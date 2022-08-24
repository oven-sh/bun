const std = @import("std");

fn getPriorityConstant(comptime name: []const u8) comptime_int {
    return if (@hasDecl(std.os.dl_phdr_info, name))
        return @field(std.os.PR, name)
    else
        return -1;
}

fn getDlopenConstant(comptime name: []const u8) comptime_int {
    return if (@hasDecl(std.os.system.RTLD, name))
        return @field(std.os.system.RTLD, name)
    else
        return -1;
}

pub fn main() void {
    std.debug.print(
        "hello, {}",
        .{getDlopenConstant("LAZY")},
    );
}
