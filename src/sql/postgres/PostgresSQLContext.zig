tcp: ?*uws.SocketContext = null,

onQueryResolveFn: jsc.Strong.Optional = .empty,
onQueryRejectFn: jsc.Strong.Optional = .empty,

/// Orphaned connections available for reuse (e.g., after hot reload).
orphaned_connections: std.ArrayListUnmanaged(*PostgresSQLConnection) = .{},
orphan_mutex: bun.Mutex = .{},

pub fn registerOrphan(this: *@This(), conn: *PostgresSQLConnection) void {
    this.orphan_mutex.lock();
    defer this.orphan_mutex.unlock();
    this.orphaned_connections.append(bun.default_allocator, conn) catch {};
}

/// Returns a connected orphan with matching config, or null. Cleans up disconnected orphans.
pub fn claimOrphan(this: *@This(), config_hash: u64) ?*PostgresSQLConnection {
    this.orphan_mutex.lock();
    defer this.orphan_mutex.unlock();

    var i: usize = 0;
    while (i < this.orphaned_connections.items.len) {
        const conn = this.orphaned_connections.items[i];

        if (conn.status != .connected or conn.socket.isClosed()) {
            _ = this.orphaned_connections.swapRemove(i);
            continue; // swapRemove moves last element here, don't increment
        }

        if (conn.config_hash == config_hash) {
            _ = this.orphaned_connections.swapRemove(i);
            return conn;
        }

        i += 1;
    }
    return null;
}

pub fn unregisterOrphan(this: *@This(), conn: *PostgresSQLConnection) void {
    this.orphan_mutex.lock();
    defer this.orphan_mutex.unlock();

    for (this.orphaned_connections.items, 0..) |existing, i| {
        if (existing == conn) {
            _ = this.orphaned_connections.swapRemove(i);
            return;
        }
    }
}

pub fn deinitOrphans(this: *@This()) void {
    this.orphan_mutex.lock();
    defer this.orphan_mutex.unlock();
    this.orphaned_connections.deinit(bun.default_allocator);
}

pub fn init(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var ctx = &globalObject.bunVM().rareData().postgresql_context;
    ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
    ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

    return .js_undefined;
}

comptime {
    const js_init = jsc.toJSHostFn(init);
    @export(&js_init, .{ .name = "PostgresSQLContext__init" });
}

const bun = @import("bun");
const std = @import("std");
const jsc = bun.jsc;
const uws = bun.uws;
const PostgresSQLConnection = @import("PostgresSQLConnection.zig");
