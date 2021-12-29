const _global = @import("./global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");

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
    var child_process = try std.ChildProcess.init(&args_buf, default_allocator);
    child_process.stderr_behavior = .Pipe;
    child_process.stdin_behavior = .Ignore;
    child_process.stdout_behavior = .Pipe;
    try child_process.spawn();
    _ = try child_process.wait();
    return;
}
