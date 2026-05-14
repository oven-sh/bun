use crate::jsc::{CallFrame, JSGlobalObject, JSValue, StrongOptional, VirtualMachineSqlExt as _};

#[repr(C)]
#[derive(Default)]
pub struct MySQLContext {
    // Zig: `Strong.Optional = .empty` → `StrongOptional::empty()` (Default).
    pub on_query_resolve_fn: StrongOptional,
    pub on_query_reject_fn: StrongOptional,
}

// TODO(b2-blocked): bun_jsc::host_fn proc-macro
// (Zig: `@export(&JSC.toJSHostFn(init), .{ .name = "MySQLContext__init" })`).
pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
    // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton); `as_mut()`
    // is the canonical safe escape hatch for the shrinking set of `&mut self`
    // helpers like `sql_state()` — one audited unsafe lives in bun_jsc.
    let ctx = &mut global.bun_vm().as_mut().sql_state().mysql_context;
    ctx.on_query_resolve_fn.set(global, frame.argument(0));
    ctx.on_query_reject_fn.set(global, frame.argument(1));
    JSValue::UNDEFINED
}

// ported from: src/sql_jsc/mysql/MySQLContext.zig
