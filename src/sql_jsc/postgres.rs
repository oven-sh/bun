use bun_jsc::{JSFunction, JSGlobalObject, JSValue};
use bun_str::ZigString;

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        ZigString::static_str(b"PostgresSQLConnection"),
        PostgresSQLConnection::js::get_constructor(global_object),
    );
    binding.put(
        global_object,
        ZigString::static_str(b"init"),
        JSFunction::create(global_object, "init", PostgresSQLContext::init, 0, Default::default()),
    );
    binding.put(
        global_object,
        ZigString::static_str(b"createQuery"),
        JSFunction::create(global_object, "createQuery", PostgresSQLQuery::call, 6, Default::default()),
    );

    binding.put(
        global_object,
        ZigString::static_str(b"createConnection"),
        JSFunction::create(global_object, "createConnection", PostgresSQLConnection::call, 2, Default::default()),
    );

    binding
}

// Thin re-exports — do NOT inline target bodies (see PORTING.md).
pub mod postgres_sql_connection;
pub mod postgres_sql_context;
pub mod postgres_sql_query;

pub use postgres_sql_connection::PostgresSQLConnection;
pub use postgres_sql_context::PostgresSQLContext;
pub use postgres_sql_query::PostgresSQLQuery;

pub use bun_sql::postgres::postgres_protocol as protocol;
pub use bun_sql::postgres::postgres_types as types;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres.zig (30 lines)
//   confidence: high
//   todos:      0
//   notes:      ZigString::static renamed static_str (keyword clash); ::js::get_constructor assumes #[bun_jsc::JsClass] codegen.
// ──────────────────────────────────────────────────────────────────────────
