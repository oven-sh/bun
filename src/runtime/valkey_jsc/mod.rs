//! Valkey/Redis client — JSC bindings.
//!
//! The protocol/state machine lives in `valkey.rs` (`ValkeyClient`); the
//! `.classes.ts` JS wrapper lives in `js_valkey.rs` (`JSValkeyClient`).
//! This file mounts the per-file modules and re-exports the canonical types.

use crate::jsc::{JSGlobalObject, JSValue};

// ─── per-file submodules ─────────────────────────────────────────────────────

#[path = "valkey.rs"]
pub mod valkey_body; // ValkeyClient state machine + DeferredFailure

#[path = "js_valkey.rs"]
pub mod js_valkey_body; // JSValkeyClient host fns, SocketHandler, constructor

#[path = "js_valkey_functions.rs"]
pub mod js_valkey_functions; // 200+ prototype methods (get/set/hget/…)

#[path = "ValkeyCommand.rs"]
pub mod valkey_command_body; // Command::serialize, Promise::resolve/reject

#[path = "index.rs"]
pub mod index;

#[path = "ValkeyContext.rs"]
pub mod valkey_context;
pub use valkey_context::ValkeyContext;

#[path = "protocol_jsc.rs"]
pub mod protocol_jsc; // RESPValue → JSValue, RedisError → JS Error
pub use protocol_jsc::{resp_value_to_js, resp_value_to_js_with_options, valkey_error_to_js, ToJSOptions};

// ─── canonical module aliases ────────────────────────────────────────────────
// Phase-A drafts are now the source of truth; the old inline B-2 type-surface
// stubs that lived here (with `todo!()` bodies) have been dissolved into the
// real per-file modules. External code references `valkey_jsc::valkey::…` /
// `valkey_jsc::js_valkey::…`, so alias the body modules under those names.
pub use valkey_body as valkey;
pub use js_valkey_body as js_valkey;

pub use valkey::{ValkeyClient, Status, Protocol, Options};
pub use js_valkey::JSValkeyClient;

// ── ValkeyCommand ────────────────────────────────────────────────────────────
pub mod valkey_command {
    // Zig's `ValkeyCommand.zig` is a file-as-struct: it is both the namespace
    // *and* the `Command` type. `index.rs` re-exports it via
    // `super::valkey_command::ValkeyCommand`, so surface the module alias here
    // publicly (the parent's `pub use valkey_command as ValkeyCommand` only
    // reached this scope through the private glob).
    pub use super::ValkeyCommand;

    // The Phase-A draft in `ValkeyCommand.rs` (mounted as `valkey_command_body`)
    // is the source of truth for these types — re-export instead of duplicating
    // so `Command.meta` (a `valkey_command_body::Meta`) unifies with
    // `command::PromisePair.meta` etc.
    pub use super::valkey_command_body::{Entry, Meta, Promise, PromisePair, entry, promise_pair};
}
pub use valkey_command as ValkeyCommand;

// ── JsClass wiring (codegen name = "RedisClient", see valkey.classes.ts) ─────
// The `.classes.ts` generator already emits the
// `RedisClient__{fromJS,fromJSDirect,create,getConstructor}` externs (and
// safe wrappers) into `crate::generated_classes::RedisClient` against an
// opaque pointee. Route through those instead of redeclaring the externs
// here — a second `extern "C"` block with a different pointee trips
// `clashing_extern_declarations`. The opaque `RedisClient` and
// `JSValkeyClient` name the same `m_ctx` heap allocation on the C++ side,
// so the pointer cast is identity.
use crate::generated_classes::RedisClient as CodegenRedisClient;

impl crate::jsc::JsClass for JSValkeyClient {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        CodegenRedisClient::from_js(value).map(|p| p.as_ptr().cast::<Self>())
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        CodegenRedisClient::from_js_direct(value).map(|p| p.as_ptr().cast::<Self>())
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        // Ownership transfers to the C++ wrapper (freed via `finalize`).
        let ptr = JSValkeyClient::new(self);
        CodegenRedisClient::to_js(ptr.cast::<CodegenRedisClient>(), global)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        CodegenRedisClient::get_constructor(global)
    }
}

impl JSValkeyClient {
    /// Wrap an already-heap-allocated client pointer in its JS object.
    /// Ownership transfers to the C++ wrapper (freed via `finalize`).
    ///
    /// `ptr` must have been produced by `JSValkeyClient::new` (heap-allocated).
    pub fn ptr_to_js(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
        CodegenRedisClient::to_js(ptr.cast::<CodegenRedisClient>(), global)
    }
}
