use bun_jsc::{JSFunction, JSGlobalObject, JSValue};
use bun_str::ZigString;

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        ZigString::static_("MySQLConnection"),
        // TODO(port): `.js.getConstructor` is emitted by the .classes.ts codegen (#[bun_jsc::JsClass])
        js_my_sql_connection::js::get_constructor(global_object),
    );
    binding.put(
        global_object,
        ZigString::static_("init"),
        JSFunction::create(global_object, "init", my_sql_context::init, 0, Default::default()),
    );
    binding.put(
        global_object,
        ZigString::static_("createQuery"),
        JSFunction::create(global_object, "createQuery", js_my_sql_query::create_instance, 6, Default::default()),
    );

    binding.put(
        global_object,
        ZigString::static_("createConnection"),
        JSFunction::create(global_object, "createConnection", js_my_sql_connection::create_instance, 2, Default::default()),
    );

    binding
}

// Zig: `pub const MySQLConnection = @import("./mysql/JSMySQLConnection.zig");` etc.
// These are whole-file namespace imports; in Rust they become submodule declarations
// (files live at src/sql_jsc/mysql/*.rs).
pub mod js_my_sql_connection;
pub mod my_sql_context;
pub mod js_my_sql_query;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql.zig (28 lines)
//   confidence: medium
//   todos:      1
//   notes:      ZigString::static_ avoids `static` keyword; .js.getConstructor relies on JsClass codegen
// ──────────────────────────────────────────────────────────────────────────
