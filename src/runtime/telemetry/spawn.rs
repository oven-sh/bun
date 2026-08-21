//! Child-process spans for Bun.spawn / node:child_process.

use core::ffi::{CStr, c_char};

use bun_telemetry::data::DEFAULT_LIMITS;
use bun_telemetry::{Instrument, ScopeId, Span, SpanKind, SpanStub, StatusCode, Value};

fn base_name(path: &[u8]) -> &[u8] {
    bun_paths::basename(path)
}

fn set_command_attrs(span: &Span, argv: &[*const c_char]) {
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
    let mut name = Vec::with_capacity(6 + exe.len());
    name.extend_from_slice(b"spawn ");
    name.extend_from_slice(base_name(exe));
    span.set_name(&name);
    span.set_attribute(b"process.executable.name", &Value::Str(base_name(exe)), l);
    span.set_attribute(b"process.executable.path", &Value::Str(exe), l);
    let vals: Vec<Value<'_>> = owned
        .iter()
        .map(|a| Value::Str(if a.len() > 256 { &a[..256] } else { a }))
        .collect();
    span.set_attribute(b"process.command_args", &Value::Array(&vals), l);
}

/// Wrap the pre-spawn `stub` into a span once the child exists.
pub fn begin(stub: SpanStub, argv: &[*const c_char], pid: i64) -> Option<Span> {
    if !stub.is_some() {
        return None;
    }
    let span = Span::new(
        stub,
        ScopeId::from(Instrument::ChildProcess),
        b"spawn",
        SpanKind::Internal,
    );
    if stub.is_recording() {
        set_command_attrs(&span, argv);
        span.set_attribute(b"process.pid", &Value::Int(pid), &DEFAULT_LIMITS);
    }
    Some(span)
}

/// The spawn itself failed.
pub fn failed(stub: &SpanStub, argv: &[*const c_char], error: &str) {
    if !stub.is_recording() {
        return;
    }
    let span = Span::new(
        *stub,
        ScopeId::from(Instrument::ChildProcess),
        b"spawn",
        SpanKind::Internal,
    );
    set_command_attrs(&span, argv);
    super::end_span(&span, 0, |w| {
        w.attr("error.type", error);
        w.status(StatusCode::Error, error.as_bytes());
    });
}

/// The child exited. `signal` is the terminating signal number, if any.
pub fn exited(span: Span, exit_code: Option<i32>, signal: Option<u8>, error: Option<&str>) {
    super::end_span(&span, 0, |w| {
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
