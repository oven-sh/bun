pub fn write(data: []const u8) void {
    debug("SocketMonitor: write {x}", .{data});
    if (comptime bun.Environment.isDebug) {
        DebugSocketMonitorWriter.check.call();
        if (DebugSocketMonitorWriter.enabled) {
            DebugSocketMonitorWriter.write(data);
        }
    }
}

pub fn read(data: []const u8) void {
    debug("SocketMonitor: read {x}", .{data});
    if (comptime bun.Environment.isDebug) {
        DebugSocketMonitorReader.check.call();
        if (DebugSocketMonitorReader.enabled) {
            DebugSocketMonitorReader.write(data);
        }
    }
}

const debug = bun.Output.scoped(.SocketMonitor, .visible);

const DebugSocketMonitorReader = @import("./DebugSocketMonitorReader.zig");
const DebugSocketMonitorWriter = @import("./DebugSocketMonitorWriter.zig");
const bun = @import("bun");
