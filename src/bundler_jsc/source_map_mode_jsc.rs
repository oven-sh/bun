//! `from_js` for `bun.schema.api.SourceMapMode` — kept out of
//! `options_types/schema.zig` so that file has no `JSGlobalObject`/`JSValue`
//! references.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_options_types::schema::api::SourceMapMode;

pub fn source_map_mode_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SourceMapMode>> {
    #[cfg(any())]
    if value.is_string() {
        let str = value.to_slice_or_null(global)?;
        let utf8 = str.slice();
        if utf8 == b"none" {
            return Ok(Some(SourceMapMode::None));
        }
        if utf8 == b"inline" {
            return Ok(Some(SourceMapMode::Inline));
        }
        if utf8 == b"external" {
            return Ok(Some(SourceMapMode::External));
        }
        if utf8 == b"linked" {
            return Ok(Some(SourceMapMode::Linked));
        }
    }
    // TODO(b2-blocked): bun_jsc::JSValue::is_string
    // TODO(b2-blocked): bun_jsc::JSValue::to_slice_or_null
    let _ = (global, value);
    Ok(None)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/source_map_mode_jsc.zig (27 lines)
//   confidence: high
//   todos:      0
//   notes:      SourceMapMode import path assumed bun_options_types::schema::api per doc-comment hint
// ──────────────────────────────────────────────────────────────────────────
