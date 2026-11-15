//! Ports of highway_strings.cpp: hexadecimal.
use bun_simd::{Isa, Out, Source};
use core::sync::atomic::AtomicU8;

const DIGITS: [u8; 16] = *b"0123456789abcdef";

#[inline(always)]
fn nibble(digit: u8) -> Option<u8> {
    match digit {
        b'0'..=b'9' => Some(digit & 15),
        b'a'..=b'f' | b'A'..=b'F' => Some((digit & 15) + 9),
        _ => None,
    }
}

#[inline(always)]
fn decode_pair([high, low]: [u8; 2]) -> Option<[u8; 1]> {
    Some([nibble(high)? << 4 | nibble(low)?])
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::U8;

    #[export]
    pub fn encode_hex_lower<'a>(src: &[u8], dst: Out<'a, [u8; 2]>) -> &'a mut [[u8; 2]] {
        encode(src, dst)
    }

    #[export]
    pub fn encode_hex_lower_shared<'a>(
        src: &[AtomicU8],
        dst: Out<'a, [u8; 2]>,
    ) -> &'a mut [[u8; 2]] {
        encode(src, dst)
    }

    #[inline(always)]
    fn encode<'a, S: Source<Lane = u8>>(src: &[S], dst: Out<'a, [u8; 2]>) -> &'a mut [[u8; 2]] {
        let dst = dst.take(src.len());
        if dst.len() >= U8::LEN {
            return width::full::encode(src, dst);
        }
        if dst.len() >= 16 {
            return width::x128::encode(src, dst);
        }
        dst.fill_chunks(src, |_, [byte]| {
            let byte = usize::from(byte.get());
            Some([[DIGITS[byte >> 4], DIGITS[byte & 15]]])
        })
    }

    /// Stops before the first pair with a byte that is no digit.
    #[export]
    pub fn decode_hex<'a>(src: &[[u8; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
        let dst = dst.take(src.len());
        let (is_wide, mut dst) = (dst.len() >= U8::LEN, dst.into_writer());
        dst.append(|dst| match is_wide {
            true => width::full::decode(src, dst),
            false => width::x128::decode(src, dst),
        });
        dst.extend_with(&src[dst.len()..], |&digits| decode_pair(digits));
        dst.finish()
    }

    /// The same for the low byte of each unit.
    #[export]
    pub fn decode_hex16<'a>(src: &[[u16; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
        let dst = dst.take(src.len());
        let (is_wide, mut dst) = (dst.len() >= U8::LEN, dst.into_writer());
        dst.append(|dst| match is_wide {
            true => width::full::decode16(src, dst),
            false => width::x128::decode16(src, dst),
        });
        dst.extend_with(&src[dst.len()..], |&[high, low]| {
            decode_pair([high as u8, low as u8])
        });
        dst.finish()
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{I8, I16, U8, U16};

        pub fn encode<'a, S: Source<Lane = u8>>(
            src: &[S],
            dst: Out<'a, [u8; 2]>,
        ) -> &'a mut [[u8; 2]] {
            let digits = U8::repeat_16(DIGITS);
            dst.fill_chunks(src, |_, from| {
                let v = U8::load(from);
                Some(U8::to_interleaved2([
                    digits.lookup(v >> 4),
                    digits.lookup(v & 0x0F),
                ]))
            })
        }

        /// The values, and what is negative for a byte that is no digit.
        fn nibbles(digits: U8) -> (U8, I8) {
            // Less one, the digits are in the rows 2 and 3, and each case of the letters starts a row.
            const TO_VALUE: [i8; 16] = [0, 0, -47, -47, -54, 0, -86, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            const TO_SIGN: [i8; 16] =
                [-16, -32, -47, 71, 58, -96, 26, -128, 0, 0, 0, 0, 0, 0, 0, 0];
            let less_one = digits - 1;
            let add = |by_row: [i8; 16]| {
                less_one + U8::repeat_16(by_row.map(i8::cast_unsigned)).lookup(less_one >> 4)
            };
            (add(TO_VALUE), add(TO_SIGN).bitcast())
        }

        #[inline(always)]
        fn decode_digits(first: U8, second: U8) -> Option<[u8; U8::LEN]> {
            let ((a, sign_a), (b, sign_b)) = (nibbles(first), nibbles(second));
            if (sign_a | sign_b).simd_lt(0).any() {
                return None;
            }
            let bytes = if isa::Isa::HAS_INTERLEAVED_MEMORY {
                let (high, low) = a.deinterleave(b);
                high << 4 | low
            } else {
                let weights = U16::splat(0x0110).bitcast();
                let join = |v| I16::saturating_pairwise_dot(v, weights);
                U8::saturating_narrow(join(a), join(b))
            };
            Some(bytes.to_array())
        }

        pub fn decode<'a>(src: &[[u8; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
            dst.fill_chunks(src, |_, from: &[_; U8::LEN]| {
                let (first, second) = from.as_flattened().split_at(U8::LEN);
                decode_digits(U8::from_slice(first), U8::from_slice(second))
            })
        }

        pub fn decode16<'a>(src: &[[u16; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
            dst.fill_chunks(src, |_, from: &[_; U8::LEN]| {
                let load = |i: usize| U16::from_slice(&from.as_flattened()[i * U16::LEN..]);
                decode_digits(U8::narrow(load(0), load(1)), U8::narrow(load(2), load(3)))
            })
        }
    }
}
