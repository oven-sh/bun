// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (files use PascalCase basenames; wired via `#[path]`).
// ──────────────────────────────────────────────────────────────────────────

#[path = "mysql/MySQLContext.rs"]
pub mod my_sql_context;

#[path = "mysql/MySQLStatement.rs"]
pub mod my_sql_statement;

#[path = "mysql/MySQLRequestQueue.rs"]
pub mod my_sql_request_queue;

#[path = "mysql/MySQLQuery.rs"]
pub mod my_sql_query;

#[path = "mysql/JSMySQLQuery.rs"]
pub mod js_my_sql_query;

#[path = "mysql/MySQLValue.rs"]
pub mod my_sql_value;

#[path = "mysql/JSMySQLConnection.rs"]
pub mod js_my_sql_connection;

#[path = "mysql/MySQLConnection.rs"]
pub mod my_sql_connection;

pub mod protocol {
    #[path = "error_packet_jsc.rs"]
    pub mod error_packet_jsc;

    #[path = "any_mysql_error_jsc.rs"]
    pub mod any_mysql_error_jsc;

    #[path = "DecodeBinaryValue.rs"]
    pub(crate) mod decode_binary_value;

    #[path = "ResultSet.rs"]
    pub mod result_set;
}

pub use my_sql_context::MySQLContext;
