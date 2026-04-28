//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `onDNSResolved` runs. The `quic.PendingConnect` C handle is consumed by
//! exactly one of `resolved()` or `cancel()`.

const PendingConnect = @This();

session: *ClientSession,
pc: *quic.PendingConnect,
loop_ptr: *uws.Loop,
next: ?*PendingConnect = null,

pub fn register(session: *ClientSession, pc: *quic.PendingConnect, l: *uws.Loop) void {
    const self = bun.new(PendingConnect, .{ .session = session, .pc = pc, .loop_ptr = l });
    session.ref();
    bun.dns.internal.registerQuic(@ptrCast(@alignCast(pc.addrinfo())), self);
}

pub fn loop(this: *PendingConnect) *uws.Loop {
    return this.loop_ptr;
}

pub fn onDNSResolved(this: *PendingConnect) void {
    const session = this.session;
    defer {
        session.deref();
        bun.destroy(this);
    }
    if (session.closed or session.pending.items.len == 0) {
        // Every waiter was aborted while DNS was in flight; don't open a
        // connection nobody will use.
        this.pc.cancel();
        if (!session.closed) failSession(session, error.Aborted);
        return;
    }
    const qs = this.pc.resolved() orelse {
        failSession(session, error.DNSResolutionFailed);
        return;
    };
    session.qsocket = qs;
    qs.ext(ClientSession).* = session;
}

/// DNS worker may call from off the HTTP thread; mirror
/// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
/// wake the loop. `drainResolved` runs from `HTTPThread.drainEvents` on the
/// next loop iteration after the wakeup.
pub fn onDNSResolvedThreadsafe(this: *PendingConnect) void {
    resolved_mutex.lock();
    this.next = resolved_head;
    resolved_head = this;
    resolved_mutex.unlock();
    this.loop_ptr.wakeup();
}

pub fn drainResolved() void {
    resolved_mutex.lock();
    var head = resolved_head;
    resolved_head = null;
    resolved_mutex.unlock();
    while (head) |pc| {
        const next = pc.next;
        pc.onDNSResolved();
        head = next;
    }
}

pub fn failSession(session: *ClientSession, err: anyerror) void {
    session.closed = true;
    if (H3.ClientContext.get()) |ctx| ctx.unregister(session);
    while (session.pending.items.len > 0) {
        const stream = session.pending.items[0];
        const cl = stream.client;
        session.detach(stream);
        if (cl) |cl_| cl_.failFromH2(err);
    }
    _ = H3.live_sessions.fetchSub(1, .monotonic);
    session.deref();
}

var resolved_mutex: bun.Mutex = .{};
var resolved_head: ?*PendingConnect = null;

const bun = @import("bun");

const H3 = bun.http.H3;
const ClientSession = H3.ClientSession;

const uws = bun.uws;
const quic = uws.quic;
