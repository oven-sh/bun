//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use crate::jsc::{CallFrame, JSGlobalObject, JSValue, StrongOptional, VirtualMachineSqlExt as _};

#[repr(C)]
#[derive(Default)]
pub struct PostgresSQLContext {
    pub on_query_resolve_fn: StrongOptional,
    pub on_query_reject_fn: StrongOptional,
}

impl PostgresSQLContext {
    // Registered directly as `init` via `put_host_functions!` in
    // `postgres.rs`, so no exported symbol is needed.
    pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton);
        // `as_mut()` is the canonical safe escape hatch for the shrinking set
        // of `&mut self` helpers like `sql_state()` — one audited unsafe lives
        // in bun_jsc.
        let ctx = &mut global.bun_vm().as_mut().sql_state().postgresql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));
        JSValue::UNDEFINED
    }
}
