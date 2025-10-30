const std = @import("std");
const bun = @import("bun");
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
    return Manager.getSocketPath(allocator, hash);
}

fn sendCommandAndWaitForResponse(
    allocator: std.mem.Allocator,
    socket_path: []const u8,
    cmd: Protocol.Command,
) !Protocol.Response {
    _ = socket_path;
    _ = cmd;
    _ = allocator;

    // This is a simplified version
    // The full implementation would:
    // 1. Connect to Unix socket
    // 2. Send JSON command
    // 3. Receive JSON response
    // 4. Parse and return

    // For now, return a not implemented error
    return error.NotImplemented;
}

pub fn startCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun start SCRIPT", .{});
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
        if (err == error.ManagerNotRunning or err == error.NotImplemented) {
            // For now, just spawn the manager
            // In the full implementation, this would retry after spawning
            try Manager.spawnManager(socket_path, hash, ctx.allocator);
            Output.errGeneric("Process manager started (implementation incomplete)", .{});
            Global.exit(1);
        }
        return err;
    };

    handleResponse(response, script_name);
}

pub fn stopCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun stop NAME", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command{ .stop = .{ .name = name } };
    const response = sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd) catch |err| {
        Output.errGeneric("Failed to connect to process manager: {}", .{err});
        Global.exit(1);
    };

    handleResponse(response, name);
}

pub fn listCommand(ctx: Command.Context) !void {
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command.list;
    const response = sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd) catch |err| {
        if (err == error.ManagerNotRunning or err == error.NotImplemented) {
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

            Output.prettyln("\n<b>NAME{s: <20}PID{s: <10}SCRIPT{s: <30}UPTIME<r>", .{ "", "", "" });
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
        Output.errGeneric("Usage: bun logs NAME [-f]", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];
    const follow = false; // TODO: Parse -f flag from ctx
    const cwd = try bun.getcwd(&path_buf);
    const socket_path = try getSocketPath(ctx.allocator, cwd);

    const cmd = Protocol.Command{ .logs = .{ .name = name, .follow = follow } };
    const response = sendCommandAndWaitForResponse(ctx.allocator, socket_path, cmd) catch |err| {
        Output.errGeneric("Failed to connect to process manager: {}", .{err});
        Global.exit(1);
    };

    switch (response) {
        .log_path => |paths| {
            Output.prettyln("Logs at:", .{});
            Output.prettyln("  stdout: {s}", .{paths.stdout});
            Output.prettyln("  stderr: {s}", .{paths.stderr});
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
