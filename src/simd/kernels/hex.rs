//! Ports of highway_strings.cpp: hexadecimal.
use core::sync::atomic::AtomicU8;

const DIGITS: [u8; 16] = *b"0123456789abcdef";

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, Unit};

    #[export]
    pub fn encode_hex_lower(src: &[u8], dst: &mut [u8]) {
        encode_hex(src, dst)
    }

    #[export]
    pub fn encode_hex_lower_shared(src: &[AtomicU8], dst: &mut [u8]) {
        encode_hex(src, dst)
    }

    #[inline(always)]
    fn encode_hex<T: Unit<Lane = u8>>(src: &[T], dst: &mut [u8]) {
        let dst = dst.as_chunks_mut().0;
        let len = src.len().min(dst.len());
        let (src, dst) = (&src[..len], &mut dst[..len]);
        if !width::full::encode_hex_vectors(src, dst) && !width::x128::encode_hex_vectors(src, dst)
        {
            for (b, to) in src.iter().map(T::get).zip(dst) {
                *to = [DIGITS[usize::from(b >> 4)], DIGITS[usize::from(b & 15)]];
            }
        }
    }

    #[export]
    pub fn decode_hex(src: &[u8], dst: &mut [u8]) -> usize {
        let src = src.as_chunks().0;
        let len = src.len().min(dst.len());
        let (src, dst) = (&src[..len], &mut dst[..len]);
        let mut out = if len >= U8::LANES {
            width::full::decode_hex(src, dst)
        } else {
            width::x128::decode_hex(src, dst)
        };
        let nibble = |c: u8| match c {
            b'0'..=b'9' => Some(c & 15),
            b'a'..=b'f' | b'A'..=b'F' => Some((c & 15) + 9),
            _ => None,
        };
        for (&[hi, lo], to) in src.iter().zip(dst).skip(out) {
            let (Some(hi), Some(lo)) = (nibble(hi), nibble(lo)) else {
                break;
            };
            *to = hi << 4 | lo;
            out += 1;
        }
        out
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{Chunk, U8, U16, Unit, Units};

        pub fn encode_hex_vectors<T: Unit<Lane = u8>>(src: &[T], dst: &mut [[u8; 2]]) -> bool {
            let digits = U8::table(&DIGITS);
            let encode = |from: &Units<T>, to: &mut [[u8; 2]; U8::LANES]| {
                let v = U8::load(from);
                digits
                    .lookup(v >> 4)
                    .store_interleaved(digits.lookup(v & 0x0F), to);
            };
            let Some((_, last)) = Chunk::split_last(src) else {
                return false;
            };
            for (from, to) in Chunk::chunks(&src[..src.len() - 1])
                .iter()
                .zip(dst.as_chunks_mut().0)
            {
                encode(from, to);
            }
            dst.split_last_chunk_mut()
                .map(|(_, to)| encode(last, to))
                .is_some()
        }

        /// Above 15 for what is no digit.
        fn nibbles(c: U8) -> U8 {
            let digit = (c + (0xFF - b'9')).saturating_sub(U8::splat(6)) - 0xF0;
            let letter = ((c & 0xDF) - b'A').saturating_add(U8::splat(10));
            digit.min(letter)
        }

        #[inline(always)]
        fn decode_block(from: &[[u8; 2]; U8::LANES], to: &mut [u8; U8::LANES]) -> bool {
            let from = from.as_flattened();
            let (a, b) = (
                nibbles(U8::load_from(from)),
                nibbles(U8::load_from(&from[U8::LANES..])),
            );
            if (a | b).gt(15).any() {
                return false;
            }
            if isa::IS_X86 {
                let weights = U16::splat(0x0110).cast();
                a.mul_add_pairs(weights)
                    .demote(b.mul_add_pairs(weights))
                    .store(to);
            } else {
                let (high, low) = a.deinterleave(b);
                (high << 4 | low).store(to);
            }
            true
        }

        /// How far it got. The last vector overlaps.
        pub fn decode_hex(src: &[[u8; 2]], dst: &mut [u8]) -> usize {
            let (Some((_, last)), mut out) = (src.split_last_chunk(), 0) else {
                return 0;
            };
            for (from, to) in src[..src.len() - 1]
                .as_chunks()
                .0
                .iter()
                .zip(dst.as_chunks_mut().0)
            {
                if !decode_block(from, to) {
                    return out;
                }
                out += U8::LANES;
            }
            if dst
                .split_last_chunk_mut()
                .is_some_and(|(_, to)| decode_block(last, to))
            {
                src.len()
            } else {
                out
            }
        }
    }
}
