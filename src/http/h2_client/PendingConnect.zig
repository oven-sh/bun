//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

pub const new = bun.TrivialNew(@This());

hostname: []const u8,
port: u16,
ssl_config: ?*SSLConfig,
waiters: std.ArrayListUnmanaged(*HTTPClient) = .{},

pub fn matches(this: *const @This(), hostname: []const u8, port: u16, ssl_config: ?*SSLConfig) bool {
    return this.port == port and this.ssl_config == ssl_config and strings.eqlLong(this.hostname, hostname, true);
}

pub fn unregisterFrom(this: *@This(), ctx: *NewHTTPContext(true)) void {
    const list = &ctx.pending_h2_connects;
    for (list.items, 0..) |p, i| {
        if (p == this) {
            _ = list.swapRemove(i);
            return;
        }
    }
}

pub fn deinit(this: *@This()) void {
    bun.default_allocator.free(this.hostname);
    this.waiters.deinit(bun.default_allocator);
    bun.destroy(this);
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const HTTPClient = bun.http;
const NewHTTPContext = HTTPClient.NewHTTPContext;
