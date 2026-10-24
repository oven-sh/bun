//! JS testing bindings for `InternalSourceMap`. Keeps `src/sourcemap/` free of JSC types.

use bun_core::MutableString;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal};
use bun_sourcemap::Ordinal;
use bun_sourcemap::internal_source_map::{self, InternalSourceMap};

use crate::generated_bindgen::internal_source_map::InternalSourceMapMapping;

pub(crate) fn from_vlq<'a>(
    heap: &JsHeap<'a>,
    vlq: &[u8],
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    let Ok(blob) = internal_source_map::from_vlq(vlq) else {
        return Err(heap.error(format_args!("InternalSourceMap.fromVLQ: invalid VLQ input")));
    };
    heap.create_uint8_array(&blob)
}

pub(crate) fn to_vlq<'a>(heap: &JsHeap<'a>, blob: &[u8]) -> bindgen::Result<'a, Vec<u8>> {
    if !internal_source_map::is_valid_blob(blob) {
        return Err(heap.error(format_args!("InternalSourceMap.toVLQ: invalid blob")));
    }
    let ism = InternalSourceMap {
        data: blob.as_ptr(),
    };
    let mut out = MutableString::init_empty();
    ism.append_vlq_to(&mut out);
    Ok(out.list)
}

pub(crate) fn find<'a>(
    heap: &JsHeap<'a>,
    blob: &[u8],
    line: f64,
    col: f64,
) -> bindgen::Result<'a, Option<InternalSourceMapMapping>> {
    if !internal_source_map::is_valid_blob(blob) {
        return Err(heap.error(format_args!("InternalSourceMap.find: invalid blob")));
    }
    let line = line as i32;
    let col = col as i32;
    if line < 0 || col < 0 {
        return Ok(None);
    }
    let ism = InternalSourceMap {
        data: blob.as_ptr(),
    };
    let Some(mapping) = ism.find(
        Ordinal::from_zero_based(line),
        Ordinal::from_zero_based(col),
    ) else {
        return Ok(None);
    };

    Ok(Some(InternalSourceMapMapping {
        generated_line: mapping.generated.lines.zero_based(),
        generated_column: mapping.generated.columns.zero_based(),
        original_line: mapping.original.lines.zero_based(),
        original_column: mapping.original.columns.zero_based(),
        source_index: mapping.source_index,
    }))
}
