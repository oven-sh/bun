use crate::jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::int_types::short;

pub const TO: short = 16;
pub const FROM: [short; 1] = [16];

pub fn to_js(_: &JSGlobalObject, value: bool) -> Result<JSValue, AnyPostgresError> {
    Ok(JSValue::js_boolean(value))
}

// ported from: src/sql_jsc/postgres/types/bool.zig
