const std = @import("std");
pub const string = []const u8;
pub const stringZ = [:0]const u8;
pub const stringMutable = []u8;
pub const CodePoint = i32;
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

    const JSC = @import("root").bun.JSC;
    pub fn fromJS(value: JSC.JSValue, global: *JSC.JSGlobalObject, exception: JSC.C.ExceptionRef) PathString {
        if (!value.jsType().isStringLike()) {
            JSC.JSError(JSC.getAllocator(global), "Only path strings are supported for now", .{}, global, exception);
            return PathString{};
        }
        var zig_str = JSC.ZigString.init("");
        value.toZigString(&zig_str, global);

        return PathString.init(zig_str.slice());
    }

    pub inline fn asRef(this: PathString) JSC.JSValueRef {
        return this.toValue().asObjectRef();
    }

    pub fn estimatedSize(this: *const PathString) usize {
        return @as(usize, this.len);
    }

    pub fn toJS(this: PathString, ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        var zig_str = JSC.ZigString.init(this.slice());
        zig_str.detectEncoding();

        return zig_str.toValueAuto(ctx.ptr()).asObjectRef();
    }

    pub inline fn slice(this: anytype) string {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.
        return @as([*]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len];
    }

    pub inline fn sliceAssumeZ(this: anytype) stringZ {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.
        return @as([*:0]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len :0];
    }

    pub inline fn init(str: string) @This() {
        @setRuntimeSafety(false); // "cast causes pointer to be null" is fine here. if it is null, the len will be 0.

        return .{
            .ptr = @as(PointerIntType, @truncate(@intFromPtr(str.ptr))),
            .len = @as(PathInt, @truncate(str.len)),
        };
    }

    pub inline fn isEmpty(this: anytype) bool {
        return this.len == 0;
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

pub const HashedString = struct {
    ptr: [*]const u8,
    len: u32,
    hash: u32,

    pub const empty = HashedString{ .ptr = @as([*]const u8, @ptrFromInt(0xDEADBEEF)), .len = 0, .hash = 0 };

    pub fn init(buf: string) HashedString {
        return HashedString{
            .ptr = buf.ptr,
            .len = @as(u32, @truncate(buf.len)),
            .hash = @as(u32, @truncate(bun.hash(buf))),
        };
    }

    pub fn initNoHash(buf: string) HashedString {
        return HashedString{
            .ptr = buf.ptr,
            .len = @as(u32, @truncate(buf.len)),
            .hash = 0,
        };
    }

    pub fn eql(this: HashedString, other: anytype) bool {
        return Eql(this, @TypeOf(other), other);
    }

    pub fn Eql(this: HashedString, comptime Other: type, other: Other) bool {
        switch (comptime Other) {
            HashedString, *HashedString, *const HashedString => {
                return ((@max(this.hash, other.hash) > 0 and this.hash == other.hash) or (this.ptr == other.ptr)) and this.len == other.len;
            },
            else => {
                return @as(usize, this.len) == other.len and @as(u32, @truncate(bun.hash(other[0..other.len]))) == this.hash;
            },
        }
    }

    pub fn str(this: HashedString) string {
        return this.ptr[0..this.len];
    }
};
