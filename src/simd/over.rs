//! Loops over slices.

use crate::closures::inlined_here;
use crate::f16;
use crate::gate::Enter;
use crate::lane::Kind;
use crate::{
    B16, B64, Columns, Float, Isa, Lane, Mapped, MaskOf, Output, Readable, Region, SameSize, Scaled, Simd, Sink, Tag,
    Width, bf16,
};
use core::marker::PhantomData;

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// Several slices side by side, up to the end of the shortest. The closures get an array of vectors. See [`Columns`](crate::Columns).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (x, y, z, mut to) = ([1.0, 2.0], [2.0, 3.0], [2.0, 6.0], [0.0; 2]);
    /// f32xN::over_all([&x, &y, &z]).map_into(&mut to, |[x, y, z]| (x * x + y * y + z * z).sqrt());
    /// assert_eq!(to, [3.0, 7.0]);
    /// # } example()
    /// ```
    #[doc(alias("zip3", "zip4", "zip_all", "multizip", "izip", "SoA"))]
    over_all[const K: usize, E: crate::Readable<T>](slices: [&[E]; K]) -> crate::Columns<T, W, $S, [&[E]; K]> = const crate::make::Fits::<K>::SLICES; |d| crate::Columns::new(d.simd(), slices);
} }; }
crate::make::enabled! { of_slices
    [/// A slice, a vector of this type at a time.
    ] {
        #[track_caller]
        pub fn over<E: crate::Readable<T>>(values: &[E]) -> crate::Over<'_, T, W, S, E> where crate::Code: crate::At<S> { crate::Over::new(S::here(), values) }
    }
    [/// A slice that is changed in place, a vector at a time.
    ] {
        #[track_caller]
        pub fn over_mut(values: &mut [T]) -> crate::OverMut<'_, T, W, S> where crate::Code: crate::At<S> { crate::OverMut::new(S::here(), values) }
    }
}
/// In `WithToken`.
macro_rules! on_token {
    () => {
        /// A slice, a register at a time. [`by`](crate::Over::by) chooses another width.
        #[op]
        fn over<T: crate::Lane, E: crate::Readable<T>>(
            self,
            values: &[E],
        ) -> crate::Over<'_, T, Self::Native, Self, E> {
            crate::Over::new(self, values)
        }
        /// A slice that is changed in place, a vector at a time.
        #[op]
        fn over_mut<T: crate::Lane>(self, values: &mut [T]) -> crate::OverMut<'_, T, Self::Native, Self> {
            crate::OverMut::new(self, values)
        }
    };
}
pub(crate) use {makers, on_token};

type V<T, W, S> = Simd<T, W, S>;
type M<T, W, S> = MaskOf<T, W, S>;

/// A slice of any length, seen a vector at a time. The methods have the names of those of `Iterator`, and take care of
/// the values that don't fill a vector.
///
/// The closures can see a value more than once, also next to padding, and have to treat all lanes alike. They can run for an empty slice, too.
///
/// ```
/// use bun_simd::prelude::*;
/// # #[kernel] fn example() {
/// assert_eq!(over(b"a,b;c").position(|v| v.simd_eq(b',') | v.simd_eq(b';')), Some(1));
/// assert_eq!(u16x8::over(&[1, 2, 300]).max(), Some(300));
/// # } example()
/// ```
pub struct Over<
    'a, // No iterator: see exact() and padded(). map_into(to, f) writes to a slice, and over_mut(x).map(f) changes one.
    T: Lane,
    W: Width,
    S: Isa,
    E = T,
> {
    d: Tag<S, T, W>,
    values: &'a [E],
}

/// A slice that is changed a vector at a time. See [`Over`]. To change several slices, records, or one next to several others, see [`as_cells`](crate::mem::as_cells).
pub struct OverMut<'a, T: Lane, W: Width, S: Isa> {
    d: Tag<S, T, W>,
    values: &'a mut [T],
}

/// Two slices side by side. See [`Over::zip`].
pub type Zip<'a, T, W, U, X, S, E = T, F = U> = Columns<T, W, S, (Over<'a, T, W, S, E>, Over<'a, U, X, S, F>)>;

/// A slice that is changed, next to one that is read. See [`OverMut::zip`].
pub struct ZipMut<'a, T: Lane, W: Width, U: Lane, S: Isa, F = U> {
    d: Tag<S, T, W>,
    values: &'a mut [T],
    y: &'a [F],
    lane: PhantomData<U>,
}

impl<T: Lane, W: Width, S: Isa, E> Copy for Over<'_, T, W, S, E> {}
impl<T: Lane, W: Width, S: Isa, E> Clone for Over<'_, T, W, S, E> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

macro_rules! methods { ($($(#[$m:meta])* fn $name:ident $([$($g:tt)*])? ($($args:tt)*) $(-> $out:ty)? $body:block)*) => {$(
    $(#[$m])* #[op] pub fn $name<$($($g)*)?>($($args)*) $(-> $out)? $body
)*}; }

impl<'a, T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'a, T, W, S, E> {
    #[op]
    #[track_caller]
    pub(crate) fn new(s: S, values: &'a [E]) -> Self {
        Self { d: Tag::new(s), values }
    }
    methods! {
    /// The same slice in vectors of another width.
    #[track_caller]
    fn by[X: Width](self) -> Over<'a, T, X, S, E> { Over::new(self.d.simd(), self.values) }
    /// The index of the first value that matches. For one match after another, there is [`positions`](Self::positions).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"key=value").position(|v| v.simd_eq(b'=')), Some(3));
    /// # } example()
    /// ```
    #[doc(alias("FindIf", "Find", "find_if", "memchr", "find"))]
    fn position(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> Option<usize> { inlined_here!(self.d.simd(), matches(a)); self.d.find_if(E::source(self.values), matches) }
    /// The index of the last value that matches.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"a/b/c").rposition(|v| v.simd_eq(b'/')), Some(3));
    /// # } example()
    /// ```
    #[doc(alias("find_last_if", "memrchr", "rfind"))]
    fn rposition(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> Option<usize> { inlined_here!(self.d.simd(), matches(a)); self.d.find_last_if(E::source(self.values), matches) }
    /// Whether any value matches. This is faster than [`position`](Self::position) if a match is the exception.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert!(over("né".as_bytes()).any(|v| v.simd_gt(0x7f)));
    /// # } example()
    /// ```
    #[doc(alias("any_if", "contains"))]
    fn any(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> bool {
        inlined_here!(self.d.simd(), matches(a));
        self.d.any_if(self.values, matches)
    }
    /// Whether all values match.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert!(over(b"2026").all(|v| v.within(b'0'..=b'9')));
    /// # } example()
    /// ```
    #[doc(alias("all_if"))]
    fn all(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> bool {
        inlined_here!(self.d.simd(), matches(a));
        self.d.all_if(self.values, matches)
    }
    /// The number of values that match.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"a\nb\n").count(|v| v.simd_eq(b'\n')), 2);
    /// # } example()
    /// ```
    #[doc(alias("CountIf", "Count", "count_if"))]
    fn count(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize { inlined_here!(self.d.simd(), matches(a)); self.d.count_if(E::source(self.values), matches) }
    /// Writes `f` of each value to the start of `to`. Panics if that is too short. It can be the same memory, as cells, if no more is written than is read.
    /// `f` can see a value twice, in any lane, and next to padding. It can work on groups of lanes, such as pairs, if their size is a power of two
    /// that divides the length, up to 16 bytes. Otherwise, and for state, there is [`scan_into`](Self::scan_into). On x86, the stores to long slices are aligned as far as the groups allow.
    ///
    /// If `f` returns more or fewer lanes than it gets, in the same order, then more or less is written in proportion, rounded down. An array of vectors is interleaved.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (mut upper, mut wide) = ([0; 3], [0u16; 3]);
    /// over(b"abc").map_into(&mut upper, |v| v ^ 0x20);
    /// over(b"abc").map_into(&mut wide, |v| v.cast());
    /// assert_eq!((upper, wide), (*b"ABC", [97, 98, 99]));
    /// let mut hex = [0; 4];
    /// over(&[0x1fu8, 0xa0]).map_into(&mut hex, |v| array::map([v >> 4, v & 15], |it| it.lookup(b"0123456789abcdef")));
    /// assert_eq!(&hex, b"1fa0");
    /// # } example()
    /// ```
    #[doc(alias("Transform", "transform"))]
    fn map_into[U: Lane, O: Mapped<U, S>](self, /* for cells: &mut &cells[..] */ to: &mut (impl Sink<U> + ?Sized), f: impl Fn(V<T, W, S>) -> O) {
        return_if!(O::EACH > 1, Columns::new(self.d.simd(), self).map_into(to, f));
        inlined_here!(self.d.simd(), f(a));
        self.d.transform(E::source(self.values), to.place(), #[inline(always)] |v| f(v).first_vector().narrowed_from(v))
    }
    /// All whole vectors, and what is left.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (vectors, rest) = u32x4::over(&[1; 10]).exact();
    /// assert_eq!((vectors.len(), rest.len()), (2, 2));
    /// # } example()
    /// ```
    #[doc(alias("chunks", "chunks_exact", "as_simd"))]
    fn exact(self) -> (impl ExactSizeIterator<Item = V<T, W, S>> + DoubleEndedIterator, &'a [E]) {
        let (d, chunks) = (self.d, self.values.chunks_exact(V::<T, W, S>::LANES));
        let rest = chunks.remainder();
        (chunks.map(#[inline(always)] move |chunk| E::load(chunk, d.simd())), rest)
    }
    /// All values in vectors, of which the last is padded with zeros, each with a bit for each lane that counts.
    /// For two slices, [`zip`](Self::zip) comes first.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let valid: Vec<u64> = u32x4::over(&[1; 6]).padded().map(|(_, valid)| valid).collect();
    /// assert_eq!(valid, [0b1111, 0b0011]);
    /// # } example()
    /// ```
    #[doc(alias("blocks", "chunks_padded"))]
    #[track_caller]
    fn padded(self) -> impl ExactSizeIterator<Item = (V<T, W, S>, u64)> {
        V::<T, W, S>::all_bits_of_lanes();
        Padded(self, self.values)
    }
    }
}

/// One test for each whole vector.
struct Padded<'a, T: Lane, W: Width, S: Isa, E>(Over<'a, T, W, S, E>, &'a [E]);
impl<T: Lane, W: Width, S: Isa, E: Readable<T>> Iterator for Padded<'_, T, W, S, E> {
    type Item = (V<T, W, S>, u64);
    #[op]
    fn next(&mut self) -> Option<Self::Item> {
        let (Over { d, values }, n) = (self.0, V::<T, W, S>::LANES);
        if let Some((whole, rest)) = values.split_at_checked(n) {
            self.0.values = rest;
            return Some((E::load(whole, d.simd()), !0 >> (64 - n)));
        }
        if values.is_empty() {
            return None;
        }
        self.0.values = &values[..0];
        // A call, until the adapters of `core` are inlined.
        let all = self.1;
        let last = always!(|| (d.load_end(all, values), crate::tag::fewer_bits(d.simd(), values.len())));
        Some(
            choose! { size_of::<T>() >= 4 => Enter::short_call(d.simd(), last), _ => Enter::only_call(d.simd(), last) },
        )
    }
    #[op]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = self.0.values.len().div_ceil(V::<T, W, S>::LANES);
        (n, Some(n))
    }
}
impl<T: Lane, W: Width, S: Isa, E: Readable<T>> ExactSizeIterator for Padded<'_, T, W, S, E> {}

impl<'a, T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'a, T, W, S, E> {
    /// Neither the order nor the width matters to this.
    #[op]
    fn extreme<const MAX: bool>(self, found: T) -> T {
        let d = self.d;
        // `==` on `f16` is a call.
        let is = always!(
            |v: V<T, W, S>| choose! { V::<T, W, S>::HALF => v.simd_eq(found).any(), _ => found == v.get_lane() }
        );
        if is(d.zero()) {
            let signs = always!(|v: V<T, W, S>| {
                v.cast_unsigned().simd_eq(if MAX { d.zero() } else { d.sign_bit() }.cast_unsigned()).retype()
            });
            return if d.any_if(self.values, signs) == MAX { T::default() } else { d.sign_bit().get_lane() };
        }
        if is(self.start::<MAX>())
            && !d.any_if(
                self.values,
                #[inline(always)]
                |v| v.simd_eq(found),
            )
        {
            return self.values[0].value();
        }
        found
    }
    /// An infinity.
    #[op]
    fn start<const MAX: bool>(self) -> V<T, W, S> {
        let finite = self.d.set(if MAX { T::MIN } else { T::MAX });
        finite + finite
    }
    /// `a` is not NaN.
    #[op]
    fn keep<const MAX: bool>(a: V<T, W, S>, v: V<T, W, S>) -> V<T, W, S> {
        if MAX { v.if_greater(a) } else { v.if_less(a) }
    }
    /// One instruction of NEON knows the sign of zero, and tells if there is a NaN.
    const OR_NAN: bool = S::NEON && cfg!(target_arch = "aarch64") && T::BITS >= 32;
    /// Unless `EXACT`, a zero has any sign, and nothing but NaN can give an infinity.
    #[op]
    #[allow(clippy::eq_op, reason = "NaN")]
    fn float_extreme<const MAX: bool, const EXACT: bool>(self) -> Option<T> {
        let (_, start) = (self.values.first()?, self.start::<MAX>());
        if const { V::<T, W, S>::HALF } {
            // As integers, among which those with the sign that is looked for come last. One of both ends is it, or NaN.
            let bits = always!(|v: V<T, W, S>| if MAX { v.bitcast::<i16>() } else { v.bitcast::<i16>() ^ i16::MIN });
            let join = always!(|a: (V<i16, W, S>, V<i16, W, S>), b: (_, _)| (a.0.simd_min(b.0), a.1.simd_max(b.1)));
            let (low, high) = self.d.fold_overlapping(
                self.values,
                #[inline(always)]
                |v| (bits(v), bits(v)),
                #[inline(always)]
                |a, v| join(a, (bits(v), bits(v))),
                join,
            );
            let (low, high) = live!(V::<T, W, S>::HALF, (low.reduce_min(), high.reduce_max()));
            let found = if high >= 0 { high } else { low };
            if found & 0x7fff <= 0x7fff >> T::FRACTION << T::FRACTION {
                return Some(
                    T::of_unsigned(&[Lane::from_u64((found as u16 ^ if MAX { 0 } else { 0x8000 }) as u64)])[0],
                );
            }
            core::hint::cold_path();
        }
        if_here!(Self::OR_NAN, {
            let found = across::<MAX, _, _, _>(self.d.fold_overlapping(
                self.values,
                #[inline(always)]
                |v| v,
                or_nan::<MAX, _, _, _>,
                or_nan::<MAX, _, _, _>,
            ));
            if found == found {
                return Some(found);
            }
            core::hint::cold_path();
        });
        let all = self.d.fold_overlapping(
            self.values,
            #[inline(always)]
            |v| Self::keep::<MAX>(start, v),
            #[inline(always)]
            |a, v| Self::keep::<MAX>(a, v),
            #[inline(always)]
            |a, v| Self::keep::<MAX>(a, v),
        );
        let found = choose! { MAX => all.reduce_max_relaxed(), _ => all.reduce_min_relaxed() };
        Some(choose! { EXACT => self.extreme::<MAX>(found), _ => found })
    }
    #[inline(always)]
    fn position_extreme<const MAX: bool>(self) -> Option<usize> {
        apart_unoptimized!(self.d.simd(), {
            let (d, values) = (self.d, self.values);
            if const { S::PARTIAL && E::PLAIN && !V::<T, W, S>::HALF } && values.len() < d.lanes() {
                return live!(S::PARTIAL && E::PLAIN && !V::<T, W, S>::HALF, {
                    // The padding is at 0 too.
                    let v = d.load_any_or(values, values.first()?.value());
                    let all = choose! { Self::FLOAT => Self::keep::<MAX>(self.start::<MAX>(), v), _ => v };
                    Some(
                        v.simd_eq(choose! { MAX => all.reduce_max_relaxed(), _ => all.reduce_min_relaxed() })
                            .first_set()
                            .unwrap_or(0),
                    )
                });
            }
            if const { !S::PARTIAL && !S::SCALAR && E::PLAIN && !V::<T, W, S>::HALF && V::<T, W, S>::LANES > 2 }
                && values.len() < d.lanes()
            {
                return live!(
                    !S::PARTIAL && !S::SCALAR && E::PLAIN && !V::<T, W, S>::HALF && V::<T, W, S>::LANES > 2,
                    {
                        values.first()?;
                        let (v, quarters) = d.load_quarters(E::source(values));
                        let all = choose! { Self::FLOAT => Self::keep::<MAX>(self.start::<MAX>(), v), _ => v };
                        Some(
                            v.simd_eq(choose! { MAX => all.reduce_max_relaxed(), _ => all.reduce_min_relaxed() })
                                .first_set()
                                .map_or(
                                    0,
                                    #[inline(always)]
                                    |lane| quarters.index(lane, values.len()),
                                ),
                        )
                    }
                );
            }
            let found = choose! { Self::FLOAT => self.float_extreme::<MAX, false>(), MAX => d.max_value(values), _ => d.min_value(values) }?;
            let (n, len) = (d.lanes(), values.len());
            // In which vector it is can't be predicted.
            if const { Self::AT_ONCE } && len >= n && len <= 4 * n {
                return live!(Self::AT_ONCE, {
                    let is = always!(|at: usize| d.load_any(&values[at..]).simd_eq(found));
                    let (lane, half) = if len <= 2 * n {
                        (is(0).find_in_both::<false>(is(len - n)), n)
                    } else {
                        (d.first_in_four([is(0), is(n), is(len - 2 * n), is(len - n)]), 2 * n)
                    };
                    let at = core::hint::select_unpredictable(lane < half, lane, (lane + len).wrapping_sub(2 * half));
                    Some(if Self::FLOAT && lane >= 2 * half { 0 } else { at })
                });
            }
            let at = d.find(values, found);
            choose! { Self::FLOAT || !E::PLAIN => at.or(Some(0)), _ => at }
        })
    }
    const AT_ONCE: bool = !S::SCALAR && E::PLAIN && W::BYTES <= S::REGISTER && W::BYTES <= 32 && size_of::<T>() >= 4;
    const FLOAT: bool = matches!(T::KIND, Kind::Float);

    methods! {
    /// Next to a slice with values of the same size, up to the end of the shorter one. The closures get a pair, as after `Iterator::zip`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"abcd").zip(b"abXd").position(|(a, b)| a.simd_ne(b)), Some(2));
    /// # } example()
    /// ```
    fn zip[U: SameSize<T::Signed>, /* else zip_scaled */ F: Readable<U>](self, other: &'a [F]) -> Zip<'a, T, W, U, W, S, E, F> {
        Columns::new(self.d.simd(), (self, Over { d: self.d.repartition(), values: other }))
    }
    /// The same for values of any size. Their vectors have as many lanes, so their width is [`Scaled`]. It doesn't build if there is no such width.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0.0; 3];
    /// over(&[0.5f32; 3]).zip_scaled(&[1u8, 2, 3]).map_into(&mut to, |(a, b)| a * b.cast::<f32>());
    /// assert_eq!(to, [0.5, 1.0, 1.5]);
    /// # } example()
    /// ```
    #[doc(alias("zip_over", "zip_mixed", "zip_wide", "zip_narrow"))]
    #[track_caller]
    fn zip_scaled[U: Lane, F: Readable<U>](self, other: &'a [F]) -> Zip<'a, T, W, U, Scaled<T, U, W>, S, E, F> { Columns::new(self.d.simd(), self).zip_scaled(other) }
    /// A bit for each of up to 64 values: whether it matches. The other bits are zero. Panics if there are more.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"a,b,").bitmask(|v| v.simd_eq(b',')), 0b1010);
    /// # } example()
    /// ```
    #[doc(alias("bits_if", "bitmap"))]
    #[track_caller]
    fn bitmask(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> u64 { inlined_here!(self.d.simd(), matches(a)); self.d.bits_if(self.values, matches) }
    /// The indices of all values that match, in order. This is faster than one [`position`](Self::position) after another, unless nearly nothing matches.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert!(over(b"a,b,").positions(|v| v.simd_eq(b',')).eq([1, 3]));
    /// # } example()
    /// ```
    #[doc(alias("memchr_iter", "match_indices", "find_all"))]
    #[track_caller]
    fn positions(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> impl Iterator<Item = usize> {
        V::<T, W, S>::all_bits_of_lanes();
        inlined_here!(self.d.simd(), matches(a));
        let (len, n) = (self.values.len(), V::<T, W, S>::LANES);
        return_if!(Tag::<S, T, W>::ONE_BY_ONE, Positions { over: self, matches, rest: self.values, first: 0, bits: 0 });
        let bits = self.d.bits_if(&self.values[..len.min(64)], #[inline(always)] |v| matches(v));
        // The other loads are aligned.
        let odd = if crate::X86 && len >= 256 { self.values.as_ptr().addr() / size_of::<T>() % n } else { 0 };
        Positions { over: self, matches, rest: &self.values[len.min(64) - odd..], first: odd.wrapping_neg(), bits: bits << odd }
    }
    /// Folds the values into four accumulators that start as `init`, and joins those. The last vector is padded with zeros, or else see [`pad`](Self::pad).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let squares = over(&[3.0; 100]).fold(f32xN::zero(), |sum, v| v.mul_add_relaxed(v, sum), |a, b| a + b);
    /// assert_eq!(squares.reduce_sum(), 900.0);
    /// # } example()
    /// ```
    #[doc(alias("Unroller", "reduce"))]
    fn fold[A: Copy](self, init: A, step: impl Fn(A, V<T, W, S>) -> A, join: impl Fn(A, A) -> A) -> A {
        inlined_here!(self.d.simd(), step(a, b), join(a, b));
        self.d.fold(self.values, T::default(), init, step, join)
    }
    /// Integers wrap, or else see [`sum_wide`](Over::sum_wide). Floating-point numbers are added in an order that depends on neither the target nor the width, starting from `0.0`.
    fn sum(/* Integers wrap. Wider: sum_wide() */ self) -> T {
        return_if!(!Self::FLOAT, self.d.sum(self.values));
        in_order::<false, _, _, _, _>(self.d.simd(), self.values, self.values)
    }
    /// The least value. NaN counts only if there is nothing else, and -0.0 is less than 0.0.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(&[2.0, f32::NAN, -1.0]).min(), Some(-1.0));
    /// # } example()
    /// ```
    #[doc(alias("MinValue", "min_value"))]
    fn min(self) -> Option<T> { choose! { Self::FLOAT => self.float_extreme::<false, true>(), _ => self.d.min_value(self.values) } }
    /// The greatest value, by the same rules.
    #[doc(alias("MaxValue", "max_value"))]
    fn max(self) -> Option<T> { choose! { Self::FLOAT => self.float_extreme::<true, true>(), _ => self.d.max_value(self.values) } }
    /// Both in one pass.
    #[doc(alias("min_max_value"))]
    #[allow(clippy::eq_op, reason = "NaN")]
    fn min_max(self) -> Option<(T, T)> {
        return_if!(!Self::FLOAT, self.d.min_max_value(self.values));
        let (_, start) = (self.values.first()?, (self.start::<false>(), self.start::<true>()));
        if_here!(S::A64 && !V::<T, W, S>::SOFT, {
            let join = always!(|a: (V<T, W, S>, V<T, W, S>), b: (_, _)| (or_nan::<false, _, _, _>(a.0, b.0), or_nan::<true, _, _, _>(a.1, b.1)));
            let (min, max) = self.d.fold_overlapping(self.values, #[inline(always)] |v| (v, v), #[inline(always)] |a, v| join(a, (v, v)), join);
            let (min, max) = (across::<false, _, _, _>(min), across::<true, _, _, _>(max));
            if min == min {
                return Some((min, max));
            }
            core::hint::cold_path();
        });
        let step = always!(|a: (V<T, W, S>, V<T, W, S>), v| (Self::keep::<false>(a.0, v), Self::keep::<true>(a.1, v)));
        let (min, max) = self.d.fold_overlapping(
            self.values,
            #[inline(always)] |v| step(start, v),
            step,
            #[inline(always)] |a, b| (Self::keep::<false>(a.0, b.0), Self::keep::<true>(a.1, b.1)),
        );
        Some((self.extreme::<false>(min.reduce_min_relaxed()), self.extreme::<true>(max.reduce_max_relaxed())))
    }
    /// The index of the first value that is equal to [`min`](Self::min), or 0 if all are NaN. It reads twice: a loop that makes the values can keep the least `value << 16 | index`, if both fit and have no sign.
    #[doc(alias("IndexOfMin", "index_of_min", "argmin"))]
    fn position_min(self) -> Option<usize> { self.position_extreme::<false>() }
    /// The index of the first value that is equal to [`max`](Self::max), or 0 if all are NaN.
    #[doc(alias("IndexOfMax", "index_of_max", "argmax"))]
    fn position_max(self) -> Option<usize> { self.position_extreme::<true>() }
    /// [`map_into`](Self::map_into) up to the first value that matches `stop`. Returns its index, or the length. The rest
    /// of as many values of `to` as this slice has can change. `f` has to return as many lanes as it gets. It can't work on groups.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 5];
    /// let n = over(b"ab\"cd").map_until(&mut to, |v| v.simd_eq(b'"'), |v| v);
    /// assert_eq!(&to[..n], b"ab");
    /// # } example()
    /// ```
    #[doc(alias("transform_until", "map_while"))]
    #[track_caller]
    fn map_until[U: Lane, X: Width](
        self,
        to: &mut (impl Sink<U> + ?Sized),
        stop: impl Fn(V<T, W, S>) -> M<T, W, S>,
        f: impl Fn(V<T, W, S>) -> V<U, X, S>,
    ) -> usize {
        inlined_here!(self.d.simd(), stop(a), f(a));
        require!("the result has to have as many lanes", V::<T, W, S>::LANES == V::<U, X, S>::LANES);
        self.d.until(self.values, to.place(), stop, f)
    }
    /// Copies the values that match to the start of `to`, and returns their number.
    /// Panics if they don't fit. There has to be room for these only, but what is after them in a slice can change.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 5];
    /// let n = over(&[1, 20, 3, 40, 5]).filter_into(&mut to, |v| v.simd_gt(9));
    /// assert_eq!(to[..n], [20, 40]);
    /// # } example()
    /// ```
    #[doc(alias("CopyIf", "copy_if", "extend_kept", "filter"))]
    fn filter_into(self, to: &mut (impl Sink<T> + ?Sized), matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize {
        inlined_here!(self.d.simd(), matches(a));
        to.kept_from(self, matches)
    }
    }
}

struct Positions<'a, T: Lane, W: Width, S: Isa, E, F> {
    over: Over<'a, T, W, S, E>,
    matches: F,
    rest: &'a [E],
    /// The index of bit 0.
    first: usize,
    bits: u64,
}
impl<T: Lane, W: Width, S: Isa, E: Readable<T>, F: Fn(V<T, W, S>) -> M<T, W, S>> Iterator
    for Positions<'_, T, W, S, E, F>
{
    type Item = usize;
    #[op]
    fn next(&mut self) -> Option<usize> {
        let (Over { d, values }, matches) = (self.over, &self.matches);
        let matches = always!(|v| matches(v));
        return_if!(Tag::<S, T, W>::ONE_BY_ONE, {
            let at = d.find_one::<false>(E::source(self.rest), matches)?;
            (self.rest, self.first) = (&self.rest[at + 1..], self.first + at + 1);
            Some(self.first - 1)
        });
        let mut empty = 0usize;
        while self.bits == 0 {
            // So that a match after another takes one jump, not two.
            core::hint::cold_path();
            // After blocks without a match, there are often more. A test takes half of what the bits take.
            empty += 1;
            if const { Tag::<S, T, W>::BITS_AT_ONCE } && empty == 3 {
                let all = self.rest;
                let skip = always!(|| {
                    let mut rest = all;
                    while let Some((block, after)) = rest.split_first_chunk::<64>()
                        && let [a, b, c, e] = d.load_four(block)
                        && (matches(a) | matches(b)).neither(matches(c) | matches(e))
                    {
                        rest = after;
                    }
                    rest
                });
                self.rest = Enter::only_call(d.simd(), skip);
                self.first = self.first.wrapping_add(all.len() - self.rest.len());
            }
            self.first = self.first.wrapping_add(64);
            if let Some((block, rest)) = self.rest.split_first_chunk::<64>() {
                // A call, if `sum` or another function of `core` around this is not inlined.
                (self.bits, self.rest) = (
                    crate::gate::Enter::only_call(
                        d.simd(),
                        #[inline(always)]
                        || d.bits_if(block, matches),
                    ),
                    rest,
                );
            } else if let (1.., Some(last)) = (self.rest.len(), values.last_chunk::<64>()) {
                (self.bits, self.rest) = (apart!(d.simd(), d.bits_if(last, matches)) >> (64 - self.rest.len()), &[]);
            } else {
                return None;
            }
        }
        let at = self.first.wrapping_add(self.bits.trailing_zeros() as usize);
        self.bits &= self.bits - 1;
        Some(at)
    }
}

#[op]
fn or_nan<const MAX: bool, T: Lane, W: Width, S: Isa>(a: V<T, W, S>, b: V<T, W, S>) -> V<T, W, S> {
    let (s, x, y) = (a.s, a.bytes(), b.bytes());
    a.with_bytes(if const { T::BITS == 16 } {
        s.or_nan_f16::<W>(x, y, MAX)
    } else if const { !MAX && T::BITS == 32 } {
        s.min_or_nan_f32::<W>(x, y)
    } else if const { !MAX } {
        s.min_or_nan_f64::<W>(x, y)
    } else if const { MAX && T::BITS == 32 } {
        s.max_or_nan_f32::<W>(x, y)
    } else {
        s.max_or_nan_f64::<W>(x, y)
    })
}
#[op]
fn across<const MAX: bool, T: Lane, W: Width, S: Isa>(mut v: V<T, W, S>) -> T {
    return_if!(W::BYTES > 16, across::<MAX, _, _, _>(or_nan::<MAX, _, _, _>(v.lower_half(), v.upper_half())));
    when!(V::<T, W, S>::LANES > 4, v = or_nan::<MAX, _, _, _>(v, v.slide_down::<4>()));
    when!(V::<T, W, S>::LANES > 2, v = or_nan::<MAX, _, _, _>(v, v.slide_down::<2>()));
    when!(V::<T, W, S>::LANES > 1, v = or_nan::<MAX, _, _, _>(v, v.slide_down::<1>()));
    v.get_lane()
}

/// From 4 KiB on, two parts are added up each by itself, as an addition waits for the one before it. The length of the first.
#[op]
pub(crate) fn first_part<T>(len: usize) -> Option<usize> {
    if len >= 4096 / size_of::<T>() { Some(len / 128 * 64) } else { None }
}
#[op]
fn in_order<const DOT: bool, T: Lane, S: Isa, E: Readable<T>, F: Readable<T>>(s: S, x: &[E], y: &[F]) -> T {
    part_in_order::<DOT, true, _, _, _, _>(s, x, y)
}
#[crate::simd]
#[inline(never)]
fn long_in_order<const DOT: bool, T: Lane, S: Isa, E: Readable<T>, F: Readable<T>>(s: S, x: &[E], y: &[F]) -> T {
    let part = first_part::<T>(x.len());
    return_if!(S::AVX2 && size_of::<T>() >= 4, {
        let step = always!(|sum, x: V<T, S::Native, S>, y| if DOT { sum + x * y } else { sum + x });
        let (d, each) = (s.full::<T>(), 128 / S::Native::BYTES);
        let Some(part) = part else {
            return halves_added(d.in_parts::<1>(each, x.len() & (each * d.lanes()).wrapping_neg(), x, y, step)[0]);
        };
        let [a, b] = d.in_parts::<2>(each, part, x, y, step);
        (s.fixed::<T, B16>().set(halves_added(a)) + halves_added(b)).get_lane()
    });
    let ((a, b), (c, d)) = (x.split_at(part.unwrap()), y.split_at(part.unwrap()));
    let first = part_in_order::<DOT, false, _, _, _, _>(s, a, c);
    // LLVM would keep the sums during the second loop.
    let first = s.fixed::<T, B16>().set(if crate::X86 { core::hint::black_box(first) } else { first });
    (first + part_in_order::<DOT, false, _, _, _, _>(s, b, &d[..b.len()])).get_lane()
}
#[on(X86)]
#[crate::simd]
#[inline(never)]
fn long_relaxed<const DOT: bool, T: Float, S: Isa, E: Readable<T>, F: Readable<T>>(s: S, x: &[E], y: &[F]) -> T {
    let (d, each) = (s.full::<T>(), if DOT { 4 } else { 8 });
    let step = always!(|sum, x: V<T, S::Native, S>, y| if DOT { x.mul_add_relaxed(y, sum) } else { sum + x });
    let [sum] = d.in_parts::<1>(each, x.len() & (each * d.lanes()).wrapping_neg(), x, y, step);
    // Whether a sum of products is `-0.0` can depend on the address.
    halves_added(if DOT { sum + T::default() } else { sum })
}
impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// `part_in_order` with `each` vectors, down to one, for `K` parts at once. The last has the rest too. The loads from `x` are aligned. That rotates the lanes, which changes nothing if halves are added.
    #[on(X86)]
    #[op]
    fn in_parts<const K: usize>(
        self,
        each: usize,
        part: usize,
        x: &[impl Readable<T>],
        y: &[impl Readable<T>],
        step: impl Fn(V<T, W, S>, V<T, W, S>, V<T, W, S>) -> V<T, W, S>,
    ) -> [V<T, W, S>; K] {
        use crate::array::own::{from_fn, map};
        let (n, zero, odd) = (Self::LANES, self.zero(), x.as_ptr().addr() / size_of::<T>() % Self::LANES);
        assert!(part >= each * n && x.len() == y.len());
        let (before, mut sums) = (self.first_n(odd), [[zero; 8]; K]);
        let at = always!(|sum, i: usize| step(sum, self.load_any(&x[i..]), self.load_any(&y[i..])));
        sums[0][0] =
            step(zero, self.end_of(zero, self.load_any(x), n - odd), self.end_of(zero, self.load_any(y), n - odd));
        unrolled!(
            4,
            for k in 1..K {
                sums[k][0] = before.if_then_zero_else(at(zero, k * part - odd))
            }
        );
        unrolled!(
            4,
            for k in 0..K {
                unrolled!(
                    8,
                    for i in 1..each {
                        sums[k][i] = at(sums[k][i], k * part + i * n - odd)
                    }
                )
            }
        );
        let (start, mut left) = (each * n - odd, part - each * n);
        let mut xs: [_; K] = from_fn(always!(|k| &x[k * part + start..][..left]));
        let mut ys: [_; K] = from_fn(always!(|k| &y[k * part + start..][..left]));
        while left >= each * n {
            if K * each >= 4 {
                crate::not_unrolled();
            }
            unrolled!(
                4,
                for k in 0..K {
                    unrolled!(
                        8,
                        for i in 0..each {
                            sums[k][i] =
                                step(sums[k][i], self.load_any(&xs[k][i * n..]), self.load_any(&ys[k][i * n..]))
                        }
                    );
                    (xs[k], ys[k]) = (&xs[k][each * n..], &ys[k][each * n..]);
                }
            );
            left -= each * n;
        }
        unrolled!(
            4,
            for k in 1..K {
                sums[k - 1][0] = before.if_then_else(at(sums[k - 1][0], k * part - odd), sums[k - 1][0])
            }
        );
        let (mut p, mut q, last) = (&x[K * part - odd..], &y[K * part - odd..], &mut sums[K - 1]);
        while p.len() >= n && q.len() >= n {
            crate::not_unrolled();
            let (next, all) = (step(last[0], self.load_any(p), self.load_any(q)), *last);
            (*last, p, q) = (from_fn(always!(|i| if i + 1 >= each { next } else { all[i + 1] })), &p[n..], &q[n..]);
        }
        if !p.is_empty() {
            let seen = n - p.len();
            last[0] = step(last[0], self.load_any_last(x).down_by(seen), self.load_any_last(y).down_by(seen));
        }
        map(
            sums,
            always!(|[a, b, c, d, e, f, g, h]: [V<T, W, S>; 8]| match each {
                2 => a + b,
                4 => a + c + (b + d),
                _ => a + e + (c + g) + (b + f + (d + h)),
            }),
        )
    }
}
/// Lane `i` of two vectors of 64 bytes has the sum of the values, or of the products, at `i` modulo 128 bytes. Then halves are added.
#[op]
fn part_in_order<const DOT: bool, const ALL: bool, T: Lane, S: Isa, E: Readable<T>, F: Readable<T>>(
    s: S,
    mut x: &[E],
    mut y: &[F],
) -> T {
    macro_rules! get {
        ($d:expr, $load:ident, $at:expr) => {
            if DOT { $d.$load(&x[$at..]) * $d.$load(&y[$at..]) } else { $d.$load(&x[$at..]) }
        };
    }
    let d = s.fixed::<T, B64>();
    let (n, mut a, mut b) = (d.lanes(), d.zero(), d.zero());
    // To add zeros changes nothing but `-0.0`.
    let v = if S::REGISTER < 64 && x.len() <= n / 4 {
        get!(d.half().half(), load_any_n, 0) + T::default()
    } else {
        let v = if S::REGISTER < 64 && x.len() <= n / 2 {
            get!(d.half(), load_any_n, 0) + T::default()
        } else {
            let v = if x.len() <= n {
                get!(d, load_any_n, 0) + T::default()
            } else {
                let odd = S::AVX2 && size_of::<T>() >= 4 && x.as_ptr().addr() % S::Native::BYTES != 0;
                let long = (4096 / size_of::<T>() as u64) >> if DOT { 2 * odd as u32 } else { odd as u32 };
                // With a bound, LLVM wouldn't unroll the loop.
                if ALL && x.len() >= 2 * n && x.len() as u64 >= crate::regs::number(long) {
                    return live!(ALL, long_in_order::<DOT, _, _, _, _>(s, x, y));
                }
                while x.len() >= 2 * n && y.len() >= 2 * n {
                    (a, b) = (a + get!(d, load_any, 0), b + get!(d, load_any, n));
                    (x, y) = (&x[2 * n..], &y[2 * n..]);
                }
                when!(S::AVX2 && DOT && S::REGISTER == 32, {
                    let left = crate::tag::uncounted(x.len().min(y.len()));
                    (x, y) = (&x[..left], &y[..left]);
                });
                if x.len() >= n && y.len() >= n {
                    (a, b) = (a + get!(d, load_any, 0), b + get!(d, load_any_n, n));
                } else if ALL || !x.is_empty() {
                    a += get!(d, load_any_n, 0);
                }
                a + b
            };
            v.lower_half() + v.upper_half()
        };
        v.lower_half() + v.upper_half()
    };
    last_halves_added(v)
}
/// The end of `in_order`.
#[op]
pub(crate) fn halves_added<T: Lane, W: Width, S: Isa>(v: V<T, W, S>) -> T {
    return_if!(W::BYTES > 16, halves_added(v.lower_half() + v.upper_half()));
    last_halves_added(v.isa().fixed::<T, B16>().resize_bitcast(v))
}
#[op]
fn last_halves_added<T: Lane, S: Isa>(v: V<T, B16, S>) -> T {
    let v = v.lower_half() + v.upper_half();
    let v = choose! { size_of::<T>() == 2 => v + v.bitcast::<u32>().slide_down::<1>().bitcast::<T>(), _ => v };
    choose! { size_of::<T>() == 8 => v.get_lane(), _ => (v + v.slide_down::<1>()).get_lane() }
}

impl<T: Float, W: Width, S: Isa, E: Readable<T>> Over<'_, T, W, S, E> {
    methods! {
        /// [`sum`](Self::sum) in an order that depends on the target.
        fn sum_relaxed(self) -> T {
            if_here!(S::AVX2 && size_of::<T>() >= 4, if size_of_val(self.values) >= 2048 { return long_relaxed::<false, _, _, _, _>(self.d.simd(), self.values, self.values) });
            self.d.sum(self.values)
        }
        /// [`min`](Self::min), but unspecified if a value is NaN, and either zero.
        fn min_relaxed(self) -> Option<T> { self.d.min_value(self.values) }
        /// [`max`](Self::max), but unspecified if a value is NaN, and either zero.
        fn max_relaxed(self) -> Option<T> { self.d.max_value(self.values) }
        /// This slice is a matrix with a row of `x.len()` values for each value of `to`, which gets the [`dot`](Zip::dot) of
        /// the row and `x`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let mut to = [0.0; 2];
        /// over(&[1.0, 2.0, 3.0, 4.0]).mat_vec(&[10.0, 1.0], &mut to);
        /// assert_eq!(to, [12.0, 34.0]);
        /// # } example()
        /// ```
        #[doc(alias("MatVec"))]
        fn mat_vec(self, x: &[impl Readable<T>], to: &mut [T]) {
            assert!(self.values.len() == x.len() * to.len());
            for (i, to) in to.iter_mut().enumerate() {
                *to = Self { values: &self.values[i * x.len()..][..x.len()], ..self }.zip::<T, _>(x).dot();
            }
        }
        /// The same with [`dot_relaxed`](Zip::dot_relaxed).
        fn mat_vec_relaxed(self, x: &[impl Readable<T>], to: &mut [T]) { self.d.mat_vec(self.values, x, to) }
    }
}

impl<W: Width, S: Isa, E: Readable<u8>> Over<'_, u8, W, S, E> {
    /// The index of the first byte that is one of `set`, which can have any length.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(b"a&b<c").position_of_any(b"<>&"), Some(1));
    /// # } example()
    /// ```
    #[doc(alias("find_any_of", "strpbrk", "strcspn"))]
    #[op]
    pub fn position_of_any(self, set: &[u8]) -> Option<usize> {
        self.d.find_any_of(self.values, set)
    }
}

impl<T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'_, T, W, S, E> {
    #[op]
    pub(crate) fn filter_to_output(self, to: &mut Output<'_, T>, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize {
        let (d, n, room) = (self.d, V::<T, W, S>::LANES, to.room());
        return_if!(S::SCALAR, {
            let out = &mut to.window(room);
            d.sift(
                self.values,
                matches,
                #[inline(always)]
                |value, kept| if out.room() > 0 { out.extend_first(&[value], kept as usize) } else { assert!(!kept) },
            );
            out.len()
        });
        // In a window, the end of what is written can't overflow.
        let exact = always!(|out: &mut Output<'_, T>, v: V<T, W, S>, kept: M<T, W, S>| {
            out.window(out.room()).push_partial(v.compress_mask(kept), kept.count())
        });
        let put = always!(|out: &mut Output<'_, T>, v: V<T, W, S>, kept: M<T, W, S>| {
            if const { V::<T, W, S>::LANES <= 64 } && out.room() >= n {
                out.push_compressed(v, kept)
            } else {
                exact(out, v, kept)
            }
        });
        if self.values.len() < n {
            let (counts, v, out) = (d.first_n(self.values.len()), d.load_any_n(self.values), &mut to.window(room));
            put(out, v, (counts & matches(v)).whole_lanes());
            return out.len();
        }
        // The length of a window stays in a register.
        let out = &mut to.window(room);
        let (last, mut rest) = (d.load_any_last(self.values), self.values);
        while rest.len() >= 4 * n && out.has_room(4 * n) {
            d.push_four(d.load_four(rest), &matches, &mut out.window(4 * n));
            rest = &rest[4 * n..];
        }
        while const { V::<T, W, S>::LANES <= 64 } && rest.len() >= n && out.has_room(n) {
            crate::not_unrolled();
            let v = d.load_any(rest);
            out.push_compressed(v, matches(v));
            rest = &rest[n..];
        }
        while rest.len() >= n {
            crate::not_unrolled();
            let v = d.load_any(rest);
            let kept = matches(v);
            if const { Tag::<S, T, W>::CELLS_BY_BITS && E::PLAIN } {
                // They are few, and this saves no registers.
                let mut bits = kept.to_bitmask();
                while bits != 0 {
                    out.push_one(rest[bits.trailing_zeros() as usize % n].value());
                    bits &= bits - 1;
                }
            } else if rest.len() < 4 * n || kept.any() {
                exact(out, v, kept);
            }
            rest = &rest[n..];
        }
        put(out, last, (!d.first_n(n - rest.len()) & matches(last)).whole_lanes());
        out.len()
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    pub(crate) fn zip_to_slice<U: Lane, X: Width, R: Lane, Y: Width>(
        self,
        (x, e, y): (&[impl Readable<T>], Tag<S, U, X>, &[impl Readable<U>]),
        to: &mut [impl crate::Writable<R>],
        f: impl Fn(V<T, W, S>, V<U, X, S>) -> V<R, Y, S>,
    ) {
        let d = self;
        if const { Self::in_classes::<U, X>() && Self::in_classes::<R, Y>() } && to.len() >= d.lanes() {
            let (n, len) = (d.lanes(), to.len());
            macro_rules! group {
                ($k:literal, $x:expr, $y:expr, $to:expr) => {{
                    let (x, y, to) = (&$x[..$k * n], &$y[..$k * n], &mut $to[..$k * n]);
                    for i in 0..$k {
                        f(d.load_any(&x[i * n..]), e.load_any(&y[i * n..])).store(&mut to[i * n..]);
                    }
                }};
                ($k:literal) => {
                    group!($k, x[x.len() - $k * n..], y[y.len() - $k * n..], to[len - $k * n..])
                };
            }
            if len <= 2 * n {
                group!(1, x, y, to);
                return group!(1);
            }
            if len <= 4 * n {
                group!(2, x, y, to);
                return group!(2);
            }
            let (mut xs, mut ys, mut room) = (x, y, &mut *to);
            while xs.len() > 4 * n && ys.len() > 4 * n && room.len() > 4 * n {
                group!(4, xs, ys, room);
                (xs, ys, room) = (&xs[4 * n..], &ys[4 * n..], &mut room[4 * n..]);
            }
            return if room.len() <= n { group!(1) } else { group!(4) };
        }
        if to.len() < d.lanes() {
            return f(d.load_any_short(x), e.load_any_short(y)).store_short(to);
        }
        let skip = d.simd().fixed::<R, Y>().to_cache_line(to, size_of::<T>().min(size_of::<U>()).min(size_of::<R>()));
        if skip > 0 {
            f(d.load_any(x), e.load_any(y)).store(to);
        }
        // In pairs, as LLVM unrolls short loops for x86 only. Not with `zip` of `core`, which stays out of line at opt-level s.
        let (n, (mut xs, mut ys, mut room)) = (d.lanes(), (&x[skip..], &y[skip..], &mut to[skip..]));
        while const { W::BYTES <= S::REGISTER && X::BYTES <= S::REGISTER && Y::BYTES <= S::REGISTER }
            && xs.len() > 2 * n
            && ys.len() > 2 * n
            && room.len() > 2 * n
        {
            let (a, b) = (f(d.load_any(xs), e.load_any(ys)), f(d.load_any(&xs[n..]), e.load_any(&ys[n..])));
            a.store(room);
            b.store(&mut room[n..]);
            (xs, ys, room) = (&xs[2 * n..], &ys[2 * n..], &mut room[2 * n..]);
        }
        while xs.len() > n && ys.len() > n && room.len() > n {
            crate::not_unrolled();
            f(d.load_any(xs), e.load_any(ys)).store(room);
            (xs, ys, room) = (&xs[n..], &ys[n..], &mut room[n..]);
        }
        f(d.load_any_last(x), e.load_any_last(y)).store_last(to);
    }
}

impl<T: Float, W: Width, S: Isa, E: Readable<T>, F: Readable<T>> Zip<'_, T, W, T, W, S, E, F> {
    methods! {
        /// The sum of the products, each of them rounded, in the order of [`Over::sum`].
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(over(&[1.0, 2.0]).zip(&[3.0, 4.0]).dot(), 11.0);
        /// # } example()
        /// ```
        #[doc(alias("Dot"))]
        fn dot(self) -> T {
            let (d, x, y) = self.parts();
            in_order::<true, _, _, _, _>(d.simd(), x, y)
        }
        /// The same in an order that depends on the target, which can also leave out the rounding of the products.
        fn dot_relaxed(self) -> T {
            let (d, x, y) = self.parts();
            if_here!(S::AVX2 && size_of::<T>() >= 4, if size_of_val(x) >= 1024 { return long_relaxed::<true, _, _, _, _>(d.simd(), x, y) });
            d.dot(x, y)
        }
    }
}

macro_rules! dots { ($($a:ident $b:ident $sum:ident $name:ident;)*) => {$(
    impl<W: Width, S: Isa, E: Readable<$a>, F: Readable<$b>> Zip<'_, $a, W, $b, W, S, E, F> {
        /// The sum of the products, which wraps.
        #[op]
        pub fn dot_wide(self) -> $sum { let (d, x, y) = self.parts(); d.$name(x, y) }
    }
)*}; }
dots! { u8 u8 u32 dot_wide; u8 i8 i32 dot_wide_i8; i8 i8 i32 dot_wide; i16 i16 i32 dot_wide; }

impl<'a, T: Lane, W: Width, S: Isa, E> Over<'a, T, W, S, E> {
    #[op]
    pub(crate) fn parts(self) -> (S, &'a [E]) {
        (self.d.simd(), self.values)
    }
}
impl<'a, T: Lane, W: Width, S: Isa> OverMut<'a, T, W, S> {
    #[op]
    pub(crate) fn parts(self) -> (S, &'a mut [T]) {
        (self.d.simd(), self.values)
    }
}

impl<W: Width, S: Isa, E: Readable<f16>, F: Readable<f16>> Zip<'_, f16, W, f16, W, S, E, F> {
    /// The sum of the products, in an order that depends on the target.
    #[op]
    pub fn dot_wide_relaxed(self) -> f32 {
        let zero = self.parts().0.repartition::<f32>().zero();
        let [a, b] = self.fold(
            [zero; 2],
            #[inline(always)]
            |sums, (a, b)| a.widening_mul_add(b, sums),
            #[inline(always)]
            |a, b| [a[0] + b[0], a[1] + b[1]],
        );
        (a + b).reduce_sum()
    }
}
impl<W: Width, S: Isa, E: Readable<bf16>, F: Readable<bf16>> Zip<'_, bf16, W, bf16, W, S, E, F> {
    /// The sum of the products, by [`dot_add_relaxed`](Simd::dot_add_relaxed).
    #[op]
    pub fn dot_wide_relaxed(self) -> f32 {
        let zero = self.parts().0.repartition::<f32>().zero();
        self.fold(
            zero,
            #[inline(always)]
            |sum, (a, b)| a.dot_add_relaxed(b, sum),
            #[inline(always)]
            |a, b| a + b,
        )
        .reduce_sum()
    }
}

impl<'a, T: Lane, W: Width, S: Isa> OverMut<'a, T, W, S> {
    #[op]
    #[track_caller]
    pub(crate) fn new(s: S, values: &'a mut [T]) -> Self {
        Self { d: Tag::new(s), values }
    }
    methods! {
    /// The same slice in vectors of another width.
    #[track_caller]
    fn by[X: Width](self) -> OverMut<'a, T, X, S> { OverMut::new(self.d.simd(), self.values) }
    /// Next to a slice with values of the same size, up to the end of the shorter one. The closures get a pair.
    fn zip[U: SameSize<T::Signed>, /* else zip_scaled */ F: Readable<U>](self, other: &'a [F]) -> ZipMut<'a, T, W, U, S, F> {
        let len = self.values.len().min(other.len());
        ZipMut { d: self.d, values: &mut self.values[..len], y: &other[..len], lane: PhantomData }
    }
    /// Replaces each value by `f` of it. `f` can see a value twice, and in any lane, but groups of lanes stay together as in [`Over::map_into`].
    /// If the place of a value matters, take [`scan`](Self::scan).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut text = *b"a_b";
    /// over_mut(&mut text).map(|v| v.simd_eq(b'_').select(b' ', v));
    /// assert_eq!(&text, b"a b");
    /// # } example()
    /// ```
    #[doc(alias("Transform", "transform_in_place", "map_in_place", "ReplaceIf", "replace_if"))]
    fn map(self, f: impl Fn(V<T, W, S>) -> V<T, W, S>) { inlined_here!(self.d.simd(), f(a)); self.d.transform_in_place(self.values, f) }
    /// Moves the values that match to the start, and returns their number. What is after them can change.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut text = *b"a b c";
    /// let n = over_mut(&mut text).retain(|v| v.simd_ne(b' '));
    /// assert_eq!(&text[..n], b"abc");
    /// # } example()
    /// ```
    fn retain(self, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize { inlined_here!(self.d.simd(), matches(a)); self.d.retain(self.values, matches) }
    /// Writes `f` of the indices, as lanes that wrap.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut squares = [0u32; 4];
    /// over_mut(&mut squares).fill_with(|i| i * i);
    /// assert_eq!(squares, [0, 1, 4, 9]);
    /// # } example()
    /// ```
    #[doc(alias("Generate", "generate", "fill"))]
    fn fill_with(self, f: impl Fn(V<T::Unsigned, W, S>) -> V<T, W, S>) { inlined_here!(self.d.simd(), f(a)); self.d.generate(self.values, f) }
    /// [`sort`](fn@crate::sort) on this target.
    #[doc(alias("VQSort", "sort_unstable", "sort_floats"))]
    fn sort(self) { crate::vqsort::sort_on::<S, T, false>(S::default(), self.values, (0, 0)) }
    }
}

impl<T: Lane, W: Width, S: Isa> OverMut<'_, T, W, S> {
    /// [`map`](Self::map) in order, as in [`Over::scan_into`].
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (mut data, key) = ([0; 6], u8xN::repeat(&[1, 2, 3, 4]));
    /// over_mut(&mut data).scan(|v| v ^ key);
    /// assert_eq!(data, [1, 2, 3, 4, 1, 2]);
    /// # } example()
    /// ```
    #[doc(alias("map_in_order", "map_indexed", "cycle"))]
    #[inline(always)]
    pub fn scan(self, f: impl FnMut(V<T, W, S>) -> V<T, W, S>) {
        self.in_order(f)
    }
    #[op]
    fn in_order<G: FnMut(V<T, W, S>) -> V<T, W, S>>(self, f: G) {
        crate::closures::inlined_mut!(self.d.simd(), f: G, (a));
        let (d, mut rest) = (self.d, self.values);
        if const { Tag::<S, T, W>::SLIDES && !S::PARTIAL } && rest.len() > d.lanes() {
            return live!(Tag::<S, T, W>::SLIDES && !S::PARTIAL, {
                let (n, last, mut before, mut whole) = (d.lanes(), d.load_last(rest), d.zero(), &mut *rest);
                while const { Tag::<S, T, W>::ROLLED } && whole.len() >= 2 * n {
                    for i in 0..2 {
                        before = f(d.load(&whole[i * n..]));
                        before.store(&mut whole[i * n..]);
                    }
                    whole = &mut whole[2 * n..];
                }
                while whole.len() >= n {
                    before = f(d.load(whole));
                    before.store(whole);
                    whole = &mut whole[n..];
                }
                let left = whole.len();
                if left > 0 {
                    d.end_of(before, f(last.down_by(n - left)), left).store_last(rest)
                }
            });
        }
        while const { Tag::<S, T, W>::ROLLED && S::PARTIAL } && rest.len() >= 2 * d.lanes() {
            for i in 0..2 {
                f(d.load(&rest[i * d.lanes()..])).store(&mut rest[i * d.lanes()..]);
            }
            rest = &mut rest[2 * d.lanes()..];
        }
        while rest.len() >= d.lanes() {
            f(d.load(rest)).store(rest);
            rest = &mut rest[d.lanes()..];
        }
        if !rest.is_empty() {
            f(d.load_n(rest)).store_n(rest)
        }
    }
}

impl<T: Lane, W: Width, U: Lane, S: Isa, F: Readable<U>> ZipMut<'_, T, W, U, S, F> {
    /// [`map`](Self::map) in order, as in [`Over::scan_into`].
    #[inline(always)]
    pub fn scan(self, f: impl FnMut((V<T, W, S>, V<U, W, S>)) -> V<T, W, S>) {
        self.in_order(f)
    }
    #[op]
    fn in_order<G: FnMut((V<T, W, S>, V<U, W, S>)) -> V<T, W, S>>(self, f: G) {
        crate::closures::inlined_mut!(self.d.simd(), f: G, (a));
        let (d, mut xs, mut ys) = (self.d, self.values, self.y);
        if const { Tag::<S, T, W>::SLIDES && !S::PARTIAL && F::PLAIN } && xs.len() > d.lanes() {
            return live!(Tag::<S, T, W>::SLIDES && !S::PARTIAL && F::PLAIN, {
                let (n, last, other) = (d.lanes(), d.load_last(xs), d.repartition::<U>().load_any_last(ys));
                let (mut before, mut whole) = (d.zero(), &mut *xs);
                while const { Tag::<S, T, W>::ROLLED } && whole.len() >= 2 * n && ys.len() >= 2 * n {
                    for i in 0..2 {
                        before = f((d.load(&whole[i * n..]), F::load(&ys[i * n..], d.simd())));
                        before.store(&mut whole[i * n..]);
                    }
                    (whole, ys) = (&mut whole[2 * n..], &ys[2 * n..]);
                }
                while whole.len() >= n && ys.len() >= n {
                    before = f((d.load(whole), F::load(ys, d.simd())));
                    before.store(whole);
                    (whole, ys) = (&mut whole[n..], &ys[n..]);
                }
                let left = whole.len();
                if left > 0 {
                    d.end_of(before, f((last.down_by(n - left), other.down_by(n - left))), left).store_last(xs)
                }
            });
        }
        while xs.len() >= d.lanes() && ys.len() >= d.lanes() {
            f((d.load(xs), F::load(ys, d.simd()))).store(xs);
            (xs, ys) = (&mut xs[d.lanes()..], &ys[d.lanes()..]);
        }
        if !xs.is_empty() {
            f((d.load_n(xs), F::load_partial(ys, d.simd()))).store_n(xs)
        }
    }
    /// Replaces each value by `f` of it and the other value at its index.
    /// `f` can see a value twice, and in any lane, but groups of lanes stay together as in [`Over::map_into`].
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut y = [1.0, 2.0];
    /// over_mut(&mut y).zip(&[10.0, 20.0]).map(|(y, x)| x * 2.0 + y);
    /// assert_eq!(y, [21.0, 42.0]);
    /// # } example()
    /// ```
    #[doc(alias("Transform1", "transform2_in_place"))]
    #[op]
    pub fn map(self, f: impl Fn((V<T, W, S>, V<U, W, S>)) -> V<T, W, S>) {
        inlined_here!(self.d.simd(), f(a));
        let f = always!(|a, b| f((a, b)));
        let Self { d, values, y, .. } = self;
        let e = d.repartition::<U>();
        if y.len() < d.lanes() {
            return f(d.load_short(values), e.load_any_short(y)).store_short(values);
        }
        if const { Tag::<S, T, W>::in_classes::<U, W>() } {
            let (n, len) = (d.lanes(), values.len());
            let at = always!(|x: &[T], y: &[F], i: usize| f(d.load(&x[i..]), e.load_any(&y[i..])));
            let last = at(values, y, len - n);
            if len <= 2 * n {
                at(values, y, 0).store(values);
                return last.store_last(values);
            }
            let last = at(values, y, len - 2 * n).concat(last);
            if len <= 4 * n {
                at(values, y, 0).concat(at(values, y, n)).store(values);
                return last.store_last(values);
            }
            let last = at(values, y, len - 4 * n).concat(at(values, y, len - 3 * n)).concat(last);
            let (mut xs, mut ys) = (&mut *values, y);
            while xs.len() > 4 * n && ys.len() > 4 * n {
                for i in 0..4 {
                    at(xs, ys, i * n).store(&mut xs[i * n..]);
                }
                (xs, ys) = (&mut xs[4 * n..], &ys[4 * n..]);
            }
            return last.store_last(values);
        }
        let (last, skip) = (f(d.load_last(values), e.load_any_last(y)), d.to_cache_line(values, size_of::<T>()));
        let first = if skip > 0 { f(d.load(values), e.load_any(y)) } else { last };
        let (n, (mut xs, mut ys)) = (d.lanes(), (&mut values[skip..], &y[skip..]));
        while const { W::BYTES <= S::REGISTER } && xs.len() > 2 * n && ys.len() > 2 * n {
            let (a, b) = (f(d.load(xs), e.load_any(ys)), f(d.load(&xs[n..]), e.load_any(&ys[n..])));
            a.store(xs);
            b.store(&mut xs[n..]);
            (xs, ys) = (&mut xs[2 * n..], &ys[2 * n..]);
        }
        while xs.len() > n && ys.len() > n {
            crate::not_unrolled();
            f(d.load(xs), e.load_any(ys)).store(xs);
            (xs, ys) = (&mut xs[n..], &ys[n..]);
        }
        if skip > 0 {
            first.store(values);
        }
        last.store_last(values);
    }
}

impl<S: Isa, T: crate::Int, W: Width> Simd<T, W, S> {
    /// Whether a lane is equal to any value of `set`: an array of any length, or a vector of 16 bytes. It is mostly a comparison for each value, best from a reference to an array.
    /// From 16 values of 32 bits on, `icelake` asks the CPU: Zen 5 takes 15 to 45% of that time, and Zen 4 45 to 80%.
    /// By value, an array that changes in each round took up to 2.5 times as long as by reference on Intel. On Zen, it took 2 to 7 times as long, but not with 16 or 32 values.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x16::from(b"a+b-c*d/e=f<g>h!").is_in(b"+-*/=").count(), 5);
    /// assert_eq!(u32x4::from([3, 50, 2, 8]).is_in(u32x4::iota(0)).to_bitmask(), 0b0101);
    /// # } example()
    /// ```
    #[doc(alias("matches_any", "MATCH", "pcmpestrm", "intersect", "vp2intersect", "vpconflict"))]
    #[op]
    #[track_caller]
    pub fn is_in(
        self,
        /* else ByteSet::of(b"..").contains(v) */ set: impl crate::Members<T, S>,
    ) -> MaskOf<T, W, S> {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        crate::Members::have::<W, false>(set, self)
    }
    /// The same, but the result is unspecified if a lane of either is zero. For lanes of 8 and 16 bits on x86, it takes 0.4 to 1.0 times as long for vectors of 16 bytes, and before AVX2.
    /// Else, that holds from 12 values of 8 bits on. Fewer than 12 take up to 1.6 times as long, and values of 16 bits 0.5 to 2.3 times.
    #[doc(alias("is_in_nonzero", "matches_any_nonzero", "pcmpistrm"))]
    #[op]
    #[track_caller]
    pub fn is_in_relaxed(self, set: impl crate::Members<T, S>) -> MaskOf<T, W, S> {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        crate::Members::have::<W, true>(set, self)
    }
    /// How many lanes of `set`, which has 16 bytes, are equal to a lane. For each register this is one instruction for bytes on `sve2`, and else three for each lane of `set`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u32x4::iota(0).count_in([2, 0, 2, 9]), [1, 0, 2, 0]);
    /// # } example()
    /// ```
    #[doc(alias("HISTSEG", "duplicates"))]
    #[op]
    #[track_caller]
    pub fn count_in(self, set: impl crate::Operand<T, B16, S>) -> Self {
        self.count_matches(self.in_each_block(set))
    }
    #[op]
    fn in_each_block(self, block: impl crate::Operand<T, B16, S>) -> Self {
        self.tag().dup128(block.vector(self.s.fixed()).to_array())
    }
}

impl<T: crate::Int, W: Width, S: Isa> crate::InBlocks<T, W, S> {
    /// Whether a lane is equal to any lane of the same block of `set`.
    #[op]
    #[track_caller]
    pub fn is_in(self, set: impl crate::Operand<T, W, S>) -> M<T, W, S> {
        self.0.matches_any(self.0.like(set))
    }
    /// The same, and faster on x86. The result is unspecified if a lane of either is zero.
    #[op]
    #[track_caller]
    pub fn is_in_relaxed(self, set: impl crate::Operand<T, W, S>) -> M<T, W, S> {
        self.0.matches_any_nonzero(self.0.like(set))
    }
    /// How many lanes of the same block of `set` are equal to a lane.
    #[op]
    #[track_caller]
    pub fn count_in(self, set: impl crate::Operand<T, W, S>) -> Simd<T, W, S> {
        self.0.count_matches(self.0.like(set))
    }
}
