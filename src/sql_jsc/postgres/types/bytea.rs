use crate::jsc::{ArrayBuffer, JSGlobalObject, JSValue, js_error_to_postgres};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;

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

// ported from: src/sql_jsc/postgres/types/bytea.zig
