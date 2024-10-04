const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSC = bun.JSC;
const IdentityContext = @import("../identity_context.zig").IdentityContext;

/// String type that stores either an offset/length into an external buffer or a string inline directly
pub const String = extern struct {
    pub const max_inline_len: usize = 8;
    /// This is three different types of string.
    /// 1. Empty string. If it's all zeroes, then it's an empty string.
    /// 2. If the final bit is set, then it's a string that is stored inline.
    /// 3. If the final bit is not set, then it's a string that is stored in an external buffer.
    bytes: [max_inline_len]u8 = [8]u8{ 0, 0, 0, 0, 0, 0, 0, 0 },

    /// Create an inline string
    pub fn from(comptime inlinable_buffer: []const u8) String {
        comptime {
            if (inlinable_buffer.len > max_inline_len or
                inlinable_buffer.len == max_inline_len and
                inlinable_buffer[max_inline_len - 1] >= 0x80)
            {
                @compileError("string constant too long to be inlined");
            }
        }
        return String.init(inlinable_buffer, inlinable_buffer);
    }

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

    pub fn Sorter(comptime direction: enum { asc, desc }) type {
        return struct {
            lhs_buf: []const u8,
            rhs_buf: []const u8,
            pub fn lessThan(this: @This(), lhs: String, rhs: String) bool {
                return lhs.order(&rhs, this.lhs_buf, this.rhs_buf) == if (comptime direction == .asc) .lt else .gt;
            }
        };
    }

    pub inline fn order(
        lhs: *const String,
        rhs: *const String,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        return strings.order(lhs.slice(lhs_buf), rhs.slice(rhs_buf));
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
            return @as(u32, @truncate(bun.hash(str)));
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
                @as(String, @bitCast((@as(
                    u64,
                    0,
                ) | @as(
                    u64,
                    @as(
                        max_addressable_space,
                        @truncate(@as(
                            u64,
                            @bitCast(Pointer.init(buf, in)),
                        )),
                    ),
                )) | 1 << 63))
            else
                String{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], in[7] } },

            else => @as(
                String,
                @bitCast((@as(
                    u64,
                    0,
                ) | @as(
                    u64,
                    @as(
                        max_addressable_space,
                        @truncate(@as(
                            u64,
                            @bitCast(Pointer.init(buf, in)),
                        )),
                    ),
                )) | 1 << 63),
            ),
        };
    }

    pub fn eql(this: String, that: String, this_buf: []const u8, that_buf: []const u8) bool {
        if (this.isInline() and that.isInline()) {
            return @as(u64, @bitCast(this.bytes)) == @as(u64, @bitCast(that.bytes));
        } else if (this.isInline() != that.isInline()) {
            return false;
        } else {
            const a = this.ptr();
            const b = that.ptr();
            return strings.eql(this_buf[a.off..][0..a.len], that_buf[b.off..][0..b.len]);
        }
    }

    pub inline fn isEmpty(this: String) bool {
        return @as(u64, @bitCast(this.bytes)) == @as(u64, 0);
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
            if (Environment.allow_assert) {
                assert(bun.isSliceInBuffer(in, buf));
            }

            return Pointer{
                .off = @as(u32, @truncate(@intFromPtr(in.ptr) - @intFromPtr(buf.ptr))),
                .len = @as(u32, @truncate(in.len)),
            };
        }
    };

    pub inline fn ptr(this: String) Pointer {
        return @as(Pointer, @bitCast(@as(u64, @as(u63, @truncate(@as(u64, @bitCast(this)))))));
    }

    pub fn toJS(this: *const String, buffer: []const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var str = bun.String.init(this.slice(buffer));
        return str.transferToJS(globalThis);
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
        len: usize = 0,
        cap: usize = 0,
        ptr: ?[*]u8 = null,
        string_pool: StringPool = undefined,

        pub const StringPool = std.HashMap(u64, String, IdentityContext(u64), 80);

        pub inline fn stringHash(buf: []const u8) u64 {
            return bun.Wyhash11.hash(0, buf);
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
        pub fn allocate(this: *Builder, allocator: Allocator) !void {
            const ptr_ = try allocator.alloc(u8, this.cap);
            this.ptr = ptr_.ptr;
        }

        pub fn append(this: *Builder, comptime Type: type, slice_: string) Type {
            return @call(bun.callmod_inline, appendWithHash, .{ this, Type, slice_, stringHash(slice_) });
        }

        pub fn appendUTF8WithoutPool(this: *Builder, comptime Type: type, slice_: string, hash: u64) Type {
            if (slice_.len <= String.max_inline_len) {
                if (strings.isAllASCII(slice_)) {
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
            }

            if (comptime Environment.allow_assert) {
                assert(this.len <= this.cap); // didn't count everything
                assert(this.ptr != null); // must call allocate first
            }

            bun.copy(u8, this.ptr.?[this.len..this.cap], slice_);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice_.len];
            this.len += slice_.len;

            if (comptime Environment.allow_assert) assert(this.len <= this.cap);

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

        // SlicedString is not supported due to inline strings.
        pub fn appendWithoutPool(this: *Builder, comptime Type: type, slice_: string, hash: u64) Type {
            if (slice_.len <= String.max_inline_len) {
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
            if (comptime Environment.allow_assert) {
                assert(this.len <= this.cap); // didn't count everything
                assert(this.ptr != null); // must call allocate first
            }

            bun.copy(u8, this.ptr.?[this.len..this.cap], slice_);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice_.len];
            this.len += slice_.len;

            if (comptime Environment.allow_assert) assert(this.len <= this.cap);

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
            if (slice_.len <= String.max_inline_len) {
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

            if (comptime Environment.allow_assert) {
                assert(this.len <= this.cap); // didn't count everything
                assert(this.ptr != null); // must call allocate first
            }

            const string_entry = this.string_pool.getOrPut(hash) catch unreachable;
            if (!string_entry.found_existing) {
                bun.copy(u8, this.ptr.?[this.len..this.cap], slice_);
                const final_slice = this.ptr.?[this.len..this.cap][0..slice_.len];
                this.len += slice_.len;

                string_entry.value_ptr.* = String.init(this.allocatedSlice(), final_slice);
            }

            if (comptime Environment.allow_assert) assert(this.len <= this.cap);

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
        const world: string = buf[6..];
        var str = String.init(
            buf,
            world,
        );
        try std.testing.expectEqualStrings("world", str.slice(buf));
    }

    {
        const buf: string = "hello";
        const world: string = buf;
        var str = String.init(
            buf,
            world,
        );
        try std.testing.expectEqualStrings("hello", str.slice(buf));
        try std.testing.expectEqual(@as(u64, @bitCast(str)), @as(u64, @bitCast([8]u8{ 'h', 'e', 'l', 'l', 'o', 0, 0, 0 })));
    }

    {
        const buf: string = &[8]u8{ 'h', 'e', 'l', 'l', 'o', 'k', 'k', 129 };
        const world: string = buf;
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
            .hash = bun.Wyhash.hash(0, in),
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

    pub inline fn slice(this: *const ExternalString, buf: string) string {
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
            .len = @as(u32, @truncate(in.len)),
            .hash = bun.Wyhash.hash(0, in),
        };
    }

    pub inline fn init(buf: string, in: string, hash: u64) BigExternalString {
        assert(@intFromPtr(buf.ptr) <= @intFromPtr(in.ptr) and ((@intFromPtr(in.ptr) + in.len) <= (@intFromPtr(buf.ptr) + buf.len)));

        return BigExternalString{
            .off = @as(u32, @truncate(@intFromPtr(in.ptr) - @intFromPtr(buf.ptr))),
            .len = @as(u32, @truncate(in.len)),
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
        if (Environment.allow_assert and !@inComptime()) {
            if (@intFromPtr(buf.ptr) > @intFromPtr(slice.ptr)) {
                @panic("SlicedString.init buf is not in front of slice");
            }
        }
        return SlicedString{ .buf = buf, .slice = slice };
    }

    pub inline fn external(this: SlicedString) ExternalString {
        if (comptime Environment.allow_assert) {
            assert(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.slice.ptr) and ((@intFromPtr(this.slice.ptr) + this.slice.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)));
        }

        return ExternalString.init(this.buf, this.slice, bun.Wyhash11.hash(0, this.slice));
    }

    pub inline fn value(this: SlicedString) String {
        if (comptime Environment.allow_assert) {
            assert(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.slice.ptr) and ((@intFromPtr(this.slice.ptr) + this.slice.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)));
        }

        return String.init(this.buf, this.slice);
    }

    pub inline fn sub(this: SlicedString, input: string) SlicedString {
        if (Environment.allow_assert) {
            if (!(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.buf.ptr) and ((@intFromPtr(input.ptr) + input.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)))) {
                @panic("SlicedString.sub input is not a substring of the slice");
            }
        }
        return SlicedString{ .buf = this.buf, .slice = input };
    }
};

const RawType = void;
pub const Version = extern struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    _tag_padding: [4]u8 = .{0} ** 4, // [see padding_checker.zig]
    tag: Tag = .{},
    // raw: RawType = RawType{},

    /// Assumes that there is only one buffer for all the strings
    pub fn sortGt(ctx: []const u8, lhs: Version, rhs: Version) bool {
        return orderFn(ctx, lhs, rhs) == .gt;
    }

    pub fn orderFn(ctx: []const u8, lhs: Version, rhs: Version) std.math.Order {
        return lhs.order(rhs, ctx, ctx);
    }

    pub fn isZero(this: Version) bool {
        return this.patch == 0 and this.minor == 0 and this.major == 0;
    }

    pub fn parseUTF8(slice: []const u8) ParseResult {
        return parse(.{ .buf = slice, .slice = slice });
    }

    pub fn cloneInto(this: Version, slice: []const u8, buf: *[]u8) Version {
        return .{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .tag = this.tag.cloneInto(slice, buf),
        };
    }

    pub inline fn len(this: *const Version) u32 {
        return this.tag.build.len + this.tag.pre.len;
    }

    pub const Formatter = struct {
        version: Version,
        input: string,

        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.version;
            try std.fmt.format(writer, "{?d}.{?d}.{?d}", .{ self.major, self.minor, self.patch });

            if (self.tag.hasPre()) {
                const pre = self.tag.pre.slice(formatter.input);
                try writer.writeAll("-");
                try writer.writeAll(pre);
            }

            if (self.tag.hasBuild()) {
                const build = self.tag.build.slice(formatter.input);
                try writer.writeAll("+");
                try writer.writeAll(build);
            }
        }
    };

    pub fn fmt(this: Version, input: string) Formatter {
        return .{ .version = this, .input = input };
    }

    pub const DiffFormatter = struct {
        version: Version,
        buf: string,
        other: Version,
        other_buf: string,

        pub fn format(this: DiffFormatter, comptime fmt_: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            if (!Output.enable_ansi_colors) {
                // print normally if no colors
                const formatter: Formatter = .{ .version = this.version, .input = this.buf };
                return Formatter.format(formatter, fmt_, options, writer);
            }

            const diff = this.version.whichVersionIsDifferent(this.other, this.buf, this.other_buf) orelse .none;

            switch (diff) {
                .major => try writer.print(Output.prettyFmt("<r><b><red>{d}.{d}.{d}", true), .{
                    this.version.major, this.version.minor, this.version.patch,
                }),
                .minor => {
                    if (this.version.major == 0) {
                        try writer.print(Output.prettyFmt("<d>{d}.<r><b><red>{d}.{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    } else {
                        try writer.print(Output.prettyFmt("<d>{d}.<r><b><yellow>{d}.{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    }
                },
                .patch => {
                    if (this.version.major == 0 and this.version.minor == 0) {
                        try writer.print(Output.prettyFmt("<d>{d}.{d}.<r><b><red>{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    } else {
                        try writer.print(Output.prettyFmt("<d>{d}.{d}.<r><b><green>{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    }
                },
                .none, .pre, .build => try writer.print(Output.prettyFmt("<d>{d}.{d}.{d}", true), .{
                    this.version.major, this.version.minor, this.version.patch,
                }),
            }

            // might be pre or build. loop through all characters, and insert <red> on
            // first diff.

            var set_color = false;
            if (this.version.tag.hasPre()) {
                if (this.other.tag.hasPre()) {
                    const pre = this.version.tag.pre.slice(this.buf);
                    const other_pre = this.other.tag.pre.slice(this.other_buf);

                    var first = true;
                    for (pre, 0..) |c, i| {
                        if (!set_color and i < other_pre.len and c != other_pre[i]) {
                            set_color = true;
                            try writer.writeAll(Output.prettyFmt("<r><b><red>", true));
                        }
                        if (first) {
                            first = false;
                            try writer.writeByte('-');
                        }
                        try writer.writeByte(c);
                    }
                } else {
                    try writer.print(Output.prettyFmt("<r><b><red>-{}", true), .{this.version.tag.pre.fmt(this.buf)});
                    set_color = true;
                }
            }

            if (this.version.tag.hasBuild()) {
                if (this.other.tag.hasBuild()) {
                    const build = this.version.tag.build.slice(this.buf);
                    const other_build = this.other.tag.build.slice(this.other_buf);

                    var first = true;
                    for (build, 0..) |c, i| {
                        if (!set_color and i < other_build.len and c != other_build[i]) {
                            set_color = true;
                            try writer.writeAll(Output.prettyFmt("<r><b><red>", true));
                        }
                        if (first) {
                            first = false;
                            try writer.writeByte('+');
                        }
                        try writer.writeByte(c);
                    }
                } else {
                    if (!set_color) {
                        try writer.print(Output.prettyFmt("<r><b><red>+{}", true), .{this.version.tag.build.fmt(this.buf)});
                    } else {
                        try writer.print("+{}", .{this.version.tag.build.fmt(this.other_buf)});
                    }
                }
            }

            try writer.writeAll(Output.prettyFmt("<r>", true));
        }
    };

    pub fn diffFmt(this: Version, other: Version, this_buf: string, other_buf: string) DiffFormatter {
        return .{
            .version = this,
            .buf = this_buf,
            .other = other,
            .other_buf = other_buf,
        };
    }

    pub const ChangedVersion = enum {
        major,
        minor,
        patch,
        pre,
        build,
        none,
    };

    pub fn whichVersionIsDifferent(
        left: Version,
        right: Version,
        left_buf: string,
        right_buf: string,
    ) ?ChangedVersion {
        if (left.major != right.major) return .major;
        if (left.minor != right.minor) return .minor;
        if (left.patch != right.patch) return .patch;

        if (left.tag.hasPre() != right.tag.hasPre()) return .pre;
        if (!left.tag.hasPre() and !right.tag.hasPre()) return null;
        if (left.tag.orderPre(right.tag, left_buf, right_buf) != .eq) return .pre;

        if (left.tag.hasBuild() != right.tag.hasBuild()) return .build;
        if (!left.tag.hasBuild() and !right.tag.hasBuild()) return null;
        return if (left.tag.build.order(&right.tag.build, left_buf, right_buf) != .eq)
            .build
        else
            null;
    }

    pub fn count(this: *const Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        if (this.tag.hasPre() and !this.tag.pre.isInline()) builder.count(this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) builder.count(this.tag.build.slice(buf));
    }

    pub fn append(this: *const Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Version {
        var that = this.*;

        if (this.tag.hasPre() and !this.tag.pre.isInline()) that.tag.pre = builder.append(ExternalString, this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) that.tag.build = builder.append(ExternalString, this.tag.build.slice(buf));

        return that;
    }

    pub const Partial = struct {
        major: ?u32 = null,
        minor: ?u32 = null,
        patch: ?u32 = null,
        tag: Tag = .{},

        pub fn min(this: Partial) Version {
            return .{
                .major = this.major orelse 0,
                .minor = this.minor orelse 0,
                .patch = this.patch orelse 0,
                .tag = this.tag,
            };
        }

        pub fn max(this: Partial) Version {
            return .{
                .major = this.major orelse std.math.maxInt(u32),
                .minor = this.minor orelse std.math.maxInt(u32),
                .patch = this.patch orelse std.math.maxInt(u32),
                .tag = this.tag,
            };
        }
    };

    const Hashable = extern struct {
        major: u32,
        minor: u32,
        patch: u32,
        pre: u64,
        build: u64,
    };

    pub fn hash(this: Version) u64 {
        const hashable = Hashable{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .pre = this.tag.pre.hash,
            .build = this.tag.build.hash,
        };
        const bytes = std.mem.asBytes(&hashable);
        return bun.Wyhash.hash(0, bytes);
    }

    pub fn eql(lhs: Version, rhs: Version) bool {
        return lhs.major == rhs.major and lhs.minor == rhs.minor and lhs.patch == rhs.patch and rhs.tag.eql(lhs.tag);
    }

    pub const HashContext = struct {
        pub fn hash(_: @This(), lhs: Version) u32 {
            return @as(u32, @truncate(lhs.hash()));
        }

        pub fn eql(_: @This(), lhs: Version, rhs: Version) bool {
            return lhs.eql(rhs);
        }
    };

    pub const PinnedVersion = enum {
        major, // ^
        minor, // ~
        patch, // =
    };

    /// Modified version of pnpm's `whichVersionIsPinned`
    /// https://github.com/pnpm/pnpm/blob/bc0618cf192a9cafd0ab171a3673e23ed0869bbd/packages/which-version-is-pinned/src/index.ts#L9
    ///
    /// Differences:
    /// - It's not used for workspaces
    /// - `npm:` is assumed already removed from aliased versions
    /// - Invalid input is considered major pinned (important because these strings are coming
    ///    from package.json)
    ///
    /// The goal of this function is to avoid a complete parse of semver that's unused
    pub fn whichVersionIsPinned(input: string) PinnedVersion {
        const version = strings.trim(input, &strings.whitespace_chars);

        var i: usize = 0;

        const pinned: PinnedVersion = pinned: {
            for (0..version.len) |j| {
                switch (version[j]) {
                    // newlines & whitespace
                    ' ',
                    '\t',
                    '\n',
                    '\r',
                    std.ascii.control_code.vt,
                    std.ascii.control_code.ff,

                    // version separators
                    'v',
                    '=',
                    => {},

                    else => |c| {
                        i = j;

                        switch (c) {
                            '~', '^' => {
                                i += 1;

                                for (i..version.len) |k| {
                                    switch (version[k]) {
                                        ' ',
                                        '\t',
                                        '\n',
                                        '\r',
                                        std.ascii.control_code.vt,
                                        std.ascii.control_code.ff,
                                        => {
                                            // `v` and `=` not included.
                                            // `~v==1` would update to `^1.1.0` if versions `1.0.0`, `1.0.1`, `1.1.0`, and `2.0.0` are available
                                            // note that `~` changes to `^`
                                        },

                                        else => {
                                            i = k;
                                            break :pinned if (c == '~') .minor else .major;
                                        },
                                    }
                                }

                                // entire version after `~` is whitespace. invalid
                                return .major;
                            },

                            '0'...'9' => break :pinned .patch,

                            // could be invalid, could also be valid range syntax (>=, ...)
                            // either way, pin major
                            else => return .major,
                        }
                    },
                }
            }

            // entire semver is whitespace, `v`, and `=`. Invalid
            return .major;
        };

        // `pinned` is `.major`, `.minor`, or `.patch`. Check for each version core number:
        // - if major is missing, return `if (pinned == .patch) .major else pinned`
        // - if minor is missing, return `if (pinned == .patch) .minor else pinned`
        // - if patch is missing, return `pinned`
        // - if there's whitespace or non-digit characters between core numbers, return `.major`
        // - if the end is reached, return `pinned`

        // major
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        var d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;
            if (i >= version.len) return if (pinned == .patch) .major else pinned;
            d = version[i];
        }

        if (d != '.') return .major;

        // minor
        i += 1;
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;
            if (i >= version.len) return if (pinned == .patch) .minor else pinned;
            d = version[i];
        }

        if (d != '.') return .major;

        // patch
        i += 1;
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;

            // patch is done and at input end, valid
            if (i >= version.len) return pinned;
            d = version[i];
        }

        // Skip remaining valid pre/build tag characters and whitespace.
        // Does not validate whitespace used inside pre/build tags.
        if (!validPreOrBuildTagCharacter(d) or std.ascii.isWhitespace(d)) return .major;
        i += 1;

        // at this point the semver is valid so we can return true if it ends
        if (i >= version.len) return pinned;
        d = version[i];
        while (validPreOrBuildTagCharacter(d) and !std.ascii.isWhitespace(d)) {
            i += 1;
            if (i >= version.len) return pinned;
            d = version[i];
        }

        // We've come across a character that is not valid for tags or is whitespace.
        // Trailing whitespace was trimmed so we can assume there's another range
        return .major;
    }

    fn validPreOrBuildTagCharacter(c: u8) bool {
        return switch (c) {
            '-', '+', '.', 'A'...'Z', 'a'...'z', '0'...'9' => true,
            else => false,
        };
    }

    pub fn isTaggedVersionOnly(input: []const u8) bool {
        const version = strings.trim(input, &strings.whitespace_chars);

        // first needs to be a-z
        if (version.len == 0 or !std.ascii.isAlphabetic(version[0])) return false;

        for (1..version.len) |i| {
            if (!std.ascii.isAlphanumeric(version[i])) return false;
        }

        return true;
    }

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

        if (lhs.tag.hasPre()) {
            if (!rhs.tag.hasPre()) return .lt;
        } else {
            if (rhs.tag.hasPre()) return .gt;
        }

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

    pub fn orderWithoutBuild(
        lhs: Version,
        rhs: Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        const order_without_tag = orderWithoutTag(lhs, rhs);
        if (order_without_tag != .eq) return order_without_tag;

        return lhs.tag.orderWithoutBuild(rhs.tag, lhs_buf, rhs_buf);
    }

    pub const Tag = extern struct {
        pre: ExternalString = ExternalString{},
        build: ExternalString = ExternalString{},

        pub fn orderPre(lhs: Tag, rhs: Tag, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
            const lhs_str = lhs.pre.slice(lhs_buf);
            const rhs_str = rhs.pre.slice(rhs_buf);

            // 1. split each by '.', iterating through each one looking for integers
            // 2. compare as integers, or if not possible compare as string
            // 3. whichever is greater is the greater one
            //
            // 1.0.0-canary.0.0.0.0.0.0 < 1.0.0-canary.0.0.0.0.0.1

            var lhs_itr = strings.split(lhs_str, ".");
            var rhs_itr = strings.split(rhs_str, ".");

            while (true) {
                const lhs_part = lhs_itr.next();
                const rhs_part = rhs_itr.next();

                if (lhs_part == null and rhs_part == null) return .eq;

                // if right is null, left is greater than.
                if (rhs_part == null) return .gt;

                // if left is null, left is less than.
                if (lhs_part == null) return .lt;

                const lhs_uint: ?u32 = std.fmt.parseUnsigned(u32, lhs_part.?, 10) catch null;
                const rhs_uint: ?u32 = std.fmt.parseUnsigned(u32, rhs_part.?, 10) catch null;

                // a part that doesn't parse as an integer is greater than a part that does
                // https://github.com/npm/node-semver/blob/816c7b2cbfcb1986958a290f941eddfd0441139e/internal/identifiers.js#L12
                if (lhs_uint != null and rhs_uint == null) return .lt;
                if (lhs_uint == null and rhs_uint != null) return .gt;

                if (lhs_uint == null and rhs_uint == null) {
                    switch (strings.order(lhs_part.?, rhs_part.?)) {
                        .eq => {
                            // continue to the next part
                            continue;
                        },
                        else => |not_equal| return not_equal,
                    }
                }

                switch (std.math.order(lhs_uint.?, rhs_uint.?)) {
                    .eq => continue,
                    else => |not_equal| return not_equal,
                }
            }

            unreachable;
        }

        pub fn order(
            lhs: Tag,
            rhs: Tag,
            lhs_buf: []const u8,
            rhs_buf: []const u8,
        ) std.math.Order {
            if (!lhs.pre.isEmpty() and !rhs.pre.isEmpty()) {
                return lhs.orderPre(rhs, lhs_buf, rhs_buf);
            }

            const pre_order = lhs.pre.order(&rhs.pre, lhs_buf, rhs_buf);
            if (pre_order != .eq) return pre_order;

            return lhs.build.order(&rhs.build, lhs_buf, rhs_buf);
        }

        pub fn orderWithoutBuild(
            lhs: Tag,
            rhs: Tag,
            lhs_buf: []const u8,
            rhs_buf: []const u8,
        ) std.math.Order {
            if (!lhs.pre.isEmpty() and !rhs.pre.isEmpty()) {
                return lhs.orderPre(rhs, lhs_buf, rhs_buf);
            }

            return lhs.pre.order(&rhs.pre, lhs_buf, rhs_buf);
        }

        pub fn cloneInto(this: Tag, slice: []const u8, buf: *[]u8) Tag {
            var pre: String = this.pre.value;
            var build: String = this.build.value;

            if (this.pre.isInline()) {
                pre = this.pre.value;
            } else {
                const pre_slice = this.pre.slice(slice);
                bun.copy(u8, buf.*, pre_slice);
                pre = String.init(buf.*, buf.*[0..pre_slice.len]);
                buf.* = buf.*[pre_slice.len..];
            }

            if (this.build.isInline()) {
                build = this.build.value;
            } else {
                const build_slice = this.build.slice(slice);
                bun.copy(u8, buf.*, build_slice);
                build = String.init(buf.*, buf.*[0..build_slice.len]);
                buf.* = buf.*[build_slice.len..];
            }

            return .{
                .pre = .{
                    .value = pre,
                    .hash = this.pre.hash,
                },
                .build = .{
                    .value = build,
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
            return lhs.pre.hash == rhs.pre.hash;
        }

        pub const TagResult = struct {
            tag: Tag = Tag{},
            len: u32 = 0,
        };

        var multi_tag_warn = false;
        // TODO: support multiple tags

        pub fn parse(sliced_string: SlicedString) TagResult {
            return parseWithPreCount(sliced_string, 0);
        }

        pub fn parseWithPreCount(sliced_string: SlicedString, initial_pre_count: u32) TagResult {
            var input = sliced_string.slice;
            var build_count: u32 = 0;
            var pre_count: u32 = initial_pre_count;

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
                    '+' => {
                        // qualifier  ::= ( '-' pre )? ( '+' build )?
                        if (state == .pre or state == .none and initial_pre_count > 0) {
                            result.tag.pre = sliced_string.sub(input[start..i]).external();
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

                    // only continue if character is a valid pre/build tag character
                    // https://semver.org/#spec-item-9
                    'a'...'z', 'A'...'Z', '0'...'9', '.' => {},

                    else => {
                        switch (state) {
                            .none => {},
                            .pre => {
                                result.tag.pre = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    assert(!strings.containsChar(result.tag.pre.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                            .build => {
                                result.tag.build = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    assert(!strings.containsChar(result.tag.build.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                        }
                        result.len = @truncate(i);
                        break;
                    },
                }
            }

            if (state == .none and initial_pre_count > 0) {
                state = .pre;
                start = 0;
            }

            switch (state) {
                .none => {},
                .pre => {
                    result.tag.pre = sliced_string.sub(input[start..i]).external();
                    // a pre can contain multiple consecutive tags
                    // checking for "-" prefix is not enough, as --canary.67e7966.0 is a valid tag
                    state = State.none;
                },
                .build => {
                    // a build can contain multiple consecutive tags
                    result.tag.build = sliced_string.sub(input[start..i]).external();

                    state = State.none;
                },
            }
            result.len = @as(u32, @truncate(i));

            return result;
        }
    };

    pub const ParseResult = struct {
        wildcard: Query.Token.Wildcard = .none,
        valid: bool = true,
        version: Version.Partial = .{},
        len: u32 = 0,
    };

    pub fn parse(sliced_string: SlicedString) ParseResult {
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

        var i: usize = 0;

        for (0..input.len) |c| {
            switch (input[c]) {
                // newlines & whitespace
                ' ',
                '\t',
                '\n',
                '\r',
                std.ascii.control_code.vt,
                std.ascii.control_code.ff,

                // version separators
                'v',
                '=',
                => {},
                else => {
                    i = c;
                    break;
                },
            }
        }

        if (i == input.len) {
            result.valid = false;
            return result;
        }

        // two passes :(
        while (i < input.len) {
            if (is_done) {
                break;
            }

            switch (input[i]) {
                ' ' => {
                    is_done = true;
                    break;
                },
                '|', '^', '#', '&', '%', '!' => {
                    is_done = true;
                    if (i > 0) {
                        i -= 1;
                    }
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
                        // `.` is expected only if there are remaining core version numbers
                        '.' => part_i != 3,
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
                    if (part_i < 2 and result.wildcard == .none) {
                        result.valid = false;
                        is_done = true;
                        break;
                    }

                    part_start_i = i;
                    while (i < input.len and switch (input[i]) {
                        ' ' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                    const tag_result = Tag.parse(sliced_string.sub(input[part_start_i..]));
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
                else => |c| {

                    // Some weirdo npm packages in the wild have a version like "1.0.0rc.1"
                    // npm just expects that to work...even though it has no "-" qualifier.
                    if (result.wildcard == .none and part_i >= 2 and switch (c) {
                        'a'...'z', 'A'...'Z' => true,
                        else => false,
                    }) {
                        part_start_i = i;
                        const tag_result = Tag.parseWithPreCount(sliced_string.sub(input[part_start_i..]), 1);
                        result.version.tag = tag_result.tag;
                        i += tag_result.len;
                        is_done = true;
                        last_char_i = i;
                        break;
                    }

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

        result.len = @as(u32, @intCast(i));

        if (comptime RawType != void) {
            result.version.raw = sliced_string.sub(input[0..i]).external();
        }

        return result;
    }

    fn parseVersionNumber(input: string) ?u32 {
        // max decimal u32 is 4294967295
        var bytes: [10]u8 = undefined;
        var byte_i: u8 = 0;

        assert(input[0] != '.');

        for (input) |char| {
            switch (char) {
                'X', 'x', '*' => return null,
                '0'...'9' => {
                    // out of bounds
                    if (byte_i + 1 > bytes.len) return null;
                    bytes[byte_i] = char;
                    byte_i += 1;
                },
                ' ', '.' => break,
                // ignore invalid characters
                else => {},
            }
        }

        // If there are no numbers
        if (byte_i == 0) return null;

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

    left: Comparator = .{},
    right: Comparator = .{},

    pub fn format(this: Range, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (this.left.op == .unset and this.right.op == .unset) {
            return;
        }

        if (this.right.op == .unset) {
            try std.fmt.format(writer, "{}", .{this.left});
        } else {
            try std.fmt.format(writer, "{} {}", .{ this.left, this.right });
        }
    }

    /// *
    /// >= 0.0.0
    /// >= 0
    /// >= 0.0
    /// >= x
    /// >= 0
    pub fn anyRangeSatisfies(this: *const Range) bool {
        return this.left.op == .gte and this.left.version.eql(.{});
    }

    pub fn initWildcard(version: Version, wildcard: Query.Token.Wildcard) Range {
        switch (wildcard) {
            .none => {
                return .{
                    .left = .{
                        .op = Op.eql,
                        .version = version,
                    },
                };
            },

            .major => {
                return .{
                    .left = .{
                        .op = Op.gte,
                        .version = .{
                            // .raw = version.raw
                        },
                    },
                };
            },
            .minor => {
                const lhs = Version{
                    .major = version.major +| 1,
                    // .raw = version.raw
                };
                const rhs = Version{
                    .major = version.major,
                    // .raw = version.raw
                };
                return .{
                    .left = .{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = .{
                        .op = Op.gte,
                        .version = rhs,
                    },
                };
            },
            .patch => {
                const lhs = Version{
                    .major = version.major,
                    .minor = version.minor +| 1,
                    // .raw = version.raw;
                };
                const rhs = Version{
                    .major = version.major,
                    .minor = version.minor,
                    // .raw = version.raw;
                };
                return Range{
                    .left = .{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = .{
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

    pub const Formatter = struct {
        buffer: []const u8,
        range: *const Range,

        pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.range.left.op == Op.unset and this.range.right.op == Op.unset) {
                return;
            }

            if (this.range.right.op == .unset) {
                try std.fmt.format(writer, "{}", .{this.range.left.fmt(this.buffer)});
            } else {
                try std.fmt.format(writer, "{} {}", .{ this.range.left.fmt(this.buffer), this.range.right.fmt(this.buffer) });
            }
        }
    };

    pub fn fmt(this: *const Range, buf: []const u8) @This().Formatter {
        return .{ .buffer = buf, .range = this };
    }

    pub const Comparator = struct {
        op: Op = .unset,
        version: Version = .{},

        pub inline fn eql(lhs: Comparator, rhs: Comparator) bool {
            return lhs.op == rhs.op and lhs.version.eql(rhs.version);
        }

        pub const Formatter = struct {
            buffer: []const u8,
            comparator: *const Comparator,

            pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                if (this.comparator.op == Op.unset) {
                    return;
                }

                switch (this.comparator.op) {
                    .unset => unreachable, // see above,
                    .eql => try writer.writeAll("=="),
                    .lt => try writer.writeAll("<"),
                    .lte => try writer.writeAll("<="),
                    .gt => try writer.writeAll(">"),
                    .gte => try writer.writeAll(">="),
                }

                try std.fmt.format(writer, "{}", .{this.comparator.version.fmt(this.buffer)});
            }
        };

        pub fn fmt(this: *const Comparator, buf: []const u8) @This().Formatter {
            return .{ .buffer = buf, .comparator = this };
        }

        pub fn satisfies(
            comparator: Comparator,
            version: Version,
            comparator_buf: string,
            version_buf: string,
        ) bool {
            const order = version.orderWithoutBuild(comparator.version, version_buf, comparator_buf);

            return switch (order) {
                .eq => switch (comparator.op) {
                    .lte, .gte, .eql => true,
                    else => false,
                },
                .gt => switch (comparator.op) {
                    .gt, .gte => true,
                    else => false,
                },
                .lt => switch (comparator.op) {
                    .lt, .lte => true,
                    else => false,
                },
            };
        }
    };

    pub fn satisfies(range: Range, version: Version, range_buf: string, version_buf: string) bool {
        const has_left = range.hasLeft();
        const has_right = range.hasRight();

        if (!has_left) {
            return true;
        }

        if (!range.left.satisfies(version, range_buf, version_buf)) {
            return false;
        }

        if (has_right and !range.right.satisfies(version, range_buf, version_buf)) {
            return false;
        }

        return true;
    }

    pub fn satisfiesPre(range: Range, version: Version, range_buf: string, version_buf: string, pre_matched: *bool) bool {
        if (comptime Environment.allow_assert) {
            assert(version.tag.hasPre());
        }
        const has_left = range.hasLeft();
        const has_right = range.hasRight();

        if (!has_left) {
            return true;
        }

        // If left has prerelease check if major,minor,patch matches with left. If
        // not, check the same with right if right exists and has prerelease.
        pre_matched.* = pre_matched.* or
            (range.left.version.tag.hasPre() and
            version.patch == range.left.version.patch and
            version.minor == range.left.version.minor and
            version.major == range.left.version.major) or
            (has_right and
            range.right.version.tag.hasPre() and
            version.patch == range.right.version.patch and
            version.minor == range.right.version.minor and
            version.major == range.right.version.major);

        if (!range.left.satisfies(version, range_buf, version_buf)) {
            return false;
        }

        if (has_right and !range.right.satisfies(version, range_buf, version_buf)) {
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

    const Formatter = struct {
        query: *const Query,
        buffer: []const u8,
        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const this = formatter.query;

            if (this.next) |ptr| {
                if (ptr.range.hasLeft() or ptr.range.hasRight()) {
                    try std.fmt.format(writer, "{} && {}", .{ this.range.fmt(formatter.buffer), ptr.range.fmt(formatter.buffer) });
                    return;
                }
            }

            try std.fmt.format(writer, "{}", .{this.range.fmt(formatter.buffer)});
        }
    };

    pub fn fmt(this: *const Query, buf: []const u8) @This().Formatter {
        return .{ .query = this, .buffer = buf };
    }

    /// Linked-list of Queries OR'd together
    /// "^1 || ^2"
    /// ----|-----
    /// That is two List
    pub const List = struct {
        head: Query = Query{},
        tail: ?*Query = null,

        // OR
        next: ?*List = null,

        const Formatter = struct {
            list: *const List,
            buffer: []const u8,
            pub fn format(formatter: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                const this = formatter.list;

                if (this.next) |ptr| {
                    try std.fmt.format(writer, "{} || {}", .{ this.head.fmt(formatter.buffer), ptr.fmt(formatter.buffer) });
                } else {
                    try std.fmt.format(writer, "{}", .{this.head.fmt(formatter.buffer)});
                }
            }
        };

        pub fn fmt(this: *const List, buf: []const u8) @This().Formatter {
            return .{ .list = this, .buffer = buf };
        }

        pub fn satisfies(list: *const List, version: Version, list_buf: string, version_buf: string) bool {
            return list.head.satisfies(
                version,
                list_buf,
                version_buf,
            ) or (list.next orelse return false).satisfies(
                version,
                list_buf,
                version_buf,
            );
        }

        pub fn satisfiesPre(list: *const List, version: Version, list_buf: string, version_buf: string) bool {
            if (comptime Environment.allow_assert) {
                assert(version.tag.hasPre());
            }

            // `version` has a prerelease tag:
            // - needs to satisfy each comparator in the query (<comparator> AND <comparator> AND ...) like normal comparison
            // - if it does, also needs to match major, minor, patch with at least one of the other versions
            //   with a prerelease
            // https://github.com/npm/node-semver/blob/ac9b35769ab0ddfefd5a3af4a3ecaf3da2012352/classes/range.js#L505
            var pre_matched = false;
            return (list.head.satisfiesPre(
                version,
                list_buf,
                version_buf,
                &pre_matched,
            ) and pre_matched) or (list.next orelse return false).satisfiesPre(
                version,
                list_buf,
                version_buf,
            );
        }

        pub fn eql(lhs: *const List, rhs: *const List) bool {
            if (!lhs.head.eql(&rhs.head)) return false;

            const lhs_next = lhs.next orelse return rhs.next == null;
            const rhs_next = rhs.next orelse return false;

            return lhs_next.eql(rhs_next);
        }

        pub fn andRange(self: *List, allocator: Allocator, range: Range) !void {
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
        allocator: Allocator,
        input: string = "",

        flags: FlagsBitSet = FlagsBitSet.initEmpty(),
        pub const Flags = struct {
            pub const pre = 1;
            pub const build = 0;
        };

        const Formatter = struct {
            group: *const Group,
            buf: string,

            pub fn format(formatter: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                const this = formatter.group;

                if (this.tail == null and this.head.tail == null and !this.head.head.range.hasLeft()) {
                    return;
                }

                if (this.tail == null and this.head.tail == null) {
                    try std.fmt.format(writer, "{}", .{this.head.fmt(formatter.buf)});
                    return;
                }

                var list = &this.head;
                while (list.next) |next| {
                    try std.fmt.format(writer, "{} && ", .{list.fmt(formatter.buf)});
                    list = next;
                }

                try std.fmt.format(writer, "{}", .{list.fmt(formatter.buf)});
            }
        };

        pub fn fmt(this: *const Group, buf: string) @This().Formatter {
            return .{
                .group = this,
                .buf = buf,
            };
        }

        pub fn jsonStringify(this: *const Group, writer: anytype) !void {
            const temp = try std.fmt.allocPrint(bun.default_allocator, "{}", .{this.fmt()});
            defer bun.default_allocator.free(temp);
            try std.json.encodeJsonString(temp, .{}, writer);
        }

        pub fn deinit(this: *const Group) void {
            var list = this.head;
            var allocator = this.allocator;

            while (list.next) |next| {
                var query = list.head;
                while (query.next) |next_query| {
                    query = next_query.*;
                    allocator.destroy(next_query);
                }
                list = next.*;
                allocator.destroy(next);
            }
        }

        pub fn getExactVersion(this: *const Group) ?Version {
            const range = this.head.head.range;
            if (this.head.next == null and
                this.head.head.next == null and
                range.hasLeft() and
                range.left.op == .eql and
                !range.hasRight())
            {
                if (comptime Environment.allow_assert) {
                    assert(this.tail == null);
                }
                return range.left.version;
            }

            return null;
        }

        pub fn from(version: Version) Group {
            return .{
                .allocator = bun.default_allocator,
                .head = .{
                    .head = .{
                        .range = .{
                            .left = .{
                                .op = .eql,
                                .version = version,
                            },
                        },
                    },
                },
            };
        }

        pub const FlagsBitSet = std.bit_set.IntegerBitSet(3);

        pub fn isExact(this: *const Group) bool {
            return this.head.next == null and this.head.head.next == null and !this.head.head.range.hasRight() and this.head.head.range.left.op == .eql;
        }

        pub fn @"is *"(this: *const Group) bool {
            const left = this.head.head.range.left;
            return this.head.head.range.right.op == .unset and
                left.op == .gte and
                this.head.next == null and
                this.head.head.next == null and
                left.version.isZero() and
                !this.flags.isSet(Flags.build);
        }

        pub inline fn eql(lhs: Group, rhs: Group) bool {
            return lhs.head.eql(&rhs.head);
        }

        pub fn toVersion(this: Group) Version {
            assert(this.isExact() or this.head.head.range.left.op == .unset);
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

        pub inline fn satisfies(
            group: *const Group,
            version: Version,
            group_buf: string,
            version_buf: string,
        ) bool {
            return if (version.tag.hasPre())
                group.head.satisfiesPre(version, group_buf, version_buf)
            else
                group.head.satisfies(version, group_buf, version_buf);
        }
    };

    pub fn eql(lhs: *const Query, rhs: *const Query) bool {
        if (!lhs.range.eql(rhs.range)) return false;

        const lhs_next = lhs.next orelse return rhs.next == null;
        const rhs_next = rhs.next orelse return false;

        return lhs_next.eql(rhs_next);
    }

    pub fn satisfies(query: *const Query, version: Version, query_buf: string, version_buf: string) bool {
        return query.range.satisfies(
            version,
            query_buf,
            version_buf,
        ) and (query.next orelse return true).satisfies(
            version,
            query_buf,
            version_buf,
        );
    }

    pub fn satisfiesPre(query: *const Query, version: Version, query_buf: string, version_buf: string, pre_matched: *bool) bool {
        if (comptime Environment.allow_assert) {
            assert(version.tag.hasPre());
        }
        return query.range.satisfiesPre(
            version,
            query_buf,
            version_buf,
            pre_matched,
        ) and (query.next orelse return true).satisfiesPre(
            version,
            query_buf,
            version_buf,
            pre_matched,
        );
    }

    const Token = struct {
        tag: Tag = Tag.none,
        wildcard: Wildcard = Wildcard.none,

        pub fn toRange(this: Token, version: Version.Partial) Range {
            switch (this.tag) {
                // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
                .caret => {
                    // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L302-L353
                    var range = Range{};
                    if (version.major) |major| done: {
                        range.left = .{
                            .op = .gte,
                            .version = .{
                                .major = major,
                            },
                        };
                        range.right = .{
                            .op = .lt,
                        };
                        if (version.minor) |minor| {
                            range.left.version.minor = minor;
                            if (version.patch) |patch| {
                                range.left.version.patch = patch;
                                range.left.version.tag = version.tag;
                                if (major == 0) {
                                    if (minor == 0) {
                                        range.right.version.patch = patch +| 1;
                                    } else {
                                        range.right.version.minor = minor +| 1;
                                    }
                                    break :done;
                                }
                            } else if (major == 0) {
                                range.right.version.minor = minor +| 1;
                                break :done;
                            }
                        }
                        range.right.version.major = major +| 1;
                    }
                    return range;
                },
                .tilda => {
                    // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L261-L287
                    var range = Range{};
                    if (version.major) |major| done: {
                        range.left = .{
                            .op = .gte,
                            .version = .{
                                .major = major,
                            },
                        };
                        range.right = .{
                            .op = .lt,
                        };
                        if (version.minor) |minor| {
                            range.left.version.minor = minor;
                            if (version.patch) |patch| {
                                range.left.version.patch = patch;
                                range.left.version.tag = version.tag;
                            }
                            range.right.version.major = major;
                            range.right.version.minor = minor +| 1;
                            break :done;
                        }
                        range.right.version.major = major +| 1;
                    }
                    return range;
                },
                .none => unreachable,
                .version => {
                    if (this.wildcard != Wildcard.none) {
                        return Range.initWildcard(version.min(), this.wildcard);
                    }

                    return .{ .left = .{ .op = .eql, .version = version.min() } };
                },
                else => {},
            }

            return switch (this.wildcard) {
                .major => .{
                    .left = .{ .op = .gte, .version = version.min() },
                    .right = .{
                        .op = .lte,
                        .version = .{
                            .major = std.math.maxInt(u32),
                            .minor = std.math.maxInt(u32),
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },
                .minor => switch (this.tag) {
                    .lte => .{
                        .left = .{
                            .op = .lte,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = std.math.maxInt(u32),
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },
                    .lt => .{
                        .left = .{
                            .op = .lt,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = 0,
                                .patch = 0,
                            },
                        },
                    },

                    .gt => .{
                        .left = .{
                            .op = .gt,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = std.math.maxInt(u32),
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },

                    .gte => .{
                        .left = .{
                            .op = .gte,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = 0,
                                .patch = 0,
                            },
                        },
                    },
                    else => unreachable,
                },
                .patch => switch (this.tag) {
                    .lte => .{
                        .left = .{
                            .op = .lte,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = version.minor orelse 0,
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },
                    .lt => .{
                        .left = .{
                            .op = .lt,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = version.minor orelse 0,
                                .patch = 0,
                            },
                        },
                    },

                    .gt => .{
                        .left = .{
                            .op = .gt,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = version.minor orelse 0,
                                .patch = std.math.maxInt(u32),
                            },
                        },
                    },

                    .gte => .{
                        .left = .{
                            .op = .gte,
                            .version = .{
                                .major = version.major orelse 0,
                                .minor = version.minor orelse 0,
                                .patch = 0,
                            },
                        },
                    },
                    else => unreachable,
                },
                .none => .{
                    .left = .{
                        .op = switch (this.tag) {
                            .gt => .gt,
                            .gte => .gte,
                            .lt => .lt,
                            .lte => .lte,
                            else => unreachable,
                        },
                        .version = version.min(),
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

    const ParseError = error{OutOfMemory};

    pub fn parse(
        allocator: Allocator,
        input: string,
        sliced: SlicedString,
    ) ParseError!Group {
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

                    // skip tagged versions
                    // we are assuming this is the beginning of a tagged version like "boop"
                    // "1.0.0 || boop"
                    while (i < input.len and input[i] != ' ' and input[i] != '|') : (i += 1) {}
                    skip_round = true;
                },
            }

            if (!skip_round) {
                const parse_result = Version.parse(sliced.sub(input[i..]));
                const version = parse_result.version.min();
                if (version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                if (version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

                token.wildcard = parse_result.wildcard;

                i += parse_result.len;
                const rollback = i;

                const maybe_hyphenate = i < input.len and (input[i] == ' ' or input[i] == '-');

                // TODO: can we do this without rolling back?
                const hyphenate: bool = maybe_hyphenate and possibly_hyphenate: {
                    i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                    if (!(i < input.len and input[i] == '-')) break :possibly_hyphenate false;
                    i += 1;
                    i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                    if (i == input.len) break :possibly_hyphenate false;
                    if (input[i] == 'v' or input[i] == '=') {
                        i += 1;
                    }
                    if (i == input.len) break :possibly_hyphenate false;
                    i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                    if (i == input.len) break :possibly_hyphenate false;

                    if (!(i < input.len and switch (input[i]) {
                        '0'...'9', 'X', 'x', '*' => true,
                        else => false,
                    })) break :possibly_hyphenate false;

                    break :possibly_hyphenate true;
                };

                if (!hyphenate) i = rollback;
                i += @as(usize, @intFromBool(!hyphenate));

                if (hyphenate) {
                    const second_parsed = Version.parse(sliced.sub(input[i..]));
                    var second_version = second_parsed.version.min();
                    if (second_version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                    if (second_version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);
                    const range: Range = brk: {
                        switch (second_parsed.wildcard) {
                            .major => {
                                // "1.0.0 - x" --> ">=1.0.0"
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = version },
                                };
                            },
                            .minor => {
                                // "1.0.0 - 1.x" --> ">=1.0.0 < 2.0.0"
                                second_version.major +|= 1;
                                second_version.minor = 0;
                                second_version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = version },
                                    .right = .{ .op = .lt, .version = second_version },
                                };
                            },
                            .patch => {
                                // "1.0.0 - 1.0.x" --> ">=1.0.0 <1.1.0"
                                second_version.minor +|= 1;
                                second_version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = version },
                                    .right = .{ .op = .lt, .version = second_version },
                                };
                            },
                            .none => {
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = version },
                                    .right = .{ .op = .lte, .version = second_version },
                                };
                            },
                        }
                    };

                    if (is_or) {
                        try list.orRange(range);
                    } else {
                        try list.andRange(range);
                    }

                    i += second_parsed.len + 1;
                } else if (count == 0 and token.tag == .version) {
                    switch (parse_result.wildcard) {
                        .none => {
                            try list.orVersion(version);
                        },
                        else => {
                            try list.orRange(token.toRange(parse_result.version));
                        },
                    }
                } else if (count == 0) {
                    // From a semver perspective, treat "--foo" the same as "-foo"
                    // example: foo/bar@1.2.3@--canary.24
                    //                         ^
                    if (token.tag == .none) {
                        is_or = false;
                        token.wildcard = .none;
                        prev_token.tag = .none;
                        continue;
                    }
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

pub const SemverObject = struct {
    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const object = JSC.JSValue.createEmptyObject(globalThis, 2);

        object.put(
            globalThis,
            JSC.ZigString.static("satisfies"),
            JSC.NewFunction(
                globalThis,
                JSC.ZigString.static("satisfies"),
                2,
                SemverObject.satisfies,
                false,
            ),
        );

        object.put(
            globalThis,
            JSC.ZigString.static("order"),
            JSC.NewFunction(
                globalThis,
                JSC.ZigString.static("order"),
                2,
                SemverObject.order,
                false,
            ),
        );

        return object;
    }

    pub fn order(
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) JSC.JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack_fallback = std.heap.stackFallback(512, arena.allocator());
        const allocator = stack_fallback.get();

        const arguments = callFrame.arguments(2).slice();
        if (arguments.len < 2) {
            globalThis.throw("Expected two arguments", .{});
            return .zero;
        }

        const left_arg = arguments[0];
        const right_arg = arguments[1];

        const left_string = left_arg.toStringOrNull(globalThis) orelse return JSC.jsNumber(0);
        const right_string = right_arg.toStringOrNull(globalThis) orelse return JSC.jsNumber(0);

        const left = left_string.toSlice(globalThis, allocator);
        defer left.deinit();
        const right = right_string.toSlice(globalThis, allocator);
        defer right.deinit();

        if (!strings.isAllASCII(left.slice())) return JSC.jsNumber(0);
        if (!strings.isAllASCII(right.slice())) return JSC.jsNumber(0);

        const left_result = Version.parse(SlicedString.init(left.slice(), left.slice()));
        const right_result = Version.parse(SlicedString.init(right.slice(), right.slice()));

        if (!left_result.valid) {
            globalThis.throw("Invalid SemVer: {s}\n", .{left.slice()});
            return .zero;
        }

        if (!right_result.valid) {
            globalThis.throw("Invalid SemVer: {s}\n", .{right.slice()});
            return .zero;
        }

        const left_version = left_result.version.max();
        const right_version = right_result.version.max();

        return switch (left_version.orderWithoutBuild(right_version, left.slice(), right.slice())) {
            .eq => JSC.jsNumber(0),
            .gt => JSC.jsNumber(1),
            .lt => JSC.jsNumber(-1),
        };
    }

    pub fn satisfies(
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) JSC.JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack_fallback = std.heap.stackFallback(512, arena.allocator());
        const allocator = stack_fallback.get();

        const arguments = callFrame.arguments(2).slice();
        if (arguments.len < 2) {
            globalThis.throw("Expected two arguments", .{});
            return .zero;
        }

        const left_arg = arguments[0];
        const right_arg = arguments[1];

        const left_string = left_arg.toStringOrNull(globalThis) orelse return .false;
        const right_string = right_arg.toStringOrNull(globalThis) orelse return .false;

        const left = left_string.toSlice(globalThis, allocator);
        defer left.deinit();
        const right = right_string.toSlice(globalThis, allocator);
        defer right.deinit();

        if (!strings.isAllASCII(left.slice())) return .false;
        if (!strings.isAllASCII(right.slice())) return .false;

        const left_result = Version.parse(SlicedString.init(left.slice(), left.slice()));
        if (left_result.wildcard != .none) {
            return .false;
        }

        const left_version = left_result.version.min();

        const right_group = Query.parse(
            allocator,
            right.slice(),
            SlicedString.init(right.slice(), right.slice()),
        ) catch |err| {
            switch (err) {
                error.OutOfMemory => {
                    globalThis.throwOutOfMemory();
                    return .zero;
                },
            }
        };
        defer right_group.deinit();

        const right_version = right_group.getExactVersion();

        if (right_version != null) {
            return JSC.jsBoolean(left_version.eql(right_version.?));
        }

        return JSC.jsBoolean(right_group.satisfies(left_version, right.slice(), left.slice()));
    }
};

const assert = bun.assert;
