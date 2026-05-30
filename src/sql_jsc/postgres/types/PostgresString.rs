use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

/// "no impl" compile error.
pub trait ToJsWithType {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// Covers Zig arms `[:0]u8, []u8, []const u8, [:0]const u8` — all collapse to a byte slice.
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

impl ToJsWithType for &mut Data {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_core::String::borrow_utf8(self.slice());
        // `defer str.deinit()` → Drop on bun_core::String
        // TODO(port): Zig calls `value.deinit()` here (consumes the Data). In Rust, Data's
        // Drop should handle this at the caller's scope; revisit ownership if Data must be
        // freed before this fn returns.
        str.to_js(global).map_err(js_error_to_postgres)
    }
}

// ported from: src/sql_jsc/postgres/types/PostgresString.zig
