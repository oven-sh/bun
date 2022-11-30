const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const Parent = @This();

pub const BufferOwnership = enum {
    BufferInternal,
    BufferOwned,
    BufferSubstring,
    BufferExternal,
};

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

pub const WTFStringImpl = *WTFStringImplStruct;

pub const WTFStringImplStruct = extern struct {
    m_refCount: u32 = 0,
    m_length: u32 = 0,
    m_ptr: extern union { latin1: [*]const u8, utf16: [*]const u16 },
    m_hashAndFlags: u32 = 0,

    // ---------------------------------------------------------------------

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

    pub fn toZigString(this: WTFStringImpl) ZigString {
        if (this.is8Bit()) {
            return ZigString.init(this.latin1Slice());
        } else {
            return ZigString.init16(this.utf16Slice());
        }
    }

    pub inline fn deref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.m_refCount;
        std.debug.assert(current_count > 0);
        Bun__WTFStringImpl__deref(self);
        if (comptime bun.Environment.allow_assert) {
            if (current_count > 1) {
                std.debug.assert(self.m_refCount < current_count);
            }
        }
    }

    pub inline fn ref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.m_refCount;
        std.debug.assert(current_count > 0);
        Bun__WTFStringImpl__ref(self);
        std.debug.assert(self.m_refCount > current_count);
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

    pub fn refCountAllocator(self: WTFStringImpl) std.mem.Allocator {
        return std.mem.Allocator{ .ptr = self, .vtable = StringImplAllocator.VTablePtr };
    }

    extern fn Bun__WTFStringImpl__deref(self: WTFStringImpl) void;
    extern fn Bun__WTFStringImpl__ref(self: WTFStringImpl) void;
};

pub const StringImplAllocator = struct {
    fn alloc(
        ptr: *anyopaque,
        len: usize,
        _: u29,
        _: u29,
        _: usize,
    ) error{OutOfMemory}![]u8 {
        var this = bun.cast(WTFStringImpl, ptr);
        const len_ = this.byteLength();

        if (len_ != len) {
            // we don't actually allocate, we just reference count
            return error.OutOfMemory;
        }

        this.ref();

        // we should never actually allocate
        return bun.constStrToU8(this.m_ptr.latin1[0..len]);
    }

    fn resize(
        _: *anyopaque,
        _: []u8,
        _: u29,
        _: usize,
        _: u29,
        _: usize,
    ) ?usize {
        return null;
    }

    pub fn free(
        ptr: *anyopaque,
        buf: []u8,
        _: u29,
        _: usize,
    ) void {
        var this = bun.cast(WTFStringImpl, ptr);
        std.debug.assert(this.byteSlice().ptr == buf.ptr);
        std.debug.assert(this.byteSlice().len == buf.len);
        this.deref();
    }

    pub const VTable = std.mem.Allocator.VTable{
        .alloc = alloc,
        .resize = resize,
        .free = free,
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

pub const String = extern struct {
    pub const name = "BunString";

    tag: Tag,
    value: StringImpl,

    pub const dead = String{ .tag = .Dead, .value = .{ .Dead = {} } };
    pub const StringImplAllocator = Parent.StringImplAllocator;

    pub fn initWithType(comptime Type: type, value: Type) String {
        switch (comptime Type) {
            ZigString => return String{ .tag = .ZigString, .value = .{ .ZigString = value } },
            []const u8 => return String{ .tag = .ZigString, .value = .{ .ZigString = ZigString.fromBytes(value) } },
            []const u16 => return String{ .tag = .ZigString, .value = .{ .ZigString = ZigString.from16Slice(value) } },
            WTFStringImpl => return String{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = value } },
            *const ZigString, *ZigString => return String{ .tag = .ZigString, .value = .{ .ZigString = value.* } },
            else => @compileError("Unsupported type for String"),
        }
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

    pub fn fromUTF8(value: []const u8) String {
        return String.initWithType(ZigString, ZigString.initUTF8(value));
    }

    pub fn fromBytes(value: []const u8) String {
        return String.initWithType(ZigString, ZigString.fromBytes(value));
    }

    pub fn format(self: String, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        return self.toZigString().format(fmt, opts, writer);
    }

    pub fn fromJS(value: bun.JSC.JSValue, globalObject: *JSC.JSGlobalObject) String {
        var out: String = String.dead;
        if (BunString__fromJS(globalObject, value, &out)) {
            return out;
        } else {
            return String.dead;
        }
    }

    pub fn toJS(this: *String, globalObject: *bun.JSC.JSGlobalObject) JSC.JSValue {
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
        return self.value.WTFStringImpl.utf16();
    }

    pub inline fn latin1(self: String) []const u8 {
        if (self.tag == .Empty)
            return &[_]u8{};

        std.debug.assert(self.tag == .WTFStringImpl);
        return self.value.WTFStringImpl.latin1();
    }

    pub fn isUTF8(self: String) bool {
        if (!self.tag == .ZigString or self.tag == .StaticZigString)
            return false;

        return self.value.ZigString.isUTF8();
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
        return String.init(self.toZigString().substring(offset));
    }

    pub fn toUTF8(this: *const String, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.toUTF8(allocator);
        }

        if (this.tag == .ZigString) {
            return this.value.ZigString.toSlice(allocator);
        }

        if (this.tag == .StaticZigString) {
            return ZigString.Slice.fromUTF8NeverFree(this.value.StaticZigString.slice());
        }

        return .{};
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

    pub fn isWTFAllocator(this: std.mem.Allocator) bool {
        return this.vtable == @This().StringImplAllocator.VTablePtr;
    }

    pub fn eqlBytes(this: String, value: []const u8) bool {
        return bun.strings.eqlLong(this.byteSlice(), value, true);
    }
};
