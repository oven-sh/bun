// @sortImports

const DebugSocketMonitorReader = @This();

var file: std.fs.File = undefined;
pub var enabled = false;
pub var check = std.once(load);

pub fn load() void {
    if (bun.getenvZAnyCase("BUN_POSTGRES_SOCKET_MONITOR_READER")) |monitor| {
        enabled = true;
        file = std.fs.cwd().createFile(monitor, .{ .truncate = true }) catch {
            enabled = false;
            return;
        };
        debug("duplicating reads to {s}", .{monitor});
    }
}

pub fn write(data: []const u8) void {
    file.writeAll(data) catch {};
}

const std = @import("std");
const bun = @import("bun");
const debug = bun.Output.scoped(.Postgres, false);
