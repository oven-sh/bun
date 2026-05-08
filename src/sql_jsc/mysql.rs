use crate::jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue};

// ──────────────────────────────────────────────────────────────────────────
// C-ABI thunks (Zig: `jsc.toJSHostFn(fn)`). `JSFunction::create` needs a real
// `unsafe extern "C" fn` pointer; the safe Rust-signature impls are wrapped
// here. `JsResult::Err` → `JSValue::ZERO` (exception already pending).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" fn js_init(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    my_sql_context::init(unsafe { &*g }, unsafe { &*f })
}
unsafe extern "C" fn js_create_query(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    match js_my_sql_query::JSMySQLQuery::create_instance(unsafe { &*g }, unsafe { &*f }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}
unsafe extern "C" fn js_create_connection(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    match js_my_sql_connection::JSMySQLConnection::create_instance(unsafe { &*g }, unsafe { &*f }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        b"MySQLConnection",
        crate::jsc::codegen::JSMySQLConnection::get_constructor(global_object),
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

pub use my_sql_context::MySQLContext;
pub use my_sql_statement::MySQLStatement;
pub use my_sql_connection::MySQLConnection;
pub use my_sql_query::MySQLQuery;
pub use my_sql_request_queue::MySQLRequestQueue;

// ported from: src/sql_jsc/mysql.zig
