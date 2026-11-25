//! A DNS stub resolver without I/O of its own. It is modeled on c-ares, and parts derive from it (LICENSE.md).
#![forbid(unsafe_code)]
// Replies come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod cache;
mod client;
mod config;
mod error;
mod hosts;
mod lookup;
mod message;
mod name;
mod servers;
mod sort;
mod system;
mod transport;

pub use client::{Answer, Answers, Client, Options, Reply};
pub use config::Config;
pub use error::Error;
pub use lookup::Family;
pub use message::{Address, Record, RecordType, Records, Strings};
pub use name::{Name, is_hostname_byte};
pub use system::{
    Events, FileStamp, Route, Socket, SocketError, SocketId, System, Transport, Variable,
};

type HashMap<K, V> = hashbrown::HashMap<K, V, bun_wyhash::BuildHasher>;
type HashSet<T> = hashbrown::HashSet<T, bun_wyhash::BuildHasher>;

pub const DEFAULT_PORT: u16 = 53;
