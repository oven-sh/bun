use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _};
use bun_sql::postgres::types::int_types::Short;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

pub const TO: i32 = 114;
pub const FROM: [Short; 2] = [114, 3802];

// PORT NOTE: reshaped `value: *Data` + `defer value.deinit()` → owned `Data`;
// Drop at scope exit replaces the explicit deinit.
pub fn to_js(
    global: &JSGlobalObject,
    value: Data,
) -> Result<JSValue, AnyPostgresError> {
    let str = bun_string::String::borrow_utf8(value.slice());
    // `defer str.deref()` — handled by Drop on bun_string::String.
    let parse_result = JSValue::parse_json(str.to_js(global)?, global);
    // PORT NOTE: Zig `parse_result.AnyPostgresError()` is a typo for
    // `.isAnyError()` (verified against bun_jsc surface — no `AnyPostgresError`
    // method exists on JSValue).
    if parse_result.is_any_error() {
        return Err(global.throw_value(parse_result).into());
    }

    Ok(parse_result)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/json.zig (27 lines)
//   confidence: medium
//   todos:      0
//   notes:      `parse_result.AnyPostgresError()` was a Zig-side typo for `.isAnyError()`; deinit-on-borrowed-param reshaped to rely on Drop
// ──────────────────────────────────────────────────────────────────────────
