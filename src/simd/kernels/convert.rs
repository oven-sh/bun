//! Ports of highway_strings.cpp: from one buffer to another, or in place.
use bun_simd::{Out, Partial};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, U8, U16, U32, x128};

    #[export]
    pub fn lower_ascii<'a>(from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        U8::map(from, to, |v| v | v.in_range(b'A'..=b'Z').to_vector() & 0x20)
    }

    #[export]
    pub fn lower_ascii16<'a>(from: &[u16], to: Out<'a, u16>) -> &'a mut [u16] {
        U16::map(from, to, |v| {
            v | v.in_range(b'A'.into()..=b'Z'.into()).to_vector() & 0x20
        })
    }

    fn reverse_each<const SIZE: u8>(v: U8) -> U8 {
        v.lookup(U8::iota() & 15 ^ (SIZE - 1))
    }

    #[export]
    pub fn bswap16(words: &mut [[u8; 2]]) {
        U8::map_in_place(words.as_flattened_mut(), |v| reverse_each::<2>(v));
    }

    #[export]
    pub fn bswap32(words: &mut [[u8; 4]]) {
        U8::map_in_place(words.as_flattened_mut(), |v| reverse_each::<4>(v));
    }

    #[export]
    pub fn bswap64(words: &mut [[u8; 8]]) {
        U8::map_in_place(words.as_flattened_mut(), |v| reverse_each::<8>(v));
    }

    #[export]
    pub fn bswap32_shared(bytes: &[AtomicU8]) {
        let words = bytes.as_chunks::<4>().0.as_flattened();
        U8::map_to_shared(words, words, |v| reverse_each::<4>(v));
    }

    /// Writes nothing after it.
    #[export]
    pub fn copy_ascii_prefix<'a>(from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        let is_not_ascii = |v: U8| v.bitcast::<I8>().simd_lt(0).cast::<u8>();
        let mut to = to.take(from.len()).into_writer();
        to.append(|to| {
            to.fill_chunks(from, |_, chunk| {
                let v = U8::load(chunk);
                is_not_ascii(v).none().then_some(v.to_array())
            })
        });
        if to.remaining() > 0 {
            let rest = &from[to.len()..][..to.remaining().min(U8::LEN)];
            let len = U8::position(rest, is_not_ascii).unwrap_or(rest.len());
            to.append(|to| U8::map(&rest[..len], to, |v| v));
        }
        to.finish()
    }

    #[export]
    pub fn copy_u16_to_u8<'a>(input: &[u16], output: Out<'a, u8>) -> &'a mut [u8] {
        let output = output.take(input.len());
        if output.len() >= U8::LEN {
            return width::full::copy_u16_to_u8(input, output);
        }
        if output.len() >= 16 {
            return width::x128::copy_u16_to_u8(input, output);
        }
        let input = &input[..output.len()];
        if let (Some(first), Some((_, last))) = (input.first_chunk(), input.split_last_chunk()) {
            let both = x128::U8::narrow(x128::U16::load(first), x128::U16::load(last)).to_array();
            let [first, last] = *both.as_chunks::<8>().0.as_array().unwrap();
            return output.fill_ends(first, last).unwrap_or_default();
        }
        match x128::U16::load_partial(input) {
            Some(Partial { lanes, .. }) => x128::U8::narrow(lanes, lanes).store_partial(output),
            None => &mut [],
        }
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U16};

        pub fn copy_u16_to_u8<'a>(input: &[u16], output: Out<'a, u8>) -> &'a mut [u8] {
            output.fill_chunks(input, |_, from: &[u16; U8::LEN]| {
                let (low, high) = from.split_at(U16::LEN);
                Some(U8::narrow(U16::from_slice(low), U16::from_slice(high)).to_array())
            })
        }
    }

    #[export]
    pub fn fill_with_mask<'a>(mask: [u8; 4], output: Out<'a, u8>, input: &[u8]) -> &'a mut [u8] {
        let output = output.take(input.len());
        let (len, mask) = (output.len(), u32::from_le_bytes(mask));
        let mask_at =
            |at: usize| U32::splat(mask.rotate_right(8 * (at % 4) as u32)).bitcast::<U8>();
        if len >= U8::LEN {
            return output.fill_chunks(input, |at, from| {
                Some((U8::load(from) ^ mask_at(at)).to_array())
            });
        }
        match U8::load_partial(&input[..len]) {
            Some(it) => (it.lanes ^ mask_at(0).lookup(it.indices() & 3)).store_partial(output),
            None => &mut [],
        }
    }

    #[export]
    pub fn fill_shared_with_mask(mask: [u8; 4], output: &[AtomicU8], input: &[u8]) {
        let len = input.len().min(output.len());
        let m: U8 = U32::splat(u32::from_le_bytes(mask)).bitcast();
        let (words, rest) = input[..len].split_at(len & !3);
        let (words_out, rest_out) = output[..len].split_at(len & !3);
        U8::map_to_shared(words, words_out, |v| v ^ m);
        for ((from, to), mask) in rest.iter().zip(rest_out).zip(mask) {
            to.store(from ^ mask, Relaxed);
        }
    }
}
