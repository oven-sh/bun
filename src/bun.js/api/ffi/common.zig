const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const debug = Output.scoped(.TCC, .visible);

extern fn pthread_jit_write_protect_np(enable: c_int) void;

/// Get the last dynamic library loading error message in a cross-platform way.
/// On POSIX systems, this calls dlerror().
/// On Windows, this uses GetLastError() and formats the error message.
/// Returns an allocated string that must be freed by the caller.
pub fn getDlError(allocator: std.mem.Allocator) ![]const u8 {
    if (Environment.isWindows) {
        // On Windows, we need to use GetLastError() and FormatMessageW()
        const err = bun.windows.GetLastError();
        const err_int = @intFromEnum(err);

        // For now, just return the error code as we'd need to implement FormatMessageW in Zig
        // This is still better than a generic message
        return try std.fmt.allocPrint(allocator, "error code {d}", .{err_int});
    } else {
        // On POSIX systems, use dlerror() to get the actual system error
        const msg = if (std.c.dlerror()) |err_ptr|
            std.mem.span(err_ptr)
        else
            "unknown error";
        // Return a copy since dlerror() string is not stable
        return try allocator.dupe(u8, msg);
    }
}

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
pub fn dangerouslyRunWithoutJitProtections(R: type, func: anytype, args: anytype) R {
    const has_protection = (Environment.isAarch64 and Environment.isMac);
    if (comptime has_protection) pthread_jit_write_protect_np(@intFromBool(false));
    defer if (comptime has_protection) pthread_jit_write_protect_np(@intFromBool(true));
    return @call(.always_inline, func, args);
}

pub const Offsets = extern struct {
    JSArrayBufferView__offsetOfLength: u32,
    JSArrayBufferView__offsetOfByteOffset: u32,
    JSArrayBufferView__offsetOfVector: u32,
    JSCell__offsetOfType: u32,

    extern "c" var Bun__FFI__offsets: Offsets;
    extern "c" fn Bun__FFI__ensureOffsetsAreLoaded() void;
    fn loadOnce() void {
        Bun__FFI__ensureOffsetsAreLoaded();
    }
    var once = std.once(loadOnce);
    pub fn get() *const Offsets {
        once.call();
        return &Bun__FFI__offsets;
    }
};
