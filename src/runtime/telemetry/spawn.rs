//! Child-process spans for Bun.spawn / node:child_process.

use core::ffi::{CStr, c_char};

use bun_jsc::JSGlobalObject;
use bun_telemetry::pool::{self, NativeSpan, Slot};
use bun_telemetry::{Instrument, ScopeId, SpanKind, SpanStub, Value};

use crate::api::bun_process::Status;

/// `argv` is the NUL-terminated array handed to `posix_spawn`. Only the
/// executable's basename and the argument count are recorded: arguments
/// routinely carry secrets.
fn set_command_attrs(s: &mut Slot, argv: &[*const c_char]) {
    let Some(&argv0) = argv.first().filter(|p| !p.is_null()) else {
        return;
    };
    // SAFETY: argv entries are NUL-terminated strings built by the caller.
    let exe = bun_paths::basename(unsafe { CStr::from_ptr(argv0) }.to_bytes());
    let argc = argv.iter().take_while(|p| !p.is_null()).count();
    let l = super::span::limits();
    s.name.clear();
    s.name.extend_from_slice(b"spawn ");
    s.name.extend_from_slice(exe);
    s.push_attribute(b"process.executable.name", &Value::Str(exe), l);
    s.push_attribute(b"process.args_count", &Value::Int(argc as i64), l);
}

fn begin_span(
    l: &mut bun_telemetry::Local,
    stub: SpanStub,
    attrs: impl FnOnce(&mut Slot),
) -> NativeSpan {
    pool::begin_with(
        &mut l.pool,
        stub,
        ScopeId::from(Instrument::ChildProcess),
        b"spawn",
        SpanKind::Internal,
        attrs,
    )
}

/// Wrap the pre-spawn `stub` into a span once the child exists.
pub fn begin(
    global: &JSGlobalObject,
    stub: SpanStub,
    argv: &[*const c_char],
    pid: i64,
) -> NativeSpan {
    let Some(mut l) = super::local(global) else {
        return NativeSpan::NONE;
    };
    begin_span(&mut l, stub, |s| {
        if stub.is_recording() {
            set_command_attrs(s, argv);
            s.push_attribute(b"process.pid", &Value::Int(pid), super::span::limits());
        }
    })
}

/// The spawn itself failed.
pub fn failed(global: &JSGlobalObject, stub: &SpanStub, argv: &[*const c_char], error: &[u8]) {
    if !stub.is_recording() {
        return;
    }
    let Some(mut l) = super::local(global) else {
        return;
    };
    let span = begin_span(&mut l, *stub, |s| set_command_attrs(s, argv));
    drop(l);
    super::end_native(global, span, 0, |w| {
        w.error(error, error);
    });
}

pub fn exited(global: &JSGlobalObject, span: NativeSpan, status: &Status) {
    super::end_native(global, span, 0, |w| match status {
        Status::Exited(e) => {
            w.attr("process.exit.code", i64::from(e.code));
            if e.code != 0 {
                let mut buf = bun_core::fmt::ItoaBuf::new();
                w.error(bun_core::fmt::itoa(&mut buf, e.code), b"");
            }
        }
        Status::Signaled(sig) => {
            w.attr("process.exit.signal", i64::from(*sig));
            w.error(b"signal", b"");
        }
        Status::Err(err) => {
            let e = <&'static str>::from(err.get_errno()).as_bytes();
            w.error(e, e);
        }
        Status::Running => {}
    });
}
