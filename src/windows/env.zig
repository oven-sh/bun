/// After running `convertEnvToWTF8`, the pointers in `std.os.environ` will point into this buffer.
pub var wtf8_env_buf: ?[]const u8 = null;
/// `convertEnvToWTF8` will set this to the original value of `std.os.environ`.
pub var orig_environ: ?[][*:0]u8 = null;

var env_converted: if (Environment.ci_assert) bool else void = if (Environment.ci_assert) false;

/// Converts all strings in `std.os.environ` to WTF-8.
///
/// This function should be called only once, at program startup, before any code that needs to
/// access the environment runs.
///
/// This function is Windows-only.
pub fn convertEnvToWTF8() bun.OOM!void {
    if (comptime Environment.ci_assert) {
        bun.assertf(!env_converted, "convertEnvToWTF8 may only be called once", .{});
        env_converted = true;
    }
    errdefer if (comptime Environment.ci_assert) {
        env_converted = false;
    };

    var num_vars: usize = 0;
    const wtf8_buf: []u8 = blk: {
        var wtf16_buf: [*:0]u16 = try bun.windows.GetEnvironmentStringsW();
        defer bun.windows.FreeEnvironmentStringsW(wtf16_buf);
        var len: usize = 0;
        while (true) {
            const str_len = std.mem.len(wtf16_buf[len..]);
            len += str_len + 1; // each string is null-terminated
            if (str_len == 0) break; // array ends with empty null-terminated string
            num_vars += 1;
        }
        break :blk try bun.strings.toUTF8AllocWithType(bun.default_allocator, wtf16_buf[0..len]);
    };
    errdefer bun.default_allocator.free(wtf8_buf);
    var len: usize = 0;

    var envp: bun.collections.ArrayListDefault(?[*:0]u8) = try .initCapacity(num_vars + 1);
    errdefer envp.deinit();
    while (true) {
        const str_len = std.mem.indexOfScalar(u8, wtf8_buf[len..], 0).?;
        defer len += str_len + 1; // each string is null-terminated
        if (str_len == 0) break; // array ends with empty null-terminated string
        const str_ptr: [*:0]u8 = @ptrCast(wtf8_buf[len..].ptr);
        try envp.append(str_ptr);
    }
    try envp.append(null);

    const envp_slice: []?[*:0]u8 = try envp.toOwnedSlice();
    const envp_nonnull_slice: [][*:0]u8 = @ptrCast(envp_slice[0 .. envp_slice.len - 1]);
    wtf8_env_buf = wtf8_buf;
    orig_environ = std.os.environ;
    std.os.environ = envp_nonnull_slice;
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
