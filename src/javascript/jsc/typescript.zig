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

pub fn main() anyerror!void {
    var args_it = process.args();
    var allocator = std.heap.c_allocator;

    _ = args_it.skip();
    var stdout = io.getStdOut();

    const modules = comptime [_]d.ts.class{
        Router.Class.typescriptDeclaration(),
    };
    inline for (modules) |class, i| {
        if (i > 0) {
            try stdout.writeAll("\n\n");
        }

        try stdout.writeAll(comptime d.ts.class.Printer.printClass(class, 0));
    }

    try stdout.writeAll("\n\n");

    try stdout.writeAll("declare global {\n");

    const global = comptime JavaScript.GlobalObject.GlobalClass.typescriptDeclaration();

    inline for (global.properties) |property, i| {
        if (i > 0) {
            try stdout.writeAll("\n\n");
        }

        try stdout.writeAll(comptime d.ts.class.Printer.printVar(property, 2));
    }

    try stdout.writeAll("\n");

    inline for (global.functions) |property, i| {
        if (i > 0) {
            try stdout.writeAll("\n\n");
        }

        try stdout.writeAll(comptime d.ts.class.Printer.printFunction(property, 2, false));
    }

    try stdout.writeAll("\n");

    const globals = comptime [_]d.ts.class{
        FetchEvent.Class.typescriptDeclaration(),
    };

    inline for (globals) |class, i| {
        if (i > 0) {
            try stdout.writeAll("\n\n");
        }

        try stdout.writeAll(comptime d.ts.class.Printer.printClass(class, 2));
    }

    try stdout.writeAll("}\n");
}
