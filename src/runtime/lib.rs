#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all top-level modules are gated behind `#[cfg(any())]`
// to preserve their Phase-A draft bodies on disk without compiling them.
// A minimal stub surface is exposed below each gate. Un-gating happens in B-2.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────
#[cfg(any())]
pub mod crypto;
#[cfg(any())]
pub mod ffi;
#[cfg(any())]
pub mod server;
#[cfg(any())]
pub mod socket;
#[cfg(any())]
#[path = "api.rs"]
pub mod api_draft;
#[cfg(any())]
#[path = "webcore.rs"]
pub mod webcore_draft;
#[cfg(any())]
#[path = "node.rs"]
pub mod node_draft;
#[cfg(any())]
pub mod bake;
#[cfg(any())]
pub mod shell;
#[cfg(any())]
pub mod cli;
#[cfg(any())]
pub mod napi;

// Additional subdirectories present under src/runtime/ but not yet wired:
// dns_jsc, image, test_runner, timer, valkey_jsc, webview, api/ (dir), node/ (dir), webcore/ (dir).
// These remain un-declared until B-2.

// ─── stub surface (opaque types / todo!() bodies) ────────────────────────

/// TODO(b1): bun_jsc dependency is gated (does not compile). Local shim so
/// downstream re-exports type-check. Remove once bun_jsc is green.
#[cfg(any())]
extern crate bun_jsc;

pub mod crypto_stub {
    // TODO(b1): stub — un-gate `crypto` in B-2.
}
pub use crypto_stub as crypto;

pub mod ffi_stub {
    // TODO(b1): stub — un-gate `ffi` in B-2.
    pub struct FFI(());
    pub mod ffi_object {}
}
pub use ffi_stub as ffi;

pub mod server_stub {
    // TODO(b1): stub — un-gate `server` in B-2.
    pub struct AnyRequestContext(());
    pub struct AnyServer(());
    pub struct DebugHTTPSServer(());
    pub struct DebugHTTPServer(());
    pub struct HTMLBundle(());
    pub struct HTTPSServer(());
    pub struct HTTPServer(());
    pub struct NodeHTTPResponse(());
    pub struct SavedRequest(());
    pub struct ServerConfig(());
    pub struct ServerWebSocket(());
}
pub use server_stub as server;

pub mod socket_stub {
    // TODO(b1): stub — un-gate `socket` in B-2.
    pub struct Listener(());
    pub struct SocketAddress(());
    pub struct TCPSocket(());
    pub struct TLSSocket(());
    pub struct Handlers(());
    pub struct NewSocket(());
    pub mod udp_socket {
        pub struct UDPSocket(());
    }
}
pub use socket_stub as socket;

pub mod api {
    // TODO(b1): stub — un-gate `api.rs` (re-export hub) in B-2.
}

pub mod webcore {
    // TODO(b1): stub — un-gate `webcore.rs` in B-2.
    pub mod streams {
        pub struct Result(());
    }
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Lifetime {
        Clone,
        Transfer,
        Share,
        Temporary,
    }
}

pub mod node {
    // TODO(b1): stub — un-gate `node.rs` in B-2.
    pub enum Maybe<R, E> {
        Err(E),
        Result(R),
    }
}

pub mod bake_stub {
    // TODO(b1): stub — un-gate `bake` in B-2.
}
pub use bake_stub as bake;

pub mod shell_stub {
    // TODO(b1): stub — un-gate `shell` in B-2.
}
pub use shell_stub as shell;

pub mod cli_stub {
    // TODO(b1): stub — un-gate `cli` in B-2.
}
pub use cli_stub as cli;

pub mod napi_stub {
    // TODO(b1): stub — un-gate `napi` in B-2.
}
pub use napi_stub as napi;
