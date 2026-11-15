//! Loops over slices of any length.
use crate::{Int, Source};
use core::sync::atomic::AtomicU8;

#[inline(always)]
fn index_of<S, const N: usize>(chunk: &[S; N], slice: &[S]) -> usize {
    (chunk.as_ptr().addr() - slice.as_ptr().addr()) / size_of::<S>()
}

#[bun_simd_macros::foreach_target]
mod simd {
    use isa::{I8, Mask, U8, U64, Vector};

    impl<T: Int<N>, const N: usize> Vector<T, N> {
        /// The first index for which `test` holds.
        pub fn position<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let Some((_, last)) = slice.split_last_chunk() else {
                return Self::load_partial_inline(slice).and_then(|p| p.first_set(test(p.lanes)));
            };
            let body = &slice[..slice.len() - 1];
            let mut rest = body.as_chunks().0;
            if let Some(near) = rest.first_chunk::<4>() {
                for (i, chunk) in near.iter().enumerate() {
                    if let Some(lane) = test(Self::load(chunk)).first_set() {
                        return Some(i * N + lane);
                    }
                }
                // Continue at an aligned address, so that no load crosses a cache line.
                let seen = 4 * N - slice.as_ptr().addr() % size_of::<[S; N]>() / size_of::<S>();
                let fours;
                (fours, rest) = body.get(seen..).unwrap_or(body).as_chunks().0.as_chunks();
                for four in fours {
                    let [a, b, c, d] = Self::load4(four);
                    let [a, b, c, d] = [test(a), test(b), test(c), test(d)];
                    // As good as `b` and `d` if there is no match before, and SSE needs no copies.
                    let (b, d) = (a | b, (a | b) | (c | d));
                    if d.any() {
                        if !S::IS_SHARED {
                            rest = four;
                            break;
                        }
                        // Keeps LLVM from adding a counter to the loop.
                        let start = index_of(core::hint::black_box(&four[0]), slice);
                        // A second read may not see the match.
                        for (i, mask) in [a, b, c, d].into_iter().enumerate() {
                            if let Some(lane) = mask.first_set() {
                                return Some(start + i * N + lane);
                            }
                        }
                    }
                }
            }
            for chunk in rest {
                if let Some(lane) = test(Self::load(chunk)).first_set() {
                    return Some(index_of(chunk, slice) + lane);
                }
            }
            let found = test(Self::load(last)).first_set();
            found.map(|lane| slice.len() - N + lane)
        }

        /// `position` in `slice[..len]`. Reads past `len`, so that a short `len` needs no branch.
        pub fn position_within<S: Source<Lane = T>>(
            slice: &[S],
            len: usize,
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            if let Some(first) = slice.first_chunk() {
                let lane = test(Self::load(first)).first_set().unwrap_or(N);
                if lane < N || len <= N {
                    return (lane < len).then_some(lane);
                }
            }
            Self::position(&slice[..len.min(slice.len())], test)
        }

        /// The last index for which `test` holds.
        pub fn rposition<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let Some(first) = slice.first_chunk() else {
                return Self::load_partial_inline(slice).and_then(|p| p.last_set(test(p.lanes)));
            };
            let body = &slice[1..];
            let mut rest = body.as_rchunks().1;
            if let Some((_, near)) = rest.split_last_chunk::<4>() {
                for chunk in near.iter().rev() {
                    if let Some(lane) = test(Self::load(chunk)).last_set() {
                        return Some(index_of(chunk, slice) + lane);
                    }
                }
                let to_aligned = slice.as_ptr_range().end.addr().wrapping_neg();
                let seen = 4 * N - to_aligned % size_of::<[S; N]>() / size_of::<S>();
                let unseen = body.get(..body.len() - seen).unwrap_or(body);
                let fours;
                (rest, fours) = unseen.as_rchunks().1.as_rchunks();
                for four in fours.iter().rev() {
                    let [a, b, c, d] = Self::load4(four);
                    let [a, b, c, d] = [test(a), test(b), test(c), test(d)];
                    let (c, a) = (c | d, (a | b) | (c | d));
                    if a.any() {
                        if !S::IS_SHARED {
                            rest = four;
                            break;
                        }
                        for (i, mask) in [a, b, c, d].into_iter().enumerate().rev() {
                            if let Some(lane) = mask.last_set() {
                                return Some(index_of(&four[i], slice) + lane);
                            }
                        }
                    }
                }
            }
            for chunk in rest.iter().rev() {
                if let Some(lane) = test(Self::load(chunk)).last_set() {
                    return Some(index_of(chunk, slice) + lane);
                }
            }
            test(Self::load(first)).last_set()
        }

        /// `to[i] = f(from[i])`. `f` may mix groups of 2, 4 or 8 lanes if the length is a multiple.
        pub fn map<S: Source<Lane = T>>(from: &[S], to: &mut [T], f: impl Fn(Self) -> Self) {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &mut to[..len]);
            let Some((_, last)) = from.split_last_chunk() else {
                if let Some(partial) = Self::load_partial_inline(from) {
                    f(partial.lanes).store_partial(to);
                }
                return;
            };
            let chunks = from[..len - 1].as_chunks().0;
            for (from, to) in chunks.iter().zip(to.as_chunks_mut().0) {
                f(Self::load(from)).store(to);
            }
            if let Some((_, to)) = to.split_last_chunk_mut() {
                f(Self::load(last)).store(to);
            }
        }

        /// `slice[i] = f(slice[i])`
        pub fn map_in_place(slice: &mut [T], f: impl Fn(Self) -> Self) {
            let Some((_, last)) = slice.split_last_chunk() else {
                if let Some(partial) = Self::load_partial_inline(slice) {
                    f(partial.lanes).store_partial(slice);
                }
                return;
            };
            // Loaded first, because it overlaps the chunk before it.
            let last = f(Self::load(last));
            let len = slice.len();
            for chunk in slice[..len - 1].as_chunks_mut().0 {
                f(Self::load(chunk)).store(chunk);
            }
            if let Some((_, to)) = slice.split_last_chunk_mut() {
                last.store(to);
            }
        }
    }

    impl<const N: usize> Vector<u8, N>
    where
        u8: Int<N>,
    {
        /// Like `map`. `from` may be `to`.
        pub fn map_to_shared<S: Source<Lane = u8>>(
            from: &[S],
            to: &[AtomicU8],
            f: impl Fn(Self) -> Self,
        ) {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &to[..len]);
            let (Some((_, last)), Some((_, to_last))) =
                (from.split_last_chunk(), to.split_last_chunk())
            else {
                if let Some(partial) = Self::load_partial_inline(from) {
                    f(partial.lanes).store_partial_shared(to);
                }
                return;
            };
            let last = f(Self::load(last));
            let (fours, from) = from[..len - 1].as_chunks().0.as_chunks();
            let (to_fours, to) = to[..len - 1].as_chunks().0.as_chunks();
            for (from, to) in fours.iter().zip(to_fours) {
                let [a, b, c, d] = Self::load4(from);
                Self::store4_shared([f(a), f(b), f(c), f(d)], to);
            }
            for (from, to) in from.iter().zip(to) {
                f(Self::load(from)).store_shared(to);
            }
            last.store_shared(to_last);
        }

        /// One bit per byte of `block`, for each of `K` tests.
        pub fn bitmasks<const K: usize>(
            block: &[u8; 64],
            tests: impl Fn(Self) -> [Mask<u8, N>; K],
        ) -> [u64; K] {
            let chunks = block.as_chunks().0;
            let mut bits = [0; K];
            if N == 16 {
                let at = |i: usize| tests(Self::load(&chunks[i]));
                let [a, b, c, d] = [at(0), at(1), at(2), at(3)];
                for k in 0..K {
                    bits[k] = crate::Isa::bitmask_of_four([a[k], b[k], c[k], d[k]]);
                }
                return bits;
            }
            for i in 0..64 / N {
                let masks = tests(Self::load(&chunks[i]));
                for k in 0..K {
                    bits[k] |= masks[k].to_bitmask() << (i * N);
                }
            }
            bits
        }
    }

    impl U8 {
        /// The number of bytes for which `test` holds.
        pub fn count<S: Source<Lane = u8>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<u8, { U8::LEN }>,
        ) -> usize {
            let Some((_, last)) = slice.split_last_chunk() else {
                let bits =
                    Self::load_partial_inline(slice).map_or(0, |p| p.to_bitmask(test(p.lanes)));
                return bits.count_ones() as usize;
            };
            let chunks = slice[..slice.len() - 1].as_chunks().0;
            let overlap = Self::LEN - 1 - (slice.len() - 1) % Self::LEN;
            let is_new = I8::iota().simd_gt(overlap as i8 - 1).cast();
            let mut sums = U64::sums_of_8((test(Self::load(last)) & is_new).to_vector() & 1);
            for mut block in chunks.chunks(if S::IS_SHARED { 252 } else { 255 }) {
                let mut counts = Self::zero();
                // LLVM does not unroll a loop that contains `asm!`.
                if S::IS_SHARED {
                    let fours;
                    (fours, block) = block.as_chunks();
                    for four in fours {
                        let [a, b, c, d] = Self::load4(four);
                        let count = |v| test(v).to_vector();
                        counts -= (count(a) + count(b)) + (count(c) + count(d));
                    }
                }
                for chunk in block {
                    counts -= test(Self::load(chunk)).to_vector();
                }
                sums += U64::sums_of_8(counts);
            }
            sums.reduce_sum() as usize
        }
    }
}
