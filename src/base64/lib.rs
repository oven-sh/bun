use std::sync::LazyLock;

use bun_simdutf_sys::simdutf::{self, SIMDUTFResult};

// ASCII control codes used in the ignore set below.
const VT: u8 = 0x0B; // std.ascii.control_code.vt
const FF: u8 = 0x0C; // std.ascii.control_code.ff

// TODO(port): Zig evaluates this at comptime; LazyLock is the Phase-A stand-in.
// PERF(port): was comptime init — profile in Phase B (consider const fn once for-in-const stabilizes).
static MIXED_DECODER: LazyLock<zig_base64::Base64DecoderWithIgnore> = LazyLock::new(|| {
    let mut decoder =
        zig_base64::standard_base64_decoder_with_ignore(&[0xFF, b' ', b'\t', b'\r', b'\n', VT, FF]);

    let mut i: usize = 62;
    for &c in &zig_base64::URL_SAFE_ALPHABET_CHARS[62..] {
        decoder.decoder.char_to_index[c as usize] = u8::try_from(i).unwrap();
        i += 1;
    }

    decoder
});

pub fn decode(destination: &mut [u8], source: &[u8]) -> SIMDUTFResult {
    let result = simdutf::base64::decode(source, destination, false);

    if !result.is_successful() {
        // The input does not follow the WHATWG forgiving-base64 specification
        // https://infra.spec.whatwg.org/#forgiving-base64-decode
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/string_bytes.cc#L359
        let mut wrote: usize = 0;
        if MIXED_DECODER.decode(destination, source, &mut wrote).is_err() {
            return SIMDUTFResult {
                count: wrote,
                status: simdutf::Status::INVALID_BASE64_CHARACTER,
            };
        }
        return SIMDUTFResult { count: wrote, status: simdutf::Status::SUCCESS };
    }

    result
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeAllocError {
    #[error("DecodingFailed")]
    DecodingFailed,
}
impl From<DecodeAllocError> for bun_core::Error {
    fn from(e: DecodeAllocError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub fn decode_alloc(input: &[u8]) -> Result<Vec<u8>, DecodeAllocError> {
    // TODO(port): narrow error set
    let mut dest = vec![0u8; decode_len(input)];
    let result = decode(&mut dest, input);
    if !result.is_successful() {
        return Err(DecodeAllocError::DecodingFailed);
    }
    dest.truncate(result.count);
    Ok(dest)
}

pub fn encode(destination: &mut [u8], source: &[u8]) -> usize {
    simdutf::base64::encode(source, destination, false)
}

pub fn encode_alloc(source: &[u8]) -> Vec<u8> { // B-1: was BabyList<u8>
    // TODO(port): narrow error set (Zig was `!bun.ByteList`; OOM now aborts)
    let len = encode_len(source);
    let mut destination = vec![0u8; len];
    let encoded_len = encode(&mut destination, source);
    // PORT NOTE: Zig built ByteList from ptr/len/cap; here Vec already carries cap == len.
    destination.truncate(encoded_len);
    destination
}

pub fn simdutf_encode_len_url_safe(source_len: usize) -> usize {
    simdutf::base64::encode_len(source_len, true)
}

/// Encode with the following differences from regular `encode` function:
///
/// * No padding is added (the extra `=` characters at the end)
/// * `-` and `_` are used instead of `+` and `/`
///
/// See the documentation for simdutf's `binary_to_base64` function for more details (simdutf_impl.h).
pub fn simdutf_encode_url_safe(destination: &mut [u8], source: &[u8]) -> usize {
    simdutf::base64::encode(source, destination, true)
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

pub fn encode_len(source: &[u8]) -> usize {
    encode_len_from_size(source.len())
}

pub fn encode_len_from_size(source: usize) -> usize {
    zig_base64::STANDARD.encoder.calc_size(source)
}

pub fn url_safe_encode_len(source: &[u8]) -> usize {
    // Copied from WebKit
    ((source.len() * 4) + 2) / 3
}

// TODO(port): move to base64_sys
unsafe extern "C" {
    fn WTF__base64URLEncode(
        input: *const u8,
        input_len: usize,
        output: *mut u8,
        output_len: usize,
    ) -> usize;
}

pub fn encode_url_safe(dest: &mut [u8], source: &[u8]) -> usize {
    // TODO(port): bun.jsc.markBinding(@src()) — debug-only binding marker, no Rust equivalent yet
    // SAFETY: WTF__base64URLEncode reads `input_len` bytes from `input` and writes at most
    // `output_len` bytes to `output`; both slices are valid for those lengths.
    unsafe { WTF__base64URLEncode(source.as_ptr(), source.len(), dest.as_mut_ptr(), dest.len()) }
}

// ──────────────────────────────────────────────────────────────────────────
// VLQ — MOVE_DOWN from bun_sourcemap (CYCLEBREAK: crash_handler → bun_base64::VLQ).
// Ground truth: src/sourcemap/VLQ.zig. Lives here because the encoding is pure
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
        /// This is a u8 and not a u4 because non^2 integers are really slow in Zig.
        pub len: u8,
    }

    impl Default for VLQ {
        fn default() -> Self {
            Self { bytes: [0; VLQ_MAX_IN_BYTES], len: 0 }
        }
    }

    pub const VLQ_MAX_IN_BYTES: usize = 7;

    impl VLQ {
        #[inline]
        pub fn slice(&self) -> &[u8] {
            &self.bytes[0..self.len as usize]
        }

        // TODO(port): Zig took `writer: anytype`. `std::io::Write` is the Phase-A
        // byte-sink trait but is itself slated to MOVE_DOWN into bun_core
        // (CYCLEBREAK MOVE_DOWN list). Re-point this bound once that lands so
        // base64 stays a tier-0 leaf with no bun_io dep.
        pub fn write_to(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
            writer.write_all(&self.bytes[0..self.len as usize])?;
            Ok(())
        }

        pub const ZERO: VLQ = VLQ_LOOKUP_TABLE[0];

        #[inline]
        pub fn encode(value: i32) -> VLQ {
            if value >= 0 && value <= 255 {
                VLQ_LOOKUP_TABLE[value as usize]
            } else {
                encode_slow_path(value)
            }
        }
    }

    // Module-level alias so `bun_base64::vlq::encode(..)` mirrors the Zig file-scope fn.
    #[inline]
    pub fn encode(value: i32) -> VLQ {
        VLQ::encode(value)
    }

    // PERF(port): was comptime-evaluated table in Zig — Rust const-eval matches.
    const VLQ_LOOKUP_TABLE: [VLQ; 256] = {
        let mut entries = [VLQ { bytes: [0; VLQ_MAX_IN_BYTES], len: 0 }; 256];
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

        let mut vlq: u32 = if value >= 0 {
            (value << 1) as u32
        } else {
            ((-value << 1) | 1) as u32
        };

        // source mappings are limited to i32
        // PERF(port): was `inline for` (unrolled) — profile in Phase B
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

    const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// `std.math.maxInt(u7)` — Rust has no native u7.
    const U7_MAX: u8 = 127;

    // base64 stores values up to 7 bits
    const BASE64_LUT: [u8; U7_MAX as usize] = {
        let mut bytes = [U7_MAX; U7_MAX as usize];
        let mut i = 0;
        while i < BASE64.len() {
            bytes[BASE64[i] as usize] = i as u8;
            i += 1;
        }
        bytes
    };

    pub fn decode(encoded: &[u8], start: usize) -> VLQResult {
        let mut shift: u8 = 0;
        let mut vlq: u32 = 0;

        // hint to the compiler what the maximum value is
        let encoded_ = &encoded[start..][0..(encoded.len() - start).min(VLQ_MAX_IN_BYTES + 1)];

        // inlining helps for the 1 or 2 byte case, hurts a little for larger
        // PERF(port): was `inline for` (unrolled) — profile in Phase B
        for i in 0..(VLQ_MAX_IN_BYTES + 1) {
            // `@as(u7, @truncate(...))` → mask to 7 bits
            let index = BASE64_LUT[(encoded_[i] & 0x7f) as usize] as u32;

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

        VLQResult { start: start + encoded_.len(), value: 0 }
    }

    pub fn decode_assume_valid(encoded: &[u8], start: usize) -> VLQResult {
        let mut shift: u8 = 0;
        let mut vlq: u32 = 0;

        // hint to the compiler what the maximum value is
        let encoded_ = &encoded[start..][0..(encoded.len() - start).min(VLQ_MAX_IN_BYTES + 1)];

        // inlining helps for the 1 or 2 byte case, hurts a little for larger
        // PERF(port): was `inline for` (unrolled) — profile in Phase B
        for i in 0..(VLQ_MAX_IN_BYTES + 1) {
            debug_assert!(encoded_[i] < U7_MAX); // invalid base64 character
            // `@as(u7, @truncate(...))` → mask to 7 bits
            let index = BASE64_LUT[(encoded_[i] & 0x7f) as usize] as u32;
            debug_assert!(index != U7_MAX as u32); // invalid base64 character

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

        VLQResult { start: start + encoded_.len(), value: 0 }
    }
}

pub mod zig_base64 {
    use std::sync::LazyLock;

    #[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Error {
        #[error("InvalidCharacter")]
        InvalidCharacter,
        #[error("InvalidPadding")]
        InvalidPadding,
        #[error("NoSpaceLeft")]
        NoSpaceLeft,
    }
    impl From<Error> for bun_core::Error {
        fn from(e: Error) -> Self {
            bun_core::Error::from_name(<&'static str>::from(e))
        }
    }

    pub type DecoderWithIgnoreProto = fn(ignore: &[u8]) -> Base64DecoderWithIgnore;

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

    pub fn standard_base64_decoder_with_ignore(ignore: &[u8]) -> Base64DecoderWithIgnore {
        Base64DecoderWithIgnore::init(STANDARD_ALPHABET_CHARS, Some(b'='), ignore)
    }

    /// Standard Base64 codecs, with padding
    // PERF(port): was comptime-evaluated in Zig — LazyLock in Phase A.
    pub static STANDARD: LazyLock<Codecs> = LazyLock::new(|| Codecs {
        alphabet_chars: STANDARD_ALPHABET_CHARS,
        pad_char: Some(b'='),
        decoder_with_ignore: standard_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(STANDARD_ALPHABET_CHARS, Some(b'=')),
        decoder: Base64Decoder::init(STANDARD_ALPHABET_CHARS, Some(b'=')),
    });

    /// Standard Base64 codecs, without padding
    pub static STANDARD_NO_PAD: LazyLock<Codecs> = LazyLock::new(|| Codecs {
        alphabet_chars: STANDARD_ALPHABET_CHARS,
        pad_char: None,
        decoder_with_ignore: standard_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(STANDARD_ALPHABET_CHARS, None),
        decoder: Base64Decoder::init(STANDARD_ALPHABET_CHARS, None),
    });

    pub const URL_SAFE_ALPHABET_CHARS: [u8; 64] =
        *b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub fn url_safe_base64_decoder_with_ignore(ignore: &[u8]) -> Base64DecoderWithIgnore {
        Base64DecoderWithIgnore::init(URL_SAFE_ALPHABET_CHARS, Some(b'='), ignore)
    }

    /// URL-safe Base64 codecs, with padding
    pub static URL_SAFE: LazyLock<Codecs> = LazyLock::new(|| Codecs {
        alphabet_chars: URL_SAFE_ALPHABET_CHARS,
        pad_char: Some(b'='),
        decoder_with_ignore: url_safe_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(URL_SAFE_ALPHABET_CHARS, Some(b'=')),
        decoder: Base64Decoder::init(URL_SAFE_ALPHABET_CHARS, Some(b'=')),
    });

    /// URL-safe Base64 codecs, without padding
    pub static URL_SAFE_NO_PAD: LazyLock<Codecs> = LazyLock::new(|| Codecs {
        alphabet_chars: URL_SAFE_ALPHABET_CHARS,
        pad_char: None,
        decoder_with_ignore: url_safe_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(URL_SAFE_ALPHABET_CHARS, None),
        decoder: Base64Decoder::init(URL_SAFE_ALPHABET_CHARS, None),
    });

    // PORT NOTE: dropped `standard_pad_char`/`standard_encoder`/`standard_decoder`
    // @compileError deprecation stubs — no Rust equivalent for use-site compile errors.

    #[derive(Clone)]
    pub struct Base64Encoder {
        pub alphabet_chars: [u8; 64],
        pub pad_char: Option<u8>,
    }

    impl Base64Encoder {
        /// A bunch of assertions, then simply pass the data right through.
        pub fn init(alphabet_chars: [u8; 64], pad_char: Option<u8>) -> Base64Encoder {
            debug_assert!(alphabet_chars.len() == 64);
            let mut char_in_alphabet = [false; 256];
            for &c in &alphabet_chars {
                debug_assert!(!char_in_alphabet[c as usize]);
                debug_assert!(pad_char.is_none() || c != pad_char.unwrap());
                char_in_alphabet[c as usize] = true;
            }
            Base64Encoder { alphabet_chars, pad_char }
        }

        /// Compute the encoded length
        /// Note: this is wrong for base64url encoding. Do not use it for that.
        pub fn calc_size(&self, source_len: usize) -> usize {
            if self.pad_char.is_some() {
                (source_len + 2) / 3 * 4
            } else {
                let leftover = source_len % 3;
                source_len / 3 * 4 + (leftover * 4 + 2) / 3
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
            // PORT NOTE: Zig used u12/u4; Rust uses u16/u8 with explicit masking.
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

        pub fn init(alphabet_chars: [u8; 64], pad_char: Option<u8>) -> Base64Decoder {
            let mut result = Base64Decoder {
                char_to_index: [Self::INVALID_CHAR; 256],
                pad_char,
            };

            let mut char_in_alphabet = [false; 256];
            for (i, &c) in alphabet_chars.iter().enumerate() {
                debug_assert!(!char_in_alphabet[c as usize]);
                debug_assert!(pad_char.is_none() || c != pad_char.unwrap());

                result.char_to_index[c as usize] = u8::try_from(i).unwrap();
                char_in_alphabet[c as usize] = true;
            }
            result
        }

        /// Return the maximum possible decoded size for a given input length - The actual length may be less if the input includes padding.
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calc_size_upper_bound(&self, source_len: usize) -> Result<usize, Error> {
            let mut result = source_len / 4 * 3;
            let leftover = source_len % 4;
            if self.pad_char.is_some() {
                if leftover % 4 != 0 {
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
        pub fn decode(&self, dest: &mut [u8], source: &[u8]) -> Result<(), Error> {
            if self.pad_char.is_some() && source.len() % 4 != 0 {
                return Err(Error::InvalidPadding);
            }
            // PORT NOTE: Zig used u12/u4; Rust uses u16/u8 with explicit masking.
            let mut acc: u16 = 0;
            let mut acc_len: u8 = 0;
            let mut dest_idx: usize = 0;
            let mut leftover_idx: Option<usize> = None;
            for (src_idx, &c) in source.iter().enumerate() {
                let d = self.char_to_index[c as usize];
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
                    dest[dest_idx] = (acc >> acc_len) as u8;
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
        pub fn init(
            alphabet_chars: [u8; 64],
            pad_char: Option<u8>,
            ignore_chars: &[u8],
        ) -> Base64DecoderWithIgnore {
            let mut result = Base64DecoderWithIgnore {
                decoder: Base64Decoder::init(alphabet_chars, pad_char),
                char_is_ignored: [false; 256],
            };
            for &c in ignore_chars {
                debug_assert!(result.decoder.char_to_index[c as usize] == Base64Decoder::INVALID_CHAR);
                debug_assert!(!result.char_is_ignored[c as usize]);
                debug_assert!(result.decoder.pad_char != Some(c));
                result.char_is_ignored[c as usize] = true;
            }
            result
        }

        /// Return the maximum possible decoded size for a given input length - The actual length may be less if the input includes padding
        /// `InvalidPadding` is returned if the input length is not valid.
        pub fn calc_size_upper_bound(&self, source_len: usize) -> usize {
            let mut result = source_len / 4 * 3;
            if self.decoder.pad_char.is_none() {
                let leftover = source_len % 4;
                result += leftover * 3 / 4;
            }
            result
        }

        /// Invalid characters that are not ignored result in Error::InvalidCharacter.
        /// Invalid padding results in Error::InvalidPadding.
        /// Decoding more data than can fit in dest results in Error::NoSpaceLeft. See also ::calc_size_upper_bound.
        /// Returns the number of bytes written to dest.
        pub fn decode(
            &self,
            dest: &mut [u8],
            source: &[u8],
            wrote: &mut usize,
        ) -> Result<(), Error> {
            let decoder = &self.decoder;
            // PORT NOTE: Zig used u12/u4; Rust uses u16/u8 with explicit masking.
            let mut acc: u16 = 0;
            let mut acc_len: u8 = 0;
            // PORT NOTE: reshaped `defer { wrote.* = dest_idx; }` into direct mutation
            // of `*wrote` so it is always current on every return path.
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
            let codecs = &*STANDARD;

            test_all_apis(codecs, b"", b"");
            test_all_apis(codecs, b"f", b"Zg==");
            test_all_apis(codecs, b"fo", b"Zm8=");
            test_all_apis(codecs, b"foo", b"Zm9v");
            test_all_apis(codecs, b"foob", b"Zm9vYg==");
            test_all_apis(codecs, b"fooba", b"Zm9vYmE=");
            test_all_apis(codecs, b"foobar", b"Zm9vYmFy");

            test_decode_ignore_space(codecs, b"", b" ");
            test_decode_ignore_space(codecs, b"f", b"Z g= =");
            test_decode_ignore_space(codecs, b"fo", b"    Zm8=");
            test_decode_ignore_space(codecs, b"foo", b"Zm9v    ");
            test_decode_ignore_space(codecs, b"foob", b"Zm9vYg = = ");
            test_decode_ignore_space(codecs, b"fooba", b"Zm9v YmE=");
            test_decode_ignore_space(codecs, b"foobar", b" Z m 9 v Y m F y ");

            // test getting some api errors
            test_error(codecs, b"A", Error::InvalidPadding);
            test_error(codecs, b"AA", Error::InvalidPadding);
            test_error(codecs, b"AAA", Error::InvalidPadding);
            test_error(codecs, b"A..A", Error::InvalidCharacter);
            test_error(codecs, b"AA=A", Error::InvalidPadding);
            test_error(codecs, b"AA/=", Error::InvalidPadding);
            test_error(codecs, b"A/==", Error::InvalidPadding);
            test_error(codecs, b"A===", Error::InvalidPadding);
            test_error(codecs, b"====", Error::InvalidPadding);

            test_no_space_left_error(codecs, b"AA==");
            test_no_space_left_error(codecs, b"AAA=");
            test_no_space_left_error(codecs, b"AAAA");
            test_no_space_left_error(codecs, b"AAAAAA==");
        }

        #[test]
        fn test_base64_url_safe_no_pad() {
            let codecs = &*URL_SAFE_NO_PAD;

            test_all_apis(codecs, b"", b"");
            test_all_apis(codecs, b"f", b"Zg");
            test_all_apis(codecs, b"fo", b"Zm8");
            test_all_apis(codecs, b"foo", b"Zm9v");
            test_all_apis(codecs, b"foob", b"Zm9vYg");
            test_all_apis(codecs, b"fooba", b"Zm9vYmE");
            test_all_apis(codecs, b"foobar", b"Zm9vYmFy");

            test_decode_ignore_space(codecs, b"", b" ");
            test_decode_ignore_space(codecs, b"f", b"Z g ");
            test_decode_ignore_space(codecs, b"fo", b"    Zm8");
            test_decode_ignore_space(codecs, b"foo", b"Zm9v    ");
            test_decode_ignore_space(codecs, b"foob", b"Zm9vYg   ");
            test_decode_ignore_space(codecs, b"fooba", b"Zm9v YmE");
            test_decode_ignore_space(codecs, b"foobar", b" Z m 9 v Y m F y ");

            // test getting some api errors
            test_error(codecs, b"A", Error::InvalidPadding);
            test_error(codecs, b"AAA=", Error::InvalidCharacter);
            test_error(codecs, b"A..A", Error::InvalidCharacter);
            test_error(codecs, b"AA=A", Error::InvalidCharacter);
            test_error(codecs, b"AA/=", Error::InvalidCharacter);
            test_error(codecs, b"A/==", Error::InvalidCharacter);
            test_error(codecs, b"A===", Error::InvalidCharacter);
            test_error(codecs, b"====", Error::InvalidCharacter);

            test_no_space_left_error(codecs, b"AA");
            test_no_space_left_error(codecs, b"AAA");
            test_no_space_left_error(codecs, b"AAAA");
            test_no_space_left_error(codecs, b"AAAAAA");
        }

        fn test_all_apis(codecs: &Codecs, expected_decoded: &[u8], expected_encoded: &[u8]) {
            // Base64Encoder
            {
                let mut buffer = [0u8; 0x100];
                let encoded = codecs.encoder.encode(&mut buffer, expected_decoded);
                assert_eq!(expected_encoded, encoded);
            }

            // Base64Decoder
            {
                let mut buffer = [0u8; 0x100];
                let len = codecs.decoder.calc_size_for_slice(expected_encoded).unwrap();
                let decoded = &mut buffer[0..len];
                codecs.decoder.decode(decoded, expected_encoded).unwrap();
                assert_eq!(expected_decoded, decoded);
            }

            // Base64DecoderWithIgnore
            {
                let decoder_ignore_nothing = (codecs.decoder_with_ignore)(b"");
                let mut buffer = [0u8; 0x100];
                let upper = decoder_ignore_nothing.calc_size_upper_bound(expected_encoded.len());
                let decoded = &mut buffer[0..upper];
                let mut written: usize = 0;
                decoder_ignore_nothing
                    .decode(decoded, expected_encoded, &mut written)
                    .unwrap();
                assert!(written <= decoded.len());
                assert_eq!(expected_decoded, &decoded[0..written]);
            }
        }

        fn test_decode_ignore_space(codecs: &Codecs, expected_decoded: &[u8], encoded: &[u8]) {
            let decoder_ignore_space = (codecs.decoder_with_ignore)(b" ");
            let mut buffer = [0u8; 0x100];
            let upper = decoder_ignore_space.calc_size_upper_bound(encoded.len());
            let decoded = &mut buffer[0..upper];
            let mut written: usize = 0;
            decoder_ignore_space.decode(decoded, encoded, &mut written).unwrap();
            assert_eq!(expected_decoded, &decoded[0..written]);
        }

        fn test_error(codecs: &Codecs, encoded: &[u8], expected_err: Error) {
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
            match decoder_ignore_space.decode(&mut buffer[..], encoded, &mut written) {
                Ok(_) => panic!("ExpectedError"),
                Err(err) => assert_eq!(err, expected_err),
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
// PORT STATUS
//   source:     src/base64/base64.zig (558 lines)
//   confidence: medium
//   todos:      5
//   notes:      comptime Codecs/mixed_decoder use LazyLock; SIMDUTFResult/BabyList field/ctor names guessed; defer-write reshaped to direct *wrote mutation
// ──────────────────────────────────────────────────────────────────────────
