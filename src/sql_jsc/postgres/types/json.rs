use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::types::int_types::Short;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;
use bun_str::StringJsc as _; // extension trait: .to_js() on bun_str::String (allowed in *_jsc crates)

pub const TO: i32 = 114;
pub const FROM: [Short; 2] = [114, 3802];

pub fn to_js(
    global: &JSGlobalObject,
    value: &mut Data,
) -> Result<JSValue, AnyPostgresError> {
    // TODO(port): Zig did `defer value.deinit()` here — the fn consumes `value`'s
    // contents. Consider taking `value: Data` by value so Drop fires at scope exit
    // instead of relying on the caller. Kept `&mut Data` per the *T param mapping.
    let str = bun_str::String::borrow_utf8(value.slice());
    // `defer str.deref()` — handled by Drop on bun_str::String.
    let parse_result = JSValue::parse(str.to_js(global), global);
    // TODO(port): Zig calls `parse_result.AnyPostgresError()` — almost certainly a
    // typo for `.isAnyError()`. Ported literally; Phase B should verify against
    // JSValue's actual API.
    if parse_result.any_postgres_error() {
        // TODO(port): narrow error set — throw_value returns JsResult; AnyPostgresError
        // must have From<JsError> for this to type-check.
        return global.throw_value(parse_result);
    }

    Ok(parse_result)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/json.zig (27 lines)
//   confidence: medium
//   todos:      3
//   notes:      `parse_result.AnyPostgresError()` looks like a Zig-side typo for `.isAnyError()`; deinit-on-borrowed-param reshaped to rely on Drop
// ──────────────────────────────────────────────────────────────────────────
