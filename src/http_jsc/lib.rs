#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: all Phase-A draft modules depend on crates not yet
// available at this tier (bun_jsc, bun_str, bun_boringssl, bun_output,
// bun_runtime) and/or symbols missing from lower-tier stub surfaces
// (bun_http::{FetchRedirect, h2_client, h3_client, websocket},
// bun_http_types::Method as a type, bun_collections::LinearFifo).
// Gate the bodies; un-gating happens in B-2.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod method_jsc;
#[cfg(any())]
pub mod fetch_enums_jsc;
#[cfg(any())]
pub mod headers_jsc;
#[cfg(any())]
pub mod websocket_client;

// TODO(b1): bun_jsc crate missing from this tier — required by all modules.
// TODO(b1): bun_str / bun_boringssl / bun_output / bun_runtime crates missing.
// TODO(b1): bun_http::{FetchRedirect, h2_client, h3_client, websocket} missing from stub surface.
// TODO(b1): bun_http_types::Method is a module, not a type, in current stub surface.
// TODO(b1): bun_collections::LinearFifo missing from stub surface.

// ─── Minimal stub surface ────────────────────────────────────────────────
pub mod method_jsc_stub {
    pub trait MethodJsc {}
}
pub use method_jsc_stub as method_jsc;

pub mod fetch_enums_jsc_stub {}
pub use fetch_enums_jsc_stub as fetch_enums_jsc;

pub mod headers_jsc_stub {
    pub struct H2TestingAPIs;
    pub struct H3TestingAPIs;
}
pub use headers_jsc_stub as headers_jsc;

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
