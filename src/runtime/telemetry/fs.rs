//! File-system spans for node:fs, Bun.file and Bun.write.

use bun_jsc::JSGlobalObject;
use bun_telemetry::{Instrument, SpanKind, SpanStub};

/// Finish an fs span. `name` is e.g. `fs.readFile`; `path` the primary path
/// argument if the op has one.
/// `end_ns`: when the operation itself finished (stamped on the thread that
/// ran it), or 0 for now.
pub fn end(
    global: &JSGlobalObject,
    stub: &SpanStub,
    name: &str,
    path: Option<&[u8]>,
    err: Option<&bun_sys::Error>,
    end_ns: u64,
) {
    super::end_leaf_at(
        global,
        Instrument::Fs,
        stub,
        name.as_bytes(),
        SpanKind::Internal,
        end_ns,
        |w| {
            if let Some(p) = path {
                w.attr_opt("file.path", p);
            }
            if let Some(e) = err {
                w.fail(e.name(), e.msg().unwrap_or(b""));
            }
        },
    );
}
