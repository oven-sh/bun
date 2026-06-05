use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

/// "no impl" compile error.
pub trait ToJsWithType {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

impl ToJsWithType for &[u8] {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_core::String::borrow_utf8(self);
        // `defer str.deinit()` → Drop on bun_core::String
        str.to_js(global).map_err(js_error_to_postgres)
    }
}

impl ToJsWithType for bun_core::String {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        self.to_js(global).map_err(js_error_to_postgres)
    }
}

// Takes owned `Data`; Drop at the
// end of this fn frees it (same pattern as bytea.rs/json.rs).
impl ToJsWithType for Data {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_core::String::borrow_utf8(self.slice());
        // `defer str.deinit()` → Drop on bun_core::String. `to_js` copies into
        // a JSC-owned string, so dropping `self` (the Data) on return is safe.
        str.to_js(global).map_err(js_error_to_postgres)
    }
}
