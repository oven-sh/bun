//! Loops over bitmaps in memory, and indices.

use crate::closures::inlined_here;
use crate::columns::Items;
use crate::lane::{Int, Kind};
use crate::{Columns, Isa, Lane, MaskOf, Over, Place, Readable, Region, Scaled, Simd, Sink, Tag, Unsigned, Width};

type V<T, W, S> = Simd<T, W, S>;
type M<T, W, S> = MaskOf<T, W, S>;

/// The items of `I`, after their indices.
#[derive(Copy, Clone)]
pub struct Enumerate<U, I>(U, I);
impl<U: Unsigned, I> Enumerate<U, I> {
    #[op]
    fn from<T: Lane, W: Width, S: Isa>(self, s: S, seen: usize) -> V<U, Scaled<T, U, W>, S> {
        Tag::new(s).iota(U::ZERO) + Tag::new(s).set(U::from_u64(self.0.to_u64().wrapping_add(seen as u64)))
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa, U: Unsigned, I: Items<T, W, S>> Items<T, W, S> for Enumerate<U, I> {
    type Item = (V<U, Scaled<T, U, W>, S>, I::Item);
    const PLAIN: bool = I::PLAIN;
    #[inline(always)]
    fn behind(self, to: usize) -> usize {
        self.1.behind(to)
    }
    #[inline(always)]
    fn how_many(self) -> usize {
        self.1.how_many()
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        Self(U::from_u64(self.0.to_u64().wrapping_add(at as u64)), self.1.items_at(at, n))
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        (self.from::<T, W, S>(s, 0), self.1.load_whole(s))
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        (self.from::<T, W, S>(s, 0), self.1.load_rest(s))
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        (self.from::<T, W, S>(s, 0), self.1.load_rest_or(s, or))
    }
    const SLIDES: bool = I::SLIDES;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        (self.from::<T, W, S>(s, seen), self.1.load_after(s, seen))
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        (self.from::<T, W, S>(s, seen), self.1.load_after_or(s, seen, or))
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        (it.0, self.1.only(it.1, keep))
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        (it.0, self.1.only_or(it.1, keep, or))
    }
}

/// The items of `I`, before their bits, which start at an index of a bit.
pub struct ZipBits<'a, I, B>(I, &'a [B], usize);
impl<I: Copy, B> Copy for ZipBits<'_, I, B> {}
impl<I: Copy, B> Clone for ZipBits<'_, I, B> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<I, B: Readable<u64>> ZipBits<'_, I, B> {
    /// From `at` on, and then zeros.
    #[op]
    fn bits(&self, at: usize, lanes: usize) -> u64 {
        let word = always!(|k: usize| if let Some(it) = self.1.get(k) { it.value() } else { 0 });
        let (k, skip) = (at / 64, at % 64);
        let lower = word(k) >> skip;
        // Most loops start at a multiple of the lanes.
        if skip + lanes <= 64 {
            return lower;
        }
        core::hint::cold_path();
        lower | word(k + 1) << (64 - skip)
    }
    #[op]
    fn mask<T: Lane, W: Width, S: Isa>(&self, s: S, seen: usize, n: usize) -> M<T, W, S> {
        let lanes = V::<T, W, S>::LANES;
        Tag::<S, T, W>::new(s).mask_from_bits(self.bits(self.2 + seen, lanes) & crate::partial::first_bits(n, lanes))
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>, B: Readable<u64>> Items<T, W, S> for ZipBits<'_, I, B> {
    type Item = (I::Item, M<T, W, S>);
    const PLAIN: bool = I::PLAIN && B::PLAIN;
    #[inline(always)]
    fn behind(self, to: usize) -> usize {
        self.0.behind(to)
    }
    #[inline(always)]
    fn how_many(self) -> usize {
        self.0.how_many()
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        Self(self.0.items_at(at, n), self.1, self.2 + at)
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        (self.0.load_whole(s), Tag::<S, T, W>::new(s).mask_from_bits(self.bits(self.2, V::<T, W, S>::LANES)))
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        (self.0.load_rest(s), self.mask::<T, W, S>(s, 0, self.how_many()))
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        (self.0.load_rest_or(s, or), self.mask::<T, W, S>(s, 0, self.how_many()))
    }
    const SLIDES: bool = I::SLIDES && B::PLAIN;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        (self.0.load_after(s, seen), self.mask::<T, W, S>(s, seen, self.how_many() - seen))
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        (self.0.load_after_or(s, seen, or), self.mask::<T, W, S>(s, seen, self.how_many() - seen))
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        (self.0.only(it.0, keep), it.1 & keep)
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        (self.0.only_or(it.0, keep, or), it.1 & keep)
    }
}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Columns<T, W, S, I> {
    /// As [`Over::enumerate`].
    #[op]
    #[track_caller]
    pub fn enumerate<U: Unsigned>(self) -> Columns<T, W, S, Enumerate<U, I>> {
        require!(
            "there is no vector with as many lanes of that type: the widths are 2 to 512 bytes",
            V::<T, W, S>::LANES == V::<U, Scaled<T, U, W>, S>::LANES
        );
        self.with(Enumerate(U::ZERO, self.items()))
    }
    /// As [`Over::zip_bits`].
    #[op]
    #[track_caller]
    pub fn zip_bits<B: Readable<u64>>(self, bits: &[B]) -> Columns<T, W, S, ZipBits<'_, I, B>> {
        let Selected { all, bits } = self.selected(bits);
        self.with(ZipBits(all.items(), bits, 0))
    }
    /// As [`Over::selected`].
    #[op]
    #[track_caller]
    pub fn selected<B: Readable<u64>>(self, bits: &[B]) -> Selected<'_, T, W, S, I, B> {
        V::<T, W, S>::all_bits_of_lanes();
        Selected { all: self.window(0, self.len().min(bits.len().saturating_mul(64))), bits }
    }
}

impl<'a, T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'a, T, W, S, E> {
    /// The closures get a pair, as after `Iterator::enumerate`: a vector with the index of each value, and the values. The indices wrap,
    /// and go on in the padding. Their width is [`Scaled`]. It doesn't build if there is no such width.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut at = [0u32; 4];
    /// let n = over(&[0.0f32, 2.0, 0.0, 1.0]).enumerate().filter_map_into(&mut at, |(i, v)| (v.simd_ne(0.0), i));
    /// assert_eq!(at[..n], [1, 3]);
    /// # } example()
    /// ```
    #[doc(alias("index", "indices", "indexed", "nonzero", "argwhere"))]
    #[op]
    #[track_caller]
    pub fn enumerate<U: Unsigned>(self) -> Columns<T, W, S, Enumerate<U, Self>> {
        Columns::new(self.parts().0, self).enumerate()
    }
    /// Next to a bitmap, as [`bitmask_into`](Self::bitmask_into) writes it, up to the end of the shorter side. The closures get a pair of the values and
    /// a mask, which is false in the padding. It doesn't build for more than 64 lanes. [`selected`](Self::selected) skips what has no bit.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 3];
    /// over(&[1, 2, 3]).zip_bits(&[0b101u64]).map_into(&mut to, |(v, valid)| valid.select(v, -1));
    /// assert_eq!(to, [1, -1, 3]);
    /// # } example()
    /// ```
    #[doc(alias("bitmap", "bitset", "validity", "nulls", "zip_mask"))]
    #[op]
    #[track_caller]
    pub fn zip_bits<B: Readable<u64>>(self, bits: &[B]) -> Columns<T, W, S, ZipBits<'_, Self, B>> {
        Columns::new(self.parts().0, self).zip_bits(bits)
    }
    /// The values whose bits are set in a bitmap, as [`bitmask_into`](Self::bitmask_into) writes it. Those after its end are left out. It doesn't build for more than 64 lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (some, mut to) = (over(&[5, 1, 7, 3]).selected(&[0b1101u64]), [0; 3]);
    /// assert_eq!((some.sum(), some.min(), some.max()), (15, Some(3), Some(7)));
    /// assert_eq!((some.map_into(&mut to, |v| v), to), (3, [5, 7, 3]));
    /// # } example()
    /// ```
    #[doc(alias("bitmap", "bitset", "validity", "nulls", "selection", "masked", "compact"))]
    #[op]
    #[track_caller]
    pub fn selected<B: Readable<u64>>(self, bits: &[B]) -> Selected<'_, T, W, S, Self, B> {
        Columns::new(self.parts().0, self).selected(bits)
    }
    /// The reverse of [`selected`](Self::selected): where a bit is set, `to` gets the next value, and elsewhere `fill`. It ends with `to` or the bitmap,
    /// and returns the number of values that it took. Panics if there are too few. It doesn't build for more than 64 lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 4];
    /// assert_eq!(over(&[5, 7, 3]).expand_into(&mut to, &[0b1101u64], -1), 3);
    /// assert_eq!(to, [5, -1, 7, 3]);
    /// # } example()
    /// ```
    #[doc(alias("scatter_by_mask", "unfilter", "spread", "decompress", "definition_levels", "bitmap", "validity"))]
    #[op]
    #[track_caller]
    pub fn expand_into(self, to: &mut (impl Sink<T> + ?Sized), bits: &[impl Readable<u64>], fill: T) -> usize {
        V::<T, W, S>::all_bits_of_lanes();
        let (s, from) = self.parts();
        Tag::<S, T, W>::new(s).expand_all(from, to.place(), bits, fill)
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// Up to this many of 64 values are expanded one by one.
    const FEW_TO_EXPAND: u32 = if S::SCALAR || S::BY_HAND || S::A64 && T::BITS == 64 {
        64
    } else if S::REGISTER == 64 {
        0
    } else {
        T::BITS / 2
    };
    #[op]
    fn expand_all<E: Readable<T>, P: Place<T>>(
        self,
        all: &[E],
        to: P,
        mut bits: &[impl Readable<u64>],
        fill: T,
    ) -> usize {
        let (s, n, or, mut from) = (self.simd(), V::<T, W, S>::LANES, self.set(fill), all);
        let len = to.len().min(bits.len().saturating_mul(64));
        let mut to = to.slice(0..len);
        while to.len() >= 64
            && let Some(next) = from.first_chunk::<64>()
            && let Some((word, more)) = bits.split_first()
        {
            let (word, mut here) = (word.value(), to.again().slice(0..64));
            let count = word.count_ones() as usize;
            if const { S::REGISTER < 64 } && word == !0 {
                for j in 0..64 / n {
                    E::load::<W, S>(&next[j * n..], s).write(&mut here, j * n);
                }
            } else if const { Self::FEW_TO_EXPAND > 0 } && count <= Self::FEW_TO_EXPAND as usize {
                self.expand_few(next, here.again(), word, fill);
            } else {
                let mut at = 0;
                for j in 0..64 / n {
                    let part = word >> (j * n) & !0 >> (64 - n);
                    self.expand_whole(&next[at.min(j * n)..], part, Some(or)).write(&mut here, j * n);
                    at += crate::ops::count_bits_on::<S>(part, n);
                }
            }
            drop(here);
            (from, to, bits) = (&from[count..], to.skip(64), more);
        }
        // Whole vectors can't be loaded any more.
        while to.len() >= 64
            && let Some((word, more)) = bits.split_first()
        {
            crate::not_unrolled();
            let (word, here) = (word.value(), to.again().slice(0..64));
            let count = word.count_ones() as usize;
            if count <= Self::FEW_TO_EXPAND.max(8) as usize {
                self.expand_few(from, here, word, fill);
            } else {
                self.expand_last(from, here, word, or);
            }
            (from, to, bits) = (&from[count..], to.skip(64), more);
        }
        if let Some(word) = bits.first()
            && !to.is_empty()
        {
            let word = word.value() & crate::partial::first_bits(to.len(), 64);
            self.expand_last(from, to, word, or);
            from = &from[word.count_ones() as usize..];
        }
        all.len() - from.len()
    }
    /// `to` has room for 64 values.
    #[op]
    fn expand_few<P: Place<T>>(self, from: &[impl Readable<T>], mut to: P, mut word: u64, fill: T) {
        let (n, mut all) = (V::<T, W, S>::LANES, [fill; 64]);
        for j in 0..if P::ANY_ORDER { 64 / n } else { 0 } {
            self.set(fill).write(&mut to, j * n);
        }
        for it in &from[..word.count_ones() as usize] {
            let at = word.trailing_zeros() as usize % 64;
            if P::ANY_ORDER {
                to.write(at, [it.value()])
            } else {
                all[at] = it.value()
            }
            word &= word.wrapping_sub(1);
        }
        for j in 0..if P::ANY_ORDER { 0 } else { 64 / n } {
            self.load(&all[j * n..]).write(&mut to, j * n);
        }
    }
    #[op]
    fn expand_last(self, mut from: &[impl Readable<T>], mut to: impl Place<T>, mut word: u64, or: V<T, W, S>) {
        let (n, mut at) = (V::<T, W, S>::LANES, 0);
        assert!(word.count_ones() as usize <= from.len());
        while at < to.len() {
            crate::not_unrolled();
            let part = word & !0 >> (64 - n);
            self.load_expanded(from, part, Some(or)).write_n(&mut to, at);
            (from, word, at) = (&from[part.count_ones() as usize..], word >> (n - 1) >> 1, at + n);
        }
    }
}

/// The values that a bitmap selects: see [`Over::selected`]. The loops skip each 64 values that have no bit.
///
/// The rules for closures are those of [`Over`]. Padding stands in for what is not selected. For the other loops, there is [`zip_bits`](Over::zip_bits).
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (x, y, valid) = ([1.0, 2.0, 3.0], [4.0, f32::NAN, 6.0], [0b101u64]);
/// let dot = over(&x).zip(&y).selected(&valid).fold(f32xN::zero(), |sum, (x, y)| sum + x * y, |a, b| a + b);
/// assert_eq!(dot.reduce_sum(), 22.0);
/// # } example()
/// ```
pub struct Selected<'a, T: Lane, W: Width, S: Isa, I, B = u64> {
    all: Columns<T, W, S, I>,
    bits: &'a [B],
}
impl<T: Lane, W: Width, S: Isa, I: Copy, B> Copy for Selected<'_, T, W, S, I, B> {}
impl<T: Lane, W: Width, S: Isa, I: Copy, B> Clone for Selected<'_, T, W, S, I, B> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>, B: Readable<u64>> Selected<'_, T, W, S, I, B> {
    const N: usize = V::<T, W, S>::LANES;
    /// Vectors that are worked on side by side.
    const GROUP: usize = {
        let most = if W::BYTES > 2 * S::REGISTER {
            1
        } else if W::BYTES > S::REGISTER {
            2
        } else {
            4
        };
        if Self::N * most > 64 { 64usize.div_ceil(Self::N) } else { most }
    };
    /// Up to this many of 64 values are added one by one.
    const FEW: u32 = if S::SCALAR {
        64
    } else if S::REGISTER < 64 || T::BITS >= 32 {
        let half = 4 * T::BITS / S::REGISTER as u32;
        if half > 2 { half } else { 2 }
    } else {
        0
    };
    /// For `GROUP` vectors. One broadcast serves several.
    #[op]
    fn masks(self, bits: u64) -> [M<T, W, S>; 4] {
        let (s, d) = (self.all.isa(), Tag::<S, T, W>::new(self.all.isa()));
        return_if!(S::REGISTER < 64 && Self::GROUP == 4, {
            let both = Tag::<S, T, <W::Twice as Width>::Twice>::new(s).mask_from_bits(bits);
            let (lower, upper) = (both.lower_half(), both.upper_half());
            let same = crate::raw::same;
            [same(lower.lower_half()), same(lower.upper_half()), same(upper.lower_half()), same(upper.upper_half())]
        });
        return_if!(S::REGISTER < 64 && Self::GROUP == 2, {
            let both = Tag::<S, T, W::Twice>::new(s).mask_from_bits(bits);
            let [lower, upper]: [M<T, W, S>; 2] =
                [crate::raw::same(both.lower_half()), crate::raw::same(both.upper_half())];
            [lower, upper, lower, upper]
        });
        crate::array::own::from_fn(
            #[inline(always)]
            |j| d.mask_from_bits(bits >> (j % Self::GROUP * Self::N)),
        )
    }
    /// `one` gets 64 items and an index, where up to `few` are selected.
    #[op]
    fn walk<const IN_ORDER: bool, A: Copy, F: Copy>(
        self,
        (init, step, join): (A, impl Fn(A, I::Item) -> A, impl Fn(A, A) -> A),
        (few, mut single, one): (u32, F, impl Fn(F, Columns<T, W, S, I>, usize) -> F),
    ) -> (A, F) {
        let (Self { all, mut bits }, n, group) = (self, Self::N, const { if IN_ORDER { 1 } else { Self::GROUP } });
        // With mask registers, a mask for a vector or two takes no longer than a branch.
        let always = const { S::REGISTER == 64 && T::BITS <= 16 };
        let (mut sums, mut left) = ([init; 4], all);
        macro_rules! each {
            (|$j:ident| $it:expr) => { each!($j $it; 0 1 2 3) };
            ($j:ident $it:expr; $($k:literal)*) => {$(
                if $k < group {
                    let $j = $k;
                    sums[$j] = step(sums[$j], $it);
                }
            )*};
        }
        while left.len() >= 64
            && let Some((word, more)) = bits.split_first()
        {
            let (mut word, here) = (word.value(), left.window(0, 64));
            (left, bits) = (left.window(64, left.len() - 64), more);
            if !always && word == !0 {
                for g in 0..64 / n / group {
                    each!(|j| here.at((g * group + j) * n));
                }
            } else if word == 0 || few > 0 && word.count_ones() <= few {
                while few > 0 && word != 0 {
                    single = one(single, here, word.trailing_zeros() as usize % 64);
                    word &= word - 1;
                }
            } else {
                for g in 0..64 / n / group {
                    let bits = word >> (g * group * n);
                    let masks = choose! { IN_ORDER => [Tag::<S, T, W>::new(all.isa()).mask_from_bits(bits); 4], _ => self.masks(bits) };
                    each!(|j| all.items().only(here.at((g * group + j) * n), masks[j]));
                }
            }
        }
        let mut at = all.len() - left.len();
        if let Some(word) = bits.first()
            && at < all.len()
        {
            let (mut word, d) =
                (word.value() & crate::partial::first_bits(all.len() - at, 64), Tag::<S, T, W>::new(all.isa()));
            while word != 0 {
                crate::not_unrolled();
                let it = if all.has(at, n) { all.at(at) } else { all.rest(at) };
                sums[0] = step(sums[0], all.items().only(it, d.mask_from_bits(word)));
                (word, at) = (word >> (n - 1) >> 1, at + n);
            }
        }
        let [a, b, c, d] = sums;
        (
            if group == 4 {
                join(join(a, b), join(c, d))
            } else if group == 2 {
                join(a, b)
            } else {
                a
            },
            single,
        )
    }

    /// The number of values.
    #[op]
    pub fn count(self) -> usize {
        let (len, mut count) = (self.all.len(), 0);
        for word in &self.bits[..len / 64] {
            count += word.value().count_ones() as usize;
        }
        if let Some(word) = self.bits.get(len / 64) {
            count += (word.value() & !(!0 << (len % 64))).count_ones() as usize;
        }
        count
    }
    /// As [`Over::fold`], but with up to five accumulators, and a value can be in any lane. What is not selected is zero, but for the indices of `enumerate`, or else see [`pad`](Over::pad), which comes before `selected`.
    #[op]
    pub fn fold<A: Copy>(self, init: A, step: impl Fn(A, I::Item) -> A, join: impl Fn(A, A) -> A) -> A {
        let s = self.all.isa();
        inlined_here!(s, step(a, b), join(a, b));
        let one =
            always!(|sum: A, here: Columns<T, W, S, I>, i: usize| step(sum, here.items().items_at(i, 1).load_rest(s)));
        let (a, b) = self.walk::<false, _, _>((init, &step, &join), (Self::FEW, init, one));
        join(a, b)
    }
    /// Writes `f` of each value to the start of `to`, with no gaps, and returns their number. Panics if they don't fit. `f` has to return as many lanes as it gets.
    /// There has to be room for these only, but what is after them can change. `to` can be what is read, as cells, from the same start.
    #[doc(alias("copy_into", "compact", "filter_into", "collect"))]
    #[op]
    #[track_caller]
    pub fn map_into<R: Lane, Y: Width>(
        self,
        to: &mut (impl Sink<R> + ?Sized),
        f: impl Fn(I::Item) -> V<R, Y, S>,
    ) -> usize {
        require!("the result has to have as many lanes", Self::N == V::<R, Y, S>::LANES);
        inlined_here!(self.all.isa(), f(a));
        self.compact(to.place(), f)
    }
    #[op]
    fn compact<R: Lane, Y: Width>(self, mut to: impl Place<R>, f: impl Fn(I::Item) -> V<R, Y, S>) -> usize {
        let (Self { all, mut bits }, s, n, room) = (self, self.all.isa(), Self::N, to.len());
        let few = const {
            let vectors = (64 * size_of::<T>() / W::BYTES) as u32;
            if S::SCALAR || S::BY_HAND {
                64
            } else if S::REGISTER == 64 || vectors > 8 {
                vectors
            } else {
                8
            }
        } * const { if S::ARM { 2 } else { 1 } };
        let one = always!(|here: Columns<T, W, S, I>, word: u64| {
            f(here.items().items_at(word.trailing_zeros() as usize % 64, 1).load_rest(s)).get_lane()
        });
        let (mut left, mut free) = (all, to.again());
        while left.len() >= 64
            && free.len() >= 64
            && let Some((word, more)) = bits.split_first()
        {
            let (mut word, here, mut to, mut end) = (word.value(), left.window(0, 64), free.again().slice(0..64), 0);
            let count = word.count_ones() as usize;
            if word.count_ones() <= few {
                while word != 0 {
                    to.write(end % 64, [one(here, word)]);
                    (end, word) = (end + 1, word & (word - 1));
                }
            } else {
                for j in 0..64 / n {
                    end += f(here.at(j * n)).compress_parts_write(word >> (j * n), &mut to, end.min(j * n));
                }
            }
            drop(to);
            (left, bits, free) = (left.window(64, left.len() - 64), more, free.skip(count));
        }
        let (mut at, mut count) = (all.len() - left.len(), room - free.len());
        drop(free);
        while at < all.len()
            && let Some((word, more)) = bits.split_first()
        {
            crate::not_unrolled();
            let word = word.value();
            if word == 0 {
                (at, bits) = (at + 64, more);
                continue;
            }
            let (mut word, mut next) = (word & crate::partial::first_bits(all.len() - at, 64), at);
            assert!(word.count_ones() as usize <= room - count);
            if all.has(at, 64) && word.count_ones() <= few {
                let here = all.window(at, 64);
                while word != 0 {
                    to.write(count, [one(here, word)]);
                    (count, word) = (count + 1, word & (word - 1));
                }
            }
            while word != 0 {
                crate::not_unrolled();
                let (it, part) = (if all.has(next, n) { all.at(next) } else { all.rest(next) }, word & !0 >> (64 - n));
                f(it).compress_own(part).write_n(&mut to, count);
                (count, word, next) = (count + part.count_ones() as usize, word >> (n - 1) >> 1, next + n);
            }
            (at, bits) = (at + 64, more);
        }
        to.keep(count);
        count
    }
}

impl<'a, T: Lane, W: Width, S: Isa, E: Readable<T>, B: Readable<u64>> Selected<'_, T, W, S, Over<'a, T, W, S, E>, B> {
    const FLOAT: bool = matches!(T::KIND, Kind::Float);
    /// As [`Over::sum`] of the values that have a bit, with zeros for what is not selected.
    #[op]
    pub fn sum(self) -> T {
        let (s, d) = (self.all.isa(), Tag::<S, T, W>::new(self.all.isa()));
        return_if!(Self::FLOAT, {
            let all = Columns::new(s, Over::<T, crate::B128, S, E>::new(s, self.all.items().parts().1));
            let add = always!(|a: V<T, crate::B128, S>, b| a + b);
            let none = always!(|(), _, _| ());
            let first = crate::over::first_part::<T>(all.len()).unwrap_or(all.len());
            let (mut sum, mut at, mut end) = (s.fixed::<T, crate::B16>().zero(), 0, first);
            while at < end {
                let part = Selected { all: all.window(at, end - at), bits: &self.bits[at / 64..] };
                sum +=
                    crate::over::halves_added(part.walk::<true, _, _>((Tag::new(s).zero(), add, add), (0, (), none)).0);
                (at, end) = (end, all.len());
            }
            sum.get_lane()
        });
        let add = always!(|a: V<T, W, S>, b| a + b);
        let one = always!(|sum: u64, here: Columns<T, W, S, Over<'a, T, W, S, E>>, i: usize| {
            sum.wrapping_add(T::unsigned(&[here.items().parts().1[i].value()])[0].to_u64())
        });
        let (a, b) = self.walk::<false, _, _>((d.zero(), add, add), (Self::FEW, 0, one));
        (s.fixed::<T, crate::B16>().set(a.reduce_sum()) + T::from_u64(b)).get_lane()
    }
    /// The first value that matches.
    #[op]
    fn find(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> Option<T> {
        let (mut left, mut bits) = (self.all, &self.bits[..self.all.len().div_ceil(64)]);
        loop {
            // The next words that have bits.
            let from = bits.iter().position(|word| word.value() != 0)?;
            let more = &bits[from + 1..];
            let to = from + 1 + more.iter().position(|word| word.value() == 0).unwrap_or(more.len());
            let end = left.len().min(to.saturating_mul(64));
            let here = left.window(64 * from, end - 64 * from);
            if let Some(at) = here.zip_bits(&bits[from..]).position(
                #[inline(always)]
                |(v, keep)| matches(v) & keep,
            ) {
                return Some(here.items().parts().1[at].value());
            }
            (left, bits) = (left.window(end, left.len() - end), &bits[to..]);
        }
    }
    #[op]
    fn extreme<const MAX: bool>(self) -> Option<T> {
        let d = Tag::<S, T, W>::new(self.all.isa());
        let finite = d.set(if MAX { T::MIN } else { T::MAX });
        let start = choose! { Self::FLOAT => finite + finite, _ => finite };
        let step = always!(|a: V<T, W, S>, v: V<T, W, S>| better::<MAX, _, _, _>(a, v));
        let one = always!(|a: T, here: Columns<T, W, S, crate::columns::Pad<Over<'a, T, W, S, E>, T>>, i: usize| {
            let v = here.unpadded().items().parts().1[i].value();
            if if MAX { v > a } else { v < a } { v } else { a }
        });
        let padded = Selected { all: self.all.pad(start.get_lane()), bits: self.bits };
        // A comparison of one `f16` can be a call.
        let few = if V::<T, W, S>::HALF { 0 } else { Self::FEW };
        let (a, b) = padded.walk::<false, _, _>((start, step, step), (few, start.get_lane(), one));
        let a = d.set(if MAX { a.reduce_max_relaxed() } else { a.reduce_min_relaxed() });
        let found = better::<MAX, _, _, _>(a, d.set(b));
        let is = always!(|v: V<T, W, S>| found.simd_eq(v).test(0));
        if const { Self::FLOAT } && is(d.zero()) {
            let wanted = if MAX { d.zero() } else { d.sign_bit() };
            let signs = always!(|v: V<T, W, S>| v.cast_unsigned().simd_eq(wanted.cast_unsigned()).retype());
            return Some(if self.find(signs).is_some() { wanted } else { wanted ^ d.sign_bit() }.get_lane());
        }
        if is(start) {
            core::hint::cold_path();
            let first = self.find(
                #[inline(always)]
                |_| d.mask_true(),
            )?;
            return_if!(
                Self::FLOAT,
                Some(
                    self.find(
                        #[inline(always)]
                        |v| v.simd_eq(start)
                    )
                    .unwrap_or(first)
                )
            );
            // The same, unless the bits have changed.
            return Some(first);
        }
        Some(found.get_lane())
    }
    /// As [`Over::min`].
    #[inline(always)]
    pub fn min(self) -> Option<T> {
        self.extreme::<false>()
    }
    /// As [`Over::max`].
    #[inline(always)]
    pub fn max(self) -> Option<T> {
        self.extreme::<true>()
    }
}

/// `a` is not NaN.
#[op]
fn better<const MAX: bool, T: Lane, W: Width, S: Isa>(a: V<T, W, S>, v: V<T, W, S>) -> V<T, W, S> {
    return_if!(matches!(T::KIND, Kind::Float), if MAX { v.if_greater(a) } else { v.if_less(a) });
    if MAX { a.simd_max(v) } else { a.simd_min(v) }
}

impl<S: Isa, T: crate::Signed, W: Width> crate::mask::Mask<T, W, S> {
    /// Writes a bit for each lane to the first bytes of `to`: lane `i` is bit `i % 8` of byte `i / 8`. With fewer than 8 lanes, the other bits of the byte are zero.
    /// Panics if `to` is too short. It takes any number of lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut bits = [0; 2];
    /// u8x16::iota(0).simd_gt(6).store_bitmask(&mut bits);
    /// assert_eq!(bits, [0x80, 0xff]);
    /// assert_eq!(mask8x16::load_bitmask(&bits).first_set(), Some(7));
    /// # } example()
    /// ```
    #[doc(alias("StoreMaskBits", "store_mask_bits", "bitmap"))]
    #[op]
    #[track_caller]
    pub fn store_bitmask<E: crate::Writable<u8>>(self, to: &mut (impl crate::SliceMut<Item = E> + ?Sized)) {
        self.store_mask_bits(crate::whole::has_room::<crate::whole::Bits<T, W>, _>(to))
    }
    #[op]
    #[track_caller]
    fn store_mask_bits<E: crate::Writable<u8>>(self, to: &mut [E]) {
        let to = &mut to[..Self::LANES.div_ceil(8)];
        return_if!(Self::LANES > 64 || Self::IS_BITS && W::BYTES > 64 && Self::LANES > 8, |this: Self = self, to: &mut [E] = to| {
            let (lower, upper) = to.split_at_mut(Self::LANES / 16);
            this.lower_half().store_mask_bits(lower);
            this.upper_half().store_mask_bits(upper)
        });
        let bits = choose! { Self::IS_BITS && Self::LANES >= 8 && cfg!(target_arch = "x86_64") => self.own_bits(), _ => self.to_bitmask() };
        let mut to = E::place(to);
        match Self::LANES {
            64 => to.write(0, bits.to_le_bytes()),
            32 => to.write(0, (bits as u32).to_le_bytes()),
            16 => to.write(0, (bits as u16).to_le_bytes()),
            _ => to.write(0, [bits as u8]),
        }
    }
}
impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    #[track_caller]
    pub(crate) fn load_mask_bits(self, from: &(impl crate::Slice<Item = u8> + ?Sized)) -> M<T, W, S> {
        self.mask_of_bytes(crate::whole::has::<crate::whole::Bits<T, W>, _>(from))
    }
    #[op]
    fn mask_of_bytes(self, from: &[u8]) -> M<T, W, S> {
        let (lanes, from) = (V::<T, W, S>::LANES, &from[..V::<T, W, S>::LANES.div_ceil(8)]);
        return_if!(V::<T, W, S>::LANES > 64 || S::REGISTER == 64 && W::BYTES > 64, |this: Self = self, from: &[u8] = from| {
            let (lower, upper) = from.split_at(V::<T, W, S>::LANES / 16);
            this.combine_masks(this.half().mask_of_bytes(upper), this.half().mask_of_bytes(lower))
        });
        self.mask_from_bits(match lanes {
            64 => u64::from_le_bytes(*from.first_chunk().unwrap()),
            32 => u32::from_le_bytes(*from.first_chunk().unwrap()) as u64,
            16 => u16::from_le_bytes(*from.first_chunk().unwrap()) as u64,
            _ => from[0] as u64,
        })
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// Whether the upper half is better loaded from where its values are.
    const EXPANDS_HALVES: bool = !S::SCALAR
        && W::BYTES > 16
        && V::<T, W, S>::LANES <= 64
        && (W::BYTES > S::REGISTER
            || S::COMPRESS[size_of::<T>().trailing_zeros() as usize] < 64
                && (T::BITS == 8 || T::BITS == 16 && S::REGISTER < 64));
    #[op]
    #[track_caller]
    pub(crate) fn load_expanded<E: Readable<T>>(
        self,
        from: &[E],
        enable: impl crate::Keep<T, W, S>,
        or: Option<V<T, W, S>>,
    ) -> V<T, W, S> {
        if const { Self::EXPANDS_HALVES } && from.len() >= V::<T, W, S>::LANES {
            return live!(Self::EXPANDS_HALVES, {
                let bits = enable.kept(self);
                choose! { crate::X86 && Self::EXPANDS_BLOCKS => self.expand_blocks(from, bits, crate::Keep::as_mask(enable, self.simd()), or), _ => self.expand_whole(from, bits, or) }
            });
        }
        self.load_whole_or_rest(from).expand_any(enable, or)
    }
    /// The same for each block of a register.
    const EXPANDS_BLOCKS: bool = crate::X86 && Self::EXPANDS_HALVES && W::BYTES <= S::REGISTER;
    #[on(X86)]
    #[op]
    fn expand_blocks<E: Readable<T>>(
        self,
        from: &[E],
        bits: u64,
        mask: M<T, W, S>,
        or: Option<V<T, W, S>>,
    ) -> V<T, W, S> {
        let (from, n) = (&from[..V::<T, W, S>::LANES], 16 / size_of::<T>());
        let v = self.from_parts(
            0,
            &mut passed!(|k: usize| {
                E::load::<crate::B16, S>(
                    &from[((bits & !(!0 << (k * n))).count_ones() as usize).min(k * n)..],
                    self.simd(),
                )
            }),
        );
        // Shifts run on other ports than shuffles.
        let mut sums = mask.to_vector().cast_unsigned();
        when!(T::BITS == 8, sums += (sums.bitcast::<u64>() << 8).bitcast());
        sums += (sums.bitcast::<u64>() << 16).bitcast();
        sums += (sums.bitcast::<u64>() << 32).bitcast();
        let last = if T::BITS == 8 { 0x0707_0707_0707_0707 } else { 0x0706_0706_0706_0706 };
        let ranks = !(sums + sums.table_lookup_bytes(self.repartition::<u64>().dup128([!0, last])).bitcast());
        let at = choose! { T::BITS == 8 => ranks.bitcast::<u8>(), _ => (ranks.bitcast::<u16>() * 0x0202 + 0x0100).bitcast() };
        v.table_lookup_bytes(at).bitcast::<T>().kept_or(mask, or)
    }
    /// `from` has a value for each lane.
    #[inline(always)]
    fn expand_whole<E: Readable<T>>(self, from: &[E], bits: u64, or: Option<V<T, W, S>>) -> V<T, W, S> {
        apart!(self.simd(), {
            return_if!(
                crate::X86 && Self::EXPANDS_BLOCKS,
                self.expand_blocks(from, bits, self.mask_from_bits(bits), or)
            );
            return_if!(S::A64 && V::<T, W, S>::RANKS_AT_ONCE, {
                let (s, from) = (self.simd(), &from[..V::<T, W, S>::LANES]);
                let sums = V::<T, W, S>::counted(s, bits);
                let v = self.from_parts(
                    0,
                    &mut passed!(|k| E::load::<crate::B16, S>(
                        &from[((sums << 8 >> (16 * k)) as u8 as usize).min(16 * k)..],
                        s
                    )),
                );
                // What is before the upper half of a block, in that block.
                v.bytes_or(V::<T, W, S>::ranks(s, bits, (sums << 8).wrapping_sub(sums << 16), 0x80), or)
            });
            return_if!(Self::EXPANDS_HALVES, |this: Self = self, from: &[E] = from, bits: u64 = bits, or: Option<V<T, W, S>> = or| {
                let (n, d) = (V::<T, W, S>::LANES / 2, this.half());
                let (from, [lower, upper]) = (&from[..2 * n], match or {
                    Some(or) => [Some(or.lower_half()), Some(or.upper_half())],
                    None => [None; 2],
                });
                let before = crate::ops::count_bits_on::<S>(bits, n).min(n);
                this.combine(d.expand_whole(&from[before..], bits >> n, upper), d.expand_whole(from, bits, lower))
            });
            E::load::<W, S>(from, self.simd()).expand_any(bits, or)
        })
    }
}
