/// String type that stores either an offset/length into an external buffer or a string inline directly
pub const String = extern struct {
    pub const max_inline_len: usize = 8;
    /// This is three different types of string.
    /// 1. Empty string. If it's all zeroes, then it's an empty string.
    /// 2. If the final bit is set, then it's a string that is stored inline.
    /// 3. If the final bit is not set, then it's a string that is stored in an external buffer.
    bytes: [max_inline_len]u8 = [8]u8{ 0, 0, 0, 0, 0, 0, 0, 0 },

    pub const empty: String = .{};

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

    pub const Buf = struct {
        bytes: *std.ArrayListUnmanaged(u8),
        allocator: std.mem.Allocator,
        pool: *Builder.StringPool,

        pub fn init(lockfile: *const Lockfile) Buf {
            return .{
                .bytes = &lockfile.buffers.string_bytes,
                .allocator = lockfile.allocator,
                .pool = &lockfile.string_pool,
            };
        }

        pub fn append(this: *Buf, str: string) OOM!String {
            if (canInline(str)) {
                return String.initInline(str);
            }

            const hash = Builder.stringHash(str);
            const entry = try this.pool.getOrPut(hash);
            if (entry.found_existing) {
                return entry.value_ptr.*;
            }

            // new entry
            const new = try String.initAppend(this.allocator, this.bytes, str);
            entry.value_ptr.* = new;
            return new;
        }

        pub fn appendWithHash(this: *Buf, str: string, hash: u64) OOM!String {
            if (canInline(str)) {
                return initInline(str);
            }

            const entry = try this.pool.getOrPut(hash);
            if (entry.found_existing) {
                return entry.value_ptr.*;
            }

            // new entry
            const new = try String.initAppend(this.allocator, this.bytes, str);
            entry.value_ptr.* = new;
            return new;
        }

        pub fn appendExternal(this: *Buf, str: string) OOM!ExternalString {
            const hash = Builder.stringHash(str);

            if (canInline(str)) {
                return .{
                    .value = String.initInline(str),
                    .hash = hash,
                };
            }

            const entry = try this.pool.getOrPut(hash);
            if (entry.found_existing) {
                return .{
                    .value = entry.value_ptr.*,
                    .hash = hash,
                };
            }

            const new = try String.initAppend(this.allocator, this.bytes, str);
            entry.value_ptr.* = new;
            return .{
                .value = new,
                .hash = hash,
            };
        }

        pub fn appendExternalWithHash(this: *Buf, str: string, hash: u64) OOM!ExternalString {
            if (canInline(str)) {
                return .{
                    .value = initInline(str),
                    .hash = hash,
                };
            }

            const entry = try this.pool.getOrPut(hash);
            if (entry.found_existing) {
                return .{
                    .value = entry.value_ptr.*,
                    .hash = hash,
                };
            }

            const new = try String.initAppend(this.allocator, this.bytes, str);
            entry.value_ptr.* = new;
            return .{
                .value = new,
                .hash = hash,
            };
        }
    };

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

        pub fn format(formatter: Formatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            const str = formatter.str;
            try writer.writeAll(str.slice(formatter.buf));
        }
    };

    /// Escapes for json. Defaults to quoting the string.
    pub inline fn fmtJson(self: *const String, buf: []const u8, opts: JsonFormatter.Options) JsonFormatter {
        return .{
            .buf = buf,
            .str = self,
            .opts = opts,
        };
    }

    pub const JsonFormatter = struct {
        str: *const String,
        buf: string,
        opts: Options,

        pub const Options = struct {
            quote: bool = true,
        };

        pub fn format(formatter: JsonFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            try writer.print("{f}", .{bun.fmt.formatJSONStringUTF8(formatter.str.slice(formatter.buf), .{ .quote = formatter.opts.quote })});
        }
    };

    pub inline fn fmtStorePath(self: *const String, buf: []const u8) StorePathFormatter {
        return .{
            .buf = buf,
            .str = self,
        };
    }

    pub const StorePathFormatter = struct {
        str: *const String,
        buf: string,

        pub fn format(this: StorePathFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            for (this.str.slice(this.buf)) |c| {
                const n = switch (c) {
                    '/' => '+',
                    '\\' => '+',
                    ':' => '+',
                    '#' => '+',
                    else => c,
                };
                try writer.writeByte(n);
            }
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
        arg_buf: []const u8,
        existing_buf: []const u8,

        pub fn eql(ctx: HashContext, arg: String, existing: String) bool {
            return arg.eql(existing, ctx.arg_buf, ctx.existing_buf);
        }

        pub fn hash(ctx: HashContext, arg: String) u64 {
            const str = arg.slice(ctx.arg_buf);
            return bun.hash(str);
        }
    };

    pub fn hashContext(l_lockfile: *Lockfile, r_lockfile: ?*Lockfile) HashContext {
        return .{
            .arg_buf = l_lockfile.buffers.string_bytes.items,
            .existing_buf = if (r_lockfile) |r| r.buffers.string_bytes.items else l_lockfile.buffers.string_bytes.items,
        };
    }

    pub const ArrayHashContext = struct {
        arg_buf: []const u8,
        existing_buf: []const u8,

        pub fn eql(ctx: ArrayHashContext, arg: String, existing: String, _: usize) bool {
            return arg.eql(existing, ctx.arg_buf, ctx.existing_buf);
        }

        pub fn hash(ctx: ArrayHashContext, arg: String) u32 {
            const str = arg.slice(ctx.arg_buf);
            return @as(u32, @truncate(bun.hash(str)));
        }
    };

    pub fn arrayHashContext(l_lockfile: *const Lockfile, r_lockfile: ?*const Lockfile) ArrayHashContext {
        return .{
            .arg_buf = l_lockfile.buffers.string_bytes.items,
            .existing_buf = if (r_lockfile) |r| r.buffers.string_bytes.items else l_lockfile.buffers.string_bytes.items,
        };
    }

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

    pub fn initInline(
        in: string,
    ) String {
        bun.assertWithLocation(canInline(in), @src());
        return switch (in.len) {
            0 => .{},
            1 => .{ .bytes = .{ in[0], 0, 0, 0, 0, 0, 0, 0 } },
            2 => .{ .bytes = .{ in[0], in[1], 0, 0, 0, 0, 0, 0 } },
            3 => .{ .bytes = .{ in[0], in[1], in[2], 0, 0, 0, 0, 0 } },
            4 => .{ .bytes = .{ in[0], in[1], in[2], in[3], 0, 0, 0, 0 } },
            5 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], 0, 0, 0 } },
            6 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], 0, 0 } },
            7 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], 0 } },
            8 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], in[7] } },
            else => unreachable,
        };
    }

    pub fn initAppendIfNeeded(
        allocator: std.mem.Allocator,
        buf: *std.ArrayListUnmanaged(u8),
        in: string,
    ) OOM!String {
        return switch (in.len) {
            0 => .{},
            1 => .{ .bytes = .{ in[0], 0, 0, 0, 0, 0, 0, 0 } },
            2 => .{ .bytes = .{ in[0], in[1], 0, 0, 0, 0, 0, 0 } },
            3 => .{ .bytes = .{ in[0], in[1], in[2], 0, 0, 0, 0, 0 } },
            4 => .{ .bytes = .{ in[0], in[1], in[2], in[3], 0, 0, 0, 0 } },
            5 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], 0, 0, 0 } },
            6 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], 0, 0 } },
            7 => .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], 0 } },

            max_inline_len =>
            // If they use the final bit, then it's a big string.
            // This should only happen for non-ascii strings that are exactly 8 bytes.
            // so that's an edge-case
            if ((in[max_inline_len - 1]) >= 128)
                try initAppend(allocator, buf, in)
            else
                .{ .bytes = .{ in[0], in[1], in[2], in[3], in[4], in[5], in[6], in[7] } },

            else => try initAppend(allocator, buf, in),
        };
    }

    pub fn initAppend(
        allocator: std.mem.Allocator,
        buf: *std.ArrayListUnmanaged(u8),
        in: string,
    ) OOM!String {
        try buf.appendSlice(allocator, in);
        const in_buf = buf.items[buf.items.len - in.len ..];
        return @bitCast((@as(u64, 0) | @as(u64, @as(max_addressable_space, @truncate(@as(u64, @bitCast(Pointer.init(buf.items, in_buf))))))) | 1 << 63);
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

    pub fn toJS(this: *const String, buffer: []const u8, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return bun.String.createUTF8ForJS(globalThis, this.slice(buffer));
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

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const IdentityContext = bun.IdentityContext;
const OOM = bun.OOM;
const assert = bun.assert;
const jsc = bun.jsc;
const strings = bun.strings;
const Lockfile = bun.install.Lockfile;

const ExternalString = bun.Semver.ExternalString;
const SlicedString = bun.Semver.SlicedString;
