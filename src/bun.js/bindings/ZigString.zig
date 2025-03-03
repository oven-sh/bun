const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const strings = bun.strings;
const JSC = bun.JSC;
const String = bun.String;
const Shimmer = JSC.Shimmer;
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSString = @import("JSString.zig").JSString;
const C_API = bun.JSC.C;

/// Prefer using bun.String instead of ZigString in new code.
pub const ZigString = extern struct {
    /// This can be a UTF-16, Latin1, or UTF-8 string.
    /// The pointer itself is tagged, so it cannot be used without untagging it first
    /// Accessing it directly is unsafe.
    _unsafe_ptr_do_not_use: [*]const u8,
    len: usize,

    pub const ByteString = union(enum) {
        latin1: []const u8,
        utf16: []const u16,
    };

    pub fn fromBytes(slice_: []const u8) ZigString {
        if (!strings.isAllASCII(slice_)) {
            return initUTF8(slice_);
        }

        return init(slice_);
    }

    pub inline fn as(this: ZigString) ByteString {
        return if (this.is16Bit()) .{ .utf16 = this.utf16SliceAligned() } else .{ .latin1 = this.slice() };
    }

    pub fn encode(this: ZigString, encoding: JSC.Node.Encoding) []u8 {
        return this.encodeWithAllocator(bun.default_allocator, encoding);
    }

    pub fn encodeWithAllocator(this: ZigString, allocator: std.mem.Allocator, encoding: JSC.Node.Encoding) []u8 {
        return switch (this.as()) {
            inline else => |repr| switch (encoding) {
                inline else => |enc| JSC.WebCore.Encoder.constructFrom(std.meta.Child(@TypeOf(repr)), repr, allocator, enc),
            },
        };
    }

    pub fn dupeForJS(utf8: []const u8, allocator: std.mem.Allocator) !ZigString {
        if (try strings.toUTF16Alloc(allocator, utf8, false, false)) |utf16| {
            var out = ZigString.initUTF16(utf16);
            out.mark();
            out.markUTF16();
            return out;
        } else {
            var out = ZigString.init(try allocator.dupe(u8, utf8));
            out.mark();
            return out;
        }
    }

    extern fn ZigString__toValueGC(arg0: *const ZigString, arg1: *JSGlobalObject) JSC.JSValue;
    pub fn toJS(this: *const ZigString, ctx: *JSC.JSGlobalObject) JSValue {
        if (this.isGloballyAllocated()) {
            return this.toExternalValue(ctx);
        }

        return ZigString__toValueGC(this, ctx);
    }

    /// This function is not optimized!
    pub fn eqlCaseInsensitive(this: ZigString, other: ZigString) bool {
        var fallback = std.heap.stackFallback(1024, bun.default_allocator);
        const fallback_allocator = fallback.get();

        var utf16_slice = this.toSliceLowercase(fallback_allocator);
        var latin1_slice = other.toSliceLowercase(fallback_allocator);
        defer utf16_slice.deinit();
        defer latin1_slice.deinit();
        return strings.eqlLong(utf16_slice.slice(), latin1_slice.slice(), true);
    }

    pub fn toSliceLowercase(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        var fallback = std.heap.stackFallback(512, allocator);
        const fallback_allocator = fallback.get();

        const uppercase_buffer = this.toOwnedSlice(fallback_allocator) catch unreachable;
        const buffer = allocator.alloc(u8, uppercase_buffer.len) catch unreachable;
        const out = strings.copyLowercase(uppercase_buffer, buffer);

        return Slice{
            .allocator = NullableAllocator.init(allocator),
            .ptr = out.ptr,
            .len = @as(u32, @truncate(out.len)),
        };
    }

    pub fn indexOfAny(this: ZigString, comptime chars: []const u8) ?strings.OptionalUsize {
        if (this.is16Bit()) {
            return strings.indexOfAny16(this.utf16SliceAligned(), chars);
        } else {
            return strings.indexOfAny(this.slice(), chars);
        }
    }

    pub fn charAt(this: ZigString, offset: usize) u8 {
        if (this.is16Bit()) {
            return @as(u8, @truncate(this.utf16SliceAligned()[offset]));
        } else {
            return @as(u8, @truncate(this.slice()[offset]));
        }
    }

    pub fn eql(this: ZigString, other: ZigString) bool {
        if (this.len == 0 or other.len == 0)
            return this.len == other.len;

        const left_utf16 = this.is16Bit();
        const right_utf16 = other.is16Bit();

        if (left_utf16 == right_utf16 and left_utf16) {
            return strings.eqlLong(std.mem.sliceAsBytes(this.utf16SliceAligned()), std.mem.sliceAsBytes(other.utf16SliceAligned()), true);
        } else if (left_utf16 == right_utf16) {
            return strings.eqlLong(this.slice(), other.slice(), true);
        }

        const utf16: ZigString = if (left_utf16) this else other;
        const latin1: ZigString = if (left_utf16) other else this;

        if (latin1.isAllASCII()) {
            return strings.utf16EqlString(utf16.utf16SliceAligned(), latin1.slice());
        }

        // slow path
        var utf16_slice = utf16.toSlice(bun.default_allocator);
        var latin1_slice = latin1.toSlice(bun.default_allocator);
        defer utf16_slice.deinit();
        defer latin1_slice.deinit();
        return strings.eqlLong(utf16_slice.slice(), latin1_slice.slice(), true);
    }

    pub fn isAllASCII(this: ZigString) bool {
        if (this.is16Bit()) {
            return strings.firstNonASCII16([]const u16, this.utf16SliceAligned()) == null;
        }

        return strings.isAllASCII(this.slice());
    }

    pub fn clone(this: ZigString, allocator: std.mem.Allocator) !ZigString {
        var sliced = this.toSlice(allocator);
        if (!sliced.isAllocated()) {
            var str = ZigString.init(try allocator.dupe(u8, sliced.slice()));
            str.mark();
            str.markUTF8();
            return str;
        }

        return this;
    }

    extern fn ZigString__toJSONObject(this: *const ZigString, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;

    pub fn toJSONObject(this: ZigString, globalThis: *JSC.JSGlobalObject) JSValue {
        JSC.markBinding(@src());
        return ZigString__toJSONObject(&this, globalThis);
    }

    extern fn BunString__toURL(this: *const ZigString, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;

    pub fn toURL(this: ZigString, globalThis: *JSC.JSGlobalObject) JSValue {
        JSC.markBinding(@src());
        return BunString__toURL(&this, globalThis);
    }

    pub fn hasPrefixChar(this: ZigString, char: u8) bool {
        if (this.len == 0)
            return false;

        if (this.is16Bit()) {
            return this.utf16SliceAligned()[0] == char;
        }

        return this.slice()[0] == char;
    }

    pub fn substringWithLen(this: ZigString, start_index: usize, end_index: usize) ZigString {
        if (this.is16Bit()) {
            return ZigString.from16SliceMaybeGlobal(this.utf16SliceAligned()[start_index..end_index], this.isGloballyAllocated());
        }

        var out = ZigString.init(this.slice()[start_index..end_index]);
        if (this.isUTF8()) {
            out.markUTF8();
        }

        if (this.isGloballyAllocated()) {
            out.mark();
        }

        return out;
    }

    pub fn substring(this: ZigString, start_index: usize) ZigString {
        return this.substringWithLen(@min(this.len, start_index), this.len);
    }

    pub fn maxUTF8ByteLength(this: ZigString) usize {
        if (this.isUTF8())
            return this.len;

        if (this.is16Bit()) {
            return this.utf16SliceAligned().len * 3;
        }

        // latin1
        return this.len * 2;
    }

    pub fn utf16ByteLength(this: ZigString) usize {
        if (this.isUTF8()) {
            return bun.simdutf.length.utf16.from.utf8(this.slice());
        }

        if (this.is16Bit()) {
            return this.len * 2;
        }

        return JSC.WebCore.Encoder.byteLengthU8(this.slice().ptr, this.slice().len, .utf16le);
    }

    pub fn latin1ByteLength(this: ZigString) usize {
        if (this.isUTF8()) {
            @panic("TODO");
        }

        return this.len;
    }

    /// Count the number of bytes in the UTF-8 version of the string.
    /// This function is slow. Use maxUITF8ByteLength() to get a quick estimate
    pub fn utf8ByteLength(this: ZigString) usize {
        if (this.isUTF8()) {
            return this.len;
        }

        if (this.is16Bit()) {
            return JSC.WebCore.Encoder.byteLengthU16(this.utf16SliceAligned().ptr, this.utf16Slice().len, .utf8);
        }

        return JSC.WebCore.Encoder.byteLengthU8(this.slice().ptr, this.slice().len, .utf8);
    }

    pub fn toOwnedSlice(this: ZigString, allocator: std.mem.Allocator) ![]u8 {
        if (this.isUTF8())
            return try allocator.dupeZ(u8, this.slice());

        var list = std.ArrayList(u8).init(allocator);
        list = if (this.is16Bit())
            try strings.toUTF8ListWithType(list, []const u16, this.utf16SliceAligned())
        else
            try strings.allocateLatin1IntoUTF8WithList(list, 0, []const u8, this.slice());

        if (list.capacity > list.items.len) {
            list.items.ptr[list.items.len] = 0;
        }

        return list.items;
    }

    pub fn toOwnedSliceZ(this: ZigString, allocator: std.mem.Allocator) ![:0]u8 {
        if (this.isUTF8())
            return allocator.dupeZ(u8, this.slice());

        var list = std.ArrayList(u8).init(allocator);
        list = if (this.is16Bit())
            try strings.toUTF8ListWithType(list, []const u16, this.utf16SliceAligned())
        else
            try strings.allocateLatin1IntoUTF8WithList(list, 0, []const u8, this.slice());

        return list.toOwnedSliceSentinel(0);
    }

    pub fn trunc(this: ZigString, len: usize) ZigString {
        return .{ ._unsafe_ptr_do_not_use = this._unsafe_ptr_do_not_use, .len = @min(len, this.len) };
    }

    pub fn eqlComptime(this: ZigString, comptime other: []const u8) bool {
        if (this.is16Bit()) {
            return strings.eqlComptimeUTF16(this.utf16SliceAligned(), other);
        }

        if (comptime strings.isAllASCII(other)) {
            if (this.len != other.len)
                return false;

            return strings.eqlComptimeIgnoreLen(this.slice(), other);
        }

        @compileError("Not implemented yet for latin1");
    }

    pub const shim = Shimmer("", "ZigString", @This());

    pub inline fn length(this: ZigString) usize {
        return this.len;
    }

    pub fn byteSlice(this: ZigString) []const u8 {
        if (this.is16Bit()) {
            return std.mem.sliceAsBytes(this.utf16SliceAligned());
        }

        return this.slice();
    }

    pub fn markStatic(this: *ZigString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 60)));
    }

    pub fn isStatic(this: *const ZigString) bool {
        return @intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 60) != 0;
    }

    pub const Slice = struct {
        allocator: NullableAllocator = .{},
        ptr: [*]const u8 = undefined,
        len: u32 = 0,

        pub fn reportExtraMemory(this: *const Slice, vm: *JSC.VM) void {
            if (this.allocator.get()) |allocator| {
                // Don't report it if the memory is actually owned by JSC.
                if (!bun.String.isWTFAllocator(allocator)) {
                    vm.reportExtraMemory(this.len);
                }
            }
        }

        pub fn isWTFAllocated(this: *const Slice) bool {
            return bun.String.isWTFAllocator(this.allocator.get() orelse return false);
        }

        pub fn init(allocator: std.mem.Allocator, input: []const u8) Slice {
            return .{
                .ptr = input.ptr,
                .len = @as(u32, @truncate(input.len)),
                .allocator = NullableAllocator.init(allocator),
            };
        }

        pub fn toZigString(this: Slice) ZigString {
            if (this.isAllocated())
                return ZigString.initUTF8(this.ptr[0..this.len]);
            return ZigString.init(this.slice());
        }

        pub inline fn length(this: Slice) usize {
            return this.len;
        }

        pub const byteSlice = Slice.slice;

        pub fn fromUTF8NeverFree(input: []const u8) Slice {
            return .{
                .ptr = input.ptr,
                .len = @as(u32, @truncate(input.len)),
                .allocator = .{},
            };
        }

        pub const empty = Slice{ .ptr = "", .len = 0 };

        pub inline fn isAllocated(this: Slice) bool {
            return !this.allocator.isNull();
        }

        pub fn toOwned(this: Slice, allocator: std.mem.Allocator) OOM!Slice {
            const duped = try allocator.dupe(u8, this.ptr[0..this.len]);
            return .{ .allocator = .init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        // TODO: this is identical to `cloneIfNeeded`
        pub fn clone(this: Slice, allocator: std.mem.Allocator) OOM!Slice {
            if (this.isAllocated()) {
                return Slice{ .allocator = this.allocator, .ptr = this.ptr, .len = this.len };
            }

            const duped = try allocator.dupe(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn cloneIfNeeded(this: Slice, allocator: std.mem.Allocator) !Slice {
            if (this.isAllocated()) {
                return this;
            }

            const duped = try allocator.dupe(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn cloneWithTrailingSlash(this: Slice, allocator: std.mem.Allocator) !Slice {
            const buf = try strings.cloneNormalizingSeparators(allocator, this.slice());
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = buf.ptr, .len = @as(u32, @truncate(buf.len)) };
        }

        pub fn cloneZ(this: Slice, allocator: std.mem.Allocator) !Slice {
            if (this.isAllocated() or this.len == 0) {
                return this;
            }

            const duped = try allocator.dupeZ(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn slice(this: Slice) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn sliceZ(this: Slice) [:0]const u8 {
            return this.ptr[0..this.len :0];
        }

        pub fn toSliceZ(this: Slice, buf: []u8) [:0]const u8 {
            if (this.len == 0) {
                return "";
            }

            if (this.ptr[this.len] == 0) {
                return this.sliceZ();
            }

            if (this.len >= buf.len) {
                return "";
            }

            bun.copy(u8, buf, this.slice());
            buf[this.len] = 0;
            return buf[0..this.len :0];
        }

        pub fn mut(this: Slice) []u8 {
            return @as([*]u8, @ptrFromInt(@intFromPtr(this.ptr)))[0..this.len];
        }

        /// Does nothing if the slice is not allocated
        pub fn deinit(this: *const Slice) void {
            this.allocator.free(this.slice());
        }
    };

    pub const name = "ZigString";
    pub const namespace = "";

    pub inline fn is16Bit(this: *const ZigString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 63)) != 0;
    }

    pub inline fn utf16Slice(this: *const ZigString) []align(1) const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("ZigString.utf16Slice() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return @as([*]align(1) const u16, @ptrCast(untagged(this._unsafe_ptr_do_not_use)))[0..this.len];
    }

    pub inline fn utf16SliceAligned(this: *const ZigString) []const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("ZigString.utf16SliceAligned() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return @as([*]const u16, @ptrCast(@alignCast(untagged(this._unsafe_ptr_do_not_use))))[0..this.len];
    }

    pub inline fn isEmpty(this: *const ZigString) bool {
        return this.len == 0;
    }

    pub fn fromStringPointer(ptr: StringPointer, buf: string, to: *ZigString) void {
        to.* = ZigString{
            .len = ptr.length,
            ._unsafe_ptr_do_not_use = buf[ptr.offset..][0..ptr.length].ptr,
        };
    }

    pub fn sortDesc(slice_: []ZigString) void {
        std.sort.block(ZigString, slice_, {}, cmpDesc);
    }

    pub fn cmpDesc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsDesc({}, a.slice(), b.slice());
    }

    pub fn sortAsc(slice_: []ZigString) void {
        std.sort.block(ZigString, slice_, {}, cmpAsc);
    }

    pub fn cmpAsc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsAsc({}, a.slice(), b.slice());
    }

    pub inline fn init(slice_: []const u8) ZigString {
        return ZigString{ ._unsafe_ptr_do_not_use = slice_.ptr, .len = slice_.len };
    }

    pub fn initUTF8(slice_: []const u8) ZigString {
        var out = init(slice_);
        out.markUTF8();
        return out;
    }

    pub fn fromUTF8(slice_: []const u8) ZigString {
        var out = init(slice_);
        if (!strings.isAllASCII(slice_))
            out.markUTF8();

        return out;
    }

    pub fn static(comptime slice_: [:0]const u8) *const ZigString {
        const Holder = struct {
            const null_terminated_ascii_literal = slice_;
            pub const value = &ZigString{ ._unsafe_ptr_do_not_use = null_terminated_ascii_literal.ptr, .len = null_terminated_ascii_literal.len };
        };

        return Holder.value;
    }

    pub const GithubActionFormatter = struct {
        text: ZigString,

        pub fn format(this: GithubActionFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            var bytes = this.text.toSlice(bun.default_allocator);
            defer bytes.deinit();
            try bun.fmt.githubActionWriter(writer, bytes.slice());
        }
    };

    pub fn githubAction(this: ZigString) GithubActionFormatter {
        return GithubActionFormatter{ .text = this };
    }

    pub fn toAtomicValue(this: *const ZigString, globalThis: *JSC.JSGlobalObject) JSValue {
        return shim.cppFn("toAtomicValue", .{ this, globalThis });
    }

    pub fn initUTF16(items: []const u16) ZigString {
        var out = ZigString{ ._unsafe_ptr_do_not_use = @ptrCast(items), .len = items.len };
        out.markUTF16();
        return out;
    }

    pub fn from16Slice(slice_: []const u16) ZigString {
        return from16(slice_.ptr, slice_.len);
    }

    fn from16SliceMaybeGlobal(slice_: []const u16, global: bool) ZigString {
        var str = init(@as([*]const u8, @alignCast(@ptrCast(slice_.ptr)))[0..slice_.len]);
        str.markUTF16();
        if (global) {
            str.mark();
        }
        return str;
    }

    /// Globally-allocated memory only
    pub fn from16(slice_: [*]const u16, len: usize) ZigString {
        var str = init(@as([*]const u8, @ptrCast(slice_))[0..len]);
        str.markUTF16();
        str.mark();
        str.assertGlobal();
        return str;
    }

    pub fn toBase64DataURL(this: ZigString, allocator: std.mem.Allocator) ![]const u8 {
        const slice_ = this.slice();
        const size = std.base64.standard.Encoder.calcSize(slice_.len);
        var buf = try allocator.alloc(u8, size + "data:;base64,".len);
        const encoded = std.base64.url_safe.Encoder.encode(buf["data:;base64,".len..], slice_);
        buf[0.."data:;base64,".len].* = "data:;base64,".*;
        return buf[0 .. "data:;base64,".len + encoded.len];
    }

    pub fn detectEncoding(this: *ZigString) void {
        if (!strings.isAllASCII(this.slice())) {
            this.markUTF16();
        }
    }

    pub fn toExternalU16(ptr: [*]const u16, len: usize, global: *JSGlobalObject) JSValue {
        if (len > String.max_length()) {
            bun.default_allocator.free(ptr[0..len]);
            global.ERR_STRING_TOO_LONG("Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }
        return shim.cppFn("toExternalU16", .{ ptr, len, global });
    }

    pub fn isUTF8(this: ZigString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 61)) != 0;
    }

    pub fn markUTF8(this: *ZigString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 61)));
    }

    pub fn markUTF16(this: *ZigString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 63)));
    }

    pub fn setOutputEncoding(this: *ZigString) void {
        if (!this.is16Bit()) this.detectEncoding();
        if (this.is16Bit()) this.markUTF8();
    }

    pub inline fn isGloballyAllocated(this: ZigString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 62)) != 0;
    }

    pub inline fn deinitGlobal(this: ZigString) void {
        bun.default_allocator.free(this.slice());
    }

    pub const mark = markGlobal;

    pub inline fn markGlobal(this: *ZigString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 62)));
    }

    pub fn format(self: ZigString, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (self.isUTF8()) {
            try writer.writeAll(self.slice());
            return;
        }

        if (self.is16Bit()) {
            try bun.fmt.formatUTF16Type(@TypeOf(self.utf16Slice()), self.utf16Slice(), writer);
            return;
        }

        try bun.fmt.formatLatin1(self.slice(), writer);
    }

    pub inline fn toRef(slice_: []const u8, global: *JSGlobalObject) C_API.JSValueRef {
        return init(slice_).toJS(global).asRef();
    }

    pub const Empty = ZigString{ ._unsafe_ptr_do_not_use = "", .len = 0 };

    pub inline fn untagged(ptr: [*]const u8) [*]const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        @setRuntimeSafety(false);
        return @as([*]const u8, @ptrFromInt(@as(u53, @truncate(@intFromPtr(ptr)))));
    }

    pub fn slice(this: *const ZigString) []const u8 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and this.is16Bit()) {
                @panic("ZigString.slice() called on a UTF-16 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return untagged(this._unsafe_ptr_do_not_use)[0..@min(this.len, std.math.maxInt(u32))];
    }

    pub fn dupe(this: ZigString, allocator: std.mem.Allocator) ![]const u8 {
        return try allocator.dupe(u8, this.slice());
    }

    pub fn toSliceFast(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            const buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }

        return Slice{
            .ptr = untagged(this._unsafe_ptr_do_not_use),
            .len = @as(u32, @truncate(this.len)),
        };
    }

    /// This function checks if the input is latin1 non-ascii
    /// It is slow but safer when the input is from JavaScript
    pub fn toSlice(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            const buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }

        if (!this.isUTF8() and !strings.isAllASCII(untagged(this._unsafe_ptr_do_not_use)[0..this.len])) {
            const buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }

        return Slice{
            .ptr = untagged(this._unsafe_ptr_do_not_use),
            .len = @as(u32, @truncate(this.len)),
        };
    }

    pub fn toSliceClone(this: ZigString, allocator: std.mem.Allocator) OOM!Slice {
        if (this.len == 0)
            return Slice.empty;
        const buffer = try this.toOwnedSlice(allocator);
        return Slice{
            .allocator = NullableAllocator.init(allocator),
            .ptr = buffer.ptr,
            .len = @as(u32, @truncate(buffer.len)),
        };
    }

    pub fn toSliceZ(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;

        if (is16Bit(&this)) {
            const buffer = this.toOwnedSliceZ(allocator) catch unreachable;
            return Slice{
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
                .allocator = NullableAllocator.init(allocator),
            };
        }

        return Slice{
            .ptr = untagged(this._unsafe_ptr_do_not_use),
            .len = @as(u32, @truncate(this.len)),
        };
    }

    pub fn sliceZBuf(this: ZigString, buf: *bun.PathBuffer) ![:0]const u8 {
        return try std.fmt.bufPrintZ(buf, "{}", .{this});
    }

    pub inline fn full(this: *const ZigString) []const u8 {
        return untagged(this._unsafe_ptr_do_not_use)[0..this.len];
    }

    pub fn trimmedSlice(this: *const ZigString) []const u8 {
        return strings.trim(this.full(), " \r\n");
    }

    inline fn assertGlobalIfNeeded(this: *const ZigString) void {
        if (comptime bun.Environment.allow_assert) {
            if (this.isGloballyAllocated()) {
                this.assertGlobal();
            }
        }
    }

    inline fn assertGlobal(this: *const ZigString) void {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(this.len == 0 or
                bun.Mimalloc.mi_is_in_heap_region(untagged(this._unsafe_ptr_do_not_use)) or
                bun.Mimalloc.mi_check_owned(untagged(this._unsafe_ptr_do_not_use)));
        }
    }

    pub fn toExternalValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        if (this.len > String.max_length()) {
            bun.default_allocator.free(@constCast(this.byteSlice()));
            global.ERR_STRING_TOO_LONG("Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }
        return shim.cppFn("toExternalValue", .{ this, global });
    }

    pub fn toExternalValueWithCallback(
        this: *const ZigString,
        global: *JSGlobalObject,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.C) void,
    ) JSValue {
        return shim.cppFn("toExternalValueWithCallback", .{ this, global, callback });
    }

    pub fn external(
        this: *const ZigString,
        global: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.C) void,
    ) JSValue {
        if (this.len > String.max_length()) {
            callback(ctx, @constCast(@ptrCast(this.byteSlice().ptr)), this.len);
            global.ERR_STRING_TOO_LONG("Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }

        return shim.cppFn("external", .{ this, global, ctx, callback });
    }

    pub fn to16BitValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        return shim.cppFn("to16BitValue", .{ this, global });
    }

    pub fn withEncoding(this: *const ZigString) ZigString {
        var out = this.*;
        out.setOutputEncoding();
        return out;
    }

    pub fn toJSStringRef(this: *const ZigString) C_API.JSStringRef {
        if (comptime @hasDecl(@import("root").bun, "bindgen")) {
            return undefined;
        }

        return if (this.is16Bit())
            C_API.JSStringCreateWithCharactersNoCopy(@as([*]const u16, @ptrCast(@alignCast(untagged(this._unsafe_ptr_do_not_use)))), this.len)
        else
            C_API.JSStringCreateStatic(untagged(this._unsafe_ptr_do_not_use), this.len);
    }

    pub fn toErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toErrorInstance", .{ this, global });
    }

    pub fn toTypeErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toTypeErrorInstance", .{ this, global });
    }

    pub fn toSyntaxErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toSyntaxErrorInstance", .{ this, global });
    }

    pub fn toRangeErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toRangeErrorInstance", .{ this, global });
    }

    pub const Extern = [_][]const u8{
        "toAtomicValue",
        "toExternalValue",
        "to16BitValue",
        "toErrorInstance",
        "toExternalU16",
        "toExternalValueWithCallback",
        "external",
        "toTypeErrorInstance",
        "toSyntaxErrorInstance",
        "toRangeErrorInstance",
    };
};

pub const StringPointer = struct {
    offset: usize = 0,
    length: usize = 0,
};
