//! QUIC (RFC 9000) and HTTP/3 (RFC 9114) without I/O. Parts derive from lsquic (LICENSE.md).
#![forbid(unsafe_code)]
// Packets come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod batch;
mod cid;
mod coding;
mod config;
mod congestion;
mod connection;
pub mod crypto;
mod deadlines;
mod endpoint;
mod error;
mod event;
mod frame;
mod hash;
pub mod http3;
mod packet;
mod path;
mod range_set;
mod stream_id;
mod time;
pub mod tls;
mod token;
mod token_bucket;
mod transport_parameters;
mod version;

pub use batch::Batch;
pub use cid::ConnectionId;
pub use config::{Config, FieldLimits, Http3Config, KeepAlive};
pub use congestion::Algorithm;
pub use connection::{Connection, Stats, StreamInfo};
pub use endpoint::{Endpoint, Handle, Incoming, Unrouted};
pub use error::{Layer, http3_code, transport_code};
pub use event::{CloseReason, Context, Event, StreamEvent};
pub use path::Addresses;
pub use stream_id::{Direction, Side, StreamId};
pub use time::{Duration, Instant};
pub use token_bucket::TokenBucket;
pub use transport_parameters::{PreferredAddress, TransportParameters};
pub use version::Version;

/// For what is known to be there.
#[inline]
fn with<T>(it: Option<T>, then: impl FnOnce(T)) {
    it.map(then).unwrap_or_default()
}
