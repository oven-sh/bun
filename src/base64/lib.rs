use bun_simdutf_sys::simdutf::{self, SIMDUTFResult};

pub use zig_base64::STANDARD_ALPHABET_CHARS;

// ASCII control codes used in the ignore set below.
const VT: u8 = 0x0B; // vertical tab
const FF: u8 = 0x0C; // form feed

// Const-initialized static lands in `.rodata`
// (no `Once` atomic on the `Integrity::parse` hot path).
static MIXED_DECODER: zig_base64::Base64DecoderWithIgnore = {
    let mut decoder =
        zig_base64::standard_base64_decoder_with_ignore(&[0xFF, b' ', b'\t', b'\r', b'\n', VT, FF]);

    let mut i: usize = 62;
    while i < 64 {
        let c = zig_base64::URL_SAFE_ALPHABET_CHARS[i];
        decoder.decoder.char_to_index[c as usize] = i as u8;
        i += 1;
    }

    decoder
};

pub fn decode(destination: &mut [u8], source: &[u8]) -> SIMDUTFResult {
    let result = simdutf::base64::decode(source, destination, false);

    if !result.is_successful() {
        // The input does not follow the WHATWG forgiving-base64 specification
        // https://infra.spec.whatwg.org/#forgiving-base64-decode
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/string_bytes.cc#L359
        let mut wrote: usize = 0;
        if MIXED_DECODER
            .decode(destination, source, &mut wrote)
            .is_err()
        {
            return SIMDUTFResult {
                count: wrote,
                status: simdutf::Status::INVALID_BASE64_CHARACTER,
            };
        }
        return SIMDUTFResult {
            count: wrote,
            status: simdutf::Status::SUCCESS,
        };
    }

    result
}

/// Destination size that lets [`decode_lenient`] decode an input of
/// `source_len` base64 characters in a single simdutf pass (the worst-case
/// decoded length).
pub const fn decode_lenient_len(source_len: usize) -> usize {
    source_len.div_ceil(4) * 3
}

/// Decode base64 the way Node.js `Buffer.from(str, "base64" | "base64url")`
/// and `buf.write(str, "base64" | "base64url")` do: both the standard and the
/// URL-safe alphabets are accepted, whitespace and any other non-alphabet
/// bytes are skipped, and decoding stops at the first `'='`. Invalid input
/// never fails — as much data as possible is decoded.
///
/// Like Node.js, strictly valid input for the requested alphabet
/// (`is_urlsafe`) is decoded with simdutf's fastest kernel; everything else is
/// decoded with simdutf's `base64_default_or_url_accept_garbage` mode.
///
/// Returns the number of bytes written to `destination`.
pub fn decode_lenient(destination: &mut [u8], source: &[u8], is_urlsafe: bool) -> usize {
    // Fast path: the common case is strictly valid base64 for the requested
    // alphabet (possibly with whitespace and padding), which simdutf decodes
    // with its fastest kernel. This is the same first attempt Node.js makes.
    let strict = simdutf::base64::decode(source, destination, is_urlsafe);
    if strict.is_successful() {
        return strict.count;
    }

    // simdutf only honors the accept-garbage stop-at-'=' rule when the
    // destination can hold the worst-case decode; with a smaller destination
    // (e.g. `buf.write` into a short buffer) it switches to a chunked strategy
    // that keeps decoding past the '='. Apply the rule up front in that case
    // so both strategies agree.
    let source = if destination.len() < decode_lenient_len(source.len()) {
        match source.iter().position(|&c| c == b'=') {
            Some(index) => &source[..index],
            None => source,
        }
    } else {
        source
    };

    let result = simdutf::base64::decode_lenient(source, destination);
    if result.is_successful() {
        return result.count;
    }

    // The decoded data does not fit in `destination`: fall back to the scalar
    // decoder, which fills `destination` and stops.
    let mut wrote: usize = 0;
    let _ = MIXED_DECODER.decode(destination, source, &mut wrote);
    wrote
}

/// WHATWG forgiving-base64 decode (https://infra.spec.whatwg.org/#forgiving-base64-decode).
/// Returns `None` when the input is not valid forgiving-base64; otherwise the decoded bytes.
pub fn decode_forgiving(input: &[u8]) -> Option<Vec<u8>> {
    let mut buf = vec![0u8; decode_lenient_len(input.len())];
    let result = simdutf::base64::decode(input, &mut buf, false);
    if !result.is_successful() {
        return None;
    }
    buf.truncate(result.count);
    Some(buf)
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeAllocError {
    #[error("DecodingFailed")]
    DecodingFailed,
}

pub fn decode_alloc(input: &[u8]) -> Result<Vec<u8>, DecodeAllocError> {
    let mut dest = vec![0u8; decode_len(input)];
    let result = decode(&mut dest, input);
    if !result.is_successful() {
        return Err(DecodeAllocError::DecodingFailed);
    }
    dest.truncate(result.count);
    Ok(dest)
}

pub use bun_core::base64::encode;

pub fn encode_alloc(source: &[u8]) -> Vec<u8> {
    let len = encode_len(source);
    let mut destination = vec![0u8; len];
    let encoded_len = encode(&mut destination, source);
    destination.truncate(encoded_len);
    destination
}

pub(crate) fn simdutf_encode_len_url_safe(source_len: usize) -> usize {
    simdutf::base64::encode_len(source_len, true)
}

/// Encode with the following differences from regular `encode` function:
///
/// * No padding is added (the extra `=` characters at the end)
/// * `-` and `_` are used instead of `+` and `/`
///
/// See the documentation for simdutf's `binary_to_base64` function for more details (simdutf_impl.h).
pub fn encode_url_safe(dest: &mut [u8], source: &[u8]) -> usize {
    simdutf::base64::encode(source, dest, true)
}

/// `encode_url_safe` into a freshly-allocated `Vec<u8>` sized exactly via
/// `simdutf_encode_len_url_safe` (simdutf computes the exact no-padding length, so
/// the trailing `truncate` is a no-op kept for symmetry with `encode_alloc`).
pub fn simdutf_encode_url_safe_alloc(source: &[u8]) -> Vec<u8> {
    let len = simdutf_encode_len_url_safe(source.len());
    let mut destination = vec![0u8; len];
    let encoded_len = encode_url_safe(&mut destination, source);
    destination.truncate(encoded_len);
    destination
}

pub fn decode_len_upper_bound(len: usize) -> usize {
    match zig_base64::STANDARD.decoder.calc_size_upper_bound(len) {
        Ok(v) => v,
        Err(_) => {
            // fallback
            len / 4 * 3
        }
    }
}

pub fn decode_len(source: &[u8]) -> usize {
    match zig_base64::STANDARD.decoder.calc_size_for_slice(source) {
        Ok(v) => v,
        Err(_) => {
            // fallback; add 2 to allow for potentially missing padding
            source.len() / 4 * 3 + 2
        }
    }
}

#[inline]
pub const fn encode_len(source: &[u8]) -> usize {
    encode_len_from_size(source.len())
}

#[inline]
pub const fn encode_len_from_size(source: usize) -> usize {
    bun_core::base64::standard_encoder_calc_size(source)
}

#[inline]
pub(crate) const fn url_safe_encode_len_from_size(n: usize) -> usize {
    // Equivalent to WebKit's `ceil(n * 4 / 3)`, but split so the intermediate
    // product can't overflow before the divide for large `n`.
    let full_chunks = n / 3;
    let leftover = n % 3;
    full_chunks * 4 + (leftover * 4).div_ceil(3)
}

#[inline]
pub const fn url_safe_encode_len(source: &[u8]) -> usize {
    url_safe_encode_len_from_size(source.len())
}

// ──────────────────────────────────────────────────────────────────────────
// VLQ — moved from bun_sourcemap. Lives here because the encoding is pure
// base64-alphabet bit-packing with zero sourcemap-specific deps; bun_sourcemap
// re-exports this for its own consumers.
// ──────────────────────────────────────────────────────────────────────────
pub use vlq::{VLQ, VLQResult};

/// Variable-length quantity encoding, limited to i32 as per source map spec.
/// https://en.wikipedia.org/wiki/Variable-length_quantity
/// https://sourcemaps.info/spec.html
pub mod vlq {
    /// Encoding min and max ints are "//////D" and "+/////D", respectively.
    /// These are 7 bytes long. This makes the `VLQ` struct 8 bytes.
    #[derive(Copy, Clone)]
    pub struct VLQ {
        pub bytes: [u8; VLQ_MAX_IN_BYTES],
        pub len: u8,
    }

    impl Default for VLQ {
        fn default() -> Self {
            Self {
                bytes: [0; VLQ_MAX_IN_BYTES],
                len: 0,
            }
        }
    }

    pub(crate) const VLQ_MAX_IN_BYTES: usize = 7;

    impl VLQ {
        #[inline]
        pub fn slice(&self) -> &[u8] {
            &self.bytes[0..self.len as usize]
        }

        // `std::io::Write` is used as the byte-sink trait so base64 stays a
        // tier-0 leaf with no bun_io dep.
        pub fn write_to(self, writer: &mut impl std::io::Write) -> std::io::Result<()> {
            writer.write_all(&self.bytes[0..self.len as usize])
        }

        pub const ZERO: VLQ = VLQ_LOOKUP_TABLE[0];

        #[inline]
        pub const fn encode(value: i32) -> VLQ {
            if value >= 0 && value <= 255 {
                VLQ_LOOKUP_TABLE[value as usize]
            } else {
                encode_slow_path(value)
            }
        }
    }

    // Module-level alias for `VLQ::encode`.
    #[inline]
    pub const fn encode(value: i32) -> VLQ {
        VLQ::encode(value)
    }

    const VLQ_LOOKUP_TABLE: [VLQ; 256] = {
        let mut entries = [VLQ {
            bytes: [0; VLQ_MAX_IN_BYTES],
            len: 0,
        }; 256];
        let mut i: usize = 0;
        let mut j: i32 = 0;
        while i < 256 {
            entries[i] = encode_slow_path(j);
            i += 1;
            j += 1;
        }
        entries
    };

    // A single base 64 digit can contain 6 bits of data. For the base 64 variable
    // length quantities we use in the source map spec, the first bit is the sign,
    // the next four bits are the actual value, and the 6th bit is the continuation
    // bit. The continuation bit tells us whether there are more digits in this
    // value following this digit.
    //
    //   Continuation
    //   |    Sign
    //   |    |
    //   V    V
    //   101011
    //
    const fn encode_slow_path(value: i32) -> VLQ {
        let mut len: u8 = 0;
        let mut bytes: [u8; VLQ_MAX_IN_BYTES] = [0; VLQ_MAX_IN_BYTES];

        // Sign-magnitude: i32::MIN has no representation (its magnitude
        // overflows the u32 VLQ), so it wraps to "-0" instead of panicking.
        // The crash handler encodes bitcast u32 address halves through here
        // and must not panic while already reporting a crash.
        let mut vlq: u32 = if value >= 0 {
            (value << 1) as u32
        } else {
            (value.unsigned_abs() << 1) | 1
        };

        // source mappings are limited to i32
        let mut iter = 0;
        while iter < VLQ_MAX_IN_BYTES {
            let mut digit = vlq & 31;
            vlq >>= 5;

            // If there are still more digits in this value, we must make sure the
            // continuation bit is marked
            if vlq != 0 {
                digit |= 32;
            }

            bytes[len as usize] = BASE64[digit as usize];
            len += 1;

            if vlq == 0 {
                return VLQ { bytes, len };
            }
            iter += 1;
        }

        VLQ { bytes, len: 0 }
    }

    #[derive(Copy, Clone, Default)]
    pub struct VLQResult {
        pub value: i32,
        pub start: usize,
    }

    const BASE64: &[u8; 64] = &crate::zig_base64::STANDARD_ALPHABET_CHARS;

    /// Maximum value of a 7-bit integer (Rust has no native u7).
    const U7_MAX: u8 = 127;

    // base64 stores values up to 7 bits
    const BASE64_LUT: [u8; U7_MAX as usize + 1] = {
        let mut bytes = [U7_MAX; U7_MAX as usize + 1];
        let mut i = 0;
        while i < BASE64.len() {
            bytes[BASE64[i] as usize] = i as u8;
            i += 1;
        }
        bytes
    };

    // Shared body for `decode` / `decode_assume_valid` (which differ only by
    // two asserts); const-generic `ASSERT_VALID` is const-folded so codegen
    // matches hand-duplicated bodies.
    // PERF: loop is not unrolled — profile if hot.
    #[inline(always)]
    fn decode_impl<const ASSERT_VALID: bool>(encoded: &[u8], start: usize) -> VLQResult {
        let mut shift: u8 = 0;
        let mut vlq: u32 = 0;

        // hint to the compiler what the maximum value is
        let encoded_ = &encoded[start..][0..(encoded.len() - start).min(VLQ_MAX_IN_BYTES + 1)];

        // inlining helps for the 1 or 2 byte case, hurts a little for larger
        for i in 0..encoded_.len() {
            if ASSERT_VALID {
                debug_assert!(encoded_[i] < U7_MAX); // invalid base64 character
            }
            // mask to 7 bits
            let index = BASE64_LUT[(encoded_[i] & 0x7f) as usize] as u32;
            if ASSERT_VALID {
                debug_assert!(index != U7_MAX as u32); // invalid base64 character
            }

            // decode a byte
            vlq |= (index & 31) << (shift & 31);
            shift += 5;

            // Stop if there's no continuation bit
            if (index & 32) == 0 {
                return VLQResult {
                    start: start + i + 1,
                    value: if (vlq & 1) == 0 {
                        (vlq >> 1) as i32
                    } else {
                        -((vlq >> 1) as i32)
                    },
                };
            }
        }

        // Reached when the input is empty or ends mid-VLQ (the last byte's
        // continuation bit is set with no following byte, or all 8 bytes have
        // it set — both malformed). No value was decoded; return `start`
        // unchanged so callers' no-progress checks treat the truncated
        // mapping as a parse failure instead of silently accepting `value: 0`.
        VLQResult { start, value: 0 }
    }

    #[inline]
    pub fn decode(encoded: &[u8], start: usize) -> VLQResult {
        decode_impl::<false>(encoded, start)
    }

    #[inline]
    pub fn decode_assume_valid(encoded: &[u8], start: usize) -> VLQResult {
        decode_impl::<true>(encoded, start)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encode_decode_roundtrip() {
            for value in [0, 1, -1, 255, 256, -255, -256, i32::MAX, i32::MIN + 1] {
                let encoded = VLQ::encode(value);
                let result = decode(encoded.slice(), 0);
                assert_eq!(result.value, value);
                assert_eq!(result.start, encoded.len as usize);
            }
            assert_eq!(VLQ::encode(i32::MAX).slice(), b"+/////D");
            assert_eq!(VLQ::encode(i32::MIN + 1).slice(), b"//////D");
        }

        #[test]
        fn encode_i32_min_does_not_panic() {
            // i32::MIN is outside the sign-magnitude domain; it wraps to "-0".
            let encoded = VLQ::encode(i32::MIN);
            assert_eq!(decode(encoded.slice(), 0).value, 0);
        }
    }
}

pub mod zig_base64 {
    #[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Error {
        #[error("InvalidCharacter")]
        InvalidCharacter,
        #[error("InvalidPadding")]
        InvalidPadding,
        #[error("NoSpaceLeft")]
        NoSpaceLeft,
    }

    pub(crate) type DecoderWithIgnoreProto = fn(ignore: &[u8]) -> Base64DecoderWithIgnore;

    /// Base64 codecs
    pub struct Codecs {
        pub alphabet_chars: [u8; 64],
        pub pad_char: Option<u8>,
        pub decoder_with_ignore: DecoderWithIgnoreProto,
        pub encoder: Base64Encoder,
        pub decoder: Base64Decoder,
    }

    pub const STANDARD_ALPHABET_CHARS: [u8; 64] =
        *b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub(crate) const fn standard_base64_decoder_with_ignore(
        ignore: &[u8],
    ) -> Base64DecoderWithIgnore {
        Base64DecoderWithIgnore::init(STANDARD_ALPHABET_CHARS, Some(b'='), ignore)
    }

    /// Standard Base64 codecs, with padding
    // Const-initialized `static` (lives in `.rodata`, no `Once`).
    pub static STANDARD: Codecs = Codecs {
        alphabet_chars: STANDARD_ALPHABET_CHARS,
        pad_char: Some(b'='),
        decoder_with_ignore: standard_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(STANDARD_ALPHABET_CHARS, Some(b'=')),
        decoder: Base64Decoder::init(STANDARD_ALPHABET_CHARS, Some(b'=')),
    };

    /// Standard Base64 codecs, without padding
    pub static STANDARD_NO_PAD: Codecs = Codecs {
        alphabet_chars: STANDARD_ALPHABET_CHARS,
        pad_char: None,
        decoder_with_ignore: standard_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(STANDARD_ALPHABET_CHARS, None),
        decoder: Base64Decoder::init(STANDARD_ALPHABET_CHARS, None),
    };

    pub(crate) const URL_SAFE_ALPHABET_CHARS: [u8; 64] =
        *b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    #[derive(Copy, Clone)]
    pub struct Base64Encoder {
        pub alphabet_chars: [u8; 64],
        pub pad_char: Option<u8>,
    }

    impl Base64Encoder {
        /// A bunch of assertions, then simply pass the data right through.
        pub const fn init(alphabet_chars: [u8; 64], pad_char: Option<u8>) -> Base64Encoder {
            let mut char_in_alphabet = [false; 256];
            let mut i = 0;
            while i < 64 {
                let c = alphabet_chars[i];
                debug_assert!(!char_in_alphabet[c as usize]);
                debug_assert!(match pad_char {
                    None => true,
                    Some(p) => c != p,
                });
                char_in_alphabet[c as usize] = true;
                i += 1;
            }
            Base64Encoder {
                alphabet_chars,
                pad_char,
            }
        }

        /// Compute the encoded length
        pub fn calc_size(&self, source_len: usize) -> usize {
            if self.pad_char.is_some() {
                source_len.div_ceil(3) * 4
            } else {
                let leftover = source_len % 3;
                source_len / 3 * 4 + (leftover * 4).div_ceil(3)
            }
        }

        /// dest.len must at least be what you get from ::calc_size.
        pub fn encode<'a>(&self, dest: &'a mut [u8], source: &[u8]) -> &'a [u8] {
            let out_len = self.calc_size(source.len());
            debug_assert!(dest.len() >= out_len);

            let out_idx = self.encode_without_size_check(dest, source);
            if let Some(pad_char) = self.pad_char {
                for pad in &mut dest[out_idx..out_len] {
                    *pad = pad_char;
                }
            }
            &dest[0..out_len]
        }

        pub fn encode_without_size_check(&self, dest: &mut [u8], source: &[u8]) -> usize {
            let mut acc: u16 = 0;
            let mut acc_len: u8 = 0;
            let mut out_idx: usize = 0;
            for &v in source {
                acc = (acc << 8) + (v as u16);
                acc_len += 8;
                while acc_len >= 6 {
                    acc_len -= 6;
                    dest[out_idx] = self.alphabet_chars[((acc >> acc_len) & 0x3F) as usize];
                    out_idx += 1;
                }
            }
            if acc_len > 0 {
                dest[out_idx] = self.alphabet_chars[((acc << (6 - acc_len)) & 0x3F) as usize];
                out_idx += 1;
            }
            out_idx
        }
    }

    #[derive(Clone)]
    pub struct Base64Decoder {
        /// e.g. 'A' => 0.
        /// `INVALID_CHAR` for any value not in the 64 alphabet chars.
        pub char_to_index: [u8; 256],
        pub pad_char: Option<u8>,
    }

    impl Base64Decoder {
        pub const INVALID_CHAR: u8 = 0xFF;

        pub const fn init(alphabet_chars: [u8; 64], pad_char: Option<u8>) -> Base64Decoder {
            let mut result = Base64Decoder {
                char_to_index: [Self::INVALID_CHAR; 256],
                pad_char,
            };

            let mut char_in_alphabet = [false; 256];
            let mut i = 0;
            while i < 64 {
                let c = alphabet_chars[i];
                debug_assert!(!char_in_alphabet[c as usize]);
                debug_assert!(match pad_char {
                    None => true,
                    Some(p) => c != p,
                });

                result.char_to_index[c as usize] = i as u8;
                char_in_alphabet[c as usize] = true;
                i += 1;
            }
            result
        }

        /// Return the maximum possible decoded size for a given input length - The actual length may be less if the input includes padding.
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calc_size_upper_bound(&self, source_len: usize) -> Result<usize, Error> {
            let mut result = source_len / 4 * 3;
            let leftover = source_len % 4;
            if self.pad_char.is_some() {
                if !leftover.is_multiple_of(4) {
                    return Err(Error::InvalidPadding);
                }
            } else {
                if leftover % 4 == 1 {
                    return Err(Error::InvalidPadding);
                }
                result += leftover * 3 / 4;
            }
            Ok(result)
        }

        /// Return the exact decoded size for a slice.
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calc_size_for_slice(&self, source: &[u8]) -> Result<usize, Error> {
            let source_len = source.len();
            let mut result = self.calc_size_upper_bound(source_len)?;
            if let Some(pad_char) = self.pad_char {
                if source_len >= 1 && source[source_len - 1] == pad_char {
                    result -= 1;
                }
                if source_len >= 2 && source[source_len - 2] == pad_char {
                    result -= 1;
                }
            }
            Ok(result)
        }

        /// dest.len must be what you get from ::calc_size.
        /// invalid characters result in Error::InvalidCharacter.
        /// invalid padding results in Error::InvalidPadding.
        #[inline]
        pub fn decode(&self, dest: &mut [u8], source: &[u8]) -> Result<(), Error> {
            if self.pad_char.is_some() && !source.len().is_multiple_of(4) {
                return Err(Error::InvalidPadding);
            }
            let mut acc: u16 = 0;
            let mut acc_len: u8 = 0;
            let mut dest_idx: usize = 0;
            let mut leftover_idx: Option<usize> = None;
            for (src_idx, &c) in source.iter().enumerate() {
                // SAFETY: `c: u8` so `c as usize` is in 0..=255, and `char_to_index` is `[u8; 256]`.
                let d = unsafe { *self.char_to_index.get_unchecked(c as usize) };
                if d == Self::INVALID_CHAR {
                    if self.pad_char.is_none() || c != self.pad_char.unwrap() {
                        return Err(Error::InvalidCharacter);
                    }
                    leftover_idx = Some(src_idx);
                    break;
                }
                acc = (acc << 6) + (d as u16);
                acc_len += 6;
                if acc_len >= 8 {
                    acc_len -= 8;
                    debug_assert!(dest_idx < dest.len());
                    // SAFETY: callers size `dest` via `calc_size_for_slice(source)` (see doc comment),
                    // which yields exactly the number of output bytes this loop produces; `dest_idx`
                    // therefore stays in-bounds for any input that reaches this branch.
                    unsafe { *dest.get_unchecked_mut(dest_idx) = (acc >> acc_len) as u8 };
                    dest_idx += 1;
                }
            }
            if acc_len > 4 || (acc & ((1u16 << acc_len) - 1)) != 0 {
                return Err(Error::InvalidPadding);
            }
            let Some(idx) = leftover_idx else {
                return Ok(());
            };
            let leftover = &source[idx..];
            if let Some(pad_char) = self.pad_char {
                let padding_len = acc_len / 2;
                let mut padding_chars: usize = 0;
                for &c in leftover {
                    if c != pad_char {
                        return if c == Self::INVALID_CHAR {
                            Err(Error::InvalidCharacter)
                        } else {
                            Err(Error::InvalidPadding)
                        };
                    }
                    padding_chars += 1;
                }
                if padding_chars != padding_len as usize {
                    return Err(Error::InvalidPadding);
                }
            }
            Ok(())
        }
    }

    #[derive(Clone)]
    pub struct Base64DecoderWithIgnore {
        pub decoder: Base64Decoder,
        pub char_is_ignored: [bool; 256],
    }

    impl Base64DecoderWithIgnore {
        pub(crate) const fn init(
            alphabet_chars: [u8; 64],
            pad_char: Option<u8>,
            ignore_chars: &[u8],
        ) -> Base64DecoderWithIgnore {
            let mut result = Base64DecoderWithIgnore {
                decoder: Base64Decoder::init(alphabet_chars, pad_char),
                char_is_ignored: [false; 256],
            };
            let mut i = 0;
            while i < ignore_chars.len() {
                let c = ignore_chars[i];
                debug_assert!(
                    result.decoder.char_to_index[c as usize] == Base64Decoder::INVALID_CHAR
                );
                debug_assert!(!result.char_is_ignored[c as usize]);
                debug_assert!(match result.decoder.pad_char {
                    None => true,
                    Some(p) => c != p,
                });
                result.char_is_ignored[c as usize] = true;
                i += 1;
            }
            result
        }

        /// Invalid characters that are not ignored result in Error::InvalidCharacter.
        /// Invalid padding results in Error::InvalidPadding.
        /// Decoding more data than can fit in dest results in Error::NoSpaceLeft. See also ::calc_size_upper_bound.
        /// Returns the number of bytes written to dest.
        pub(crate) fn decode(
            &self,
            dest: &mut [u8],
            source: &[u8],
            wrote: &mut usize,
        ) -> Result<(), Error> {
            let decoder = &self.decoder;
            let mut acc: u16 = 0;
            let mut acc_len: u8 = 0;
            // `*wrote` is mutated directly (rather than once before return)
            // so it is always current on every return path.
            *wrote = 0;
            let mut leftover_idx: Option<usize> = None;

            for (src_idx, &c) in source.iter().enumerate() {
                if self.char_is_ignored[c as usize] {
                    continue;
                }
                let d = decoder.char_to_index[c as usize];
                if d == Base64Decoder::INVALID_CHAR {
                    if let Some(pad_char) = decoder.pad_char {
                        if c == pad_char {
                            leftover_idx = Some(src_idx);
                            break;
                        }
                    }
                    if self.char_is_ignored[Base64Decoder::INVALID_CHAR as usize] {
                        continue;
                    }
                    return Err(Error::InvalidCharacter);
                }
                acc = (acc << 6) + (d as u16);
                acc_len += 6;
                if acc_len >= 8 {
                    if *wrote == dest.len() {
                        return Err(Error::NoSpaceLeft);
                    }
                    acc_len -= 8;
                    dest[*wrote] = (acc >> acc_len) as u8;
                    *wrote += 1;
                }
            }
            if acc_len > 4 || (acc & ((1u16 << acc_len) - 1)) != 0 {
                return Err(Error::InvalidPadding);
            }

            if let Some(pad_char) = decoder.pad_char {
                let padding_len = acc_len / 2;

                if let Some(idx) = leftover_idx {
                    let leftover = &source[idx..];
                    let mut padding_chars: usize = 0;
                    for &c in leftover {
                        if self.char_is_ignored[c as usize] {
                            continue;
                        }
                        if c != pad_char {
                            return if c == Base64Decoder::INVALID_CHAR {
                                Err(Error::InvalidCharacter)
                            } else {
                                Err(Error::InvalidPadding)
                            };
                        }
                        padding_chars += 1;
                    }
                    if padding_chars != padding_len as usize {
                        return Err(Error::InvalidPadding);
                    }
                } else if padding_len > 0 {
                    return Err(Error::InvalidPadding);
                }
            }
            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_base64() {
            let codecs = &STANDARD;

            // STANDARD's `decoder_with_ignore` matches its `pad_char`, so
            // both decoders take the same encoded form.
            test_all_apis(codecs, b"", b"", b"");
            test_all_apis(codecs, b"f", b"Zg==", b"Zg==");
            test_all_apis(codecs, b"fo", b"Zm8=", b"Zm8=");
            test_all_apis(codecs, b"foo", b"Zm9v", b"Zm9v");
            test_all_apis(codecs, b"foob", b"Zm9vYg==", b"Zm9vYg==");
            test_all_apis(codecs, b"fooba", b"Zm9vYmE=", b"Zm9vYmE=");
            test_all_apis(codecs, b"foobar", b"Zm9vYmFy", b"Zm9vYmFy");

            test_decode_ignore_space(codecs, b"", b" ");
            test_decode_ignore_space(codecs, b"f", b"Z g= =");
            test_decode_ignore_space(codecs, b"fo", b"    Zm8=");
            test_decode_ignore_space(codecs, b"foo", b"Zm9v    ");
            test_decode_ignore_space(codecs, b"foob", b"Zm9vYg = = ");
            test_decode_ignore_space(codecs, b"fooba", b"Zm9v YmE=");
            test_decode_ignore_space(codecs, b"foobar", b" Z m 9 v Y m F y ");

            // test getting some api errors
            test_error(
                codecs,
                b"A",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"AA",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"AAA",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"A..A",
                Error::InvalidCharacter,
                Some(Error::InvalidCharacter),
            );
            test_error(
                codecs,
                b"AA=A",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"AA/=",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"A/==",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"A===",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );
            test_error(
                codecs,
                b"====",
                Error::InvalidPadding,
                Some(Error::InvalidPadding),
            );

            test_no_space_left_error(codecs, b"AA==");
            test_no_space_left_error(codecs, b"AAA=");
            test_no_space_left_error(codecs, b"AAAA");
            test_no_space_left_error(codecs, b"AAAAAA==");
        }

        /// `expected_with_ignore` is the input for `Base64DecoderWithIgnore`,
        /// which may differ from `expected_encoded` when the codec's
        /// `decoder_with_ignore` doesn't share its `pad_char` (URL-safe family).
        fn test_all_apis(
            codecs: &Codecs,
            expected_decoded: &[u8],
            expected_encoded: &[u8],
            expected_with_ignore: &[u8],
        ) {
            // Base64Encoder
            {
                let mut buffer = [0u8; 0x100];
                let encoded = codecs.encoder.encode(&mut buffer, expected_decoded);
                assert_eq!(expected_encoded, encoded);
            }

            // Base64Decoder
            {
                let mut buffer = [0u8; 0x100];
                let len = codecs
                    .decoder
                    .calc_size_for_slice(expected_encoded)
                    .unwrap();
                let decoded = &mut buffer[0..len];
                codecs.decoder.decode(decoded, expected_encoded).unwrap();
                assert_eq!(expected_decoded, decoded);
            }

            // Base64DecoderWithIgnore
            {
                let decoder_ignore_nothing = (codecs.decoder_with_ignore)(b"");
                let mut buffer = [0u8; 0x100];
                let decoded = &mut buffer[..];
                let mut written: usize = 0;
                decoder_ignore_nothing
                    .decode(decoded, expected_with_ignore, &mut written)
                    .unwrap();
                assert!(written <= decoded.len());
                assert_eq!(expected_decoded, &decoded[0..written]);
            }
        }

        fn test_decode_ignore_space(codecs: &Codecs, expected_decoded: &[u8], encoded: &[u8]) {
            let decoder_ignore_space = (codecs.decoder_with_ignore)(b" ");
            let mut buffer = [0u8; 0x100];
            let decoded = &mut buffer[..];
            let mut written: usize = 0;
            decoder_ignore_space
                .decode(decoded, encoded, &mut written)
                .unwrap();
            assert_eq!(expected_decoded, &decoded[0..written]);
        }

        /// `expected_with_ignore` is the error `decoder_with_ignore` reports
        /// for the same input, or `None` if it accepts the input. Differs from
        /// `expected_err` when the codec's `decoder_with_ignore` doesn't share
        /// its `pad_char` (URL-safe family).
        fn test_error(
            codecs: &Codecs,
            encoded: &[u8],
            expected_err: Error,
            expected_with_ignore: Option<Error>,
        ) {
            let decoder_ignore_space = (codecs.decoder_with_ignore)(b" ");
            let mut buffer = [0u8; 0x100];
            match codecs.decoder.calc_size_for_slice(encoded) {
                Ok(decoded_size) => {
                    let decoded = &mut buffer[0..decoded_size];
                    match codecs.decoder.decode(decoded, encoded) {
                        Ok(_) => panic!("ExpectedError"),
                        Err(err) => assert_eq!(err, expected_err),
                    }
                }
                Err(err) => assert_eq!(err, expected_err),
            }

            let mut written: usize = 0;
            let result = decoder_ignore_space.decode(&mut buffer[..], encoded, &mut written);
            match expected_with_ignore {
                Some(expected) => assert_eq!(result.unwrap_err(), expected),
                None => assert!(result.is_ok()),
            }
        }

        fn test_no_space_left_error(codecs: &Codecs, encoded: &[u8]) {
            let decoder_ignore_space = (codecs.decoder_with_ignore)(b" ");
            let mut buffer = [0u8; 0x100];
            let size = codecs.decoder.calc_size_for_slice(encoded).unwrap() - 1;
            let decoded = &mut buffer[0..size];
            let mut written: usize = 0;
            match decoder_ignore_space.decode(decoded, encoded, &mut written) {
                Ok(_) => panic!("ExpectedError"),
                Err(err) => assert_eq!(err, Error::NoSpaceLeft),
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LAYERING: hoisted from `bun_css::css_modules::hash` so `bun_bundler` can
// call the *same* implementation without taking a hard dep on `bun_css` (and
// without re-implementing the hash, which would diverge — see review of
// `LinkerContext.rs::css_modules_hash_shim`). `bun_css` re-exports this as
// `css_modules::hash` for its in-crate callers.
//
// Behavior: wyhash(u64) of the formatted args,
// truncated to u32, url-safe-base64-encoded into a bump-allocated slice. If
// `at_start` and the first encoded byte is a digit, prefix `_` (CSS idents
// can't start with a digit).
// ──────────────────────────────────────────────────────────────────────────

// TODO: replace with bun's hash
pub fn wyhash_url_safe<'a>(
    bump: &'a bun_alloc::Arena,
    args: core::fmt::Arguments<'_>,
    at_start: bool,
) -> &'a [u8] {
    use std::io::Write as _;

    let mut hasher = bun_wyhash::Wyhash11::init(0);
    // Write into a scratch Vec then hash; freed immediately.
    let mut fmt_str: Vec<u8> = Vec::with_capacity(128);
    write!(&mut fmt_str, "{}", args).expect("unreachable");
    hasher.update(&fmt_str);

    let h: u32 = hasher.final_() as u32; // @truncate
    let h_bytes: [u8; 4] = h.to_le_bytes();

    let encode_len = simdutf_encode_len_url_safe(h_bytes.len());

    // Always alloc a fresh slice from the arena.
    // PERF: no buffer reuse for large encode_len — profile if hot.
    let slice_to_write: &mut [u8] =
        bump.alloc_slice_fill_default(encode_len + usize::from(at_start));

    let base64_encoded_hash_len = encode_url_safe(slice_to_write, &h_bytes);

    let base64_encoded_hash = &slice_to_write[0..base64_encoded_hash_len];

    if at_start
        && !base64_encoded_hash.is_empty()
        && base64_encoded_hash[0] >= b'0'
        && base64_encoded_hash[0] <= b'9'
    {
        // Overlapping copy, dest > src → copy_within.
        slice_to_write.copy_within(0..base64_encoded_hash_len, 1);
        slice_to_write[0] = b'_';
        return &slice_to_write[0..base64_encoded_hash_len + 1];
    }

    &slice_to_write[0..base64_encoded_hash_len]
}
