use crate::jsc::{CallFrame, JSGlobalObject, JSValue, StrongOptional, VirtualMachineSqlExt as _};

#[repr(C)]
#[derive(Default)]
pub struct MySQLContext {
    pub on_query_resolve_fn: StrongOptional,
    pub on_query_reject_fn: StrongOptional,
}

impl MySQLContext {
    /// Release the JSC `Strong` handles while the VM is still alive. This
    /// struct is owned by `bun_runtime`'s `RuntimeState`, which drops after
    /// `~VM` — a `Strong` dropped there unlinks a `HandleNode` from the
    /// already-freed `HandleSet`.
    pub fn deinit(&mut self) {
        self.on_query_resolve_fn.deinit();
        self.on_query_reject_fn.deinit();
    }
}

// The binding object is built in Rust (`mysql.rs` registers this fn through
// `put_host_functions!`/`IntoJSHostFn`), so no C symbol is needed.
pub(crate) fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
    // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton); `as_mut()`
    // is the canonical safe escape hatch for the shrinking set of `&mut self`
    // helpers like `sql_state()` — one audited unsafe lives in bun_jsc.
    let ctx = &mut global.bun_vm().as_mut().sql_state().mysql_context;
    ctx.on_query_resolve_fn.set(global, frame.argument(0));
    ctx.on_query_reject_fn.set(global, frame.argument(1));
    JSValue::UNDEFINED
}
