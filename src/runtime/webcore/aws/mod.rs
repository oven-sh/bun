//! Cloud credentials: the AWS default provider chain (used by `Bun.s3`,
//! `fetch("s3://…")`, `fetch(url, { aws })`, `Bun.aws`) and GCP application
//! default credentials (`fetch(url, { gcp })`, `Bun.gcp`).

pub mod chain;
pub mod config;
pub mod fetch_signing;
pub mod http_sync;
pub mod ini;
pub mod js;
pub mod json;
pub mod provider;
pub mod sign_options;

pub use sign_options::AwsSignOptions;
pub use provider::{DefaultProvider, default_provider, resolve_async, resolve_shared_async, shared};
