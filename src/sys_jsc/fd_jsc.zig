//! JSC bridge for `bun.FD`. Keeps `src/sys/` free of JSC types.

/// fd "fails" if not given an int32, returning null in that case
pub fn fromJS(value: JSValue) ?FD {
    if (!value.isAnyInt()) return null;
    const fd64 = value.toInt64();
    if (fd64 < 0 or fd64 > std.math.maxInt(i32)) {
        return null;
    }
    const fd: i32 = @intCast(fd64);
    // On Windows, JS-visible fds are libuv/CRT fds (see `toJS`). libuv fd
    // 0/1/2 already map to stdio, so there is no need to substitute the
    // cached `.system` HANDLE here — doing so forces every `sys_uv` call to
    // round-trip through `FD.uv()`'s stdio-handle comparison, which panics
    // if the process std handle was swapped after startup.
    return .fromUV(fd);
}

// If a non-number is given, returns null.
// If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
pub fn fromJSValidated(value: JSValue, global: *jsc.JSGlobalObject) bun.JSError!?FD {
    if (!value.isNumber())
        return null;
    const float = value.asNumber();
    if (@mod(float, 1) != 0) {
        return global.throwRangeError(float, .{ .field_name = "fd", .msg = "an integer" });
    }
    if (float < 0 or float > @as(f64, @floatFromInt(std.math.maxInt(i32)))) {
        return global.throwRangeError(float, .{ .field_name = "fd", .min = 0, .max = std.math.maxInt(i32) });
    }
    const int: i64 = @intFromFloat(float);
    const fd: c_int = @intCast(int);
    // See `fromJS` above for why stdio fds are not remapped to the cached
    // `.system` HANDLE on Windows.
    return .fromUV(fd);
}

/// After calling, the input file descriptor is no longer valid and must not be used.
/// If an error is thrown, the file descriptor is cleaned up for you.
pub fn toJS(any_fd: FD, global: *jsc.JSGlobalObject) JSValue {
    if (!any_fd.isValid()) {
        return JSValue.jsNumberFromInt32(-1);
    }
    const uv_owned_fd = any_fd.makeLibUVOwned() catch {
        any_fd.close();
        const err_instance = (jsc.SystemError{
            .message = bun.String.static("EMFILE, too many open files"),
            .code = bun.String.static("EMFILE"),
        }).toErrorInstance(global);
        return global.vm().throwError(global, err_instance) catch .zero;
    };
    return JSValue.jsNumberFromInt32(uv_owned_fd.uv());
}

/// Convert an FD to a JavaScript number without transferring ownership to libuv.
/// Unlike toJS(), this does not call makeLibUVOwned() on Windows, so the caller
/// retains ownership and must close the FD themselves.
/// Returns -1 for invalid file descriptors.
/// On Windows: returns Uint64 for system handles, Int32 for uv file descriptors.
pub fn toJSWithoutMakingLibUVOwned(any_fd: FD) JSValue {
    if (!any_fd.isValid()) {
        return JSValue.jsNumberFromInt32(-1);
    }
    if (Environment.isWindows) {
        return switch (any_fd.kind) {
            .system => JSValue.jsNumberFromUint64(@intCast(any_fd.value.as_system)),
            .uv => JSValue.jsNumberFromInt32(any_fd.value.as_uv),
        };
    }
    return JSValue.jsNumberFromInt32(any_fd.value.as_system);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
