const std = @import("std");

pub fn start(_: [*:0]const u8) bool {
    std.debug.attachSegfaultHandler();
}

pub fn generate() void {}

pub fn crashReportPath(_: *[1024]u8) []const u8 {
    return "";
}
