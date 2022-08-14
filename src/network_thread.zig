const ThreadPool = @import("thread_pool");
pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;
const Node = ThreadPool.Node;
pub const Completion = AsyncIO.Completion;
const std = @import("std");
pub const AsyncIO = @import("io");
const Output = @import("./global.zig").Output;
const IdentityContext = @import("./identity_context.zig").IdentityContext;
const HTTP = @import("./http_client_async.zig");
const NetworkThread = @This();
const Environment = @import("./global.zig").Environment;
const Lock = @import("./lock.zig").Lock;
const FIFO = @import("./io/fifo.zig").FIFO;

/// Single-thread in this pool
pool: ThreadPool,
io: *AsyncIO = undefined,
thread: std.Thread = undefined,
event_fd: std.os.fd_t = 0,
queued_tasks_mutex: Lock = Lock.init(),
queued_tasks: Batch = .{},
head: ?*Node = null,
tail: ?*Node = null,
timer: std.time.Timer = undefined,

pub var global: NetworkThread = undefined;
pub var global_loaded: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

const log = Output.scoped(.NetworkThread, true);

fn queueEvents(this: *@This()) void {
    this.queued_tasks_mutex.lock();
    defer this.queued_tasks_mutex.unlock();
    if (this.queued_tasks.len == 0)
        return;
    log("Received {d} tasks\n", .{this.queued_tasks.len});
    if (this.tail) |tail| {
        std.debug.assert(tail.next == null);
        tail.next = &this.queued_tasks.head.?.node;
        this.tail = &this.queued_tasks.tail.?.node;
    } else {
        this.head = &this.queued_tasks.head.?.node;
        this.tail = &this.queued_tasks.tail.?.node;
    }
    this.queued_tasks = .{};
}

pub fn processEvents(this: *@This()) void {
    processEvents_(this) catch {};
    unreachable;
}
/// Should only be called on the HTTP thread!
fn processEvents_(this: *@This()) !void {
    {
        var bytes: [8]u8 = undefined;
        _ = std.os.read(this.event_fd, &bytes) catch 0;
    }

    while (true) {
        this.queueEvents();

        var count: usize = 0;

        while (this.head) |node| {
            if (node == this.tail) {
                this.tail = null;
            }
            this.head = node.next;
            node.next = null;
            var task = @fieldParentPtr(Task, "node", node);
            var callback = task.callback;
            callback(task);
            if (comptime Environment.allow_assert) {
                count += 1;
            }
        }

        if (comptime Environment.allow_assert) {
            if (count > 0)
                log("Processed {d} tasks\n", .{count});
        }

        var start: i128 = 0;
        if (comptime Environment.isDebug) {
            start = std.time.nanoTimestamp();
        }
        Output.flush();
        this.io.wait(this, queueEvents);
        if (comptime Environment.isDebug) {
            var end = std.time.nanoTimestamp();
            log("Waited {any}\n", .{std.fmt.fmtDurationSigned(@truncate(i64, end - start))});
            Output.flush();
        }
    }
}

pub fn schedule(this: *@This(), batch: Batch) void {
    if (comptime Environment.isLinux) {
        if (batch.len == 0)
            return;

        {
            this.queued_tasks_mutex.lock();
            defer this.queued_tasks_mutex.unlock();
            this.queued_tasks.push(batch);
        }

        const one = @bitCast([8]u8, @as(usize, batch.len));
        _ = std.os.write(this.event_fd, &one) catch @panic("Failed to write to eventfd");
    } else {
        this.pool.schedule(batch);
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
    if (comptime !Environment.isLinux)
        global.pool.forceSpawn();
}

pub fn init() !void {
    if ((global_loaded.swap(1, .Monotonic)) == 1) return;
    AsyncIO.global_loaded = true;

    global = NetworkThread{
        .pool = ThreadPool.init(.{ .max_threads = 1, .stack_size = 64 * 1024 * 1024 }),
        .timer = try std.time.Timer.start(),
    };
    global.pool.on_thread_spawn = HTTP.onThreadStart;
    if (comptime Environment.isLinux) {
        const event_fd = try std.os.eventfd(0, std.os.linux.EFD.CLOEXEC | 0);
        global.event_fd = event_fd;
        global.thread = try std.Thread.spawn(.{ .stack_size = 64 * 1024 * 1024 }, HTTP.onThreadStartNew, .{
            @intCast(std.os.fd_t, event_fd),
        });
        global.thread.detach();
    }
}
