//! Process-global lazily-initialised on the HTTP thread. Owns the lsquic
//! client engine and the live-session registry. Never freed — the engine
//! lives for the process, same as the HTTP thread itself.

const ClientContext = @This();

qctx: *quic.Context,
sessions: std.ArrayListUnmanaged(*ClientSession) = .{},

/// One instance per HTTP-thread loop. Stored as a process global only
/// because `bun.http.http_thread` is itself a process singleton — the
/// underlying lsquic engine is bound to the `loop` passed to
/// `quic.Context.createClient` (it lives on `loop->data.quic_head` and is
/// driven by that loop's pre/post hooks), so a second loop would get its
/// own engine; this var would just need to become per-loop storage.
var instance: ?*ClientContext = null;
var lsquic_init_once = bun.once(quic.globalInit);

pub fn get() ?*ClientContext {
    return instance;
}

pub fn getOrCreate(loop: *uws.Loop) ?*ClientContext {
    if (instance) |i| return i;
    lsquic_init_once.call(.{});
    const qctx = quic.Context.createClient(
        loop,
        0,
        @sizeOf(*ClientSession),
        @sizeOf(*Stream),
    ) orelse return null;
    callbacks.register(qctx);

    const self = bun.handleOom(bun.default_allocator.create(ClientContext));
    self.* = .{ .qctx = qctx };
    instance = self;
    return self;
}

/// Find or open a connection to `hostname:port` and queue `client` on it.
pub fn connect(this: *ClientContext, client: *HTTPClient, hostname: []const u8, port: u16) bool {
    const reject = client.flags.reject_unauthorized;
    for (this.sessions.items) |s| {
        if (s.matches(hostname, port, reject) and s.hasHeadroom()) {
            log("reuse session {s}:{d}", .{ hostname, port });
            s.enqueue(client);
            return true;
        }
    }

    const host_z = bun.handleOom(bun.default_allocator.dupeZ(u8, hostname));
    const session = ClientSession.new(.{
        .qsocket = null,
        .hostname = host_z,
        .port = port,
        .reject_unauthorized = reject,
    });
    _ = H3.live_sessions.fetchAdd(1, .monotonic);
    session.registry_index = @intCast(this.sessions.items.len);
    bun.handleOom(this.sessions.append(bun.default_allocator, session));
    session.enqueue(client);

    switch (this.qctx.connect(host_z.ptr, port, host_z.ptr, reject, session)) {
        .socket => |qs| {
            session.qsocket = qs;
            qs.ext(ClientSession).* = session;
            log("connect {s}:{d} (sync)", .{ hostname, port });
        },
        .pending => |pending| {
            log("connect {s}:{d} (dns pending)", .{ hostname, port });
            PendingConnect.register(session, pending, this.qctx.loop());
        },
        .err => {
            log("connect {s}:{d} failed", .{ hostname, port });
            this.unregister(session);
            PendingConnect.failSession(session, error.ConnectionRefused);
            return false;
        },
    }
    return true;
}

pub fn unregister(this: *ClientContext, session: *ClientSession) void {
    const i = session.registry_index;
    if (i >= this.sessions.items.len or this.sessions.items[i] != session) return;
    _ = this.sessions.swapRemove(i);
    if (i < this.sessions.items.len) this.sessions.items[i].registry_index = i;
    session.registry_index = std.math.maxInt(u32);
}

pub fn abortByHttpId(async_http_id: u32) bool {
    const this = instance orelse return false;
    for (this.sessions.items) |s| {
        if (s.abortByHttpId(async_http_id)) return true;
    }
    return false;
}

pub fn streamBodyByHttpId(async_http_id: u32, ended: bool) void {
    const this = instance orelse return;
    for (this.sessions.items) |s| s.streamBodyByHttpId(async_http_id, ended);
}

const log = bun.Output.scoped(.h3_client, .hidden);

const ClientSession = @import("./ClientSession.zig");
const H3 = @import("../H3Client.zig");
const PendingConnect = @import("./PendingConnect.zig");
const Stream = @import("./Stream.zig");
const callbacks = @import("./callbacks.zig");
const std = @import("std");

const bun = @import("bun");
const HTTPClient = bun.http;

const uws = bun.uws;
const quic = uws.quic;
