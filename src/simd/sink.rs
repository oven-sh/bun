//! What bytes are appended to.
use crate::{Int, Out, SharedOutU8, Writer};
use bun_simd_trusted::UNROLL;

/// A `Writer` of bytes, to plain or to shared memory. What follows the bytes is left as it is.
pub trait Sink {
    fn len(&self) -> usize;

    fn remaining(&self) -> usize;

    #[doc(hidden)]
    fn append_either(
        &mut self,
        plain: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        shared: impl FnOnce(&[SharedOutU8]) -> usize,
    );
}

impl Sink for Writer<'_, u8> {
    #[inline(always)]
    fn len(&self) -> usize {
        self.len()
    }

    #[inline(always)]
    fn remaining(&self) -> usize {
        self.remaining()
    }

    #[inline(always)]
    fn append_either(
        &mut self,
        plain: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        _: impl FnOnce(&[SharedOutU8]) -> usize,
    ) {
        self.append(plain);
    }
}

/// Fills shared memory from the start.
pub struct SharedWriter<'a> {
    rest: &'a [SharedOutU8],
    len: usize,
}

impl<'a> SharedWriter<'a> {
    #[inline(always)]
    pub fn new(rest: &'a [SharedOutU8]) -> Self {
        Self { rest, len: 0 }
    }
}

impl Sink for SharedWriter<'_> {
    #[inline(always)]
    fn len(&self) -> usize {
        self.len
    }

    #[inline(always)]
    fn remaining(&self) -> usize {
        self.rest.len()
    }

    #[inline(always)]
    fn append_either(
        &mut self,
        _: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        shared: impl FnOnce(&[SharedOutU8]) -> usize,
    ) {
        let added = shared(self.rest).min(self.rest.len());
        (self.rest, self.len) = (&self.rest[added..], self.len + added);
    }
}

#[bun_simd_macros::foreach_target]
mod simd {
    use isa::Vector;

    impl<const N: usize> Vector<u8, N>
    where
        u8: Int<N>,
    {
        /// Like `Out::fill_chunks`, from half a vector on. `f` may mix only the lanes of a half.
        pub fn append_chunks<A: Copy>(
            from: &[A],
            to: &mut impl Sink,
            f: impl Fn(&[A; N]) -> Option<Self>,
        ) {
            const {
                assert!(
                    N >= 16 && size_of::<A>().is_multiple_of(2),
                    "needs whole vectors as halves"
                )
            };
            let len = from.len().min(to.remaining());
            if len >= N {
                to.append_either(
                    |to| to.fill_chunks(from, |_, chunk| Some(f(chunk)?.to_array())),
                    |to| Self::fill_chunks_shared(&from[..len], &to[..len], &f),
                );
            } else if len >= N / 2 {
                let mut halves = [from[0]; N];
                let (first, last) = halves.split_at_mut(N / 2);
                for (to, from) in [(first, &from[..N / 2]), (last, &from[len - N / 2..len])] {
                    for (to, from) in to.iter_mut().zip(from) {
                        *to = *from;
                    }
                }
                if let Some(halves) = f(&halves) {
                    to.append_either(
                        |to| halves.store_halves(to.take(len)),
                        |to| halves.store_halves_shared(&to[..len]),
                    );
                }
            }
        }

        #[inline(always)]
        fn fill_chunks_shared<A>(
            from: &[A],
            to: &[SharedOutU8],
            f: &impl Fn(&[A; N]) -> Option<Self>,
        ) -> usize {
            let (len, mut filled) = (from.len(), 0);
            let _: Option<()> = try {
                let (last, to_last) = (from.split_last_chunk()?.1, to.split_last_chunk()?.1);
                let (chunks, rest) = from[..len - 1].as_chunks().0.as_chunks::<UNROLL>();
                let (to, to_rest) = to[..len - 1].as_chunks().0.as_chunks::<UNROLL>();
                for (from, to) in chunks.iter().zip(to) {
                    Self::fill_each_shared(from, to, &mut filled, f)?;
                }
                Self::fill_each_shared(rest, to_rest, &mut filled, f)?;
                f(last)?.store_shared(to_last);
                filled = len;
            };
            filled
        }

        #[inline(always)]
        fn fill_each_shared<A>(
            from: &[[A; N]],
            to: &[[SharedOutU8; N]],
            filled: &mut usize,
            f: &impl Fn(&[A; N]) -> Option<Self>,
        ) -> Option<()> {
            for (from, to) in from.iter().zip(to) {
                f(from)?.store_shared(to);
                *filled += N;
            }
            Some(())
        }

        /// As many of the first `len` lanes as fit. Panics if they fill the vector.
        pub fn append_partial(self, to: &mut impl Sink, len: usize) {
            assert!(len < N);
            to.append_either(
                |to| self.store_partial(to.take(len)),
                |to| self.store_partial_shared(&to[..len.min(to.len())]),
            );
        }
    }
}
