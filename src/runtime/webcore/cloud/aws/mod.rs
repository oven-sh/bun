//! The AWS default credential provider chain, SigV4 request signing for
//! `fetch()`, and `Bun.aws`.

pub mod chain;
pub mod config;
pub mod fetch_signing;
pub mod ini;
pub mod js;
pub mod provider;
pub mod sign_options;

pub use js::AWSClient;
pub use provider::{DefaultProvider, default_provider, resolve_shared_async};
pub use sign_options::AwsSignOptions;
