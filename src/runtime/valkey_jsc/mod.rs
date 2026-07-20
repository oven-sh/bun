//! Valkey/Redis client — JSC bindings.
//!
//! Module layout: the protocol
//! state machine lives in [`valkey`] (`ValkeyClient`), the `.classes.ts`
//! wrapper in [`js_valkey`] (`JSValkeyClient`), and the ~200 prototype
//! methods in [`js_valkey_functions`]. RESP wire-format parsing is in the
//! lower `bun_valkey` crate; this module owns the JSC-touching half.

pub mod valkey;
pub mod js_valkey;
pub mod js_valkey_functions;
pub mod command;
pub mod protocol_jsc;

pub use js_valkey::JSValkeyClient;
