//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).

#[path = "dns.rs"]
mod dns_body;
#[cfg(target_os = "macos")]
pub(crate) use dns_body::dns_sd;
pub(crate) use dns_body::{Order, Resolver, internal, netc};

pub(crate) mod answer_jsc;
pub(crate) mod options_jsc;
