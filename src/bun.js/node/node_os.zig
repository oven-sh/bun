const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("io");
const JSC = @import("../../jsc.zig");
const PathString = JSC.PathString;
const Environment = bun.Environment;
const Global = bun.Global;
const C = bun.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
const Buffer = JSC.MarkedArrayBuffer;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const logger = @import("../../logger.zig");
const Fs = @import("../../fs.zig");
const URL = @import("../../url.zig").URL;
const Shimmer = @import("../bindings/shimmer.zig").Shimmer;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const meta = bun.meta;
const heap_allocator = bun.default_allocator;

pub const Os = struct {
    pub const shim = Shimmer("Bun", "Os", @This());
    pub const name = "Bun__Os";
    pub const include = "Os.h";
    pub const namespace = shim.namespace;
    const PathHandler = @import("../../resolver/resolve_path.zig");
    const StringBuilder = @import("../../string_builder.zig");
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject, isWindows: bool) callconv(.C) JSC.JSValue {
        return shim.cppFn("create", .{ globalObject, isWindows });
    }

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValueGC(globalThis);
    }

    pub fn homedir(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var dir: string = "unknown";
        if (comptime Environment.isWindows)
            dir = std.os.getenv("USERPROFILE") orelse "unknown"
        else
            dir = std.os.getenv("HOME") orelse "unknown";

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub const Export = shim.exportFunctions(.{
        .@"arch" = arch,
        .@"homedir" = homedir,
    });

    pub const Extern = [_][]const u8{"create"};

    comptime {
        if (!is_bindgen) {
            @export(Os.arch, .{
                .name = Export[0].symbol_name,
            });
            @export(Os.homedir, .{
                .name = Export[1].symbol_name,
            });
        }
    }
};

comptime {
    std.testing.refAllDecls(Os);
}
