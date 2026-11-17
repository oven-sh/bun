//! The network stack of a session. Pages only get at it through a [`Client`](crate::client::Client).

pub mod auth;
pub mod body;
mod cache;
mod chain;
pub mod checks;
pub mod cookies;
pub mod embedder;
pub mod error;
pub mod fetch;
mod gssapi;
mod hsts;
mod http;
#[cfg(target_os = "macos")]
mod keychain;
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod library;
#[cfg(target_os = "linux")]
mod nss;
mod ntlm;
pub mod proxy;
pub(crate) mod record;
pub mod response;
pub mod schemes;
pub mod session;
mod system_proxy;
pub mod tls;
mod transaction;
mod tunnel;
pub mod web_socket;

pub use error::{NetError, Result};
pub use http::Progress;
