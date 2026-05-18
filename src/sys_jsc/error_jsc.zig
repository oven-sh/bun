//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

pub fn toJS(this: Error, ptr: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return this.toSystemError().toErrorInstance(ptr);
}

/// Like `toJS` but populates the error's stack trace with async frames from the
/// given promise's await chain. Use when rejecting a promise from native code
/// at the top of the event loop (threadpool callback) — otherwise the error
/// will have an empty stack trace.
pub fn toJSWithAsyncStack(this: Error, ptr: *jsc.JSGlobalObject, promise: *jsc.JSPromise) bun.JSError!jsc.JSValue {
    return this.toSystemError().toErrorInstanceWithAsyncStack(ptr, promise);
}

pub const TestingAPIs = struct {
    /// Exercises Error.name() with from_libuv=true so tests can feed the
    /// negated-UV-code errno values that node_fs.zig stores and verify the
    /// integer overflow at translateUVErrorToE(-code) is fixed. Windows-only.
    pub fn sysErrorNameFromLibuv(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments();
        if (arguments.len < 1 or !arguments[0].isNumber()) {
            return globalThis.throw("sysErrorNameFromLibuv: expected 1 number argument", .{});
        }
        if (comptime !Environment.isWindows) {
            return .js_undefined;
        }
        const err: Error = .{
            .errno = @intCast(arguments[0].toInt32()),
            .syscall = .open,
            .from_libuv = true,
        };
        return bun.String.createUTF8ForJS(globalThis, err.name());
    }

    /// Exposes libuv -> `bun.sys.E` translation so tests can feed out-of-range
    /// negative values and verify it does not panic. Windows-only.
    pub fn translateUVErrorToE(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments();
        if (arguments.len < 1 or !arguments[0].isNumber()) {
            return globalThis.throw("translateUVErrorToE: expected 1 number argument", .{});
        }
        if (comptime !Environment.isWindows) {
            return .js_undefined;
        }
        const code: c_int = arguments[0].toInt32();
        const result = bun.windows.libuv.translateUVErrorToE(code);
        return bun.String.createUTF8ForJS(globalThis, @tagName(result));
    }

    /// Verifies `bun.sys.Sigaction`'s layout matches the host libc by
    /// round-tripping a known handler through `sigaction(2)`. If the struct
    /// layout disagrees with libc (as `std.posix.Sigaction` does on Android
    /// bionic — `sa_flags` first, 8-byte `sigset_t`), libc reads/writes the
    /// fields at the wrong offsets and the returned handler/flags won't match
    /// what we installed. Returns `{ installed, readback }` for the test to
    /// compare. POSIX-only.
    pub fn sigactionLayout(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (comptime !Environment.isPosix) return .js_undefined;

        const posix = std.posix;
        const sentry = struct {
            fn handler(_: c_int) callconv(.c) void {}
        };
        var mask = bun.sys.sigemptyset();
        bun.sys.sigaddset(&mask, posix.SIG.USR2);
        const act = bun.sys.Sigaction{
            .handler = .{ .handler = &sentry.handler },
            .mask = mask,
            .flags = posix.SA.RESTART,
        };
        var prev: bun.sys.Sigaction = undefined;
        var readback: bun.sys.Sigaction = undefined;
        bun.sys.sigaction(posix.SIG.USR2, &act, &prev);
        bun.sys.sigaction(posix.SIG.USR2, null, &readback);
        bun.sys.sigaction(posix.SIG.USR2, &prev, null);

        const installed = (try jsc.JSObject.create(.{
            .handler = @as(f64, @floatFromInt(@intFromPtr(&sentry.handler))),
            .flags = @as(f64, @floatFromInt(act.flags & posix.SA.RESTART)),
        }, globalThis)).toJS();
        const rb = (try jsc.JSObject.create(.{
            .handler = @as(f64, @floatFromInt(@intFromPtr(readback.handler.handler))),
            .flags = @as(f64, @floatFromInt(readback.flags & posix.SA.RESTART)),
        }, globalThis)).toJS();
        return (try jsc.JSObject.create(.{
            .installed = installed,
            .readback = rb,
            .sizeof = @as(f64, @floatFromInt(@sizeOf(bun.sys.Sigaction))),
        }, globalThis)).toJS();
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const Error = bun.sys.Error;
