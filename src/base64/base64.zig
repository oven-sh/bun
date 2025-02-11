const std = @import("std");
const bun = @import("root").bun;

const mixed_decoder = brk: {
    var decoder = zig_base64.standard.decoderWithIgnore("\xff \t\r\n" ++ [_]u8{
        std.ascii.control_code.vt,
        std.ascii.control_code.ff,
    });

    for (zig_base64.url_safe_alphabet_chars[62..], 62..) |c, i| {
        decoder.decoder.char_to_index[c] = @as(u8, @intCast(i));
    }

    break :brk decoder;
};

pub fn decode(destination: []u8, source: []const u8) bun.simdutf.SIMDUTFResult {
    const result = bun.simdutf.base64.decode(source, destination, false);

    if (!result.isSuccessful()) {
        // The input does not follow the WHATWG forgiving-base64 specification
        // https://infra.spec.whatwg.org/#forgiving-base64-decode
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/string_bytes.cc#L359
        var wrote: usize = 0;
        mixed_decoder.decode(destination, source, &wrote) catch {
            return .{
                .count = wrote,
                .status = .invalid_base64_character,
            };
        };
        return .{ .count = wrote, .status = .success };
    }

    return result;
}

pub fn decodeAlloc(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    var dest = try allocator.alloc(u8, decodeLen(input));
    const result = decode(dest, input);
    if (!result.isSuccessful()) {
        allocator.free(dest);
        return error.DecodingFailed;
    }
    return dest[0..result.count];
}

pub fn encode(destination: []u8, source: []const u8) usize {
    return bun.simdutf.base64.encode(source, destination, false);
}

pub fn decodeLenUpperBound(len: usize) usize {
    return zig_base64.standard.Decoder.calcSizeUpperBound(len) catch {
        //fallback
        return len / 4 * 3;
    };
}

pub fn decodeLen(source: anytype) usize {
    return zig_base64.standard.Decoder.calcSizeForSlice(source) catch {

        //fallback; add 2 to allow for potentially missing padding
        return source.len / 4 * 3 + 2;
    };
}

pub fn encodeLen(source: anytype) usize {
    return encodeLenFromSize(source.len);
}

pub fn encodeLenFromSize(source: usize) usize {
    return zig_base64.standard.Encoder.calcSize(source);
}

pub fn urlSafeEncodeLen(source: anytype) usize {
    // Copied from WebKit
    return ((source.len * 4) + 2) / 3;
}
extern fn WTF__base64URLEncode(input: [*]const u8, input_len: usize, output: [*]u8, output_len: usize) usize;
pub fn encodeURLSafe(dest: []u8, source: []const u8) usize {
    bun.JSC.markBinding(@src());
    return WTF__base64URLEncode(source.ptr, source.len, dest.ptr, dest.len);
}

const zig_base64 = struct {
    const assert = bun.assert;
    const testing = std.testing;
    const mem = std.mem;

    pub const Error = error{
        InvalidCharacter,
        InvalidPadding,
        NoSpaceLeft,
    };

    const decoderWithIgnoreProto = *const fn (ignore: []const u8) Base64DecoderWithIgnore;

    /// Base64 codecs
    pub const Codecs = struct {
        alphabet_chars: [64]u8,
        pad_char: ?u8,
        decoderWithIgnore: decoderWithIgnoreProto,
        Encoder: Base64Encoder,
        Decoder: Base64Decoder,
    };

    pub const standard_alphabet_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".*;
    fn standardBase64DecoderWithIgnore(ignore: []const u8) Base64DecoderWithIgnore {
        return Base64DecoderWithIgnore.init(standard_alphabet_chars, '=', ignore);
    }

    /// Standard Base64 codecs, with padding
    pub const standard = Codecs{
        .alphabet_chars = standard_alphabet_chars,
        .pad_char = '=',
        .decoderWithIgnore = standardBase64DecoderWithIgnore,
        .Encoder = Base64Encoder.init(standard_alphabet_chars, '='),
        .Decoder = Base64Decoder.init(standard_alphabet_chars, '='),
    };

    /// Standard Base64 codecs, without padding
    pub const standard_no_pad = Codecs{
        .alphabet_chars = standard_alphabet_chars,
        .pad_char = null,
        .decoderWithIgnore = standardBase64DecoderWithIgnore,
        .Encoder = Base64Encoder.init(standard_alphabet_chars, null),
        .Decoder = Base64Decoder.init(standard_alphabet_chars, null),
    };

    pub const url_safe_alphabet_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".*;
    fn urlSafeBase64DecoderWithIgnore(ignore: []const u8) Base64DecoderWithIgnore {
        return Base64DecoderWithIgnore.init(url_safe_alphabet_chars, '=', ignore);
    }

    /// URL-safe Base64 codecs, with padding
    pub const url_safe = Codecs{
        .alphabet_chars = url_safe_alphabet_chars,
        .pad_char = '=',
        .decoderWithIgnore = urlSafeBase64DecoderWithIgnore,
        .Encoder = Base64Encoder.init(url_safe_alphabet_chars, '='),
        .Decoder = Base64Decoder.init(url_safe_alphabet_chars, '='),
    };

    /// URL-safe Base64 codecs, without padding
    pub const url_safe_no_pad = Codecs{
        .alphabet_chars = url_safe_alphabet_chars,
        .pad_char = null,
        .decoderWithIgnore = urlSafeBase64DecoderWithIgnore,
        .Encoder = Base64Encoder.init(url_safe_alphabet_chars, null),
        .Decoder = Base64Decoder.init(url_safe_alphabet_chars, null),
    };

    pub const standard_pad_char = @compileError("deprecated; use standard.pad_char");
    pub const standard_encoder = @compileError("deprecated; use standard.Encoder");
    pub const standard_decoder = @compileError("deprecated; use standard.Decoder");

    pub const Base64Encoder = struct {
        alphabet_chars: [64]u8,
        pad_char: ?u8,

        /// A bunch of assertions, then simply pass the data right through.
        pub fn init(alphabet_chars: [64]u8, pad_char: ?u8) Base64Encoder {
            assert(alphabet_chars.len == 64);
            var char_in_alphabet = [_]bool{false} ** 256;
            for (alphabet_chars) |c| {
                assert(!char_in_alphabet[c]);
                assert(pad_char == null or c != pad_char.?);
                char_in_alphabet[c] = true;
            }
            return Base64Encoder{
                .alphabet_chars = alphabet_chars,
                .pad_char = pad_char,
            };
        }

        /// Compute the encoded length
        /// Note: this is wrong for base64url encoding. Do not use it for that.
        pub fn calcSize(encoder: *const Base64Encoder, source_len: usize) usize {
            if (encoder.pad_char != null) {
                return @divTrunc(source_len + 2, 3) * 4;
            } else {
                const leftover = source_len % 3;
                return @divTrunc(source_len, 3) * 4 + @divTrunc(leftover * 4 + 2, 3);
            }
        }

        /// dest.len must at least be what you get from ::calcSize.
        pub fn encode(encoder: *const Base64Encoder, dest: []u8, source: []const u8) []const u8 {
            const out_len = encoder.calcSize(source.len);
            assert(dest.len >= out_len);

            const out_idx = encoder.encodeWithoutSizeCheck(dest, source);
            if (encoder.pad_char) |pad_char| {
                for (dest[out_idx..out_len]) |*pad| {
                    pad.* = pad_char;
                }
            }
            return dest[0..out_len];
        }

        pub fn encodeWithoutSizeCheck(encoder: *const Base64Encoder, dest: []u8, source: []const u8) usize {
            var acc: u12 = 0;
            var acc_len: u4 = 0;
            var out_idx: usize = 0;
            for (source) |v| {
                acc = (acc << 8) + v;
                acc_len += 8;
                while (acc_len >= 6) {
                    acc_len -= 6;
                    dest[out_idx] = encoder.alphabet_chars[@as(u6, @truncate((acc >> acc_len)))];
                    out_idx += 1;
                }
            }
            if (acc_len > 0) {
                dest[out_idx] = encoder.alphabet_chars[@as(u6, @truncate((acc << 6 - acc_len)))];
                out_idx += 1;
            }
            return out_idx;
        }
    };

    pub const Base64Decoder = struct {
        const invalid_char: u8 = 0xff;

        /// e.g. 'A' => 0.
        /// `invalid_char` for any value not in the 64 alphabet chars.
        char_to_index: [256]u8,
        pad_char: ?u8,

        pub fn init(alphabet_chars: [64]u8, pad_char: ?u8) Base64Decoder {
            var result = Base64Decoder{
                .char_to_index = [_]u8{invalid_char} ** 256,
                .pad_char = pad_char,
            };

            var char_in_alphabet = [_]bool{false} ** 256;
            for (alphabet_chars, 0..) |c, i| {
                assert(!char_in_alphabet[c]);
                assert(pad_char == null or c != pad_char.?);

                result.char_to_index[c] = @as(u8, @intCast(i));
                char_in_alphabet[c] = true;
            }
            return result;
        }

        /// Return the maximum possible decoded size for a given input length - The actual length may be less if the input includes padding.
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calcSizeUpperBound(decoder: *const Base64Decoder, source_len: usize) Error!usize {
            var result = source_len / 4 * 3;
            const leftover = source_len % 4;
            if (decoder.pad_char != null) {
                if (leftover % 4 != 0) return error.InvalidPadding;
            } else {
                if (leftover % 4 == 1) return error.InvalidPadding;
                result += leftover * 3 / 4;
            }
            return result;
        }

        /// Return the exact decoded size for a slice.
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calcSizeForSlice(decoder: *const Base64Decoder, source: []const u8) Error!usize {
            const source_len = source.len;
            var result = try decoder.calcSizeUpperBound(source_len);
            if (decoder.pad_char) |pad_char| {
                if (source_len >= 1 and source[source_len - 1] == pad_char) result -= 1;
                if (source_len >= 2 and source[source_len - 2] == pad_char) result -= 1;
            }
            return result;
        }

        /// dest.len must be what you get from ::calcSize.
        /// invalid characters result in error.InvalidCharacter.
        /// invalid padding results in error.InvalidPadding.
        pub fn decode(decoder: *const Base64Decoder, dest: []u8, source: []const u8) Error!void {
            if (decoder.pad_char != null and source.len % 4 != 0) return error.InvalidPadding;
            var acc: u12 = 0;
            var acc_len: u4 = 0;
            var dest_idx: usize = 0;
            var leftover_idx: ?usize = null;
            for (source, 0..) |c, src_idx| {
                const d = decoder.char_to_index[c];
                if (d == invalid_char) {
                    if (decoder.pad_char == null or c != decoder.pad_char.?) return error.InvalidCharacter;
                    leftover_idx = src_idx;
                    break;
                }
                acc = (acc << 6) + d;
                acc_len += 6;
                if (acc_len >= 8) {
                    acc_len -= 8;
                    dest[dest_idx] = @as(u8, @truncate(acc >> acc_len));
                    dest_idx += 1;
                }
            }
            if (acc_len > 4 or (acc & (@as(u12, 1) << acc_len) - 1) != 0) {
                return error.InvalidPadding;
            }
            if (leftover_idx == null) return;
            const leftover = source[leftover_idx.?..];
            if (decoder.pad_char) |pad_char| {
                const padding_len = acc_len / 2;
                var padding_chars: usize = 0;
                for (leftover) |c| {
                    if (c != pad_char) {
                        return if (c == Base64Decoder.invalid_char) error.InvalidCharacter else error.InvalidPadding;
                    }
                    padding_chars += 1;
                }
                if (padding_chars != padding_len) return error.InvalidPadding;
            }
        }
    };

    pub const Base64DecoderWithIgnore = struct {
        decoder: Base64Decoder,
        char_is_ignored: [256]bool,

        pub fn init(alphabet_chars: [64]u8, pad_char: ?u8, ignore_chars: []const u8) Base64DecoderWithIgnore {
            var result = Base64DecoderWithIgnore{
                .decoder = Base64Decoder.init(alphabet_chars, pad_char),
                .char_is_ignored = [_]bool{false} ** 256,
            };
            for (ignore_chars) |c| {
                assert(result.decoder.char_to_index[c] == Base64Decoder.invalid_char);
                assert(!result.char_is_ignored[c]);
                assert(result.decoder.pad_char != c);
                result.char_is_ignored[c] = true;
            }
            return result;
        }

        /// Return the maximum possible decoded size for a given input length - The actual length may be less if the input includes padding
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calcSizeUpperBound(decoder_with_ignore: *const Base64DecoderWithIgnore, source_len: usize) usize {
            var result = source_len / 4 * 3;
            if (decoder_with_ignore.decoder.pad_char == null) {
                const leftover = source_len % 4;
                result += leftover * 3 / 4;
            }
            return result;
        }

        /// Invalid characters that are not ignored result in error.InvalidCharacter.
        /// Invalid padding results in error.InvalidPadding.
        /// Decoding more data than can fit in dest results in error.NoSpaceLeft. See also ::calcSizeUpperBound.
        /// Returns the number of bytes written to dest.
        pub fn decode(decoder_with_ignore: *const Base64DecoderWithIgnore, dest: []u8, source: []const u8, wrote: *usize) Error!void {
            const decoder = &decoder_with_ignore.decoder;
            var acc: u12 = 0;
            var acc_len: u4 = 0;
            var dest_idx: usize = 0;
            var leftover_idx: ?usize = null;

            defer {
                wrote.* = dest_idx;
            }

            for (source, 0..) |c, src_idx| {
                if (decoder_with_ignore.char_is_ignored[c]) continue;
                const d = decoder.char_to_index[c];
                if (d == Base64Decoder.invalid_char) {
                    if (decoder.pad_char) |pad_char| {
                        if (c == pad_char) {
                            leftover_idx = src_idx;
                            break;
                        }
                    }
                    if (decoder_with_ignore.char_is_ignored[Base64Decoder.invalid_char]) continue;
                    return error.InvalidCharacter;
                }
                acc = (acc << 6) + d;
                acc_len += 6;
                if (acc_len >= 8) {
                    if (dest_idx == dest.len) return error.NoSpaceLeft;
                    acc_len -= 8;
                    dest[dest_idx] = @as(u8, @truncate(acc >> acc_len));
                    dest_idx += 1;
                }
            }
            if (acc_len > 4 or (acc & (@as(u12, 1) << acc_len) - 1) != 0) return error.InvalidPadding;

            if (decoder.pad_char) |pad_char| {
                const padding_len = acc_len / 2;

                if (leftover_idx) |idx| {
                    const leftover = source[idx..];
                    var padding_chars: usize = 0;
                    for (leftover) |c| {
                        if (decoder_with_ignore.char_is_ignored[c]) continue;
                        if (c != pad_char) {
                            return if (c == Base64Decoder.invalid_char) error.InvalidCharacter else error.InvalidPadding;
                        }
                        padding_chars += 1;
                    }
                    if (padding_chars != padding_len) return error.InvalidPadding;
                } else if (padding_len > 0) {
                    return error.InvalidPadding;
                }
            }
        }
    };

    fn testBase64() !void {
        const codecs = standard;

        try testAllApis(codecs, "", "");
        try testAllApis(codecs, "f", "Zg==");
        try testAllApis(codecs, "fo", "Zm8=");
        try testAllApis(codecs, "foo", "Zm9v");
        try testAllApis(codecs, "foob", "Zm9vYg==");
        try testAllApis(codecs, "fooba", "Zm9vYmE=");
        try testAllApis(codecs, "foobar", "Zm9vYmFy");

        try testDecodeIgnoreSpace(codecs, "", " ");
        try testDecodeIgnoreSpace(codecs, "f", "Z g= =");
        try testDecodeIgnoreSpace(codecs, "fo", "    Zm8=");
        try testDecodeIgnoreSpace(codecs, "foo", "Zm9v    ");
        try testDecodeIgnoreSpace(codecs, "foob", "Zm9vYg = = ");
        try testDecodeIgnoreSpace(codecs, "fooba", "Zm9v YmE=");
        try testDecodeIgnoreSpace(codecs, "foobar", " Z m 9 v Y m F y ");

        // test getting some api errors
        try testError(codecs, "A", error.InvalidPadding);
        try testError(codecs, "AA", error.InvalidPadding);
        try testError(codecs, "AAA", error.InvalidPadding);
        try testError(codecs, "A..A", error.InvalidCharacter);
        try testError(codecs, "AA=A", error.InvalidPadding);
        try testError(codecs, "AA/=", error.InvalidPadding);
        try testError(codecs, "A/==", error.InvalidPadding);
        try testError(codecs, "A===", error.InvalidPadding);
        try testError(codecs, "====", error.InvalidPadding);

        try testNoSpaceLeftError(codecs, "AA==");
        try testNoSpaceLeftError(codecs, "AAA=");
        try testNoSpaceLeftError(codecs, "AAAA");
        try testNoSpaceLeftError(codecs, "AAAAAA==");
    }

    fn testBase64UrlSafeNoPad() !void {
        const codecs = url_safe_no_pad;

        try testAllApis(codecs, "", "");
        try testAllApis(codecs, "f", "Zg");
        try testAllApis(codecs, "fo", "Zm8");
        try testAllApis(codecs, "foo", "Zm9v");
        try testAllApis(codecs, "foob", "Zm9vYg");
        try testAllApis(codecs, "fooba", "Zm9vYmE");
        try testAllApis(codecs, "foobar", "Zm9vYmFy");

        try testDecodeIgnoreSpace(codecs, "", " ");
        try testDecodeIgnoreSpace(codecs, "f", "Z g ");
        try testDecodeIgnoreSpace(codecs, "fo", "    Zm8");
        try testDecodeIgnoreSpace(codecs, "foo", "Zm9v    ");
        try testDecodeIgnoreSpace(codecs, "foob", "Zm9vYg   ");
        try testDecodeIgnoreSpace(codecs, "fooba", "Zm9v YmE");
        try testDecodeIgnoreSpace(codecs, "foobar", " Z m 9 v Y m F y ");

        // test getting some api errors
        try testError(codecs, "A", error.InvalidPadding);
        try testError(codecs, "AAA=", error.InvalidCharacter);
        try testError(codecs, "A..A", error.InvalidCharacter);
        try testError(codecs, "AA=A", error.InvalidCharacter);
        try testError(codecs, "AA/=", error.InvalidCharacter);
        try testError(codecs, "A/==", error.InvalidCharacter);
        try testError(codecs, "A===", error.InvalidCharacter);
        try testError(codecs, "====", error.InvalidCharacter);

        try testNoSpaceLeftError(codecs, "AA");
        try testNoSpaceLeftError(codecs, "AAA");
        try testNoSpaceLeftError(codecs, "AAAA");
        try testNoSpaceLeftError(codecs, "AAAAAA");
    }

    fn testAllApis(codecs: Codecs, expected_decoded: []const u8, expected_encoded: []const u8) !void {
        // Base64Encoder
        {
            var buffer: [0x100]u8 = undefined;
            const encoded = codecs.Encoder.encode(&buffer, expected_decoded);
            try testing.expectEqualSlices(u8, expected_encoded, encoded);
        }

        // Base64Decoder
        {
            var buffer: [0x100]u8 = undefined;
            const decoded = buffer[0..try codecs.Decoder.calcSizeForSlice(expected_encoded)];
            try codecs.Decoder.decode(decoded, expected_encoded);
            try testing.expectEqualSlices(u8, expected_decoded, decoded);
        }

        // Base64DecoderWithIgnore
        {
            const decoder_ignore_nothing = codecs.decoderWithIgnore("");
            var buffer: [0x100]u8 = undefined;
            var decoded = buffer[0..try decoder_ignore_nothing.calcSizeUpperBound(expected_encoded.len)];
            const written = try decoder_ignore_nothing.decode(decoded, expected_encoded);
            try testing.expect(written <= decoded.len);
            try testing.expectEqualSlices(u8, expected_decoded, decoded[0..written]);
        }
    }

    fn testDecodeIgnoreSpace(codecs: Codecs, expected_decoded: []const u8, encoded: []const u8) !void {
        const decoder_ignore_space = codecs.decoderWithIgnore(" ");
        var buffer: [0x100]u8 = undefined;
        var decoded = buffer[0..try decoder_ignore_space.calcSizeUpperBound(encoded.len)];
        const written = try decoder_ignore_space.decode(decoded, encoded);
        try testing.expectEqualSlices(u8, expected_decoded, decoded[0..written]);
    }

    fn testError(codecs: Codecs, encoded: []const u8, expected_err: anyerror) !void {
        const decoder_ignore_space = codecs.decoderWithIgnore(" ");
        var buffer: [0x100]u8 = undefined;
        if (codecs.Decoder.calcSizeForSlice(encoded)) |decoded_size| {
            const decoded = buffer[0..decoded_size];
            if (codecs.Decoder.decode(decoded, encoded)) |_| {
                return error.ExpectedError;
            } else |err| if (err != expected_err) return err;
        } else |err| if (err != expected_err) return err;

        if (decoder_ignore_space.decode(buffer[0..], encoded)) |_| {
            return error.ExpectedError;
        } else |err| if (err != expected_err) return err;
    }

    fn testNoSpaceLeftError(codecs: Codecs, encoded: []const u8) !void {
        const decoder_ignore_space = codecs.decoderWithIgnore(" ");
        var buffer: [0x100]u8 = undefined;
        const decoded = buffer[0 .. (try codecs.Decoder.calcSizeForSlice(encoded)) - 1];
        if (decoder_ignore_space.decode(decoded, encoded)) |_| {
            return error.ExpectedError;
        } else |err| if (err != error.NoSpaceLeft) return err;
    }
};
