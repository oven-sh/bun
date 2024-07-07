const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const is_bindgen: bool = false;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const ConsoleObject = JSC.ConsoleObject;
const FFI = @import("./FFI.zig");
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const String = bun.String;
const ErrorableString = JSC.ErrorableString;
pub const JSObject = extern struct {
    pub const shim = Shimmer("JSC", "JSObject", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSObject.h";
    pub const name = "JSC::JSObject";
    pub const namespace = "JSC";

    pub fn getArrayLength(this: *JSObject) usize {
        return cppFn("getArrayLength", .{
            this,
        });
    }

    const InitializeCallback = *const fn (ctx: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void;
    pub fn create(global_object: *JSGlobalObject, length: usize, ctx: *anyopaque, initializer: InitializeCallback) JSValue {
        return cppFn("create", .{
            global_object,
            length,
            ctx,
            initializer,
        });
    }

    extern fn JSC__createStructure(*JSC.JSGlobalObject, *JSC.JSCell, u32, names: [*]bun.String) JSC.JSValue;
    extern fn JSC__createEmptyObjectWithStructure(*JSC.JSGlobalObject, *anyopaque) JSC.JSValue;
    extern fn JSC__putDirectOffset(*JSC.VM, JSC.JSValue, offset: u32, JSC.JSValue) void;

    pub fn createStructure(global: *JSGlobalObject, owner: JSC.JSValue, length: u32, names: [*]bun.String) JSValue {
        JSC.markBinding(@src());
        return JSC__createStructure(global, owner.asCell(), length, names);
    }

    pub fn uninitialized(global: *JSGlobalObject, structure: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        return JSC__createEmptyObjectWithStructure(global, structure.asCell());
    }

    pub fn putDirectOffset(this: JSValue, vm: *VM, offset: u32, value: JSValue) void {
        JSC.markBinding(@src());
        return JSC__putDirectOffset(vm, this, offset, value);
    }

    pub fn Initializer(comptime Ctx: type, comptime func: fn (*Ctx, obj: *JSObject, global: *JSGlobalObject) void) type {
        return struct {
            pub fn call(this: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void {
                @call(bun.callmod_inline, func, .{ @as(*Ctx, @ptrCast(@alignCast(this.?))), obj.?, global.? });
            }
        };
    }

    pub fn createWithInitializer(comptime Ctx: type, creator: *Ctx, global: *JSGlobalObject, length: usize) JSValue {
        const Type = Initializer(Ctx, Ctx.create);
        return create(global, length, creator, Type.call);
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return cppFn("getIndex", .{
            this,
            globalThis,
            i,
        });
    }

    pub fn putRecord(this: *JSObject, global: *JSGlobalObject, key: *ZigString, values: [*]ZigString, values_len: usize) void {
        return cppFn("putRecord", .{ this, global, key, values, values_len });
    }

    pub fn getDirect(this: *JSObject, globalThis: *JSGlobalObject, str: *const ZigString) JSValue {
        return cppFn("getDirect", .{
            this,
            globalThis,
            str,
        });
    }

    pub const Extern = [_][]const u8{
        "putRecord",
        "create",
        "getArrayLength",
        "getIndex",
        "putAtIndex",
        "getDirect",
    };
};

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
        return switch (this.as()) {
            inline else => |repr| switch (encoding) {
                inline else => |enc| JSC.WebCore.Encoder.constructFrom(std.meta.Child(@TypeOf(repr)), repr, enc),
            },
        };
    }

    pub fn dupeForJS(utf8: []const u8, allocator: std.mem.Allocator) !ZigString {
        if (try strings.toUTF16Alloc(allocator, utf8, false, false)) |utf16| {
            var out = ZigString.init16(utf16);
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

        try list.append(0);
        return list.items[0 .. list.items.len - 1 :0];
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
        this.ptr = @as([*]const u8, @ptrFromInt(@intFromPtr(this.ptr) | (1 << 60)));
    }

    pub fn isStatic(this: *const ZigString) bool {
        return @intFromPtr(this.ptr) & (1 << 60) != 0;
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

        pub fn clone(this: Slice, allocator: std.mem.Allocator) !Slice {
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
            return bun.cstring(this.ptr[0..this.len]);
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
            return bun.cstring(buf[0..this.len]);
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

    pub fn static(comptime slice_: []const u8) *const ZigString {
        const Holder = struct {
            pub const value = ZigString{ ._unsafe_ptr_do_not_use = slice_.ptr, .len = slice_.len };
        };

        return &Holder.value;
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

    pub fn init16(slice_: []const u16) ZigString {
        var out = ZigString{ ._unsafe_ptr_do_not_use = std.mem.sliceAsBytes(slice_).ptr, .len = slice_.len };
        out.markUTF16();
        return out;
    }

    pub fn from(slice_: JSC.C.JSValueRef, ctx: JSC.C.JSContextRef) ZigString {
        return JSC.JSValue.fromRef(slice_).getZigString(ctx.ptr());
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

    pub fn toSliceClone(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        const buffer = this.toOwnedSlice(allocator) catch unreachable;
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

pub const DOMURL = opaque {
    pub const shim = Shimmer("WebCore", "DOMURL", @This());

    const cppFn = shim.cppFn;
    pub const name = "WebCore::DOMURL";

    pub fn cast_(value: JSValue, vm: *VM) ?*DOMURL {
        return shim.cppFn("cast_", .{ value, vm });
    }

    pub fn cast(value: JSValue) ?*DOMURL {
        return cast_(value, JSC.VirtualMachine.get().global.vm());
    }

    pub fn href_(this: *DOMURL, out: *ZigString) void {
        return shim.cppFn("href_", .{ this, out });
    }

    pub fn href(this: *DOMURL) ZigString {
        var out = ZigString.Empty;
        this.href_(&out);
        return out;
    }

    pub fn fileSystemPath(this: *DOMURL) bun.String {
        return shim.cppFn("fileSystemPath", .{this});
    }

    pub fn pathname_(this: *DOMURL, out: *ZigString) void {
        return shim.cppFn("pathname_", .{ this, out });
    }

    pub fn pathname(this: *DOMURL) ZigString {
        var out = ZigString.Empty;
        this.pathname_(&out);
        return out;
    }

    pub const Extern = [_][]const u8{
        "cast_",
        "href_",
        "pathname_",
        "fileSystemPath",
    };
};

const Api = @import("../../api/schema.zig").Api;

pub const DOMFormData = opaque {
    pub const shim = Shimmer("WebCore", "DOMFormData", @This());

    pub const name = "WebCore::DOMFormData";
    pub const include = "DOMFormData.h";
    pub const namespace = "WebCore";

    const cppFn = shim.cppFn;

    pub fn create(
        global: *JSGlobalObject,
    ) JSValue {
        return shim.cppFn("create", .{
            global,
        });
    }

    pub fn createFromURLQuery(
        global: *JSGlobalObject,
        query: *ZigString,
    ) JSValue {
        return shim.cppFn("createFromURLQuery", .{
            global,
            query,
        });
    }

    extern fn DOMFormData__toQueryString(
        *DOMFormData,
        ctx: *anyopaque,
        callback: *const fn (ctx: *anyopaque, *ZigString) callconv(.C) void,
    ) void;

    pub fn toQueryString(
        this: *DOMFormData,
        comptime Ctx: type,
        ctx: Ctx,
        comptime callback: fn (ctx: Ctx, ZigString) callconv(.C) void,
    ) void {
        const Wrapper = struct {
            const cb = callback;
            pub fn run(c: *anyopaque, str: *ZigString) callconv(.C) void {
                cb(@as(Ctx, @ptrCast(c)), str.*);
            }
        };

        DOMFormData__toQueryString(this, ctx, &Wrapper.run);
    }

    pub fn fromJS(
        value: JSValue,
    ) ?*DOMFormData {
        return shim.cppFn("fromJS", .{
            value,
        });
    }

    pub fn append(
        this: *DOMFormData,
        name_: *ZigString,
        value_: *ZigString,
    ) void {
        return shim.cppFn("append", .{
            this,
            name_,
            value_,
        });
    }

    pub fn appendBlob(
        this: *DOMFormData,
        global: *JSC.JSGlobalObject,
        name_: *ZigString,
        blob: *anyopaque,
        filename_: *ZigString,
    ) void {
        return shim.cppFn("appendBlob", .{
            this,
            global,
            name_,
            blob,
            filename_,
        });
    }

    pub fn count(
        this: *DOMFormData,
    ) usize {
        return shim.cppFn("count", .{
            this,
        });
    }

    const ForEachFunction = *const fn (
        ctx_ptr: ?*anyopaque,
        name: *ZigString,
        value_ptr: *anyopaque,
        filename: ?*ZigString,
        is_blob: u8,
    ) callconv(.C) void;

    extern fn DOMFormData__forEach(*DOMFormData, ?*anyopaque, ForEachFunction) void;
    pub const FormDataEntry = union(enum) {
        string: ZigString,
        file: struct {
            blob: *JSC.WebCore.Blob,
            filename: ZigString,
        },
    };
    pub fn forEach(
        this: *DOMFormData,
        comptime Context: type,
        ctx: *Context,
        comptime callback_wrapper: *const fn (ctx: *Context, name: ZigString, value: FormDataEntry) void,
    ) void {
        const Wrap = struct {
            const wrapper = callback_wrapper;
            pub fn forEachWrapper(
                ctx_ptr: ?*anyopaque,
                name_: *ZigString,
                value_ptr: *anyopaque,
                filename: ?*ZigString,
                is_blob: u8,
            ) callconv(.C) void {
                const ctx_ = bun.cast(*Context, ctx_ptr.?);
                const value = if (is_blob == 0)
                    FormDataEntry{ .string = bun.cast(*ZigString, value_ptr).* }
                else
                    FormDataEntry{
                        .file = .{
                            .blob = bun.cast(*JSC.WebCore.Blob, value_ptr),
                            .filename = (filename orelse &ZigString.Empty).*,
                        },
                    };

                wrapper(ctx_, name_.*, value);
            }
        };
        JSC.markBinding(@src());
        DOMFormData__forEach(this, ctx, Wrap.forEachWrapper);
    }

    pub const Extern = [_][]const u8{
        "create",
        "fromJS",
        "append",
        "appendBlob",
        "count",
        "createFromURLQuery",
    };
};
pub const FetchHeaders = opaque {
    pub const shim = Shimmer("WebCore", "FetchHeaders", @This());

    pub const name = "WebCore::FetchHeaders";
    pub const include = "FetchHeaders.h";
    pub const namespace = "WebCore";

    const cppFn = shim.cppFn;

    pub fn createValue(
        global: *JSGlobalObject,
        names: [*c]Api.StringPointer,
        values: [*c]Api.StringPointer,
        buf: *const ZigString,
        count_: u32,
    ) JSValue {
        return shim.cppFn("createValue", .{
            global,
            names,
            values,
            buf,
            count_,
        });
    }

    pub fn createFromJS(
        global: *JSGlobalObject,
        value: JSValue,
    ) ?*FetchHeaders {
        return shim.cppFn("createFromJS", .{
            global,
            value,
        });
    }

    pub fn putDefault(this: *FetchHeaders, name_: []const u8, value: []const u8, global: *JSGlobalObject) void {
        if (this.has(&ZigString.init(name_), global)) {
            return;
        }

        this.put_(&ZigString.init(name_), &ZigString.init(value), global);
    }

    pub fn from(
        global: *JSGlobalObject,
        names: [*c]Api.StringPointer,
        values: [*c]Api.StringPointer,
        buf: *const ZigString,
        count_: u32,
    ) JSValue {
        return shim.cppFn("createValue", .{
            global,
            names,
            values,
            buf,
            count_,
        });
    }

    pub fn isEmpty(this: *FetchHeaders) bool {
        return shim.cppFn("isEmpty", .{
            this,
        });
    }

    pub fn createFromUWS(
        global: *JSGlobalObject,
        uws_request: *anyopaque,
    ) *FetchHeaders {
        return shim.cppFn("createFromUWS", .{
            global,
            uws_request,
        });
    }

    pub fn toUWSResponse(
        headers: *FetchHeaders,
        is_ssl: bool,
        uws_response: *anyopaque,
    ) void {
        return shim.cppFn("toUWSResponse", .{
            headers,
            is_ssl,
            uws_response,
        });
    }

    const PicoHeaders = extern struct {
        ptr: ?*const anyopaque,
        len: usize,
    };

    pub fn createEmpty() *FetchHeaders {
        return shim.cppFn("createEmpty", .{});
    }

    pub fn createFromPicoHeaders(
        pico_headers: anytype,
    ) *FetchHeaders {
        const out = PicoHeaders{ .ptr = pico_headers.ptr, .len = pico_headers.len };
        const result = shim.cppFn("createFromPicoHeaders_", .{
            &out,
        });
        return result;
    }

    pub fn createFromPicoHeaders_(
        pico_headers: *const anyopaque,
    ) *FetchHeaders {
        return shim.cppFn("createFromPicoHeaders_", .{
            pico_headers,
        });
    }

    pub fn append(
        this: *FetchHeaders,
        name_: *const ZigString,
        value: *const ZigString,
        global: *JSGlobalObject,
    ) void {
        return shim.cppFn("append", .{
            this,
            name_,
            value,
            global,
        });
    }

    pub fn put_(
        this: *FetchHeaders,
        name_: *const ZigString,
        value: *const ZigString,
        global: *JSGlobalObject,
    ) void {
        return shim.cppFn("put_", .{
            this,
            name_,
            value,
            global,
        });
    }

    pub fn put(
        this: *FetchHeaders,
        name_: []const u8,
        value: []const u8,
        global: *JSGlobalObject,
    ) void {
        this.put_(&ZigString.init(name_), &ZigString.init(value), global);
    }

    pub fn get_(
        this: *FetchHeaders,
        name_: *const ZigString,
        out: *ZigString,
        global: *JSGlobalObject,
    ) void {
        shim.cppFn("get_", .{
            this,
            name_,
            out,
            global,
        });
    }

    pub fn get(
        this: *FetchHeaders,
        name_: []const u8,
        global: *JSGlobalObject,
    ) ?[]const u8 {
        var out = ZigString.Empty;
        get_(this, &ZigString.init(name_), &out, global);
        if (out.len > 0) {
            return out.slice();
        }

        return null;
    }

    pub fn has(
        this: *FetchHeaders,
        name_: *const ZigString,
        global: *JSGlobalObject,
    ) bool {
        return shim.cppFn("has", .{
            this,
            name_,
            global,
        });
    }

    pub fn fastHas(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) bool {
        return fastHas_(this, @intFromEnum(name_));
    }

    pub fn fastGet(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) ?ZigString {
        var str = ZigString.init("");
        fastGet_(this, @intFromEnum(name_), &str);
        if (str.len == 0) {
            return null;
        }

        return str;
    }

    pub fn fastHas_(
        this: *FetchHeaders,
        name_: u8,
    ) bool {
        return shim.cppFn("fastHas_", .{
            this,
            name_,
        });
    }

    pub fn fastGet_(
        this: *FetchHeaders,
        name_: u8,
        str: *ZigString,
    ) void {
        return shim.cppFn("fastGet_", .{
            this,
            name_,
            str,
        });
    }

    pub const HTTPHeaderName = enum(u8) {
        Accept,
        AcceptCharset,
        AcceptEncoding,
        AcceptLanguage,
        AcceptRanges,
        AccessControlAllowCredentials,
        AccessControlAllowHeaders,
        AccessControlAllowMethods,
        AccessControlAllowOrigin,
        AccessControlExposeHeaders,
        AccessControlMaxAge,
        AccessControlRequestHeaders,
        AccessControlRequestMethod,
        Age,
        Authorization,
        CacheControl,
        Connection,
        ContentDisposition,
        ContentEncoding,
        ContentLanguage,
        ContentLength,
        ContentLocation,
        ContentRange,
        ContentSecurityPolicy,
        ContentSecurityPolicyReportOnly,
        ContentType,
        Cookie,
        Cookie2,
        CrossOriginEmbedderPolicy,
        CrossOriginEmbedderPolicyReportOnly,
        CrossOriginOpenerPolicy,
        CrossOriginOpenerPolicyReportOnly,
        CrossOriginResourcePolicy,
        DNT,
        Date,
        DefaultStyle,
        ETag,
        Expect,
        Expires,
        Host,
        IcyMetaInt,
        IcyMetadata,
        IfMatch,
        IfModifiedSince,
        IfNoneMatch,
        IfRange,
        IfUnmodifiedSince,
        KeepAlive,
        LastEventID,
        LastModified,
        Link,
        Location,
        Origin,
        PingFrom,
        PingTo,
        Pragma,
        ProxyAuthorization,
        Purpose,
        Range,
        Referer,
        ReferrerPolicy,
        Refresh,
        ReportTo,
        SecFetchDest,
        SecFetchMode,
        SecWebSocketAccept,
        SecWebSocketExtensions,
        SecWebSocketKey,
        SecWebSocketProtocol,
        SecWebSocketVersion,
        ServerTiming,
        ServiceWorker,
        ServiceWorkerAllowed,
        ServiceWorkerNavigationPreload,
        SetCookie,
        SetCookie2,
        SourceMap,
        StrictTransportSecurity,
        TE,
        TimingAllowOrigin,
        Trailer,
        TransferEncoding,
        Upgrade,
        UpgradeInsecureRequests,
        UserAgent,
        Vary,
        Via,
        XContentTypeOptions,
        XDNSPrefetchControl,
        XFrameOptions,
        XSourceMap,
        XTempTablet,
        XXSSProtection,
    };

    pub fn fastRemove(
        this: *FetchHeaders,
        header: HTTPHeaderName,
    ) void {
        return fastRemove_(this, @intFromEnum(header));
    }

    pub fn fastRemove_(
        this: *FetchHeaders,
        header: u8,
    ) void {
        return shim.cppFn("fastRemove_", .{
            this,
            header,
        });
    }

    pub fn remove(
        this: *FetchHeaders,
        name_: *const ZigString,
        global: *JSGlobalObject,
    ) void {
        return shim.cppFn("remove", .{
            this,
            name_,
            global,
        });
    }

    pub fn cast_(value: JSValue, vm: *VM) ?*FetchHeaders {
        return shim.cppFn("cast_", .{ value, vm });
    }

    pub fn cast(value: JSValue) ?*FetchHeaders {
        return cast_(value, JSC.VirtualMachine.get().global.vm());
    }

    pub fn toJS(this: *FetchHeaders, globalThis: *JSGlobalObject) JSValue {
        return shim.cppFn("toJS", .{ this, globalThis });
    }

    pub fn count(
        this: *FetchHeaders,
        names: *u32,
        buf_len: *u32,
    ) void {
        return shim.cppFn("count", .{
            this,
            names,
            buf_len,
        });
    }

    pub fn clone(
        this: *FetchHeaders,
        global: *JSGlobalObject,
    ) JSValue {
        return shim.cppFn("clone", .{
            this,
            global,
        });
    }

    pub fn cloneThis(
        this: *FetchHeaders,
        global: *JSGlobalObject,
    ) ?*FetchHeaders {
        return shim.cppFn("cloneThis", .{
            this,
            global,
        });
    }

    pub fn deref(
        this: *FetchHeaders,
    ) void {
        return shim.cppFn("deref", .{
            this,
        });
    }

    pub fn copyTo(
        this: *FetchHeaders,
        names: ?[*]Api.StringPointer,
        values: ?[*]Api.StringPointer,
        buf: [*]u8,
    ) void {
        return shim.cppFn("copyTo", .{
            this,
            names,
            values,
            buf,
        });
    }

    pub const Extern = [_][]const u8{
        "fastRemove_",
        "fastGet_",
        "fastHas_",
        "append",
        "cast_",
        "clone",
        "cloneThis",
        "copyTo",
        "count",
        "createFromJS",
        "createEmpty",
        "createFromPicoHeaders_",
        "createFromUWS",
        "createValue",
        "deref",
        "get_",
        "has",
        "put_",
        "remove",
        "toJS",
        "toUWSResponse",
        "isEmpty",
    };
};

pub const SystemError = extern struct {
    errno: c_int = 0,
    /// label for errno
    code: String = String.empty,
    message: String = String.empty,
    path: String = String.empty,
    syscall: String = String.empty,
    fd: bun.FileDescriptor = bun.toFD(-1),

    pub fn Maybe(comptime Result: type) type {
        return union(enum) {
            err: SystemError,
            result: Result,
        };
    }

    pub const shim = Shimmer("", "SystemError", @This());

    pub const name = "SystemError";
    pub const namespace = "";

    pub fn getErrno(this: *const SystemError) bun.C.E {
        // The inverse in bun.sys.Error.toSystemError()
        return @enumFromInt(this.errno * -1);
    }

    pub fn toAnyhowError(this: SystemError) bun.anyhow.Error {
        return bun.anyhow.Error.newSys(this);
    }

    pub fn deref(this: *const SystemError) void {
        this.path.deref();
        this.code.deref();
        this.message.deref();
        this.syscall.deref();
    }

    pub fn ref(this: *SystemError) void {
        this.path.ref();
        this.code.ref();
        this.message.ref();
        this.syscall.ref();
    }

    pub fn toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue {
        defer {
            this.path.deref();
            this.code.deref();
            this.message.deref();
            this.syscall.deref();
        }

        return shim.cppFn("toErrorInstance", .{ this, global });
    }

    pub fn format(self: SystemError, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (!self.path.isEmpty()) {
            // TODO: remove this hardcoding
            switch (bun.Output.enable_ansi_colors_stderr) {
                inline else => |enable_colors| try writer.print(
                    comptime bun.Output.prettyFmt(
                        "<r><red>{}<r><d>:<r> <b>{s}<r>: {} <d>({}())<r>",
                        enable_colors,
                    ),
                    .{
                        self.code,
                        self.path,
                        self.message,
                        self.syscall,
                    },
                ),
            }
        } else
        // TODO: remove this hardcoding
        switch (bun.Output.enable_ansi_colors_stderr) {
            inline else => |enable_colors| try writer.print(
                comptime bun.Output.prettyFmt(
                    "<r><red>{}<r><d>:<r> {} <d>({}())<r>",
                    enable_colors,
                ),
                .{
                    self.code,
                    self.message,
                    self.syscall,
                },
            ),
        }
    }

    pub const Extern = [_][]const u8{
        "toErrorInstance",
    };
};

pub const ReturnableException = *?*Exception;
pub const Sizes = @import("../bindings/sizes.zig");

pub const JSUint8Array = opaque {
    pub const name = "Uint8Array_alias";
    pub fn ptr(this: *JSUint8Array) [*]u8 {
        return @as(*[*]u8, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector)).*;
    }

    pub fn len(this: *JSUint8Array) usize {
        return @as(*usize, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayLength)).*;
    }

    pub fn slice(this: *JSUint8Array) []u8 {
        return this.ptr()[0..this.len()];
    }
};

pub const JSCell = extern struct {
    pub const shim = Shimmer("JSC", "JSCell", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSCell.h";
    pub const name = "JSC::JSCell";
    pub const namespace = "JSC";

    const CellType = enum(u8) { _ };

    pub fn getObject(this: *JSCell) *JSObject {
        return shim.cppFn("getObject", .{this});
    }

    pub fn getType(this: *JSCell) u8 {
        return shim.cppFn("getType", .{
            this,
        });
    }

    pub const Extern = [_][]const u8{ "getObject", "getType" };

    pub fn getGetterSetter(this: *JSCell) *GetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isGetterSetter());
        }
        return @as(*GetterSetter, @ptrCast(@alignCast(this)));
    }

    pub fn getCustomGetterSetter(this: *JSCell) *CustomGetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isCustomGetterSetter());
        }
        return @as(*CustomGetterSetter, @ptrCast(@alignCast(this)));
    }
};

pub const JSString = extern struct {
    pub const shim = Shimmer("JSC", "JSString", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSString.h";
    pub const name = "JSC::JSString";
    pub const namespace = "JSC";

    pub fn toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject {
        return shim.cppFn("toObject", .{ this, global });
    }

    pub fn toZigString(this: *JSString, global: *JSGlobalObject, zig_str: *JSC.ZigString) void {
        return shim.cppFn("toZigString", .{ this, global, zig_str });
    }

    pub fn getZigString(this: *JSString, global: *JSGlobalObject) JSC.ZigString {
        var out = JSC.ZigString.init("");
        this.toZigString(global, &out);
        return out;
    }

    // doesn't always allocate
    pub fn toSlice(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSlice(allocator);
    }

    pub fn toSliceClone(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSliceClone(allocator);
    }

    pub fn toSliceZ(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSliceZ(allocator);
    }

    pub fn eql(this: *const JSString, global: *JSGlobalObject, other: *JSString) bool {
        return shim.cppFn("eql", .{ this, global, other });
    }

    pub fn iterator(this: *JSString, globalObject: *JSGlobalObject, iter: *anyopaque) void {
        return shim.cppFn("iterator", .{ this, globalObject, iter });
    }

    pub fn length(this: *const JSString) usize {
        return shim.cppFn("length", .{
            this,
        });
    }

    pub fn is8Bit(this: *const JSString) bool {
        return shim.cppFn("is8Bit", .{
            this,
        });
    }

    pub const JStringIteratorAppend8Callback = *const fn (*Iterator, [*]const u8, u32) callconv(.C) void;
    pub const JStringIteratorAppend16Callback = *const fn (*Iterator, [*]const u16, u32) callconv(.C) void;
    pub const JStringIteratorWrite8Callback = *const fn (*Iterator, [*]const u8, u32, u32) callconv(.C) void;
    pub const JStringIteratorWrite16Callback = *const fn (*Iterator, [*]const u16, u32, u32) callconv(.C) void;
    pub const Iterator = extern struct {
        data: ?*anyopaque,
        stop: u8,
        append8: ?JStringIteratorAppend8Callback,
        append16: ?JStringIteratorAppend16Callback,
        write8: ?JStringIteratorWrite8Callback,
        write16: ?JStringIteratorWrite16Callback,
    };

    pub const Extern = [_][]const u8{ "toZigString", "iterator", "toObject", "eql", "value", "length", "is8Bit", "createFromOwnedString", "createFromString" };
};

pub const GetterSetter = extern struct {
    pub const shim = Shimmer("JSC", "GetterSetter", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/GetterSetter.h";
    pub const name = "JSC::GetterSetter";
    pub const namespace = "JSC";

    pub fn isGetterNull(this: *GetterSetter) bool {
        return shim.cppFn("isGetterNull", .{this});
    }

    pub fn isSetterNull(this: *GetterSetter) bool {
        return shim.cppFn("isSetterNull", .{this});
    }
};

pub const CustomGetterSetter = extern struct {
    pub const shim = Shimmer("JSC", "CustomGetterSetter", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/CustomGetterSetter.h";
    pub const name = "JSC::CustomGetterSetter";
    pub const namespace = "JSC";

    pub fn isGetterNull(this: *CustomGetterSetter) bool {
        return shim.cppFn("isGetterNull", .{this});
    }

    pub fn isSetterNull(this: *CustomGetterSetter) bool {
        return shim.cppFn("isSetterNull", .{this});
    }
};

pub const JSPromiseRejectionOperation = enum(u32) {
    Reject = 0,
    Handle = 1,
};

pub fn NewGlobalObject(comptime Type: type) type {
    return struct {
        const importNotImpl = "Import not implemented";
        const resolveNotImpl = "resolve not implemented";
        const moduleNotImpl = "Module fetch not implemented";
        pub fn import(global: *JSGlobalObject, specifier: *String, source: *String) callconv(.C) ErrorableString {
            if (comptime @hasDecl(Type, "import")) {
                return @call(bun.callmod_inline, Type.import, .{ global, specifier.*, source.* });
            }
            return ErrorableString.err(error.ImportFailed, String.init(importNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn resolve(
            res: *ErrorableString,
            global: *JSGlobalObject,
            specifier: *String,
            source: *String,
            query_string: *ZigString,
        ) callconv(.C) void {
            if (comptime @hasDecl(Type, "resolve")) {
                @call(bun.callmod_inline, Type.resolve, .{ res, global, specifier.*, source.*, query_string, true });
                return;
            }
            res.* = ErrorableString.err(error.ResolveFailed, String.init(resolveNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *String, source: *String) callconv(.C) void {
            if (comptime @hasDecl(Type, "fetch")) {
                @call(bun.callmod_inline, Type.fetch, .{ ret, global, specifier.*, source.* });
                return;
            }
            ret.* = ErrorableResolvedSource.err(error.FetchFailed, String.init(moduleNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "promiseRejectionTracker")) {
                return @call(bun.callmod_inline, Type.promiseRejectionTracker, .{ global, promise, rejection });
            }
            return JSValue.jsUndefined();
        }

        pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "reportUncaughtException")) {
                return @call(bun.callmod_inline, Type.reportUncaughtException, .{ global, exception });
            }
            return JSValue.jsUndefined();
        }

        pub fn onCrash() callconv(.C) void {
            if (comptime @hasDecl(Type, "onCrash")) {
                return @call(bun.callmod_inline, Type.onCrash, .{});
            }

            Output.flush();

            @panic("A C++ exception occurred");
        }
    };
}

pub const JSModuleLoader = extern struct {
    pub const shim = Shimmer("JSC", "JSModuleLoader", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSModuleLoader.h";
    pub const name = "JSC::JSModuleLoader";
    pub const namespace = "JSC";

    pub fn evaluate(
        globalObject: *JSGlobalObject,
        sourceCodePtr: [*]const u8,
        sourceCodeLen: usize,
        originUrlPtr: [*]const u8,
        originUrlLen: usize,
        referrerUrlPtr: [*]const u8,
        referrerUrlLen: usize,
        thisValue: JSValue,
        exception: [*]JSValue,
    ) JSValue {
        return shim.cppFn("evaluate", .{
            globalObject,
            sourceCodePtr,
            sourceCodeLen,
            originUrlPtr,
            originUrlLen,
            referrerUrlPtr,
            referrerUrlLen,
            thisValue,
            exception,
        });
    }

    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: *const bun.String) ?*JSInternalPromise {
        return shim.cppFn("loadAndEvaluateModule", .{
            globalObject,
            module_name,
        });
    }

    extern fn JSModuleLoader__import(*JSGlobalObject, *const bun.String) *JSInternalPromise;
    pub fn import(globalObject: *JSGlobalObject, module_name: *const bun.String) *JSInternalPromise {
        return JSModuleLoader__import(globalObject, module_name);
    }

    // pub fn dependencyKeysIfEvaluated(this: *JSModuleLoader, globalObject: *JSGlobalObject, moduleRecord: *JSModuleRecord) *JSValue {
    //     return shim.cppFn("dependencyKeysIfEvaluated", .{ this, globalObject, moduleRecord });
    // }

    pub const Extern = [_][]const u8{
        "evaluate",
        "loadAndEvaluateModule",
        "importModule",
        "checkSyntax",
    };
};

pub fn PromiseCallback(comptime Type: type, comptime CallbackFunction: fn (*Type, *JSGlobalObject, []const JSValue) anyerror!JSValue) type {
    return struct {
        pub fn callback(
            ctx: ?*anyopaque,
            globalThis: *JSGlobalObject,
            arguments: [*]const JSValue,
            arguments_len: usize,
        ) callconv(.C) JSValue {
            return CallbackFunction(@as(*Type, @ptrCast(@alignCast(ctx.?))), globalThis, arguments[0..arguments_len]) catch |err| brk: {
                break :brk ZigString.init(bun.asByteSlice(@errorName(err))).toErrorInstance(globalThis);
            };
        }
    }.callback;
}

pub const AbortSignal = extern opaque {
    pub const shim = Shimmer("WebCore", "AbortSignal", @This());
    const cppFn = shim.cppFn;
    pub const include = "webcore/AbortSignal.h";
    pub const name = "WebCore::AbortSignal";
    pub const namespace = "WebCore";

    pub fn listen(
        this: *AbortSignal,
        comptime Context: type,
        ctx: *Context,
        comptime cb: *const fn (*Context, JSValue) void,
    ) *AbortSignal {
        const Wrapper = struct {
            const call = cb;
            pub fn callback(
                ptr: ?*anyopaque,
                reason: JSValue,
            ) callconv(.C) void {
                const val = bun.cast(*Context, ptr.?);
                call(val, reason);
            }
        };

        return this.addListener(@as(?*anyopaque, @ptrCast(ctx)), Wrapper.callback);
    }

    pub fn addListener(
        this: *AbortSignal,
        ctx: ?*anyopaque,
        callback: *const fn (?*anyopaque, JSValue) callconv(.C) void,
    ) *AbortSignal {
        return cppFn("addListener", .{ this, ctx, callback });
    }

    pub fn cleanNativeBindings(this: *AbortSignal, ctx: ?*anyopaque) void {
        return cppFn("cleanNativeBindings", .{ this, ctx });
    }

    pub fn signal(
        this: *AbortSignal,
        reason: JSValue,
    ) *AbortSignal {
        bun.Analytics.Features.abort_signal += 1;
        return cppFn("signal", .{ this, reason });
    }

    /// This function is not threadsafe. aborted is a boolean, not an atomic!
    pub fn aborted(this: *AbortSignal) bool {
        return cppFn("aborted", .{this});
    }

    /// This function is not threadsafe. JSValue cannot safely be passed between threads.
    pub fn abortReason(this: *AbortSignal) JSValue {
        return cppFn("abortReason", .{this});
    }

    pub fn ref(
        this: *AbortSignal,
    ) *AbortSignal {
        return cppFn("ref", .{this});
    }

    pub fn unref(
        this: *AbortSignal,
    ) *AbortSignal {
        return cppFn("unref", .{this});
    }

    pub fn detach(this: *AbortSignal, ctx: ?*anyopaque) void {
        this.cleanNativeBindings(ctx);
        _ = this.unref();
    }

    pub fn fromJS(value: JSValue) ?*AbortSignal {
        return cppFn("fromJS", .{value});
    }

    pub fn toJS(this: *AbortSignal, global: *JSGlobalObject) JSValue {
        return cppFn("toJS", .{ this, global });
    }

    pub fn create(global: *JSGlobalObject) JSValue {
        return cppFn("create", .{global});
    }

    extern fn WebCore__AbortSignal__new(*JSGlobalObject) *AbortSignal;
    pub fn new(global: *JSGlobalObject) *AbortSignal {
        JSC.markBinding(@src());
        return WebCore__AbortSignal__new(global);
    }

    pub fn createAbortError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createAbortError", .{ message, code, global });
    }

    pub fn createTimeoutError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createTimeoutError", .{ message, code, global });
    }

    pub const Extern = [_][]const u8{ "createAbortError", "createTimeoutError", "create", "ref", "unref", "signal", "abortReason", "aborted", "addListener", "fromJS", "toJS", "cleanNativeBindings" };
};

pub const JSPromise = extern struct {
    pub const shim = Shimmer("JSC", "JSPromise", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSPromise.h";
    pub const name = "JSC::JSPromise";
    pub const namespace = "JSC";

    pub const Status = enum(u32) {
        Pending = 0, // Making this as 0, so that, we can change the status from Pending to others without masking.
        Fulfilled = 1,
        Rejected = 2,
    };

    pub fn Weak(comptime T: type) type {
        return struct {
            weak: JSC.Weak(T) = .{},
            const WeakType = @This();

            pub fn reject(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().reject(globalThis, val);
            }

            /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
            pub fn rejectTask(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                const loop = JSC.VirtualMachine.get().eventLoop();
                loop.enter();
                defer loop.exit();

                this.reject(globalThis, val);
            }

            pub fn rejectOnNextTick(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().rejectOnNextTick(globalThis, val);
            }

            pub fn resolve(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().resolve(globalThis, val);
            }

            /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
            pub fn resolveTask(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                const loop = JSC.VirtualMachine.get().eventLoop();
                loop.enter();
                defer loop.exit();
                this.resolve(globalThis, val);
            }

            pub fn resolveOnNextTick(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().resolveOnNextTick(globalThis, val);
            }

            pub fn init(
                globalThis: *JSC.JSGlobalObject,
                promise: JSValue,
                ctx: *T,
                comptime finalizer: *const fn (*T, JSC.JSValue) void,
            ) WeakType {
                return WeakType{
                    .weak = JSC.Weak(T).create(
                        promise,
                        globalThis,
                        ctx,
                        finalizer,
                    ),
                };
            }

            pub fn get(this: *const WeakType) *JSC.JSPromise {
                return this.weak.get().?.asPromise().?;
            }

            pub fn getOrNull(this: *const WeakType) ?*JSC.JSPromise {
                const promise_value = this.weak.get() orelse return null;
                return promise_value.asPromise();
            }

            pub fn value(this: *const WeakType) JSValue {
                return this.weak.get().?;
            }

            pub fn valueOrEmpty(this: *const WeakType) JSValue {
                return this.weak.get() orelse .zero;
            }

            pub fn swap(this: *WeakType) *JSC.JSPromise {
                const prom = this.weak.swap().asPromise().?;
                this.weak.deinit();
                return prom;
            }
            pub fn deinit(this: *WeakType) void {
                this.weak.clear();
                this.weak.deinit();
            }
        };
    }

    pub const Strong = struct {
        strong: JSC.Strong = .{},

        pub fn reject(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().reject(globalThis, val);
        }

        /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
        pub fn rejectTask(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.enter();
            defer loop.exit();

            this.reject(globalThis, val);
        }

        pub fn rejectOnNextTick(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().rejectOnNextTick(globalThis, val);
        }

        pub fn resolve(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().resolve(globalThis, val);
        }

        /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
        pub fn resolveTask(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.enter();
            defer loop.exit();
            this.resolve(globalThis, val);
        }

        pub fn resolveOnNextTick(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().resolveOnNextTick(globalThis, val);
        }

        pub fn init(globalThis: *JSC.JSGlobalObject) Strong {
            return Strong{
                .strong = JSC.Strong.create(
                    JSC.JSPromise.create(globalThis).asValue(globalThis),
                    globalThis,
                ),
            };
        }

        pub fn get(this: *const Strong) *JSC.JSPromise {
            return this.strong.get().?.asPromise().?;
        }

        pub fn value(this: *const Strong) JSValue {
            return this.strong.get().?;
        }

        pub fn valueOrEmpty(this: *const Strong) JSValue {
            return this.strong.get() orelse .zero;
        }

        pub fn swap(this: *Strong) *JSC.JSPromise {
            const prom = this.strong.swap().asPromise().?;
            this.strong.deinit();
            return prom;
        }
        pub fn deinit(this: *Strong) void {
            this.strong.clear();
            this.strong.deinit();
        }
    };

    pub fn wrap(
        globalObject: *JSGlobalObject,
        value: JSValue,
    ) JSValue {
        if (value.isEmpty()) {
            return resolvedPromiseValue(globalObject, JSValue.jsUndefined());
        } else if (value.isEmptyOrUndefinedOrNull() or !value.isCell()) {
            return resolvedPromiseValue(globalObject, value);
        }

        if (value.jsType() == .JSPromise) {
            return value;
        }

        if (value.isAnyError()) {
            return rejectedPromiseValue(globalObject, value);
        }

        return resolvedPromiseValue(globalObject, value);
    }
    pub fn status(this: *const JSPromise, vm: *VM) Status {
        return shim.cppFn("status", .{ this, vm });
    }
    pub fn result(this: *JSPromise, vm: *VM) JSValue {
        return cppFn("result", .{ this, vm });
    }
    pub fn isHandled(this: *const JSPromise, vm: *VM) bool {
        return cppFn("isHandled", .{ this, vm });
    }
    pub fn setHandled(this: *JSPromise, vm: *VM) void {
        cppFn("setHandled", .{ this, vm });
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("resolvedPromise", .{ globalThis, value });
    }

    pub fn resolveOnNextTick(promise: *JSC.JSPromise, globalThis: *JSGlobalObject, value: JSC.JSValue) void {
        return cppFn("resolveOnNextTick", .{ promise, globalThis, value });
    }

    pub fn rejectOnNextTick(promise: *JSC.JSPromise, globalThis: *JSGlobalObject, value: JSC.JSValue) void {
        return rejectOnNextTickWithHandled(promise, globalThis, value, false);
    }

    pub fn rejectOnNextTickAsHandled(promise: *JSC.JSPromise, globalThis: *JSGlobalObject, value: JSC.JSValue) void {
        return rejectOnNextTickWithHandled(promise, globalThis, value, true);
    }

    pub fn rejectOnNextTickWithHandled(promise: *JSC.JSPromise, globalThis: *JSGlobalObject, value: JSC.JSValue, handled: bool) void {
        return cppFn("rejectOnNextTickWithHandled", .{ promise, globalThis, value, handled });
    }

    /// Create a new promise with an already fulfilled value
    /// This is the faster function for doing that.
    pub fn resolvedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return cppFn("resolvedPromiseValue", .{ globalThis, value });
    }

    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("rejectedPromise", .{ globalThis, value });
    }

    pub fn rejectedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return cppFn("rejectedPromiseValue", .{ globalThis, value });
    }

    /// Fulfill an existing promise with the value
    /// The value can be another Promise
    /// If you want to create a new Promise that is already resolved, see JSPromise.resolvedPromiseValue
    pub fn resolve(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name = String.static("resolve");
            }
        }

        cppFn("resolve", .{ this, globalThis, value });
    }
    pub fn reject(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name = String.static("reject");
            }
        }

        cppFn("reject", .{ this, globalThis, value });
    }
    pub fn rejectAsHandled(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("rejectAsHandled", .{ this, globalThis, value });
    }
    // pub fn rejectException(this: *JSPromise, globalThis: *JSGlobalObject, value: *Exception) void {
    //     cppFn("rejectException", .{ this, globalThis, value });
    // }
    pub fn rejectAsHandledException(this: *JSPromise, globalThis: *JSGlobalObject, value: *Exception) void {
        cppFn("rejectAsHandledException", .{ this, globalThis, value });
    }

    pub fn create(globalThis: *JSGlobalObject) *JSPromise {
        return cppFn("create", .{globalThis});
    }

    pub fn asValue(this: *JSPromise, globalThis: *JSGlobalObject) JSValue {
        return cppFn("asValue", .{ this, globalThis });
    }

    pub const Extern = [_][]const u8{
        "asValue",
        "create",
        "isHandled",
        "setHandled",
        "reject",
        "rejectAsHandled",
        "rejectAsHandledException",
        "rejectOnNextTickWithHandled",
        "rejectedPromise",
        "rejectedPromiseValue",
        "resolve",
        "resolveOnNextTick",
        "resolvedPromise",
        "resolvedPromiseValue",
        "result",
        "status",
        // "rejectException",
    };
};

pub const JSInternalPromise = extern struct {
    pub const shim = Shimmer("JSC", "JSInternalPromise", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSInternalPromise.h";
    pub const name = "JSC::JSInternalPromise";
    pub const namespace = "JSC";

    pub fn status(this: *const JSInternalPromise, vm: *VM) JSPromise.Status {
        return shim.cppFn("status", .{ this, vm });
    }
    pub fn result(this: *const JSInternalPromise, vm: *VM) JSValue {
        return cppFn("result", .{ this, vm });
    }
    pub fn isHandled(this: *const JSInternalPromise, vm: *VM) bool {
        return cppFn("isHandled", .{ this, vm });
    }
    pub fn setHandled(this: *JSInternalPromise, vm: *VM) void {
        cppFn("setHandled", .{ this, vm });
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return cppFn("resolvedPromise", .{ globalThis, value });
    }
    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return cppFn("rejectedPromise", .{ globalThis, value });
    }

    pub fn resolve(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("resolve", .{ this, globalThis, value });
    }
    pub fn reject(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("reject", .{ this, globalThis, value });
    }
    pub fn rejectAsHandled(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("rejectAsHandled", .{ this, globalThis, value });
    }
    // pub fn rejectException(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: *Exception) void {
    //     cppFn("rejectException", .{ this, globalThis, value });
    // }
    pub fn rejectAsHandledException(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: *Exception) void {
        cppFn("rejectAsHandledException", .{ this, globalThis, value });
    }
    // pub const PromiseCallbackPrimitive = *const fn (
    //     ctx: ?*anyopaque,
    //     globalThis: *JSGlobalObject,
    //     arguments: [*]const JSValue,
    //     arguments_len: usize,
    // ) callconv(.C) JSValue;
    // pub fn then_(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     resolve_ctx: ?*anyopaque,
    //     onResolve: PromiseCallbackPrimitive,
    //     reject_ctx: ?*anyopaque,
    //     onReject: PromiseCallbackPrimitive,
    // ) *JSInternalPromise {
    //     return cppFn("then_", .{ this, globalThis, resolve_ctx, onResolve, reject_ctx, onReject });
    // }

    // pub const Completion = struct {
    //     result: []const JSValue,
    //     global: *JSGlobalObject,
    //     resolved: bool = false,

    //     pub const PromiseTask = struct {
    //         frame: @Frame(JSInternalPromise._wait),
    //         completion: Completion,

    //         pub fn onResolve(this: *PromiseTask, global: *JSGlobalObject, arguments: []const JSValue) anyerror!JSValue {
    //             this.completion.global = global;
    //             this.completion.resolved = true;
    //             this.completion.result = arguments;

    //             return resume this.frame;
    //         }

    //         pub fn onReject(this: *PromiseTask, global: *JSGlobalObject, arguments: []const JSValue) anyerror!JSValue {
    //             this.completion.global = global;
    //             this.completion.resolved = false;
    //             this.completion.result = arguments;
    //             return resume this.frame;
    //         }
    //     };
    // };

    // pub fn _wait(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     internal: *Completion.PromiseTask,
    // ) void {
    //     this.then(
    //         globalThis,
    //         Completion.PromiseTask,
    //         internal,
    //         Completion.PromiseTask.onResolve,
    //         Completion.PromiseTask,
    //         internal,
    //         Completion.PromiseTask.onReject,
    //     );

    //     suspend {
    //         internal.frame = @frame().*;
    //     }
    // }

    // pub fn wait(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     allocator: std.mem.Allocator,
    // ) callconv(.Async) anyerror!Completion {
    //     var internal = try allocator.create(Completion.PromiseTask);
    //     defer allocator.destroy(internal);
    //     internal.* = Completion.Internal{
    //         .frame = undefined,
    //         .completion = Completion{
    //             .global = globalThis,
    //             .resolved = false,
    //             .result = &[_]JSValue{},
    //         },
    //     };

    //     this._wait(globalThis, internal);

    //     return internal.completion;
    // }

    // pub fn then(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     comptime Resolve: type,
    //     resolver: *Resolve,
    //     comptime onResolve: fn (*Resolve, *JSGlobalObject, []const JSValue) anyerror!JSValue,
    //     comptime Reject: type,
    //     rejecter: *Reject,
    //     comptime onReject: fn (*Reject, *JSGlobalObject, []const JSValue) anyerror!JSValue,
    // ) *JSInternalPromise {
    //     return then_(this, globalThis, resolver, PromiseCallback(Resolve, onResolve), Reject, rejecter, PromiseCallback(Reject, onReject));
    // }

    // pub fn thenResolve(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     comptime Resolve: type,
    //     resolver: *Resolve,
    //     comptime onResolve: fn (*Resolve, *JSGlobalObject, []const JSValue) anyerror!JSValue,
    // ) *JSInternalPromise {
    //     return thenResolve_(this, globalThis, resolver, PromiseCallback(Resolve, onResolve));
    // }

    // pub fn thenResolve_(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     resolve_ctx: ?*anyopaque,
    //     onResolve: PromiseCallbackPrimitive,
    // ) *JSInternalPromise {
    //     return cppFn("thenResolve_", .{
    //         this,
    //         globalThis,
    //         resolve_ctx,
    //         onResolve,
    //     });
    // }

    // pub fn thenReject_(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     resolve_ctx: ?*anyopaque,
    //     onResolve: PromiseCallbackPrimitive,
    // ) *JSInternalPromise {
    //     return cppFn("thenReject_", .{
    //         this,
    //         globalThis,
    //         resolve_ctx,
    //         onResolve,
    //     });
    // }

    // pub fn thenReject(
    //     this: *JSInternalPromise,
    //     globalThis: *JSGlobalObject,
    //     comptime Resolve: type,
    //     resolver: *Resolve,
    //     comptime onResolve: fn (*Resolve, *JSGlobalObject, []const JSValue) anyerror!JSValue,
    // ) *JSInternalPromise {
    //     return thenReject_(this, globalThis, resolver, PromiseCallback(Resolve, onResolve));
    // }

    pub fn create(globalThis: *JSGlobalObject) *JSInternalPromise {
        return cppFn("create", .{globalThis});
    }

    pub fn asValue(this: *JSInternalPromise) JSValue {
        return JSValue.fromCell(this);
    }

    pub const Extern = [_][]const u8{
        "create",
        // "then_",
        "status",
        "result",
        "isHandled",
        "setHandled",
        "resolvedPromise",
        "rejectedPromise",
        "resolve",
        "reject",
        "rejectAsHandled",
        // "thenResolve_",
        // "thenReject_",
        // "rejectException",
        "rejectAsHandledException",
    };
};

pub const AnyPromise = union(enum) {
    Normal: *JSPromise,
    Internal: *JSInternalPromise,

    pub fn status(this: AnyPromise, vm: *VM) JSPromise.Status {
        return switch (this) {
            inline else => |promise| promise.status(vm),
        };
    }
    pub fn result(this: AnyPromise, vm: *VM) JSValue {
        return switch (this) {
            inline else => |promise| promise.result(vm),
        };
    }
    pub fn isHandled(this: AnyPromise, vm: *VM) bool {
        return switch (this) {
            inline else => |promise| promise.isHandled(vm),
        };
    }
    pub fn setHandled(this: AnyPromise, vm: *VM) void {
        switch (this) {
            inline else => |promise| promise.setHandled(vm),
        }
    }

    pub fn resolve(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.resolve(globalThis, value),
        }
    }
    pub fn reject(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.reject(globalThis, value),
        }
    }
    pub fn rejectAsHandled(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.rejectAsHandled(globalThis, value),
        }
    }
    pub fn rejectAsHandledException(this: AnyPromise, globalThis: *JSGlobalObject, value: *Exception) void {
        switch (this) {
            inline else => |promise| promise.rejectAsHandledException(globalThis, value),
        }
    }
    pub fn asValue(this: AnyPromise, globalThis: *JSGlobalObject) JSValue {
        return switch (this) {
            .Normal => |promise| promise.asValue(globalThis),
            .Internal => |promise| promise.asValue(),
        };
    }
};

// SourceProvider.h
pub const SourceType = enum(u8) {
    Program = 0,
    Module = 1,
    WebAssembly = 2,
};

pub const Thenables = opaque {};

pub const JSFunction = extern struct {
    pub const shim = Shimmer("JSC", "JSFunction", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSFunction.h";
    pub const name = "JSC::JSFunction";
    pub const namespace = "JSC";

    const ImplementationVisibility = enum(u8) {
        public,
        private,
        private_recursive,
    };

    /// In WebKit: Intrinsic.h
    const Intrinsic = enum(u8) {
        none,
        _,
    };

    const CreateJSFunctionOptions = struct {
        implementation_visibility: ImplementationVisibility = .public,
        intrinsic: Intrinsic = .none,
        constructor: ?*const JSHostFunctionType = null,
    };

    extern fn JSFunction__createFromZig(
        global: *JSGlobalObject,
        fn_name: bun.String,
        implementation: *const JSHostFunctionType,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: ?*const JSHostFunctionType,
    ) JSValue;

    pub fn create(
        global: *JSGlobalObject,
        fn_name: anytype,
        comptime implementation: JSHostFunctionType,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) JSValue {
        return JSFunction__createFromZig(
            global,
            switch (@TypeOf(fn_name)) {
                bun.String => fn_name,
                else => bun.String.init(fn_name),
            },
            implementation,
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        );
    }

    pub fn optimizeSoon(value: JSValue) void {
        cppFn("optimizeSoon", .{value});
    }

    extern fn JSC__JSFunction__getSourceCode(value: JSValue, out: *ZigString) bool;

    pub fn getSourceCode(value: JSValue) ?bun.String {
        var str: ZigString = undefined;
        return if (JSC__JSFunction__getSourceCode(value, &str)) bun.String.init(str) else null;
    }

    pub const Extern = [_][]const u8{
        "fromString",
        "getName",
        "displayName",
        "calculatedDisplayName",
        "optimizeSoon",
    };
};

pub const JSGlobalObject = extern struct {
    pub const shim = Shimmer("JSC", "JSGlobalObject", @This());
    bytes: shim.Bytes,

    pub const include = "JavaScriptCore/JSGlobalObject.h";
    pub const name = "JSC::JSGlobalObject";
    pub const namespace = "JSC";

    pub fn allocator(this: *JSGlobalObject) std.mem.Allocator {
        return this.bunVM().allocator;
    }

    pub fn throwOutOfMemory(this: *JSGlobalObject) void {
        this.throwValue(this.createErrorInstance("Out of memory", .{}));
    }

    pub fn throwTODO(this: *JSGlobalObject, msg: []const u8) void {
        const err = this.createErrorInstance("{s}", .{msg});
        err.put(this, ZigString.static("name"), bun.String.static("TODOError").toJS(this));
        this.throwValue(err);
    }

    extern fn JSGlobalObject__clearTerminationException(this: *JSGlobalObject) void;
    extern fn JSGlobalObject__throwTerminationException(this: *JSGlobalObject) void;
    pub const throwTerminationException = JSGlobalObject__throwTerminationException;
    pub const clearTerminationException = JSGlobalObject__clearTerminationException;
    extern fn JSGlobalObject__setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool;

    pub fn setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool {
        return JSGlobalObject__setTimeZone(this, timeZone);
    }

    pub inline fn toJSValue(globalThis: *JSGlobalObject) JSValue {
        return @enumFromInt(@as(JSValue.Type, @bitCast(@intFromPtr(globalThis))));
    }

    pub fn throwInvalidArguments(
        this: *JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) void {
        const err = JSC.toInvalidArguments(fmt, args, this);
        this.vm().throwError(this, err);
    }

    pub fn createInvalidArgumentType(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime field: []const u8,
        comptime typename: []const u8,
    ) JSC.JSValue {
        return JSC.JSValue.createTypeError(
            ZigString.static(
                comptime std.fmt.comptimePrint("Expected {s} to be a {s} for '{s}'.", .{ field, typename, name_ }),
            ),
            ZigString.static("ERR_INVALID_ARG_TYPE"),
            this,
        );
    }

    pub fn toJS(this: *JSC.JSGlobalObject, value: anytype, comptime lifetime: JSC.Lifetime) JSC.JSValue {
        return JSC.toJS(this, @TypeOf(value), value, lifetime);
    }

    pub fn throwInvalidArgumentType(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime field: []const u8,
        comptime typename: []const u8,
    ) void {
        this.throwValue(this.createInvalidArgumentType(name_, field, typename));
    }

    pub fn throwInvalidArgumentTypeValue(
        this: *JSGlobalObject,
        field: []const u8,
        typename: []const u8,
        value: JSValue,
    ) JSValue {
        const ty_str = value.jsTypeString(this).toSlice(this, bun.default_allocator);
        defer ty_str.deinit();
        return this.throwValueRet(this.createTypeErrorInstanceWithCode(.ERR_INVALID_ARG_TYPE, "The \"{s}\" argument must be of type {s}. Received {s}", .{ field, typename, ty_str.slice() }));
    }

    pub fn createNotEnoughArguments(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime expected: usize,
        got: usize,
    ) JSC.JSValue {
        return JSC.toTypeErrorWithCode(
            @tagName(JSC.Node.ErrorCode.ERR_MISSING_ARGS),
            "Not enough arguments to '" ++ name_ ++ "'. Expected {d}, got {d}.",
            .{ expected, got },
            this,
        );
    }

    pub fn throwNotEnoughArguments(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime expected: usize,
        got: usize,
    ) void {
        this.throwValue(this.createNotEnoughArguments(name_, expected, got));
    }

    pub fn reload(this: *JSC.JSGlobalObject) void {
        this.vm().drainMicrotasks();
        this.vm().collectAsync();

        return cppFn("reload", .{this});
    }

    pub const BunPluginTarget = enum(u8) {
        bun = 0,
        node = 1,
        browser = 2,
    };
    extern fn Bun__runOnLoadPlugins(*JSC.JSGlobalObject, ?*const bun.String, *const bun.String, BunPluginTarget) JSValue;
    extern fn Bun__runOnResolvePlugins(*JSC.JSGlobalObject, ?*const bun.String, *const bun.String, *const String, BunPluginTarget) JSValue;

    pub fn runOnLoadPlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());
        const result = Bun__runOnLoadPlugins(this, if (namespace_.length() > 0) &namespace_ else null, &path, target);
        if (result.isEmptyOrUndefinedOrNull()) {
            return null;
        }

        return result;
    }

    pub fn runOnResolvePlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, source: bun.String, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());

        const result = Bun__runOnResolvePlugins(this, if (namespace_.length() > 0) &namespace_ else null, &path, &source, target);
        if (result.isEmptyOrUndefinedOrNull()) {
            return null;
        }

        return result;
    }

    pub fn createSyntheticModule_(this: *JSGlobalObject, export_names: [*]const ZigString, export_len: usize, value_ptrs: [*]const JSValue, values_len: usize) void {
        shim.cppFn("createSyntheticModule_", .{ this, export_names, export_len, value_ptrs, values_len });
    }

    pub fn createSyntheticModule(this: *JSGlobalObject, comptime module: anytype) void {
        const names = comptime std.meta.fieldNames(@TypeOf(module));
        var export_names: [names.len]ZigString = undefined;
        var export_values: [names.len]JSValue = undefined;
        inline for (comptime names, 0..) |export_name, i| {
            export_names[i] = ZigString.init(export_name);
            const function = @field(module, export_name).@"0";
            const len = @field(module, export_name).@"1";
            export_values[i] = JSC.NewFunction(this, &export_names[i], len, function, true);
        }

        createSyntheticModule_(this, &export_names, names.len, &export_values, names.len);
    }

    pub fn createErrorInstance(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch
            // if an exception occurs in the middle of formatting the error message, it's better to just return the formatting string than an error about an error
                return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.toOwnedSliceLeaky());
            return str.toErrorInstance(this);
        } else {
            if (comptime strings.isAllASCII(fmt)) {
                return ZigString.static(fmt).toErrorInstance(this);
            } else {
                return ZigString.initUTF8(fmt).toErrorInstance(this);
            }
        }
    }

    pub fn createErrorInstanceWithCode(this: *JSGlobalObject, code: JSC.Node.ErrorCode, comptime fmt: string, args: anytype) JSValue {
        var err = this.createErrorInstance(fmt, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(code)).toJS(this));
        return err;
    }

    pub fn createTypeErrorInstance(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.toOwnedSliceLeaky());
            return str.toTypeErrorInstance(this);
        } else {
            return ZigString.static(fmt).toTypeErrorInstance(this);
        }
    }

    pub fn createTypeErrorInstanceWithCode(this: *JSGlobalObject, code: JSC.Node.ErrorCode, comptime fmt: string, args: anytype) JSValue {
        var err = this.createTypeErrorInstance(fmt, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(code)).toJS(this));
        return err;
    }

    pub fn createSyntaxErrorInstance(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.toOwnedSliceLeaky());
            return str.toSyntaxErrorInstance(this);
        } else {
            return ZigString.static(fmt).toSyntaxErrorInstance(this);
        }
    }

    pub fn createRangeErrorInstance(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.toOwnedSliceLeaky());
            return str.toRangeErrorInstance(this);
        } else {
            return ZigString.static(fmt).toRangeErrorInstance(this);
        }
    }

    pub fn createRangeErrorInstanceWithCode(this: *JSGlobalObject, code: JSC.Node.ErrorCode, comptime fmt: string, args: anytype) JSValue {
        var err = this.createRangeErrorInstance(fmt, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(code)).toJS(this));
        return err;
    }

    pub fn createRangeError(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        const err = createErrorInstance(this, fmt, args);
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(JSC.Node.ErrorCode.ERR_OUT_OF_RANGE)).toJS(this));
        return err;
    }

    pub fn createInvalidArgs(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        const err = createErrorInstance(this, fmt, args);
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE)).toJS(this));
        return err;
    }

    pub fn createError(
        this: *JSGlobalObject,
        code: JSC.Node.ErrorCode,
        error_name: string,
        comptime message: string,
        args: anytype,
    ) JSValue {
        const err = createErrorInstance(this, message, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(code)).toJS(this));
        err.put(this, ZigString.static("name"), ZigString.init(error_name).toJS(this));
        return err;
    }

    pub fn throw(
        this: *JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) void {
        const instance = this.createErrorInstance(fmt, args);
        if (instance != .zero)
            this.vm().throwError(this, instance);
    }

    pub fn throwPretty(
        this: *JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) void {
        const instance = switch (Output.enable_ansi_colors) {
            inline else => |enabled| this.createErrorInstance(Output.prettyFmt(fmt, enabled), args),
        };

        if (instance != .zero)
            this.vm().throwError(this, instance);
    }
    extern fn JSC__JSGlobalObject__queueMicrotaskCallback(*JSGlobalObject, *anyopaque, Function: *const (fn (*anyopaque) callconv(.C) void)) void;
    pub fn queueMicrotaskCallback(
        this: *JSGlobalObject,
        ctx_val: anytype,
        comptime Function: fn (ctx: @TypeOf(ctx_val)) void,
    ) void {
        JSC.markBinding(@src());
        const Fn = Function;
        const ContextType = @TypeOf(ctx_val);
        const Wrapper = struct {
            pub fn call(p: *anyopaque) callconv(.C) void {
                Fn(bun.cast(ContextType, p));
            }
        };

        JSC__JSGlobalObject__queueMicrotaskCallback(this, ctx_val, &Wrapper.call);
    }

    pub fn queueMicrotask(
        this: *JSGlobalObject,
        function: JSValue,
        args: []const JSC.JSValue,
    ) void {
        this.queueMicrotaskJob(
            function,
            if (args.len > 0) args[0] else .zero,
            if (args.len > 1) args[1] else .zero,
        );
    }

    pub fn queueMicrotaskJob(
        this: *JSGlobalObject,
        function: JSValue,
        first: JSValue,
        second: JSValue,
    ) void {
        shim.cppFn("queueMicrotaskJob", .{
            this,
            function,
            first,
            second,
        });
    }

    pub fn throwValue(
        this: *JSGlobalObject,
        value: JSC.JSValue,
    ) void {
        this.vm().throwError(this, value);
    }

    // eventually merge this with throwValue, but that's a big diff
    pub fn throwValueRet(
        this: *JSGlobalObject,
        value: JSC.JSValue,
    ) JSValue {
        this.vm().throwError(this, value);
        return .zero;
    }

    pub fn throwError(
        this: *JSGlobalObject,
        err: anyerror,
        comptime fmt: string,
    ) void {
        var str = ZigString.init(std.fmt.allocPrint(this.bunVM().allocator, "{s} " ++ fmt, .{@errorName(err)}) catch return);
        str.markUTF8();
        const err_value = str.toErrorInstance(this);
        this.vm().throwError(this, err_value);
        this.bunVM().allocator.free(ZigString.untagged(str._unsafe_ptr_do_not_use)[0..str.len]);
    }

    pub fn handleError(
        this: *JSGlobalObject,
        err: anyerror,
        comptime fmt: string,
    ) JSValue {
        this.throwError(err, fmt);
        return JSValue.jsUndefined();
    }

    // pub fn createError(globalObject: *JSGlobalObject, error_type: ErrorType, message: *String) *JSObject {
    //     return cppFn("createError", .{ globalObject, error_type, message });
    // }

    // pub fn throwError(
    //     globalObject: *JSGlobalObject,
    //     err: *JSObject,
    // ) *JSObject {
    //     return cppFn("throwError", .{
    //         globalObject,
    //         err,
    //     });
    // }

    const cppFn = shim.cppFn;

    pub fn ref(this: *JSGlobalObject) C_API.JSContextRef {
        return @as(C_API.JSContextRef, @ptrCast(this));
    }
    pub const ctx = ref;

    pub inline fn ptr(this: *JSGlobalObject) *JSGlobalObject {
        return this;
    }

    pub fn createAggregateError(globalObject: *JSGlobalObject, errors: [*]*anyopaque, errors_len: u16, message: *const ZigString) JSValue {
        return cppFn("createAggregateError", .{ globalObject, errors, errors_len, message });
    }

    pub fn generateHeapSnapshot(this: *JSGlobalObject) JSValue {
        return cppFn("generateHeapSnapshot", .{this});
    }

    pub fn putCachedObject(this: *JSGlobalObject, key: *const ZigString, value: JSValue) JSValue {
        return cppFn("putCachedObject", .{ this, key, value });
    }

    pub fn getCachedObject(this: *JSGlobalObject, key: *const ZigString) JSValue {
        return cppFn("getCachedObject", .{ this, key });
    }

    extern fn JSGlobalObject__hasException(*JSGlobalObject) bool;
    pub fn hasException(this: *JSGlobalObject) bool {
        return JSGlobalObject__hasException(this);
    }

    pub fn vm(this: *JSGlobalObject) *VM {
        return cppFn("vm", .{this});
    }

    pub fn deleteModuleRegistryEntry(this: *JSGlobalObject, name_: *ZigString) void {
        return cppFn("deleteModuleRegistryEntry", .{ this, name_ });
    }

    fn bunVMUnsafe(this: *JSGlobalObject) *anyopaque {
        return cppFn("bunVM", .{this});
    }

    pub fn bunVM(this: *JSGlobalObject) *JSC.VirtualMachine {
        if (comptime bun.Environment.allow_assert) {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            const assertion = this.bunVMUnsafe() == @as(*anyopaque, @ptrCast(JSC.VirtualMachine.get()));
            if (!assertion) @breakpoint();
            bun.assert(assertion);
        }
        return @as(*JSC.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bunVMConcurrently(this: *JSGlobalObject) *JSC.VirtualMachine {
        return @as(*JSC.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    pub fn handleRejectedPromises(this: *JSGlobalObject) void {
        return cppFn("handleRejectedPromises", .{this});
    }

    pub fn startRemoteInspector(this: *JSGlobalObject, host: [:0]const u8, port: u16) bool {
        return cppFn("startRemoteInspector", .{ this, host, port });
    }

    extern fn ZigGlobalObject__readableStreamToArrayBuffer(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToBytes(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToText(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToJSON(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToFormData(*JSGlobalObject, JSValue, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToBlob(*JSGlobalObject, JSValue) JSValue;

    pub fn readableStreamToArrayBuffer(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToArrayBuffer(this, value);
    }

    pub fn readableStreamToBytes(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToBytes(this, value);
    }

    pub fn readableStreamToText(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToText(this, value);
    }

    pub fn readableStreamToJSON(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToJSON(this, value);
    }

    pub fn readableStreamToBlob(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToBlob(this, value);
    }

    pub fn readableStreamToFormData(this: *JSGlobalObject, value: JSValue, content_type: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToFormData(this, value, content_type);
    }

    pub inline fn assertOnJSThread(this: *JSGlobalObject) void {
        if (bun.Environment.allow_assert) this.bunVM().assertOnJSThread();
    }

    pub const Extern = [_][]const u8{
        "reload",
        "bunVM",
        "putCachedObject",
        "getCachedObject",
        "createAggregateError",

        "deleteModuleRegistryEntry",

        "vm",
        "generateHeapSnapshot",
        "startRemoteInspector",
        "handleRejectedPromises",
        "createSyntheticModule_",
        "queueMicrotaskJob",
        // "createError",
        // "throwError",
    };
};

pub const JSNativeFn = JSHostFunctionPtr;

pub const JSArrayIterator = struct {
    i: u32 = 0,
    len: u32 = 0,
    array: JSValue,
    global: *JSGlobalObject,

    pub fn init(value: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return .{
            .array = value,
            .global = global,
            .len = @as(u32, @truncate(value.getLength(global))),
        };
    }

    pub fn next(this: *JSArrayIterator) ?JSValue {
        if (!(this.i < this.len)) {
            return null;
        }
        const i = this.i;
        this.i += 1;
        return JSObject.getIndex(this.array, this.global, i);
    }
};

pub const JSMap = opaque {
    pub const shim = Shimmer("JSC", "JSMap", @This());
    pub const Type = JSMap;
    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/JSMap.h";
    pub const name = "JSC::JSMap";
    pub const namespace = "JSC";

    pub fn create(globalObject: *JSGlobalObject) JSValue {
        return cppFn("create", .{globalObject});
    }

    pub fn set(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue, value: JSValue) void {
        return cppFn("set", .{ this, globalObject, key, value });
    }

    pub fn get_(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) JSValue {
        return cppFn("get", .{ this, globalObject, key });
    }

    pub fn get(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) ?JSValue {
        const value = get_(this, globalObject, key);
        if (value.isEmpty()) {
            return null;
        }
        return value;
    }

    pub fn has(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return cppFn("has", .{ this, globalObject, key });
    }

    pub fn remove(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return cppFn("remove", .{ this, globalObject, key });
    }

    pub fn fromJS(value: JSValue) ?*JSMap {
        if (value.jsTypeLoose() == .JSMap) {
            return bun.cast(*JSMap, value.asEncoded().asPtr.?);
        }

        return null;
    }

    pub const Extern = [_][]const u8{
        "create",
        "set",
        "get_",
        "has",
        "remove",
    };
};

pub const JSValueReprInt = i64;
pub const JSValue = enum(JSValueReprInt) {
    zero = 0,
    undefined = 0xa,
    null = 0x2,
    true = FFI.TrueI64,
    false = 0x6,
    _,

    pub const Type = JSValueReprInt;

    pub const shim = Shimmer("JSC", "JSValue", @This());
    pub const is_pointer = false;

    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/JSValue.h";
    pub const name = "JSC::JSValue";
    pub const namespace = "JSC";
    pub const JSType = enum(u8) {
        // The Cell value must come before any JS that is a JSCell.
        Cell,
        Structure,
        String,
        HeapBigInt,
        Symbol,

        GetterSetter,
        CustomGetterSetter,
        /// For 32-bit architectures, this wraps a 64-bit JSValue
        APIValueWrapper,

        NativeExecutable,

        ProgramExecutable,
        ModuleProgramExecutable,
        EvalExecutable,
        FunctionExecutable,

        UnlinkedFunctionExecutable,

        UnlinkedProgramCodeBlock,
        UnlinkedModuleProgramCodeBlock,
        UnlinkedEvalCodeBlock,
        UnlinkedFunctionCodeBlock,

        CodeBlock,

        JSImmutableButterfly,
        JSSourceCode,
        JSScriptFetcher,
        JSScriptFetchParameters,

        // The Object value must come before any JS that is a subclass of JSObject.
        Object,
        FinalObject,
        JSCallee,
        JSFunction,
        InternalFunction,
        NullSetterFunction,
        BooleanObject,
        NumberObject,
        ErrorInstance,
        GlobalProxy,
        DirectArguments,
        ScopedArguments,
        ClonedArguments,

        // Start JSArray s.
        Array,
        DerivedArray,
        // End JSArray s.

        ArrayBuffer,

        // Start JSArrayBufferView s. Keep in sync with the order of FOR_EACH_D_ARRAY__EXCLUDING_DATA_VIEW.
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
        DataView,
        // End JSArrayBufferView s.

        // JSScope <- JSWithScope
        //         <- StrictEvalActivation
        //         <- JSSymbolTableObject  <- JSLexicalEnvironment      <- JSModuleEnvironment
        //                                 <- JSSegmentedVariableObject <- JSGlobalLexicalEnvironment
        //                                                              <- JSGlobalObject
        // Start JSScope s.
        // Start environment record s.
        GlobalObject,
        GlobalLexicalEnvironment,
        LexicalEnvironment,
        ModuleEnvironment,
        StrictEvalActivation,
        // End environment record s.
        WithScope,
        // End JSScope s.

        ModuleNamespaceObject,
        ShadowRealm,
        RegExpObject,
        JSDate,
        ProxyObject,
        JSGenerator,
        JSAsyncGenerator,
        JSArrayIterator,
        JSMapIterator,
        JSSetIterator,
        JSStringIterator,
        JSPromise,
        JSMap,
        JSSet,
        JSWeakMap,
        JSWeakSet,
        WebAssemblyModule,
        WebAssemblyInstance,
        WebAssemblyGCObject,
        // Start StringObject s.
        StringObject,
        DerivedStringObject,
        // End StringObject s.

        InternalFieldTuple,

        MaxJS = 0b11111111,
        Event = 0b11101111,
        DOMWrapper = 0b11101110,
        Blob = 0b11111100,

        /// This means that we don't have Zig bindings for the type yet, but it
        /// implements .toJSON()
        JSAsJSONType = 0b11110000 | 1,
        _,

        pub fn canGet(this: JSType) bool {
            return switch (this) {
                .Array,
                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .BooleanObject,
                .DOMWrapper,
                .DataView,
                .DerivedArray,
                .DerivedStringObject,
                .ErrorInstance,
                .Event,
                .FinalObject,
                .Float32Array,
                .Float64Array,
                .GlobalObject,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .InternalFunction,
                .JSArrayIterator,
                .JSAsyncGenerator,
                .JSDate,
                .JSFunction,
                .JSGenerator,
                .JSMap,
                .JSMapIterator,
                .JSPromise,
                .JSSet,
                .JSSetIterator,
                .JSStringIterator,
                .JSWeakMap,
                .JSWeakSet,
                .ModuleNamespaceObject,
                .NumberObject,
                .Object,
                .ProxyObject,
                .RegExpObject,
                .ShadowRealm,
                .StringObject,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                .WebAssemblyModule,
                .WebAssemblyInstance,
                .WebAssemblyGCObject,
                => true,
                else => false,
            };
        }

        pub inline fn isObject(this: JSType) bool {
            // inline constexpr bool isObjectType(JSType type) { return type >= ObjectType; }
            return @intFromEnum(this) >= @intFromEnum(JSType.Object);
        }

        pub fn isFunction(this: JSType) bool {
            return switch (this) {
                .JSFunction, .FunctionExecutable, .InternalFunction => true,
                else => false,
            };
        }

        pub fn isTypedArray(this: JSType) bool {
            return switch (this) {
                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub fn toC(this: JSType) C_API.JSTypedArrayType {
            return switch (this) {
                .Int8Array => .kJSTypedArrayTypeInt8Array,
                .Int16Array => .kJSTypedArrayTypeInt16Array,
                .Int32Array => .kJSTypedArrayTypeInt32Array,
                .Uint8Array => .kJSTypedArrayTypeUint8Array,
                .Uint8ClampedArray => .kJSTypedArrayTypeUint8ClampedArray,
                .Uint16Array => .kJSTypedArrayTypeUint16Array,
                .Uint32Array => .kJSTypedArrayTypeUint32Array,
                .Float32Array => .kJSTypedArrayTypeFloat32Array,
                .Float64Array => .kJSTypedArrayTypeFloat64Array,
                .ArrayBuffer => .kJSTypedArrayTypeArrayBuffer,
                // .DataView => .kJSTypedArrayTypeDataView,
                else => .kJSTypedArrayTypeNone,
            };
        }

        pub fn isHidden(this: JSType) bool {
            return switch (this) {
                .APIValueWrapper,
                .NativeExecutable,
                .ProgramExecutable,
                .ModuleProgramExecutable,
                .EvalExecutable,
                .FunctionExecutable,
                .UnlinkedFunctionExecutable,
                .UnlinkedProgramCodeBlock,
                .UnlinkedModuleProgramCodeBlock,
                .UnlinkedEvalCodeBlock,
                .UnlinkedFunctionCodeBlock,
                .CodeBlock,
                .JSImmutableButterfly,
                .JSSourceCode,
                .JSScriptFetcher,
                .JSScriptFetchParameters,
                => true,
                else => false,
            };
        }

        pub const LastMaybeFalsyCellPrimitive = JSType.HeapBigInt;
        pub const LastJSCObject = JSType.DerivedStringObject; // This is the last "JSC" Object type. After this, we have embedder's (e.g., WebCore) extended object types.

        pub inline fn isString(this: JSType) bool {
            return this == .String;
        }

        pub inline fn isStringObject(this: JSType) bool {
            return this == .StringObject;
        }

        pub inline fn isDerivedStringObject(this: JSType) bool {
            return this == .DerivedStringObject;
        }

        pub inline fn isStringObjectLike(this: JSType) bool {
            return this == .StringObject or this == .DerivedStringObject;
        }

        pub inline fn isStringLike(this: JSType) bool {
            return switch (this) {
                .String, .StringObject, .DerivedStringObject => true,
                else => false,
            };
        }

        pub inline fn isArray(this: JSType) bool {
            return switch (this) {
                .Array, .DerivedArray => true,
                else => false,
            };
        }

        pub inline fn isArrayLike(this: JSType) bool {
            return switch (this) {
                .Array,
                .DerivedArray,

                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub inline fn isSet(this: JSType) bool {
            return switch (this) {
                .JSSet, .JSWeakSet => true,
                else => false,
            };
        }

        pub inline fn isMap(this: JSType) bool {
            return switch (this) {
                .JSMap, .JSWeakMap => true,
                else => false,
            };
        }

        pub inline fn isIndexable(this: JSType) bool {
            return switch (this) {
                .Object,
                .FinalObject,
                .Array,
                .DerivedArray,
                .ErrorInstance,
                .JSFunction,
                .InternalFunction,

                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }
    };

    pub inline fn cast(ptr: anytype) JSValue {
        return @as(JSValue, @enumFromInt(@as(i64, @bitCast(@intFromPtr(ptr)))));
    }

    pub fn coerceToInt32(this: JSValue, globalThis: *JSC.JSGlobalObject) i32 {
        return cppFn("coerceToInt32", .{ this, globalThis });
    }

    pub fn coerceToInt64(this: JSValue, globalThis: *JSC.JSGlobalObject) i64 {
        return cppFn("coerceToInt64", .{ this, globalThis });
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return JSC.JSObject.getIndex(this, globalThis, i);
    }

    extern fn JSC__JSValue__getDirectIndex(JSValue, *JSGlobalObject, u32) JSValue;
    pub fn getDirectIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return JSC__JSValue__getDirectIndex(this, globalThis, i);
    }

    const PropertyIteratorFn = *const fn (
        globalObject_: *JSGlobalObject,
        ctx_ptr: ?*anyopaque,
        key: *ZigString,
        value: JSValue,
        is_symbol: bool,
        is_private_symbol: bool,
    ) callconv(.C) void;

    pub extern fn JSC__JSValue__forEachPropertyNonIndexed(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;
    pub extern fn JSC__JSValue__forEachProperty(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;
    pub extern fn JSC__JSValue__forEachPropertyOrdered(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;

    pub fn forEachPropertyNonIndexed(
        this: JSValue,
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachPropertyNonIndexed(this, globalThis, ctx, callback);
    }

    pub fn forEachProperty(
        this: JSValue,
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachProperty(this, globalThis, ctx, callback);
    }

    pub fn forEachPropertyOrdered(
        this: JSValue,
        globalObject: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachPropertyOrdered(this, globalObject, ctx, callback);
    }

    pub fn coerceToDouble(
        this: JSValue,
        globalObject: *JSC.JSGlobalObject,
    ) f64 {
        return cppFn("coerceToDouble", .{ this, globalObject });
    }

    pub fn coerce(this: JSValue, comptime T: type, globalThis: *JSC.JSGlobalObject) T {
        return switch (T) {
            ZigString => this.getZigString(globalThis),
            bool => this.toBooleanSlow(globalThis),
            f64 => {
                if (this.isDouble()) {
                    return this.asDouble();
                }

                return this.coerceToDouble(globalThis);
            },
            i64 => {
                return this.coerceToInt64(globalThis);
            },
            i32 => {
                if (this.isInt32()) {
                    return this.asInt32();
                }

                if (this.getNumber()) |num| {
                    return coerceJSValueDoubleTruncatingT(i32, num);
                }

                return this.coerceToInt32(globalThis);
            },
            else => @compileError("Unsupported coercion type"),
        };
    }

    /// This does not call [Symbol.toPrimitive] or [Symbol.toStringTag].
    /// This is only safe when you don't want to do conversions across non-primitive types.
    pub fn to(this: JSValue, comptime T: type) T {
        return switch (comptime T) {
            u32 => toU32(this),
            u16 => toU16(this),
            c_uint => @as(c_uint, @intCast(toU32(this))),
            c_int => @as(c_int, @intCast(toInt32(this))),
            ?AnyPromise => asAnyPromise(this),
            u52 => @as(u52, @truncate(@as(u64, @intCast(@max(this.toInt64(), 0))))),
            i52 => @as(i52, @truncate(@as(i52, @intCast(this.toInt64())))),
            u64 => toUInt64NoTruncate(this),
            u8 => @as(u8, @truncate(toU32(this))),
            i16 => @as(i16, @truncate(toInt32(this))),
            i8 => @as(i8, @truncate(toInt32(this))),
            i32 => @as(i32, @truncate(toInt32(this))),
            i64 => this.toInt64(),
            bool => this.toBoolean(),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool {
        if (!this.isCell())
            return false;

        return cppFn("isInstanceOf", .{ this, global, constructor });
    }

    pub fn call(this: JSValue, globalThis: *JSGlobalObject, args: []const JSC.JSValue) JSC.JSValue {
        return callWithThis(this, globalThis, JSC.JSValue.jsUndefined(), args);
    }

    pub fn callWithGlobalThis(this: JSValue, globalThis: *JSGlobalObject, args: []const JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name.deref();
                loop.debug.last_fn_name = this.getName(globalThis);
            }
        }
        return JSC.C.JSObjectCallAsFunctionReturnValue(
            globalThis,
            this,
            globalThis.toJSValue(),
            args.len,
            @as(?[*]const JSC.C.JSValueRef, @ptrCast(args.ptr)),
        );
    }

    pub fn callWithThis(this: JSValue, globalThis: *JSGlobalObject, thisValue: JSC.JSValue, args: []const JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name.deref();
                loop.debug.last_fn_name = this.getName(globalThis);
            }
        }
        return JSC.C.JSObjectCallAsFunctionReturnValue(
            globalThis,
            this,
            thisValue,
            args.len,
            @as(?[*]const JSC.C.JSValueRef, @ptrCast(args.ptr)),
        );
    }

    /// The value cannot be empty. Check `!this.isEmpty()` before calling this function
    pub fn jsType(
        this: JSValue,
    ) JSType {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(!this.isEmpty());
        }
        return cppFn("jsType", .{this});
    }

    pub fn jsTypeLoose(
        this: JSValue,
    ) JSType {
        if (this.isNumber()) {
            return JSType.NumberObject;
        }

        return this.jsType();
    }

    extern fn JSC__jsTypeStringForValue(globalObject: *JSGlobalObject, value: JSValue) *JSC.JSString;

    pub fn jsTypeString(this: JSValue, globalObject: *JSGlobalObject) *JSC.JSString {
        return JSC__jsTypeStringForValue(globalObject, this);
    }

    extern fn JSC__JSValue__createEmptyObjectWithNullPrototype(globalObject: *JSGlobalObject) JSValue;

    pub fn createEmptyObjectWithNullPrototype(global: *JSGlobalObject) JSValue {
        return JSC__JSValue__createEmptyObjectWithNullPrototype(global);
    }

    /// Creates a new empty object, with Object as its prototype
    pub fn createEmptyObject(global: *JSGlobalObject, len: usize) JSValue {
        return cppFn("createEmptyObject", .{ global, len });
    }

    pub fn createEmptyArray(global: *JSGlobalObject, len: usize) JSValue {
        return cppFn("createEmptyArray", .{ global, len });
    }

    pub fn putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values_array: [*]ZigString, values_len: usize) void {
        return cppFn("putRecord", .{ value, global, key, values_array, values_len });
    }

    fn putZigString(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: JSC.JSValue) void {
        @import("./headers.zig").JSC__JSValue__put(value, global, key, result);
    }

    extern "C" fn JSC__JSValue__putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: JSC.JSValue) void;
    fn putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: JSC.JSValue) void {
        if (comptime bun.Environment.isDebug)
            JSC.markBinding(@src());
        JSC__JSValue__putBunString(value, global, key, result);
    }

    pub fn put(value: JSValue, global: *JSGlobalObject, key: anytype, result: JSC.JSValue) void {
        const Key = @TypeOf(key);
        if (comptime @typeInfo(Key) == .Pointer) {
            const Elem = @typeInfo(Key).Pointer.child;
            if (Elem == ZigString) {
                putZigString(value, global, key, result);
            } else if (Elem == bun.String) {
                putBunString(value, global, key, result);
            } else {
                @compileError("Unsupported key type in put(). Expected ZigString or bun.String, got " ++ @typeName(Elem));
            }
        } else if (comptime Key == ZigString) {
            putZigString(value, global, &key, result);
        } else if (comptime Key == bun.String) {
            putBunString(value, global, &key, result);
        } else {
            @compileError("Unsupported key type in put(). Expected ZigString or bun.String, got " ++ @typeName(Key));
        }
    }

    /// Note: key can't be numeric (if so, use putMayBeIndex instead)
    extern fn JSC__JSValue__putMayBeIndex(target: JSValue, globalObject: *JSGlobalObject, key: *const String, value: JSC.JSValue) void;

    /// Same as `.put` but accepts both non-numeric and numeric keys.
    /// Prefer to use `.put` if the key is guaranteed to be non-numeric (e.g. known at comptime)
    pub inline fn putMayBeIndex(this: JSValue, globalObject: *JSGlobalObject, key: *const String, value: JSValue) void {
        JSC__JSValue__putMayBeIndex(this, globalObject, key, value);
    }

    pub fn putIndex(value: JSValue, globalObject: *JSGlobalObject, i: u32, out: JSValue) void {
        cppFn("putIndex", .{ value, globalObject, i, out });
    }

    pub fn push(value: JSValue, globalObject: *JSGlobalObject, out: JSValue) void {
        cppFn("push", .{ value, globalObject, out });
    }

    extern fn JSC__JSValue__toISOString(*JSC.JSGlobalObject, JSC.JSValue, *[28]u8) c_int;
    pub fn toISOString(this: JSValue, globalObject: *JSC.JSGlobalObject, buf: *[28]u8) []const u8 {
        const count = JSC__JSValue__toISOString(globalObject, this, buf);
        if (count < 0) {
            return "";
        }

        return buf[0..@as(usize, @intCast(count))];
    }

    /// Return the pointer to the wrapped object only if it is a direct instance of the type.
    /// If the object does not match the type, return null.
    /// If the object is a subclass of the type or has mutated the structure, return null.
    /// Note: this may return null for direct instances of the type if the user adds properties to the object.
    pub fn asDirect(value: JSValue, comptime ZigType: type) ?*ZigType {
        bun.assert(value.isCell()); // you must have already checked this.

        return ZigType.fromJSDirect(value);
    }

    pub fn as(value: JSValue, comptime ZigType: type) ?*ZigType {
        if (value.isEmptyOrUndefinedOrNull())
            return null;

        if (comptime ZigType == DOMURL) {
            return DOMURL.cast(value);
        }

        if (comptime ZigType == FetchHeaders) {
            return FetchHeaders.cast(value);
        }

        if (comptime ZigType == JSC.WebCore.Body.Value) {
            if (value.as(JSC.WebCore.Request)) |req| {
                return req.getBodyValue();
            }

            if (value.as(JSC.WebCore.Response)) |res| {
                return res.getBodyValue();
            }

            return null;
        }

        if (comptime @hasDecl(ZigType, "fromJS") and @TypeOf(ZigType.fromJS) == fn (JSC.JSValue) ?*ZigType) {
            if (comptime ZigType == JSC.WebCore.Blob) {
                if (ZigType.fromJS(value)) |blob| {
                    return blob;
                }

                if (JSC.API.BuildArtifact.fromJS(value)) |build| {
                    return &build.blob;
                }

                return null;
            }

            return ZigType.fromJS(value);
        }

        return JSC.GetJSPrivateData(ZigType, value.asObjectRef());
    }

    extern fn JSC__JSValue__dateInstanceFromNullTerminatedString(*JSGlobalObject, [*:0]const u8) JSValue;
    pub fn fromDateString(globalObject: *JSGlobalObject, str: [*:0]const u8) JSValue {
        JSC.markBinding(@src());
        return JSC__JSValue__dateInstanceFromNullTerminatedString(globalObject, str);
    }

    extern fn JSBuffer__isBuffer(*JSGlobalObject, JSValue) bool;
    pub fn isBuffer(value: JSValue, global: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return JSBuffer__isBuffer(global, value);
    }

    pub fn isRegExp(this: JSValue) bool {
        return this.jsType() == .RegExpObject;
    }

    pub fn isDate(this: JSValue) bool {
        return this.jsType() == .JSDate;
    }

    pub fn asCheckLoaded(value: JSValue, comptime ZigType: type) ?*ZigType {
        if (!ZigType.Class.isLoaded() or value.isUndefinedOrNull())
            return null;

        return JSC.GetJSPrivateData(ZigType, value.asObjectRef());
    }

    pub fn protect(this: JSValue) void {
        if (this.isEmptyOrUndefinedOrNull() or this.isNumber()) return;
        JSC.C.JSValueProtect(JSC.VirtualMachine.get().global, this.asObjectRef());
    }

    pub fn unprotect(this: JSValue) void {
        if (this.isEmptyOrUndefinedOrNull() or this.isNumber()) return;
        JSC.C.JSValueUnprotect(JSC.VirtualMachine.get().global, this.asObjectRef());
    }

    pub fn JSONValueFromString(
        global: *JSGlobalObject,
        str: [*]const u8,
        len: usize,
        ascii: bool,
    ) JSValue {
        return cppFn("JSONValueFromString", .{ global, str, len, ascii });
    }

    /// Create an object with exactly two properties
    pub fn createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) JSValue {
        return cppFn("createObject2", .{ global, key1, key2, value1, value2 });
    }

    pub fn asPromisePtr(this: JSValue, comptime T: type) *T {
        return asPtr(this, T);
    }

    pub fn createRopeString(this: JSValue, rhs: JSValue, globalThis: *JSC.JSGlobalObject) JSValue {
        return cppFn("createRopeString", .{ this, rhs, globalThis });
    }

    pub fn getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return cppFn("getErrorsProperty", .{ this, globalObject });
    }

    pub fn createBufferFromLength(globalObject: *JSGlobalObject, len: usize) JSValue {
        JSC.markBinding(@src());
        return JSBuffer__bufferFromLength(globalObject, @as(i64, @intCast(len)));
    }

    pub fn jestSnapshotPrettyFormat(this: JSValue, out: *MutableString, globalObject: *JSGlobalObject) !void {
        var buffered_writer = MutableString.BufferedWriter{ .context = out };
        const writer = buffered_writer.writer();
        const Writer = @TypeOf(writer);

        const fmt_options = JestPrettyFormat.FormatOptions{
            .enable_colors = false,
            .add_newline = false,
            .flush = false,
            .quote_strings = true,
        };

        JestPrettyFormat.format(
            .Debug,
            globalObject,
            @as([*]const JSValue, @ptrCast(&this)),
            1,
            Writer,
            Writer,
            writer,
            fmt_options,
        );

        try buffered_writer.flush();

        const count: usize = brk: {
            var total: usize = 0;
            var remain = out.list.items;
            while (strings.indexOfChar(remain, '`')) |i| {
                total += 1;
                remain = remain[i + 1 ..];
            }
            break :brk total;
        };

        if (count > 0) {
            var result = try out.allocator.alloc(u8, count + out.list.items.len);
            var input = out.list.items;

            var input_i: usize = 0;
            var result_i: usize = 0;
            while (strings.indexOfChar(input[input_i..], '`')) |i| {
                bun.copy(u8, result[result_i..], input[input_i .. input_i + i]);
                result_i += i;
                result[result_i] = '\\';
                result[result_i + 1] = '`';
                result_i += 2;
                input_i += i + 1;
            }

            if (result_i != result.len) {
                bun.copy(u8, result[result_i..], input[input_i..]);
            }

            out.deinit();
            out.list.items = result;
            out.list.capacity = result.len;
        }
    }

    pub fn jestPrettyFormat(this: JSValue, out: *MutableString, globalObject: *JSGlobalObject) !void {
        var buffered_writer = MutableString.BufferedWriter{ .context = out };
        const writer = buffered_writer.writer();
        const Writer = @TypeOf(writer);

        const fmt_options = JSC.ConsoleObject.FormatOptions{
            .enable_colors = false,
            .add_newline = false,
            .flush = false,
            .ordered_properties = true,
            .quote_strings = true,
        };

        JSC.ConsoleObject.format2(
            .Debug,
            globalObject,
            @as([*]const JSValue, @ptrCast(&this)),
            1,
            Writer,
            Writer,
            writer,
            fmt_options,
        );

        try buffered_writer.flush();
    }

    extern fn JSBuffer__bufferFromLength(*JSGlobalObject, i64) JSValue;

    /// Must come from globally-allocated memory if allocator is not null
    pub fn createBuffer(globalObject: *JSGlobalObject, slice: []u8, allocator: ?std.mem.Allocator) JSValue {
        JSC.markBinding(@src());
        @setRuntimeSafety(false);
        if (allocator) |alloc| {
            return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, alloc.ptr, JSC.MarkedArrayBuffer_deallocator);
        } else {
            return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, null, null);
        }
    }

    pub fn createUninitializedUint8Array(globalObject: *JSGlobalObject, len: usize) JSValue {
        JSC.markBinding(@src());
        return shim.cppFn("createUninitializedUint8Array", .{ globalObject, len });
    }

    pub fn createBufferWithCtx(globalObject: *JSGlobalObject, slice: []u8, ptr: ?*anyopaque, func: JSC.C.JSTypedArrayBytesDeallocator) JSValue {
        JSC.markBinding(@src());
        @setRuntimeSafety(false);
        return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, ptr, func);
    }

    extern fn JSBuffer__bufferFromPointerAndLengthAndDeinit(*JSGlobalObject, [*]u8, usize, ?*anyopaque, JSC.C.JSTypedArrayBytesDeallocator) JSValue;

    pub fn jsNumberWithType(comptime Number: type, number: Number) JSValue {
        return switch (comptime Number) {
            JSValue => number,
            u0 => jsNumberFromInt32(0),
            f32, f64 => jsNumberFromDouble(@as(f64, number)),
            u31, c_ushort, u8, i16, i32, c_int, i8, u16 => jsNumberFromInt32(@as(i32, @intCast(number))),
            c_long, u32, u52, c_uint, i64, isize => jsNumberFromInt64(@as(i64, @intCast(number))),
            usize, u64 => jsNumberFromUint64(@as(u64, @intCast(number))),
            comptime_int => switch (number) {
                0...std.math.maxInt(i32) => jsNumberFromInt32(@as(i32, @intCast(number))),
                else => jsNumberFromInt64(@as(i64, @intCast(number))),
            },
            else => {
                @compileError("Type transformation missing for number of type: " ++ @typeName(Number));
            },
        };
    }

    pub fn createInternalPromise(globalObject: *JSGlobalObject) JSValue {
        return cppFn("createInternalPromise", .{globalObject});
    }

    pub fn asInternalPromise(
        value: JSValue,
    ) ?*JSInternalPromise {
        return cppFn("asInternalPromise", .{
            value,
        });
    }

    pub fn asPromise(
        value: JSValue,
    ) ?*JSPromise {
        return cppFn("asPromise", .{
            value,
        });
    }

    pub fn asAnyPromise(
        value: JSValue,
    ) ?AnyPromise {
        if (value.isEmptyOrUndefinedOrNull()) return null;
        if (value.asInternalPromise()) |promise| {
            return AnyPromise{
                .Internal = promise,
            };
        }
        if (value.asPromise()) |promise| {
            return AnyPromise{
                .Normal = promise,
            };
        }
        return null;
    }

    pub inline fn jsBoolean(i: bool) JSValue {
        return cppFn("jsBoolean", .{i});
    }

    pub fn jsDoubleNumber(i: f64) JSValue {
        return cppFn("jsDoubleNumber", .{i});
    }

    pub inline fn jsEmptyString(globalThis: *JSGlobalObject) JSValue {
        return cppFn("jsEmptyString", .{globalThis});
    }

    pub inline fn jsNull() JSValue {
        return JSValue.null;
    }

    pub fn jsNumber(number: anytype) JSValue {
        return jsNumberWithType(@TypeOf(number), number);
    }

    pub inline fn jsTDZValue() JSValue {
        return cppFn("jsTDZValue", .{});
    }

    pub inline fn jsUndefined() JSValue {
        return JSValue.undefined;
    }

    pub fn className(this: JSValue, globalThis: *JSGlobalObject) ZigString {
        var str = ZigString.init("");
        this.getClassName(globalThis, &str);
        return str;
    }

    pub fn createStringArray(globalThis: *JSGlobalObject, str: [*c]const ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("createStringArray", .{
            globalThis,
            str,
            strings_count,
            clone,
        });
    }

    pub fn print(
        this: JSValue,
        globalObject: *JSGlobalObject,
        message_type: ConsoleObject.MessageType,
        message_level: ConsoleObject.MessageLevel,
    ) void {
        JSC.ConsoleObject.messageWithTypeAndLevel(
            undefined,
            message_type,
            message_level,
            globalObject,
            &[_]JSC.JSValue{this},
            1,
        );
    }

    /// Create a JSValue string from a zig format-print (fmt + args)
    pub fn printString(globalThis: *JSGlobalObject, comptime stack_buffer_size: usize, comptime fmt: []const u8, args: anytype) !JSValue {
        var stack_fallback = std.heap.stackFallback(stack_buffer_size, globalThis.allocator());

        var buf = try bun.MutableString.init(stack_fallback.get(), stack_buffer_size);
        defer buf.deinit();

        var writer = buf.writer();
        try writer.print(fmt, args);
        return String.init(buf.toOwnedSliceLeaky()).toJS(globalThis);
    }

    /// Create a JSValue string from a zig format-print (fmt + args), with pretty format
    pub fn printStringPretty(globalThis: *JSGlobalObject, comptime stack_buffer_size: usize, comptime fmt: []const u8, args: anytype) !JSValue {
        var stack_fallback = std.heap.stackFallback(stack_buffer_size, globalThis.allocator());

        var buf = try bun.MutableString.init(stack_fallback.get(), stack_buffer_size);
        defer buf.deinit();

        var writer = buf.writer();
        switch (Output.enable_ansi_colors) {
            inline else => |enabled| try writer.print(Output.prettyFmt(fmt, enabled), args),
        }
        return String.init(buf.toOwnedSliceLeaky()).toJS(globalThis);
    }

    pub fn fromEntries(globalThis: *JSGlobalObject, keys_array: [*c]ZigString, values_array: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("fromEntries", .{
            globalThis,
            keys_array,
            values_array,
            strings_count,
            clone,
        });
    }

    pub fn keys(value: JSValue, globalThis: *JSGlobalObject) JSValue {
        return cppFn("keys", .{
            globalThis,
            value,
        });
    }

    /// This is `Object.values`.
    /// `value` is assumed to be not empty, undefined, or null.
    pub fn values(value: JSValue, globalThis: *JSGlobalObject) JSValue {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(!value.isEmptyOrUndefinedOrNull());
        }
        return cppFn("values", .{
            globalThis,
            value,
        });
    }

    extern "C" fn JSC__JSValue__hasOwnPropertyValue(JSValue, *JSGlobalObject, JSValue) bool;
    /// Calls `Object.hasOwnProperty(value)`.
    /// Returns true if the object has the property, false otherwise
    ///
    /// If the object is not an object, it will crash. **You must check if the object is an object before calling this function.**
    pub const hasOwnPropertyValue = JSC__JSValue__hasOwnPropertyValue;

    pub inline fn arrayIterator(this: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return JSArrayIterator.init(this, global);
    }

    pub fn jsNumberFromDouble(i: f64) JSValue {
        return FFI.DOUBLE_TO_JSVALUE(i).asJSValue;
    }
    pub fn jsNumberFromChar(i: u8) JSValue {
        return cppFn("jsNumberFromChar", .{i});
    }
    pub fn jsNumberFromU16(i: u16) JSValue {
        return cppFn("jsNumberFromU16", .{i});
    }
    pub fn jsNumberFromInt32(i: i32) JSValue {
        return FFI.INT32_TO_JSVALUE(i).asJSValue;
    }

    pub fn jsNumberFromInt64(i: i64) JSValue {
        if (i <= std.math.maxInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsNumberFromDouble(@floatFromInt(i));
    }

    pub inline fn toJS(this: JSValue, _: *const JSGlobalObject) JSValue {
        return this;
    }

    pub fn jsNumberFromUint64(i: u64) JSValue {
        if (i <= std.math.maxInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsNumberFromPtrSize(i);
    }

    pub fn jsNumberFromPtrSize(i: usize) JSValue {
        return jsNumberFromDouble(@floatFromInt(i));
    }

    fn coerceJSValueDoubleTruncatingT(comptime T: type, num: f64) T {
        return coerceJSValueDoubleTruncatingTT(T, T, num);
    }

    fn coerceJSValueDoubleTruncatingTT(comptime T: type, comptime Out: type, num: f64) Out {
        if (std.math.isNan(num)) {
            return 0;
        }

        if (num <= std.math.minInt(T) or std.math.isNegativeInf(num)) {
            return std.math.minInt(T);
        }

        if (num >= std.math.maxInt(T) or std.math.isPositiveInf(num)) {
            return std.math.maxInt(T);
        }

        return @intFromFloat(num);
    }

    pub fn coerceDoubleTruncatingIntoInt64(this: JSValue) i64 {
        return coerceJSValueDoubleTruncatingT(i64, this.asNumber());
    }

    /// Decimal values are truncated without rounding.
    /// `-Infinity` and `NaN` coerce to -minInt(64)
    /// `Infinity` coerces to maxInt(64)
    pub fn toInt64(this: JSValue) i64 {
        if (this.isInt32()) {
            return this.asInt32();
        }

        if (this.isNumber()) {
            return this.coerceDoubleTruncatingIntoInt64();
        }

        return cppFn("toInt64", .{this});
    }

    pub const ComparisonResult = enum(u8) {
        equal,
        undefined_result,
        greater_than,
        less_than,
        invalid_comparison,
    };

    pub fn asBigIntCompare(this: JSValue, global: *JSGlobalObject, other: JSValue) ComparisonResult {
        if (!this.isBigInt() or (!other.isBigInt() and !other.isNumber())) {
            return .invalid_comparison;
        }
        return cppFn("asBigIntCompare", .{ this, global, other });
    }

    pub inline fn isUndefined(this: JSValue) bool {
        return @intFromEnum(this) == 0xa;
    }
    pub inline fn isNull(this: JSValue) bool {
        return @intFromEnum(this) == 0x2;
    }
    pub inline fn isEmptyOrUndefinedOrNull(this: JSValue) bool {
        return switch (@intFromEnum(this)) {
            0, 0xa, 0x2 => true,
            else => false,
        };
    }
    pub fn isUndefinedOrNull(this: JSValue) bool {
        return switch (@intFromEnum(this)) {
            0xa, 0x2 => true,
            else => false,
        };
    }
    /// Empty as in "JSValue {}" rather than an empty string
    pub inline fn isEmpty(this: JSValue) bool {
        return switch (@intFromEnum(this)) {
            0 => true,
            else => false,
        };
    }
    pub fn isBoolean(this: JSValue) bool {
        return cppFn("isBoolean", .{this});
    }
    pub fn isAnyInt(this: JSValue) bool {
        return cppFn("isAnyInt", .{this});
    }
    pub fn isUInt32AsAnyInt(this: JSValue) bool {
        return cppFn("isUInt32AsAnyInt", .{this});
    }

    pub fn asEncoded(this: JSValue) FFI.EncodedJSValue {
        return FFI.EncodedJSValue{ .asJSValue = this };
    }

    pub fn fromCell(ptr: *anyopaque) JSValue {
        return (FFI.EncodedJSValue{ .asPtr = ptr }).asJSValue;
    }

    pub fn isInt32(this: JSValue) bool {
        return FFI.JSVALUE_IS_INT32(.{ .asJSValue = this });
    }

    pub fn isInt32AsAnyInt(this: JSValue) bool {
        return cppFn("isInt32AsAnyInt", .{this});
    }

    pub fn isNumber(this: JSValue) bool {
        return FFI.JSVALUE_IS_NUMBER(.{ .asJSValue = this });
    }

    pub fn isDouble(this: JSValue) bool {
        return this.isNumber() and !this.isInt32();
    }

    pub fn isError(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return this.jsType() == JSType.ErrorInstance;
    }

    pub fn isAnyError(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return cppFn("isAnyError", .{this});
    }

    pub fn toError_(this: JSValue) JSValue {
        return cppFn("toError_", .{this});
    }

    pub fn toError(this: JSValue) ?JSValue {
        const res = this.toError_();
        if (res == .zero)
            return null;
        return res;
    }

    /// Returns true if
    /// - `" string literal"`
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    pub inline fn isString(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return jsType(this).isStringLike();
    }

    /// Returns true only for string literals
    /// - `" string literal"`
    pub inline fn isStringLiteral(this: JSValue) bool {
        if (!this.isCell()) {
            return false;
        }

        return jsType(this).isString();
    }

    /// Returns true if
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    pub inline fn isStringObjectLike(this: JSValue) bool {
        if (!this.isCell()) {
            return false;
        }

        return jsType(this).isStringObjectLike();
    }

    pub fn isBigInt(this: JSValue) bool {
        return cppFn("isBigInt", .{this});
    }
    pub fn isHeapBigInt(this: JSValue) bool {
        return cppFn("isHeapBigInt", .{this});
    }
    pub fn isBigInt32(this: JSValue) bool {
        return cppFn("isBigInt32", .{this});
    }
    pub fn isSymbol(this: JSValue) bool {
        return cppFn("isSymbol", .{this});
    }
    pub fn isPrimitive(this: JSValue) bool {
        return cppFn("isPrimitive", .{this});
    }
    pub fn isGetterSetter(this: JSValue) bool {
        return cppFn("isGetterSetter", .{this});
    }
    pub fn isCustomGetterSetter(this: JSValue) bool {
        return cppFn("isCustomGetterSetter", .{this});
    }
    pub inline fn isObject(this: JSValue) bool {
        return this.isCell() and this.jsType().isObject();
    }
    pub fn isObjectEmpty(this: JSValue, globalObject: *JSGlobalObject) bool {
        const type_of_value = this.jsType();
        // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
        // Map and Set are not considered as object in jest-extended
        if (type_of_value.isMap() or type_of_value.isSet() or this.isRegExp() or this.isDate()) {
            return false;
        }

        return this.jsType().isObject() and keys(this, globalObject).getLength(globalObject) == 0;
    }

    pub fn isClass(this: JSValue, global: *JSGlobalObject) bool {
        return cppFn("isClass", .{ this, global });
    }

    pub fn isConstructor(this: JSValue) bool {
        if (!this.isCell()) return false;
        return cppFn("isConstructor", .{this});
    }

    pub fn getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        if (this.isEmptyOrUndefinedOrNull()) {
            return;
        }

        cppFn("getNameProperty", .{ this, global, ret });
    }

    extern fn JSC__JSValue__getName(JSC.JSValue, *JSC.JSGlobalObject, *bun.String) void;
    pub fn getName(this: JSValue, global: *JSGlobalObject) bun.String {
        var ret = bun.String.empty;
        JSC__JSValue__getName(this, global, &ret);
        return ret;
    }

    pub fn getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        cppFn("getClassName", .{ this, global, ret });
    }

    pub inline fn isCell(this: JSValue) bool {
        return switch (this) {
            .zero, .undefined, .null, .true, .false => false,
            else => (@as(u64, @bitCast(@intFromEnum(this))) & FFI.NotCellMask) == 0,
        };
    }

    pub fn toJSString(globalObject: *JSC.JSGlobalObject, slice_: []const u8) JSC.JSValue {
        return JSC.ZigString.init(slice_).withEncoding().toJS(globalObject);
    }

    pub fn asCell(this: JSValue) *JSCell {
        return cppFn("asCell", .{this});
    }

    pub fn isCallable(this: JSValue, vm: *VM) bool {
        return cppFn("isCallable", .{ this, vm });
    }

    pub fn isException(this: JSValue, vm: *VM) bool {
        return cppFn("isException", .{ this, vm });
    }

    pub fn isTerminationException(this: JSValue, vm: *VM) bool {
        return cppFn("isTerminationException", .{ this, vm });
    }

    pub fn toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void {
        return cppFn("toZigException", .{ this, global, exception });
    }

    pub fn toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) void {
        return cppFn("toZigString", .{ this, out, global });
    }

    /// Increments the reference count
    ///
    /// **You must call `.deref()` or it will leak memory**
    pub fn toBunString(this: JSValue, globalObject: *JSC.JSGlobalObject) bun.String {
        return bun.String.fromJS(this, globalObject);
    }

    /// this: RegExp value
    /// other: string value
    pub fn toMatch(this: JSValue, global: *JSGlobalObject, other: JSValue) bool {
        return cppFn("toMatch", .{ this, global, other });
    }

    pub fn asArrayBuffer_(this: JSValue, global: *JSGlobalObject, out: *ArrayBuffer) bool {
        return cppFn("asArrayBuffer_", .{ this, global, out });
    }

    pub fn asArrayBuffer(this: JSValue, global: *JSGlobalObject) ?ArrayBuffer {
        var out: ArrayBuffer = .{
            .offset = 0,
            .len = 0,
            .byte_len = 0,
            .shared = false,
            .typed_array_type = .Uint8Array,
        };

        if (this.asArrayBuffer_(global, &out)) {
            out.value = this;
            return out;
        }

        return null;
    }

    /// This always returns a JS BigInt
    pub fn fromInt64NoTruncate(globalObject: *JSGlobalObject, i: i64) JSValue {
        return cppFn("fromInt64NoTruncate", .{ globalObject, i });
    }
    /// This always returns a JS BigInt
    pub fn fromUInt64NoTruncate(globalObject: *JSGlobalObject, i: u64) JSValue {
        return cppFn("fromUInt64NoTruncate", .{ globalObject, i });
    }

    /// This always returns a JS BigInt using std.posix.timeval from std.posix.rusage
    pub fn fromTimevalNoTruncate(globalObject: *JSGlobalObject, nsec: i64, sec: i64) JSValue {
        return cppFn("fromTimevalNoTruncate", .{ globalObject, nsec, sec });
    }

    /// Sums two JS BigInts
    pub fn bigIntSum(globalObject: *JSGlobalObject, a: JSValue, b: JSValue) JSValue {
        return cppFn("bigIntSum", .{ globalObject, a, b });
    }

    pub fn toUInt64NoTruncate(this: JSValue) u64 {
        return cppFn("toUInt64NoTruncate", .{
            this,
        });
    }

    pub inline fn getZigString(this: JSValue, global: *JSGlobalObject) ZigString {
        var str = ZigString.init("");
        this.toZigString(&str, global);
        return str;
    }

    /// Convert a JSValue to a string, potentially calling `toString` on the
    /// JSValue in JavaScript.
    ///
    /// This function can throw an exception in the `JSC::VM`. **If
    /// the exception is not handled correctly, Bun will segfault**
    ///
    /// To handle exceptions, use `JSValue.toSliceOrNull`.
    pub inline fn toSlice(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        const str = bun.String.fromJS(this, global);
        defer str.deref();

        // This keeps the WTF::StringImpl alive if it was originally a latin1
        // ASCII-only string.
        //
        // Otherwise, it will be cloned using the allocator.
        return str.toUTF8(allocator);
    }

    pub inline fn toSliceZ(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        return getZigString(this, global).toSliceZ(allocator);
    }

    // On exception, this returns the empty string.
    pub fn toString(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return cppFn("toString", .{ this, globalThis });
    }

    pub fn jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *bun.String) void {
        return cppFn("jsonStringify", .{ this, globalThis, indent, out });
    }

    /// On exception, this returns null, to make exception checks clearer.
    pub fn toStringOrNull(this: JSValue, globalThis: *JSGlobalObject) ?*JSString {
        return cppFn("toStringOrNull", .{ this, globalThis });
    }

    /// Call `toString()` on the JSValue and clone the result.
    /// On exception, this returns null.
    pub fn toSliceOrNull(this: JSValue, globalThis: *JSGlobalObject) ?ZigString.Slice {
        const str = bun.String.tryFromJS(this, globalThis) orelse return null;
        defer str.deref();
        return str.toUTF8(bun.default_allocator);
    }

    /// Call `toString()` on the JSValue and clone the result.
    /// On exception or out of memory, this returns null.
    ///
    /// Remember that `Symbol` throws an exception when you call `toString()`.
    pub fn toSliceClone(this: JSValue, globalThis: *JSGlobalObject) ?ZigString.Slice {
        return this.toSliceCloneWithAllocator(globalThis, bun.default_allocator);
    }

    /// On exception or out of memory, this returns null, to make exception checks clearer.
    pub fn toSliceCloneWithAllocator(
        this: JSValue,
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ?ZigString.Slice {
        var str = this.toStringOrNull(globalThis) orelse return null;
        return str.toSlice(globalThis, allocator).cloneIfNeeded(allocator) catch {
            globalThis.throwOutOfMemory();
            return null;
        };
    }

    pub fn toObject(this: JSValue, globalThis: *JSGlobalObject) *JSObject {
        return cppFn("toObject", .{ this, globalThis });
    }

    pub fn getPrototype(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return cppFn("getPrototype", .{ this, globalObject });
    }

    pub fn eqlValue(this: JSValue, other: JSValue) bool {
        return cppFn("eqlValue", .{ this, other });
    }

    pub fn eqlCell(this: JSValue, other: *JSCell) bool {
        return cppFn("eqlCell", .{ this, other });
    }

    pub const BuiltinName = enum(u8) {
        method,
        headers,
        status,
        statusText,
        url,
        body,
        data,
        toString,
        redirect,
        inspectCustom,
        highWaterMark,
        path,
        stream,
        asyncIterator,
        name,
        message,
        @"error",

        pub fn has(property: []const u8) bool {
            return bun.ComptimeEnumMap(BuiltinName).has(property);
        }
    };

    pub fn fastGetOrElse(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName, alternate: ?JSC.JSValue) ?JSValue {
        return this.fastGet(global, builtin_name) orelse {
            if (alternate) |alt| return alt.fastGet(global, builtin_name);

            return null;
        };
    }

    // `this` must be known to be an object
    // intended to be more lightweight than ZigString.
    pub fn fastGet(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        if (bun.Environment.allow_assert)
            bun.assert(this.isObject());
        const result = fastGet_(this, global, @intFromEnum(builtin_name));
        if (result == .zero or
            // JS APIs treat {}.a as mostly the same as though it was not defined
            result == .undefined)
        {
            return null;
        }

        return result;
    }

    pub fn fastGetDirect(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        const result = fastGetDirect_(this, global, @intFromEnum(builtin_name));
        if (result == .zero) {
            return null;
        }

        return result;
    }

    pub fn fastGet_(this: JSValue, global: *JSGlobalObject, builtin_name: u8) JSValue {
        return cppFn("fastGet_", .{ this, global, builtin_name });
    }

    pub fn fastGetDirect_(this: JSValue, global: *JSGlobalObject, builtin_name: u8) JSValue {
        return cppFn("fastGetDirect_", .{ this, global, builtin_name });
    }

    /// Do not use this directly! Use `get` instead.
    pub fn getIfPropertyExistsImpl(this: JSValue, global: *JSGlobalObject, ptr: [*]const u8, len: u32) JSValue {
        return cppFn("getIfPropertyExistsImpl", .{ this, global, ptr, len });
    }

    pub fn getIfPropertyExistsFromPath(this: JSValue, global: *JSGlobalObject, path: JSValue) JSValue {
        return cppFn("getIfPropertyExistsFromPath", .{ this, global, path });
    }

    pub fn getSymbolDescription(this: JSValue, global: *JSGlobalObject, str: *ZigString) void {
        cppFn("getSymbolDescription", .{ this, global, str });
    }

    pub fn symbolFor(global: *JSGlobalObject, str: *ZigString) JSValue {
        return cppFn("symbolFor", .{ global, str });
    }

    pub fn symbolKeyFor(this: JSValue, global: *JSGlobalObject, str: *ZigString) bool {
        return cppFn("symbolKeyFor", .{ this, global, str });
    }

    pub fn _then(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: JSNativeFn, reject: JSNativeFn) void {
        return cppFn("_then", .{ this, global, ctx, resolve, reject });
    }

    pub fn then(this: JSValue, global: *JSGlobalObject, ctx: ?*anyopaque, resolve: JSNativeFn, reject: JSNativeFn) void {
        if (comptime bun.Environment.allow_assert)
            bun.assert(JSValue.fromPtr(ctx).asPtr(anyopaque) == ctx.?);
        return this._then(global, JSValue.fromPtr(ctx), resolve, reject);
    }

    pub fn getDescription(this: JSValue, global: *JSGlobalObject) ZigString {
        var zig_str = ZigString.init("");
        getSymbolDescription(this, global, &zig_str);
        return zig_str;
    }

    pub fn get(this: JSValue, global: *JSGlobalObject, property: []const u8) ?JSValue {
        if (comptime bun.Environment.isDebug) {
            if (BuiltinName.has(property)) {
                Output.debugWarn("get(\"{s}\") called. Please use fastGet(.{s}) instead!", .{ property, property });
            }
        }

        const value = getIfPropertyExistsImpl(this, global, property.ptr, @as(u32, @intCast(property.len)));
        return if (@intFromEnum(value) != 0) value else return null;
    }

    extern fn JSC__JSValue__getIfPropertyExistsImplString(value: JSValue, globalObject: *JSGlobalObject, propertyName: [*c]const bun.String) JSValue;

    pub fn getWithString(this: JSValue, global: *JSGlobalObject, property_name: anytype) ?JSValue {
        var property_name_str = bun.String.init(property_name);
        const value = JSC__JSValue__getIfPropertyExistsImplString(this, global, &property_name_str);
        return if (@intFromEnum(value) != 0) value else return null;
    }

    extern fn JSC__JSValue__getOwn(value: JSValue, globalObject: *JSGlobalObject, propertyName: [*c]const bun.String) JSValue;

    /// Get *own* property value (i.e. does not resolve property in the prototype chain)
    pub fn getOwn(this: JSValue, global: *JSGlobalObject, property_name: anytype) ?JSValue {
        var property_name_str = bun.String.init(property_name);
        const value = JSC__JSValue__getOwn(this, global, &property_name_str);
        return if (@intFromEnum(value) != 0) value else return null;
    }

    /// safe to use on any JSValue
    pub fn implementsToString(this: JSValue, global: *JSGlobalObject) bool {
        if (!this.isObject())
            return false;
        const function = this.fastGet(global, BuiltinName.toString) orelse
            return false;
        return function.isCell() and function.isCallable(global.vm());
    }

    pub fn getTruthyComptime(this: JSValue, global: *JSGlobalObject, comptime property: []const u8) ?JSValue {
        if (comptime bun.ComptimeEnumMap(BuiltinName).has(property)) {
            if (fastGet(this, global, @field(BuiltinName, property))) |prop| {
                if (prop.isEmptyOrUndefinedOrNull()) return null;
                return prop;
            }

            return null;
        }

        return getTruthy(this, global, property);
    }

    pub fn getTruthy(this: JSValue, global: *JSGlobalObject, property: []const u8) ?JSValue {
        if (get(this, global, property)) |prop| {
            if (prop.isEmptyOrUndefinedOrNull()) return null;
            return prop;
        }

        return null;
    }

    pub fn toEnumFromMap(
        this: JSValue,
        globalThis: *JSGlobalObject,
        comptime property_name: []const u8,
        comptime Enum: type,
        comptime StringMap: anytype,
    ) !Enum {
        if (!this.isString()) {
            globalThis.throwInvalidArguments(property_name ++ " must be a string", .{});
            return error.JSError;
        }

        const target_str = this.getZigString(globalThis);
        return StringMap.getWithEql(target_str, ZigString.eqlComptime) orelse {
            const one_of = struct {
                pub const list = brk: {
                    var str: []const u8 = "'";
                    const field_names = bun.meta.enumFieldNames(Enum);
                    for (field_names, 0..) |entry, i| {
                        str = str ++ entry ++ "'";
                        if (i < field_names.len - 2) {
                            str = str ++ ", '";
                        } else if (i == field_names.len - 2) {
                            str = str ++ " or '";
                        }
                    }
                    break :brk str;
                };

                pub const label = property_name ++ " must be one of " ++ list;
            }.label;
            globalThis.throwInvalidArguments(one_of, .{});
            return error.JSError;
        };
    }

    pub fn toEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) !Enum {
        return toEnumFromMap(this, globalThis, property_name, Enum, Enum.Map);
    }

    pub fn toOptionalEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) !?Enum {
        if (this.isEmptyOrUndefinedOrNull())
            return null;

        return toEnum(this, globalThis, property_name, Enum);
    }

    pub fn getOptionalEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) !?Enum {
        if (comptime BuiltinName.has(property_name)) {
            if (fastGet(this, globalThis, @field(BuiltinName, property_name))) |prop| {
                if (prop.isEmptyOrUndefinedOrNull())
                    return null;
                return try toEnum(prop, globalThis, property_name, Enum);
            }
            return null;
        }

        if (get(this, globalThis, property_name)) |prop| {
            if (prop.isEmptyOrUndefinedOrNull())
                return null;
            return try toEnum(prop, globalThis, property_name, Enum);
        }
        return null;
    }

    pub fn getArray(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) !?JSValue {
        if (getTruthy(this, globalThis, property_name)) |prop| {
            if (!prop.jsTypeLoose().isArray()) {
                globalThis.throwInvalidArguments(property_name ++ " must be an array", .{});
                return error.JSError;
            }

            if (prop.getLength(globalThis) == 0) {
                return null;
            }

            return prop;
        }

        return null;
    }

    pub fn getObject(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) !?JSValue {
        if (getTruthy(this, globalThis, property_name)) |prop| {
            if (!prop.jsTypeLoose().isObject()) {
                globalThis.throwInvalidArguments(property_name ++ " must be an object", .{});
                return error.JSError;
            }

            return prop;
        }

        return null;
    }

    pub fn getFunction(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) !?JSValue {
        if (getTruthy(this, globalThis, property_name)) |prop| {
            if (!prop.isCell() or !prop.isCallable(globalThis.vm())) {
                globalThis.throwInvalidArguments(property_name ++ " must be a function", .{});
                return error.JSError;
            }

            return prop;
        }

        return null;
    }

    pub fn getOptional(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime T: type) !?T {
        const prop = (if (comptime BuiltinName.has(property_name))
            fastGet(this, globalThis, @field(BuiltinName, property_name))
        else
            get(this, globalThis, property_name)) orelse return null;

        if (!prop.isEmptyOrUndefinedOrNull()) {
            switch (comptime T) {
                bool => {
                    if (prop.isBoolean()) {
                        return prop.toBoolean();
                    }

                    if (prop.isNumber()) {
                        return prop.coerce(f64, globalThis) != 0;
                    }

                    globalThis.throwInvalidArguments(property_name ++ " must be a boolean", .{});
                    return error.JSError;
                },
                ZigString.Slice => {
                    if (prop.isString()) {
                        if (return prop.toSliceOrNull(globalThis)) |str| {
                            return str;
                        }
                    }

                    globalThis.throwInvalidArguments(property_name ++ " must be a string", .{});
                    return error.JSError;
                },
                else => @compileError("TODO:" ++ @typeName(T)),
            }
        }

        return null;
    }

    /// Alias for getIfPropertyExists
    pub const getIfPropertyExists = get;

    pub fn createTypeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createTypeError", .{ message, code, global });
    }

    pub fn createRangeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createRangeError", .{ message, code, global });
    }

    /// Object.is()
    /// This algorithm differs from the IsStrictlyEqual Algorithm by treating all NaN values as equivalent and by differentiating +0𝔽 from -0𝔽.
    /// https://tc39.es/ecma262/#sec-samevalue
    pub fn isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return @intFromEnum(this) == @intFromEnum(other) or cppFn("isSameValue", .{ this, other, global });
    }

    pub fn deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("deepEquals", .{ this, other, global });
    }

    /// same as `JSValue.deepEquals`, but with jest asymmetric matchers enabled
    pub fn jestDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("jestDeepEquals", .{ this, other, global });
    }

    pub fn strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("strictDeepEquals", .{ this, other, global });
    }

    /// same as `JSValue.strictDeepEquals`, but with jest asymmetric matchers enabled
    pub fn jestStrictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("jestStrictDeepEquals", .{ this, other, global });
    }

    pub fn deepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool {
        return cppFn("deepMatch", .{ this, subset, global, replace_props_with_asymmetric_matchers });
    }

    /// same as `JSValue.deepMatch`, but with jest asymmetric matchers enabled
    pub fn jestDeepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool {
        return cppFn("jestDeepMatch", .{ this, subset, global, replace_props_with_asymmetric_matchers });
    }

    pub const DiffMethod = enum(u8) {
        none,
        character,
        word,
        line,
    };

    pub fn determineDiffMethod(this: JSValue, other: JSValue, global: *JSGlobalObject) DiffMethod {
        if ((this.isString() and other.isString()) or (this.isBuffer(global) and other.isBuffer(global))) return .character;
        if ((this.isRegExp() and other.isObject()) or (this.isObject() and other.isRegExp())) return .character;
        if (this.isObject() and other.isObject()) return .line;

        return .none;
    }

    pub fn asString(this: JSValue) *JSString {
        return cppFn("asString", .{
            this,
        });
    }

    /// Get the internal number of the `JSC::DateInstance` object
    /// Returns NaN if the value is not a `JSC::DateInstance` (`Date` in JS)
    pub fn getUnixTimestamp(this: JSValue) f64 {
        return cppFn("getUnixTimestamp", .{
            this,
        });
    }

    pub const StringFormatter = struct {
        value: JSC.JSValue,
        globalObject: *JSC.JSGlobalObject,

        pub fn format(this: StringFormatter, comptime text: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const str = this.value.toBunString(this.globalObject);
            defer str.deref();
            try str.format(text, opts, writer);
        }
    };

    pub fn fmtString(this: JSValue, globalObject: *JSC.JSGlobalObject) StringFormatter {
        return .{
            .value = this,
            .globalObject = globalObject,
        };
    }

    pub fn toFmt(
        this: JSValue,
        global: *JSGlobalObject,
        formatter: *Exports.ConsoleObject.Formatter,
    ) Exports.ConsoleObject.Formatter.ZigFormatter {
        formatter.remaining_values = &[_]JSValue{};
        if (formatter.map_node) |node| {
            node.release();
            formatter.map_node = null;
        }

        return Exports.ConsoleObject.Formatter.ZigFormatter{
            .formatter = formatter,
            .value = this,
            .global = global,
        };
    }

    /// Check if the JSValue is either a signed 32-bit integer or a double and
    /// return the value as a f64
    ///
    /// This does not call `valueOf` on the JSValue
    pub fn getNumber(this: JSValue) ?f64 {
        if (this.isInt32()) {
            return @as(f64, @floatFromInt(this.asInt32()));
        }

        if (isNumber(this)) {
            // Don't need to check for !isInt32() because above
            return asDouble(this);
        }

        return null;
    }

    pub fn asNumber(this: JSValue) f64 {
        if (this.isInt32()) {
            return @as(f64, @floatFromInt(this.asInt32()));
        }

        if (isNumber(this)) {
            // Don't need to check for !isInt32() because above
            return asDouble(this);
        }

        if (this.isUndefinedOrNull()) {
            return 0.0;
        } else if (this.isBoolean()) {
            return if (asBoolean(this)) 1.0 else 0.0;
        }

        return cppFn("asNumber", .{
            this,
        });
    }

    pub fn asDouble(this: JSValue) f64 {
        bun.assert(this.isDouble());
        return FFI.JSVALUE_TO_DOUBLE(.{ .asJSValue = this });
    }

    pub fn asPtr(this: JSValue, comptime Pointer: type) *Pointer {
        return @as(*Pointer, @ptrFromInt(this.asPtrAddress()));
    }

    pub fn fromPtrAddress(addr: anytype) JSValue {
        return jsNumber(@as(f64, @floatFromInt(@as(usize, @bitCast(@as(usize, addr))))));
    }

    pub fn asPtrAddress(this: JSValue) usize {
        return @as(usize, @bitCast(@as(usize, @intFromFloat(this.asDouble()))));
    }

    pub fn fromPtr(addr: anytype) JSValue {
        return fromPtrAddress(@intFromPtr(addr));
    }

    pub fn toBooleanSlow(this: JSValue, global: *JSGlobalObject) bool {
        return cppFn("toBooleanSlow", .{ this, global });
    }

    pub fn toBoolean(this: JSValue) bool {
        if (isEmptyOrUndefinedOrNull(this)) {
            return false;
        }

        return asBoolean(this);
    }

    pub fn asBoolean(this: JSValue) bool {
        if (comptime bun.Environment.allow_assert) {
            if (!this.isBoolean()) {
                Output.panic("Expected boolean but found {s}", .{@tagName(this.jsTypeLoose())});
            }
        }
        return FFI.JSVALUE_TO_BOOL(.{ .asJSValue = this });
    }

    pub inline fn asInt52(this: JSValue) i64 {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(this.isNumber());
        }
        return coerceJSValueDoubleTruncatingTT(i52, i64, this.asNumber());
    }

    pub fn toInt32(this: JSValue) i32 {
        if (this.isInt32()) {
            return asInt32(this);
        }

        if (this.getNumber()) |num| {
            return coerceJSValueDoubleTruncatingT(i32, num);
        }

        if (comptime bun.Environment.allow_assert) {
            bun.assert(!this.isString()); // use coerce() instead
            bun.assert(!this.isCell()); // use coerce() instead
        }

        // TODO: this shouldn't be reachable.
        return cppFn("toInt32", .{
            this,
        });
    }

    pub fn asInt32(this: JSValue) i32 {
        // TODO: add this assertion. currently, there is a mistake in
        // argumentCount that mistakenly uses a JSValue instead of a c_int. This
        // mistake performs the correct conversion instructions for it's use
        // case but is bad code practice to misuse JSValue casts.
        //
        // if (bun.Environment.allow_assert) {
        //     bun.assert(this.isInt32());
        // }
        return FFI.JSVALUE_TO_INT32(.{ .asJSValue = this });
    }

    pub fn asFileDescriptor(this: JSValue) bun.FileDescriptor {
        bun.assert(this.isNumber());
        return bun.FDImpl.fromUV(this.toInt32()).encode();
    }

    pub inline fn toU16(this: JSValue) u16 {
        return @as(u16, @truncate(@max(this.toInt32(), 0)));
    }

    pub inline fn toU32(this: JSValue) u32 {
        return @as(u32, @intCast(@min(@max(this.toInt64(), 0), std.math.maxInt(u32))));
    }

    /// This function supports:
    /// - Array, DerivedArray & friends
    /// - String, DerivedString & friends
    /// - TypedArray
    /// - Map (size)
    /// - WeakMap (size)
    /// - Set (size)
    /// - WeakSet (size)
    /// - ArrayBuffer (byteLength)
    /// - anything with a .length property returning a number
    ///
    /// If the "length" property does not exist, this function will return 0.
    pub fn getLength(this: JSValue, globalThis: *JSGlobalObject) u64 {
        const len = this.getLengthIfPropertyExistsInternal(globalThis);
        if (len == std.math.floatMax(f64)) {
            return 0;
        }

        return @as(u64, @intFromFloat(@max(@min(len, std.math.maxInt(i52)), 0)));
    }

    /// This function supports:
    /// - Array, DerivedArray & friends
    /// - String, DerivedString & friends
    /// - TypedArray
    /// - Map (size)
    /// - WeakMap (size)
    /// - Set (size)
    /// - WeakSet (size)
    /// - ArrayBuffer (byteLength)
    /// - anything with a .length property returning a number
    ///
    /// If the "length" property does not exist, this function will return null.
    pub fn tryGetLength(this: JSValue, globalThis: *JSGlobalObject) ?f64 {
        const len = this.getLengthIfPropertyExistsInternal(globalThis);
        if (len == std.math.floatMax(f64)) {
            return null;
        }

        return @as(u64, @intFromFloat(@max(@min(len, std.math.maxInt(i52)), 0)));
    }

    /// Do not use this directly!
    ///
    /// If the property does not exist, this function will return max(f64) instead of 0.
    pub fn getLengthIfPropertyExistsInternal(this: JSValue, globalThis: *JSGlobalObject) f64 {
        return cppFn("getLengthIfPropertyExistsInternal", .{
            this,
            globalThis,
        });
    }

    pub fn isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool {
        return cppFn("isAggregateError", .{ this, globalObject });
    }

    pub fn forEach(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void,
    ) void {
        return cppFn("forEach", .{ this, globalObject, ctx, callback });
    }

    /// Same as `forEach` but accepts a typed context struct without need for @ptrCasts
    pub inline fn forEachWithContext(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: anytype,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: @TypeOf(ctx), nextValue: JSValue) callconv(.C) void,
    ) void {
        const func = @as(*const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void, @ptrCast(callback));
        return cppFn("forEach", .{ this, globalObject, ctx, func });
    }

    pub fn isIterable(this: JSValue, globalObject: *JSGlobalObject) bool {
        return cppFn("isIterable", .{
            this,
            globalObject,
        });
    }

    pub fn parseJSON(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return cppFn("parseJSON", .{
            this,
            globalObject,
        });
    }

    pub fn stringIncludes(this: JSValue, globalObject: *JSGlobalObject, other: JSValue) bool {
        return cppFn("stringIncludes", .{ this, globalObject, other });
    }

    pub inline fn asRef(this: JSValue) C_API.JSValueRef {
        return @as(C_API.JSValueRef, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(this)))));
    }

    pub inline fn c(this: C_API.JSValueRef) JSValue {
        return @as(JSValue, @enumFromInt(@as(JSValue.Type, @bitCast(@intFromPtr(this)))));
    }

    pub inline fn fromRef(this: C_API.JSValueRef) JSValue {
        return @as(JSValue, @enumFromInt(@as(JSValue.Type, @bitCast(@intFromPtr(this)))));
    }

    pub inline fn asObjectRef(this: JSValue) C_API.JSObjectRef {
        return @as(C_API.JSObjectRef, @ptrCast(this.asVoid()));
    }

    /// When the GC sees a JSValue referenced in the stack
    /// It knows not to free it
    /// This mimicks the implementation in JavaScriptCore's C++
    pub inline fn ensureStillAlive(this: JSValue) void {
        if (!this.isCell()) return;
        std.mem.doNotOptimizeAway(this.asEncoded().asPtr);
    }

    pub inline fn asNullableVoid(this: JSValue) ?*anyopaque {
        return @as(?*anyopaque, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(this)))));
    }

    pub inline fn asVoid(this: JSValue) *anyopaque {
        if (comptime bun.Environment.allow_assert) {
            if (@intFromEnum(this) == 0) {
                @panic("JSValue is null");
            }
        }
        return this.asNullableVoid().?;
    }

    pub const Extern = [_][]const u8{
        "_then",
        "asArrayBuffer_",
        "asBigIntCompare",
        "asCell",
        "asInternalPromise",
        "asNumber",
        "asPromise",
        "asString",
        "coerceToDouble",
        "coerceToInt32",
        "coerceToInt64",
        "createEmptyArray",
        "createEmptyObject",
        "createInternalPromise",
        "createObject2",
        "createRangeError",
        "createRopeString",
        "createStringArray",
        "createTypeError",
        "createUninitializedUint8Array",
        "deepEquals",
        "eqlCell",
        "eqlValue",
        "fastGetDirect_",
        "fastGet_",
        "forEach",
        "forEachProperty",
        "forEachPropertyOrdered",
        "fromEntries",
        "fromInt64NoTruncate",
        "fromUInt64NoTruncate",
        "getClassName",
        "getDirect",
        "getErrorsProperty",
        "getIfExists",
        "getIfPropertyExistsFromPath",
        "getIfPropertyExistsImpl",
        "getLengthIfPropertyExistsInternal",
        "getNameProperty",
        "getPropertyByPropertyName",
        "getPropertyNames",
        "getPrototype",
        "getStaticProperty",
        "getSymbolDescription",
        "getUnixTimestamp",
        "hasProperty",
        "hasOwnProperty",
        "isAggregateError",
        "isAnyError",
        "isAnyInt",
        "isBigInt",
        "isBigInt32",
        "isBoolean",
        "isCallable",
        "isClass",
        "isCustomGetterSetter",
        "isError",
        "isException",
        "isGetterSetter",
        "isHeapBigInt",
        "isInt32",
        "isInt32AsAnyInt",
        "isIterable",
        "isNumber",
        "isObject",
        "isPrimitive",
        "isSameValue",
        "isSymbol",
        "isTerminationException",
        "isUInt32AsAnyInt",
        "jsBoolean",
        "jsDoubleNumber",
        "jsNull",
        "jsNumberFromChar",
        "jsNumberFromDouble",
        "jsNumberFromInt64",
        "jsNumberFromU16",
        "jsTDZValue",
        "jsType",
        "jsUndefined",
        "jsonStringify",
        "keys",
        "values",
        "kind_",
        "parseJSON",
        "put",
        "putDirect",
        "putIndex",
        "push",
        "putRecord",
        "strictDeepEquals",
        "symbolFor",
        "symbolKeyFor",
        "toBoolean",
        "toBooleanSlow",
        "toError_",
        "toInt32",
        "toInt64",
        "toObject",
        "toPropertyKeyValue",
        "toString",
        "toStringOrNull",
        "toUInt64NoTruncate",
        "toWTFString",
        "toZigException",
        "toZigString",
        "toMatch",
        "isConstructor",
        "isInstanceOf",
        "stringIncludes",
        "deepMatch",
        "jestDeepEquals",
        "jestStrictDeepEquals",
        "jestDeepMatch",
    };

    // For any callback JSValue created in JS that you will not call *immediatly*, you must wrap it
    // in an AsyncContextFrame with this function. This allows AsyncLocalStorage to work by
    // snapshotting it's state and restoring it when called.
    // - If there is no current context, this returns the callback as-is.
    // - It is safe to run .call() on the resulting JSValue. This includes automatic unwrapping.
    // - Do not pass the callback as-is to JS; The wrapped object is NOT a function.
    // - If passed to C++, call it with AsyncContextFrame::call() instead of JSC::call()
    pub inline fn withAsyncContextIfNeeded(this: JSValue, global: *JSGlobalObject) JSValue {
        JSC.markBinding(@src());
        return AsyncContextFrame__withAsyncContextIfNeeded(global, this);
    }

    extern "c" fn Bun__JSValue__deserialize(global: *JSGlobalObject, data: [*]const u8, len: isize) JSValue;

    /// Deserializes a JSValue from a serialized buffer. Zig version of `import('bun:jsc').deserialize`
    pub inline fn deserialize(bytes: []const u8, global: *JSGlobalObject) JSValue {
        return Bun__JSValue__deserialize(global, bytes.ptr, @intCast(bytes.len));
    }

    extern fn Bun__serializeJSValue(global: *JSC.JSGlobalObject, value: JSValue) SerializedScriptValue.External;
    extern fn Bun__SerializedScriptSlice__free(*anyopaque) void;

    pub const SerializedScriptValue = struct {
        data: []const u8,
        handle: *anyopaque,

        const External = extern struct {
            bytes: ?[*]const u8,
            size: usize,
            handle: ?*anyopaque,
        };

        pub inline fn deinit(self: @This()) void {
            Bun__SerializedScriptSlice__free(self.handle);
        }
    };

    /// Throws a JS exception and returns null if the serialization fails, otherwise returns a SerializedScriptValue.
    /// Must be freed when you are done with the bytes.
    pub inline fn serialize(this: JSValue, global: *JSGlobalObject) ?SerializedScriptValue {
        const value = Bun__serializeJSValue(global, this);
        return if (value.bytes) |bytes|
            .{ .data = bytes[0..value.size], .handle = value.handle.? }
        else
            null;
    }

    extern fn Bun__ProxyObject__getInternalField(this: JSValue, field: ProxyInternalField) JSValue;

    const ProxyInternalField = enum(u32) {
        target = 0,
        handler = 1,
    };

    /// Asserts `this` is a proxy
    pub fn getProxyInternalField(this: JSValue, field: ProxyInternalField) JSValue {
        return Bun__ProxyObject__getInternalField(this, field);
    }

    extern fn JSC__JSValue__getClassInfoName(value: JSValue, out: *bun.String) bool;

    /// For native C++ classes extending JSCell, this retrieves s_info's name
    pub fn getClassInfoName(this: JSValue) ?bun.String {
        if (!this.isObject()) return null;
        var out: bun.String = bun.String.empty;
        if (!JSC__JSValue__getClassInfoName(this, &out)) return null;
        return out;
    }
};

extern "c" fn AsyncContextFrame__withAsyncContextIfNeeded(global: *JSGlobalObject, callback: JSValue) JSValue;

pub const Exception = extern struct {
    pub const shim = Shimmer("JSC", "Exception", @This());
    bytes: shim.Bytes,
    pub const Type = JSObject;
    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/Exception.h";
    pub const name = "JSC::Exception";
    pub const namespace = "JSC";

    pub const StackCaptureAction = enum(u8) {
        CaptureStack = 0,
        DoNotCaptureStack = 1,
    };

    pub fn create(globalObject: *JSGlobalObject, object: *JSObject, stack_capture: StackCaptureAction) *Exception {
        return cppFn(
            "create",
            .{ globalObject, object, @intFromEnum(stack_capture) },
        );
    }

    pub fn value(this: *Exception) JSValue {
        return cppFn(
            "value",
            .{this},
        );
    }

    pub fn getStackTrace(this: *Exception, trace: *ZigStackTrace) void {
        return cppFn(
            "getStackTrace",
            .{ this, trace },
        );
    }

    pub const Extern = [_][]const u8{ "create", "value", "getStackTrace" };
};

pub const VM = extern struct {
    pub const shim = Shimmer("JSC", "VM", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/VM.h";
    pub const name = "JSC::VM";
    pub const namespace = "JSC";

    pub const HeapType = enum(u8) {
        SmallHeap = 0,
        LargeHeap = 1,
    };

    pub fn create(heap_type: HeapType) *VM {
        return cppFn("create", .{@intFromEnum(heap_type)});
    }

    pub fn deinit(vm: *VM, global_object: *JSGlobalObject) void {
        return cppFn("deinit", .{ vm, global_object });
    }

    pub fn setControlFlowProfiler(vm: *VM, enabled: bool) void {
        return cppFn("setControlFlowProfiler", .{ vm, enabled });
    }

    pub fn isJITEnabled() bool {
        return cppFn("isJITEnabled", .{});
    }

    pub fn holdAPILock(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("holdAPILock", .{ this, ctx, callback });
    }

    pub fn deferGC(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("deferGC", .{ this, ctx, callback });
    }
    extern fn JSC__VM__reportExtraMemory(*VM, usize) void;
    pub fn reportExtraMemory(this: *VM, size: usize) void {
        JSC.markBinding(@src());
        JSC__VM__reportExtraMemory(this, size);
    }

    pub fn deleteAllCode(
        vm: *VM,
        global_object: *JSGlobalObject,
    ) void {
        return cppFn("deleteAllCode", .{ vm, global_object });
    }

    pub fn whenIdle(
        vm: *VM,
        callback: *const fn (...) callconv(.C) void,
    ) void {
        return cppFn("whenIdle", .{ vm, callback });
    }

    pub fn shrinkFootprint(
        vm: *VM,
    ) void {
        return cppFn("shrinkFootprint", .{
            vm,
        });
    }

    pub fn runGC(vm: *VM, sync: bool) JSValue {
        return cppFn("runGC", .{
            vm,
            sync,
        });
    }

    pub fn heapSize(vm: *VM) usize {
        return cppFn("heapSize", .{
            vm,
        });
    }

    pub fn collectAsync(vm: *VM) void {
        return cppFn("collectAsync", .{
            vm,
        });
    }

    pub fn setExecutionForbidden(vm: *VM, forbidden: bool) void {
        cppFn("setExecutionForbidden", .{ vm, forbidden });
    }

    pub fn setExecutionTimeLimit(vm: *VM, timeout: f64) void {
        return cppFn("setExecutionTimeLimit", .{ vm, timeout });
    }

    pub fn clearExecutionTimeLimit(vm: *VM) void {
        return cppFn("clearExecutionTimeLimit", .{vm});
    }

    pub fn executionForbidden(vm: *VM) bool {
        return cppFn("executionForbidden", .{
            vm,
        });
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    /// Fires NeedTermination Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedTermination(vm: *VM) void {
        cppFn("notifyNeedTermination", .{vm});
    }
    /// Fires NeedWatchdogCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedWatchdogCheck(vm: *VM) void {
        cppFn("notifyNeedWatchdogCheck", .{vm});
    }
    /// Fires NeedDebuggerBreak Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedDebuggerBreak(vm: *VM) void {
        cppFn("notifyNeedDebuggerBreak", .{vm});
    }
    /// Fires NeedShellTimeoutCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedShellTimeoutCheck(vm: *VM) void {
        cppFn("notifyNeedShellTimeoutCheck", .{vm});
    }

    pub fn isEntered(vm: *VM) bool {
        return cppFn("isEntered", .{
            vm,
        });
    }

    pub fn throwError(vm: *VM, global_object: *JSGlobalObject, value: JSValue) void {
        return cppFn("throwError", .{
            vm,
            global_object,
            value,
        });
    }

    pub fn releaseWeakRefs(vm: *VM) void {
        return cppFn("releaseWeakRefs", .{vm});
    }

    pub fn drainMicrotasks(
        vm: *VM,
    ) void {
        return cppFn("drainMicrotasks", .{
            vm,
        });
    }

    pub fn externalMemorySize(vm: *VM) usize {
        return cppFn("externalMemorySize", .{vm});
    }

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub fn blockBytesAllocated(vm: *VM) usize {
        return cppFn("blockBytesAllocated", .{vm});
    }

    pub const Extern = [_][]const u8{
        "setControlFlowProfiler",
        "collectAsync",
        "externalMemorySize",
        "blockBytesAllocated",
        "heapSize",
        "releaseWeakRefs",
        "throwError",
        "deferGC",
        "holdAPILock",
        "runGC",
        "generateHeapSnapshot",
        "isJITEnabled",
        "deleteAllCode",
        "create",
        "deinit",
        "setExecutionForbidden",
        "executionForbidden",
        "isEntered",
        "throwError",
        "drainMicrotasks",
        "whenIdle",
        "shrinkFootprint",
        "setExecutionTimeLimit",
        "clearExecutionTimeLimit",
        "notifyNeedTermination",
        "notifyNeedWatchdogCheck",
        "notifyNeedDebuggerBreak",
        "notifyNeedShellTimeoutCheck",
    };
};

pub const ThrowScope = extern struct {
    pub const shim = Shimmer("JSC", "ThrowScope", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/ThrowScope.h";
    pub const name = "JSC::ThrowScope";
    pub const namespace = "JSC";

    pub fn declare(
        vm: *VM,
        _: [*]u8,
        file: [*]u8,
        line: usize,
    ) ThrowScope {
        return cppFn("declare", .{ vm, file, line });
    }

    pub fn release(this: *ThrowScope) void {
        return cppFn("release", .{this});
    }

    pub fn exception(this: *ThrowScope) ?*Exception {
        return cppFn("exception", .{this});
    }

    pub fn clearException(this: *ThrowScope) void {
        return cppFn("clearException", .{this});
    }

    pub const Extern = [_][]const u8{
        "declare",
        "release",
        "exception",
        "clearException",
    };
};

pub const CatchScope = extern struct {
    pub const shim = Shimmer("JSC", "CatchScope", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/CatchScope.h";
    pub const name = "JSC::CatchScope";
    pub const namespace = "JSC";

    pub fn declare(
        vm: *VM,
        function_name: [*]u8,
        file: [*]u8,
        line: usize,
    ) CatchScope {
        return cppFn("declare", .{ vm, function_name, file, line });
    }

    pub fn exception(this: *CatchScope) ?*Exception {
        return cppFn("exception", .{this});
    }

    pub fn clearException(this: *CatchScope) void {
        return cppFn("clearException", .{this});
    }

    pub const Extern = [_][]const u8{
        "declare",
        "exception",
        "clearException",
    };
};

pub const CallFrame = opaque {
    /// The value is generated in `make sizegen`
    /// The value is 6.
    /// On ARM64_32, the value is something else but it really doesn't matter for our case
    /// However, I don't want this to subtly break amidst future upgrades to JavaScriptCore
    const alignment = Sizes.Bun_CallFrame__align;

    pub const name = "JSC::CallFrame";

    pub fn format(frame: *CallFrame, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        const args = frame.argumentsPtr()[0..frame.argumentsCount()];

        for (args[0..@min(args.len, 4)], 0..) |arg, i| {
            if (i != 0) {
                try writer.writeAll(", ");
            }
            switch (arg) {
                .zero => try writer.writeAll("<empty>"),
                .undefined => try writer.writeAll("undefined"),
                .null => try writer.writeAll("null"),
                .true => try writer.writeAll("true"),
                .false => try writer.writeAll("false"),
                else => {
                    if (arg.isNumber()) {
                        try writer.writeAll("number");
                    } else {
                        try writer.writeAll(@tagName(arg.jsType()));
                    }
                },
            }
        }

        if (args.len > 4) {
            try writer.print(", ... {d} more", .{args.len - 4});
        }
    }

    pub fn argumentsPtr(self: *const CallFrame) [*]const JSC.JSValue {
        return @as([*]align(alignment) const JSC.JSValue, @ptrCast(@alignCast(self))) + Sizes.Bun_CallFrame__firstArgument;
    }

    pub fn callee(self: *const CallFrame) JSC.JSValue {
        return (@as([*]align(alignment) const JSC.JSValue, @ptrCast(@alignCast(self))) + Sizes.Bun_CallFrame__callee)[0];
    }

    fn Arguments(comptime max: usize) type {
        return struct {
            ptr: [max]JSC.JSValue,
            len: usize,
            pub inline fn init(comptime i: usize, ptr: [*]const JSC.JSValue) @This() {
                var args: [max]JSC.JSValue = std.mem.zeroes([max]JSC.JSValue);
                args[0..comptime i].* = ptr[0..i].*;

                return @This(){
                    .ptr = args,
                    .len = i,
                };
            }

            pub inline fn slice(self: *const @This()) []const JSValue {
                return self.ptr[0..self.len];
            }
        };
    }

    pub fn arguments(self: *const CallFrame, comptime max: usize) Arguments(max) {
        const len = self.argumentsCount();
        const ptr = self.argumentsPtr();
        return switch (@as(u4, @min(len, max))) {
            0 => .{ .ptr = undefined, .len = 0 },
            inline 1...9 => |count| Arguments(max).init(comptime @min(count, max), ptr),
            else => unreachable,
        };
    }

    pub fn argument(self: *const CallFrame, comptime i: comptime_int) JSC.JSValue {
        return self.argumentsPtr()[i];
    }

    pub fn this(self: *const CallFrame) JSC.JSValue {
        return (@as([*]align(alignment) const JSC.JSValue, @ptrCast(@alignCast(self))) + Sizes.Bun_CallFrame__thisArgument)[0];
    }

    pub fn argumentsCount(self: *const CallFrame) usize {
        return @as(usize, @intCast((@as([*]align(alignment) const JSC.JSValue, @ptrCast(@alignCast(self))) + Sizes.Bun_CallFrame__argumentCountIncludingThis)[0].asInt32() - 1));
    }
};

// pub const WellKnownSymbols = extern struct {
//     pub const shim = Shimmer("JSC", "CommonIdentifiers", @This());

//
//

//     pub const include = "JavaScriptCore/CommonIdentifiers.h";
//     pub const name = "JSC::CommonIdentifiers";
//     pub const namespace = "JSC";

//     pub var hasthis: *const Identifier = shim.cppConst(Identifier, "hasInstance");
//     pub var isConcatSpreadable: Identifier = shim.cppConst(Identifier, "isConcatSpreadable");
//     pub var asyncIterator: Identifier = shim.cppConst(Identifier, "asyncIterator");
//     pub var iterator: Identifier = shim.cppConst(Identifier, "iterator");
//     pub var match: Identifier = shim.cppConst(Identifier, "match");
//     pub var matchAll: Identifier = shim.cppConst(Identifier, "matchAll");
//     pub var replace: Identifier = shim.cppConst(Identifier, "replace");
//     pub var search: Identifier = shim.cppConst(Identifier, "search");
//     pub var species: Identifier = shim.cppConst(Identifier, "species");
//     pub var split: Identifier = shim.cppConst(Identifier, "split");
//     pub var toPrimitive: Identifier = shim.cppConst(Identifier, "toPrimitive");
//     pub var toStringTag: Identifier = shim.cppConst(Identifier, "toStringTag");
//     pub var unscopable: Identifier = shim.cppConst(Identifier, "unscopabl");

// };

pub const EncodedJSValue = extern union {
    asInt64: i64,
    ptr: ?*JSCell,
    asBits: [8]u8,
    asPtr: ?*anyopaque,
    asDouble: f64,
};
pub const JSHostFunctionType = fn (*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
pub const JSHostFunctionTypeWithCCallConvForAssertions = fn (*JSGlobalObject, *CallFrame) callconv(.C) JSValue;
pub const JSHostFunctionPtr = *const JSHostFunctionType;
pub fn toJSHostFunction(comptime Function: anytype) JSC.JSHostFunctionType {
    if (comptime @TypeOf(Function) == JSHostFunctionType) {
        return Function;
    }

    if (@TypeOf(Function) == fn (*JSGlobalObject, *CallFrame) JSValue) {
        // These may coerce to both, but we want to force it to be this kind.
    } else if (@TypeOf(Function) == *const fn (*JSGlobalObject, *CallFrame) JSValue) {
        @compileLog(Function, "use JSC.toJSHostFunction(Function) instead of JSC.toJSHostFunction(&Function)");
    }

    return struct {
        pub fn function(
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(JSC.conv) JSC.JSValue {
            comptime {
                const Fn = @TypeOf(Function);
                var FnTypeInfo = @typeInfo(Fn);
                if (FnTypeInfo == .Pointer) {
                    FnTypeInfo = @typeInfo(std.meta.Child(Fn));
                }

                if (bun.Environment.isWindows) {
                    if (FnTypeInfo.Fn.calling_convention == .C) {
                        @compileLog(Function, "use callconv(JSC.conv) instead of callconv(.C), or don't set a callconv on the function.");
                    }
                }
            }

            return @call(.always_inline, Function, .{ globalThis, callframe });
        }
    }.function;
}

const DeinitFunction = *const fn (ctx: *anyopaque, buffer: [*]u8, len: usize) callconv(.C) void;

pub const JSArray = opaque {
    // TODO(@paperdave): this can throw
    extern fn JSArray__constructArray(*JSGlobalObject, [*]const JSValue, usize) JSValue;

    pub fn create(global: *JSGlobalObject, items: []const JSValue) JSValue {
        return JSArray__constructArray(global, items.ptr, items.len);
    }

    pub fn iterator(array: *JSArray, global: *JSGlobalObject) JSArrayIterator {
        return JSValue.fromCell(array).arrayIterator(global);
    }
};

const private = struct {
    pub extern fn Bun__CreateFFIFunctionWithDataValue(
        *JSGlobalObject,
        ?*const ZigString,
        argCount: u32,
        function: JSHostFunctionPtr,
        strong: bool,
        data: *anyopaque,
    ) JSValue;
    pub extern fn Bun__CreateFFIFunction(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: JSHostFunctionPtr,
        strong: bool,
    ) *anyopaque;

    pub extern fn Bun__CreateFFIFunctionValue(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: JSHostFunctionPtr,
        strong: bool,
        add_ptr_field: bool,
    ) JSValue;

    pub extern fn Bun__untrackFFIFunction(
        globalObject: *JSGlobalObject,
        function: JSValue,
    ) bool;

    pub extern fn Bun__FFIFunction_getDataPtr(JSValue) ?*anyopaque;
    pub extern fn Bun__FFIFunction_setDataPtr(JSValue, ?*anyopaque) void;
};

pub fn NewFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime functionPointer: anytype,
    strong: bool,
) JSValue {
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFunction(functionPointer), strong, false);
}

pub fn createCallback(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime functionPointer: anytype,
) JSValue {
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFunction(functionPointer), false, false);
}

pub fn NewRuntimeFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    functionPointer: JSHostFunctionPtr,
    strong: bool,
    add_ptr_property: bool,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionValue(globalObject, symbolName, argCount, functionPointer, strong, add_ptr_property);
}

pub fn getFunctionData(function: JSValue) ?*anyopaque {
    JSC.markBinding(@src());
    return private.Bun__FFIFunction_getDataPtr(function);
}

pub fn setFunctionData(function: JSValue, value: ?*anyopaque) void {
    JSC.markBinding(@src());
    return private.Bun__FFIFunction_setDataPtr(function, value);
}

pub fn NewFunctionWithData(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime functionPointer: anytype,
    strong: bool,
    data: *anyopaque,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionWithDataValue(
        globalObject,
        symbolName,
        argCount,
        toJSHostFunction(functionPointer),
        strong,
        data,
    );
}

pub fn untrackFunction(
    globalObject: *JSGlobalObject,
    value: JSValue,
) bool {
    JSC.markBinding(@src());
    return private.Bun__untrackFFIFunction(globalObject, value);
}

pub const URL = opaque {
    extern fn URL__fromJS(JSValue, *JSC.JSGlobalObject) ?*URL;
    extern fn URL__fromString(*bun.String) ?*URL;
    extern fn URL__protocol(*URL) String;
    extern fn URL__href(*URL) String;
    extern fn URL__username(*URL) String;
    extern fn URL__password(*URL) String;
    extern fn URL__search(*URL) String;
    extern fn URL__host(*URL) String;
    extern fn URL__hostname(*URL) String;
    extern fn URL__port(*URL) String;
    extern fn URL__deinit(*URL) void;
    extern fn URL__pathname(*URL) String;
    extern fn URL__getHrefFromJS(JSValue, *JSC.JSGlobalObject) String;
    extern fn URL__getHref(*String) String;
    extern fn URL__getFileURLString(*String) String;
    extern fn URL__getHrefJoin(*String, *String) String;
    extern fn URL__pathFromFileURL(*String) String;

    pub fn hrefFromString(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__getHref(&input);
    }

    pub fn join(base: bun.String, relative: bun.String) String {
        JSC.markBinding(@src());
        var base_str = base;
        var relative_str = relative;
        return URL__getHrefJoin(&base_str, &relative_str);
    }

    pub fn fileURLFromString(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__getFileURLString(&input);
    }

    pub fn pathFromFileURL(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__pathFromFileURL(&input);
    }

    /// This percent-encodes the URL, punycode-encodes the hostname, and returns the result
    /// If it fails, the tag is marked Dead
    pub fn hrefFromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) String {
        JSC.markBinding(@src());
        return URL__getHrefFromJS(value, globalObject);
    }

    pub fn fromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) ?*URL {
        JSC.markBinding(@src());
        return URL__fromJS(value, globalObject);
    }

    pub fn fromUTF8(input: []const u8) ?*URL {
        return fromString(String.fromUTF8(input));
    }
    pub fn fromString(str: bun.String) ?*URL {
        JSC.markBinding(@src());
        var input = str;
        return URL__fromString(&input);
    }
    pub fn protocol(url: *URL) String {
        JSC.markBinding(@src());
        return URL__protocol(url);
    }
    pub fn href(url: *URL) String {
        JSC.markBinding(@src());
        return URL__href(url);
    }
    pub fn username(url: *URL) String {
        JSC.markBinding(@src());
        return URL__username(url);
    }
    pub fn password(url: *URL) String {
        JSC.markBinding(@src());
        return URL__password(url);
    }
    pub fn search(url: *URL) String {
        JSC.markBinding(@src());
        return URL__search(url);
    }
    pub fn host(url: *URL) String {
        JSC.markBinding(@src());
        return URL__host(url);
    }
    pub fn hostname(url: *URL) String {
        JSC.markBinding(@src());
        return URL__hostname(url);
    }
    pub fn port(url: *URL) String {
        JSC.markBinding(@src());
        return URL__port(url);
    }
    pub fn deinit(url: *URL) void {
        JSC.markBinding(@src());
        return URL__deinit(url);
    }
    pub fn pathname(url: *URL) String {
        JSC.markBinding(@src());
        return URL__pathname(url);
    }
};

pub const URLSearchParams = opaque {
    extern fn URLSearchParams__create(globalObject: *JSGlobalObject, *const ZigString) JSValue;
    pub fn create(globalObject: *JSGlobalObject, init: ZigString) JSValue {
        JSC.markBinding(@src());
        return URLSearchParams__create(globalObject, &init);
    }

    extern fn URLSearchParams__fromJS(JSValue) ?*URLSearchParams;
    pub fn fromJS(value: JSValue) ?*URLSearchParams {
        JSC.markBinding(@src());
        return URLSearchParams__fromJS(value);
    }

    extern fn URLSearchParams__toString(
        self: *URLSearchParams,
        ctx: *anyopaque,
        callback: *const fn (ctx: *anyopaque, str: *const ZigString) callconv(.C) void,
    ) void;

    pub fn toString(
        self: *URLSearchParams,
        comptime Ctx: type,
        ctx: *Ctx,
        comptime callback: *const fn (ctx: *Ctx, str: ZigString) void,
    ) void {
        JSC.markBinding(@src());
        const Wrap = struct {
            const cb_ = callback;
            pub fn cb(c: *anyopaque, str: *const ZigString) callconv(.C) void {
                cb_(
                    bun.cast(*Ctx, c),
                    str.*,
                );
            }
        };

        URLSearchParams__toString(self, ctx, Wrap.cb);
    }
};

pub const WTF = struct {
    extern fn WTF__copyLCharsFromUCharSource(dest: [*]u8, source: *const anyopaque, len: usize) void;
    extern fn WTF__parseDouble(bytes: [*]const u8, length: usize, counted: *usize) f64;

    pub fn parseDouble(buf: []const u8) !f64 {
        JSC.markBinding(@src());

        if (buf.len == 0)
            return error.InvalidCharacter;

        var count: usize = 0;
        const res = WTF__parseDouble(buf.ptr, buf.len, &count);

        if (count == 0)
            return error.InvalidCharacter;
        return res;
    }

    /// This uses SSE2 instructions and/or ARM NEON to copy 16-bit characters efficiently
    /// See wtf/Text/ASCIIFastPath.h for details
    pub fn copyLCharsFromUCharSource(destination: [*]u8, comptime Source: type, source: Source) void {
        JSC.markBinding(@src());

        // This is any alignment
        WTF__copyLCharsFromUCharSource(destination, source.ptr, source.len);
    }
};

pub usingnamespace @import("./JSPropertyIterator.zig");

// DOMCall Fields
const Bun = JSC.API.Bun;
pub const __DOMCall_ptr = Bun.FFIObject.dom_call;
pub const __DOMCall__reader_u8 = Bun.FFIObject.Reader.DOMCalls.u8;
pub const __DOMCall__reader_u16 = Bun.FFIObject.Reader.DOMCalls.u16;
pub const __DOMCall__reader_u32 = Bun.FFIObject.Reader.DOMCalls.u32;
pub const __DOMCall__reader_ptr = Bun.FFIObject.Reader.DOMCalls.ptr;
pub const __DOMCall__reader_i8 = Bun.FFIObject.Reader.DOMCalls.i8;
pub const __DOMCall__reader_i16 = Bun.FFIObject.Reader.DOMCalls.i16;
pub const __DOMCall__reader_i32 = Bun.FFIObject.Reader.DOMCalls.i32;
pub const __DOMCall__reader_f32 = Bun.FFIObject.Reader.DOMCalls.f32;
pub const __DOMCall__reader_f64 = Bun.FFIObject.Reader.DOMCalls.f64;
pub const __DOMCall__reader_i64 = Bun.FFIObject.Reader.DOMCalls.i64;
pub const __DOMCall__reader_u64 = Bun.FFIObject.Reader.DOMCalls.u64;
pub const __DOMCall__reader_intptr = Bun.FFIObject.Reader.DOMCalls.intptr;
pub const DOMCalls = &.{
    .{ .ptr = Bun.FFIObject.dom_call },
    Bun.FFIObject.Reader.DOMCalls,
};

extern "c" fn JSCInitialize(env: [*]const [*:0]u8, count: usize, cb: *const fn ([*]const u8, len: usize) callconv(.C) void) void;
pub fn initialize() void {
    JSC.markBinding(@src());
    bun.analytics.Features.jsc += 1;
    JSCInitialize(
        std.os.environ.ptr,
        std.os.environ.len,
        struct {
            pub fn callback(name: [*]const u8, len: usize) callconv(.C) void {
                Output.prettyErrorln(
                    \\<r><red>error<r><d>:<r> invalid JSC environment variable
                    \\
                    \\    <b>{s}<r>
                    \\
                    \\For a list of options, see this file:
                    \\
                    \\    https://github.com/oven-sh/webkit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h
                    \\
                    \\Environment variables must be prefixed with "BUN_JSC_". This code runs before .env files are loaded, so those won't work here.
                    \\
                    \\Warning: options change between releases of Bun and WebKit without notice. This is not a stable API, you should not rely on it beyond debugging something, and it may be removed entirely in a future version of Bun.
                ,
                    .{name[0..len]},
                );
                bun.Global.exit(1);
            }
        }.callback,
    );
}

pub const ScriptExecutionStatus = enum(i32) {
    running = 0,
    suspended = 1,
    stopped = 2,
};

comptime {
    // this file is gennerated, but cant be placed in the build/codegen folder
    // because zig will complain about outside-of-module stuff
    _ = @import("./GeneratedJS2Native.zig");
}
