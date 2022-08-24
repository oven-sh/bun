const std = @import("std");

const loadavgStruct = struct {
    ldavg: [3]c_ulong,
    scale: c_ulong,
};

pub fn main() void {
    var loadavg_: [24]loadavgStruct = undefined;
    var size: usize = loadavg_.len;

    std.os.sysctlbynameZ(
        "vm.loadavg",
        &loadavg_,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        error.UnknownName => unreachable,
        else => unreachable,
    };

    const loadavg = loadavg_[0];
    const scale = @intToFloat(f64, loadavg.scale);
    const avg1 = @intToFloat(f64, loadavg.ldavg[0]) / scale;
    const avg2 = @intToFloat(f64, loadavg.ldavg[1]) / scale;
    const avg3 = @intToFloat(f64, loadavg.ldavg[2]) / scale;
    std.debug.print("test, {s} {s} {s}", .{ avg1, avg2, avg3 });
}
