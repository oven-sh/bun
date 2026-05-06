use crate::jsc::{JSGlobalObject, JSValue, JSValueSqlExt};
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
        // Zig passed `null` allocator → C++ copies; map to the copying overload
        // (`create_buffer_copy` takes `&[u8]`).
        Ok(JSValue::create_buffer_copy(global, self.slice()))
    }
}

pub fn to_js<T: ByteaToJs>(
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    value.bytea_to_js(global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/bytea.zig (23 lines)
//   confidence: high
//   todos:      0
//   notes:      TO const typed as `Short` to match FROM; verify against sibling type modules.
// ──────────────────────────────────────────────────────────────────────────
