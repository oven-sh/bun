//! Port of `src/runtime/socket/socket.zig`.
//!
//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).
//!
//! The full method-body port lives in `socket_body.rs`; this module wires the
//! submodules together and re-exports the canonical type surface so
//! `crate::api` and the dispatch / handler layers see one set of types.

// ─── submodules ──────────────────────────────────────────────────────────────

#[path = "socket_body.rs"]
mod socket_body;

#[path = "SocketAddress.rs"]
pub mod socket_address;

#[path = "Handlers.rs"]
pub mod handlers;

#[path = "Listener.rs"]
pub mod listener;

#[path = "UpgradedDuplex.rs"]
pub mod upgraded_duplex;

#[path = "WindowsNamedPipe.rs"]
pub mod windows_named_pipe;

#[path = "WindowsNamedPipeContext.rs"]
pub mod windows_named_pipe_context;

#[path = "ssl_wrapper.rs"]
pub mod ssl_wrapper;

#[path = "tls_socket_functions.rs"]
mod tls_socket_functions;

#[path = "udp_socket.rs"]
pub mod udp_socket_draft;

#[path = "uws_dispatch.rs"]
pub mod uws_dispatch;

#[path = "uws_handlers.rs"]
pub mod uws_handlers;

#[path = "uws_jsc.rs"]
pub mod uws_jsc;

#[path = "SSLConfig.rs"]
pub mod ssl_config;
pub use ssl_config::SSLConfig;

// ─── canonical type surface ──────────────────────────────────────────────────
// These were previously stub-defined inline here for the B-2 struct/state
// un-gate; now that the real submodules compile, re-export instead so
// `socket_body`/`tls_socket_functions`/`uws_handlers` all agree on one type.

pub use socket_body::{Flags as SocketFlags, NativeCallbacks, NewSocket, SocketMode, TCPSocket, TLSSocket};
pub use handlers::{Handlers, SocketConfig};
pub use listener::Listener;
pub use socket_address::SocketAddress;

#[cfg(windows)]
pub use windows_named_pipe_context::WindowsNamedPipeContext;
#[cfg(not(windows))]
pub type WindowsNamedPipeContext = ();

/// LAYERING: `udp_socket.rs` is the canonical body. It is mounted as
/// `udp_socket_draft` above (Phase-B name retained for existing callers); the
/// public `udp_socket` module below is a thin re-export façade so both
/// `generated_classes.rs` (`crate::socket::udp_socket::UDPSocket`) and
/// `generated_js2native.rs` (`crate::socket::udp_socket::udp_socket::js_connect`)
/// resolve against the real struct, not an opaque placeholder.
pub mod udp_socket {
    pub use super::udp_socket_draft::*;
    /// `generated_js2native.rs` lowers `$zig(udp_socket.zig, UDPSocket.jsConnect)`
    /// to `crate::socket::udp_socket::udp_socket::js_connect`. The inner
    /// `udp_socket` segment is the snake-cased struct name; aliasing the type
    /// lets the associated-fn path resolve directly.
    pub use super::udp_socket_draft::UDPSocket as udp_socket;
}
pub use udp_socket::UDPSocket;

/// Codegen path alias.
///
/// `generated_js2native.rs` lowers `$zig(socket.zig, fnName)` to
/// `crate::socket::socket::fn_name(...)` (one path segment per directory plus
/// the file stem). The Rust port placed the bodies in `socket_body.rs` to keep
/// `mod.rs` as the wiring layer, so re-export the js2native entry points under
/// the name the generator expects rather than special-casing the generator.
pub mod socket {
    pub use super::socket_body::{
        js_create_socket_pair, js_get_buffered_amount, js_is_named_pipe_socket,
        js_set_socket_options, js_upgrade_duplex_to_tls,
    };
}

// ─── SocketEvents glue ───────────────────────────────────────────────────────
// `uws_handlers::SocketEvents<SSL>` is the trait the vtable dispatch layer
// (`uws_dispatch.rs`) requires of `api::NewSocket<SSL>`. The inherent
// `on_*` methods live on `socket_body::NewSocket`; bridge them here so the
// trait impl and the struct definition stay in their respective files.
impl<const SSL: bool> uws_handlers::SocketEvents<SSL> for NewSocket<SSL> {
    #[inline]
    fn on_open(&mut self, s: bun_uws::NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        NewSocket::on_open(self, s);
        Ok(())
    }
    #[inline]
    fn on_data(&mut self, s: bun_uws::NewSocketHandler<SSL>, data: &[u8]) -> bun_jsc::JsResult<()> {
        NewSocket::on_data(self, s, data);
        Ok(())
    }
    #[inline]
    fn on_writable(&mut self, s: bun_uws::NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        NewSocket::on_writable(self, s);
        Ok(())
    }
    #[inline]
    fn on_close(
        &mut self,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
        reason: Option<*mut core::ffi::c_void>,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_close(self, s, code, reason)
    }
    #[inline]
    fn on_timeout(&mut self, s: bun_uws::NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        NewSocket::on_timeout(self, s);
        Ok(())
    }
    #[inline]
    fn on_end(&mut self, s: bun_uws::NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        NewSocket::on_end(self, s);
        Ok(())
    }
    #[inline]
    fn on_connect_error(&mut self, s: bun_uws::NewSocketHandler<SSL>, code: i32) -> bun_jsc::JsResult<()> {
        NewSocket::on_connect_error(self, s, code)
    }
    #[inline]
    fn on_handshake(
        &mut self,
        s: bun_uws::NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws_sys::us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        // Bridge the C-ABI `bun_uws_sys` struct to the `bun_uws` mirror the
        // inherent method takes (identical layout, first field renamed).
        let err = bun_uws::us_bun_verify_error_t { error_no: err.error, code: err.code, reason: err.reason };
        NewSocket::on_handshake(self, s, ok, err)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/socket.zig
//   confidence: medium
//   notes:      type surface re-exported from real submodules; SocketEvents
//               trait bridged to socket_body::NewSocket inherent methods.
// ──────────────────────────────────────────────────────────────────────────
