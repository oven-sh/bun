use crate::jsc::{JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        b"PostgresSQLConnection",
        postgres_sql_connection::js::get_constructor(global_object),
    );
    crate::put_host_functions!(
        binding,
        global_object,
        [
            ("init", PostgresSQLContext::init, 0),
            ("createQuery", PostgresSQLQuery::call, 6),
            ("createConnection", postgres_sql_connection::call, 2),
        ]
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (files use PascalCase basenames; wired via `#[path]`).
// ──────────────────────────────────────────────────────────────────────────

#[path = "postgres/SASL.rs"]
pub mod sasl;
pub use sasl::SASL;

#[path = "postgres/AuthenticationState.rs"]
pub mod authentication_state;
pub use authentication_state::AuthenticationState;

#[path = "postgres/PostgresSQLContext.rs"]
pub mod postgres_sql_context;
pub use postgres_sql_context::PostgresSQLContext;

#[path = "postgres/Signature.rs"]
pub mod signature;
pub use signature::Signature;

#[path = "postgres/command_tag_jsc.rs"]
pub(crate) mod command_tag_jsc;

#[path = "postgres/error_jsc.rs"]
pub(crate) mod error_jsc;

#[path = "postgres/PostgresSQLStatement.rs"]
pub mod postgres_sql_statement;
pub use postgres_sql_statement::PostgresSQLStatement;

#[path = "postgres/PostgresSQLConnection.rs"]
pub mod postgres_sql_connection;
pub use postgres_sql_connection::PostgresSQLConnection;

#[path = "postgres/PostgresSQLQuery.rs"]
pub mod postgres_sql_query;
pub use postgres_sql_query::PostgresSQLQuery;

#[path = "postgres/PostgresRequest.rs"]
pub mod postgres_request;

#[path = "postgres/DataCell.rs"]
pub mod data_cell;

pub(crate) mod types {
    #[path = "date.rs"]
    pub(crate) mod date;

    #[path = "tag_jsc.rs"]
    pub(crate) mod tag_jsc;
}

pub(crate) mod protocol {
    #[path = "error_response_jsc.rs"]
    pub(crate) mod error_response_jsc;
}

// Re-exports of base-crate protocol/types modules.
pub use bun_sql::postgres::postgres_protocol as base_protocol;
pub use bun_sql::postgres::postgres_types as base_types;
