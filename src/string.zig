const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const Parent = @This();

pub const BufferOwnership = enum {
    BufferInternal,
    BufferOwned,
    BufferSubstring,
    BufferExternal,
};

pub const WTFStringImpl = *WTFStringImplStruct;

pub const WTFStringImplStruct = extern struct {
    m_refCount: u32 = 0,
    m_length: u32 = 0,
    m_ptr: extern union { latin1: [*]const u8, utf16: [*]const u16 },
    m_hashAndFlags: u32 = 0,

    // ---------------------------------------------------------------------
    // These details must stay in sync with WTFStringImpl.h in WebKit!
    // ---------------------------------------------------------------------
    const s_flagCount: u32 = 8;

    const s_flagMask: u32 = (1 << s_flagCount) - 1;
    const s_flagStringKindCount: u32 = 4;
    const s_hashZeroValue: u32 = 0;
    const s_hashFlagStringKindIsAtom: u32 = @as(1, u32) << (s_flagStringKindCount);
    const s_hashFlagStringKindIsSymbol: u32 = @as(1, u32) << (s_flagStringKindCount + 1);
    const s_hashMaskStringKind: u32 = s_hashFlagStringKindIsAtom | s_hashFlagStringKindIsSymbol;
    const s_hashFlagDidReportCost: u32 = @as(1, u32) << 3;
    const s_hashFlag8BitBuffer: u32 = 1 << 2;
    const s_hashMaskBufferOwnership: u32 = (1 << 0) | (1 << 1);

    /// The bottom bit in the ref count indicates a static (immortal) string.
    const s_refCountFlagIsStaticString = 0x1;

    /// This allows us to ref / deref without disturbing the static string flag.
    const s_refCountIncrement = 0x2;

    // ---------------------------------------------------------------------

    pub fn refCount(this: WTFStringImpl) u32 {
        return this.m_refCount / s_refCountIncrement;
    }

    pub fn isStatic(this: WTFStringImpl) bool {
        return this.m_refCount & s_refCountIncrement != 0;
    }

    pub fn byteLength(this: WTFStringImpl) usize {
        return if (this.is8Bit()) this.m_length else this.m_length * 2;
    }

    pub fn byteSlice(this: WTFStringImpl) []const u8 {
        return this.m_ptr.latin1[0..this.byteLength()];
    }

    pub inline fn is8Bit(self: WTFStringImpl) bool {
        return (self.m_hashAndFlags & s_hashFlag8BitBuffer) != 0;
    }

    pub inline fn length(self: WTFStringImpl) u32 {
        return self.m_length;
    }

    pub inline fn utf16Slice(self: WTFStringImpl) []const u16 {
        std.debug.assert(!is8Bit(self));
        return self.m_ptr.utf16[0..length(self)];
    }

    pub inline fn latin1Slice(self: WTFStringImpl) []const u8 {
        std.debug.assert(is8Bit(self));
        return self.m_ptr.latin1[0..length(self)];
    }

    /// Caller must ensure that the string is 8-bit and ASCII.
    pub inline fn utf8Slice(self: WTFStringImpl) []const u8 {
        if (comptime bun.Environment.allow_assert)
            std.debug.assert(canUseAsUTF8(self));
        return self.m_ptr.latin1[0..length(self)];
    }

    pub fn toZigString(this: WTFStringImpl) ZigString {
        if (this.is8Bit()) {
            return ZigString.init(this.latin1Slice());
        } else {
            return ZigString.init16(this.utf16Slice());
        }
    }

    pub inline fn deref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.refCount();
        std.debug.assert(current_count > 0);
        Bun__WTFStringImpl__deref(self);
        if (comptime bun.Environment.allow_assert) {
            if (current_count > 1) {
                std.debug.assert(self.refCount() < current_count or self.isStatic());
            }
        }
    }

    pub inline fn ref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.refCount();
        std.debug.assert(current_count > 0);
        Bun__WTFStringImpl__ref(self);
        std.debug.assert(self.refCount() > current_count or self.isStatic());
    }

    pub fn toUTF8(this: WTFStringImpl, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()) catch null) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            this.ref();
            return ZigString.Slice.init(this.refCountAllocator(), this.latin1Slice());
        }

        if (bun.strings.toUTF8Alloc(allocator, this.utf16Slice()) catch null) |utf8| {
            return ZigString.Slice.init(allocator, utf8);
        }

        return .{};
    }

    pub fn toUTF8IfNeeded(this: WTFStringImpl, allocator: std.mem.Allocator) ?ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()) catch null) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return null;
        }

        if (bun.strings.toUTF8Alloc(allocator, this.utf16Slice()) catch null) |utf8| {
            return ZigString.Slice.init(allocator, utf8);
        }

        return null;
    }

    /// Avoid using this in code paths that are about to get the string as a UTF-8
    /// In that case, use toUTF8IfNeeded instead.
    pub fn canUseAsUTF8(this: WTFStringImpl) bool {
        return this.is8Bit() and bun.strings.isAllASCII(this.latin1Slice());
    }

    pub fn utf8ByteLength(this: WTFStringImpl) usize {
        if (this.is8Bit()) {
            const input = this.latin1Slice();
            return if (input.len > 0) JSC.WebCore.Encoder.byteLengthU8(input.ptr, input.len, .utf8) else 0;
        } else {
            const input = this.utf16Slice();
            return if (input.len > 0) JSC.WebCore.Encoder.byteLengthU16(input.ptr, input.len, .utf8) else 0;
        }
    }

    pub fn refCountAllocator(self: WTFStringImpl) std.mem.Allocator {
        return std.mem.Allocator{ .ptr = self, .vtable = StringImplAllocator.VTablePtr };
    }

    extern fn Bun__WTFStringImpl__deref(self: WTFStringImpl) void;
    extern fn Bun__WTFStringImpl__ref(self: WTFStringImpl) void;
};

pub const StringImplAllocator = struct {
    fn alloc(ptr: *anyopaque, len: usize, _: u8, _: usize) ?[*]u8 {
        var this = bun.cast(WTFStringImpl, ptr);
        const len_ = this.byteLength();

        if (len_ != len) {
            // we don't actually allocate, we just reference count
            return null;
        }

        this.ref();

        // we should never actually allocate
        return @constCast(this.m_ptr.latin1);
    }

    fn resize(_: *anyopaque, _: []u8, _: u8, _: usize, _: usize) bool {
        return false;
    }

    pub fn free(
        ptr: *anyopaque,
        buf: []u8,
        _: u8,
        _: usize,
    ) void {
        var this = bun.cast(WTFStringImpl, ptr);
        std.debug.assert(this.byteSlice().ptr == buf.ptr);
        std.debug.assert(this.byteSlice().len == buf.len);
        this.deref();
    }

    pub const VTable = std.mem.Allocator.VTable{
        .alloc = &alloc,
        .resize = &resize,
        .free = &free,
    };

    pub const VTablePtr = &VTable;
};

pub const Tag = enum(u8) {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
};

const ZigString = bun.JSC.ZigString;

pub const StringImpl = extern union {
    ZigString: ZigString,
    WTFStringImpl: WTFStringImpl,
    StaticZigString: ZigString,
    Dead: void,
    Empty: void,
};

/// Prefer using String instead of ZigString in new code.
pub const String = extern struct {
    pub const name = "BunString";

    tag: Tag,
    value: StringImpl,

    pub const empty = String{ .tag = .Empty, .value = .{ .Empty = {} } };

    pub const dead = String{ .tag = .Dead, .value = .{ .Dead = {} } };
    pub const StringImplAllocator = Parent.StringImplAllocator;

    extern fn BunString__fromLatin1(bytes: [*]const u8, len: usize) String;
    extern fn BunString__fromBytes(bytes: [*]const u8, len: usize) String;

    pub fn createLatin1(bytes: []const u8) String {
        return BunString__fromLatin1(bytes.ptr, bytes.len);
    }

    pub fn create(bytes: []const u8) String {
        return BunString__fromBytes(bytes.ptr, bytes.len);
    }

    pub fn initWithType(comptime Type: type, value: Type) String {
        switch (comptime Type) {
            ZigString => return String{ .tag = .ZigString, .value = .{ .ZigString = value } },
            [:0]u8, []u8, [:0]const u8, []const u8 => return String{ .tag = .ZigString, .value = .{ .ZigString = ZigString.fromBytes(value) } },
            [:0]u16, []u16, [:0]const u16, []const u16 => return String{ .tag = .ZigString, .value = .{ .ZigString = ZigString.from16Slice(value) } },
            WTFStringImpl => return String{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = value } },
            *const ZigString, *ZigString => return String{ .tag = .ZigString, .value = .{ .ZigString = value.* } },
            *const [0:0]u8 => return String{ .tag = .Empty, .value = .{ .Empty = {} } },
            String => return value,
            else => {
                if (comptime std.meta.trait.isZigString(Type)) {
                    return static(value);
                }

                @compileError("Unsupported type for String " ++ @typeName(Type));
            },
        }
    }

    pub fn toErrorInstance(this: String, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return this.toZigString().toErrorInstance(globalObject);
    }

    pub fn static(input: []const u8) String {
        return .{
            .tag = .StaticZigString,
            .value = .{ .StaticZigString = ZigString.init(input) },
        };
    }

    pub fn init(value: anytype) String {
        return initWithType(@TypeOf(value), value);
    }

    extern fn BunString__createExternal(
        bytes: [*]const u8,
        len: usize,
        isLatin1: bool,
        ptr: ?*anyopaque,
        callback: ?*const fn (*anyopaque, *anyopaque, u32) callconv(.C) void,
    ) String;

    pub fn createExternal(bytes: []const u8, isLatin1: bool, ctx: ?*anyopaque, callback: ?*const fn (*anyopaque, *anyopaque, u32) callconv(.C) void) String {
        return BunString__createExternal(bytes.ptr, bytes.len, isLatin1, ctx, callback);
    }

    pub fn fromUTF8(value: []const u8) String {
        return String.initWithType(ZigString, ZigString.initUTF8(value));
    }

    pub fn fromBytes(value: []const u8) String {
        return String.initWithType(ZigString, ZigString.fromBytes(value));
    }

    pub fn format(self: String, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        try self.toZigString().format(fmt, opts, writer);
    }

    pub fn fromJS(value: bun.JSC.JSValue, globalObject: *JSC.JSGlobalObject) String {
        JSC.markBinding(@src());

        var out: String = String.dead;
        if (BunString__fromJS(globalObject, value, &out)) {
            return out;
        } else {
            return String.dead;
        }
    }

    pub fn tryFromJS(value: bun.JSC.JSValue, globalObject: *JSC.JSGlobalObject) ?String {
        JSC.markBinding(@src());

        var out: String = String.dead;
        if (BunString__fromJS(globalObject, value, &out)) {
            return out;
        } else {
            return null;
        }
    }

    pub fn toJS(this: *String, globalObject: *bun.JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        return BunString__toJS(globalObject, this);
    }

    pub fn toZigString(this: String) ZigString {
        if (this.tag == .StaticZigString or this.tag == .ZigString) {
            return this.value.ZigString;
        }

        if (this.tag == .WTFStringImpl)
            return this.value.WTFStringImpl.toZigString();

        return ZigString.Empty;
    }

    pub fn toWTF(this: *String) void {
        BunString__toWTFString(this);
    }

    pub inline fn length(this: String) usize {
        return if (this.tag == .WTFStringImpl)
            this.value.WTFStringImpl.length()
        else
            this.toZigString().length();
    }

    pub inline fn utf16(self: String) []const u16 {
        if (self.tag == .Empty)
            return &[_]u16{};
        std.debug.assert(self.tag == .WTFStringImpl);
        return self.value.WTFStringImpl.utf16Slice();
    }

    pub inline fn latin1(self: String) []const u8 {
        if (self.tag == .Empty)
            return &[_]u8{};

        std.debug.assert(self.tag == .WTFStringImpl);
        return self.value.WTFStringImpl.latin1Slice();
    }

    pub fn isUTF8(self: String) bool {
        if (!self.tag == .ZigString or self.tag == .StaticZigString)
            return false;

        return self.value.ZigString.isUTF8();
    }

    pub fn encoding(self: String) bun.strings.Encoding {
        if (self.isUTF16()) {
            return .utf16;
        }

        if (self.isUTF8()) {
            return .utf8;
        }

        return .latin1;
    }

    pub fn byteSlice(this: String) []const u8 {
        return switch (this.tag) {
            .ZigString, .StaticZigString => this.value.ZigString.byteSlice(),
            .WTFStringImpl => this.value.WTFStringImpl.byteSlice(),
            else => &[_]u8{},
        };
    }

    pub fn isUTF16(self: String) bool {
        if (self.tag == .WTFStringImpl)
            return !self.value.WTFStringImpl.is8Bit();

        if (self.tag == .ZigString or self.tag == .StaticZigString)
            return self.value.ZigString.isUTF16();

        return false;
    }

    pub inline fn utf8(self: String) []const u8 {
        if (comptime bun.Environment.allow_assert)
            std.debug.assert(self.canBeUTF8());
        return self.value.ZigString.slice();
    }

    pub fn canBeUTF8(self: String) bool {
        if (self.tag == .WTFStringImpl)
            return self.value.WTFStringImpl.is8Bit() and bun.strings.isAllASCII(self.value.WTFStringImpl.latin1());

        if (self.tag == .ZigString or self.tag == .StaticZigString)
            return self.value.ZigString.isUTF8();

        return self.tag == .Empty;
    }

    pub fn substring(self: String, offset: usize) String {
        return String.init(self.toZigString().substring(offset, 0));
    }

    pub fn toUTF8(this: String, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.toUTF8(allocator);
        }

        if (this.tag == .ZigString) {
            return this.value.ZigString.toSlice(allocator);
        }

        if (this.tag == .StaticZigString) {
            return ZigString.Slice.fromUTF8NeverFree(this.value.StaticZigString.slice());
        }

        return ZigString.Slice.empty;
    }

    extern fn BunString__fromJS(globalObject: *JSC.JSGlobalObject, value: bun.JSC.JSValue, out: *String) bool;
    extern fn BunString__toJS(globalObject: *JSC.JSGlobalObject, in: *String) JSC.JSValue;
    extern fn BunString__toWTFString(this: *String) void;

    pub fn ref(this: String) void {
        switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.ref(),
            else => {},
        }
    }

    pub fn deref(this: String) void {
        switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.deref(),
            else => {},
        }
    }

    pub const unref = deref;

    pub fn eqlComptime(this: String, comptime value: []const u8) bool {
        return this.toZigString().eqlComptime(value);
    }

    pub fn hasPrefixComptime(this: String, comptime value: []const u8) bool {
        _ = value;
        _ = this;
        return false;
        // return this.toZigString().substring(0, value.len).eqlComptime(value);
    }

    pub fn isWTFAllocator(this: std.mem.Allocator) bool {
        return this.vtable == @This().StringImplAllocator.VTablePtr;
    }

    pub fn eqlBytes(this: String, value: []const u8) bool {
        return bun.strings.eqlLong(this.byteSlice(), value, true);
    }

    pub fn eql(this: String, other: String) bool {
        return this.toZigString().eql(other.toZigString());
    }
};
