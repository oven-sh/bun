//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).
//!
//! Port of `src/runtime/dns_jsc/dns.zig`. The full body — `Resolver` with the
//! c-ares channel, all `resolve*`/`reverse`/`getServers`/`setServers` host
//! functions, libinfo/libuv/system getaddrinfo backends, and the process-wide
//! `internal` cache used by the usockets connect path — lives in `dns.rs`
//! (mounted here as `dns_body`). This module is the public surface: it
//! re-exports the real types and methods so callers (`dispatch.rs`,
//! `repl_command.rs`, `udp_socket.rs`) name `crate::dns_jsc::Foo` directly.

#[path = "dns.rs"]
mod dns_body;
pub(crate) use dns_body::netc;

#[path = "cares_jsc.rs"]
pub mod cares_jsc; // c-ares reply struct → JSValue bridges

#[path = "options_jsc.rs"]
pub mod options_jsc; // GetAddrInfo.Options ↔ JSValue

// ─── public surface ──────────────────────────────────────────────────────────
// `dns_body` is the real port of `dns.zig` (c-ares channel, request types,
// Resolver method bodies, `internal` cache). The earlier B-2 erased
// "type-surface" duplicates that lived here have been dissolved — there is one
// `Resolver`, and `dispatch.rs`'s `from_field_ptr!`/`owner_as!` casts now resolve
// to the same allocation `dns_body::Resolver::init` produces.

pub use dns_body::{
    CacheConfig, CacheHit, GetAddrInfoAsyncCallback, GetAddrInfoRequest, GlobalData,
    InternalDNSRequest, Order, PendingCache, PendingCacheField, RecordType, Resolver, internal,
};
pub use dns_body::{
    get_addr_info_request, get_host_by_addr_info_request, get_name_info_request,
    resolve_info_request,
};
