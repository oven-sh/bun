//! Ports of highway_strings.cpp: from one buffer to another, or in place.
use bun_simd::{Out, Partial, SharedU8, SharedWriter, Sink, Source};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, U8, U16, U32, Vector, x128};

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

    /// Leaves what follows the last whole word.
    #[inline(always)]
    fn reverse_each<const SIZE: usize>(bytes: &[AtomicU8]) {
        let words = bytes.as_chunks::<SIZE>().0.as_flattened();
        U8::map_to_shared(words, words, |v| {
            v.lookup(U8::iota() & 15 ^ (SIZE as u8 - 1))
        });
    }

    #[export]
    pub fn bswap16_shared(bytes: &[AtomicU8]) {
        reverse_each::<2>(bytes);
    }

    #[export]
    pub fn bswap32_shared(bytes: &[AtomicU8]) {
        reverse_each::<4>(bytes);
    }

    #[export]
    pub fn bswap64_shared(bytes: &[AtomicU8]) {
        reverse_each::<8>(bytes);
    }

    #[inline(always)]
    fn append_ascii_prefix(from: &[u8], to: &mut impl Sink) {
        let is_not_ascii = |v: U8| v.bitcast::<I8>().simd_lt(0).cast::<u8>();
        let from = &from[..from.len().min(to.remaining())];
        let done = U8::append_chunks(to, from, |_, chunk| {
            let v = U8::load(chunk);
            is_not_ascii(v).none().then_some(v)
        });
        if done < from.len() {
            let rest = &from[done..][..(from.len() - done).min(U8::LEN - 1)];
            let len = U8::position(rest, is_not_ascii).unwrap_or(rest.len());
            if let Some(partial) = U8::load_partial(&rest[..len]) {
                partial.lanes.append_partial(to, len);
            }
        }
    }

    #[export]
    pub fn copy_ascii_prefix<'a>(from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        let mut to = to.into_writer();
        append_ascii_prefix(from, &mut to);
        to.finish()
    }

    #[export]
    pub fn copy_ascii_prefix_to_shared(from: &[u8], to: &[AtomicU8]) -> usize {
        let mut to = SharedWriter::new(to);
        append_ascii_prefix(from, &mut to);
        to.len()
    }

    /// The same for a few dozen bytes.
    #[export(baseline)]
    #[inline]
    pub fn copy_short_ascii_prefix_to_shared(from: &[u8], to: &[AtomicU8]) -> usize {
        let mut to = SharedWriter::new(to);
        let done = U8::append_chunks(&mut to, from, |_, chunk| {
            let v = U8::load(chunk);
            v.bitcast::<I8>().simd_lt(0).none().then_some(v)
        });
        to.extend_with(&from[done..], |&byte| byte.is_ascii().then_some(byte));
        to.len()
    }

    #[inline(always)]
    fn copy_ends_if_ascii<const N: usize>(from: &[u8], to: &[AtomicU8]) -> Option<bool> {
        let (first, last) = (*from.first_chunk::<N>()?, *from.split_last_chunk::<N>()?.1);
        let (start, end) = (to.first_chunk()?, to.split_last_chunk()?.1);
        let (first, last) = (Vector::from_array(first), Vector::from_array(last));
        let is_ascii = (first | last).to_array().is_ascii();
        if is_ascii {
            first.store_shared(start);
            last.store_shared(end);
        }
        Some(is_ascii)
    }

    /// Copies all or nothing: all if it is ASCII, fits and has up to 16 bytes.
    #[export(baseline)]
    #[inline]
    pub fn copy_few_ascii_to_shared(from: &[u8], to: &[AtomicU8]) -> bool {
        let len = from.len();
        if len > 16 || len > to.len() {
            return false;
        }
        let to = &to[..len];
        if let Some(is_copied) = copy_ends_if_ascii::<8>(from, to) {
            return is_copied;
        }
        if let Some(is_copied) = copy_ends_if_ascii::<4>(from, to) {
            return is_copied;
        }
        let Some(last) = len.checked_sub(1) else {
            return true;
        };
        let all = [0, len / 2, last];
        let is_ascii = all.iter().fold(0, |bits, &at| bits | from[at]).is_ascii();
        if is_ascii {
            for at in all {
                to[at].store(from[at], Relaxed);
            }
        }
        is_ascii
    }

    #[inline(always)]
    fn append_low_bytes(from: &[u16], to: &mut impl Sink) {
        let from = &from[..from.len().min(to.remaining())];
        if from.len() >= U8::LEN {
            width::full::append_low_bytes(from, to);
        } else if from.len() >= 16 {
            width::x128::append_low_bytes(from, to);
        } else if from.len() >= 8 {
            Vector::append_chunks(to, from, |_, chunk| Some(x128::U16::load(chunk).cast()));
        } else if let Some(Partial { lanes, .. }) = x128::U16::load_partial(from) {
            x128::U8::narrow(lanes, lanes).append_partial(to, from.len());
        }
    }

    #[export]
    pub fn copy_u16_to_u8<'a>(from: &[u16], to: Out<'a, u8>) -> &'a mut [u8] {
        let mut to = to.into_writer();
        append_low_bytes(from, &mut to);
        to.finish()
    }

    #[export]
    pub fn copy_u16_to_shared(from: &[u16], to: &[AtomicU8]) -> usize {
        let mut to = SharedWriter::new(to);
        append_low_bytes(from, &mut to);
        to.len()
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U16};

        #[inline(always)]
        pub fn append_low_bytes(from: &[u16], to: &mut impl Sink) {
            U8::append_chunks(to, from, |_, chunk| {
                let (low, high) = chunk.split_at(U16::LEN);
                Some(U8::narrow(U16::from_slice(low), U16::from_slice(high)))
            });
        }
    }

    #[inline(always)]
    fn fill<'a>(
        mask: [u8; 4],
        output: Out<'a, u8>,
        input: &[impl Source<Lane = u8>],
    ) -> &'a mut [u8] {
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
    pub fn fill_with_mask<'a>(mask: [u8; 4], output: Out<'a, u8>, input: &[u8]) -> &'a mut [u8] {
        fill(mask, output, input)
    }

    #[export]
    pub fn fill_with_mask_from_shared<'a>(
        mask: [u8; 4],
        output: Out<'a, u8>,
        input: &[SharedU8],
    ) -> &'a mut [u8] {
        fill(mask, output, input)
    }

    #[export]
    pub fn mask_in_place(mask: [u8; 4], bytes: &mut [u8]) {
        let (words, rest) = bytes.as_chunks_mut::<4>();
        let masks: U8 = U32::splat(u32::from_le_bytes(mask)).bitcast();
        U8::map_in_place(words.as_flattened_mut(), |v| v ^ masks);
        for (byte, mask) in rest.iter_mut().zip(mask) {
            *byte ^= mask;
        }
    }
}
