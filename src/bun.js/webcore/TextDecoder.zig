const TextDecoder = @This();

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

pub const js = jsc.Codegen.JSTextDecoder;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const new = bun.TrivialNew(TextDecoder);

pub fn finalize(this: *TextDecoder) void {
    bun.destroy(this);
}

pub fn getIgnoreBOM(
    this: *TextDecoder,
    _: *jsc.JSGlobalObject,
) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.ignore_bom);
}

pub fn getFatal(
    this: *TextDecoder,
    _: *jsc.JSGlobalObject,
) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.fatal);
}

pub fn getEncoding(
    this: *TextDecoder,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.init(EncodingLabel.getLabel(this.encoding)).toJS(globalThis);
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

pub fn decode(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();

    const input_slice = input_slice: {
        if (arguments.len == 0 or arguments[0].isUndefined()) {
            break :input_slice "";
        }

        if (arguments[0].asArrayBuffer(globalThis)) |array_buffer| {
            break :input_slice array_buffer.slice();
        }

        return globalThis.throwInvalidArguments("TextDecoder.decode expects an ArrayBuffer or TypedArray", .{});
    };

    const stream = stream: {
        if (arguments.len > 1 and arguments[1].isObject()) {
            if (try arguments[1].fastGet(globalThis, .stream)) |stream_value| {
                break :stream stream_value.toBoolean();
            }
        }

        break :stream false;
    };

    return switch (!stream) {
        inline else => |flush| this.decodeSlice(globalThis, input_slice, flush),
    };
}

pub fn decodeWithoutTypeChecks(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, uint8array: *jsc.JSUint8Array) bun.JSError!JSValue {
    return this.decodeSlice(globalThis, uint8array.slice(), false);
}

fn decodeSlice(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, buffer_slice: []const u8, comptime flush: bool) bun.JSError!JSValue {
    const TextCodec = @import("../bindings/TextCodec.zig").TextCodec;

    switch (this.encoding) {
        EncodingLabel.latin1 => {
            if (strings.isAllASCII(buffer_slice)) {
                return ZigString.init(buffer_slice).toJS(globalThis);
            }

            // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
            // However, this is also what WebKit seems to do.
            //
            // => The reason we need to encode it is because TextDecoder "latin1" is actually CP1252, while WebKit latin1 is 8-bit utf-16
            const out_length = strings.elementLengthCP1252IntoUTF16(buffer_slice);
            const bytes = try bun.default_allocator.alloc(u16, out_length);

            const out = strings.copyCP1252IntoUTF16(bytes, buffer_slice);
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
                    const joined = try bun.default_allocator.alloc(u8, maybe_without_bom.len + this.buffered.len);
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
                            return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "Invalid byte sequence", .{}).throw();
                        }
                    }

                    bun.assert(err == error.OutOfMemory);
                    return globalThis.throwOutOfMemory();
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

            var decoded, const saw_error = try this.decodeUTF16(input, utf16_encoding == .@"UTF-16BE", flush);

            if (saw_error and this.fatal) {
                decoded.deinit(bun.default_allocator);
                return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "The encoded data was not valid {s} data", .{@tagName(utf16_encoding)}).throw();
            }

            var output = bun.String.borrowUTF16(decoded.items);
            return output.toJS(globalThis);
        },

        // Handle all other encodings using WebKit's TextCodec
        else => {
            const encoding_name = EncodingLabel.getLabel(this.encoding);

            // Create codec if we don't have one cached
            // Note: In production, we might want to cache these per-encoding
            const codec = TextCodec.create(encoding_name) orelse {
                // Fallback to empty string if codec creation fails
                return ZigString.init("").toJS(globalThis);
            };
            defer codec.deinit();

            // Handle BOM stripping if needed
            if (!this.ignore_bom) {
                codec.stripBOM();
            }

            // Decode the data
            const result = codec.decode(buffer_slice, flush, this.fatal);
            defer result.result.deref();

            // Check for errors if fatal mode is enabled
            if (result.sawError and this.fatal) {
                return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "The encoded data was not valid {s} data", .{encoding_name}).throw();
            }

            // Return the decoded string
            return result.result.toJS(globalThis);
        },
    }
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*TextDecoder {
    const encoding_value, const options_value = callframe.argumentsAsArray(2);

    var decoder = TextDecoder{};

    if (encoding_value.isString()) {
        var str = try encoding_value.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();

        if (EncodingLabel.which(str.slice())) |label| {
            decoder.encoding = label;
        } else {
            return globalThis.ERR(.ENCODING_NOT_SUPPORTED, "Unsupported encoding label \"{s}\"", .{str.slice()}).throw();
        }
    } else if (encoding_value.isUndefined()) {
        // default to utf-8
        decoder.encoding = EncodingLabel.@"UTF-8";
    } else {
        return globalThis.throwInvalidArguments("TextDecoder(encoding) label is invalid", .{});
    }

    if (!options_value.isUndefined()) {
        if (!options_value.isObject()) {
            return globalThis.throwInvalidArguments("TextDecoder(options) is invalid", .{});
        }

        if (try options_value.get(globalThis, "fatal")) |fatal| {
            decoder.fatal = fatal.toBoolean();
        }

        if (try options_value.get(globalThis, "ignoreBOM")) |ignoreBOM| {
            if (ignoreBOM.isBoolean()) {
                decoder.ignore_bom = ignoreBOM.asBoolean();
            } else {
                return globalThis.throwInvalidArguments("TextDecoder(options) ignoreBOM is invalid. Expected boolean value", .{});
            }
        }
    }

    return TextDecoder.new(decoder);
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const ArrayBuffer = jsc.ArrayBuffer;
const JSGlobalObject = jsc.JSGlobalObject;
const JSUint8Array = jsc.JSUint8Array;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const EncodingLabel = jsc.WebCore.EncodingLabel;
