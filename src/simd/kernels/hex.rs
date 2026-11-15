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
        let rest = &src[dst.len()..];
        dst.append(|dst| {
            dst.fill_chunks(rest, |_, &[[high, low]]| {
                Some([nibble(high)? << 4 | nibble(low)?])
            })
        });
        dst.finish()
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{I16, U8, U16};

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

        /// Above 15 for a byte that is no digit.
        fn nibbles(c: U8) -> U8 {
            let digit = (c + (0xFF - b'9')).saturating_sub(6) - 0xF0;
            let letter = ((c & 0xDF) - b'A').saturating_add(10);
            digit.simd_min(letter)
        }

        pub fn decode<'a>(src: &[[u8; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
            dst.fill_chunks(src, |_, from: &[_; U8::LEN]| {
                let (a, b) = from.as_flattened().split_at(U8::LEN);
                let (a, b) = (nibbles(U8::from_slice(a)), nibbles(U8::from_slice(b)));
                if (a | b).simd_gt(15).any() {
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
            })
        }
    }
}
