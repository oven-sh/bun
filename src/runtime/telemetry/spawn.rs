//! Child-process spans for Bun.spawn / node:child_process.

use bun_jsc::JSGlobalObject;
use bun_telemetry::pool::{NativeSpan, Slot};
use bun_telemetry::{Instrument, SpanKind, SpanStub, Value};

use crate::api::bun_process::Status;

/// What a spawn span records about the command: only the executable's
/// basename and the argument count (arguments routinely carry secrets).
pub struct SpawnedCommand<'a> {
    /// basename of the resolved executable
    pub exe: &'a [u8],
    pub argc: usize,
}

fn set_command_attrs(s: &mut Slot, cmd: &SpawnedCommand<'_>) {
    let l = super::span::limits();
    s.name.clear();
    s.name.extend_from_slice(b"spawn ");
    s.name.extend_from_slice(cmd.exe);
    s.push_attribute(b"process.executable.name", &Value::Str(cmd.exe), l);
    s.push_attribute(b"process.args_count", &Value::Int(cmd.argc as i64), l);
}

/// Wrap the pre-spawn `stub` into a span once the child exists.
#[inline]
pub fn begin(
    global: &JSGlobalObject,
    stub: SpanStub,
    cmd: &SpawnedCommand<'_>,
    pid: i64,
) -> NativeSpan {
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    bun_telemetry::rt::begin_pooled(
        global.as_ptr().cast(),
        Instrument::ChildProcess,
        stub,
        b"spawn",
        SpanKind::Internal,
        |s| {
            if stub.is_recording() {
                set_command_attrs(s, cmd);
                s.push_attribute(b"process.pid", &Value::Int(pid), super::span::limits());
            }
        },
    )
}

/// The spawn itself failed.
pub fn failed(global: &JSGlobalObject, stub: &SpanStub, cmd: &SpawnedCommand<'_>, error: &[u8]) {
    if !stub.is_recording() {
        return;
    }
    let span = bun_telemetry::rt::begin_pooled(
        global.as_ptr().cast(),
        Instrument::ChildProcess,
        *stub,
        b"spawn",
        SpanKind::Internal,
        |s| set_command_attrs(s, cmd),
    );
    super::end_native(global, span, 0, |w| {
        w.fail(error, b"");
    });
}

pub fn exited(global: &JSGlobalObject, span: NativeSpan, status: &Status) {
    super::end_native(global, span, 0, |w| match status {
        Status::Exited(e) => {
            w.attr("process.exit.code", i64::from(e.code));
            if e.code != 0 {
                // A non-zero exit is the child's verdict; error.type carries it
                // (no exception happened in this process).
                let mut buf = bun_core::fmt::ItoaBuf::new();
                w.error(bun_core::fmt::itoa(&mut buf, e.code), b"");
            }
        }
        Status::Signaled(sig) => {
            // error.type = the signal name (SIGKILL, …); RT signals by number.
            let mut buf = bun_core::fmt::ItoaBuf::new();
            let name = match bun_core::SignalCode::from_raw(*sig) {
                Some(s) => s.name().as_bytes(),
                None => bun_core::fmt::itoa(&mut buf, *sig),
            };
            w.error(name, b"");
        }
        Status::Err(err) => {
            w.fail(err.name(), err.msg().unwrap_or(b""));
        }
        Status::Running => {}
    });
}
