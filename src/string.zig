const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const Parent = @This();

pub const BufferOwnership = enum(u32) {
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

    extern fn WTFStringImpl__isThreadSafe(WTFStringImpl) bool;
    pub fn isThreadSafe(this: WTFStringImpl) bool {
        return WTFStringImpl__isThreadSafe(this);
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

    pub fn toLatin1Slice(this: WTFStringImpl) ZigString.Slice {
        this.ref();
        return ZigString.Slice.init(this.refCountAllocator(), this.latin1Slice());
    }

    pub fn toUTF8(this: WTFStringImpl, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()) catch bun.outOfMemory()) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return this.toLatin1Slice();
        }

        return ZigString.Slice.init(
            allocator,
            bun.strings.toUTF8Alloc(allocator, this.utf16Slice()) catch bun.outOfMemory(),
        );
    }

    pub fn toUTF8WithoutRef(this: WTFStringImpl, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()) catch bun.outOfMemory()) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return ZigString.Slice.fromUTF8NeverFree(this.latin1Slice());
        }

        return ZigString.Slice.init(
            allocator,
            bun.strings.toUTF8Alloc(allocator, this.utf16Slice()) catch bun.outOfMemory(),
        );
    }

    pub fn toUTF8IfNeeded(this: WTFStringImpl, allocator: std.mem.Allocator) ?ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()) catch bun.outOfMemory()) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return null;
        }

        return ZigString.Slice.init(
            allocator,
            bun.strings.toUTF8Alloc(allocator, this.utf16Slice()) catch bun.outOfMemory(),
        );
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

    pub fn utf16ByteLength(this: WTFStringImpl) usize {
        // All latin1 characters fit in a single UTF-16 code unit.
        return this.length() * 2;
    }

    pub fn latin1ByteLength(this: WTFStringImpl) usize {
        // Not all UTF-16 characters fit are representable in latin1.
        // Those get truncated?
        return this.length();
    }

    pub fn refCountAllocator(self: WTFStringImpl) std.mem.Allocator {
        return std.mem.Allocator{ .ptr = self, .vtable = StringImplAllocator.VTablePtr };
    }

    pub fn hasPrefix(self: WTFStringImpl, text: []const u8) bool {
        return Bun__WTFStringImpl__hasPrefix(self, text.ptr, text.len);
    }

    extern fn Bun__WTFStringImpl__deref(self: WTFStringImpl) void;
    extern fn Bun__WTFStringImpl__ref(self: WTFStringImpl) void;
    extern fn Bun__WTFStringImpl__hasPrefix(self: *const WTFStringImplStruct, offset: [*]const u8, length: usize) bool;
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
        std.debug.assert(this.latin1Slice().ptr == buf.ptr);
        std.debug.assert(this.latin1Slice().len == buf.len);
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
    extern fn BunString__fromUTF16(bytes: [*]const u16, len: usize) String;
    extern fn BunString__fromUTF16ToLatin1(bytes: [*]const u16, len: usize) String;
    extern fn BunString__fromLatin1Unitialized(len: usize) String;
    extern fn BunString__fromUTF16Unitialized(len: usize) String;

    pub fn isGlobal(this: String) bool {
        return this.tag == Tag.ZigString and this.value.ZigString.isGloballyAllocated();
    }

    pub fn toOwnedSlice(this: String, allocator: std.mem.Allocator) ![]u8 {
        switch (this.tag) {
            .ZigString => return try this.value.ZigString.toOwnedSlice(allocator),
            .WTFStringImpl => {
                var utf8_slice = this.value.WTFStringImpl.toUTF8WithoutRef(allocator);

                if (utf8_slice.allocator.get()) |alloc| {
                    if (!isWTFAllocator(alloc)) {
                        return @constCast(utf8_slice.slice());
                    }
                }

                return @constCast((try utf8_slice.clone(allocator)).slice());
            },
            .StaticZigString => return try this.value.StaticZigString.toOwnedSlice(allocator),
            .Empty => return &[_]u8{},
            else => unreachable,
        }
    }

    fn createUninitializedLatin1(len: usize) struct { String, []u8 } {
        std.debug.assert(len > 0);
        const string = BunString__fromLatin1Unitialized(len);
        const wtf = string.value.WTFStringImpl;
        return .{
            string,
            @constCast(wtf.m_ptr.latin1[0..wtf.m_length]),
        };
    }

    fn createUninitializedUTF16(len: usize) struct { String, []u16 } {
        std.debug.assert(len > 0);
        const string = BunString__fromUTF16Unitialized(len);
        const wtf = string.value.WTFStringImpl;
        return .{
            string,
            @constCast(wtf.m_ptr.utf16[0..wtf.m_length]),
        };
    }

    const WTFStringEncoding = enum {
        latin1,
        utf16,

        pub fn Byte(comptime this: WTFStringEncoding) type {
            return switch (this) {
                .latin1 => u8,
                .utf16 => u16,
            };
        }
    };

    /// Allocate memory for a WTF::String of a given length and encoding, and
    /// return the string and a mutable slice for that string.
    ///
    /// This is not allowed on zero-length strings, in this case you should
    /// check earlier and use String.empty in that case.
    pub fn createUninitialized(
        comptime kind: WTFStringEncoding,
        len: usize,
    ) struct { String, [](kind.Byte()) } {
        std.debug.assert(len > 0);
        return switch (comptime kind) {
            .latin1 => createUninitializedLatin1(len),
            .utf16 => createUninitializedUTF16(len),
        };
    }

    pub fn createLatin1(bytes: []const u8) String {
        JSC.markBinding(@src());
        if (bytes.len == 0) return String.empty;
        return BunString__fromLatin1(bytes.ptr, bytes.len);
    }

    pub fn createUTF8(bytes: []const u8) String {
        JSC.markBinding(@src());
        if (bytes.len == 0) return String.empty;
        return BunString__fromBytes(bytes.ptr, bytes.len);
    }

    pub fn createUTF16(bytes: []const u16) String {
        if (bytes.len == 0) return String.empty;
        if (bun.strings.firstNonASCII16CheckMin([]const u16, bytes, false) == null) {
            return BunString__fromUTF16ToLatin1(bytes.ptr, bytes.len);
        }
        return BunString__fromUTF16(bytes.ptr, bytes.len);
    }

    pub fn createFromOSPath(os_path: bun.OSPathSlice) String {
        return switch (@TypeOf(os_path)) {
            []const u8 => createUTF8(os_path),
            []const u16 => createUTF16(os_path),
            else => comptime unreachable,
        };
    }

    pub fn isEmpty(this: String) bool {
        return this.tag == .Empty or this.length() == 0;
    }

    pub fn dupeRef(this: String) String {
        this.ref();
        return this;
    }

    pub fn clone(this: String) String {
        if (this.tag == .WTFStringImpl) {
            return this.dupeRef();
        }

        if (this.isEmpty()) {
            return String.empty;
        }

        if (this.isUTF16()) {
            const new, const bytes = createUninitialized(.utf16, this.length());
            @memcpy(bytes, this.value.ZigString.utf16Slice());
            return new;
        }

        return createUTF8(this.byteSlice());
    }

    extern fn BunString__createAtom(bytes: [*]const u8, len: usize) String;
    extern fn BunString__tryCreateAtom(bytes: [*]const u8, len: usize) String;

    /// Must be given ascii input
    pub fn createAtomASCII(bytes: []const u8) String {
        return BunString__createAtom(bytes.ptr, bytes.len);
    }

    /// Will return null if the input is non-ascii or too long
    pub fn tryCreateAtom(bytes: []const u8) ?String {
        const atom = BunString__tryCreateAtom(bytes.ptr, bytes.len);
        return if (atom.tag == .Dead) null else atom;
    }

    /// Atomized strings are interned strings
    /// They're de-duplicated in a threadlocal hash table
    /// They cannot be used from other threads.
    pub fn createAtomIfPossible(bytes: []const u8) String {
        if (bytes.len < 64) {
            if (tryCreateAtom(bytes)) |atom| {
                return atom;
            }
        }

        return createUTF8(bytes);
    }

    pub fn utf8ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.utf8ByteLength(),
            .ZigString => this.value.ZigString.utf8ByteLength(),
            .StaticZigString => this.value.StaticZigString.utf8ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    pub fn utf16ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.utf16ByteLength(),
            .StaticZigString, .ZigString => this.value.ZigString.utf16ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    pub fn latin1ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.latin1ByteLength(),
            .StaticZigString, .ZigString => this.value.ZigString.latin1ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    /// Create a bun.String from a slice. This is never a copy.
    /// For strings created from static string literals, use `String.static`
    pub fn init(value: anytype) String {
        const Type = @TypeOf(value);
        return switch (Type) {
            String => value,
            ZigString => .{ .tag = .ZigString, .value = .{ .ZigString = value } },
            [:0]u8, []u8, [:0]const u8, []const u8 => .{ .tag = .ZigString, .value = .{ .ZigString = ZigString.fromBytes(value) } },
            [:0]u16, []u16, [:0]const u16, []const u16 => .{ .tag = .ZigString, .value = .{ .ZigString = ZigString.from16Slice(value) } },
            WTFStringImpl => .{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = value } },
            *const ZigString, *ZigString => .{ .tag = .ZigString, .value = .{ .ZigString = value.* } },
            *const [0:0]u8 => .{ .tag = .Empty, .value = .{ .Empty = {} } },
            else => {
                const info = @typeInfo(Type);

                // Zig string literals
                if (info == .Pointer and info.Pointer.size == .One and info.Pointer.is_const) {
                    const child_info = @typeInfo(info.Pointer.child);
                    if (child_info == .Array and child_info.Array.child == u8) {
                        if (child_info.Array.len == 0) return String.empty;
                        return static(value);
                    }
                }

                @compileError("Unsupported type for String " ++ @typeName(Type));
            },
        };
    }

    pub fn static(input: []const u8) String {
        return .{
            .tag = .StaticZigString,
            .value = .{ .StaticZigString = ZigString.init(input) },
        };
    }

    pub fn toErrorInstance(this: *const String, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        defer this.deref();
        return JSC__createError(globalObject, this);
    }

    extern fn BunString__createExternal(
        bytes: [*]const u8,
        len: usize,
        isLatin1: bool,
        ptr: ?*anyopaque,
        callback: ?*const fn (*anyopaque, *anyopaque, u32) callconv(.C) void,
    ) String;

    pub fn createExternal(bytes: []const u8, isLatin1: bool, ctx: ?*anyopaque, callback: ?*const fn (*anyopaque, *anyopaque, u32) callconv(.C) void) String {
        JSC.markBinding(@src());
        std.debug.assert(bytes.len > 0);
        return BunString__createExternal(bytes.ptr, bytes.len, isLatin1, ctx, callback);
    }

    extern fn BunString__createExternalGloballyAllocatedLatin1(
        bytes: [*]u8,
        len: usize,
    ) String;

    extern fn BunString__createExternalGloballyAllocatedUTF16(
        bytes: [*]u16,
        len: usize,
    ) String;

    pub fn createExternalGloballyAllocated(comptime kind: WTFStringEncoding, bytes: []kind.Byte()) String {
        JSC.markBinding(@src());
        std.debug.assert(bytes.len > 0);

        return switch (comptime kind) {
            .latin1 => BunString__createExternalGloballyAllocatedLatin1(bytes.ptr, bytes.len),
            .utf16 => BunString__createExternalGloballyAllocatedUTF16(bytes.ptr, bytes.len),
        };
    }

    pub fn fromUTF8(value: []const u8) String {
        return String.init(ZigString.initUTF8(value));
    }

    pub fn fromBytes(value: []const u8) String {
        return String.init(ZigString.fromBytes(value));
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

    pub fn toJS(this: *const String, globalObject: *bun.JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        return BunString__toJS(globalObject, this);
    }

    pub fn toJSDOMURL(this: *String, globalObject: *bun.JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        return BunString__toJSDOMURL(globalObject, this);
    }

    extern fn BunString__createArray(
        globalObject: *bun.JSC.JSGlobalObject,
        ptr: [*]const String,
        len: usize,
    ) JSC.JSValue;

    pub fn toJSArray(globalObject: *bun.JSC.JSGlobalObject, array: []const bun.String) JSC.JSValue {
        JSC.markBinding(@src());

        return BunString__createArray(globalObject, array.ptr, array.len);
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
        JSC.markBinding(@src());

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
        if (self.tag == .WTFStringImpl) {
            return self.value.WTFStringImpl.utf16Slice();
        }

        return self.toZigString().utf16SliceAligned();
    }

    pub inline fn latin1(self: String) []const u8 {
        if (self.tag == .Empty)
            return &[_]u8{};

        if (self.tag == .WTFStringImpl) {
            return self.value.WTFStringImpl.latin1Slice();
        }

        return self.toZigString().slice();
    }

    pub fn isUTF8(self: String) bool {
        if (!(self.tag == .ZigString or self.tag == .StaticZigString))
            return false;

        return self.value.ZigString.isUTF8();
    }

    pub inline fn asUTF8(self: String) ?[]const u8 {
        if (self.tag == .WTFStringImpl) {
            if (self.value.WTFStringImpl.is8Bit() and bun.strings.isAllASCII(self.value.WTFStringImpl.latin1Slice())) {
                return self.value.WTFStringImpl.latin1Slice();
            }

            return null;
        }

        if (self.tag == .ZigString or self.tag == .StaticZigString) {
            if (self.value.ZigString.isUTF8()) {
                return self.value.ZigString.slice();
            }

            if (bun.strings.isAllASCII(self.toZigString().slice())) {
                return self.value.ZigString.slice();
            }

            return null;
        }

        return "";
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

    pub fn githubAction(self: String) ZigString.GithubActionFormatter {
        return self.toZigString().githubAction();
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
            return self.value.ZigString.is16Bit();

        return false;
    }

    extern fn BunString__toJSON(
        globalObject: *bun.JSC.JSGlobalObject,
        this: *String,
    ) JSC.JSValue;

    pub fn toJSByParseJSON(self: *String, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return BunString__toJSON(globalObject, self);
    }

    pub fn encodeInto(self: String, out: []u8, comptime enc: JSC.Node.Encoding) !usize {
        if (self.isUTF16()) {
            return JSC.WebCore.Encoder.encodeIntoFrom16(self.utf16(), out, enc, true);
        }

        if (self.isUTF8()) {
            @panic("TODO");
        }

        return JSC.WebCore.Encoder.encodeIntoFrom8(self.latin1(), out, enc);
    }

    pub fn encode(self: String, enc: JSC.Node.Encoding) []u8 {
        return self.toZigString().encode(enc);
    }

    pub inline fn utf8(self: String) []const u8 {
        if (comptime bun.Environment.allow_assert)
            std.debug.assert(self.canBeUTF8());
        return self.value.ZigString.slice();
    }

    pub fn canBeUTF8(self: String) bool {
        if (self.tag == .WTFStringImpl)
            return self.value.WTFStringImpl.is8Bit() and bun.strings.isAllASCII(self.value.WTFStringImpl.latin1Slice());

        if (self.tag == .ZigString or self.tag == .StaticZigString) {
            if (self.value.ZigString.isUTF8()) {
                return true;
            }

            return bun.strings.isAllASCII(self.toZigString().slice());
        }

        return self.tag == .Empty;
    }

    pub fn substring(this: String, start_index: usize) String {
        const len = this.length();
        return this.substringWithLen(@min(len, start_index), len);
    }

    pub fn substringWithLen(this: String, start_index: usize, end_index: usize) String {
        switch (this.tag) {
            .ZigString, .StaticZigString => {
                return String.init(this.value.ZigString.substringWithLen(start_index, end_index));
            },
            .WTFStringImpl => {
                if (this.value.WTFStringImpl.is8Bit()) {
                    return String.init(ZigString.init(this.value.WTFStringImpl.latin1Slice()[start_index..end_index]));
                } else {
                    return String.init(ZigString.init16(this.value.WTFStringImpl.utf16Slice()[start_index..end_index]));
                }
            },
            else => return this,
        }
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

    /// This is the same as toUTF8, but it doesn't increment the reference count for latin1 strings
    pub fn toUTF8WithoutRef(this: String, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.toUTF8WithoutRef(allocator);
        }

        if (this.tag == .ZigString) {
            return this.value.ZigString.toSlice(allocator);
        }

        if (this.tag == .StaticZigString) {
            return ZigString.Slice.fromUTF8NeverFree(this.value.StaticZigString.slice());
        }

        return ZigString.Slice.empty;
    }

    pub fn toSlice(this: String, allocator: std.mem.Allocator) SliceWithUnderlyingString {
        return SliceWithUnderlyingString{
            .utf8 = this.toUTF8(allocator),
            .underlying = this,
        };
    }

    pub fn toThreadSafeSlice(this: *String, allocator: std.mem.Allocator) SliceWithUnderlyingString {
        if (this.tag == .WTFStringImpl) {
            if (!this.value.WTFStringImpl.isThreadSafe()) {
                const slice = this.value.WTFStringImpl.toUTF8WithoutRef(allocator);

                if (slice.allocator.isNull()) {
                    // this was a WTF-allocated string
                    // We're going to need to clone it across the threads
                    // so let's just do that now instead of creating another copy.
                    return .{
                        .utf8 = ZigString.Slice.init(allocator, allocator.dupe(u8, slice.slice()) catch bun.outOfMemory()),
                    };
                }

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(!isWTFAllocator(slice.allocator.get().?)); // toUTF8WithoutRef() should never return a WTF allocator
                    std.debug.assert(slice.allocator.get().?.vtable == allocator.vtable); // assert that the allocator is the same
                }

                // We've already cloned the string, so let's just return the slice.
                return .{
                    .utf8 = slice,
                    .underlying = empty,
                };
            } else {
                const slice = this.value.WTFStringImpl.toUTF8WithoutRef(allocator);

                // this WTF-allocated string is already thread safe
                // and it's ASCII, so we can just use it directly
                if (slice.allocator.isNull()) {
                    // Once for the string
                    this.ref();

                    // Once for the utf8 slice
                    this.ref();

                    // We didn't clone anything, so let's conserve memory by re-using the existing WTFStringImpl
                    return .{
                        .utf8 = ZigString.Slice.init(this.value.WTFStringImpl.refCountAllocator(), slice.slice()),
                        .underlying = this.*,
                    };
                }

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(!isWTFAllocator(slice.allocator.get().?)); // toUTF8WithoutRef() should never return a WTF allocator
                    std.debug.assert(slice.allocator.get().?.vtable == allocator.vtable); // assert that the allocator is the same
                }

                // We did have to clone the string. Let's avoid keeping the WTFStringImpl around
                // for longer than necessary, since the string could potentially have a single
                // reference count and that means excess memory usage
                return .{
                    .utf8 = slice,
                };
            }
        }

        return this.toSlice(allocator);
    }

    extern fn BunString__fromJS(globalObject: *JSC.JSGlobalObject, value: bun.JSC.JSValue, out: *String) bool;
    extern fn BunString__toJS(globalObject: *JSC.JSGlobalObject, in: *const String) JSC.JSValue;
    extern fn BunString__toJSWithLength(globalObject: *JSC.JSGlobalObject, in: *const String, usize) JSC.JSValue;
    extern fn BunString__toJSDOMURL(globalObject: *JSC.JSGlobalObject, in: *String) JSC.JSValue;
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

    pub fn is8Bit(this: String) bool {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.is8Bit(),
            .ZigString => !this.value.ZigString.is16Bit(),
            else => true,
        };
    }

    pub fn charAt(this: String, index: usize) u16 {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(index < this.length());
        }
        return switch (this.tag) {
            .WTFStringImpl => if (this.value.WTFStringImpl.is8Bit()) @intCast(this.value.WTFStringImpl.utf8Slice()[index]) else this.value.WTFStringImpl.utf16Slice()[index],
            .ZigString, .StaticZigString => if (!this.value.ZigString.is16Bit()) @intCast(this.value.ZigString.slice()[index]) else this.value.ZigString.utf16Slice()[index],
            else => 0,
        };
    }

    pub fn charAtU8(this: String, index: usize) u8 {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(index < this.length());
        }
        return switch (this.tag) {
            .WTFStringImpl => if (this.value.WTFStringImpl.is8Bit()) this.value.WTFStringImpl.utf8Slice()[index] else @truncate(this.value.WTFStringImpl.utf16Slice()[index]),
            .ZigString, .StaticZigString => if (!this.value.ZigString.is16Bit()) this.value.ZigString.slice()[index] else @truncate(this.value.ZigString.utf16SliceAligned()[index]),
            else => 0,
        };
    }

    pub fn indexOfAsciiChar(this: String, chr: u8) ?usize {
        std.debug.assert(chr < 128);
        return switch (this.isUTF16()) {
            true => std.mem.indexOfScalar(u16, this.utf16(), @intCast(chr)),
            false => bun.strings.indexOfCharUsize(this.byteSlice(), chr),
        };
    }

    pub fn visibleWidth(this: *const String) usize {
        if (this.isUTF8()) {
            return bun.strings.visible.width.utf8(this.utf8());
        } else if (this.isUTF16()) {
            return bun.strings.visible.width.utf16(this.utf16());
        } else {
            return bun.strings.visible.width.ascii(this.latin1());
        }
    }

    pub fn visibleWidthExcludeANSIColors(this: *const String) usize {
        if (this.isUTF8()) {
            return bun.strings.visible.width.exclude_ansi_colors.utf8(this.utf8());
        } else if (this.isUTF16()) {
            return bun.strings.visible.width.exclude_ansi_colors.utf16(this.utf16());
        } else {
            return bun.strings.visible.width.exclude_ansi_colors.ascii(this.latin1());
        }
    }

    pub fn indexOfComptimeWithCheckLen(this: String, comptime values: []const []const u8, comptime check_len: usize) ?usize {
        if (this.is8Bit()) {
            const bytes = this.byteSlice();
            for (values, 0..) |val, i| {
                if (bun.strings.eqlComptimeCheckLenWithType(u8, bytes, val, check_len)) {
                    return i;
                }
            }

            return null;
        }

        const u16_bytes = this.byteSlice();
        inline for (values, 0..) |val, i| {
            if (bun.strings.eqlComptimeCheckLenWithType(u16, u16_bytes, comptime bun.strings.toUTF16Literal(val), check_len)) {
                return i;
            }
        }

        return null;
    }

    pub fn indexOfComptimeArrayAssumeSameLength(this: String, comptime values: []const []const u8) ?usize {
        if (this.is8Bit()) {
            const bytes = this.byteSlice();

            inline for (0..values.len) |i| {
                std.debug.assert(bytes.len == values[i].len);
                if (bun.strings.eqlComptimeCheckLenWithType(u8, bytes, values[i], false)) {
                    return i;
                }
            }

            return null;
        }

        const u16_bytes = this.utf16();
        var buffer: [values[0].len]u8 = undefined;
        inline for (0..values[0].len) |i| {
            const uchar = u16_bytes[i];
            if (uchar > 255)
                return null;

            buffer[i] = @as(u8, @intCast(uchar));
        }

        inline for (0..values.len) |i| {
            if (bun.strings.eqlComptimeCheckLenWithType(u8, &buffer, values[i], false)) {
                return i;
            }
        }

        return null;
    }

    pub fn inMap(this: String, comptime ComptimeStringMap: anytype) ?ComptimeStringMap.Value {
        return ComptimeStringMap.getWithEqlList(this, indexOfComptimeArrayAssumeSameLength);
    }

    pub fn inMapCaseInsensitive(this: String, comptime ComptimeStringMap: anytype) ?ComptimeStringMap.Value {
        return ComptimeStringMap.getWithEqlList(this, indexOfComptimeArrayCaseInsensitiveSameLength);
    }

    pub fn indexOfComptimeArrayCaseInsensitiveSameLength(this: String, comptime values: []const []const u8) ?usize {
        if (this.is8Bit()) {
            const bytes = this.byteSlice();

            inline for (0..values.len) |i| {
                std.debug.assert(bytes.len == values[i].len);
                if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(bytes, values[i])) {
                    return i;
                }
            }

            return null;
        }

        const u16_bytes = this.utf16();
        const buffer: [values[0].len]u8 = brk: {
            var bytes: [values[0].len]u8 = undefined;
            for (&bytes, u16_bytes) |*byte, uchar| {
                if (uchar > 255)
                    return null;

                byte.* = @as(u8, @intCast(uchar));
            }
            break :brk bytes;
        };

        inline for (0..values.len) |i| {
            if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(&buffer, values[i])) {
                return i;
            }
        }

        return null;
    }

    pub fn hasPrefixComptime(this: String, comptime value: []const u8) bool {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.hasPrefix(value);
        }

        var str = this.toZigString();
        if (str.len < value.len) return false;

        return str.substringWithLen(0, value.len).eqlComptime(value);
    }

    pub fn isWTFAllocator(this: std.mem.Allocator) bool {
        return this.vtable == @This().StringImplAllocator.VTablePtr;
    }

    pub fn eqlBytes(this: String, value: []const u8) bool {
        return bun.strings.eqlLong(this.byteSlice(), value, true);
    }

    extern fn BunString__toThreadSafe(this: *String) void;

    /// Does not increment the reference count unless the StringImpl is cloned.
    pub fn toThreadSafe(this: *String) void {
        JSC.markBinding(@src());

        if (this.tag == .WTFStringImpl) {
            BunString__toThreadSafe(this);
        }
    }

    /// We don't ref unless the underlying StringImpl is new.
    ///
    /// This will ref even if it doesn't change.
    pub fn toThreadSafeEnsureRef(this: *String) void {
        JSC.markBinding(@src());

        if (this.tag == .WTFStringImpl) {
            const orig = this.value.WTFStringImpl;
            BunString__toThreadSafe(this);
            if (this.value.WTFStringImpl == orig) {
                orig.ref();
            }
        }
    }

    pub fn eqlUTF8(this: String, other: []const u8) bool {
        return this.toZigString().eql(ZigString.fromUTF8(other));
    }

    pub fn eql(this: String, other: String) bool {
        return this.toZigString().eql(other.toZigString());
    }

    extern fn JSC__createError(*JSC.JSGlobalObject, str: *const String) JSC.JSValue;

    fn concat(comptime n: usize, allocator: std.mem.Allocator, strings: *const [n]String) !String {
        var num_16bit: usize = 0;
        inline for (strings) |str| {
            if (!str.is8Bit()) num_16bit += 1;
        }

        if (num_16bit == n) {
            // all are 16bit
            var slices: [n][]const u16 = undefined;
            for (strings, 0..) |str, i| {
                slices[i] = switch (str.tag) {
                    .WTFStringImpl => str.value.WTFStringImpl.utf16Slice(),
                    .ZigString, .StaticZigString => str.value.ZigString.utf16SliceAligned(),
                    else => &[_]u16{},
                };
            }
            const result = try std.mem.concat(allocator, u16, &slices);
            return init(ZigString.from16Slice(result));
        } else {
            // either all 8bit, or mixed 8bit and 16bit
            var slices_holded: [n]SliceWithUnderlyingString = undefined;
            var slices: [n][]const u8 = undefined;
            inline for (strings, 0..) |str, i| {
                slices_holded[i] = str.toSlice(allocator);
                slices[i] = slices_holded[i].slice();
            }
            const result = try std.mem.concat(allocator, u8, &slices);
            inline for (0..n) |i| {
                slices_holded[i].deinit();
            }
            return createUTF8(result);
        }
    }

    /// Creates a new String from a given tuple (of comptime-known size) of String.
    ///
    /// Note: the callee owns the resulting string and must call `.deref()` on it once done
    pub inline fn createFromConcat(allocator: std.mem.Allocator, strings: anytype) !String {
        return try concat(strings.len, allocator, strings);
    }

    pub export fn BunString__getStringWidth(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args.ptr[0].isString()) {
            return JSC.jsNumber(@as(i32, 0));
        }

        const str = args[0].toBunString(globalObject);
        defer str.deref();

        if (str.isEmpty()) {
            return JSC.jsNumber(@as(i32, 0));
        }

        const width = str.visibleWidth();
        return JSC.jsNumber(width);
    }
};

pub const SliceWithUnderlyingString = struct {
    utf8: ZigString.Slice = ZigString.Slice.empty,
    underlying: String = String.dead,

    did_report_extra_memory_debug: bun.DebugOnly(bool) = if (bun.Environment.allow_assert) false else {},

    pub inline fn reportExtraMemory(this: *SliceWithUnderlyingString, vm: *JSC.VM) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(!this.did_report_extra_memory_debug);
            this.did_report_extra_memory_debug = true;
        }
        this.utf8.reportExtraMemory(vm);
    }

    pub fn isWTFAllocated(this: *const SliceWithUnderlyingString) bool {
        if (this.utf8.allocator.get()) |allocator| {
            const is_wtf_allocator = String.isWTFAllocator(allocator);

            return is_wtf_allocator;
        }

        return false;
    }

    pub fn dupeRef(this: SliceWithUnderlyingString) SliceWithUnderlyingString {
        return .{
            .utf8 = ZigString.Slice.empty,
            .underlying = this.underlying.dupeRef(),
        };
    }

    /// Transcode a byte array to an encoded String, avoiding unnecessary copies.
    ///
    /// owned_input_bytes ownership is transferred to this function
    pub fn transcodeFromOwnedSlice(owned_input_bytes: []u8, encoding: JSC.Node.Encoding) SliceWithUnderlyingString {
        if (owned_input_bytes.len == 0) {
            return .{
                .utf8 = ZigString.Slice.empty,
                .underlying = String.empty,
            };
        }

        return .{
            .underlying = JSC.WebCore.Encoder.toBunStringFromOwnedSlice(owned_input_bytes, encoding),
        };
    }

    /// Assumes default allocator in use
    pub fn fromUTF8(utf8: []const u8) SliceWithUnderlyingString {
        return .{
            .utf8 = ZigString.Slice.init(bun.default_allocator, utf8),
            .underlying = String.dead,
        };
    }

    pub fn toThreadSafe(this: *SliceWithUnderlyingString) void {
        if (this.underlying.tag == .WTFStringImpl) {
            var orig = this.underlying.value.WTFStringImpl;
            this.underlying.toThreadSafe();
            if (this.underlying.value.WTFStringImpl != orig) {
                orig.deref();

                if (this.utf8.allocator.get()) |allocator| {
                    if (String.isWTFAllocator(allocator)) {
                        this.utf8.deinit();
                        this.utf8 = this.underlying.value.WTFStringImpl.toLatin1Slice();
                    }
                }
            }
        }
    }

    pub fn deinit(this: SliceWithUnderlyingString) void {
        this.utf8.deinit();
        this.underlying.deref();
    }

    pub fn slice(this: SliceWithUnderlyingString) []const u8 {
        return this.utf8.slice();
    }

    pub fn format(self: SliceWithUnderlyingString, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        if (self.utf8.len == 0) {
            try self.underlying.format(fmt, opts, writer);
            return;
        }

        try writer.writeAll(self.utf8.slice());
    }

    pub fn toJS(this: *SliceWithUnderlyingString, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        if ((this.underlying.tag == .Dead or this.underlying.tag == .Empty) and this.utf8.length() > 0) {
            if (comptime bun.Environment.allow_assert) {
                if (this.utf8.allocator.get()) |allocator| {
                    std.debug.assert(!String.isWTFAllocator(allocator)); // We should never enter this state.
                }
            }

            if (this.utf8.allocator.get()) |_| {
                if (bun.strings.toUTF16Alloc(bun.default_allocator, this.utf8.slice(), false, false) catch null) |utf16| {
                    this.utf8.deinit();
                    this.utf8 = .{};
                    return JSC.ZigString.toExternalU16(utf16.ptr, utf16.len, globalObject);
                } else {
                    const js_value = ZigString.init(this.utf8.slice()).toExternalValue(
                        globalObject,
                    );
                    this.utf8 = .{};
                    return js_value;
                }
            }

            const out = bun.String.createUTF8(this.utf8.slice());
            defer out.deref();
            return out.toJS(globalObject);
        }

        return this.underlying.toJS(globalObject);
    }
};
