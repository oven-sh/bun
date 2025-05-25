/// On windows, this is what libuv expects
/// On unix it is what the utimens api expects
pub const TimeLike = if (Environment.isWindows) f64 else std.posix.timespec;

// Equivalent to `toUnixTimestamp`
//
// Node.js docs:
// > Values can be either numbers representing Unix epoch time in seconds, Dates, or a numeric string like '123456789.0'.
// > If the value can not be converted to a number, or is NaN, Infinity, or -Infinity, an Error will be thrown.
pub fn fromJS(globalObject: *JSGlobalObject, value: JSValue) ?TimeLike {
    // Number is most common case
    if (value.isNumber()) {
        const seconds = value.asNumber();
        if (std.math.isFinite(seconds)) {
            if (seconds < 0) {
                return fromNow();
            }
            return fromSeconds(seconds);
        }
        return null;
    } else switch (value.jsType()) {
        .JSDate => {
            const milliseconds = value.getUnixTimestamp();
            if (std.math.isFinite(milliseconds)) {
                return fromMilliseconds(milliseconds);
            }
        },
        .String => {
            const seconds = value.coerceToDouble(globalObject);
            if (std.math.isFinite(seconds)) {
                return fromSeconds(seconds);
            }
        },
        else => {},
    }
    return null;
}

fn fromSeconds(seconds: f64) TimeLike {
    if (Environment.isWindows) {
        return seconds;
    }
    return .{
        .sec = @intFromFloat(seconds),
        .nsec = @intFromFloat(@mod(seconds, 1) * std.time.ns_per_s),
    };
}

fn fromMilliseconds(milliseconds: f64) TimeLike {
    if (Environment.isWindows) {
        return milliseconds / 1000.0;
    }

    var sec: f64 = @divFloor(milliseconds, std.time.ms_per_s);
    var nsec: f64 = @mod(milliseconds, std.time.ms_per_s) * std.time.ns_per_ms;

    if (nsec < 0) {
        nsec += std.time.ns_per_s;
        sec -= 1;
    }

    return .{
        .sec = @intFromFloat(sec),
        .nsec = @intFromFloat(nsec),
    };
}

fn fromNow() TimeLike {
    if (Environment.isWindows) {
        const nanos = std.time.nanoTimestamp();
        return @as(TimeLike, @floatFromInt(nanos)) / std.time.ns_per_s;
    }

    // Permissions requirements
    //        To set both file timestamps to the current time (i.e., times is
    //        NULL, or both tv_nsec fields specify UTIME_NOW), either:
    //
    //        •  the caller must have write access to the file;
    //
    //        •  the caller's effective user ID must match the owner of the
    //           file; or
    //
    //        •  the caller must have appropriate privileges.
    //
    //        To make any change other than setting both timestamps to the
    //        current time (i.e., times is not NULL, and neither tv_nsec field
    //        is UTIME_NOW and neither tv_nsec field is UTIME_OMIT), either
    //        condition 2 or 3 above must apply.
    //
    //        If both tv_nsec fields are specified as UTIME_OMIT, then no file
    //        ownership or permission checks are performed, and the file
    //        timestamps are not modified, but other error conditions may still
    return .{
        .sec = 0,
        .nsec = if (Environment.isLinux) std.os.linux.UTIME.NOW else bun.c.UTIME_NOW,
    };
}

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
