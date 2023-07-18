//! Futex is a mechanism used to block (`wait`) and unblock (`wake`) threads using a 32bit memory address as hints.
//! Blocking a thread is acknowledged only if the 32bit memory address is equal to a given value.
//! This check helps avoid block/unblock deadlocks which occur if a `wake()` happens before a `wait()`.
//! Using Futex, other Thread synchronization primitives can be built which efficiently wait for cross-thread events or signals.

// This is copy-pasted from Zig's source code to fix an issue with linking on macOS Catalina and earlier.

const std = @import("std");
const builtin = @import("builtin");
const Futex = @This();

const target = builtin.target;
const single_threaded = builtin.single_threaded;

const assert = std.debug.assert;
const testing = std.testing;

const Atomic = std.atomic.Atomic;
const spinLoopHint = std.atomic.spinLoopHint;

/// Checks if `ptr` still contains the value `expect` and, if so, blocks the caller until either:
/// - The value at `ptr` is no longer equal to `expect`.
/// - The caller is unblocked by a matching `wake()`.
/// - The caller is unblocked spuriously by an arbitrary internal signal.
///
/// If `timeout` is provided, and the caller is blocked for longer than `timeout` nanoseconds`, `error.TimedOut` is returned.
///
/// The checking of `ptr` and `expect`, along with blocking the caller, is done atomically
/// and totally ordered (sequentially consistent) with respect to other wait()/wake() calls on the same `ptr`.
pub fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
    if (single_threaded) {
        // check whether the caller should block
        if (ptr.loadUnchecked() != expect) {
            return;
        }

        // There are no other threads which could notify the caller on single_threaded.
        // Therefore a wait() without a timeout would block indefinitely.
        const timeout_ns = timeout orelse {
            @panic("deadlock");
        };

        // Simulate blocking with the timeout knowing that:
        // - no other thread can change the ptr value
        // - no other thread could unblock us if we waiting on the ptr
        std.time.sleep(timeout_ns);
        return error.TimedOut;
    }

    // Avoid calling into the OS for no-op waits()
    if (timeout) |timeout_ns| {
        if (timeout_ns == 0) {
            if (ptr.load(.SeqCst) != expect) return;
            return error.TimedOut;
        }
    }

    return OsFutex.wait(ptr, expect, timeout);
}

/// Unblocks at most `num_waiters` callers blocked in a `wait()` call on `ptr`.
/// `num_waiters` of 1 unblocks at most one `wait(ptr, ...)` and `maxInt(u32)` unblocks effectively all `wait(ptr, ...)`.
pub fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
    if (single_threaded) return;
    if (num_waiters == 0) return;

    return OsFutex.wake(ptr, num_waiters);
}

const OsFutex = if (target.os.tag == .windows)
    WindowsFutex
else if (target.os.tag == .linux)
    LinuxFutex
else if (target.isDarwin())
    DarwinFutex
else if (builtin.link_libc)
    PosixFutex
else
    UnsupportedFutex;

const UnsupportedFutex = struct {
    fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
        return unsupported(.{ ptr, expect, timeout });
    }

    fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
        return unsupported(.{ ptr, num_waiters });
    }

    fn unsupported(unused: anytype) noreturn {
        @compileLog("Unsupported operating system", target.os.tag);
        _ = unused;
        unreachable;
    }
};

const WindowsFutex = struct {
    const windows = std.os.windows;

    fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
        var timeout_value: windows.LARGE_INTEGER = undefined;
        var timeout_ptr: ?*const windows.LARGE_INTEGER = null;

        // NTDLL functions work with time in units of 100 nanoseconds.
        // Positive values for timeouts are absolute time while negative is relative.
        if (timeout) |timeout_ns| {
            timeout_ptr = &timeout_value;
            timeout_value = -@as(windows.LARGE_INTEGER, @intCast(timeout_ns / 100));
        }

        switch (windows.ntdll.RtlWaitOnAddress(
            @as(?*const anyopaque, @ptrCast(ptr)),
            @as(?*const anyopaque, @ptrCast(&expect)),
            @sizeOf(@TypeOf(expect)),
            timeout_ptr,
        )) {
            .SUCCESS => {},
            .TIMEOUT => return error.TimedOut,
            else => unreachable,
        }
    }

    fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
        const address = @as(?*const anyopaque, @ptrCast(ptr));
        switch (num_waiters) {
            1 => windows.ntdll.RtlWakeAddressSingle(address),
            else => windows.ntdll.RtlWakeAddressAll(address),
        }
    }
};

const LinuxFutex = struct {
    const linux = std.os.linux;

    fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
        var ts: std.os.timespec = undefined;
        var ts_ptr: ?*std.os.timespec = null;

        // Futex timespec timeout is already in relative time.
        if (timeout) |timeout_ns| {
            ts_ptr = &ts;
            ts.tv_sec = @as(@TypeOf(ts.tv_sec), @intCast(timeout_ns / std.time.ns_per_s));
            ts.tv_nsec = @as(@TypeOf(ts.tv_nsec), @intCast(timeout_ns % std.time.ns_per_s));
        }

        switch (linux.getErrno(linux.futex_wait(
            @as(*const i32, @ptrCast(ptr)),
            linux.FUTEX.PRIVATE_FLAG | linux.FUTEX.WAIT,
            @as(i32, @bitCast(expect)),
            ts_ptr,
        ))) {
            .SUCCESS => {}, // notified by `wake()`
            .INTR => {}, // spurious wakeup
            .AGAIN => {}, // ptr.* != expect
            .TIMEDOUT => return error.TimedOut,
            .INVAL => {}, // possibly timeout overflow
            .FAULT => unreachable,
            else => unreachable,
        }
    }

    fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
        switch (linux.getErrno(linux.futex_wake(
            @as(*const i32, @ptrCast(ptr)),
            linux.FUTEX.PRIVATE_FLAG | linux.FUTEX.WAKE,
            std.math.cast(i32, num_waiters) orelse std.math.maxInt(i32),
        ))) {
            .SUCCESS => {}, // successful wake up
            .INVAL => {}, // invalid futex_wait() on ptr done elsewhere
            .FAULT => {}, // pointer became invalid while doing the wake
            else => unreachable,
        }
    }
};

const DarwinFutex = struct {
    const darwin = std.os.darwin;

    fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
        // Darwin XNU 7195.50.7.100.1 introduced __ulock_wait2 and migrated code paths (notably pthread_cond_t) towards it:
        // https://github.com/apple/darwin-xnu/commit/d4061fb0260b3ed486147341b72468f836ed6c8f#diff-08f993cc40af475663274687b7c326cc6c3031e0db3ac8de7b24624610616be6
        //
        // This XNU version appears to correspond to 11.0.1:
        // https://kernelshaman.blogspot.com/2021/01/building-xnu-for-macos-big-sur-1101.html
        //
        // ulock_wait() uses 32-bit micro-second timeouts where 0 = INFINITE or no-timeout
        // ulock_wait2() uses 64-bit nano-second timeouts (with the same convention)
        var timeout_ns: u64 = 0;
        if (timeout) |timeout_value| {
            // This should be checked by the caller.
            assert(timeout_value != 0);
            timeout_ns = timeout_value;
        }
        const addr = @as(*const anyopaque, @ptrCast(ptr));
        const flags = darwin.UL_COMPARE_AND_WAIT | darwin.ULF_NO_ERRNO;
        // If we're using `__ulock_wait` and `timeout` is too big to fit inside a `u32` count of
        // micro-seconds (around 70min), we'll request a shorter timeout. This is fine (users
        // should handle spurious wakeups), but we need to remember that we did so, so that
        // we don't return `TimedOut` incorrectly. If that happens, we set this variable to
        // true so that we we know to ignore the ETIMEDOUT result.
        var timeout_overflowed = false;
        const status = blk: {
            const timeout_us = cast: {
                const timeout_u32 = std.math.cast(u32, timeout_ns / std.time.ns_per_us);
                timeout_overflowed = timeout_u32 == null;
                break :cast timeout_u32 orelse std.math.maxInt(u32);
            };
            break :blk darwin.__ulock_wait(flags, addr, expect, timeout_us);
        };

        if (status >= 0) return;
        switch (@as(std.os.E, @enumFromInt(-status))) {
            .INTR => {},
            // Address of the futex is paged out. This is unlikely, but possible in theory, and
            // pthread/libdispatch on darwin bother to handle it. In this case we'll return
            // without waiting, but the caller should retry anyway.
            .FAULT => {},
            .TIMEDOUT => if (!timeout_overflowed) return error.TimedOut,
            else => unreachable,
        }
    }

    fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
        var flags: u32 = darwin.UL_COMPARE_AND_WAIT | darwin.ULF_NO_ERRNO;
        if (num_waiters > 1) {
            flags |= darwin.ULF_WAKE_ALL;
        }

        while (true) {
            const addr = @as(*const anyopaque, @ptrCast(ptr));
            const status = darwin.__ulock_wake(flags, addr, 0);

            if (status >= 0) return;
            switch (@as(std.os.E, @enumFromInt(-status))) {
                .INTR => continue, // spurious wake()
                .FAULT => continue, // address of the lock was paged out
                .NOENT => return, // nothing was woken up
                .ALREADY => unreachable, // only for ULF_WAKE_THREAD
                else => unreachable,
            }
        }
    }
};

const PosixFutex = struct {
    fn wait(ptr: *const Atomic(u32), expect: u32, timeout: ?u64) error{TimedOut}!void {
        const address = @intFromPtr(ptr);
        const bucket = Bucket.from(address);
        var waiter: List.Node = undefined;

        {
            assert(std.c.pthread_mutex_lock(&bucket.mutex) == .SUCCESS);
            defer assert(std.c.pthread_mutex_unlock(&bucket.mutex) == .SUCCESS);

            if (ptr.load(.SeqCst) != expect) {
                return;
            }

            waiter.data = .{ .address = address };
            bucket.list.prepend(&waiter);
        }

        var timed_out = false;
        waiter.data.wait(timeout) catch {
            defer if (!timed_out) {
                waiter.data.wait(null) catch unreachable;
            };

            assert(std.c.pthread_mutex_lock(&bucket.mutex) == .SUCCESS);
            defer assert(std.c.pthread_mutex_unlock(&bucket.mutex) == .SUCCESS);

            if (waiter.data.address == address) {
                timed_out = true;
                bucket.list.remove(&waiter);
            }
        };

        waiter.data.deinit();
        if (timed_out) {
            return error.TimedOut;
        }
    }

    fn wake(ptr: *const Atomic(u32), num_waiters: u32) void {
        const address = @intFromPtr(ptr);
        const bucket = Bucket.from(address);
        var can_notify = num_waiters;

        var notified = List{};
        defer while (notified.popFirst()) |waiter| {
            waiter.data.notify();
        };

        assert(std.c.pthread_mutex_lock(&bucket.mutex) == .SUCCESS);
        defer assert(std.c.pthread_mutex_unlock(&bucket.mutex) == .SUCCESS);

        var waiters = bucket.list.first;
        while (waiters) |waiter| {
            assert(waiter.data.address != null);
            waiters = waiter.next;

            if (waiter.data.address != address) continue;
            if (can_notify == 0) break;
            can_notify -= 1;

            bucket.list.remove(waiter);
            waiter.data.address = null;
            notified.prepend(waiter);
        }
    }

    const Bucket = struct {
        mutex: std.c.pthread_mutex_t = .{},
        list: List = .{},

        var buckets = [_]Bucket{.{}} ** 64;

        fn from(address: usize) *Bucket {
            return &buckets[address % buckets.len];
        }
    };

    const List = std.TailQueue(struct {
        address: ?usize,
        state: State = .empty,
        cond: std.c.pthread_cond_t = .{},
        mutex: std.c.pthread_mutex_t = .{},

        const Self = @This();
        const State = enum {
            empty,
            waiting,
            notified,
        };

        fn deinit(self: *Self) void {
            _ = std.c.pthread_cond_destroy(&self.cond);
            _ = std.c.pthread_mutex_destroy(&self.mutex);
        }

        fn wait(self: *Self, timeout: ?u64) error{TimedOut}!void {
            assert(std.c.pthread_mutex_lock(&self.mutex) == .SUCCESS);
            defer assert(std.c.pthread_mutex_unlock(&self.mutex) == .SUCCESS);

            switch (self.state) {
                .empty => self.state = .waiting,
                .waiting => unreachable,
                .notified => return,
            }

            var ts: std.os.timespec = undefined;
            var ts_ptr: ?*const std.os.timespec = null;
            if (timeout) |timeout_ns| {
                ts_ptr = &ts;
                std.os.clock_gettime(std.os.CLOCK_REALTIME, &ts) catch unreachable;
                ts.tv_sec += @as(@TypeOf(ts.tv_sec), @intCast(timeout_ns / std.time.ns_per_s));
                ts.tv_nsec += @as(@TypeOf(ts.tv_nsec), @intCast(timeout_ns % std.time.ns_per_s));
                if (ts.tv_nsec >= std.time.ns_per_s) {
                    ts.tv_sec += 1;
                    ts.tv_nsec -= std.time.ns_per_s;
                }
            }

            while (true) {
                switch (self.state) {
                    .empty => unreachable,
                    .waiting => {},
                    .notified => return,
                }

                const ts_ref = ts_ptr orelse {
                    assert(std.c.pthread_cond_wait(&self.cond, &self.mutex) == .SUCCESS);
                    continue;
                };

                const rc = std.c.pthread_cond_timedwait(&self.cond, &self.mutex, ts_ref);
                switch (rc) {
                    .SUCCESS => {},
                    .TIMEDOUT => {
                        self.state = .empty;
                        return error.TimedOut;
                    },
                    else => unreachable,
                }
            }
        }

        fn notify(self: *Self) void {
            assert(std.c.pthread_mutex_lock(&self.mutex) == .SUCCESS);
            defer assert(std.c.pthread_mutex_unlock(&self.mutex) == .SUCCESS);

            switch (self.state) {
                .empty => self.state = .notified,
                .waiting => {
                    self.state = .notified;
                    assert(std.c.pthread_cond_signal(&self.cond) == .SUCCESS);
                },
                .notified => unreachable,
            }
        }
    });
};

test "Futex - wait/wake" {
    var value = Atomic(u32).init(0);
    Futex.wait(&value, 1, null) catch unreachable;

    const wait_noop_result = Futex.wait(&value, 0, 0);
    try testing.expectError(error.TimedOut, wait_noop_result);

    const wait_longer_result = Futex.wait(&value, 0, std.time.ns_per_ms);
    try testing.expectError(error.TimedOut, wait_longer_result);

    Futex.wake(&value, 0);
    Futex.wake(&value, 1);
    Futex.wake(&value, std.math.maxInt(u32));
}

test "Futex - Signal" {
    if (single_threaded) {
        return error.SkipZigTest;
    }

    const Paddle = struct {
        value: Atomic(u32) = Atomic(u32).init(0),
        current: u32 = 0,

        fn run(self: *@This(), hit_to: *@This()) !void {
            var iterations: usize = 4;
            while (iterations > 0) : (iterations -= 1) {
                var value: u32 = undefined;
                while (true) {
                    value = self.value.load(.Acquire);
                    if (value != self.current) break;
                    Futex.wait(&self.value, self.current, null) catch unreachable;
                }

                try testing.expectEqual(value, self.current + 1);
                self.current = value;

                _ = hit_to.value.fetchAdd(1, .Release);
                Futex.wake(&hit_to.value, 1);
            }
        }
    };

    var ping = Paddle{};
    var pong = Paddle{};

    const t1 = try std.Thread.spawn(.{}, Paddle.run, .{ &ping, &pong });
    defer t1.join();

    const t2 = try std.Thread.spawn(.{}, Paddle.run, .{ &pong, &ping });
    defer t2.join();

    _ = ping.value.fetchAdd(1, .Release);
    Futex.wake(&ping.value, 1);
}

test "Futex - Broadcast" {
    if (single_threaded) {
        return error.SkipZigTest;
    }

    const Context = struct {
        threads: [4]std.Thread = undefined,
        broadcast: Atomic(u32) = Atomic(u32).init(0),
        notified: Atomic(usize) = Atomic(usize).init(0),

        const BROADCAST_EMPTY = 0;
        const BROADCAST_SENT = 1;
        const BROADCAST_RECEIVED = 2;

        fn runSender(self: *@This()) !void {
            self.broadcast.store(BROADCAST_SENT, .Monotonic);
            Futex.wake(&self.broadcast, @as(u32, @intCast(self.threads.len)));

            while (true) {
                const broadcast = self.broadcast.load(.Acquire);
                if (broadcast == BROADCAST_RECEIVED) break;
                try testing.expectEqual(broadcast, BROADCAST_SENT);
                Futex.wait(&self.broadcast, broadcast, null) catch unreachable;
            }
        }

        fn runReceiver(self: *@This()) void {
            while (true) {
                const broadcast = self.broadcast.load(.Acquire);
                if (broadcast == BROADCAST_SENT) break;
                assert(broadcast == BROADCAST_EMPTY);
                Futex.wait(&self.broadcast, broadcast, null) catch unreachable;
            }

            const notified = self.notified.fetchAdd(1, .Monotonic);
            if (notified + 1 == self.threads.len) {
                self.broadcast.store(BROADCAST_RECEIVED, .Release);
                Futex.wake(&self.broadcast, 1);
            }
        }
    };

    var ctx = Context{};
    for (ctx.threads) |*thread|
        thread.* = try std.Thread.spawn(.{}, Context.runReceiver, .{&ctx});
    defer for (ctx.threads) |thread|
        thread.join();

    // Try to wait for the threads to start before running runSender().
    // NOTE: not actually needed for correctness.
    std.time.sleep(16 * std.time.ns_per_ms);
    try ctx.runSender();

    const notified = ctx.notified.load(.Monotonic);
    try testing.expectEqual(notified, ctx.threads.len);
}

test "Futex - Chain" {
    if (single_threaded) {
        return error.SkipZigTest;
    }

    const Signal = struct {
        value: Atomic(u32) = Atomic(u32).init(0),

        fn wait(self: *@This()) void {
            while (true) {
                const value = self.value.load(.Acquire);
                if (value == 1) break;
                assert(value == 0);
                Futex.wait(&self.value, 0, null) catch unreachable;
            }
        }

        fn notify(self: *@This()) void {
            assert(self.value.load(.Unordered) == 0);
            self.value.store(1, .Release);
            Futex.wake(&self.value, 1);
        }
    };

    const Context = struct {
        completed: Signal = .{},
        threads: [4]struct {
            thread: std.Thread,
            signal: Signal,
        } = undefined,

        fn run(self: *@This(), index: usize) void {
            const this_signal = &self.threads[index].signal;

            var next_signal = &self.completed;
            if (index + 1 < self.threads.len) {
                next_signal = &self.threads[index + 1].signal;
            }

            this_signal.wait();
            next_signal.notify();
        }
    };

    var ctx = Context{};
    for (&ctx.threads, 0..) |*entry, index| {
        entry.signal = .{};
        entry.thread = try std.Thread.spawn(.{}, Context.run, .{ &ctx, index });
    }

    ctx.threads[0].signal.notify();
    ctx.completed.wait();

    for (ctx.threads) |entry| {
        entry.thread.join();
    }
}
