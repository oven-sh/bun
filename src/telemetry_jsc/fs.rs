//! node:fs, `Bun.file()` and `Bun.write()`.

use bun_jsc::JSGlobalObject;
use bun_telemetry::{Instrument, Record, SpanKind};

use crate::native::NativeSpan;
use crate::promise::PromiseSpan;

fn describe(record: &mut Record, name: [&str; 3], path: Option<&[u8]>) {
    record.set_name(name.concat().as_bytes());
    record.attr_opt("file.path", path.unwrap_or_default());
}

/// `suffix` is `"Sync"` or empty.
#[inline(always)]
pub fn begin<'a>(
    global: &JSGlobalObject,
    operation: &str,
    suffix: &str,
    path: impl FnOnce() -> Option<&'a [u8]>,
) -> NativeSpan {
    NativeSpan::start(global, Instrument::Fs, SpanKind::Internal, |r| {
        describe(r, ["fs.", operation, suffix], path());
    })
}

#[inline(always)]
pub fn begin_promise<'a>(
    global: &JSGlobalObject,
    operation: &str,
    path: impl FnOnce() -> Option<&'a [u8]>,
) -> PromiseSpan {
    PromiseSpan::start(global, Instrument::Fs, SpanKind::Internal, |r| {
        describe(r, ["fs.", operation, ""], path());
    })
}
