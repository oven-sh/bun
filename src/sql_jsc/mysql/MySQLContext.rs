use crate::jsc::{StrongCell, VirtualMachineSqlExt as _};
use bun_jsc::bindgen::{Callable, JsHeap, JsLocal};

#[repr(C)]
#[derive(Default)]
pub struct MySQLContext {
    pub(crate) on_query_resolve_fn: StrongCell,
    pub(crate) on_query_reject_fn: StrongCell,
}

impl MySQLContext {
    pub(crate) fn clear(&self) {
        self.on_query_resolve_fn.clear();
        self.on_query_reject_fn.clear();
    }
}

pub(crate) fn init<'a>(
    heap: &JsHeap<'a>,
    on_resolve_query: JsLocal<'a, Callable>,
    on_reject_query: JsLocal<'a, Callable>,
) {
    // SAFETY: setting a `Strong` runs no JavaScript.
    let global = unsafe { heap.global() };
    let ctx = &global.bun_vm().sql_state().mysql_context;
    ctx.on_query_resolve_fn
        .set(global, on_resolve_query.to_js());
    ctx.on_query_reject_fn.set(global, on_reject_query.to_js());
}
