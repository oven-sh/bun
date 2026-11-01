//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use crate::jsc::{StrongOptional, VirtualMachineSqlExt as _};
use bun_jsc::bindgen::{Callable, JsHeap, JsLocal};

#[repr(C)]
#[derive(Default)]
pub struct PostgresSQLContext {
    pub(crate) on_query_resolve_fn: StrongOptional,
    pub(crate) on_query_reject_fn: StrongOptional,
    pub(crate) array_literal_fn: StrongOptional,
}

impl PostgresSQLContext {
    pub(crate) fn init<'a>(
        heap: &JsHeap<'a>,
        on_resolve_query: JsLocal<'a, Callable>,
        on_reject_query: JsLocal<'a, Callable>,
        array_literal: JsLocal<'a, Callable>,
    ) {
        // SAFETY: setting a `Strong` runs no JavaScript.
        let global = unsafe { heap.global() };
        // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton);
        // `as_mut()` is the canonical safe escape hatch for the shrinking set
        // of `&mut self` helpers like `sql_state()` — one audited unsafe lives
        // in bun_jsc.
        let ctx = &mut global.bun_vm().as_mut().sql_state().postgresql_context;
        ctx.on_query_resolve_fn
            .set(global, on_resolve_query.to_js());
        ctx.on_query_reject_fn.set(global, on_reject_query.to_js());
        ctx.array_literal_fn.set(global, array_literal.to_js());
    }
}
