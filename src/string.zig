pub const immutable = @import("./string/immutable.zig");

pub const HashedString = @import("./string/HashedString.zig");
pub const MutableString = @import("./string/MutableString.zig");
pub const PathString = @import("./string/PathString.zig").PathString;
pub const SmolStr = @import("./string/SmolStr.zig").SmolStr;
pub const StringBuilder = @import("./string/StringBuilder.zig");
pub const StringJoiner = @import("./string/StringJoiner.zig");
pub const WTFString = @import("./string/wtf.zig").WTFString;
pub const WTFStringImpl = @import("./string/wtf.zig").WTFStringImpl;
pub const WTFStringImplStruct = @import("./string/wtf.zig").WTFStringImplStruct;

pub const Tag = enum(u8) {
    /// String is not valid. Observed on some failed operations.
    /// To prevent crashes, this value acts similarly to .Empty (such as length = 0)
    Dead = 0,
    /// String is backed by a WTF::StringImpl from JavaScriptCore.
    /// Can be in either `latin1` or `utf16le` encodings.
    WTFStringImpl = 1,
    /// Memory has an unknown owner, likely in Bun's Zig codebase. If `isGloballyAllocated`
    /// is set, then it is owned by mimalloc. When converted to JSValue it has to be cloned
    /// into a WTF::String.
    /// Can be in either `utf8` or `utf16le` encodings.
    StringView = 2,
    /// Static memory that is guaranteed to never be freed. When converted to WTF::String,
    /// the memory is not cloned, but instead referenced with WTF::ExternalStringImpl.
    /// Can be in either `utf8` or `utf16le` encodings.
    StaticStringView = 3,
    /// String is ""
    Empty = 4,
};

pub const StringImpl = extern union {
    StringView: StringView,
    WTFStringImpl: WTFStringImpl,
    StaticStringView: StringView,
    Dead: void,
    Empty: void,
};

/// Represents a string value in Bun's runtime, bridging Zig and JavaScriptCore.
pub const String = extern struct {
    pub const name = "BunString";

    tag: Tag,
    value: StringImpl,

    pub const empty = String{ .tag = .Empty, .value = .{ .StringView = .Empty } };

    pub const dead = String{ .tag = .Dead, .value = .{ .Dead = {} } };
    pub const StringImplAllocator = @import("./string/wtf.zig").StringImplAllocator;

    pub fn toInt32(this: *const String) ?i32 {
        const val = bun.cpp.BunString__toInt32(this);
        if (val > std.math.maxInt(i32)) return null;
        return @intCast(val);
    }

    pub fn ascii(bytes: []const u8) String {
        return String{ .tag = .StringView, .value = .{ .StringView = StringView.init(bytes) } };
    }

    pub fn isGlobal(this: String) bool {
        return this.tag == Tag.StringView and this.value.StringView.isGloballyAllocated();
    }

    pub fn ensureHash(this: String) void {
        if (this.tag == .WTFStringImpl) this.value.WTFStringImpl.ensureHash();
    }

    extern fn BunString__transferToJS(this: *String, globalThis: *jsc.JSGlobalObject) jsc.JSValue;
    pub fn transferToJS(this: *String, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalThis, @src(), BunString__transferToJS, .{ this, globalThis });
    }

    pub fn toOwnedSlice(this: String, allocator: std.mem.Allocator) OOM![]u8 {
        const bytes, _ = try this.toOwnedSliceImpl(allocator);
        return bytes;
    }

    /// Returns `.{ utf8_bytes, is_all_ascii }`.
    ///
    /// `false` means the string contains at least one non-ASCII character.
    pub fn toOwnedSliceReturningAllASCII(this: String, allocator: std.mem.Allocator) OOM!struct { []u8, bool } {
        const bytes, const ascii_status = try this.toOwnedSliceImpl(allocator);
        const is_ascii = switch (ascii_status) {
            .all_ascii => true,
            .non_ascii => false,
            .unknown => bun.strings.isAllASCII(bytes),
        };
        return .{ bytes, is_ascii };
    }

    fn toOwnedSliceImpl(this: String, allocator: std.mem.Allocator) !struct { []u8, AsciiStatus } {
        return switch (this.tag) {
            .StringView => .{ try this.value.StringView.toOwnedSlice(allocator), .unknown },
            .WTFStringImpl => blk: {
                const utf8_slice = this.value.WTFStringImpl.toUTF8WithoutRef(allocator);
                // `utf8_slice.allocator` is either null, or `allocator`.
                errdefer utf8_slice.deinit();

                const ascii_status: AsciiStatus = if (utf8_slice.allocator.isNull())
                    .all_ascii // no allocation means the string was 8-bit and all ascii
                else if (this.value.WTFStringImpl.is8Bit())
                    .non_ascii // otherwise the allocator would be null for an 8-bit string
                else
                    .unknown; // string was 16-bit; may or may not be all ascii

                const owned_slice = try utf8_slice.cloneIfBorrowed(allocator);
                // `owned_slice.allocator` is guaranteed to be `allocator`.
                break :blk .{ owned_slice.mut(), ascii_status };
            },
            .StaticStringView => .{
                try this.value.StaticStringView.toOwnedSlice(allocator), .unknown,
            },
            else => return .{ &.{}, .all_ascii }, // trivially all ascii
        };
    }

    pub fn createIfDifferent(other: String, utf8_slice: []const u8) String {
        if (other.tag == .WTFStringImpl) {
            if (other.eqlUTF8(utf8_slice)) {
                return other.dupeRef();
            }
        }

        return cloneUTF8(utf8_slice);
    }

    fn createUninitializedLatin1(len: usize) struct { String, []u8 } {
        bun.assert(len > 0);
        const string = bun.cpp.BunString__fromLatin1Unitialized(len);
        if (string.tag == .Dead) {
            return .{ string, &.{} };
        }
        _ = validateRefCount(string);
        const wtf = string.value.WTFStringImpl;
        return .{
            string,
            @constCast(wtf.m_ptr.latin1[0..wtf.m_length]),
        };
    }

    fn createUninitializedUTF16(len: usize) struct { String, []u16 } {
        bun.assert(len > 0);
        const string = bun.cpp.BunString__fromUTF16Unitialized(len);
        if (string.tag == .Dead) {
            return .{ string, &.{} };
        }
        _ = validateRefCount(string);
        const wtf = string.value.WTFStringImpl;
        return .{
            string,
            @constCast(wtf.m_ptr.utf16[0..wtf.m_length]),
        };
    }

    pub const WTFEncoding = enum {
        latin1,
        utf16,

        pub fn Byte(comptime this: WTFEncoding) type {
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
    ///
    /// If the length is too large, this will return a dead string.
    pub fn createUninitialized(
        comptime kind: WTFEncoding,
        len: usize,
    ) struct { String, [](kind.Byte()) } {
        bun.assert(len > 0);
        return switch (comptime kind) {
            .latin1 => createUninitializedLatin1(len),
            .utf16 => createUninitializedUTF16(len),
        };
    }

    pub fn cloneLatin1(bytes: []const u8) String {
        jsc.markBinding(@src());
        if (bytes.len == 0) return String.empty;
        return validateRefCount(bun.cpp.BunString__fromLatin1(bytes.ptr, bytes.len));
    }

    pub inline fn validateRefCount(this: String) String {
        if (comptime bun.Environment.isDebug) {
            // Newly created strings should have a ref count of 1
            if (!this.isEmpty()) {
                const ref_count = this.value.WTFStringImpl.refCount();
                bun.assert(ref_count == 1);
            }
        }

        return this;
    }

    pub fn cloneUTF8(bytes: []const u8) String {
        return jsc.WebCore.encoding.toBunStringComptime(bytes, .utf8);
    }

    pub fn cloneUTF16(bytes: []const u16) String {
        if (bytes.len == 0) return String.empty;
        if (bun.strings.firstNonASCII16(bytes) == null) {
            return validateRefCount(bun.cpp.BunString__fromUTF16ToLatin1(bytes.ptr, bytes.len));
        }
        return validateRefCount(bun.cpp.BunString__fromUTF16(bytes.ptr, bytes.len));
    }

    pub fn createFormat(comptime fmt: [:0]const u8, args: anytype) OOM!String {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len == 0) {
            return String.static(fmt);
        }

        var sba = std.heap.stackFallback(512, bun.default_allocator);
        const alloc = sba.get();
        const buf = try std.fmt.allocPrint(alloc, fmt, args);
        defer alloc.free(buf);
        return cloneUTF8(buf);
    }

    pub fn createFromOSPath(os_path: bun.OSPathSlice) String {
        return switch (@TypeOf(os_path)) {
            []const u8 => cloneUTF8(os_path),
            []const u16 => cloneUTF16(os_path),
            else => @compileError("unreachable"),
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
            if (new.tag != .Dead) {
                @memcpy(bytes, this.value.StringView.utf16Slice());
            }
            return new;
        }

        return cloneUTF8(this.byteSlice());
    }

    /// Must be given ascii input
    pub fn createAtomASCII(bytes: []const u8) String {
        return bun.cpp.BunString__createAtom(bytes.ptr, bytes.len);
    }

    /// Will return null if the input is non-ascii or too long
    pub fn tryCreateAtom(bytes: []const u8) ?String {
        const atom = bun.cpp.BunString__tryCreateAtom(bytes.ptr, bytes.len);
        return if (atom.tag == .Dead) null else atom;
    }

    /// Atomized strings are interned strings
    /// They're de-duplicated in a threadlocal hash table
    /// They cannot be used from other threads.
    pub fn createAtomIfPossible(bytes: []const u8) String {
        if (bytes.len == 0) {
            return String.empty;
        }

        if (bytes.len < 64) {
            if (tryCreateAtom(bytes)) |atom| {
                return atom;
            }
        }

        return cloneUTF8(bytes);
    }

    pub fn utf8ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.utf8ByteLength(),
            .StringView => this.value.StringView.utf8ByteLength(),
            .StaticStringView => this.value.StaticStringView.utf8ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    pub fn utf16ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.utf16ByteLength(),
            .StaticStringView, .StringView => this.value.StringView.utf16ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    pub fn latin1ByteLength(this: String) usize {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.latin1ByteLength(),
            .StaticStringView, .StringView => this.value.StringView.latin1ByteLength(),
            .Dead, .Empty => 0,
        };
    }

    pub fn trunc(this: String, len: usize) String {
        if (this.length() <= len) {
            return this;
        }

        return String.init(this.asStringViewUnsafe().trunc(len));
    }

    pub fn toOwnedSliceZ(this: String, allocator: std.mem.Allocator) OOM![:0]u8 {
        return this.asStringViewUnsafe().toOwnedSliceZ(allocator);
    }

    /// Create a bun.String from a slice. This is never a copy.
    /// For strings created from static string literals, use `String.static`
    pub fn init(value: anytype) String {
        const Type = @TypeOf(value);
        return switch (Type) {
            String => value,
            StringView => .{ .tag = .StringView, .value = .{ .StringView = value } },
            [:0]u8, []u8, [:0]const u8, []const u8 => .{ .tag = .StringView, .value = .{ .StringView = StringView.fromBytes(value) } },
            [:0]u16, []u16, [:0]const u16, []const u16 => .{ .tag = .StringView, .value = .{ .StringView = StringView.from16Slice(value) } },
            WTFStringImpl => .{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = value } },
            *const StringView, *StringView => .{ .tag = .StringView, .value = .{ .StringView = value.* } },
            *const [0:0]u8 => .{ .tag = .Empty, .value = .{ .Empty = {} } },
            else => {
                const info = @typeInfo(Type);

                // Zig string literals
                if (info == .pointer and info.pointer.size == .one and info.pointer.is_const) {
                    const child_info = @typeInfo(info.pointer.child);
                    if (child_info == .array and child_info.array.child == u8) {
                        if (child_info.array.len == 0) return String.empty;
                        return static(value);
                    }
                }

                @compileError("Unsupported type for String " ++ @typeName(Type));
            },
        };
    }

    pub fn static(input: [:0]const u8) String {
        return .{
            .tag = .StaticStringView,
            .value = .{ .StaticStringView = StringView.init(input) },
        };
    }

    pub fn toErrorInstance(this: *const String, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        defer this.deref();
        return JSC__createError(globalObject, this);
    }

    pub fn toTypeErrorInstance(this: *const String, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        defer this.deref();
        return JSC__createTypeError(globalObject, this);
    }

    pub fn toRangeErrorInstance(this: *const String, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        defer this.deref();
        return JSC__createRangeError(globalObject, this);
    }

    pub fn toSyntaxErrorInstance(this: *const String, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        defer this.deref();
        return JSC__createSyntaxError(globalObject, this);
    }

    pub fn toDOMExceptionInstance(this: *const String, globalObject: *jsc.JSGlobalObject, code: jsc.WebCore.DOMExceptionCode) jsc.JSValue {
        defer this.deref();
        return JSC__createDOMException(globalObject, this, @intFromEnum(code));
    }

    extern fn BunString__createExternal(
        bytes: [*]const u8,
        len: usize,
        isLatin1: bool,
        ptr: ?*anyopaque,
        callback: ?*const fn (*anyopaque, *anyopaque, u32) callconv(.c) void,
    ) String;
    extern fn BunString__createStaticExternal(
        bytes: [*]const u8,
        len: usize,
        isLatin1: bool,
    ) String;

    /// ctx is the pointer passed into `createExternal`
    /// buffer is the pointer to the buffer, either [*]u8 or [*]u16
    /// len is the number of characters in that buffer.
    pub fn ExternalStringImplFreeFunction(comptime Ctx: type) type {
        return fn (ctx: Ctx, buffer: *anyopaque, len: u32) callconv(.c) void;
    }

    /// Creates a `String` backed by a `WTF::ExternalStringImpl`.
    ///
    /// External strings are WTF strings with bytes allocated somewhere else.
    /// When destroyed, they call `callback`, which should free the allocation
    /// as needed.
    ///
    ///
    /// If `bytes` is too long (longer than `max_length()`), `callback` gets
    /// called and a `dead` string is returned. `bytes` cannot be empty. Passing
    /// an empty slice is safety-checked Illegal Behavior.
    ///
    /// ### Memory Characteristics
    /// - Allocates memory for backing `WTF::ExternalStringImpl` struct. Does
    ///   not allocate for actual string bytes.
    /// - `bytes` is borrowed.
    pub fn createExternal(
        comptime Ctx: type,
        bytes: []const u8,
        isLatin1: bool,
        ctx: Ctx,
        callback: ?*const ExternalStringImplFreeFunction(Ctx),
    ) String {
        comptime if (@typeInfo(Ctx) != .pointer) @compileError("context must be a pointer");
        bun.assert(bytes.len > 0);
        jsc.markBinding(@src());
        if (bytes.len >= max_length()) {
            if (callback) |cb| {
                cb(ctx, @ptrCast(@constCast(bytes.ptr)), @truncate(bytes.len));
            }
            return dead;
        }
        return validateRefCount(BunString__createExternal(@ptrCast(bytes.ptr), bytes.len, isLatin1, ctx, @ptrCast(callback)));
    }

    /// This should rarely be used. The WTF::StringImpl* will never be freed.
    ///
    /// So this really only makes sense when you need to dynamically allocate a
    /// string that will never be freed.
    pub fn createStaticExternal(bytes: []const u8, isLatin1: bool) String {
        jsc.markBinding(@src());
        bun.assert(bytes.len > 0);
        return BunString__createStaticExternal(bytes.ptr, bytes.len, isLatin1);
    }

    extern fn BunString__createExternalGloballyAllocatedLatin1(
        bytes: [*]u8,
        len: usize,
    ) String;

    extern fn BunString__createExternalGloballyAllocatedUTF16(
        bytes: [*]u16,
        len: usize,
    ) String;

    /// Max WTFStringImpl length.
    /// **Not** in bytes. In characters.
    pub inline fn max_length() usize {
        return jsc.VirtualMachine.string_allocation_limit;
    }

    /// If the allocation fails, this will free the bytes and return a dead string.
    pub fn createExternalGloballyAllocated(comptime kind: WTFEncoding, bytes: []kind.Byte()) String {
        jsc.markBinding(@src());
        bun.assert(bytes.len > 0);

        if (bytes.len >= max_length()) {
            bun.default_allocator.free(bytes);
            return dead;
        }

        return switch (comptime kind) {
            .latin1 => validateRefCount(BunString__createExternalGloballyAllocatedLatin1(bytes.ptr, bytes.len)),
            .utf16 => validateRefCount(BunString__createExternalGloballyAllocatedUTF16(bytes.ptr, bytes.len)),
        };
    }

    /// Create a `String` from a UTF-8 slice.
    ///
    /// No checks are performed to ensure `value` is valid UTF-8. Caller is
    /// responsible for ensuring `value` is valid.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn borrowUTF8(value: []const u8) String {
        return String.init(StringView.initUTF8(value));
    }

    /// Create a `String` from a UTF-16 slice.
    ///
    /// No checks are performed to ensure `value` is valid UTF-16. Caller is
    /// responsible for ensuring `value` is valid.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn borrowUTF16(value: []const u16) String {
        return String.init(StringView.initUTF16(value));
    }

    pub fn initLatin1OrASCIIView(value: []const u8) String {
        return String.init(StringView.init(value));
    }

    /// Create a `String` from a byte slice.
    ///
    /// Checks if `value` is ASCII (using `strings.isAllASCII`) and, if so,
    /// the returned `String` is marked as UTF-8. Otherwise, no encoding is assumed.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn fromBytes(value: []const u8) String {
        return String.init(StringView.fromBytes(value));
    }

    pub fn format(self: String, writer: *std.Io.Writer) !void {
        try self.asStringViewUnsafe().format(writer);
    }

    pub fn fromJS(value: bun.jsc.JSValue, globalObject: *jsc.JSGlobalObject) bun.JSError!String {
        var scope: jsc.ExceptionValidationScope = undefined;
        scope.init(globalObject, @src());
        defer scope.deinit();
        var out: String = String.dead;
        const ok = bun.cpp.BunString__fromJS(globalObject, value, &out);

        // If there is a pending exception, but stringifying succeeds, we don't return JSError.
        // We do need to always call hasException() to satisfy the need for an exception check.
        const has_exception = scope.hasExceptionOrFalseWhenAssertionsAreDisabled();
        if (ok) {
            bun.debugAssert(out.tag != .Dead);
        } else {
            bun.debugAssert(has_exception);
        }

        return if (ok) out else error.JSError;
    }

    pub fn toJS(this: *const String, globalObject: *bun.jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());

        return bun.jsc.fromJSHostCall(globalObject, @src(), BunString__toJS, .{ globalObject, this });
    }

    pub fn toJSDOMURL(this: *String, globalObject: *bun.jsc.JSGlobalObject) jsc.JSValue {
        jsc.markBinding(@src());

        return BunString__toJSDOMURL(globalObject, this);
    }

    extern fn BunString__createArray(
        globalObject: *bun.jsc.JSGlobalObject,
        ptr: [*]const String,
        len: usize,
    ) jsc.JSValue;

    /// calls toJS on all elements of `array`.
    pub fn toJSArray(globalObject: *bun.jsc.JSGlobalObject, array: []const bun.String) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalObject, @src(), BunString__createArray, .{ globalObject, array.ptr, array.len });
    }

    /// Internal: get the borrowed-bytes view of this String.
    /// Returns a `StringView` with bytes borrowed from the underlying storage.
    /// For WTFStringImpl, the returned view's lifetime is tied to the StringImpl's refcount.
    fn asStringViewUnsafe(this: String) StringView {
        if (this.tag == .StaticStringView or this.tag == .StringView) {
            return this.value.StringView;
        }

        if (this.tag == .WTFStringImpl)
            return this.value.WTFStringImpl.asStringViewUnsafe();

        return StringView.Empty;
    }

    pub fn toWTF(this: *String) void {
        jsc.markBinding(@src());

        bun.cpp.BunString__toWTFString(this);
    }

    pub inline fn length(this: String) usize {
        return if (this.tag == .WTFStringImpl)
            this.value.WTFStringImpl.length()
        else
            this.asStringViewUnsafe().length();
    }

    pub inline fn utf16(self: String) []const u16 {
        if (self.tag == .Empty)
            return &[_]u16{};
        if (self.tag == .WTFStringImpl) {
            return self.value.WTFStringImpl.utf16Slice();
        }

        return self.asStringViewUnsafe().utf16SliceAligned();
    }

    pub inline fn latin1(self: String) []const u8 {
        if (self.tag == .Empty)
            return &[_]u8{};

        if (self.tag == .WTFStringImpl) {
            return self.value.WTFStringImpl.latin1Slice();
        }

        return self.asStringViewUnsafe().slice();
    }

    pub fn isUTF8(self: String) bool {
        if (!(self.tag == .StringView or self.tag == .StaticStringView))
            return false;

        return self.value.StringView.isUTF8();
    }

    pub inline fn asUTF8(self: String) ?[]const u8 {
        if (self.tag == .WTFStringImpl) {
            if (self.value.WTFStringImpl.is8Bit() and bun.strings.isAllASCII(self.value.WTFStringImpl.latin1Slice())) {
                return self.value.WTFStringImpl.latin1Slice();
            }

            return null;
        }

        if (self.tag == .StringView or self.tag == .StaticStringView) {
            if (self.value.StringView.isUTF8()) {
                return self.value.StringView.slice();
            }

            if (bun.strings.isAllASCII(self.asStringViewUnsafe().slice())) {
                return self.value.StringView.slice();
            }

            return null;
        }

        return "";
    }

    pub fn encoding(self: String) bun.strings.EncodingNonAscii {
        if (self.isUTF16()) {
            return .utf16;
        }

        if (self.isUTF8()) {
            return .utf8;
        }

        return .latin1;
    }

    pub fn githubAction(self: String) StringView.GithubActionFormatter {
        return self.asStringViewUnsafe().githubAction();
    }

    pub fn byteSlice(this: String) []const u8 {
        return switch (this.tag) {
            .StringView, .StaticStringView => this.value.StringView.byteSlice(),
            .WTFStringImpl => this.value.WTFStringImpl.byteSlice(),
            else => &[_]u8{},
        };
    }

    pub fn isUTF16(self: String) bool {
        if (self.tag == .WTFStringImpl)
            return !self.value.WTFStringImpl.is8Bit();

        if (self.tag == .StringView or self.tag == .StaticStringView)
            return self.value.StringView.is16Bit();

        return false;
    }

    pub fn toJSByParseJSON(self: *String, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return bun.cpp.BunString__toJSON(globalObject, self);
    }

    pub fn encodeInto(self: String, out: []u8, comptime enc: jsc.Node.Encoding) !usize {
        if (self.isUTF16()) {
            return jsc.WebCore.encoding.encodeIntoFrom16(self.utf16(), out, enc, true);
        }

        if (self.isUTF8()) {
            @panic("TODO");
        }

        return jsc.WebCore.encoding.encodeIntoFrom8(self.latin1(), out, enc);
    }

    pub fn encode(self: String, enc: jsc.Node.Encoding) []u8 {
        return self.asStringViewUnsafe().encodeWithAllocator(bun.default_allocator, enc);
    }

    pub inline fn utf8(self: String) []const u8 {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(self.tag == .StringView or self.tag == .StaticStringView);
            bun.assert(self.canBeUTF8());
        }
        return self.value.StringView.slice();
    }

    pub fn canBeUTF8(self: String) bool {
        if (self.tag == .WTFStringImpl)
            return self.value.WTFStringImpl.is8Bit() and bun.strings.isAllASCII(self.value.WTFStringImpl.latin1Slice());

        if (self.tag == .StringView or self.tag == .StaticStringView) {
            if (self.value.StringView.isUTF8()) {
                return true;
            }

            return bun.strings.isAllASCII(self.asStringViewUnsafe().slice());
        }

        return self.tag == .Empty;
    }

    pub fn substring(this: String, start_index: usize) String {
        const len = this.length();
        return this.substringWithLen(@min(len, start_index), len);
    }

    pub fn substringWithLen(this: String, start_index: usize, end_index: usize) String {
        switch (this.tag) {
            .StringView, .StaticStringView => {
                return String.init(this.value.StringView.substringWithLen(start_index, end_index));
            },
            .WTFStringImpl => {
                if (this.value.WTFStringImpl.is8Bit()) {
                    return String.init(StringView.init(this.value.WTFStringImpl.latin1Slice()[start_index..end_index]));
                } else {
                    return String.init(StringView.initUTF16(this.value.WTFStringImpl.utf16Slice()[start_index..end_index]));
                }
            },
            else => return this,
        }
    }

    pub fn toUTF8(this: String, allocator: std.mem.Allocator) StringView.Slice {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.toUTF8(allocator);
        }

        if (this.tag == .StringView) {
            return this.value.StringView.toSlice(allocator);
        }

        if (this.tag == .StaticStringView) {
            return StringView.Slice.fromUTF8NeverFree(this.value.StaticStringView.slice());
        }

        return StringView.Slice.empty;
    }

    /// This is the same as toUTF8, but it doesn't increment the reference count for latin1 strings
    pub fn toUTF8WithoutRef(this: String, allocator: std.mem.Allocator) StringView.Slice {
        if (this.tag == .WTFStringImpl) {
            return this.value.WTFStringImpl.toUTF8WithoutRef(allocator);
        }

        if (this.tag == .StringView) {
            return this.value.StringView.toSlice(allocator);
        }

        if (this.tag == .StaticStringView) {
            return StringView.Slice.fromUTF8NeverFree(this.value.StaticStringView.slice());
        }

        return StringView.Slice.empty;
    }

    /// Equivalent to calling `toUTF8WithoutRef` followed by `cloneIfBorrowed`.
    pub fn toUTF8Owned(this: String, allocator: std.mem.Allocator) StringView.Slice {
        return bun.handleOom(this.toUTF8WithoutRef(allocator).cloneIfBorrowed(allocator));
    }

    /// The returned slice is always allocated by `allocator`.
    pub fn toUTF8Bytes(this: String, allocator: std.mem.Allocator) []u8 {
        return this.toUTF8Owned(allocator).mut();
    }

    /// use `byteSlice` to get a `[]const u8`.
    pub fn toSlice(this: *String, allocator: std.mem.Allocator) SliceWithUnderlyingString {
        defer this.* = .empty;
        return SliceWithUnderlyingString{
            .utf8 = this.toUTF8(allocator),
            .underlying = this.*,
        };
    }

    pub fn toThreadSafeSlice(this: *String, allocator: std.mem.Allocator) bun.OOM!SliceWithUnderlyingString {
        if (this.tag == .WTFStringImpl) {
            if (!this.value.WTFStringImpl.isThreadSafe()) {
                const slice = this.value.WTFStringImpl.toUTF8WithoutRef(allocator);

                if (slice.allocator.isNull()) {
                    // This is an ASCII latin1 string with the same reference as the original.
                    return .{
                        .utf8 = StringView.Slice.init(allocator, try allocator.dupe(u8, slice.slice())),
                        .underlying = empty,
                    };
                }

                if (comptime bun.Environment.allow_assert) {
                    bun.assert(!isWTFAllocator(slice.allocator.get().?)); // toUTF8WithoutRef() should never return a WTF allocator
                    bun.assert(slice.allocator.get().?.vtable == allocator.vtable); // assert that the allocator is the same
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
                        .utf8 = StringView.Slice.init(this.value.WTFStringImpl.refCountAllocator(), slice.slice()),
                        .underlying = this.*,
                    };
                }

                if (comptime bun.Environment.allow_assert) {
                    bun.assert(!isWTFAllocator(slice.allocator.get().?)); // toUTF8WithoutRef() should never return a WTF allocator
                    bun.assert(slice.allocator.get().?.vtable == allocator.vtable); // assert that the allocator is the same
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

    extern fn BunString__toJS(globalObject: *jsc.JSGlobalObject, in: *const String) jsc.JSValue;
    extern fn BunString__toJSWithLength(globalObject: *jsc.JSGlobalObject, in: *const String, usize) jsc.JSValue;
    extern fn BunString__toJSDOMURL(globalObject: *jsc.JSGlobalObject, in: *String) jsc.JSValue;

    pub fn createUTF8ForJS(globalObject: *jsc.JSGlobalObject, utf8_slice: []const u8) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return bun.cpp.BunString__createUTF8ForJS(globalObject, utf8_slice.ptr, utf8_slice.len);
    }

    pub fn createFormatForJS(globalObject: *jsc.JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        var builder = std.array_list.Managed(u8).init(bun.default_allocator);
        defer builder.deinit();
        bun.handleOom(builder.writer().print(fmt, args));
        return bun.cpp.BunString__createUTF8ForJS(globalObject, builder.items.ptr, builder.items.len);
    }

    pub fn parseDate(this: *String, globalObject: *jsc.JSGlobalObject) bun.JSError!f64 {
        jsc.markBinding(@src());
        return bun.cpp.Bun__parseDate(globalObject, this);
    }

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

    pub fn eqlComptime(this: String, comptime value: []const u8) bool {
        return this.asStringViewUnsafe().eqlComptime(value);
    }

    pub fn is8Bit(this: String) bool {
        return switch (this.tag) {
            .WTFStringImpl => this.value.WTFStringImpl.is8Bit(),
            .StringView => !this.value.StringView.is16Bit(),
            else => true,
        };
    }

    pub fn charAt(this: String, index: usize) u16 {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(index < this.length());
        }
        return switch (this.tag) {
            .WTFStringImpl => if (this.value.WTFStringImpl.is8Bit()) this.value.WTFStringImpl.latin1Slice()[index] else this.value.WTFStringImpl.utf16Slice()[index],
            .StringView, .StaticStringView => if (!this.value.StringView.is16Bit()) this.value.StringView.slice()[index] else this.value.StringView.utf16Slice()[index],
            else => 0,
        };
    }

    pub fn indexOfAsciiChar(this: String, chr: u8) ?usize {
        bun.assert(chr < 128);
        return switch (this.isUTF16()) {
            true => std.mem.indexOfScalar(u16, this.utf16(), @intCast(chr)),
            false => bun.strings.indexOfCharUsize(this.byteSlice(), chr),
        };
    }

    pub fn indexOfAny(this: String, comptime chars: []const u8) ?bun.strings.OptionalUsize {
        if (this.isUTF16()) {
            return bun.strings.indexOfAny16(this.utf16(), chars);
        }
        return bun.strings.indexOfAny(this.latin1(), chars);
    }

    /// Returns the character at `index` as a u8 (truncated from u16 for UTF-16 strings).
    /// Use this only when you know the character is ASCII.
    pub fn charAtU8(this: String, index: usize) u8 {
        return @truncate(this.charAt(index));
    }

    pub fn visibleWidth(this: *const String, ambiguousAsWide: bool) usize {
        if (this.isUTF8()) {
            return bun.strings.visible.width.utf8(this.utf8());
        } else if (this.isUTF16()) {
            return bun.strings.visible.width.utf16(this.utf16(), ambiguousAsWide);
        } else {
            return bun.strings.visible.width.latin1(this.latin1());
        }
    }

    pub fn visibleWidthExcludeANSIColors(this: *const String, ambiguousAsWide: bool) usize {
        if (this.isUTF8()) {
            return bun.strings.visible.width.exclude_ansi_colors.utf8(this.utf8());
        } else if (this.isUTF16()) {
            return bun.strings.visible.width.exclude_ansi_colors.utf16(this.utf16(), ambiguousAsWide);
        } else {
            return bun.strings.visible.width.exclude_ansi_colors.latin1(this.latin1());
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
                bun.assert(bytes.len == values[i].len);
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
                bun.assert(bytes.len == values[i].len);
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

        var str = this.asStringViewUnsafe();
        if (str.len < value.len) return false;

        return str.substringWithLen(0, value.len).eqlComptime(value);
    }

    pub fn isWTFAllocator(this: std.mem.Allocator) bool {
        return this.vtable == StringImplAllocator.VTablePtr;
    }

    pub fn eqlBytes(this: String, value: []const u8) bool {
        return bun.strings.eqlLong(this.byteSlice(), value, true);
    }

    /// Does not increment the reference count unless the StringImpl is cloned.
    pub fn toThreadSafe(this: *String) void {
        jsc.markBinding(@src());

        if (this.tag == .WTFStringImpl) {
            bun.cpp.BunString__toThreadSafe(this);
        }
    }

    /// We don't ref unless the underlying StringImpl is new.
    ///
    /// This will ref even if it doesn't change.
    pub fn toThreadSafeEnsureRef(this: *String) void {
        jsc.markBinding(@src());

        if (this.tag == .WTFStringImpl) {
            const orig = this.value.WTFStringImpl;
            bun.cpp.BunString__toThreadSafe(this);
            if (this.value.WTFStringImpl == orig) {
                orig.ref();
            }
        }
    }

    pub fn eqlUTF8(this: String, other: []const u8) bool {
        return this.asStringViewUnsafe().eql(StringView.fromUTF8(other));
    }

    pub fn eql(this: String, other: String) bool {
        return this.asStringViewUnsafe().eql(other.asStringViewUnsafe());
    }

    extern fn JSC__createError(*jsc.JSGlobalObject, str: *const String) jsc.JSValue;
    extern fn JSC__createTypeError(*jsc.JSGlobalObject, str: *const String) jsc.JSValue;
    extern fn JSC__createRangeError(*jsc.JSGlobalObject, str: *const String) jsc.JSValue;
    extern fn JSC__createSyntaxError(*jsc.JSGlobalObject, str: *const String) jsc.JSValue;
    extern fn JSC__createDOMException(*jsc.JSGlobalObject, str: *const String, code: u8) jsc.JSValue;

    pub fn jsGetStringWidth(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callFrame.argumentsAsArray(2);
        const argument = args[0];
        const opts_val = args[1];

        if (argument == .zero or argument.isUndefined()) {
            return .jsNumber(@as(i32, 0));
        }

        const js_str = try argument.toJSString(globalObject);
        const str = js_str.view(globalObject);

        if (str.isEmpty()) {
            return .jsNumber(@as(i32, 0));
        }

        // Parse options: { countAnsiEscapeCodes?: bool, ambiguousIsNarrow?: bool }
        var count_ansi: bool = false;
        var ambiguous_is_narrow: bool = true;

        if (opts_val.isObject()) {
            if (try opts_val.getTruthyComptime(globalObject, "countAnsiEscapeCodes")) |v| {
                count_ansi = v.toBoolean();
            }
            if (try opts_val.getTruthyComptime(globalObject, "ambiguousIsNarrow")) |v| {
                ambiguous_is_narrow = v.toBoolean();
            }
        }

        const width = if (count_ansi)
            str.visibleWidth(!ambiguous_is_narrow)
        else
            str.visibleWidthExcludeANSIColors(!ambiguous_is_narrow);

        return .jsNumber(width);
    }

    /// Reports owned allocation size, not the actual size of the string.
    pub fn estimatedSize(this: *const String) usize {
        return switch (this.tag) {
            .Dead, .Empty, .StaticStringView => 0,
            .StringView => this.value.StringView.len,
            .WTFStringImpl => this.value.WTFStringImpl.byteLength(),
        };
    }

    /// A UTF-8 encoded slice tied to the lifetime of a `bun.String`.
    /// Must call `.deinit` to release memory.
    ///
    /// This struct has no encoding tag — its contents are always valid UTF-8
    /// (converted from the underlying string's encoding if necessary).
    pub const Slice = struct {
        allocator: NullableAllocator = .{},
        ptr: [*]const u8 = &.{},
        len: u32 = 0,

        pub fn reportExtraMemory(this: *const Slice, vm: *jsc.VM) void {
            if (this.allocator.get()) |allocator| {
                // Don't report it if the memory is actually owned by jsc.
                if (!String.isWTFAllocator(allocator)) {
                    vm.reportExtraMemory(this.len);
                }
            }
        }

        pub fn isWTFAllocated(this: *const Slice) bool {
            return String.isWTFAllocator(this.allocator.get() orelse return false);
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

        /// Converts this `Slice` into a `[]const u8`, guaranteed to be allocated by
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
            const buf = try bun.strings.cloneNormalizingSeparators(allocator, this.slice());
            return Slice{ .allocator = NullableAllocator.init(allocator), .ptr = buf.ptr, .len = @as(u32, @truncate(buf.len)) };
        }

        pub fn slice(this: *const Slice) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn mut(this: Slice) []u8 {
            bun.assertf(!this.allocator.isNull(), "cannot mutate a borrowed String.Slice", .{});
            return @constCast(this.ptr)[0..this.len];
        }

        /// Does nothing if the slice is not allocated
        pub fn deinit(this: *const Slice) void {
            this.allocator.free(this.slice());
        }
    };
};

pub const SliceWithUnderlyingString = struct {
    utf8: StringView.Slice = StringView.Slice.empty,
    underlying: String = String.dead,

    did_report_extra_memory_debug: bun.DebugOnly(bool) = if (bun.Environment.isDebug) false,

    pub inline fn reportExtraMemory(this: *SliceWithUnderlyingString, vm: *jsc.VM) void {
        if (comptime bun.Environment.isDebug) {
            bun.assert(!this.did_report_extra_memory_debug);
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
            .utf8 = StringView.Slice.empty,
            .underlying = this.underlying.dupeRef(),
        };
    }

    /// Transcode a byte array to an encoded String, avoiding unnecessary copies.
    ///
    /// owned_input_bytes ownership is transferred to this function
    pub fn transcodeFromOwnedSlice(owned_input_bytes: []u8, encoding: jsc.Node.Encoding) SliceWithUnderlyingString {
        if (owned_input_bytes.len == 0) {
            return .{
                .utf8 = StringView.Slice.empty,
                .underlying = String.empty,
            };
        }

        return .{
            .underlying = jsc.WebCore.encoding.toBunStringFromOwnedSlice(owned_input_bytes, encoding),
        };
    }

    /// Assumes default allocator in use
    pub fn fromUTF8(utf8: []const u8) SliceWithUnderlyingString {
        return .{
            .utf8 = StringView.Slice.init(bun.default_allocator, utf8),
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

    pub fn format(self: SliceWithUnderlyingString, writer: *std.Io.Writer) !void {
        if (self.utf8.len == 0) {
            try self.underlying.format(writer);
            return;
        }

        try writer.writeAll(self.utf8.slice());
    }

    pub fn toJS(this: *SliceWithUnderlyingString, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return this.toJSWithOptions(globalObject, false);
    }

    pub fn transferToJS(this: *SliceWithUnderlyingString, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return this.toJSWithOptions(globalObject, true);
    }

    fn toJSWithOptions(this: *SliceWithUnderlyingString, globalObject: *jsc.JSGlobalObject, transfer: bool) bun.JSError!jsc.JSValue {
        if ((this.underlying.tag == .Dead or this.underlying.tag == .Empty) and this.utf8.length() > 0) {
            if (comptime bun.Environment.allow_assert) {
                if (this.utf8.allocator.get()) |allocator| {
                    bun.assert(!String.isWTFAllocator(allocator)); // We should never enter this state.
                }
            }

            if (this.utf8.allocator.get()) |_| {
                if (bun.strings.toUTF16Alloc(bun.default_allocator, this.utf8.slice(), false, false) catch null) |utf16| {
                    this.utf8.deinit();
                    this.utf8 = .{};
                    // utf16.len > 0 guaranteed: toUTF16Alloc returns null for all-ASCII, and utf8.length() > 0 checked above
                    var out = String.createExternalGloballyAllocated(.utf16, utf16);
                    return out.transferToJS(globalObject);
                } else {
                    // All-ASCII case. utf8.length() > 0 checked above.
                    var out = String.createExternalGloballyAllocated(.latin1, @constCast(this.utf8.slice()));
                    this.utf8 = .{};
                    return out.transferToJS(globalObject);
                }
            }

            defer {
                if (transfer) {
                    this.utf8.deinit();
                    this.utf8 = .{};
                }
            }

            return String.createUTF8ForJS(globalObject, this.utf8.slice());
        }

        if (transfer) {
            this.utf8.deinit();
            this.utf8 = .{};
            return this.underlying.transferToJS(globalObject);
        } else {
            return this.underlying.toJS(globalObject);
        }
    }
};

/// Internal borrowed-bytes representation used by `bun.String` for the
/// `.StringView` and `.StaticStringView` variants. Not a public API — prefer
/// `bun.String` in all new code.
///
/// This struct uses a tagged pointer: bits 63/62/61/60 encode UTF16/global-alloc/UTF8/static.
/// The ABI matches the C `struct ZigStringView { const unsigned char* ptr; size_t len; }` in
/// `headers-handwritten.h`, and it backs the `.view` field of the C `BunStringImpl` union.
///
/// It is also used as a tagged byte-buffer carrier for `FetchHeaders.create` (see
/// `WebCore__FetchHeaders__createValueNotJS` and `Zig::toStringCopy(ZigStringView, StringPointer)`).
pub const StringView = extern struct {
    _unsafe_ptr_do_not_use: [*]const u8,
    len: usize,

    pub const Empty = StringView{ ._unsafe_ptr_do_not_use = "", .len = 0 };

    /// Alias for `bun.String.Slice`.
    pub const Slice = String.Slice;

    pub const ByteString = union(enum) {
        latin1: []const u8,
        utf16: []const u16,
    };

    // === Tag bit helpers ===

    pub inline fn untagged(ptr: [*]const u8) [*]const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        @setRuntimeSafety(false);
        return @as([*]const u8, @ptrFromInt(@as(u53, @truncate(@intFromPtr(ptr)))));
    }

    pub inline fn is16Bit(this: *const StringView) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 63)) != 0;
    }

    pub fn isUTF8(this: StringView) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 61)) != 0;
    }

    pub inline fn isGloballyAllocated(this: StringView) bool {
        return (@intFromPtr(this._unsafe_ptr_do_not_use) & (1 << 62)) != 0;
    }

    pub fn markUTF8(this: *StringView) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 61)));
    }

    pub fn markUTF16(this: *StringView) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 63)));
    }

    pub inline fn markGlobal(this: *StringView) void {
        this._unsafe_ptr_do_not_use = @as([*]const u8, @ptrFromInt(@intFromPtr(this._unsafe_ptr_do_not_use) | (1 << 62)));
    }

    // === Constructors ===

    pub inline fn init(slice_: []const u8) StringView {
        return .{ ._unsafe_ptr_do_not_use = slice_.ptr, .len = slice_.len };
    }

    pub fn initUTF8(slice_: []const u8) StringView {
        var out = init(slice_);
        out.markUTF8();
        return out;
    }

    pub fn initUTF16(items: []const u16) StringView {
        var out = StringView{ ._unsafe_ptr_do_not_use = @ptrCast(items), .len = items.len };
        out.markUTF16();
        return out;
    }

    pub fn fromBytes(slice_: []const u8) StringView {
        if (!bun.strings.isAllASCII(slice_)) {
            return initUTF8(slice_);
        }
        return init(slice_);
    }

    pub fn fromUTF8(slice_: []const u8) StringView {
        var out = init(slice_);
        if (!bun.strings.isAllASCII(slice_))
            out.markUTF8();
        return out;
    }

    /// Globally-allocated memory only
    pub fn from16Slice(slice_: []const u16) StringView {
        var str = init(@as([*]const u8, @ptrCast(slice_.ptr))[0..slice_.len]);
        str.markUTF16();
        str.markGlobal();
        return str;
    }

    fn from16SliceMaybeGlobal(slice_: []const u16, global: bool) StringView {
        var str = init(@as([*]const u8, @ptrCast(@alignCast(slice_.ptr)))[0..slice_.len]);
        str.markUTF16();
        if (global) {
            str.markGlobal();
        }
        return str;
    }

    // === Slice accessors ===

    pub fn slice(this: *const StringView) []const u8 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and this.is16Bit()) {
                @panic("StringView.slice() called on a UTF-16 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }
        return untagged(this._unsafe_ptr_do_not_use)[0..@min(this.len, std.math.maxInt(u32))];
    }

    pub inline fn utf16Slice(this: *const StringView) []align(1) const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("StringView.utf16Slice() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }
        return @as([*]align(1) const u16, @ptrCast(untagged(this._unsafe_ptr_do_not_use)))[0..this.len];
    }

    pub inline fn utf16SliceAligned(this: *const StringView) []const u16 {
        if (comptime bun.Environment.allow_assert) {
            if (this.len > 0 and !this.is16Bit()) {
                @panic("StringView.utf16SliceAligned() called on a latin1 string.\nPlease use .toSlice() instead or carefully check that .is16Bit() is false first.");
            }
        }
        return @as([*]const u16, @ptrCast(@alignCast(untagged(this._unsafe_ptr_do_not_use))))[0..this.len];
    }

    pub fn byteSlice(this: StringView) []const u8 {
        if (this.is16Bit()) {
            return std.mem.sliceAsBytes(this.utf16SliceAligned());
        }
        return this.slice();
    }

    pub inline fn as(this: StringView) ByteString {
        return if (this.is16Bit()) .{ .utf16 = this.utf16SliceAligned() } else .{ .latin1 = this.slice() };
    }

    pub inline fn length(this: StringView) usize {
        return this.len;
    }

    // === Transforms ===

    pub fn trunc(this: StringView, len: usize) StringView {
        return .{ ._unsafe_ptr_do_not_use = this._unsafe_ptr_do_not_use, .len = @min(len, this.len) };
    }

    pub fn substringWithLen(this: StringView, start_index: usize, end_index: usize) StringView {
        if (this.is16Bit()) {
            return from16SliceMaybeGlobal(this.utf16SliceAligned()[start_index..end_index], this.isGloballyAllocated());
        }
        var out = init(this.slice()[start_index..end_index]);
        if (this.isUTF8()) out.markUTF8();
        if (this.isGloballyAllocated()) out.markGlobal();
        return out;
    }

    // === Length calculations ===

    pub fn utf8ByteLength(this: StringView) usize {
        if (this.isUTF8()) return this.len;
        if (this.is16Bit()) return bun.strings.elementLengthUTF16IntoUTF8(this.utf16SliceAligned());
        return bun.webcore.encoding.byteLengthU8(this.slice().ptr, this.slice().len, .utf8);
    }

    pub fn utf16ByteLength(this: StringView) usize {
        if (this.isUTF8()) return bun.simdutf.length.utf16.from.utf8(this.slice());
        if (this.is16Bit()) return this.len * 2;
        return jsc.WebCore.encoding.byteLengthU8(this.slice().ptr, this.slice().len, .utf16le);
    }

    pub fn latin1ByteLength(this: StringView) usize {
        if (this.isUTF8()) @panic("TODO");
        return this.len;
    }

    // === Encoding conversions ===

    pub fn toOwnedSlice(this: StringView, allocator: std.mem.Allocator) OOM![]u8 {
        if (this.isUTF8())
            return try allocator.dupeZ(u8, this.slice());

        var list = std.array_list.Managed(u8).init(allocator);
        list = if (this.is16Bit())
            try bun.strings.toUTF8ListWithType(list, this.utf16SliceAligned())
        else
            try bun.strings.allocateLatin1IntoUTF8WithList(list, 0, this.slice());

        if (list.capacity > list.items.len) {
            list.items.ptr[list.items.len] = 0;
        }
        if (list.capacity > 0 and list.items.len == 0) {
            list.deinit();
            return &.{};
        }
        return list.items;
    }

    pub fn toOwnedSliceZ(this: StringView, allocator: std.mem.Allocator) OOM![:0]u8 {
        if (this.isUTF8())
            return allocator.dupeZ(u8, this.slice());

        var list = std.array_list.Managed(u8).init(allocator);
        list = if (this.is16Bit())
            try bun.strings.toUTF8ListWithType(list, this.utf16SliceAligned())
        else
            try bun.strings.allocateLatin1IntoUTF8WithList(list, 0, this.slice());

        return list.toOwnedSliceSentinel(0);
    }

    /// This function checks if the input is latin1 non-ascii.
    /// It is slow but safer when the input is from JavaScript.
    pub fn toSlice(this: StringView, allocator: std.mem.Allocator) String.Slice {
        if (this.len == 0)
            return String.Slice.empty;
        if (is16Bit(&this)) {
            const buffer = bun.handleOom(this.toOwnedSlice(allocator));
            return .{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }
        if (!this.isUTF8() and !bun.strings.isAllASCII(untagged(this._unsafe_ptr_do_not_use)[0..this.len])) {
            const buffer = bun.handleOom(this.toOwnedSlice(allocator));
            return .{
                .allocator = NullableAllocator.init(allocator),
                .ptr = buffer.ptr,
                .len = @as(u32, @truncate(buffer.len)),
            };
        }
        return .{
            .ptr = untagged(this._unsafe_ptr_do_not_use),
            .len = @as(u32, @truncate(this.len)),
        };
    }

    pub fn encodeWithAllocator(this: StringView, allocator: std.mem.Allocator, enc: jsc.Node.Encoding) []u8 {
        return switch (this.as()) {
            inline else => |repr| switch (enc) {
                inline else => |e| jsc.WebCore.encoding.constructFrom(std.meta.Child(@TypeOf(repr)), repr, allocator, e),
            },
        };
    }

    // === Equality ===

    pub fn eqlComptime(this: StringView, comptime other: []const u8) bool {
        if (this.is16Bit()) {
            return bun.strings.eqlComptimeUTF16(this.utf16SliceAligned(), other);
        }
        if (comptime bun.strings.isAllASCII(other)) {
            if (this.len != other.len) return false;
            return bun.strings.eqlComptimeIgnoreLen(this.slice(), other);
        }
        @compileError("Not implemented yet for latin1");
    }

    pub fn eql(this: StringView, other: StringView) bool {
        if (this.len == 0 or other.len == 0)
            return this.len == other.len;

        const left_utf16 = this.is16Bit();
        const right_utf16 = other.is16Bit();

        if (left_utf16 == right_utf16 and left_utf16) {
            return bun.strings.eqlLong(std.mem.sliceAsBytes(this.utf16SliceAligned()), std.mem.sliceAsBytes(other.utf16SliceAligned()), true);
        } else if (left_utf16 == right_utf16) {
            return bun.strings.eqlLong(this.slice(), other.slice(), true);
        }

        const utf16: StringView = if (left_utf16) this else other;
        const latin1_s: StringView = if (left_utf16) other else this;

        if (latin1_s.isAllASCII()) {
            return bun.strings.utf16EqlString(utf16.utf16SliceAligned(), latin1_s.slice());
        }

        // slow path
        var utf16_slice = utf16.toSlice(bun.default_allocator);
        var latin1_slice = latin1_s.toSlice(bun.default_allocator);
        defer utf16_slice.deinit();
        defer latin1_slice.deinit();
        return bun.strings.eqlLong(utf16_slice.slice(), latin1_slice.slice(), true);
    }

    fn isAllASCII(this: StringView) bool {
        if (this.is16Bit()) {
            return bun.strings.firstNonASCII16(this.utf16SliceAligned()) == null;
        }
        return bun.strings.isAllASCII(this.slice());
    }

    // === Formatting ===

    pub fn format(self: StringView, writer: *std.Io.Writer) !void {
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

    pub const GithubActionFormatter = struct {
        text: StringView,

        pub fn format(this: GithubActionFormatter, writer: *std.Io.Writer) !void {
            var bytes = this.text.toSlice(bun.default_allocator);
            defer bytes.deinit();
            try bun.fmt.githubActionWriter(writer, bytes.slice());
        }
    };

    pub fn githubAction(this: StringView) GithubActionFormatter {
        return .{ .text = this };
    }
};

/// Free callback for ExternalStringImpl backed by mimalloc.
/// Called from C++ `Zig::free_global_string` (helpers.h) to release globally-allocated string bytes.
export fn BunString__freeGlobalBytes(ptr: [*]const u8, len: usize) void {
    const untagged_ptr = @as(*anyopaque, @ptrFromInt(@intFromPtr(StringView.init(ptr[0..len]).slice().ptr)));
    if (comptime bun.Environment.allow_assert) {
        bun.assert(bun.mimalloc.mi_is_in_heap_region(ptr));
    }
    // we must untag the string pointer
    bun.mimalloc.mi_free(untagged_ptr);
}

comptime {
    bun.assert_eql(@sizeOf(bun.String), 24);
    bun.assert_eql(@alignOf(bun.String), 8);
}

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const OOM = bun.OOM;
const NullableAllocator = bun.NullableAllocator;
const AsciiStatus = bun.strings.AsciiStatus;

const jsc = bun.jsc;
const JSValue = bun.jsc.JSValue;
