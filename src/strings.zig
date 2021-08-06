const mutable = @import("string_mutable.zig");
const std = @import("std");

pub usingnamespace @import("string_types.zig");

pub const strings = @import("string_immutable.zig");

pub const MutableString = mutable.MutableString;

pub const eql = std.meta.eql;

pub fn NewStringBuilder(comptime size: usize) type {
    return struct {
        const This = @This();
        buffer: [size + 1]u8 = undefined,
        remain: []u8 = undefined,

        pub fn init() This {
            var instance = This{};
            instance.load();
            return instance;
        }

        fn load(this: *This) void {
            this.remain = (&this.buffer)[0..size];
        }

        pub fn append(this: *This, _str: string) void {
            std.mem.copy(u8, this.remain, _str);
            this.remain = this.remain[_str.len..];
        }

        pub fn str(this: *This) string {
            var buf = this.buffer[0 .. @ptrToInt(this.remain.ptr) - @ptrToInt(&this.buffer)];
            // Always leave a sentinel so that anything that expects a sentinel Just Works
            // specifically, the reason for this is so C-based APIs can be used without an extra copy.
            // one byte is cheap...right?
            this.buffer[buf.len] = 0;
            return buf;
        }

        pub fn pop(this: *This, count: usize) string {
            this.remain = this.buffer[0 .. @ptrToInt(this.remain.ptr) - @ptrToInt(&this.buffer) - count];
        }

        pub fn reset(this: *This) void {
            this.load();
        }
    };
}

pub fn nql(a: anytype, b: @TypeOf(a)) bool {
    return !eql(a, b);
}
