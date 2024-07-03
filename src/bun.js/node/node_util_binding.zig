const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

pub fn guessHandleType(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(1).slice();
            if (arguments.len < 1) {
                globalThis.throwNotEnoughArguments("guessHandleType", 1, arguments.len);
                return .zero;
            }
            const fd_value = arguments[0];
            const fd_int = fd_value.toInt32();
            const t = uv_guess_handle(fd_int);
            return JSC.JSValue.jsNumber(@as(u8, switch (t) {
                .tcp => 0,
                .tty => 1,
                .udp => 2,
                .file => 3,
                .named_pipe => 4,
                .unknown => 5,
                else => @panic("unreachable"),
            }));
        }
    };
    return JSC.JSFunction.create(global, "guessHandleType", S.cb, 1, .{});
}

fn uv_guess_handle(file: uv.uv_file) uv.uv_handle_type {
    if (Environment.isWindows) {
        return bun.windows.libuv.uv_guess_handle(file);
    }

    // eb5af8e3c0ea19a6b0196d5db3212dae1785739b
    // https://github.com/libuv/libuv/blob/v1.x/src/unix/tty.c#L356

    if (file < 0)
        return .unknown;

    if (std.posix.isatty(file))
        return .tty;

    const zig_file = std.fs.File{ .handle = file };
    const stat = zig_file.stat() catch return .unknown;

    if (bun.S.ISREG(stat.mode))
        return .file;

    if (bun.S.ISCHR(stat.mode))
        return .file;

    if (bun.S.ISFIFO(stat.mode))
        return .named_pipe;

    if (!bun.S.ISSOCK(stat.mode))
        return .unknown;

    const sockaddr = std.posix.sockaddr;
    var addr: sockaddr = undefined;
    if (std.c.getsockname(file, &addr, @ptrFromInt(@sizeOf(sockaddr))) > 0) return .unknown;

    var ty: u32 = 0;
    if (std.c.getsockopt(file, std.posix.SOL.SOCKET, std.posix.SO.TYPE, &ty, @ptrFromInt(4)) > 0) return .unknown;

    if (ty == std.posix.SOCK.DGRAM)
        if (addr.family == std.posix.AF.INET or addr.family == std.posix.AF.INET6)
            return .udp;

    if (ty == std.posix.SOCK.STREAM) {
        if (addr.family == std.posix.AF.INET or addr.family == std.posix.AF.INET6)
            return .tcp;
        if (addr.family == std.posix.AF.UNIX)
            return .named_pipe;
    }

    return .unknown;
}

pub fn internalErrorName(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(1).slice();
            if (arguments.len < 1) {
                globalThis.throwNotEnoughArguments("internalErrorName", 1, arguments.len);
                return .zero;
            }
            const err_value = arguments[0];
            const err_int = err_value.toInt32();
            const err_i: isize = err_int;
            const err_e: std.c.E = @enumFromInt(-err_i);
            // Refactor this when https://github.com/ziglang/zig/issues/12845 lands.
            return bun.String.init(@tagName(err_e)).toJS(globalThis);
        }
    };
    return JSC.JSFunction.create(global, "internalErrorName", S.cb, 1, .{});
}
