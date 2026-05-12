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

/// Re-export of the canonical `bun_uws::ssl_wrapper` plus the runtime-tier
/// `init(&SSLConfig, ..)` constructor that the lower tier can't see (it would
/// need to name `crate::server::server_config::SSLConfig`). The body is the
/// same `as_usockets() → init_from_options()` round-trip the old local copy
/// did; the duplicate module file is gone.
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
        SSLWrapper::<T>::init_from_options(ssl_options.as_usockets(), is_client, handlers)
            .map_err(bun_core::Error::from)
    }
}

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
pub use ssl_config::{SSLConfig, SSLConfigFromJs};

// ─── canonical type surface ──────────────────────────────────────────────────
// These were previously stub-defined inline here for the B-2 struct/state
// un-gate; now that the real submodules compile, re-export instead so
// `socket_body`/`tls_socket_functions`/`uws_handlers` all agree on one type.

pub use handlers::{Handlers, SocketConfig};
pub use listener::Listener;
pub use socket_address::SocketAddress;
pub use socket_body::{
    Flags as SocketFlags, NativeCallbacks, NewSocket, SocketMode, TCPSocket, TLSSocket,
};

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
    /// `generated_js2native.rs` lowers `$zig(udp_socket.zig, UDPSocket.jsConnect)`
    /// to `crate::socket::udp_socket::udp_socket::js_connect`. The inner
    /// `udp_socket` segment is the snake-cased struct name; aliasing the type
    /// lets the associated-fn path resolve directly.
    pub use super::udp_socket_draft::UDPSocket as udp_socket;
    pub use super::udp_socket_draft::*;
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

// ─── RawSocketEvents glue ────────────────────────────────────────────────────
// `uws_handlers::RawSocketEvents<SSL>` is the raw-pointer dispatch trait the
// vtable layer requires of `api::NewSocket<SSL>` (routed via `RawPtrHandler`,
// not `PtrHandler`). PORT NOTE (noalias re-entrancy): the inherent `on_*`
// methods take `this: *mut Self` precisely so no `&mut NewSocket` is held
// across `callback.call` (JS can re-derive `&mut Self` via the wrapper's
// `m_ptr` and mutate `flags`/`handlers`/`ref_count`); a `&mut self` argument
// formed here from the ext slot and protected through the dispatch frame would
// be aliasing UB. Bridge them here so the trait impl and the struct definition
// stay in their respective files.
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
