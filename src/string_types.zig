const std = @import("std");
const BabyList = @import("./baby_list.zig").BabyList;
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

    const JSC = bun.JSC;

    pub fn estimatedSize(this: *const PathString) usize {
        return @as(usize, this.len);
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

/// This is a string type that stores up to 15 bytes inline on the stack, and heap allocates if it is longer
pub const SmolStr = packed struct {
    __len: u32,
    cap: u32,
    __ptr: [*]u8,

    const Tag: usize = 0x8000000000000000;
    const NegatedTag: usize = ~Tag;

    pub fn jsonStringify(self: *const SmolStr, writer: anytype) !void {
        try writer.write(self.slice());
    }

    pub const Inlined = packed struct {
        data: u120,
        __len: u7,
        _tag: u1,

        pub fn len(this: Inlined) u8 {
            return @intCast(this.__len);
        }

        pub fn setLen(this: *Inlined, new_len: u7) void {
            this.__len = new_len;
        }

        pub fn slice(this: *Inlined) []const u8 {
            return this.allChars()[0..this.__len];
        }

        pub fn allChars(this: *Inlined) *[15]u8 {
            return @as([*]u8, @ptrCast(@as(*u128, @ptrCast(this))))[0..15];
        }
    };

    comptime {
        bun.assert(@sizeOf(SmolStr) == @sizeOf(Inlined));
    }

    pub fn empty() SmolStr {
        const inlined = Inlined{
            .data = 0,
            .__len = 0,
            ._tag = 1,
        };
        return SmolStr.fromInlined(inlined);
    }

    pub fn len(this: *const SmolStr) u32 {
        if (this.isInlined()) {
            return @intCast((@intFromPtr(this.__ptr) >> 56) & 0b01111111);
        }

        return this.__len;
    }

    pub fn ptr(this: *SmolStr) [*]u8 {
        return @ptrFromInt(@as(usize, @intFromPtr(this.__ptr)) & NegatedTag);
    }

    pub fn ptrConst(this: *const SmolStr) [*]const u8 {
        return @ptrFromInt(@as(usize, @intFromPtr(this.__ptr)) & NegatedTag);
    }

    pub fn markInlined(this: *SmolStr) void {
        this.__ptr = @ptrFromInt(@as(usize, @intFromPtr(this.__ptr)) | Tag);
    }

    pub fn markHeap(this: *SmolStr) void {
        this.__ptr = @ptrFromInt(@as(usize, @intFromPtr(this.__ptr)) & NegatedTag);
    }

    pub fn isInlined(this: *const SmolStr) bool {
        return @as(usize, @intFromPtr(this.__ptr)) & Tag != 0;
    }

    pub fn toInlined(this: *const SmolStr) Inlined {
        var inlined: Inlined = @bitCast(@as(u128, @bitCast(this.*)));
        inlined._tag = 1;
        return inlined;
    }

    pub fn fromBabyList(baby_list: BabyList(u8)) SmolStr {
        var smol_str: SmolStr = .{
            .__len = baby_list.len,
            .cap = baby_list.cap,
            .__ptr = baby_list.ptr,
        };
        smol_str.markHeap();
        return smol_str;
    }

    pub fn fromInlined(inlined: Inlined) SmolStr {
        var smol_str: SmolStr = @bitCast(inlined);
        smol_str.markInlined();
        return smol_str;
    }

    pub fn fromChar(char: u8) SmolStr {
        var inlined = Inlined{
            .data = 0,
            .__len = 1,
            ._tag = 1,
        };

        inlined.allChars()[0] = char;
        inlined.setLen(1);

        return SmolStr.fromInlined(inlined);
    }

    pub fn fromSlice(allocator: std.mem.Allocator, values: []const u8) !SmolStr {
        if (values.len > 15) {
            var baby_list = try BabyList(u8).initCapacity(allocator, values.len);
            baby_list.appendSliceAssumeCapacity(values);
            return SmolStr.fromBabyList(baby_list);
        }

        var inlined = Inlined{
            .data = 0,
            .__len = 0,
            ._tag = 1,
        };

        if (values.len > 0) {
            @memcpy(inlined.allChars()[0..values.len], values[0..values.len]);
            inlined.setLen(@intCast(values.len));
        }

        return SmolStr.fromInlined(inlined);
    }

    pub fn slice(this: *const SmolStr) []const u8 {
        if (this.isInlined()) {
            const bytes: [*]const u8 = @ptrCast(this);
            return bytes[0..this.len()];
        }
        return this.ptrConst()[0..this.__len];
    }

    pub fn appendChar(this: *SmolStr, allocator: std.mem.Allocator, char: u8) !void {
        if (this.isInlined()) {
            var inlined = this.toInlined();
            if (inlined.len() + 1 > 15) {
                var baby_list = try BabyList(u8).initCapacity(allocator, inlined.len() + 1);
                baby_list.appendSliceAssumeCapacity(inlined.slice());
                try baby_list.push(allocator, char);
                // this.* = SmolStr.fromBabyList(baby_list);
                this.__len = baby_list.len;
                this.__ptr = baby_list.ptr;
                this.cap = baby_list.cap;
                this.markHeap();
                return;
            }
            inlined.allChars()[inlined.len()] = char;
            inlined.setLen(@intCast(inlined.len() + 1));
            // this.* = SmolStr.fromInlined(inlined);
            this.* = @bitCast(inlined);
            this.markInlined();
            return;
        }

        var baby_list = BabyList(u8){
            .ptr = this.ptr(),
            .len = this.__len,
            .cap = this.cap,
        };
        try baby_list.push(allocator, char);

        // this.* = SmolStr.fromBabyList(baby_list);
        this.__len = baby_list.len;
        this.__ptr = baby_list.ptr;
        this.cap = baby_list.cap;
        return;
    }

    pub fn appendSlice(this: *SmolStr, allocator: std.mem.Allocator, values: []const u8) !void {
        if (this.isInlined()) {
            var inlined = this.toInlined();
            if (inlined.len() + values.len > 15) {
                var baby_list = try BabyList(u8).initCapacity(allocator, inlined.len() + values.len);
                baby_list.appendSliceAssumeCapacity(inlined.slice());
                baby_list.appendSliceAssumeCapacity(values);
                this.* = SmolStr.fromBabyList(baby_list);
                return;
            }
            @memcpy(inlined.allChars()[inlined.len() .. inlined.len() + values.len], values);
            inlined.setLen(@intCast(inlined.len() + values.len));
            this.* = SmolStr.fromInlined(inlined);
            return;
        }

        var baby_list = BabyList(u8){
            .ptr = this.ptr(),
            .len = this.__len,
            .cap = this.cap,
        };
        try baby_list.append(allocator, values);

        this.* = SmolStr.fromBabyList(baby_list);
        return;
    }
};
