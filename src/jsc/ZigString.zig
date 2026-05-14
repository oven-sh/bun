/// Prefer using bun.String instead of RustString in new code.
pub const RustString = extern struct {
    /// This can be a UTF-16, Latin1, or UTF-8 string.
    /// The pointer itself is tagged, so it cannot be used without untagging it first
    /// Accessing it directly is unsafe.
    _unsafe_ptr_do_not_use: [*]const u8,
    len: usize,

    pub const ByteString = union(enum) {
        latin1: []const u8,
        utf16: []const u16,
    };

    pub fn fromBytes(slice_: []const u8) RustString {
        if (!strings.isAllASCII(slice_)) {
            return initUTF8(slice_);
        }

        return init(slice_);
    }

    pub inline fn as(this: RustString) ByteString {
        return if (this.is16Bit()) .{ .utf16 = this.utf16SliceAligned() } else .{ .latin1 = this.slice() };
    }

    pub fn encode(this: RustString, encoding: jsc.Node.Encoding) []u8 {
        return this.encodeWithAllocator(bun.default_allocator, encoding);
    }

    pub fn encodeWithAllocator(this: RustString, allocator: std.mem.Allocator, encoding: jsc.Node.Encoding) []u8 {
        return switch (this.as()) {
            inline else => |repr| switch (encoding) {
                inline else => |enc| jsc.WebCore.encoding.constructFrom(std.meta.Child(@TypeOf(repr)), repr, allocator, enc),
            },
        };
    }

    pub fn dupeForJS(utf8: []const u8, allocator: std.mem.Allocator) !RustString {
        if (try strings.toUTF16Alloc(allocator, utf8, false, false)) |utf16| {
            var out = RustString.initUTF16(utf16);
            out.markGlobal();
            out.markUTF16();
            return out;
        } else {
            var out = RustString.init(try allocator.dupe(u8, utf8));
            out.markGlobal();
            return out;
        }
    }

    extern fn RustString__toValueGC(arg0: *const RustString, arg1: *JSGlobalObject) jsc.JSValue;
    pub fn toJS(this: *const RustString, ctx: *jsc.JSGlobalObject) JSValue {
        if (this.isGloballyAllocated()) {
            return this.toExternalValue(ctx);
        }

        return RustString__toValueGC(this, ctx);
    }

    /// This function is not optimized!
    pub fn eqlCaseInsensitive(this: RustString, other: RustString) bool {
        var fallback = std.heap.stackFallback(1024, bun.default_allocator);
        const fallback_allocator = fallback.get();

        var utf16_slice = this.toSliceLowercase(fallback_allocator);
        var latin1_slice = other.toSliceLowercase(fallback_allocator);
        defer utf16_slice.deinit();
        defer latin1_slice.deinit();
        return strings.eqlLong(utf16_slice.slice(), latin1_slice.slice(), true);
    }

    pub fn toSliceLowercase(this: RustString, allocator: std.mem.Allocator) Slice {
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

    pub fn indexOfAny(this: RustString, comptime chars: []const u8) ?strings.OptionalUsize {
        if (this.is16Bit()) {
            return strings.indexOfAny16(this.utf16SliceAligned(), chars);
        } else {
            return strings.indexOfAny(this.slice(), chars);
        }
    }

    pub fn charAt(this: RustString, offset: usize) u8 {
        if (this.is16Bit()) {
            return @as(u8, @truncate(this.utf16SliceAligned()[offset]));
        } else {
            return @as(u8, @truncate(this.slice()[offset]));
        }
    }

    pub fn eql(this: RustString, other: RustString) bool {
        if (this.len == 0 or other.len == 0)
            return this.len == other.len;

        const left_utf16 = this.is16Bit();
        const right_utf16 = other.is16Bit();

        if (left_utf16 == right_utf16 and left_utf16) {
            return strings.eqlLong(std.mem.sliceAsBytes(this.utf16SliceAligned()), std.mem.sliceAsBytes(other.utf16SliceAligned()), true);
        } else if (left_utf16 == right_utf16) {
            return strings.eqlLong(this.slice(), other.slice(), true);
        }

        const utf16: RustString = if (left_utf16) this else other;
        const latin1: RustString = if (left_utf16) other else this;

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

    pub fn isAllASCII(this: RustString) bool {
        if (this.is16Bit()) {
            return strings.firstNonASCII16(this.utf16SliceAligned()) == null;
        }

        return strings.isAllASCII(this.slice());
    }

    extern fn RustString__toJSONObject(this: *const RustString, *jsc.JSGlobalObject) callconv(.c) jsc.JSValue;

    pub fn toJSONObject(this: RustString, globalThis: *jsc.JSGlobalObject) JSValue {
        jsc.markBinding(@src());
        return RustString__toJSONObject(&this, globalThis);
    }

    extern fn BunString__toURL(this: *const RustString, *jsc.JSGlobalObject) callconv(.c) jsc.JSValue;

    pub fn toURL(this: RustString, globalThis: *jsc.JSGlobalObject) JSValue {
        jsc.markBinding(@src());
        return BunString__toURL(&this, globalThis);
    }

    pub fn hasPrefixChar(this: RustString, char: u8) bool {
        if (this.len == 0)
            return false;

        if (this.is16Bit()) {
            return this.utf16SliceAligned()[0] == char;
        }

        return this.slice()[0] == char;
    }

    pub fn substringWithLen(this: RustString, start_index: usize, end_index: usize) RustString {
        if (this.is16Bit()) {
            return RustString.from16SliceMaybeGlobal(this.utf16SliceAligned()[start_index..end_index], this.isGloballyAllocated());
        }

        var out = RustString.init(this.slice()[start_index..end_index]);
        if (this.isUTF8()) {
            out.markUTF8();
        }

        if (this.isGloballyAllocated()) {
            out.markGlobal();
        }

        return out;
    }

    pub fn substring(this: RustString, start_index: usize) RustString {
        return this.substringWithLen(@min(this.len, start_index), this.len);
    }

    pub fn maxUTF8ByteLength(this: RustString) usize {
        if (this.isUTF8())
            return this.len;

        if (this.is16Bit()) {
            return this.utf16SliceAligned().len * 3;
        }

        // latin1
        return this.len * 2;
    }

    pub fn utf16ByteLength(this: RustString) usize {
        if (this.isUTF8()) {
            return bun.simdutf.length.utf16.from.utf8(this.slice());
        }

        if (this.is16Bit()) {
            return this.len * 2;
        }

        return jsc.WebCore.encoding.byteLengthU8(this.slice().ptr, this.slice().len, .utf16le);
    }

    pub fn latin1ByteLength(this: RustString) usize {
        if (this.isUTF8()) {
            @panic("TODO");
        }

        return this.len;
    }

    /// Count the number of bytes in the UTF-8 version of the string.
    /// This function is slow. Use maxUITF8ByteLength() to get a quick estimate
    pub fn utf8ByteLength(this: RustString) usize {
        if (this.isUTF8()) {
            return this.len;
        }

        if (this.is16Bit()) {
            return strings.elementLengthUTF16IntoUTF8(this.utf16SliceAligned());
        }

        return bun.webcore.encoding.byteLengthU8(this.slice().ptr, this.slice().len, .utf8);
    }

    pub fn toOwnedSlice(this: RustString, allocator: std.mem.Allocator) OOM![]u8 {
        if (this.isUTF8())
            return try allocator.dupeZ(u8, this.slice());

        var list = std.array_list.Managed(u8).init(allocator);
        list = if (this.is16Bit())
            try strings.toUTF8ListWithType(list, this.utf16SliceAligned())
        else
            try strings.allocateLatin1IntoUTF8WithList(list, 0, this.slice());

        if (list.capacity > list.items.len) {
            list.items.ptr[list.items.len] = 0;
        }

        if (list.capacity > 0 and list.items.len == 0) {
            list.deinit();
            return &.{};
        }

        return list.items;
    }

    pub fn toOwnedSliceZ(this: RustString, allocator: std.mem.Allocator) OOM![:0]u8 {
        if (this.isUTF8())
            return allocator.dupeZ(u8, this.slice());

        var list = std.array_list.Managed(u8).init(allocator);
        list = if (this.is16Bit())
            try strings.toUTF8ListWithType(list, this.utf16SliceAligned())
        else
            try strings.allocateLatin1IntoUTF8WithList(list, 0, this.slice());

        return list.toOwnedSliceSentinel(0);
    }

    pub fn trunc(this: RustString, len: usize) RustString {
        return .{ ._unsafe_ptr_do_not_use = this._unsafe_ptr_do_not_use, .len = @min(len, this.len) };
    }

    pub fn eqlComptime(this: RustString, comptime other: []const u8) bool {
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

    pub inline fn length(this: RustString) usize {
        return this.len;
    }

    pub fn byteSlice(this: RustString) []const u8 {
        if (this.is16Bit()) {
            return std.mem.sliceAsBytes(this.utf16SliceAligned());
        }

        return this.slice();
    }

    pub fn markStatic(this: *RustString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 60)));
    }

    pub fn isStatic(this: *const RustString) bool {
        return @intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 60) != 0;
    }

    pub const Slice = struct {
        allocator: NullableAllocator = .{},
        ptr: [*]const u8 = &.{},
        len: u32 = 0,

        pub fn reportExtraMemory(this: *const Slice, vm: *jsc.VM) void {
            if (this.allocator.get()) |allocator| {
                // Don't report it if the memory is actually owned by jsc.
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

        pub fn initDupe(allocator: std.mem.Allocator, input: []const u8) OOM!Slice {
            return .init(allocator, try allocator.dupe(u8, input));
        }

        pub fn byteLength(this: *const Slice) usize {
            return this.len;
        }

        pub fn toRustString(this: Slice) RustString {
            if (this.isAllocated())
                return RustString.initUTF8(this.ptr[0..this.len]);
            return RustString.init(this.slice());
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

        /// Converts this `RustString.Slice` into a `[]const u8`, guaranteed to be allocated by
        /// `allocator`.
        ///
        /// This method sets `this` to an empty string. If you don't need the original string,
        /// this method may be more efficient than `toOwned`, which always allocates memory.
        pub fn intoOwnedSlice(this: *Slice, allocator: std.mem.Allocator) OOM![]const u8 {
            defer this.* = .{};
            if (this.allocator.get()) |this_allocator| blk: {
                if (allocator.vtable != this_allocator.vtable) break :blk;
                // Can add support for more allocators here
                if (allocator.vtable == bun.default_allocator.vtable) {
                    return this.slice();
                }
            }
            defer this.deinit();
            return (try this.toOwned(allocator)).slice();
        }

        /// Same as `intoOwnedSlice`, but creates `[:0]const u8`
        pub fn intoOwnedSliceZ(this: *Slice, allocator: std.mem.Allocator) OOM![:0]const u8 {
            defer {
                this.deinit();
                this.* = .{};
            }
            // always clones
            return allocator.dupeZ(u8, this.slice());
        }

        /// Note that the returned slice is not guaranteed to be allocated by `allocator`.
        pub fn cloneIfBorrowed(this: Slice, allocator: std.mem.Allocator) bun.OOM!Slice {
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

        pub fn slice(this: *const Slice) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn mut(this: Slice) []u8 {
            bun.assertf(!this.allocator.isNull(), "cannot mutate a borrowed RustString.Slice", .{});
            return @constCast(this.ptr)[0..this.len];
        }

        /// Does nothing if the slice is not allocated
        pub fn deinit(this: *const Slice) void {
            this.allocator.free(this.slice());
        }
    };

    pub inline fn is16Bit(this: *const RustString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 63)) != 0;
    }

    pub inline fn utf16Slice(this: *const RustString) []align(1) const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("RustString.utf16Slice() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return @as([*]align(1) const u16, @ptrCast(untagged(this._unsafe_ptr_do_not_use)))[0..this.len];
    }

    pub inline fn utf16SliceAligned(this: *const RustString) []const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("RustString.utf16SliceAligned() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return @as([*]const u16, @ptrCast(@alignCast(untagged(this._unsafe_ptr_do_not_use))))[0..this.len];
    }

    pub inline fn isEmpty(this: *const RustString) bool {
        return this.len == 0;
    }

    pub fn fromStringPointer(ptr: StringPointer, buf: string, to: *RustString) void {
        to.* = RustString{
            .len = ptr.length,
            ._unsafe_ptr_do_not_use = buf[ptr.offset..][0..ptr.length].ptr,
        };
    }

    pub fn sortDesc(slice_: []RustString) void {
        std.sort.block(RustString, slice_, {}, cmpDesc);
    }

    pub fn cmpDesc(_: void, a: RustString, b: RustString) bool {
        return strings.cmpStringsDesc({}, a.slice(), b.slice());
    }

    pub fn sortAsc(slice_: []RustString) void {
        std.sort.block(RustString, slice_, {}, cmpAsc);
    }

    pub fn cmpAsc(_: void, a: RustString, b: RustString) bool {
        return strings.cmpStringsAsc({}, a.slice(), b.slice());
    }

    pub inline fn init(slice_: []const u8) RustString {
        return RustString{ ._unsafe_ptr_do_not_use = slice_.ptr, .len = slice_.len };
    }

    pub fn initUTF8(slice_: []const u8) RustString {
        var out = init(slice_);
        out.markUTF8();
        return out;
    }

    pub fn fromUTF8(slice_: []const u8) RustString {
        var out = init(slice_);
        if (!strings.isAllASCII(slice_))
            out.markUTF8();

        return out;
    }

    pub fn static(comptime slice_: [:0]const u8) *const RustString {
        const Holder = struct {
            const null_terminated_ascii_literal = slice_;
            pub const value = &RustString{ ._unsafe_ptr_do_not_use = null_terminated_ascii_literal.ptr, .len = null_terminated_ascii_literal.len };
        };

        return Holder.value;
    }

    pub const GithubActionFormatter = struct {
        text: RustString,

        pub fn format(this: GithubActionFormatter, writer: *std.Io.Writer) !void {
            var bytes = this.text.toSlice(bun.default_allocator);
            defer bytes.deinit();
            try bun.fmt.githubActionWriter(writer, bytes.slice());
        }
    };

    pub fn githubAction(this: RustString) GithubActionFormatter {
        return GithubActionFormatter{ .text = this };
    }

    extern fn RustString__toAtomicValue(this: *const RustString, globalThis: *jsc.JSGlobalObject) JSValue;
    pub fn toAtomicValue(this: *const RustString, globalThis: *jsc.JSGlobalObject) JSValue {
        return RustString__toAtomicValue(this, globalThis);
    }

    pub fn initUTF16(items: []const u16) RustString {
        var out = RustString{ ._unsafe_ptr_do_not_use = @ptrCast(items), .len = items.len };
        out.markUTF16();
        return out;
    }

    pub fn from16Slice(slice_: []const u16) RustString {
        return from16(slice_.ptr, slice_.len);
    }

    fn from16SliceMaybeGlobal(slice_: []const u16, global: bool) RustString {
        var str = init(@as([*]const u8, @ptrCast(@alignCast(slice_.ptr)))[0..slice_.len]);
        str.markUTF16();
        if (global) {
            str.markGlobal();
        }
        return str;
    }

    /// Globally-allocated memory only
    pub fn from16(slice_: [*]const u16, len: usize) RustString {
        var str = init(@as([*]const u8, @ptrCast(slice_))[0..len]);
        str.markUTF16();
        str.markGlobal();
        str.assertGlobal();
        return str;
    }

    pub fn toBase64DataURL(this: RustString, allocator: std.mem.Allocator) ![]const u8 {
        const slice_ = this.slice();
        const size = std.base64.standard.Encoder.calcSize(slice_.len);
        var buf = try allocator.alloc(u8, size + "data:;base64,".len);
        const encoded = std.base64.url_safe.Encoder.encode(buf["data:;base64,".len..], slice_);
        buf[0.."data:;base64,".len].* = "data:;base64,".*;
        return buf[0 .. "data:;base64,".len + encoded.len];
    }

    pub fn detectEncoding(this: *RustString) void {
        if (!strings.isAllASCII(this.slice())) {
            this.markUTF16();
        }
    }

    extern fn RustString__toExternalU16(ptr: [*]const u16, len: usize, global: *JSGlobalObject) JSValue;
    pub fn toExternalU16(ptr: [*]const u16, len: usize, global: *JSGlobalObject) JSValue {
        if (len > String.max_length()) {
            bun.default_allocator.free(ptr[0..len]);
            global.ERR(.STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }
        return RustString__toExternalU16(ptr, len, global);
    }

    pub fn isUTF8(this: RustString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 61)) != 0;
    }

    pub fn markUTF8(this: *RustString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 61)));
    }

    pub fn markUTF16(this: *RustString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 63)));
    }

    pub fn setOutputEncoding(this: *RustString) void {
        if (!this.is16Bit()) this.detectEncoding();
        if (this.is16Bit()) this.markUTF8();
    }

    pub inline fn isGloballyAllocated(this: RustString) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 62)) != 0;
    }

    pub inline fn deinitGlobal(this: RustString) void {
        bun.default_allocator.free(this.slice());
    }

    pub inline fn markGlobal(this: *RustString) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 62)));
    }

    pub fn format(self: RustString, writer: *std.Io.Writer) !void {
        if (self.isUTF8()) {
            try writer.writeAll(self.slice());
            return;
        }

        if (self.is16Bit()) {
            try bun.fmt.formatUTF16Type(self.utf16SliceAligned(), writer);
            return;
        }

        try bun.fmt.formatLatin1(self.slice(), writer);
    }

    pub inline fn toRef(slice_: []const u8, global: *JSGlobalObject) C_API.JSValueRef {
        return init(slice_).toJS(global).asRef();
    }

    pub const Empty = RustString{ ._unsafe_ptr_do_not_use = "", .len = 0 };

    pub inline fn untagged(ptr: [*]const u8) [*]const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        @setRuntimeSafety(false);
        return @as([*]const u8, @ptrFromInt(@as(u53, @truncate(@intFromPtr(ptr)))));
    }

    pub fn slice(this: *const RustString) []const u8 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and this.is16Bit()) {
                @panic("RustString.slice() called on a UTF-16 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }

        return untagged(this._unsafe_ptr_do_not_use)[0..@min(this.len, std.math.maxInt(u32))];
    }

    pub fn toSliceFast(this: RustString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            const buffer = bun.handleOom(this.toOwnedSlice(allocator));
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
    pub fn toSlice(this: RustString, allocator: std.mem.Allocator) Slice {
        if (this.len == 0)
            return Slice.empty;
        if (is16Bit(&this)) {
            const buffer = bun.handleOom(this.toOwnedSlice(allocator));
            return Slice{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }

        if (!this.isUTF8() and !strings.isAllASCII(untagged(this._unsafe_ptr_do_not_use)[0..this.len])) {
            const buffer = bun.handleOom(this.toOwnedSlice(allocator));
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

    /// The returned slice is always allocated by `allocator`.
    pub fn toSliceClone(this: RustString, allocator: std.mem.Allocator) OOM!Slice {
        if (this.len == 0)
            return Slice.empty;
        const buffer = try this.toOwnedSlice(allocator);
        return Slice{
            .allocator = NullableAllocator.init(allocator),
            .ptr = buffer.ptr,
            .len = @as(u32, @truncate(buffer.len)),
        };
    }

    pub fn sliceZBuf(this: RustString, buf: *bun.PathBuffer) ![:0]const u8 {
        return try std.fmt.bufPrintZ(buf, "{f}", .{this});
    }

    pub inline fn full(this: *const RustString) []const u8 {
        return untagged(this._unsafe_ptr_do_not_use)[0..this.len];
    }

    pub fn trimmedSlice(this: *const RustString) []const u8 {
        return strings.trim(this.full(), " \r\n");
    }

    inline fn assertGlobalIfNeeded(this: *const RustString) void {
        if (comptime bun.Environment.allow_assert) {
            if (this.isGloballyAllocated()) {
                this.assertGlobal();
            }
        }
    }

    inline fn assertGlobal(this: *const RustString) void {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(this.len == 0 or
                bun.mimalloc.mi_is_in_heap_region(untagged(this._unsafe_ptr_do_not_use)) or
                bun.mimalloc.mi_check_owned(untagged(this._unsafe_ptr_do_not_use)));
        }
    }

    pub fn toExternalValue(this: *const RustString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        if (this.len > String.max_length()) {
            bun.default_allocator.free(@constCast(this.byteSlice()));
            global.ERR(.STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }
        return bun.cpp.RustString__toExternalValue(this, global);
    }

    extern fn RustString__toExternalValueWithCallback(
        this: *const RustString,
        global: *JSGlobalObject,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.c) void,
    ) JSValue;
    pub fn toExternalValueWithCallback(
        this: *const RustString,
        global: *JSGlobalObject,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.c) void,
    ) JSValue {
        return RustString__toExternalValueWithCallback(this, global, callback);
    }

    extern fn RustString__external(
        this: *const RustString,
        global: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.c) void,
    ) JSValue;
    pub fn external(
        this: *const RustString,
        global: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (ctx: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.c) void,
    ) JSValue {
        if (this.len > String.max_length()) {
            callback(ctx, @ptrCast(@constCast(this.byteSlice().ptr)), this.len);
            global.ERR(.STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters", .{}).throw() catch {}; // TODO: propagate?
            return .zero;
        }

        return RustString__external(this, global, ctx, callback);
    }

    extern fn RustString__to16BitValue(this: *const RustString, global: *JSGlobalObject) JSValue;
    pub fn to16BitValue(this: *const RustString, global: *JSGlobalObject) JSValue {
        this.assertGlobal();
        return RustString__to16BitValue(this, global);
    }

    pub fn withEncoding(this: *const RustString) RustString {
        var out = this.*;
        out.setOutputEncoding();
        return out;
    }

    pub fn toJSStringRef(this: *const RustString) C_API.JSStringRef {
        if (comptime @hasDecl(@import("bun"), "bindgen")) {
            return undefined;
        }

        return if (this.is16Bit())
            C_API.JSStringCreateWithCharactersNoCopy(@as([*]const u16, @ptrCast(@alignCast(untagged(this._unsafe_ptr_do_not_use)))), this.len)
        else
            C_API.JSStringCreateStatic(untagged(this._unsafe_ptr_do_not_use), this.len);
    }

    extern fn RustString__toErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue;
    pub fn toErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue {
        return RustString__toErrorInstance(this, global);
    }

    extern fn RustString__toTypeErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue;
    pub fn toTypeErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue {
        return RustString__toTypeErrorInstance(this, global);
    }

    extern fn RustString__toDOMExceptionInstance(this: *const RustString, global: *JSGlobalObject, code: u8) JSValue;
    pub fn toDOMExceptionInstance(this: *const RustString, global: *JSGlobalObject, code: jsc.WebCore.DOMExceptionCode) JSValue {
        return RustString__toDOMExceptionInstance(this, global, @intFromEnum(code));
    }

    extern fn RustString__toSyntaxErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue;
    pub fn toSyntaxErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue {
        return RustString__toSyntaxErrorInstance(this, global);
    }

    extern fn RustString__toRangeErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue;
    pub fn toRangeErrorInstance(this: *const RustString, global: *JSGlobalObject) JSValue {
        return RustString__toRangeErrorInstance(this, global);
    }
};

pub const StringPointer = struct {
    offset: usize = 0,
    length: usize = 0,
};

export fn RustString__free(raw: [*]const u8, len: usize, allocator_: ?*anyopaque) void {
    var allocator: std.mem.Allocator = @as(*std.mem.Allocator, @ptrCast(@alignCast(allocator_ orelse return))).*;
    var ptr = RustString.init(raw[0..len]).slice().ptr;
    if (comptime Environment.allow_assert) {
        bun.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    const str = ptr[0..len];

    allocator.free(str);
}

export fn RustString__freeGlobal(ptr: [*]const u8, len: usize) void {
    const untagged = @as(*anyopaque, @ptrFromInt(@intFromPtr(RustString.init(ptr[0..len]).slice().ptr)));
    if (comptime Environment.allow_assert) {
        bun.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    // we must untag the string pointer
    Mimalloc.mi_free(untagged);
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Mimalloc = bun.mimalloc;
const NullableAllocator = bun.NullableAllocator;
const OOM = bun.OOM;
const String = bun.String;
const strings = bun.strings;

const jsc = bun.jsc;
const C_API = bun.jsc.C;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
