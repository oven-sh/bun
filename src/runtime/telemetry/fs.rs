//! File-system spans for node:fs, Bun.file and Bun.write.

use bun_jsc::JSGlobalObject;
use bun_telemetry::{Instrument, SpanKind, SpanStub};

/// Finish an fs span. `name` is e.g. `fs.readFile`; `path` the primary path
/// argument if the op has one.
pub fn end(
    global: &JSGlobalObject,
    stub: &SpanStub,
    name: &str,
    path: Option<&[u8]>,
    err: Option<&bun_sys::Error>,
) {
    super::end_leaf(
        global,
        Instrument::Fs,
        stub,
        name.as_bytes(),
        SpanKind::Internal,
        |w| {
            if let Some(p) = path {
                w.attr_opt("file.path", p);
            }
            if let Some(e) = err {
                w.error(e.name(), e.name());
            }
        },
    );
}
