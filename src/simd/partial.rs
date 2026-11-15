//! Slices that are shorter than a vector.
use crate::source::Memory;
use crate::swizzle::Repeat;
use crate::{Int, Isa, Lane, Mask, Out, Source, Vector, portable};
use core::array::{from_fn, from_ref};
use core::simd::{Simd, Swizzle, ToBytes, u8x16, u8x32, u16x8, u32x4, u32x8};
use core::sync::atomic::AtomicU8;

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

/// Where four pieces start that cover `piece..=4 * piece` elements.
#[inline(always)]
const fn quarters(len: usize, piece: usize) -> [usize; 4] {
    let room = len - piece;
    let inset = if room < piece { room } else { piece };
    [0, inset, room - inset, room]
}

#[repr(align(16))]
struct Shuffles([[u8; 16]; 16]);

/// From the quarters of so many bytes, or from the bytes if they are less than 4, to those bytes.
static JOIN: Shuffles = Shuffles(from_fn(const |size| {
    let (mut shuffle, mut i) = ([0x80; 16], 0);
    while i < if size < 4 { size } else { 16 } {
        let at = if size < 4 {
            i
        } else {
            quarters(size, 4)[i / 4] + i % 4
        };
        shuffle[at] = i as u8;
        i += 1;
    }
    shuffle
}));

/// From `n` on, it moves bytes down by `n`.
static SLIDE: [u8; 32] = from_fn(const |i| if i < 16 { i as u8 } else { 0x80 });

/// A slice shorter than a vector. The order of the lanes depends on the target and the length.
#[derive(Clone, Copy)]
pub struct Partial<T: Lane, const N: usize, I> {
    /// The slice padded with zeros, or its first and last elements, alternating.
    pub lanes: Vector<T, N, I>,
    len: usize,
}

impl<T: Lane, const N: usize, I: Isa> Vector<T, N, I> {
    const IS_MASKED: bool = {
        let has_other_way = matches!(size_of::<Self>(), 16 | 32);
        assert!(
            I::HAS_MASKED_MEMORY || has_other_way,
            "needs 16 or 32 bytes"
        );
        I::HAS_MASKED_MEMORY
    };

    /// The inverse of `load_partial` for a slice of the same length.
    #[inline(always)]
    pub fn store_partial(self, to: Out<'_, T>) -> &mut [T] {
        #[inline(always)]
        fn put<'a, T: Copy, const HALF: usize>(lanes: &[T], to: Out<'a, T>) -> Filled<'a, T> {
            match *lanes.as_chunks::<HALF>().0 {
                [first, last, ..] => to.fill_ends(first, last),
                _ => Err(to),
            }
        }
        debug_assert!(to.len() < N);
        if Self::IS_MASKED {
            return self.store_masked(to);
        }
        let lanes = &self.to_array();
        put::<T, 16>(lanes, to)
            .or_else(|to| put::<T, 8>(lanes, to))
            .or_else(|to| put::<T, 4>(lanes, to))
            .or_else(|to| put::<T, 2>(lanes, to))
            .or_else(|to| put::<T, 1>(lanes, to))
            .unwrap_or_default()
    }

    #[inline(always)]
    fn store_masked(self, to: Out<'_, T>) -> &mut [T] {
        if !is_slow_with_mask::<T, N>(to.as_ptr(), to.len()) {
            return to.fill_masked(self.0);
        }
        let to = to.take(N);
        copy_short(&self.to_array()[..to.len()], to)
    }

    #[inline(always)]
    fn load_masked(from: &[T]) -> Self {
        if !is_slow_with_mask::<T, N>(from.as_ptr(), from.len()) {
            return Self::new(Simd::load_or_default(from));
        }
        let (mut lanes, len) = ([T::default(); N], from.len().min(N));
        copy_short(&from[..len], lanes[..len].as_mut().into());
        Self::from_array(lanes)
    }
}

/// Alternates between the first `len` bytes of `first` and of `last`.
#[inline(always)]
fn alternate(first: u8x16, last: u8x16, len: usize) -> u8x32 {
    #[inline(always)]
    fn as_lanes<T: Lane, const HALF: usize, const N: usize>(first: u8x16, last: u8x16) -> u8x32
    where
        Simd<T, HALF>: ToBytes<Bytes = u8x16>,
        Simd<T, N>: ToBytes<Bytes = u8x32>,
    {
        let both = [first, last].map(|end| Simd::<T, HALF>::from_ne_bytes(end)[0]);
        let all: Simd<T, N> = Repeat::<2>::swizzle(Simd::from_array(both));
        all.to_ne_bytes()
    }
    match len {
        // Avoids `vinserti128` from memory, for which QEMU 7.2 to 10.0.3 reads 32 bytes.
        16 => Repeat::<16>::swizzle(last) ^ (first ^ last).resize(0),
        8 => as_lanes::<u64, 2, 4>(first, last),
        4 => as_lanes::<u32, 4, 8>(first, last),
        _ => {
            let [a, b] = [first, last].map(|end| u32::from(u16x8::from_le_bytes(end)[0]));
            u32x8::splat(a | b << 16).to_le_bytes()
        }
    }
}

/// `last_chunk` would leave a comparison with null in the code.
#[inline(always)]
fn ends<T, const N: usize>(slice: &[T]) -> Option<(&[T; N], &[T; N])> {
    Some((slice.first_chunk()?, slice.split_last_chunk()?.1))
}

type Filled<'a, T> = Result<&'a mut [T], Out<'a, T>>;

/// For two slices of the same length, up to 64.
#[inline(always)]
pub(crate) fn copy_short<'a, T: Copy>(from: &[T], to: Out<'a, T>) -> &'a mut [T] {
    #[inline(always)]
    fn put<'a, T: Copy, const HALF: usize>(from: &[T], to: Out<'a, T>) -> Filled<'a, T> {
        match ends::<T, HALF>(from) {
            Some((&first, &last)) => to.fill_ends(first, last),
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

/// A masked access takes hundreds of cycles if the lanes that it skips are in an unmapped page.
#[inline(always)]
fn is_slow_with_mask<T, const N: usize>(start: *const T, len: usize) -> bool {
    let size = size_of::<[T; N]>().next_power_of_two().max(16);
    let is_at_end_of_page = start.addr().wrapping_add(size) & (4096 - size) == 0;
    core::hint::unlikely(is_at_end_of_page || len == 0)
}

#[bun_simd_macros::foreach_target]
mod simd {
    #[cfg(miri)]
    use crate::portable as shared;
    #[cfg(not(miri))]
    use isa as shared;
    use isa::{Vector, x128};

    impl<T: Int<N>, const N: usize> Vector<T, N> {
        /// `None` if `from` is empty.
        pub fn load_padded<S: Source<Lane = T>>(from: &[S]) -> Option<Padded<T, N, isa::Isa>> {
            Self::load_padded_inline(from)
        }

        #[inline(always)]
        pub(crate) fn load_padded_inline<S: Source<Lane = T>>(
            from: &[S],
        ) -> Option<Padded<T, N, isa::Isa>> {
            debug_assert!(from.len() < N);
            let lanes = match const { size_of::<T>() } {
                _ if Self::IS_MASKED => Self::load_partial_inline(from)?.lanes,
                1 => Self::join::<S, 4, 16>(from)?,
                2 => Self::join::<S, 2, 8>(from)?,
                4 => Self::join::<S, 1, 4>(from)?,
                _ => Self::join::<S, 1, 2>(from)?,
            };
            let len = from.len();
            Some(Padded { lanes, len })
        }

        /// Lengths are hard to predict, so few of them have a path of their own.
        #[inline(always)]
        fn join<S: Source<Lane = T>, const IN_4: usize, const IN_16: usize>(
            from: &[S],
        ) -> Option<Self> {
            let (len, size) = (from.len(), size_of_val(from));
            if N > IN_16
                && let Some((first, last)) = ends::<S, IN_16>(from)
            {
                let [first, last] = [Self::load_bytes(first), Self::load_bytes(last)];
                let slide = x128::U8::load(SLIDE.get(32 - size..)?.first_chunk()?);
                let rest = x128::U8::new(last).lookup(slide).0;
                let both: u8x32 = Repeat::<32>::concat_swizzle(first, rest);
                return Some(Self::from_first_bytes(both));
            }
            let pieces = if size_of::<T>() <= 4
                && let Some((a, d)) = ends::<S, IN_4>(from)
            {
                let inset = quarters(len, IN_4)[1];
                let b = from[inset..].first_chunk()?;
                let c = from[..len - inset].split_last_chunk()?.1;
                let word = |piece| u32::from_ne_bytes(Self::load_bytes(piece).to_array());
                u32x4::from_array([word(a), word(b), word(c), word(d)]).to_ne_bytes()
            } else {
                let mut lanes = Self::from_first(from.first()?.get());
                if size_of::<T>() > 1 {
                    return Some(lanes);
                }
                (lanes.0[1], lanes.0[2]) = (from[len / 2].get(), from[len - 1].get());
                lanes.first_bytes()
            };
            let joined = x128::U8::new(pieces).lookup(x128::U8::load(JOIN.0.get(size)?));
            Some(Self::from_first_bytes::<32>(joined.0.resize(0)))
        }

        #[inline(always)]
        fn load_bytes<S: Source<Lane = T>, const LEN: usize, const BYTES: usize>(
            from: &[S; LEN],
        ) -> Simd<u8, BYTES> {
            let lanes = Vector::load_nth_of_any_width::<S, 1, 0>(from_ref(from));
            Self::new(lanes.0.resize(T::default())).first_bytes()
        }

        /// `None` if `from` is empty.
        pub fn load_partial<S: Source<Lane = T>>(from: &[S]) -> Option<Partial<T, N, isa::Isa>> {
            Self::load_partial_inline(from)
        }

        /// Not public: Clippy cannot inline the MIR of another crate.
        #[inline(always)]
        pub(crate) fn load_partial_inline<S: Source<Lane = T>>(
            from: &[S],
        ) -> Option<Partial<T, N, isa::Isa>> {
            debug_assert!(from.len() < N);
            let len = from.len();
            let lanes = if Self::IS_MASKED {
                if len == 0 {
                    return None;
                }
                match S::memory(from) {
                    Memory::Plain(lanes) => Self::load_masked(lanes),
                    Memory::Shared(bytes)
                        if is_slow_with_mask::<_, 64>(bytes.as_ptr(), bytes.len()) =>
                    {
                        Self::from_shared(portable::load_shared_masked(bytes))
                    }
                    Memory::Shared(bytes) => Self::from_shared(shared::load_shared_masked(bytes)),
                }
            } else if N > 8 && len >= 8 {
                if N > 16 && len >= 16 {
                    Self::load_ends::<S, 16>(from)?
                } else {
                    Self::load_ends::<S, 8>(from)?
                }
            } else if N > 4 && len >= 4 {
                Self::load_ends::<S, 4>(from)?
            } else if N > 2 && len >= 2 {
                Self::load_ends::<S, 2>(from)?
            } else {
                Self::splat(from.first()?.get())
            };
            Some(Partial { lanes, len })
        }

        #[inline(always)]
        fn load_ends<S: Source<Lane = T>, const HALF: usize>(from: &[S]) -> Option<Self> {
            let (first, last) = ends::<S, HALF>(from)?;
            let load = |end| Vector::load_nth_of_any_width::<S, 1, 0>(from_ref(end));
            let bytes = |end| Self::new(load(end).0.resize(T::default())).first_bytes();
            let both = alternate(bytes(first), bytes(last), size_of_val(first));
            Some(Self::from_first_bytes(both))
        }
    }

    impl<const N: usize> Partial<u8, N, isa::Isa>
    where
        u8: Int<N>,
    {
        /// The index into the slice of each lane.
        pub fn indices(self) -> Vector<u8, N> {
            const INDICES: &[u8; 32] = &core::array::from_fn(const |i| i as u8);
            if Vector::<u8, N>::IS_MASKED {
                return Vector::iota();
            }
            let indices = Vector::load_partial_inline(&INDICES[..self.len]);
            indices.map_or_else(Vector::zero, |it| it.lanes)
        }
    }

    impl isa::U8 {
        /// `from`, which has less than 64 bytes, then zeros. Loads of it need not wait for the cache.
        pub fn pad_block(from: &[u8]) -> [u8; 64] {
            if Self::LEN == 64 {
                let padded = Self::load_padded_inline(from).map(|it| it.lanes.0);
                return padded.unwrap_or_default().resize(0).to_array();
            }
            let Some(last) = from.len().checked_sub(16) else {
                let padded = x128::U8::load_padded_inline(from).map(|it| it.lanes.0);
                return padded.unwrap_or_default().resize(0).to_array();
            };
            let quarter = |i: usize| {
                let at = last.min(16 * i);
                let slide = x128::U8::from_slice(&SLIDE[(16 * i - at).min(16)..]);
                x128::U8::from_slice(&from[at..]).lookup(slide).0
            };
            let low: u8x32 = Repeat::<32>::concat_swizzle(quarter(0), quarter(1));
            let high: u8x32 = Repeat::<32>::concat_swizzle(quarter(2), quarter(3));
            Repeat::<64>::concat_swizzle(low, high).to_array()
        }
    }

    impl<const N: usize> Vector<u8, N> {
        #[inline(always)]
        pub(crate) fn store_partial_shared(self, to: &[AtomicU8]) {
            debug_assert!(to.len() < N);
            if !Self::IS_MASKED {
                _ = self.store_ends_shared::<16>(to)
                    || self.store_ends_shared::<8>(to)
                    || self.store_ends_shared::<4>(to)
                    || self.store_ends_shared::<2>(to)
                    || self.store_ends_shared::<1>(to);
            } else if is_slow_with_mask::<_, 64>(to.as_ptr(), to.len()) {
                portable::store_shared_masked(self.0, to);
            } else {
                shared::store_shared_masked(self.0, to);
            }
        }

        #[inline(always)]
        fn store_ends_shared<const HALF: usize>(self, to: &[AtomicU8]) -> bool {
            let ([first, last, ..], Some((start, end))) =
                (self.0.as_array().as_chunks().0, ends::<_, HALF>(to))
            else {
                return false;
            };
            Vector::from_array(*first).store_shared(start);
            Vector::from_array(*last).store_shared(end);
            true
        }
    }
}
