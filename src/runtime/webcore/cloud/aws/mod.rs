//! The AWS default credential provider chain, SigV4 request signing for
//! `fetch()`, and `Bun.aws`.

pub mod chain;
pub mod config;
pub mod fetch_signing;
pub mod ini;
pub mod js;
pub mod provider;
pub mod sign_options;

pub use provider::{
    DefaultProvider, default_provider, resolve_async, resolve_shared_async, shared,
};
pub use sign_options::AwsSignOptions;
