const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const Environment = bun.Environment;
const Command = @import("../../cli.zig").Command;
const Protocol = @import("./protocol.zig");
const Manager = @import("./manager.zig");
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;

var path_buf: bun.PathBuffer = undefined;

fn getSocketPath(allocator: std.mem.Allocator, cwd: []const u8) ![]const u8 {
    const hash = std.hash.Wyhash.hash(0, cwd);

    if (Environment.isLinux) {
        return try std.fmt.allocPrint(allocator, "\x00bun-pm-{x}", .{hash});
    } else if (Environment.isMac) {
        return try std.fmt.allocPrint(allocator, "/tmp/bun-pm-{x}.sock", .{hash});
    } else if (Environment.isWindows) {
        return try std.fmt.allocPrint(allocator, "\\\\.\\pipe\\bun-pm-{x}", .{hash});
    }
    unreachable;
}

const ClientContext = struct {
    socket: uws.NewSocketHandler(false),
    allocator: std.mem.Allocator,
    response_buffer: std.ArrayList(u8),
    command_to_send: []const u8, // JSON serialized command
    done: bool = false,
    error_occurred: bool = false,

    pub fn onOpen(this: *ClientContext, socket: uws.NewSocketHandler(false)) void {
        _ = socket;
        // CRITICAL: Send command immediately when connected
        _ = this.socket.write(this.command_to_send);

        // Shutdown write side to signal we're done sending
        this.socket.shutdown();
    }

    pub fn onData(this: *ClientContext, socket: uws.NewSocketHandler(false), data: []const u8) void {
        _ = socket;
        // Accumulate response data
        this.response_buffer.appendSlice(data) catch {
            this.error_occurred = true;
            this.socket.close(.failure);
        };
    }

    pub fn onClose(this: *ClientContext, socket: uws.NewSocketHandler(false), code: i32, reason: ?*anyopaque) void {
        _ = socket;
        _ = code;
        _ = reason;
        // Connection closed - we're done
        this.done = true;
    }

    pub fn onEnd(this: *ClientContext, socket: uws.NewSocketHandler(false)) void {
        _ = socket;
        // Server finished sending, close our side
        this.socket.close(.normal);
    }

    pub fn onConnectError(this: *ClientContext, socket: uws.NewSocketHandler(false), code: i32) void {
        _ = socket;
        _ = code;
        this.error_occurred = true;
        this.done = true;
    }

    pub fn onWritable(this: *ClientContext, socket: uws.NewSocketHandler(false)) void {
        _ = this;
        _ = socket;
    }

    pub fn onTimeout(this: *ClientContext, socket: uws.NewSocketHandler(false)) void {
        socket.close(.failure);
        this.error_occurred = true;
    }

    pub fn onLongTimeout(this: *ClientContext, socket: uws.NewSocketHandler(false)) void {
        socket.close(.failure);
        this.error_occurred = true;
    }

    pub fn onHandshake(this: *ClientContext, socket: uws.NewSocketHandler(false), success: i32, verify_error: uws.us_bun_verify_error_t) void {
        _ = this;
        _ = socket;
        _ = success;
        _ = verify_error;
    }
};

fn sendCommandAndWaitForResponse(
    allocator: std.mem.Allocator,
    socket_path: []const u8,
    cmd: Protocol.Command,
) !Protocol.Response {
    // 1. Get event loop
    const loop = uws.Loop.get();

    // 2. Create socket context
    const socket_ctx = uws.SocketContext.createNoSSLContext(loop, @sizeOf(*ClientContext)) orelse
        return error.SocketContextFailed;
    defer socket_ctx.deinit(false);

    // 3. Configure callbacks
    const Socket = uws.NewSocketHandler(false);
    Socket.configure(socket_ctx, true, *ClientContext, ClientContext);

    // 4. Serialize command to JSON
    var cmd_buf = std.ArrayList(u8).init(allocator);
    defer cmd_buf.deinit();
    try std.json.stringify(cmd, .{}, cmd_buf.writer());

    // 5. Create client context
    var client = ClientContext{
        .socket = .{ .socket = .{ .detached = {} } },
        .allocator = allocator,
        .response_buffer = std.ArrayList(u8).init(allocator),
        .command_to_send = cmd_buf.items,
    };
    defer client.response_buffer.deinit();

    // 6. Convert socket path to null-terminated
    const socket_path_z = try allocator.dupeZ(u8, socket_path);
    defer allocator.free(socket_path_z);

    // 7. Connect to Unix socket
    client.socket = Socket.connectUnixAnon(
        socket_path_z,
        socket_ctx,
        &client,
        false,
    ) catch {
        return error.ManagerNotRunning;
    };

    // 8. Run event loop until connection closes
    while (!client.done) {
        loop.tick();
    }

    // 9. Check for errors
    if (client.error_occurred) {
        return error.ConnectionFailed;
    }

    // 10. Parse JSON response
    const parsed = try std.json.parseFromSlice(
        Protocol.Response,
        allocator,
        client.response_buffer.items,
        .{},
    );

    return parsed.value;
}

// Command implementations

pub fn startCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun start [script]", .{});
        Global.exit(1);
    }

    const script_name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);
    const hash = std.hash.Wyhash.hash(0, cwd);

    const cmd = Protocol.Command{
        .start = .{
            .name = script_name,
            .script = script_name,
            .cwd = cwd,
        },
    };

    const response = sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd) catch |err| {
        if (err == error.ManagerNotRunning) {
            // Spawn manager and retry
            try Manager.spawnManager(socket_path, hash, ctx.allocator);
            std.time.sleep(100 * std.time.ns_per_ms);

            const retry_response = try sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd);
            handleResponse(retry_response, script_name);
            return;
        }
        return err;
    };

    handleResponse(response, script_name);
}

pub fn stopCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun stop [name]", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command{ .stop = .{ .name = name } };
    const response = try sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd);

    handleResponse(response, name);
}

pub fn listCommand(ctx: Command.Context) !void {
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command.list;
    const response = sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd) catch |err| {
        if (err == error.ManagerNotRunning) {
            Output.prettyln("No processes running in this workspace", .{});
            return;
        }
        return err;
    };

    switch (response) {
        .process_list => |list| {
            if (list.len == 0) {
                Output.prettyln("No processes running", .{});
                return;
            }

            Output.prettyln("\n<b>NAME{s: <20}PID{s: <10}COMMAND{s: <30}UPTIME<r>", .{ "", "", "" });
            for (list) |proc| {
                const uptime = formatUptime(proc.uptime);
                Output.prettyln("{s: <20}{d: <10}{s: <30}{s}", .{ proc.name, proc.pid, proc.script, uptime });
            }
            Output.prettyln("", .{});
        },
        else => {
            Output.errGeneric("Unexpected response from manager", .{});
            Global.exit(1);
        },
    }
}

pub fn logsCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun logs [name] [-f]", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];

    // Parse -f flag
    const follow = blk: {
        for (ctx.positionals[2..]) |arg| {
            if (strings.eqlComptime(arg, "-f")) break :blk true;
        }
        break :blk false;
    };

    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command{ .logs = .{ .name = name, .follow = follow } };
    const response = try sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd);

    switch (response) {
        .log_path => |paths| {
            if (follow) {
                try tailLogsFollow(paths.stdout, paths.stderr);
            } else {
                try catLogs(paths.stdout, paths.stderr);
            }
        },
        .err => |e| {
            Output.errGeneric("{s}", .{e.message});
            Global.exit(1);
        },
        else => unreachable,
    }
}

fn handleResponse(response: Protocol.Response, name: []const u8) void {
    switch (response) {
        .success => |s| {
            Output.prettyln("<green>✓<r> {s}: <b>{s}<r>", .{ s.message, name });
        },
        .err => |e| {
            Output.errGeneric("{s}", .{e.message});
            Global.exit(1);
        },
        else => {
            Output.errGeneric("Unexpected response", .{});
            Global.exit(1);
        },
    }
}

fn formatUptime(seconds: i64) []const u8 {
    var buf: [32]u8 = undefined;
    if (seconds < 60) {
        return std.fmt.bufPrint(&buf, "{d}s", .{seconds}) catch "?";
    } else if (seconds < 3600) {
        const mins = @divFloor(seconds, 60);
        return std.fmt.bufPrint(&buf, "{d}m", .{mins}) catch "?";
    } else if (seconds < 86400) {
        const hours = @divFloor(seconds, 3600);
        return std.fmt.bufPrint(&buf, "{d}h", .{hours}) catch "?";
    } else {
        const days = @divFloor(seconds, 86400);
        return std.fmt.bufPrint(&buf, "{d}d", .{days}) catch "?";
    }
}

fn catLogs(stdout_path: []const u8, stderr_path: []const u8) !void {
    // Convert paths to zero-terminated
    var stdout_buf: bun.PathBuffer = undefined;
    const stdout_path_z = try std.fmt.bufPrintZ(&stdout_buf, "{s}", .{stdout_path});
    var stderr_buf: bun.PathBuffer = undefined;
    const stderr_path_z = try std.fmt.bufPrintZ(&stderr_buf, "{s}", .{stderr_path});

    // Read and print stdout
    const stdout_file = try bun.sys.open(stdout_path_z, bun.O.RDONLY, 0).unwrap();
    defer _ = stdout_file.close();

    var buf: [4096]u8 = undefined;
    while (true) {
        const n = try bun.sys.read(stdout_file, &buf).unwrap();
        if (n == 0) break;
        try bun.Output.writer().writeAll(buf[0..n]);
    }

    // Read and print stderr
    const stderr_file = try bun.sys.open(stderr_path_z, bun.O.RDONLY, 0).unwrap();
    defer _ = stderr_file.close();

    while (true) {
        const n = try bun.sys.read(stderr_file, &buf).unwrap();
        if (n == 0) break;
        try bun.Output.writer().writeAll(buf[0..n]);
    }
}

fn tailLogsFollow(stdout_path: []const u8, stderr_path: []const u8) !void {
    // Convert paths to zero-terminated
    var stdout_buf: bun.PathBuffer = undefined;
    const stdout_path_z = try std.fmt.bufPrintZ(&stdout_buf, "{s}", .{stdout_path});
    var stderr_buf: bun.PathBuffer = undefined;
    const stderr_path_z = try std.fmt.bufPrintZ(&stderr_buf, "{s}", .{stderr_path});

    // Open files
    const stdout_file = try bun.sys.open(stdout_path_z, bun.O.RDONLY, 0).unwrap();
    defer _ = stdout_file.close();

    const stderr_file = try bun.sys.open(stderr_path_z, bun.O.RDONLY, 0).unwrap();
    defer _ = stderr_file.close();

    // Seek to end
    _ = try bun.sys.lseek(stdout_file, 0, std.posix.SEEK.END).unwrap();
    _ = try bun.sys.lseek(stderr_file, 0, std.posix.SEEK.END).unwrap();

    var buf: [4096]u8 = undefined;

    // Poll for new data
    while (true) {
        // Try stdout
        const n_out = bun.sys.read(stdout_file, &buf).unwrap() catch 0;
        if (n_out > 0) {
            try bun.Output.writer().writeAll(buf[0..n_out]);
        }

        // Try stderr
        const n_err = bun.sys.read(stderr_file, &buf).unwrap() catch 0;
        if (n_err > 0) {
            try bun.Output.writer().writeAll(buf[0..n_err]);
        }

        // Sleep briefly if no new data
        if (n_out == 0 and n_err == 0) {
            std.time.sleep(100 * std.time.ns_per_ms);
        }
    }
}
