//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).
//!
//! The full body — `Resolver` with its
//! `bun_dns_resolver` channel, all `resolve*`/`reverse`/`getServers`/`setServers` host
//! functions, dns_sd/libuv/system getaddrinfo backends, and the process-wide
//! `internal` cache used by the usockets connect path — lives in `dns.rs`
//! (mounted here as `dns_body`). This module is the public surface: it
//! re-exports the real types and methods so callers (`dispatch.rs`,
//! `repl_command.rs`, `udp_socket.rs`) name `crate::dns_jsc::Foo` directly.

#[path = "dns.rs"]
mod dns_body;
#[cfg(windows)]
pub(crate) use dns_body::UvDnsPoll;
#[cfg(windows)]
pub(crate) use dns_body::lib_uv_backend::LibuvCompleteHolder;
pub(crate) use dns_body::netc;

pub(crate) mod dns_resolver_jsc; // answers and errors → JSValue

mod system_io;
mod system_settings;

#[path = "options_jsc.rs"]
pub(crate) mod options_jsc; // GetAddrInfo.Options ↔ JSValue

// ─── public surface ──────────────────────────────────────────────────────────
// `dns_body` is the real implementation (the channel, request types,
// Resolver method bodies, `internal` cache). The earlier erased "type-surface"
// duplicates that lived here have been dissolved — there is one
// `Resolver`, and `dispatch.rs`'s `from_field_ptr!`/`owner_as!` casts now resolve
// to the same allocation `dns_body::Resolver::init` produces.

#[cfg(target_os = "macos")]
pub(crate) use dns_body::dns_sd;
pub(crate) use dns_body::{GlobalData, Order, Resolver, internal};
