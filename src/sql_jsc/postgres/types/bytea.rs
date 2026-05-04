use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::int_types::short;
use bun_sql::shared::Data;

pub const TO: short = 17;
pub const FROM: [short; 1] = [17];

// PORT NOTE: reshaped `value: *Data` + `defer value.deinit()` → owned `Data`;
// Drop at scope exit replaces the explicit deinit.
pub fn to_js(
    global: &JSGlobalObject,
    value: Data,
) -> Result<JSValue, AnyPostgresError> {
    // var slice = value.slice()[@min(1, value.len)..];
    // _ = slice;
    Ok(JSValue::create_buffer(global, value.slice(), None))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/bytea.zig (23 lines)
//   confidence: high
//   todos:      0
//   notes:      TO const typed as `short` to match FROM; verify against sibling type modules.
// ──────────────────────────────────────────────────────────────────────────
