//! Google application default credentials: `Bun.gcp` and `fetch(url, { gcp })`.

pub mod chain;
pub mod js;
pub mod jwt;
pub mod provider;

pub use js::GcpFetchOptions;
pub use provider::{TokenProvider, provider_for, resolve_async};
