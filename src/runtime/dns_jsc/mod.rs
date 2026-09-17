//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).
//!
//! The full body — `Resolver` with the
//! c-ares channel, all `resolve*`/`reverse`/`getServers`/`setServers` host
//! functions, dns_sd/libuv/system getaddrinfo backends, and the process-wide
//! `internal` cache used by the usockets connect path — lives in `dns.rs`
//! (mounted here as `dns_body`). This module is the public surface: it
//! re-exports the real types and methods so callers (`dispatch.rs`,
//! `repl_command.rs`, `udp_socket.rs`) name `crate::dns_jsc::Foo` directly.

#[path = "dns.rs"]
#[doc(hidden)]
pub mod dns_body;
pub(crate) use dns_body::netc;

#[path = "cares_jsc.rs"]
pub mod cares_jsc; // c-ares reply struct → JSValue bridges

#[path = "options_jsc.rs"]
pub mod options_jsc; // GetAddrInfo.Options ↔ JSValue

// ─── public surface ──────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub(crate) use dns_body::dns_sd;
pub use dns_body::get_addr_info_request;
pub use dns_body::{
    CacheHit, GetAddrInfoRequest, GlobalData, InternalDNSRequest, Order, PendingCache, RecordType,
    Resolver, internal,
};
