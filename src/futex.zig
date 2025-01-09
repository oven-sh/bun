//! This is a copy-pasta of std.Thread.Futex, except without `unreachable`
//! A mechanism used to block (`wait`) and unblock (`wake`) threads using a
//! 32bit memory address as hints.
//!
//! Blocking a thread is acknowledged only if the 32bit memory address is equal
//! to a given value. This check helps avoid block/unblock deadlocks which
//! occur if a `wake()` happens before a `wait()`.
//!
//! Using Futex, other Thread synchronization primitives can be built which
//! efficiently wait for cross-thread events or signals.

const std = @import("std");
const builtin = @import("builtin");
const Futex = @This();
const windows = std.os.windows;
const linux = std.os.linux;
const c = std.c;
const bun = @import("root").bun;
const assert = bun.assert;
const atomic = std.atomic;

/// Checks if `ptr` still contains the value `expect` and, if so, blocks the caller until either:
/// - The value at `ptr` is no longer equal to `expect`.
/// - The caller is unblocked by a matching `wake()`.
/// - The caller is unblocked spuriously ("at random").
/// - The caller blocks for longer than the given timeout. In which case, `error.Timeout` is returned.
///
/// The checking of `ptr` and `expect`, along with blocking the caller, is done atomically
/// and totally ordered (sequentially consistent) with respect to other wait()/wake() calls on the same `ptr`.
pub fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout_ns: ?u64) error{Timeout}!void {
    @setCold(true);

    // Avoid calling into the OS for no-op timeouts.
    if (timeout_ns) |t| {
        if (t == 0) {
            if (ptr.load(.seq_cst) != expect) return;
            return error.Timeout;
        }
    }

    return Impl.wait(ptr, expect, timeout_ns);
}

pub fn waitForever(ptr: *const atomic.Value(u32), expect: u32) void {
    @setCold(true);

    while (true) {
        Impl.wait(ptr, expect, null) catch |err| switch (err) {
            // Shouldn't happen, but people can override system calls sometimes.
            error.Timeout => continue,
        };
        break;
    }
}

/// Unblocks at most `max_waiters` callers blocked in a `wait()` call on `ptr`.
pub fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
    @setCold(true);

    // Avoid calling into the OS if there's nothing to wake up.
    if (max_waiters == 0) {
        return;
    }

    Impl.wake(ptr, max_waiters);
}

const Impl = if (builtin.os.tag == .windows)
    WindowsImpl
else if (builtin.os.tag.isDarwin())
    DarwinImpl
else if (builtin.os.tag == .linux)
    LinuxImpl
else if (builtin.target.isWasm())
    WasmImpl
else
    UnsupportedImpl;

/// We can't do @compileError() in the `Impl` switch statement above as its eagerly evaluated.
/// So instead, we @compileError() on the methods themselves for platforms which don't support futex.
const UnsupportedImpl = struct {
    fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout: ?u64) error{Timeout}!void {
        return unsupported(.{ ptr, expect, timeout });
    }

    fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
        return unsupported(.{ ptr, max_waiters });
    }

    fn unsupported(_: anytype) noreturn {
        @compileError("Unsupported operating system " ++ @tagName(builtin.target.os.tag));
    }
};

// We use WaitOnAddress through NtDll instead of API-MS-Win-Core-Synch-l1-2-0.dll
// as it's generally already a linked target and is autoloaded into all processes anyway.
const WindowsImpl = struct {
    fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout: ?u64) error{Timeout}!void {
        var timeout_value: windows.LARGE_INTEGER = undefined;
        var timeout_ptr: ?*const windows.LARGE_INTEGER = null;

        // NTDLL functions work with time in units of 100 nanoseconds.
        // Positive values are absolute deadlines while negative values are relative durations.
        if (timeout) |delay| {
            timeout_value = @as(windows.LARGE_INTEGER, @intCast(delay / 100));
            timeout_value = -timeout_value;
            timeout_ptr = &timeout_value;
        }

        const rc = windows.ntdll.RtlWaitOnAddress(
            ptr,
            &expect,
            @sizeOf(@TypeOf(expect)),
            timeout_ptr,
        );

        switch (rc) {
            .SUCCESS => {},
            .TIMEOUT => {
                assert(timeout != null);
                return error.Timeout;
            },
            else => @panic("Unexpected RtlWaitOnAddress() return code"),
        }
    }

    fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
        const address: ?*const anyopaque = ptr;
        assert(max_waiters != 0);

        switch (max_waiters) {
            1 => windows.ntdll.RtlWakeAddressSingle(address),
            else => windows.ntdll.RtlWakeAddressAll(address),
        }
    }
};

const DarwinImpl = struct {
    fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout: ?u64) error{Timeout}!void {
        // Darwin XNU 7195.50.7.100.1 introduced __ulock_wait2 and migrated code paths (notably pthread_cond_t) towards it:
        // https://github.com/apple/darwin-xnu/commit/d4061fb0260b3ed486147341b72468f836ed6c8f#diff-08f993cc40af475663274687b7c326cc6c3031e0db3ac8de7b24624610616be6
        //
        // This XNU version appears to correspond to 11.0.1:
        // https://kernelshaman.blogspot.com/2021/01/building-xnu-for-macos-big-sur-1101.html
        //
        // ulock_wait() uses 32-bit micro-second timeouts where 0 = INFINITE or no-timeout
        // ulock_wait2() uses 64-bit nano-second timeouts (with the same convention)
        const supports_ulock_wait2 = builtin.target.os.version_range.semver.min.major >= 11;

        var timeout_ns: u64 = 0;
        if (timeout) |delay| {
            assert(delay != 0); // handled by timedWait()
            timeout_ns = delay;
        }

        // If we're using `__ulock_wait` and `timeout` is too big to fit inside a `u32` count of
        // micro-seconds (around 70min), we'll request a shorter timeout. This is fine (users
        // should handle spurious wakeups), but we need to remember that we did so, so that
        // we don't return `Timeout` incorrectly. If that happens, we set this variable to
        // true so that we we know to ignore the ETIMEDOUT result.
        var timeout_overflowed = false;

        const addr: *const anyopaque = ptr;
        const flags = c.UL_COMPARE_AND_WAIT | c.ULF_NO_ERRNO;
        const status = blk: {
            if (supports_ulock_wait2) {
                break :blk c.__ulock_wait2(flags, addr, expect, timeout_ns, 0);
            }

            const timeout_us = std.math.cast(u32, timeout_ns / std.time.ns_per_us) orelse overflow: {
                timeout_overflowed = true;
                break :overflow std.math.maxInt(u32);
            };

            break :blk c.__ulock_wait(flags, addr, expect, timeout_us);
        };

        if (status >= 0) return;
        switch (@as(c.E, @enumFromInt(-status))) {
            // Wait was interrupted by the OS or other spurious signalling.
            .INTR => {},
            // Address of the futex was paged out. This is unlikely, but possible in theory, and
            // pthread/libdispatch on darwin bother to handle it. In this case we'll return
            // without waiting, but the caller should retry anyway.
            .FAULT => {},
            // Only report Timeout if we didn't have to cap the timeout
            .TIMEDOUT => {
                assert(timeout != null);
                if (!timeout_overflowed) return error.Timeout;
            },
            else => @panic("Unexpected __ulock_wait() return code"),
        }
    }

    fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
        const default_flags: u32 = c.UL_COMPARE_AND_WAIT | c.ULF_NO_ERRNO;
        const flags: u32 = default_flags | (if (max_waiters > 1) c.ULF_WAKE_ALL else @as(u32, 0));

        while (true) {
            const addr: *const anyopaque = ptr;
            const status = c.__ulock_wake(flags, addr, 0);

            if (status >= 0) return;
            switch (@as(c.E, @enumFromInt(-status))) {
                .INTR => continue, // spurious wake()
                .FAULT => @panic("__ulock_wake() returned EFAULT unexpectedly"), // __ulock_wake doesn't generate EFAULT according to darwin pthread_cond_t
                .NOENT => return, // nothing was woken up
                .ALREADY => @panic("__ulock_wake() returned EALREADY unexpectedly"), // only for ULF_WAKE_THREAD
                else => @panic("Unexpected __ulock_wake() return code"),
            }
        }
    }
};

// https://man7.org/linux/man-pages/man2/futex.2.html
const LinuxImpl = struct {
    fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout: ?u64) error{Timeout}!void {
        const ts: linux.timespec = if (timeout) |timeout_ns|
            .{
                .tv_sec = @intCast(timeout_ns / std.time.ns_per_s),
                .tv_nsec = @intCast(timeout_ns % std.time.ns_per_s),
            }
        else
            undefined;

        const rc = linux.futex_wait(
            @as(*const i32, @ptrCast(&ptr.raw)),
            linux.FUTEX.PRIVATE_FLAG | linux.FUTEX.WAIT,
            @as(i32, @bitCast(expect)),
            if (timeout != null) &ts else null,
        );

        switch (linux.E.init(rc)) {
            .SUCCESS => {}, // notified by `wake()`
            .INTR => {}, // spurious wakeup
            .AGAIN => {}, // ptr.* != expect
            .TIMEDOUT => {
                assert(timeout != null);
                return error.Timeout;
            },
            .INVAL => {}, // possibly timeout overflow
            .FAULT => @panic("futex_wait() returned EFAULT unexpectedly"), // ptr was invalid
            else => |err| bun.Output.panic("Unexpected futex_wait() return code: {d} - {s}", .{ rc, std.enums.tagName(linux.E, err) orelse "unknown" }),
        }
    }

    fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
        const rc = linux.futex_wake(
            @as(*const i32, @ptrCast(&ptr.raw)),
            linux.FUTEX.PRIVATE_FLAG | linux.FUTEX.WAKE,
            std.math.cast(i32, max_waiters) orelse std.math.maxInt(i32),
        );

        switch (linux.E.init(rc)) {
            .SUCCESS => {}, // successful wake up
            .INVAL => {}, // invalid futex_wait() on ptr done elsewhere
            .FAULT => @panic("futex_wake() returned EFAULT unexpectedly"), // pointer became invalid while doing the wake
            else => @panic("Unexpected futex_wake() return code"),
        }
    }
};

const WasmImpl = struct {
    fn wait(ptr: *const atomic.Value(u32), expect: u32, timeout: ?u64) error{Timeout}!void {
        if (!comptime std.Target.wasm.featureSetHas(builtin.target.cpu.features, .atomics)) {
            @compileError("WASI target missing cpu feature 'atomics'");
        }
        const to: i64 = if (timeout) |to| @intCast(to) else -1;
        const result = asm (
            \\local.get %[ptr]
            \\local.get %[expected]
            \\local.get %[timeout]
            \\memory.atomic.wait32 0
            \\local.set %[ret]
            : [ret] "=r" (-> u32),
            : [ptr] "r" (&ptr.raw),
              [expected] "r" (@as(i32, @bitCast(expect))),
              [timeout] "r" (to),
        );
        switch (result) {
            0 => {}, // ok
            1 => {}, // expected =! loaded
            2 => return error.Timeout,
            else => @panic("Unexpected memory.atomic.wait32() return code"),
        }
    }

    fn wake(ptr: *const atomic.Value(u32), max_waiters: u32) void {
        if (!comptime std.Target.wasm.featureSetHas(builtin.target.cpu.features, .atomics)) {
            @compileError("WASI target missing cpu feature 'atomics'");
        }
        assert(max_waiters != 0);
        const woken_count = asm (
            \\local.get %[ptr]
            \\local.get %[waiters]
            \\memory.atomic.notify 0
            \\local.set %[ret]
            : [ret] "=r" (-> u32),
            : [ptr] "r" (&ptr.raw),
              [waiters] "r" (max_waiters),
        );
        _ = woken_count; // can be 0 when linker flag 'shared-memory' is not enabled
    }
};
