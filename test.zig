const std = @import("std");

fn getErrnoConstants(comptime name: []const u8) comptime_int {
    return if (@hasField(std.os.E, name))
        return @enumToInt(@field(std.os.E, name))
    else
        return 0;
}

pub fn main() void {
    std.debug.print(
        "hello, {}",
        .{getErrnoConstants("2BIG")},
    );
}
