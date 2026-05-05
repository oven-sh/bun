//! `from_js` for `bun.schema.api.SourceMapMode` — kept out of
//! `options_types/schema.zig` so that file has no `JSGlobalObject`/`JSValue`
//! references.

use crate::{JSGlobalObject, JSValue, JsResult};

// TODO(b2-blocked): bun_options_types::schema::api::SourceMapMode
// schema.rs is a peechy-generated stub that does not yet emit `SourceMapMode`.
// The fn is gated whole (signature names the missing type).
#[cfg(any())]
pub fn source_map_mode_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<bun_options_types::schema::api::SourceMapMode>> {
    use bun_options_types::schema::api::SourceMapMode;
    // TODO(b2-blocked): bun_jsc::JSValue::is_string
    // TODO(b2-blocked): bun_jsc::JSValue::to_slice_or_null
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
    Ok(None)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/source_map_mode_jsc.zig (27 lines)
//   confidence: high
//   todos:      0
//   notes:      SourceMapMode import path assumed bun_options_types::schema::api per doc-comment hint
// ──────────────────────────────────────────────────────────────────────────
