//! What `Iterator` and slices have, and is made of other loops.

use crate::{Int, Isa, Lane, Over, OverMut, Readable, Simd, Tag, Width};
use core::cmp::Ordering;

impl<T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'_, T, W, S, E> {
    /// Whether each value is less than the next or equal to it. With a NaN among two values or more, it is false.
    #[doc(alias("IsSorted"))]
    #[op]
    pub fn is_sorted(self) -> bool {
        let (s, values) = self.parts();
        // Two lanes don't make up for the steps of a comparison.
        return_if!(
            cfg!(target_arch = "x86_64")
                && S::REGISTER == 16
                && T::BITS == 64
                && !T::IS_FLOAT
                && !(T::IS_SIGNED && S::SSE42)
                && E::PLAIN,
            E::plain(values).is_sorted()
        );
        let Some(rest) = values.get(1..) else { return true };
        Over::<T, W, S, E>::new(s, values)
            .zip::<T, E>(rest)
            .position(
                #[inline(always)]
                |(a, b)| !a.simd_le(b),
            )
            .is_none()
    }
}

impl<T: Int, W: Width, S: Isa, E: Readable<T>> Over<'_, T, W, S, E> {
    /// The order of slices: by the first values that differ, and then by the length.
    #[doc(alias("memcmp", "compare"))]
    #[allow(clippy::should_implement_trait)]
    #[op]
    pub fn cmp(self, other: &[impl Readable<T>]) -> Ordering {
        let (s, values) = self.parts();
        match Over::<T, W, S, E>::new(s, values).zip::<T, _>(other).position(
            #[inline(always)]
            |(a, b)| a.simd_ne(b),
        ) {
            Some(at) => values[at].value().cmp(&other[at].value()),
            None => values.len().cmp(&other.len()),
        }
    }
}

impl<T: Lane, W: Width, S: Isa> OverMut<'_, T, W, S> {
    /// From the last value to the first.
    #[op]
    pub fn reverse(self) {
        let (s, mut all) = self.parts();
        let d = s.fixed::<T, W>();
        let n = d.lanes();
        if const { Tag::<S, T, W>::ROLLED } && all.len() >= 2 * n {
            // The middle is read first, and overlaps what the loop has swapped.
            if all.len() <= 4 * n {
                return reverse_rest::<T, W::Twice, S>(s, all);
            }
            let (d, skip) = (s.fixed::<T, W::Twice>(), (all.len() - (4 * n - 1)) / 2);
            let middle = skip..all.len() - skip;
            let (a, b, mut rest) = (d.load(&all[middle.clone()]), d.load_last(&all[middle.clone()]), &mut *all);
            while rest.len() > 4 * n {
                let (first, last) = (d.load(rest), d.load_last(rest));
                last.reverse().store(rest);
                first.reverse().store_last(rest);
                let end = rest.len() - 2 * n;
                rest = &mut rest[2 * n..end];
            }
            b.reverse().store(&mut all[middle.clone()]);
            return a.reverse().store_last(&mut all[middle]);
        }
        while const { !S::AVX2 || W::BYTES < 32 } && all.len() >= 2 * n {
            let (first, last) = (d.load(all), d.load_last(all));
            last.reverse().store(all);
            first.reverse().store_last(all);
            let end = all.len() - n;
            all = &mut all[n..end];
        }
        if const { !S::AVX2 || W::BYTES < 32 } || all.len() <= 2 * n {
            return reverse_rest::<T, W, S>(s, all);
        }
        if const { S::REGISTER == 32 && W::BYTES == 32 } && all.len() <= 4 * n {
            return live!(S::REGISTER == 32 && W::BYTES == 32, reverse_rest::<T, W::Twice, S>(s, all));
        }
        let last = all.len() - n;
        let swap = always!(|all: &mut [T], from: usize| {
            let mut at = from;
            while at <= last / 2 {
                let (a, b) = (d.load_any_at(all, at), d.load_any_at(all, last - at));
                b.reverse().store_at(all, at);
                a.reverse().store_at(all, last - at);
                at += n;
            }
        });
        // What overlaps is read before, and written after.
        let middle = d.load_any_at(all, last / 2);
        if last >= 16 * n {
            let (a, b) = (d.load(all), d.load_last(all));
            #[allow(unused_mut)]
            let mut at = n - all.as_ptr().addr() / size_of::<T>() % n;
            // LLVM takes two shuffles. `vpermd` is faster on Intel and Zen 5, the same on Zen 4, and slower before.
            when!(S::AVX2 && W::BYTES == 32 && T::BITS == 32, {
                let order = d.to_unsigned().iota(Lane::ZERO).reverse().black_box();
                let end = if crate::tuning::fast_masked_store() { last / 2 } else { 0 };
                while at <= end {
                    let (a, b) = (d.load_any_at(all, at), d.load_any_at(all, last - at));
                    b.swizzle_dyn_relaxed(order).store_at(all, at);
                    a.swizzle_dyn_relaxed(order).store_at(all, last - at);
                    at += n;
                }
            });
            swap(all, at);
            b.reverse().store(all);
            a.reverse().store_last(all);
        } else {
            swap(all, 0);
        }
        middle.reverse().store_at(all, last - last / 2);
    }
    /// Puts into `range` what [`sort`](Self::sort) would put there. The values before it are no greater, and those after it are no less.
    /// Panics if the range is out of bounds.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut values = [5, 1, 4, 2, 3];
    /// over_mut(&mut values).partial_sort(0..2);
    /// assert_eq!(values[..2], [1, 2]);
    /// # } example()
    /// ```
    #[doc(alias("VQPartialSort", "partial_sort_unstable", "top_k"))]
    #[op]
    #[track_caller]
    pub fn partial_sort(self, range: core::ops::Range<usize>) {
        let (s, values) = self.parts();
        let (at, empty) = (range.start, values[range.clone()].is_empty());
        if at < values.len() && (at > 0 || !empty) {
            crate::vqsort::sort_on::<S, T, true>(s, values, (at, range.end.max(at + 1)))
        }
    }
    /// [`partial_sort`](Self::partial_sort) for one place, whose value it returns. Panics if there is no such place.
    #[doc(alias("VQSelect", "select_nth_unstable", "nth_element", "median"))]
    #[op]
    #[track_caller]
    pub fn select_nth(self, index: usize) -> T {
        let (s, values) = self.parts();
        assert!(index < values.len());
        crate::vqsort::sort_on::<S, T, true>(s, values, (index, index + 1));
        values[index]
    }
    /// Moves the values that differ from the one before them to the start, and returns their number. What is after them can change.
    #[doc(alias("Unique", "unique", "partition_dedup"))]
    #[op]
    pub fn dedup(self) -> usize {
        let (s, values) = self.parts();
        let d = s.fixed::<T, W>();
        if values.len() >= 32 * d.lanes() {
            return dedup_long::<T, W, S>(s, values);
        }
        Self::dedup_all(d, values)
    }
    #[op]
    fn dedup_all(d: Tag<S, T, W>, values: &mut [T]) -> usize {
        return_if!(masked::<T, W, S>(), dedup_masked(d, values));
        let Some(&first) = values.first() else { return 0 };
        let (n, mut before, mut at, mut kept) = (d.lanes(), d.set(first), 1, 1);
        while const { Tag::<S, T, W>::ROLLED && size_of::<T>() > 1 } && values.len() - at >= 5 * n {
            let v = d.load_four(&values[at..]);
            let new = always!(|i: usize| v[i].simd_ne(v[i].shift_elements_right::<1>(if i == 0 {
                before
            } else {
                v[i - 1]
            })));
            kept += d.compress_four(v, new, &mut values[kept..][..5 * n]);
            (before, at) = (v[3], at + 4 * n);
        }
        while n > 2 && values.len() >= n && at <= values.len() - n {
            let v = d.load_any_at(values, at);
            crate::window::check(values.len(), kept, n);
            kept += v.compress_mask_store(v.simd_ne(v.shift_elements_right::<1>(before)), &mut values[kept..]);
            (before, at) = (v, at + n);
        }
        if n <= 16 || values.len() - at < 16 {
            let mut before = values[kept - 1];
            for at in at..values.len() {
                let value = values[at];
                values[kept] = value;
                kept += (value != before) as usize;
                before = value;
            }
            return kept;
        }
        let v = d.load_n(&values[at..]);
        let keep = v.simd_ne(v.shift_elements_right::<1>(before)) & d.first_n(values.len() - at);
        v.compress_mask(keep).store_n(&mut values[kept..]);
        kept + keep.count()
    }
}

/// Whether a part of a vector takes less time than a few values one by one.
const fn masked<T: Lane, W: Width, S: Isa>() -> bool {
    Tag::<S, T, W>::CELLS_BY_BITS && S::COMPRESS[size_of::<T>().trailing_zeros() as usize] == 64
}
#[crate::simd]
#[inline(never)]
/// What is before the first two equal neighbors stays, and a search stores nothing. `values` is not empty.
fn dedup_long<T: Lane, W: Width, S: Isa>(s: S, values: &mut [T]) -> usize {
    let (d, last) = (s.fixed::<T, W>(), values.len() - 1);
    let first = d.find2_if(
        &values[..last],
        d,
        &values[1..],
        #[inline(always)]
        |a, b| a.simd_eq(b),
    );
    let done = first.unwrap_or(last);
    done + OverMut::dedup_all(d, &mut values[done..])
}
#[op]
fn dedup_masked<T: Lane, W: Width, S: Isa>(d: Tag<S, T, W>, values: &mut [T]) -> usize {
    let (n, len) = (d.lanes(), values.len());
    if len <= n {
        return d.replace_n(
            values,
            always!(|v: Simd<T, W, S>| {
                let keep = (v.simd_ne(v.shift_elements_right::<1>(v)) | d.first_n(1)) & d.first_n(len);
                (v.compress_mask(keep), keep.count())
            }),
        );
    }
    // To load it later would have to wait for the stores.
    let last = d.load_last(values);
    let keep = d.all_but_last((len - 1) % n).and_not(last.simd_ne(d.load_last(&values[..len - 1])));
    let (mut before, mut at, mut kept) = (d.set(values[0]), 1, 1);
    while const { size_of::<T>() <= 2 } && len - at >= 4 * n {
        let v = d.load_four(&values[at..]);
        let new =
            always!(|i: usize| v[i].simd_ne(v[i].shift_elements_right::<1>(if i == 0 { before } else { v[i - 1] })));
        kept += d.compress_four(v, new, &mut values[kept..][..4 * n]);
        (before, at) = (v[3], at + 4 * n);
    }
    while at <= len - n {
        crate::not_unrolled();
        let v = d.load_any_at(values, at);
        crate::window::check(len, kept, n);
        kept += v.compress_mask_store(v.simd_ne(v.shift_elements_right::<1>(before)), &mut values[kept..]);
        (before, at) = (v, at + n);
    }
    last.compress_mask(keep).store_n(&mut values[kept..]);
    kept + keep.count()
}
/// For up to two vectors.
#[op]
fn reverse_rest<T: Lane, W: Width, S: Isa>(s: S, values: &mut [T]) {
    let d = s.fixed::<T, W>();
    if values.len() >= d.lanes() {
        let (first, last) = (d.load(values), d.load_last(values));
        last.reverse().store(values);
        return first.reverse().store_last(values);
    }
    return_if!(crate::X86 && Tag::<S, T, W>::CELLS_BY_BITS && Tag::<S, T, W>::SLIDES, |d: Tag<S, T, W> = d, values: &mut [T] = values| {
        let from = d.to_unsigned().set(Lane::from_usize(values.len())) - d.to_unsigned().iota(Lane::from_usize(1));
        d.replace_n(values, always!(|v: Simd<T, W, S>| (v.swizzle_dyn_relaxed(from), ())))
    });
    return_if!(W::BYTES / size_of::<T>() > 2, |s: S = s, values: &mut [T] = values| reverse_rest::<T, W::Half, S>(s, values));
}

impl<T: Int, W: Width, S: Isa> OverMut<'_, T, W, S> {
    /// Adds to each value all those before it, and returns the sum of all. The sums wrap.
    #[doc(alias("scan", "inclusive_scan", "cumsum", "partial_sum"))]
    #[op]
    pub fn prefix_sum(self) -> T {
        let (s, values) = self.parts();
        let d = s.fixed::<T, W>();
        let one_by_one = always!(|values: &mut [T]| {
            values.iter_mut().fold(
                T::ZERO,
                #[inline(always)]
                |sum, it| {
                    *it = T::from_u64(sum.to_u64().wrapping_add(it.to_u64()));
                    *it
                },
            )
        });
        if d.lanes() <= 2 {
            if_here!(
                S::A64,
                if values.len() >= 16 {
                    let ((fours, rest), mut sum) = (values.as_chunks_mut::<4>(), 0u64);
                    let mut add = always!(|it: &mut T| {
                        sum = sum.wrapping_add(it.to_u64());
                        *it = T::from_u64(sum);
                    });
                    for [a, b, c, e] in fours {
                        add(a);
                        add(b);
                        add(c);
                        add(e);
                    }
                    for it in rest {
                        add(it);
                    }
                    return T::from_u64(sum);
                }
            );
            return one_by_one(values);
        }
        let n = d.lanes();
        if values.len() >= n {
            // The last vector overlaps the one before, whose sums it gets again.
            let last = d.load_last(values);
            let sums = last.prefix_sum();
            let (again, seen) = (sums - last, values.len().wrapping_neg() % n);
            let last = sums
                - choose! {
                    Tag::<S, T, W>::SLIDES && (S::REGISTER != 32 || size_of::<T>() >= 4) => again.swizzle_dyn_relaxed(on_x86!(d.to_unsigned().set(Lane::from_usize(seen)), black_box())),
                    _ => d.set(again.to_array().as_ref()[seen]),
                };
            let (mut before, mut whole) = (d.zero(), &mut *values);
            while const { Tag::<S, T, W>::ROLLED } && whole.len() > 2 * n {
                let (a, b) = choose! {
                    S::A64 && W::BYTES == 16 => {
                        let [a, b] = s.fixed::<T, W::Twice>().load(whole).prefix_sum().split();
                        (a.same(), b.same())
                    },
                    _ => {
                        let (a, b) = (d.load(whole).prefix_sum(), d.load(&whole[n..]).prefix_sum());
                        (a, b + a.splat_last())
                    },
                };
                (a + before).store(whole);
                (b + before).store(&mut whole[n..]);
                before += b.splat_last();
                whole = &mut whole[2 * n..];
            }
            while whole.len() > n {
                let sums = d.load(whole).prefix_sum();
                (sums + before).store(whole);
                before += sums.splat_last();
                whole = &mut whole[n..];
            }
            let last = last + before;
            last.store_last(values);
            return last.splat_last().get_lane();
        }
        if values.len() < 16 {
            return one_by_one(values);
        }
        let sums = d.load_n(values).prefix_sum();
        sums.store_n(values);
        sums.splat_last().get_lane()
    }
}
