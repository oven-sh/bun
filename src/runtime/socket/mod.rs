//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).
//!
//! The full method bodies live in `socket_body.rs`; this module wires the
//! submodules together and re-exports the canonical type surface so
//! `crate::api` and the dispatch / handler layers see one set of types.

// ─── submodules ──────────────────────────────────────────────────────────────

#[path = "socket_body.rs"]
pub(crate) mod socket_body;

#[path = "SocketAddress.rs"]
pub(crate) mod socket_address;

#[path = "Handlers.rs"]
pub(crate) mod handlers;

#[path = "JSSocketHandlers.rs"]
pub(crate) mod js_socket_handlers;

#[path = "Listener.rs"]
pub(crate) mod listener;

pub(crate) mod pending_writes;

#[path = "UpgradedDuplex.rs"]
pub(crate) mod upgraded_duplex;

#[path = "FdPipe.rs"]
pub(crate) mod fd_pipe;

#[cfg(windows)]
#[path = "WindowsNamedPipe.rs"]
pub(crate) mod windows_named_pipe;

mod bundled_root_certs;
mod cert_files;
#[cfg(all(unix, not(target_vendor = "apple")))]
mod system_certs;

pub(crate) mod node_http_socket;
pub(crate) mod udp_socket;

#[path = "uws_dispatch.rs"]
pub(crate) mod uws_dispatch;

#[path = "uws_handlers.rs"]
pub(crate) mod uws_handlers;

#[path = "uws_jsc.rs"]
pub(crate) mod uws_jsc;

#[path = "SSLConfig.rs"]
pub(crate) mod ssl_config;
pub(crate) use ssl_config::{SSLConfig, http_client_defaults, resolve_reject_unauthorized};

// ─── canonical type surface ──────────────────────────────────────────────────
// These were previously stub-defined inline here; now that the real
// submodules compile, re-export instead so
// `socket_body`/`tls_socket_functions`/`uws_handlers` all agree on one type.

pub(crate) use handlers::{Handlers, SocketConfig};
pub(crate) use listener::Listener;
pub(crate) use socket_address::SocketAddress;
pub(crate) use socket_body::{
    DeferredWriteCompletion, Flags as SocketFlags, NativeCallbacks, NewSocket, SocketMode,
    TCPSocket, TLSSocket, server_ctx_rejects_unauthorized, server_ctx_requests_cert,
};

#[cfg(windows)]
pub(crate) use windows_named_pipe::WindowsNamedPipe;

pub(crate) use udp_socket::UDPSocket;

// ─── RawSocketEvents glue ────────────────────────────────────────────────────
// `uws_handlers::RawSocketEvents<SSL>` is the raw-pointer dispatch trait the
// vtable layer requires of `api::NewSocket<SSL>` (routed via `RawPtrHandler`). The
// handlers take `ThisPtr<Self>` rather than `&mut self`:
// a JS callback can close the socket and drop its last ref mid-dispatch, and a
// `&mut` argument protector outliving the allocation is UB.
impl<const SSL: bool> uws_handlers::RawSocketEvents<SSL> for NewSocket<SSL> {
    const HAS_ON_OPEN: bool = true;

    #[inline]
    fn on_open(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_open(this, s)
    }
    #[inline]
    fn on_data(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        data: &[u8],
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_data(this, s, data)
    }
    #[inline]
    fn on_writable(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_writable(this, s)
    }
    #[inline]
    fn on_close(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
        reason: *mut core::ffi::c_void,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_close(
            this,
            s,
            code,
            if reason.is_null() { None } else { Some(reason) },
        )
    }
    #[inline]
    fn on_timeout(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_timeout(this, s)
    }
    #[inline]
    fn on_end(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_end(this, s)
    }
    #[inline]
    fn on_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        code: i32,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_connect_error(this, s, code)
    }
    #[inline]
    fn on_handshake(
        this: bun_ptr::ThisPtr<Self>,
        s: bun_uws::NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws_sys::us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        NewSocket::on_handshake(this, s, ok, err)
    }
}
