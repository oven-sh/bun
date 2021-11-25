const ThreadPool = @import("../thread_pool.zig");
const Batch = ThreadPool.Batch;
const std = @import("std");
const AsyncIO = @import("io");

const NetworkThread = @This();

/// Single-thread in this pool
pool: ThreadPool,

pub var global: NetworkThread = undefined;
pub var global_loaded: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

pub fn init() !void {
    if ((global_loaded.swap(1, .Monotonic)) == 1) return;
    AsyncIO.global_loaded = true;
    AsyncIO.global = try AsyncIO.init(1024, 0);

    global = NetworkThread{
        .pool = ThreadPool.init(.{ .max_threads = 1, .stack_size = 64 * 1024 * 1024 }),
    };

    global.pool.io = &AsyncIO.global;
}
