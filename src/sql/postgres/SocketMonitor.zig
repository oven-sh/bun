// @sortImports

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

const std = @import("std");
const bun = @import("bun");
const debug = bun.Output.scoped(.Postgres, false);
const DebugSocketMonitorReader = @import("./DebugSocketMonitorReader.zig");
const DebugSocketMonitorWriter = @import("./DebugSocketMonitorWriter.zig");
