usingnamespace @import("./global.zig");
const std = @import("std");
const alloc = @import("./alloc.zig");

const opener = switch (std.Target.current.os.tag) {
    .macos => "/usr/bin/open",
    .windows => "start",
    else => "xdg-open",
};

pub fn openURL(url: string) !void {
    if (comptime isWasi) {
        Output.prettyln("-> {s}", .{url});
        Output.flush();
        return;
    }

    var args_buf = [_]string{ opener, url };
    var child_process = try std.ChildProcess.init(&args_buf, alloc.dynamic);
    child_process.stderr_behavior = .Pipe;
    child_process.stdin_behavior = .Ignore;
    child_process.stdout_behavior = .Pipe;
    try child_process.spawn();
    _ = try child_process.wait();
    return;
}

