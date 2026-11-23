use crate::connection::Connection;
use crate::error::Layer;
use crate::http3::Fields;
use crate::path::Addresses;
use crate::stream_id::{Direction, StreamId};

/// What the application attaches to a connection or a stream.
pub type Context = *mut core::ffi::c_void;

pub enum Event {
    /// Streams can be used. On a server that accepts early data, this is before the end of the handshake.
    Ready,
    /// RFC 9001 §4.1.2.
    HandshakeConfirmed,
    /// All streams are closed without a word to the peer.
    EarlyDataRejected,
    /// For [`Endpoint::connect`](crate::Endpoint::connect).
    Ticket(Vec<u8>),
    Token(Vec<u8>),
    KeyLog(Vec<u8>),
    /// [`Connection::open`] may succeed again.
    StreamsAvailable(Direction),
    Stream(StreamId, Context, StreamEvent),
    Datagram {
        data: Vec<u8>,
        is_early: bool,
    },
    DatagramAcked(u64),
    DatagramLost(u64),
    /// It is too large.
    DatagramAbandoned(u64),
    PathChanged {
        from: Addresses,
        to: Addresses,
        is_preferred: bool,
    },
    GoAway {
        /// Something that has arrived before it has yet to be read.
        overtakes_data: bool,
    },
    /// The payload of an ORIGIN frame.
    Origin(Vec<u8>),
    /// The last one. The streams are closed before.
    Closed(Box<Connection>),
}

pub enum StreamEvent {
    /// By the peer.
    Opened,
    Headers(Fields),
    Data {
        data: Vec<u8>,
        is_last: bool,
    },
    /// Once for [`Connection::want_write`], or for a write that was short.
    Writable,
    /// There is nothing more to read.
    Reset(u64),
    /// There is nothing more to write.
    Stopped(u64),
    /// Reading and writing are both over. The last one.
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloseReason {
    /// The application asked for it.
    Local,
    /// What the peer did was not acceptable.
    Error {
        layer: Layer,
        code: u64,
        reason: &'static str,
    },
    Peer {
        layer: Layer,
        code: u64,
        reason: Vec<u8>,
    },
    StatelessReset,
    IdleTimeout,
    HandshakeTimeout,
    NoCommonVersion,
}
