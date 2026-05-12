//! Rust bindings for the lsquic-backed QUIC transport in
//! `packages/bun-usockets/src/quic.{c,h}`. One opaque per C handle; the
//! HTTP/3 server uses these via the C++ uWS layer (`uws.H3`), the HTTP/3
//! fetch client (`src/http/H3Client.zig`) uses them directly.
//!
//! Lifetimes: a `Context` outlives every `Socket` on it; a `Socket`
//! outlives every `Stream` on it. `Socket`/`Stream` pointers are valid
//! until their `on_close` callback returns, after which they are freed by
//! lsquic — never store them past that point.

#[path = "quic/Context.rs"]
pub mod context;
#[path = "quic/Header.rs"]
pub mod header;
#[path = "quic/PendingConnect.rs"]
pub mod pending_connect;
#[path = "quic/Socket.rs"]
pub mod socket;
#[path = "quic/Stream.rs"]
pub mod stream;

pub use self::context::Context;
pub use self::pending_connect::PendingConnect;
pub use self::socket::Socket;
pub use self::stream::Stream;

pub use self::header::Header;
pub use self::header::Qpack;

unsafe extern "C" {
    // safe: no args; idempotent C-side initialization with no preconditions.
    pub safe fn us_quic_global_init();
}

#[inline]
pub fn global_init() {
    us_quic_global_init()
}

// ported from: src/uws_sys/quic.zig
