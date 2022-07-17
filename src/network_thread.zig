const ThreadPool = @import("thread_pool");
pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;
pub const Completion = AsyncIO.Completion;
const std = @import("std");
pub const AsyncIO = @import("io");
const Output = @import("./global.zig").Output;
const IdentityContext = @import("./identity_context.zig").IdentityContext;
const HTTP = @import("./http_client_async.zig");
const NetworkThread = @This();
const Lock = @import("./lock.zig").Lock;

const Port = if (bun.Environment.isLinux) usize else bun.C.darwin.mach_port_t;
pub var global: NetworkThread = undefined;
pub var global_loaded: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);
const bun = @import("./global.zig");
thread: std.Thread = undefined,
lock: Lock = Lock.init(),
pending_batch: ThreadPool.Batch = .{},
current_batch: ThreadPool.Batch = .{},

const log = bun.Output.scoped(.Network, true);

pub fn schedule(_: *@This(), batch: ThreadPool.Batch) void {
    if (batch.len == 0) return;
    init() catch unreachable;

    log("schedule {d}", .{batch.len});
    {
        global.lock.lock();
        global.pending_batch.push(batch);
        global.lock.unlock();
    }
    AsyncIO.global.wake();
}

pub fn scheduleLocal(this: *@This(), batch: ThreadPool.Batch) void {
    if (batch.len == 0) return;
    this.lock.lock();
    defer this.lock.unlock();
    this.pending_batch.push(batch);
}

pub fn loop(port: Port) void {
    HTTP.onThreadStart(port);

    const default_decay = 1000;
    var decay: u63 = default_decay;

    while (true) {
        {
            global.lock.lock();
            global.pending_batch = .{};
            global.lock.unlock();

            const pending = global.pending_batch;
            decay = if (pending.len > 0) default_decay else decay;
            global.current_batch.push(pending);
        }

        while (global.current_batch.pop()) |task| : (AsyncIO.global.tick() catch unreachable) {
            task.callback(task);
        }

        {
            global.lock.lock();
            const pending = global.pending_batch;
            global.pending_batch = .{};
            global.lock.unlock();

            if (pending.len > 0) {
                global.current_batch.push(pending);
                decay = default_decay;
                continue;
            }
            decay *|= 2;
        }

        log("wait({d})", .{decay});
        AsyncIO.global.run_for_ns(decay) catch unreachable;
        log("awoke", .{});
    }
}

const CachedAddressList = struct {
    address_list: *std.net.AddressList,
    expire_after: u64,
    key: u64,
    index: ?u32 = null,
    invalidated: bool = false,
    pub fn hash(name: []const u8, port: u16) u64 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        hasher.update(":");
        hasher.update(std.mem.asBytes(&port));
        return hasher.final();
    }

    pub fn init(key: u64, address_list: *std.net.AddressList, now: u64) CachedAddressList {
        return CachedAddressList{
            .address_list = address_list,
            .expire_after = now + std.time.ms_per_hour,
            .key = key,
        };
    }

    pub fn invalidate(this: *CachedAddressList) void {
        if (!this.invalidated) {
            this.invalidated = true;
            this.address_list.deinit();
        }
        _ = address_list_cached.remove(this.key);
    }
};

pub const AddressListCache = std.HashMap(u64, CachedAddressList, IdentityContext(u64), 80);
pub var address_list_cached: AddressListCache = undefined;
pub fn getAddressList(allocator: std.mem.Allocator, name: []const u8, port: u16) !*std.net.AddressList {
    // const hash = CachedAddressList.hash(name, port);
    // const now = @intCast(u64, @maximum(0, std.time.milliTimestamp()));
    // if (address_list_cached.getPtr(hash)) |cached| {
    //     if (cached.expire_after > now) {
    //         return cached;
    //     }

    //     cached.address_list.deinit();
    // }

    return try std.net.getAddressList(allocator, name, port);
}

pub var has_warmed = false;
pub fn warmup() !void {
    if (has_warmed or global_loaded.load(.Monotonic) > 0) return;
    has_warmed = true;
    try init();
}

pub fn init() !void {
    if ((global_loaded.swap(1, .Monotonic)) == 1) return;
    AsyncIO.global_loaded = true;
    log("init()", .{});

    if (comptime bun.Environment.isMac) {
        const darwin = bun.C.darwin;
        var port: darwin.mach_port = undefined;
        const kr = darwin.mach_port_allocate(darwin.mach_task_self(), darwin.MACH_PORT_RIGHT_RECEIVE, &port);
        if (kr != 0) {
            @panic("mach_port_allocate failed");
        }
        const kr2 = darwin.mach_port_insert_right(darwin.mach_task_self(), port, port, darwin.MACH_MSG_TYPE_MAKE_SEND);
        if (kr2 != 0) {
            @panic("mach_port_insert_right failed");
        }

        global = .{
            .thread = try std.Thread.spawn(.{ .stack_size = 64 * 1024 * 1024 }, loop, .{port}),
        };
    } else {
        global = .{
            .thread = try std.Thread.spawn(.{ .stack_size = 64 * 1024 * 1024 }, loop, .{std.os.linux.eventfd(1, std.os.O.CLOEXEC)}),
        };
    }
}
