const std = @import("std");
const unistd = @cImport(@cInclude("unistd.h"));

pub fn main() void {
    //var name: [32]u8 = undefined;
    //var length = name.len - 1;
    //var oo = std.c.sysctlbyname("kernel.hostname", &name, &length, null, 0);
    //std.debug.print("a {any}, {s}", .{ oo, name });
    std.debug.print("aaaa yee {any}", .{info});
}
