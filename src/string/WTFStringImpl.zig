const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const OOM = bun.OOM;

pub const WTFStringImpl = *WTFStringImplStruct;
const ZigString = bun.JSC.ZigString;

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

    pub fn memoryCost(this: WTFStringImpl) usize {
        return this.byteLength();
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
        bun.assert(!is8Bit(self));
        return self.m_ptr.utf16[0..length(self)];
    }

    pub inline fn latin1Slice(self: WTFStringImpl) []const u8 {
        bun.assert(is8Bit(self));
        return self.m_ptr.latin1[0..length(self)];
    }

    /// Caller must ensure that the string is 8-bit and ASCII.
    pub inline fn utf8Slice(self: WTFStringImpl) []const u8 {
        if (comptime bun.Environment.allow_assert)
            bun.assert(canUseAsUTF8(self));
        return self.m_ptr.latin1[0..length(self)];
    }

    pub fn toZigString(this: WTFStringImpl) ZigString {
        if (this.is8Bit()) {
            return ZigString.init(this.latin1Slice());
        } else {
            return ZigString.initUTF16(this.utf16Slice());
        }
    }

    pub inline fn deref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.refCount();
        bun.assert(current_count > 0);
        Bun__WTFStringImpl__deref(self);
        if (comptime bun.Environment.allow_assert) {
            if (current_count > 1) {
                bun.assert(self.refCount() < current_count or self.isStatic());
            }
        }
    }

    pub inline fn ref(self: WTFStringImpl) void {
        JSC.markBinding(@src());
        const current_count = self.refCount();
        bun.assert(current_count > 0);
        Bun__WTFStringImpl__ref(self);
        bun.assert(self.refCount() > current_count or self.isStatic());
    }

    pub fn toLatin1Slice(this: WTFStringImpl) ZigString.Slice {
        this.ref();
        return ZigString.Slice.init(this.refCountAllocator(), this.latin1Slice());
    }

    extern fn Bun__WTFStringImpl__ensureHash(this: WTFStringImpl) void;
    /// Compute the hash() if necessary
    pub fn ensureHash(this: WTFStringImpl) void {
        JSC.markBinding(@src());
        Bun__WTFStringImpl__ensureHash(this);
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

    pub const max = std.math.maxInt(u32);

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

    pub fn toOwnedSliceZ(this: WTFStringImpl, allocator: std.mem.Allocator) [:0]u8 {
        if (this.is8Bit()) {
            if (bun.strings.toUTF8FromLatin1Z(allocator, this.latin1Slice()) catch bun.outOfMemory()) |utf8| {
                return utf8.items[0 .. utf8.items.len - 1 :0];
            }

            return allocator.dupeZ(u8, this.latin1Slice()) catch bun.outOfMemory();
        }
        return bun.strings.toUTF8AllocZ(allocator, this.utf16Slice()) catch bun.outOfMemory();
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

    pub fn utf16ByteLength(this: WTFStringImpl) usize {
        if (this.is8Bit()) {
            return this.length() * 2;
        } else {
            return this.length();
        }
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
        bun.assert(this.latin1Slice().ptr == buf.ptr);
        bun.assert(this.latin1Slice().len == buf.len);
        this.deref();
    }

    pub const VTable = std.mem.Allocator.VTable{
        .alloc = &alloc,
        .resize = &resize,
        .free = &free,
    };

    pub const VTablePtr = &VTable;
};
