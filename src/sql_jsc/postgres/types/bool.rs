use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::types::int_types::short;
use bun_sql::postgres::AnyPostgresError;

pub const TO: short = 16;
pub const FROM: [short; 1] = [16];

pub fn to_js(
    _: &JSGlobalObject,
    value: bool,
) -> Result<JSValue, AnyPostgresError> {
    Ok(JSValue::from(value))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/bool.zig (18 lines)
//   confidence: high
//   todos:      0
//   notes:      TO const was untyped comptime_int in Zig; assumed `short` to match FROM.
// ──────────────────────────────────────────────────────────────────────────
