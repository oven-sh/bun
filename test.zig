const std = @import("std");

fn getSignalsConstant(comptime name: []const u8) comptime_int {
    return if (@hasDecl(std.os.SIG, name))
        return @field(std.os.SIG, name)
    else
        return -1;
}

pub fn main() void {
    std.debug.print(
        "hello, {}, {}",
        .{ std.os.SIG.@"BUS", getSignalsConstant("STKFLT") },
    );
}
