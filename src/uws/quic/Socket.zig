//! `us_quic_socket_t` — one QUIC connection. Valid until its `on_close`
//! callback returns; lsquic frees the underlying `lsquic_conn` immediately
//! after, so callers must drop the pointer inside that callback.

pub const Socket = opaque {
    extern fn us_quic_socket_make_stream(s: *Socket) void;
    pub const makeStream = us_quic_socket_make_stream;

    extern fn us_quic_socket_streams_avail(s: *Socket) c_uint;
    pub const streamsAvail = us_quic_socket_streams_avail;

    extern fn us_quic_socket_status(s: *Socket, buf: [*]u8, len: c_uint) c_int;
    pub fn status(s: *Socket, buf: []u8) c_int {
        return us_quic_socket_status(s, buf.ptr, @intCast(buf.len));
    }

    extern fn us_quic_socket_close(s: *Socket) void;
    pub const close = us_quic_socket_close;

    extern fn us_quic_socket_ext(s: *Socket) *anyopaque;
    /// `conn_ext_size` bytes of caller storage co-allocated with the socket.
    /// Unset until the caller writes to it after `connect`/`on_open`; the
    /// `?*T` slot pattern lets callbacks early-return on a null ext.
    pub fn ext(s: *Socket, comptime T: type) *?*T {
        return @ptrCast(@alignCast(us_quic_socket_ext(s)));
    }
};
