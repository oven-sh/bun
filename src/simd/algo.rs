//! Loops over slices of any length.
use crate::partial::copy_short;
use crate::{Int, Isa, Matches, Out, Padded, SharedOutU8, Source};
use bun_simd_trusted::quarters;
use core::hint::{black_box, cold_path, likely};
use core::ops::Range;

#[inline(always)]
fn of_same_len<S, const P: usize>(mut slices: [&[S]; P]) -> [&[S]; P] {
    let len = slices
        .iter()
        .fold(usize::MAX, |len, slice| len.min(slice.len()));
    for slice in &mut slices {
        *slice = &slice[..len];
    }
    slices
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
        /// The lanes in 64 bytes. Nothing branches on where a match is among them.
        pub const BLOCK_LEN: usize = 64 / size_of::<T>();
        const PER_BLOCK: usize = match size_of::<Self>() {
            16 | 32 | 64 => Self::BLOCK_LEN / N,
            _ => panic!("needs 16, 32 or 64 bytes"),
        };
        /// The chunks that `rposition` and `position` test at once.
        const PER_STEP: [usize; 2] = [if Self::PER_BLOCK > 1 { 2 } else { 1 }, Self::PER_BLOCK];

        /// The first index for which `test` holds.
        pub fn position<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            Self::search::<S, true>(slice, move |v| [test(v); 2])
        }

        /// `position` for the second test. The first one is cheaper, and holds wherever it does.
        pub fn position_refined<S: Source<Lane = T>>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            Self::search::<S, true>(slice, tests)
        }

        /// The last index for which `test` holds.
        pub fn rposition<S: Source<Lane = T>>(
            slice: &[S],
            test: impl Fn(Self) -> Mask<T, N>,
        ) -> Option<usize> {
            Self::search::<S, false>(slice, move |v| [test(v); 2])
        }

        #[inline(always)]
        fn search<S: Source<Lane = T>, const FORWARD: bool>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            let (len, test) = (slice.len(), |[v]: [Self; 1]| tests(v)[1]);
            let k = Self::PER_STEP[usize::from(FORWARD)];
            if len < k * N {
                let find = Isa::nearest_set::<T, N, FORWARD>;
                return match len {
                    _ if len < N => Self::nearest_in_short::<S, 1, FORWARD>([slice], test),
                    _ if k == 4 && len <= 2 * N => find(&Self::cover([slice], 2, &test)?[..2], 0),
                    _ => find(&Self::cover([slice], k, &test)?[..k], 0),
                };
            }
            let last = len - k * N;
            let [near, far] = if FORWARD { [0, last] } else { [last, 0] };
            let found = Self::nearest_at::<S, 1, FORWARD>([slice], near, k, &test);
            if likely(found.is_some()) {
                return found;
            }
            if last > k * N {
                return Self::search_far::<S, FORWARD>(slice, tests);
            }
            if last == 0 {
                return None;
            }
            Self::nearest_at::<S, 1, FORWARD>([slice], far, k, &test)
        }

        /// After the first block. The registers that it needs cost the other paths nothing.
        #[inline(never)]
        fn search_far<S: Source<Lane = T>, const FORWARD: bool>(
            slice: &[S],
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> Option<usize> {
            let (len, test) = (slice.len(), |[v]: [Self; 1]| tests(v)[1]);
            let k = Self::PER_STEP[usize::from(FORWARD)];
            let mut seen = k * N;
            if len >= 2 * k * N + 4 * N {
                if k < 4 {
                    let start = if FORWARD { seen } else { len - 2 * seen };
                    let found = Self::nearest_at::<S, 1, FORWARD>([slice], start, k, &test);
                    if found.is_some() {
                        return found;
                    }
                    seen += k * N;
                }
                seen = Self::skip::<S, FORWARD>(slice, seen, &tests);
            }
            Self::nearest_past::<S, FORWARD>(slice, seen, k, &test)
        }

        /// The first `i` for which `test` holds for all `slices[..][i]`, with less code, if it is near.
        pub fn position_near<S: Source<Lane = T>, const P: usize>(
            slices: [&[S]; P],
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<usize> {
            let slices = of_same_len(slices);
            let Some(last) = slices[0].len().checked_sub(N) else {
                return Self::nearest_in_short::<S, P, true>(slices, test);
            };
            let mut start = 0;
            #[rustc_unroll(never)]
            while start < last {
                let found = Self::nearest_at::<S, P, true>(slices, start, 1, &test);
                if found.is_some() {
                    return found;
                }
                start += N;
            }
            Self::nearest_at::<S, P, true>(slices, last, 1, &test)
        }

        /// The last such `i`.
        pub fn rposition_near<S: Source<Lane = T>, const P: usize>(
            slices: [&[S]; P],
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<usize> {
            let slices = of_same_len(slices);
            let mut rest = slices;
            #[rustc_unroll(never)]
            while rest[0].len() > N {
                let left = rest[0].len() - N;
                let masks = Self::block(rest, left, 1, &test)?;
                let found = Isa::nearest_set::<T, N, false>(&masks[..1], left);
                if found.is_some() {
                    return found;
                }
                for slice in &mut rest {
                    *slice = slice.get(..left)?;
                }
            }
            if slices[0].len() < N {
                return Self::nearest_in_short::<S, P, false>(slices, test);
            }
            Self::nearest_at::<S, P, false>(slices, 0, 1, &test)
        }

        /// Each such `i` in the first or the last block.
        pub fn matches_near<S: Source<Lane = T>, const P: usize, const FORWARD: bool>(
            slices: [&[S]; P],
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Matches {
            let (slices, k) = (of_same_len(slices), Self::PER_BLOCK);
            let found = match slices[0].len().checked_sub(k * N) {
                Some(last) => {
                    let start = if FORWARD { 0 } else { last };
                    Self::block(slices, start, k, &test).map(|it| Matches::of(&it[..k], start))
                }
                None if slices[0].len() >= N => {
                    Self::cover(slices, k, &test).map(|it| Matches::of(&it[..k], 0))
                }
                None => Self::test_short(slices, test).map(|(short, mask)| Matches {
                    bits: short.to_bitmask(mask),
                    start: 0,
                }),
            };
            found.unwrap_or_default()
        }

        /// The same in whole blocks only. `range` counts from that end. Its last block may overlap.
        pub fn matches_in<S: Source<Lane = T>, const P: usize, const FORWARD: bool>(
            slices: [&[S]; P],
            range: Range<usize>,
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> impl Iterator<Item = Matches> {
            let mut slices = of_same_len(slices);
            let len = slices[0].len().min(range.end);
            let cut = if FORWARD { 0 } else { slices[0].len() - len };
            for slice in &mut slices {
                *slice = &slice[cut..][..len];
            }
            let after = |start: usize| match FORWARD {
                true => start + Self::BLOCK_LEN,
                false => start.wrapping_sub(Self::BLOCK_LEN),
            };
            let mut next = match FORWARD {
                true => range.start,
                false => after(len.wrapping_sub(range.start)),
            };
            core::iter::from_fn(move || {
                let (k, last) = (Self::PER_BLOCK, len.checked_sub(Self::BLOCK_LEN)?);
                #[rustc_unroll(never)]
                loop {
                    if next > last {
                        // Unlike `min`, a branch does not make the next loads wait.
                        cold_path();
                        next = match FORWARD {
                            true => (next < len).then_some(last)?,
                            false => (next > after(0)).then_some(0)?,
                        };
                    }
                    let masks = Self::block(slices, next, k, &test)?;
                    let any = masks[1..k].iter().fold(masks[0].0, |any, it| any | it.0);
                    if any.any() {
                        let found = Matches::of(&masks[..k], cut + next);
                        next = after(next);
                        return Some(found);
                    }
                    next = after(next);
                }
            })
        }

        /// How far the tests hold nowhere, counted from the start or the end, or a little less than `seen`.
        pub fn skip<S: Source<Lane = T>, const FORWARD: bool>(
            slice: &[S],
            seen: usize,
            tests: impl Fn(Self) -> [Mask<T, N>; 2],
        ) -> usize {
            let len = slice.len();
            let seen = Self::aligned::<S, FORWARD>(slice, seen).min(len);
            let (start, end) = slice.split_at(if FORWARD { seen } else { len - seen });
            let mut rest = if FORWARD { end } else { start };
            while let Some(left) = rest.len().checked_sub(4 * N)
                && let (start, end) = rest.split_at(if FORWARD { 4 * N } else { left })
                && let Some([a, b, c, d]) = Self::load_chunks(if FORWARD { start } else { end }, 4)
            {
                let holds =
                    |i: usize| ((tests(a)[i] | tests(b)[i]) | (tests(c)[i] | tests(d)[i])).any();
                if holds(0) {
                    if holds(1) {
                        break;
                    }
                    if cfg!(target_arch = "aarch64") {
                        // Without it, each step can run both tests.
                        black_box(());
                    }
                }
                rest = if FORWARD { end } else { start };
            }
            len - rest.len()
        }

        /// Up to `seen`, from where no load crosses a cache line.
        #[inline(always)]
        fn aligned<S, const FORWARD: bool>(slice: &[S], seen: usize) -> usize {
            let Range { start, end } = slice.as_ptr_range();
            let address = match FORWARD {
                true => start.wrapping_add(seen).addr(),
                false => end.wrapping_sub(seen).addr().wrapping_neg(),
            };
            seen.saturating_sub(address % size_of::<Self>() / size_of::<S>())
        }

        #[inline(always)]
        fn test_short<S: Source<Lane = T>, const P: usize>(
            slices: [&[S]; P],
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<(Padded<T, N, isa::Isa>, Mask<T, N>)> {
            let first = Self::load_padded_inline(slices[0])?;
            let mut all = [first.lanes; P];
            for p in 1..P {
                all[p] = Self::load_padded_inline(slices[p])?.lanes;
            }
            Some((first, test(all)))
        }

        #[inline(always)]
        fn nearest_in_short<S: Source<Lane = T>, const P: usize, const FORWARD: bool>(
            slices: [&[S]; P],
            test: impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<usize> {
            let (short, mask) = Self::test_short(slices, test)?;
            if FORWARD {
                short.first_set(mask)
            } else {
                short.last_set(mask)
            }
        }

        /// The tests of `k` chunks from `start` on, and where they are in the block.
        #[inline(always)]
        fn block<S: Source<Lane = T>, const P: usize>(
            slices: [&[S]; P],
            start: usize,
            k: usize,
            test: &impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<[(Mask<T, N>, usize); 4]> {
            let mut chunks = [[Self::zero(); P]; 4];
            for p in 0..P {
                // From this, LLVM sees that the checks below hold.
                if start > slices[p].len().checked_sub(k * N)? {
                    return None;
                }
                let [a, b, c, d] = Self::load_chunks(slices[p].get(start..)?, k)?;
                (chunks[0][p], chunks[1][p], chunks[2][p], chunks[3][p]) = (a, b, c, d);
            }
            let mut all = [(test(chunks[0]), 0); 4];
            if k > 1 {
                all[1] = (test(chunks[1]), N);
            }
            if k > 2 {
                (all[2], all[3]) = ((test(chunks[2]), 2 * N), (test(chunks[3]), 3 * N));
            }
            Some(all)
        }

        #[inline(always)]
        fn nearest_at<S: Source<Lane = T>, const P: usize, const FORWARD: bool>(
            slices: [&[S]; P],
            start: usize,
            k: usize,
            test: &impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<usize> {
            Isa::nearest_set::<T, N, FORWARD>(&Self::block(slices, start, k, test)?[..k], start)
        }

        /// `block` for `k` chunks that overlap.
        #[inline(always)]
        fn cover<S: Source<Lane = T>, const P: usize>(
            slices: [&[S]; P],
            k: usize,
            test: &impl Fn([Self; P]) -> Mask<T, N>,
        ) -> Option<[(Mask<T, N>, usize); 4]> {
            let at = |at: usize| Some((Self::block(slices, at, 1, test)?[0].0, at));
            let (starts, mut all) = (quarters(slices[0].len(), N), [at(0)?; 4]);
            all[k - 1] = at(starts[3])?;
            if k > 2 {
                (all[1], all[2]) = (at(starts[1])?, at(starts[2])?);
            }
            Some(all)
        }

        /// For a few blocks of `k` chunks. The last one overlaps.
        #[inline(always)]
        fn nearest_past<S: Source<Lane = T>, const FORWARD: bool>(
            slice: &[S],
            mut seen: usize,
            k: usize,
            test: &impl Fn([Self; 1]) -> Mask<T, N>,
        ) -> Option<usize> {
            let (len, last) = (slice.len(), slice.len().checked_sub(k * N)?);
            #[rustc_unroll(never)]
            while seen < len {
                let start = match FORWARD {
                    true => seen.min(last),
                    false => last.saturating_sub(seen),
                };
                let masks = Self::block([slice], start, k, test)?;
                if let Some(found) = Isa::nearest_set::<T, N, FORWARD>(&masks[..k], start) {
                    return Some(found);
                }
                seen += k * N;
            }
            None
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
            let count = stops(v).first_set().unwrap_or(N - 1).min(rest.len());
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
                    bits[k] = Isa::bitmask_of(&[(a[k], 0), (b[k], 16), (c[k], 32), (d[k], 48)]);
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
