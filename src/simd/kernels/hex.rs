//! Ports of highway_strings.cpp: hexadecimal.
use bun_simd::{Isa, Source};
use core::sync::atomic::AtomicU8;

const DIGITS: [u8; 16] = *b"0123456789abcdef";

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::U8;

    #[export]
    pub fn encode_hex_lower(src: &[u8], dst: &mut [u8]) {
        encode_hex(src, dst)
    }

    #[export]
    pub fn encode_hex_lower_shared(src: &[AtomicU8], dst: &mut [u8]) {
        encode_hex(src, dst)
    }

    #[inline(always)]
    fn encode_hex<T: Source<Lane = u8>>(src: &[T], dst: &mut [u8]) {
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
        let mut out = if len >= U8::LEN {
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
        use isa::{I16, U8, U16};

        pub fn encode_hex_vectors<T: Source<Lane = u8>>(src: &[T], dst: &mut [[u8; 2]]) -> bool {
            let digits = U8::repeat_16(DIGITS);
            let encode = |from: &[T; U8::LEN], to: &mut [[u8; 2]; U8::LEN]| {
                let v = U8::load(from);
                U8::store_interleaved2([digits.lookup(v >> 4), digits.lookup(v & 0x0F)], to);
            };
            let Some((_, last)) = src.split_last_chunk() else {
                return false;
            };
            for (from, to) in src[..src.len() - 1]
                .as_chunks()
                .0
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
            let digit = (c + (0xFF - b'9')).saturating_sub(6) - 0xF0;
            let letter = ((c & 0xDF) - b'A').saturating_add(10);
            digit.simd_min(letter)
        }

        #[inline(always)]
        fn decode_block(from: &[[u8; 2]; U8::LEN], to: &mut [u8; U8::LEN]) -> bool {
            let from = from.as_flattened();
            let (a, b) = (
                nibbles(U8::from_slice(from)),
                nibbles(U8::from_slice(&from[U8::LEN..])),
            );
            if (a | b).simd_gt(15).any() {
                return false;
            }
            if !isa::Isa::HAS_INTERLEAVED_MEMORY {
                let weights = U16::splat(0x0110).bitcast();
                let join = |v| I16::saturating_pairwise_dot(v, weights);
                U8::saturating_narrow(join(a), join(b)).store(to);
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
                out += U8::LEN;
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
