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

/// Single-thread in this pool
pool: ThreadPool,

pub var global: NetworkThread = undefined;
pub var global_loaded: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

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
    global.pool.forceSpawn();
}

pub fn init() !void {
    if ((global_loaded.swap(1, .Monotonic)) == 1) return;
    AsyncIO.global_loaded = true;

    global = NetworkThread{
        .pool = ThreadPool.init(.{ .max_threads = 1, .stack_size = 64 * 1024 * 1024 }),
    };
    global.pool.on_thread_spawn = HTTP.onThreadStart;
}
