//! Slices that are shorter than a vector.
use crate::source::Memory;
use crate::swizzle::Repeat;
use crate::{Int, Isa, Lane, Mask, Out, Source, Vector, portable};
use core::array::from_ref;
use core::simd::{Simd, Swizzle, ToBytes, u8x16, u8x32, u16x8, u32x8};
use core::sync::atomic::AtomicU8;

/// A slice shorter than a vector. The order of the lanes depends on the target and the length.
#[derive(Clone, Copy)]
pub struct Partial<T: Lane, const N: usize, I> {
    /// The slice padded with zeros, or its first `half` and last `half` elements, alternating.
    pub lanes: Vector<T, N, I>,
    half: usize,
    len: usize,
}

impl<T: Int<N>, const N: usize, I: Isa> Partial<T, N, I> {
    #[inline(always)]
    fn index_of(self, lane: usize) -> usize {
        let lane = lane & (2 * self.half - 1);
        if lane < self.half {
            lane
        } else {
            lane + self.len - 2 * self.half
        }
    }

    /// The first index into the slice for which `mask` is set.
    #[inline(always)]
    pub fn first_set(self, mask: Mask<T, N, I>) -> Option<usize> {
        if I::HAS_MASK_REGISTERS {
            let lane = mask.to_bitmask().trailing_zeros() as usize;
            return (lane < self.len).then_some(lane);
        }
        mask.first_set().map(|lane| self.index_of(lane))
    }

    /// The last index into the slice for which `mask` is set.
    #[inline(always)]
    pub fn last_set(self, mask: Mask<T, N, I>) -> Option<usize> {
        if I::HAS_MASK_REGISTERS {
            let lane = 63usize.wrapping_sub(self.to_bitmask(mask).leading_zeros() as usize);
            return (lane < self.len).then_some(lane);
        }
        mask.last_set().map(|lane| self.index_of(lane))
    }

    /// One bit for each index into the slice.
    #[inline(always)]
    pub fn to_bitmask(self, mask: Mask<T, N, I>) -> u64 {
        let bits = mask.to_bitmask();
        if I::HAS_MASK_REGISTERS {
            return bits & ((1 << self.len) - 1);
        }
        let half = (1 << self.half) - 1;
        bits & half | (bits >> self.half & half) << (self.len - self.half)
    }
}

impl<T: Lane, const N: usize, I: Isa> Vector<T, N, I> {
    const IS_MASKED: bool = {
        let has_other_way = matches!(size_of::<Self>(), 16 | 32);
        assert!(
            I::HAS_MASK_REGISTERS || has_other_way,
            "needs 16 or 32 bytes"
        );
        I::HAS_MASK_REGISTERS
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
    use isa::Vector;

    impl<T: Int<N>, const N: usize> Vector<T, N> {
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
            let (lanes, half) = if Self::IS_MASKED {
                if len == 0 {
                    return None;
                }
                let lanes = match S::memory(from) {
                    Memory::Plain(lanes) => Self::load_masked(lanes),
                    Memory::Shared(bytes)
                        if is_slow_with_mask::<_, 64>(bytes.as_ptr(), bytes.len()) =>
                    {
                        Self::from_shared(portable::load_shared_masked(bytes))
                    }
                    Memory::Shared(bytes) => Self::from_shared(shared::load_shared_masked(bytes)),
                };
                (lanes, 0)
            } else if N > 8 && len >= 8 {
                if N > 16 && len >= 16 {
                    (Self::load_ends::<S, 16>(from)?, 16)
                } else {
                    (Self::load_ends::<S, 8>(from)?, 8)
                }
            } else if N > 4 && len >= 4 {
                (Self::load_ends::<S, 4>(from)?, 4)
            } else if N > 2 && len >= 2 {
                (Self::load_ends::<S, 2>(from)?, 2)
            } else {
                (Self::splat(from.first()?.get()), 1)
            };
            Some(Partial { lanes, half, len })
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
