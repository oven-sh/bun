const std = @import("std");

const Timer = @This();

begin: i128 = 0,
elapsed: i128 = 0,

pub fn start(timer: *Timer) void {
    timer.begin = std.time.nanoTimestamp();
}

pub fn stop(timer: *Timer) void {
    timer.elapsed = std.time.nanoTimestamp() - timer.begin;
}

pub fn seconds(timer: *const Timer) f64 {
    return @intToFloat(f64, timer.elapsed) / std.time.ns_per_s;
}

pub const Group = struct {};
