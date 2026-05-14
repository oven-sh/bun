use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::int_types::Short;
use bun_sql::shared::Data;

pub const TO: i32 = 114;
pub const FROM: [Short; 2] = [114, 3802];

// `toJS` only ever takes `Data`, but the caller (`tag_jsc::to_js_with_type<T>`)
// is generic. Model the single concrete arm as a trait impl so the generic
// dispatcher can name a bound; mirrors date.rs / bytea.rs.
pub trait JsonToJs {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// Takes `Data` by value so Drop at scope exit frees the transient decode buffer.
impl JsonToJs for Data {
    fn json_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_core::String::borrow_utf8(self.slice());
        // Drop on bun_core::String releases the ref.
        let js_str = str.to_js(global).map_err(js_error_to_postgres)?;
        let parse_result = js_str.parse_json(global).map_err(js_error_to_postgres)?;
        if parse_result.is_any_error() {
            return Err(js_error_to_postgres(global.throw_value(parse_result)));
        }

        Ok(parse_result)
    }
}

pub fn to_js<T: JsonToJs>(global: &JSGlobalObject, value: T) -> Result<JSValue, AnyPostgresError> {
    value.json_to_js(global)
}
