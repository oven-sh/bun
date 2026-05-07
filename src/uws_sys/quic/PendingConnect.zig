//! `us_quic_pending_connect_s` — DNS-pending client connect. Created when
//! `Context.connect` returns 0 (cache miss); holds the
//! `Bun__addrinfo` request that the caller registers a callback on.
//! Consumed by exactly one of `resolved()` or `cancel()`.

pub const PendingConnect = opaque {
    extern fn us_quic_pending_connect_addrinfo(pc: *PendingConnect) *anyopaque;
    pub const addrinfo = us_quic_pending_connect_addrinfo;

    extern fn us_quic_pending_connect_resolved(pc: *PendingConnect) ?*Socket;
    pub const resolved = us_quic_pending_connect_resolved;

    extern fn us_quic_pending_connect_cancel(pc: *PendingConnect) void;
    pub const cancel = us_quic_pending_connect_cancel;
};

const bun = @import("bun");
const uws = bun.uws;
const Socket = uws.quic.Socket;
