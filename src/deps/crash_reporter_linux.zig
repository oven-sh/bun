const std = @import("std");

pub fn start(_: anytype) bool {
    std.debug.attachSegfaultHandler();
    return true;
}

pub fn generate() void {}

pub fn crashReportPath(_: *[1024]u8) []const u8 {
    return "";
}
