//! Variable-length quantity encoding, limited to i32 as per source map spec.
//! https://en.wikipedia.org/wiki/Variable-length_quantity
//! https://sourcemaps.info/spec.html

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

impl VLQ {
    #[inline]
    pub fn slice(&self) -> &[u8] {
        &self.bytes[0..self.len as usize]
    }

    pub fn write_to(self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write_all(&self.bytes[0..self.len as usize])?;
        Ok(())
    }

    pub const ZERO: VLQ = VLQ_LOOKUP_TABLE[0];
}

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

const VLQ_MAX_IN_BYTES: usize = 7;

pub fn encode(value: i32) -> VLQ {
    if value >= 0 && value <= 255 {
        VLQ_LOOKUP_TABLE[usize::try_from(value).unwrap()]
    } else {
        encode_slow_path(value)
    }
}

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
    let mut _iter = 0;
    while _iter < VLQ_MAX_IN_BYTES {
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
        _iter += 1;
    }

    VLQ { bytes, len: 0 }
}

#[derive(Copy, Clone, Default)]
pub struct VLQResult {
    pub value: i32,
    pub start: usize,
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 stores values up to 7 bits
const BASE64_LUT: [u8; u7::MAX as usize] = {
    let mut bytes = [u7::MAX; u7::MAX as usize];

    let mut i = 0;
    while i < BASE64.len() {
        bytes[BASE64[i] as usize] = i as u8;
        i += 1;
    }

    bytes
};

// Zig's `std.math.maxInt(u7)` — Rust has no native u7.
#[allow(non_camel_case_types)]
struct u7;
impl u7 {
    const MAX: u8 = 127;
}

pub fn decode(encoded: &[u8], start: usize) -> VLQResult {
    let mut shift: u8 = 0;
    let mut vlq: u32 = 0;

    // hint to the compiler what the maximum value is
    let encoded_ = &encoded[start..][0..(encoded.len() - start).min(VLQ_MAX_IN_BYTES + 1)];

    // inlining helps for the 1 or 2 byte case, hurts a little for larger
    // PERF(port): was `inline for` (unrolled) — profile in Phase B
    for i in 0..(VLQ_MAX_IN_BYTES + 1) {
        let index = BASE64_LUT[(encoded_[i] & 0x7f) as usize] as u32;

        // decode a byte
        vlq |= (index & 31) << (shift & 31);
        shift += 5;

        // Stop if there's no continuation bit
        if (index & 32) == 0 {
            return VLQResult {
                start: start + i + 1,
                value: if (vlq & 1) == 0 {
                    i32::try_from(vlq >> 1).unwrap()
                } else {
                    -i32::try_from(vlq >> 1).unwrap()
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
        debug_assert!(encoded_[i] < u7::MAX); // invalid base64 character
        let index = BASE64_LUT[(encoded_[i] & 0x7f) as usize] as u32;
        debug_assert!(index != u7::MAX as u32); // invalid base64 character

        // decode a byte
        vlq |= (index & 31) << (shift & 31);
        shift += 5;

        // Stop if there's no continuation bit
        if (index & 32) == 0 {
            return VLQResult {
                start: start + i + 1,
                value: if (vlq & 1) == 0 {
                    i32::try_from(vlq >> 1).unwrap()
                } else {
                    -i32::try_from(vlq >> 1).unwrap()
                },
            };
        }
    }

    VLQResult { start: start + encoded_.len(), value: 0 }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/VLQ.zig (168 lines)
//   confidence: high
//   todos:      1
//   notes:      const-fn lookup tables; `inline for` lowered to runtime loops (PERF tagged); write_to uses bun_io::Write
// ──────────────────────────────────────────────────────────────────────────
