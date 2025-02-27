const std = @import("std");
const bun = @import("root").bun;

// macOS sets file path limit to 1024
// Since a pointer on x64 is 64 bits and only 46 bits are used
// We can safely store the entire path slice in a single u64.
pub const PathString = packed struct {
    const PathIntLen = std.math.IntFittingRange(0, bun.MAX_PATH_BYTES);
    pub const use_small_path_string = @bitSizeOf(usize) - @bitSizeOf(PathIntLen) >= 53;
    pub const PathInt = if (use_small_path_string) PathIntLen else usize;
    pub const PointerIntType = if (use_small_path_string) u53 else usize;
    ptr: PointerIntType = 0,
    len: PathInt = 0,

    const JSC = bun.JSC;

    pub fn estimatedSize(this: *const PathString) usize {
        return @as(usize, this.len);
    }

    pub inline fn slice(this: anytype) []const u8 {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.
        return @as([*]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len];
    }

    pub inline fn sliceAssumeZ(this: anytype) [:0]const u8 {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.
        return @as([*:0]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len :0];
    }

    pub inline fn init(str: []const u8) @This() {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.

        return .{
            .ptr = @as(PointerIntType, @truncate(@intFromPtr(str.ptr))),
            .len = @as(PathInt, @truncate(str.len)),
        };
    }

    pub inline fn isEmpty(this: anytype) bool {
        return this.len == 0;
    }

    pub fn format(self: PathString, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try writer.writeAll(self.slice());
    }

    pub const empty = @This(){ .ptr = 0, .len = 0 };
    comptime {
        if (!bun.Environment.isWasm) {
            if (use_small_path_string and @bitSizeOf(@This()) != 64) {
                @compileError("PathString must be 64 bits");
            } else if (!use_small_path_string and @bitSizeOf(@This()) != 128) {
                @compileError("PathString must be 128 bits");
            }
        }
    }
};
