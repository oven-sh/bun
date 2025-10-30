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

pub fn startCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun start SCRIPT", .{});
        Global.exit(1);
    }

    const script_name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);

    const manager = try Manager.ProcessManager.init(ctx.allocator, cwd);
    defer manager.deinit();

    // Clean up any dead processes first
    try manager.cleanup();

    manager.startProcess(script_name, script_name, cwd) catch |err| {
        switch (err) {
            error.ProcessAlreadyExists => {
                Output.errGeneric("Process '{s}' is already running", .{script_name});
                Global.exit(1);
            },
            else => return err,
        }
    };

    Output.prettyln("<green>\u{2713}<r> Started: <b>{s}<r>", .{script_name});
    Output.flush();
}

pub fn stopCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun stop NAME", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);

    const manager = try Manager.ProcessManager.init(ctx.allocator, cwd);
    defer manager.deinit();

    // Clean up any dead processes first
    try manager.cleanup();

    manager.stopProcess(name) catch |err| {
        switch (err) {
            error.ProcessNotFound => {
                Output.errGeneric("Process '{s}' not found", .{name});
                Global.exit(1);
            },
            else => return err,
        }
    };

    Output.prettyln("<green>\u{2713}<r> Stopped: <b>{s}<r>", .{name});
    Output.flush();
}

pub fn listCommand(ctx: Command.Context) !void {
    const cwd = try bun.getcwd(&path_buf);

    const manager = try Manager.ProcessManager.init(ctx.allocator, cwd);
    defer manager.deinit();

    // Clean up any dead processes first
    try manager.cleanup();

    const list = try manager.listProcesses(ctx.allocator);
    defer ctx.allocator.free(list);

    if (list.len == 0) {
        Output.prettyln("No processes running in this workspace", .{});
        Output.flush();
        return;
    }

    Output.prettyln("\n<b>NAME                PID       SCRIPT                        UPTIME<r>", .{});
    for (list) |proc| {
        const uptime = formatUptime(proc.uptime);
        Output.prettyln("{s: <20}{d: <10}{s: <30}{s}", .{ proc.name, proc.pid, proc.script, uptime });
    }
    Output.prettyln("", .{});
    Output.flush();
}

pub fn logsCommand(ctx: Command.Context) !void {
    if (ctx.positionals.len < 2) {
        Output.errGeneric("Usage: bun logs NAME [-f]", .{});
        Global.exit(1);
    }

    const name = ctx.positionals[1];
    const cwd = try bun.getcwd(&path_buf);

    const manager = try Manager.ProcessManager.init(ctx.allocator, cwd);
    defer manager.deinit();

    // Clean up any dead processes first
    try manager.cleanup();

    const response = manager.getLogPaths(name) catch |err| {
        switch (err) {
            error.ProcessNotFound => {
                Output.errGeneric("Process '{s}' not found", .{name});
                Global.exit(1);
            },
            else => return err,
        }
    };

    switch (response) {
        .log_path => |paths| {
            Output.prettyln("<b>Logs for {s}:<r>", .{name});
            Output.prettyln("  stdout: {s}", .{paths.stdout});
            Output.prettyln("  stderr: {s}", .{paths.stderr});

            // TODO: Check for -f flag and tail the logs
            // For now, just print last 50 lines of stdout
            Output.prettyln("\n<b>Recent stdout:<r>", .{});
            try tailFile(ctx.allocator, paths.stdout, 50);

            Output.prettyln("\n<b>Recent stderr:<r>", .{});
            try tailFile(ctx.allocator, paths.stderr, 50);
        },
        else => {},
    }

    Output.flush();
}

fn tailFile(allocator: std.mem.Allocator, path: []const u8, lines: usize) !void {
    const file = std.fs.openFileAbsolute(path, .{}) catch |err| {
        if (err == error.FileNotFound) {
            Output.prettyln("  <d>(no output yet)<r>", .{});
            return;
        }
        return err;
    };
    defer file.close();

    const contents = try file.readToEndAlloc(allocator, 1024 * 1024);
    defer allocator.free(contents);

    if (contents.len == 0) {
        Output.prettyln("  <d>(no output yet)<r>", .{});
        return;
    }

    // Count newlines from the end
    var line_count: usize = 0;
    var i: usize = contents.len;
    while (i > 0 and line_count < lines) {
        i -= 1;
        if (contents[i] == '\n') {
            line_count += 1;
        }
    }

    // Skip to the start of the line
    if (i > 0) {
        while (i < contents.len and contents[i] != '\n') {
            i += 1;
        }
        if (i < contents.len) i += 1;
    }

    const tail_contents = contents[i..];
    if (tail_contents.len > 0) {
        Output.pretty("{s}", .{tail_contents});
    } else {
        Output.prettyln("  <d>(no output yet)<r>", .{});
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
