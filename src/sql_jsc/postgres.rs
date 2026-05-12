use crate::jsc::{JSFunction, JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    // NB: the win-x64 segfault originally observed here was an ABI mismatch in
    // the `get_constructor!` extern declaration — fixed at source by switching
    // to `jsc_abi_extern!` in `crate::jsc::codegen`. Statement order below is
    // not load-bearing.
    let connection_ctor = postgres_sql_connection::js::get_constructor(global_object);
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(global_object, b"PostgresSQLConnection", connection_ctor);
    // `JSFunction::create` accepts safe `fn(&JSGlobalObject, &CallFrame) -> JSValue` /
    // `-> JsResult<JSValue>` directly via `IntoJSHostFn` (Zig: `jsc.toJSHostFn(fn)`);
    // the JSC-ABI thunk + raw-ptr deref live in `crate::jsc` — no per-binding
    // `unsafe { &*g }` boilerplate here.
    binding.put(
        global_object,
        b"init",
        JSFunction::create(global_object, "init", PostgresSQLContext::init, 0, Default::default()),
    );
    binding.put(
        global_object,
        b"createQuery",
        JSFunction::create(global_object, "createQuery", PostgresSQLQuery::call, 6, Default::default()),
    );
    binding.put(
        global_object,
        b"createConnection",
        JSFunction::create(
            global_object,
            "createConnection",
            postgres_sql_connection::call,
            2,
            Default::default(),
        ),
    );
    binding
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (Phase-A draft files use PascalCase basenames; wired via
// `#[path]`). Heavy modules remain ``-gated until their lower-
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

#[path = "postgres/PostgresSQLConnection.rs"]
pub mod postgres_sql_connection;
pub use postgres_sql_connection::PostgresSQLConnection;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface

#[path = "postgres/PostgresSQLQuery.rs"]
pub mod postgres_sql_query;
pub use postgres_sql_query::PostgresSQLQuery;

// TODO(b2-blocked): bun_jsc::JSValue / bun_jsc::JSObject method surface

#[path = "postgres/PostgresRequest.rs"]
pub mod postgres_request;

// TODO(b2-blocked): bun_jsc::js_object::ExternColumnIdentifier
// TODO(b2-blocked): bun_jsc::JSType (real enum)
// TODO(b2-blocked): bun_core::wtf::{RefPtr,StringImpl}

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
    #[path = "error_response_jsc.rs"]
    pub mod error_response_jsc;

    #[path = "notice_response_jsc.rs"]
    pub mod notice_response_jsc;
}

// Re-exports of base-crate protocol/types modules (Zig: thin re-exports).
pub use bun_sql::postgres::postgres_protocol as base_protocol;
pub use bun_sql::postgres::postgres_types as base_types;

// ported from: src/sql_jsc/postgres.zig
