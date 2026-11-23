//! Loops over slices of any length, like `hwy/contrib/algo`.
//!
//! They take slices, or any `Source`. The closures can see a value more than once, and have to treat all lanes alike.

use crate::output::Tail;
use crate::{Isa, Lane, MaskOf, Output, Place, Readable, Region, Simd, Source, Tag, Width};
use core::hint::select_unpredictable as select;

type Seen<T, W, S> = ([Simd<T, W, S>; 4], [MaskOf<T, W, S>; 4]);

/// How a short slice fills a vector: `part` values from 0, from `step`, up to `len - step` and up to `len`, and again.
#[derive(Copy, Clone)]
pub(crate) struct Quarters {
    part: usize,
    step: usize,
}

impl Quarters {
    /// Where a lane is from. Two that are from the same place can differ, if another thread writes there.
    #[op]
    pub(crate) fn index(self, lane: usize, len: usize) -> usize {
        let (Self { part, step }, lane) = (self, lane & (4 * self.part - 1));
        let (lower, upper) = (select(lane < part, 0, step.wrapping_sub(part)), select(lane < 3 * part, part - step, 0));
        lane.wrapping_add(select(lane < 2 * part, lower, (upper + len).wrapping_sub(4 * part)))
    }
}

/// `Quarters::index` for each length and lane.
const fn places<const N: usize>(lanes: usize) -> [[u8; N]; N] {
    let (mut all, mut i) = ([[0; N]; N], N);
    while i < N * lanes {
        let (len, lane) = (i / N, i % N);
        let n = if len < 16 && lanes > 16 { 16 } else { lanes };
        let part = if len < n / 4 { 1 } else { n / 4 };
        let step = if part < len - part { part } else { len - part };
        all[len][lane] = ([0, step, len - step - part, len - part][lane / part % 4] + lane % part) as u8;
        i += 1;
    }
    all
}
// For the time to compile: each crate evaluates a constant again, but takes the value of a static from the metadata.
static PLACES: [[[u8; 16]; 16]; 3] = [places(4), places(8), places(16)];
static PLACES_32: [[u8; 32]; 32] = places(32);

/// Four short vectors are joined in pairs, so that truncations merge. LLVM would join their stores one after the other.
macro_rules! joined {
    ($s:expr, |$i:ident| $part:expr, |$v:ident| $write:expr) => {
        when!(Self::joins::<X>(), {
            // A loop, which stays one if the closure is long.
            let mut all = [Tag::<S, U, X>::new($s).zero(); 4];
            for $i in 0..4 {
                all[$i] = $part;
            }
            let $v = all[0].concat(all[1]).concat(all[2].concat(all[3]));
            $write
        })
    };
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// Where a lane of `load_quarters` is from.
    #[op]
    pub(crate) fn place(self, quarters: Quarters, lane: usize, len: usize) -> usize {
        choose! {
            Self::LANES <= 2 => 0,
            Self::LANES <= 16 => const { &crate::Aligned(PLACES[Self::LANES / 8]).0 }[len % 16][lane % 16] as usize,
            Self::LANES == 32 => const { &crate::Aligned(PLACES_32).0 }[len % 32][lane % 32] as usize,
            _ => quarters.index(lane, len),
        }
    }

    /// How many vectors a search looks at before it branches.
    const UNROLL: usize = if W::BYTES <= 32 { 4 } else { 2 };
    /// The last vectors overlap those before, which takes fewer branches than a loop. Closures on floats are long, as a rule.
    pub(crate) const fn in_classes<U: Lane, X: Width>() -> bool {
        Self::ROLLED && X::BYTES <= 16 && !T::IS_FLOAT && !U::IS_FLOAT
    }
    const fn joins<X: Width>() -> bool {
        (crate::X86 || S::A64 && X::BYTES == 8)
            && crate::OPTIMIZED
            && !S::AVX512VL
            && Self::UNROLL == 4
            && X::BYTES < W::BYTES
            && X::BYTES <= 8
    }

    #[op]
    fn read_last(self, from: impl Source<T>) -> Simd<T, W, S> {
        self.read(from, from.len() - Self::LANES)
    }

    /// How many values `from` starts after a multiple of the width, if that is known.
    #[op]
    fn misalignment(self, from: impl Source<T>) -> usize {
        from.address() / size_of::<T>() % Self::LANES
    }
    /// `at - odd` for `odd < LANES`. With two lanes, LLVM loses the range of that difference, and loops keep their checks.
    #[op]
    pub(crate) fn back(at: usize, odd: usize) -> usize {
        choose! { Self::LANES == 2 => if odd == 0 { at } else { at - 1 }, _ => at - odd }
    }

    /// For `0 < from.len() < LANES`: the first `n` values, the last `n` values, and again, where `n` is a power of two.
    #[inline(always)]
    pub(crate) fn load_ends(self, from: impl Source<T>) -> Simd<T, W, S> {
        apart!(self.simd(), {
            return_if!(Self::LANES <= 2, self.set(from.get(0)));
            let half = self.half();
            if from.len() >= half.lanes() {
                return self.combine(half.read_last(from), half.read(from, 0));
            }
            let ends = half.load_ends(from);
            self.combine(ends, ends)
        })
    }

    /// The same with fewer branches, which are hard to predict, and more loads. See [`Quarters`].
    #[inline(always)]
    pub(crate) fn load_quarters<F: Source<T>>(self, from: F) -> (Simd<T, W, S>, Quarters) {
        apart_unoptimized!(self.simd(), {
            let len = from.len();
            return_if!(Self::LANES <= 2, (self.set(from.get(0)), Quarters { part: 1, step: 0 }));
            return_if!(Self::LANES == 4, self.load_few(from));
            let half = self.half();
            let part = Self::LANES / 4;
            return_if!(Self::LANES > 16, {
                if len >= 2 * part {
                    return (self.combine(half.read_last(from), half.read(from, 0)), Quarters { part, step: part });
                }
                let (v, quarters) = again!(Tag::load_quarters, half, from);
                (self.combine(v, v), quarters)
            });
            let quarter = half.half();
            if len >= part {
                // In this form, LLVM sees that nothing panics, also where it has made `len != 1` of the test.
                #[allow(unused_macros)]
                macro_rules! by_ends {
                    () => {{
                        let end = len.min(2 * part);
                        let lower = half.combine(quarter.read_last(from.slice(0..end)), quarter.read(from, 0));
                        let upper = half.combine(quarter.read_last(from), quarter.read(from.skip(len - end), 0));
                        (self.combine(upper, lower), Quarters { part, step: end - part })
                    }};
                }
                return_if!(crate::X86 && Self::LANES == 8, by_ends!());
                let step = part.min(len - part);
                return_if!(S::A64 && Self::LANES == 16 && F::SLICE, {
                    let (last, third) = (len - part, (len - part).saturating_sub(part));
                    // Loads to lanes wait for each other, and take no offsets.
                    return_if!(W::BYTES == 16 && crate::OPTIMIZED && cfg!(target_endian = "little"), {
                        let word =
                            always!(|at| self.repartition::<u32>().resize_bitcast(quarter.read(from, at)).black_box());
                        let pair = always!(|a, b| word(a).interleave_lower(word(b)).bitcast::<u64>());
                        (pair(0, step).interleave_lower(pair(third, last)).bitcast(), Quarters { part, step })
                    });
                    let pair = always!(|a, b| half.combine(quarter.read(from, b), quarter.read(from, a)));
                    (self.combine(pair(third, last), pair(0, step)), Quarters { part, step })
                });
                // Before `step`, this costs lanes of `u8` an instruction.
                return_if!(S::A64 && Self::LANES == 8, by_ends!());
                let lower = half.combine(quarter.read(from, step), quarter.read(from, 0));
                let upper = half.combine(quarter.read_last(from), quarter.read_last(from.slice(0..len - step)));
                return (self.combine(upper, lower), Quarters { part, step });
            }
            return_if!(Self::LANES == 16 && size_of::<T>() <= 2, self.load_few(from));
            live!(Self::LANES == 8 || Self::LANES == 16 && size_of::<T>() > 2, {
                let (v, quarters) = again!(Tag::load_quarters, quarter, from);
                (self.combine(half.combine(v, v), half.combine(v, v)), quarters)
            })
        })
    }

    /// `f` of a slice that is neither empty nor fills a vector. The lengths of text are hard to predict. For wider lanes, four parts cost more than a branch.
    #[op]
    fn transform_short<U: Lane, X: Width, P: Place<U>>(
        self,
        from: &[impl Readable<T>],
        to: P,
        f: impl Fn(Simd<T, W, S>) -> Simd<U, X, S>,
    ) {
        // With a copy of `f` for the usual case, one test does for the load and the store.
        choose! {
            Tag::<S, U, X>::IN_QUARTERS && Self::IN_QUARTERS && Self::LANES == Tag::<S, U, X>::LANES && !P::SHARED => {
                if_here!(S::A64 && crate::OPTIMIZED, if from.len() >= 4 { return f(self.load_quarters(Readable::source(from)).0).store_quarters(to) });
                f(self.load_quarters(Readable::source(from)).0).store_quarters(to)
            },
            S::A64 && Self::in_classes::<U, X>() && Self::LANES == 8 => {
                if from.len() >= 4 { return f(self.load_ends(Readable::source(from))).store_ends(to) }
                f(self.load_ends(Readable::source(from))).store_ends(to)
            },
            _ => f(self.load_ends(Readable::source(from))).store_ends(to),
        }
    }
    pub(crate) const IN_QUARTERS: bool = !S::PORTABLE
        && (crate::X86 && size_of::<T>() == 1 && W::BYTES >= 16 || S::A64 && size_of::<T>() <= 2 && Self::LANES == 16);

    /// For 1 to 3 values.
    #[op]
    fn load_few(self, from: impl Source<T>) -> (Simd<T, W, S>, Quarters) {
        let (len, first, middle) = (from.len(), from.get(0), from.get(from.len() / 2));
        let four = [first, middle, select(len == 2, first, middle), from.get(len - 1)];
        let bits = always!(|i: usize| crate::Int::to_u64(T::unsigned(&four)[i]) << (i as u32 * T::BITS % 64));
        (
            choose! {
                size_of::<T>() == 1 => self.repartition::<u32>().set((bits(0) | bits(1) | bits(2) | bits(3)) as u32).bitcast(),
                size_of::<T>() == 2 => self.repartition::<u64>().set(bits(0) | bits(1) | bits(2) | bits(3)).bitcast(),
                _ => {
                    let mut lanes = self.zero().to_array();
                    let each = lanes.as_mut();
                    (each[0], each[1], each[2], each[3]) = four.into();
                    self.from_array(lanes)
                },
            },
            Quarters { part: 1, step: len / 2 },
        )
    }

    /// For an operation on each value of a slice that is shorter than a vector. Each value is in one lane or more, in an
    /// order that depends only on the length and the target. [`Simd::store_short`] undoes it, also for lanes of another type.
    #[op]
    pub(crate) fn load_short(self, from: &[T]) -> Simd<T, W, S> {
        self.load_any_short(from)
    }

    #[op]
    pub(crate) fn load_any_short(self, from: &[impl crate::Readable<T>]) -> Simd<T, W, S> {
        choose! {
            S::PARTIAL => self.load_any_n(from),
            _ => if from.is_empty() { self.zero() } else { self.load_ends(Readable::source(from)) },
        }
    }

    #[op]
    fn find_in_short<const LAST: bool, F: Source<T>>(
        self,
        within: F,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        let find = always!(|mask: MaskOf<T, W, S>| if LAST { mask.last_set() } else { mask.first_set() });
        if const { S::HAS_MASKED_MEMORY && F::MASKED } {
            return_if!(Self::BY_BITS && F::MASKED && !LAST && Self::LANES <= 64, {
                let at = matches(within.read_vector_n(self)).to_bitmask().trailing_zeros() as usize;
                (at < within.len()).then_some(at)
            });
            return_if!(S::SVE2 && !LAST, {
                let at = matches(within.read_vector_n(self)).count_before_first();
                (at < within.len()).then_some(at)
            });
            return live!(
                S::HAS_MASKED_MEMORY && F::MASKED,
                find(matches(within.read_vector_n(self)) & self.first_n(within.len()))
            );
        }
        if const { Self::IN_ORDER && F::SLICE }
            && let Some(within) = within.as_slice()
        {
            return live!(Self::IN_ORDER, {
                let ((bits, per_lane), len) = (matches(self.load_n(within)).wide_bits(), within.len() as u32);
                let valid = bits & !(!0 << (len * per_lane));
                let at = if LAST { 63 ^ crate::regs::number(valid).leading_zeros() } else { bits.trailing_zeros() }
                    / per_lane;
                (valid != 0).then_some(at as usize)
            });
        }
        if within.is_empty() {
            return None;
        }
        let (v, quarters) = self.load_quarters(within);
        let lane = find(matches(v))?;
        Some(self.place(quarters, lane, within.len()))
    }

    /// `last_set` without the cycle that tells LLVM the range.
    #[op]
    fn last_in(self, mask: MaskOf<T, W, S>) -> Option<usize> {
        return_if!(S::LZCNT && !S::AVX512F && W::BYTES <= 32, {
            let (bits, per_lane) = mask.wide_bits();
            (bits != 0).then_some(((63 ^ crate::regs::number(bits).leading_zeros()) / per_lane) as usize)
        });
        mask.last_set()
    }
    /// A test in a general register doesn't delay the move of the mask to there.
    #[op]
    pub(crate) fn find_in<const LAST: bool>(self, mask: MaskOf<T, W, S>) -> Option<usize> {
        return_if!(
            S::REGISTER < 64 || W::BYTES > 64 || MaskOf::<T, W, S>::BOTH,
            if LAST { self.last_in(mask) } else { mask.first_set() }
        );
        let bits = mask.to_bitmask();
        (bits != 0).then(
            #[inline(always)]
            || if LAST { 63 ^ (bits | 1).leading_zeros() } else { bits.trailing_zeros() } as usize,
        )
    }

    /// With `THREE`, the last two are the same.
    #[op]
    fn masks<const THREE: bool>(self, of: impl Fn(usize) -> MaskOf<T, W, S>) -> [MaskOf<T, W, S>; 4] {
        let (a, b) = (of(0), of(1));
        if const { Self::UNROLL == 2 } {
            return [a, b, a, b];
        }
        let c = of(2);
        [a, b, c, choose! { THREE => c, _ => of(3) }]
    }
    #[op]
    fn look_at<const THREE: bool>(
        self,
        v: [Simd<T, W, S>; 4],
        matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> Option<Seen<T, W, S>> {
        let masks = self.masks::<THREE>(
            #[inline(always)]
            |i| matches(v[i]),
        );
        // In mask registers.
        return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES == 64 && Self::LANES < 64, {
            let mut both = masks[0];
            both |= masks[1];
            if both.none() { None } else { Some((v, masks)) }
        });
        if (masks[0] | masks[1]).neither(masks[2] | masks[3]) { None } else { Some((v, masks)) }
    }
    #[op]
    fn none_of(masks: [MaskOf<T, W, S>; 4]) -> bool {
        return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES == 64 && Self::LANES < 64, {
            let mut both = masks[0];
            both |= masks[1];
            both.none()
        });
        (masks[0] | masks[1]).neither(masks[2] | masks[3])
    }
    /// As `look`. A branch on an `Option` loses its weight.
    #[op]
    fn peek(self, chunk: impl Source<T>, matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>) -> (bool, Seen<T, W, S>) {
        let v = chunk.slice(0..Self::UNROLL * Self::LANES).read_group(self);
        let masks = self.masks::<false>(always!(|i: usize| matches(v[i])));
        (!Self::none_of(masks), (v, masks))
    }

    /// If the masks of the test have another use, LLVM makes `select` of `|`, and then shifts before it moves the bits. It merges the two looks later.
    pub(crate) const AGAIN: bool = crate::X86 && S::REGISTER < 64;
    #[op]
    fn look_again<const THREE: bool>(
        self,
        (v, masks): Seen<T, W, S>,
        matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> [MaskOf<T, W, S>; 4] {
        // If these masks were those of the test, LLVM couldn't merge the tests of sign bits.
        choose! {
            S::ARM => self.masks::<THREE>(#[inline(always)] |i| matches(self.opaque(v[i].raw))),
            // Those of words would be packed in the loop.
            Self::AGAIN && size_of::<T>() == 2 => self.masks::<THREE>(#[inline(always)] |i| matches(v[i].barrier())),
            Self::AGAIN => self.masks::<THREE>(#[inline(always)] |i| matches(v[i])),
            _ => masks,
        }
    }
    /// Where the match in a group is. On Arm, a search has this once for all of its whole groups. On x86, masks that meet from several places get packed.
    #[op]
    fn locate<const LAST: bool>(
        self,
        seen: Seen<T, W, S>,
        matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> usize {
        let [a, b, c, d] = self.look_again::<false>(seen, matches);
        let at = choose! {
            W::BYTES > 64 => {
                let (a, b) = (self.find_in::<LAST>(a), self.find_in::<LAST>(b).map(#[inline(always)] |at| Self::LANES + at));
                (if LAST { b.or(a) } else { a.or(b) }).unwrap_or(0)
            },
            W::BYTES == 64 => a.find_in_both::<LAST>(b),
            W::BYTES == 32 => a.twice(b).find_in_both::<LAST>(c.twice(d)),
            _ => {
                let all = a.twice(b).twice(c.twice(d));
                if LAST { all.last_set_relaxed() } else { all.first_set_relaxed() }
            },
        };
        choose! { S::ARM || Self::AGAIN => at & (Self::UNROLL * Self::LANES - 1), _ => at }
    }
    /// In the vector at `one`, or if it has no match, in the two at `two`.
    #[op]
    fn find_in_three<const LAST: bool>(
        self,
        (one, a): (usize, Simd<T, W, S>),
        (two, b, c): (usize, Simd<T, W, S>, Simd<T, W, S>),
        matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        let [a, b, c, _] = self.look_again::<true>(self.look_at::<true>([a, b, c, c], matches)?, matches);
        let (n, (a, per_lane)) =
            (Self::LANES, choose! { MaskOf::<T, W, S>::BOTH => (a.to_bitmask(), 1u32), _ => a.wide_bits() });
        let lane =
            always!(|bits: u64| (if LAST { 63u32.wrapping_sub(bits.leading_zeros()) } else { bits.trailing_zeros() }
                / per_lane) as usize);
        return_if!(S::A64 && W::BYTES == 16, {
            // Or LLVM takes the branch out.
            crate::not_unrolled();
            let (b, c) = ((b.wide_bits().0, two), (c.wide_bits().0, two + n));
            let (b, c) = if LAST { (c, (b.0 | 1, b.1)) } else { (b, (c.0 | 1 << 63, c.1)) };
            let (bits, at) = (select(b.0 != 0, b.0, c.0), select(b.0 != 0, b.1, c.1));
            let (bits, at) = (select(a != 0, a, bits), select(a != 0, one, at));
            Some(if LAST { at + n - 1 - (bits.leading_zeros() / per_lane) as usize } else { at + lane(bits) })
        });
        Some(select(a != 0, one.wrapping_add(lane(a)), two + (b.find_in_both::<LAST>(c) & (2 * n - 1))))
    }

    /// `find_in` with a branch, so that no match doesn't wait for the mask. On Arm, LLVM takes it out, which pays for wide lanes only.
    #[op]
    fn branch_on<const LAST: bool>(self, mask: MaskOf<T, W, S>) -> Option<usize> {
        let at = self.find_in::<LAST>(mask);
        if const { S::A64 && crate::OPTIMIZED && size_of::<T>() <= 2 } && at.is_some() {
            crate::not_unrolled();
        }
        at
    }

    /// In four masks as if they were one, of which a lane is set.
    #[op]
    pub(crate) fn first_in_four(self, [a, b, c, d]: [MaskOf<T, W, S>; 4]) -> usize {
        let n = Self::LANES;
        choose! {
            W::BYTES > 64 => {
                let (lower, upper) = (a.count_before_first(), c.count_before_first());
                let (lower, upper) = (if lower < n { lower } else { n + b.count_before_first() }, if upper < n { upper } else { n + d.count_before_first() });
                if lower < 2 * n { lower } else { 2 * n + upper }
            },
            W::BYTES == 64 => {
                let lower = a.find_in_both::<false>(b);
                select(lower < 2 * n, lower, 2 * n + c.find_in_both::<false>(d))
            },
            W::BYTES == 32 => a.twice(b).find_in_both::<false>(c.twice(d)),
            // LLVM would compute it before the test.
            S::A64 && W::BYTES == 16 && size_of::<T>() >= 4 => a.twice(b.to_vector().black_box().full_mask()).twice(c.twice(d)).first_set_relaxed(),
            _ => a.twice(b).twice(c.twice(d)).first_set_relaxed(),
        }
    }

    /// The first group, if it has a match.
    #[op]
    fn look(self, chunk: impl Source<T>, matches: &impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>) -> Option<Seen<T, W, S>> {
        self.look_at::<false>(chunk.slice(0..Self::UNROLL * Self::LANES).read_group(self), matches)
    }
    #[op]
    pub(crate) fn read_one_by_one(self, chunk: impl Source<T>) -> [Simd<T, W, S>; 4] {
        let n = Self::LANES;
        let (a, b) = (self.read(chunk, 0), self.read(chunk, n));
        let (c, d) = choose! { Self::UNROLL == 4 => (self.read(chunk, 2 * n), self.read(chunk, 3 * n)), _ => (a, b) };
        [a, b, c, d]
    }

    /// The index of the first value that matches. `FindIf`.
    #[inline(always)]
    pub(crate) fn find_if(
        self,
        within: impl Source<T>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        apart_unoptimized!(self.simd(), {
            return_if!(Self::ONE_BY_ONE, self.find_one::<false>(within, matches));
            let (n, len, group) = (Self::LANES, within.len(), Self::UNROLL * Self::LANES);
            if len < n {
                return self.find_in_short::<false, _>(within, matches);
            }
            if let Some(at) = self.find_in::<false>(matches(self.read(within, 0))) {
                return Some(at);
            }
            if len <= 2 * n {
                return self.branch_on::<false>(matches(self.read_last(within))).map(
                    #[inline(always)]
                    |at| len - n + at,
                );
            }
            if const { Self::UNROLL == 4 } && len <= group {
                let two = (len - 2 * n, self.read(within, len - 2 * n), self.read_last(within));
                return live!(Self::UNROLL == 4, self.find_in_three::<false>((n, self.read(within, n)), two, &matches));
            }
            let last = len - group;
            let (start, seen) = 'found: {
                macro_rules! look {
                    ($at:expr) => {
                        if let Some(seen) = self.look(within.skip($at), &matches) {
                            return_if!(!S::ARM, Some($at + self.locate::<false>(seen, &matches)));
                            break 'found ($at, seen);
                        }
                    };
                }
                if last > n {
                    look!(n);
                    if last > n + group {
                        // From here on the loads are aligned.
                        let mut done = n + group - self.misalignment(within);
                        if const { S::AVX2 } {
                            loop {
                                if done >= last {
                                    crate::hints::leaves();
                                    break;
                                }
                                if let (true, seen) = live!(S::AVX2, self.peek(within.skip(done), &matches)) {
                                    crate::hints::leaves();
                                    return Some(done + self.locate::<false>(seen, &matches));
                                }
                                done += group;
                            }
                        } else {
                            while done < last {
                                look!(done);
                                done += group;
                            }
                        }
                    }
                }
                look!(last);
                return None;
            };
            Some(start + self.locate::<false>(seen, &matches))
        })
    }

    #[inline(always)]
    fn test<const ALL: bool, E: Readable<T>>(
        self,
        within: &[E],
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> bool {
        apart_unoptimized!(self.simd(), {
            let n = Self::LANES;
            let join = always!(|a: MaskOf<T, W, S>, b| if ALL { a & b } else { a | b });
            let end = always!(|mask: MaskOf<T, W, S>| if ALL { mask.all() } else { mask.any() });
            let ends = always!(|of: &[E]| join(matches(self.load_any(of)), matches(self.load_any_last(of))));
            // LLVM tests sign bits a word at a time.
            return_if!(Self::ONE_BY_ONE, {
                let mut rest = within;
                while rest.len() >= 2 * n {
                    if end(ends(&rest[..2 * n])) != ALL {
                        return !ALL;
                    }
                    rest = &rest[2 * n..];
                }
                self.find_one::<false>(
                    E::source(rest),
                    #[inline(always)]
                    |v| if ALL { !matches(v) } else { matches(v) },
                )
                .is_some()
                    != ALL
            });
            if const { Self::IN_ORDER }
                && within.len() < n
                && let Some(within) = E::source(within).as_slice()
            {
                return live!(Self::IN_ORDER, {
                    let (bits, per_lane) = matches(self.load_n(within)).wide_bits();
                    let bits = if ALL { !bits as u32 } else { bits as u32 };
                    (bits & !(!0 << (within.len() as u32 * per_lane)) != 0) != ALL
                });
            }
            if within.len() <= n {
                return_if!(S::PARTIAL && (E::PLAIN || !S::A64), {
                    let (found, valid) = (matches(self.load_any_n(within)), self.first_n(within.len()));
                    if ALL { found.and_not(valid).none() } else { (found & valid).any() }
                });
                if within.len() == n {
                    return end(matches(self.load_any(within)));
                }
                return if within.is_empty() {
                    ALL
                } else {
                    end(matches(
                        choose! { Self::LANES > 4 => self.load_quarters(E::source(within)).0, _ => self.load_ends(Readable::source(within)) },
                    ))
                };
            }
            if within.len() <= 2 * n {
                return end(ends(within));
            }
            let both =
                always!(|a: usize, b: usize| end(join(ends(&within[a..][..2 * n]), ends(&within[b..][..2 * n]))));
            if within.len() <= 4 * n {
                return both(0, within.len() - 2 * n);
            }
            let last = within.len() - 4 * n;
            let four = always!(|at: usize| {
                let of = &within[at..][..4 * n];
                let (a, b) = (ends(&of[..2 * n]), ends(&of[2 * n..]));
                if ALL { (a & b).all() } else { !a.neither(b) }
            });
            if four(0) != ALL {
                return !ALL;
            }
            if last > 4 * n {
                let mut done = Self::back(4 * n, self.misalignment(E::source(within)));
                while done < last {
                    if four(done) != ALL {
                        crate::hints::leaves();
                        return !ALL;
                    }
                    done += 4 * n;
                }
            }
            four(last)
        })
    }

    /// Whether any value matches. This is faster than [`over(x).position`](crate::Over::position) if a match is the exception.
    #[op]
    pub(crate) fn any_if(
        self,
        within: &[impl Readable<T>],
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> bool {
        self.test::<false, _>(within, matches)
    }

    /// Whether all values match.
    #[op]
    pub(crate) fn all_if(
        self,
        within: &[impl Readable<T>],
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> bool {
        self.test::<true, _>(within, matches)
    }

    /// Vector `i` of a group of four, with zeros for the first `seen` values of the group.
    #[on(A64)]
    #[op]
    pub(crate) fn unseen_of(self, v: Simd<T, W, S>, seen: usize, i: usize) -> Simd<T, W, S> {
        const STEP: &[u8; 256] = &crate::access::InPage({
            let (mut all, mut i) = ([0; 256], 128);
            while i < 256 {
                all[i] = 255;
                i += 1;
            }
            all
        })
        .0;
        let from = &STEP[128 - seen % (4 * Self::LANES) * size_of::<T>()..];
        v & self.repartition::<u8>().load(&from[i * W::BYTES..]).bitcast::<T>()
    }
    /// For a vector or more. The last vectors overlap those before, which takes fewer branches than a loop.
    #[op]
    fn count_in_groups(self, all: impl Source<T>, matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>) -> usize {
        let (n, len, d) = (Self::LANES, all.len(), self.to_signed());
        let at = always!(|of, at: usize| matches(self.read(of, at)));
        // -1 where a value matches that isn't one of the first `seen` of the group in which this is vector `i`.
        let new = always!(|found: MaskOf<T, W, S>, seen: usize, i: usize| {
            return_if!(S::A64, d.unseen_of(found.to_vector(), seen, i));
            (d.set(Lane::from_usize(seen)).simd_gt(d.iota(Lane::from_usize(i * n))).retype()).and_not(found).to_vector()
        });
        let total =
            always!(|v: Simd<T::Signed, W, S>| crate::Int::to_u64(v.reduce_sum()).wrapping_neg() as u8 as usize);
        let bits =
            always!(|a: MaskOf<T, W, S>, b, seen: usize| (a.twice(b).to_bitmask() >> seen).count_ones() as usize);
        let by_bits = crate::X86;
        if len <= 2 * n {
            let (a, b, seen) = (at(all, 0), at(all, len - n), 2 * n - len);
            return if by_bits {
                a.count() + (b.to_bitmask() >> seen).count_ones() as usize
            } else {
                total(a.to_vector() + new(b, seen, 0))
            };
        }
        if len <= 4 * n {
            let (first, last, seen) = (all.slice(0..2 * n), all.skip(len - 2 * n).slice(0..2 * n), 4 * n - len);
            let (a, b, c, e) = (at(first, 0), at(first, n), at(last, 0), at(last, n));
            return if by_bits {
                bits(a, b, 0) + bits(c, e, seen)
            } else {
                total(a.to_vector() + b.to_vector() + (new(c, seen, 0) + new(e, seen, 1)))
            };
        }
        if len <= 8 * n {
            let (first, last, seen) = (all.slice(0..4 * n), all.skip(len - 4 * n).slice(0..4 * n), 8 * n - len);
            let (a, b) = (
                [at(first, 0), at(first, n), at(first, 2 * n), at(first, 3 * n)],
                [at(last, 0), at(last, n), at(last, 2 * n), at(last, 3 * n)],
            );
            let sum = a[0].to_vector()
                + a[1].to_vector()
                + (a[2].to_vector() + a[3].to_vector())
                + (new(b[0], seen, 0) + new(b[1], seen, 1) + (new(b[2], seen, 2) + new(b[3], seen, 3)));
            return if by_bits {
                (d.zero() - sum).bitcast::<u8>().sums_of_8().reduce_sum() as usize
            } else {
                total(sum)
            };
        }
        if crate::X86 && len < 16 * n {
            let (mut rest, last, seen) = (all, all.skip(len - 4 * n).slice(0..4 * n), len.wrapping_neg() % (4 * n));
            let mut sum = new(at(last, 0), seen, 0)
                + new(at(last, n), seen, 1)
                + (new(at(last, 2 * n), seen, 2) + new(at(last, 3 * n), seen, 3));
            while rest.len() > 4 * n {
                crate::not_unrolled();
                let four = rest.slice(0..4 * n);
                sum += at(four, 0).to_vector()
                    + at(four, n).to_vector()
                    + (at(four, 2 * n).to_vector() + at(four, 3 * n).to_vector());
                rest = rest.skip(4 * n);
            }
            return (d.zero() - sum).bitcast::<u8>().sums_of_8().reduce_sum() as usize;
        }
        let (mut rest, mut count) = (all, 0);
        if crate::X86 && W::BYTES >= 32 && len >= 16 * n {
            let unaligned = n - self.misalignment(all);
            count = (at(all, 0) & self.first_n(unaligned)).count();
            rest = all.skip(unaligned);
        }
        let (last, seen) = (all.skip(len - 4 * n).slice(0..4 * n), rest.len().wrapping_neg() % (4 * n));
        let mut counts = [
            new(at(last, 0), seen, 0),
            new(at(last, n), seen, 1),
            new(at(last, 2 * n), seen, 2),
            new(at(last, 3 * n), seen, 3),
        ];
        let (mut whole, mut sums) = (rest.slice(0..rest.len() - 1), self.repartition::<u64>().zero());
        loop {
            let most = choose! { size_of::<T>() == 1 => 248 * n, size_of::<T>() < 8 => 65528 * n, _ => usize::MAX };
            // With a multiple of its step, a loop counts to zero, which takes an instruction less.
            let group = whole.slice(0..whole.len().min(most));
            let mut group = group.slice(0..group.len() & !(4 * n - 1));
            whole = whole.skip(group.len().min(whole.len()));
            // With an index, Intel takes a load and its operation apart. LLVM keeps the pointer if it learns late where it ends.
            when!(S::AVX2 && crate::OPTIMIZED && W::BYTES == 32, {
                if let Some(all) = group.as_slice() {
                    let all = crate::lane::Repr::bytes(all).as_chunks::<128>().0;
                    for four in select(crate::tag::nothing(len) == 0, all.iter(), [].iter()) {
                        for i in 0..4 {
                            counts[i] += matches(self.repartition::<u8>().load(&four[32 * i..]).bitcast()).to_vector();
                        }
                    }
                    group = group.slice(0..0);
                }
            });
            // Four sums, since an addition takes two cycles on most AArch64 CPUs.
            while group.len() >= 4 * n {
                let four = group.slice(0..4 * n).read_group(self);
                for i in 0..4 {
                    counts[i] += matches(four[i]).to_vector();
                }
                group = group.skip(4 * n);
            }
            let sum = d.zero() - (counts[0] + counts[1] + (counts[2] + counts[3]));
            sums += choose! {
                size_of::<T>() == 1 => sum.bitcast::<u8>().sums_of_8(),
                size_of::<T>() == 2 => sum.bitcast::<u16>().sums_of_2().sums_of_2(),
                size_of::<T>() == 4 => sum.bitcast::<u32>().sums_of_2(),
                _ => sum.bitcast(),
            };
            if whole.len() < 4 * n {
                return count + sums.reduce_sum() as usize;
            }
            counts = [d.zero(); 4];
        }
    }

    /// The number of values that match. `CountIf`.
    #[inline(always)]
    pub(crate) fn count_if(self, within: impl Source<T>, matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>) -> usize {
        apart_unoptimized!(self.simd(), {
            return_if!(Self::ONE_BY_ONE, self.count_ones_by_one(within, matches));
            let mut within = within;
            let (n, mut count) = (Self::LANES, 0);
            if within.len() < n {
                if const { Self::IN_ORDER }
                    && let Some(within) = within.as_slice()
                {
                    return live!(Self::IN_ORDER, {
                        let (bits, per_lane) = matches(self.load_n(within)).wide_bits();
                        ((bits & !(!0 << (within.len() as u32 * per_lane))).count_ones() / per_lane) as usize
                    });
                }
                return_if!(
                    S::A64 && Self::COUNTS_QUARTERS,
                    if within.is_empty() {
                        0
                    } else {
                        (matches(self.load_quarters(within).0) & self.once(within.len())).count()
                    }
                );
                if const { Self::COUNTS_QUARTERS }
                    && let Some(within) = within.as_slice()
                {
                    return live!(
                        Self::COUNTS_QUARTERS,
                        if within.is_empty() {
                            0
                        } else {
                            (matches(self.load_quarters(within).0) & self.once(within.len())).count()
                        }
                    );
                }
                return (matches(within.read_vector_n(self)) & self.first_n(within.len())).count();
            }
            return_if!(
                W::BYTES == S::REGISTER && W::BYTES <= 32 && (S::A64 || S::WASM || S::SSE41 && !S::HAS_MASKED_MEMORY),
                self.count_in_groups(within, matches)
            );
            // The last vectors, and what is before them of as many from the start.
            macro_rules! ends { ($($k:literal)*) => {$(
                if const { Self::BY_BITS && matches!(W::BYTES, 16..=64) && (S::AVX512VBMI || Self::LANES < 64) } && within.len() <= 2 * $k * n {
                    let (first, before) = (within.slice(0..$k * n), within.len() - $k * n);
                    let last = within.skip(before).slice(0..$k * n);
                    for i in 0..$k {
                        let new = crate::tag::first_bits(self.simd(), before.saturating_sub(i * n), n);
                        count += (matches(self.read(first, i * n)).to_bitmask() & new).count_ones() as usize;
                        count += matches(self.read(last, i * n)).count();
                    }
                    return count;
                }
            )*}; }
            ends!(1 2);
            if crate::X86 && W::BYTES >= 32 && within.len() >= 8 * n {
                let unaligned = n - self.misalignment(within);
                count = (matches(self.read(within, 0)) & self.first_n(unaligned)).count();
                within = within.skip(unaligned);
            }
            let mut whole = within.slice(0..within.len() - within.len() % n);
            count += self.all_but_last(within.len() % n).and_not(matches(self.read_last(within))).count();
            if const { W::BYTES < 8 } || within.len() < if const { S::REGISTER == 64 } { 8 * n } else { 4 * n } {
                // With many lanes, there are mostly one or two rounds.
                while const { Self::LANES >= 32 } && whole.len() >= n {
                    crate::not_unrolled();
                    count += matches(self.read(whole, 0)).count();
                    whole = whole.skip(n);
                }
                while const { Self::LANES < 32 } && whole.len() >= n {
                    count += matches(self.read(whole, 0)).count();
                    whole = whole.skip(n);
                }
                return count;
            }
            let (d, mut sums) = (self.to_unsigned(), self.repartition::<u64>().zero());
            // With a constant, LLVM makes a vector of the mask, which took 2.6 times as long on Sapphire Rapids.
            let one = d.set(Lane::from_usize(if const { S::REGISTER == 64 } { core::hint::black_box(1) } else { 1 }));
            let add = always!(|counts: Simd<T::Unsigned, W, S>, mask: MaskOf<T, W, S>| {
                if_here!(crate::X86 && MaskOf::<T, W, S>::BOTH, {
                    if let Some(v) = live!(MaskOf::<T, W, S>::BOTH, mask.whole()) {
                        return counts - v.bitcast();
                    }
                });
                choose! { S::REGISTER == 64 => mask.retype().if_then_else(counts + one, counts), Self::PACKED => counts.add_small(mask.to_vector().cast_unsigned().bitcast::<T::Unsigned>() >> (T::BITS - 1)), _ => counts - mask.to_vector().bitcast() }
            });
            while !whole.is_empty() {
                let mut group =
                    whole.slice(0..whole.len().min(if const { size_of::<T>() == 1 } { 252 } else { 65532 } * n));
                whole = whole.skip(group.len());
                // Four sums, since an addition takes two cycles on most AArch64 CPUs.
                let mut counts = [d.zero(); 4];
                while group.len() >= 4 * n {
                    let four = group.slice(0..4 * n);
                    for i in 0..4 {
                        let sum = if S::SCALAR { 0 } else { i };
                        counts[sum] = add(counts[sum], matches(self.read(four, i * n)));
                    }
                    group = group.skip(4 * n);
                }
                while group.len() >= n {
                    crate::not_unrolled();
                    counts[0] = add(counts[0], matches(self.read(group, 0)));
                    group = group.skip(n);
                }
                let counts = counts[0] + counts[1] + (counts[2] + counts[3]);
                sums += choose! {
                    size_of::<T>() == 1 => counts.bitcast::<u8>().sums_of_8(),
                    size_of::<T>() == 2 => counts.bitcast::<u16>().sums_of_2().sums_of_2(),
                    size_of::<T>() == 4 => counts.bitcast::<u32>().sums_of_2(),
                    _ => counts.bitcast(),
                };
            }
            count + sums.reduce_sum() as usize
        })
    }

    /// Writes `f` of each value to the start of `to`. Panics if that is too short. It can be the same memory as `from`.
    /// `f` can also work on groups of lanes, if their size is a power of two that divides the length,
    /// and no more than 16 bytes. `Transform`.
    ///
    /// If `f` returns more or fewer lanes than it gets, in the same order, then more or less is written in proportion.
    /// If `from` is a slice, then `f` sees no other values than those in it, and so can check them on the way.
    #[op]
    pub(crate) fn transform<U: Lane, X: Width, F: Source<T>>(
        self,
        from: F,
        to: impl Place<U>,
        f: impl Fn(Simd<T, W, S>) -> Simd<U, X, S>,
    ) {
        require!(of Simd<U, X, S>, "a lane is wider than the vector", X::BYTES >= size_of::<U>());
        let (n, m) = (Self::LANES, Tag::<S, U, X>::LANES);
        // What is too little for a value of `to` would shift the vectors that end with `from`.
        let from = if m < n { from.slice(0..from.len() / (n / m) * (n / m)) } else { from };
        to.slice(0..if m >= n { from.len() * (m / n) } else { from.len() / (n / m) }).mapped(self, from, f)
    }

    /// How many values to skip after the first vector, so that the stores are aligned.
    #[op]
    fn to_aligned<U: Lane>(self, len: usize, address: usize) -> usize {
        let largest_group = 1usize << (len | (16 / size_of::<T>().min(size_of::<U>()))).trailing_zeros();
        (Self::LANES - address / size_of::<U>() % Self::LANES) & largest_group.wrapping_neg()
    }

    /// `to` is empty, and has room for the result only.
    #[op]
    pub(crate) fn transform_to_output<U: Lane, X: Width, E: Copy>(
        self,
        mut from: impl Source<T>,
        to: &mut Output<'_, E>,
        f: impl Fn(Simd<T, W, S>) -> Simd<U, X, S>,
    ) where
        for<'o, 'a> Tail<'o, 'a, E>: Place<U>,
    {
        let (n, m) = (Self::LANES, Tag::<S, U, X>::LANES);
        if from.len() < n {
            return self.transform_all(from, to.tail(), f);
        }
        let all = from;
        if const { Self::in_classes::<U, X>() } {
            macro_rules! group {
                ($k:literal, $from:expr) => {{
                    let (from, group) = ($from.slice(0..$k * n), &mut to.window($k * m));
                    if const { Self::joins::<X>() && $k == 4 } {
                        joined!(self.simd(), |i| f(self.read(from, i * n)), |v| v.write(&mut group.tail(), 0));
                    } else {
                        // LLVM doesn't always know that it is other memory.
                        let mut v = [self.zero(); $k];
                        for i in 0..$k {
                            v[i] = self.read(from, i * n);
                        }
                        for i in 0..$k {
                            f(v[i]).write(&mut group.tail(), 0);
                        }
                    }
                }};
            }
            macro_rules! last {
                ($k:literal) => {{
                    let last = to.capacity() - $k * m;
                    assert!(last <= to.len());
                    to.truncate(last);
                    return group!($k, all.skip(all.len() - $k * n));
                }};
            }
            if all.len() <= 2 * n {
                group!(1, all);
                last!(1);
            }
            if all.len() <= 4 * n {
                group!(2, all);
                last!(2);
            }
            while from.len() > 4 * n && to.has_room(4 * m) {
                group!(4, from);
                from = from.skip(4 * n);
            }
            if from.len() <= n {
                last!(1);
            }
            last!(4);
        }
        if crate::X86 && n == m && from.len() >= 8 * Self::UNROLL * n {
            let skip = self.to_aligned::<U>(from.len(), to.filled().as_ptr().addr());
            f(self.read(from, 0)).write(&mut to.tail(), 0);
            to.truncate(skip);
            from = from.skip(skip);
        }
        while from.len() > Self::UNROLL * n {
            let group = &mut to.window(Self::UNROLL * m);
            if const { Self::joins::<X>() } {
                joined!(self.simd(), |i| f(self.read(from, i * n)), |v| v.write(&mut group.tail(), 0));
            } else {
                for i in 0..Self::UNROLL {
                    f(self.read(from, i * n)).write(&mut group.tail(), 0);
                }
            }
            from = from.skip(Self::UNROLL * n);
        }
        while from.len() > n {
            crate::not_unrolled();
            f(self.read(from, 0)).write(&mut to.tail(), 0);
            from = from.skip(n);
        }
        let last = to.capacity() - m;
        assert!(last <= to.len());
        to.truncate(last);
        f(self.read_last(all)).write(&mut to.tail(), 0)
    }

    #[op]
    pub(crate) fn transform_all<U: Lane, X: Width, F: Source<T>, P: Place<U>>(
        self,
        mut from: F,
        mut to: P,
        f: impl Fn(Simd<T, W, S>) -> Simd<U, X, S>,
    ) {
        let (n, m) = (Self::LANES, Tag::<S, U, X>::LANES);
        // If not, both can be the same memory, and what overlaps has to be read before it is written.
        let slices = from.as_slice().is_some() || to.as_mut_slice().is_some() || to.uninit_address().is_some();
        if const { !F::SLICE } && from.len() < n {
            if from.is_empty() {
                return;
            }
            return if Self::BY_BITS && F::MASKED && (slices || to.shared_address().is_some()) {
                live!(Self::BY_BITS && F::MASKED, f(self.read_n(from)).write_n(&mut to, 0))
            } else {
                f(self.load_ends(from)).store_ends(to)
            };
        }
        if const { F::SLICE }
            && let (Some(from), true) = (from.as_slice(), from.len() < n)
        {
            let Some(&first) = from.first() else { return };
            if const { P::SLICE && S::PARTIAL } {
                return f(self.load_n_or(first, from)).write_n(&mut to, 0);
            }
            if const { !P::SLICE && (P::ANY_ORDER || !S::A64) }
                && (Self::TO_UNINIT && to.uninit_address().is_some() || Self::BY_BITS && to.shared_address().is_some())
            {
                return live!(Self::TO_UNINIT && !P::SLICE, f(self.load_n_or(first, from)).write_n(&mut to, 0));
            }
            return self.transform_short(from, to, f);
        }
        if const { (F::SLICE || !P::SHARED) && Self::in_classes::<U, X>() } {
            let len = from.len();
            if len <= 2 * n {
                let (at, first, last) = (to.len() - m, f(self.read(from, 0)), f(self.read_last(from)));
                first.write(&mut to, 0);
                return last.write(&mut to, at);
            }
            macro_rules! group {
                ($k:literal, $from:expr, $to:expr) => {{
                    let (from, mut to) = ($from.slice(0..$k * n), $to.slice(0..$k * m));
                    if const { Self::joins::<X>() && $k == 4 } {
                        joined!(self.simd(), |i| f(self.read(from, i * n)), |v| v.write(&mut to, 0));
                    } else {
                        for i in 0..$k {
                            f(self.read(from, i * n)).write(&mut to, i * m);
                        }
                    }
                }};
            }
            if len <= 4 * n {
                group!(2, from, to.again());
                let at = to.len() - 2 * m;
                return group!(2, from.skip(len - 2 * n), to.skip(at));
            }
            let (mut rest, mut room) = (from, to.again());
            while rest.len() > 4 * n && room.len() > 4 * m {
                group!(4, rest, room.again());
                (rest, room) = (rest.skip(4 * n), room.skip(4 * m));
            }
            drop(room);
            if rest.len() <= n {
                let at = to.len() - m;
                return f(self.read_last(from)).write(&mut to, at);
            }
            let at = to.len() - 4 * m;
            return group!(4, from.skip(len - 4 * n), to.skip(at));
        }
        if const { Self::in_classes::<U, X>() && W::BYTES == 16 && X::BYTES == 16 } && from.len() > 2 * n {
            return live!(Self::in_classes::<U, X>() && W::BYTES == 16 && X::BYTES == 16, {
                let four = always!(|v: [Simd<T, W, S>; 4]| {
                    let mut all = [Tag::<S, U, X>::new(self.simd()).zero(); 4];
                    for i in 0..4 {
                        all[i] = f(v[i]);
                    }
                    all[0].concat(all[1]).concat(all[2].concat(all[3]))
                });
                let (len, room) = (from.len(), to.len());
                if len <= 4 * n {
                    let all = four([
                        self.read(from, 0),
                        self.read(from, n),
                        self.read(from, len - 2 * n),
                        self.read_last(from),
                    ]);
                    all.lower_half().write(&mut to, 0);
                    return all.upper_half().write(&mut to, room - 2 * m);
                }
                let (last, mut rest) = (four(from.skip(len - 4 * n).read_group(self)), to.again());
                while from.len() > 4 * n && rest.len() > 4 * m {
                    four(from.read_group(self)).write(&mut rest, 0);
                    (from, rest) = (from.skip(4 * n), rest.skip(4 * m));
                }
                drop(rest);
                last.write(&mut to, room - 4 * m)
            });
        }
        // On x86, a store across a cache line takes twice as long, and one across a page 20 to 35 cycles.
        if crate::X86
            && n == m
            && from.len() >= 8 * Self::UNROLL * n
            && let Some(start) =
                to.uninit_address().or(to.shared_address()).or(to.as_mut_slice().map(|to| to.as_ptr().addr()))
        {
            let skip = self.to_aligned::<U>(from.len(), start);
            let (first, next) = (
                f(self.read(from, 0)),
                if const { !F::SLICE && !P::SLICE } && !slices { Some(f(self.read(from, skip))) } else { None },
            );
            first.write(&mut to, 0);
            (from, to) = (from.skip(skip), to.skip(skip));
            if const { !F::SLICE && !P::SLICE }
                && let Some(next) = next
            {
                next.write(&mut to, 0);
                (from, to) = (from.skip(n), to.skip(n));
            }
        }
        let wide = S::A64 && X::BYTES >= 4 * W::BYTES && X::BYTES > S::REGISTER;
        while !wide && from.len() >= (Self::UNROLL + 1) * n && to.len() >= (Self::UNROLL + 1) * m {
            if const { Self::joins::<X>() } && slices {
                joined!(self.simd(), |i| f(self.read(from, i * n)), |v| v.write(&mut to, 0));
            } else {
                for i in 0..Self::UNROLL {
                    f(self.read(from, i * n)).write(&mut to, i * m);
                }
            }
            (from, to) = (from.skip(Self::UNROLL * n), to.skip(Self::UNROLL * m));
        }
        while from.len() >= 2 * n && to.len() >= 2 * m {
            crate::not_unrolled();
            f(self.read(from, 0)).write(&mut to, 0);
            (from, to) = (from.skip(n), to.skip(m));
        }
        let (at, last) = (to.len() - m, f(self.read(from, from.len() - n)));
        if from.len() > n {
            f(self.read(from, 0)).write(&mut to, 0);
        }
        last.write(&mut to, at);
    }

    /// [`map_into`](Self::map_into) up to the first value that matches `stop`. Returns its index, or the length. The
    /// rest of the first `from.len()` values of `to` can change. Highway doesn't have this.
    #[op]
    pub(crate) fn transform_until<U: Lane, X: Width, P: Place<U>>(
        self,
        from: &[impl Readable<T>],
        to: P,
        stop: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
        f: impl Fn(Simd<T, W, S>) -> Simd<U, X, S>,
    ) -> usize {
        let (n, len, mut to) = (Self::LANES, from.len(), to.slice(0..from.len()));
        if len < n {
            // A part of an output can start after its end.
            if const { S::PARTIAL && P::MASKED } && (P::ANY_ORDER || len != 0) {
                let v = self.load_any_n(from);
                f(v).write_n(&mut to, 0);
                return stop(v).count_before_first().min(len);
            }
            if len == 0 {
                return 0;
            }
            // As in `transform_short`.
            return choose! {
                Tag::<S, U, X>::IN_QUARTERS && Self::IN_QUARTERS && Self::LANES == Tag::<S, U, X>::LANES && !P::SHARED => {
                    let (v, quarters) = self.load_quarters(Readable::source(from));
                    f(v).store_quarters(to);
                    stop(v).first_set().map_or(len, #[inline(always)] |lane| self.place(quarters, lane, len))
                },
                _ => {
                    let v = self.load_ends(Readable::source(from));
                    f(v).store_ends(to);
                    let (lane, part) = (stop(v).count_before_first(), 1 << len.ilog2());
                    select(lane < part, lane, (lane + len).wrapping_sub(2 * part).min(len))
                },
            };
        }
        // The shape of `find_if`.
        macro_rules! one {
            ($from:expr, $to:expr, $at:expr) => {{
                let v = self.load_any(&$from[$at..]);
                $to.store($at, f(v));
                v
            }};
        }
        let group = Self::UNROLL * n;
        macro_rules! chunk {
            ($at:expr) => {{
                let (from, mut to) = (&from[$at..][..group], to.again().skip($at).slice(0..group));
                let all = choose! {
                    Self::joins::<X>() => {
                        let all = [self.load_any(from), self.load_any(&from[n..]), self.load_any(&from[2 * n..]), self.load_any(&from[3 * n..])];
                        joined!(self.simd(), |i| f(all[i]), |v| to.store(0, v));
                        all
                    },
                    Self::UNROLL == 4 => [one!(from, to, 0), one!(from, to, n), one!(from, to, 2 * n), one!(from, to, 3 * n)],
                    _ => {
                        let (a, b) = (one!(from, to, 0), one!(from, to, n));
                        [a, b, a, b]
                    },
                };
                self.look_at::<false>(all, &stop).map(#[inline(always)] |seen| self.locate::<false>(seen, &stop))
            }};
        }
        if let Some(at) = self.find_in::<false>(stop(one!(from, to, 0))) {
            return at;
        }
        if len <= 2 * n {
            return len - n + stop(one!(from, to, len - n)).count_before_first();
        }
        if const { Self::UNROLL == 4 } && len <= group {
            let (a, b, c) = (one!(from, to, n), one!(from, to, len - 2 * n), one!(from, to, len - n));
            return live!(
                Self::UNROLL == 4,
                self.find_in_three::<false>((n, a), (len - 2 * n, b, c), &stop).unwrap_or(len)
            );
        }
        let last = len - group;
        if last > n {
            // From here on the stores are aligned, or on x86 the wider side.
            let mut done = n
                - choose! { S::A64 && !cfg!(target_vendor = "apple") && size_of::<U>() == size_of::<T>() => self.misalignment(Readable::source(from)), !crate::X86 || size_of::<U>() >= size_of::<T>() => to.address().unwrap_or(0) / size_of::<U>() % n, _ => self.misalignment(Readable::source(from)) };
            while done < last {
                if let Some(at) = chunk!(done) {
                    return done + at;
                }
                done += group;
            }
        }
        if let Some(at) = chunk!(last) { last + at } else { len }
    }

    /// Replaces each value by `f` of it.
    #[op]
    pub(crate) fn transform_in_place(self, values: &mut [T], f: impl Fn(Simd<T, W, S>) -> Simd<T, W, S>) {
        if values.len() < Self::LANES {
            return_if!(
                Self::IN_QUARTERS && !S::PARTIAL,
                if !values.is_empty() {
                    if const { S::A64 && crate::OPTIMIZED } && values.len() >= 4 {
                        return f(self.load_quarters(&*values).0).store_quarters(values);
                    }
                    f(self.load_quarters(&*values).0).store_quarters(values)
                }
            );
            return_if!(crate::X86 && Self::CELLS_BY_BITS, self.replace_n(values, always!(|v| (f(v), ()))));
            return f(self.load_short(values)).store_short(values);
        }
        // What overlaps is read before the loops, and written after them.
        let (n, first, last) = (Self::LANES, f(self.load(values)), f(self.load_last(values)));
        if const { Self::in_classes::<T, W>() } {
            let len = values.len();
            if len > 2 * n {
                let c = f(self.load(&values[len - 2 * n..]));
                if len <= 4 * n {
                    f(self.load(&values[n..])).store(&mut values[n..]);
                } else {
                    let (a, b) = (f(self.load(&values[len - 4 * n..])), f(self.load(&values[len - 3 * n..])));
                    let largest_group = 1usize << (len | (16 / size_of::<T>())).trailing_zeros();
                    let skip = (n - self.misalignment(&*values)) & largest_group.wrapping_neg();
                    let mut rest = &mut values[skip..];
                    while rest.len() > 4 * n {
                        for i in 0..4 {
                            f(self.load(&rest[i * n..])).store(&mut rest[i * n..]);
                        }
                        rest = &mut rest[4 * n..];
                    }
                    a.store(&mut values[len - 4 * n..]);
                    b.store(&mut values[len - 3 * n..]);
                }
                c.store(&mut values[len - 2 * n..]);
            }
            first.store(values);
            return last.store_last(values);
        }
        let mut skip = n;
        if crate::X86 && values.len() >= 8 * Self::UNROLL * n {
            let largest_group = 1usize << (values.len() | (16 / size_of::<T>())).trailing_zeros();
            skip = (n - self.misalignment(&*values)) & largest_group.wrapping_neg();
        }
        let mut rest = &mut values[skip..];
        while rest.len() > Self::UNROLL * n {
            for i in 0..Self::UNROLL {
                f(self.load(&rest[i * n..])).store(&mut rest[i * n..]);
            }
            rest = &mut rest[Self::UNROLL * n..];
        }
        while rest.len() > n {
            crate::not_unrolled();
            f(self.load(rest)).store(rest);
            rest = &mut rest[n..];
        }
        first.store(values);
        last.store_last(values);
    }

    /// The index of the last value that matches.
    #[inline(always)]
    pub(crate) fn find_last_if(
        self,
        within: impl Source<T>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        apart_unoptimized!(self.simd(), {
            return_if!(Self::ONE_BY_ONE, self.find_one::<true>(within, matches));
            let (n, len, group) = (Self::LANES, within.len(), Self::UNROLL * Self::LANES);
            if len < n {
                return self.find_in_short::<true, _>(within, matches);
            }
            if let Some(at) = self.find_in::<true>(matches(self.read_last(within))) {
                return Some(len - n + at);
            }
            if len <= 2 * n {
                return self.branch_on::<true>(matches(self.read(within, 0)));
            }
            if const { Self::UNROLL == 4 } && len <= group {
                let two = (0, self.read(within, 0), self.read(within, n));
                return live!(
                    Self::UNROLL == 4,
                    self.find_in_three::<true>((len - 2 * n, self.read(within, len - 2 * n)), two, &matches)
                );
            }
            let (start, seen) = 'found: {
                macro_rules! look {
                    ($of:expr, $at:expr) => {
                        if let Some(seen) = self.look($of.skip($at), &matches) {
                            return_if!(!S::ARM, Some($at + self.locate::<true>(seen, &matches)));
                            break 'found ($at, seen);
                        }
                    };
                }
                if len > n + group {
                    let before = len - n - group;
                    look!(within, before);
                    if before > group {
                        let end = before + (self.misalignment(within) + len).wrapping_neg() % n;
                        // With forced frame pointers, the frame is made on the way to the panic on Arm and AVX-512, and at the start if there is none. AVX2 is faster without.
                        let mut rest = within
                            .slice(0..choose! { S::ARM || crate::X86 && S::REGISTER == 64 => end, _ => len.min(end) });
                        if const { S::AVX2 && S::REGISTER == 32 } {
                            loop {
                                if rest.len() <= group {
                                    crate::hints::leaves();
                                    break;
                                }
                                let before = rest.len() - group;
                                if let (true, seen) =
                                    live!(S::AVX2 && S::REGISTER == 32, self.peek(rest.skip(before), &matches))
                                {
                                    crate::hints::leaves();
                                    return Some(before + self.locate::<true>(seen, &matches));
                                }
                                rest = rest.slice(0..before);
                            }
                        } else {
                            while rest.len() > group {
                                let before = rest.len() - group;
                                look!(rest, before);
                                rest = rest.slice(0..before);
                            }
                        }
                    }
                }
                look!(within, 0);
                return None;
            };
            Some(start + self.locate::<true>(seen, &matches))
        })
    }
}

impl<S: Isa, T: crate::Signed, W: Width> crate::mask::Mask<T, W, S> {
    #[op]
    fn twice(self, hi: Self) -> crate::mask::Mask<T, W::Twice, S> {
        if_here!(crate::X86 && Self::BOTH, {
            if let (Some(lo), Some(hi)) = live!(Self::BOTH, (self.moved(), hi.moved())) {
                let both = crate::regs::number(lo) | crate::regs::number(hi) << Self::LANES;
                return crate::mask::Mask::from_bits(self.s, both).given();
            }
        });
        crate::mask::Mask::combine(crate::raw::same(hi), crate::raw::same(self))
    }
    /// Whether no lane of both is true.
    #[op]
    pub(crate) fn neither(self, other: Self) -> bool {
        // `addhn` joins and narrows.
        return_if!(S::A64 && !S::SVE2 && W::BYTES == 16 && size_of::<T>() > 1, {
            let sum = self.to_vector().bitcast::<u16>() + other.to_vector().bitcast::<u16>();
            (sum >> 8).cast::<u8>().bitcast::<u64>().get_lane() == 0
        });
        (self | other).none()
    }
    #[op]
    pub(crate) fn find_in_both<const LAST: bool>(self, hi: Self) -> usize {
        // As many bits for each lane in both.
        let bits = always!(|m: Self| choose! { Self::BOTH => (m.to_bitmask(), 1u32), _ => m.wide_bits() });
        let ((lo, per_lane), hi, n) = (bits(self), bits(hi).0, Self::LANES as u32);
        let of = always!(|bits: u64| 63u32.wrapping_sub(bits.leading_zeros()) / per_lane);
        if n * per_lane <= 32 {
            // LLVM would join four numbers in a vector.
            let hi =
                choose! { crate::X86 && S::REGISTER == 32 && Self::LANES == 32 => crate::regs::number(hi), _ => hi };
            let both = lo | hi << (n * per_lane % 64);
            return (if LAST { of(both) } else { both.trailing_zeros() / per_lane }) as usize;
        }
        (if LAST {
            select(hi != 0, n.wrapping_add(of(hi)), of(lo))
        } else {
            select(lo != 0, lo.trailing_zeros() / per_lane, n + hi.trailing_zeros() / per_lane)
        }) as usize
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// The reverse of [`load_short`](crate::Simd::load_short), for a slice of the same length and a vector with as many lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (from, mut to) = (b"abc", [0; 3]);
    /// (u8x16::load_short(from) ^ 0x20).store_short(&mut to);
    /// assert_eq!(&to, b"ABC");
    /// # } example()
    /// ```
    #[op]
    pub fn store_short(self, to: &mut [impl crate::Writable<T>]) {
        return_if!(S::PARTIAL, self.store_rest(to));
        self.store_ends(crate::Writable::place(to))
    }

    /// The reverse of `load_quarters`, for `IN_QUARTERS`.
    #[op]
    fn store_quarters(self, mut to: impl Place<T>) {
        let (len, lower, upper) = (to.len(), self.lower_half(), self.upper_half());
        return_if!(Self::LANES > 16, {
            if let Some(at) = len.checked_sub(Self::LANES / 2) {
                lower.write(&mut to, 0);
                return upper.write(&mut to, at);
            }
            lower.store_quarters(to)
        });
        if let Some(last) = len.checked_sub(4) {
            let step = last.min(4);
            lower.lower_half().write(&mut to, 0);
            lower.upper_half().write(&mut to, step);
            upper.lower_half().write(&mut to, last.saturating_sub(4));
            return upper.upper_half().write(&mut to, last);
        }
        let lanes = lower.lower_half().to_array();
        to.write(0, [lanes.as_ref()[0]]);
        to.write(len / 2, [lanes.as_ref()[1]]);
        to.write(len - 1, [lanes.as_ref()[3]]);
    }

    #[inline(always)]
    pub(crate) fn store_ends<P: Place<T>>(self, to: P) {
        apart_unoptimized!(self.s, |to: P| {
            let mut to = to;
            return_if!(
                W::BYTES / size_of::<T>() <= 2,
                if !to.is_empty() {
                    to.write(0, [self.get_lane()])
                }
            );
            if let Some(at) = to.len().checked_sub(self.tag().lanes() / 2) {
                self.lower_half().write(&mut to, 0);
                return self.upper_half().write(&mut to, at);
            }
            live!(W::BYTES / size_of::<T>() > 2, again!(Simd::store_ends, self.lower_half(), to))
        })
    }
}
