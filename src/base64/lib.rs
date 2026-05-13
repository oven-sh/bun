#![warn(unreachable_pub)]
use bun_simdutf_sys::simdutf::{self, SIMDUTFResult};

pub use zig_base64::STANDARD_ALPHABET_CHARS;

// ASCII control codes used in the ignore set below.
const VT: u8 = 0x0B; // std.ascii.control_code.vt
const FF: u8 = 0x0C; // std.ascii.control_code.ff

// PORT NOTE: Zig evaluates this at comptime; const-initialized static lands in `.rodata`
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

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeAllocError {
    #[error("DecodingFailed")]
    DecodingFailed,
}
bun_core::named_error_set!(DecodeAllocError);

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

pub use bun_core::base64::encode;

pub fn encode_alloc(source: &[u8]) -> Vec<u8> {
    // B-1: was Vec<u8>
    // TODO(port): narrow error set (Zig was `!bun.Vec<u8>`; OOM now aborts)
    let len = encode_len(source);
    let mut destination = vec![0u8; len];
    let encoded_len = encode(&mut destination, source);
    // PORT NOTE: Zig built Vec<u8> from ptr/len/cap; here Vec already carries cap == len.
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

/// `simdutf_encode_url_safe` into a freshly-allocated `Vec<u8>` sized exactly via
/// `simdutf_encode_len_url_safe` (simdutf computes the exact no-padding length, so
/// the trailing `truncate` is a no-op kept for symmetry with `encode_alloc`).
pub fn simdutf_encode_url_safe_alloc(source: &[u8]) -> Vec<u8> {
    let len = simdutf_encode_len_url_safe(source.len());
    let mut destination = vec![0u8; len];
    let encoded_len = simdutf_encode_url_safe(&mut destination, source);
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
pub const fn url_safe_encode_len_from_size(n: usize) -> usize {
    // Copied from WebKit
    ((n * 4) + 2) / 3
}

#[inline]
pub const fn url_safe_encode_len(source: &[u8]) -> usize {
    url_safe_encode_len_from_size(source.len())
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
// VLQ — moved from bun_sourcemap. Ground truth: src/sourcemap/VLQ.zig.
// Lives here because the encoding is pure
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
            Self {
                bytes: [0; VLQ_MAX_IN_BYTES],
                len: 0,
            }
        }
    }

    pub const VLQ_MAX_IN_BYTES: usize = 7;

    impl VLQ {
        #[inline]
        pub fn slice(&self) -> &[u8] {
            &self.bytes[0..self.len as usize]
        }

        // TODO(port): Zig took `writer: anytype`. `std::io::Write` is the Phase-A
        // byte-sink trait; base64 stays a tier-0 leaf with no bun_io dep.
        pub fn write_to(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
            writer.write_all(&self.bytes[0..self.len as usize])?;
            Ok(())
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

    // Module-level alias so `bun_base64::vlq::encode(..)` mirrors the Zig file-scope fn.
    #[inline]
    pub const fn encode(value: i32) -> VLQ {
        VLQ::encode(value)
    }

    // PERF(port): was comptime-evaluated table in Zig — Rust const-eval matches.
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

    const BASE64: &[u8; 64] = &crate::zig_base64::STANDARD_ALPHABET_CHARS;

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

    // Shared body for `decode` / `decode_assume_valid`. The two .zig originals
    // (src/sourcemap/VLQ.zig:104/135) differ only by two `bun.assert` lines;
    // const-generic `ASSERT_VALID` is const-folded so codegen matches the
    // hand-duplicated bodies.
    // PERF(port): loop was `inline for` (unrolled) — profile in Phase B.
    #[inline(always)]
    fn decode_impl<const ASSERT_VALID: bool>(encoded: &[u8], start: usize) -> VLQResult {
        let mut shift: u8 = 0;
        let mut vlq: u32 = 0;

        // hint to the compiler what the maximum value is
        let encoded_ = &encoded[start..][0..(encoded.len() - start).min(VLQ_MAX_IN_BYTES + 1)];

        // inlining helps for the 1 or 2 byte case, hurts a little for larger
        for i in 0..(VLQ_MAX_IN_BYTES + 1) {
            if ASSERT_VALID {
                debug_assert!(encoded_[i] < U7_MAX); // invalid base64 character
            }
            // `@as(u7, @truncate(...))` → mask to 7 bits
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

        VLQResult {
            start: start + encoded_.len(),
            value: 0,
        }
    }

    #[inline]
    pub fn decode(encoded: &[u8], start: usize) -> VLQResult {
        decode_impl::<false>(encoded, start)
    }

    #[inline]
    pub fn decode_assume_valid(encoded: &[u8], start: usize) -> VLQResult {
        decode_impl::<true>(encoded, start)
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
    bun_core::named_error_set!(Error);

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

    pub const fn standard_base64_decoder_with_ignore(ignore: &[u8]) -> Base64DecoderWithIgnore {
        Base64DecoderWithIgnore::init(STANDARD_ALPHABET_CHARS, Some(b'='), ignore)
    }

    /// Standard Base64 codecs, with padding
    // PORT NOTE: Zig comptime → const-initialized `static` (lives in `.rodata`, no `Once`).
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

    pub const URL_SAFE_ALPHABET_CHARS: [u8; 64] =
        *b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub const fn url_safe_base64_decoder_with_ignore(ignore: &[u8]) -> Base64DecoderWithIgnore {
        Base64DecoderWithIgnore::init(URL_SAFE_ALPHABET_CHARS, Some(b'='), ignore)
    }

    /// URL-safe Base64 codecs, with padding
    pub static URL_SAFE: Codecs = Codecs {
        alphabet_chars: URL_SAFE_ALPHABET_CHARS,
        pad_char: Some(b'='),
        decoder_with_ignore: url_safe_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(URL_SAFE_ALPHABET_CHARS, Some(b'=')),
        decoder: Base64Decoder::init(URL_SAFE_ALPHABET_CHARS, Some(b'=')),
    };

    /// URL-safe Base64 codecs, without padding
    pub static URL_SAFE_NO_PAD: Codecs = Codecs {
        alphabet_chars: URL_SAFE_ALPHABET_CHARS,
        pad_char: None,
        decoder_with_ignore: url_safe_base64_decoder_with_ignore,
        encoder: Base64Encoder::init(URL_SAFE_ALPHABET_CHARS, None),
        decoder: Base64Decoder::init(URL_SAFE_ALPHABET_CHARS, None),
    };

    // PORT NOTE: dropped `standard_pad_char`/`standard_encoder`/`standard_decoder`
    // @compileError deprecation stubs — no Rust equivalent for use-site compile errors.

    #[derive(Clone)]
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
        #[inline]
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
                    // SAFETY: callers size `dest` via `calc_size_for_slice(source)` (see doc comment),
                    // which yields exactly the number of output bytes this loop produces; `dest_idx`
                    // therefore stays in-bounds for any input that reaches this branch.
                    debug_assert!(dest_idx < dest.len());
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
        pub const fn init(
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
            let codecs = &STANDARD;

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
            let codecs = &URL_SAFE_NO_PAD;

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
            decoder_ignore_space
                .decode(decoded, encoded, &mut written)
                .unwrap();
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
// LAYERING: hoisted from `bun_css::css_modules::hash` so `bun_bundler` can
// call the *same* implementation without taking a hard dep on `bun_css` (and
// without re-implementing the hash, which would diverge — see review of
// `LinkerContext.rs::css_modules_hash_shim`). `bun_css` re-exports this as
// `css_modules::hash` for its in-crate callers.
//
// Spec: `src/css/css_modules.zig:hash` — wyhash(u64) of the formatted args,
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

    // PERF(port): was stack-fallback alloc (StackFallbackAllocator 128B) — profile in Phase B
    let mut hasher = bun_wyhash::Wyhash11::init(0);
    // PORT NOTE: std.fmt.count + allocPrint collapsed; write into a scratch
    // Vec then hash. Freed immediately (Zig used stack-fallback for this).
    let mut fmt_str: Vec<u8> = Vec::with_capacity(128);
    write!(&mut fmt_str, "{}", args).expect("unreachable");
    hasher.update(&fmt_str);

    let h: u32 = hasher.final_() as u32; // @truncate
    let h_bytes: [u8; 4] = h.to_le_bytes();

    let encode_len = simdutf_encode_len_url_safe(h_bytes.len());

    // PORT NOTE: Zig reused fmt_str buffer when encode_len > 128 - at_start; arena makes the
    // distinction moot (both arms allocate from bump). Always alloc fresh slice here.
    // PERF(port): was buffer reuse for large encode_len — profile in Phase B
    let slice_to_write: &mut [u8] =
        bump.alloc_slice_fill_default(encode_len + usize::from(at_start));

    let base64_encoded_hash_len = simdutf_encode_url_safe(slice_to_write, &h_bytes);

    let base64_encoded_hash = &slice_to_write[0..base64_encoded_hash_len];

    if at_start
        && !base64_encoded_hash.is_empty()
        && base64_encoded_hash[0] >= b'0'
        && base64_encoded_hash[0] <= b'9'
    {
        // std.mem.copyBackwards: overlapping copy, dest > src → copy_within
        slice_to_write.copy_within(0..base64_encoded_hash_len, 1);
        slice_to_write[0] = b'_';
        return &slice_to_write[0..base64_encoded_hash_len + 1];
    }

    &slice_to_write[0..base64_encoded_hash_len]
}

// ported from: src/base64/base64.zig
