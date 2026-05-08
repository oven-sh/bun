use crate::jsc::{CallFrame, JSGlobalObject, JSGlobalObjectSqlExt, JSValue, StrongOptional, VirtualMachineSqlExt as _};

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
    // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM via raw ptr,
    // no other live borrow in this scope.
    let ctx = &mut unsafe { &mut *global.sql_vm_ptr() }.sql_state().mysql_context;
    ctx.on_query_resolve_fn.set(global, frame.argument(0));
    ctx.on_query_reject_fn.set(global, frame.argument(1));
    JSValue::UNDEFINED
}

// ported from: src/sql_jsc/mysql/MySQLContext.zig
