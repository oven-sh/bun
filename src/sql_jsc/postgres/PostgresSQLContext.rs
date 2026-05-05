//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use crate::jsc::{CallFrame, JSGlobalObject, JSValue};

#[derive(Default)]
pub struct PostgresSQLContext {
    // TODO(b2-blocked): bun_jsc::Strong (currently a module, not a type) — field
    // type should be `bun_jsc::Strong` (Strong.Optional = .empty in Zig).
    pub on_query_resolve_fn: JSValue,
    pub on_query_reject_fn: JSValue,
}

impl PostgresSQLContext {
    // Exported to C++ as `PostgresSQLContext__init` — the Zig used
    // `comptime { @export(&jsc.toJSHostFn(init), .{ .name = "PostgresSQLContext__init" }) }`.
    // The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim; the
    // `export = "..."` arg gives it the #[unsafe(no_mangle)] symbol name.
    // TODO(b2-blocked): bun_jsc::host_fn proc-macro (#[bun_jsc::host_fn(export = "PostgresSQLContext__init")])
    pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::bun_vm
            // TODO(b2-blocked): bun_jsc::RareData::postgresql_context
            // TODO(b2-blocked): bun_jsc::Strong::set
            // TODO(b2-blocked): bun_jsc::CallFrame::argument
            // TODO(b2-blocked): bun_jsc::JSValue::UNDEFINED
            let ctx = &mut global.bun_vm().rare_data().postgresql_context;
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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresSQLContext.zig (22 lines)
//   confidence: high
//   todos:      see TODO(b2-blocked)
//   notes:      host_fn export-name attribute spelling needs Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
