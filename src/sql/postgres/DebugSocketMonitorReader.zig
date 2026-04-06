var file: std.fs.File = undefined;
pub var enabled = false;
pub var check = std.once(load);

pub fn load() void {
    if (bun.env_var.BUN_POSTGRES_SOCKET_MONITOR_READER.get()) |monitor| {
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

const debug = bun.Output.scoped(.Postgres, .visible);

const bun = @import("bun");
const std = @import("std");
