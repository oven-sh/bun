//! Zig bindings for the lsquic-backed QUIC transport in
//! `packages/bun-usockets/src/quic.{c,h}`. One opaque per C handle; the
//! HTTP/3 server uses these via the C++ uWS layer (`uws.H3`), the HTTP/3
//! fetch client (`src/http/H3Client.zig`) uses them directly.
//!
//! Lifetimes: a `Context` outlives every `Socket` on it; a `Socket`
//! outlives every `Stream` on it. `Socket`/`Stream` pointers are valid
//! until their `on_close` callback returns, after which they are freed by
//! lsquic — never store them past that point.

pub const Context = @import("./quic/Context.zig").Context;
pub const Socket = @import("./quic/Socket.zig").Socket;
pub const Stream = @import("./quic/Stream.zig").Stream;
pub const PendingConnect = @import("./quic/PendingConnect.zig").PendingConnect;

pub const Header = @import("./quic/Header.zig").Header;
pub const Qpack = @import("./quic/Header.zig").Qpack;

pub extern fn us_quic_global_init() callconv(.c) void;
pub const globalInit = us_quic_global_init;
