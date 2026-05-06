use crate::jsc::{JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::JSValue::{create_empty_object_with_null_prototype,put}
        // TODO(b2-blocked): bun_jsc::JSFunction::create
        // TODO(b2-blocked): bun_string::ZigString::static_str
        // TODO(b2-blocked): bun_jsc codegen `js::get_constructor` for #[JsClass] types
        let binding = JSValue::create_empty_object_with_null_prototype(global_object);
        binding.put(
            global_object,
            bun_string::ZigString::static_str(b"PostgresSQLConnection"),
            PostgresSQLConnection::js::get_constructor(global_object),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_str(b"init"),
            bun_jsc::JSFunction::create(global_object, "init", PostgresSQLContext::init, 0, Default::default()),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_str(b"createQuery"),
            bun_jsc::JSFunction::create(global_object, "createQuery", PostgresSQLQuery::call, 6, Default::default()),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_str(b"createConnection"),
            bun_jsc::JSFunction::create(global_object, "createConnection", PostgresSQLConnection::call, 2, Default::default()),
        );
        return binding;
    }
    #[cfg(not(any()))]
    {
        let _ = global_object;
        unimplemented!("b2-blocked: bun_jsc::JSValue / JSFunction method surface")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (Phase-A draft files use PascalCase basenames; wired via
// `#[path]`). Heavy modules remain `#[cfg(any())]`-gated until their lower-
// tier deps land — see per-module `TODO(b2-blocked)` markers.
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
pub mod command_tag_jsc;

#[path = "postgres/error_jsc.rs"]
pub mod error_jsc;

#[path = "postgres/PostgresSQLStatement.rs"]
pub mod postgres_sql_statement;
pub use postgres_sql_statement::PostgresSQLStatement;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface
// TODO(b2-blocked): bun_uws::Socket method surface
// TODO(b2-blocked): bun_jsc::VirtualMachine::get / RareData
#[cfg(any())]
#[path = "postgres/PostgresSQLConnection.rs"]
pub mod postgres_sql_connection;
#[cfg(not(any()))]
pub mod postgres_sql_connection {
    pub struct PostgresSQLConnection {
        pub password: Vec<u8>,
    }
}
pub use postgres_sql_connection::PostgresSQLConnection;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface
#[cfg(any())]
#[path = "postgres/PostgresSQLQuery.rs"]
pub mod postgres_sql_query;
#[cfg(not(any()))]
pub mod postgres_sql_query {
    pub struct PostgresSQLQuery(());
}
pub use postgres_sql_query::PostgresSQLQuery;

// TODO(b2-blocked): bun_jsc::JSValue / bun_jsc::JSObject method surface
#[cfg(any())]
#[path = "postgres/PostgresRequest.rs"]
pub mod postgres_request;

// TODO(b2-blocked): bun_jsc::js_object::ExternColumnIdentifier
// TODO(b2-blocked): bun_jsc::JSType (real enum)
// TODO(b2-blocked): bun_string::wtf::{RefPtr,StringImpl}
#[cfg(any())]
#[path = "postgres/DataCell.rs"]
pub mod data_cell;

pub mod types {
    #[path = "bool.rs"]
    pub mod r#bool;

    #[path = "bytea.rs"]
    pub mod bytea;

    #[path = "date.rs"]
    pub mod date;

    #[path = "json.rs"]
    pub mod json;

    #[path = "PostgresString.rs"]
    pub mod postgres_string;

    #[path = "tag_jsc.rs"]
    pub mod tag_jsc;
}

pub mod protocol {
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::take_error
    // TODO(b2-blocked): bun_string::String::{utf8_byte_length,byte_slice,eql,is_empty}
    // TODO(b2-blocked): bun_string::StringBuilder::{append,append_str,allocated_slice}
    // TODO(b2-blocked): bun_sql::postgres::protocol::error_response::FieldMessage
    #[cfg(any())]
    #[path = "error_response_jsc.rs"]
    pub mod error_response_jsc;

    #[path = "notice_response_jsc.rs"]
    pub mod notice_response_jsc;
}

// Re-exports of base-crate protocol/types modules (Zig: thin re-exports).
pub use bun_sql::postgres::postgres_protocol as base_protocol;
pub use bun_sql::postgres::postgres_types as base_types;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres.zig (30 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) above
//   notes:      `create_binding` body gated; submodule filenames PascalCase → #[path]
// ──────────────────────────────────────────────────────────────────────────
