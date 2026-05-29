//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use crate::jsc::{CallFrame, JSGlobalObject, JSValue, StrongOptional, VirtualMachineSqlExt as _};

#[repr(C)]
#[derive(Default)]
pub struct PostgresSQLContext {
    // Zig: `Strong.Optional = .empty` → `StrongOptional::empty()` (Default).
    pub on_query_resolve_fn: StrongOptional,
    pub on_query_reject_fn: StrongOptional,
}

impl PostgresSQLContext {
    pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        let ctx = &mut global.bun_vm().as_mut().sql_state().postgresql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));
        JSValue::UNDEFINED
    }
}

// ported from: src/sql_jsc/postgres/PostgresSQLContext.zig
