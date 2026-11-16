//! Loops over slices of any length.
use crate::partial::copy_short;
use crate::{Int, Isa, Matches, Out, SharedOutU8, Source};
use core::hint::{likely, unlikely};

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
            Self::position_refined(slice, move |v| [test(v); 2])
        }

        /// `position` for the second test. The first one is cheaper, and holds wherever it does.
        pub fn position_refined<S: Source<Lane = T>>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            match const { size_of::<Self>() } {
                16 => Self::position_by::<S, 4>(slice, tests),
                32 => Self::position_by::<S, 2>(slice, tests),
                _ => Self::position_by::<S, 1>(slice, tests),
            }
        }

        /// The tests of `K` chunks that cover `slice`, and where they start.
        #[inline(always)]
        fn cover<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            test: &impl Fn(Self) -> Mask<T, N>,
        ) -> Option<[(Mask<T, N>, usize); K]> {
            const { assert!(matches!(K, 1 | 2 | 4)) };
            let room = slice.len().checked_sub(N)?;
            let at = |at: usize| Some((test(Self::load(slice.get(at..)?.first_chunk()?)), at));
            let mut all = [at(0)?; K];
            if K > 1 {
                all[K - 1] = at(room)?;
            }
            if K > 2 {
                (all[1], all[2]) = (at(N)?, at(room.checked_sub(N)?)?);
            }
            Some(all)
        }

        /// Where a match is within a block of `K` chunks is hard to predict, so nothing branches on it.
        #[inline(always)]
        fn position_by<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            let test = |v| tests(v)[1];
            let (len, first_in) = (slice.len(), |block| {
                Isa::first_set_of(Self::cover::<S, K>(block, &test)?)
            });
            let Some(first) = slice.get(..K * N) else {
                if len < N {
                    return Self::load_padded_inline(slice)
                        .and_then(|p| p.first_set(test(p.lanes)));
                }
                if K == 4 && len <= 2 * N {
                    return Isa::first_set_of(Self::cover::<S, 2>(slice, &test)?);
                }
                return first_in(slice);
            };
            let found = first_in(first);
            if likely(found.is_some()) {
                return found;
            }
            if len > 2 * K * N {
                return Self::position_far::<S, K>(slice, tests);
            }
            if len == K * N {
                return None;
            }
            first_in(&slice[len - K * N..]).map(|lane| len - K * N + lane)
        }

        /// After the first block. The registers that it needs cost the other paths nothing.
        #[inline(never)]
        fn position_far<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            let test = |v| tests(v)[1];
            let first_at = |at: usize| {
                let block = slice.get(at..)?.get(..K * N)?;
                Some(at + Isa::first_set_of(Self::cover::<S, K>(block, &test)?)?)
            };
            let (last, mut seen) = (slice.len().checked_sub(K * N)?, K * N);
            if last >= K * N + 4 * N {
                if K < 4 {
                    if let Some(found) = first_at(seen) {
                        return Some(found);
                    }
                    seen += K * N;
                }
                // Continue at an aligned address, so that no load crosses a cache line.
                seen -= slice.as_ptr().addr() % size_of::<[S; N]>() / size_of::<S>();
                let mut rest = &slice[seen..];
                while let Some(four) = rest.as_chunks().0.first_chunk() {
                    let [a, b, c, d] = Self::load4(four);
                    let holds = |i: usize| {
                        ((tests(a)[i] | tests(b)[i]) | (tests(c)[i] | tests(d)[i])).any()
                    };
                    if holds(0) && holds(1) {
                        break;
                    }
                    rest = &rest[4 * N..];
                }
                seen = slice.len() - rest.len();
            }
            while seen < slice.len() {
                let at = seen.min(last);
                if let Some(found) = first_at(at) {
                    return Some(found);
                }
                seen = at + K * N;
            }
            None
        }

        /// The last index for which `test` holds.
        pub fn rposition<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            match const { size_of::<Self>() } {
                16 | 32 => Self::rposition_by::<S, 2>(slice, test),
                _ => Self::rposition_by::<S, 1>(slice, test),
            }
        }

        #[inline(always)]
        fn rposition_by<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let (len, last_in) = (slice.len(), |block| {
                Isa::last_set_of(Self::cover::<S, K>(block, &test)?)
            });
            let Some(start) = len.checked_sub(K * N) else {
                if len < N {
                    return Self::load_padded_inline(slice).and_then(|p| p.last_set(test(p.lanes)));
                }
                return last_in(slice);
            };
            let found = last_in(&slice[start..]);
            if likely(found.is_some()) {
                return found.map(|lane| start + lane);
            }
            if len > 2 * K * N {
                return Self::rposition_far::<S, K>(slice, test);
            }
            if len == K * N {
                return None;
            }
            last_in(&slice[..K * N])
        }

        #[inline(never)]
        fn rposition_far<S: Source<Lane = T>, const K: usize>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let last_before = |end: usize| {
                let (before, block) = slice.get(..end)?.split_at(end.checked_sub(K * N)?);
                Some(before.len() + Isa::last_set_of(Self::cover::<S, K>(block, &test)?)?)
            };
            let mut unseen = slice.len().checked_sub(K * N)?;
            if unseen >= K * N + 4 * N {
                if let Some(found) = last_before(unseen) {
                    return Some(found);
                }
                let to_aligned = slice.as_ptr_range().end.addr().wrapping_neg();
                unseen -= K * N - to_aligned % size_of::<[S; N]>() / size_of::<S>();
                let mut rest = &slice[..unseen];
                while let Some(before) = rest.len().checked_sub(4 * N) {
                    let [a, b, c, d] = Self::load4(rest[before..].as_chunks().0.first_chunk()?);
                    if ((test(a) | test(b)) | (test(c) | test(d))).any() {
                        break;
                    }
                    rest = &rest[..before];
                }
                unseen = rest.len();
            }
            while unseen > 0 {
                let end = unseen.max(K * N);
                if let Some(found) = last_before(end) {
                    return Some(found);
                }
                unseen = end - K * N;
            }
            None
        }

        /// `position` with less code, for a match that is not far from the start.
        pub fn position_near<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let Some((before_last, last)) = slice.split_last_chunk() else {
                return Self::load_padded_inline(slice).and_then(|p| p.first_set(test(p.lanes)));
            };
            for (i, chunk) in slice[..slice.len() - 1].as_chunks().0.iter().enumerate() {
                if let Some(lane) = test(Self::load(chunk)).first_set() {
                    return Some(N * i + lane);
                }
            }
            Some(before_last.len() + test(Self::load(last)).first_set()?)
        }

        /// `rposition` with less code, for a match that is not far from the end.
        pub fn rposition_near<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            let mut rest = slice;
            while rest.len() > N {
                let (before, chunk) = rest.split_last_chunk()?;
                if let Some(lane) = test(Self::load(chunk)).last_set() {
                    return Some(before.len() + lane);
                }
                rest = before;
            }
            match slice.first_chunk() {
                Some(first) => test(Self::load(first)).last_set(),
                None => Self::load_padded_inline(slice).and_then(|p| p.last_set(test(p.lanes))),
            }
        }

        /// Gives `f` each `i` for which `test` holds for `a[i]` and `b[i]`, until it returns `Some`.
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
            let (a, b) = (Self::load_padded_inline(a)?, Self::load_padded_inline(b)?);
            let bits = a.to_bitmask(test(a.lanes, b.lanes));
            (bits != 0).then(|| Matches::from_bitmask(bits))
        }

        /// The number of indices for which `test` holds.
        pub fn count<S: Source<Lane = T>>(slice: &[S], test: impl Fn(Self) -> Mask<T, N>) -> usize {
            let Some((_, last)) = slice.split_last_chunk() else {
                return Self::load_padded_inline(slice).map_or(0, |p| p.count(test(p.lanes)));
            };
            if !isa::Isa::HAS_MASK_REGISTERS {
                let add = |sums, v| sums - U8::new(test(v).to_vector().first_bytes());
                return Self::sum_with::<S, 1>(slice, last, add) / size_of::<T>();
            }
            let (fours, rest) = slice[..slice.len() - 1].as_chunks().0.as_chunks();
            let overlap = slice.len().wrapping_neg() % N;
            let mut total = (test(Self::load(last)).to_bitmask() >> overlap).count_ones() as usize;
            #[rustc_unroll(never)]
            for four in fours {
                let [a, b, c, d] = Self::load4(four);
                total += (test(a).count() + test(b).count()) + (test(c).count() + test(d).count());
            }
            #[rustc_unroll(never)]
            for chunk in rest {
                total += test(Self::load(chunk)).count();
            }
            total
        }

        /// The sum of the bytes of `f(slice[i])`, each at most `MAX`, which is below 64. `f(0)` is 0.
        pub fn sum_of_bytes<S: Source<Lane = T>, const MAX: usize>(
            slice: &[S],
            f: impl Fn(Self) -> U8,
        ) -> usize {
            let Some((_, last)) = slice.split_last_chunk() else {
                let sums = Self::load_padded_inline(slice).map(|p| U64::sums_of_8(f(p.lanes)));
                return sums.map_or(0, |sums| sums.reduce_sum() as usize);
            };
            Self::sum_with::<S, MAX>(slice, last, |sums, v| sums + f(v))
        }

        /// `add` adds up to `MAX` to each byte.
        #[inline(always)]
        fn sum_with<S: Source<Lane = T>, const MAX: usize>(
            slice: &[S],
            last: &[S; N],
            add: impl Fn(U8, Self) -> U8,
        ) -> usize {
            const STEP: &[u8; 128] = &core::array::from_fn(const |i| if i < 64 { 0 } else { 0xFF });
            const { assert!(size_of::<Self>() == U8::LEN, "has to fill a register") };
            const { assert!(matches!(MAX, 1..64)) };
            let (fours, rest) = slice[..slice.len() - 1].as_chunks().0.as_chunks();
            let overlap = size_of_val(slice).wrapping_neg() % U8::LEN;
            let mut sums =
                add(U8::zero(), Self::load(last)) & U8::from_slice(&STEP[64 - overlap..]);
            #[rustc_unroll(never)]
            for chunk in rest {
                sums = add(sums, Self::load(chunk));
            }
            let mut total = U64::sums_of_8(sums);
            for fours in fours.chunks(255 / 4 / MAX) {
                // One sum would wait for itself.
                let mut sums = [U8::zero(); 4];
                #[rustc_unroll(never)]
                for four in fours {
                    let [a, b, c, d] = Self::load4(four);
                    sums = [
                        add(sums[0], a),
                        add(sums[1], b),
                        add(sums[2], c),
                        add(sums[3], d),
                    ];
                }
                total += U64::sums_of_8((sums[0] + sums[1]) + (sums[2] + sums[3]));
            }
            total.reduce_sum() as usize
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
            match Self::load_pieces(&from[..to.len()]) {
                Some(pieces) => f(pieces).store_pieces(to),
                None => &mut [],
            }
        }

        /// `slice[i] = f(slice[i])`
        pub fn map_in_place(slice: &mut [T], f: impl Fn(Self) -> Self) {
            let Some((_, last)) = slice.split_last_chunk() else {
                if let Some(pieces) = Self::load_pieces(slice) {
                    f(pieces).store_pieces(slice.into());
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
                let (a, b) = (Self::load_pieces(slice), Self::load_pieces(other));
                if let (Some(a), Some(b)) = (a, b) {
                    f(a, b).store_pieces(slice.into());
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
        /// Like `map`. `from` and `to` may be the same bytes.
        pub fn map_to_shared<S: Source<Lane = u8>>(
            from: &[S],
            to: &[SharedOutU8],
            f: impl Fn(Self) -> Self,
        ) {
            Self::map_to_shared_until(from, to, f, |v| v.simd_ne(v));
        }

        /// The same up to the first element that `stops`. Returns the count.
        pub fn map_to_shared_until<S: Source<Lane = u8>>(
            from: &[S],
            to: &[SharedOutU8],
            f: impl Fn(Self) -> Self,
            stops: impl Fn(Self) -> Mask<u8, N>,
        ) -> usize {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &to[..len]);
            let (v, rest): (Self, &[SharedOutU8]) = 'stopped: {
                let (Some((_, last)), Some((_, to_last))) =
                    (from.split_last_chunk(), to.split_last_chunk())
                else {
                    let Some(pieces) = Self::load_pieces(from) else {
                        return 0;
                    };
                    match pieces.join(len) {
                        Some(v) if stops(pieces).any() => break 'stopped (v, to),
                        _ => return f(pieces).store_pieces_shared(to),
                    }
                };
                let last = Self::load(last);
                let mut from = from[..len - 1].as_chunks().0;
                let mut to = to[..len - 1].as_chunks().0;
                while let (Some((four, rest)), Some((to_four, to_rest))) =
                    (from.split_first_chunk(), to.split_first_chunk())
                {
                    let [a, b, c, d] = Self::load4(four);
                    if (stops(a) | stops(b) | stops(c) | stops(d)).any() {
                        break;
                    }
                    Self::store4_shared([f(a), f(b), f(c), f(d)], to_four);
                    (from, to) = (rest, to_rest);
                }
                for (from, to) in from.iter().zip(to) {
                    let v = Self::load(from);
                    if stops(v).any() {
                        break 'stopped (v, to);
                    }
                    f(v).store_shared(to);
                }
                if stops(last).any() {
                    break 'stopped (last, to_last);
                }
                f(last).store_shared(to_last);
                return len;
            };
            let count = stops(v).first_set().unwrap_or(0).min(rest.len());
            rest.as_ptr().addr() - to.as_ptr().addr() + f(v).store_partial_shared(&rest[..count])
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
