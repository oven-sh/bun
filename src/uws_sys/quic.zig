//! Rust bindings for the lsquic-backed QUIC transport in
//! `packages/bun-usockets/src/quic.{c,h}`. One opaque per C handle; the
//! HTTP/3 server uses these via the C++ uWS layer (`uws.H3`), the HTTP/3
//! fetch client (`src/http/H3Client.rust`) uses them directly.
//!
//! Lifetimes: a `Context` outlives every `Socket` on it; a `Socket`
//! outlives every `Stream` on it. `Socket`/`Stream` pointers are valid
//! until their `on_close` callback returns, after which they are freed by
//! lsquic — never store them past that point.

pub const Context = @import("./quic/Context.rust").Context;
pub const Socket = @import("./quic/Socket.rust").Socket;
pub const Stream = @import("./quic/Stream.rust").Stream;
pub const PendingConnect = @import("./quic/PendingConnect.rust").PendingConnect;

pub const Header = @import("./quic/Header.rust").Header;
pub const Qpack = @import("./quic/Header.rust").Qpack;

pub extern fn us_quic_global_init() callconv(.c) void;
pub const globalInit = us_quic_global_init;
