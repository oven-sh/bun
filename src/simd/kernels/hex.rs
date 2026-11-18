use bun_simd::{Isa, Out, SharedOutU8, SharedU8, SharedWriter, Sink, Source};

pub use simd::{
    decode_hex, decode_hex_to_shared, decode_hex16, decode_hex16_to_shared, encode_hex_lower,
    encode_hex_lower_from_shared,
};

#[bun_simd::foreach_target]
mod simd {
    use isa::{I8, I16, U8, U16};

    fn digits(v: U8) -> [U8; 2] {
        let digits = U8::repeat(*b"0123456789abcdef");
        [digits.lookup(v >> 4), digits.lookup(v & 0x0F)]
    }

    #[inline(always)]
    fn encode<'a, S: Source<Lane = u8>>(from: &[S], to: Out<'a, u8>) -> &'a mut [u8] {
        let len = from.len().min(to.len() / 2);
        if len >= U8::LEN {
            let encode = |_, from: &_| Some(U8::to_interleaved2(digits(U8::load(from))));
            return to
                .into_chunks()
                .fill_chunks(from, encode)
                .as_flattened_mut();
        }
        let [v] = U8::load_or_zero(&from[..len]);
        let [high, low] = digits(v);
        let ((mut next, second), mut to) = (high.interleave(low), to.take(2 * len).into_writer());
        if to.remaining() >= U8::LEN {
            to.push(next.to_array());
            next = second;
        }
        next.append_partial(&mut to, 2 * len % U8::LEN);
        to.finish()
    }

    #[export]
    pub fn encode_hex_lower<'a>(from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        encode(from, to)
    }

    #[export]
    pub fn encode_hex_lower_from_shared<'a>(from: &[SharedU8], to: Out<'a, u8>) -> &'a mut [u8] {
        encode(from, to)
    }

    /// The values, and what is negative for a byte that is no digit.
    fn nibbles(digits: U8) -> (U8, I8) {
        // Plus 15, the digits are in the rows 3 and 4, and each case of the letters starts a row.
        const TO_VALUE: [i8; 16] = [0, 0, 0, -63, -63, -70, 0, -102, 0, 0, 0, 0, 0, 0, 0, 0];
        const TO_SIGN: [i8; 16] = [
            -16, -32, -48, -63, 55, 42, -112, 10, 112, 0, 0, 0, 0, 0, 0, 0,
        ];
        let moved = digits + 15;
        let add =
            |by_row: [i8; 16]| moved + U8::repeat(by_row.map(i8::cast_unsigned)).lookup(moved >> 4);
        (add(TO_VALUE), add(TO_SIGN).bitcast())
    }

    fn join(a: U8, b: U8) -> U8 {
        if isa::Isa::HAS_INTERLEAVED_MEMORY {
            let (high, low) = a.deinterleave(b);
            return high << 4 | low & 0x0F;
        }
        let weights = I8::repeat([16, 1]);
        let join = |v| I16::saturating_pairwise_dot(v, weights);
        U8::saturating_narrow(join(a), join(b))
    }

    /// `load` returns as many digits as fit, then zeros.
    #[inline(always)]
    fn decode_with<T: Copy>(from: &[[T; 2]], to: &mut impl Sink, load: impl Fn(&[T]) -> [U8; 2]) {
        let (start, from) = (to.len(), &from[..from.len().min(to.remaining())]);
        U8::append_chunks(from, to, |from| {
            let [first, second] = load(from.as_flattened());
            let ((a, sign_a), (b, sign_b)) = (nibbles(first), nibbles(second));
            (sign_a | sign_b).simd_lt(0).none().then(|| join(a, b))
        });
        if let Some(rest @ [_, ..]) = from.get(to.len() - start..) {
            let [first, second] = load(rest.as_flattened());
            let ((a, sign_a), (b, sign_b)) = (nibbles(first), nibbles(second));
            let digits = match sign_a.simd_lt(0).first_set() {
                Some(digits) => digits,
                None => U8::LEN + sign_b.simd_lt(0).first_set().unwrap_or(0),
            };
            join(a, b).append_partial(to, digits / 2);
        }
    }

    #[inline(always)]
    fn decode(from: &[[u8; 2]], to: &mut impl Sink) {
        decode_with(from, to, |from| U8::load_or_zero(from));
    }

    #[inline(always)]
    fn decode16(from: &[[u16; 2]], to: &mut impl Sink) {
        decode_with(from, to, |from| {
            let [a, b, c, d] = U16::load_or_zero(from);
            [U8::narrow(a, b), U8::narrow(c, d)]
        });
    }

    /// Stops before the first pair with a byte that is no digit.
    #[export]
    pub fn decode_hex<'a>(from: &[[u8; 2]], to: Out<'a, u8>) -> &'a mut [u8] {
        let mut to = to.into_writer();
        decode(from, &mut to);
        to.finish()
    }

    #[export]
    pub fn decode_hex_to_shared(from: &[[u8; 2]], to: &[SharedOutU8]) -> usize {
        let mut to = SharedWriter::new(to);
        decode(from, &mut to);
        to.len()
    }

    /// The same for the low byte of each unit.
    #[export]
    pub fn decode_hex16<'a>(from: &[[u16; 2]], to: Out<'a, u8>) -> &'a mut [u8] {
        let mut to = to.into_writer();
        decode16(from, &mut to);
        to.finish()
    }

    #[export]
    pub fn decode_hex16_to_shared(from: &[[u16; 2]], to: &[SharedOutU8]) -> usize {
        let mut to = SharedWriter::new(to);
        decode16(from, &mut to);
        to.len()
    }
}
