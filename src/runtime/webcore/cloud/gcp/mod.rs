//! Google application default credentials: `Bun.GCPClient` / `Bun.gcp`.

pub mod chain;
pub mod js;
pub mod jwt;
pub mod provider;

pub use js::{ClientOptions, GCPClient, GcpFetchOptions};
pub use provider::{TokenProvider, provider_for};
