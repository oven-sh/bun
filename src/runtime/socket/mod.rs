//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).
//!
//! The full method bodies live in `socket_body.rs`; this module wires the
//! submodules together and re-exports the canonical type surface so
//! `crate::api` and the dispatch / handler layers see one set of types.

// ─── submodules ──────────────────────────────────────────────────────────────

#[path = "socket_body.rs"]
mod socket_body;

#[path = "SocketAddress.rs"]
pub mod socket_address;

#[path = "Handlers.rs"]
pub mod handlers;

#[path = "JSSocketHandlers.rs"]
pub mod js_socket_handlers;

#[path = "Listener.rs"]
pub mod listener;

#[path = "UpgradedDuplex.rs"]
pub mod upgraded_duplex;

#[path = "WindowsNamedPipe.rs"]
pub mod windows_named_pipe;

#[path = "WindowsNamedPipeContext.rs"]
pub mod windows_named_pipe_context;

/// Re-export of the canonical `bun_uws::ssl_wrapper` plus the runtime-tier
/// `init(&SSLConfig, ..)` constructor that the lower tier can't see (it would
/// need to name `crate::server::server_config::SSLConfig`). The body is the
/// same `as_usockets() → init_from_options()` round-trip the old local copy
/// did; the duplicate module file is gone.
pub mod ssl_wrapper {
    pub use bun_uws::ssl_wrapper::*;

    /// Thin wrapper over `SSLWrapper::init_from_options` so callers in this
    /// tier can keep passing `&SSLConfig` directly.
    pub fn init<T: Copy>(
        ssl_options: &crate::server::server_config::SSLConfig,
        is_client: bool,
        handlers: Handlers<T>,
    ) -> Result<SSLWrapper<T>, crate::Error> {
        SSLWrapper::<T>::init_from_options(&ssl_options.as_usockets(), is_client, handlers)
            .map_err(crate::Error::from)
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
pub use ssl_config::{SSLConfig, SSLConfigFromJs, resolve_reject_unauthorized, tls_true_defaults};

// ─── canonical type surface ──────────────────────────────────────────────────
// These were previously stub-defined inline here; now that the real
// submodules compile, re-export instead so
// `socket_body`/`tls_socket_functions`/`uws_handlers` all agree on one type.

pub use handlers::{Handlers, SocketConfig};
pub use listener::Listener;
pub use socket_address::SocketAddress;
pub use socket_body::{
    Flags as SocketFlags, NativeCallbacks, NewSocket, SocketMode, TCPSocket, TLSSocket,
};

#[cfg(windows)]
pub use windows_named_pipe_context::WindowsNamedPipeContext;

/// LAYERING: `udp_socket.rs` is the canonical body. It is mounted as
/// `udp_socket_draft` above (legacy name retained for existing callers); the
/// public `udp_socket` module below is a thin re-export façade so both
/// `generated_classes.rs` (`crate::socket::udp_socket::UDPSocket`) and
/// `generated_js2native.rs` (`crate::socket::udp_socket::udp_socket::js_connect`)
/// resolve against the real struct, not an opaque placeholder.
pub mod udp_socket {
    /// `generated_js2native.rs` lowers `$rust(udp_socket.rs, UDPSocket.jsConnect)`
    /// to `crate::socket::udp_socket::udp_socket::js_connect`. The inner
    /// `udp_socket` segment is the snake-cased struct name; aliasing the type
    /// lets the associated-fn path resolve directly.
    pub use super::udp_socket_draft::UDPSocket as udp_socket;
    pub use super::udp_socket_draft::*;
}
pub use udp_socket::UDPSocket;

/// Codegen path alias.
///
/// `generated_js2native.rs` lowers `$rust(socket.rs, fnName)` to
/// `crate::socket::socket::fn_name(...)` (one path segment per directory plus
/// the file stem). The Rust port placed the bodies in `socket_body.rs` to keep
/// `mod.rs` as the wiring layer, so re-export the js2native entry points under
/// the name the generator expects rather than special-casing the generator.
pub mod socket {
    pub use super::socket_body::{
        js_create_socket_pair, js_get_buffered_amount, js_is_named_pipe_socket,
        js_set_socket_options, js_upgrade_duplex_to_tls, js_upgrade_tls_deferred, testing_ap_is,
    };
}

// ─── RawSocketEvents glue ────────────────────────────────────────────────────
// `uws_handlers::RawSocketEvents<SSL>` is the raw-pointer dispatch trait the
// vtable layer requires of `api::NewSocket<SSL>` (routed via `RawPtrHandler`). The
// handlers take `ThisPtr<Self>` rather than `&mut self`:
// a JS callback can close the socket and drop its last ref mid-dispatch, and a
// `&mut` argument protector outliving the allocation is UB.
impl<const SSL: bool> uws_handlers::RawSocketEvents<SSL> for NewSocket<SSL> {
    const HAS_ON_OPEN: bool = true;

    #[inline]
    fn on_open(this: bun_ptr::ThisPtr<Self>, s: bun_uws::NewSocketHandler<SSL>) {
        NewSocket::on_open(this, s);
    }
    #[inline]
    fn on_data(this: bun_ptr::ThisPtr<Self>, s: bun_uws::NewSocketHandler<SSL>, data: &[u8]) {
        NewSocket::on_data(this, s, data);
    }
    #[inline]
    fn on_writable(this: bun_ptr::ThisPtr<Self>, s: bun_uws::NewSocketHandler<SSL>) {
        NewSocket::on_writable(this, s);
    }
    #[inline]
    fn on_close(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
        reason: *mut core::ffi::c_void,
    ) {
        let _ = NewSocket::on_close(
            this,
            s,
            code,
            if reason.is_null() { None } else { Some(reason) },
        );
    }
    #[inline]
    fn on_timeout(this: bun_ptr::ThisPtr<Self>, s: bun_uws::NewSocketHandler<SSL>) {
        NewSocket::on_timeout(this, s);
    }
    #[inline]
    fn on_end(this: bun_ptr::ThisPtr<Self>, s: bun_uws::NewSocketHandler<SSL>) {
        NewSocket::on_end(this, s);
    }
    #[inline]
    fn on_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
    ) {
        let _ = NewSocket::on_connect_error(this, s, code);
    }
    #[inline]
    fn on_handshake(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws_sys::us_bun_verify_error_t,
    ) {
        let _ = NewSocket::on_handshake(this, s, ok, err);
    }
}
