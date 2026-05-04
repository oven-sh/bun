use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Strong};

pub struct MySQLContext {
    pub on_query_resolve_fn: Strong,
    pub on_query_reject_fn: Strong,
}

impl Default for MySQLContext {
    fn default() -> Self {
        Self {
            on_query_resolve_fn: Strong::empty(),
            on_query_reject_fn: Strong::empty(),
        }
    }
}

// TODO(port): confirm `export = "..."` is the correct host_fn attr syntax for
// emitting a `#[no_mangle] extern` shim named `MySQLContext__init` (Zig:
// `@export(&JSC.toJSHostFn(init), .{ .name = "MySQLContext__init" })`).
#[bun_jsc::host_fn(export = "MySQLContext__init")]
pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let ctx = &mut global.bun_vm().rare_data().mysql_context;
    ctx.on_query_resolve_fn.set(global, frame.argument(0));
    ctx.on_query_reject_fn.set(global, frame.argument(1));

    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLContext.zig (19 lines)
//   confidence: high
//   todos:      1
//   notes:      host_fn export-name attr syntax assumed; verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
