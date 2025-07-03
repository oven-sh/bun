pub fn write(data: []const u8) void {
    if (comptime bun.Environment.isDebug) {
        DebugSocketMonitorWriter.check.call();
        if (DebugSocketMonitorWriter.enabled) {
            DebugSocketMonitorWriter.write(data);
        }
    }
}

pub fn read(data: []const u8) void {
    if (comptime bun.Environment.isDebug) {
        DebugSocketMonitorReader.check.call();
        if (DebugSocketMonitorReader.enabled) {
            DebugSocketMonitorReader.write(data);
        }
    }
}
const DebugSocketMonitorWriter = struct {
    var file: std.fs.File = undefined;
    var enabled = false;
    var check = std.once(load);
    pub fn write(data: []const u8) void {
        file.writeAll(data) catch {};
    }

    fn load() void {
        if (bun.getenvZAnyCase("BUN_POSTGRES_SOCKET_MONITOR")) |monitor| {
            enabled = true;
            file = std.fs.cwd().createFile(monitor, .{ .truncate = true }) catch {
                enabled = false;
                return;
            };
            debug("writing to {s}", .{monitor});
        }
    }
};

const DebugSocketMonitorReader = struct {
    var file: std.fs.File = undefined;
    var enabled = false;
    var check = std.once(load);

    fn load() void {
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
};

const std = @import("std");
const bun = @import("bun");
const debug = bun.Output.scoped(.Postgres, false);
