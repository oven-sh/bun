const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;

pub const timespec = extern struct {
    sec: isize = 0,
    nsec: isize = 0,

    pub fn eql(this: *const timespec, other: *const timespec) bool {
        return this.sec == other.sec and this.nsec == other.nsec;
    }

    pub fn fromMs(milliseconds: u64) timespec {
        return .{
            .sec = @intCast(milliseconds / 1000),
            .nsec = @intCast((milliseconds % 1000) * 1_000_000),
        };
    }

    pub fn toInstant(this: *const timespec) std.time.Instant {
        if (comptime Environment.isPosix) {
            return std.time.Instant{
                .timestamp = @bitCast(this.*),
            };
        }

        if (comptime Environment.isWindows) {
            return std.time.Instant{
                .timestamp = @intCast(this.sec * std.time.ns_per_s + this.nsec),
            };
        }
    }

    // TODO: this is wrong!
    pub fn duration(this: *const timespec, other: *const timespec) timespec {
        // Mimick C wrapping behavior.
        var sec_diff = this.sec -% other.sec;
        var nsec_diff = this.nsec -% other.nsec;

        if (nsec_diff < 0) {
            sec_diff -%= 1;
            nsec_diff +%= std.time.ns_per_s;
        }

        return timespec{
            .sec = sec_diff,
            .nsec = nsec_diff,
        };
    }

    pub fn order(a: *const timespec, b: *const timespec) std.math.Order {
        const sec_order = std.math.order(a.sec, b.sec);
        if (sec_order != .eq) return sec_order;
        return std.math.order(a.nsec, b.nsec);
    }

    /// Returns the nanoseconds of this timer. Note that maxInt(u64) ns is
    /// 584 years so if we get any overflows we just use maxInt(u64). If
    /// any software is running in 584 years waiting on this timer...
    /// shame on me I guess... but I'll be dead.
    pub fn ns(this: *const timespec) u64 {
        if (this.sec <= 0) {
            return @max(this.nsec, 0);
        }

        assert(this.sec >= 0);
        assert(this.nsec >= 0);
        const s_ns = std.math.mul(
            u64,
            @as(u64, @intCast(@max(this.sec, 0))),
            std.time.ns_per_s,
        ) catch return std.math.maxInt(u64);

        return std.math.add(u64, s_ns, @as(u64, @intCast(@max(this.nsec, 0)))) catch
            return std.math.maxInt(i64);
    }

    pub fn nsSigned(this: *const timespec) i64 {
        const ns_per_sec = this.sec *% std.time.ns_per_s;
        const ns_from_nsec = @divFloor(this.nsec, 1_000_000);
        return ns_per_sec +% ns_from_nsec;
    }

    pub fn ms(this: *const timespec) i64 {
        const ms_from_sec = this.sec *% 1000;
        const ms_from_nsec = @divFloor(this.nsec, 1_000_000);
        return ms_from_sec +% ms_from_nsec;
    }

    pub fn msUnsigned(this: *const timespec) u64 {
        return this.ns() / std.time.ns_per_ms;
    }

    pub fn greater(a: *const timespec, b: *const timespec) bool {
        return a.order(b) == .gt;
    }

    pub fn now() timespec {
        return getRoughTickCount();
    }

    pub fn sinceNow(start: *const timespec) u64 {
        return now().duration(start).ns();
    }

    pub fn addMs(this: *const timespec, interval: i64) timespec {
        const sec_inc = @divTrunc(interval, std.time.ms_per_s);
        const nsec_inc = @rem(interval, std.time.ms_per_s) * std.time.ns_per_ms;

        var new_timespec = this.*;

        new_timespec.sec +%= sec_inc;
        new_timespec.nsec +%= nsec_inc;

        if (new_timespec.nsec >= std.time.ns_per_s) {
            new_timespec.sec +%= 1;
            new_timespec.nsec -%= std.time.ns_per_s;
        }

        return new_timespec;
    }

    pub fn msFromNow(interval: i64) timespec {
        return now().addMs(interval);
    }

    pub fn getRoughTickCount() timespec {
        if (comptime Environment.isMac) {
            // https://opensource.apple.com/source/xnu/xnu-2782.30.5/libsyscall/wrappers/mach_approximate_time.c.auto.html
            // https://opensource.apple.com/source/Libc/Libc-1158.1.2/gen/clock_gettime.c.auto.html
            var spec = timespec{
                .nsec = 0,
                .sec = 0,
            };
            const clocky = struct {
                pub var clock_id: std.c.CLOCK = .REALTIME;
                pub fn get() void {
                    var res = timespec{};
                    _ = std.c.clock_getres(.MONOTONIC_RAW_APPROX, @ptrCast(&res));
                    if (res.ms() <= 1) {
                        clock_id = .MONOTONIC_RAW_APPROX;
                    } else {
                        clock_id = .MONOTONIC_RAW;
                    }
                }

                pub var once = std.once(get);
            };
            clocky.once.call();

            // We use this one because we can avoid reading the mach timebase info ourselves.
            _ = std.c.clock_gettime(clocky.clock_id, @ptrCast(&spec));
            return spec;
        }

        if (comptime Environment.isLinux) {
            var spec = timespec{
                .nsec = 0,
                .sec = 0,
            };
            const clocky = struct {
                pub var clock_id: std.os.linux.CLOCK = .REALTIME;
                pub fn get() void {
                    var res = timespec{};
                    std.posix.clock_getres(.MONOTONIC_COARSE, @ptrCast(&res)) catch {};
                    if (res.ms() <= 1) {
                        clock_id = .MONOTONIC_COARSE;
                    } else {
                        clock_id = .MONOTONIC_RAW;
                    }
                }

                pub var once = std.once(get);
            };
            clocky.once.call();
            _ = std.os.linux.clock_gettime(clocky.clock_id, @ptrCast(&spec));
            return spec;
        }

        if (comptime Environment.isWindows) {
            return .fromMs(bun.getRoughTickCountMs());
        }

        return 0;
    }
};
