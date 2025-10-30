const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Global = bun.Global;
const Protocol = @import("./protocol.zig");
const strings = bun.strings;
const PosixSpawn = @import("../../bun.js/api/bun/spawn.zig").PosixSpawn;

const pid_t = std.posix.pid_t;
const mode_t = std.posix.mode_t;

pub fn getSocketPath(allocator: std.mem.Allocator, workspace_hash: u64) ![]const u8 {
    if (Environment.isLinux) {
        // Abstract socket (no filesystem path)
        return try std.fmt.allocPrint(allocator, "\x00bun-pm-{x}", .{workspace_hash});
    } else if (Environment.isMac) {
        return try std.fmt.allocPrint(allocator, "/tmp/bun-pm-{x}.sock", .{workspace_hash});
    } else if (Environment.isWindows) {
        return try std.fmt.allocPrint(allocator, "\\\\.\\pipe\\bun-pm-{x}", .{workspace_hash});
    }
    unreachable;
}

pub fn getLogDir(allocator: std.mem.Allocator, workspace_hash: u64) ![]const u8 {
    return try std.fmt.allocPrint(allocator, "/tmp/bun-logs/{x}", .{workspace_hash});
}

const ManagedProcess = struct {
    name: []const u8,
    script: []const u8,
    pid: pid_t,
    start_time: i64,
    stdout_path: []const u8,
    stderr_path: []const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *ManagedProcess) void {
        self.allocator.free(self.name);
        self.allocator.free(self.script);
        self.allocator.free(self.stdout_path);
        self.allocator.free(self.stderr_path);
    }

    pub fn uptime(self: *const ManagedProcess) i64 {
        const now = std.time.timestamp();
        return now - self.start_time;
    }

    pub fn toProcessInfo(self: *const ManagedProcess) Protocol.ProcessInfo {
        return .{
            .name = self.name,
            .pid = self.pid,
            .script = self.script,
            .uptime = self.uptime(),
        };
    }
};

pub const ProcessManager = struct {
    allocator: std.mem.Allocator,
    processes: std.StringHashMap(ManagedProcess),
    log_dir: []const u8,
    workspace_hash: u64,

    pub fn init(allocator: std.mem.Allocator, workspace_hash: u64) !ProcessManager {
        const log_dir = try getLogDir(allocator, workspace_hash);

        // Create log directory if it doesn't exist
        std.fs.makeDirAbsolute(log_dir) catch |err| {
            if (err != error.PathAlreadyExists) {
                return err;
            }
        };

        return ProcessManager{
            .allocator = allocator,
            .processes = std.StringHashMap(ManagedProcess).init(allocator),
            .log_dir = log_dir,
            .workspace_hash = workspace_hash,
        };
    }

    pub fn deinit(self: *ProcessManager) void {
        var it = self.processes.iterator();
        while (it.next()) |entry| {
            var proc = entry.value_ptr;
            proc.deinit();
        }
        self.processes.deinit();
        self.allocator.free(self.log_dir);
    }

    pub fn startProcess(
        self: *ProcessManager,
        name: []const u8,
        script: []const u8,
        cwd: []const u8,
    ) !Protocol.Response {
        // Check if process already exists
        if (self.processes.contains(name)) {
            return Protocol.Response{
                .err = .{ .message = "Process already exists" },
            };
        }

        // Create log file paths
        const stdout_path = try std.fmt.allocPrint(
            self.allocator,
            "{s}/{s}-stdout.log",
            .{ self.log_dir, name },
        );
        errdefer self.allocator.free(stdout_path);

        const stderr_path = try std.fmt.allocPrint(
            self.allocator,
            "{s}/{s}-stderr.log",
            .{ self.log_dir, name },
        );
        errdefer self.allocator.free(stderr_path);

        // Open log files
        const stdout_file = try std.fs.createFileAbsolute(
            stdout_path,
            .{ .truncate = false },
        );
        defer stdout_file.close();

        const stderr_file = try std.fs.createFileAbsolute(
            stderr_path,
            .{ .truncate = false },
        );
        defer stderr_file.close();

        // Build command: [bun, script]
        var argv_list = std.ArrayList([*:0]const u8).init(self.allocator);
        defer argv_list.deinit();

        // Get the current bun executable path
        var exe_buf: bun.PathBuffer = undefined;
        const exe_path = std.fs.selfExePath(&exe_buf) catch bun.selfExePath() catch "/usr/bin/env bun";
        const exe_path_z = try self.allocator.dupeZ(u8, exe_path);
        defer self.allocator.free(exe_path_z);

        try argv_list.append(exe_path_z.ptr);

        const script_z = try self.allocator.dupeZ(u8, script);
        defer self.allocator.free(script_z);
        try argv_list.append(script_z.ptr);
        try argv_list.append(null); // argv must be null-terminated

        // Setup spawn attributes
        var attr = try PosixSpawn.PosixSpawnAttr.init();
        defer attr.deinit();

        // Set detached flag (POSIX_SPAWN_SETSID)
        var flags = try attr.get();
        flags |= bun.C.POSIX_SPAWN_SETSID;
        try attr.set(flags);
        try attr.resetSignals();

        // Setup file actions
        var actions = try PosixSpawn.PosixSpawnActions.init();
        defer actions.deinit();

        // Redirect stdout and stderr to log files
        try actions.dup2(bun.toFD(stdout_file.handle), bun.toFD(1));
        try actions.dup2(bun.toFD(stderr_file.handle), bun.toFD(2));

        // Change directory
        const cwd_z = try self.allocator.dupeZ(u8, cwd);
        defer self.allocator.free(cwd_z);
        try actions.chdir(cwd_z);

        // Get environment
        const envp = std.c.environ;

        // Spawn the process
        var pid: pid_t = undefined;
        const spawn_result = std.c.posix_spawn(
            &pid,
            exe_path_z.ptr,
            &actions.actions,
            &attr.attr,
            @ptrCast(argv_list.items.ptr),
            envp,
        );

        if (spawn_result != 0) {
            self.allocator.free(stdout_path);
            self.allocator.free(stderr_path);
            return Protocol.Response{
                .err = .{ .message = "Failed to spawn process" },
            };
        }

        // Store the managed process
        const managed_process = ManagedProcess{
            .name = try self.allocator.dupe(u8, name),
            .script = try self.allocator.dupe(u8, script),
            .pid = pid,
            .start_time = std.time.timestamp(),
            .stdout_path = stdout_path,
            .stderr_path = stderr_path,
            .allocator = self.allocator,
        };

        try self.processes.put(try self.allocator.dupe(u8, name), managed_process);

        return Protocol.Response{
            .success = .{ .message = "Started" },
        };
    }

    pub fn stopProcess(self: *ProcessManager, name: []const u8) !Protocol.Response {
        const proc = self.processes.get(name) orelse {
            return Protocol.Response{
                .err = .{ .message = "Process not found" },
            };
        };

        // Send SIGTERM to the process
        _ = std.c.kill(proc.pid, std.posix.SIG.TERM);

        // Wait a bit, then force kill if necessary
        std.time.sleep(100 * std.time.ns_per_ms);

        // Check if process is still alive
        var status: c_int = 0;
        const wait_result = std.c.waitpid(proc.pid, &status, std.c.W.NOHANG);

        if (wait_result == 0) {
            // Process still alive, force kill
            _ = std.c.kill(proc.pid, std.posix.SIG.KILL);
            _ = std.c.waitpid(proc.pid, &status, 0);
        }

        // Remove from managed processes
        var removed = self.processes.fetchRemove(name).?;
        removed.value.deinit();
        self.allocator.free(removed.key);

        return Protocol.Response{
            .success = .{ .message = "Stopped" },
        };
    }

    pub fn listProcesses(self: *ProcessManager) !Protocol.Response {
        var list = std.ArrayList(Protocol.ProcessInfo).init(self.allocator);
        errdefer list.deinit();

        var it = self.processes.iterator();
        while (it.next()) |entry| {
            try list.append(entry.value_ptr.toProcessInfo());
        }

        return Protocol.Response{
            .process_list = try list.toOwnedSlice(),
        };
    }

    pub fn getLogPaths(self: *ProcessManager, name: []const u8) !Protocol.Response {
        const proc = self.processes.get(name) orelse {
            return Protocol.Response{
                .err = .{ .message = "Process not found" },
            };
        };

        return Protocol.Response{
            .log_path = .{
                .stdout = proc.stdout_path,
                .stderr = proc.stderr_path,
            },
        };
    }

    pub fn handleCommand(self: *ProcessManager, cmd: Protocol.Command) !Protocol.Response {
        return switch (cmd) {
            .start => |s| try self.startProcess(s.name, s.script, s.cwd),
            .stop => |s| try self.stopProcess(s.name),
            .list => try self.listProcesses(),
            .logs => |l| try self.getLogPaths(l.name),
        };
    }

    pub fn isEmpty(self: *const ProcessManager) bool {
        return self.processes.count() == 0;
    }
};

pub fn spawnManager(socket_path: []const u8, workspace_hash: u64, allocator: std.mem.Allocator) !void {
    if (Environment.isWindows) {
        // Windows doesn't support fork, would need a different approach
        return error.UnsupportedPlatform;
    }

    const pid = try std.posix.fork();

    if (pid == 0) {
        // Child process - become daemon
        // Note: setsid is handled by POSIX_SPAWN_SETSID flag when spawning processes

        // Close stdio
        const dev_null = try std.fs.openFileAbsolute("/dev/null", .{ .mode = .read_write });
        defer dev_null.close();

        try std.posix.dup2(dev_null.handle, 0);
        try std.posix.dup2(dev_null.handle, 1);
        try std.posix.dup2(dev_null.handle, 2);

        // Run the manager
        runManager(socket_path, workspace_hash, allocator) catch |err| {
            // Daemon failed to start
            std.debug.print("Manager daemon failed: {}\n", .{err});
            std.posix.exit(1);
        };

        std.posix.exit(0);
    } else {
        // Parent process - just return
        return;
    }
}

fn runManager(socket_path: []const u8, workspace_hash: u64, allocator: std.mem.Allocator) !void {
    _ = socket_path;
    _ = workspace_hash;
    _ = allocator;

    // This is a simplified version
    // The full implementation would:
    // 1. Create a uws.Loop
    // 2. Create a Unix socket listener
    // 3. Accept client connections
    // 4. Parse JSON commands
    // 5. Handle commands via ProcessManager
    // 6. Send JSON responses
    // 7. Exit when no processes remain

    // For now, this is a placeholder
    // The actual implementation requires deep integration with uws
    // which is complex and beyond the scope of this initial implementation

    return error.NotImplemented;
}
