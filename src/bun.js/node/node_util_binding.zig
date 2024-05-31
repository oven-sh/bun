const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

pub fn guessHandleType(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    if (std.os.isatty(file))
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

    const sockaddr = std.os.sockaddr;
    var addr: sockaddr = undefined;
    if (std.c.getsockname(file, &addr, @ptrFromInt(@sizeOf(sockaddr))) > 0) return .unknown;

    var ty: u32 = 0;
    if (std.c.getsockopt(file, std.os.SOL.SOCKET, std.os.SO.TYPE, &ty, @ptrFromInt(4)) > 0) return .unknown;

    if (ty == std.os.SOCK.DGRAM)
        if (addr.family == std.os.AF.INET or addr.family == std.os.AF.INET6)
            return .udp;

    if (ty == std.os.SOCK.STREAM) {
        if (addr.family == std.os.AF.INET or addr.family == std.os.AF.INET6)
            return .tcp;
        if (addr.family == std.os.AF.UNIX)
            return .named_pipe;
    }

    return .unknown;
}
