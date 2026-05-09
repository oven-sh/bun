//! DNS-pending SOCKS5 connect. Created when `SocksProxy.receive` returns
//! `.needs_dns_resolve` (socks5:// with hostname); the global DNS cache
//! notifies via `onDNSResolved[Threadsafe]`, at which point the resolved
//! address is used to write the SOCKS5 CONNECT request.
//!
//! Lifetime: destroyed exclusively by `onDNSResolved` (from drain or sync
//! notify). Owner cancel sets `cancelled` flag only — never destroys.
//!
//! HTTP owners: pushed to `resolved_head` mutex-list, drained from
//! `HTTPThread.drainEvents`. WebSocket owners: scheduled via
//! `loop.nextTick` directly onto the JS main thread.

const SocksDNSPending = @This();

pub const HTTPOwner = struct {
    async_http_id: u32,
    target_port: u16,
};

pub const OwnerKind = union(enum) {
    http: HTTPOwner,
    ws_non_tls: *WsUpgradeClientNonTLS,
    ws_tls: *WsUpgradeClientTLS,
};

owner: OwnerKind,
loop_ptr: *uws.Loop,
dns_request: *dns.internal.Request,
cancelled: std.atomic.Value(bool),
next: ?*SocksDNSPending = null,

pub fn loop(this: *SocksDNSPending) *uws.Loop {
    return this.loop_ptr;
}

// --- Thread dispatch ---

/// Called from DNS worker thread (or inline from `registerSocksIfPending`
/// when result arrives between check and lock). Routes to the correct
/// thread for final processing.
pub fn onDNSResolvedThreadsafe(this: *SocksDNSPending) void {
    switch (this.owner) {
        .http => {
            // Push to HTTP-thread drain list
            resolved_mutex.lock();
            this.next = resolved_head;
            resolved_head = this;
            resolved_mutex.unlock();
            this.loop_ptr.wakeup();
        },
        .ws_non_tls, .ws_tls => {
            // Schedule directly on JS main thread
            this.loop_ptr.nextTick(*SocksDNSPending, this, onDNSResolved);
        },
    }
}

/// Drain all HTTP-thread pending resolves. Called from
/// `HTTPThread.drainEvents` on the HTTP thread.
pub fn drainResolved() void {
    resolved_mutex.lock();
    var head = resolved_head;
    resolved_head = null;
    resolved_mutex.unlock();
    while (head) |pc| {
        const next_pc = pc.next;
        pc.onDNSResolved();
        head = next_pc;
    }
}

// --- DNS resolved callback (runs on owner's thread) ---

pub fn onDNSResolved(this: *SocksDNSPending) void {
    const req = this.dns_request;
    defer {
        dns.internal.freeaddrinfo(req, 0);
        bun.destroy(this);
    }

    // Check cancelled BEFORE touching owner
    if (this.cancelled.load(.acquire)) {
        this.releaseWsRef();
        return;
    }

    const result = req.result orelse {
        this.failOwner(error.DNSLookupFailed);
        return;
    };
    if (result.err != 0 or result.info == null) {
        this.failOwner(error.DNSLookupFailed);
        return;
    }

    switch (this.owner) {
        .ws_non_tls => |client| {
            defer client.deref();
            client.continueSocksAfterDNSRequest(req);
            return;
        },
        .ws_tls => |client| {
            defer client.deref();
            client.continueSocksAfterDNSRequest(req);
            return;
        },
        .http => {},
    }

    // HTTP SOCKS currently resumes with the first address, matching the
    // surrounding HTTP client path. WebSocket keeps the full list for fallback.
    const entry = &result.info.?[0];
    const address = addrFromSockaddr(&entry.addr) catch {
        this.failOwner(error.DNSLookupFailed);
        return;
    };

    switch (this.owner) {
        .http => |http_owner| this.resumeHTTP(http_owner, address),
        .ws_non_tls, .ws_tls => unreachable,
    }
}

fn getTargetPort(this: *const SocksDNSPending) u16 {
    return switch (this.owner) {
        .http => |h| h.target_port,
        // WS owners store target port in proxy state
        .ws_non_tls => |client| if (client.proxy) |*p| p.target_port else 0,
        .ws_tls => |client| if (client.proxy) |*p| p.target_port else 0,
    };
}

fn resumeHTTP(this: *SocksDNSPending, http_owner: HTTPOwner, address: std.net.Address) void {
    _ = this;
    // Generation check: is the HTTPClient still alive?
    const any_socket = bun.http.socket_async_http_abort_tracker.get(
        http_owner.async_http_id,
    ) orelse return;

    // Extract HTTPClient from socket ext via ActiveSocket tagged pointer
    switch (any_socket) {
        inline .SocketTLS, .SocketTCP => |socket, tag| {
            const is_tls = tag == .SocketTLS;
            const HTTPContext = bun.http.NewHTTPContext(is_tls);
            const tagged = HTTPContext.getTaggedFromSocket(socket);
            const client = tagged.get(bun.http) orelse return;
            // Defense-in-depth: verify same request
            if (client.async_http_id != http_owner.async_http_id) return;
            client.socks_dns_pending = null;
            client.completeSocksWithAddress(is_tls, socket, address, http_owner.target_port);
        },
    }
}

fn failOwner(this: *SocksDNSPending, err: anyerror) void {
    switch (this.owner) {
        .http => |http_owner| {
            const any_socket = bun.http.socket_async_http_abort_tracker.get(
                http_owner.async_http_id,
            ) orelse return;
            switch (any_socket) {
                inline .SocketTLS, .SocketTCP => |socket, tag| {
                    const is_tls = tag == .SocketTLS;
                    const HTTPContext = bun.http.NewHTTPContext(is_tls);
                    const tagged = HTTPContext.getTaggedFromSocket(socket);
                    const client = tagged.get(bun.http) orelse return;
                    if (client.async_http_id != http_owner.async_http_id) return;
                    client.socks_dns_pending = null;
                    client.closeAndFail(err, is_tls, socket);
                },
            }
        },
        .ws_non_tls => |client| {
            defer client.deref();
            client.terminate(.proxy_tunnel_failed);
        },
        .ws_tls => |client| {
            defer client.deref();
            client.terminate(.proxy_tunnel_failed);
        },
    }
}

fn releaseWsRef(this: *SocksDNSPending) void {
    switch (this.owner) {
        .ws_non_tls => |client| client.deref(),
        .ws_tls => |client| client.deref(),
        .http => {},
    }
}

/// Owner calls this to signal cancellation. Does NOT destroy pending.
pub fn markCancelled(this: *SocksDNSPending) void {
    this.cancelled.store(true, .release);
}

// --- Addr conversion helper ---

pub fn addrFromSockaddr(storage: *const std.c.sockaddr.storage) !std.net.Address {
    const family = storage.family;
    if (family == std.posix.AF.INET) {
        const addr_in: *const std.c.sockaddr.in = @ptrCast(@alignCast(storage));
        return std.net.Address{ .in = .{ .sa = addr_in.* } };
    } else if (family == std.posix.AF.INET6) {
        const addr_in6: *const std.c.sockaddr.in6 = @ptrCast(@alignCast(storage));
        return std.net.Address{ .in6 = .{ .sa = addr_in6.* } };
    }
    return error.SocksAddressTypeNotSupported;
}

// --- Module-level state ---

var resolved_mutex: bun.Mutex = .{};
var resolved_head: ?*SocksDNSPending = null;

// --- Imports ---

const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const dns = bun.dns;
const NewHTTPUpgradeClient = @import("../http_jsc/websocket_client/WebSocketUpgradeClient.zig").NewHTTPUpgradeClient;
const WsUpgradeClientNonTLS = NewHTTPUpgradeClient(false);
const WsUpgradeClientTLS = NewHTTPUpgradeClient(true);
