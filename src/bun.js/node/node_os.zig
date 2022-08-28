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

// From C ; bindings/node_os/
pub const struct_InterfaceAddresses = extern struct {
    interface: [*c]u8,
    address: [*c]u8,
    netmask: [*c]u8,
    family: [*c]u8,
    mac: [*c]u8,
    cidr: c_int,
    scopeid: u32,
    internal: c_int,
};
pub extern fn getNetworkInterfaces() [*c]struct_InterfaceAddresses;
pub extern fn getNetworkInterfaceArrayLen(arr: [*c]struct_InterfaceAddresses) usize;
extern fn freeNetworkInterfaceArray(arr: [*c]struct_InterfaceAddresses, len: c_int) void;

pub const struct_CpuInfo = extern struct {
    manufacturer: [*c]u8,
    clockSpeed: f32,
    userTime: c_int,
    niceTime: c_int,
    systemTime: c_int,
    idleTime: c_int,
    iowaitTime: c_int,
    irqTime: c_int,
};
extern fn getCpuInfo() [*c]struct_CpuInfo;
extern fn getCpuTime() [*c]struct_CpuInfo;
extern fn getCpuInfoAndTime() [*c]struct_CpuInfo;
extern fn getCpuArrayLen(arr: [*c]struct_CpuInfo) usize;
extern fn freeCpuInfoArray(arr: [*c]struct_CpuInfo, len: c_int) void;

pub const Os = struct {
    pub const name = "Bun__Os";
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 20);

        module.put(globalObject, &JSC.ZigString.init("arch"), JSC.NewFunction(globalObject, &JSC.ZigString.init("arch"), 0, arch));
        module.put(globalObject, &JSC.ZigString.init("cpus"), JSC.NewFunction(globalObject, &JSC.ZigString.init("cpus"), 0, cpus));
        module.put(globalObject, &JSC.ZigString.init("endianness"), JSC.NewFunction(globalObject, &JSC.ZigString.init("endianness"), 0, endianness));
        module.put(globalObject, &JSC.ZigString.init("freemem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("freemem"), 0, freemem));
        module.put(globalObject, &JSC.ZigString.init("getPriority"), JSC.NewFunction(globalObject, &JSC.ZigString.init("getPriority"), 1, getPriority));
        module.put(globalObject, &JSC.ZigString.init("homedir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("homedir"), 0, homedir));
        module.put(globalObject, &JSC.ZigString.init("hostname"), JSC.NewFunction(globalObject, &JSC.ZigString.init("hostname"), 0, hostname));
        module.put(globalObject, &JSC.ZigString.init("loadavg"), JSC.NewFunction(globalObject, &JSC.ZigString.init("loadavg"), 0, loadavg));
        module.put(globalObject, &JSC.ZigString.init("networkInterfaces"), JSC.NewFunction(globalObject, &JSC.ZigString.init("networkInterfaces"), 0, networkInterfaces));
        module.put(globalObject, &JSC.ZigString.init("platform"), JSC.NewFunction(globalObject, &JSC.ZigString.init("platform"), 0, platform));
        module.put(globalObject, &JSC.ZigString.init("release"), JSC.NewFunction(globalObject, &JSC.ZigString.init("release"), 0, release));
        module.put(globalObject, &JSC.ZigString.init("setPriority"), JSC.NewFunction(globalObject, &JSC.ZigString.init("setPriority"), 2, setPriority));
        module.put(globalObject, &JSC.ZigString.init("tmpdir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("tmpdir"), 0, tmpdir));
        module.put(globalObject, &JSC.ZigString.init("totalmem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("totalmem"), 0, @"totalmem"));
        module.put(globalObject, &JSC.ZigString.init("type"), JSC.NewFunction(globalObject, &JSC.ZigString.init("type"), 0, @"type"));
        module.put(globalObject, &JSC.ZigString.init("uptime"), JSC.NewFunction(globalObject, &JSC.ZigString.init("uptime"), 0, uptime));
        module.put(globalObject, &JSC.ZigString.init("userInfo"), JSC.NewFunction(globalObject, &JSC.ZigString.init("userInfo"), 0, userInfo));
        module.put(globalObject, &JSC.ZigString.init("version"), JSC.NewFunction(globalObject, &JSC.ZigString.init("version"), 0, version));

        module.put(globalObject, &JSC.ZigString.init("devNull"), JSC.ZigString.init(devNull).withEncoding().toValue(globalObject));
        module.put(globalObject, &JSC.ZigString.init("EOL"), JSC.ZigString.init(EOL).withEncoding().toValue(globalObject));

        module.put(globalObject, &JSC.ZigString.init("constants"), constants.create(globalObject));

        return module;
    }

    pub const EOL = if (Environment.isWindows) "\\r\\n" else "\\n";
    pub const devNull = if (Environment.isWindows) "\\\\.\nul" else "/dev/null";

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValue(globalThis);
    }

    pub fn cpus(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        const cpus_ = getCpuInfoAndTime();
        if (cpus_ == null) return JSC.JSArray.from(globalThis, &.{});

        const len = getCpuArrayLen(cpus_);
        const arr = cpus_[0..len];

        var buf: [256]JSC.JSValue = undefined;
        var result = std.ArrayListUnmanaged(JSC.JSValue){ .capacity = buf.len, .items = buf[0..1] };
        result.items.len = 0;

        for (arr) |cpu| {
            var object = JSC.JSValue.createEmptyObject(globalThis, 3);
            var timesObject = JSC.JSValue.createEmptyObject(globalThis, 5);

            timesObject.put(globalThis, &JSC.ZigString.init("user"), JSC.JSValue.jsNumber(cpu.userTime));
            timesObject.put(globalThis, &JSC.ZigString.init("nice"), JSC.JSValue.jsNumber(cpu.niceTime));
            timesObject.put(globalThis, &JSC.ZigString.init("sys"), JSC.JSValue.jsNumber(cpu.systemTime));
            timesObject.put(globalThis, &JSC.ZigString.init("idle"), JSC.JSValue.jsNumber(cpu.idleTime));
            timesObject.put(globalThis, &JSC.ZigString.init("irq"), JSC.JSValue.jsNumber(cpu.irqTime));

            object.put(globalThis, &JSC.ZigString.init("model"), JSC.ZigString.init(std.mem.span(cpu.manufacturer)).withEncoding().toValueGC(globalThis));
            object.put(globalThis, &JSC.ZigString.init("speed"), JSC.JSValue.jsNumber(@floatToInt(i32, cpu.clockSpeed)));
            object.put(globalThis, &JSC.ZigString.init("times"), timesObject);

            _ = result.appendAssumeCapacity(object);
        }

        freeCpuInfoArray(cpus_, @intCast(c_int, len));
        heap_allocator.free(arr);
        return JSC.JSArray.from(globalThis, result.toOwnedSlice(heap_allocator));
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn freemem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.JSValue.jsNumberFromUint64(C.getFreeMemory());
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var args_ = callframe.arguments(1);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

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

        var pid = if (arguments.len > 0) arguments[0].asInt32() else 0;

        const priority = C.getProcessPriority(pid);
        if (priority == -1) {
            //const info = JSC.JSValue.createEmptyObject(globalThis, 4);
            //info.put(globalThis, &JSC.ZigString.init("errno"), JSC.JSValue.jsNumberFromInt32(-3));
            //info.put(globalThis, &JSC.ZigString.init("code"), JSC.ZigString.init("ESRCH").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, &JSC.ZigString.init("message"), JSC.ZigString.init("no such process").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, &JSC.ZigString.init("syscall"), JSC.ZigString.init("uv_os_getpriority").withEncoding().toValueGC(globalThis));

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
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var dir: string = "unknown";
        if (comptime Environment.isWindows)
            dir = std.os.getenv("USERPROFILE") orelse "unknown"
        else
            dir = std.os.getenv("HOME") orelse "unknown";

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.os.gethostname(&name_buffer) catch "unknown").withEncoding().toValueGC(globalThis);
    }

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        const result = C.getSystemLoadavg();
        return JSC.JSArray.from(globalThis, &.{
            JSC.JSValue.jsDoubleNumber(result[0]),
            JSC.JSValue.jsDoubleNumber(result[1]),
            JSC.JSValue.jsDoubleNumber(result[2]),
        });
    }

    pub fn networkInterfaces(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        const networkInterfaces_ = getNetworkInterfaces();
        if (networkInterfaces_ == null) return JSC.JSValue.createEmptyObject(globalThis, 0);

        const len = getNetworkInterfaceArrayLen(networkInterfaces_);
        const arr = networkInterfaces_[0..len];

        const object = JSC.JSValue.createEmptyObject(globalThis, 0);
        var map = std.StringArrayHashMap(std.ArrayList(JSC.JSValue)).init(heap_allocator);
        _ = map.ensureUnusedCapacity(len) catch unreachable;

        defer map.deinit();

        for (arr) |part| {
            const interface = std.mem.span(part.interface);
            const family = std.mem.span(part.family);
            const netmask = std.mem.span(part.netmask);
            const cidr = std.fmt.allocPrint(heap_allocator, "{s}/{}", .{ netmask, part.cidr }) catch unreachable;

            var list = map.get(interface) orelse std.ArrayList(JSC.JSValue).init(heap_allocator);
            var obj = JSC.JSValue.createEmptyObject(globalThis, if (strings.eqlComptime(family, "IPv6")) 7 else 6);
            obj.put(globalThis, &JSC.ZigString.init("address"), JSC.ZigString.init(std.mem.span(part.address)).withEncoding().toValueGC(globalThis));
            obj.put(globalThis, &JSC.ZigString.init("netmask"), JSC.ZigString.init(netmask).withEncoding().toValueGC(globalThis));
            obj.put(globalThis, &JSC.ZigString.init("family"), JSC.ZigString.init(family).withEncoding().toValueGC(globalThis));
            obj.put(globalThis, &JSC.ZigString.init("mac"), JSC.ZigString.init(std.mem.span(part.mac)).withEncoding().toValueGC(globalThis));
            obj.put(globalThis, &JSC.ZigString.init("cidr"), JSC.ZigString.init(cidr).withEncoding().toValueGC(globalThis));
            if (strings.eqlComptime(family, "IPv6")) obj.put(globalThis, &JSC.ZigString.init("scopeid"), JSC.JSValue.jsNumber(part.scopeid));
            obj.put(globalThis, &JSC.ZigString.init("internal"), JSC.JSValue.jsBoolean(if (part.internal == 0) true else false));

            _ = list.append(obj) catch unreachable;
            _ = map.put(interface, list) catch unreachable;
        }

        for (map.keys()) |key| {
            var value = map.get(key);

            object.put(globalThis, &JSC.ZigString.init(key), JSC.JSArray.from(globalThis, value.?.toOwnedSlice()));
        }

        freeNetworkInterfaceArray(networkInterfaces_, @intCast(c_int, len));
        heap_allocator.free(arr);
        return object;
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getRelease(&name_buffer)).withEncoding().toValueGC(globalThis);
    }

    pub fn setPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

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

    pub fn totalmem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.JSValue.jsNumberFromUint64(C.getTotalMemory());
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isWindows)
            return JSC.ZigString.init("Windows_NT").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.init("Darwin").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.init("Linux").withEncoding().toValueGC(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn uptime(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.JSValue.jsNumberFromUint64(C.getSystemUptime());
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, &JSC.ZigString.init("homedir"), homedir(globalThis, callframe));

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

    pub fn version(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getVersion(&name_buffer)).withEncoding().toValueGC(globalThis);
    }
};

comptime {
    std.testing.refAllDecls(Os);
}
