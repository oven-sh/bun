//! Arguments whose length can be a part of the type.

use crate::{Aligned, Isa, Lane, Readable, Simd, Sink, Tag, Width, Writable};

/// What has to be long enough, as for loads of whole vectors: a slice, an array, a `Vec`, or these in a reference, `Box`, `Rc`, `Arc`, `Cow`, `Ref`, `RefMut` or [`Aligned`]. An array that is too short is an error of `cargo build`.
///
/// `&x[..]` makes a slice of other types, and of an array whose length is tested at run time.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not a slice or an array",
    note = "`&x[..]` makes a slice, `as_bytes()` that of a string, and `filled()` that of an `Output`"
)]
pub trait Slice: crate::seals::Slice {
    /// What it is made of.
    type Item;
    #[doc(hidden)]
    const MOST: usize = usize::MAX;
    #[doc(hidden)]
    fn all(this: &Self) -> &[Self::Item];
    // For speed, slices don't go through `all` here.
    #[doc(hidden)]
    #[inline(always)]
    #[track_caller]
    fn read_first<T: Lane, W: Width, S: Isa>(this: &Self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        Self::Item: Readable<T>,
    {
        Slice::read_first(has::<Vectors<T, W>, _>(this), d)
    }
    #[doc(hidden)]
    #[inline(always)]
    #[track_caller]
    fn read_last<T: Lane, W: Width, S: Isa>(this: &Self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        Self::Item: Readable<T>,
    {
        Slice::read_last(has::<Vectors<T, W>, _>(this), d)
    }
}
/// The same, for stores.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not a slice or an array that can be changed",
    note = "`&mut x[..]` makes a slice. An `Output` has `push`, `push_at` and `push_array`, and cells take `store_at(&mut &cells[..], at)`"
)]
pub trait SliceMut: Slice {
    #[doc(hidden)]
    fn all_mut(this: &mut Self) -> &mut [Self::Item];
    #[doc(hidden)]
    #[inline(always)]
    #[track_caller]
    fn write_first<T: Lane, W: Width, S: Isa>(this: &mut Self, v: Simd<T, W, S>)
    where
        Self::Item: Writable<T>,
    {
        v.store_whole(has_room::<Vectors<T, W>, _>(this))
    }
    #[doc(hidden)]
    #[inline(always)]
    #[track_caller]
    fn write_last<T: Lane, W: Width, S: Isa>(this: &mut Self, v: Simd<T, W, S>)
    where
        Self::Item: Writable<T>,
    {
        v.store_end(has_room::<Vectors<T, W>, _>(this))
    }
}
#[sealed]
impl<E> Slice for [E] {
    type Item = E;
    #[inline(always)]
    fn all(this: &Self) -> &[E] {
        this
    }
    #[inline(always)]
    #[track_caller]
    fn read_first<T: Lane, W: Width, S: Isa>(this: &Self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        E: Readable<T>,
    {
        d.load_any(this)
    }
    #[inline(always)]
    #[track_caller]
    fn read_last<T: Lane, W: Width, S: Isa>(this: &Self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        E: Readable<T>,
    {
        d.load_any(&this[this.len() - d.lanes()..])
    }
}
impl<E> SliceMut for [E] {
    #[inline(always)]
    fn all_mut(this: &mut Self) -> &mut [E] {
        this
    }
    #[inline(always)]
    #[track_caller]
    fn write_first<T: Lane, W: Width, S: Isa>(this: &mut Self, v: Simd<T, W, S>)
    where
        E: Writable<T>,
    {
        v.store_whole(this)
    }
    #[inline(always)]
    #[track_caller]
    fn write_last<T: Lane, W: Width, S: Isa>(this: &mut Self, v: Simd<T, W, S>)
    where
        E: Writable<T>,
    {
        v.store_end(this)
    }
}
#[sealed]
impl<E, const N: usize> Slice for [E; N] {
    type Item = E;
    const MOST: usize = N;
    #[inline(always)]
    fn all(this: &Self) -> &[E] {
        this
    }
}
impl<E, const N: usize> SliceMut for [E; N] {
    #[inline(always)]
    fn all_mut(this: &mut Self) -> &mut [E] {
        this
    }
}
macro_rules! through { ($($(#[$m:meta])* [$($g:tt)*] $outer:ty, $inner:ty;)*) => {$(
    $(#[$m])*
    #[sealed]
    impl<$($g)*> Slice for $outer where $inner: Slice {
        type Item = <$inner as Slice>::Item;
        const MOST: usize = <$inner as Slice>::MOST;
        #[inline(always)]
        fn all(this: &Self) -> &[Self::Item] { <$inner as Slice>::all(this) }
    }
)*}; }
macro_rules! through_mut { ($($(#[$m:meta])* [$($g:tt)*] $outer:ty, $inner:ty;)*) => {$(
    through! { $(#[$m])* [$($g)*] $outer, $inner; }
    $(#[$m])*
    impl<$($g)*> SliceMut for $outer where $inner: SliceMut {
        #[inline(always)]
        fn all_mut(this: &mut Self) -> &mut [Self::Item] { <$inner as SliceMut>::all_mut(this) }
    }
)*}; }
through! {
    [X: ?Sized] &X, X;
    [X: ?Sized] core::cell::Ref<'_, X>, X;
    #[cfg(feature = "alloc")] [X: ?Sized] alloc::rc::Rc<X>, X;
    #[cfg(all(feature = "alloc", target_has_atomic = "ptr"))] [X: ?Sized] alloc::sync::Arc<X>, X;
    #[cfg(feature = "alloc")] [X: alloc::borrow::ToOwned + ?Sized] alloc::borrow::Cow<'_, X>, X;
}
through_mut! {
    [X: ?Sized] &mut X, X;
    [X: ?Sized] core::cell::RefMut<'_, X>, X;
    [A] Aligned<A>, A;
    #[cfg(feature = "alloc")] [E] alloc::vec::Vec<E>, [E];
    #[cfg(feature = "alloc")] [X: ?Sized] alloc::boxed::Box<X>, X;
}

/// How many values an access takes.
pub(crate) trait Takes {
    const VALUES: usize;
}
macro_rules! takes { ($($name:ident = $n:expr;)*) => {$(
    pub(crate) struct $name<T, W, const K: usize = 1>(T, W);
    impl<T: Lane, W: Width, const K: usize> Takes for $name<T, W, K> { const VALUES: usize = K * $n; }
)*}; }
takes! {
    Vectors = W::BYTES / size_of::<T>();
    Bytes = W::BYTES;
    Block = 16 / size_of::<T>();
    ThreeOfFour = W::BYTES / size_of::<T>() / 4 * 3;
    Bits = (W::BYTES / size_of::<T>()).div_ceil(8);
    Values = 1;
    BytesOfLane = size_of::<T>();
}
#[inline(always)]
#[track_caller]
pub(crate) fn has<N: Takes, A: Slice + ?Sized>(from: &A) -> &[A::Item] {
    require!(of(N, &A), "the array is too short", A::MOST >= N::VALUES);
    A::all(from)
}
#[inline(always)]
#[track_caller]
pub(crate) fn has_room<N: Takes, A: SliceMut + ?Sized>(to: &mut A) -> &mut [A::Item] {
    require!(of(N, &A), "the array is too short", A::MOST >= N::VALUES);
    A::all_mut(to)
}
#[inline(always)]
#[track_caller]
pub(crate) fn takes<T: Lane, N: Takes, A: Sink<T> + ?Sized>(to: &mut A) -> &mut A {
    require!(of(N, &A), "the array is too short", A::MOST >= N::VALUES);
    to
}
