//! From one buffer to another, or in place.
use bun_simd::{Out, SharedOutU8, SharedU8, SharedWriter, Sink};
use core::sync::atomic::AtomicU8;

pub use simd::{
    copy_ascii_prefix_to_shared, copy_few_ascii_to_shared, copy_short_ascii_prefix_to_shared,
    copy_u16_to_shared, copy_u16_to_u8, lower_ascii, lower_ascii16, swap16_shared, swap32_shared,
    swap64_shared,
};

#[bun_simd::foreach_target]
mod simd {
    use isa::{I8, U8, U16, Vector};

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
        let (from, to) = (SharedU8::from_slice(words), SharedOutU8::from_slice(words));
        U8::map_to_shared(from, to, |v| v.lookup(U8::iota() & 15 ^ (SIZE as u8 - 1)));
    }

    #[export]
    pub fn swap16_shared(bytes: &[AtomicU8]) {
        reverse_each::<2>(bytes);
    }

    #[export]
    pub fn swap32_shared(bytes: &[AtomicU8]) {
        reverse_each::<4>(bytes);
    }

    #[export]
    pub fn swap64_shared(bytes: &[AtomicU8]) {
        reverse_each::<8>(bytes);
    }

    #[export]
    pub fn copy_ascii_prefix_to_shared(from: &[u8], to: &[SharedOutU8]) -> usize {
        U8::map_to_shared_until(from, to, |v| v, |v| v.bitcast::<I8>().simd_lt(0).cast())
    }

    /// The same for a few dozen bytes.
    #[export(baseline)]
    #[inline]
    pub fn copy_short_ascii_prefix_to_shared(from: &[u8], to: &[SharedOutU8]) -> usize {
        let len = from.len().min(to.len());
        let (from, to) = (&from[..len], &to[..len]);
        let copy = |from: &[u8; 8], to| {
            let word = Vector::from_array(*from);
            from.is_ascii().then(|| word.store_shared(to))
        };
        let mut done = 0;
        for (from, to) in from.as_chunks().0.iter().zip(to.as_chunks().0) {
            if copy(from, to).is_none() {
                break;
            }
            done += 8;
        }
        if len - done < 8
            && let (Some((_, from)), Some((_, to))) =
                (from.split_last_chunk(), to.split_last_chunk())
            && copy(from, to).is_some()
        {
            return len;
        }
        while done < len && from[done].is_ascii() {
            to[done].set(from[done]);
            done += 1;
        }
        done
    }

    #[inline(always)]
    fn copy_ends_if_ascii<const N: usize>(from: &[u8], to: &[SharedOutU8]) -> Option<bool> {
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
    pub fn copy_few_ascii_to_shared(from: &[u8], to: &[SharedOutU8]) -> bool {
        let len = from.len();
        if len > 16 || len > to.len() {
            return false;
        }
        let to = &to[..len];
        if len >= 8 {
            copy_ends_if_ascii::<8>(from, to) == Some(true)
        } else if len >= 4 {
            copy_ends_if_ascii::<4>(from, to) == Some(true)
        } else if len > 0 {
            let all = [0, len / 2, len - 1];
            let is_ascii = all.iter().fold(0, |bits, &at| bits | from[at]).is_ascii();
            if is_ascii {
                all.iter().for_each(|&at| to[at].set(from[at]));
            }
            is_ascii
        } else {
            true
        }
    }

    #[inline(always)]
    fn append_low_bytes(from: &[u16], to: &mut impl Sink) {
        let from = &from[..from.len().min(to.remaining())];
        if from.len() >= U16::LEN {
            return U8::append_chunks(from, to, |chunk| {
                let [low, high] = U16::load_or_zero(chunk);
                Some(U8::narrow(low, high))
            });
        }
        let [v] = U16::load_or_zero(from);
        U8::narrow(v, v).append_partial(to, from.len());
    }

    #[export]
    pub fn copy_u16_to_u8<'a>(from: &[u16], to: Out<'a, u8>) -> &'a mut [u8] {
        let mut to = to.into_writer();
        append_low_bytes(from, &mut to);
        to.finish()
    }

    #[export]
    pub fn copy_u16_to_shared(from: &[u16], to: &[SharedOutU8]) -> usize {
        let mut to = SharedWriter::new(to);
        append_low_bytes(from, &mut to);
        to.len()
    }
}
