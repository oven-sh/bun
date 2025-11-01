const special_characters = "|\\{}()[]^$+*?.-";

pub fn escapeRegExp(input: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
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
pub fn escapeRegExpForPackageNameMatching(input: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
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

    var input = try input_value.toSlice(global, bun.default_allocator);
    defer input.deinit();

    var buf = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer buf.deinit();

    escapeRegExp(input.slice(), &buf.writer) catch |e| switch (e) {
        error.WriteFailed => return error.OutOfMemory, // Writer.Allocating can only fail with OutOfMemory
    };

    var output = String.cloneUTF8(buf.written());

    return output.toJS(global);
}

pub fn jsEscapeRegExpForPackageNameMatching(global: *JSGlobalObject, call_frame: *jsc.CallFrame) JSError!JSValue {
    const input_value = call_frame.argument(0);

    if (!input_value.isString()) {
        return global.throw("expected string argument", .{});
    }

    var input = try input_value.toSlice(global, bun.default_allocator);
    defer input.deinit();

    var buf = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer buf.deinit();

    escapeRegExpForPackageNameMatching(input.slice(), &buf.writer) catch |e| switch (e) {
        error.WriteFailed => return error.OutOfMemory, // Writer.Allocating can only fail with OutOfMemory
    };

    var output = String.cloneUTF8(buf.written());

    return output.toJS(global);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;
const String = bun.String;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
