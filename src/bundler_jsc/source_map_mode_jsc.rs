//! `from_js` for `bun.schema.api.SourceMapMode` — kept here so the schema
//! module has no `JSGlobalObject`/`JSValue` references.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_options_types::schema::api::SourceMapMode;

pub fn source_map_mode_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SourceMapMode>> {
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
