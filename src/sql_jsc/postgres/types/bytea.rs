use crate::jsc::{ArrayBuffer, JSGlobalObject, JSValue, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::int_types::Short;
use bun_sql::shared::Data;

pub const TO: Short = 17;
pub const FROM: [Short; 1] = [17];

// Zig `toJS(value: *Data)` only ever takes `*Data`, but the caller
// (`tag_jsc::to_js_with_type<T>`) is generic. Model the single concrete arm as a
// trait impl so the generic dispatcher can name a bound; mirrors date.rs /
// PostgresString.rs.
pub trait ByteaToJs {
    fn bytea_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// PORT NOTE: reshaped `value: *Data` + `defer value.deinit()` → owned `Data`;
// Drop at scope exit replaces the explicit deinit.
impl ByteaToJs for Data {
    fn bytea_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        // var slice = value.slice()[@min(1, value.len)..];
        // _ = slice;
        //
        // Zig's `JSValue.createBuffer(global, slice, null)` with a null
        // allocator maps to the copying Buffer constructor: `self.slice()`
        // borrows a transient decode buffer that `Drop` frees on return, so
        // JSC must own its own copy.
        ArrayBuffer::create_buffer(global, self.slice()).map_err(js_error_to_postgres)
    }
}

pub fn to_js<T: ByteaToJs>(global: &JSGlobalObject, value: T) -> Result<JSValue, AnyPostgresError> {
    value.bytea_to_js(global)
}

// ported from: src/sql_jsc/postgres/types/bytea.zig
