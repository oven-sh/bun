//! Valkey/Redis client — JSC bindings.
//!
//! Module layout mirrors `src/runtime/valkey_jsc/index.zig`: the protocol
//! state machine lives in [`valkey`] (`ValkeyClient`), the `.classes.ts`
//! wrapper in [`js_valkey`] (`JSValkeyClient`), and the ~200 prototype
//! methods in [`js_valkey_functions`]. RESP wire-format parsing is in the
//! lower `bun_valkey` crate; this module owns the JSC-touching half.

use crate::jsc::{JSGlobalObject, JSValue};

// ─── submodules ──────────────────────────────────────────────────────────────

#[path = "valkey.rs"]
pub mod valkey; // ValkeyClient state machine, fail/reject paths, auto-flush

#[path = "js_valkey.rs"]
pub mod js_valkey; // JSValkeyClient host fns, SocketHandler, constructor

#[path = "js_valkey_functions.rs"]
pub mod js_valkey_functions; // 200+ prototype methods (get/set/hget/…)

#[path = "ValkeyCommand.rs"]
pub mod valkey_command_body; // Command::serialize, Promise::resolve/reject

#[path = "ValkeyContext.rs"]
pub mod valkey_context;

#[path = "protocol_jsc.rs"]
pub mod protocol_jsc; // RESPValue → JSValue, RedisError → JS Error

#[path = "index.rs"]
pub mod index;

// ─── Phase-B back-compat aliases ─────────────────────────────────────────────
// Earlier passes mounted the bodies under `*_body` to keep the inline stub
// modules compiling alongside them. The stubs are now dissolved; keep the
// `*_body` names as aliases so sibling files (`valkey.rs` imports
// `super::js_valkey_body`, `js_valkey.rs` imports `super::valkey_command_body`)
// don't churn in this pass.
pub use self::js_valkey as js_valkey_body;
pub use self::valkey as valkey_body;

// ─── public re-exports ───────────────────────────────────────────────────────
pub use js_valkey::JSValkeyClient;
pub use protocol_jsc::{
    ToJSOptions, resp_value_to_js, resp_value_to_js_with_options, valkey_error_to_js,
};
pub use valkey::{Options, Protocol, Status, ValkeyClient};
pub use valkey_context::ValkeyContext;

// ── ValkeyCommand ────────────────────────────────────────────────────────────
// Zig's `ValkeyCommand.zig` is a file-as-struct: it is both the namespace
// *and* the `Command` type. Expose a `valkey_command` module that re-exports
// the body's items so `command::PromisePair` / `command::Entry` resolve, and
// alias it as `ValkeyCommand` for callers that match the Zig spelling.
pub mod valkey_command {
    pub use super::valkey_command_body::{Entry, Meta, Promise, PromisePair, entry, promise_pair};
    // `index.rs` re-exports `super::valkey_command::ValkeyCommand`.
    pub use super::ValkeyCommand;
}
pub use valkey_command as ValkeyCommand;

// ── JsClass wiring (codegen name = "RedisClient", see valkey.classes.ts) ────
// `generate-classes.ts` emits the `RedisClient__{fromJS,fromJSDirect,create,
// getConstructor}` externs plus safe wrappers as **free functions** in
// `crate::generated_classes::js_RedisClient` (one `js_<Name>` submodule per
// class). The codegen's `RedisClient` *type* re-export resolves back to
// `JSValkeyClient` itself (via `valkey::RedisClient`), so the wrapper pointee
// is already `*mut JSValkeyClient` — no cast required. Route through the
// submodule instead of redeclaring the externs here; a second `extern "C"`
// block would trip `clashing_extern_declarations`.
use crate::generated_classes::js_RedisClient;

impl JSValkeyClient {
    /// Wrap an already-heap-allocated client pointer in its JS object.
    /// Ownership transfers to the C++ wrapper (freed via `finalize`).
    #[inline]
    pub fn ptr_to_js(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
        // `ptr` was produced by `JSValkeyClient::new` (heap-allocated) and is
        // hereby owned by the JS wrapper.
        js_RedisClient::to_js(ptr, global)
    }
}

bun_jsc::impl_js_class_via_generated!(JSValkeyClient => crate::generated_classes::js_RedisClient);
