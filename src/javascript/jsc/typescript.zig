usingnamespace @import("./base.zig");
const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const Router = @import("./api/router.zig");
const JavaScript = @import("./javascript.zig");
const builtin = std.builtin;
const io = std.io;
const fs = std.fs;
const process = std.process;
const ChildProcess = std.ChildProcess;
const Progress = std.Progress;
const print = std.debug.print;
const mem = std.mem;
const testing = std.testing;
const Allocator = std.mem.Allocator;
const resolve_path = @import("../../resolver/resolve_path.zig");
usingnamespace @import("./webcore/response.zig");

const modules = [_]d.ts.decl{
    Router.Class.typescriptDeclaration(),
};

const hidden_globals = [_]d.ts.decl{
    FetchEvent.Class.typescriptDeclaration(),
};

const global = JavaScript.GlobalObject.GlobalClass.typescriptDeclaration();

pub fn main() anyerror!void {
    var argv = std.mem.span(std.os.argv);
    var dest = [_]string{ argv[argv.len - 2], argv[argv.len - 1] };

    var dir_path = resolve_path.joinAbs(std.process.getCwdAlloc(allocator), .auto, &dest);

    std.debug.assert(dir_path.len > 0 and strings.eqlComptime(std.fs.path.basename(dir_path), "types"));
    try std.fs.deleteTreeAbsolute(dir_path);
    try std.fs.makeDirAbsolute(dir_path);
    var dir = try std.fs.openDirAbsolute(dir_path, std.fs.Dir.OpenDirOptions{});

    var index_file = dir.openFile("index.d.ts", .{ .write = true });
    try index_file.writeAll(comptime d.ts.class.Printer.printDecl(global, 0));

    try index_file.writeAll("\n");

    try index_file.writeAll("declare global {\n");

    inline for (hidden_globals) |module, i| {
        if (i > 0) {
            try index_file.writeAll("\n");
        }
        try index_file.writeAll(comptime d.ts.class.Printer.printDecl(module, 2));
    }

    try index_file.writeAll("}\n");
    var stdout = std.io.getStdOut();
    try stdout.writeAll("✔️ index.d.ts");

    inline for (modules) |decl| {
        var module: d.ts.module = comptime decl.module;
        const basepath = comptime module.path["speedy.js/".len..];
        if (std.fs.path.dirname(basepath)) |dirname| {
            dir.makePath(dirname);
        }

        var file = try dir.openFile(comptime basepath ++ ".d.ts", .{ .write = true });
        try file.writeAll(comptime d.ts.class.Printer.printDecl(module, 0));
        try stdout.writeAll(comptime "✔️ " ++ basepath);
    }
}
