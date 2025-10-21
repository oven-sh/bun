const special_characters = "|\\{}()[]^$+*?.-";

pub fn escapeRegExp(input: []const u8, writer: anytype) @TypeOf(writer).Error!void {
    var remain = input;

    while (strings.indexOfAny(remain, special_characters)) |i| {
        try writer.writeAll(remain[0..i]);
        switch (remain[i]) {
            '|',
            '\\',
            '{',
            '}',
            '(',
            ')',
            '[',
            ']',
            '^',
            '$',
            '+',
            '*',
            '?',
            '.',
            => |c| try writer.writeAll(&.{ '\\', c }),
            '-' => try writer.writeAll("\\x2d"),
            else => |c| {
                if (comptime Environment.isDebug) {
                    unreachable;
                }
                try writer.writeByte(c);
            },
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

/// '*' becomes '.*' instead of '\\*'
pub fn escapeRegExpForPackageNameMatching(input: []const u8, writer: anytype) @TypeOf(writer).Error!void {
    var remain = input;

    while (strings.indexOfAny(remain, special_characters)) |i| {
        try writer.writeAll(remain[0..i]);
        switch (remain[i]) {
            '|',
            '\\',
            '{',
            '}',
            '(',
            ')',
            '[',
            ']',
            '^',
            '$',
            '+',
            '?',
            '.',
            => |c| try writer.writeAll(&.{ '\\', c }),
            '*' => try writer.writeAll(".*"),
            '-' => try writer.writeAll("\\x2d"),
            else => |c| {
                if (comptime Environment.isDebug) {
                    unreachable;
                }
                try writer.writeByte(c);
            },
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

pub fn jsEscapeRegExp(global: *JSGlobalObject, call_frame: *jsc.CallFrame) JSError!JSValue {
    const input_value = call_frame.argument(0);

    if (!input_value.isString()) {
        return global.throw("expected string argument", .{});
    }

    var input_str = try input_value.toBunString(global);
    defer input_str.deref();

    var input = input_str.toSlice(bun.default_allocator);
    defer input.deinit();

    var buf: bun.collections.ArrayListDefault(u8) = .init();
    defer buf.deinit();

    try escapeRegExp(input.slice(), buf.writer());

    var output = String.cloneUTF8(buf.items());

    return output.toJS(global);
}

pub fn jsEscapeRegExpForPackageNameMatching(global: *JSGlobalObject, call_frame: *jsc.CallFrame) JSError!JSValue {
    const input_value = call_frame.argument(0);

    if (!input_value.isString()) {
        return global.throw("expected string argument", .{});
    }

    var input_str = try input_value.toBunString(global);
    defer input_str.deref();

    var input = input_str.toSlice(bun.default_allocator);
    defer input.deinit();

    var buf: bun.collections.ArrayListDefault(u8) = .init();
    defer buf.deinit();

    try escapeRegExpForPackageNameMatching(input.slice(), buf.writer());

    var output = String.cloneUTF8(buf.items());

    return output.toJS(global);
}

const bun = @import("bun");
const Environment = bun.Environment;
const strings = bun.strings;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const JSError = bun.JSError;
const String = bun.String;
