const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const C = bun.C;
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
        module.put(globalObject, &JSC.ZigString.init("freemem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("freemem"), 0, freemem));
        module.put(globalObject, &JSC.ZigString.init("getPriority"), JSC.NewFunction(globalObject, &JSC.ZigString.init("getPriority"), 1, getPriority));
        module.put(globalObject, &JSC.ZigString.init("homedir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("homedir"), 0, homedir));
        module.put(globalObject, &JSC.ZigString.init("hostname"), JSC.NewFunction(globalObject, &JSC.ZigString.init("hostname"), 0, hostname));
        module.put(globalObject, &JSC.ZigString.init("loadavg"), JSC.NewFunction(globalObject, &JSC.ZigString.init("loadavg"), 0, loadavg));
        module.put(globalObject, &JSC.ZigString.init("platform"), JSC.NewFunction(globalObject, &JSC.ZigString.init("platform"), 0, platform));
        module.put(globalObject, &JSC.ZigString.init("release"), JSC.NewFunction(globalObject, &JSC.ZigString.init("release"), 0, release));
        module.put(globalObject, &JSC.ZigString.init("tmpdir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("tmpdir"), 0, tmpdir));
        module.put(globalObject, &JSC.ZigString.init("totalmem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("totalmem"), 0, @"totalmem"));
        module.put(globalObject, &JSC.ZigString.init("type"), JSC.NewFunction(globalObject, &JSC.ZigString.init("type"), 0, @"type"));
        module.put(globalObject, &JSC.ZigString.init("uptime"), JSC.NewFunction(globalObject, &JSC.ZigString.init("uptime"), 0, uptime));
        module.put(globalObject, &JSC.ZigString.init("userInfo"), JSC.NewFunction(globalObject, &JSC.ZigString.init("userInfo"), 0, userInfo));
        module.put(globalObject, &JSC.ZigString.init("version"), JSC.NewFunction(globalObject, &JSC.ZigString.init("version"), 0, version));

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

    pub fn freemem(_: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_free_memory());
        } else {
            return JSC.JSValue.jsNumber(0);
        }
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, _: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        //var stack_fallback = std.heap.stackFallback(4096, JSC.getAllocator(globalThis.ref()));
        //var allocator = stack_fallback.get();

        var arguments: []JSC.JSValue = args_ptr[0..args_len];
        std.debug.print("test, {any}", .{arguments});
        //var pid_ = arguments[0].toSlice(globalThis, allocator); //else JSC.ZigString.init("0").toSlice(allocator);
        //defer pid_.deinit();

        const pid = "0"; //pid_.slice();

        return JSC.ZigString.init(pid).withEncoding().toValueGC(globalThis);
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

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            const result = C.linux.get_system_loadavg();
            return JSC.JSArray.from(globalThis, &.{
                JSC.JSValue.jsDoubleNumber(result[0]),
                JSC.JSValue.jsDoubleNumber(result[1]),
                JSC.JSValue.jsDoubleNumber(result[2]),
            });
        } else {
            return JSC.JSArray.from(globalThis, &.{
                JSC.JSValue.jsNumber(0),
                JSC.JSValue.jsNumber(0),
                JSC.JSValue.jsNumber(0),
            });
        }
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

    pub fn tmpdir(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var dir: string = "unknown";
        if (comptime Environment.isWindows) {
            if (std.os.getenv("TEMP") orelse std.os.getenv("TMP")) |tmpdir_| {
                dir = tmpdir_;
            }

            if (std.os.getenv("SYSTEMROOT") orelse std.os.getenv("WINDIR")) |systemdir_| {
                dir = systemdir_ + "\\temp";
            }

            dir = "unknown";
        } else {
            dir = std.os.getenv("TMPDIR") orelse std.os.getenv("TMP") orelse std.os.getenv("TEMP") orelse "/tmp";
        }

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn totalmem(_: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_total_memory());
        } else {
            return JSC.JSValue.jsNumber(C.darwin.get_total_memory());
        }
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

    pub fn uptime(_: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_system_uptime());
        } else {
            return JSC.JSValue.jsNumber(0);
        }
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, &JSC.ZigString.init("homedir"), homedir(globalThis, isWindows, args_ptr, args_len));

        if (comptime Environment.isWindows) {
            result.put(globalThis, &JSC.ZigString.init("username"), JSC.ZigString.init(std.os.getenv("USERNAME") orelse "unknown").withEncoding().toValueGC(globalThis));
            result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, &JSC.ZigString.init("shell"), JSC.JSValue.jsNull());
        } else {
            const username = std.os.getenv("USER") orelse "unknown";

            result.put(globalThis, &JSC.ZigString.init("username"), JSC.ZigString.init(username).withEncoding().toValueGC(globalThis));
            result.put(globalThis, &JSC.ZigString.init("shell"), JSC.ZigString.init(std.os.getenv("SHELL") orelse "unknown").withEncoding().toValueGC(globalThis));

            if (comptime Environment.isLinux) {
                result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(std.os.linux.getuid()));
                result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(std.os.linux.getgid()));
            } else {
                result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(C.darwin.getuid()));
                result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(C.darwin.getgid()));
            }
        }

        return result;
    }

    pub fn version(globalThis: *JSC.JSGlobalObject, _: bool, _: [*]JSC.JSValue, _: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        const uts = std.os.uname();
        const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.version, 0), 0);
        std.mem.copy(u8, &name_buffer, result);

        return JSC.ZigString.init(name_buffer[0..result.len]).withEncoding().toValueGC(globalThis);
    }
};

comptime {
    std.testing.refAllDecls(Os);
}
