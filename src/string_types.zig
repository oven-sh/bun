const std = @import("std");
pub const string = []const u8;
pub const stringZ = [:0]const u8;
pub const stringMutable = []u8;
pub const CodePoint = i32;

// macOS sets file path limit to 1024
// Since a pointer on x64 is 64 bits and only 46 bits are used
// We can safely store the entire path slice in a single u64.
pub const PathString = packed struct {
    const PathIntLen = std.math.IntFittingRange(0, std.fs.MAX_PATH_BYTES);
    pub const use_small_path_string = @bitSizeOf(usize) - @bitSizeOf(PathIntLen) >= 53;
    pub const PathInt = if (use_small_path_string) PathIntLen else usize;
    pub const PointerIntType = if (use_small_path_string) u53 else usize;
    ptr: PointerIntType,
    len: PathInt,

    pub inline fn slice(this: PathString) string {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.
        return @intToPtr([*]u8, @intCast(usize, this.ptr))[0..this.len];
    }

    pub inline fn init(str: string) PathString {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.

        return PathString{
            .ptr = @truncate(PointerIntType, @ptrToInt(str.ptr)),
            .len = @truncate(PathInt, str.len),
        };
    }

    pub inline fn isEmpty(this: PathString) bool {
        return this.len == 0;
    }

    pub const empty = PathString{ .ptr = 0, .len = 0 };
    comptime {
        if (use_small_path_string and @bitSizeOf(PathString) != 64) {
            @compileError("PathString must be 64 bits");
        } else if (!use_small_path_string and @bitSizeOf(PathString) != 128) {
            @compileError("PathString must be 128 bits");
        }
    }
};

pub const HashedString = struct {
    ptr: [*]const u8,
    len: u32,
    hash: u32,

    pub const empty = HashedString{ .ptr = @intToPtr([*]const u8, 0xDEADBEEF), .len = 0, .hash = 0 };

    pub fn init(buf: string) HashedString {
        return HashedString{
            .ptr = buf.ptr,
            .len = @truncate(u32, buf.len),
            .hash = @truncate(u32, std.hash.Wyhash.hash(0, buf)),
        };
    }

    pub fn initNoHash(buf: string) HashedString {
        return HashedString{
            .ptr = buf.ptr,
            .len = @truncate(u32, buf.len),
            .hash = 0,
        };
    }

    pub fn eql(this: HashedString, other: anytype) bool {
        return Eql(this, @TypeOf(other), other);
    }

    pub fn Eql(this: HashedString, comptime Other: type, other: Other) bool {
        switch (comptime Other) {
            HashedString, *HashedString, *const HashedString => {
                return ((@maximum(this.hash, other.hash) > 0 and this.hash == other.hash) or (this.ptr == other.ptr)) and this.len == other.len;
            },
            else => {
                return @as(usize, this.len) == other.len and @truncate(u32, std.hash.Wyhash.hash(0, other[0..other.len])) == this.hash;
            },
        }
    }

    pub fn str(this: HashedString) string {
        return this.ptr[0..len];
    }
};
