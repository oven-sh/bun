//! Per-VM Postgres state that isn't per-connection. The shared
//! `us_socket_context_t` that used to live here is gone — connections link
//! into `RareData.postgres_group`/`postgres_tls_group` instead.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Strong};

pub struct PostgresSQLContext {
    pub on_query_resolve_fn: Strong,
    pub on_query_reject_fn: Strong,
}

impl Default for PostgresSQLContext {
    fn default() -> Self {
        Self {
            on_query_resolve_fn: Strong::empty(),
            on_query_reject_fn: Strong::empty(),
        }
    }
}

impl PostgresSQLContext {
    // Exported to C++ as `PostgresSQLContext__init` — the Zig used
    // `comptime { @export(&jsc.toJSHostFn(init), .{ .name = "PostgresSQLContext__init" }) }`.
    // The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim; the
    // `export = "..."` arg gives it the #[unsafe(no_mangle)] symbol name.
    // TODO(port): confirm `export = "..."` is the agreed spelling on #[host_fn].
    #[bun_jsc::host_fn(export = "PostgresSQLContext__init")]
    pub fn init(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let ctx = &mut global.bun_vm().rare_data().postgresql_context;
        ctx.on_query_resolve_fn.set(global, frame.argument(0));
        ctx.on_query_reject_fn.set(global, frame.argument(1));

        Ok(JSValue::UNDEFINED)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresSQLContext.zig (22 lines)
//   confidence: high
//   todos:      1
//   notes:      host_fn export-name attribute spelling needs Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
