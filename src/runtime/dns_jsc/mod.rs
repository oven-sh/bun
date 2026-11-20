//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).

#[path = "dns.rs"]
mod dns_body;
#[cfg(windows)]
pub(crate) use dns_body::UvDnsPoll;
#[cfg(target_os = "macos")]
pub(crate) use dns_body::dns_sd;
#[cfg(windows)]
pub(crate) use dns_body::lib_uv_backend::LibuvRequest;
pub(crate) use dns_body::{GlobalData, Order, Resolver, internal, netc};

pub(crate) mod cares_jsc;
pub(crate) mod options_jsc;
