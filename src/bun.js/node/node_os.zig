const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const C = bun.C;
const string = bun.string;
const strings = bun.strings;
const JSC = @import("../../jsc.zig");
const Environment = bun.Environment;
const Global = bun.Global;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const heap_allocator = bun.default_allocator;
const constants = @import("./os/constants.zig");

pub const Os = struct {
    pub const name = "Bun__Os";
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 20);

        module.put(globalObject, JSC.ZigString.static("arch"), JSC.NewFunction(globalObject, JSC.ZigString.static("arch"), 0, arch, true));
        module.put(globalObject, JSC.ZigString.static("cpus"), JSC.NewFunction(globalObject, JSC.ZigString.static("cpus"), 0, cpus, true));
        module.put(globalObject, JSC.ZigString.static("endianness"), JSC.NewFunction(globalObject, JSC.ZigString.static("endianness"), 0, endianness, true));
        module.put(globalObject, JSC.ZigString.static("freemem"), JSC.NewFunction(globalObject, JSC.ZigString.static("freemem"), 0, freemem, true));
        module.put(globalObject, JSC.ZigString.static("getPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("getPriority"), 1, getPriority, true));
        module.put(globalObject, JSC.ZigString.static("homedir"), JSC.NewFunction(globalObject, JSC.ZigString.static("homedir"), 0, homedir, true));
        module.put(globalObject, JSC.ZigString.static("hostname"), JSC.NewFunction(globalObject, JSC.ZigString.static("hostname"), 0, hostname, true));
        module.put(globalObject, JSC.ZigString.static("loadavg"), JSC.NewFunction(globalObject, JSC.ZigString.static("loadavg"), 0, loadavg, true));
        module.put(globalObject, JSC.ZigString.static("networkInterfaces"), JSC.NewFunction(globalObject, JSC.ZigString.static("networkInterfaces"), 0, networkInterfaces, true));
        module.put(globalObject, JSC.ZigString.static("platform"), JSC.NewFunction(globalObject, JSC.ZigString.static("platform"), 0, platform, true));
        module.put(globalObject, JSC.ZigString.static("release"), JSC.NewFunction(globalObject, JSC.ZigString.static("release"), 0, release, true));
        module.put(globalObject, JSC.ZigString.static("setPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("setPriority"), 2, setPriority, true));
        module.put(globalObject, JSC.ZigString.static("tmpdir"), JSC.NewFunction(globalObject, JSC.ZigString.static("tmpdir"), 0, tmpdir, true));
        module.put(globalObject, JSC.ZigString.static("totalmem"), JSC.NewFunction(globalObject, JSC.ZigString.static("totalmem"), 0, totalmem, true));
        module.put(globalObject, JSC.ZigString.static("type"), JSC.NewFunction(globalObject, JSC.ZigString.static("type"), 0, Os.@"type", true));
        module.put(globalObject, JSC.ZigString.static("uptime"), JSC.NewFunction(globalObject, JSC.ZigString.static("uptime"), 0, uptime, true));
        module.put(globalObject, JSC.ZigString.static("userInfo"), JSC.NewFunction(globalObject, JSC.ZigString.static("userInfo"), 0, userInfo, true));
        module.put(globalObject, JSC.ZigString.static("version"), JSC.NewFunction(globalObject, JSC.ZigString.static("version"), 0, version, true));

        module.put(globalObject, JSC.ZigString.static("devNull"), JSC.ZigString.init(devNull).withEncoding().toValue(globalObject));
        module.put(globalObject, JSC.ZigString.static("EOL"), JSC.ZigString.init(EOL).withEncoding().toValue(globalObject));

        module.put(globalObject, JSC.ZigString.static("constants"), constants.create(globalObject));

        return module;
    }

    pub const EOL = if (Environment.isWindows) "\\r\\n" else "\\n";
    pub const devNull = if (Environment.isWindows) "\\\\.\nul" else "/dev/null";

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValue(globalThis);
    }

    pub fn cpus(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        // TODO:
        return JSC.JSArray.from(globalThis, &.{});
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        switch (comptime builtin.target.cpu.arch.endian()) {
            .Big => {
                return JSC.ZigString.init("BE").withEncoding().toValue(globalThis);
            },
            .Little => {
                return JSC.ZigString.init("LE").withEncoding().toValue(globalThis);
            },
        }
    }

    pub fn freemem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getFreeMemory());
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(1);
        const arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len > 0 and !arguments[0].isNumber()) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "getPriority() expects a number",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const pid = if (arguments.len > 0) arguments[0].asInt32() else 0;

        const priority = C.getProcessPriority(pid);
        if (priority == -1) {
            //const info = JSC.JSValue.createEmptyObject(globalThis, 4);
            //info.put(globalThis, JSC.ZigString.static("errno"), JSC.JSValue.jsNumberFromInt32(-3));
            //info.put(globalThis, JSC.ZigString.static("code"), JSC.ZigString.init("ESRCH").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, JSC.ZigString.static("message"), JSC.ZigString.init("no such process").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, JSC.ZigString.static("syscall"), JSC.ZigString.init("uv_os_getpriority").withEncoding().toValueGC(globalThis));

            const err = JSC.SystemError{
                .message = JSC.ZigString.init("A system error occurred: uv_os_getpriority returned ESRCH (no such process)"),
                .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                //.info = info,
                .errno = -3,
                .syscall = JSC.ZigString.init("uv_os_getpriority"),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return JSC.JSValue.jsUndefined();
        }

        return JSC.JSValue.jsNumberFromInt32(priority);
    }

    pub fn homedir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var dir: string = "unknown";
        if (comptime Environment.isWindows)
            dir = std.os.getenv("USERPROFILE") orelse "unknown"
        else
            dir = std.os.getenv("HOME") orelse "unknown";

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.os.gethostname(&name_buffer) catch "unknown").withEncoding().toValueGC(globalThis);
    }

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const result = C.getSystemLoadavg();
        return JSC.JSArray.from(globalThis, &.{
            JSC.JSValue.jsDoubleNumber(result[0]),
            JSC.JSValue.jsDoubleNumber(result[1]),
            JSC.JSValue.jsDoubleNumber(result[2]),
        });
    }

    pub fn networkInterfaces(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        // TODO:
        return JSC.JSValue.createEmptyObject(globalThis, 0);
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getRelease(&name_buffer)).withEncoding().toValueGC(globalThis);
    }

    pub fn setPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(2);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len == 0) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "The \"priority\" argument must be of type number. Received undefined",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const pid = if (arguments.len == 2) arguments[0].toInt32() else 0;
        const priority = if (arguments.len == 2) arguments[1].toInt32() else arguments[0].toInt32();

        if (priority < -20 or priority > 19) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_OUT_OF_RANGE,
                "The value of \"priority\" is out of range. It must be >= -20 && <= 19",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const errcode = C.setProcessPriority(pid, priority);
        switch (errcode) {
            .SRCH => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned ESRCH (no such process)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -3,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            .ACCES => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned EACCESS (permission denied)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -13,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            else => {},
        }

        return JSC.JSValue.jsUndefined();
    }

    pub fn tmpdir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

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

    pub fn totalmem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getTotalMemory());
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        if (comptime Environment.isWindows)
            return JSC.ZigString.static("Windows_NT").toValue(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.static("Darwin").toValue(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.static("Linux").toValue(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn uptime(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getSystemUptime());
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, JSC.ZigString.static("homedir"), homedir(globalThis, callframe));

        if (comptime Environment.isWindows) {
            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(std.os.getenv("USERNAME") orelse "unknown").withEncoding().toValueGC(globalThis));
            result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.JSValue.jsNull());
        } else {
            const username = std.os.getenv("USER") orelse "unknown";

            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(username).withEncoding().toValueGC(globalThis));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.ZigString.init(std.os.getenv("SHELL") orelse "unknown").withEncoding().toValueGC(globalThis));

            if (comptime Environment.isLinux) {
                result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(std.os.linux.getuid()));
                result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(std.os.linux.getgid()));
            } else {
                result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(C.darwin.getuid()));
                result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(C.darwin.getgid()));
            }
        }

        return result;
    }

    pub fn version(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getVersion(&name_buffer)).withEncoding().toValueGC(globalThis);
    }
};
