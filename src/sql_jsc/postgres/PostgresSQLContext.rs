//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use crate::jsc::{CallFrame, JSGlobalObject, JSGlobalObjectSqlExt, JSValue, StrongOptional};

#[repr(C)]
#[derive(Default)]
pub struct PostgresSQLContext {
    // Zig: `Strong.Optional = .empty` → `StrongOptional::empty()` (Default).
    pub on_query_resolve_fn: StrongOptional,
    pub on_query_reject_fn: StrongOptional,
}

impl PostgresSQLContext {
    // Exported to C++ as `PostgresSQLContext__init` — the Zig used
    // `comptime { @export(&jsc.toJSHostFn(init), .{ .name = "PostgresSQLContext__init" }) }`.
    // The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim; the
    // `export = "..."` arg gives it the #[unsafe(no_mangle)] symbol name.
    // TODO(b2-blocked): bun_jsc::host_fn proc-macro (#[bun_jsc::host_fn(export = "PostgresSQLContext__init")])
    pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM via raw ptr,
        // no other live borrow in this scope.
        let ctx = &mut unsafe { &mut *global.sql_vm_ptr() }.rare_data().postgresql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));
        JSValue::UNDEFINED
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresSQLContext.zig (22 lines)
//   confidence: high
//   todos:      see TODO(b2-blocked)
//   notes:      host_fn export-name attribute spelling needs Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
