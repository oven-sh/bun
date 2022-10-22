const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../jsc.zig");
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;

const ObjectPool = @import("../../pool.zig").ObjectPool;
const bun = @import("../../global.zig");
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const strings = @import("../../global.zig").strings;
const string = @import("../../global.zig").string;
const default_allocator = @import("../../global.zig").default_allocator;
const FeatureFlags = @import("../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = @import("../javascript.zig").Task;

const picohttp = @import("picohttp");

pub const TextEncoder = struct {
    filler: u32 = 0,

    const utf8_string: string = "utf-8";

    pub export fn TextEncoder__encode8(
        globalThis: *JSGlobalObject,
        ptr: [*]const u8,
        len: usize,
    ) JSValue {
        // as much as possible, rely on JSC to own the memory
        // their code is more battle-tested than bun's code
        // so we do a stack allocation here
        // and then copy into JSC memory
        // unless it's huge
        // JSC will GC Uint8Array that occupy less than 512 bytes
        // so it's extra good for that case
        // this also means there won't be reallocations for small strings
        var buf: [2048]u8 = undefined;
        const slice = ptr[0..len];

        if (slice.len <= buf.len / 2) {
            const result = strings.copyLatin1IntoUTF8(&buf, []const u8, slice);
            const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
            std.debug.assert(result.written <= buf.len);
            std.debug.assert(result.read == slice.len);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            std.debug.assert(result.written == array_buffer.len);
            @memcpy(array_buffer.byteSlice().ptr, &buf, result.written);
            return uint8array;
        } else {
            const bytes = strings.allocateLatin1IntoUTF8(globalThis.bunVM().allocator, []const u8, slice) catch {
                return JSC.toInvalidArguments("Out of memory", .{}, globalThis);
            };
            std.debug.assert(bytes.len >= slice.len);
            return ArrayBuffer.fromBytes(bytes, .Uint8Array).toJSUnchecked(globalThis, null);
        }
    }

    pub export fn TextEncoder__encode16(
        globalThis: *JSGlobalObject,
        ptr: [*]const u16,
        len: usize,
    ) JSValue {
        // as much as possible, rely on JSC to own the memory
        // their code is more battle-tested than bun's code
        // so we do a stack allocation here
        // and then copy into JSC memory
        // unless it's huge
        // JSC will GC Uint8Array that occupy less than 512 bytes
        // so it's extra good for that case
        // this also means there won't be reallocations for small strings
        var buf: [2048]u8 = undefined;

        const slice = ptr[0..len];

        // max utf16 -> utf8 length
        if (slice.len <= buf.len / 4) {
            const result = strings.copyUTF16IntoUTF8(&buf, @TypeOf(slice), slice);
            const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
            std.debug.assert(result.written <= buf.len);
            std.debug.assert(result.read == slice.len);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            std.debug.assert(result.written == array_buffer.len);
            @memcpy(array_buffer.slice().ptr, &buf, result.written);
            return uint8array;
        } else {
            var bytes = strings.toUTF8AllocWithType(
                default_allocator,
                @TypeOf(slice),
                slice,
            ) catch {
                return JSC.toInvalidArguments("Out of memory", .{}, globalThis);
            };
            return ArrayBuffer.fromBytes(bytes, .Uint8Array).toJSUnchecked(globalThis, null);
        }
    }

    // This is a fast path for copying a Rope string into a Uint8Array.
    // This keeps us from an extra string temporary allocation
    const RopeStringEncoder = struct {
        globalThis: *JSGlobalObject,
        buf: []u8,
        tail: usize = 0,
        any_non_ascii: bool = false,

        pub fn append8(it: *JSC.JSString.Iterator, ptr: [*]const u8, len: u32) callconv(.C) void {
            var this = bun.cast(*RopeStringEncoder, it.data.?);
            const result = strings.copyLatin1IntoUTF8StopOnNonASCII(this.buf[this.tail..], []const u8, ptr[0..len], true);
            if (result.read == std.math.maxInt(u32) and result.written == std.math.maxInt(u32)) {
                it.stop = 1;
                this.any_non_ascii = true;
            } else {
                this.tail += result.written;
            }
        }
        pub fn append16(it: *JSC.JSString.Iterator, _: [*]const u16, _: u32) callconv(.C) void {
            var this = bun.cast(*RopeStringEncoder, it.data.?);
            this.any_non_ascii = true;
            it.stop = 1;
        }
        pub fn write8(it: *JSC.JSString.Iterator, ptr: [*]const u8, len: u32, offset: u32) callconv(.C) void {
            var this = bun.cast(*RopeStringEncoder, it.data.?);
            const result = strings.copyLatin1IntoUTF8StopOnNonASCII(this.buf[offset..], []const u8, ptr[0..len], true);
            if (result.read == std.math.maxInt(u32) and result.written == std.math.maxInt(u32)) {
                it.stop = 1;
                this.any_non_ascii = true;
            }
        }
        pub fn write16(it: *JSC.JSString.Iterator, _: [*]const u16, _: u32, _: u32) callconv(.C) void {
            var this = bun.cast(*RopeStringEncoder, it.data.?);
            this.any_non_ascii = true;
            it.stop = 1;
        }

        pub fn iter(this: *RopeStringEncoder) JSC.JSString.Iterator {
            return .{
                .data = this,
                .stop = 0,
                .append8 = append8,
                .append16 = append16,
                .write8 = write8,
                .write16 = write16,
            };
        }
    };

    // This fast path is only suitable for ASCII strings
    // It's not suitable for UTF-16 strings, because getting the byteLength is unpredictable
    // It also isn't usable for latin1 strings which contain non-ascii characters
    pub export fn TextEncoder__encodeRopeString(
        globalThis: *JSGlobalObject,
        rope_str: *JSC.JSString,
    ) JSValue {
        if (comptime Environment.allow_assert) std.debug.assert(rope_str.is8Bit());
        var stack_buf: [2048]u8 = undefined;
        var buf_to_use: []u8 = &stack_buf;
        const length = rope_str.length();
        var array: JSValue = JSValue.zero;
        if (length > stack_buf.len / 2) {
            array = JSC.JSValue.createUninitializedUint8Array(globalThis, length);
            array.ensureStillAlive();
            buf_to_use = array.asArrayBuffer(globalThis).?.slice();
        }
        var encoder = RopeStringEncoder{
            .globalThis = globalThis,
            .buf = buf_to_use,
        };
        var iter = encoder.iter();
        array.ensureStillAlive();
        rope_str.iterator(globalThis, &iter);
        array.ensureStillAlive();

        if (encoder.any_non_ascii) {
            return JSC.JSValue.jsUndefined();
        }

        if (array.isEmpty()) {
            array = JSC.JSValue.createUninitializedUint8Array(globalThis, length);
            array.ensureStillAlive();
            @memcpy(array.asArrayBuffer(globalThis).?.ptr, buf_to_use.ptr, length);
        }

        return array;
    }

    pub export fn TextEncoder__encodeInto16(
        input_ptr: [*]const u16,
        input_len: usize,
        buf_ptr: [*]u8,
        buf_len: usize,
    ) u64 {
        var output = buf_ptr[0..buf_len];
        const input = input_ptr[0..input_len];
        const result: strings.EncodeIntoResult =
            strings.copyUTF16IntoUTF8(output, []const u16, input);
        const sized: [2]u32 = .{ result.read, result.written };
        return @bitCast(u64, sized);
    }

    pub export fn TextEncoder__encodeInto8(
        input_ptr: [*]const u8,
        input_len: usize,
        buf_ptr: [*]u8,
        buf_len: usize,
    ) u64 {
        var output = buf_ptr[0..buf_len];
        const input = input_ptr[0..input_len];
        const result: strings.EncodeIntoResult =
            strings.copyLatin1IntoUTF8(output, []const u8, input);
        const sized: [2]u32 = .{ result.read, result.written };
        return @bitCast(u64, sized);
    }
};

comptime {
    if (!JSC.is_bindgen) {
        _ = TextEncoder.TextEncoder__encode8;
        _ = TextEncoder.TextEncoder__encode16;
        _ = TextEncoder.TextEncoder__encodeInto8;
        _ = TextEncoder.TextEncoder__encodeInto16;
        _ = TextEncoder.TextEncoder__encodeRopeString;
    }
}

/// https://encoding.spec.whatwg.org/encodings.json
pub const EncodingLabel = enum {
    @"UTF-8",
    @"IBM866",
    @"ISO-8859-2",
    @"ISO-8859-3",
    @"ISO-8859-4",
    @"ISO-8859-5",
    @"ISO-8859-6",
    @"ISO-8859-7",
    @"ISO-8859-8",
    @"ISO-8859-8-I",
    @"ISO-8859-10",
    @"ISO-8859-13",
    @"ISO-8859-14",
    @"ISO-8859-15",
    @"ISO-8859-16",
    @"KOI8-R",
    @"KOI8-U",
    @"macintosh",
    @"windows-874",
    @"windows-1250",
    @"windows-1251",
    /// Also known as
    /// - ASCII
    /// - latin1
    @"windows-1252",
    @"windows-1253",
    @"windows-1254",
    @"windows-1255",
    @"windows-1256",
    @"windows-1257",
    @"windows-1258",
    @"x-mac-cyrillic",
    @"Big5",
    @"EUC-JP",
    @"ISO-2022-JP",
    @"Shift_JIS",
    @"EUC-KR",
    @"UTF-16BE",
    @"UTF-16LE",
    @"x-user-defined",

    pub const Map = std.enums.EnumMap(EncodingLabel, string);
    pub const label: Map = brk: {
        var map = Map.initFull("");
        map.put(EncodingLabel.@"UTF-8", "utf-8");
        map.put(EncodingLabel.@"UTF-16LE", "utf-16le");
        map.put(EncodingLabel.@"windows-1252", "windows-1252");
        break :brk map;
    };

    const utf16_names = [_]string{
        "ucs-2",
        "utf-16",
        "unicode",
        "utf-16le",
        "csunicode",
        "unicodefeff",
        "iso-10646-ucs-2",
    };

    const utf8_names = [_]string{
        "utf8",
        "utf-8",
        "unicode11utf8",
        "unicode20utf8",
        "x-unicode20utf8",
        "unicode-1-1-utf-8",
    };

    const latin1_names = [_]string{
        "l1",
        "ascii",
        "cp819",
        "cp1252",
        "ibm819",
        "latin1",
        "iso88591",
        "us-ascii",
        "x-cp1252",
        "iso8859-1",
        "iso_8859-1",
        "iso-8859-1",
        "iso-ir-100",
        "csisolatin1",
        "windows-1252",
        "ansi_x3.4-1968",
        "iso_8859-1:1987",
    };

    pub const latin1 = EncodingLabel.@"windows-1252";

    pub fn which(input_: string) ?EncodingLabel {
        const input = strings.trim(input_, " \t\r\n");
        const ExactMatcher = strings.ExactSizeMatcher;
        const Eight = ExactMatcher(8);
        const Sixteen = ExactMatcher(16);
        return switch (input.len) {
            1, 0 => null,
            2...8 => switch (Eight.matchLower(input)) {
                Eight.case("l1"),
                Eight.case("ascii"),
                Eight.case("cp819"),
                Eight.case("cp1252"),
                Eight.case("ibm819"),
                Eight.case("latin1"),
                Eight.case("iso88591"),
                Eight.case("us-ascii"),
                Eight.case("x-cp1252"),
                => EncodingLabel.latin1,

                Eight.case("ucs-2"),
                Eight.case("utf-16"),
                Eight.case("unicode"),
                Eight.case("utf-16le"),
                => EncodingLabel.@"UTF-16LE",

                Eight.case("utf8"), Eight.case("utf-8") => EncodingLabel.@"UTF-8",
                else => null,
            },

            9...16 => switch (Sixteen.matchLower(input)) {
                Sixteen.case("iso8859-1"),
                Sixteen.case("iso_8859-1"),
                Sixteen.case("iso-8859-1"),
                Sixteen.case("iso-ir-100"),
                Sixteen.case("csisolatin1"),
                Sixteen.case("windows-1252"),
                Sixteen.case("ansi_x3.4-1968"),
                Sixteen.case("iso_8859-1:1987"),
                => EncodingLabel.latin1,

                Sixteen.case("unicode11utf8"),
                Sixteen.case("unicode20utf8"),
                Sixteen.case("x-unicode20utf8"),
                => EncodingLabel.@"UTF-8",

                Sixteen.case("csunicode"),
                Sixteen.case("unicodefeff"),
                Sixteen.case("iso-10646-ucs-2"),
                => EncodingLabel.@"UTF-16LE",

                else => null,
            },
            else => if (strings.eqlCaseInsensitiveASCII(input, "unicode-1-1-utf-8", true))
                EncodingLabel.@"UTF-8"
            else
                null,
        };
    }
};

pub const TextDecoder = struct {
    scratch_memory: []u8 = &[_]u8{},
    ignore_bom: bool = false,
    fatal: bool = false,
    encoding: EncodingLabel = EncodingLabel.utf8,

    pub fn finalize(this: *TextDecoder) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }

    pub usingnamespace JSC.Codegen.JSTextDecoder;

    pub fn getIgnoreBOM(
        this: *TextDecoder,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.ignore_bom);
    }
    // pub fn setIgnoreBOM(
    //     this: *TextDecoder,
    //     _: *JSC.JSGlobalObject,
    // ) callconv(.C) JSC.JSValue {
    //     this.ignore_bom = JSValue.fromRef(this.ignore_bom).toBoolean();
    //     return true;
    // }

    // pub fn setFatal(
    //     this: *TextDecoder,
    //     _: js.JSContextRef,
    //     _: js.JSValueRef,
    //     _: js.JSStringRef,
    //     value: JSC.C.JSValueRef,
    //     _: js.ExceptionRef,
    // ) bool {
    //     this.fatal = JSValue.fromRef(value).toBoolean();
    //     return true;
    // }
    pub fn getFatal(
        this: *TextDecoder,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.fatal);
    }

    const utf8_string: string = "utf-8";
    pub fn getEncoding(
        this: *TextDecoder,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(EncodingLabel.label.get(this.encoding).?).toValue(globalThis);
    }
    const Vector16 = std.meta.Vector(16, u16);
    const max_16_ascii: Vector16 = @splat(16, @as(u16, 127));

    fn decodeUTF16WithAlignment(
        _: *TextDecoder,
        comptime Slice: type,
        slice: Slice,
        ctx: js.JSContextRef,
    ) JSC.JSValue {
        var i: usize = 0;

        while (i < slice.len) {
            while (i + strings.ascii_u16_vector_size <= slice.len) {
                const vec: strings.AsciiU16Vector = slice[i..][0..strings.ascii_u16_vector_size].*;
                if ((@reduce(
                    .Or,
                    @bitCast(
                        strings.AsciiVectorU16U1,
                        vec > strings.max_u16_ascii,
                    ) | @bitCast(
                        strings.AsciiVectorU16U1,
                        vec < strings.min_u16_ascii,
                    ),
                ) == 0)) {
                    break;
                }
                i += strings.ascii_u16_vector_size;
            }
            while (i < slice.len and slice[i] <= 127) {
                i += 1;
            }
            break;
        }

        // is this actually a UTF-16 string that is just ascii?
        // we can still allocate as UTF-16 and just copy the bytes
        if (i == slice.len) {
            if (comptime Slice == []u16) {
                return ZigString.init16(slice).toValueGC(ctx);
            } else {
                var str = ZigString.init("");
                str.ptr = @ptrCast([*]u8, slice.ptr);
                str.len = slice.len;
                str.markUTF16();
                return str.toValueGC(ctx.ptr());
            }
        }

        var buffer = std.ArrayListAlignedUnmanaged(u16, @alignOf(@TypeOf(slice.ptr))){};
        // copy the allocator to reduce the number of threadlocal accesses
        const allocator = VirtualMachine.vm.allocator;
        buffer.ensureTotalCapacity(allocator, slice.len) catch unreachable;
        buffer.items.len = i;

        @memcpy(
            std.mem.sliceAsBytes(buffer.items).ptr,
            std.mem.sliceAsBytes(slice).ptr,
            std.mem.sliceAsBytes(slice[0..i]).len,
        );

        const first_high_surrogate = 0xD800;
        const last_high_surrogate = 0xDBFF;
        const first_low_surrogate = 0xDC00;
        const last_low_surrogate = 0xDFFF;

        var remainder = slice[i..];
        while (remainder.len > 0) {
            switch (remainder[0]) {
                0...127 => {
                    const count: usize = if (strings.firstNonASCII16CheckMin(Slice, remainder, false)) |index| index + 1 else remainder.len;

                    buffer.ensureUnusedCapacity(allocator, count) catch unreachable;

                    const prev = buffer.items.len;
                    buffer.items.len += count;
                    // Since this string is freshly allocated, we know it's not going to overlap
                    @memcpy(
                        std.mem.sliceAsBytes(buffer.items[prev..]).ptr,
                        std.mem.sliceAsBytes(remainder).ptr,
                        std.mem.sliceAsBytes(remainder[0..count]).len,
                    );
                    remainder = remainder[count..];
                },
                first_high_surrogate...last_high_surrogate => |first| {
                    if (remainder.len > 1) {
                        if (remainder[1] >= first_low_surrogate and remainder[1] <= last_low_surrogate) {
                            buffer.ensureUnusedCapacity(allocator, 2) catch unreachable;
                            buffer.items.ptr[buffer.items.len] = first;
                            buffer.items.ptr[buffer.items.len + 1] = remainder[1];
                            buffer.items.len += 2;
                            remainder = remainder[2..];
                            continue;
                        }
                    }
                    buffer.ensureUnusedCapacity(allocator, 1) catch unreachable;
                    buffer.items.ptr[buffer.items.len] = strings.unicode_replacement;
                    buffer.items.len += 1;
                    remainder = remainder[1..];
                    continue;
                },

                // Is this an unpaired low surrogate or four-digit hex escape?
                else => {
                    buffer.ensureUnusedCapacity(allocator, 1) catch unreachable;
                    buffer.items.ptr[buffer.items.len] = strings.unicode_replacement;
                    buffer.items.len += 1;
                    remainder = remainder[1..];
                },
            }
        }

        var full = buffer.toOwnedSlice(allocator);

        var out = ZigString.init("");
        out.ptr = @ptrCast([*]u8, full.ptr);
        out.len = full.len;
        out.markUTF16();
        return out.toValueGC(ctx.ptr());
    }

    pub fn decode(this: *TextDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1 or arguments[0].isUndefined()) {
            return ZigString.Empty.toValue(globalThis);
        }

        const array_buffer = arguments[0].asArrayBuffer(globalThis) orelse {
            globalThis.throwInvalidArguments("TextDecoder.decode expects an ArrayBuffer or TypedArray", .{});
            return JSValue.zero;
        };

        if (array_buffer.len == 0) {
            return ZigString.Empty.toValue(globalThis);
        }

        switch (this.encoding) {
            EncodingLabel.@"latin1" => {
                return ZigString.init(array_buffer.byteSlice()).toValueGC(globalThis);
            },
            EncodingLabel.@"UTF-8" => {
                const buffer_slice = array_buffer.byteSlice();

                if (this.fatal) {
                    if (strings.toUTF16Alloc(default_allocator, buffer_slice, true)) |result_| {
                        if (result_) |result| {
                            return ZigString.toExternalU16(result.ptr, result.len, globalThis);
                        }
                    } else |err| {
                        switch (err) {
                            error.InvalidByteSequence => {
                                globalThis.throw("Invalid byte sequence", .{});
                                return JSValue.zero;
                            },
                            error.OutOfMemory => {
                                globalThis.throw("Out of memory", .{});
                                return JSValue.zero;
                            },
                            else => {
                                globalThis.throw("Unknown error", .{});
                                return JSValue.zero;
                            },
                        }
                    }
                } else {
                    if (strings.toUTF16Alloc(default_allocator, buffer_slice, false)) |result_| {
                        if (result_) |result| {
                            return ZigString.toExternalU16(result.ptr, result.len, globalThis);
                        }
                    } else |err| {
                        switch (err) {
                            error.OutOfMemory => {
                                globalThis.throw("Out of memory", .{});
                                return JSValue.zero;
                            },
                            else => {
                                globalThis.throw("Unknown error", .{});
                                return JSValue.zero;
                            },
                        }
                    }
                }

                // Experiment: using mimalloc directly is slightly slower
                return ZigString.init(buffer_slice).toValueGC(globalThis);
            },

            EncodingLabel.@"UTF-16LE" => {
                if (std.mem.isAligned(@ptrToInt(array_buffer.ptr) + @as(usize, array_buffer.offset), @alignOf([*]u16))) {
                    return this.decodeUTF16WithAlignment([]u16, array_buffer.asU16(), globalThis);
                }

                return this.decodeUTF16WithAlignment([]align(1) u16, array_buffer.asU16Unaligned(), globalThis);
            },
            else => {
                globalThis.throwInvalidArguments("TextDecoder.decode set to unsupported encoding", .{});
                return JSValue.zero;
            },
        }
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*TextDecoder {
        var args_ = callframe.arguments(1);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        var encoding = EncodingLabel.@"UTF-8";
        if (arguments.len > 0) {
            if (!arguments[0].isString()) {
                globalThis.throwInvalidArguments("TextDecoder(encoding) label is invalid", .{});
                return null;
            }

            var str = arguments[0].toSlice(globalThis, default_allocator);
            defer if (str.allocated) str.deinit();
            encoding = EncodingLabel.which(str.slice()) orelse {
                globalThis.throwInvalidArguments("Unsupported encoding label \"{s}\"", .{str.slice()});
                return null;
            };
        }
        var decoder = getAllocator(globalThis).create(TextDecoder) catch unreachable;
        decoder.* = TextDecoder{ .encoding = encoding };
        return decoder;
    }
};

pub const Encoder = struct {
    export fn Bun__encoding__writeLatin1(input: [*]const u8, len: usize, to: [*]u8, to_len: usize, encoding: u8) i64 {
        return switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .utf8 => writeU8(input, len, to, to_len, .utf8),
            .latin1 => writeU8(input, len, to, to_len, .ascii),
            .ascii => writeU8(input, len, to, to_len, .ascii),
            .ucs2 => writeU8(input, len, to, to_len, .utf16le),
            .utf16le => writeU8(input, len, to, to_len, .utf16le),
            .base64 => writeU8(input, len, to, to_len, .base64),
            .base64url => writeU8(input, len, to, to_len, .base64url),
            .hex => writeU8(input, len, to, to_len, .hex),
            else => unreachable,
        };
    }
    export fn Bun__encoding__writeUTF16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, encoding: u8) i64 {
        return switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .utf8 => writeU16(input, len, to, to_len, .utf8),
            .latin1 => writeU16(input, len, to, to_len, .ascii),
            .ascii => writeU16(input, len, to, to_len, .ascii),
            .ucs2 => writeU16(input, len, to, to_len, .utf16le),
            .utf16le => writeU16(input, len, to, to_len, .utf16le),
            .base64 => writeU16(input, len, to, to_len, .base64),
            .base64url => writeU16(input, len, to, to_len, .base64url),
            .hex => writeU16(input, len, to, to_len, .hex),
            else => unreachable,
        };
    }
    export fn Bun__encoding__byteLengthLatin1(input: [*]const u8, len: usize, encoding: u8) usize {
        return switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .utf8 => byteLengthU8(input, len, .utf8),
            .latin1 => byteLengthU8(input, len, .ascii),
            .ascii => byteLengthU8(input, len, .ascii),
            .ucs2 => byteLengthU8(input, len, .utf16le),
            .utf16le => byteLengthU8(input, len, .utf16le),
            .base64 => byteLengthU8(input, len, .base64),
            .base64url => byteLengthU8(input, len, .base64url),
            .hex => byteLengthU8(input, len, .hex),
            else => unreachable,
        };
    }
    export fn Bun__encoding__byteLengthUTF16(input: [*]const u16, len: usize, encoding: u8) usize {
        return switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .utf8 => byteLengthU16(input, len, .utf8),
            .latin1 => byteLengthU16(input, len, .ascii),
            .ascii => byteLengthU16(input, len, .ascii),
            .ucs2 => byteLengthU16(input, len, .utf16le),
            .utf16le => byteLengthU16(input, len, .utf16le),
            .base64 => byteLengthU16(input, len, .base64),
            .base64url => byteLengthU16(input, len, .base64url),
            .hex => byteLengthU16(input, len, .hex),
            else => unreachable,
        };
    }
    export fn Bun__encoding__constructFromLatin1(globalObject: *JSGlobalObject, input: [*]const u8, len: usize, encoding: u8) JSValue {
        var slice = switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .hex => constructFromU8(input, len, .hex),
            .ascii => constructFromU8(input, len, .ascii),
            .base64url => constructFromU8(input, len, .base64url),
            .utf16le => constructFromU8(input, len, .utf16le),
            .ucs2 => constructFromU8(input, len, .utf16le),
            .utf8 => constructFromU8(input, len, .utf8),
            .base64 => constructFromU8(input, len, .base64),
            else => unreachable,
        };
        return JSC.JSValue.createBuffer(globalObject, slice, globalObject.bunVM().allocator);
    }
    export fn Bun__encoding__constructFromUTF16(globalObject: *JSGlobalObject, input: [*]const u16, len: usize, encoding: u8) JSValue {
        var slice = switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .base64 => constructFromU16(input, len, .base64),
            .hex => constructFromU16(input, len, .hex),
            .base64url => constructFromU16(input, len, .base64url),
            .utf16le => constructFromU16(input, len, .utf16le),
            .ucs2 => constructFromU16(input, len, .utf16le),
            .utf8 => constructFromU16(input, len, .utf8),
            .ascii => constructFromU16(input, len, .utf8),
            else => unreachable,
        };
        return JSC.JSValue.createBuffer(globalObject, slice, globalObject.bunVM().allocator);
    }

    // for SQL statement
    export fn Bun__encoding__toStringUTF8(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject) JSValue {
        return toString(input, len, globalObject, .utf8);
    }

    export fn Bun__encoding__toString(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject, encoding: u8) JSValue {
        return switch (@intToEnum(JSC.Node.Encoding, encoding)) {
            .ucs2 => toString(input, len, globalObject, .utf16le),
            .utf16le => toString(input, len, globalObject, .utf16le),
            .utf8 => toString(input, len, globalObject, .utf8),
            .ascii => toString(input, len, globalObject, .ascii),
            .hex => toString(input, len, globalObject, .hex),
            .base64 => toString(input, len, globalObject, .base64),
            .base64url => toString(input, len, globalObject, .base64url),

            // treat everything else as utf8
            else => toString(input, len, globalObject, .utf8),
        };
    }

    // pub fn writeUTF16AsUTF8(utf16: [*]const u16, len: usize, to: [*]u8, to_len: usize) callconv(.C) i32 {
    //     return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, utf16[0..len]).written);
    // }

    pub fn toString(input_ptr: [*]const u8, len: usize, global: *JSGlobalObject, comptime encoding: JSC.Node.Encoding) JSValue {
        if (len == 0)
            return ZigString.Empty.toValue(global);

        const input = input_ptr[0..len];
        const allocator = VirtualMachine.vm.allocator;

        switch (comptime encoding) {
            .ascii => {
                var to = allocator.alloc(u8, len) catch return ZigString.init("Out of memory").toErrorInstance(global);

                @memcpy(to.ptr, input_ptr, to.len);

                // Hoping this gets auto vectorized
                for (to[0..to.len]) |c, i| {
                    to[i] = @as(u8, @truncate(u7, c));
                }

                return ZigString.init(to).toExternalValue(global);
            },
            .latin1 => {
                var to = allocator.alloc(u8, len) catch return ZigString.init("Out of memory").toErrorInstance(global);

                @memcpy(to.ptr, input_ptr, to.len);

                return ZigString.init(to).toExternalValue(global);
            },
            .buffer, .utf8 => {
                // JSC only supports UTF-16 strings for non-ascii text
                const converted = strings.toUTF16Alloc(allocator, input, false) catch return ZigString.init("Out of memory").toErrorInstance(global);
                if (converted) |utf16| {
                    return ZigString.toExternalU16(utf16.ptr, utf16.len, global);
                }

                // If we get here, it means we can safely assume the string is 100% ASCII characters
                // For this, we rely on the GC to manage the memory to minimize potential for memory leaks
                return ZigString.init(input).toValueGC(global);
            },
            .ucs2, .utf16le => {
                var output = allocator.alloc(u16, len / 2) catch return ZigString.init("Out of memory").toErrorInstance(global);
                var i: usize = 0;
                while (i < len / 2) : (i += 1) {
                    output[i] = (@intCast(u16, input[2 * i + 1]) << 8) + @intCast(u16, input[2 * i]);
                }
                return ZigString.toExternalU16(output.ptr, output.len, global);
            },

            JSC.Node.Encoding.hex => {
                var output = allocator.alloc(u8, input.len * 2) catch return ZigString.init("Out of memory").toErrorInstance(global);
                const wrote = strings.encodeBytesToHex(output, input);
                std.debug.assert(wrote == output.len);
                var val = ZigString.init(output);
                val.mark();
                return val.toExternalValue(global);
            },

            JSC.Node.Encoding.base64url => {
                return JSC.WTF.toBase64URLStringValue(input, global);
            },

            JSC.Node.Encoding.base64 => {
                const to_len = bun.base64.encodeLen(input);
                var to = allocator.alloc(u8, to_len) catch return ZigString.init("Out of memory").toErrorInstance(global);
                const wrote = bun.base64.encode(to, input);
                return ZigString.init(to[0..wrote]).toExternalValue(global);
            },
        }
    }

    pub fn writeU8(input: [*]const u8, len: usize, to: [*]u8, to_len: usize, comptime encoding: JSC.Node.Encoding) i64 {
        if (len == 0 or to_len == 0)
            return 0;

        // TODO: increase temporary buffer size for larger amounts of data
        // defer {
        //     if (comptime encoding.isBinaryToText()) {}
        // }

        // if (comptime encoding.isBinaryToText()) {}

        switch (comptime encoding) {
            JSC.Node.Encoding.buffer => {
                const written = @minimum(len, to_len);
                @memcpy(to, input, written);

                return @intCast(i64, written);
            },
            .latin1, .ascii => {
                const written = @minimum(len, to_len);
                @memcpy(to, input, written);

                // Hoping this gets auto vectorized
                for (to[0..written]) |c, i| {
                    to[i] = @as(u8, @truncate(u7, c));
                }

                return @intCast(i64, written);
            },
            .utf8 => {
                // need to encode
                return @intCast(i64, strings.copyLatin1IntoUTF8(to[0..to_len], []const u8, input[0..len]).written);
            },
            // encode latin1 into UTF16
            JSC.Node.Encoding.ucs2, JSC.Node.Encoding.utf16le => {
                if (to_len < 2)
                    return 0;

                if (std.mem.isAligned(@ptrToInt(to), @alignOf([*]u16))) {
                    var buf = input[0..len];
                    var output = @ptrCast([*]u16, @alignCast(@alignOf(u16), to))[0 .. to_len / 2];
                    return strings.copyLatin1IntoUTF16([]u16, output, []const u8, buf).written;
                } else {
                    var buf = input[0..len];
                    var output = @ptrCast([*]align(1) u16, to)[0 .. to_len / 2];
                    return strings.copyLatin1IntoUTF16([]align(1) u16, output, []const u8, buf).written;
                }
            },

            JSC.Node.Encoding.hex => {
                return @intCast(i64, strings.decodeHexToBytes(to[0..to_len], u8, input[0..len]));
            },

            JSC.Node.Encoding.base64url => {
                var slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.VT});
                if (slice.len == 0)
                    return 0;

                if (strings.eqlComptime(slice[slice.len - 2 ..][0..2], "==")) {
                    slice = slice[0 .. slice.len - 2];
                } else if (slice[slice.len - 1] == '=') {
                    slice = slice[0 .. slice.len - 1];
                }

                const wrote = bun.base64.urlsafe.decode(to[0..to_len], slice) catch |err| brk: {
                    if (err == error.NoSpaceLeft) {
                        break :brk to_len;
                    }

                    return -1;
                };
                return @intCast(i64, wrote);
            },

            JSC.Node.Encoding.base64 => {
                var slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.VT});
                var outlen = bun.base64.decodeLen(slice);

                return @intCast(i64, bun.base64.decode(to[0..outlen], slice).written);
            },
            // else => return 0,
        }
    }

    pub fn byteLengthU8(input: [*]const u8, len: usize, comptime encoding: JSC.Node.Encoding) usize {
        if (len == 0)
            return 0;

        switch (comptime encoding) {
            .utf8 => {
                return strings.elementLengthLatin1IntoUTF8([]const u8, input[0..len]);
            },

            .latin1, JSC.Node.Encoding.ascii, JSC.Node.Encoding.buffer => {
                return len;
            },

            JSC.Node.Encoding.ucs2, JSC.Node.Encoding.utf16le => {
                return strings.elementLengthUTF8IntoUTF16([]const u8, input[0..len]) * 2;
            },

            JSC.Node.Encoding.hex => {
                return len * 2;
            },

            JSC.Node.Encoding.base64, JSC.Node.Encoding.base64url => {
                return bun.base64.encodeLen(input[0..len]);
            },
            // else => return &[_]u8{};
        }
    }

    pub fn writeU16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, comptime encoding: JSC.Node.Encoding) i64 {
        if (len == 0)
            return 0;

        switch (comptime encoding) {
            .utf8 => {
                return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, input[0..len]).written);
            },
            // string is already encoded, just need to copy the data
            .latin1, JSC.Node.Encoding.ascii, JSC.Node.Encoding.ucs2, JSC.Node.Encoding.buffer, JSC.Node.Encoding.utf16le => {
                strings.copyU16IntoU8(to[0..to_len], []const u16, input[0..len]);

                return @intCast(i64, @minimum(len, to_len));
            },

            JSC.Node.Encoding.hex => {
                return @intCast(i64, strings.decodeHexToBytes(to[0..to_len], u16, input[0..len]));
            },

            JSC.Node.Encoding.base64, JSC.Node.Encoding.base64url => {
                if (to_len < 2 or len == 0)
                    return 0;

                // very very slow case!
                // shouldn't really happen though
                var transcoded = strings.toUTF8Alloc(bun.default_allocator, input[0..len]) catch return 0;
                defer bun.default_allocator.free(transcoded);
                return writeU8(transcoded.ptr, transcoded.len, to, to_len, encoding);
            },
            // else => return &[_]u8{};
        }
    }

    /// Node returns imprecise byte length here
    /// Should be fast enough for us to return precise length
    pub fn byteLengthU16(input: [*]const u16, len: usize, comptime encoding: JSC.Node.Encoding) usize {
        if (len == 0)
            return 0;

        switch (comptime encoding) {
            // these should be the same size
            .ascii, .latin1, .utf8 => {
                return strings.elementLengthUTF16IntoUTF8([]const u16, input[0..len]);
            },
            JSC.Node.Encoding.ucs2, JSC.Node.Encoding.buffer, JSC.Node.Encoding.utf16le => {
                return len * 2;
            },

            JSC.Node.Encoding.hex => {
                return len;
            },

            JSC.Node.Encoding.base64, JSC.Node.Encoding.base64url => {
                return bun.base64.encodeLen(input[0..len]);
            },
            // else => return &[_]u8{};
        }
    }

    pub fn constructFromU8(input: [*]const u8, len: usize, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0)
            return &[_]u8{};

        const allocator = VirtualMachine.vm.allocator;

        switch (comptime encoding) {
            JSC.Node.Encoding.buffer => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};
                @memcpy(to.ptr, input, len);

                return to;
            },
            .latin1, .ascii => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};

                @memcpy(to.ptr, input, len);

                return to;
            },
            .utf8 => {
                // need to encode
                return strings.allocateLatin1IntoUTF8(allocator, []const u8, input[0..len]) catch return &[_]u8{};
            },
            // encode latin1 into UTF16
            // return as bytes
            JSC.Node.Encoding.ucs2, JSC.Node.Encoding.utf16le => {
                var to = allocator.alloc(u16, len) catch return &[_]u8{};
                _ = strings.copyLatin1IntoUTF16([]u16, to, []const u8, input[0..len]);
                return std.mem.sliceAsBytes(to[0..len]);
            },

            JSC.Node.Encoding.hex => {
                if (len < 2)
                    return &[_]u8{};

                var to = allocator.alloc(u8, len / 2) catch return &[_]u8{};
                return to[0..strings.decodeHexToBytes(to, u8, input[0..len])];
            },

            JSC.Node.Encoding.base64url => {
                var slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.VT});
                if (slice.len == 0)
                    return &[_]u8{};

                if (strings.eqlComptime(slice[slice.len - 2 ..][0..2], "==")) {
                    slice = slice[0 .. slice.len - 2];
                } else if (slice[slice.len - 1] == '=') {
                    slice = slice[0 .. slice.len - 1];
                }

                const to_len = bun.base64.urlsafe.decoder.calcSizeForSlice(slice) catch unreachable;
                var to = allocator.alloc(u8, to_len) catch return &[_]u8{};

                const wrote = bun.base64.urlsafe.decode(to[0..to_len], slice) catch |err| brk: {
                    if (err == error.NoSpaceLeft) {
                        break :brk to_len;
                    }

                    return &[_]u8{};
                };
                return to[0..wrote];
            },

            JSC.Node.Encoding.base64 => {
                var slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.VT});
                var outlen = bun.base64.decodeLen(slice);

                var to = allocator.alloc(u8, outlen) catch return &[_]u8{};
                const written = bun.base64.decode(to[0..outlen], slice).written;
                return to[0..written];
            },
            // else => return 0,
        }
    }

    pub fn constructFromU16(input: [*]const u16, len: usize, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0)
            return &[_]u8{};

        const allocator = VirtualMachine.vm.allocator;

        switch (comptime encoding) {
            .utf8 => {
                return strings.toUTF8AllocWithType(allocator, []const u16, input[0..len]) catch return &[_]u8{};
            },
            JSC.Node.Encoding.latin1, JSC.Node.Encoding.buffer, JSC.Node.Encoding.ascii => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};
                @memcpy(to.ptr, input, len);
                for (to[0..len]) |c, i| {
                    to[i] = @as(u8, @truncate(u7, c));
                }

                return to;
            },
            // string is already encoded, just need to copy the data
            JSC.Node.Encoding.ucs2, JSC.Node.Encoding.utf16le => {
                var to = std.mem.sliceAsBytes(allocator.alloc(u16, len * 2) catch return &[_]u8{});
                @memcpy(to.ptr, std.mem.sliceAsBytes(input[0..len]).ptr, std.mem.sliceAsBytes(input[0..len]).len);
                return to;
            },

            JSC.Node.Encoding.hex => {
                var to = allocator.alloc(u8, len * 2) catch return &[_]u8{};
                return to[0..strings.decodeHexToBytes(to, u16, input[0..len])];
            },

            JSC.Node.Encoding.base64 => {

                // very very slow case!
                // shouldn't really happen though
                var transcoded = strings.toUTF8Alloc(allocator, input[0..len]) catch return &[_]u8{};
                defer allocator.free(transcoded);
                return constructFromU8(transcoded.ptr, transcoded.len, .base64);
            },

            JSC.Node.Encoding.base64url => {

                // very very slow case!
                // shouldn't really happen though
                var transcoded = strings.toUTF8Alloc(allocator, input[0..len]) catch return &[_]u8{};
                defer allocator.free(transcoded);
                return constructFromU8(transcoded.ptr, transcoded.len, .base64url);
            },
            // else => return 0,
        }
    }

    comptime {
        if (!JSC.is_bindgen) {
            _ = Bun__encoding__writeLatin1;
            _ = Bun__encoding__writeUTF16;

            _ = Bun__encoding__byteLengthLatin1;
            _ = Bun__encoding__byteLengthUTF16;

            _ = Bun__encoding__toString;
            _ = Bun__encoding__toStringUTF8;

            _ = Bun__encoding__constructFromLatin1;
            _ = Bun__encoding__constructFromUTF16;
        }
    }
};

comptime {
    if (!JSC.is_bindgen) {
        std.testing.refAllDecls(Encoder);
    }
}

test "Vec" {}
