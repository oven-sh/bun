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

    pub fn memoryCost(this: WTFStringImpl) usize {
        return this.byteLength();
    }

    pub fn isStatic(this: WTFStringImpl) bool {
        return this.m_refCount & s_refCountIncrement != 0;
    }

    pub fn byteLength(this: WTFStringImpl) usize {
        return if (this.is8Bit()) this.m_length else this.m_length * 2;
    }

    pub fn isThreadSafe(this: WTFStringImpl) bool {
        return bun.cpp.WTFStringImpl__isThreadSafe(this);
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
        jsc.markBinding(@src());
        const current_count = self.refCount();
        bun.assert(self.hasAtLeastOneRef()); // do not use current_count, it breaks for static strings
        bun.cpp.Bun__WTFStringImpl__deref(self);
        if (comptime bun.Environment.allow_assert) {
            if (current_count > 1) {
                bun.assert(self.refCount() < current_count or self.isStatic());
            }
        }
    }

    pub inline fn ref(self: WTFStringImpl) void {
        jsc.markBinding(@src());
        const current_count = self.refCount();
        bun.assert(self.hasAtLeastOneRef()); // do not use current_count, it breaks for static strings
        bun.cpp.Bun__WTFStringImpl__ref(self);
        bun.assert(self.refCount() > current_count or self.isStatic());
    }

    pub inline fn hasAtLeastOneRef(self: WTFStringImpl) bool {
        // WTF::StringImpl::hasAtLeastOneRef
        return self.m_refCount > 0;
    }

    pub fn toLatin1Slice(this: WTFStringImpl) ZigString.Slice {
        this.ref();
        return ZigString.Slice.init(this.refCountAllocator(), this.latin1Slice());
    }

    /// Compute the hash() if necessary
    pub fn ensureHash(this: WTFStringImpl) void {
        jsc.markBinding(@src());
        bun.cpp.Bun__WTFStringImpl__ensureHash(this);
    }

    pub fn toUTF8(this: WTFStringImpl, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.handleOom(bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()))) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return this.toLatin1Slice();
        }

        return ZigString.Slice.init(
            allocator,
            bun.handleOom(bun.strings.toUTF8Alloc(allocator, this.utf16Slice())),
        );
    }

    pub const max = std.math.maxInt(u32);

    pub fn toUTF8WithoutRef(this: WTFStringImpl, allocator: std.mem.Allocator) ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.handleOom(bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()))) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return ZigString.Slice.fromUTF8NeverFree(this.latin1Slice());
        }

        return ZigString.Slice.init(
            allocator,
            bun.handleOom(bun.strings.toUTF8Alloc(allocator, this.utf16Slice())),
        );
    }

    pub fn toOwnedSliceZ(this: WTFStringImpl, allocator: std.mem.Allocator) [:0]u8 {
        if (this.is8Bit()) {
            if (bun.handleOom(bun.strings.toUTF8FromLatin1Z(allocator, this.latin1Slice()))) |utf8| {
                return utf8.items[0 .. utf8.items.len - 1 :0];
            }

            return bun.handleOom(allocator.dupeZ(u8, this.latin1Slice()));
        }
        return bun.handleOom(bun.strings.toUTF8AllocZ(allocator, this.utf16Slice()));
    }

    pub fn toUTF8IfNeeded(this: WTFStringImpl, allocator: std.mem.Allocator) ?ZigString.Slice {
        if (this.is8Bit()) {
            if (bun.handleOom(bun.strings.toUTF8FromLatin1(allocator, this.latin1Slice()))) |utf8| {
                return ZigString.Slice.init(allocator, utf8.items);
            }

            return null;
        }

        return ZigString.Slice.init(
            allocator,
            bun.handleOom(bun.strings.toUTF8Alloc(allocator, this.utf16Slice())),
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
            return if (input.len > 0) jsc.WebCore.encoding.byteLengthU8(input.ptr, input.len, .utf8) else 0;
        } else {
            const input = this.utf16Slice();
            return if (input.len > 0) bun.strings.elementLengthUTF16IntoUTF8(input) else 0;
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
        return bun.cpp.Bun__WTFStringImpl__hasPrefix(self, text.ptr, text.len);
    }

    pub const external_shared_descriptor = struct {
        pub const ref = WTFStringImplStruct.ref;
        pub const deref = WTFStringImplStruct.deref;
    };
};

/// Behaves like `WTF::Ref<WTF::StringImpl>`.
pub const WTFString = bun.ptr.ExternalShared(WTFStringImplStruct);

pub const StringImplAllocator = struct {
    fn alloc(ptr: *anyopaque, len: usize, _: std.mem.Alignment, _: usize) ?[*]u8 {
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

    pub fn free(
        ptr: *anyopaque,
        buf: []u8,
        _: std.mem.Alignment,
        _: usize,
    ) void {
        var this = bun.cast(WTFStringImpl, ptr);
        bun.assert(this.latin1Slice().ptr == buf.ptr);
        bun.assert(this.latin1Slice().len == buf.len);
        this.deref();
    }

    pub const VTable = std.mem.Allocator.VTable{
        .alloc = &alloc,
        .resize = &std.mem.Allocator.noResize,
        .remap = &std.mem.Allocator.noRemap,
        .free = &free,
    };

    pub const VTablePtr = &VTable;
};

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const ZigString = bun.jsc.ZigString;
