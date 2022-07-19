const Command = @import("../cli.zig").Command;
const JSON = @import("../json_parser.zig");
const JSAst = @import("../js_ast.zig");
const JSPrinter = @import("../js_printer.zig");
const logger = @import("../logger.zig");
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

        // build package object
        const Scripts = struct {
        };

        const Package = struct {
            name: []const u8,
            description: []const u8,
            module: []const u8,
            scripts: Scripts,
            author: []const u8,
            license: []const u8
        };

        const content = Package {
            .name = project_name,
            .description = desc,
            .module = entry_point,
            .scripts = Scripts {},
            .author = author,
            .license = license
        };

        // create & write to package.json file
        var buffer_writer = try JSPrinter.BufferWriter.init(alloc);
        var writer = JSPrinter.BufferPrinter.init(buffer_writer);
        var source = logger.Source.initEmptyFile("package.json");

        const json = try JSON.toAST(alloc, Package, content);
        try JSPrinter.printJSON(*JSPrinter.BufferPrinter, &writer, json, &source);
    }
}