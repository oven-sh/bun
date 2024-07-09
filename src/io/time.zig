const std = @import("std");
const bun = @import("root").bun;
const assert = bun.assert;
const is_darwin = @import("builtin").target.isDarwin();

pub const Time = struct {
    const Self = @This();

    /// Hardware and/or software bugs can mean that the monotonic clock may regress.
    /// One example (of many): https://bugzilla.redhat.com/show_bug.cgi?id=448449
    /// We crash the process for safety if this ever happens, to protect against infinite loops.
    /// It's better to crash and come back with a valid monotonic clock than get stuck forever.
    monotonic_guard: u64 = 0,

    /// A timestamp to measure elapsed time, meaningful only on the same system, not across reboots.
    /// Always use a monotonic timestamp if the goal is to measure elapsed time.
    /// This clock is not affected by discontinuous jumps in the system time, for example if the
    /// system administrator manually changes the clock.
    pub fn monotonic(self: *Self) u64 {
        const m = blk: {
            // Uses mach_continuous_time() instead of mach_absolute_time() as it counts while suspended.
            // https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time
            // https://opensource.apple.com/source/Libc/Libc-1158.1.2/gen/clock_gettime.c.auto.html
            if (is_darwin) {
                const darwin = struct {
                    const mach_timebase_info_t = std.posix.darwin.mach_timebase_info_data;
                    extern "c" fn mach_timebase_info(info: *mach_timebase_info_t) std.posix.darwin.kern_return_t;
                    extern "c" fn mach_continuous_time() u64;
                };

                const now = darwin.mach_continuous_time();
                var info: darwin.mach_timebase_info_t = undefined;
                if (darwin.mach_timebase_info(&info) != 0) @panic("mach_timebase_info() failed");
                return (now * info.numer) / info.denom;
            }

            // The true monotonic clock on Linux is not in fact CLOCK_MONOTONIC:
            // CLOCK_MONOTONIC excludes elapsed time while the system is suspended (e.g. VM migration).
            // CLOCK_BOOTTIME is the same as CLOCK_MONOTONIC but includes elapsed time during a suspend.
            // For more detail and why CLOCK_MONOTONIC_RAW is even worse than CLOCK_MONOTONIC,
            // see https://github.com/ziglang/zig/pull/933#discussion_r656021295.
            var ts: std.posix.timespec = undefined;
            std.posix.clock_gettime(std.posix.CLOCK_BOOTTIME, &ts) catch @panic("CLOCK_BOOTTIME required");
            break :blk @as(u64, @intCast(ts.tv_sec)) * std.time.ns_per_s + @as(u64, @intCast(ts.tv_nsec));
        };

        // "Oops!...I Did It Again"
        if (m < self.monotonic_guard) @panic("a hardware/kernel bug regressed the monotonic clock");
        self.monotonic_guard = m;
        return m;
    }

    /// A timestamp to measure real (i.e. wall clock) time, meaningful across systems, and reboots.
    /// This clock is affected by discontinuous jumps in the system time.
    pub fn realtime(_: *Self) i64 {
        // macos has supported clock_gettime() since 10.12:
        // https://opensource.apple.com/source/Libc/Libc-1158.1.2/gen/clock_gettime.3.auto.html

        var ts: std.posix.timespec = undefined;
        std.posix.clock_gettime(std.posix.CLOCK_REALTIME, &ts) catch unreachable;
        return @as(i64, ts.tv_sec) * std.time.ns_per_s + ts.tv_nsec;
    }

    pub fn tick(_: *Self) void {}
};
