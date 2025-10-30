const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Protocol = @import("./protocol.zig");
const Global = bun.Global;
const FileSystem = @import("../../fs.zig").FileSystem;

var path_buf: bun.PathBuffer = undefined;
var path_buf2: bun.PathBuffer = undefined;

pub fn getStateDir(allocator: std.mem.Allocator, cwd: []const u8) ![]const u8 {
    const hash = std.hash.Wyhash.hash(0, cwd);

    if (Environment.isLinux or Environment.isMac) {
        return try std.fmt.allocPrint(allocator, "/tmp/bun-pm-{x}", .{hash});
    } else if (Environment.isWindows) {
        const temp = try std.process.getEnvVarOwned(allocator, "TEMP");
        defer allocator.free(temp);
        return try std.fmt.allocPrint(allocator, "{s}\\bun-pm-{x}", .{ temp, hash });
    }
    unreachable;
}

pub fn getLogDir(allocator: std.mem.Allocator, cwd: []const u8) ![]const u8 {
    const hash = std.hash.Wyhash.hash(0, cwd);

    if (Environment.isLinux or Environment.isMac) {
        return try std.fmt.allocPrint(allocator, "/tmp/bun-logs/{x}", .{hash});
    } else if (Environment.isWindows) {
        const temp = try std.process.getEnvVarOwned(allocator, "TEMP");
        defer allocator.free(temp);
        return try std.fmt.allocPrint(allocator, "{s}\\bun-logs\\{x}", .{ temp, hash });
    }
    unreachable;
}

pub const ManagedProcess = struct {
    name: []const u8,
    script: []const u8,
    pid: i32,
    cwd: []const u8,
    start_time: i64,
    stdout_path: []const u8,
    stderr_path: []const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(this: *ManagedProcess) void {
        this.allocator.free(this.name);
        this.allocator.free(this.script);
        this.allocator.free(this.cwd);
        this.allocator.free(this.stdout_path);
        this.allocator.free(this.stderr_path);
    }
};

pub const ProcessManager = struct {
    processes: std.StringHashMap(ManagedProcess),
    allocator: std.mem.Allocator,
    state_dir: []const u8,
    log_dir: []const u8,
    cwd: []const u8,

    pub fn init(allocator: std.mem.Allocator, cwd: []const u8) !*ProcessManager {
        const state_dir = try getStateDir(allocator, cwd);
        const log_dir = try getLogDir(allocator, cwd);

        // Create directories
        std.fs.makeDirAbsolute(state_dir) catch |err| {
            if (err != error.PathAlreadyExists) return err;
        };
        std.fs.makeDirAbsolute(log_dir) catch |err| {
            if (err != error.PathAlreadyExists) return err;
        };

        const manager = try allocator.create(ProcessManager);
        manager.* = .{
            .processes = std.StringHashMap(ManagedProcess).init(allocator),
            .allocator = allocator,
            .state_dir = state_dir,
            .log_dir = log_dir,
            .cwd = try allocator.dupe(u8, cwd),
        };

        // Try to load existing state
        manager.loadState() catch {
            // Ignore errors on first load
        };

        return manager;
    }

    pub fn deinit(this: *ProcessManager) void {
        var it = this.processes.valueIterator();
        while (it.next()) |proc| {
            proc.deinit();
        }
        this.processes.deinit();
        this.allocator.free(this.state_dir);
        this.allocator.free(this.log_dir);
        this.allocator.free(this.cwd);
        this.allocator.destroy(this);
    }

    pub fn startProcess(
        this: *ProcessManager,
        name: []const u8,
        script: []const u8,
        cwd: []const u8,
    ) !void {
        // Check if already running
        if (this.processes.get(name)) |_| {
            return error.ProcessAlreadyExists;
        }

        // Create log files
        const stdout_path = try std.fmt.allocPrint(
            this.allocator,
            "{s}/{s}-stdout.log",
            .{ this.log_dir, name },
        );
        errdefer this.allocator.free(stdout_path);

        const stderr_path = try std.fmt.allocPrint(
            this.allocator,
            "{s}/{s}-stderr.log",
            .{ this.log_dir, name },
        );
        errdefer this.allocator.free(stderr_path);

        // Create/truncate log files
        const stdout_file = try std.fs.createFileAbsolute(stdout_path, .{ .truncate = true });
        stdout_file.close();

        const stderr_file = try std.fs.createFileAbsolute(stderr_path, .{ .truncate = true });
        stderr_file.close();

        // Spawn the process
        const pid = try this.spawnProcess(script, cwd, stdout_path, stderr_path);

        const proc = ManagedProcess{
            .name = try this.allocator.dupe(u8, name),
            .script = try this.allocator.dupe(u8, script),
            .pid = pid,
            .cwd = try this.allocator.dupe(u8, cwd),
            .start_time = std.time.timestamp(),
            .stdout_path = stdout_path,
            .stderr_path = stderr_path,
            .allocator = this.allocator,
        };

        try this.processes.put(proc.name, proc);
        try this.saveState();
    }

    fn spawnProcess(
        this: *ProcessManager,
        script: []const u8,
        cwd: []const u8,
        stdout_path: []const u8,
        stderr_path: []const u8,
    ) !i32 {
        _ = this;

        if (comptime Environment.isWindows) {
            // Windows implementation
            return error.NotImplementedOnWindows;
        }

        // Open log files
        const stdout_fd = try std.posix.open(
            stdout_path,
            .{ .ACCMODE = .WRONLY, .CREAT = true, .APPEND = true },
            0o644,
        );
        errdefer std.posix.close(stdout_fd);

        const stderr_fd = try std.posix.open(
            stderr_path,
            .{ .ACCMODE = .WRONLY, .CREAT = true, .APPEND = true },
            0o644,
        );
        errdefer std.posix.close(stderr_fd);

        // Fork the process
        const pid = try std.posix.fork();

        if (pid == 0) {
            // Child process

            // Redirect stdout and stderr
            std.posix.dup2(stdout_fd, std.posix.STDOUT_FILENO) catch std.process.exit(1);
            std.posix.dup2(stderr_fd, std.posix.STDERR_FILENO) catch std.process.exit(1);

            // Close original file descriptors
            std.posix.close(stdout_fd);
            std.posix.close(stderr_fd);

            // Change directory
            std.posix.chdir(cwd) catch std.process.exit(1);

            // Prepare arguments for bun run
            // We need a null-terminated version of script
            const script_z = std.posix.toPosixPath(script) catch std.process.exit(1);
            const argv = [_:null]?[*:0]const u8{
                "bun",
                "run",
                &script_z,
                null,
            };

            // Get bun path
            const bun_path = bun.selfExePath() catch std.process.exit(1);

            // Execute
            _ = std.posix.execveZ(
                bun_path.ptr,
                @ptrCast(&argv),
                @ptrCast(@extern(*[*:null]const ?[*:0]const u8, .{ .name = "environ" })),
            ) catch std.process.exit(1);

            // If execve returns, it failed
            std.process.exit(1);
        }

        // Parent process
        std.posix.close(stdout_fd);
        std.posix.close(stderr_fd);

        return @intCast(pid);
    }

    pub fn stopProcess(this: *ProcessManager, name: []const u8) !void {
        const proc = this.processes.get(name) orelse return error.ProcessNotFound;

        // Send SIGTERM
        if (comptime !Environment.isWindows) {
            std.posix.kill(@intCast(proc.pid), std.posix.SIG.TERM) catch |err| {
                if (err != error.ProcessNotFound) {
                    return err;
                }
            };
        }

        // Remove from map
        var entry = this.processes.fetchRemove(name).?;
        entry.value.deinit();

        try this.saveState();
    }

    pub fn listProcesses(this: *ProcessManager, allocator: std.mem.Allocator) ![]Protocol.ProcessInfo {
        const list = try allocator.alloc(Protocol.ProcessInfo, this.processes.count());

        var it = this.processes.valueIterator();
        var i: usize = 0;
        while (it.next()) |proc| : (i += 1) {
            const uptime = std.time.timestamp() - proc.start_time;
            list[i] = .{
                .name = proc.name,
                .pid = proc.pid,
                .script = proc.script,
                .uptime = uptime,
            };
        }

        return list;
    }

    pub fn getLogPaths(this: *ProcessManager, name: []const u8) !Protocol.Response {
        const proc = this.processes.get(name) orelse return error.ProcessNotFound;

        return Protocol.Response{
            .log_path = .{
                .stdout = proc.stdout_path,
                .stderr = proc.stderr_path,
            },
        };
    }

    fn saveState(this: *ProcessManager) !void {
        const state_path = try std.fmt.bufPrint(&path_buf, "{s}/state.json", .{this.state_dir});

        var file = try std.fs.createFileAbsolute(state_path, .{ .truncate = true });
        defer file.close();

        var buffered_writer = std.io.bufferedWriter(file.writer());
        const writer = buffered_writer.writer();

        try writer.writeAll("{\n  \"processes\": [\n");

        var it = this.processes.valueIterator();
        var first = true;
        while (it.next()) |proc| {
            if (!first) {
                try writer.writeAll(",\n");
            }
            first = false;

            try writer.writeAll("    {\n");
            try std.json.stringify(.{
                .name = proc.name,
                .script = proc.script,
                .pid = proc.pid,
                .cwd = proc.cwd,
                .start_time = proc.start_time,
                .stdout_path = proc.stdout_path,
                .stderr_path = proc.stderr_path,
            }, .{}, writer);
            try writer.writeAll("\n    }");
        }

        try writer.writeAll("\n  ]\n}\n");
        try buffered_writer.flush();
    }

    fn loadState(this: *ProcessManager) !void {
        const state_path = try std.fmt.bufPrint(&path_buf, "{s}/state.json", .{this.state_dir});

        const file = std.fs.openFileAbsolute(state_path, .{}) catch |err| {
            if (err == error.FileNotFound) return;
            return err;
        };
        defer file.close();

        const contents = try file.readToEndAlloc(this.allocator, 1024 * 1024);
        defer this.allocator.free(contents);

        const State = struct {
            processes: []struct {
                name: []const u8,
                script: []const u8,
                pid: i32,
                cwd: []const u8,
                start_time: i64,
                stdout_path: []const u8,
                stderr_path: []const u8,
            },
        };

        const parsed = try std.json.parseFromSlice(State, this.allocator, contents, .{});
        defer parsed.deinit();

        // Verify each process is still running
        for (parsed.value.processes) |proc_data| {
            const is_running = blk: {
                if (comptime Environment.isWindows) {
                    break :blk false;
                } else {
                    // Check if process exists by sending signal 0
                    std.posix.kill(@intCast(proc_data.pid), 0) catch {
                        break :blk false;
                    };
                    break :blk true;
                }
            };

            if (is_running) {
                const proc = ManagedProcess{
                    .name = try this.allocator.dupe(u8, proc_data.name),
                    .script = try this.allocator.dupe(u8, proc_data.script),
                    .pid = proc_data.pid,
                    .cwd = try this.allocator.dupe(u8, proc_data.cwd),
                    .start_time = proc_data.start_time,
                    .stdout_path = try this.allocator.dupe(u8, proc_data.stdout_path),
                    .stderr_path = try this.allocator.dupe(u8, proc_data.stderr_path),
                    .allocator = this.allocator,
                };
                try this.processes.put(proc.name, proc);
            }
        }
    }

    pub fn cleanup(this: *ProcessManager) !void {
        // Clean up dead processes
        var to_remove = std.ArrayList([]const u8).init(this.allocator);
        defer to_remove.deinit();

        var it = this.processes.iterator();
        while (it.next()) |entry| {
            const is_running = blk: {
                if (comptime Environment.isWindows) {
                    break :blk false;
                } else {
                    std.posix.kill(@intCast(entry.value_ptr.pid), 0) catch {
                        break :blk false;
                    };
                    break :blk true;
                }
            };

            if (!is_running) {
                try to_remove.append(entry.key_ptr.*);
            }
        }

        for (to_remove.items) |name| {
            var entry = this.processes.fetchRemove(name).?;
            entry.value.deinit();
        }

        if (to_remove.items.len > 0) {
            try this.saveState();
        }
    }
};
