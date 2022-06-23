const d = @import("./base.zig").d;
const std = @import("std");
const Router = @import("./api/router.zig");
const builtin = @import("builtin");
const io = std.io;
const fs = std.fs;
const process = std.process;
const ChildProcess = std.ChildProcess;
const Progress = std.Progress;
const print = std.debug.print;
const mem = std.mem;
const testing = std.testing;
const Allocator = std.mem.Allocator;
const resolve_path = @import("../resolver/resolve_path.zig");
const JSC = @import("../jsc.zig");
const bun = @import("../global.zig");
const string = bun.string;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

pub const bindgen = true;

pub fn main() anyerror!void {
    const modules = comptime [_]d.ts.decl{
        JSC.Node.NodeFSBindings.typescriptDeclaration(),
    };

    const hidden_globals = comptime [_]d.ts.decl{
        JSC.WebCore.FetchEvent.Class.typescriptDeclaration(),
    };

    const globals = comptime [_]d.ts.decl{
        Router.Instance.typescriptDeclaration(),
        JSC.Bun.Class.typescriptDeclaration(),
        JSC.BuildError.Class.typescriptDeclaration(),
        JSC.ResolveError.Class.typescriptDeclaration(),
        JSC.WebCore.Response.Class.typescriptDeclaration(),
        JSC.WebCore.Headers.Class.typescriptDeclaration(),
        JSC.EventListenerMixin.addEventListener(JSC.VirtualMachine).typescriptDeclaration(),
        JSC.WebCore.Fetch.Class.typescriptDeclaration(),
        JSC.Performance.Class.typescriptDeclaration(),
        JSC.Crypto.Class.typescriptDeclaration(),
        JSC.WebCore.TextDecoder.Class.typescriptDeclaration(),
        JSC.API.Transpiler.Class.typescriptDeclaration(),
    };

    var allocator = default_allocator;
    var argv = std.mem.span(std.os.argv);
    var dest = [_]string{ std.mem.span(argv[argv.len - 2]), std.mem.span(argv[argv.len - 1]) };
    var stdout = std.io.getStdOut();
    var writer = stdout.writer();
    try writer.print("{s}/{s}\n", .{ dest[0], dest[1] });
    var dir_path = resolve_path.joinAbsString(try std.process.getCwdAlloc(allocator), &dest, .auto);

    std.debug.assert(dir_path.len > 0 and strings.eqlComptime(std.fs.path.basename(dir_path), "types"));
    std.fs.deleteTreeAbsolute(dir_path) catch {};
    try std.fs.makeDirAbsolute(dir_path);
    var dir = try std.fs.openDirAbsolute(dir_path, std.fs.Dir.OpenDirOptions{});
    var index_file = try dir.createFile("index.d.ts", .{});
    try index_file.writeAll(
        \\/// <reference no-default-lib="true" />
        \\/// <reference lib="esnext" />
        \\/// <reference types="bun.js/types/globals" />
        \\/// <reference types="bun.js/types/modules" />
        \\
    );

    var global_file = try dir.createFile("globals.d.ts", .{});
    try global_file.writeAll(
        \\// bun.js v
        \\
        \\
    );
    inline for (globals) |global| {
        try global_file.writeAll(comptime d.ts.class.Printer.printDecl(global, 0));
    }

    var module_file = try dir.createFile("modules.d.ts", .{});
    try module_file.writeAll(
        \\// bun.js v
        \\
        \\
    );

    try global_file.writeAll("\n");

    try global_file.writeAll("declare global {\n");

    inline for (hidden_globals) |module, i| {
        if (i > 0) {
            try global_file.writeAll("\n");
        }
        try global_file.writeAll(comptime d.ts.class.Printer.printDecl(module, 2));
    }

    try global_file.writeAll("}\n\n");
    try stdout.writeAll("  ✔️ index.d.ts\n");

    inline for (modules) |decl| {
        comptime var module: d.ts.module = decl.module;
        const basepath = comptime module.path;
        if (std.fs.path.dirname(basepath)) |dirname| {
            try dir.makePath(dirname);
        }

        try module_file.writeAll(comptime d.ts.class.Printer.printDecl(decl, 0));
        try stdout.writeAll(comptime "  ✔️ " ++ basepath ++ " - modules.d.ts\n");
    }

    try global_file.writeAll("export {};\n");
}
