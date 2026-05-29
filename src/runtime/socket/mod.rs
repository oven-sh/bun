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

pub mod ssl_wrapper {
    pub use bun_uws::ssl_wrapper::*;

    /// Zig `init(ssl_options: jsc.API.ServerConfig.SSLConfig, ...)`.
    /// Thin wrapper over `SSLWrapper::init_from_options` so callers in this
    /// tier can keep passing `&SSLConfig` directly.
    pub fn init<T: Copy>(
        ssl_options: &crate::server::server_config::SSLConfig,
        is_client: bool,
        handlers: Handlers<T>,
    ) -> Result<SSLWrapper<T>, bun_core::Error> {
        SSLWrapper::<T>::init_from_options(&ssl_options.as_usockets(), is_client, handlers)
            .map_err(bun_core::Error::from)
    }
}

// `tls_socket_functions.rs` is `#[path]`-included from `socket_body.rs` (where
// the functions are actually used); a second top-level include here was only
// there for type-check parity.

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
pub use ssl_config::{SSLConfig, SSLConfigFromJs};

pub use handlers::{Handlers, SocketConfig};
pub use listener::Listener;
pub use socket_address::SocketAddress;
pub use socket_body::{
    Flags as SocketFlags, NativeCallbacks, NewSocket, SocketMode, TCPSocket, TLSSocket,
};

#[cfg(windows)]
pub use windows_named_pipe_context::WindowsNamedPipeContext;

pub mod udp_socket {
    pub use super::udp_socket_draft::UDPSocket as udp_socket;
    pub use super::udp_socket_draft::*;
}
pub use udp_socket::UDPSocket;

pub mod socket {
    pub use super::socket_body::{
        js_create_socket_pair, js_get_buffered_amount, js_is_named_pipe_socket,
        js_set_socket_options, js_upgrade_duplex_to_tls,
    };
}

impl<const SSL: bool> uws_handlers::RawSocketEvents<SSL> for NewSocket<SSL> {
    const HAS_ON_OPEN: bool = true;

    #[inline]
    unsafe fn on_open(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>) {
        // SAFETY: caller (RawPtrHandler) passes the live ext-slot pointer.
        unsafe { NewSocket::on_open(this, s) };
    }
    #[inline]
    unsafe fn on_data(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>, data: &[u8]) {
        // SAFETY: see `on_open`.
        unsafe { NewSocket::on_data(this, s, data) };
    }
    #[inline]
    unsafe fn on_writable(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { NewSocket::on_writable(this, s) };
    }
    #[inline]
    unsafe fn on_close(
        this: *mut Self,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
        reason: *mut core::ffi::c_void,
    ) {
        // SAFETY: see `on_open`.
        let _ = unsafe {
            NewSocket::on_close(
                this,
                s,
                code,
                if reason.is_null() { None } else { Some(reason) },
            )
        };
    }
    #[inline]
    unsafe fn on_timeout(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { NewSocket::on_timeout(this, s) };
    }
    #[inline]
    unsafe fn on_end(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { NewSocket::on_end(this, s) };
    }
    #[inline]
    unsafe fn on_connect_error(this: *mut Self, s: bun_uws::NewSocketHandler<SSL>, code: i32) {
        // SAFETY: see `on_open`.
        let _ = unsafe { NewSocket::on_connect_error(this, s, code) };
    }
    #[inline]
    unsafe fn on_handshake(
        this: *mut Self,
        s: bun_uws::NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws_sys::us_bun_verify_error_t,
    ) {
        // SAFETY: see `on_open`.
        let _ = unsafe { NewSocket::on_handshake(this, s, ok, err) };
    }
}

// ported from: src/runtime/socket/socket.zig
