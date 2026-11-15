//! What bytes are appended to.
use crate::{Int, Out, Writer};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A `Writer` of bytes, to plain or to shared memory. What follows the bytes is left as it is.
pub trait Sink {
    fn len(&self) -> usize;

    fn remaining(&self) -> usize;

    /// Pushes `f(item)` for each item, until it is `None` or there is no room.
    fn extend_with<A>(&mut self, items: &[A], f: impl FnMut(&A) -> Option<u8>);

    #[doc(hidden)]
    fn append_either(
        &mut self,
        plain: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        shared: impl FnOnce(&[AtomicU8]) -> usize,
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
    fn extend_with<A>(&mut self, items: &[A], mut f: impl FnMut(&A) -> Option<u8>) {
        self.extend_with(items, |item| Some([f(item)?]));
    }

    #[inline(always)]
    fn append_either(
        &mut self,
        plain: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        _: impl FnOnce(&[AtomicU8]) -> usize,
    ) {
        self.append(plain);
    }
}

/// Fills shared memory from the start.
pub struct SharedWriter<'a> {
    rest: &'a [AtomicU8],
    len: usize,
}

impl<'a> SharedWriter<'a> {
    #[inline(always)]
    pub fn new(rest: &'a [AtomicU8]) -> Self {
        Self { rest, len: 0 }
    }

    #[inline(always)]
    fn advance(&mut self, by: usize) {
        (self.rest, self.len) = (&self.rest[by..], self.len + by);
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
    fn extend_with<A>(&mut self, items: &[A], mut f: impl FnMut(&A) -> Option<u8>) {
        let mut added = 0;
        for (to, item) in self.rest.iter().zip(items) {
            let Some(byte) = f(item) else { break };
            to.store(byte, Relaxed);
            added += 1;
        }
        self.advance(added);
    }

    #[inline(always)]
    fn append_either(
        &mut self,
        _: impl for<'a> FnOnce(Out<'a, u8>) -> &'a mut [u8],
        shared: impl FnOnce(&[AtomicU8]) -> usize,
    ) {
        self.advance(shared(self.rest));
    }
}

#[bun_simd_macros::foreach_target]
mod simd {
    use isa::Vector;

    impl<const N: usize> Vector<u8, N>
    where
        u8: Int<N>,
    {
        /// Like `Out::fill_chunks`, but returns the count. `from` may be where the bytes go.
        pub fn append_chunks<A>(
            to: &mut impl Sink,
            from: &[A],
            f: impl Fn(usize, &[A; N]) -> Option<Self>,
        ) -> usize {
            let start = to.len();
            to.append_either(
                |to| to.fill_chunks(from, |at, chunk| Some(f(at, chunk)?.to_array())),
                |to| Self::fill_chunks_shared(to, from, &f),
            );
            to.len() - start
        }

        #[inline(always)]
        fn fill_chunks_shared<A>(
            to: &[AtomicU8],
            from: &[A],
            f: &impl Fn(usize, &[A; N]) -> Option<Self>,
        ) -> usize {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &to[..len]);
            let (Some((_, last)), Some((_, to_last))) =
                (from.split_last_chunk(), to.split_last_chunk())
            else {
                return 0;
            };
            let last = f(len - N, last);
            let (chunks, mut filled) = (from[..len - 1].as_chunks().0, 0);
            #[cfg_attr(target_arch = "aarch64", rustc_unroll(4))]
            for (from, to) in chunks.iter().zip(to[..len - 1].as_chunks().0) {
                let Some(v) = f(filled, from) else {
                    return filled;
                };
                v.store_shared(to);
                filled += N;
            }
            let Some(last) = last else {
                return filled;
            };
            last.store_shared(to_last);
            len
        }

        /// Like `store_partial` for `len` bytes. Panics if they do not fit, or fill the vector.
        pub fn append_partial(self, to: &mut impl Sink, len: usize) {
            assert!(len < N && len <= to.remaining());
            to.append_either(
                |to| self.store_partial_inline(to.take(len)),
                |to| {
                    self.store_partial_shared(&to[..len]);
                    len
                },
            );
        }
    }
}
