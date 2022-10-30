const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

/// String type that stores either an offset/length into an external buffer or a string inline directly
pub const String = extern struct {
    pub const max_inline_len: usize = 8;
    /// This is three different types of string.
    /// 1. Empty string. If it's all zeroes, then it's an empty string.
    /// 2. If the final bit is set, then it's a string that is stored inline.
    /// 3. If the final bit is not set, then it's a string that is stored in an external buffer.
    bytes: [max_inline_len]u8 = [8]u8{ 0, 0, 0, 0, 0, 0, 0, 0 },

    pub const Tag = enum {
        small,
        big,
    };

    pub inline fn fmt(self: *const String, buf: []const u8) Formatter {
        return Formatter{
            .buf = buf,
            .str = self,
        };
    }

    pub const Formatter = struct {
        str: *const String,
        buf: string,

        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const str = formatter.str;
            try writer.writeAll(str.slice(formatter.buf));
        }
    };

    pub inline fn order(
        lhs: *const String,
        rhs: *const String,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        return std.mem.order(u8, lhs.slice(lhs_buf), rhs.slice(rhs_buf));
    }

    pub inline fn canInline(buf: []const u8) bool {
        return switch (buf.len) {
            0...max_inline_len - 1 => true,
            max_inline_len => buf[max_inline_len - 1] & 0x80 == 0,
            else => false,
        };
    }

    pub inline fn isInline(this: String) bool {
        return this.bytes[max_inline_len - 1] & 0x80 == 0;
    }

    pub inline fn sliced(this: *const String, buf: []const u8) SlicedString {
        return if (this.isInline())
            SlicedString.init(this.slice(""), this.slice(""))
        else
            SlicedString.init(buf, this.slice(buf));
    }

    // https://en.wikipedia.org/wiki/Intel_5-level_paging
    // https://developer.arm.com/documentation/101811/0101/Address-spaces-in-AArch64#:~:text=0%2DA%2C%20the%20maximum%20size,2%2DA.
    // X64 seems to need some of the pointer bits
    const max_addressable_space = u63;

    comptime {
        if (@sizeOf(usize) != 8) {
            @compileError("This code needs to be updated for non-64-bit architectures");
        }
    }

    pub const HashContext = struct {
        a_buf: []const u8,
        b_buf: []const u8,

        pub fn eql(ctx: HashContext, a: String, b: String) bool {
            return a.eql(b, ctx.a_buf, ctx.b_buf);
        }

        pub fn hash(ctx: HashContext, a: String) u64 {
            const str = a.slice(ctx.a_buf);
            return bun.hash(str);
        }
    };

    pub const ArrayHashContext = struct {
        a_buf: []const u8,
        b_buf: []const u8,

        pub fn eql(ctx: ArrayHashContext, a: String, b: String, _: usize) bool {
            return a.eql(b, ctx.a_buf, ctx.b_buf);
        }

        pub fn hash(ctx: ArrayHashContext, a: String) u32 {
            const str = a.slice(ctx.a_buf);
            return @truncate(u32, bun.hash(str));
        }
    };

    pub fn init(
        buf: string,
        in: string,
    ) String {
        return switch (in.len) {
            0 => String{},
            1 => String{ .bytes = .{ in[0], 0, 0, 0, 0, 0, 0, 0 } },
            2 => String{ .bytes = .{ in[0], in[1], 0, 0, 0, 0, 0, 0 } },
            3 => String{ .bytes = .{ in[0], in[1], in[2], 0, 0, 0, 0, 0 } },
            4 => String{ .bytes = .{ in[0], in[1], in[2], in[3], 0, 0, 0, 0 } },
            5 => String{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], 0, 0, 0 } },
            6 => String{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], 0, 0 } },
            7 => String{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], 0 } },
            max_inline_len =>
            // If they use the final bit, then it's a big string.
            // This should only happen for non-ascii strings that are exactly 8 bytes.
            // so that's an edge-case
            if ((in[max_inline_len - 1]) >= 128)
                @bitCast(String, (@as(
                    u64,
                    0,
                ) | @as(
                    u64,
                    @truncate(
                        max_addressable_space,
                        @bitCast(
                            u64,
                            Pointer.init(buf, in),
                        ),
                    ),
                )) | 1 << 63)
            else
                String{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], in[7] } },

            else => @bitCast(
                String,
                (@as(
                    u64,
                    0,
                ) | @as(
                    u64,
                    @truncate(
                        max_addressable_space,
                        @bitCast(
                            u64,
                            Pointer.init(buf, in),
                        ),
                    ),
                )) | 1 << 63,
            ),
        };
    }

    pub fn eql(this: String, that: String, this_buf: []const u8, that_buf: []const u8) bool {
        if (this.isInline() and that.isInline()) {
            return @bitCast(u64, this.bytes) == @bitCast(u64, that.bytes);
        } else if (this.isInline() != that.isInline()) {
            return false;
        } else {
            const a = this.ptr();
            const b = that.ptr();
            return strings.eql(this_buf[0..a.len], that_buf[0..b.len]);
        }
    }

    pub inline fn isEmpty(this: String) bool {
        return @bitCast(u64, this.bytes) == @as(u64, 0);
    }

    pub fn len(this: String) usize {
        switch (this.bytes[max_inline_len - 1] & 128) {
            0 => {
                // Edgecase: string that starts with a 0 byte will be considered empty.
                switch (this.bytes[0]) {
                    0 => {
                        return 0;
                    },
                    else => {
                        comptime var i: usize = 0;

                        inline while (i < this.bytes.len) : (i += 1) {
                            if (this.bytes[i] == 0) return i;
                        }

                        return 8;
                    },
                }
            },
            else => {
                const ptr_ = this.ptr();
                return ptr_.len;
            },
        }
    }

    pub const Pointer = extern struct {
        off: u32 = 0,
        len: u32 = 0,

        pub inline fn init(
            buf: string,
            in: string,
        ) Pointer {
            std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr) and ((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len)));

            return Pointer{
                .off = @truncate(u32, @ptrToInt(in.ptr) - @ptrToInt(buf.ptr)),
                .len = @truncate(u32, in.len),
            };
        }
    };

    pub inline fn ptr(this: String) Pointer {
        return @bitCast(Pointer, @as(u64, @truncate(u63, @bitCast(u64, this))));
    }

    // String must be a pointer because we reference it as a slice. It will become a dead pointer if it is copied.
    pub fn slice(this: *const String, buf: string) string {
        switch (this.bytes[max_inline_len - 1] & 128) {
            0 => {
                // Edgecase: string that starts with a 0 byte will be considered empty.
                switch (this.bytes[0]) {
                    0 => {
                        return "";
                    },
                    else => {
                        comptime var i: usize = 0;

                        inline while (i < this.bytes.len) : (i += 1) {
                            if (this.bytes[i] == 0) return this.bytes[0..i];
                        }

                        return &this.bytes;
                    },
                }
            },
            else => {
                const ptr_ = this.*.ptr();
                return buf[ptr_.off..][0..ptr_.len];
            },
        }
    }

    pub const Builder = struct {
        const Allocator = @import("std").mem.Allocator;
        const assert = @import("std").debug.assert;
        const copy = @import("std").mem.copy;
        const IdentityContext = @import("../identity_context.zig").IdentityContext;

        len: usize = 0,
        cap: usize = 0,
        ptr: ?[*]u8 = null,
        string_pool: StringPool = undefined,

        pub const StringPool = std.HashMap(u64, String, IdentityContext(u64), 80);

        pub inline fn stringHash(buf: []const u8) u64 {
            return std.hash.Wyhash.hash(0, buf);
        }

        pub inline fn count(this: *Builder, slice_: string) void {
            return countWithHash(this, slice_, if (slice_.len >= String.max_inline_len) stringHash(slice_) else std.math.maxInt(u64));
        }

        pub inline fn countWithHash(this: *Builder, slice_: string, hash: u64) void {
            if (slice_.len <= String.max_inline_len) return;

            if (!this.string_pool.contains(hash)) {
                this.cap += slice_.len;
            }
        }

        pub inline fn allocatedSlice(this: *Builder) []u8 {
            return if (this.cap > 0)
                this.ptr.?[0..this.cap]
            else
                &[_]u8{};
        }
        pub fn allocate(this: *Builder, allocator: std.mem.Allocator) !void {
            var ptr_ = try allocator.alloc(u8, this.cap);
            this.ptr = ptr_.ptr;
        }

        pub fn append(this: *Builder, comptime Type: type, slice_: string) Type {
            return @call(.{ .modifier = .always_inline }, appendWithHash, .{ this, Type, slice_, stringHash(slice_) });
        }

        // SlicedString is not supported due to inline strings.
        pub fn appendWithoutPool(this: *Builder, comptime Type: type, slice_: string, hash: u64) Type {
            if (slice_.len < String.max_inline_len) {
                switch (Type) {
                    String => {
                        return String.init(this.allocatedSlice(), slice_);
                    },
                    ExternalString => {
                        return ExternalString.init(this.allocatedSlice(), slice_, hash);
                    },
                    else => @compileError("Invalid type passed to StringBuilder"),
                }
            }
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first

            copy(u8, this.ptr.?[this.len..this.cap], slice_);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice_.len];
            this.len += slice_.len;

            assert(this.len <= this.cap);

            switch (Type) {
                String => {
                    return String.init(this.allocatedSlice(), final_slice);
                },
                ExternalString => {
                    return ExternalString.init(this.allocatedSlice(), final_slice, hash);
                },
                else => @compileError("Invalid type passed to StringBuilder"),
            }
        }

        pub fn appendWithHash(this: *Builder, comptime Type: type, slice_: string, hash: u64) Type {
            if (slice_.len < String.max_inline_len) {
                switch (Type) {
                    String => {
                        return String.init(this.allocatedSlice(), slice_);
                    },
                    ExternalString => {
                        return ExternalString.init(this.allocatedSlice(), slice_, hash);
                    },
                    else => @compileError("Invalid type passed to StringBuilder"),
                }
            }

            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first

            var string_entry = this.string_pool.getOrPut(hash) catch unreachable;
            if (!string_entry.found_existing) {
                copy(u8, this.ptr.?[this.len..this.cap], slice_);
                const final_slice = this.ptr.?[this.len..this.cap][0..slice_.len];
                this.len += slice_.len;

                string_entry.value_ptr.* = String.init(this.allocatedSlice(), final_slice);
            }

            assert(this.len <= this.cap);

            switch (Type) {
                String => {
                    return string_entry.value_ptr.*;
                },
                ExternalString => {
                    return ExternalString{
                        .value = string_entry.value_ptr.*,
                        .hash = hash,
                    };
                },
                else => @compileError("Invalid type passed to StringBuilder"),
            }
        }
    };

    comptime {
        if (@sizeOf(String) != @sizeOf(Pointer)) {
            @compileError("String types must be the same size");
        }
    }
};

test "String works" {
    {
        var buf: string = "hello world";
        var world: string = buf[6..];
        var str = String.init(
            buf,
            world,
        );
        try std.testing.expectEqualStrings("world", str.slice(buf));
    }

    {
        var buf: string = "hello";
        var world: string = buf;
        var str = String.init(
            buf,
            world,
        );
        try std.testing.expectEqualStrings("hello", str.slice(buf));
        try std.testing.expectEqual(@bitCast(u64, str), @bitCast(u64, [8]u8{ 'h', 'e', 'l', 'l', 'o', 0, 0, 0 }));
    }

    {
        var buf: string = &[8]u8{ 'h', 'e', 'l', 'l', 'o', 'k', 'k', 129 };
        var world: string = buf;
        var str = String.init(
            buf,
            world,
        );
        try std.testing.expectEqualStrings(buf, str.slice(buf));
    }
}

pub const ExternalString = extern struct {
    value: String = String{},
    hash: u64 = 0,

    pub inline fn fmt(this: *const ExternalString, buf: []const u8) String.Formatter {
        return this.value.fmt(buf);
    }

    pub fn order(lhs: *const ExternalString, rhs: *const ExternalString, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
        if (lhs.hash == rhs.hash and lhs.hash > 0) return .eq;

        return lhs.value.order(&rhs.value, lhs_buf, rhs_buf);
    }

    /// ExternalString but without the hash
    pub inline fn from(in: string) ExternalString {
        return ExternalString{
            .value = String.init(in, in),
            .hash = std.hash.Wyhash.hash(0, in),
        };
    }

    pub inline fn isInline(this: ExternalString) bool {
        return this.value.isInline();
    }

    pub inline fn isEmpty(this: ExternalString) bool {
        return this.value.isEmpty();
    }

    pub inline fn len(this: ExternalString) usize {
        return this.value.len();
    }

    pub inline fn init(buf: string, in: string, hash: u64) ExternalString {
        return ExternalString{
            .value = String.init(buf, in),
            .hash = hash,
        };
    }

    pub inline fn slice(this: ExternalString, buf: string) string {
        return this.value.slice(buf);
    }
};

pub const BigExternalString = extern struct {
    off: u32 = 0,
    len: u32 = 0,
    hash: u64 = 0,

    pub fn from(in: string) BigExternalString {
        return BigExternalString{
            .off = 0,
            .len = @truncate(u32, in.len),
            .hash = std.hash.Wyhash.hash(0, in),
        };
    }

    pub inline fn init(buf: string, in: string, hash: u64) BigExternalString {
        std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr) and ((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len)));

        return BigExternalString{
            .off = @truncate(u32, @ptrToInt(in.ptr) - @ptrToInt(buf.ptr)),
            .len = @truncate(u32, in.len),
            .hash = hash,
        };
    }

    pub fn slice(this: BigExternalString, buf: string) string {
        return buf[this.off..][0..this.len];
    }
};

pub const SlicedString = struct {
    buf: string,
    slice: string,

    pub inline fn init(buf: string, slice: string) SlicedString {
        return SlicedString{ .buf = buf, .slice = slice };
    }

    pub inline fn external(this: SlicedString) ExternalString {
        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.slice.ptr) and ((@ptrToInt(this.slice.ptr) + this.slice.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));

        return ExternalString.init(this.buf, this.slice, std.hash.Wyhash.hash(0, this.slice));
    }

    pub inline fn value(this: SlicedString) String {
        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.slice.ptr) and ((@ptrToInt(this.slice.ptr) + this.slice.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));

        return String.init(this.buf, this.slice);
    }

    pub inline fn sub(this: SlicedString, input: string) SlicedString {
        std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.buf.ptr) and ((@ptrToInt(input.ptr) + input.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));
        return SlicedString{ .buf = this.buf, .slice = input };
    }
};

const RawType = void;
pub const Version = extern struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    tag: Tag = Tag{},
    // raw: RawType = RawType{},

    /// Assumes that there is only one buffer for all the strings
    pub fn sortFn(ctx: []const u8, lhs: Version, rhs: Version) std.math.Order {
        return lhs.order(rhs, ctx, ctx);
    }

    pub fn cloneInto(this: Version, slice: []const u8, buf: *[]u8) Version {
        return Version{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .tag = this.tag.cloneInto(slice, buf),
        };
    }

    pub inline fn len(this: *const Version) u32 {
        return this.tag.build.len + this.tag.pre.len;
    }

    pub fn fmt(this: Version, input: string) Formatter {
        return Formatter{ .version = this, .input = input };
    }

    pub fn count(this: Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        if (this.tag.hasPre() and !this.tag.pre.isInline()) builder.count(this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) builder.count(this.tag.build.slice(buf));
    }

    pub fn clone(this: Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Version {
        var that = this;

        if (this.tag.hasPre() and !this.tag.pre.isInline()) that.tag.pre = builder.append(ExternalString, this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) that.tag.build = builder.append(ExternalString, this.tag.build.slice(buf));

        return that;
    }

    const HashableVersion = extern struct { major: u32, minor: u32, patch: u32, pre: u64, build: u64 };

    pub fn hash(this: Version) u64 {
        const hashable = HashableVersion{ .major = this.major, .minor = this.minor, .patch = this.patch, .pre = this.tag.pre.hash, .build = this.tag.build.hash };
        const bytes = std.mem.asBytes(&hashable);
        return std.hash.Wyhash.hash(0, bytes);
    }

    pub const Formatter = struct {
        version: Version,
        input: string,

        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.version;
            try std.fmt.format(writer, "{d}.{d}.{d}", .{ self.major, self.minor, self.patch });

            if (self.tag.pre.len() > 0) {
                const pre = self.tag.pre.slice(formatter.input);
                try writer.writeAll("-");
                try writer.writeAll(pre);
            }

            if (self.tag.build.len() > 0) {
                const build = self.tag.build.slice(formatter.input);
                try writer.writeAll("+");
                try writer.writeAll(build);
            }
        }
    };

    pub fn eql(lhs: Version, rhs: Version) bool {
        return lhs.major == rhs.major and lhs.minor == rhs.minor and lhs.patch == rhs.patch and rhs.tag.eql(lhs.tag);
    }

    pub const HashContext = struct {
        pub fn hash(_: @This(), lhs: Version) u32 {
            return @truncate(u32, lhs.hash());
        }

        pub fn eql(_: @This(), lhs: Version, rhs: Version) bool {
            return lhs.eql(rhs);
        }
    };

    pub fn orderWithoutTag(
        lhs: Version,
        rhs: Version,
    ) std.math.Order {
        if (lhs.major < rhs.major) return .lt;
        if (lhs.major > rhs.major) return .gt;
        if (lhs.minor < rhs.minor) return .lt;
        if (lhs.minor > rhs.minor) return .gt;
        if (lhs.patch < rhs.patch) return .lt;
        if (lhs.patch > rhs.patch) return .gt;

        if (lhs.tag.hasPre() != rhs.tag.hasPre())
            return if (lhs.tag.hasPre()) .lt else .gt;

        if (lhs.tag.hasBuild() != rhs.tag.hasBuild())
            return if (lhs.tag.hasBuild()) .gt else .lt;

        return .eq;
    }

    pub fn order(
        lhs: Version,
        rhs: Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        const order_without_tag = orderWithoutTag(lhs, rhs);
        if (order_without_tag != .eq) return order_without_tag;

        return lhs.tag.order(rhs.tag, lhs_buf, rhs_buf);
    }

    pub const Tag = extern struct {
        pre: ExternalString = ExternalString{},
        build: ExternalString = ExternalString{},

        pub fn order(lhs: Tag, rhs: Tag, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
            const pre_order = lhs.pre.order(&rhs.pre, lhs_buf, rhs_buf);
            if (pre_order != .eq) return pre_order;

            return lhs.build.order(&rhs.build, lhs_buf, rhs_buf);
        }

        pub fn cloneInto(this: Tag, slice: []const u8, buf: *[]u8) Tag {
            var pre: String = this.pre.value;
            var build: String = this.build.value;

            if (this.pre.isInline()) {
                pre = this.pre.value;
            } else {
                const pre_slice = this.pre.slice(slice);
                std.mem.copy(u8, buf.*, pre_slice);
                pre = String.init(buf.*, buf.*[0..pre_slice.len]);
                buf.* = buf.*[pre_slice.len..];
            }

            if (this.build.isInline()) {
                build = this.pre.build;
            } else {
                const build_slice = this.build.slice(slice);
                std.mem.copy(u8, buf.*, build_slice);
                build = String.init(buf.*, buf.*[0..build_slice.len]);
                buf.* = buf.*[build_slice.len..];
            }

            return Tag{
                .pre = .{
                    .value = pre,
                    .hash = this.pre.hash,
                },
                .build = .{
                    .value = this.build,
                    .hash = this.build.hash,
                },
            };
        }

        pub inline fn hasPre(this: Tag) bool {
            return !this.pre.isEmpty();
        }

        pub inline fn hasBuild(this: Tag) bool {
            return !this.build.isEmpty();
        }

        pub fn eql(lhs: Tag, rhs: Tag) bool {
            return lhs.build.hash == rhs.build.hash and lhs.pre.hash == rhs.pre.hash;
        }

        pub const TagResult = struct {
            tag: Tag = Tag{},
            len: u32 = 0,
        };

        var multi_tag_warn = false;
        // TODO: support multiple tags
        pub fn parse(_: std.mem.Allocator, sliced_string: SlicedString) TagResult {
            var input = sliced_string.slice;
            var build_count: u32 = 0;
            var pre_count: u32 = 0;

            for (input) |c| {
                switch (c) {
                    ' ' => break,
                    '+' => {
                        build_count += 1;
                    },
                    '-' => {
                        pre_count += 1;
                    },
                    else => {},
                }
            }

            if (build_count == 0 and pre_count == 0) {
                return TagResult{
                    .len = 0,
                };
            }

            const State = enum { none, pre, build };
            var result = TagResult{};
            // Common case: no allocation is necessary.
            var state = State.none;
            var start: usize = 0;

            var i: usize = 0;

            while (i < input.len) : (i += 1) {
                const c = input[i];
                switch (c) {
                    ' ' => {
                        switch (state) {
                            .none => {},
                            .pre => {
                                result.tag.pre = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.pre.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                            .build => {
                                result.tag.build = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.build.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                        }
                        result.len = @truncate(u32, i);
                        break;
                    },
                    '+' => {
                        // qualifier  ::= ( '-' pre )? ( '+' build )?
                        if (state == .pre) {
                            result.tag.pre = sliced_string.sub(input[start..i]).external();
                            if (comptime Environment.isDebug) {
                                std.debug.assert(!strings.containsChar(result.tag.pre.slice(sliced_string.buf), '-'));
                            }
                        }

                        if (state != .build) {
                            state = .build;
                            start = i + 1;
                        }
                    },
                    '-' => {
                        if (state != .pre) {
                            state = .pre;
                            start = i + 1;
                        }
                    },
                    else => {},
                }
            }

            switch (state) {
                .none => {},
                .pre => {
                    result.tag.pre = sliced_string.sub(input[start..i]).external();
                    // a pre can contain multiple consecutive tags
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.startsWithChar(result.tag.pre.slice(sliced_string.buf), '-'));
                    }
                    state = State.none;
                },
                .build => {
                    // a build can contain multiple consecutive tags
                    result.tag.build = sliced_string.sub(input[start..i]).external();
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.startsWithChar(result.tag.build.slice(sliced_string.buf), '+'));
                    }
                    state = State.none;
                },
            }
            result.len = @truncate(u32, i);

            return result;
        }
    };

    pub const ParseResult = struct {
        wildcard: Query.Token.Wildcard = Query.Token.Wildcard.none,
        valid: bool = true,
        version: Version = Version{},
        stopped_at: u32 = 0,
    };

    pub fn parse(sliced_string: SlicedString, allocator: std.mem.Allocator) ParseResult {
        var input = sliced_string.slice;
        var result = ParseResult{};

        var part_i: u8 = 0;
        var part_start_i: usize = 0;
        var last_char_i: usize = 0;

        if (input.len == 0) {
            result.valid = false;
            return result;
        }
        var is_done = false;
        var stopped_at: i32 = 0;

        var i: usize = 0;

        // two passes :(
        while (i < input.len) {
            if (is_done) {
                break;
            }

            stopped_at = @intCast(i32, i);
            switch (input[i]) {
                ' ' => {
                    is_done = true;
                    break;
                },
                '|', '^', '#', '&', '%', '!' => {
                    is_done = true;
                    stopped_at -= 1;
                    break;
                },
                '0'...'9' => {
                    part_start_i = i;
                    i += 1;

                    while (i < input.len and switch (input[i]) {
                        '0'...'9' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    last_char_i = i;

                    switch (part_i) {
                        0 => {
                            result.version.major = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 1;
                        },
                        1 => {
                            result.version.minor = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 2;
                        },
                        2 => {
                            result.version.patch = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 3;
                        },
                        else => {},
                    }

                    if (i < input.len and switch (input[i]) {
                        '.' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                },
                '.' => {
                    result.valid = false;
                    is_done = true;
                    break;
                },
                '-', '+' => {
                    // Just a plain tag with no version is invalid.

                    if (part_i < 2) {
                        result.valid = false;
                        is_done = true;
                        break;
                    }

                    part_start_i = i;
                    i += 1;
                    while (i < input.len and switch (input[i]) {
                        ' ' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                    const tag_result = Tag.parse(allocator, sliced_string.sub(input[part_start_i..]));
                    result.version.tag = tag_result.tag;
                    i += tag_result.len;
                    break;
                },
                'x', '*', 'X' => {
                    part_start_i = i;
                    i += 1;

                    while (i < input.len and switch (input[i]) {
                        'x', '*', 'X' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    last_char_i = i;

                    if (i < input.len and switch (input[i]) {
                        '.' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    if (result.wildcard == .none) {
                        switch (part_i) {
                            0 => {
                                result.wildcard = Query.Token.Wildcard.major;
                                part_i = 1;
                            },
                            1 => {
                                result.wildcard = Query.Token.Wildcard.minor;
                                part_i = 2;
                            },
                            2 => {
                                result.wildcard = Query.Token.Wildcard.patch;
                                part_i = 3;
                            },
                            else => unreachable,
                        }
                    }
                },
                else => {
                    last_char_i = 0;
                    result.valid = false;
                    is_done = true;
                    break;
                },
            }
        }

        if (result.wildcard == .none) {
            switch (part_i) {
                0 => {
                    result.wildcard = Query.Token.Wildcard.major;
                },
                1 => {
                    result.wildcard = Query.Token.Wildcard.minor;
                },
                2 => {
                    result.wildcard = Query.Token.Wildcard.patch;
                },
                else => {},
            }
        }

        result.stopped_at = @intCast(u32, i);

        if (comptime RawType != void) {
            result.version.raw = sliced_string.sub(input[0..i]).external();
        }

        return result;
    }

    fn parseVersionNumber(input: string) u32 {
        // max decimal u32 is 4294967295
        var bytes: [10]u8 = undefined;
        var byte_i: u8 = 0;

        std.debug.assert(input[0] != '.');

        for (input) |char| {
            switch (char) {
                'X', 'x', '*' => return 0,
                '0'...'9' => {
                    // out of bounds
                    if (byte_i + 1 > bytes.len) return 0;
                    bytes[byte_i] = char;
                    byte_i += 1;
                },
                ' ', '.' => break,
                // ignore invalid characters
                else => {},
            }
        }

        // If there are no numbers, it's 0.
        if (byte_i == 0) return 0;

        if (comptime Environment.isDebug) {
            return std.fmt.parseInt(u32, bytes[0..byte_i], 10) catch |err| {
                Output.prettyErrorln("ERROR {s} parsing version: \"{s}\", bytes: {s}", .{
                    @errorName(err),
                    input,
                    bytes[0..byte_i],
                });
                return 0;
            };
        }

        return std.fmt.parseInt(u32, bytes[0..byte_i], 10) catch 0;
    }
};

pub const Range = struct {
    pub const Op = enum(u8) {
        unset = 0,
        eql = 1,
        lt = 3,
        lte = 4,
        gt = 5,
        gte = 6,
    };

    left: Comparator = Comparator{},
    right: Comparator = Comparator{},

    /// *
    /// >= 0.0.0
    /// >= 0
    /// >= 0.0
    /// >= x
    /// >= 0
    pub fn anyRangeSatisfies(this: *const Range) bool {
        return this.left.op == .gte and this.left.version.eql(Version{});
    }

    pub fn initWildcard(version: Version, wildcard: Query.Token.Wildcard) Range {
        switch (wildcard) {
            .none => {
                return Range{
                    .left = Comparator{
                        .op = Op.eql,
                        .version = version,
                    },
                };
            },

            .major => {
                return Range{
                    .left = Comparator{
                        .op = Op.gte,
                        .version = Version{
                            // .raw = version.raw
                        },
                    },
                };
            },
            .minor => {
                var lhs = Version{
                    // .raw = version.raw
                };
                lhs.major = version.major + 1;

                var rhs = Version{
                    // .raw = version.raw
                };
                rhs.major = version.major;

                return Range{
                    .left = Comparator{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = Comparator{
                        .op = Op.gte,
                        .version = rhs,
                    },
                };
            },
            .patch => {
                var lhs = Version{};
                lhs.major = version.major;
                lhs.minor = version.minor + 1;

                var rhs = Version{};
                rhs.major = version.major;
                rhs.minor = version.minor;

                // rhs.raw = version.raw;
                // lhs.raw = version.raw;

                return Range{
                    .left = Comparator{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = Comparator{
                        .op = Op.gte,
                        .version = rhs,
                    },
                };
            },
        }
    }

    pub inline fn hasLeft(this: Range) bool {
        return this.left.op != Op.unset;
    }

    pub inline fn hasRight(this: Range) bool {
        return this.right.op != Op.unset;
    }

    /// Is the Range equal to another Range
    /// This does not evaluate the range.
    pub inline fn eql(lhs: Range, rhs: Range) bool {
        return lhs.left.eql(rhs.left) and lhs.right.eql(rhs.right);
    }

    pub const Comparator = struct {
        op: Op = Op.unset,
        version: Version = Version{},

        pub inline fn eql(lhs: Comparator, rhs: Comparator) bool {
            return lhs.op == rhs.op and lhs.version.eql(rhs.version);
        }

        pub fn satisfies(this: Comparator, version: Version) bool {
            const order = version.orderWithoutTag(this.version);

            return switch (order) {
                .eq => switch (this.op) {
                    .lte, .gte, .eql => true,
                    else => false,
                },
                .gt => switch (this.op) {
                    .gt, .gte => true,
                    else => false,
                },
                .lt => switch (this.op) {
                    .lt, .lte => true,
                    else => false,
                },
            };
        }
    };

    pub fn satisfies(this: Range, version: Version) bool {
        if (!this.hasLeft()) {
            return true;
        }

        if (!this.left.satisfies(version)) {
            return false;
        }

        if (this.hasRight() and !this.right.satisfies(version)) {
            return false;
        }

        return true;
    }
};

/// Linked-list of AND ranges
/// "^1 ^2"
/// ----|-----
/// That is two Query
pub const Query = struct {
    pub const Op = enum {
        none,
        AND,
        OR,
    };

    range: Range = Range{},

    // AND
    next: ?*Query = null,

    /// Linked-list of Queries OR'd together
    /// "^1 || ^2"
    /// ----|-----
    /// That is two List
    pub const List = struct {
        head: Query = Query{},
        tail: ?*Query = null,

        // OR
        next: ?*List = null,

        pub inline fn satisfies(this: *const List, version: Version) bool {
            return this.head.satisfies(version) or (this.next orelse return false).satisfies(version);
        }

        pub inline fn eql(lhs: *const List, rhs: *const List) bool {
            if (!lhs.head.eql(&rhs.head)) return false;

            var lhs_next = lhs.next orelse return rhs.next == null;
            var rhs_next = rhs.next orelse return false;

            return lhs_next.eql(rhs_next);
        }

        pub fn andRange(self: *List, allocator: std.mem.Allocator, range: Range) !void {
            if (!self.head.range.hasLeft() and !self.head.range.hasRight()) {
                self.head.range = range;
                return;
            }

            var tail = try allocator.create(Query);
            tail.* = Query{
                .range = range,
            };
            tail.range = range;

            var last_tail = self.tail orelse &self.head;
            last_tail.next = tail;
            self.tail = tail;
        }
    };

    pub const Group = struct {
        head: List = List{},
        tail: ?*List = null,
        allocator: std.mem.Allocator,
        input: string = "",

        flags: FlagsBitSet = FlagsBitSet.initEmpty(),
        pub const Flags = struct {
            pub const pre = 1;
            pub const build = 0;
        };

        pub const FlagsBitSet = std.bit_set.IntegerBitSet(3);

        pub fn isExact(this: *const Group) bool {
            return this.head.next == null and this.head.head.next == null and !this.head.head.range.hasRight() and this.head.head.range.left.op == .eql;
        }

        pub inline fn eql(lhs: Group, rhs: Group) bool {
            return lhs.head.eql(&rhs.head);
        }

        pub fn toVersion(this: Group) Version {
            std.debug.assert(this.isExact());
            return this.head.head.range.left.version;
        }

        pub fn orVersion(self: *Group, version: Version) !void {
            if (self.tail == null and !self.head.head.range.hasLeft()) {
                self.head.head.range.left.version = version;
                self.head.head.range.left.op = .eql;
                return;
            }

            var new_tail = try self.allocator.create(List);
            new_tail.* = List{};
            new_tail.head.range.left.version = version;
            new_tail.head.range.left.op = .eql;

            var prev_tail = self.tail orelse &self.head;
            prev_tail.next = new_tail;
            self.tail = new_tail;
        }

        pub fn andRange(self: *Group, range: Range) !void {
            var tail = self.tail orelse &self.head;
            try tail.andRange(self.allocator, range);
        }

        pub fn orRange(self: *Group, range: Range) !void {
            if (self.tail == null and self.head.tail == null and !self.head.head.range.hasLeft()) {
                self.head.head.range = range;
                return;
            }

            var new_tail = try self.allocator.create(List);
            new_tail.* = List{};
            new_tail.head.range = range;

            var prev_tail = self.tail orelse &self.head;
            prev_tail.next = new_tail;
            self.tail = new_tail;
        }

        pub inline fn satisfies(this: *const Group, version: Version) bool {
            return this.head.satisfies(version);
        }
    };

    pub fn eql(lhs: *const Query, rhs: *const Query) bool {
        if (!lhs.range.eql(rhs.range)) return false;

        const lhs_next = lhs.next orelse return rhs.next == null;
        const rhs_next = rhs.next orelse return false;

        return lhs_next.eql(rhs_next);
    }

    pub inline fn satisfies(this: *const Query, version: Version) bool {
        const left = this.range.satisfies(version);

        return left and (this.next orelse return true).satisfies(version);
    }

    pub const Token = struct {
        tag: Tag = Tag.none,
        wildcard: Wildcard = Wildcard.none,

        pub fn toRange(this: Token, version: Version) Range {
            switch (this.tag) {
                // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
                .caret => {
                    var right_version = version;
                    // https://github.com/npm/node-semver/blob/cb1ca1d5480a6c07c12ac31ba5f2071ed530c4ed/classes/range.js#L310-L336
                    if (right_version.major == 0) {
                        if (right_version.minor == 0) {
                            right_version.patch += 1;
                        } else {
                            right_version.minor += 1;
                            right_version.patch = 0;
                        }
                    } else {
                        right_version.major += 1;
                        right_version.patch = 0;
                        right_version.minor = 0;
                    }

                    return Range{
                        .left = .{
                            .op = .gte,
                            .version = version,
                        },
                        .right = .{
                            .op = .lt,
                            .version = right_version,
                        },
                    };
                },
                .tilda => {
                    if (this.wildcard == .minor or this.wildcard == .major) {
                        return Range.initWildcard(version, .minor);
                    }

                    // This feels like it needs to be tested more.
                    var right_version = version;
                    right_version.minor += 1;
                    right_version.patch = 0;

                    return Range{
                        .left = .{
                            .op = .gte,
                            .version = version,
                        },
                        .right = .{
                            .op = .lt,
                            .version = right_version,
                        },
                    };
                },
                .none => unreachable,
                .version => {
                    if (this.wildcard != Wildcard.none) {
                        return Range.initWildcard(version, this.wildcard);
                    }

                    return Range{ .left = .{ .op = .eql, .version = version } };
                },
                else => {},
            }

            return switch (this.wildcard) {
                .major => Range{
                    .left = .{ .op = .gte, .version = version },
                    .right = .{
                        .op = .lte,
                        .version = Version{
                            .major = std.math.maxInt(u32),
                            .minor = std.math.maxInt(u32),
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },
                .minor => switch (this.tag) {
                    .lte => Range{
                        .left = .{
                            .op = .lte,
                            .version = Version{
                                .major = version.major,
                                .minor = std.math.maxInt(u32),
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },
                    .lt => Range{
                        .left = .{
                            .op = .lt,
                            .version = Version{
                                .major = version.major,
                                .minor = 0,
                                .patch = 0,
                            },
                        },
                    },

                    .gt => Range{
                        .left = .{
                            .op = .gt,
                            .version = Version{
                                .major = version.major,
                                .minor = std.math.maxInt(u32),
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },

                    .gte => Range{
                        .left = .{
                            .op = .gte,
                            .version = Version{
                                .major = version.major,
                                .minor = 0,
                                .patch = 0,
                            },
                        },
                    },
                    else => unreachable,
                },
                .patch => switch (this.tag) {
                    .lte => Range{
                        .left = .{
                            .op = .lte,
                            .version = Version{
                                .major = version.major,
                                .minor = version.minor,
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },
                    .lt => Range{
                        .left = .{
                            .op = .lt,
                            .version = Version{
                                .major = version.major,
                                .minor = version.minor,
                                .patch = 0,
                            },
                        },
                    },

                    .gt => Range{
                        .left = .{
                            .op = .gt,
                            .version = Version{
                                .major = version.major,
                                .minor = version.minor,
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },

                    .gte => Range{
                        .left = .{
                            .op = .gte,
                            .version = Version{
                                .major = version.major,
                                .minor = version.minor,
                                .patch = 0,
                            },
                        },
                    },
                    else => unreachable,
                },
                .none => Range{
                    .left = .{
                        .op = switch (this.tag) {
                            .gt => .gt,
                            .gte => .gte,
                            .lt => .lt,
                            .lte => .lte,
                            else => unreachable,
                        },
                        .version = version,
                    },
                },
            };
        }

        pub const Tag = enum {
            none,
            gt,
            gte,
            lt,
            lte,
            version,
            tilda,
            caret,
        };

        pub const Wildcard = enum {
            none,
            major,
            minor,
            patch,
        };
    };

    pub fn parse(
        allocator: std.mem.Allocator,
        input: string,
        sliced: SlicedString,
    ) !Group {
        var i: usize = 0;
        var list = Group{
            .allocator = allocator,
            .input = input,
        };

        var token = Token{};
        var prev_token = Token{};

        var count: u8 = 0;
        var skip_round = false;
        var is_or = false;

        while (i < input.len) {
            skip_round = false;

            switch (input[i]) {
                '>' => {
                    if (input.len > i + 1 and input[i + 1] == '=') {
                        token.tag = .gte;
                        i += 1;
                    } else {
                        token.tag = .gt;
                    }

                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                '<' => {
                    if (input.len > i + 1 and input[i + 1] == '=') {
                        token.tag = .lte;
                        i += 1;
                    } else {
                        token.tag = .lt;
                    }

                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                '=', 'v' => {
                    token.tag = .version;
                    is_or = true;
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                '~' => {
                    token.tag = .tilda;
                    i += 1;

                    if (i < input.len and input[i] == '>') i += 1;

                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                '^' => {
                    token.tag = .caret;
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                '0'...'9', 'X', 'x', '*' => {
                    token.tag = .version;
                    is_or = true;
                },
                '|' => {
                    i += 1;

                    while (i < input.len and input[i] == '|') : (i += 1) {}
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                    is_or = true;
                    token.tag = Token.Tag.none;
                    skip_round = true;
                },
                '-' => {
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                },
                ' ' => {
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                    skip_round = true;
                },
                else => {
                    i += 1;
                    token.tag = Token.Tag.none;
                    skip_round = true;
                },
            }

            if (!skip_round) {
                const parse_result = Version.parse(sliced.sub(input[i..]), allocator);
                if (parse_result.version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                if (parse_result.version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

                token.wildcard = parse_result.wildcard;

                i += parse_result.stopped_at;
                const rollback = i;

                const had_space = i < input.len and input[i] == ' ';

                // TODO: can we do this without rolling back?
                const hyphenate: bool = had_space and possibly_hyphenate: {
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                    if (!(i < input.len and input[i] == '-')) break :possibly_hyphenate false;
                    i += 1;
                    if (!(i < input.len and input[i] == ' ')) break :possibly_hyphenate false;
                    i += 1;
                    while (i < input.len and switch (input[i]) {
                        ' ', 'v', '=' => true,
                        else => false,
                    }) : (i += 1) {}
                    if (!(i < input.len and switch (input[i]) {
                        '0'...'9', 'X', 'x', '*' => true,
                        else => false,
                    })) break :possibly_hyphenate false;

                    break :possibly_hyphenate true;
                };

                if (!hyphenate) i = rollback;
                i += @as(usize, @boolToInt(!hyphenate));

                if (hyphenate) {
                    var second_version = Version.parse(sliced.sub(input[i..]), allocator);
                    if (second_version.version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                    if (second_version.version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

                    const range: Range = brk: {
                        switch (second_version.wildcard) {
                            .major => {
                                second_version.version.major += 1;
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lte, .version = second_version.version },
                                };
                            },
                            .minor => {
                                second_version.version.major += 1;
                                second_version.version.minor = 0;
                                second_version.version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lt, .version = second_version.version },
                                };
                            },
                            .patch => {
                                second_version.version.minor += 1;
                                second_version.version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lt, .version = second_version.version },
                                };
                            },
                            .none => {
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lte, .version = second_version.version },
                                };
                            },
                        }
                    };

                    if (is_or) {
                        try list.orRange(range);
                    } else {
                        try list.andRange(range);
                    }

                    i += second_version.stopped_at + 1;
                } else if (count == 0 and token.tag == .version) {
                    switch (parse_result.wildcard) {
                        .none => {
                            try list.orVersion(parse_result.version);
                        },
                        else => {
                            try list.orRange(token.toRange(parse_result.version));
                        },
                    }
                } else if (count == 0) {
                    try list.andRange(token.toRange(parse_result.version));
                } else if (is_or) {
                    try list.orRange(token.toRange(parse_result.version));
                } else {
                    try list.andRange(token.toRange(parse_result.version));
                }

                is_or = false;
                count += 1;
                token.wildcard = .none;
                prev_token.tag = token.tag;
            }
        }

        return list;
    }
};

const expect = struct {
    pub var counter: usize = 0;
    pub fn isRangeMatch(input: string, version_str: string) bool {
        var parsed = Version.parse(SlicedString.init(version_str, version_str), default_allocator);
        std.debug.assert(parsed.valid);
        // std.debug.assert(strings.eql(parsed.version.raw.slice(version_str), version_str));

        var list = Query.parse(
            default_allocator,
            input,
            SlicedString.init(input, input),
        ) catch |err| Output.panic("Test fail due to error {s}", .{@errorName(err)});

        return list.satisfies(parsed.version);
    }

    pub fn range(input: string, version_str: string, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        if (!isRangeMatch(input, version_str)) {
            Output.panic("<r><red>Fail<r> Expected range <b>\"{s}\"<r> to match <b>\"{s}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                version_str,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }
    pub fn notRange(input: string, version_str: string, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        if (isRangeMatch(input, version_str)) {
            Output.panic("<r><red>Fail<r> Expected range <b>\"{s}\"<r> NOT match <b>\"{s}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                version_str,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }

    pub fn done(src: std.builtin.SourceLocation) void {
        Output.prettyErrorln("<r><green>{d} passed expectations <d>in {s}<r>", .{ counter, src.fn_name });
        Output.flush();
        counter = 0;
    }

    pub fn version(input: string, v: [3]u32, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        var result = Version.parse(SlicedString.init(input, input), default_allocator);
        var other = Version{ .major = v[0], .minor = v[1], .patch = v[2] };
        std.debug.assert(result.valid);

        if (!other.eql(result.version)) {
            Output.panic("<r><red>Fail<r> Expected version <b>\"{s}\"<r> to match <b>\"{d}.{d}.{d}\" but received <red>\"{d}.{d}.{d}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                v[0],
                v[1],
                v[2],
                result.version.major,
                result.version.minor,
                result.version.patch,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }

    pub fn versionT(input: string, v: Version, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;

        var result = Version.parse(SlicedString.init(input, input), default_allocator);
        if (!v.eql(result.version)) {
            Output.panic("<r><red>Fail<r> Expected version <b>\"{s}\"<r> to match <b>\"{s}\" but received <red>\"{}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                v,
                result.version,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }
};

test "Version parsing" {
    defer expect.done(@src());

    expect.version("1.0.0", .{ 1, 0, 0 }, @src());
    expect.version("1.1.0", .{ 1, 1, 0 }, @src());
    expect.version("1.1.1", .{ 1, 1, 1 }, @src());
    expect.version("1.1.0", .{ 1, 1, 0 }, @src());
    expect.version("0.1.1", .{ 0, 1, 1 }, @src());
    expect.version("0.0.1", .{ 0, 0, 1 }, @src());
    expect.version("0.0.0", .{ 0, 0, 0 }, @src());

    expect.version("1.x", .{ 1, 0, 0 }, @src());
    expect.version("2.2.x", .{ 2, 2, 0 }, @src());
    expect.version("2.x.2", .{ 2, 0, 2 }, @src());

    expect.version("1.X", .{ 1, 0, 0 }, @src());
    expect.version("2.2.X", .{ 2, 2, 0 }, @src());
    expect.version("2.X.2", .{ 2, 0, 2 }, @src());

    expect.version("1.*", .{ 1, 0, 0 }, @src());
    expect.version("2.2.*", .{ 2, 2, 0 }, @src());
    expect.version("2.*.2", .{ 2, 0, 2 }, @src());
    expect.version("3", .{ 3, 0, 0 }, @src());
    expect.version("3.x", .{ 3, 0, 0 }, @src());
    expect.version("3.x.x", .{ 3, 0, 0 }, @src());
    expect.version("3.*.*", .{ 3, 0, 0 }, @src());
    expect.version("3.X.x", .{ 3, 0, 0 }, @src());

    expect.version("0.0.0", .{ 0, 0, 0 }, @src());

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-beta";
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-build101";
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 0,
            .minor = 21,
            .patch = 0,
        };
        var input: string = "0.21.0-beta-96ca8d915-20211115";
        v.tag.pre = SlicedString.init(input, input["0.21.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-beta+build101";
        v.tag.build = SlicedString.init(input, input["1.0.0-beta+".len..]).external();
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..][0..4]).external();
        expect.versionT(input, v, @src());
    }

    var buf: [1024]u8 = undefined;

    var triplet = [3]u32{ 0, 0, 0 };
    var x: u32 = 0;
    var y: u32 = 0;
    var z: u32 = 0;

    while (x < 32) : (x += 1) {
        while (y < 32) : (y += 1) {
            while (z < 32) : (z += 1) {
                triplet[0] = x;
                triplet[1] = y;
                triplet[2] = z;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ x, y, z }), triplet, @src());
                triplet[0] = z;
                triplet[1] = x;
                triplet[2] = y;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ z, x, y }), triplet, @src());

                triplet[0] = y;
                triplet[1] = x;
                triplet[2] = z;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ y, x, z }), triplet, @src());
            }
        }
    }
}

test "Range parsing" {
    defer expect.done(@src());

    expect.range("~1.2.3", "1.2.3", @src());
    expect.range("~1.2", "1.2.0", @src());
    expect.range("~1", "1.0.0", @src());
    expect.range("~1", "1.2.0", @src());
    expect.range("~1", "1.2.999", @src());
    expect.range("~0.2.3", "0.2.3", @src());
    expect.range("~0.2", "0.2.0", @src());
    expect.range("~0.2", "0.2.1", @src());

    expect.range("~0 ", "0.0.0", @src());

    expect.notRange("~1.2.3", "1.3.0", @src());
    expect.notRange("~1.2", "1.3.0", @src());
    expect.notRange("~1", "2.0.0", @src());
    expect.notRange("~0.2.3", "0.3.0", @src());
    expect.notRange("~0.2.3", "1.0.0", @src());
    expect.notRange("~0 ", "1.0.0", @src());
    expect.notRange("~0.2", "0.1.0", @src());
    expect.notRange("~0.2", "0.3.0", @src());

    expect.notRange("~3.0.5", "3.3.0", @src());

    expect.range("^1.1.4", "1.1.4", @src());

    expect.range(">=3", "3.5.0", @src());
    expect.notRange(">=3", "2.999.999", @src());
    expect.range(">=3", "3.5.1", @src());
    expect.range(">=3", "4", @src());

    expect.range("<6 >= 5", "5.0.0", @src());
    expect.notRange("<6 >= 5", "4.0.0", @src());
    expect.notRange("<6 >= 5", "6.0.0", @src());
    expect.notRange("<6 >= 5", "6.0.1", @src());

    expect.range(">2", "3", @src());
    expect.notRange(">2", "2.1", @src());
    expect.notRange(">2", "2", @src());
    expect.notRange(">2", "1.0", @src());
    expect.notRange(">1.3", "1.3.1", @src());
    expect.range(">1.3", "2.0.0", @src());
    expect.range(">2.1.0", "2.2.0", @src());
    expect.range("<=2.2.99999", "2.2.0", @src());
    expect.range(">=2.1.99999", "2.2.0", @src());
    expect.range("<2.2.99999", "2.2.0", @src());
    expect.range(">2.1.99999", "2.2.0", @src());
    expect.range(">1.0.0", "2.0.0", @src());
    expect.range("1.0.0", "1.0.0", @src());
    expect.notRange("1.0.0", "2.0.0", @src());

    expect.range("1.0.0 || 2.0.0", "1.0.0", @src());
    expect.range("2.0.0 || 1.0.0", "1.0.0", @src());
    expect.range("1.0.0 || 2.0.0", "2.0.0", @src());
    expect.range("2.0.0 || 1.0.0", "2.0.0", @src());
    expect.range("2.0.0 || >1.0.0", "2.0.0", @src());

    expect.range(">1.0.0 <2.0.0 <2.0.1 >1.0.1", "1.0.2", @src());

    expect.range("2.x", "2.0.0", @src());
    expect.range("2.x", "2.1.0", @src());
    expect.range("2.x", "2.2.0", @src());
    expect.range("2.x", "2.3.0", @src());
    expect.range("2.x", "2.1.1", @src());
    expect.range("2.x", "2.2.2", @src());
    expect.range("2.x", "2.3.3", @src());

    expect.range("<2.0.1 >1.0.0", "2.0.0", @src());
    expect.range("<=2.0.1 >=1.0.0", "2.0.0", @src());

    expect.range("^2", "2.0.0", @src());
    expect.range("^2", "2.9.9", @src());
    expect.range("~2", "2.0.0", @src());
    expect.range("~2", "2.1.0", @src());
    expect.range("~2.2", "2.2.1", @src());

    {
        const passing = [_]string{ "2.4.0", "2.4.1", "3.0.0", "3.0.1", "3.1.0", "3.2.0", "3.3.0", "3.3.1", "3.4.0", "3.5.0", "3.6.0", "3.7.0", "2.4.2", "3.8.0", "3.9.0", "3.9.1", "3.9.2", "3.9.3", "3.10.0", "3.10.1", "4.0.0", "4.0.1", "4.1.0", "4.2.0", "4.2.1", "4.3.0", "4.4.0", "4.5.0", "4.5.1", "4.6.0", "4.6.1", "4.7.0", "4.8.0", "4.8.1", "4.8.2", "4.9.0", "4.10.0", "4.11.0", "4.11.1", "4.11.2", "4.12.0", "4.13.0", "4.13.1", "4.14.0", "4.14.1", "4.14.2", "4.15.0", "4.16.0", "4.16.1", "4.16.2", "4.16.3", "4.16.4", "4.16.5", "4.16.6", "4.17.0", "4.17.1", "4.17.2", "4.17.3", "4.17.4", "4.17.5", "4.17.9", "4.17.10", "4.17.11", "2.0.0", "2.1.0" };

        for (passing) |item| {
            expect.range("^2 <2.2 || > 2.3", item, @src());
            expect.range("> 2.3 || ^2 <2.2", item, @src());
        }

        const not_passing = [_]string{
            "0.1.0",
            "0.10.0",
            "0.2.0",
            "0.2.1",
            "0.2.2",
            "0.3.0",
            "0.3.1",
            "0.3.2",
            "0.4.0",
            "0.4.1",
            "0.4.2",
            "0.5.0",
            // "0.5.0-rc.1",
            "0.5.1",
            "0.5.2",
            "0.6.0",
            "0.6.1",
            "0.7.0",
            "0.8.0",
            "0.8.1",
            "0.8.2",
            "0.9.0",
            "0.9.1",
            "0.9.2",
            "1.0.0",
            "1.0.1",
            "1.0.2",
            "1.1.0",
            "1.1.1",
            "1.2.0",
            "1.2.1",
            "1.3.0",
            "1.3.1",
            "2.2.0",
            "2.2.1",
            "2.3.0",
            // "1.0.0-rc.1",
            // "1.0.0-rc.2",
            // "1.0.0-rc.3",
        };

        for (not_passing) |item| {
            expect.notRange("^2 <2.2 || > 2.3", item, @src());
            expect.notRange("> 2.3 || ^2 <2.2", item, @src());
        }
    }
    expect.range("2.1.0 || > 2.2 || >3", "2.1.0", @src());
    expect.range(" > 2.2 || >3 || 2.1.0", "2.1.0", @src());
    expect.range(" > 2.2 || 2.1.0 || >3", "2.1.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "2.3.0", @src());
    expect.notRange("> 2.2 || 2.1.0 || >3", "2.2.1", @src());
    expect.notRange("> 2.2 || 2.1.0 || >3", "2.2.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "2.3.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "3.0.1", @src());
    expect.range("~2", "2.0.0", @src());
    expect.range("~2", "2.1.0", @src());

    expect.range("1.2.0 - 1.3.0", "1.2.2", @src());
    expect.range("1.2 - 1.3", "1.2.2", @src());
    expect.range("1 - 1.3", "1.2.2", @src());
    expect.range("1 - 1.3", "1.3.0", @src());
    expect.range("1.2 - 1.3", "1.3.1", @src());
    expect.notRange("1.2 - 1.3", "1.4.0", @src());
    expect.range("1 - 1.3", "1.3.1", @src());

    expect.notRange("1.2 - 1.3 || 5.0", "6.4.0", @src());
    expect.range("1.2 - 1.3 || 5.0", "1.2.1", @src());
    expect.range("5.0 || 1.2 - 1.3", "1.2.1", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0.2", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3 || >8", "9.0.2", @src());
}
