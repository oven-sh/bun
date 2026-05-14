use crate::jsc::{JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        b"MySQLConnection",
        crate::jsc::codegen::JSMySQLConnection::get_constructor(global_object),
    );
    crate::put_host_functions!(
        binding,
        global_object,
        [
            ("init", my_sql_context::init, 0),
            (
                "createQuery",
                js_my_sql_query::JSMySQLQuery::create_instance,
                6
            ),
            (
                "createConnection",
                js_my_sql_connection::JSMySQLConnection::create_instance,
                2
            ),
        ]
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (Phase-A draft files use PascalCase basenames; wired via
// `#[path]`). Heavy modules remain ``-gated until their lower-
// tier deps land — see per-module `TODO(b2-blocked)` markers.
// ──────────────────────────────────────────────────────────────────────────

#[path = "mysql/MySQLContext.rs"]
pub mod my_sql_context;

#[path = "mysql/MySQLStatement.rs"]
pub mod my_sql_statement;

#[path = "mysql/MySQLRequestQueue.rs"]
pub mod my_sql_request_queue;

// TODO(b2-blocked): bun_jsc::JsRef + JSValue method surface (.call, .ensure_still_alive)
// TODO(b2-blocked): bun_jsc::host_fn proc-macro

#[path = "mysql/MySQLQuery.rs"]
pub mod my_sql_query;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface

#[path = "mysql/JSMySQLQuery.rs"]
pub mod js_my_sql_query;

#[path = "mysql/MySQLValue.rs"]
pub mod my_sql_value;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro
// TODO(b2-blocked): bun_uws::Socket method surface
// TODO(b2-blocked): bun_jsc::VirtualMachine::get / RareData

#[path = "mysql/JSMySQLConnection.rs"]
pub mod js_my_sql_connection;

#[path = "mysql/MySQLConnection.rs"]
pub mod my_sql_connection;

// ──────────────────────────────────────────────────────────────────────────
// Module-name aliases.
//
// Downstream consumers (`MySQLConnection.rs`, `MySQLRequestQueue.rs`,
// `MySQLQuery.rs`, `JSMySQLConnection.rs`, `JSMySQLQuery.rs`) import via the
// `js_mysql_{connection,query}` spelling (matching `crate::jsc::codegen`).
// Re-export the file-backed modules under those names so there is exactly one
// type hierarchy — previously a parallel inline stub pair shadowed the real
// implementations and every method body panicked.
// ──────────────────────────────────────────────────────────────────────────

pub use js_my_sql_connection as js_mysql_connection;
pub use js_my_sql_query as js_mysql_query;

pub mod protocol {
    #[path = "Signature.rs"]
    pub mod signature;
    pub use signature::Signature;

    #[path = "error_packet_jsc.rs"]
    pub mod error_packet_jsc;

    #[path = "any_mysql_error_jsc.rs"]
    pub mod any_mysql_error_jsc;

    // TODO(b2-blocked): bun_jsc::JSValue method surface (date/number/buffer constructors)

    #[path = "DecodeBinaryValue.rs"]
    pub mod decode_binary_value;

    // TODO(b2-blocked): bun_jsc::JSValue / bun_jsc::JSObject method surface

    #[path = "ResultSet.rs"]
    pub mod result_set;
}

pub use my_sql_connection::MySQLConnection;
pub use my_sql_context::MySQLContext;
pub use my_sql_query::MySQLQuery;
pub use my_sql_request_queue::MySQLRequestQueue;
pub use my_sql_statement::MySQLStatement;

// ported from: src/sql_jsc/mysql.zig
