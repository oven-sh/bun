// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (files use PascalCase basenames; wired via `#[path]`).
// ──────────────────────────────────────────────────────────────────────────

#[path = "postgres/SASL.rs"]
pub mod sasl;

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
pub mod command_tag_jsc;

#[path = "postgres/error_jsc.rs"]
pub mod error_jsc;

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

pub mod types {
    #[path = "date.rs"]
    pub mod date;

    #[path = "tag_jsc.rs"]
    pub mod tag_jsc;
}

pub mod protocol {
    #[path = "error_response_jsc.rs"]
    pub mod error_response_jsc;
}
