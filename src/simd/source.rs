//! What vectors are loaded from.
use crate::{Int, Lane, SharedOutU8, SharedU8};
use core::array;

/// A lane in memory: a plain value, or bytes that other threads may write concurrently.
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
    Shared(&'a [SharedU8]),
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

impl Source for SharedU8 {
    type Lane = u8;
    const IS_SHARED: bool = true;

    #[inline(always)]
    fn get(&self) -> u8 {
        self.get()
    }

    #[inline(always)]
    fn memory(slice: &[Self]) -> Memory<'_, u8> {
        Memory::Shared(slice)
    }
}

/// Little-endian, at any address.
impl Source for [SharedU8; 2] {
    type Lane = u16;
    const IS_SHARED: bool = true;

    #[inline(always)]
    fn get(&self) -> u16 {
        u16::from_le_bytes(SharedU8::get_two(self))
    }

    #[inline(always)]
    fn memory(slice: &[Self]) -> Memory<'_, u16> {
        Memory::Shared(slice.as_flattened())
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

        /// Needs only one address, even for shared memory.
        pub fn load4<S: Source<Lane = T>>(from: &[[S; N]; 4]) -> [Self; 4] {
            [
                Self::load_nth::<S, 4, 0>(from),
                Self::load_nth::<S, 4, 1>(from),
                Self::load_nth::<S, 4, 2>(from),
                Self::load_nth::<S, 4, 3>(from),
            ]
        }

        /// `from[at]`, for a loop that is unrolled: four need only one address too.
        pub fn load_at<S: Source<Lane = T>>(from: &[[S; N]], at: usize) -> Self {
            let four = from.as_chunks().0.get(at / 4).filter(|_| S::IS_SHARED);
            match (four, at % 4) {
                (Some(four), 1) => Self::load_nth::<S, 4, 1>(four),
                (Some(four), 2) => Self::load_nth::<S, 4, 2>(four),
                (Some(four), 3) => Self::load_nth::<S, 4, 3>(four),
                _ => Self::load(&from[at]),
            }
        }

        /// The first one, two or four chunks. The last one repeats.
        #[inline(always)]
        pub(crate) fn load_chunks<S: Source<Lane = T>>(from: &[S], k: usize) -> Option<[Self; 4]> {
            let chunks = from.as_chunks().0;
            Some(match k {
                4 => Self::load4(chunks.first_chunk()?),
                2 => {
                    let two = chunks.first_chunk()?;
                    let last = Self::load_nth::<S, 2, 1>(two);
                    [Self::load_nth::<S, 2, 0>(two), last, last, last]
                }
                1 => [Self::load(chunks.first()?); 4],
                _ => unreachable!(),
            })
        }

        pub(crate) fn load_nth<S: Source<Lane = T>, const K: usize, const AT: usize>(
            from: &[[S; N]; K],
        ) -> Self {
            const {
                let fits = size_of::<[S; N]>() <= isa::U8::LEN;
                assert!(!S::IS_SHARED || fits, "wider than a register")
            };
            Self::load_nth_of_any_width::<S, K, AT>(from)
        }

        /// For a branch that only the targets with such a width take.
        pub(crate) fn load_nth_of_any_width<
            S: Source<Lane = T>,
            const K: usize,
            const AT: usize,
        >(
            from: &[[S; N]; K],
        ) -> Self {
            match S::memory(if S::IS_SHARED {
                from.as_flattened()
            } else {
                &from[AT]
            }) {
                Memory::Plain(lanes) => Self::from_slice(lanes),
                Memory::Shared(bytes) => {
                    Self::from_first_bytes(shared::load_shared::<[S; N], K, AT>(bytes))
                }
            }
        }
    }

    impl<T: Int<N>, const N: usize> Vector<T, N> {
        /// Keeps LLVM from merging the ops before it with those after it. For a whole register.
        pub fn opaque(self) -> Self {
            const {
                assert!(
                    matches!(size_of::<Self>(), 16..=isa::U8::LEN),
                    "no register"
                )
            };
            isa::opaque_lanes(self)
        }
    }

    impl<const N: usize> Vector<u8, N> {
        pub fn store_shared(self, to: &[SharedOutU8; N]) {
            self.store_nth_shared::<1, 0>(array::from_ref(to));
        }

        pub(crate) fn store4_shared([a, b, c, d]: [Self; 4], to: &[[SharedOutU8; N]; 4]) {
            a.store_nth_shared::<4, 0>(to);
            b.store_nth_shared::<4, 1>(to);
            c.store_nth_shared::<4, 2>(to);
            d.store_nth_shared::<4, 3>(to);
        }

        fn store_nth_shared<const K: usize, const AT: usize>(self, to: &[[SharedOutU8; N]; K]) {
            const { assert!(N <= isa::U8::LEN, "wider than a register") };
            shared::store_shared::<N, K, AT>(self.0, to.as_flattened());
        }
    }
}
