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

#[path = "UpgradedDuplex.rs"]
pub(crate) mod upgraded_duplex;

#[cfg(windows)]
#[path = "WindowsNamedPipe.rs"]
pub(crate) mod windows_named_pipe;

#[cfg(windows)]
#[path = "WindowsNamedPipeContext.rs"]
pub(crate) mod windows_named_pipe_context;

mod bundled_root_certs;
mod cert_files;
#[cfg(all(unix, not(target_vendor = "apple")))]
mod system_certs;

/// Re-export of the canonical `bun_uws::ssl_wrapper` plus the runtime-tier
/// `init(&SSLConfig, ..)` constructor that the lower tier can't see (it would
/// need to name `crate::server::server_config::SSLConfig`). The body is the
/// same `as_usockets() → init_from_options()` round-trip the old local copy
/// did; the duplicate module file is gone.
pub(crate) mod ssl_wrapper {
    pub(crate) use bun_uws::ssl_wrapper::*;

    /// Thin wrapper over `SSLWrapper::init_from_options` so callers in this
    /// tier can keep passing `&SSLConfig` directly.
    pub(crate) fn init(
        ssl_options: &crate::server::server_config::SSLConfig,
        is_client: bool,
    ) -> Result<SSLWrapper, crate::Error> {
        SSLWrapper::init_from_options(&ssl_options.as_usockets(), is_client)
            .map_err(crate::Error::from)
    }
}

pub(crate) mod udp_socket;

#[path = "uws_dispatch.rs"]
pub(crate) mod uws_dispatch;

#[path = "uws_handlers.rs"]
pub(crate) mod uws_handlers;

#[path = "uws_jsc.rs"]
pub(crate) mod uws_jsc;

#[path = "SSLConfig.rs"]
pub(crate) mod ssl_config;
pub(crate) use ssl_config::{
    SSLConfig, SSLConfigFromJs, http_client_defaults, resolve_reject_unauthorized,
    tls_true_defaults,
};

// ─── canonical type surface ──────────────────────────────────────────────────
// These were previously stub-defined inline here; now that the real
// submodules compile, re-export instead so
// `socket_body`/`tls_socket_functions`/`uws_handlers` all agree on one type.

pub(crate) use handlers::{Handlers, SocketConfig};
pub(crate) use listener::Listener;
pub(crate) use socket_address::SocketAddress;
pub(crate) use socket_body::DuplexUpgradeContext;
pub(crate) use socket_body::{
    Flags as SocketFlags, NativeCallbacks, NativeRef, NewSocket, SocketMode, TCPSocket, TLSSocket,
    server_ctx_rejects_unauthorized, server_ctx_requests_cert,
};

#[cfg(windows)]
pub(crate) use windows_named_pipe_context::WindowsNamedPipeContext;

pub(crate) use udp_socket::UDPSocket;
