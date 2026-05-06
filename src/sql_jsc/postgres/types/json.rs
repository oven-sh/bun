use crate::jsc::{js_error_to_postgres, JSGlobalObject, JSValue, StringJsc as _};
use bun_sql::postgres::types::int_types::Short;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

pub const TO: i32 = 114;
pub const FROM: [Short; 2] = [114, 3802];

// Zig `toJS(value: *Data)` only ever takes `*Data`, but the caller
// (`tag_jsc::to_js_with_type<T>`) is generic. Model the single concrete arm as a
// trait impl so the generic dispatcher can name a bound; mirrors date.rs /
// bytea.rs.
pub trait JsonToJs {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// PORT NOTE: reshaped `value: *Data` + `defer value.deinit()` → owned `Data`;
// Drop at scope exit replaces the explicit deinit.
impl JsonToJs for Data {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_string::String::borrow_utf8(self.slice());
        // `defer str.deref()` — handled by Drop on bun_string::String.
        let js_str = str.to_js(global).map_err(js_error_to_postgres)?;
        let parse_result = js_str.parse_json(global).map_err(js_error_to_postgres)?;
        // PORT NOTE: Zig `parse_result.AnyPostgresError()` is a typo for
        // `.isAnyError()` (verified against bun_jsc surface — no `AnyPostgresError`
        // method exists on JSValue).
        if parse_result.is_any_error() {
            return Err(js_error_to_postgres(global.throw_value(parse_result)));
        }

        Ok(parse_result)
    }
}

pub fn to_js<T: JsonToJs>(
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    value.json_to_js(global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/json.zig (27 lines)
//   confidence: medium
//   todos:      0
//   notes:      `parse_result.AnyPostgresError()` was a Zig-side typo for `.isAnyError()`; deinit-on-borrowed-param reshaped to rely on Drop
// ──────────────────────────────────────────────────────────────────────────
