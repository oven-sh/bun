use crate::jsc::{CallFrame, JSGlobalObject, JSValue};

#[derive(Default)]
pub struct MySQLContext {
    // TODO(b2-blocked): bun_jsc::Strong (currently a module, not a type) — field
    // type should be `bun_jsc::Strong` (Strong.Optional = .empty in Zig).
    pub on_query_resolve_fn: JSValue,
    pub on_query_reject_fn: JSValue,
}

// TODO(b2-blocked): bun_jsc::host_fn proc-macro
// (Zig: `@export(&JSC.toJSHostFn(init), .{ .name = "MySQLContext__init" })`).
pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::bun_vm
        // TODO(b2-blocked): bun_jsc::RareData::mysql_context
        // TODO(b2-blocked): bun_jsc::Strong::set
        // TODO(b2-blocked): bun_jsc::CallFrame::argument
        // TODO(b2-blocked): bun_jsc::JSValue::UNDEFINED
        let ctx = &mut global.bun_vm().rare_data().mysql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));
        return JSValue::UNDEFINED;
    }
    #[cfg(not(any()))]
    {
        let _ = (global, frame);
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::bun_vm / RareData / Strong::set")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLContext.zig (19 lines)
//   confidence: high
//   todos:      see TODO(b2-blocked)
//   notes:      host_fn export-name attr syntax assumed; verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
