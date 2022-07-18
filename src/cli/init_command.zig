const Command = @import("../cli.zig").Command;
const std = @import("std");

pub const InitCommand = struct {
    fn getUserInput(alloc: std.mem.Allocator, default: []const u8) []const u8 {
        const stdin = std.io.getStdIn().reader();

        const buffer = stdin.readUntilDelimiterOrEofAlloc(alloc, '\n', 100) catch {
            return default;
        };
    
        const buf = buffer orelse "";
        if (buf.len == 0) {
            return default;
        }  
        else {
            return buf;
        }
    }

    pub fn exec(alloc: std.mem.Allocator) !void {
        const stdout = std.io.getStdOut().writer();

        // get package info from user
        try stdout.print("package name: (project)", .{});
        const project_name = getUserInput(alloc, "project");

        try stdout.print("description: ", .{});
        const desc = getUserInput(alloc, "");

        try stdout.print("entry point: (index.ts)", .{});
        const entry_point = getUserInput(alloc, "index.ts");

        try stdout.print("author: ", .{});
        const author = getUserInput(alloc, "");

        try stdout.print("license: (ISC)", .{});
        const license = getUserInput(alloc, "ISC");

        const fs = std.fs;
        const cwd = fs.cwd();

        const package_json = cwd.createFile("package.json", .{ .exclusive = true }) catch |err| {
            std.debug.print("{any}", .{err});
            return;
        };
        defer package_json.close();

        // build json object
        const Scripts = struct {
            tests: []const u8
        };

        const Package = struct {
            name: []const u8,
            description: []const u8,
            main: []const u8,
            scripts: Scripts,
            author: []const u8,
            license: []const u8
        };

        const content = Package {
            .name = project_name,
            .description = desc,
            .main = entry_point,
            .scripts = Scripts { .tests = "echo \"Error: no test specified\" && exit 1" },
            .author = author,
            .license = license
        };

        // json object to string
        var string = std.ArrayList(u8).init(alloc);
        try std.json.stringify(content, .{}, string.writer());
        defer string.deinit();

        // write json object to file
        try package_json.writeAll(string.items);
    }
}