//! Rust bindings for the lsquic-backed QUIC transport in
//! `packages/bun-usockets/src/quic.{c,h}`. One opaque per C handle; the
//! HTTP/3 server uses these via the C++ uWS layer (`uws.H3`), the HTTP/3
//! fetch client (`src/http/H3Client.zig`) uses them directly.
//!
//! Lifetimes: a `Context` outlives every `Socket` on it; a `Socket`
//! outlives every `Stream` on it. `Socket`/`Stream` pointers are valid
//! until their `on_close` callback returns, after which they are freed by
//! lsquic — never store them past that point.

pub mod context;
pub mod socket;
pub mod stream;
pub mod pending_connect;
pub mod header;

pub use self::context::Context;
pub use self::socket::Socket;
pub use self::stream::Stream;
pub use self::pending_connect::PendingConnect;

pub use self::header::Header;
pub use self::header::Qpack;

unsafe extern "C" {
    pub fn us_quic_global_init();
}

#[inline]
pub fn global_init() {
    // SAFETY: us_quic_global_init is idempotent C-side initialization with no preconditions.
    unsafe { us_quic_global_init() }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic.zig (20 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export module; submodule filenames snake_cased per crate-map rule
// ──────────────────────────────────────────────────────────────────────────
