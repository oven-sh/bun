use crate::jsc::{JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::JSValue::{create_empty_object_with_null_prototype,put}
        // TODO(b2-blocked): bun_jsc::JSFunction::create
        // TODO(b2-blocked): bun_string::ZigString::static_
        // TODO(b2-blocked): bun_jsc codegen `js::get_constructor` for #[JsClass] types
        let binding = JSValue::create_empty_object_with_null_prototype(global_object);
        binding.put(
            global_object,
            bun_string::ZigString::static_(b"MySQLConnection"),
            js_my_sql_connection::js::get_constructor(global_object),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_(b"init"),
            bun_jsc::JSFunction::create(global_object, "init", my_sql_context::init, 0, Default::default()),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_(b"createQuery"),
            bun_jsc::JSFunction::create(global_object, "createQuery", js_my_sql_query::create_instance, 6, Default::default()),
        );
        binding.put(
            global_object,
            bun_string::ZigString::static_(b"createConnection"),
            bun_jsc::JSFunction::create(global_object, "createConnection", js_my_sql_connection::create_instance, 2, Default::default()),
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

#[path = "mysql/MySQLContext.rs"]
pub mod my_sql_context;

// TODO(b2-blocked): bun_jsc::object::ExternColumnIdentifier
// TODO(b2-blocked): bun_jsc::JSObject::{max_inline_capacity,create_structure}
// TODO(b2-blocked): bun_output::{declare_scope!,scoped_log!}
// TODO(b2-blocked): bun_string::String::create_atom_if_possible
#[cfg(any())]
#[path = "mysql/MySQLStatement.rs"]
pub mod my_sql_statement;
#[cfg(not(any()))]
pub mod my_sql_statement {
    pub struct MySQLStatement(());
    pub use bun_sql::mysql::mysql_param::Param;
}

// TODO(b2-blocked): bun_output::{declare_scope!,scoped_log!}
// TODO(b2-blocked): bun_core::feature_flag
#[cfg(any())]
#[path = "mysql/MySQLRequestQueue.rs"]
pub mod my_sql_request_queue;

// TODO(b2-blocked): bun_jsc::JsRef + JSValue method surface (.call, .ensure_still_alive)
// TODO(b2-blocked): bun_jsc::host_fn proc-macro
#[cfg(any())]
#[path = "mysql/MySQLQuery.rs"]
pub mod my_sql_query;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface
#[cfg(any())]
#[path = "mysql/JSMySQLQuery.rs"]
pub mod js_my_sql_query;

// TODO(b2-blocked): bun_jsc::JSValue::{js_number,js_type,is_*,to_*,as_*}
// TODO(b2-blocked): bun_jsc::JSType (real enum)
#[cfg(any())]
#[path = "mysql/MySQLValue.rs"]
pub mod my_sql_value;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro
// TODO(b2-blocked): bun_uws::Socket method surface
// TODO(b2-blocked): bun_jsc::VirtualMachine::get / RareData
#[cfg(any())]
#[path = "mysql/JSMySQLConnection.rs"]
pub mod js_my_sql_connection;

// TODO(b2-blocked): bun_uws::Socket / bun_jsc::VirtualMachine / bun_output
#[cfg(any())]
#[path = "mysql/MySQLConnection.rs"]
pub mod my_sql_connection;

pub mod protocol {
    #[path = "Signature.rs"]
    pub mod signature;
    pub use signature::Signature;

    // TODO(b2-blocked): bun_jsc::JSValue::{create_empty_object,put,js_number,ensure_still_alive}
    // TODO(b2-blocked): bun_string::String::create_utf8_for_js
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::take_exception
    #[cfg(any())]
    #[path = "error_packet_jsc.rs"]
    pub mod error_packet_jsc;

    // TODO(b2-blocked): bun_jsc::JSGlobalObject::{take_exception,create_out_of_memory_error}
    #[cfg(any())]
    #[path = "any_mysql_error_jsc.rs"]
    pub mod any_mysql_error_jsc;

    // TODO(b2-blocked): bun_jsc::JSValue method surface (date/number/buffer constructors)
    #[cfg(any())]
    #[path = "DecodeBinaryValue.rs"]
    pub mod decode_binary_value;

    // TODO(b2-blocked): bun_jsc::JSValue / bun_jsc::JSObject method surface
    #[cfg(any())]
    #[path = "ResultSet.rs"]
    pub mod result_set;
}

pub use my_sql_context::MySQLContext;
pub use my_sql_statement::MySQLStatement;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql.zig (28 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) above
//   notes:      `create_binding` body gated; submodule filenames PascalCase → #[path]
// ──────────────────────────────────────────────────────────────────────────
