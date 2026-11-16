//! Ports of highway_strings.cpp: hexadecimal.
use bun_simd::{Isa, Out, SharedOutU8, SharedU8, SharedWriter, Sink, Source};

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, I16, U8, U16};

    fn digits(v: U8) -> [U8; 2] {
        let digits = U8::repeat_16(*b"0123456789abcdef");
        [digits.lookup(v >> 4), digits.lookup(v & 0x0F)]
    }

    #[inline(always)]
    fn encode<'a, S: Source<Lane = u8>>(src: &[S], dst: Out<'a, u8>) -> &'a mut [u8] {
        let len = src.len().min(dst.len() / 2);
        if len >= U8::LEN {
            let encode = |_, from: &_| Some(U8::to_interleaved2(digits(U8::load(from))));
            return dst
                .into_chunks()
                .fill_chunks(src, encode)
                .as_flattened_mut();
        }
        let [v] = U8::load_or_zero(&src[..len]);
        let [high, low] = digits(v);
        let ((mut next, second), mut dst) = (high.interleave(low), dst.take(2 * len).into_writer());
        if dst.remaining() >= U8::LEN {
            dst.push(next.to_array());
            next = second;
        }
        next.append_partial(&mut dst, 2 * len % U8::LEN);
        dst.finish()
    }

    #[export]
    pub fn encode_hex_lower<'a>(src: &[u8], dst: Out<'a, u8>) -> &'a mut [u8] {
        encode(src, dst)
    }

    #[export]
    pub fn encode_hex_lower_shared<'a>(src: &[SharedU8], dst: Out<'a, u8>) -> &'a mut [u8] {
        encode(src, dst)
    }

    /// The values, and what is negative for a byte that is no digit.
    fn nibbles(digits: U8) -> (U8, I8) {
        // Plus 15, the digits are in the rows 3 and 4, and each case of the letters starts a row.
        const TO_VALUE: [i8; 16] = [0, 0, 0, -63, -63, -70, 0, -102, 0, 0, 0, 0, 0, 0, 0, 0];
        const TO_SIGN: [i8; 16] = [
            -16, -32, -48, -63, 55, 42, -112, 10, 112, 0, 0, 0, 0, 0, 0, 0,
        ];
        let moved = digits + 15;
        let add = |by_row: [i8; 16]| {
            moved + U8::repeat_16(by_row.map(i8::cast_unsigned)).lookup(moved >> 4)
        };
        (add(TO_VALUE), add(TO_SIGN).bitcast())
    }

    fn join(a: U8, b: U8) -> U8 {
        if isa::Isa::HAS_INTERLEAVED_MEMORY {
            let (high, low) = a.deinterleave(b);
            return high << 4 | low & 0x0F;
        }
        let weights = U16::splat(0x0110).bitcast();
        let join = |v| I16::saturating_pairwise_dot(v, weights);
        U8::saturating_narrow(join(a), join(b))
    }

    /// `load` returns as many digits as fit, then zeros.
    #[inline(always)]
    fn decode_with<T: Copy>(src: &[[T; 2]], dst: &mut impl Sink, load: impl Fn(&[T]) -> [U8; 2]) {
        let (start, src) = (dst.len(), &src[..src.len().min(dst.remaining())]);
        U8::append_chunks(dst, src, |from| {
            let [first, second] = load(from.as_flattened());
            let ((a, sign_a), (b, sign_b)) = (nibbles(first), nibbles(second));
            (sign_a | sign_b).simd_lt(0).none().then(|| join(a, b))
        });
        if let Some(rest @ [_, ..]) = src.get(dst.len() - start..) {
            let [first, second] = load(rest.as_flattened());
            let ((a, sign_a), (b, sign_b)) = (nibbles(first), nibbles(second));
            let digits = match sign_a.simd_lt(0).first_set() {
                Some(digits) => digits,
                None => U8::LEN + sign_b.simd_lt(0).first_set().unwrap_or(0),
            };
            join(a, b).append_partial(dst, digits / 2);
        }
    }

    #[inline(always)]
    fn decode(src: &[[u8; 2]], dst: &mut impl Sink) {
        decode_with(src, dst, |from| U8::load_or_zero(from));
    }

    #[inline(always)]
    fn decode16(src: &[[u16; 2]], dst: &mut impl Sink) {
        decode_with(src, dst, |from| {
            let [a, b, c, d] = U16::load_or_zero(from);
            [U8::narrow(a, b), U8::narrow(c, d)]
        });
    }

    /// Stops before the first pair with a byte that is no digit.
    #[export]
    pub fn decode_hex<'a>(src: &[[u8; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
        let mut dst = dst.into_writer();
        decode(src, &mut dst);
        dst.finish()
    }

    #[export]
    pub fn decode_hex_to_shared(src: &[[u8; 2]], dst: &[SharedOutU8]) -> usize {
        let mut dst = SharedWriter::new(dst);
        decode(src, &mut dst);
        dst.len()
    }

    /// The same for the low byte of each unit.
    #[export]
    pub fn decode_hex16<'a>(src: &[[u16; 2]], dst: Out<'a, u8>) -> &'a mut [u8] {
        let mut dst = dst.into_writer();
        decode16(src, &mut dst);
        dst.finish()
    }

    #[export]
    pub fn decode_hex16_to_shared(src: &[[u16; 2]], dst: &[SharedOutU8]) -> usize {
        let mut dst = SharedWriter::new(dst);
        decode16(src, &mut dst);
        dst.len()
    }
}
