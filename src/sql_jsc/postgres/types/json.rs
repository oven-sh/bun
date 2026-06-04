use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

// bytea.rs.
pub trait JsonToJs {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// Takes `Data` by value; Drop at scope exit frees the decode buffer.
impl JsonToJs for Data {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_core::String::borrow_utf8(self.slice());
        // `defer str.deref()` — handled by Drop on bun_core::String.
        let js_str = str.to_js(global).map_err(js_error_to_postgres)?;
        let parse_result = js_str.parse_json(global).map_err(js_error_to_postgres)?;
        // The Zig original called `parse_result.AnyPostgresError()`, a typo
        // for `.isAnyError()` (no `AnyPostgresError` method exists on
        // JSValue); the intended check is "did parsing produce an error".
        if parse_result.is_any_error() {
            return Err(js_error_to_postgres(global.throw_value(parse_result)));
        }

        Ok(parse_result)
    }
}

// ported from: src/sql_jsc/postgres/types/json.zig
