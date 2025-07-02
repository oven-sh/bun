const ProcessAutoKiller = @This();
const log = bun.Output.scoped(.AutoKiller, true);
const bun = @import("bun");
const std = @import("std");

processes: std.AutoArrayHashMapUnmanaged(*bun.spawn.Process, void) = .{},
enabled: bool = false,
ever_enabled: bool = false,

pub fn enable(this: *ProcessAutoKiller) void {
    this.enabled = true;
    this.ever_enabled = true;
}

pub fn disable(this: *ProcessAutoKiller) void {
    this.enabled = false;
}

pub const Result = struct {
    processes: u32 = 0,

    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        switch (self.processes) {
            0 => {},
            1 => {
                try writer.writeAll("killed 1 dangling process");
            },
            else => {
                try std.fmt.format(writer, "killed {d} dangling processes", .{self.processes});
            },
        }
    }
};

pub fn kill(this: *ProcessAutoKiller) Result {
    return .{
        .processes = this.killProcesses(),
    };
}

fn killProcesses(this: *ProcessAutoKiller) u32 {
    var count: u32 = 0;
    while (this.processes.pop()) |process| {
        defer process.key.deref();
        if (!process.key.hasExited()) {
            log("process.kill {d}", .{process.key.pid});
            count += @as(u32, @intFromBool(process.key.kill(@intFromEnum(bun.SignalCode.default)) == .result));
        }
    }
    return count;
}

pub fn clear(this: *ProcessAutoKiller) void {
    for (this.processes.keys()) |process| {
        process.deref();
    }

    if (this.processes.capacity() > 256) {
        this.processes.clearAndFree(bun.default_allocator);
    }

    this.processes.clearRetainingCapacity();
}

pub fn onSubprocessSpawn(this: *ProcessAutoKiller, process: *bun.spawn.Process) void {
    if (this.enabled) {
        this.processes.put(bun.default_allocator, process, {}) catch return;
        process.ref();
    }
}

pub fn onSubprocessExit(this: *ProcessAutoKiller, process: *bun.spawn.Process) void {
    if (this.ever_enabled) {
        if (this.processes.swapRemove(process)) {
            process.deref();
        }
    }
}

pub fn deinit(this: *ProcessAutoKiller) void {
    for (this.processes.keys()) |process| {
        process.deref();
    }
    this.processes.deinit(bun.default_allocator);
}
