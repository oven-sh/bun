//! A stub DNS resolver without I/O of its own, behaving as c-ares 1.34.9 did the way Bun configured it. Parts derive from it (LICENSE.md).
#![forbid(unsafe_code)]
// Answers come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
#![allow(dead_code)] // WIP

pub mod addrinfo;
mod buf;
mod channel;
mod error;
mod hosts;
pub mod io;
mod lookup;
pub mod record;
pub mod reply;
mod sysconfig;
mod text;

pub use channel::{Answer, Channel, Completion, Options, ServerConfig};
pub use error::{Error, Result};
pub use lookup::{Host, NameInfo};
pub use record::Record;
pub use sysconfig::{Source, SysConfig};
