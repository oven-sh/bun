const bun = @import("root").bun;
const ThreadPool = bun.ThreadPool;
pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;
const Node = ThreadPool.Node;
pub const Completion = AsyncIO.Completion;
const std = @import("std");
pub const AsyncIO = bun.AsyncIO;
const Output = bun.Output;
const IdentityContext = @import("./identity_context.zig").IdentityContext;
const HTTP = @import("./http_client_async.zig");
const NetworkThread = @This();
const Environment = bun.Environment;
const Lock = @import("./lock.zig").Lock;

/// Single-thread in this pool
io: *AsyncIO = undefined,
thread: std.Thread = undefined,
waker: AsyncIO.Waker = undefined,
queued_tasks_mutex: Lock = Lock.init(),
queued_tasks: Batch = .{},
processing_tasks: Batch = .{},
timer: std.time.Timer = undefined,

pub var global: NetworkThread = undefined;
pub var global_loaded: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

const log = Output.scoped(.NetworkThread, true);
const Global = @import("root").bun.Global;
pub fn onStartIOThread(waker: AsyncIO.Waker) void {
    NetworkThread.address_list_cached = NetworkThread.AddressListCache.init(@import("root").bun.default_allocator);
    AsyncIO.global = AsyncIO.init(1024, 0, waker) catch |err| {
        log: {
            if (comptime Environment.isLinux) {
                if (err == error.SystemOutdated) {
                    Output.prettyErrorln(
                        \\<red>error<r>: Linux kernel version doesn't support io_uring, which Bun depends on. 
                        \\
                        \\ To fix this error: please upgrade to a newer Linux kernel.
                        \\ 
                        \\ If you're using Windows Subsystem for Linux, here's how:
                        \\  1. Open PowerShell as an administrator
                        \\  2. Run this:
                        \\      wsl --update
                        \\      wsl --shutdown
                        \\ 
                        \\ Please make sure you're using WSL version 2 (not WSL 1). To check: wsl -l -v
                        \\ If you are on WSL 1, update to WSL 2 with the following commands:
                        \\  1. wsl --set-default-version 2
                        \\  2. wsl --set-version [distro_name] 2
                        \\  3. Now follow the WSL 2 instructions above.
                        \\     Where [distro_name] is one of the names from the list given by: wsl -l -v
                        \\ 
                        \\ If that doesn't work (and you're on a Windows machine), try this:
                        \\  1. Open Windows Update
                        \\  2. Download any updates to Windows Subsystem for Linux
                        \\ 
                        \\ If you're still having trouble, ask for help in bun's discord https://bun.sh/discord
                    , .{});
                    break :log;
                } else if (err == error.SystemResources) {
                    Output.prettyErrorln(
                        \\<red>error<r>: memlock limit exceeded
                        \\
                        \\To fix this error: <b>please increase the memlock limit<r> or upgrade to Linux kernel 5.11+
                        \\
                        \\If Bun is running inside Docker, make sure to set the memlock limit to unlimited (-1)
                        \\ 
                        \\    docker run --rm --init --ulimit memlock=-1:-1 jarredsumner/bun:edge
                        \\
                        \\To bump the memlock limit, check one of the following:
                        \\    /etc/security/limits.conf
                        \\    /etc/systemd/user.conf
                        \\    /etc/systemd/system.conf
                        \\
                        \\You can also try running bun as root.
                        \\
                        \\If running many copies of Bun via exec or spawn, be sure that O_CLOEXEC is set so
                        \\that resources are not leaked when the child process exits.
                        \\
                        \\Why does this happen?
                        \\
                        \\Bun uses io_uring and io_uring accounts memory it
                        \\needs under the rlimit memlocked option, which can be
                        \\quite low on some setups (64K).
                        \\
                        \\
                    , .{});
                    break :log;
                }
            }

            Output.prettyErrorln("<r><red>error<r>: Failed to initialize network thread: <red><b>{s}<r>.\nHTTP requests will not work. Please file an issue and run strace().", .{@errorName(err)});
        }

        Global.exit(1);
    };
    AsyncIO.global_loaded = true;
    NetworkThread.global.io = &AsyncIO.global;
    Output.Source.configureNamedThread("Async IO");
    NetworkThread.global.processEvents();
}

fn queueEvents(this: *@This()) void {
    this.queued_tasks_mutex.lock();
    defer this.queued_tasks_mutex.unlock();
    if (this.queued_tasks.len == 0)
        return;
    log("Received {d} tasks\n", .{this.queued_tasks.len});
    this.processing_tasks.push(this.queued_tasks);
    this.queued_tasks = .{};
}

pub fn processEvents(this: *@This()) void {
    processEvents_(this) catch {};
    unreachable;
}

/// Should only be called on the HTTP thread!
fn processEvents_(this: *@This()) !void {
    while (true) {
        this.queueEvents();

        var count: usize = 0;

        while (this.processing_tasks.pop()) |task| {
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
            log("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start)))});
            Output.flush();
        }
    }
}

pub fn schedule(this: *@This(), batch: Batch) void {
    if (batch.len == 0)
        return;

    {
        this.queued_tasks_mutex.lock();
        defer this.queued_tasks_mutex.unlock();
        this.queued_tasks.push(batch);
    }

    if (comptime Environment.isLinux) {
        const one = @as([8]u8, @bitCast(@as(usize, batch.len)));
        _ = std.os.write(this.waker.fd, &one) catch @panic("Failed to write to eventfd");
    } else {
        this.waker.wake() catch @panic("Failed to wake");
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
    // const now = @intCast(u64, @max(0, std.time.milliTimestamp()));
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

    global = NetworkThread{
        .timer = try std.time.Timer.start(),
    };

    if (comptime Environment.isLinux) {
        const fd = try std.os.eventfd(0, std.os.linux.EFD.CLOEXEC | 0);
        global.waker = .{ .fd = fd };
    } else if (comptime Environment.isMac) {
        global.waker = try AsyncIO.Waker.init(@import("root").bun.default_allocator);
    } else {
        @compileLog("TODO: Waker");
    }

    global.thread = try std.Thread.spawn(.{ .stack_size = 2 * 1024 * 1024 }, onStartIOThread, .{
        global.waker,
    });
    global.thread.detach();
}
