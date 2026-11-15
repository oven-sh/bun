//! Loops over slices of any length.
use crate::partial::copy_short;
use crate::{Int, Isa, Matches, Out, Source};
use core::hint::unlikely;
use core::sync::atomic::AtomicU8;

#[inline(always)]
fn index_of<S, const N: usize>(chunk: &[S; N], slice: &[S]) -> usize {
    (chunk.as_ptr().addr() - slice.as_ptr().addr()) / size_of::<S>()
}

/// `slice` in blocks for `bitmasks`. What is left of it is copied to the start of `padding`.
#[inline(always)]
pub fn blocks<'a, T: Copy>(
    slice: &'a [T],
    padding: &'a mut [T; 64],
) -> impl Iterator<Item = &'a [T; 64]> {
    let (whole, rest) = slice.as_chunks();
    copy_short(rest, padding[..rest.len()].as_mut().into());
    let last = core::slice::from_ref(&*padding);
    let (mut blocks, mut last) = (whole.iter(), &last[..usize::from(!rest.is_empty())]);
    // One comparison for each block, unlike `chain`.
    core::iter::from_fn(move || {
        if blocks.as_slice().is_empty() {
            blocks = core::mem::take(&mut last).iter();
        }
        blocks.next()
    })
}

#[bun_simd_macros::foreach_target]
mod simd {
    use isa::{Mask, U8, U64, Vector};

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

        /// `rposition` with less code, for a match that is not far from the end.
        pub fn rposition_near(slice: &[T], test: impl Fn(Self) -> Mask<T, N>) -> Option<usize> {
            let Some(first) = slice.first_chunk() else {
                return Self::load_partial_inline(slice).and_then(|p| p.last_set(test(p.lanes)));
            };
            for chunk in slice[1..].as_rchunks().1.iter().rev() {
                if let Some(lane) = test(Self::load(chunk)).last_set() {
                    return Some(index_of(chunk, slice) + lane);
                }
            }
            test(Self::load(first)).last_set()
        }

        /// Gives `f` the indices for which `test` holds, one or more at a time, until it returns `Some`.
        pub fn find_map<R>(
            slice: &[T],
            test: impl Fn(Self) -> Mask<T, N>,
            f: impl FnMut(Matches) -> Option<R>,
        ) -> Option<R> {
            Self::zip_find_map(slice, slice, |v, _| test(v), f)
        }

        /// `find_map` with a test of `a[i]` and `b[i]`.
        pub fn zip_find_map<S: Source<Lane = T>, R>(
            a: &[S],
            b: &[S],
            test: impl Fn(Self, Self) -> Mask<T, N>,
            mut f: impl FnMut(Matches) -> Option<R>,
        ) -> Option<R> {
            let len = a.len().min(b.len());
            let (a, b) = (&a[..len], &b[..len]);
            if len < N {
                return Self::matches_in_short(a, b, test).and_then(f);
            }
            let mut seen = 0;
            while seen < len {
                let (mask, start) = Self::first_match_from(seen, a, b, &test)?;
                let matches = Matches::new(mask, start).skip_lanes(seen.saturating_sub(start))?;
                if let Some(found) = f(matches) {
                    return Some(found);
                }
                seen = start + N;
            }
            None
        }

        /// `zip_find_map` with less code, for short slices.
        pub fn zip_find_map_near<S: Source<Lane = T>, R>(
            a: &[S],
            b: &[S],
            test: impl Fn(Self, Self) -> Mask<T, N>,
            mut f: impl FnMut(Matches) -> Option<R>,
        ) -> Option<R> {
            let len = a.len().min(b.len());
            let (a, b) = (&a[..len], &b[..len]);
            let (Some((_, last_a)), Some((_, last_b))) =
                (a.split_last_chunk(), b.split_last_chunk())
            else {
                return Self::matches_in_short(a, b, test).and_then(f);
            };
            let [chunks_a, chunks_b] = [a, b].map(|it| it[..len - 1].as_chunks().0);
            for (chunk_a, chunk_b) in chunks_a.iter().zip(chunks_b) {
                let mask = test(Self::load(chunk_a), Self::load(chunk_b));
                if unlikely(mask.any())
                    && let Some(found) = f(Matches::new(mask, index_of(chunk_a, a)))
                {
                    return Some(found);
                }
            }
            let mask = test(Self::load(last_a), Self::load(last_b));
            if mask.none() {
                return None;
            }
            f(Matches::new(mask, len - N).skip_lanes(N - 1 - (len - 1) % N)?)
        }

        /// The first chunk with a match, and where it starts. The last one may start before `from`.
        #[inline(always)]
        fn first_match_from<S: Source<Lane = T>>(
            from: usize,
            a: &[S],
            b: &[S],
            test: &impl Fn(Self, Self) -> Mask<T, N>,
        ) -> Option<(Mask<T, N>, usize)> {
            let chunks_from = |at: usize| [a, b].map(|it| it[at..it.len() - 1].as_chunks().0);
            let [mut rest_a, mut rest_b] = chunks_from(from);
            if let ([first_a, _, _, _, ..], [first_b, ..]) = (rest_a, rest_b) {
                let mask = test(Self::load(first_a), Self::load(first_b));
                if mask.any() {
                    return Some((mask, from));
                }
                let past_aligned = first_a.as_ptr().addr() % size_of::<[T; N]>() / size_of::<T>();
                let (pairs_a, pairs_b);
                [(pairs_a, rest_a), (pairs_b, rest_b)] =
                    chunks_from(from + N - past_aligned).map(<[_]>::as_chunks);
                for (pair_a, pair_b) in pairs_a.iter().zip(pairs_b) {
                    let [first, second] = Self::test_pair(pair_a, pair_b, test);
                    let either = first | second;
                    if either.any() {
                        let start = index_of(&pair_a[0], a);
                        let is_first = first.any();
                        return Some(if is_first {
                            (first, start)
                        } else {
                            (either, start + N)
                        });
                    }
                }
            }
            for (chunk_a, chunk_b) in rest_a.iter().zip(rest_b) {
                let mask = test(Self::load(chunk_a), Self::load(chunk_b));
                if mask.any() {
                    return Some((mask, index_of(chunk_a, a)));
                }
            }
            let (last_a, last_b) = (a.split_last_chunk()?.1, b.split_last_chunk()?.1);
            let mask = test(Self::load(last_a), Self::load(last_b));
            mask.any().then_some((mask, a.len() - N))
        }

        /// `zip_find_map` from the end.
        pub fn zip_rfind_map<S: Source<Lane = T>, R>(
            a: &[S],
            b: &[S],
            test: impl Fn(Self, Self) -> Mask<T, N>,
            mut f: impl FnMut(Matches) -> Option<R>,
        ) -> Option<R> {
            let len = a.len().min(b.len());
            let (a, b) = (&a[..len], &b[..len]);
            if len < N {
                return Self::matches_in_short(a, b, test).and_then(f);
            }
            let mut unseen = len;
            while unseen > 0 {
                let (mask, start) = Self::last_match_until(unseen, a, b, &test)?;
                let matches = Matches::new(mask, start).take_lanes((unseen - start).min(N))?;
                if let Some(found) = f(matches) {
                    return Some(found);
                }
                unseen = start;
            }
            None
        }

        /// The last chunk with a match, and where it starts. The first one may end after `until`.
        #[inline(always)]
        fn last_match_until<S: Source<Lane = T>>(
            until: usize,
            a: &[S],
            b: &[S],
            test: &impl Fn(Self, Self) -> Mask<T, N>,
        ) -> Option<(Mask<T, N>, usize)> {
            let chunks_until = |at: usize| [a, b].map(|it| it[1..at].as_rchunks().1);
            let [mut rest_a, mut rest_b] = chunks_until(until);
            if let ([.., _, _, _, last_a], [.., last_b]) = (rest_a, rest_b) {
                let mask = test(Self::load(last_a), Self::load(last_b));
                if mask.any() {
                    return Some((mask, until - N));
                }
                let to_aligned = last_a.as_ptr().addr().wrapping_neg() % size_of::<[T; N]>();
                let (pairs_a, pairs_b);
                [(rest_a, pairs_a), (rest_b, pairs_b)] =
                    chunks_until(until - N + to_aligned / size_of::<T>()).map(<[_]>::as_rchunks);
                for (pair_a, pair_b) in pairs_a.iter().zip(pairs_b).rev() {
                    let [first, second] = Self::test_pair(pair_a, pair_b, test);
                    let either = first | second;
                    if either.any() {
                        let start = index_of(&pair_a[0], a);
                        let is_second = second.any();
                        return Some(if is_second {
                            (second, start + N)
                        } else {
                            (either, start)
                        });
                    }
                }
            }
            for (chunk_a, chunk_b) in rest_a.iter().zip(rest_b).rev() {
                let mask = test(Self::load(chunk_a), Self::load(chunk_b));
                if mask.any() {
                    return Some((mask, index_of(chunk_a, a)));
                }
            }
            let mask = test(Self::load(a.first_chunk()?), Self::load(b.first_chunk()?));
            mask.any().then_some((mask, 0))
        }

        #[inline(always)]
        fn test_pair<S: Source<Lane = T>>(
            a: &[[S; N]; 2],
            b: &[[S; N]; 2],
            test: &impl Fn(Self, Self) -> Mask<T, N>,
        ) -> [Mask<T, N>; 2] {
            [
                test(Self::load_nth::<S, 2, 0>(a), Self::load_nth::<S, 2, 0>(b)),
                test(Self::load_nth::<S, 2, 1>(a), Self::load_nth::<S, 2, 1>(b)),
            ]
        }

        #[inline(always)]
        fn matches_in_short<S: Source<Lane = T>>(
            a: &[S],
            b: &[S],
            test: impl Fn(Self, Self) -> Mask<T, N>,
        ) -> Option<Matches> {
            let (a, b) = (Self::load_partial_inline(a)?, Self::load_partial_inline(b)?);
            let bits = a.to_bitmask(test(a.lanes, b.lanes));
            (bits != 0).then(|| Matches::from_bitmask(bits))
        }

        /// The number of indices for which `test` holds.
        pub fn count<S: Source<Lane = T>>(slice: &[S], test: impl Fn(Self) -> Mask<T, N>) -> usize {
            Self::count_each(slice, |v| [test(v)])[0]
        }

        /// `count` for each of `K` tests.
        pub fn count_each<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; K],
        ) -> [usize; K] {
            const { assert!(size_of::<Self>() == U8::LEN, "has to fill a register") };
            let mut totals = [0; K];
            let Some((_, last)) = slice.split_last_chunk() else {
                if let Some(partial) = Self::load_partial_inline(slice) {
                    let masks = tests(partial.lanes);
                    for k in 0..K {
                        totals[k] = partial.to_bitmask(masks[k]).count_ones() as usize;
                    }
                }
                return totals;
            };
            let (fours, rest) = slice[..slice.len() - 1].as_chunks().0.as_chunks();
            for block in fours.chunks(63) {
                // One sum would wait for itself if the tests are short.
                let (mut counts, ways) = ([[U8::zero(); K]; 4], if K == 1 { 4 } else { 1 });
                #[rustc_unroll(never)]
                for four in block {
                    let [a, b, c, d] = Self::load4(four);
                    let masks = [tests(a), tests(b), tests(c), tests(d)];
                    for i in 0..4 {
                        for k in 0..K {
                            if isa::Isa::HAS_MASK_REGISTERS {
                                totals[k] += masks[i][k].count();
                            } else {
                                counts[i % ways][k] -=
                                    U8::new(masks[i][k].to_vector().first_bytes());
                            }
                        }
                    }
                }
                for k in 0..K {
                    let counts = (counts[0][k] + counts[1][k]) + (counts[2][k] + counts[3][k]);
                    totals[k] += U64::sums_of_8(counts).reduce_sum() as usize / size_of::<T>();
                }
            }
            #[rustc_unroll(never)]
            for chunk in rest {
                let masks = tests(Self::load(chunk));
                for k in 0..K {
                    totals[k] += masks[k].count();
                }
            }
            let masks = tests(Self::load(last));
            for k in 0..K {
                totals[k] += masks[k].count_from(N - 1 - (slice.len() - 1) % N);
            }
            totals
        }

        /// `to[i] = f(from[i])`. `f` may mix groups of 2, 4 or 8 lanes if the length is a multiple.
        pub fn map<'a, S: Source<Lane = T>>(
            from: &[S],
            to: Out<'a, T>,
            f: impl Fn(Self) -> Self,
        ) -> &'a mut [T] {
            let to = to.take(from.len());
            if to.len() >= N {
                return to.fill_chunks(from, |_, chunk| Some(f(Self::load(chunk)).to_array()));
            }
            match Self::load_partial_inline(&from[..to.len()]) {
                Some(partial) => f(partial.lanes).store_partial(to),
                None => &mut [],
            }
        }

        /// `slice[i] = f(slice[i])`
        pub fn map_in_place(slice: &mut [T], f: impl Fn(Self) -> Self) {
            let Some((_, last)) = slice.split_last_chunk() else {
                if let Some(partial) = Self::load_partial_inline(slice) {
                    f(partial.lanes).store_partial(slice.into());
                }
                return;
            };
            // Loaded first, because it overlaps the chunk before it.
            let last = f(Self::load(last));
            let len = slice.len();
            #[rustc_unroll(4)]
            for chunk in slice[..len - 1].as_chunks_mut().0 {
                f(Self::load(chunk)).store(chunk);
            }
            if let Some((_, to)) = slice.split_last_chunk_mut() {
                last.store(to);
            }
        }

        /// `slice[i] = f(slice[i], other[i])`. Panics if `other` is shorter.
        pub fn zip_in_place(slice: &mut [T], other: &[T], f: impl Fn(Self, Self) -> Self) {
            let (len, other) = (slice.len(), &other[..slice.len()]);
            let (Some((_, a)), Some((_, b))) = (slice.split_last_chunk(), other.split_last_chunk())
            else {
                let (a, b) = (
                    Self::load_partial_inline(slice),
                    Self::load_partial_inline(other),
                );
                if let (Some(a), Some(b)) = (a, b) {
                    f(a.lanes, b.lanes).store_partial(slice.into());
                }
                return;
            };
            let last = f(Self::load(a), Self::load(b));
            let others = other[..len - 1].as_chunks().0;
            #[rustc_unroll(4)]
            for (a, b) in slice[..len - 1].as_chunks_mut().0.iter_mut().zip(others) {
                f(Self::load(a), Self::load(b)).store(a);
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
            Self::bitmasks_of_chunks(block, |chunk| tests(Self::load(chunk)))
        }

        /// The same for elements of any type.
        pub fn bitmasks_of_chunks<A, const K: usize>(
            block: &[A; 64],
            tests: impl Fn(&[A; N]) -> [Mask<u8, N>; K],
        ) -> [u64; K] {
            let chunks = block.as_chunks().0;
            let mut bits = [0; K];
            if N == 16 {
                let at = |i: usize| tests(&chunks[i]);
                let [a, b, c, d] = [at(0), at(1), at(2), at(3)];
                for k in 0..K {
                    bits[k] = Isa::bitmask_of_four([a[k], b[k], c[k], d[k]]);
                }
                return bits;
            }
            for i in 0..64 / N {
                let masks = tests(&chunks[i]);
                for k in 0..K {
                    bits[k] |= masks[k].to_bitmask() << (i * N);
                }
            }
            bits
        }
    }
}
