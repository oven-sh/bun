use crate::jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue};

// ──────────────────────────────────────────────────────────────────────────
// C-ABI thunks (Zig: `jsc.toJSHostFn(fn)`). `JSFunction::create` needs a real
// `unsafe extern "C" fn` pointer; the safe Rust-signature impls are wrapped
// here. `JsResult::Err` → `JSValue::ZERO` (exception already pending).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" fn js_init(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    PostgresSQLContext::init(unsafe { &*g }, unsafe { &*f })
}
unsafe extern "C" fn js_create_query(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    match PostgresSQLQuery::call(unsafe { &*g }, unsafe { &*f }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}
unsafe extern "C" fn js_create_connection(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    match postgres_sql_connection::call(unsafe { &*g }, unsafe { &*f }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        b"PostgresSQLConnection",
        postgres_sql_connection::js::get_constructor(global_object),
    );
    binding.put(
        global_object,
        b"init",
        JSFunction::create(global_object, "init", js_init as JSHostFn, 0, Default::default()),
    );
    binding.put(
        global_object,
        b"createQuery",
        JSFunction::create(global_object, "createQuery", js_create_query as JSHostFn, 6, Default::default()),
    );
    binding.put(
        global_object,
        b"createConnection",
        JSFunction::create(global_object, "createConnection", js_create_connection as JSHostFn, 2, Default::default()),
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
// TODO(b2-blocked): bun_string::wtf::{RefPtr,StringImpl}

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
