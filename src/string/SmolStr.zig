const std = @import("std");
const BabyList = @import("../baby_list.zig").BabyList;
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;

/// This is a string type that stores up to 15 bytes inline on the stack, and heap allocates if it is longer
pub const SmolStr = packed struct(u128) {
    __len: u32,
    cap: u32,
    __ptr: [*]u8,

    const Tag: usize = 0x8000000000000000; // NOTE: only works on little endian systems
    const NegatedTag: usize = ~Tag;

    pub fn jsonStringify(self: *const SmolStr, writer: anytype) !void {
        try writer.write(self.slice());
    }

    pub const Inlined = packed struct(u128) {
        data: u120,
        __len: u7,
        _tag: u1,

        const max_len: comptime_int = @bitSizeOf(@FieldType(Inlined, "data")) / 8;
        const empty: Inlined = .{
            .data = 0,
            .__len = 0,
            ._tag = 1,
        };

        /// ## Errors
        /// if `str` is longer than `max_len`
        pub fn init(str: []const u8) !Inlined {
            if (str.len > max_len) {
                @branchHint(.unlikely);
                return error.StringTooLong;
            }
            var inlined = Inlined.empty;

            if (str.len > 0) {
                @memcpy(inlined.allChars()[0..str.len], str[0..str.len]);
                inlined.setLen(@intCast(str.len));
            }
            return inlined;
        }

        pub inline fn len(this: Inlined) u8 {
            return @intCast(this.__len);
        }

        pub fn setLen(this: *Inlined, new_len: u7) void {
            this.__len = new_len;
        }

        pub fn slice(this: *const Inlined) []const u8 {
            return @constCast(this).ptr()[0..this.__len];
        }

        pub fn sliceMut(this: *Inlined) []u8 {
            return this.ptr()[0..this.__len];
        }

        pub fn allChars(this: *Inlined) *[max_len]u8 {
            return this.ptr()[0..max_len];
        }

        inline fn ptr(this: *Inlined) [*]u8 {
            return @as([*]u8, @ptrCast(@as(*u128, @ptrCast(this))));
        }
    };

    comptime {
        assert(@sizeOf(SmolStr) == @sizeOf(Inlined));
    }

    pub fn empty() SmolStr {
        return SmolStr.fromInlined(Inlined.empty);
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

    /// ## Panics
    /// if `this` is too long to fit in an inlined string
    pub fn toInlined(this: *const SmolStr) Inlined {
        assert(this.len() <= Inlined.max_len);
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
    pub fn deinit(this: *SmolStr, allocator: Allocator) void {
        if (!this.isInlined()) {
            allocator.free(this.slice());
        }
    }

    pub fn fromSlice(allocator: Allocator, values: []const u8) Allocator.Error!SmolStr {
        if (values.len > Inlined.max_len) {
            var baby_list = try BabyList(u8).initCapacity(allocator, values.len);
            baby_list.appendSliceAssumeCapacity(values);
            return SmolStr.fromBabyList(baby_list);
        }

        // SAFETY: we already checked that `values` can fit in an inlined string
        const inlined = Inlined.init(values) catch unreachable;
        return SmolStr.fromInlined(inlined);
    }

    pub fn slice(this: *const SmolStr) []const u8 {
        if (this.isInlined()) {
            const bytes: [*]const u8 = @ptrCast(this);
            return bytes[0..this.len()];
        }
        return this.ptrConst()[0..this.__len];
    }

    pub fn appendChar(this: *SmolStr, allocator: Allocator, char: u8) Allocator.Error!void {
        if (this.isInlined()) {
            var inlined = this.toInlined();
            if (inlined.len() + 1 > Inlined.max_len) {
                var baby_list = try BabyList(u8).initCapacity(allocator, inlined.len() + 1);
                baby_list.appendSliceAssumeCapacity(inlined.slice());
                try baby_list.push(allocator, char);
                this.__len = baby_list.len;
                this.__ptr = baby_list.ptr;
                this.cap = baby_list.cap;
                this.markHeap();
                return;
            }
            inlined.allChars()[inlined.len()] = char;
            inlined.setLen(@intCast(inlined.len() + 1));
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

        this.__len = baby_list.len;
        this.__ptr = baby_list.ptr;
        this.cap = baby_list.cap;
        return;
    }

    pub fn appendSlice(this: *SmolStr, allocator: Allocator, values: []const u8) Allocator.Error!void {
        if (this.isInlined()) {
            var inlined = this.toInlined();
            if (inlined.len() + values.len > Inlined.max_len) {
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

const t = std.testing;

test SmolStr {
    // large strings are heap-allocated
    {
        var str = try SmolStr.fromSlice(t.allocator, "oh wow this is a long string");
        defer str.deinit(t.allocator);
        try t.expectEqualStrings("oh wow this is a long string", str.slice());
        try t.expect(!str.isInlined());
    }

    // small strings are inlined
    {
        var str = try SmolStr.fromSlice(t.allocator, "hello");
        defer str.deinit(t.allocator);
        try t.expectEqualStrings("hello", str.slice());
        try t.expect(str.isInlined());

        // operations that grow a string beyond the inlined capacity force an allocation.
        try str.appendSlice(t.allocator, " world, this makes it too long to be inlined");
        try t.expectEqualStrings("hello world, this makes it too long to be inlined", str.slice());
        try t.expect(!str.isInlined());
    }
}

test "SmolStr.Inlined.init" {
    var hello = try SmolStr.Inlined.init("hello");
    try t.expectEqualStrings("hello", hello.slice());
    try t.expectEqual(5, hello.len());
    try t.expectEqual(1, hello._tag); // 1 = inlined

    try t.expectError(error.StringTooLong, SmolStr.Inlined.init("this string is too long to be inlined within a u120"));

    const empty = try SmolStr.Inlined.init("");
    try t.expectEqual(empty, SmolStr.Inlined.empty);
}

test "Creating an inlined SmolStr does not allocate" {
    var hello = try SmolStr.fromSlice(t.allocator, "hello");
    // no `defer hello.deinit()` to ensure fromSlice does not allocate
    try t.expectEqual(5, hello.len());
    try t.expect(hello.isInlined());
}
