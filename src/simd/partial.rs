//! Slices that are shorter than a vector.
use crate::source::Memory;
use crate::swizzle::Repeat;
use crate::vector::to_array;
use crate::{Int, Isa, Lane, Mask, Out, SharedOutU8, Source, Vector};
use bun_simd_trusted::{from_array, load_or_default, quarters};
use core::array::{from_fn, from_ref};
use core::hint::cold_path;
use core::simd::{Simd, Swizzle, ToBytes, u8x32, u8x64};

/// A slice shorter than a vector.
#[derive(Clone, Copy)]
pub struct Padded<T: Lane, const N: usize, I> {
    /// The slice, then zeros.
    pub lanes: Vector<T, N, I>,
    len: usize,
}

impl<T: Int<N>, const N: usize, I: Isa> Padded<T, N, I> {
    /// The first index into the slice for which `mask` is set.
    #[inline(always)]
    pub fn first_set(self, mask: Mask<T, N, I>) -> Option<usize> {
        let (bits, bits_per_lane) = I::movemask(mask);
        let lane = bits.trailing_zeros() as usize / bits_per_lane;
        (lane < self.len).then_some(lane)
    }

    /// The last index into the slice for which `mask` is set.
    #[inline(always)]
    pub fn last_set(self, mask: Mask<T, N, I>) -> Option<usize> {
        let (bits, bits_per_lane) = I::movemask(mask);
        let bits = bits << (64 - self.len * bits_per_lane);
        (bits != 0).then(|| self.len - 1 - bits.leading_zeros() as usize / bits_per_lane)
    }

    /// The number of indices into the slice for which `mask` is set.
    #[inline(always)]
    pub fn count(self, mask: Mask<T, N, I>) -> usize {
        mask.count_before(self.len)
    }

    /// One bit for each index into the slice.
    #[inline(always)]
    pub fn to_bitmask(self, mask: Mask<T, N, I>) -> u64 {
        mask.to_bitmask() & !(u64::MAX << self.len)
    }
}

/// Between the order of the slice and that of `load_pieces`.
#[repr(align(32))]
struct Shuffles {
    join: [u8; 16],
    split: [u8; 16],
}

static BY_SIZE: [Shuffles; 16] = from_fn(const |size: usize| {
    let (mut join, mut split) = ([0x80; 16], [0x80; 16]);
    let mut i = if size < 4 { 3 } else { 16 };
    while i > 0 {
        i -= 1;
        let at = match size {
            ..4 => [0, size.saturating_sub(1), size / 2][i],
            _ => quarters(size, 4)[i / 4] + i % 4,
        };
        (join[at], split[i]) = (i as u8, at as u8);
    }
    Shuffles { join, split }
});

/// From `n` on, it moves bytes down by `n`. From `32 - n` on, it moves them up.
static SLIDE: [u8; 48] = from_fn(const |i| if i / 16 == 1 { 0x80 } else { i as u8 % 16 });

impl<T: Int<N>, const N: usize, I: Isa> Vector<T, N, I> {
    const IS_MASKED: bool = {
        let size = size_of::<Self>();
        assert!(
            matches!(size, 16 | 32) || size == I::MASKED_BYTES,
            "needs 16 or 32 bytes"
        );
        size <= I::MASKED_BYTES
    };

    /// For an instruction that covers `size` bytes, and a slice that is not empty.
    #[inline(always)]
    fn is_slow_with_mask<E>(size: usize, start: *const E) -> bool {
        I::IS_SLOW_TO_SKIP_PAGE && start.addr().wrapping_add(size) & (4096 - size) == 0
    }

    #[inline(always)]
    pub(crate) fn to_64_bytes(self) -> u8x64 {
        match const { size_of::<Self>() } {
            16 => self.first_bytes::<16>().resize(0),
            32 => self.first_bytes::<32>().resize(0),
            _ => self.first_bytes(),
        }
    }
}

/// `last_chunk` would leave a comparison with null in the code.
#[inline(always)]
fn ends<T, const N: usize>(slice: &[T]) -> Option<(&[T; N], &[T; N])> {
    Some((slice.first_chunk()?, slice.split_last_chunk()?.1))
}

/// The pieces at `quarters`.
#[inline(always)]
fn quarters_of<T, const N: usize>(slice: &[T]) -> Option<[&[T; N]; 4]> {
    let (a, d) = ends(slice)?;
    let inset = quarters(slice.len(), N)[1];
    let b = slice[inset..].first_chunk()?;
    let c = slice[..slice.len() - inset].split_last_chunk()?.1;
    Some([a, b, c, d])
}

type Filled<'a, T> = Result<&'a mut [T], Out<'a, T>>;

/// Gives `to` back unless the two fit and cover all of it.
#[inline(always)]
fn fill_ends<T: Copy, const N: usize>(
    to: Out<'_, T>,
    first: [T; N],
    last: [T; N],
) -> Filled<'_, T> {
    let len = to.len();
    if len > 2 * N || len < N {
        return Err(to);
    }
    let mut to = to.into_writer();
    to.push(first);
    to.truncate(len - N);
    to.push(last);
    Ok(to.finish())
}

/// For two slices of the same length, up to 64.
#[inline(always)]
pub(crate) fn copy_short<'a, T: Copy>(from: &[T], to: Out<'a, T>) -> &'a mut [T] {
    #[inline(always)]
    fn put<'a, T: Copy, const HALF: usize>(from: &[T], to: Out<'a, T>) -> Filled<'a, T> {
        match ends::<T, HALF>(from) {
            Some((&first, &last)) => fill_ends(to, first, last),
            None => Err(to),
        }
    }
    put::<T, 32>(from, to)
        .or_else(|to| put::<T, 16>(from, to))
        .or_else(|to| put::<T, 8>(from, to))
        .or_else(|to| put::<T, 4>(from, to))
        .or_else(|to| put::<T, 2>(from, to))
        .or_else(|to| put::<T, 1>(from, to))
        .unwrap_or_default()
}

#[bun_simd_macros::foreach_target]
mod simd {
    #[cfg(miri)]
    use crate::portable as shared;
    #[cfg(not(miri))]
    use isa as shared;
    use isa::{Vector, rotate_bytes, x128, x256};

    #[inline(always)]
    fn slide(bytes: x128::U8, at: usize) -> Option<x128::U8> {
        (at <= 32).then(|| bytes.lookup(x128::U8::from_slice(&SLIDE[at..])))
    }

    impl<T: Int<N>, const N: usize> Vector<T, N> {
        /// `None` if `from` is empty. Panics if it fills the vector.
        pub fn load_padded<S: Source<Lane = T>>(from: &[S]) -> Option<Padded<T, N, isa::Isa>> {
            assert!(from.len() < N);
            Self::load_padded_inline(from)
        }

        /// Not public: Clippy cannot inline the MIR of another crate.
        #[inline(always)]
        pub(crate) fn load_padded_inline<S: Source<Lane = T>>(
            from: &[S],
        ) -> Option<Padded<T, N, isa::Isa>> {
            let (lanes, len) = (
                Self::load_pieces(from)?.join(size_of_val(from))?,
                from.len(),
            );
            Some(Padded { lanes, len })
        }

        /// As much of `from` as fits, then zeros.
        pub fn load_or_zero<S: Source<Lane = T>, const K: usize>(from: &[S]) -> [Self; K] {
            let (whole, rest) = from[..from.len().min(K * N)].as_chunks();
            let mut all = [Self::zero(); K];
            let rest = Self::load_padded_inline(rest).map_or(all[0], |it| it.lanes);
            for (i, v) in all.iter_mut().enumerate() {
                match whole.get(i) {
                    Some(chunk) => *v = Self::load(chunk),
                    None if i == whole.len() => *v = rest,
                    None => {}
                }
            }
            all
        }

        /// The first lanes. Panics if `to` has room for all.
        pub fn store_partial(self, to: Out<'_, T>) -> &mut [T] {
            assert!(to.len() < N);
            match self.split(to.len() * size_of::<T>()) {
                Some(pieces) => pieces.store_pieces(to),
                None => &mut [],
            }
        }

        /// In an order of its own, which keeps groups of 2, 4 or 8 together if the length is a multiple.
        #[inline(always)]
        pub(crate) fn load_pieces<S: Source<Lane = T>>(from: &[S]) -> Option<Self> {
            debug_assert!(from.len() < N);
            match const { size_of::<T>() } {
                _ if Self::IS_MASKED => Self::load_with_mask(from),
                1 => Self::load_pieces_of::<S, 4, 16>(from),
                2 => Self::load_pieces_of::<S, 2, 8>(from),
                4 => Self::load_pieces_of::<S, 1, 4>(from),
                _ => Self::load_pieces_of::<S, 1, 2>(from),
            }
        }

        #[inline(always)]
        pub(crate) fn store_pieces(self, to: Out<'_, T>) -> &mut [T] {
            debug_assert!(to.len() < N);
            match const { size_of::<T>() } {
                _ if Self::IS_MASKED => self.store_with_mask(to),
                1 => self.store_pieces_of::<4, 16>(to),
                2 => self.store_pieces_of::<2, 8>(to),
                4 => self.store_pieces_of::<1, 4>(to),
                _ => self.store_pieces_of::<1, 2>(to),
            }
        }

        /// Lengths are hard to predict, so few of them have a path of their own.
        #[inline(always)]
        fn load_pieces_of<S: Source<Lane = T>, const IN_4: usize, const IN_16: usize>(
            from: &[S],
        ) -> Option<Self> {
            let len = from.len();
            if N > IN_16
                && let Some((first, last)) = ends::<S, IN_16>(from)
            {
                let [first, last] = [Self::load_bytes::<S, _, 16>(first), Self::load_bytes(last)];
                // Avoids `vinserti128` from memory, for which QEMU 7.2 to 10.0.3 reads 32 bytes.
                let both: u8x32 = Repeat::<16>::swizzle(last) ^ (first ^ last).resize(0);
                return Some(Self::from_first_bytes(both));
            }
            if size_of::<T>() <= 4
                && let Some([a, b, c, d]) = quarters_of::<S, IN_4>(from)
            {
                let word = |piece| u32::from_ne_bytes(to_array(Self::load_bytes(piece)));
                let words = from_array([word(a), word(b), word(c), word(d)]);
                return Some(Self::from_first_bytes(words.to_ne_bytes()));
            }
            let mut lanes = Self::from_first(from.first()?.get());
            if size_of::<T>() == 1 {
                (lanes.0[1], lanes.0[2]) = (from[len - 1].get(), from[len / 2].get());
            }
            Some(lanes)
        }

        #[inline(always)]
        fn store_pieces_of<const IN_4: usize, const IN_16: usize>(
            self,
            mut to: Out<'_, T>,
        ) -> &mut [T] {
            let (len, lanes) = (to.len(), self.to_array());
            if let [first, last] = *lanes.as_chunks::<IN_16>().0 {
                match fill_ends(to, first, last) {
                    Ok(filled) => return filled,
                    Err(shorter) => to = shorter,
                }
            }
            if size_of::<T>() <= 4
                && len >= IN_4
                && let Some(&pieces) = lanes.as_chunks::<IN_4>().0.first_chunk()
            {
                return to.fill_quarters(pieces);
            }
            let mut to = to.into_writer();
            if len > 0 {
                to.push([lanes[0]]);
                if size_of::<T>() == 1 {
                    to.truncate(len / 2);
                    to.push([lanes[2]]);
                    to.truncate(len - 1);
                    to.push([lanes[1]]);
                }
            }
            to.finish()
        }

        #[inline(always)]
        pub(crate) fn join(self, size: usize) -> Option<Self> {
            if Self::IS_MASKED {
                return Some(self);
            }
            if size_of::<Self>() == 32 && size >= 16 {
                let [first, last] = self.blocks();
                return Some(Self::with_blocks(first, slide(last, 32 - size)?));
            }
            Some(self.shuffle_16_bytes(&BY_SIZE.get(size)?.join))
        }

        #[inline(always)]
        fn split(self, size: usize) -> Option<Self> {
            if Self::IS_MASKED {
                return Some(self);
            }
            if size_of::<Self>() == 32 && size >= 16 {
                let [first, rest] = self.blocks();
                let last = slide(first, size - 16)? | slide(rest, size)?;
                return Some(Self::with_blocks(first, last));
            }
            Some(self.shuffle_16_bytes(&BY_SIZE.get(size)?.split))
        }

        #[inline(always)]
        fn blocks(self) -> [x128::U8; 2] {
            let both = self.first_bytes::<32>();
            [both.extract::<0, 16>(), both.extract::<16, 16>()].map(x128::U8::new)
        }

        #[inline(always)]
        fn with_blocks(first: x128::U8, second: x128::U8) -> Self {
            Self::from_first_bytes::<32>(Repeat::<32>::concat_swizzle(first.0, second.0))
        }

        #[inline(always)]
        fn shuffle_16_bytes(self, order: &[u8; 16]) -> Self {
            // One lane of 8 bytes is where it belongs.
            if size_of::<T>() == 8 {
                return self;
            }
            let bytes = x128::U8::new(self.first_bytes()).lookup(x128::U8::load(order));
            Self::from_first_bytes(bytes.0)
        }

        #[inline(always)]
        fn load_bytes<S: Source<Lane = T>, const LEN: usize, const BYTES: usize>(
            from: &[S; LEN],
        ) -> Simd<u8, BYTES> {
            let lanes = Vector::load_nth_of_any_width::<S, 1, 0>(from_ref(from));
            Self::new(lanes.0.resize(T::default())).first_bytes()
        }

        /// At the end of a page, it skips what is before the slice, not what is after it.
        #[inline(always)]
        fn load_with_mask<S: Source<Lane = T>>(from: &[S]) -> Option<Self> {
            if from.is_empty() {
                return None;
            }
            Some(match S::memory(from) {
                Memory::Plain(from)
                    if Self::is_slow_with_mask(size_of::<Self>(), from.as_ptr()) =>
                {
                    cold_path();
                    let last = shared::load_to_last::<T, N>(from);
                    Self::from_first_bytes(rotate_bytes(last, size_of_val(from)))
                }
                Memory::Plain(from) => Self::new(load_or_default(from)),
                Memory::Shared(from) if Self::is_slow_with_mask(64, from.as_ptr()) => {
                    cold_path();
                    let last = shared::load_shared_masked::<true>(from);
                    Self::from_first_bytes(rotate_bytes(last, from.len()))
                }
                Memory::Shared(from) => {
                    Self::from_first_bytes(shared::load_shared_masked::<false>(from))
                }
            })
        }

        #[inline(always)]
        fn store_with_mask(self, to: Out<'_, T>) -> &mut [T] {
            if to.is_empty() {
                &mut []
            } else if Self::is_slow_with_mask(size_of::<Self>(), to.as_ptr()) {
                cold_path();
                let size = to.len() * size_of::<T>();
                let last = rotate_bytes(self.to_64_bytes(), size.wrapping_neg());
                shared::fill_from_last::<T, N>(last, to)
            } else {
                to.fill_masked(self.0)
            }
        }
    }

    impl<const N: usize> Vector<u8, N>
    where
        u8: Int<N>,
    {
        /// Moves lane `i` to `i + by`, after zeros. Panics if none is left.
        pub fn slide_up(self, by: usize) -> Self {
            static RAMP: [u8; 80] =
                from_fn(const |i| if i / 16 == 3 { i as u8 % 16 } else { 0x80 });
            assert!(by < N);
            match N {
                16 => {
                    let indices = x128::U8::from_slice(&RAMP[48 - by..]);
                    Self::from_first_bytes(x128::U8::new(self.first_bytes()).lookup(indices).0)
                }
                32 => {
                    let [near, far] = [32, 48].map(|at| x256::U8::from_slice(&RAMP[at - by..]));
                    let [first, _] = self.blocks();
                    let [both, first] = [self, Self::with_blocks(first, first)]
                        .map(|it| x256::U8::new(it.first_bytes()));
                    Self::from_first_bytes((both.lookup(near) | first.lookup(far)).0)
                }
                _ => {
                    let rotated = Self::from_first_bytes(rotate_bytes(self.to_64_bytes(), by));
                    rotated & Self::iota().simd_ge(by as u8).to_vector()
                }
            }
        }
    }

    impl isa::U8 {
        /// `from`, which has less than 64 bytes, then zeros. Loads of it need not wait for the cache.
        pub fn pad_block(from: &[u8]) -> [u8; 64] {
            if Self::LEN == 64 {
                let padded = Self::load_padded_inline(from).map(|it| it.lanes.0);
                return to_array(padded.unwrap_or_default().resize(0));
            }
            let Some(last) = from.len().checked_sub(16) else {
                let padded = x128::U8::load_padded_inline(from).map(|it| it.lanes.0);
                return to_array(padded.unwrap_or_default().resize(0));
            };
            let quarter = |i: usize| {
                let at = last.min(16 * i);
                let slide = x128::U8::from_slice(&SLIDE[(16 * i - at).min(16)..]);
                x128::U8::from_slice(&from[at..]).lookup(slide).0
            };
            let low: u8x32 = Repeat::<32>::concat_swizzle(quarter(0), quarter(1));
            let high: u8x32 = Repeat::<32>::concat_swizzle(quarter(2), quarter(3));
            to_array(Repeat::<64>::concat_swizzle(low, high))
        }
    }

    impl<const N: usize> Vector<u8, N>
    where
        u8: Int<N>,
    {
        /// One to the start and one to the end.
        #[inline(always)]
        pub(crate) fn store_halves(self, to: Out<'_, u8>) -> &mut [u8] {
            (self.store_ends::<32>(to))
                .or_else(|to| self.store_ends::<16>(to))
                .or_else(|to| self.store_ends::<8>(to))
                .unwrap_or_default()
        }

        #[inline(always)]
        fn store_ends<const HALF: usize>(self, to: Out<'_, u8>) -> Filled<'_, u8> {
            match *self.to_array().as_chunks::<HALF>().0 {
                [first, last] => fill_ends(to, first, last),
                _ => Err(to),
            }
        }

        #[inline(always)]
        pub(crate) fn store_halves_shared(self, to: &[SharedOutU8]) -> usize {
            _ = self.store_ends_shared::<32>(to)
                || self.store_ends_shared::<16>(to)
                || self.store_ends_shared::<8>(to);
            to.len()
        }

        #[inline(always)]
        fn store_ends_shared<const HALF: usize>(self, to: &[SharedOutU8]) -> bool {
            let lanes = self.to_array();
            let ([first, last], Some((start, end))) = (lanes.as_chunks().0, ends::<_, HALF>(to))
            else {
                return false;
            };
            shared::store_shared::<HALF, 1, 0>(from_array(*first), start);
            shared::store_shared::<HALF, 1, 0>(from_array(*last), end);
            true
        }

        #[inline(always)]
        pub(crate) fn store_partial_shared(self, to: &[SharedOutU8]) -> usize {
            match self.split(to.len()) {
                Some(pieces) => pieces.store_pieces_shared(to),
                None => 0,
            }
        }

        #[inline(always)]
        pub(crate) fn store_pieces_shared(self, to: &[SharedOutU8]) -> usize {
            debug_assert!(to.len() < N);
            let (len, lanes) = (to.len(), self.to_array());
            if len == 0 {
            } else if Self::IS_MASKED && Self::is_slow_with_mask(64, to.as_ptr()) {
                cold_path();
                let last = rotate_bytes(self.to_64_bytes(), len.wrapping_neg());
                shared::store_shared_masked::<true>(last, to);
            } else if Self::IS_MASKED {
                shared::store_shared_masked::<false>(self.to_64_bytes(), to);
            } else if self.store_ends_shared::<16>(to) {
            } else if let Some(quarters) = quarters_of::<_, 4>(to) {
                for (piece, to) in lanes.as_chunks().0.iter().zip(quarters) {
                    Vector::load(piece).store_shared(to);
                }
            } else {
                // Of two bytes, the third lane has been mixed with padding.
                let middle = if len == 2 { lanes[1] } else { lanes[2] };
                for (byte, at) in [(lanes[0], 0), (middle, len / 2), (lanes[1], len - 1)] {
                    to[at].set(byte);
                }
            }
            len
        }
    }
}
