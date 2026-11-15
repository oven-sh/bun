//! What vectors are loaded from.
use crate::Lane;
use core::array;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A lane in memory: a plain value, or a byte that other threads may write concurrently.
pub trait Source: Sized {
    type Lane: Lane;
    /// Two reads may return different values.
    const IS_SHARED: bool;

    fn get(&self) -> Self::Lane;

    #[doc(hidden)]
    fn memory(slice: &[Self]) -> Memory<'_, Self::Lane>;
}

pub enum Memory<'a, T> {
    Plain(&'a [T]),
    Shared(&'a [AtomicU8]),
}

impl<T: Lane> Source for T {
    type Lane = T;
    const IS_SHARED: bool = false;

    #[inline(always)]
    fn get(&self) -> T {
        *self
    }

    #[inline(always)]
    fn memory(slice: &[T]) -> Memory<'_, T> {
        Memory::Plain(slice)
    }
}

impl Source for AtomicU8 {
    type Lane = u8;
    const IS_SHARED: bool = true;

    #[inline(always)]
    fn get(&self) -> u8 {
        self.load(Relaxed)
    }

    #[inline(always)]
    fn memory(slice: &[Self]) -> Memory<'_, u8> {
        Memory::Shared(slice)
    }
}

#[bun_simd_macros::foreach_target]
mod simd {
    // Miri cannot run `asm!`.
    #[cfg(miri)]
    use crate::portable as shared;
    #[cfg(not(miri))]
    use isa as shared;
    use isa::Vector;

    impl<T: Lane, const N: usize> Vector<T, N> {
        pub fn load<S: Source<Lane = T>>(from: &[S; N]) -> Self {
            Self::load_nth::<S, 1, 0>(array::from_ref(from))
        }

        pub(crate) fn load4<S: Source<Lane = T>>(from: &[[S; N]; 4]) -> [Self; 4] {
            [
                Self::load_nth::<S, 4, 0>(from),
                Self::load_nth::<S, 4, 1>(from),
                Self::load_nth::<S, 4, 2>(from),
                Self::load_nth::<S, 4, 3>(from),
            ]
        }

        fn load_nth<S: Source<Lane = T>, const K: usize, const AT: usize>(
            from: &[[S; N]; K],
        ) -> Self {
            const { assert!(!S::IS_SHARED || N <= isa::U8::LEN, "wider than a register") };
            match S::memory(from.as_flattened()) {
                Memory::Plain(lanes) => Self::from_array(lanes.as_chunks().0[AT]),
                Memory::Shared(bytes) => Vector::new(shared::load_shared::<N, K, AT>(bytes)).cast(),
            }
        }
    }

    impl<const N: usize> Vector<u8, N> {
        pub fn store_shared(self, to: &[AtomicU8; N]) {
            self.store_nth_shared::<1, 0>(array::from_ref(to));
        }

        pub(crate) fn store4_shared([a, b, c, d]: [Self; 4], to: &[[AtomicU8; N]; 4]) {
            a.store_nth_shared::<4, 0>(to);
            b.store_nth_shared::<4, 1>(to);
            c.store_nth_shared::<4, 2>(to);
            d.store_nth_shared::<4, 3>(to);
        }

        fn store_nth_shared<const K: usize, const AT: usize>(self, to: &[[AtomicU8; N]; K]) {
            const { assert!(N <= isa::U8::LEN, "wider than a register") };
            shared::store_shared::<N, K, AT>(self.0, to.as_flattened());
        }
    }
}
