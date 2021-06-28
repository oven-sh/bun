const std = @import("std");
usingnamespace @import("../../global.zig");

// This makes it so we get the defines already formatted from the user's environment with the "process.env." prefix set
// This also normalizes quoting
// Currently, it truncates any environment variables to a max of 1024 bytes
pub const NodeEnvBufMap = struct {
    backing: std.BufMap,
    pub fn init(allocator: *std.mem.Allocator) NodeEnvBufMap {
        return NodeEnvBufMap{ .backing = std.BufMap.init(allocator) };
    }
    pub fn get(this: *const NodeEnvBufMap, key: string) ?string {
        return this.backing.get(key);
    }
    pub threadlocal var bufkeybuf: [1024]u8 = undefined;
    pub threadlocal var bufkeybuf_first = true;

    pub fn iterator(this: *NodeEnvBufMap) @typeInfo(@TypeOf(std.BufMap.iterator)).Fn.return_type.? {
        return this.backing.iterator();
    }

    pub fn put(this: *NodeEnvBufMap, key: string, value: anytype) !void {
        if (value.len == 0) {
            return;
        }

        if (bufkeybuf_first) {
            std.mem.copy(u8, &bufkeybuf, "process.env.");
            bufkeybuf_first = false;
        }
        std.mem.copy(u8, bufkeybuf["process.env.".len..], key);
        var key_slice = bufkeybuf[0 .. key.len + "process.env.".len];
        var value_slice = value;
        const max_value_slice_len = std.math.min(value.len, bufkeybuf.len - key_slice.len);
        if (value_slice[0] != '"' and value_slice[value.len - 1] != '"') {
            value_slice = bufkeybuf[key_slice.len..][0 .. max_value_slice_len + 2];
            value_slice[0] = '"';
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
            value_slice[value_slice.len - 1] = '"';
        } else if (value_slice[0] != '"') {
            value_slice[0] = '"';
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
        } else if (value_slice[value.len - 1] != '"') {
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
            value_slice[value_slice.len - 1] = '"';
        }

        return this.backing.put(key_slice, value_slice);
    }

    pub fn count(this: *const NodeEnvBufMap) usize {
        return this.backing.count();
    }

    pub fn deinit(this: *NodeEnvBufMap) void {
        this.backing.deinit();
    }
};

pub fn getNodeEnvMap(allocator: *std.mem.Allocator) !NodeEnvBufMap {
    var result = NodeEnvBufMap.init(allocator);
    errdefer result.deinit();
    const builtin = std.builtin;
    if (builtin.os.tag == .windows) {
        const ptr = os.windows.peb().ProcessParameters.Environment;

        var i: usize = 0;
        while (ptr[i] != 0) {
            const key_start = i;

            while (ptr[i] != 0 and ptr[i] != '=') : (i += 1) {}
            const key_w = ptr[key_start..i];
            const key = try std.unicode.utf16leToUtf8Alloc(allocator, key_w);
            errdefer allocator.free(key);

            if (ptr[i] == '=') i += 1;

            const value_start = i;
            while (ptr[i] != 0) : (i += 1) {}
            const value_w = ptr[value_start..i];
            const value = try std.unicode.utf16leToUtf8Alloc(allocator, value_w);
            errdefer allocator.free(value);

            i += 1; // skip over null byte

            try result.putMove(key, value);
        }
        return result;
    } else if (builtin.os.tag == .wasi) {
        var environ_count: usize = undefined;
        var environ_buf_size: usize = undefined;

        const environ_sizes_get_ret = os.wasi.environ_sizes_get(&environ_count, &environ_buf_size);
        if (environ_sizes_get_ret != os.wasi.ESUCCESS) {
            return os.unexpectedErrno(environ_sizes_get_ret);
        }

        var environ = try allocator.alloc([*:0]u8, environ_count);
        defer allocator.free(environ);
        var environ_buf = try allocator.alloc(u8, environ_buf_size);
        defer allocator.free(environ_buf);

        const environ_get_ret = os.wasi.environ_get(environ.ptr, environ_buf.ptr);
        if (environ_get_ret != os.wasi.ESUCCESS) {
            return os.unexpectedErrno(environ_get_ret);
        }

        for (environ) |env| {
            const pair = mem.spanZ(env);
            var parts = mem.split(pair, "=");
            const key = parts.next().?;
            const value = parts.next().?;
            try result.put(key, value);
        }
        return result;
    } else if (builtin.link_libc) {
        var ptr = std.c.environ;
        while (ptr.*) |line| : (ptr += 1) {
            var line_i: usize = 0;
            while (line[line_i] != 0 and line[line_i] != '=') : (line_i += 1) {}
            const key = line[0..line_i];

            var end_i: usize = line_i;
            while (line[end_i] != 0) : (end_i += 1) {}
            const value = line[line_i + 1 .. end_i];

            try result.put(key, value);
        }
        return result;
    } else {
        for (os.environ) |line| {
            var line_i: usize = 0;
            while (line[line_i] != 0 and line[line_i] != '=') : (line_i += 1) {}
            const key = line[0..line_i];

            var end_i: usize = line_i;
            while (line[end_i] != 0) : (end_i += 1) {}
            const value = line[line_i + 1 .. end_i];

            try result.put(key, value);
        }
        return result;
    }
}
