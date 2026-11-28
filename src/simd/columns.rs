//! Loops that see several values at each index.

use crate::closures::{inlined_here, inlined_mut};
use crate::streaming::ahead;
use crate::{
    Isa, Lane, MaskOf, Over, Place, Readable, Region, SameSize, Scaled, Simd, Sink, Tag, Width, Zip,
    array::own as array,
};
use core::marker::PhantomData;

type V<T, W, S> = Simd<T, W, S>;
type M<T, W, S> = MaskOf<T, W, S>;

/// What the closures of [`Columns`] get.
pub trait Items<T: Lane, W: Width, S: Isa>: Copy + crate::seals::Items<T, W, S> {
    /// An array of vectors, or after `zip` a pair of what was there and a vector.
    type Item: Copy;
    #[doc(hidden)]
    const PLAIN: bool;
    #[doc(hidden)]
    fn how_many(self) -> usize;
    /// Of the first column, in lanes, to align loops.
    #[doc(hidden)]
    #[inline(always)]
    fn address(self) -> usize {
        0
    }
    /// The least `ahead` of the columns.
    #[doc(hidden)]
    #[inline(always)]
    fn behind(self, _to: usize) -> usize {
        4096
    }
    /// The size of the narrowest lanes.
    #[doc(hidden)]
    const NARROWEST: usize = 1;
    /// All columns have the same length, or `at` is zero.
    #[doc(hidden)]
    fn items_at(self, at: usize, n: usize) -> Self;
    #[doc(hidden)]
    fn load_whole(self, s: S) -> Self::Item;
    #[doc(hidden)]
    fn load_rest(self, s: S) -> Self::Item;
    #[doc(hidden)]
    fn load_rest_or(self, s: S, or: T) -> Self::Item;
    /// Whether the rest is best made of the last whole vectors.
    #[doc(hidden)]
    const SLIDES: bool;
    /// As `load_rest` of what comes after the first `seen` items.
    #[doc(hidden)]
    fn load_after(self, s: S, seen: usize) -> Self::Item;
    #[doc(hidden)]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item;
    /// Padding where `keep` is false.
    #[doc(hidden)]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item;
    #[doc(hidden)]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item;
    /// Whether half of the vectors take less time to load.
    #[doc(hidden)]
    const HALVES: bool = false;
    #[doc(hidden)]
    #[inline(always)]
    fn load_half(self, s: S) -> Self::Item {
        self.load_rest(s)
    }
    #[doc(hidden)]
    #[op]
    fn fold_or<A: Copy>(
        all: Columns<T, W, S, Pad<Self, T>>,
        init: A,
        step: impl Fn(A, Self::Item) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        all.fold_by_two(init, step, join)
    }
    // Two slices have loops of their own.
    #[doc(hidden)]
    #[op]
    fn first_match(all: Columns<T, W, S, Self>, matches: impl Fn(Self::Item) -> M<T, W, S>) -> Option<usize> {
        all.find::<false>(matches)
    }
    #[doc(hidden)]
    #[inline(always)]
    fn test_items<const ALL: bool>(all: Columns<T, W, S, Self>, matches: impl Fn(Self::Item) -> M<T, W, S>) -> bool {
        all.test::<ALL>(matches)
    }
    #[doc(hidden)]
    #[op]
    fn fold_items<A: Copy>(
        all: Columns<T, W, S, Self>,
        init: A,
        step: impl Fn(A, Self::Item) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        all.fold_by_two(init, step, join)
    }
    #[doc(hidden)]
    #[inline(always)]
    fn map_items<R: Lane, O: Mapped<R, S>>(
        all: Columns<T, W, S, Self>,
        to: impl Place<R>,
        f: impl Fn(Self::Item) -> O,
    ) {
        all.map(to, f)
    }
    #[doc(hidden)]
    #[op]
    fn first_pair<U: Lane, X: Width, F: Readable<U>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        matches: impl Fn((Self::Item, V<U, X, S>)) -> M<T, W, S>,
    ) -> Option<usize> {
        all.find::<false>(matches)
    }
    #[doc(hidden)]
    #[inline(always)]
    fn test_pairs<const ALL: bool, U: Lane, X: Width, F: Readable<U>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        matches: impl Fn((Self::Item, V<U, X, S>)) -> M<T, W, S>,
    ) -> bool {
        all.test::<ALL>(matches)
    }
    #[doc(hidden)]
    #[op]
    fn fold_pairs<U: Lane, X: Width, F: Readable<U>, A: Copy>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        init: A,
        step: impl Fn(A, (Self::Item, V<U, X, S>)) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        all.fold_by_two(init, step, join)
    }
    #[doc(hidden)]
    #[inline(always)]
    fn map_pairs<U: Lane, X: Width, F: Readable<U>, R: Lane, O: Mapped<R, S>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        to: impl Place<R>,
        f: impl Fn((Self::Item, V<U, X, S>)) -> O,
    ) {
        all.map(to, f)
    }
}

#[op]
fn part<E>(of: &[E], at: usize, n: usize) -> &[E] {
    crate::window::check(of.len(), at, n);
    &of[at..][..n]
}

#[sealed]
impl<T: Lane, W: Width, S: Isa, E: Readable<T>> Items<T, W, S> for Over<'_, T, W, S, E> {
    type Item = V<T, W, S>;
    const PLAIN: bool = E::PLAIN;
    const NARROWEST: usize = size_of::<T>();
    #[op]
    fn address(self) -> usize {
        self.parts().1.as_ptr().addr() / size_of::<T>()
    }
    #[op]
    fn behind(self, to: usize) -> usize {
        ahead(to, self.parts().1.as_ptr().addr())
    }
    #[inline(always)]
    fn how_many(self) -> usize {
        self.parts().1.len()
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        Over::new(self.parts().0, part(self.parts().1, at, n))
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        E::load(self.parts().1, s)
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        E::load_partial(self.parts().1, s)
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        Tag::new(s).load_any_or(self.parts().1, or)
    }
    const SLIDES: bool = E::PLAIN && Tag::<S, T, W>::SLIDES;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        self.load_whole(s).down_by(seen)
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        Tag::new(s).after_or(self.load_whole(s), seen, or)
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        keep.if_then_else_zero(it)
    }
    #[inline(always)]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        keep.if_then_else(it, or)
    }
    #[op]
    fn fold_or<A: Copy>(
        all: Columns<T, W, S, Pad<Self, T>>,
        init: A,
        step: impl Fn(A, Self::Item) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        Tag::new(all.s).fold(all.items.0.parts().1, all.items.1, init, step, join)
    }
    #[op]
    fn first_pair<U: Lane, X: Width, F: Readable<U>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        matches: impl Fn((Self::Item, V<U, X, S>)) -> M<T, W, S>,
    ) -> Option<usize> {
        let (d, x, y) = all.parts();
        d.find2_if(
            x,
            Tag::new(all.s),
            y,
            #[inline(always)]
            |a, b| matches((a, b)),
        )
    }
    #[op]
    fn test_pairs<const ALL: bool, U: Lane, X: Width, F: Readable<U>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        matches: impl Fn((Self::Item, V<U, X, S>)) -> M<T, W, S>,
    ) -> bool {
        let (d, x, y) = all.parts();
        d.test2::<ALL, _, _>(
            x,
            Tag::new(all.s),
            y,
            #[inline(always)]
            |a, b| matches((a, b)),
        )
    }
    #[op]
    fn fold_pairs<U: Lane, X: Width, F: Readable<U>, A: Copy>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        init: A,
        step: impl Fn(A, (Self::Item, V<U, X, S>)) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        let (d, x, y) = all.parts();
        d.fold2::<true, _, _, _>(
            x,
            Tag::new(all.s),
            y,
            init,
            #[inline(always)]
            |sum, a, b| step(sum, (a, b)),
            join,
        )
    }
    #[op]
    fn map_pairs<U: Lane, X: Width, F: Readable<U>, R: Lane, O: Mapped<R, S>>(
        all: Columns<T, W, S, (Self, Over<'_, U, X, S, F>)>,
        to: impl Place<R>,
        f: impl Fn((Self::Item, V<U, X, S>)) -> O,
    ) {
        let (d, x, y) = all.parts();
        choose! { O::EACH == 1 => to.zipped(d, (x, Tag::new(all.s), y), #[inline(always)] |a, b| f((a, b)).first_vector()), _ => all.map(to, f) }
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa, E: Readable<T>, const K: usize> Items<T, W, S> for [&[E]; K] {
    type Item = [V<T, W, S>; K];
    const NARROWEST: usize = size_of::<T>();
    #[op]
    fn address(self) -> usize {
        self[0].as_ptr().addr() / size_of::<T>()
    }
    #[op]
    fn behind(self, to: usize) -> usize {
        self.iter().fold(4096, |gap, it| gap.min(ahead(to, it.as_ptr().addr())))
    }
    const PLAIN: bool = E::PLAIN;
    #[op]
    fn how_many(self) -> usize {
        const { crate::make::Fits::<K>::SLICES };
        let mut len = self[0].len();
        unrolled!(8, for k in 1..const K {
            len = len.min(self[k].len());
        });
        len
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        array::map(
            self,
            #[inline(always)]
            |it| part(it, at, n),
        )
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        array::map(
            self,
            #[inline(always)]
            |it| E::load(it, s),
        )
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        array::map(
            self,
            #[inline(always)]
            |it| E::load_partial(it, s),
        )
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        array::map(
            self,
            #[inline(always)]
            |it| Tag::new(s).load_any_or(it, or),
        )
    }
    const SLIDES: bool = E::PLAIN && Tag::<S, T, W>::SLIDES;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        array::map(
            self.load_whole(s),
            #[inline(always)]
            |v| v.down_by(seen),
        )
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        array::map(
            self.load_whole(s),
            #[inline(always)]
            |v| Tag::new(s).after_or(v, seen, or),
        )
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        array::map(
            it,
            #[inline(always)]
            |v| keep.if_then_else_zero(v),
        )
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        array::map(
            it,
            #[inline(always)]
            |v| keep.if_then_else(v, or),
        )
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa, E: Readable<T>, const K: usize> Items<T, W, S> for &[[E; K]] {
    type Item = [V<T, W, S>; K];
    const PLAIN: bool = E::PLAIN;
    #[inline(always)]
    fn how_many(self) -> usize {
        <[_]>::len(self)
    }
    #[inline(always)]
    fn items_at(self, at: usize, n: usize) -> Self {
        part(self, at, n)
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        Tag::new(s).load_interleaved_any(self.as_flattened())
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        Tag::new(s).load_interleaved_n(self.as_flattened())
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        let counts = Tag::<S, T, W>::new(s).first_n(self.len());
        array::map(
            self.load_rest(s),
            #[inline(always)]
            |v| counts.select(v, or),
        )
    }
    const HALVES: bool = K > 4 && W::BYTES >= 32 && W::BYTES <= S::REGISTER;
    #[op]
    fn load_half(self, s: S) -> Self::Item {
        let d = Tag::<S, T, W>::new(s);
        array::map(
            d.half().load_interleaved_any(self.as_flattened()),
            #[inline(always)]
            |v| d.zero_extend(v),
        )
    }
    const SLIDES: bool = E::PLAIN && Tag::<S, T, W>::SLIDES;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        array::map(
            self.load_whole(s),
            #[inline(always)]
            |v| v.down_by(seen),
        )
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        array::map(
            self.load_whole(s),
            #[inline(always)]
            |v| Tag::new(s).after_or(v, seen, or),
        )
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        array::map(
            it,
            #[inline(always)]
            |v| keep.if_then_else_zero(v),
        )
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        array::map(
            it,
            #[inline(always)]
            |v| keep.if_then_else(v, or),
        )
    }
}
/// The lanes from `seen < LANES` on, and zeros. Up to 8 bytes are shifted as a number.
#[op]
fn after<U: Lane, X: Width, S: Isa>(v: V<U, X, S>, seen: usize) -> V<U, X, S> {
    choose! { X::BYTES <= 8 => v.resize::<crate::B8>().lanes_from(seen).resize(), _ => v.down_by(seen) }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa, A: Items<T, W, S>, U: Lane, X: Width, F: Readable<U>> Items<T, W, S>
    for (A, Over<'_, U, X, S, F>)
{
    type Item = (A::Item, V<U, X, S>);
    const PLAIN: bool = A::PLAIN && F::PLAIN;
    const NARROWEST: usize = if A::NARROWEST < size_of::<U>() { A::NARROWEST } else { size_of::<U>() };
    #[inline(always)]
    fn address(self) -> usize {
        self.0.address()
    }
    #[op]
    fn behind(self, to: usize) -> usize {
        self.0.behind(to).min(self.1.behind(to))
    }
    #[op]
    fn how_many(self) -> usize {
        self.0.how_many().min(self.1.how_many())
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        (self.0.items_at(at, n), self.1.items_at(at, n))
    }
    #[op]
    fn load_whole(self, s: S) -> Self::Item {
        (self.0.load_whole(s), self.1.load_whole(s))
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        (self.0.load_rest(s), self.1.load_rest(s))
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        (self.0.load_rest_or(s, or), self.1.load_rest(s))
    }
    const SLIDES: bool = A::SLIDES && F::PLAIN && (Tag::<S, U, X>::SLIDES || X::BYTES <= 8 && V::<U, X, S>::SLIDES);
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        (self.0.load_after(s, seen), after(self.1.load_whole(s), seen))
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        (self.0.load_after_or(s, seen, or), after(self.1.load_whole(s), seen))
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        (self.0.only(it.0, keep), self.1.only(it.1, crate::raw::same(keep.rebind::<U::Signed>())))
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        (self.0.only_or(it.0, keep, or), self.1.only(it.1, crate::raw::same(keep.rebind::<U::Signed>())))
    }
    #[op]
    fn first_match(all: Columns<T, W, S, Self>, matches: impl Fn(Self::Item) -> M<T, W, S>) -> Option<usize> {
        A::first_pair(all, matches)
    }
    #[op]
    fn test_items<const ALL: bool>(all: Columns<T, W, S, Self>, matches: impl Fn(Self::Item) -> M<T, W, S>) -> bool {
        A::test_pairs::<ALL, _, _, _>(all, matches)
    }
    #[op]
    fn fold_items<B: Copy>(
        all: Columns<T, W, S, Self>,
        init: B,
        step: impl Fn(B, Self::Item) -> B,
        join: impl Fn(B, B) -> B,
    ) -> B {
        A::fold_pairs(all, init, step, join)
    }
    #[inline(always)]
    fn map_items<R: Lane, O: Mapped<R, S>>(
        all: Columns<T, W, S, Self>,
        to: impl Place<R>,
        f: impl Fn(Self::Item) -> O,
    ) {
        A::map_pairs(all, to, f)
    }
}
#[derive(Copy, Clone)]
pub struct Pad<I, T>(I, T);
#[sealed]
impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Items<T, W, S> for Pad<I, T> {
    type Item = I::Item;
    const NARROWEST: usize = I::NARROWEST;
    #[inline(always)]
    fn address(self) -> usize {
        self.0.address()
    }
    #[inline(always)]
    fn behind(self, to: usize) -> usize {
        self.0.behind(to)
    }
    const PLAIN: bool = I::PLAIN;
    #[inline(always)]
    fn how_many(self) -> usize {
        self.0.how_many()
    }
    #[op]
    fn items_at(self, at: usize, n: usize) -> Self {
        Self(self.0.items_at(at, n), self.1)
    }
    #[inline(always)]
    fn load_whole(self, s: S) -> Self::Item {
        self.0.load_whole(s)
    }
    #[op]
    fn load_rest(self, s: S) -> Self::Item {
        self.0.load_rest_or(s, self.1)
    }
    #[op]
    fn load_rest_or(self, s: S, or: T) -> Self::Item {
        self.0.load_rest_or(s, or)
    }
    const SLIDES: bool = I::SLIDES;
    #[op]
    fn load_after(self, s: S, seen: usize) -> Self::Item {
        self.0.load_after_or(s, seen, self.1)
    }
    #[op]
    fn load_after_or(self, s: S, seen: usize, or: T) -> Self::Item {
        self.0.load_after_or(s, seen, or)
    }
    #[op]
    fn only(self, it: Self::Item, keep: M<T, W, S>) -> Self::Item {
        self.0.only_or(it, keep, self.1)
    }
    #[op]
    fn only_or(self, it: Self::Item, keep: M<T, W, S>, or: T) -> Self::Item {
        self.0.only_or(it, keep, or)
    }
    #[op]
    fn fold_items<A: Copy>(
        all: Columns<T, W, S, Self>,
        init: A,
        step: impl Fn(A, Self::Item) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        I::fold_or(all, init, step, join)
    }
}

impl<T: Lane, W: Width, S: Isa, I> Columns<T, W, S, Pad<I, T>> {
    #[op]
    pub(crate) fn unpadded(self) -> Columns<T, W, S, I> {
        Columns { s: self.s, items: self.items.0, of: PhantomData }
    }
}

/// What [`map_into`](Over::map_into) writes: a vector, or an array of up to 16, which are interleaved.
#[diagnostic::on_unimplemented(message = "`{Self}` is neither a vector of `{R}` nor an array of them")]
pub trait Mapped<R: Lane, S: Isa>: Copy + crate::seals::Mapped<R, S> {
    #[doc(hidden)]
    const LANES: usize;
    #[doc(hidden)]
    const EACH: usize;
    #[doc(hidden)]
    type Of: Width;
    #[doc(hidden)]
    fn first_vector(self) -> V<R, Self::Of, S>;
    #[doc(hidden)]
    fn write_whole(self, to: impl Place<R>);
    #[doc(hidden)]
    fn write_rest(self, to: impl Place<R>);
    #[doc(hidden)]
    fn write_half(self, to: impl Place<R>);
    /// See `Tag::end_of`.
    #[doc(hidden)]
    fn end_with(self, rest: Self, left: usize) -> Self;
}
#[sealed]
impl<R: Lane, Y: Width, S: Isa> Mapped<R, S> for V<R, Y, S> {
    const LANES: usize = Self::LANES;
    const EACH: usize = 1;
    type Of = Y;
    #[inline(always)]
    fn first_vector(self) -> Self {
        self
    }
    #[inline(always)]
    fn write_whole(self, mut to: impl Place<R>) {
        self.write(&mut to, 0)
    }
    #[inline(always)]
    fn write_rest(self, mut to: impl Place<R>) {
        self.write_n(&mut to, 0)
    }
    #[op]
    fn write_half(self, mut to: impl Place<R>) {
        self.lower_half().write(&mut to, 0)
    }
    #[op]
    fn end_with(self, rest: Self, left: usize) -> Self {
        self.tag().end_of(self, rest, left)
    }
}
#[sealed]
impl<R: Lane, Y: Width, S: Isa, const K: usize> Mapped<R, S> for [V<R, Y, S>; K] {
    const LANES: usize = V::<R, Y, S>::LANES;
    const EACH: usize = crate::make::Fits::<K>::RECORDS;
    type Of = Y;
    #[inline(always)]
    fn first_vector(self) -> V<R, Y, S> {
        self[0]
    }
    #[op]
    fn write_whole(self, to: impl Place<R>) {
        self[0].tag().write_interleaved_n(self, to)
    }
    #[op]
    fn write_rest(self, to: impl Place<R>) {
        self[0].tag().write_interleaved_rest(self, to)
    }
    #[op]
    fn write_half(self, to: impl Place<R>) {
        array::map(
            self,
            #[inline(always)]
            |v| v.lower_half(),
        )
        .write_whole(to)
    }
    #[op]
    fn end_with(self, rest: Self, left: usize) -> Self {
        array::from_fn(
            #[inline(always)]
            |k| self[k].end_with(rest[k], left),
        )
    }
}

/// What [`unzip_into`](Over::unzip_into) writes to: a tuple or an array of 2 to 16 [`Sink`]s, such as `&mut [T]`, `&mut Output` or `&[Cell<T>]`.
#[diagnostic::on_unimplemented(
    message = "this can't be written to `{Self}`",
    label = "expected a tuple or an array of 2 to 16 outputs, such as `&mut [T]`",
    note = "the closure returns a tuple for a tuple of outputs, and an array for an array"
)]
pub trait Sinks<R, O, S: Isa>: crate::seals::Sinks<R, O, S> {
    #[doc(hidden)]
    fn unzip_from<T: Lane, W: Width, I: Items<T, W, S>, F: FnMut(I::Item) -> O>(self, all: Columns<T, W, S, I>, f: F);
    #[doc(hidden)]
    fn filter_from<T: Lane, W: Width, I: Items<T, W, S>>(
        self,
        all: Columns<T, W, S, I>,
        f: impl Fn(I::Item) -> (M<T, W, S>, O),
    ) -> usize;
}
#[op]
#[track_caller]
fn kept<T: Lane, W: Width, S: Isa, R: Lane, O: Mapped<R, S>>(values: O, keep: M<T, W, S>) -> V<R, O::Of, S> {
    require!(of V<T, W, S>, "the result has to have as many lanes", O::EACH == 1 && V::<T, W, S>::LANES == O::LANES);
    let (v, keep) = (values.first_vector(), crate::raw::same(keep.rebind::<R::Signed>()));
    choose! { S::SVE2 => v.compress_counted(keep, true).0, _ => v.compress_mask(keep) }
}
/// There is room for all lanes.
#[op]
#[track_caller]
fn put_kept<T: Lane, W: Width, S: Isa, R: Lane, O: Mapped<R, S>>(
    values: O,
    keep: M<T, W, S>,
    to: &mut impl Place<R>,
    at: usize,
) {
    if const { V::<R, O::Of, S>::IN_PARTS && O::EACH == 1 && V::<T, W, S>::LANES == O::LANES } {
        return live!(V::<R, O::Of, S>::IN_PARTS && O::EACH == 1 && V::<T, W, S>::LANES == O::LANES, {
            let mut to = to.again().skip(at).slice(0..O::LANES);
            values.first_vector().compress_parts_write(keep.own_bits(), &mut to, 0);
        });
    }
    kept::<T, W, S, R, O>(values, keep).write(to, at)
}
/// As many as fit, of which only the first `left` can be kept.
#[op]
#[track_caller]
fn put_rest<T: Lane, W: Width, S: Isa, R: Lane, O: Mapped<R, S>>(
    values: O,
    keep: M<T, W, S>,
    to: &mut impl Place<R>,
    at: usize,
    left: usize,
) {
    if const {
        crate::X86
            && V::<R, O::Of, S>::IN_PARTS
            && O::Of::BYTES == 32
            && O::EACH == 1
            && V::<T, W, S>::LANES == O::LANES
    } && left <= O::LANES / 2
    {
        return live!(crate::X86 && V::<R, O::Of, S>::IN_PARTS && O::Of::BYTES == 32, {
            values.first_vector().lower_half().compress_own(keep.own_bits()).write_n(to, at)
        });
    }
    kept::<T, W, S, R, O>(values, keep).write_n(to, at)
}
#[sealed]
impl<S: Isa, R: Lane, Y: Width, A: Sink<R> + ?Sized> Sinks<R, V<R, Y, S>, S> for &mut A {
    #[inline(always)]
    #[track_caller]
    fn unzip_from<T: Lane, W: Width, I: Items<T, W, S>, F: FnMut(I::Item) -> V<R, Y, S>>(
        self,
        all: Columns<T, W, S, I>,
        f: F,
    ) {
        all.scan(self.place(), f)
    }
    #[op]
    #[track_caller]
    fn filter_from<T: Lane, W: Width, I: Items<T, W, S>>(
        self,
        all: Columns<T, W, S, I>,
        f: impl Fn(I::Item) -> (M<T, W, S>, V<R, Y, S>),
    ) -> usize {
        (self,).filter_from(
            all,
            #[inline(always)]
            |it| {
                let (keep, v) = f(it);
                (keep, (v,))
            },
        )
    }
}
/// A tuple of sinks as pairs in pairs, so that rustc checks the loops once, and not for each length.
trait Nested<R, O, S: Isa> {
    type Places<'a>: Places<R, O, S>
    where
        Self: 'a;
    fn places(&mut self) -> Self::Places<'_>;
    fn rooms<T: Lane, W: Width, I: Items<T, W, S>>(&mut self, all: Columns<T, W, S, I>) -> Self::Places<'_>;
}
trait Places<R, O, S: Isa> {
    /// The numbers of lanes, as bits, at which `end` has a use for the values before.
    const SLIDES: usize;
    fn shortest(&self, so_far: usize) -> usize;
    fn cut(self, n: usize) -> Self;
    /// All checks come before `values`. LLVM would sink what it computes behind them, in another order.
    fn write_whole(&mut self, k: usize, values: impl FnOnce() -> O);
    fn end<T: Lane, W: Width, I: Items<T, W, S>>(self, before: (bool, O), rest: O, len: usize, at: usize);
    fn put_kept<T: Lane, W: Width>(&mut self, values: O, keep: M<T, W, S>, at: usize);
    fn put_some<T: Lane, W: Width>(&mut self, values: O, keep: M<T, W, S>, at: usize);
    fn put_left<T: Lane, W: Width>(&mut self, values: O, keep: M<T, W, S>, at: usize, left: usize);
    fn put_rest<T: Lane, W: Width>(&mut self, values: O, keep: M<T, W, S>, at: usize, left: usize);
    fn keep(&mut self, n: usize);
}
impl<S: Isa> Nested<(), (), S> for () {
    type Places<'a> = ();
    #[inline(always)]
    fn places(&mut self) {}
    #[inline(always)]
    fn rooms<T: Lane, W: Width, I: Items<T, W, S>>(&mut self, _: Columns<T, W, S, I>) {}
}
impl<S: Isa, R: Lane, O: Mapped<R, S>, A: Sink<R>, Rs, Os: Copy, As: Nested<Rs, Os, S>> Nested<(R, Rs), (O, Os), S>
    for (A, As)
{
    type Places<'a>
        = (A::Place<'a>, As::Places<'a>)
    where
        Self: 'a;
    #[op]
    #[track_caller]
    fn places(&mut self) -> Self::Places<'_> {
        (self.0.place(), self.1.places())
    }
    #[op]
    #[track_caller]
    fn rooms<T: Lane, W: Width, I: Items<T, W, S>>(&mut self, all: Columns<T, W, S, I>) -> Self::Places<'_> {
        (self.0.place().slice(0..all.room::<R, O>()), self.1.rooms(all))
    }
}
impl<S: Isa> Places<(), (), S> for () {
    const SLIDES: usize = 0;
    #[inline(always)]
    fn shortest(&self, so_far: usize) -> usize {
        so_far
    }
    #[inline(always)]
    fn cut(self, _: usize) {}
    #[inline(always)]
    fn write_whole(&mut self, _: usize, values: impl FnOnce()) {
        values()
    }
    #[inline(always)]
    fn end<T: Lane, W: Width, I: Items<T, W, S>>(self, _: (bool, ()), (): (), _: usize, _: usize) {}
    #[inline(always)]
    fn put_kept<T: Lane, W: Width>(&mut self, (): (), _: M<T, W, S>, _: usize) {}
    #[inline(always)]
    fn put_some<T: Lane, W: Width>(&mut self, (): (), _: M<T, W, S>, _: usize) {}
    #[inline(always)]
    fn put_left<T: Lane, W: Width>(&mut self, (): (), _: M<T, W, S>, _: usize, _: usize) {}
    #[inline(always)]
    fn put_rest<T: Lane, W: Width>(&mut self, (): (), _: M<T, W, S>, _: usize, _: usize) {}
    #[inline(always)]
    fn keep(&mut self, _: usize) {}
}
impl<S: Isa, R: Lane, O: Mapped<R, S>, P: Place<R>, Rs, Os: Copy, Ps: Places<Rs, Os, S>> Places<(R, Rs), (O, Os), S>
    for (P, Ps)
{
    const SLIDES: usize = Ps::SLIDES | if Tag::<S, R, O::Of>::SLIDES && !P::SHARED { O::LANES } else { 0 };
    #[op]
    fn shortest(&self, so_far: usize) -> usize {
        self.1.shortest(so_far.min(self.0.len()))
    }
    #[op]
    #[track_caller]
    fn cut(self, n: usize) -> Self {
        (self.0.slice(0..n), self.1.cut(n))
    }
    #[op]
    #[track_caller]
    fn write_whole(&mut self, k: usize, values: impl FnOnce() -> (O, Os)) {
        let m = O::LANES * O::EACH;
        crate::window::check(self.0.len(), k * m, m);
        let here = self.0.again().skip(k * m).slice(0..m);
        self.1.write_whole(
            k,
            #[inline(always)]
            || {
                let (first, others) = values();
                first.write_whole(here);
                others
            },
        )
    }
    #[op]
    #[track_caller]
    fn end<T: Lane, W: Width, I: Items<T, W, S>>(self, before: (bool, (O, Os)), rest: (O, Os), len: usize, at: usize) {
        Columns::<T, W, S, I>::end(if before.0 { Some(before.1.0) } else { None }, rest.0, self.0, len, at);
        self.1.end::<T, W, I>((before.0, before.1.1), rest.1, len, at)
    }
    #[op]
    #[track_caller]
    fn put_kept<T: Lane, W: Width>(&mut self, values: (O, Os), keep: M<T, W, S>, at: usize) {
        put_kept::<T, W, S, R, O>(values.0, keep, &mut self.0, at);
        self.1.put_kept::<T, W>(values.1, keep, at)
    }
    #[op]
    #[track_caller]
    fn put_some<T: Lane, W: Width>(&mut self, values: (O, Os), keep: M<T, W, S>, at: usize) {
        kept::<T, W, S, R, O>(values.0, keep).write_n(&mut self.0, at);
        self.1.put_some::<T, W>(values.1, keep, at)
    }
    #[op]
    #[track_caller]
    fn put_left<T: Lane, W: Width>(&mut self, values: (O, Os), keep: M<T, W, S>, at: usize, left: usize) {
        crate::window::check(self.0.len(), at, left);
        kept::<T, W, S, R, O>(values.0, keep).write_n(&mut self.0.again().skip(at).slice(0..left), 0);
        self.1.put_left::<T, W>(values.1, keep, at, left)
    }
    #[op]
    #[track_caller]
    fn put_rest<T: Lane, W: Width>(&mut self, values: (O, Os), keep: M<T, W, S>, at: usize, left: usize) {
        put_rest::<T, W, S, R, O>(values.0, keep, &mut self.0, at, left);
        self.1.put_rest::<T, W>(values.1, keep, at, left)
    }
    #[op]
    #[track_caller]
    fn keep(&mut self, n: usize) {
        self.0.keep(n);
        self.1.keep(n)
    }
}
impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Columns<T, W, S, I> {
    #[op]
    #[track_caller]
    fn unzip<R, O: Copy, P: Places<R, O, S>>(self, mut to: P, mut f: impl FnMut(I::Item) -> O) {
        let (mut at, mut k, mut before) = (0, 0, None);
        while self.has(at, V::<T, W, S>::LANES) {
            to.write_whole(
                k,
                #[inline(always)]
                || *before.insert(f(self.at(at))),
            );
            (at, k) = (at + V::<T, W, S>::LANES, k + 1);
        }
        if at < self.len() {
            let rest = f(self.rest(at));
            // No `Option` for the pairs: LLVM would keep a copy of the tail for each case, also where they are the same.
            if const { P::SLIDES & Self::N != 0 }
                && let Some(before) = before
            {
                return to.end::<T, W, I>((true, before), rest, self.len(), at);
            }
            to.end::<T, W, I>((false, rest), rest, self.len(), at)
        }
    }
    #[op]
    #[track_caller]
    fn filter<R, O>(self, mut to: impl Nested<R, O, S>, f: impl Fn(I::Item) -> (M<T, W, S>, O)) -> usize {
        let (to, lanes, mut at, mut n) = (to.places(), V::<T, W, S>::LANES, 0, 0);
        let room = to.shortest(usize::MAX);
        let mut to = to.cut(room);
        let len = self.len();
        if len >= lanes {
            // Without masks, the odd part comes first, so that the last store is whole too. With them, the last vector overlaps.
            // What isn't plain can be what is written.
            let (first, last) = const { (I::PLAIN && !Tag::<S, T, W>::BY_BITS, I::PLAIN && Tag::<S, T, W>::BY_BITS) };
            let mut step = if first { (len - 1) % lanes + 1 } else { lanes };
            let mut counts = self.d().first_n(step);
            while self.has(at, lanes) && room >= lanes && n <= room - lanes {
                let (keep, values) = f(self.at(at));
                let keep = keep & counts;
                to.put_kept::<T, W>(values, keep, n);
                (at, n, step, counts) = (at + step, n + keep.count(), lanes, self.d().mask_true());
            }
            while if last { at < len } else { self.has(at, lanes) } {
                crate::not_unrolled();
                let here = if last { at.min(len - lanes) } else { at };
                let (keep, values) = f(self.at(here));
                let keep = keep & if last { !self.d().first_n((at - here) % lanes) } else { counts };
                // With so little room, most have nothing.
                if len - at < 4 * lanes || keep.any() {
                    to.put_some::<T, W>(values, keep, n);
                    n += keep.count();
                    assert!(n <= room);
                }
                (at, step, counts) = (at + step, lanes, self.d().mask_true());
            }
            if const { I::PLAIN } {
                to.keep(n);
                return n;
            }
        }
        // In a loop, each address has a counter.
        if at < len {
            let (keep, values) = f(self.rest(at));
            let (left, keep) = (len - at, keep & self.d().first_n(len - at));
            // With the length of the loads, the stores take their mask.
            if const { Tag::<S, T, W>::BY_BITS } && room >= left && n <= room - left {
                to.put_left::<T, W>(values, keep, n, left);
            } else {
                to.put_rest::<T, W>(values, keep, n, left);
                assert!(n + keep.count() <= room);
            }
            n += keep.count();
        }
        to.keep(n);
        n
    }
}
macro_rules! nested {
    () => { () };
    ($first:tt $($rest:tt)*) => { ($first, nested!($($rest)*)) };
}
macro_rules! sinks {
    ([$($done:tt)+]) => {};
    ([$($done:tt)+] $next:tt $($rest:tt)*) => { sinks_of! { $($done)+ $next } sinks! { [$($done)+ $next] $($rest)* } };
}
#[rules]
macro_rules! sinks_of { ($([$to:ident $A:ident $R:ident $o:ident $O:ident])+) => {
    #[doc(hidden)]
    #[sealed]
    impl<S: Isa, $($R: Lane, $O: Mapped<$R, S>, $A: Sink<$R>),+> Sinks<($($R,)+), ($($O,)+), S> for ($($A,)+) where nested!($($A)+): Nested<nested!($($R)+), nested!($($O)+), S> {
        #[op]
        #[track_caller]
        fn unzip_from<T: Lane, W: Width, I: Items<T, W, S>, F: FnMut(I::Item) -> ($($O,)+)>(self, all: Columns<T, W, S, I>, f: F) {
            inlined_mut!(all.s, f: F, (a));
            let ($($to,)+) = self;
            all.unzip(nested!($($to)+).rooms(all), #[inline(always)] |it| { let ($($o,)+) = f(it); nested!($($o)+) })
        }
        #[op]
        #[track_caller]
        fn filter_from<T: Lane, W: Width, I: Items<T, W, S>>(self, all: Columns<T, W, S, I>, f: impl Fn(I::Item) -> (M<T, W, S>, ($($O,)+))) -> usize {
            inlined_here!(all.s, f(a));
            let ($($to,)+) = self;
            all.filter(nested!($($to)+), #[inline(always)] |it| { let (keep, ($($o,)+)) = f(it); (keep, nested!($($o)+)) })
        }
    }
    #[doc(hidden)]
    #[sealed]
    impl<S: Isa, R, O, A> Sinks<R, [O; ${count($to)}], S> for [A; ${count($to)}] where ($(${ignore($to)} A,)+): Sinks<($(${ignore($to)} R,)+), ($(${ignore($to)} O,)+), S> {
        #[op]
        #[track_caller]
        fn unzip_from<T: Lane, W: Width, I: Items<T, W, S>, F: FnMut(I::Item) -> [O; ${count($to)}]>(self, all: Columns<T, W, S, I>, mut f: F) {
            let [$($to),+] = self;
            ($($to,)+).unzip_from(all, #[inline(always)] move |it| { let [$($o),+] = f(it); ($($o,)+) })
        }
        #[op]
        #[track_caller]
        fn filter_from<T: Lane, W: Width, I: Items<T, W, S>>(self, all: Columns<T, W, S, I>, f: impl Fn(I::Item) -> (M<T, W, S>, [O; ${count($to)}])) -> usize {
            let [$($to),+] = self;
            ($($to,)+).filter_from(all, #[inline(always)] |it| { let (keep, [$($o),+]) = f(it); (keep, ($($o,)+)) })
        }
    }
}; }
sinks_of! { [to0 A0 R0 o0 O0] }
sinks! { [[to0 A0 R0 o0 O0]]
[to1 A1 R1 o1 O1] [to2 A2 R2 o2 O2] [to3 A3 R3 o3 O3] [to4 A4 R4 o4 O4] [to5 A5 R5 o5 O5] [to6 A6 R6 o6 O6] [to7 A7 R7 o7 O7]
[to8 A8 R8 o8 O8] [to9 A9 R9 o9 O9] [to10 A10 R10 o10 O10] [to11 A11 R11 o11 O11] [to12 A12 R12 o12 O12] [to13 A13 R13 o13 O13] [to14 A14 R14 o14 O14] [to15 A15 R15 o15 O15] }

/// Several values at each index, a vector of each at a time: of slices side by side ([`V::over_all`](Simd::over_all), [`zip`](Over::zip)),
/// of neighbors ([`windows`](Over::windows)), or of the fields of records ([`interleaved`](Over::interleaved)).
///
/// The loops have one check for all columns, and take care of the tail. The rules for closures are those of [`Over`].
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut bgra = [0; 8];
/// over(b"RGBrgb").interleaved().map_into(&mut bgra, |[r, g, b]| [b, g, r, u8xN::splat(b'!')]);
/// assert_eq!(&bgra, b"BGR!bgr!");
/// assert_eq!(over(b"a\r\n").windows().position(|[a, b]| a.simd_eq(b'\r') & b.simd_eq(b'\n')), Some(1));
/// # } example()
/// ```
pub struct Columns<
    T: Lane, // No iterator: see exact() and padded(). map_into(to, f) writes to a slice.
    W: Width,
    S: Isa,
    I,
> {
    s: S,
    items: I,
    of: PhantomData<(T, W)>,
}
impl<T: Lane, W: Width, S: Isa, I: Copy> Copy for Columns<T, W, S, I> {}
impl<T: Lane, W: Width, S: Isa, I: Copy> Clone for Columns<T, W, S, I> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

macro_rules! methods { ($($(#[$m:meta])* fn $name:ident $([$($g:tt)*])? ($($args:tt)*) $(-> $out:ty)? $body:block)*) => {$(
    $(#[$m])* #[op] pub fn $name<$($($g)*)?>($($args)*) $(-> $out)? $body
)*}; }

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Columns<T, W, S, I> {
    const N: usize = V::<T, W, S>::LANES;
    #[op]
    pub(crate) fn new(s: S, items: I) -> Self {
        Self { s, items: items.items_at(0, items.how_many()), of: PhantomData }
    }
    #[inline(always)]
    pub(crate) fn items(self) -> I {
        self.items
    }
    /// All columns of `items` have the same length.
    #[op]
    pub(crate) fn with<J>(self, items: J) -> Columns<T, W, S, J> {
        Columns { s: self.s, items, of: PhantomData }
    }
    #[op]
    pub(crate) fn window(self, at: usize, n: usize) -> Self {
        Self { items: self.items.items_at(at, n), ..self }
    }
    #[inline(always)]
    fn d(self) -> Tag<S, T, W> {
        Tag::new(self.s)
    }
    #[inline(always)]
    pub(crate) fn isa(self) -> S {
        self.s
    }
    #[op]
    pub(crate) fn at(self, at: usize) -> I::Item {
        self.items.items_at(at, Self::N).load_whole(self.s)
    }
    #[op]
    pub(crate) fn rest(self, at: usize) -> I::Item {
        if const { I::SLIDES } && self.len() >= Self::N {
            let last = self.len() - Self::N;
            return live!(I::SLIDES, self.items.items_at(last, Self::N).load_after(self.s, (at - last) % Self::N));
        }
        let left = self.len() - at;
        // One test, for a `min` in the mask of each column.
        assert!(left < Self::N);
        self.items.items_at(at, left).load_rest(self.s)
    }
    /// Whether there are `n` items from `at` on, in the form of the check of `items_at`.
    #[op]
    pub(crate) fn has(self, at: usize, n: usize) -> bool {
        self.len() >= n && at <= self.len() - n
    }
    /// How many items the first column starts after a multiple of the width, or ends before one. Zero if it doesn't pay to align the loads.
    #[op]
    fn odd<const LAST: bool>(self) -> usize {
        if const { !S::AVX2 || W::BYTES < 32 } || self.len() < 16 * Self::N {
            return 0;
        }
        core::hint::cold_path();
        (if LAST { self.items.address().wrapping_add(self.len()).wrapping_neg() } else { self.items.address() })
            % Self::N
    }
    #[op]
    fn block(self, at: usize, matches: &impl Fn(I::Item) -> M<T, W, S>) -> u64 {
        let all = Self { items: self.items.items_at(at, 64), ..self };
        self.d().bits_of(
            #[inline(always)]
            |at| matches(all.at(at)),
        )
    }
    /// Of the fewer than 64 items from `at` on.
    #[op]
    fn last_block(self, at: usize, matches: &impl Fn(I::Item) -> M<T, W, S>) -> u64 {
        let len = self.len();
        if len >= 64 {
            return self.block(len - 64, matches) >> 1 >> (63 - (len - at));
        }
        let (mut all, mut at) = (0, 0);
        if len < Self::N {
            return matches(self.rest(0)).to_bitmask() & !(!0 << len);
        }
        return_if!(
            Tag::<S, T, W>::BITS_AT_ONCE,
            self.d().fewer_bits_of(
                len - Self::N,
                #[inline(always)]
                |at| matches(self.at(at))
            )
        );
        while at < len {
            crate::not_unrolled();
            let here = at.min(len - Self::N);
            all |= matches(self.at(here)).to_bitmask() << here;
            at += Self::N;
        }
        all
    }
    #[op]
    fn test<const ALL: bool>(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> bool {
        self.find::<false>(
            #[inline(always)]
            |it| if ALL { !matches(it) } else { matches(it) },
        )
        .is_none()
            == ALL
    }
    #[op]
    fn find<const LAST: bool>(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> Option<usize> {
        let (d, n, len) = (self.d(), Self::N, self.len());
        if len < n {
            return d.find_in::<LAST>(matches(self.rest(0)) & d.first_n(len));
        }
        let (mut done, odd) = (0, self.odd::<LAST>());
        if odd != 0 {
            let at = if LAST { len - n } else { 0 };
            if let Some(lane) = d.find_in::<LAST>(matches(self.at(at))) {
                return Some(at + lane);
            }
            done = n - odd;
        }
        while const { W::BYTES <= S::REGISTER } && self.has(done, 2 * n) {
            let at = if LAST { len - 2 * n - done } else { done };
            let two = Self { items: self.items.items_at(at, 2 * n), ..self };
            let (a, b) = (matches(two.at(0)), matches(two.at(n)));
            if (a | b).any() {
                return Some(at + a.find_in_both::<LAST>(b));
            }
            done += 2 * n;
        }
        while done < len {
            crate::not_unrolled();
            let at = if LAST { len - n - done.min(len - n) } else { done.min(len - n) };
            if let Some(lane) = d.find_in::<LAST>(matches(self.at(at))) {
                return Some(at + lane);
            }
            done += n;
        }
        None
    }

    methods! {
    /// The number of indices.
    fn len(self) -> usize { self.items.how_many() }
    /// Whether there are none.
    fn is_empty(self) -> bool { self.len() == 0 }
    /// Next to a slice with values of the same size, up to the end of the shorter side. The closures get a pair, as after `Iterator::zip`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (a, b, c) = ([1i64, 5, 9], [0.5, 0.5, 2.0], [1u64, 1, 1]);
    /// assert_eq!(over(&a).zip(&b).zip(&c).count(|((a, b), c)| a.simd_gt(2) & b.simd_lt(1.0) & c.simd_eq(1)), 1);
    /// # } example()
    /// ```
    fn zip['a, U: SameSize<T::Signed>, /* else zip_scaled */ F: Readable<U>](self, other: &'a [F]) -> Columns<T, W, S, (I, Over<'a, U, W, S, F>)> {
        Columns::new(self.s, (self.items, Over::new(self.s, other)))
    }
    /// As [`Over::zip_scaled`].
    #[track_caller]
    fn zip_scaled['a, U: Lane, F: Readable<U>](self, other: &'a [F]) -> Columns<T, W, S, (I, Over<'a, U, Scaled<T, U, W>, S, F>)> {
        require!("there is no vector with as many lanes of that type: the widths are 2 to 512 bytes", Self::N == V::<U, Scaled<T, U, W>, S>::LANES);
        Columns::new(self.s, (self.items, Over::new(self.s, other)))
    }
    /// As [`Over::pad`]. What `zip` has added keeps zeros.
    fn pad(self, value: T) -> Columns<T, W, S, Pad<I, T>> { Columns { s: self.s, items: Pad(self.items, value), of: PhantomData } }
    /// All whole vectors, and what is left.
    fn exact(self) -> (impl ExactSizeIterator<Item = I::Item>, Self) {
        let left = self.len() % Self::N;
        (Exact { all: self, at: 0 }, Self { items: self.items.items_at(self.len() - left, left), ..self })
    }
    /// As [`Over::padded`].
    #[track_caller]
    fn padded(self) -> impl ExactSizeIterator<Item = (I::Item, u64)> {
        V::<T, W, S>::all_bits_of_lanes();
        Padded { all: self, at: 0 }
    }
    /// The first index that matches.
    #[doc(alias("mismatch", "memcmp", "memmem", "substring", "common_prefix"))]
    fn position(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> Option<usize> { inlined_here!(self.s, matches(a)); I::first_match(self, matches) }
    /// The last index that matches.
    #[doc(alias("common_suffix"))]
    fn rposition(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> Option<usize> { inlined_here!(self.s, matches(a)); self.find::<true>(matches) }
    /// All indices that match, in order, such as the candidates of a search for a substring.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (text, word) = (b"a cot, a cat", b"cat");
    /// let mut candidates = over(text).zip(&text[2..]).positions(|(a, b)| a.simd_eq(b'c') & b.simd_eq(b't'));
    /// assert_eq!(candidates.find(|&at| text[at..].starts_with(word)), Some(9));
    /// # } example()
    /// ```
    #[doc(alias("memmem", "substring", "strstr"))]
    #[track_caller]
    fn positions(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> impl Iterator<Item = usize> {
        V::<T, W, S>::all_bits_of_lanes();
        inlined_here!(self.s, matches(a));
        let odd = self.odd::<false>();
        if odd != 0 && self.len() >= 64 {
            return Positions { all: self, bits: self.block(0, &matches) << odd, matches, first: odd.wrapping_neg() };
        }
        Positions { all: self, matches, first: 0usize.wrapping_sub(64), bits: 0 }
    }
    /// Whether any index matches.
    fn any(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> bool { inlined_here!(self.s, matches(a)); I::test_items::<false>(self, matches) }
    /// Whether all indices match.
    #[doc(alias("eq", "equal"))]
    fn all(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> bool {
        inlined_here!(self.s, matches(a));
        I::test_items::<true>(self, matches)
    }
    /// The number of indices that match.
    fn count(self, matches: impl Fn(I::Item) -> M<T, W, S>) -> usize {
        inlined_here!(self.s, matches(a));
        self.tally(#[inline(always)] |it| [matches(it)])[0]
    }
    /// As [`Over::counts`].
    fn counts[const K: usize](self, matches: impl Fn(I::Item) -> [M<T, W, S>; K]) -> [usize; K] { inlined_here!(self.s, matches(a)); self.tally(matches) }
    /// As [`Over::bitmask_into`].
    #[track_caller]
    fn bitmask_into(self, to: &mut (impl Sink<u64> + ?Sized), matches: impl Fn(I::Item) -> M<T, W, S>) {
        V::<T, W, S>::all_bits_of_lanes();
        inlined_here!(self.s, matches(a));
        let (mut to, mut at) = (to.place().slice(0..self.len().div_ceil(64)), 0);
        // LLVM doesn't unroll it.
        while const { crate::X86 && S::REGISTER >= 32 && Self::N >= 32 && crate::OPTIMIZED } && self.has(at, 256) {
            let all = self.window(at, 256);
            let mut four = to.again().slice(0..4);
            four.write(0, [all.block(0, &matches)]);
            four.write(1, [all.block(64, &matches)]);
            four.write(2, [all.block(128, &matches)]);
            four.write(3, [all.block(192, &matches)]);
            drop(four);
            (to, at) = (to.skip(4), at + 256);
        }
        while self.has(at, 64) {
            if const { S::REGISTER == 64 && Self::N >= 8 && Self::N < 64 && cfg!(target_endian = "little") } && let Some([word, ..]) = to.as_mut_slice() {
                // No shifts.
                let (all, bytes) = (self.window(at, 64), crate::lane::as_bytes_mut(core::slice::from_mut(word)));
                unrolled!(8 theirs, for j in 0..const (64 / if Self::N == 0 { 1 } else { Self::N }) {
                    matches(all.at(j * Self::N)).store_bitmask(&mut bytes[j * Self::N / 8..]);
                });
                (to, at) = (to.skip(1), at + 64);
                continue;
            }
            to.write(0, [self.block(at, &matches)]);
            (to, at) = (to.skip(1), at + 64);
        }
        if at < self.len() {
            to.write(0, [self.last_block(at, &matches)]);
        }
    }
    /// As [`Over::fold`], but with two accumulators, unless these are two slices after `zip`, or one after `pad`.
    #[doc(alias("fold2"))]
    fn fold[A: Copy](self, init: A, step: impl Fn(A, I::Item) -> A, join: impl Fn(A, A) -> A) -> A {
        inlined_here!(self.s, step(a, b), join(a, b));
        I::fold_items(self, init, step, join)
    }
    /// Writes `f` of each item to the start of `to`: a vector, or an array of them, which are interleaved. Panics if `to` is
    /// too short. It can be the same memory, as cells, if what is written at an index is not read at a later one.
    /// Groups of lanes, and results with more or fewer lanes, are as in [`Over::map_into`].
    #[doc(alias("Transform2", "transform2", "zip_map"))]
    #[track_caller]
    fn map_into[R: Lane, O: Mapped<R, S>](self, /* for cells: &mut &cells[..] */ to: &mut (impl Sink<R> + ?Sized), f: impl Fn(I::Item) -> O) {
        return_if!(Self::N != O::LANES, {
            require!(of O, "a lane is wider than the vector", O::LANES > 0);
            let each = Self::N.div_ceil(O::LANES);
            Self { items: self.items.items_at(0, self.len() / each * each), ..self }.scan(to.place(), f)
        });
        inlined_here!(self.s, f(a));
        I::map_items(self, to.place().slice(0..self.len().saturating_mul(O::EACH)), f)
    }
    /// As [`Over::scan_into`].
    #[track_caller]
    fn scan_into[R: Lane, O: Mapped<R, S>](self, to: &mut (impl Sink<R> + ?Sized), f: impl FnMut(I::Item) -> O) { const { O::EACH }; self.scan(to.place(), f) }
    /// As [`Over::unzip_into`].
    #[track_caller]
    fn unzip_into[R, O](self, to: impl Sinks<R, O, S>, f: impl FnMut(I::Item) -> O) { to.unzip_from(self, f) }
    /// As [`Over::filter_map_into`].
    #[doc(alias("filter_into", "retain"))]
    #[track_caller]
    fn filter_map_into[R, O](self, to: impl Sinks<R, O, S>, f: impl Fn(I::Item) -> (M<T, W, S>, O)) -> usize { to.filter_from(self, f) }
    }

    #[op]
    fn fold_by_two<A: Copy>(self, init: A, step: impl Fn(A, I::Item) -> A, join: impl Fn(A, A) -> A) -> A {
        let (n, mut a, mut b, mut at) = (Self::N, init, init, 0);
        while self.has(at, 2 * n) {
            let two = Self { items: self.items.items_at(at, 2 * n), ..self };
            (a, b, at) = (step(a, two.at(0)), step(b, two.at(n)), at + 2 * n);
        }
        if self.has(at, n) {
            (a, at) = (step(a, self.at(at)), at + n);
        }
        if at < self.len() {
            b = step(b, self.rest(at));
        }
        join(a, b)
    }
    /// Whether a map takes two steps in a round. LLVM doesn't unroll for Arm. It was slower where records are stored.
    /// The tail reads again, so not where that can have been written.
    const fn in_pairs<R: Lane, O: Mapped<R, S>, P: Place<R>>() -> bool {
        S::A64
            && W::BYTES <= 16
            && O::EACH == 1
            && O::Of::BYTES <= 16
            && size_of::<I::Item>() <= 64
            && (I::PLAIN || !P::SHARED)
    }
    /// Whether it stores the results of the round before, which are ready to be shuffled. That takes 32 registers.
    /// These are the records for which it gained more than the copies of registers cost.
    const fn stores_late<R: Lane, O: Mapped<R, S>>() -> bool {
        (S::AVX512F && S::REGISTERS == 32 && size_of::<R>() >= 4 || S::A64 && size_of::<R>() == 4 && O::EACH % 2 == 1)
            && O::Of::BYTES <= S::REGISTER
            && 4 < O::EACH
            && O::EACH <= 12
    }
    #[inline(always)]
    pub(crate) fn behind(self, to: usize) -> usize {
        self.items.behind(to)
    }
    #[op]
    fn map<R: Lane, O: Mapped<R, S>, P: Place<R>>(self, mut to: P, f: impl Fn(I::Item) -> O) {
        let (n, len, mut at) = (Self::N, self.len(), 0);
        if const { P::STREAMS && O::EACH == 1 } && self.s.fixed::<R, O::Of>().streams(len) {
            return live!(P::STREAMS && O::EACH == 1 && Tag::<S, R, O::Of>::STREAMS, {
                let d = self.s.fixed::<R, O::Of>();
                let last = d.odd_end(f(self.at(len - n)).first_vector(), len);
                let gap = self.behind(to.address().unwrap_or(0));
                d.stream_in_order(
                    to,
                    (len / n, gap),
                    (),
                    #[inline(always)]
                    |_, k| f(self.at(k * n)).first_vector(),
                    #[inline(always)]
                    |_| last,
                )
            });
        }
        let m = n * O::EACH;
        let put = always!(|to: &mut P, at: usize| {
            crate::window::check(to.len(), at * O::EACH, m);
            f(self.at(at)).write_whole(to.again().skip(at * O::EACH).slice(0..m))
        });
        if const { Self::in_pairs::<R, O, P>() } && len >= n {
            return live!(Self::in_pairs::<R, O, P>(), {
                while self.has(at, 2 * n) {
                    let two = self.window(at, 2 * n);
                    let (a, b) = (f(two.at(0)), f(two.at(n)));
                    crate::window::check(to.len(), at * O::EACH, 2 * m);
                    let mut two = to.again().skip(at * O::EACH).slice(0..2 * m);
                    a.write_whole(two.again().slice(0..m));
                    b.write_whole(two.skip(m));
                    at += 2 * n;
                }
                while at < len {
                    crate::not_unrolled();
                    at = at.min(len - n);
                    put(&mut to, at);
                    at += n;
                }
            });
        }
        if const { Self::stores_late::<R, O>() } && len >= n {
            return live!(Self::stores_late::<R, O>(), {
                let write = always!(|to: &mut P, at: usize, values: O| {
                    crate::window::check(to.len(), at * O::EACH, m);
                    values.write_whole(to.again().skip(at * O::EACH).slice(0..m))
                });
                let mut values = f(self.at(0));
                while self.has(at, 2 * n) {
                    let next = f(self.at(at + n));
                    write(&mut to, at, values);
                    (at, values) = (at + n, next);
                }
                if len - at == n {
                    return write(&mut to, at, values);
                }
                // All is read before it is written.
                if const { I::HALVES && O::Of::BYTES >= 32 } && len - at - n <= n / 2 {
                    return live!(I::HALVES && O::Of::BYTES >= 32, {
                        let half = f(self.items.items_at(len - n / 2, n / 2).load_half(self.s));
                        write(&mut to, at, values);
                        half.write_half(to.skip((len - n / 2) * O::EACH).slice(0..m / 2))
                    });
                }
                let last = f(self.at(len - n));
                write(&mut to, at, values);
                write(&mut to, len - n, last)
            });
        }
        return_if!(S::AVX2 && O::Of::BYTES >= 32 && O::EACH == 1 && !I::HALVES && (I::PLAIN || !P::SHARED), {
            if len < n {
                return if len > 0 {
                    f(self.rest(0)).write_rest(to)
                };
            }
            // A store across a cache line takes twice as long.
            if len >= 32 * n
                && let Some(start) = to.address()
            {
                core::hint::cold_path();
                let largest_group = 1usize << (len | (16 / I::NARROWEST.min(size_of::<R>()))).trailing_zeros();
                at = (n - start / size_of::<R>() % n) & largest_group.wrapping_neg();
                put(&mut to, 0);
            }
            while at < len - n {
                put(&mut to, at);
                at += n;
            }
            put(&mut to, len - n)
        });
        // It can be the same memory, so what is written twice has to be read first.
        let twice = const { !I::PLAIN && P::SHARED } && (len > n) & (len % n != 0);
        let last = if twice { Some(f(self.at(len - n))) } else { None };
        while self.has(at, n) {
            put(&mut to, at);
            at += n;
        }
        if let Some(last) = last {
            return last.write_whole(to.skip((len - n) * O::EACH).slice(0..m));
        }
        if at == len {
            return;
        }
        if const { (I::PLAIN || !P::SHARED) && I::HALVES && O::Of::BYTES >= 32 }
            && len >= n / 2
            && (len < n || len - at <= n / 2)
        {
            return live!(I::HALVES && O::Of::BYTES >= 32, {
                while at < len {
                    crate::not_unrolled();
                    at = at.min(len - n / 2);
                    f(self.items.items_at(at, n / 2).load_half(self.s))
                        .write_half(to.again().skip(at * O::EACH).slice(0..m / 2));
                    at += n / 2;
                }
            });
        }
        if const { I::PLAIN || !P::SHARED } && len >= n {
            return put(&mut to, len - n);
        }
        f(self.rest(at)).write_rest(to.skip(at * O::EACH))
    }
    /// Writes the results for the items `at..len`, which come after those in `before`. What is shared can have changed since.
    #[op]
    fn end<R: Lane, O: Mapped<R, S>, P: Place<R>>(before: Option<O>, rest: O, to: P, len: usize, at: usize) {
        let (n, m) = (Self::N, O::LANES * O::EACH);
        if const { Tag::<S, R, O::Of>::SLIDES && O::LANES == Self::N && !P::SHARED }
            && let Some(before) = before
        {
            return live!(Tag::<S, R, O::Of>::SLIDES && O::LANES == Self::N, {
                crate::window::check(to.len(), (len - n) * O::EACH, m);
                before.end_with(rest, len - at).write_whole(to.skip((len - n) * O::EACH).slice(0..m))
            });
        }
        rest.write_rest(to.skip(at / n * m))
    }
    #[op]
    fn room<R: Lane, O: Mapped<R, S>>(self) -> usize {
        let (n, m, len) = (Self::N, O::LANES * O::EACH, self.len());
        if m % n == 0 {
            len.saturating_mul(m / n)
        } else if n % m == 0 {
            len.div_ceil(n / m)
        } else {
            (len / n).saturating_mul(m).saturating_add((len % n * m).div_ceil(n))
        }
    }
    #[op]
    #[track_caller]
    fn scan<R: Lane, O: Mapped<R, S>, F: FnMut(I::Item) -> O, P: Place<R>>(self, to: P, f: F) {
        inlined_mut!(self.s, f: F, (a));
        let (n, m, len) = (Self::N, O::LANES * O::EACH, self.len());
        let (mut to, mut at, mut here, mut before) = (to.slice(0..self.room::<R, O>()), 0, 0, None);
        if const { P::STREAMS && O::EACH == 1 } && self.s.fixed::<R, O::Of>().streams(to.len()) {
            return live!(P::STREAMS && O::EACH == 1 && Tag::<S, R, O::Of>::STREAMS, {
                let gap = self.behind(to.address().unwrap_or(0));
                self.s.fixed::<R, O::Of>().stream_in_order(
                    to,
                    (len / n, gap),
                    f,
                    #[inline(always)]
                    |f, k| f(self.at(k * n)).first_vector(),
                    #[inline(always)]
                    |f| f(self.rest(len / n * n)).first_vector(),
                )
            });
        }
        while const { Self::in_pairs::<R, O, P>() } && self.has(at, 2 * n) {
            crate::window::check(to.len(), here, 2 * m);
            let (two, mut to) = (self.window(at, 2 * n), to.again().skip(here).slice(0..2 * m));
            for i in 0..2 {
                before.insert(f(two.at(i * n))).write_whole(to.again().skip(i * m).slice(0..m));
            }
            (at, here) = (at + 2 * n, here + 2 * m);
        }
        while self.has(at, n) {
            crate::window::check(to.len(), here, m);
            let values = f(self.at(at));
            values.write_whole(to.again().skip(here).slice(0..m));
            (at, here, before) = (at + n, here + m, Some(values));
            if const { Self::in_pairs::<R, O, P>() } {
                break;
            }
        }
        if at < len {
            Self::end(before, f(self.rest(at)), to, len, at)
        }
    }
    #[op]
    fn tally<const K: usize>(mut self, matches: impl Fn(I::Item) -> [M<T, W, S>; K]) -> [usize; K] {
        let (d, n, len) = (self.d(), Self::N, self.len());
        let counted = always!(|it: I::Item, counts: M<T, W, S>| {
            array::map(
                matches(it),
                #[inline(always)]
                |m| (m & counts).count(),
            )
        });
        if len < n {
            return counted(self.rest(0), d.first_n(len));
        }
        let (odd, mut first) = (self.odd::<false>(), [0; K]);
        if odd != 0 {
            (first, self) = (counted(self.at(0), d.all_but_last(odd)), self.window(n - odd, len - (n - odd)));
        }
        let len = self.len();
        let last = counted(self.at(len - n), !d.all_but_last(len % n));
        let (mut all, mut at) = (array::from_fn(always!(|k| first[k] + last[k])), 0);
        // The masks of AVX-512 are counted as fast as they are added, if they have many lanes or there are few.
        if const { W::BYTES < 8 || S::REGISTER == 64 && (size_of::<T>() <= 2 || K < 2) } || len < 4 * n {
            let add = always!(|all: [usize; K], it: I::Item| {
                let masks = matches(it);
                array::from_fn(
                    #[inline(always)]
                    |k| all[k] + masks[k].count(),
                )
            });
            while self.has(at, n) {
                (all, at) = (add(all, self.at(at)), at + n);
            }
            return all;
        }
        let (zero, mut sums) = (d.to_unsigned().zero(), [d.repartition::<u64>().zero(); K]);
        while self.has(at, n) {
            let group = Self {
                items: self
                    .items
                    // For speed: two steps leave no check.
                    .items_at(at, len - at)
                    .items_at(0, (len - at).min(if const { size_of::<T>() == 1 } { 255 } else { 65535 } * n)),
                ..self
            };
            let (mut counts, mut here) = ([zero; K], 0);
            while const { Tag::<S, T, W>::ROLLED && K <= 4 } && len >= 16 * n && group.has(here, 4 * n) {
                let four = group.window(here, 4 * n);
                let m = [matches(four.at(0)), matches(four.at(n)), matches(four.at(2 * n)), matches(four.at(3 * n))];
                counts = array::from_fn(
                    #[inline(always)]
                    |k| {
                        counts[k]
                            - (m[0][k].to_vector() + m[1][k].to_vector() + (m[2][k].to_vector() + m[3][k].to_vector()))
                                .barrier()
                                .bitcast()
                    },
                );
                here += 4 * n;
            }
            while group.has(here, n) {
                let masks = matches(group.at(here));
                counts = array::from_fn(
                    #[inline(always)]
                    |k| counts[k] - masks[k].to_vector().bitcast(),
                );
                here += n;
            }
            at += here;
            sums = array::from_fn(
                #[inline(always)]
                |k| {
                    sums[k]
                        + choose! {
                            size_of::<T>() == 1 => counts[k].bitcast::<u8>().sums_of_8(),
                            size_of::<T>() == 2 => counts[k].bitcast::<u16>().sums_of_2().sums_of_2(),
                            size_of::<T>() == 4 => counts[k].bitcast::<u32>().sums_of_2(),
                            _ => counts[k].bitcast(),
                        }
                },
            );
        }
        array::from_fn(
            #[inline(always)]
            |k| all[k] + sums[k].reduce_sum() as usize,
        )
    }
}

struct Exact<T: Lane, W: Width, S: Isa, I> {
    all: Columns<T, W, S, I>,
    at: usize,
}
struct Padded<T: Lane, W: Width, S: Isa, I> {
    all: Columns<T, W, S, I>,
    at: usize,
}
struct Positions<T: Lane, W: Width, S: Isa, I, F> {
    all: Columns<T, W, S, I>,
    matches: F,
    first: usize,
    bits: u64,
}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Iterator for Exact<T, W, S, I> {
    type Item = I::Item;
    #[op]
    fn next(&mut self) -> Option<I::Item> {
        let (n, at) = (V::<T, W, S>::LANES, self.at);
        if !self.all.has(at, n) {
            return None;
        }
        self.at += n;
        Some(self.all.at(at))
    }
    #[op]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = (self.all.len() - self.at) / V::<T, W, S>::LANES;
        (n, Some(n))
    }
}
impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> ExactSizeIterator for Exact<T, W, S, I> {}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Iterator for Padded<T, W, S, I> {
    type Item = (I::Item, u64);
    #[op]
    fn next(&mut self) -> Option<Self::Item> {
        let (n, at, len) = (V::<T, W, S>::LANES, self.at, self.all.len());
        if self.all.has(at, n) {
            self.at += n;
            return Some((self.all.at(at), !0 >> (64 - n)));
        }
        core::hint::cold_path();
        if at >= len {
            return None;
        }
        self.at = len;
        let all = self.all;
        Some(crate::gate::Enter::only_call(
            all.s,
            #[inline(always)]
            || (all.rest(at), crate::tag::fewer_bits(all.s, len - at)),
        ))
    }
    #[op]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = (self.all.len() - self.at).div_ceil(V::<T, W, S>::LANES);
        (n, Some(n))
    }
}
impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> ExactSizeIterator for Padded<T, W, S, I> {}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>, F: Fn(I::Item) -> M<T, W, S>> Iterator for Positions<T, W, S, I, F> {
    type Item = usize;
    #[op]
    fn next(&mut self) -> Option<usize> {
        let mut empty = 0usize;
        while self.bits == 0 {
            let (mut at, all, matches) = (self.first.wrapping_add(64), self.all, &self.matches);
            // As for one slice.
            empty += 1;
            if const { Tag::<S, T, W>::BITS_AT_ONCE } && empty == 3 {
                let skip = always!(|| {
                    let mut at = at;
                    while all.has(at, 64)
                        && let four = all.window(at, 64)
                        && (matches(four.at(0)) | matches(four.at(16)))
                            .neither(matches(four.at(32)) | matches(four.at(48)))
                    {
                        at += 64;
                    }
                    at
                });
                at = crate::gate::Enter::only_call(all.s, skip);
            }
            // Calls, if `sum` or another function of `core` around this is not inlined.
            self.bits = if all.has(at, 64) {
                crate::gate::Enter::only_call(
                    all.s,
                    #[inline(always)]
                    || all.block(at, matches),
                )
            } else if at < all.len() {
                crate::gate::Enter::only_call(
                    all.s,
                    #[inline(always)]
                    || all.last_block(at, matches),
                )
            } else {
                return None;
            };
            self.first = at;
        }
        let at = self.first.wrapping_add(self.bits.trailing_zeros() as usize);
        self.bits &= self.bits - 1;
        Some(at)
    }
}

impl<'a, T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'a, T, W, S, E> {
    methods! {
        /// Each value with the `K - 1` after it, as in `slice::windows`: the vectors at the offsets `0..K`. The last `K - 1` values start no window.
        /// With 64 bytes, nearly all of these loads cross a cache line: `Upto<B32, S>` or `shift_elements_right` can be faster.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let mut sums = [0; 3];
        /// over(&[1, 2, 3, 4, 5]).windows().map_into(&mut sums, |[a, b, c]| a + b + c);
        /// assert_eq!(sums, [6, 9, 12]);
        /// # } example()
        /// ```
        #[doc(alias("array_windows", "sliding", "stencil", "neighbors", "lookahead", "memmem", "prev", "previous"))]
        fn windows[const K: usize](self) -> Columns<T, W, S, [&'a [E]; K]> {
            const { crate::make::Fits::<K>::SLICES };
            let (s, values) = self.parts();
            let items = match values.len().checked_sub(K.saturating_sub(1)) {
                Some(len) => array::from_fn(#[inline(always)] |k| &values[k..][..len]),
                None => [&values[..0]; K],
            };
            Columns { s, items, of: PhantomData }
        }
        /// Records of 1 to 16 values, such as pixels, points or small matrices, with a vector for each field: a loop of [`load_interleaved`](Simd::load_interleaved).
        /// What is too little for a record at the end is left out. `as_flattened` makes such a slice of `&[[T; K]]`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let points = [[3.0, 4.0], [6.0, 8.0], [0.0, 1.0]];
        /// assert_eq!(over(points.as_flattened()).interleaved().count(|[x, y]| (x * x + y * y).simd_gt(4.0)), 2);
        /// # } example()
        /// ```
        #[doc(alias("deinterleave", "array_chunks", "as_chunks", "groups", "records", "channels", "AoS"))]
        fn interleaved[const K: usize](self) -> Columns<T, W, S, &'a [[E; K]]> {
            const { crate::make::Fits::<K>::RECORDS };
            let (s, values) = self.parts();
            Columns { s, items: values.as_chunks().0, of: PhantomData }
        }
        /// [`map_into`](Self::map_into) in order: `f` sees each value once and in its place, so it can have state. Lane `i` of call `k` is the value at
        /// `k * LANES + i`, and the last vector is padded with zeros. `f` returns a vector or an array of them, which are interleaved. If that has more or
        /// fewer lanes, then more or less is written in proportion, rounded up. Panics if `to` is too short.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let (mut copy, mut sum) = ([0; 70], u64xN::zero());
        /// over(&[3u8; 70]).scan_into(&mut copy, |v| {
        ///     sum += v.sum_groups();
        ///     v
        /// });
        /// assert_eq!((copy, sum.reduce_sum()), ([3; 70], 210));
        /// # } example()
        /// ```
        #[doc(alias("map_in_order", "map_fold", "map_indexed", "stateful", "carry", "inspect", "enumerate"))]
        #[track_caller]
        fn scan_into[R: Lane, O: Mapped<R, S>](self, to: &mut (impl Sink<R> + ?Sized), f: impl FnMut(V<T, W, S>) -> O) { const { O::EACH }; Columns::new(self.parts().0, self).scan(to.place(), f) }
        /// [`scan_into`](Self::scan_into) with several outputs: a tuple, or an array if they have one type. `f` returns the same.
        /// They can be what is read, if what is written at an index is not read at a later one: see [`as_cells`](crate::mem::as_cells).
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let (mut low, mut float) = ([0; 3], [0.0; 3]);
        /// over(&[1u32, 2, 259]).unzip_into((&mut low, &mut float), |v| (v.cast::<u8>(), v.cast::<f32>()));
        /// assert_eq!((low, float), ([1, 2, 3], [1.0, 2.0, 259.0]));
        /// let [mut r, mut g, mut b] = [[0; 2]; 3];
        /// over(b"RGBrgb").interleaved().unzip_into([&mut r, &mut g, &mut b], |rgb| rgb);
        /// assert_eq!([&r, &g, &b], [b"Rr", b"Gg", b"Bb"]);
        /// # } example()
        /// ```
        #[doc(alias("unzip", "planes", "planar", "outputs", "multiple_outputs", "map_into2"))]
        #[track_caller]
        fn unzip_into[R, O](self, to: impl Sinks<R, O, S>, f: impl FnMut(V<T, W, S>) -> O) { to.unzip_from(Columns::new(self.parts().0, self), f) }
        /// The loops that follow fill the last vector with `value`, and not with zeros.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let all = over(&[0b110u8, 0b011]).pad(!0).fold(u8xN::splat(!0), |all, v| all & v, |a, b| a & b);
        /// assert_eq!(all.reduce_and(), 0b010);
        /// let (mut digits, mut most) = ([0; 3], u8xN::zero());
        /// over(b"204").pad(b'0').scan_into(&mut digits, |v| {
        ///     most = most.simd_max(v - b'0');
        ///     v - b'0'
        /// });
        /// assert_eq!((digits, most.reduce_max()), ([2, 0, 4], 4));
        /// # } example()
        /// ```
        #[doc(alias("padding", "fold_padded", "pad_with", "neutral"))]
        fn pad(self, value: T) -> Columns<T, W, S, Pad<Self, T>> { Columns::new(self.parts().0, self).pad(value) }
        /// [`filter_into`](Self::filter_into) for what `f` computes. It returns a mask, and a vector for each output, as in [`unzip_into`](Self::unzip_into).
        /// The vectors have as many lanes as the mask. What is after the kept values can change. An output can be one of the slices that are read, as cells, from the same start.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let (mut ids, mut halves) = ([0; 3], [0.0; 3]);
        /// let both = over(&[1.0f32, -2.0, 3.0]).zip(&[7u32, 8, 9]);
        /// let n = both.filter_map_into((&mut ids, &mut halves), |(x, id)| (x.simd_gt(0.0), (id, x * 0.5)));
        /// assert_eq!((&ids[..n], &halves[..n]), (&[7, 9][..], &[0.5, 1.5][..]));
        /// assert_eq!(both.filter_map_into(&mut ids, |(x, id)| (x.simd_lt(0.0), id)), 1);
        /// # } example()
        /// ```
        #[doc(alias("filter_map", "compact", "retain_all", "select_rows", "where"))]
        #[track_caller]
        fn filter_map_into[R, O](self, to: impl Sinks<R, O, S>, f: impl Fn(V<T, W, S>) -> (M<T, W, S>, O)) -> usize { to.filter_from(Columns::new(self.parts().0, self), f) }
        /// Several [`count`](Self::count)s in one pass.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(over(b"a b\nc\n").counts(|v| [v.simd_eq(b' '), v.simd_eq(b'\n')]), [1, 2]);
        /// # } example()
        /// ```
        #[doc(alias("counter", "histogram", "tally"))]
        fn counts[const K: usize](self, matches: impl Fn(V<T, W, S>) -> [M<T, W, S>; K]) -> [usize; K] { Columns::new(self.parts().0, self).counts(matches) }
        /// [`bitmask`](Self::bitmask) for any length: a word for each 64 values, to the start of `to`. Panics if that is too short.
        /// The lanes of a value are as for [`map_into`](Self::map_into).
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let mut bits = [0; 2];
        /// over(&[7; 66]).bitmask_into(&mut bits, |v| v.simd_gt(0));
        /// assert_eq!(bits, [!0, 0b11]);
        /// # } example()
        /// ```
        #[doc(alias("bitmap", "bitset", "validity"))]
        #[track_caller]
        fn bitmask_into(self, to: &mut (impl Sink<u64> + ?Sized), matches: impl Fn(V<T, W, S>) -> M<T, W, S>) { Columns::new(self.parts().0, self).bitmask_into(to, matches) }
    }
}

impl<'a, T: Lane, W: Width, U: Lane, X: Width, S: Isa, E, F> Zip<'a, T, W, U, X, S, E, F> {
    #[op]
    pub(crate) fn parts(self) -> (Tag<S, T, W>, &'a [E], &'a [F]) {
        (Tag::new(self.s), self.items.0.parts().1, self.items.1.parts().1)
    }
}
