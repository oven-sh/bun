//! Valkey/Redis client — JSC bindings.
//!
//! Module layout: the protocol
//! state machine lives in [`valkey`] (`ValkeyClient`), the `valkey.bind.ts`
//! wrapper in [`js_valkey`] (`JSValkeyClient`), and the ~200 prototype
//! methods in [`js_valkey_functions`]. RESP wire-format parsing is in the
//! lower `bun_valkey` crate; this module owns the JSC-touching half.

// ─── submodules ──────────────────────────────────────────────────────────────

#[path = "valkey.rs"]
pub(crate) mod valkey; // ValkeyClient state machine, fail/reject paths, auto-flush

#[path = "js_valkey.rs"]
pub(crate) mod js_valkey; // JSValkeyClient host fns, SocketHandler, constructor

#[path = "js_valkey_functions.rs"]
pub(crate) mod js_valkey_functions; // 200+ prototype methods (get/set/hget/…)

#[path = "ValkeyCommand.rs"]
pub(crate) mod valkey_command_body; // Command::serialize, Promise::resolve/reject

#[path = "protocol_jsc.rs"]
pub(crate) mod protocol_jsc; // RESPValue → JSValue, RedisError → JS Error

// ─── back-compat aliases ─────────────────────────────────────────────────────
// Sibling files were written against `*_body` module names (`valkey.rs`
// imports `super::js_valkey_body`); keep the alias so it doesn't need to churn.
pub(crate) use self::js_valkey as js_valkey_body;

// ─── public re-exports ───────────────────────────────────────────────────────
pub(crate) use js_valkey::JSValkeyClient;

pub(crate) mod valkey_command {
    pub(crate) use super::valkey_command_body::{Entry, PromisePair};
}
