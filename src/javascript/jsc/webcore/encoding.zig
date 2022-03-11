const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../query_string_map.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../../jsc.zig");
const js = JSC.C;

const Method = @import("../../../http/method.zig").Method;

const ObjectPool = @import("../../../pool.zig").ObjectPool;

const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../../env.zig");
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
    var text_encoder: TextEncoder = TextEncoder{};

    pub const Class = NewClass(
        TextEncoder,
        .{
            .name = "TextEncoder",
        },
        .{
            .encode = .{
                .rfn = encode,
            },
            .encodeInto = .{
                .rfn = encodeInto,
            },
        },
        .{
            .encoding = .{
                .get = getEncoding,
                .readOnly = true,
            },
        },
    );

    const utf8_string: string = "utf-8";
    pub fn getEncoding(
        _: *TextEncoder,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(utf8_string).toValue(ctx.ptr()).asObjectRef();
    }

    pub fn encode(
        _: *TextEncoder,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var arguments: []const JSC.JSValue = @ptrCast([*]const JSC.JSValue, args.ptr)[0..args.len];

        if (arguments.len < 1) {
            return JSC.C.JSObjectMakeTypedArray(ctx, JSC.C.JSTypedArrayType.kJSTypedArrayTypeUint8Array, 0, exception);
        }

        const value = arguments[0];

        var zig_str = value.getZigString(ctx.ptr());

        var array_buffer: ArrayBuffer = undefined;
        if (zig_str.is16Bit()) {
            var bytes = strings.toUTF8AllocWithType(
                default_allocator,
                @TypeOf(zig_str.utf16Slice()),
                zig_str.utf16Slice(),
            ) catch {
                JSC.throwInvalidArguments("Out of memory", .{}, ctx, exception);
                return null;
            };
            array_buffer = ArrayBuffer.fromBytes(bytes, .Uint8Array);
        } else {
            var bytes = strings.allocateLatin1IntoUTF8(default_allocator, []const u8, zig_str.slice()) catch {
                JSC.throwInvalidArguments("Out of memory", .{}, ctx, exception);
                return null;
            };

            array_buffer = ArrayBuffer.fromBytes(bytes, .Uint8Array);
        }

        return array_buffer.toJS(ctx, exception).asObjectRef();
    }

    const read_key = ZigString.init("read");
    const written_key = ZigString.init("written");

    pub fn encodeInto(
        _: *TextEncoder,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var arguments: []const JSC.JSValue = @ptrCast([*]const JSC.JSValue, args.ptr)[0..args.len];

        if (arguments.len < 2) {
            JSC.throwInvalidArguments("TextEncoder.encodeInto expects (string, Uint8Array)", .{}, ctx, exception);
            return null;
        }

        const value = arguments[0];

        const array_buffer = arguments[1].asArrayBuffer(ctx.ptr()) orelse {
            JSC.throwInvalidArguments("TextEncoder.encodeInto expects a Uint8Array", .{}, ctx, exception);
            return null;
        };

        var output = array_buffer.slice();
        const input = value.getZigString(ctx.ptr());
        var result: strings.EncodeIntoResult = strings.EncodeIntoResult{ .read = 0, .written = 0 };
        if (input.is16Bit()) {
            const utf16_slice = input.utf16Slice();
            result = strings.copyUTF16IntoUTF8(output, @TypeOf(utf16_slice), utf16_slice);
        } else {
            result = strings.copyLatin1IntoUTF8(output, @TypeOf(input.slice()), input.slice());
        }
        return JSC.JSValue.createObject2(ctx.ptr(), &read_key, &written_key, JSValue.jsNumber(result.read), JSValue.jsNumber(result.written)).asObjectRef();
    }

    pub const Constructor = struct {
        pub const Class = NewClass(
            void,
            .{
                .name = "TextEncoder",
            },
            .{
                .constructor = constructor,
            },
            .{},
        );

        pub fn constructor(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSObjectRef {
            return TextEncoder.Class.make(ctx, &text_encoder);
        }
    };
};

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

    pub const Class = NewClass(
        TextDecoder,
        .{
            .name = "TextDecoder",
        },
        .{
            .decode = .{
                .rfn = decode,
            },
        },
        .{
            .encoding = .{
                .get = getEncoding,
                .readOnly = true,
            },
            .ignoreBOM = .{
                .get = getIgnoreBOM,
                .set = setIgnoreBOM,
            },
            .fatal = .{
                .get = getFatal,
                .set = setFatal,
            },
        },
    );

    pub fn getIgnoreBOM(
        this: *TextDecoder,
        _: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return JSC.JSValue.jsBoolean(this.ignore_bom).asObjectRef();
    }
    pub fn setIgnoreBOM(
        this: *TextDecoder,
        _: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        value: JSC.C.JSValueRef,
        _: js.ExceptionRef,
    ) bool {
        this.ignore_bom = JSValue.fromRef(value).toBoolean();
        return true;
    }
    pub fn setFatal(
        this: *TextDecoder,
        _: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        value: JSC.C.JSValueRef,
        _: js.ExceptionRef,
    ) bool {
        this.fatal = JSValue.fromRef(value).toBoolean();
        return true;
    }
    pub fn getFatal(
        this: *TextDecoder,
        _: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return JSC.JSValue.jsBoolean(this.fatal).asObjectRef();
    }

    const utf8_string: string = "utf-8";
    pub fn getEncoding(
        this: *TextDecoder,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(EncodingLabel.label.get(this.encoding).?).toValue(ctx.ptr()).asObjectRef();
    }
    const Vector16 = std.meta.Vector(16, u16);
    const max_16_ascii: Vector16 = @splat(16, @as(u16, 127));
    pub fn decode(
        this: *TextDecoder,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var arguments: []const JSC.JSValue = @ptrCast([*]const JSC.JSValue, args.ptr)[0..args.len];

        if (arguments.len < 1 or arguments[0].isUndefined()) {
            return ZigString.Empty.toValue(ctx.ptr()).asObjectRef();
        }

        var array_buffer = arguments[0].asArrayBuffer(ctx.ptr()) orelse {
            JSC.throwInvalidArguments("TextDecoder.decode expects an ArrayBuffer or TypedArray", .{}, ctx, exception);
            return null;
        };

        if (array_buffer.len == 0) {
            return ZigString.Empty.toValue(ctx.ptr()).asObjectRef();
        }

        switch (this.encoding) {
            EncodingLabel.@"latin1" => {
                var str = ZigString.init(array_buffer.slice());
                return str.toValueGC(ctx.ptr()).asObjectRef();
            },
            EncodingLabel.@"UTF-8" => {
                const buffer_slice = array_buffer.slice();
                var str = ZigString.init(buffer_slice);

                if (this.fatal) {
                    if (strings.toUTF16Alloc(default_allocator, buffer_slice, true)) |result_| {
                        if (result_) |result| {
                            return ZigString.toExternalU16(result.ptr, result.len, ctx.ptr()).asObjectRef();
                        }
                    } else |err| {
                        switch (err) {
                            error.InvalidByteSequence => {
                                JSC.JSError(default_allocator, "Invalid byte sequence", .{}, ctx, exception);
                                return null;
                            },
                            error.OutOfMemory => {
                                JSC.JSError(default_allocator, "Out of memory", .{}, ctx, exception);
                                return null;
                            },
                            else => {
                                JSC.JSError(default_allocator, "Unknown error", .{}, ctx, exception);
                                return null;
                            },
                        }
                    }
                } else {
                    if (strings.toUTF16Alloc(default_allocator, buffer_slice, false)) |result_| {
                        if (result_) |result| {
                            return ZigString.toExternalU16(result.ptr, result.len, ctx.ptr()).asObjectRef();
                        }
                    } else |err| {
                        switch (err) {
                            error.OutOfMemory => {
                                JSC.JSError(default_allocator, "Out of memory", .{}, ctx, exception);
                                return null;
                            },
                            else => {
                                JSC.JSError(default_allocator, "Unknown error", .{}, ctx, exception);
                                return null;
                            },
                        }
                    }
                }
                return str.toValue(ctx.ptr()).asObjectRef();
            },

            EncodingLabel.@"UTF-16LE" => {
                var slice = array_buffer.asU16();
                var i: usize = 0;

                while (i < slice.len) {
                    while (i + 16 <= slice.len) {
                        const vec: Vector16 = slice[i..][0..16].*;
                        if ((@reduce(.Or, vec > max_16_ascii))) {
                            break;
                        }
                        i += 16;
                    }
                    while (i < slice.len and slice[i] <= 127) {
                        i += 1;
                    }
                    break;
                }

                // is this actually a UTF-16 string that is just ascii?
                // we can still allocate as UTF-16 and just copy the bytes
                if (i == slice.len) {
                    return JSC.C.JSValueMakeString(ctx, JSC.C.JSStringCreateWithCharacters(slice.ptr, slice.len));
                }

                var buffer = std.ArrayListAlignedUnmanaged(u16, 1){};
                buffer.ensureTotalCapacity(default_allocator, slice.len) catch unreachable;
                buffer.items.len = i;
                defer buffer.deinit(
                    default_allocator,
                );

                for (slice[0..i]) |char, j| {
                    buffer.items[j] = char;
                }

                const first_high_surrogate = 0xD800;
                const last_high_surrogate = 0xDBFF;
                const first_low_surrogate = 0xDC00;
                const last_low_surrogate = 0xDFFF;

                var remainder = slice[i..];
                while (remainder.len > 0) {
                    switch (remainder[0]) {
                        0...127 => {
                            var count: usize = 1;
                            while (remainder.len > count and remainder[count] <= 127) : (count += 1) {}
                            buffer.ensureUnusedCapacity(default_allocator, count) catch unreachable;
                            const prev = buffer.items.len;
                            buffer.items.len += count;
                            for (remainder[0..count]) |char, j| {
                                buffer.items[prev + j] = char;
                            }
                            remainder = remainder[count..];
                        },
                        first_high_surrogate...last_high_surrogate => |first| {
                            if (remainder.len > 1) {
                                if (remainder[1] >= first_low_surrogate and remainder[1] <= last_low_surrogate) {
                                    buffer.ensureUnusedCapacity(default_allocator, 2) catch unreachable;
                                    buffer.items.ptr[buffer.items.len] = first;
                                    buffer.items.ptr[buffer.items.len + 1] = remainder[1];
                                    buffer.items.len += 2;
                                    remainder = remainder[2..];
                                    continue;
                                }
                            }
                            buffer.ensureUnusedCapacity(default_allocator, 1) catch unreachable;
                            buffer.items.ptr[buffer.items.len] = strings.unicode_replacement;
                            buffer.items.len += 1;
                            remainder = remainder[1..];
                            continue;
                        },

                        // Is this an unpaired low surrogate or four-digit hex escape?
                        else => {
                            buffer.ensureUnusedCapacity(default_allocator, 1) catch unreachable;
                            buffer.items.ptr[buffer.items.len] = strings.unicode_replacement;
                            buffer.items.len += 1;
                            remainder = remainder[1..];
                        },
                    }
                }

                var out = ZigString.init("");
                out.ptr = @ptrCast([*]u8, buffer.items.ptr);
                out.len = buffer.items.len;
                out.markUTF16();
                return out.toValueGC(ctx.ptr()).asObjectRef();
            },
            else => {
                JSC.throwInvalidArguments("TextDecoder.decode set to unsupported encoding", .{}, ctx, exception);
                return null;
            },
        }
    }

    pub const Constructor = struct {
        pub const Class = NewClass(
            void,
            .{
                .name = "TextDecoder",
            },
            .{
                .constructor = constructor,
            },
            .{},
        );

        pub fn constructor(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            args_: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            var arguments: []const JSC.JSValue = @ptrCast([*]const JSC.JSValue, args_.ptr)[0..args_.len];
            var encoding = EncodingLabel.@"UTF-8";
            if (arguments.len > 0) {
                if (!arguments[0].isString()) {
                    JSC.throwInvalidArguments("TextDecoder(encoding) label is invalid", .{}, ctx, exception);
                    return null;
                }

                var str = arguments[0].toSlice(ctx.ptr(), default_allocator);
                defer if (str.allocated) str.deinit();
                encoding = EncodingLabel.which(str.slice()) orelse {
                    JSC.throwInvalidArguments("Unsupported encoding label \"{s}\"", .{str.slice()}, ctx, exception);
                    return null;
                };
            }
            var decoder = getAllocator(ctx).create(TextDecoder) catch unreachable;
            decoder.* = TextDecoder{ .encoding = encoding };
            return TextDecoder.Class.make(ctx, decoder);
        }
    };
};

test "Vec" {}
