const std = @import("std");

pub fn main() void {
    var product_version: [32]u8 = undefined;
    var size: usize = product_version.len;

    std.os.sysctlbynameZ(
        "kern.osproductversion",
        &product_version,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        error.UnknownName => unreachable,
        else => unreachable,
    };

    const string_version = product_version[0 .. size - 1 :0];
    std.debug.print("test, {s}", .{string_version});
}
