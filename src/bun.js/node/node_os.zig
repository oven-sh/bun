const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const string = bun.string;
const JSC = @import("../../jsc.zig");
const Environment = bun.Environment;
const Global = bun.Global;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const heap_allocator = bun.default_allocator;

pub const Os = struct {
    pub const name = "Bun__Os";
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 5);

        module.put(globalObject, &JSC.ZigString.init("arch"), JSC.NewFunction(globalObject, &JSC.ZigString.init("arch"), 0, arch));
        module.put(globalObject, &JSC.ZigString.init("endianness"), JSC.NewFunction(globalObject, &JSC.ZigString.init("endianness"), 0, endianness));
        module.put(globalObject, &JSC.ZigString.init("homedir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("homedir"), 0, homedir));
        module.put(globalObject, &JSC.ZigString.init("hostname"), JSC.NewFunction(globalObject, &JSC.ZigString.init("hostname"), 0, hostname));
        module.put(globalObject, &JSC.ZigString.init("platform"), JSC.NewFunction(globalObject, &JSC.ZigString.init("platform"), 0, platform));
        module.put(globalObject, &JSC.ZigString.init("release"), JSC.NewFunction(globalObject, &JSC.ZigString.init("release"), 0, release));
        module.put(globalObject, &JSC.ZigString.init("type"), JSC.NewFunction(globalObject, &JSC.ZigString.init("type"), 0, @"type"));

        module.put(globalObject, &JSC.ZigString.init("devNull"), JSC.ZigString.init(devNull).withEncoding().toValue(globalObject));
        module.put(globalObject, &JSC.ZigString.init("EOL"), JSC.ZigString.init(EOL).withEncoding().toValue(globalObject));

        return module;
    }

    pub const EOL = if (Environment.isWindows) "\\r\\n" else "\\n";
    pub const devNull = if (Environment.isWindows) "\\\\.\nul" else "/dev/null";

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValue(globalThis);
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        switch (comptime builtin.target.cpu.arch.endian()) {
            .Big => {
                return JSC.ZigString.init("BE").withEncoding().toValue(globalThis);
            },
            .Little => {
                return JSC.ZigString.init("LE").withEncoding().toValue(globalThis);
            },
        }
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

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.os.gethostname(&name_buffer) catch "unknown").withEncoding().toValueGC(globalThis);
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        const uts = std.os.uname();
        const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.release, 0), 0);
        std.mem.copy(u8, &name_buffer, result);

        return JSC.ZigString.init(name_buffer[0..result.len]).withEncoding().toValueGC(globalThis);
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isWindows)
            return JSC.ZigString.init("Windows_NT").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.init("Darwin").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.init("Linux").withEncoding().toValueGC(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }
};

comptime {
    std.testing.refAllDecls(Os);
}
