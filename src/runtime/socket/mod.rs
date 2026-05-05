//! Port of `src/runtime/socket/socket.zig`.
//!
//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).
//!
//! B-2: full draft (3232 lines, preserved in `socket_body.rs`) depends on
//! `bun_jsc` method surface, `bun_boringssl_sys::{SSL, SSL_CTX}` (bindgen not
//! generated), and `bun_output` macros. Pure-data / low-dependency submodules
//! are wired as they become compilable; the rest remain gated.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "socket_body.rs"]
mod socket_body; // full Phase-A draft of socket.zig
#[cfg(any())]
#[path = "SocketAddress.rs"]
pub mod socket_address;
#[cfg(any())]
#[path = "Handlers.rs"]
pub mod handlers;
#[cfg(any())]
#[path = "Listener.rs"]
pub mod listener;
#[cfg(any())]
#[path = "SSLConfig.rs"]
pub mod ssl_config;
#[cfg(any())]
#[path = "UpgradedDuplex.rs"]
pub mod upgraded_duplex;
#[cfg(any())]
#[path = "WindowsNamedPipe.rs"]
pub mod windows_named_pipe;
#[cfg(any())]
#[path = "WindowsNamedPipeContext.rs"]
pub mod windows_named_pipe_context;
#[cfg(any())]
#[path = "ssl_wrapper.rs"]
pub mod ssl_wrapper;
#[cfg(any())]
#[path = "tls_socket_functions.rs"]
mod tls_socket_functions;
#[cfg(any())]
#[path = "udp_socket.rs"]
pub mod udp_socket_draft;
#[cfg(any())]
#[path = "uws_dispatch.rs"]
pub mod uws_dispatch;
#[cfg(any())]
#[path = "uws_handlers.rs"]
pub mod uws_handlers;
#[cfg(any())]
#[path = "uws_jsc.rs"]
pub mod uws_jsc;

// ─── opaque type surface (replaces lib.rs socket_stub) ───────────────────────
// TODO(b2-blocked): bun_jsc::JSGlobalObject (method surface)
// TODO(b2-blocked): bun_boringssl_sys::SSL
// TODO(b2-blocked): bun_boringssl_sys::SSL_CTX
// TODO(b2-blocked): bun_output::declare_scope
pub struct Listener(());
pub struct SocketAddress(());
pub struct TCPSocket(());
pub struct TLSSocket(());
pub struct Handlers(());
pub struct SocketConfig(());
pub struct NewSocket<const SSL: bool>(());
pub mod udp_socket {
    pub struct UDPSocket(());
}

#[cfg(not(windows))]
pub type WindowsNamedPipeContext = ();

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/socket.zig
//   confidence: low (B-2 thin un-gate)
//   notes:      blocked on bun_jsc/bun_boringssl_sys; opaque surface only.
// ──────────────────────────────────────────────────────────────────────────
