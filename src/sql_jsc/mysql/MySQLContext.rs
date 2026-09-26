use crate::jsc::{CallFrame, JSGlobalObject, JSValue, StrongOptional, VirtualMachineSqlExt as _};

#[repr(C)]
#[derive(Default)]
pub struct MySQLContext {
    pub(crate) on_query_resolve_fn: StrongOptional,
    pub(crate) on_query_reject_fn: StrongOptional,
}

// The binding object is built in Rust (`mysql.rs` registers this fn through
// `put_host_functions!`/`IntoJSHostFn`), so no C symbol is needed.
pub(crate) fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
    global.bun_vm().with_sql_state(|state| {
        let ctx = &mut state.mysql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));
    });
    JSValue::UNDEFINED
}
