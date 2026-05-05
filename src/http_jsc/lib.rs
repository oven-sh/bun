#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-2 STATUS
// `bun_jsc` itself does not compile yet (its own B-2 pass is incomplete), and
// every module here names `JSGlobalObject`/`JSValue`. `headers_jsc` is un-gated
// (its unit structs `H2TestingAPIs`/`H3TestingAPIs` carry no JSC types; the
// fns inside remain individually `#[cfg(any())]`-gated). The other three
// modules stay module-gated until `bun_jsc` is green — their entire public
// surface is JSC-typed.
//
// Import-path fixes already applied inside the gated files so un-gating is a
// pure `#[cfg(any())]` removal once bun_jsc lands:
//   - method_jsc.rs:      bun_http_types::Method        → bun_http_types::Method::Method
//   - fetch_enums_jsc.rs: bun_http::Fetch*              → bun_http_types::Fetch*::Fetch*
//   - headers_jsc.rs:     bun_str::ZigString            → bun_string::ZigString
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): bun_jsc::JSGlobalObject — bun_jsc crate does not compile
// TODO(b2-blocked): bun_jsc::JSValue
#[cfg(any())]
pub mod method_jsc;
#[cfg(any())]
pub mod fetch_enums_jsc;

pub mod headers_jsc;

#[cfg(any())]
pub mod websocket_client;
// TODO(b2-blocked): bun_jsc::JSGlobalObject / JSValue / CallFrame / JsResult — bun_jsc does not compile
// TODO(b2-blocked): bun_jsc::EventLoop (as a type, not module) — `event_loop: &'static EventLoop` field
// TODO(b2-blocked): bun_jsc::VirtualMachine (as a type, not module) — CppWebSocket bridge
// TODO(b2-blocked): bun_uws::NewSocketHandler<const SSL: bool> — current stub is `<T>` not const-generic
// TODO(b2-blocked): bun_string::strings (full surface used by websocket_client body)
// TODO(b2-blocked): bun_core::Output::scoped (declare_scope!/scoped_log! macro re-export as bun_output)
// `bun_str` / `bun_output` crate names in the Phase-A draft are wrong (per crate-map: bun_string / bun_core);
// fix on un-gate.

// ─── Minimal stub surface (still-gated modules only) ─────────────────────
pub mod method_jsc_stub {
    pub trait MethodJsc {}
}
pub use method_jsc_stub as method_jsc;

pub mod fetch_enums_jsc_stub {}
pub use fetch_enums_jsc_stub as fetch_enums_jsc;

pub mod websocket_client_stub {
    /// Opaque stub; real def gated in `websocket_client.rs`.
    pub struct WebSocket<const SSL: bool>;
    pub struct InitialDataHandler<const SSL: bool>;
    #[repr(u8)]
    pub enum ErrorCode {
        Cancel = 0,
    }
    pub struct Mask;
    pub enum ReceiveState {
        NeedHeader,
    }
    pub enum DataType {
        None,
    }
}
pub use websocket_client_stub as websocket_client;
