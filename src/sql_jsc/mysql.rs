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

#[path = "mysql/MySQLContext.rs"]
pub mod my_sql_context;

#[path = "mysql/MySQLStatement.rs"]
pub mod my_sql_statement;

#[path = "mysql/MySQLRequestQueue.rs"]
pub mod my_sql_request_queue;

// TODO(port): bun_jsc::JsRef + JSValue method surface (.call, .ensure_still_alive)
// TODO(port): bun_jsc::host_fn proc-macro

#[path = "mysql/MySQLQuery.rs"]
pub mod my_sql_query;

// TODO(port): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface

#[path = "mysql/JSMySQLQuery.rs"]
pub mod js_my_sql_query;

#[path = "mysql/MySQLValue.rs"]
pub mod my_sql_value;

// TODO(port): bun_jsc::host_fn proc-macro
// TODO(port): bun_uws::Socket method surface
// TODO(port): bun_jsc::VirtualMachine::get / RareData

#[path = "mysql/JSMySQLConnection.rs"]
pub mod js_my_sql_connection;

#[path = "mysql/MySQLConnection.rs"]
pub mod my_sql_connection;

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

    // TODO(port): bun_jsc::JSValue method surface (date/number/buffer constructors)

    #[path = "DecodeBinaryValue.rs"]
    pub mod decode_binary_value;

    // TODO(port): bun_jsc::JSValue / bun_jsc::JSObject method surface

    #[path = "ResultSet.rs"]
    pub mod result_set;
}

pub use my_sql_connection::MySQLConnection;
pub use my_sql_context::MySQLContext;
pub use my_sql_query::MySQLQuery;
pub use my_sql_request_queue::MySQLRequestQueue;
pub use my_sql_statement::MySQLStatement;

// ported from: src/sql_jsc/mysql.zig
