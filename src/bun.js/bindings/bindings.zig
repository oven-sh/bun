const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const hasRef = std.meta.trait.hasField("ref");
const C_API = @import("bun").JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = @import("bun").JSC;
const Shimmer = JSC.Shimmer;
const FFI = @import("./FFI.zig");
const NullableAllocator = @import("../../nullable_allocator.zig").NullableAllocator;

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

    const InitializeCallback = fn (ctx: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void;
    pub fn create(global_object: *JSGlobalObject, length: usize, ctx: *anyopaque, initializer: InitializeCallback) JSValue {
        return cppFn("create", .{
            global_object,
            length,
            ctx,
            initializer,
        });
    }

    pub fn Initializer(comptime Ctx: type, comptime func: fn (*Ctx, obj: *JSObject, global: *JSGlobalObject) void) type {
        return struct {
            pub fn call(this: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void {
                @call(.{ .modifier = .always_inline }, func, .{ @ptrCast(*Ctx, @alignCast(@alignOf(*Ctx), this.?)), obj.?, global.? });
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

pub const ZigString = extern struct {
    // TODO: align this to align(2)
    // That would improve perf a bit
    ptr: [*]const u8,
    len: usize,

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

    pub fn substring(this: ZigString, offset: usize) ZigString {
        if (this.is16Bit()) {
            return ZigString.from16Slice(this.utf16SliceAligned()[@minimum(this.len, offset)..]);
        }

        var out = ZigString.init(this.slice()[@minimum(this.len, offset)..]);
        if (this.isUTF8()) {
            out.markUTF8();
        }

        if (this.isGloballyAllocated()) {
            out.mark();
        }

        return out;
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

    /// Count the number of code points in the string.
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
        return .{ .ptr = this.ptr, .len = @minimum(len, this.len) };
    }

    pub fn eqlComptime(this: ZigString, comptime other: []const u8) bool {
        if (this.len != other.len)
            return false;

        if (this.is16Bit()) {
            return strings.eqlComptimeUTF16(this.utf16SliceAligned(), other);
        }

        if (comptime strings.isAllASCIISimple(other)) {
            return strings.eqlComptimeIgnoreLen(this.slice(), other);
        }

        @compileError("Not implemented yet for latin1");
    }

    pub const shim = Shimmer("", "ZigString", @This());

    pub const Slice = struct {
        allocator: NullableAllocator = .{},
        ptr: [*]const u8 = undefined,
        len: u32 = 0,

        pub fn fromUTF8NeverFree(input: []const u8) Slice {
            return .{
                .ptr = input.ptr,
                .len = @truncate(u32, input.len),
                .allocator = .{},
            };
        }

        pub const empty = Slice{ .ptr = undefined, .len = 0 };

        pub inline fn isAllocated(this: Slice) bool {
            return !this.allocator.isNull();
        }

        pub fn clone(this: Slice, allocator: std.mem.Allocator) !Slice {
            if (this.isAllocated()) {
                return Slice{ .allocator = this.allocator, .ptr = this.ptr, .len = this.len };
            }

            var duped = try allocator.dupe(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn cloneIfNeeded(this: Slice, allocator: std.mem.Allocator) !Slice {
            if (this.isAllocated()) {
                return this;
            }

            var duped = try allocator.dupe(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn cloneWithTrailingSlash(this: Slice, allocator: std.mem.Allocator) !Slice {
            var buf = try strings.cloneNormalizingSeparators(allocator, this.slice());
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = buf.ptr, .len = @truncate(u32, buf.len) };
        }

        pub fn cloneZ(this: Slice, allocator: std.mem.Allocator) !Slice {
            if (this.isAllocated() or this.len == 0) {
                return this;
            }

            var duped = try allocator.dupeZ(u8, this.ptr[0..this.len]);
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = duped.ptr, .len = this.len };
        }

        pub fn slice(this: Slice) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn sliceZ(this: Slice) [:0]const u8 {
            return std.meta.assumeSentinel(this.ptr[0..this.len], 0);
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

            std.mem.copy(u8, buf[0..this.len], this.slice());
            buf[this.len] = 0;
            return std.meta.assumeSentinel(buf[0..this.len], 0);
        }

        pub fn mut(this: Slice) []u8 {
            return @intToPtr([*]u8, @ptrToInt(this.ptr))[0..this.len];
        }

        /// Does nothing if the slice is not allocated
        pub fn deinit(this: *const Slice) void {
            if (this.allocator.get()) |allocator| {
                allocator.free(this.slice());
            }
        }
    };

    pub const name = "ZigString";
    pub const namespace = "";

    pub inline fn is16Bit(this: *const ZigString) bool {
        return (@ptrToInt(this.ptr) & (1 << 63)) != 0;
    }

    pub inline fn utf16Slice(this: *const ZigString) []align(1) const u16 {
        return @ptrCast([*]align(1) const u16, untagged(this.ptr))[0..this.len];
    }

    pub inline fn utf16SliceAligned(this: *const ZigString) []const u16 {
        return @ptrCast([*]const u16, @alignCast(@alignOf(u16), untagged(this.ptr)))[0..this.len];
    }

    pub inline fn isEmpty(this: *const ZigString) bool {
        return this.len == 0;
    }

    pub fn fromStringPointer(ptr: StringPointer, buf: string, to: *ZigString) void {
        to.* = ZigString{
            .len = ptr.length,
            .ptr = buf[ptr.offset..][0..ptr.length].ptr,
        };
    }

    pub fn sortDesc(slice_: []ZigString) void {
        std.sort.sort(ZigString, slice_, {}, cmpDesc);
    }

    pub fn cmpDesc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsDesc(void{}, a.slice(), b.slice());
    }

    pub fn sortAsc(slice_: []ZigString) void {
        std.sort.sort(ZigString, slice_, {}, cmpAsc);
    }

    pub fn cmpAsc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsAsc(void{}, a.slice(), b.slice());
    }

    pub fn init(slice_: []const u8) ZigString {
        return ZigString{ .ptr = slice_.ptr, .len = slice_.len };
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
            pub const value = ZigString{ .ptr = slice_.ptr, .len = slice_.len };
        };

        return &Holder.value;
    }

    pub fn toAtomicValue(this: *const ZigString, globalThis: *JSC.JSGlobalObject) JSValue {
        return shim.cppFn("toAtomicValue", .{ this, globalThis });
    }

    pub fn init16(slice_: []const u16) ZigString {
        var out = ZigString{ .ptr = std.mem.sliceAsBytes(slice_).ptr, .len = slice_.len };
        out.markUTF16();
        return out;
    }

    pub fn from(slice_: JSC.C.JSValueRef, ctx: JSC.C.JSContextRef) ZigString {
        return JSC.JSValue.fromRef(slice_).getZigString(ctx.ptr());
    }

    pub fn from16Slice(slice_: []const u16) ZigString {
        return from16(slice_.ptr, slice_.len);
    }

    /// Globally-allocated memory only
    pub fn from16(slice_: [*]const u16, len: usize) ZigString {
        var str = init(@ptrCast([*]const u8, slice_)[0..len]);
        str.markUTF16();
        str.mark();
        str.assertGlobal();
        return str;
    }

    pub fn toBase64DataURL(this: ZigString, allocator: std.mem.Allocator) ![]const u8 {
        const slice_ = this.slice();
        const size = std.base64.standard.Encoder.calcSize(slice_.len);
        var buf = try allocator.alloc(u8, size + "data:;base64,".len);
        var encoded = std.base64.url_safe.Encoder.encode(buf["data:;base64,".len..], slice_);
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
        return (@ptrToInt(this.ptr) & (1 << 61)) != 0;
    }

    pub fn markUTF8(this: *ZigString) void {
        this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 61));
    }

    pub fn markUTF16(this: *ZigString) void {
        this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 63));
    }

    pub fn setOutputEncoding(this: *ZigString) void {
        if (!this.is16Bit()) this.detectEncoding();
        if (this.is16Bit()) this.markUTF8();
    }

    pub inline fn isGloballyAllocated(this: ZigString) bool {
        return (@ptrToInt(this.ptr) & (1 << 62)) != 0;
    }

    pub inline fn deinitGlobal(this: ZigString) void {
        bun.default_allocator.free(this.slice());
    }

    pub inline fn mark(this: *ZigString) void {
        this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 62));
    }

    pub fn format(self: ZigString, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (self.isUTF8()) {
            try writer.writeAll(self.slice());
            return;
        }

        if (self.is16Bit()) {
            try strings.formatUTF16(self.utf16Slice(), writer);
            return;
        }

        try strings.formatLatin1(self.slice(), writer);
    }

    pub inline fn toRef(slice_: []const u8, global: *JSGlobalObject) C_API.JSValueRef {
        return init(slice_).toValue(global).asRef();
    }

    pub const Empty = ZigString{ .ptr = "", .len = 0 };

    inline fn untagged(ptr: [*]const u8) [*]const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        @setRuntimeSafety(false);
        return @intToPtr([*]const u8, @truncate(u53, @ptrToInt(ptr)));
    }

    pub fn slice(this: *const ZigString) []const u8 {
        return untagged(this.ptr)[0..@minimum(this.len, std.math.maxInt(u32))];
    }

    pub fn dupe(this: ZigString, allocator: std.mem.Allocator) ![]const u8 {
        return try allocator.dupe(u8, this.slice());
    }

    pub fn toSliceFast(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            var buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .ptr = buffer.ptr,
                .len = @truncate(u32, buffer.len),
                .allocator = NullableAllocator.init(allocator),
            };
        }

        return Slice{
            .ptr = untagged(this.ptr),
            .len = @truncate(u32, this.len),
        };
    }

    /// This function checks if the input is latin1 non-ascii
    /// It is slow but safer when the input is from JavaScript
    pub fn toSlice(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            var buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @truncate(u32, buffer.len),
            };
        }

        if (!this.isUTF8() and !strings.isAllASCII(untagged(this.ptr)[0..this.len])) {
            var buffer = this.toOwnedSlice(allocator) catch unreachable;
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @truncate(u32, buffer.len),
            };
        }

        return Slice{
            .ptr = untagged(this.ptr),
            .len = @truncate(u32, this.len),
        };
    }

    pub fn toSliceZ(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;

        if (is16Bit(&this)) {
            var buffer = this.toOwnedSliceZ(allocator) catch unreachable;
            return Slice{
                .ptr = buffer.ptr,
                .len = @truncate(u32, buffer.len),
                .allocator = NullableAllocator.init(allocator),
            };
        }

        return Slice{
            .ptr = untagged(this.ptr),
            .len = @truncate(u32, this.len),
        };
    }

    pub fn sliceZBuf(this: ZigString, buf: *[bun.MAX_PATH_BYTES]u8) ![:0]const u8 {
        return try std.fmt.bufPrintZ(buf, "{}", .{this});
    }

    pub inline fn full(this: *const ZigString) []const u8 {
        return untagged(this.ptr)[0..this.len];
    }

    pub fn trimmedSlice(this: *const ZigString) []const u8 {
        return strings.trim(this.full(), " \r\n");
    }

    pub fn toValueAuto(this: *const ZigString, global: *JSGlobalObject) JSValue {
        if (!this.is16Bit()) {
            return this.toValue(global);
        } else {
            return this.to16BitValue(global);
        }
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
            std.debug.assert(bun.Mimalloc.mi_is_in_heap_region(untagged(this.ptr)) or bun.Mimalloc.mi_check_owned(untagged(this.ptr)));
        }
    }

    pub fn toValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        this.assertGlobalIfNeeded();
        return shim.cppFn("toValue", .{ this, global });
    }

    pub fn toExternalValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        return shim.cppFn("toExternalValue", .{ this, global });
    }

    pub fn toExternalValueWithCallback(
        this: *const ZigString,
        global: *JSGlobalObject,
        callback: fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.C) void,
    ) JSValue {
        return shim.cppFn("toExternalValueWithCallback", .{ this, global, callback });
    }

    pub fn external(
        this: *const ZigString,
        global: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.C) void,
    ) JSValue {
        return shim.cppFn("external", .{ this, global, ctx, callback });
    }

    pub fn to16BitValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        return shim.cppFn("to16BitValue", .{ this, global });
    }

    pub fn toValueGC(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toValueGC", .{ this, global });
    }

    pub fn withEncoding(this: *const ZigString) ZigString {
        var out = this.*;
        out.setOutputEncoding();
        return out;
    }

    pub fn toJSStringRef(this: *const ZigString) C_API.JSStringRef {
        if (comptime @hasDecl(@import("bun"), "bindgen")) {
            return undefined;
        }

        return if (this.is16Bit())
            C_API.JSStringCreateWithCharactersNoCopy(@ptrCast([*]const u16, @alignCast(@alignOf([*]const u16), untagged(this.ptr))), this.len)
        else
            C_API.JSStringCreateStatic(untagged(this.ptr), this.len);
    }

    pub fn toErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toErrorInstance", .{ this, global });
    }

    pub const Extern = [_][]const u8{ "toAtomicValue", "toValue", "toExternalValue", "to16BitValue", "toValueGC", "toErrorInstance", "toExternalU16", "toExternalValueWithCallback", "external" };
};

pub const DOMURL = opaque {
    pub const shim = Shimmer("WebCore", "DOMURL", @This());

    const cppFn = shim.cppFn;
    pub const name = "WebCore::DOMURL";

    pub fn cast_(value: JSValue, vm: *VM) ?*DOMURL {
        return shim.cppFn("cast_", .{ value, vm });
    }

    pub fn cast(value: JSValue) ?*DOMURL {
        return cast_(value, JSC.VirtualMachine.vm.global.vm());
    }

    pub fn href_(this: *DOMURL, out: *ZigString) void {
        return shim.cppFn("href_", .{ this, out });
    }

    pub fn href(this: *DOMURL) ZigString {
        var out = ZigString.Empty;
        this.href_(&out);
        return out;
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
    };
};

const Api = @import("../../api/schema.zig").Api;

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

    pub fn putDefault(this: *FetchHeaders, name_: []const u8, value: []const u8) void {
        if (this.has(&ZigString.init(name_))) {
            return;
        }

        this.put_(&ZigString.init(name_), &ZigString.init(value));
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
    ) void {
        return shim.cppFn("append", .{
            this,
            name_,
            value,
        });
    }

    pub fn put_(
        this: *FetchHeaders,
        name_: *const ZigString,
        value: *const ZigString,
    ) void {
        return shim.cppFn("put_", .{
            this,
            name_,
            value,
        });
    }

    pub fn put(
        this: *FetchHeaders,
        name_: []const u8,
        value: []const u8,
    ) void {
        this.put_(&ZigString.init(name_), &ZigString.init(value));
    }

    pub fn get_(
        this: *FetchHeaders,
        name_: *const ZigString,
        out: *ZigString,
    ) void {
        shim.cppFn("get_", .{
            this,
            name_,
            out,
        });
    }

    pub fn get(
        this: *FetchHeaders,
        name_: []const u8,
    ) ?[]const u8 {
        var out = ZigString.Empty;
        get_(this, &ZigString.init(name_), &out);
        if (out.len > 0) {
            return out.slice();
        }

        return null;
    }

    pub fn has(
        this: *FetchHeaders,
        name_: *const ZigString,
    ) bool {
        return shim.cppFn("has", .{
            this,
            name_,
        });
    }

    pub fn fastHas(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) bool {
        return fastHas_(this, @enumToInt(name_));
    }

    pub fn fastGet(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) ?ZigString {
        var str = ZigString.init("");
        fastGet_(this, @enumToInt(name_), &str);
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
        return fastRemove_(this, @enumToInt(header));
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
    ) void {
        return shim.cppFn("remove", .{
            this,
            name_,
        });
    }

    pub fn cast_(value: JSValue, vm: *VM) ?*FetchHeaders {
        return shim.cppFn("cast_", .{ value, vm });
    }

    pub fn cast(value: JSValue) ?*FetchHeaders {
        return cast_(value, JSC.VirtualMachine.vm.global.vm());
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
    ) ?*FetchHeaders {
        return shim.cppFn("cloneThis", .{
            this,
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
        names: [*c]Api.StringPointer,
        values: [*c]Api.StringPointer,
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
    };
};

pub const SystemError = extern struct {
    errno: c_int = 0,
    /// label for errno
    code: ZigString = ZigString.init(""),
    message: ZigString = ZigString.init(""),
    path: ZigString = ZigString.init(""),
    syscall: ZigString = ZigString.init(""),
    fd: i32 = -1,

    pub fn Maybe(comptime Result: type) type {
        return union(enum) {
            err: SystemError,
            result: Result,
        };
    }

    pub const shim = Shimmer("", "SystemError", @This());

    pub const name = "SystemError";
    pub const namespace = "";

    pub fn toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toErrorInstance", .{ this, global });
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
        return @intToPtr(*[*]u8, @ptrToInt(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector).*;
    }

    pub fn len(this: *JSUint8Array) usize {
        return @intToPtr(*usize, @ptrToInt(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayLength).*;
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

    pub fn toSlice(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSlice(allocator);
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

    pub const JStringIteratorAppend8Callback = fn (*Iterator, [*]const u8, u32) callconv(.C) void;
    pub const JStringIteratorAppend16Callback = fn (*Iterator, [*]const u16, u32) callconv(.C) void;
    pub const JStringIteratorWrite8Callback = fn (*Iterator, [*]const u8, u32, u32) callconv(.C) void;
    pub const JStringIteratorWrite16Callback = fn (*Iterator, [*]const u16, u32, u32) callconv(.C) void;
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

pub const JSPromiseRejectionOperation = enum(u32) {
    Reject = 0,
    Handle = 1,
};

pub fn NewGlobalObject(comptime Type: type) type {
    return struct {
        const importNotImpl = "Import not implemented";
        const resolveNotImpl = "resolve not implemented";
        const moduleNotImpl = "Module fetch not implemented";
        pub fn import(global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) ErrorableZigString {
            if (comptime @hasDecl(Type, "import")) {
                return @call(.{ .modifier = .always_inline }, Type.import, .{ global, specifier.*, source.* });
            }
            return ErrorableZigString.err(error.ImportFailed, ZigString.init(importNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
            if (comptime @hasDecl(Type, "resolve")) {
                @call(.{ .modifier = .always_inline }, Type.resolve, .{ res, global, specifier.*, source.* });
                return;
            }
            res.* = ErrorableZigString.err(error.ResolveFailed, ZigString.init(resolveNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
            if (comptime @hasDecl(Type, "fetch")) {
                @call(.{ .modifier = .always_inline }, Type.fetch, .{ ret, global, specifier.*, source.* });
                return;
            }
            ret.* = ErrorableResolvedSource.err(error.FetchFailed, ZigString.init(moduleNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "promiseRejectionTracker")) {
                return @call(.{ .modifier = .always_inline }, Type.promiseRejectionTracker, .{ global, promise, rejection });
            }
            return JSValue.jsUndefined();
        }

        pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "reportUncaughtException")) {
                return @call(.{ .modifier = .always_inline }, Type.reportUncaughtException, .{ global, exception });
            }
            return JSValue.jsUndefined();
        }

        pub fn onCrash() callconv(.C) void {
            if (comptime @hasDecl(Type, "onCrash")) {
                return @call(.{ .modifier = .always_inline }, Type.onCrash, .{});
            }

            Output.flush();
            const Reporter = @import("../../report.zig");
            Reporter.fatal(null, "A C++ exception occurred");
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

    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: *const ZigString) *JSInternalPromise {
        return shim.cppFn("loadAndEvaluateModule", .{
            globalObject,
            module_name,
        });
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
            return CallbackFunction(@ptrCast(*Type, @alignCast(@alignOf(*Type), ctx.?)), globalThis, arguments[0..arguments_len]) catch |err| brk: {
                break :brk ZigString.init(std.mem.span(@errorName(err))).toErrorInstance(globalThis);
            };
        }
    }.callback;
}

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

    pub const Strong = struct {
        strong: JSC.Strong = .{},

        pub fn init(globalThis: *JSC.JSGlobalObject) Strong {
            return Strong{
                .strong = JSC.Strong.create(globalThis, JSC.JSPromise.create(globalThis).asValue(globalThis)),
            };
        }

        pub fn get(this: *Strong) *JSC.JSPromise {
            return this.strong.get().?.asPromise().?;
        }

        pub fn value(this: *Strong) JSValue {
            return this.strong.get().?;
        }

        pub fn swap(this: *Strong) *JSC.JSPromise {
            var prom = this.strong.swap().asPromise().?;
            this.strong.deinit();
            return prom;
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

        if (value.isAnyError(globalObject)) {
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

    pub fn rejectWithCaughtException(this: *JSPromise, globalObject: *JSGlobalObject, scope: ThrowScope) void {
        return cppFn("rejectWithCaughtException", .{ this, globalObject, scope });
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("resolvedPromise", .{ globalThis, value });
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
        cppFn("resolve", .{ this, globalThis, value });
    }
    pub fn reject(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
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
        "rejectWithCaughtException",
        "status",
        "result",
        "isHandled",
        "resolvedPromise",
        "rejectedPromise",
        "resolve",
        "reject",
        "rejectAsHandled",
        // "rejectException",
        "rejectAsHandledException",
        "rejectedPromiseValue",
        "resolvedPromiseValue",
        "asValue",
        "create",
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

    pub fn rejectWithCaughtException(this: *JSInternalPromise, globalObject: *JSGlobalObject, scope: ThrowScope) void {
        return cppFn("rejectWithCaughtException", .{ this, globalObject, scope });
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
    // pub const PromiseCallbackPrimitive = fn (
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

    pub const Extern = [_][]const u8{
        "create",
        // "then_",
        "rejectWithCaughtException",
        "status",
        "result",
        "isHandled",
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

    // pub fn createFromSourceCode(
    //     global: *JSGlobalObject,
    //     function_name: ?[*]const u8,
    //     function_name_len: u16,
    //     args: ?[*]JSValue,
    //     args_len: u16,
    //     source: *const SourceCode,
    //     origin: *SourceOrigin,
    //     exception: *?*JSObject,
    // ) *JSFunction {
    //     return cppFn("createFromSourceCode", .{
    //         global,
    //         function_name,
    //         function_name_len,
    //         args,
    //         args_len,
    //         source,
    //         origin,
    //         exception,
    //     });
    // }

    pub fn optimizeSoon(value: JSValue) void {
        cppFn("optimizeSoon", .{value});
    }
    // pub fn toString(this: *JSFunction, globalThis: *JSGlobalObject) *const JSString {
    //     return cppFn("toString", .{ this, globalThis });
    // }

    pub const Extern = [_][]const u8{
        "fromString",
        // "createFromSourceCode",

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

    pub fn throwInvalidArguments(
        this: *JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) void {
        var err = JSC.toInvalidArguments(fmt, args, this);
        this.vm().throwError(this, err);
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
    extern fn Bun__runOnLoadPlugins(*JSC.JSGlobalObject, ?*const ZigString, *const ZigString, BunPluginTarget) JSValue;
    extern fn Bun__runOnResolvePlugins(*JSC.JSGlobalObject, ?*const ZigString, *const ZigString, *const ZigString, BunPluginTarget) JSValue;

    pub fn runOnLoadPlugins(this: *JSGlobalObject, namespace_: ZigString, path: ZigString, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());
        const result = Bun__runOnLoadPlugins(this, if (namespace_.len > 0) &namespace_ else null, &path, target);
        if (result.isEmptyOrUndefinedOrNull()) {
            return null;
        }

        return result;
    }

    pub fn runOnResolvePlugins(this: *JSGlobalObject, namespace_: ZigString, path: ZigString, source: ZigString, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());

        const result = Bun__runOnResolvePlugins(this, if (namespace_.len > 0) &namespace_ else null, &path, &source, target);
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
        inline for (comptime names) |export_name, i| {
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
            return ZigString.static(fmt).toErrorInstance(this);
        }
    }

    pub fn createRangeError(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        const err = createErrorInstance(this, fmt, args);
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(JSC.Node.ErrorCode.ERR_OUT_OF_RANGE)).toValue(this));
        return err;
    }

    pub fn createInvalidArgs(this: *JSGlobalObject, comptime fmt: string, args: anytype) JSValue {
        const err = createErrorInstance(this, fmt, args);
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE)).toValue(this));
        return err;
    }

    pub fn throw(
        this: *JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) void {
        this.vm().throwError(this, this.createErrorInstance(fmt, args));
    }

    pub fn throwValue(
        this: *JSGlobalObject,
        value: JSC.JSValue,
    ) void {
        this.vm().throwError(this, value);
    }

    pub fn throwError(
        this: *JSGlobalObject,
        err: anyerror,
        comptime fmt: string,
    ) void {
        var str = ZigString.init(std.fmt.allocPrint(this.bunVM().allocator, "{s} " ++ fmt, .{@errorName(err)}) catch return);
        str.markUTF8();
        var err_value = str.toErrorInstance(this);
        this.vm().throwError(this, err_value);
        this.bunVM().allocator.free(ZigString.untagged(str.ptr)[0..str.len]);
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
        return @ptrCast(C_API.JSContextRef, this);
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

    pub fn vm(this: *JSGlobalObject) *VM {
        return cppFn("vm", .{this});
    }

    pub fn deleteModuleRegistryEntry(this: *JSGlobalObject, name_: *ZigString) void {
        return cppFn("deleteModuleRegistryEntry", .{ this, name_ });
    }

    pub fn bunVM_(this: *JSGlobalObject) *anyopaque {
        return cppFn("bunVM", .{this});
    }

    pub fn bunVM(this: *JSGlobalObject) *JSC.VirtualMachine {
        if (comptime bun.Environment.allow_assert) {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            const assertion = this.bunVM_() == @ptrCast(*anyopaque, JSC.VirtualMachine.vm);
            if (!assertion) @breakpoint();
            std.debug.assert(assertion);
        }
        return @ptrCast(*JSC.VirtualMachine, @alignCast(std.meta.alignment(JSC.VirtualMachine), this.bunVM_()));
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bunVMConcurrently(this: *JSGlobalObject) *JSC.VirtualMachine {
        return @ptrCast(*JSC.VirtualMachine, @alignCast(std.meta.alignment(JSC.VirtualMachine), this.bunVM_()));
    }

    pub fn handleRejectedPromises(this: *JSGlobalObject) void {
        return cppFn("handleRejectedPromises", .{this});
    }

    pub fn startRemoteInspector(this: *JSGlobalObject, host: [:0]const u8, port: u16) bool {
        return cppFn("startRemoteInspector", .{ this, host, port });
    }

    extern fn ZigGlobalObject__readableStreamToArrayBuffer(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToText(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToJSON(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToBlob(*JSGlobalObject, JSValue) JSValue;

    pub fn readableStreamToArrayBuffer(this: *JSGlobalObject, value: JSValue) JSValue {
        if (comptime is_bindgen) unreachable;
        return ZigGlobalObject__readableStreamToArrayBuffer(this, value);
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
        // "createError",
        // "throwError",
    };
};

pub const JSNativeFn = fn (*JSGlobalObject, *CallFrame) callconv(.C) JSValue;

pub const JSArrayIterator = struct {
    i: u32 = 0,
    len: u32 = 0,
    array: JSValue,
    global: *JSGlobalObject,

    pub fn init(value: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return .{
            .array = value,
            .global = global,
            .len = @truncate(u32, value.getLengthOfArray(global)),
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

pub const JSValueReprInt = i64;
pub const JSValue = enum(JSValueReprInt) {
    zero = 0,
    @"undefined" = @bitCast(JSValueReprInt, @as(i64, 0xa)),
    @"null" = @bitCast(JSValueReprInt, @as(i64, 0x2)),
    @"true" = @bitCast(JSValueReprInt, @as(i64, 0x4)),
    @"false" = @bitCast(JSValueReprInt, @as(i64, 0x6)),
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
        PureForwardingProxy,
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
        // Start StringObject s.
        StringObject,
        DerivedStringObject,
        // End StringObject s.

        MaxJS = 0b11111111,
        Event = 0b11101111,
        DOMWrapper = 0b11101110,
        Blob = 0b11111100,
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
                => true,
                else => false,
            };
        }

        pub fn isObject(this: JSType) bool {
            return switch (this) {
                .Object, .FinalObject => true,
                else => false,
            };
        }

        pub fn isFunction(this: JSType) bool {
            return switch (this) {
                .JSFunction, .FunctionExecutable, .InternalFunction => true,
                else => false,
            };
        }

        pub fn isTypedArray(this: JSType) bool {
            return switch (this) {
                .Int8Array, .Int16Array, .Int32Array, .Uint8Array, .Uint8ClampedArray, .Uint16Array, .Uint32Array, .Float32Array, .Float64Array, .ArrayBuffer => true,
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

        pub inline fn isIndexable(this: JSType) bool {
            return switch (this) {
                .Object,
                .FinalObject,
                .Int8Array,
                .Int16Array,
                .Int32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                .Uint16Array,
                .Uint32Array,
                .Float32Array,
                .Float64Array,
                .Array,
                .DerivedArray,
                => true,
                else => false,
            };
        }
    };

    pub inline fn cast(ptr: anytype) JSValue {
        return @intToEnum(JSValue, @bitCast(i64, @ptrToInt(ptr)));
    }

    pub const Formatter = struct {
        value: JSValue,
        global: *JSGlobalObject,

        pub fn format(formatter: Formatter, comptime fmt: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.value;
            const kind: JSType = jsType(self);
            if (kind.isStringLike()) {
                var zig_str = self.getZigString();
                return try zig_str.format(fmt, opts, writer);
            }

            if (kind) {}
        }
    };

    pub fn coerceToInt32(this: JSValue, globalThis: *JSC.JSGlobalObject) i32 {
        return cppFn("coerceToInt32", .{ this, globalThis });
    }

    const PropertyIteratorFn = fn (
        globalObject_: [*c]JSGlobalObject,
        ctx_ptr: ?*anyopaque,
        key: *ZigString,
        value: JSValue,
        is_symbol: bool,
    ) callconv(.C) void;

    pub fn forEachProperty(
        this: JSValue,
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        cppFn("forEachProperty", .{ this, globalThis, ctx, callback });
    }

    pub fn coerce(this: JSValue, comptime T: type, globalThis: *JSC.JSGlobalObject) T {
        return switch (T) {
            ZigString => this.getZigString(globalThis),
            bool => this.toBooleanSlow(globalThis),
            i32 => {
                if (this.isInt32()) {
                    return this.asInt32();
                }

                if (this.isNumber()) {
                    return @truncate(i32, this.coerceDoubleTruncatingIntoInt64());
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
            c_uint => @intCast(c_uint, toU32(this)),
            c_int => @intCast(c_int, toInt32(this)),
            ?*JSInternalPromise => asInternalPromise(this),
            ?*JSPromise => asPromise(this),

            u52 => @truncate(u52, @intCast(u64, @maximum(this.toInt64(), 0))),
            u64 => toUInt64NoTruncate(this),
            u8 => @truncate(u8, toU32(this)),
            i16 => @truncate(i16, toInt32(this)),
            i8 => @truncate(i8, toInt32(this)),
            i32 => @truncate(i32, toInt32(this)),
            i64 => this.toInt64(),
            bool => this.toBoolean(),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool {
        if (this.isEmptyOrUndefinedOrNull())
            return false;

        return JSC.C.JSValueIsInstanceOfConstructor(global, this.asObjectRef(), constructor.asObjectRef(), null);
    }

    pub fn call(this: JSValue, globalThis: *JSGlobalObject, args: []const JSC.JSValue) JSC.JSValue {
        return callWithThis(this, globalThis, JSC.JSValue.jsUndefined(), args);
    }

    pub fn callWithThis(this: JSValue, globalThis: *JSGlobalObject, thisValue: JSC.JSValue, args: []const JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        return JSC.C.JSObjectCallAsFunctionReturnValue(
            globalThis,
            this.asObjectRef(),
            @ptrCast(JSC.C.JSValueRef, thisValue.asNullableVoid()),
            args.len,
            @ptrCast(?[*]const JSC.C.JSValueRef, args.ptr),
        );
    }

    pub fn jsType(
        this: JSValue,
    ) JSType {
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

    pub fn createEmptyObject(global: *JSGlobalObject, len: usize) JSValue {
        std.debug.assert(len <= 64); // max inline capacity JSC allows is 64. If you run into this, just set it to 0.
        return cppFn("createEmptyObject", .{ global, len });
    }

    pub fn putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values: [*]ZigString, values_len: usize) void {
        return cppFn("putRecord", .{ value, global, key, values, values_len });
    }

    pub fn put(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: JSC.JSValue) void {
        return cppFn("put", .{ value, global, key, result });
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

        if (comptime @hasDecl(ZigType, "fromJS") and @TypeOf(ZigType.fromJS) == fn (JSC.JSValue) ?*ZigType) {
            return ZigType.fromJS(value);
        }

        return JSC.GetJSPrivateData(ZigType, value.asObjectRef());
    }

    extern fn JSBuffer__isBuffer(*JSGlobalObject, JSValue) bool;
    pub fn isBuffer(value: JSValue, global: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return JSBuffer__isBuffer(global, value);
    }

    pub fn asCheckLoaded(value: JSValue, comptime ZigType: type) ?*ZigType {
        if (!ZigType.Class.isLoaded() or value.isUndefinedOrNull())
            return null;

        return JSC.GetJSPrivateData(ZigType, value.asObjectRef());
    }

    pub fn protect(this: JSValue) void {
        if (this.isEmptyOrUndefinedOrNull() or this.isNumber()) return;
        JSC.C.JSValueProtect(JSC.VirtualMachine.vm.global, this.asObjectRef());
    }

    pub fn unprotect(this: JSValue) void {
        if (this.isEmptyOrUndefinedOrNull() or this.isNumber()) return;
        JSC.C.JSValueUnprotect(JSC.VirtualMachine.vm.global, this.asObjectRef());
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

    pub fn makeWithNameAndPrototype(globalObject: *JSGlobalObject, class: ?*anyopaque, instance: ?*anyopaque, name_: *const ZigString) JSValue {
        return cppFn("makeWithNameAndPrototype", .{ globalObject, class, instance, name_ });
    }

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
            f32, f64 => jsNumberFromDouble(@as(f64, number)),
            u8, i16, i32, c_int, i8, u16 => jsNumberFromInt32(@intCast(i32, number)),
            u32, u52, c_uint, i64 => jsNumberFromInt64(@intCast(i64, number)),
            usize, u64 => jsNumberFromUint64(@intCast(u64, number)),
            comptime_int => switch (number) {
                0...std.math.maxInt(i32) => jsNumberFromInt32(@intCast(i32, number)),
                else => jsNumberFromInt64(@intCast(i64, number)),
            },
            else => @compileError("Type transformation missing for number of type: " ++ @typeName(Number)),
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
        if (value.isEmptyOrUndefinedOrNull()) return null;
        return cppFn("asPromise", .{
            value,
        });
    }

    pub fn jsNumber(number: anytype) JSValue {
        return jsNumberWithType(@TypeOf(number), number);
    }

    pub inline fn jsNull() JSValue {
        return JSValue.@"null";
    }
    pub inline fn jsUndefined() JSValue {
        return JSValue.@"undefined";
    }
    pub inline fn jsBoolean(i: bool) JSValue {
        const out = cppFn("jsBoolean", .{i});
        return out;
    }

    pub fn jsTDZValue() JSValue {
        return cppFn("jsTDZValue", .{});
    }

    pub fn jsDoubleNumber(i: f64) JSValue {
        return cppFn("jsDoubleNumber", .{i});
    }

    pub fn className(this: JSValue, globalThis: *JSGlobalObject) ZigString {
        var str = ZigString.init("");
        this.getClassName(globalThis, &str);
        return str;
    }

    pub fn createStringArray(globalThis: *JSGlobalObject, str: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("createStringArray", .{
            globalThis,
            str,
            strings_count,
            clone,
        });
    }

    pub fn fromEntries(globalThis: *JSGlobalObject, keys: [*c]ZigString, values: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("fromEntries", .{
            globalThis,
            keys,
            values,
            strings_count,
            clone,
        });
    }

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
            return jsNumberFromInt32(@intCast(i32, i));
        }

        return jsNumberFromDouble(@intToFloat(f64, @truncate(i52, i)));
    }

    pub inline fn toJS(this: JSValue, _: *const JSGlobalObject) JSValue {
        return this;
    }

    pub fn jsNumberFromUint64(i: u64) JSValue {
        if (i <= std.math.maxInt(i32)) {
            return jsNumberFromInt32(@intCast(i32, i));
        }

        return jsNumberFromDouble(@intToFloat(f64, @intCast(i52, @truncate(u51, i))));
    }

    pub fn coerceDoubleTruncatingIntoInt64(this: JSValue) i64 {
        const double_value = this.asDouble();

        if (std.math.isNan(double_value))
            return std.math.minInt(i64);

        // coerce NaN or Infinity to either -maxInt or maxInt
        if (std.math.isInf(double_value)) {
            return if (double_value < 0) @as(i64, std.math.minInt(i64)) else @as(i64, std.math.maxInt(i64));
        }

        return @floatToInt(
            i64,
            double_value,
        );
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
        return @enumToInt(this) == 0xa;
    }
    pub inline fn isNull(this: JSValue) bool {
        return @enumToInt(this) == 0x2;
    }
    pub inline fn isEmptyOrUndefinedOrNull(this: JSValue) bool {
        return switch (@enumToInt(this)) {
            0, 0xa, 0x2 => true,
            else => false,
        };
    }
    pub fn isUndefinedOrNull(this: JSValue) bool {
        return switch (@enumToInt(this)) {
            0xa, 0x2 => true,
            else => false,
        };
    }
    /// Empty as in "JSValue {}" rather than an empty string
    pub inline fn isEmpty(this: JSValue) bool {
        return switch (@enumToInt(this)) {
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

    pub fn isInt32(this: JSValue) bool {
        return FFI.JSVALUE_IS_INT32(.{ .asJSValue = this });
    }

    pub fn isInt32AsAnyInt(this: JSValue) bool {
        return cppFn("isInt32AsAnyInt", .{this});
    }

    pub fn isNumber(this: JSValue) bool {
        return FFI.JSVALUE_IS_NUMBER(.{ .asJSValue = this });
    }

    pub fn isError(this: JSValue) bool {
        return cppFn("isError", .{this});
    }

    pub fn isAnyError(this: JSValue, global: *JSGlobalObject) bool {
        if (this.isEmptyOrUndefinedOrNull()) return false;

        return this.isError() or this.isException(global.vm()) or this.isAggregateError(global);
    }
    pub fn isString(this: JSValue) bool {
        return cppFn("isString", .{this});
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
    pub fn isObject(this: JSValue) bool {
        return cppFn("isObject", .{this});
    }

    pub fn isClass(this: JSValue, global: *JSGlobalObject) bool {
        return cppFn("isClass", .{ this, global });
    }

    pub fn getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        if (this.isEmptyOrUndefinedOrNull()) {
            return;
        }

        cppFn("getNameProperty", .{ this, global, ret });
    }

    pub fn getName(this: JSValue, global: *JSGlobalObject) ZigString {
        var ret = ZigString.init("");
        getNameProperty(this, global, &ret);
        return ret;
    }

    pub fn getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        cppFn("getClassName", .{ this, global, ret });
    }

    pub fn isCell(this: JSValue) bool {
        return cppFn("isCell", .{this});
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

    pub fn toError(this: JSValue, global: *JSGlobalObject) JSValue {
        return cppFn("toError", .{ this, global });
    }

    pub fn toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void {
        return cppFn("toZigException", .{ this, global, exception });
    }

    pub fn toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) void {
        return cppFn("toZigString", .{ this, out, global });
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

    pub fn fromInt64NoTruncate(globalObject: *JSGlobalObject, i: i64) JSValue {
        return cppFn("fromInt64NoTruncate", .{ globalObject, i });
    }
    pub fn fromUInt64NoTruncate(globalObject: *JSGlobalObject, i: u64) JSValue {
        return cppFn("fromUInt64NoTruncate", .{ globalObject, i });
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

    pub inline fn toSlice(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        return getZigString(this, global).toSlice(allocator);
    }

    // On exception, this returns the empty string.
    pub fn toString(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return cppFn("toString", .{ this, globalThis });
    }

    pub fn jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *ZigString) void {
        return cppFn("jsonStringify", .{ this, globalThis, indent, out });
    }

    // On exception, this returns null, to make exception checks faster.
    pub fn toStringOrNull(this: JSValue, globalThis: *JSGlobalObject) ?*JSString {
        return cppFn("toStringOrNull", .{ this, globalThis });
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
        url,
        body,
        data,
    };

    // intended to be more lightweight than ZigString
    pub fn fastGet(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        const result = fastGet_(this, global, @enumToInt(builtin_name));
        if (result == .zero) {
            return null;
        }

        return result;
    }

    pub fn fastGet_(this: JSValue, global: *JSGlobalObject, builtin_name: u8) JSValue {
        return cppFn("fastGet_", .{ this, global, builtin_name });
    }

    // intended to be more lightweight than ZigString
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
            std.debug.assert(JSValue.fromPtr(ctx).asPtr(anyopaque) == ctx.?);
        return this._then(global, JSValue.fromPtr(ctx), resolve, reject);
    }

    pub fn getDescription(this: JSValue, global: *JSGlobalObject) ZigString {
        var zig_str = ZigString.init("");
        getSymbolDescription(this, global, &zig_str);
        return zig_str;
    }

    pub fn get(this: JSValue, global: *JSGlobalObject, comptime property: []const u8) ?JSValue {
        const value = getIfPropertyExistsImpl(this, global, property.ptr, @intCast(u32, property.len));
        return if (@enumToInt(value) != 0) value else return null;
    }

    pub fn getTruthy(this: JSValue, global: *JSGlobalObject, comptime property: []const u8) ?JSValue {
        if (get(this, global, property)) |prop| {
            if (prop.isEmptyOrUndefinedOrNull()) return null;
            return prop;
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
        return @enumToInt(this) == @enumToInt(other) or cppFn("isSameValue", .{ this, other, global });
    }

    pub fn deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("deepEquals", .{ this, other, global });
    }

    pub fn strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("strictDeepEquals", .{ this, other, global });
    }

    pub fn asString(this: JSValue) *JSString {
        return cppFn("asString", .{
            this,
        });
    }

    pub fn toFmt(
        this: JSValue,
        global: *JSGlobalObject,
        formatter: *Exports.ZigConsoleClient.Formatter,
    ) Exports.ZigConsoleClient.Formatter.ZigFormatter {
        formatter.remaining_values = &[_]JSValue{};
        if (formatter.map_node) |node| {
            node.release();
            formatter.map_node = null;
        }

        return Exports.ZigConsoleClient.Formatter.ZigFormatter{
            .formatter = formatter,
            .value = this,
            .global = global,
        };
    }

    pub fn asObject(this: JSValue) JSObject {
        return cppFn("asObject", .{
            this,
        });
    }

    pub fn asNumber(this: JSValue) f64 {
        if (this.isInt32()) {
            return @intToFloat(f64, this.asInt32());
        }

        if (isNumber(this)) {
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
        return FFI.JSVALUE_TO_DOUBLE(.{ .asJSValue = this });
    }

    pub fn asPtr(this: JSValue, comptime Pointer: type) *Pointer {
        return @intToPtr(*Pointer, this.asPtrAddress());
    }

    pub fn fromPtrAddress(addr: anytype) JSValue {
        return jsNumber(@intToFloat(f64, @bitCast(usize, @as(usize, addr))));
    }

    pub fn asPtrAddress(this: JSValue) usize {
        return @bitCast(usize, @floatToInt(usize, this.asDouble()));
    }

    pub fn fromPtr(addr: anytype) JSValue {
        return fromPtrAddress(@ptrToInt(addr));
    }

    pub fn toBooleanSlow(this: JSValue, global: *JSGlobalObject) bool {
        return cppFn("toBooleanSlow", .{ this, global });
    }

    pub fn toBoolean(this: JSValue) bool {
        if (isUndefinedOrNull(this)) {
            return false;
        }

        return asBoolean(this);
    }

    pub fn asBoolean(this: JSValue) bool {
        return FFI.JSVALUE_TO_BOOL(.{ .asJSValue = this });
    }

    pub fn toInt32(this: JSValue) i32 {
        if (this.isInt32()) {
            return asInt32(this);
        }

        if (this.isNumber()) {
            return @truncate(i32, @floatToInt(i64, asDouble(this)));
        }

        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(!this.isString()); // use coerce() instead
            std.debug.assert(!this.isCell()); // use coerce() instead
        }

        return cppFn("toInt32", .{
            this,
        });
    }

    pub fn asInt32(this: JSValue) i32 {
        return FFI.JSVALUE_TO_INT32(.{ .asJSValue = this });
    }

    pub inline fn toU16(this: JSValue) u16 {
        return @truncate(u16, this.toU32());
    }

    pub inline fn toU32(this: JSValue) u32 {
        return @intCast(u32, @maximum(this.toInt32(), 0));
    }

    pub fn getLengthOfArray(this: JSValue, globalThis: *JSGlobalObject) u64 {
        return cppFn("getLengthOfArray", .{
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
        callback: fn (vm: [*c]VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void,
    ) void {
        return cppFn("forEach", .{ this, globalObject, ctx, callback });
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

    pub inline fn asRef(this: JSValue) C_API.JSValueRef {
        return @intToPtr(C_API.JSValueRef, @bitCast(usize, @enumToInt(this)));
    }

    pub inline fn c(this: C_API.JSValueRef) JSValue {
        return @intToEnum(JSValue, @bitCast(JSValue.Type, @ptrToInt(this)));
    }

    pub inline fn fromRef(this: C_API.JSValueRef) JSValue {
        return @intToEnum(JSValue, @bitCast(JSValue.Type, @ptrToInt(this)));
    }

    pub inline fn asObjectRef(this: JSValue) C_API.JSObjectRef {
        return @ptrCast(C_API.JSObjectRef, this.asVoid());
    }

    /// When the GC sees a JSValue referenced in the stack
    /// It knows not to free it
    /// This mimicks the implementation in JavaScriptCore's C++
    pub inline fn ensureStillAlive(this: JSValue) void {
        if (this.isEmpty() or this.isNumber() or this.isBoolean() or this.isUndefinedOrNull()) return;
        std.mem.doNotOptimizeAway(@ptrCast(C_API.JSObjectRef, this.asVoid()));
    }

    pub inline fn asNullableVoid(this: JSValue) ?*anyopaque {
        return @intToPtr(?*anyopaque, @bitCast(usize, @enumToInt(this)));
    }

    pub inline fn asVoid(this: JSValue) *anyopaque {
        if (comptime bun.Environment.allow_assert) {
            if (@enumToInt(this) == 0) {
                @panic("JSValue is null");
            }
        }
        return this.asNullableVoid().?;
    }

    pub const Extern = [_][]const u8{ "createRopeString", "forEachProperty", "coerceToInt32", "fastGet_", "getStaticProperty", "createUninitializedUint8Array", "fromInt64NoTruncate", "fromUInt64NoTruncate", "toUInt64NoTruncate", "asPromise", "toInt64", "_then", "put", "makeWithNameAndPrototype", "parseJSON", "symbolKeyFor", "symbolFor", "getSymbolDescription", "createInternalPromise", "asInternalPromise", "asArrayBuffer_", "fromEntries", "createTypeError", "createRangeError", "createObject2", "getIfPropertyExistsImpl", "jsType", "jsonStringify", "kind_", "isTerminationException", "isSameValue", "getLengthOfArray", "toZigString", "createStringArray", "createEmptyObject", "putRecord", "asPromise", "isClass", "getNameProperty", "getClassName", "getErrorsProperty", "toInt32", "toBoolean", "isInt32", "isIterable", "forEach", "isAggregateError", "toError", "toZigException", "isException", "toWTFString", "hasProperty", "getPropertyNames", "getDirect", "putDirect", "getIfExists", "asString", "asObject", "asNumber", "isError", "jsNull", "jsUndefined", "jsTDZValue", "jsBoolean", "jsDoubleNumber", "jsNumberFromDouble", "jsNumberFromChar", "jsNumberFromU16", "jsNumberFromInt64", "isBoolean", "isAnyInt", "isUInt32AsAnyInt", "isInt32AsAnyInt", "isNumber", "isString", "isBigInt", "isHeapBigInt", "isBigInt32", "isSymbol", "isPrimitive", "isGetterSetter", "isCustomGetterSetter", "isObject", "isCell", "asCell", "toString", "toStringOrNull", "toPropertyKeyValue", "toObject", "toString", "getPrototype", "getPropertyByPropertyName", "eqlValue", "eqlCell", "isCallable", "toBooleanSlow", "deepEquals", "strictDeepEquals", "getIfPropertyExistsFromPath", "asBigIntCompare" };
};

extern "c" fn Microtask__run(*Microtask, *JSGlobalObject) void;
extern "c" fn Microtask__run_default(*MicrotaskForDefaultGlobalObject, *JSGlobalObject) void;

pub const Microtask = opaque {
    pub const name = "Zig::JSMicrotaskCallback";
    pub const namespace = "Zig";

    pub fn run(this: *Microtask, global_object: *JSGlobalObject) void {
        if (comptime is_bindgen) {
            return;
        }

        return Microtask__run(this, global_object);
    }
};

pub const MicrotaskForDefaultGlobalObject = opaque {
    pub fn run(this: *MicrotaskForDefaultGlobalObject, global_object: *JSGlobalObject) void {
        if (comptime is_bindgen) {
            return;
        }

        return Microtask__run_default(this, global_object);
    }
};

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
            .{ globalObject, object, @enumToInt(stack_capture) },
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
        return cppFn("create", .{@enumToInt(heap_type)});
    }

    pub fn deinit(vm: *VM, global_object: *JSGlobalObject) void {
        return cppFn("deinit", .{ vm, global_object });
    }

    pub fn isJITEnabled() bool {
        return cppFn("isJITEnabled", .{});
    }

    pub fn holdAPILock(this: *VM, ctx: ?*anyopaque, callback: fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("holdAPILock", .{ this, ctx, callback });
    }

    pub fn deferGC(this: *VM, ctx: ?*anyopaque, callback: fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("deferGC", .{ this, ctx, callback });
    }

    pub fn deleteAllCode(
        vm: *VM,
        global_object: *JSGlobalObject,
    ) void {
        return cppFn("deleteAllCode", .{ vm, global_object });
    }

    extern fn Bun__setOnEachMicrotaskTick(vm: *VM, ptr: ?*anyopaque, callback: ?(fn (*anyopaque) callconv(.C) void)) void;

    pub fn onEachMicrotask(vm: *VM, comptime Ptr: type, ptr: *Ptr, comptime callback: fn (*Ptr) void) void {
        if (comptime is_bindgen) {
            return;
        }

        const callback_ = callback;
        const Wrapper = struct {
            pub fn run(ptr_: *anyopaque) callconv(.C) void {
                var ptr__ = @ptrCast(*Ptr, @alignCast(@alignOf(Ptr), ptr_));
                callback_(ptr__);
            }
        };

        Bun__setOnEachMicrotaskTick(vm, ptr, Wrapper.run);
    }

    pub fn clearMicrotaskCallback(vm: *VM) void {
        if (comptime is_bindgen) {
            return;
        }

        Bun__setOnEachMicrotaskTick(vm, null, null);
    }

    pub fn whenIdle(
        vm: *VM,
        callback: fn (...) callconv(.C) void,
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

    pub fn doWork(
        vm: *VM,
    ) void {
        return cppFn("doWork", .{
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

    pub const Extern = [_][]const u8{ "collectAsync", "externalMemorySize", "blockBytesAllocated", "heapSize", "releaseWeakRefs", "throwError", "doWork", "deferGC", "holdAPILock", "runGC", "generateHeapSnapshot", "isJITEnabled", "deleteAllCode", "create", "deinit", "setExecutionForbidden", "executionForbidden", "isEntered", "throwError", "drainMicrotasks", "whenIdle", "shrinkFootprint", "setExecutionTimeLimit", "clearExecutionTimeLimit" };
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

    pub fn argumentsPtr(self: *const CallFrame) [*]const JSC.JSValue {
        return @ptrCast([*]const JSC.JSValue, @alignCast(alignment, self)) + Sizes.Bun_CallFrame__firstArgument;
    }

    pub fn callee(self: *const CallFrame) JSC.JSValue {
        return (@ptrCast([*]const JSC.JSValue, @alignCast(alignment, self)) + Sizes.Bun_CallFrame__callee)[0];
    }

    pub fn arguments(self: *const CallFrame, comptime max: usize) struct { ptr: [max]JSC.JSValue, len: usize } {
        var buf: [max]JSC.JSValue = std.mem.zeroes([max]JSC.JSValue);
        const len = self.argumentsCount();
        var ptr = self.argumentsPtr();
        switch (@minimum(len, max)) {
            0 => {
                return .{ .ptr = buf, .len = 0 };
            },
            1 => {
                buf[0..1].* = ptr[0..1].*;
                return .{ .ptr = buf, .len = 1 };
            },
            2 => {
                buf[0..2].* = ptr[0..2].*;
                return .{ .ptr = buf, .len = 2 };
            },
            3 => {
                buf[0..3].* = ptr[0..3].*;
                return .{ .ptr = buf, .len = 3 };
            },
            4 => {
                buf[0..4].* = ptr[0..4].*;
                return .{ .ptr = buf, .len = 4 };
            },
            5 => {
                buf[0..5].* = ptr[0..5].*;
                return .{ .ptr = buf, .len = 5 };
            },
            6 => {
                buf[0..6].* = ptr[0..6].*;
                return .{ .ptr = buf, .len = 6 };
            },
            7 => {
                buf[0..7].* = ptr[0..7].*;
                return .{ .ptr = buf, .len = 7 };
            },
            else => {
                buf[0..8].* = ptr[0..8].*;
                return .{ .ptr = buf, .len = 8 };
            },
        }
    }

    pub fn argument(self: *const CallFrame, comptime i: comptime_int) JSC.JSValue {
        return self.argumentsPtr()[i];
    }

    pub fn this(self: *const CallFrame) JSC.JSValue {
        return (@ptrCast([*]const JSC.JSValue, @alignCast(alignment, self)) + Sizes.Bun_CallFrame__thisArgument)[0];
    }

    pub fn argumentsCount(self: *const CallFrame) usize {
        return @intCast(usize, (@ptrCast([*]const JSC.JSValue, @alignCast(alignment, self)) + Sizes.Bun_CallFrame__argumentCountIncludingThis)[0].asInt32() - 1);
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

const DeinitFunction = fn (ctx: *anyopaque, buffer: [*]u8, len: usize) callconv(.C) void;

pub const JSArray = struct {
    pub fn from(globalThis: *JSGlobalObject, arguments: []const JSC.JSValue) JSValue {
        return JSC.JSValue.c(JSC.C.JSObjectMakeArray(globalThis, arguments.len, @ptrCast(?[*]const JSC.C.JSObjectRef, arguments.ptr), null));
    }
};

const private = struct {
    pub extern fn Bun__CreateFFIFunctionWithDataValue(
        *JSGlobalObject,
        ?*const ZigString,
        argCount: u32,
        function: *const anyopaque,
        strong: bool,
        data: *anyopaque,
    ) JSValue;
    pub extern fn Bun__CreateFFIFunction(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: *const anyopaque,
        strong: bool,
    ) *anyopaque;

    pub extern fn Bun__CreateFFIFunctionValue(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: *const anyopaque,
        strong: bool,
    ) JSValue;

    pub extern fn Bun__untrackFFIFunction(
        globalObject: *JSGlobalObject,
        function: JSValue,
    ) bool;

    pub extern fn Bun__FFIFunction_getDataPtr(JSValue) ?*anyopaque;
    pub extern fn Bun__FFIFunction_setDataPtr(JSValue, ?*anyopaque) void;
};

pub fn NewFunctionPtr(globalObject: *JSGlobalObject, symbolName: ?*const ZigString, argCount: u32, functionPointer: anytype, strong: bool) *anyopaque {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunction(globalObject, symbolName, argCount, @ptrCast(*const anyopaque, functionPointer), strong);
}

pub fn NewFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    functionPointer: anytype,
    strong: bool,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionValue(globalObject, symbolName, argCount, @ptrCast(*const anyopaque, functionPointer), strong);
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
    functionPointer: anytype,
    strong: bool,
    data: *anyopaque,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionWithDataValue(
        globalObject,
        symbolName,
        argCount,
        @ptrCast(*const anyopaque, functionPointer),
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

pub const WTF = struct {
    extern fn WTF__copyLCharsFromUCharSource(dest: [*]u8, source: *const anyopaque, len: usize) void;
    extern fn WTF__toBase64URLStringValue(bytes: [*]const u8, length: usize, globalObject: *JSGlobalObject) JSValue;
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

    /// Encode a byte array to a URL-safe base64 string for use with JS
    /// Memory is managed by JavaScriptCore instead of us
    pub fn toBase64URLStringValue(bytes: []const u8, globalObject: *JSGlobalObject) JSValue {
        JSC.markBinding(@src());

        return WTF__toBase64URLStringValue(bytes.ptr, bytes.len, globalObject);
    }
};

pub const Callback = struct {
    // zig: Value,
};

pub fn Thenable(comptime name: []const u8, comptime Then: type, comptime onResolve: fn (*Then, globalThis: *JSGlobalObject, result: JSValue) void, comptime onReject: fn (*Then, globalThis: *JSGlobalObject, result: JSValue) void) type {
    return struct {
        pub fn resolve(
            globalThis: [*c]JSGlobalObject,
            callframe: ?*JSC.CallFrame,
        ) callconv(.C) void {
            @setRuntimeSafety(false);
            const args_list = callframe.?.arguments(8);
            onResolve(@ptrCast(*Then, @alignCast(std.meta.alignment(Then), args_list.ptr[args_list.len - 1].asEncoded().asPtr)), globalThis, args_list.ptr[0]);
        }

        pub fn reject(
            globalThis: [*c]JSGlobalObject,
            callframe: ?*JSC.CallFrame,
        ) callconv(.C) void {
            @setRuntimeSafety(false);
            const args_list = callframe.?.arguments(8);
            onReject(@ptrCast(*Then, @alignCast(std.meta.alignment(Then), args_list.ptr[args_list.len - 1].asEncoded().asPtr)), globalThis, args_list.ptr[0]);
        }

        pub fn then(ctx: *Then, this: JSValue, globalThis: *JSGlobalObject) void {
            this._then(globalThis, ctx, resolve, reject);
        }

        comptime {
            if (!JSC.is_bindgen) {
                @export(resolve, name ++ "__resolve");
                @export(reject, name ++ "__reject");
            }
        }
    };
}

pub const JSPropertyIteratorOptions = struct {
    skip_empty_name: bool,
    include_value: bool,
};

pub fn JSPropertyIterator(comptime options: JSPropertyIteratorOptions) type {
    return struct {
        /// Position in the property list array
        /// Update is deferred until the next iteration
        i: u32 = 0,

        iter_i: u32 = 0,
        len: u32,
        array_ref: JSC.C.JSPropertyNameArrayRef,

        /// The `JSValue` of the current property.
        ///
        /// Invokes undefined behavior if an iteration has not yet occurred and
        /// zero-sized when `options.include_value` is not enabled.
        value: if (options.include_value) JSC.JSValue else void,
        /// Zero-sized when `options.include_value` is not enabled.
        object: if (options.include_value) JSC.C.JSObjectRef else void,
        /// Zero-sized when `options.include_value` is not enabled.
        global: if (options.include_value) JSC.C.JSContextRef else void,

        const Self = @This();

        inline fn initInternal(global: JSC.C.JSContextRef, object: JSC.C.JSObjectRef) Self {
            const array_ref = JSC.C.JSObjectCopyPropertyNames(global, object);
            return .{
                .array_ref = array_ref,
                .len = @truncate(u32, JSC.C.JSPropertyNameArrayGetCount(array_ref)),
                .object = if (comptime options.include_value) object else .{},
                .global = if (comptime options.include_value) global else .{},
                .value = undefined,
            };
        }

        /// Initializes the iterator. Make sure you `deinit()` it!
        ///
        /// Not recommended for use when using the CString buffer mode as the
        /// buffer must be manually initialized. Instead, see
        /// `JSPropertyIterator.initCStringBuffer()`.
        pub inline fn init(global: JSC.C.JSContextRef, object: JSC.C.JSObjectRef) Self {
            return Self.initInternal(global, object);
        }

        /// Deinitializes the property name array and all of the string
        /// references constructed by the copy.
        pub inline fn deinit(self: *Self) void {
            JSC.C.JSPropertyNameArrayRelease(self.array_ref);
        }

        pub fn hasLongNames(self: *Self) bool {
            var i = self.i;
            const len = self.len;
            var estimated_length: usize = 0;
            while (i < len) : (i += 1) {
                estimated_length += JSC.C.JSStringGetLength(JSC.C.JSPropertyNameArrayGetNameAtIndex(self.array_ref, i));
                if (estimated_length > 14) return true;
            }
            return false;
        }

        /// Finds the next property string and, if `options.include_value` is
        /// enabled, updates the `iter.value` to respect the latest property's
        /// value. Also note the behavior of the other options.
        pub fn next(self: *Self) ?ZigString {
            return nextMaybeFirstValue(self, .zero);
        }

        pub fn nextMaybeFirstValue(self: *Self, first_value: JSValue) ?ZigString {
            if (self.iter_i >= self.len) {
                self.i = self.iter_i;
                return null;
            }
            self.i = self.iter_i;
            var property_name_ref = JSC.C.JSPropertyNameArrayGetNameAtIndex(self.array_ref, self.iter_i);
            self.iter_i += 1;

            const len = JSC.C.JSStringGetLength(property_name_ref);

            if (comptime options.skip_empty_name) {
                if (len == 0) return self.next();
            }

            const prop = property_name_ref.toZigString();

            if (comptime options.include_value) {
                if (self.i == 0 and first_value != .zero) {
                    self.value = first_value;
                } else {
                    self.value = JSC.JSValue.fromRef(JSC.C.JSObjectGetProperty(self.global, self.object, property_name_ref, null));
                }
            }

            return prop;
        }
    };
}

// DOMCall Fields
pub const __DOMCall_ptr = @import("../api/bun.zig").FFI.Class.functionDefinitions.ptr;
pub const __DOMCall__reader_u8 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"u8";
pub const __DOMCall__reader_u16 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"u16";
pub const __DOMCall__reader_u32 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"u32";
pub const __DOMCall__reader_ptr = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"ptr";
pub const __DOMCall__reader_i8 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"i8";
pub const __DOMCall__reader_i16 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"i16";
pub const __DOMCall__reader_i32 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"i32";
pub const __DOMCall__reader_f32 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"f32";
pub const __DOMCall__reader_f64 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"f64";
pub const __DOMCall__reader_i64 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"i64";
pub const __DOMCall__reader_u64 = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"u64";
pub const __DOMCall__reader_intptr = @import("../api/bun.zig").FFI.Reader.Class.functionDefinitions.@"intptr";
pub const __Crypto_getRandomValues = @import("../webcore.zig").Crypto.Class.functionDefinitions.@"getRandomValues";
pub const __Crypto_randomUUID = @import("../webcore.zig").Crypto.Class.functionDefinitions.@"randomUUID";
pub const __Crypto_timingSafeEqual = @import("../webcore.zig").Crypto.Class.functionDefinitions.@"timingSafeEqual";
pub const DOMCalls = .{
    @import("../api/bun.zig").FFI,
    @import("../api/bun.zig").FFI.Reader,
    @import("../webcore.zig").Crypto,
};
