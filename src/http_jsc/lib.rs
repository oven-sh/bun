#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-2 STATUS
// `bun_jsc` is now linked and its stub surface (`JSGlobalObject`/`JSValue`/
// `CallFrame`/`JsResult`) is sufficient for the small bridges:
//   - method_jsc       → un-gated, compiles
//   - fetch_enums_jsc  → un-gated, compiles
//   - headers_jsc      → un-gated; `live_counts`/`quic_live_counts` signatures
//                        compile, bodies re-gated on `bun_http::{h2,h3}_client`;
//                        `to_fetch_headers` stays whole-fn gated (FetchHeaders
//                        lives in a higher-tier crate)
//   - websocket_client → still module-gated (see blockers below)
// ──────────────────────────────────────────────────────────────────────────

pub mod method_jsc;
pub mod fetch_enums_jsc;

pub mod headers_jsc;

#[cfg(any())]
pub mod websocket_client;
// TODO(b2-blocked): bun_jsc::EventLoop (as a TYPE, not module) — `event_loop: &'static EventLoop` field;
//                   bun_jsc currently only re-exports `event_loop` as a module alias
// TODO(b2-blocked): bun_jsc::VirtualMachine (as a type, not module) — CppWebSocket bridge
// TODO(b2-blocked): bun_uws::NewSocketHandler<const SSL: bool> — current stub is `<T>` not const-generic
// TODO(b2-blocked): bun_http::websocket_http_client surface (Mask/ReceiveState/DataType shared types)
// `bun_str` / `bun_output` crate names in the Phase-A draft are wrong (per crate-map: bun_string / bun_core);
// fix on un-gate. 2298 LOC + 5 submodules; out of scope for this pass while the
// const-generic socket handler and EventLoop type are absent.

// ─── Minimal stub surface (still-gated modules only) ─────────────────────
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
