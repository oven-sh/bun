//! Child-process spans for Bun.spawn / node:child_process.

use core::ffi::{CStr, c_char};

use bun_jsc::JSGlobalObject;
use bun_telemetry::pool::{self, NativeSpan, Slot};
use bun_telemetry::{DEFAULT_LIMITS, Instrument, ScopeId, SpanKind, SpanStub, StatusCode, Value};

fn set_command_attrs(s: &mut Slot, argv: &[*const c_char]) {
    let l = &DEFAULT_LIMITS;
    let mut owned: Vec<&[u8]> = Vec::with_capacity(argv.len().min(32));
    for (i, p) in argv.iter().enumerate() {
        if p.is_null() || i >= 32 {
            break;
        }
        // SAFETY: argv entries are NUL-terminated strings built by the caller.
        owned.push(unsafe { CStr::from_ptr(*p) }.to_bytes());
    }
    let Some(exe) = owned.first() else { return };
    let base = bun_paths::basename(exe);
    s.name.clear();
    s.name.extend_from_slice(b"spawn ");
    s.name.extend_from_slice(base);
    s.push_attribute(b"process.executable.name", &Value::Str(base), l);
    s.push_attribute(b"process.executable.path", &Value::Str(exe), l);
    let vals: Vec<Value<'_>> = owned
        .iter()
        .map(|a| Value::Str(bun_telemetry::otlp::truncate_utf8(a, 256)))
        .collect();
    s.push_attribute(b"process.command_args", &Value::Array(&vals), l);
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
    pool::begin_with(
        &mut l.pool,
        stub,
        ScopeId::from(Instrument::ChildProcess),
        b"spawn",
        SpanKind::Internal,
        |s| {
            if stub.is_recording() {
                set_command_attrs(s, argv);
                s.push_attribute(b"process.pid", &Value::Int(pid), &DEFAULT_LIMITS);
            }
        },
    )
}

/// The spawn itself failed.
pub fn failed(global: &JSGlobalObject, stub: &SpanStub, argv: &[*const c_char], error: &[u8]) {
    if !stub.is_recording() {
        return;
    }
    let Some(mut l) = super::local(global) else {
        return;
    };
    let span = pool::begin_with(
        &mut l.pool,
        *stub,
        ScopeId::from(Instrument::ChildProcess),
        b"spawn",
        SpanKind::Internal,
        |s| set_command_attrs(s, argv),
    );
    drop(l);
    super::end_native(global, span, 0, |w| {
        w.attr("error.type", error);
        w.status(StatusCode::Error, error);
    });
}

/// The child exited. `signal` is the terminating signal number, if any.
pub fn exited(
    global: &JSGlobalObject,
    span: NativeSpan,
    exit_code: Option<i32>,
    signal: Option<u8>,
    error: Option<&str>,
) {
    super::end_native(global, span, 0, |w| {
        if let Some(c) = exit_code {
            w.attr("process.exit.code", c as i64);
            if c != 0 {
                let mut buf = bun_core::fmt::ItoaBuf::new();
                let s = bun_core::fmt::itoa(&mut buf, c);
                w.attr("error.type", s);
                w.status(StatusCode::Error, b"");
            }
        }
        if let Some(sig) = signal {
            w.attr("process.exit.signal", sig as i64);
            w.attr("error.type", "signal");
            w.status(StatusCode::Error, b"");
        }
        if let Some(e) = error {
            w.attr("error.type", e);
            w.status(StatusCode::Error, e.as_bytes());
        }
    });
}
