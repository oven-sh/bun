const std = @import("std");
pub const Environment = @import("./env.zig");

pub const string = []const u8;
pub const stringZ = [:0]const u8;
pub const stringMutable = []u8;
pub const CodePoint = i32;

pub const FeatureFlags = @import("./feature_flags.zig");
pub usingnamespace @import("./global_utils.zig");

pub const use_mimalloc = false;

pub const default_allocator: std.mem.Allocator = std.heap.c_allocator;

pub const huge_allocator: std.mem.Allocator = std.heap.c_allocator;

pub const auto_allocator: std.mem.Allocator = std.heap.c_allocator;

pub const huge_allocator_threshold = 1024 * 256;

pub const strings = @import("./string_immutable.zig");
pub const MutableString = @import("./string_mutable.zig").MutableString;

pub const MAX_PATH_BYTES: usize = std.fs.MAX_PATH_BYTES;

pub const Output = struct {
    pub inline fn isEmojiEnabled() bool {
        return false;
    }

    pub fn prettyErrorln(comptime _: string, _: anytype) void {}

    pub fn initTest() void {}

    pub fn flush() void {}

    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        std.debug.panic(fmt, args);
    }
};

pub const Global = struct {
    pub fn exit(_: u8) void {}

    pub const Mimalloc = @import("./allocators/mimalloc.zig");
};
