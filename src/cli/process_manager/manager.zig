const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const Environment = bun.Environment;
const Protocol = @import("./protocol.zig");
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const SpawnResult = bun.spawn.SpawnResult;
const Subprocess = bun.jsc.Subprocess;

pub const ProcessManager = struct {
    allocator: std.mem.Allocator,
    loop: *uws.Loop,
    socket_context: *uws.SocketContext,
    listen_socket: *uws.ListenSocket,
    processes: std.StringHashMap(*ManagedProcess),
    workspace_hash: u64,
    log_dir: []const u8,
    socket_path: []const u8,
    active_clients: u32 = 0,

    pub fn init(allocator: std.mem.Allocator, socket_path: []const u8, workspace_hash: u64) !*ProcessManager {
        const loop = uws.Loop.get();

        // Create socket context
        const ctx = uws.SocketContext.createNoSSLContext(loop, @sizeOf(*ProcessManager)) orelse
            return error.SocketContextFailed;

        const self = try allocator.create(ProcessManager);
        self.* = .{
            .allocator = allocator,
            .loop = loop,
            .socket_context = ctx,
            .listen_socket = undefined,
            .processes = std.StringHashMap(*ManagedProcess).init(allocator),
            .workspace_hash = workspace_hash,
            .log_dir = try std.fmt.allocPrint(allocator, "/tmp/bun-logs/{x}", .{workspace_hash}),
            .socket_path = try allocator.dupe(u8, socket_path),
        };

        // Store manager pointer in context extension
        const ctx_ext = ctx.ext(false, *ProcessManager).?;
        ctx_ext.* = self;

        // Create log directory
        const log_dir_z = try allocator.dupeZ(u8, self.log_dir);
        defer allocator.free(log_dir_z);
        _ = bun.sys.mkdir(log_dir_z, 0o755).unwrap() catch {};

        // Listen on Unix socket
        var listen_err: c_int = 0;
        const socket_path_z = try allocator.dupeZ(u8, socket_path);
        defer allocator.free(socket_path_z);

        self.listen_socket = ctx.listenUnix(
            false,
            socket_path_z,
            socket_path.len,
            0,
            @sizeOf(ClientHandler),
            &listen_err,
        ) orelse {
            if (listen_err == @intFromEnum(std.posix.E.ADDRINUSE)) return error.AddressInUse;
            return error.ListenFailed;
        };

        // Configure callbacks
        ctx.onOpen(false, onClientOpen);
        ctx.onData(false, onClientData);
        ctx.onClose(false, onClientClose);
        ctx.onEnd(false, onClientEnd);

        return self;
    }

    pub fn run(self: *ProcessManager) void {
        // CRITICAL: Loop until no processes AND no active clients
        while (self.processes.count() > 0 or self.active_clients > 0) {
            self.loop.tick();
        }

        self.cleanup();
    }

    fn cleanup(self: *ProcessManager) void {
        // Kill remaining processes
        var iter = self.processes.iterator();
        while (iter.next()) |entry| {
            std.posix.kill(entry.value_ptr.*.pid, std.posix.SIG.KILL) catch {};
        }

        self.socket_context.close(false);

        // Remove socket file on macOS
        if (Environment.isMac and !strings.hasPrefix(self.socket_path, "\x00")) {
            _ = bun.sys.unlink(self.socket_path);
        }

        self.allocator.free(self.log_dir);
        self.allocator.free(self.socket_path);
    }

    fn handleCommand(self: *ProcessManager, cmd: Protocol.Command) Protocol.Response {
        return switch (cmd) {
            .start => |s| self.handleStart(s.name, s.script, s.cwd),
            .stop => |s| self.handleStop(s.name),
            .list => self.handleList(),
            .logs => |l| self.handleLogs(l.name),
        };
    }

    fn handleStart(self: *ProcessManager, name: []const u8, script: []const u8, cwd: []const u8) Protocol.Response {
        self.startProcess(name, script, cwd) catch |err| {
            return .{ .err = .{ .message = @errorName(err) } };
        };
        return .{ .success = .{ .message = "Started" } };
    }

    fn handleStop(self: *ProcessManager, name: []const u8) Protocol.Response {
        if (self.processes.get(name)) |proc| {
            std.posix.kill(proc.pid, std.posix.SIG.TERM) catch {};
            return .{ .success = .{ .message = "Stopped" } };
        }
        return .{ .err = .{ .message = "Process not found" } };
    }

    fn handleList(self: *ProcessManager) Protocol.Response {
        var list = std.ArrayList(Protocol.ProcessInfo).init(self.allocator);
        var iter = self.processes.iterator();
        while (iter.next()) |entry| {
            const pid = entry.value_ptr.*.pid;
            list.append(.{
                .name = entry.value_ptr.*.name,
                .pid = pid,
                .script = entry.value_ptr.*.script,
                .uptime = std.time.timestamp() - entry.value_ptr.*.started_at,
            }) catch return .{ .err = .{ .message = "OutOfMemory" } };
        }
        return .{ .process_list = list.toOwnedSlice() catch &.{} };
    }

    fn handleLogs(self: *ProcessManager, name: []const u8) Protocol.Response {
        if (self.processes.contains(name)) {
            const stdout_path = std.fmt.allocPrint(
                self.allocator,
                "{s}/{s}-stdout.log",
                .{ self.log_dir, name },
            ) catch return .{ .err = .{ .message = "OutOfMemory" } };

            const stderr_path = std.fmt.allocPrint(
                self.allocator,
                "{s}/{s}-stderr.log",
                .{ self.log_dir, name },
            ) catch return .{ .err = .{ .message = "OutOfMemory" } };

            return .{ .log_path = .{ .stdout = stdout_path, .stderr = stderr_path } };
        }
        return .{ .err = .{ .message = "Process not found" } };
    }

    fn startProcess(self: *ProcessManager, name: []const u8, script: []const u8, cwd: []const u8) !void {
        if (self.processes.contains(name)) {
            return error.ProcessAlreadyExists;
        }

        // Create log files
        const stdout_path = try std.fmt.allocPrintZ(self.allocator, "{s}/{s}-stdout.log", .{ self.log_dir, name });
        defer self.allocator.free(stdout_path);
        const stderr_path = try std.fmt.allocPrintZ(self.allocator, "{s}/{s}-stderr.log", .{ self.log_dir, name });
        defer self.allocator.free(stderr_path);

        const stdout_fd = try bun.sys.open(
            stdout_path,
            bun.O.WRONLY | bun.O.CREAT | bun.O.APPEND,
            0o644,
        ).unwrap();

        const stderr_fd = try bun.sys.open(
            stderr_path,
            bun.O.WRONLY | bun.O.CREAT | bun.O.APPEND,
            0o644,
        ).unwrap();

        // Build argv
        const bun_exe = try bun.selfExePath();
        var argv = std.ArrayList(?[*:0]const u8).init(self.allocator);
        defer argv.deinit();

        try argv.append(try self.allocator.dupeZ(u8, bun_exe));
        try argv.append(try self.allocator.dupeZ(u8, "run"));
        try argv.append(try self.allocator.dupeZ(u8, script));
        try argv.append(null); // null terminator

        const envp = std.os.environ;

        // Spawn process
        const spawn_options = bun.spawn.SpawnOptions{
            .cwd = cwd,
            .stdin = .ignore,
            .stdout = .{ .pipe = stdout_fd },
            .stderr = .{ .pipe = stderr_fd },
            .detached = false,
            .windows = if (Environment.isWindows) .{
                .loop = bun.jsc.EventLoopHandle.init(self.loop),
            } else undefined,
        };

        const maybe_result = try bun.spawn.spawnProcess(
            &spawn_options,
            @ptrCast(argv.items.ptr),
            @ptrCast(envp),
        );

        const result = try maybe_result.unwrap();

        // Create managed process
        const managed = try self.allocator.create(ManagedProcess);
        managed.* = .{
            .name = try self.allocator.dupe(u8, name),
            .pid = result.pid,
            .log_stdout = stdout_fd,
            .log_stderr = stderr_fd,
            .script = try self.allocator.dupe(u8, script),
            .cwd = try self.allocator.dupe(u8, cwd),
            .started_at = std.time.timestamp(),
            .manager = self,
        };

        // Add to map
        try self.processes.put(try self.allocator.dupe(u8, name), managed);
    }
};

const ManagedProcess = struct {
    name: []const u8,
    pid: std.posix.pid_t,
    log_stdout: bun.FileDescriptor,
    log_stderr: bun.FileDescriptor,
    script: []const u8,
    cwd: []const u8,
    started_at: i64,
    manager: *ProcessManager,
};

const ClientHandler = struct {
    buffer: std.ArrayList(u8),
    manager: *ProcessManager,
};

fn onClientOpen(
    socket: *uws.Socket,
    is_client: i32,
    ip: [*c]u8,
    ip_len: i32,
) callconv(.C) ?*uws.Socket {
    _ = is_client;
    _ = ip;
    _ = ip_len;

    const ctx = socket.context(false);
    const manager = ctx.ext(false, *ProcessManager).?.*;

    manager.active_clients += 1;

    const handler = @as(*ClientHandler, @ptrCast(@alignCast(socket.ext(false))));
    handler.* = .{
        .buffer = std.ArrayList(u8).init(manager.allocator),
        .manager = manager,
    };

    return socket;
}

fn onClientData(
    socket: *uws.Socket,
    data_ptr: [*c]u8,
    data_len: i32,
) callconv(.C) ?*uws.Socket {
    const handler = @as(*ClientHandler, @ptrCast(@alignCast(socket.ext(false))));
    const data = data_ptr[0..@intCast(data_len)];

    handler.buffer.appendSlice(data) catch {
        socket.close(false, .failure);
        return null;
    };

    return socket;
}

fn onClientEnd(
    socket: *uws.Socket,
) callconv(.C) ?*uws.Socket {
    const handler = @as(*ClientHandler, @ptrCast(@alignCast(socket.ext(false))));

    // Parse command
    const cmd = std.json.parseFromSlice(
        Protocol.Command,
        handler.manager.allocator,
        handler.buffer.items,
        .{},
    ) catch {
        socket.close(false, .failure);
        return null;
    };
    defer cmd.deinit();

    // Handle command
    const response = handler.manager.handleCommand(cmd.value);

    // Serialize response
    var response_buf = std.ArrayList(u8).init(handler.manager.allocator);
    defer response_buf.deinit();
    std.json.stringify(response, .{}, response_buf.writer()) catch {
        socket.close(false, .failure);
        return null;
    };

    // Send response
    _ = socket.write(false, response_buf.items);

    // Close
    socket.close(false, .normal);
    return null;
}

fn onClientClose(
    socket: *uws.Socket,
    code: i32,
    reason: ?*anyopaque,
) callconv(.C) ?*uws.Socket {
    _ = code;
    _ = reason;

    const handler = @as(*ClientHandler, @ptrCast(@alignCast(socket.ext(false))));

    handler.manager.active_clients -= 1;
    handler.buffer.deinit();

    return socket;
}

pub fn spawnManager(socket_path: []const u8, workspace_hash: u64, allocator: std.mem.Allocator) !void {
    if (Environment.isWindows) {
        return try spawnManagerWindows(socket_path, workspace_hash, allocator);
    }

    const pid = std.c.fork();

    if (pid < 0) return error.ForkFailed;
    if (pid > 0) return;

    _ = std.os.linux.setsid();

    // Close all FDs except 0,1,2
    const max_fd = if (Environment.isLinux) 1024 else 256;
    var fd: i32 = 3;
    while (fd < max_fd) : (fd += 1) {
        _ = bun.FD.fromNative(fd).close();
    }

    // Redirect stdio to /dev/null
    const null_fd = try bun.sys.open("/dev/null", bun.O.RDWR, 0).unwrap();
    try std.posix.dup2(null_fd.cast(), bun.FD.stdin().cast());
    try std.posix.dup2(null_fd.cast(), bun.FD.stdout().cast());
    try std.posix.dup2(null_fd.cast(), bun.FD.stderr().cast());
    if (null_fd.cast() > 2) _ = null_fd.close();

    // Run manager
    const manager = ProcessManager.init(allocator, socket_path, workspace_hash) catch {
        Global.exit(1);
    };

    manager.run();
    Global.exit(0);
}

fn spawnManagerWindows(socket_path: []const u8, workspace_hash: u64, allocator: std.mem.Allocator) !void {
    // TODO: Windows implementation
    _ = socket_path;
    _ = workspace_hash;
    _ = allocator;
    return error.NotImplemented;
}
