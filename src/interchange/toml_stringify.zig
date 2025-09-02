pub const TOMLStringifyError = error{
    OutOfMemory,
    InvalidValue,
    CircularReference,
    InvalidKey,
    UnsupportedType,
    JSError,
};

pub const TOMLStringifier = struct {
    writer: std.ArrayList(u8),
    allocator: std.mem.Allocator,
    seen_objects: std.HashMap(*anyopaque, void, std.hash_map.AutoContext(*anyopaque), std.hash_map.default_max_load_percentage),

    pub fn init(allocator: std.mem.Allocator) TOMLStringifier {
        return TOMLStringifier{
            .writer = std.ArrayList(u8).init(allocator),
            .allocator = allocator,
            .seen_objects = std.HashMap(*anyopaque, void, std.hash_map.AutoContext(*anyopaque), std.hash_map.default_max_load_percentage).init(allocator),
        };
    }

    pub fn deinit(self: *TOMLStringifier) void {
        self.writer.deinit();
        self.seen_objects.deinit();
    }

    pub fn stringify(self: *TOMLStringifier, globalThis: *JSGlobalObject, value: JSValue) TOMLStringifyError![]const u8 {
        self.stringifyValue(globalThis, value, "", true) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidValue,
        };
        return self.writer.items;
    }

    fn stringifyValue(self: *TOMLStringifier, globalThis: *JSGlobalObject, value: JSValue, key: []const u8, is_root: bool) anyerror!void {
        if (value.isNull() or value.isUndefined()) {
            return;
        }

        if (value.isBoolean()) {
            return self.stringifyBoolean(value, key, is_root);
        }

        if (value.isNumber()) {
            return self.stringifyNumber(value, key, is_root);
        }

        if (value.isString()) {
            return self.stringifyString(globalThis, value, key, is_root);
        }

        // Check for arrays first before objects since arrays are also objects in JS
        if (value.jsType() == .Array) {
            return self.stringifyArray(globalThis, value, key, is_root);
        }

        if (value.isObject()) {
            if (is_root) {
                return self.stringifyRootObject(globalThis, value);
            } else {
                // Non-root objects should be handled as tables in the root pass
                return;
            }
        }

        return error.UnsupportedType;
    }

    fn stringifyBoolean(self: *TOMLStringifier, value: JSValue, key: []const u8, is_root: bool) anyerror!void {
        if (key.len > 0 and !is_root) {
            try self.stringifyKey(key);
            try self.writer.appendSlice(" = ");
        }
        if (value.toBoolean()) {
            try self.writer.appendSlice("true");
        } else {
            try self.writer.appendSlice("false");
        }
        if (!is_root) try self.writer.append('\n');
    }

    fn stringifyNumber(self: *TOMLStringifier, value: JSValue, key: []const u8, is_root: bool) anyerror!void {
        if (key.len > 0 and !is_root) {
            try self.stringifyKey(key);
            try self.writer.appendSlice(" = ");
        }

        const num = value.asNumber();

        // Handle special float values
        if (std.math.isNan(num)) {
            try self.writer.appendSlice("nan");
        } else if (std.math.isPositiveInf(num)) {
            try self.writer.appendSlice("inf");
        } else if (std.math.isNegativeInf(num)) {
            try self.writer.appendSlice("-inf");
        } else if (std.math.floor(num) == num and num >= -9223372036854775808.0 and num <= 9223372036854775807.0) {
            // Integer
            try self.writer.writer().print("{d}", .{@as(i64, @intFromFloat(num))});
        } else {
            // Float
            try self.writer.writer().print("{d}", .{num});
        }

        if (!is_root) try self.writer.append('\n');
    }

    fn stringifyString(self: *TOMLStringifier, globalThis: *JSGlobalObject, value: JSValue, key: []const u8, is_root: bool) anyerror!void {
        if (key.len > 0 and !is_root) {
            try self.stringifyKey(key);
            try self.writer.appendSlice(" = ");
        }

        const str = value.toBunString(globalThis) catch return error.JSError;
        defer str.deref();
        const slice = str.toSlice(self.allocator);
        defer slice.deinit();

        try self.stringifyQuotedString(slice.slice());
        if (!is_root) try self.writer.append('\n');
    }

    fn stringifyArray(self: *TOMLStringifier, globalThis: *JSGlobalObject, array: JSValue, key: []const u8, is_root: bool) anyerror!void {
        if (key.len > 0 and !is_root) {
            try self.stringifyKey(key);
            try self.writer.appendSlice(" = ");
        }

        const length = array.getLength(globalThis) catch return error.JSError;

        try self.writer.append('[');

        const is_multiline = length > 3;
        if (is_multiline) {
            try self.writer.append('\n');
        }

        for (0..length) |i| {
            if (i > 0) {
                try self.writer.appendSlice(", ");
                if (is_multiline) {
                    try self.writer.append('\n');
                }
            }

            if (is_multiline) {
                try self.writer.appendSlice("  ");
            }

            const item = array.getIndex(globalThis, @intCast(i)) catch return error.JSError;
            try self.stringifyValue(globalThis, item, "", true);
        }

        if (is_multiline) {
            try self.writer.append('\n');
        }

        try self.writer.append(']');
        if (!is_root) try self.writer.append('\n');
    }

    fn stringifyRootObject(self: *TOMLStringifier, globalThis: *JSGlobalObject, obj: JSValue) anyerror!void {
        return self.stringifyObjectAtPath(globalThis, obj, "");
    }

    fn stringifyObjectAtPath(self: *TOMLStringifier, globalThis: *JSGlobalObject, obj: JSValue, table_path: []const u8) anyerror!void {
        const obj_val = obj.getObject() orelse return error.InvalidValue;

        // Basic circular reference detection
        const obj_ptr = @as(*anyopaque, @ptrCast(obj_val));
        if (self.seen_objects.contains(obj_ptr)) {
            return error.CircularReference;
        }
        try self.seen_objects.put(obj_ptr, {});
        defer _ = self.seen_objects.remove(obj_ptr);

        // First pass: write simple key-value pairs
        var iterator = jsc.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalThis, obj_val) catch return error.JSError;
        defer iterator.deinit();

        while (try iterator.next()) |prop| {
            const value = iterator.value;
            if (value.isNull() or value.isUndefined()) continue;

            const name = prop.toSlice(self.allocator);
            defer name.deinit();

            // Skip objects for second pass
            if (value.isObject() and value.jsType() != .Array) continue;

            try self.stringifyValue(globalThis, value, name.slice(), false);
        }

        // Second pass: write tables (nested objects)
        var iterator2 = jsc.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalThis, obj_val) catch return error.JSError;
        defer iterator2.deinit();

        var has_written_table = false;
        while (try iterator2.next()) |prop| {
            const value = iterator2.value;
            if (!value.isObject() or value.jsType() == .Array) continue;

            if (has_written_table or self.writer.items.len > 0) {
                try self.writer.append('\n');
            }
            has_written_table = true;

            const name = prop.toSlice(self.allocator);
            defer name.deinit();

            // Build full table path
            var path_buf = std.ArrayList(u8).init(self.allocator);
            defer path_buf.deinit();

            if (table_path.len > 0) {
                try path_buf.appendSlice(table_path);
                try path_buf.append('.');
            }
            try path_buf.appendSlice(name.slice());

            try self.writer.appendSlice("[");
            // For table paths, handle dotted keys specially
            try self.stringifyTablePath(path_buf.items);
            try self.writer.appendSlice("]\n");

            try self.stringifyObjectAtPath(globalThis, value, path_buf.items);
        }
    }

    fn stringifyTablePath(self: *TOMLStringifier, path: []const u8) anyerror!void {
        // Split path by dots and quote each part if needed
        var it = std.mem.splitScalar(u8, path, '.');
        var first = true;
        while (it.next()) |part| {
            if (!first) {
                try self.writer.append('.');
            }
            first = false;
            try self.stringifyKey(part);
        }
    }

    fn stringifyKey(self: *TOMLStringifier, key: []const u8) anyerror!void {
        if (key.len == 0) return error.InvalidKey;

        // Check if key needs quoting
        var needs_quotes = false;

        // Empty key always needs quotes
        if (key.len == 0) needs_quotes = true;

        // Check for characters that require quoting
        for (key) |ch| {
            if (!std.ascii.isAlphanumeric(ch) and ch != '_' and ch != '-') {
                needs_quotes = true;
                break;
            }
        }

        // Check if it starts with a number (bare keys can't start with numbers in some contexts)
        if (key.len > 0 and std.ascii.isDigit(key[0])) {
            needs_quotes = true;
        }

        if (needs_quotes) {
            try self.stringifyQuotedString(key);
        } else {
            try self.writer.appendSlice(key);
        }
    }

    fn stringifyQuotedString(self: *TOMLStringifier, str: []const u8) anyerror!void {
        try self.writer.append('"');
        for (str) |ch| {
            switch (ch) {
                '"' => try self.writer.appendSlice("\\\""),
                '\\' => try self.writer.appendSlice("\\\\"),
                '\n' => try self.writer.appendSlice("\\n"),
                '\r' => try self.writer.appendSlice("\\r"),
                '\t' => try self.writer.appendSlice("\\t"),
                '\x00'...'\x08', '\x0B', '\x0C', '\x0E'...'\x1F', '\x7F' => {
                    // Control characters need unicode escaping
                    try self.writer.writer().print("\\u{X:0>4}", .{ch});
                },
                else => try self.writer.append(ch),
            }
        }
        try self.writer.append('"');
    }
};

pub fn stringify(globalThis: *JSGlobalObject, value: JSValue, allocator: std.mem.Allocator) TOMLStringifyError![]const u8 {
    var stringifier = TOMLStringifier.init(allocator);
    defer stringifier.deinit();
    const result = try stringifier.stringify(globalThis, value);
    // Make a copy since the stringifier will be deinitialized
    const owned_result = allocator.dupe(u8, result) catch return error.OutOfMemory;
    return owned_result;
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
