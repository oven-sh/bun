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
pub use self::valkey as valkey_body;
pub use self::js_valkey as js_valkey_body;

// ─── public re-exports ───────────────────────────────────────────────────────
pub use valkey_context::ValkeyContext;
pub use protocol_jsc::{
    resp_value_to_js, resp_value_to_js_with_options, valkey_error_to_js, ToJSOptions,
};
pub use valkey::{Options, Protocol, Status, ValkeyClient};
pub use js_valkey::JSValkeyClient;

// ── ValkeyCommand ────────────────────────────────────────────────────────────
// Zig's `ValkeyCommand.zig` is a file-as-struct: it is both the namespace
// *and* the `Command` type. Expose a `valkey_command` module that re-exports
// the body's items so `command::PromisePair` / `command::Entry` resolve, and
// alias it as `ValkeyCommand` for callers that match the Zig spelling.
pub mod valkey_command {
    pub use super::valkey_command_body::{entry, promise_pair, Entry, Meta, Promise, PromisePair};
    // `index.rs` re-exports `super::valkey_command::ValkeyCommand`.
    pub use super::ValkeyCommand;
}
pub use valkey_command as ValkeyCommand;

// ── JsClass wiring (codegen name = "RedisClient", see valkey.classes.ts) ────
// The `.classes.ts` generator emits the
// `RedisClient__{fromJS,fromJSDirect,create,getConstructor}` externs (and safe
// wrappers) into `crate::generated_classes::RedisClient` against an opaque
// pointee. Route through those instead of redeclaring the externs here — a
// second `extern "C"` block with a different pointee trips
// `clashing_extern_declarations`. The opaque `RedisClient` and `JSValkeyClient`
// name the same `m_ctx` heap allocation on the C++ side, so the pointer cast
// is identity.
use crate::generated_classes::RedisClient as CodegenRedisClient;

impl JSValkeyClient {
    /// Wrap an already-heap-allocated client pointer in its JS object.
    /// Ownership transfers to the C++ wrapper (freed via `finalize`).
    #[inline]
    pub fn ptr_to_js(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
        // `ptr` was produced by `JSValkeyClient::new` (heap-allocated) and is
        // hereby owned by the JS wrapper. Cast through the codegen's opaque
        // `RedisClient` newtype — it's the same `m_ctx` pointer.
        CodegenRedisClient::to_js(ptr.cast::<CodegenRedisClient>(), global)
    }
}

impl crate::jsc::JsClass for JSValkeyClient {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        CodegenRedisClient::from_js(value).map(|p| p.as_ptr().cast::<Self>())
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        CodegenRedisClient::from_js_direct(value).map(|p| p.as_ptr().cast::<Self>())
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        // Ownership transfers to the C++ wrapper (freed via finalize).
        let ptr = Box::into_raw(Box::new(self));
        CodegenRedisClient::to_js(ptr.cast::<CodegenRedisClient>(), global)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        CodegenRedisClient::get_constructor(global)
    }
}
