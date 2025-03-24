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

const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;

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
            const array_buffer = uint8array.asArrayBuffer(globalThis) orelse return .zero;
            bun.assert(result.written == array_buffer.len);
            @memcpy(array_buffer.byteSlice()[0..result.written], buf[0..result.written]);
            return uint8array;
        } else {
            const bytes = strings.allocateLatin1IntoUTF8(globalThis.bunVM().allocator, []const u8, slice) catch {
                return globalThis.throwOutOfMemoryValue();
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

    pub export fn c(
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
                return globalThis.throwOutOfMemoryValue();
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

        if (array == .zero) {
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
    _ = TextEncoder.TextEncoder__encode8;
    _ = TextEncoder.TextEncoder__encode16;
    _ = TextEncoder.TextEncoder__encodeInto8;
    _ = TextEncoder.TextEncoder__encodeInto16;
    _ = TextEncoder.TextEncoder__encodeRopeString;
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

pub const TextEncoderStreamEncoder = @import("./TextEncoderStreamEncoder.zig");
pub const TextDecoder = @import("./TextDecoder.zig");

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
    // TODO(@190n) handle unpaired surrogates
    export fn Bun__encoding__byteLengthLatin1AsUTF8(input: [*]const u8, len: usize) usize {
        return byteLengthU8(input, len, .utf8);
    }
    // TODO(@190n) handle unpaired surrogates
    export fn Bun__encoding__byteLengthUTF16AsUTF8(input: [*]const u16, len: usize) usize {
        return strings.elementLengthUTF16IntoUTF8([]const u16, input[0..len]);
    }
    export fn Bun__encoding__constructFromLatin1(globalObject: *JSGlobalObject, input: [*]const u8, len: usize, encoding: u8) JSValue {
        const slice = switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .hex => constructFromU8(input, len, bun.default_allocator, .hex),
            .ascii => constructFromU8(input, len, bun.default_allocator, .ascii),
            .base64url => constructFromU8(input, len, bun.default_allocator, .base64url),
            .utf16le => constructFromU8(input, len, bun.default_allocator, .utf16le),
            .ucs2 => constructFromU8(input, len, bun.default_allocator, .utf16le),
            .utf8 => constructFromU8(input, len, bun.default_allocator, .utf8),
            .base64 => constructFromU8(input, len, bun.default_allocator, .base64),
            else => unreachable,
        };
        return JSC.JSValue.createBuffer(globalObject, slice, globalObject.bunVM().allocator);
    }
    export fn Bun__encoding__constructFromUTF16(globalObject: *JSGlobalObject, input: [*]const u16, len: usize, encoding: u8) JSValue {
        const slice = switch (@as(JSC.Node.Encoding, @enumFromInt(encoding))) {
            .base64 => constructFromU16(input, len, bun.default_allocator, .base64),
            .hex => constructFromU16(input, len, bun.default_allocator, .hex),
            .base64url => constructFromU16(input, len, bun.default_allocator, .base64url),
            .utf16le => constructFromU16(input, len, bun.default_allocator, .utf16le),
            .ucs2 => constructFromU16(input, len, bun.default_allocator, .utf16le),
            .utf8 => constructFromU16(input, len, bun.default_allocator, .utf8),
            .ascii => constructFromU16(input, len, bun.default_allocator, .ascii),
            .latin1 => constructFromU16(input, len, bun.default_allocator, .latin1),
            else => unreachable,
        };
        return JSC.JSValue.createBuffer(globalObject, slice, globalObject.bunVM().allocator);
    }

    // for SQL statement
    export fn Bun__encoding__toStringUTF8(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject) JSValue {
        return toStringComptime(input[0..len], globalObject, .utf8);
    }

    export fn Bun__encoding__toString(input: [*]const u8, len: usize, globalObject: *JSC.JSGlobalObject, encoding: u8) JSValue {
        return toString(input[0..len], globalObject, @enumFromInt(encoding));
    }

    // pub fn writeUTF16AsUTF8(utf16: [*]const u16, len: usize, to: [*]u8, to_len: usize) callconv(.C) i32 {
    //     return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, utf16[0..len], true).written);
    // }
    pub fn toString(input: []const u8, globalObject: *JSGlobalObject, encoding: JSC.Node.Encoding) JSValue {
        return switch (encoding) {
            // treat buffer as utf8
            // callers are expected to check that before constructing `Buffer` objects
            .buffer, .utf8 => toStringComptime(input, globalObject, .utf8),

            inline else => |enc| toStringComptime(input, globalObject, enc),
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

    pub fn toStringComptime(input: []const u8, global: *JSGlobalObject, comptime encoding: JSC.Node.Encoding) JSValue {
        var bun_string = toBunStringComptime(input, encoding);
        return bun_string.transferToJS(global);
    }

    pub fn toBunString(input: []const u8, encoding: JSC.Node.Encoding) bun.String {
        return switch (encoding) {
            inline else => |enc| toBunStringComptime(input, enc),
        };
    }

    pub fn toBunStringComptime(input: []const u8, comptime encoding: JSC.Node.Encoding) bun.String {
        if (input.len == 0)
            return bun.String.empty;

        switch (comptime encoding) {
            .ascii => {
                const str, const chars = bun.String.createUninitialized(.latin1, input.len);
                strings.copyLatin1IntoASCII(chars, input);
                return str;
            },
            .latin1 => {
                const str, const chars = bun.String.createUninitialized(.latin1, input.len);
                @memcpy(chars, input);
                return str;
            },
            .buffer, .utf8 => {
                const converted = strings.toUTF16Alloc(bun.default_allocator, input, false, false) catch return bun.String.dead;
                if (converted) |utf16| {
                    return bun.String.createExternalGloballyAllocated(.utf16, utf16);
                }

                // If we get here, it means we can safely assume the string is 100% ASCII characters
                // For this, we rely on WebKit to manage the memory.
                return bun.String.createLatin1(input);
            },
            .ucs2, .utf16le => {
                // Avoid incomplete characters
                if (input.len / 2 == 0) return bun.String.empty;

                const str, const chars = bun.String.createUninitialized(.utf16, input.len / 2);
                var output_bytes = std.mem.sliceAsBytes(chars);
                output_bytes[output_bytes.len - 1] = 0;

                @memcpy(output_bytes, input[0..output_bytes.len]);
                return str;
            },

            .hex => {
                const str, const chars = bun.String.createUninitialized(.latin1, input.len * 2);

                const wrote = strings.encodeBytesToHex(chars, input);
                bun.assert(wrote == chars.len);
                return str;
            },

            .base64url => {
                const to_len = bun.base64.urlSafeEncodeLen(input);
                const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
                const wrote = bun.base64.encodeURLSafe(to, input);
                return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
            },

            .base64 => {
                const to_len = bun.base64.encodeLen(input);
                const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
                const wrote = bun.base64.encode(to, input);
                return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
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
                return strings.decodeHexToBytesTruncate(to_ptr[0..to_len], u8, input[0..len]);
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
                return strings.decodeHexToBytesTruncate(to[0..to_len], u16, input[0..len]);
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

    pub fn constructFrom(comptime T: type, input: []const T, allocator: std.mem.Allocator, comptime encoding: JSC.Node.Encoding) []u8 {
        return switch (comptime T) {
            u16 => constructFromU16(input.ptr, input.len, allocator, encoding),
            u8 => constructFromU8(input.ptr, input.len, allocator, encoding),
            else => @compileError("Unsupported type for constructFrom: " ++ @typeName(T)),
        };
    }

    pub fn constructFromU8(input: [*]const u8, len: usize, allocator: std.mem.Allocator, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0) return &[_]u8{};

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

    pub fn constructFromU16(input: [*]const u16, len: usize, allocator: std.mem.Allocator, comptime encoding: JSC.Node.Encoding) []u8 {
        if (len == 0) return &[_]u8{};

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
                return constructFromU8(transcoded.ptr, transcoded.len, allocator, encoding);
            },
        }
    }

    comptime {
        _ = Bun__encoding__writeLatin1;
        _ = Bun__encoding__writeUTF16;

        _ = Bun__encoding__byteLengthLatin1AsUTF8;
        _ = Bun__encoding__byteLengthUTF16AsUTF8;

        _ = Bun__encoding__toString;
        _ = Bun__encoding__toStringUTF8;

        _ = Bun__encoding__constructFromLatin1;
        _ = Bun__encoding__constructFromUTF16;
    }
};

comptime {
    std.testing.refAllDecls(Encoder);
}
