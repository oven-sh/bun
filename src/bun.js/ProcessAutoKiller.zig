const ProcessAutoKiller = @This();

const log = bun.Output.scoped(.AutoKiller, .hidden);

processes: std.AutoArrayHashMapUnmanaged(*bun.spawn.Process, ProcessInfo) = .{},
enabled: bool = false,
ever_enabled: bool = false,

pub const ProcessInfo = struct {
    command: ?[]const u8 = null,

    fn deinit(this: *ProcessInfo) void {
        if (this.command) |cmd| {
            bun.default_allocator.free(cmd);
            this.command = null;
        }
    }
};

pub fn enable(this: *ProcessAutoKiller) void {
    this.enabled = true;
    this.ever_enabled = true;
}

pub fn disable(this: *ProcessAutoKiller) void {
    this.enabled = false;
}

pub const KilledProcess = struct {
    pid: if (bun.Environment.isPosix) std.posix.pid_t else bun.windows.libuv.uv_pid_t,
    command: ?[]const u8,
};

pub const Result = struct {
    processes: u32 = 0,
    killed: bun.BoundedArray(KilledProcess, max_reported) = .{},

    const max_reported = 8;

    /// Free command strings owned by this result.
    pub fn deinit(this: *Result) void {
        for (this.killed.slice()) |*info| {
            if (info.command) |cmd| {
                bun.default_allocator.free(cmd);
                info.command = null;
            }
        }
    }

    pub fn printError(this: *const Result) void {
        if (this.processes == 0) return;
        if (this.killed.len == 1) {
            const info = this.killed.constSlice()[0];
            if (info.command) |cmd| {
                bun.Output.prettyErrorln("<yellow>killed 1 dangling process<r> <d>(pid {d}: {s})<r>", .{ info.pid, cmd });
            } else {
                bun.Output.prettyErrorln("<yellow>killed 1 dangling process<r> <d>(pid {d})<r>", .{info.pid});
            }
        } else {
            bun.Output.prettyErrorln("<yellow>killed {d} dangling processes:<r>", .{this.processes});
            for (this.killed.constSlice()) |info| {
                if (info.command) |cmd| {
                    bun.Output.prettyErrorln("<d>  pid {d}: {s}<r>", .{ info.pid, cmd });
                } else {
                    bun.Output.prettyErrorln("<d>  pid {d}<r>", .{info.pid});
                }
            }
            if (this.processes > this.killed.len) {
                bun.Output.prettyErrorln("<d>  ... and {d} more<r>", .{this.processes - this.killed.len});
            }
        }
    }
};

pub fn kill(this: *ProcessAutoKiller) Result {
    return this.killProcesses();
}

fn killProcesses(this: *ProcessAutoKiller) Result {
    var result = Result{};
    while (this.processes.pop()) |entry| {
        defer entry.key.deref();
        var info = entry.value;
        if (!entry.key.hasExited()) {
            log("process.kill {d}", .{entry.key.pid});
            if (entry.key.kill(@intFromEnum(bun.SignalCode.default)) == .result) {
                result.processes += 1;
                if (result.killed.len < Result.max_reported) {
                    result.killed.appendAssumeCapacity(.{
                        .pid = entry.key.pid,
                        .command = info.command,
                    });
                    info.command = null; // ownership moved into result
                }
            }
        }
        info.deinit(); // free command if ownership was not transferred
    }
    return result;
}

pub fn clear(this: *ProcessAutoKiller) void {
    for (this.processes.keys(), this.processes.values()) |process, *info| {
        process.deref();
        info.deinit();
    }

    if (this.processes.capacity() > 256) {
        this.processes.clearAndFree(bun.default_allocator);
    }

    this.processes.clearRetainingCapacity();
}

pub fn onSubprocessSpawn(this: *ProcessAutoKiller, process: *bun.spawn.Process, command: ?[]const u8) void {
    if (this.enabled) {
        const duped_command: ?[]const u8 = if (command) |cmd|
            bun.handleOom(bun.default_allocator.dupe(u8, cmd))
        else
            null;
        this.processes.put(bun.default_allocator, process, .{ .command = duped_command }) catch {
            if (duped_command) |cmd| bun.default_allocator.free(cmd);
            return;
        };
        process.ref();
    }
}

pub fn onSubprocessExit(this: *ProcessAutoKiller, process: *bun.spawn.Process) void {
    if (this.ever_enabled) {
        if (this.processes.fetchSwapRemove(process)) |entry| {
            var info = entry.value;
            info.deinit();
            process.deref();
        }
    }
}

pub fn deinit(this: *ProcessAutoKiller) void {
    for (this.processes.keys(), this.processes.values()) |process, *info| {
        process.deref();
        info.deinit();
    }
    this.processes.deinit(bun.default_allocator);
}

const bun = @import("bun");
const std = @import("std");
