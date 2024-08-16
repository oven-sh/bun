const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const MimeType = bun.http.MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = bun.http;

const JSC = bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;

const ObjectPool = @import("../../pool.zig").ObjectPool;
const bun = @import("root").bun;
const Output = bun.Output;
const MutableString = bun.MutableString;
const strings = bun.strings;
const string = bun.string;
const FeatureFlags = bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSUint8Array = JSC.JSUint8Array;
const Properties = @import("../base.zig").Properties;

const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;

const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = JSC.VirtualMachine;
const Task = @import("../javascript.zig").Task;

const picohttp = bun.picohttp;

pub const TextEncoder = struct {
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
            bun.assert(result.written <= buf.len);
            bun.assert(result.read == slice.len);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            bun.assert(result.written == array_buffer.len);
            @memcpy(array_buffer.byteSlice()[0..result.written], buf[0..result.written]);
            return uint8array;
        } else {
            const bytes = strings.allocateLatin1IntoUTF8(globalThis.bunVM().allocator, []const u8, slice) catch {
                return JSC.toInvalidArguments("Out of memory", .{}, globalThis);
            };
            bun.assert(bytes.len >= slice.len);
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
            const result = strings.copyUTF16IntoUTF8(&buf, @TypeOf(slice), slice, true);
            if (result.read == 0 or result.written == 0) {
                const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, 3);
                const array_buffer = uint8array.asArrayBuffer(globalThis).?;
                const replacement_char = [_]u8{ 239, 191, 189 };
                @memcpy(array_buffer.slice()[0..replacement_char.len], &replacement_char);
                return uint8array;
            }
            const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
            bun.assert(result.written <= buf.len);
            bun.assert(result.read == slice.len);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            bun.assert(result.written == array_buffer.len);
            @memcpy(array_buffer.slice()[0..result.written], buf[0..result.written]);
            return uint8array;
        } else {
            const bytes = strings.toUTF8AllocWithType(
                bun.default_allocator,
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
        if (comptime Environment.allow_assert) bun.assert(rope_str.is8Bit());
        var stack_buf: [2048]u8 = undefined;
        var buf_to_use: []u8 = &stack_buf;
        const length = rope_str.length();
        var array: JSValue = .zero;
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
            return .undefined;
        }

        if (array.isEmpty()) {
            array = JSC.JSValue.createUninitializedUint8Array(globalThis, length);
            array.ensureStillAlive();
            @memcpy(array.asArrayBuffer(globalThis).?.ptr[0..length], buf_to_use[0..length]);
        }

        return array;
    }

    pub export fn TextEncoder__encodeInto16(
        input_ptr: [*]const u16,
        input_len: usize,
        buf_ptr: [*]u8,
        buf_len: usize,
    ) u64 {
        const output = buf_ptr[0..buf_len];
        const input = input_ptr[0..input_len];
        var result: strings.EncodeIntoResult = strings.copyUTF16IntoUTF8(output, []const u16, input, false);
        if (output.len >= 3 and (result.read == 0 or result.written == 0)) {
            const replacement_char = [_]u8{ 239, 191, 189 };
            @memcpy(buf_ptr[0..replacement_char.len], &replacement_char);
            result.read = 1;
            result.written = 3;
        }
        const sized: [2]u32 = .{ result.read, result.written };
        return @bitCast(sized);
    }

    pub export fn TextEncoder__encodeInto8(
        input_ptr: [*]const u8,
        input_len: usize,
        buf_ptr: [*]u8,
        buf_len: usize,
    ) u64 {
        const output = buf_ptr[0..buf_len];
        const input = input_ptr[0..input_len];
        const result: strings.EncodeIntoResult =
            strings.copyLatin1IntoUTF8(output, []const u8, input);
        const sized: [2]u32 = .{ result.read, result.written };
        return @bitCast(sized);
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
    IBM866,
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
    macintosh,
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
    Big5,
    @"EUC-JP",
    @"ISO-2022-JP",
    Shift_JIS,
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

                Eight.case("utf-16be"),
                => EncodingLabel.@"UTF-16BE",

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

pub const TextEncoderStreamEncoder = struct {
    pending_lead_surrogate: ?u16 = null,

    const log = Output.scoped(.TextEncoderStreamEncoder, false);

    pub usingnamespace JSC.Codegen.JSTextEncoderStreamEncoder;
    pub usingnamespace bun.New(TextEncoderStreamEncoder);

    pub fn finalize(this: *TextEncoderStreamEncoder) void {
        this.destroy();
    }

    pub fn constructor(_: *JSGlobalObject, _: *JSC.CallFrame) ?*TextEncoderStreamEncoder {
        return TextEncoderStreamEncoder.new(.{});
    }

    pub fn encode(this: *TextEncoderStreamEncoder, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
        const arguments = callFrame.arguments(1).slice();
        if (arguments.len == 0) {
            globalObject.throwNotEnoughArguments("TextEncoderStreamEncoder.encode", 1, arguments.len);
            return .zero;
        }

        const str: ZigString = (arguments[0].toStringOrNull(globalObject) orelse return .zero).getZigString(globalObject);

        if (str.is16Bit()) {
            return this.encodeUTF16(globalObject, str.utf16SliceAligned());
        }

        return this.encodeLatin1(globalObject, str.slice());
    }

    pub fn encodeWithoutTypeChecks(this: *TextEncoderStreamEncoder, globalObject: *JSC.JSGlobalObject, input: *JSC.JSString) JSValue {
        const str = input.getZigString(globalObject);

        if (str.is16Bit()) {
            return this.encodeUTF16(globalObject, str.utf16SliceAligned());
        }

        return this.encodeLatin1(globalObject, str.slice());
    }

    fn encodeLatin1(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, input: []const u8) JSValue {
        log("encodeLatin1: \"{s}\"", .{input});

        if (input.len == 0) return JSUint8Array.createEmpty(globalObject);

        const prepend_replacement_len: usize = prepend_replacement: {
            if (this.pending_lead_surrogate != null) {
                this.pending_lead_surrogate = null;
                // no latin1 surrogate pairs
                break :prepend_replacement 3;
            }

            break :prepend_replacement 0;
        };
        // In a previous benchmark, counting the length took about as much time as allocating the buffer.
        //
        // Benchmark	Time %	CPU (ns)	Iterations	Ratio
        // 288.00 ms   13.5%	288.00 ms	 	  simdutf::arm64::implementation::convert_latin1_to_utf8(char const*, unsigned long, char*) const
        // 278.00 ms   13.0%	278.00 ms	 	  simdutf::arm64::implementation::utf8_length_from_latin1(char const*, unsigned long) const
        //
        //
        var buffer = std.ArrayList(u8).initCapacity(bun.default_allocator, input.len + prepend_replacement_len) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        if (prepend_replacement_len > 0) {
            buffer.appendSliceAssumeCapacity(&[3]u8{ 0xef, 0xbf, 0xbd });
        }

        var remain = input;
        while (remain.len > 0) {
            const result = strings.copyLatin1IntoUTF8(buffer.unusedCapacitySlice(), []const u8, remain);

            buffer.items.len += result.written;
            remain = remain[result.read..];

            if (result.written == 0 and result.read == 0) {
                buffer.ensureUnusedCapacity(2) catch {
                    buffer.deinit();
                    globalObject.throwOutOfMemory();
                    return .zero;
                };
            } else if (buffer.items.len == buffer.capacity and remain.len > 0) {
                buffer.ensureTotalCapacity(buffer.items.len + remain.len + 1) catch {
                    buffer.deinit();
                    globalObject.throwOutOfMemory();
                    return .zero;
                };
            }
        }

        if (comptime Environment.isDebug) {
            // wrap in comptime if so simdutf isn't called in a release build here.
            bun.debugAssert(buffer.items.len == (bun.simdutf.length.utf8.from.latin1(input) + prepend_replacement_len));
        }

        return JSC.JSUint8Array.fromBytes(globalObject, buffer.items);
    }

    fn encodeUTF16(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, input: []const u16) JSValue {
        log("encodeUTF16: \"{}\"", .{bun.fmt.utf16(input)});

        if (input.len == 0) return JSUint8Array.createEmpty(globalObject);

        const Prepend = struct {
            bytes: [4]u8,
            len: u3,

            pub const replacement: @This() = .{ .bytes = .{ 0xef, 0xbf, 0xbd, 0 }, .len = 3 };

            pub fn fromSequence(seq: [4]u8, length: u3) @This() {
                return .{ .bytes = seq, .len = length };
            }
        };

        var remain = input;

        const prepend: ?Prepend = prepend: {
            if (this.pending_lead_surrogate) |lead| {
                this.pending_lead_surrogate = null;
                const maybe_trail = remain[0];
                if (strings.u16IsTrail(maybe_trail)) {
                    const converted = strings.utf16CodepointWithFFFD([]const u16, &.{ lead, maybe_trail });
                    // shouldn't fail because `u16IsTrail` is true and `pending_lead_surrogate` is always
                    // a valid lead.
                    bun.debugAssert(!converted.fail);

                    const sequence = strings.wtf8Sequence(converted.code_point);

                    remain = remain[1..];
                    if (remain.len == 0) {
                        return JSUint8Array.fromBytesCopy(
                            globalObject,
                            sequence[0..converted.utf8Width()],
                        );
                    }

                    break :prepend Prepend.fromSequence(sequence, converted.utf8Width());
                }

                break :prepend Prepend.replacement;
            }
            break :prepend null;
        };

        const length = bun.simdutf.length.utf8.from.utf16.le(remain);

        var buf = std.ArrayList(u8).initCapacity(
            bun.default_allocator,
            length + @as(usize, if (prepend) |pre| pre.len else 0),
        ) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };

        if (prepend) |*pre| {
            buf.appendSliceAssumeCapacity(pre.bytes[0..pre.len]);
        }

        const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(remain, buf.unusedCapacitySlice());

        switch (result.status) {
            else => {
                // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
                const lead_surrogate = strings.toUTF8ListWithTypeBun(&buf, []const u16, remain, true) catch {
                    buf.deinit();
                    globalObject.throwOutOfMemory();
                    return .zero;
                };

                if (lead_surrogate) |pending_lead| {
                    this.pending_lead_surrogate = pending_lead;
                    if (buf.items.len == 0) return JSUint8Array.createEmpty(globalObject);
                }

                return JSC.JSUint8Array.fromBytes(globalObject, buf.items);
            },
            .success => {
                buf.items.len += result.count;
                return JSC.JSUint8Array.fromBytes(globalObject, buf.items);
            },
        }
    }

    pub fn flush(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, _: *JSC.CallFrame) JSValue {
        return flushBody(this, globalObject);
    }

    pub fn flushWithoutTypeChecks(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject) JSValue {
        return flushBody(this, globalObject);
    }

    fn flushBody(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject) JSValue {
        return if (this.pending_lead_surrogate == null)
            JSUint8Array.createEmpty(globalObject)
        else
            JSUint8Array.fromBytesCopy(globalObject, &.{ 0xef, 0xbf, 0xbd });
    }
};

pub const TextDecoder = struct {

    // used for utf8 decoding
    buffered: struct {
        buf: [3]u8 = .{0} ** 3,
        len: u2 = 0,

        pub fn slice(this: *@This()) []const u8 {
            return this.buf[0..this.len];
        }
    } = .{},

    // used for utf16 decoding
    lead_byte: ?u8 = null,
    lead_surrogate: ?u16 = null,

    ignore_bom: bool = false,
    fatal: bool = false,
    encoding: EncodingLabel = EncodingLabel.@"UTF-8",

    pub usingnamespace bun.New(TextDecoder);

    pub fn finalize(this: *TextDecoder) void {
        this.destroy();
    }

    pub usingnamespace JSC.Codegen.JSTextDecoder;

    pub fn getIgnoreBOM(
        this: *TextDecoder,
        _: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.ignore_bom);
    }
    // pub fn setIgnoreBOM(
    //     this: *TextDecoder,
    //     _: *JSC.JSGlobalObject,
    // )  JSC.JSValue {
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
    ) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.fatal);
    }

    pub fn getEncoding(
        this: *TextDecoder,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init(EncodingLabel.label.get(this.encoding).?).toJS(globalThis);
    }
    const Vector16 = std.meta.Vector(16, u16);
    const max_16_ascii: Vector16 = @splat(@as(u16, 127));

    fn processCodeUnitUTF16(
        this: *TextDecoder,
        output: *std.ArrayListUnmanaged(u16),
        saw_error: *bool,
        code_unit: u16,
    ) error{OutOfMemory}!void {
        if (this.lead_surrogate) |lead_surrogate| {
            this.lead_surrogate = null;

            if (strings.u16IsTrail(code_unit)) {
                // TODO: why is this here?
                // const code_point = strings.u16GetSupplementary(lead_surrogate, code_unit);
                try output.appendSlice(
                    bun.default_allocator,
                    &.{ lead_surrogate, code_unit },
                );
                return;
            }
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error.* = true;
        }

        if (strings.u16IsLead(code_unit)) {
            this.lead_surrogate = code_unit;
            return;
        }

        if (strings.u16IsTrail(code_unit)) {
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error.* = true;
            return;
        }

        try output.append(bun.default_allocator, code_unit);
        return;
    }

    pub fn codeUnitFromBytesUTF16(
        first: u16,
        second: u16,
        comptime big_endian: bool,
    ) u16 {
        return if (comptime big_endian)
            (first << 8) | second
        else
            first | (second << 8);
    }

    pub fn decodeUTF16(
        this: *TextDecoder,
        bytes: []const u8,
        comptime big_endian: bool,
        comptime flush: bool,
    ) error{OutOfMemory}!struct { std.ArrayListUnmanaged(u16), bool } {
        var output: std.ArrayListUnmanaged(u16) = .{};
        try output.ensureTotalCapacity(bun.default_allocator, @divFloor(bytes.len, 2));

        var remain = bytes;
        var saw_error = false;

        if (this.lead_byte) |lead_byte| {
            if (remain.len > 0) {
                this.lead_byte = null;

                try this.processCodeUnitUTF16(
                    &output,
                    &saw_error,
                    codeUnitFromBytesUTF16(@intCast(lead_byte), @intCast(remain[0]), big_endian),
                );
                remain = remain[1..];
            }
        }

        var i: usize = 0;

        while (i < remain.len -| 1) {
            try this.processCodeUnitUTF16(
                &output,
                &saw_error,
                codeUnitFromBytesUTF16(@intCast(remain[i]), @intCast(remain[i + 1]), big_endian),
            );
            i += 2;
        }

        if (remain.len != 0 and i == remain.len - 1) {
            this.lead_byte = remain[i];
        } else {
            bun.assertWithLocation(i == remain.len, @src());
        }

        if (comptime flush) {
            if (this.lead_byte != null or this.lead_surrogate != null) {
                this.lead_byte = null;
                this.lead_surrogate = null;
                try output.append(bun.default_allocator, strings.unicode_replacement);
                saw_error = true;
                return .{ output, saw_error };
            }
        }

        return .{ output, saw_error };
    }

    pub fn decode(this: *TextDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        const arguments = callframe.arguments(2).slice();

        const input_slice = input_slice: {
            if (arguments.len == 0 or arguments[0].isUndefined()) {
                break :input_slice "";
            }

            if (arguments[0].asArrayBuffer(globalThis)) |array_buffer| {
                break :input_slice array_buffer.slice();
            }

            globalThis.throwInvalidArguments("TextDecoder.decode expects an ArrayBuffer or TypedArray", .{});
            return .zero;
        };

        const stream = stream: {
            if (arguments.len > 1 and arguments[1].isObject()) {
                if (arguments[1].fastGet(globalThis, .stream)) |stream_value| {
                    const stream_bool = stream_value.coerce(bool, globalThis);
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    break :stream stream_bool;
                }
            }

            break :stream false;
        };

        return switch (!stream) {
            inline else => |flush| this.decodeSlice(globalThis, input_slice, flush),
        };
    }

    pub fn decodeWithoutTypeChecks(this: *TextDecoder, globalThis: *JSC.JSGlobalObject, uint8array: *JSC.JSUint8Array) JSValue {
        return this.decodeSlice(globalThis, uint8array.slice(), false);
    }

    fn decodeSlice(this: *TextDecoder, globalThis: *JSC.JSGlobalObject, buffer_slice: []const u8, comptime flush: bool) JSValue {
        switch (this.encoding) {
            EncodingLabel.latin1 => {
                if (strings.isAllASCII(buffer_slice)) {
                    return ZigString.init(buffer_slice).toJS(globalThis);
                }

                // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
                // However, this is also what WebKit seems to do.
                //
                // It's not clear why we couldn't jusst use Latin1 here, but tests failures proved it necessary.
                const out_length = strings.elementLengthLatin1IntoUTF16([]const u8, buffer_slice);
                const bytes = globalThis.allocator().alloc(u16, out_length) catch {
                    globalThis.throwOutOfMemory();
                    return .zero;
                };

                const out = strings.copyLatin1IntoUTF16([]u16, bytes, []const u8, buffer_slice);
                return ZigString.toExternalU16(bytes.ptr, out.written, globalThis);
            },
            EncodingLabel.@"UTF-8" => {
                const input, const deinit = input: {
                    const maybe_without_bom = if (!this.ignore_bom and strings.hasPrefixComptime(buffer_slice, "\xef\xbb\xbf"))
                        buffer_slice[3..]
                    else
                        buffer_slice;

                    if (this.buffered.len > 0) {
                        defer this.buffered.len = 0;
                        const joined = bun.default_allocator.alloc(u8, maybe_without_bom.len + this.buffered.len) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                        @memcpy(joined[0..this.buffered.len], this.buffered.slice());
                        @memcpy(joined[this.buffered.len..][0..maybe_without_bom.len], maybe_without_bom);
                        break :input .{ joined, true };
                    }

                    break :input .{ maybe_without_bom, false };
                };

                const maybe_decode_result = switch (this.fatal) {
                    inline else => |fail_if_invalid| strings.toUTF16AllocMaybeBuffered(bun.default_allocator, input, fail_if_invalid, flush) catch |err| {
                        if (deinit) bun.default_allocator.free(input);
                        if (comptime fail_if_invalid) {
                            if (err == error.InvalidByteSequence) {
                                globalThis.ERR_ENCODING_INVALID_ENCODED_DATA("Invalid byte sequence", .{}).throw();
                                return .zero;
                            }
                        }

                        bun.assert(err == error.OutOfMemory);
                        globalThis.throwOutOfMemory();
                        return .zero;
                    },
                };

                if (maybe_decode_result) |decode_result| {
                    if (deinit) bun.default_allocator.free(input);
                    const decoded, const leftover, const leftover_len = decode_result;
                    bun.assert(this.buffered.len == 0);
                    if (comptime !flush) {
                        if (leftover_len != 0) {
                            this.buffered.buf = leftover;
                            this.buffered.len = leftover_len;
                        }
                    }
                    return ZigString.toExternalU16(decoded.ptr, decoded.len, globalThis);
                }

                bun.debugAssert(input.len == 0 or !deinit);

                // Experiment: using mimalloc directly is slightly slower
                return ZigString.init(input).toJS(globalThis);
            },

            inline .@"UTF-16LE", .@"UTF-16BE" => |utf16_encoding| {
                const bom = if (comptime utf16_encoding == .@"UTF-16LE") "\xff\xfe" else "\xfe\xff";
                const input = if (!this.ignore_bom and strings.hasPrefixComptime(buffer_slice, bom))
                    buffer_slice[2..]
                else
                    buffer_slice;

                var decoded, const saw_error = this.decodeUTF16(input, utf16_encoding == .@"UTF-16BE", flush) catch {
                    globalThis.throwOutOfMemory();
                    return .zero;
                };

                if (saw_error and this.fatal) {
                    decoded.deinit(bun.default_allocator);
                    globalThis.ERR_ENCODING_INVALID_ENCODED_DATA("The encoded data was not valid {s} data", .{@tagName(utf16_encoding)}).throw();
                    return .zero;
                }

                var output = bun.String.fromUTF16(decoded.items);
                return output.toJS(globalThis);
            },
            else => {
                globalThis.throwInvalidArguments("TextDecoder.decode set to unsupported encoding", .{});
                return .zero;
            },
        }
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) ?*TextDecoder {
        var args_ = callframe.arguments(2);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        var decoder = TextDecoder{};

        if (arguments.len > 0) {
            // encoding
            if (arguments[0].isString()) {
                var str = arguments[0].toSlice(globalThis, bun.default_allocator);
                defer if (str.isAllocated()) str.deinit();

                if (EncodingLabel.which(str.slice())) |label| {
                    decoder.encoding = label;
                } else {
                    globalThis.throwInvalidArguments("Unsupported encoding label \"{s}\"", .{str.slice()});
                    return null;
                }
            } else if (arguments[0].isUndefined()) {
                // default to utf-8
                decoder.encoding = EncodingLabel.@"UTF-8";
            } else {
                globalThis.throwInvalidArguments("TextDecoder(encoding) label is invalid", .{});
                return null;
            }

            if (arguments.len >= 2) {
                const options = arguments[1];

                if (!options.isObject()) {
                    globalThis.throwInvalidArguments("TextDecoder(options) is invalid", .{});
                    return null;
                }

                if (options.get(globalThis, "fatal")) |fatal| {
                    if (fatal.isBoolean()) {
                        decoder.fatal = fatal.asBoolean();
                    } else {
                        globalThis.throwInvalidArguments("TextDecoder(options) fatal is invalid. Expected boolean value", .{});
                        return null;
                    }
                }

                if (options.get(globalThis, "ignoreBOM")) |ignoreBOM| {
                    if (ignoreBOM.isBoolean()) {
                        decoder.ignore_bom = ignoreBOM.asBoolean();
                    } else {
                        globalThis.throwInvalidArguments("TextDecoder(options) ignoreBOM is invalid. Expected boolean value", .{});
                        return null;
                    }
                }
            }
        }

        return TextDecoder.new(decoder);
    }
};

pub const Encoder = struct {
    export fn Bun__encoding__writeLatin1(input: [*]const u8, len: usize, to: [*]u8, to_len: usize, encoding: u8) usize {
        return switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .utf8 => writeU8(input, len, to, to_len, .utf8),
            .latin1 => writeU8(input, len, to, to_len, .latin1),
            .ascii => writeU8(input, len, to, to_len, .ascii),
            .ucs2 => writeU8(input, len, to, to_len, .utf16le),
            .utf16le => writeU8(input, len, to, to_len, .utf16le),
            .base64 => writeU8(input, len, to, to_len, .base64),
            .base64url => writeU8(input, len, to, to_len, .base64url),
            .hex => writeU8(input, len, to, to_len, .hex),
            else => unreachable,
        } catch 0;
    }
    export fn Bun__encoding__writeUTF16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, encoding: u8) usize {
        return switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .utf8 => writeU16(input, len, to, to_len, .utf8, false),
            .latin1 => writeU16(input, len, to, to_len, .ascii, false),
            .ascii => writeU16(input, len, to, to_len, .ascii, false),
            .ucs2 => writeU16(input, len, to, to_len, .utf16le, false),
            .utf16le => writeU16(input, len, to, to_len, .utf16le, false),
            .base64 => writeU16(input, len, to, to_len, .base64, false),
            .base64url => writeU16(input, len, to, to_len, .base64url, false),
            .hex => writeU16(input, len, to, to_len, .hex, false),
            else => unreachable,
        } catch 0;
    }
    export fn Bun__encoding__byteLengthLatin1(input: [*]const u8, len: usize, encoding: u8) usize {
        return switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
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
        return switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
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
        const slice = switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
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
        const slice = switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .base64 => constructFromU16(input, len, .base64),
            .hex => constructFromU16(input, len, .hex),
            .base64url => constructFromU16(input, len, .base64url),
            .utf16le => constructFromU16(input, len, .utf16le),
            .ucs2 => constructFromU16(input, len, .utf16le),
            .utf8 => constructFromU16(input, len, .utf8),
            .ascii => constructFromU16(input, len, .ascii),
            .latin1 => constructFromU16(input, len, .latin1),
            else => unreachable,
        };
        return JSC.JSValue.createBuffer(globalObject, slice, globalObject.bunVM().allocator);
    }

    // for SQL statement
    export fn Bun__encoding__toStringUTF8(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject) JSValue {
        return toString(input, len, globalObject, .utf8);
    }

    export fn Bun__encoding__toString(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject, encoding: u8) JSValue {
        return switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .ucs2 => toString(input, len, globalObject, .utf16le),
            .utf16le => toString(input, len, globalObject, .utf16le),
            .utf8 => toString(input, len, globalObject, .utf8),
            .ascii => toString(input, len, globalObject, .ascii),
            .hex => toString(input, len, globalObject, .hex),
            .base64 => toString(input, len, globalObject, .base64),
            .base64url => toString(input, len, globalObject, .base64url),
            .latin1 => toString(input, len, globalObject, .latin1),

            // treat everything else as utf8
            else => toString(input, len, globalObject, .utf8),
        };
    }

    // pub fn writeUTF16AsUTF8(utf16: [*]const u16, len: usize, to: [*]u8, to_len: usize) callconv(.C) i32 {
    //     return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, utf16[0..len], true).written);
    // }
    pub fn toStringAtRuntime(input: [*]const u8, len: usize, globalObject: *JSGlobalObject, encoding: JSC.Node.Encoding) JSValue {
        return switch (encoding) {
            .ucs2 => toString(input, len, globalObject, .utf16le),
            .utf16le => toString(input, len, globalObject, .utf16le),
            .utf8 => toString(input, len, globalObject, .utf8),
            .ascii => toString(input, len, globalObject, .ascii),
            .hex => toString(input, len, globalObject, .hex),
            .base64 => toString(input, len, globalObject, .base64),
            .base64url => toString(input, len, globalObject, .base64url),
            .latin1 => toString(input, len, globalObject, .latin1),
            // treat everything else as utf8
            else => toString(input, len, globalObject, .utf8),
        };
    }

    pub fn toBunStringFromOwnedSlice(input: []u8, encoding: JSC.Node.Encoding) bun.String {
        if (input.len == 0)
            return bun.String.empty;

        switch (encoding) {
            .ascii => {
                if (strings.isAllASCII(input)) {
                    return bun.String.createExternalGloballyAllocated(.latin1, input);
                }

                const str, const chars = bun.String.createUninitialized(.latin1, input.len);
                defer bun.default_allocator.free(input);
                if (str.tag == .Dead) {
                    return str;
                }
                strings.copyLatin1IntoASCII(chars, input);
                return str;
            },
            .latin1 => {
                return bun.String.createExternalGloballyAllocated(.latin1, input);
            },
            .buffer, .utf8 => {
                const converted = strings.toUTF16Alloc(bun.default_allocator, input, false, false) catch {
                    bun.default_allocator.free(input);
                    return bun.String.dead;
                };

                if (converted) |utf16| {
                    defer bun.default_allocator.free(input);
                    return bun.String.createExternalGloballyAllocated(.utf16, utf16);
                }

                // If we get here, it means we can safely assume the string is 100% ASCII characters
                return bun.String.createExternalGloballyAllocated(.latin1, input);
            },
            .ucs2, .utf16le => {
                // Avoid incomplete characters
                if (input.len / 2 == 0) {
                    bun.default_allocator.free(input);
                    return bun.String.empty;
                }

                const as_u16 = std.mem.bytesAsSlice(u16, input);
                return bun.String.createExternalGloballyAllocated(.utf16, @alignCast(as_u16));
            },

            .hex => {
                defer bun.default_allocator.free(input);
                const str, const chars = bun.String.createUninitialized(.latin1, input.len * 2);

                if (str.tag == .Dead) {
                    return str;
                }

                const wrote = strings.encodeBytesToHex(chars, input);

                // Return an empty string in this case, just like node.
                if (wrote < chars.len) {
                    str.deref();
                    return bun.String.empty;
                }

                return str;
            },

            // TODO: this is not right. There is an issue here. But it needs to
            // be addressed separately because constructFromU8's base64url also
            // appears inconsistent with Node.js.
            .base64url => {
                defer bun.default_allocator.free(input);
                const out, const chars = bun.String.createUninitialized(.latin1, bun.base64.urlSafeEncodeLen(input));
                if (out.tag != .Dead) {
                    _ = bun.base64.encodeURLSafe(chars, input);
                }
                return out;
            },

            .base64 => {
                defer bun.default_allocator.free(input);
                const to_len = bun.base64.encodeLen(input);
                const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
                const wrote = bun.base64.encode(to, input);
                return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
            },
        }
    }

    pub fn toString(input_ptr: [*]const u8, len: usize, global: *JSGlobalObject, comptime encoding: JSC.Node.Encoding) JSValue {
        if (len == 0)
            return ZigString.Empty.toJS(global);

        const input = input_ptr[0..len];
        const allocator = VirtualMachine.get().allocator;

        switch (comptime encoding) {
            .ascii => {
                var str, const chars = bun.String.createUninitialized(.latin1, len);
                defer str.deref();

                strings.copyLatin1IntoASCII(chars, input);
                return str.toJS(global);
            },
            .latin1 => {
                var str, const chars = bun.String.createUninitialized(.latin1, len);
                defer str.deref();

                @memcpy(chars, input);
                return str.toJS(global);
            },
            .buffer, .utf8 => {
                const converted = strings.toUTF16Alloc(allocator, input, false, false) catch return ZigString.init("Out of memory").toErrorInstance(global);
                if (converted) |utf16| {
                    return ZigString.toExternalU16(utf16.ptr, utf16.len, global);
                }

                // If we get here, it means we can safely assume the string is 100% ASCII characters
                // For this, we rely on the GC to manage the memory to minimize potential for memory leaks
                return ZigString.init(input).toJS(global);
            },
            .ucs2, .utf16le => {
                // Avoid incomplete characters
                if (len / 2 == 0) return ZigString.Empty.toJS(global);

                var output, const chars = bun.String.createUninitialized(.utf16, len / 2);
                defer output.deref();
                var output_bytes = std.mem.sliceAsBytes(chars);
                output_bytes[output_bytes.len - 1] = 0;

                @memcpy(output_bytes, input_ptr[0..output_bytes.len]);
                return output.toJS(global);
            },

            .hex => {
                var str, const chars = bun.String.createUninitialized(.latin1, len * 2);
                defer str.deref();

                const wrote = strings.encodeBytesToHex(chars, input);
                bun.assert(wrote == chars.len);
                return str.toJS(global);
            },

            .base64url => {
                var out, const chars = bun.String.createUninitialized(.latin1, bun.base64.urlSafeEncodeLen(input));
                defer out.deref();
                _ = bun.base64.encodeURLSafe(chars, input);
                return out.toJS(global);
            },

            .base64 => {
                const to_len = bun.base64.encodeLen(input);
                var to = allocator.alloc(u8, to_len) catch return ZigString.init("Out of memory").toErrorInstance(global);
                const wrote = bun.base64.encode(to, input);
                return ZigString.init(to[0..wrote]).toExternalValue(global);
            },
        }
    }

    pub fn writeU8(input: [*]const u8, len: usize, to_ptr: [*]u8, to_len: usize, comptime encoding: JSC.Node.Encoding) !usize {
        if (len == 0 or to_len == 0)
            return 0;

        // TODO: increase temporary buffer size for larger amounts of data
        // defer {
        //     if (comptime encoding.isBinaryToText()) {}
        // }

        // if (comptime encoding.isBinaryToText()) {}

        switch (comptime encoding) {
            .buffer, .latin1 => {
                const written = @min(len, to_len);
                @memcpy(to_ptr[0..written], input[0..written]);

                return written;
            },
            .ascii => {
                const written = @min(len, to_len);

                const to = to_ptr[0..written];
                var remain = input[0..written];

                if (bun.simdutf.validate.ascii(remain)) {
                    @memcpy(to_ptr[0..written], remain[0..written]);
                } else {
                    strings.copyLatin1IntoASCII(to, remain);
                }

                return written;
            },
            .utf8 => {
                // need to encode
                return strings.copyLatin1IntoUTF8(to_ptr[0..to_len], []const u8, input[0..len]).written;
            },
            // encode latin1 into UTF16
            .ucs2, .utf16le => {
                if (to_len < 2)
                    return 0;

                if (std.mem.isAligned(@intFromPtr(to_ptr), @alignOf([*]u16))) {
                    const buf = input[0..len];

                    const output = @as([*]u16, @ptrCast(@alignCast(to_ptr)))[0 .. to_len / 2];
                    const written = strings.copyLatin1IntoUTF16([]u16, output, []const u8, buf).written;
                    return written * 2;
                } else {
                    const buf = input[0..len];
                    const output = @as([*]align(1) u16, @ptrCast(to_ptr))[0 .. to_len / 2];

                    const written = strings.copyLatin1IntoUTF16([]align(1) u16, output, []const u8, buf).written;
                    return written * 2;
                }
            },

            .hex => {
                return strings.decodeHexToBytes(to_ptr[0..to_len], u8, input[0..len]);
            },

            .base64, .base64url => {
                return bun.base64.decode(to_ptr[0..to_len], input[0..len]).count;
            },
        }
    }

    pub fn byteLengthU8(input: [*]const u8, len: usize, comptime encoding: JSC.Node.Encoding) usize {
        if (len == 0)
            return 0;

        switch (comptime encoding) {
            .utf8 => {
                return strings.elementLengthLatin1IntoUTF8([]const u8, input[0..len]);
            },

            .latin1, .ascii, .buffer => {
                return len;
            },

            .ucs2, .utf16le => {
                return strings.elementLengthUTF8IntoUTF16([]const u8, input[0..len]) * 2;
            },

            .hex => {
                return len / 2;
            },

            .base64, .base64url => {
                return bun.base64.decodeLen(input[0..len]);
            },
            // else => return &[_]u8{};
        }
    }

    pub fn encodeIntoFrom16(input: []const u16, to: []u8, comptime encoding: JSC.Node.Encoding, comptime allow_partial_write: bool) !usize {
        return writeU16(input.ptr, input.len, to.ptr, to.len, encoding, allow_partial_write);
    }

    pub fn encodeIntoFrom8(input: []const u8, to: []u8, comptime encoding: JSC.Node.Encoding) !usize {
        return writeU8(input.ptr, input.len, to.ptr, to.len, encoding);
    }

    pub fn writeU16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, comptime encoding: JSC.Node.Encoding, comptime allow_partial_write: bool) !usize {
        if (len == 0)
            return 0;

        switch (comptime encoding) {
            .utf8 => {
                return strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, input[0..len], allow_partial_write).written;
            },
            .latin1, .ascii, .buffer => {
                const out = @min(len, to_len);
                strings.copyU16IntoU8(to[0..to_len], []const u16, input[0..out]);
                return out;
            },
            // string is already encoded, just need to copy the data
            .ucs2, .utf16le => {
                if (allow_partial_write) {
                    const bytes_input_len = len * 2;
                    const written = @min(bytes_input_len, to_len);
                    const input_u8 = @as([*]const u8, @ptrCast(input));
                    strings.copyU16IntoU8(to[0..written], []const u8, input_u8[0..written]);
                    return written;
                } else {
                    const bytes_input_len = len * 2;
                    const written = @min(bytes_input_len, to_len);
                    if (written < 2) return 0;

                    const fixed_len = (written / 2) * 2;
                    const input_u8 = @as([*]const u8, @ptrCast(input));
                    strings.copyU16IntoU8(to[0..written], []const u8, input_u8[0..fixed_len]);
                    return fixed_len;
                }
            },

            .hex => {
                return strings.decodeHexToBytes(to[0..to_len], u16, input[0..len]);
            },

            .base64, .base64url => {
                if (to_len < 2 or len == 0)
                    return 0;

                // very very slow case!
                // shouldn't really happen though
                const transcoded = strings.toUTF8Alloc(bun.default_allocator, input[0..len]) catch return 0;
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
            .ucs2, .buffer, .utf16le => {
                return len * 2;
            },

            .hex => {
                return len / 2;
            },

            .base64, .base64url => {
                return bun.base64.decodeLenUpperBound(len);
            },
            // else => return &[_]u8{};
        }
    }

    pub fn constructFrom(comptime T: type, input: []const T, comptime encoding: JSC.Node.Encoding) []u8 {
        return switch (comptime T) {
            u16 => constructFromU16(input.ptr, input.len, encoding),
            u8 => constructFromU8(input.ptr, input.len, encoding),
            else => @compileError("Unsupported type for constructFrom: " ++ @typeName(T)),
        };
    }

    pub fn constructFromU8(input: [*]const u8, len: usize, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0) return &[_]u8{};

        const allocator = bun.default_allocator;

        switch (comptime encoding) {
            .buffer => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};
                @memcpy(to[0..len], input[0..len]);

                return to;
            },
            .latin1, .ascii => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};

                @memcpy(to[0..len], input[0..len]);

                return to;
            },
            .utf8 => {
                // need to encode
                return strings.allocateLatin1IntoUTF8(allocator, []const u8, input[0..len]) catch return &[_]u8{};
            },
            // encode latin1 into UTF16
            // return as bytes
            .ucs2, .utf16le => {
                var to = allocator.alloc(u16, len) catch return &[_]u8{};
                _ = strings.copyLatin1IntoUTF16([]u16, to, []const u8, input[0..len]);
                return std.mem.sliceAsBytes(to[0..len]);
            },

            .hex => {
                if (len < 2)
                    return &[_]u8{};

                var to = allocator.alloc(u8, len / 2) catch return &[_]u8{};
                return to[0..strings.decodeHexToBytesTruncate(to, u8, input[0..len])];
            },

            .base64, .base64url => {
                const slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.vt});
                if (slice.len == 0) return &[_]u8{};

                const outlen = bun.base64.decodeLen(slice);
                const to = allocator.alloc(u8, outlen) catch return &[_]u8{};

                const wrote = bun.base64.decode(to[0..outlen], slice).count;
                return to[0..wrote];
            },
        }
    }

    pub fn constructFromU16(input: [*]const u16, len: usize, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0) return &[_]u8{};

        const allocator = bun.default_allocator;

        switch (comptime encoding) {
            .utf8 => {
                return strings.toUTF8AllocWithType(allocator, []const u16, input[0..len]) catch return &[_]u8{};
            },
            .latin1, .buffer, .ascii => {
                var to = allocator.alloc(u8, len) catch return &[_]u8{};
                strings.copyU16IntoU8(to[0..len], []const u16, input[0..len]);
                return to;
            },
            // string is already encoded, just need to copy the data
            .ucs2, .utf16le => {
                var to = std.mem.sliceAsBytes(allocator.alloc(u16, len) catch return &[_]u8{});
                const bytes = std.mem.sliceAsBytes(input[0..len]);
                @memcpy(to[0..bytes.len], bytes);
                return to;
            },

            .hex => {
                var to = allocator.alloc(u8, len * 2) catch return &[_]u8{};
                return to[0..strings.decodeHexToBytesTruncate(to, u16, input[0..len])];
            },

            .base64, .base64url => {
                // very very slow case!
                // shouldn't really happen though
                const transcoded = strings.toUTF8Alloc(allocator, input[0..len]) catch return &[_]u8{};
                defer allocator.free(transcoded);
                return constructFromU8(transcoded.ptr, transcoded.len, encoding);
            },
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
