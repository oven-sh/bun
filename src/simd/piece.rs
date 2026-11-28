//! What can be pushed to an output.

use crate::low_bytes::bits;
use crate::text::Ascii;
use crate::{Isa, Keep, Lane, MoreBytes, Output, Simd, Unsigned, Width};
use core::mem::MaybeUninit;

/// What [`Output::push`] and [`Output::try_push`] take. These need room only for the values that are added.
///
/// - A [`Lane`], an [`Ascii`], a vector, a slice, or a reference to an array.
/// - A part: [`first_n`](Simd::first_n), [`selected`](Simd::selected), [`low_bytes`](Simd::low_bytes). For a `String`, [`ascii`](Simd::ascii).
/// - A tuple of two to six or an array of these, which takes one check for all, unless it has a slice.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (v, mut all) = (u8x16::load_or_default(b"a b"), Vec::new());
/// Output::append(&mut all, 9).push((b'[', v.first_n(3), b", ", v.selected(v.simd_gt(b' ')), b']'));
/// assert_eq!(all, b"[a b, ab]");
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "`{Self}` can't be pushed to an `Output` of `{T}`",
    note = "it takes a lane, a vector, `&x[..]`, `v.first_n(n)`, `v.selected(mask)`, or an array or a tuple of up to six of these",
    note = "`push_one` takes one value of any type"
)]
pub trait Piece<T: Copy>: Put<Item = T> {
    /// The first `n` values, or all if there are fewer.
    #[op]
    #[track_caller]
    fn first_n(self, n: usize) -> FirstN<Self> {
        require!(
            "`first_n` takes a slice that is alone, or up to 512 values of up to 8 bytes",
            Self::IN_MEMORY || Self::SMALL
        );
        FirstN(self, n)
    }
}

#[diagnostic::do_not_recommend]
impl<T: Copy, P: Put<Item = T>> Piece<T> for P {}

/// Only this file has one.
pub struct Here(());

/// Not nameable outside of this crate.
#[diagnostic::on_unimplemented(
    message = "`{Self}` can't be pushed to an `Output`",
    note = "it takes a lane, a vector, `&x[..]`, `v.first_n(n)`, `v.selected(mask)`, or an array or a tuple of up to six of these",
    note = "`push_one` takes one value of any type"
)]
pub trait Put: Copy {
    type Item: Copy;
    /// No more values are written.
    const MOST: usize;
    /// All that is written counts.
    const EXACT: bool;
    const IN_MEMORY: bool = false;
    /// It fits on the stack.
    const SMALL: bool = Self::MOST <= STAGE && size_of::<Self::Item>() <= 8;
    /// Panics unless there is room for all that is written.
    #[track_caller]
    fn put(self, to: &mut Output<'_, Self::Item>, _: Here);
    /// The same, with one check.
    #[inline(always)]
    #[track_caller]
    fn put_at_once(self, to: &mut Output<'_, Self::Item>, _: Here) {
        self.put(to, Here(()))
    }
    #[inline(always)]
    fn try_put(self, to: &mut Output<'_, Self::Item>, _: Here) -> Option<()> {
        at_once(self, to)
    }
    #[op]
    #[track_caller]
    fn put_first_n(self, n: usize, to: &mut Output<'_, Self::Item>, _: Here) {
        let mut to = to.window(Self::MOST);
        self.put(&mut to, Here(()));
        to.truncate(n);
    }
    #[op]
    fn try_put_first_n(self, n: usize, to: &mut Output<'_, Self::Item>, _: Here) -> Option<()> {
        at_once(FirstN(self, n), to)
    }
    #[op]
    #[track_caller]
    fn put_all<const N: usize>(all: [Self; N], to: &mut Output<'_, Self::Item>, _: Here) {
        unrolled!(8 theirs, for i in 0..const N { all[i].put(to, Here(())) });
    }
}

const STAGE: usize = 512;

/// The comparison of `far` once more: LLVM joins both, and learns here which way is cold.
#[op]
fn is_far<T: Copy>(to: &Output<'_, T>, n: usize) -> bool {
    n == 0 || to.len() < to.capacity().saturating_sub(n - 1)
}

#[op]
fn at_once<P: Put>(piece: P, to: &mut Output<'_, P::Item>) -> Option<()> {
    if is_far(to, P::MOST)
        && let Some(mut to) = to.far(P::MOST)
    {
        piece.put(&mut to, Here(()));
        return Some(());
    }
    core::hint::cold_path();
    choose! {
        P::EXACT => None,
        P::MOST <= 16 => staged::<P, 16>(piece, to),
        P::MOST <= 64 => staged::<P, 64>(piece, to),
        _ => staged::<P, STAGE>(piece, to),
    }
}

#[op]
fn staged<P: Put, const N: usize>(piece: P, to: &mut Output<'_, P::Item>) -> Option<()> {
    let mut stage = [MaybeUninit::uninit(); N];
    let mut staged = Output::new(&mut stage[..P::MOST]);
    piece.put(&mut staged, Here(()));
    to.few(staged.into_filled())
}

impl<T: Copy> Output<'_, T> {
    /// Adds a [`Piece`]. Panics if that doesn't fit, and adds nothing then. It is fastest with room for whole vectors.
    #[doc(alias("extend_from_slice", "append", "write", "put"))]
    #[op]
    #[track_caller]
    pub fn push</* String: v.ascii() */ P: Piece<T>>(&mut self, piece: P) {
        if const { P::EXACT && (P::IN_MEMORY || P::MOST != usize::MAX) } {
            return piece.put_at_once(self, Here(()));
        }
        piece.try_put(self, Here(())).expect("the `Output` is full")
    }
    /// As `push`, without the code for the end: it panics unless there is room for all lanes of all parts. That can depend on the target.
    /// It is for tuned loops, and for small code. It gains nothing on a [`Room`](crate::mem::Room), which loses its count.
    #[op]
    #[track_caller]
    pub fn push_with_slack<P: Piece<T>>(&mut self, piece: P) {
        if const { P::MOST == usize::MAX } {
            return self.push(piece);
        }
        piece.put_at_once(self, Here(()))
    }
    /// As `push`, or nothing if it doesn't fit.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut room = [0; 3];
    /// let mut out = Output::overwrite(&mut room);
    /// assert_eq!(out.try_push(u8x16::iota(1).first_n(2)), Some(()));
    /// assert_eq!(out.try_push((3, 4)), None);
    /// assert_eq!(out.filled(), [1, 2]);
    /// # } example()
    /// ```
    #[doc(alias("push_within_capacity", "try_extend_from_slice"))]
    #[op]
    #[must_use = "it can be full"]
    pub fn try_push</* String: v.ascii() */ P: Piece<T>>(&mut self, piece: P) -> Option<()> {
        piece.try_put(self, Here(()))
    }
}

impl<T: Copy> crate::Room<'_, '_, T> {
    /// As [that of `Output`](Output::push).
    #[op]
    #[track_caller]
    pub fn push<P: Piece<T>>(&mut self, piece: P) {
        if const { P::MOST < u16::MAX as usize }
            && let Some(mut room) = self.take(P::MOST as u16)
        {
            return piece.put(&mut room, Here(()));
        }
        Output::push(self, piece)
    }
    /// As [that of `Output`](Output::try_push).
    #[op]
    #[must_use = "it can be full"]
    pub fn try_push<P: Piece<T>>(&mut self, piece: P) -> Option<()> {
        if const { P::MOST < u16::MAX as usize }
            && let Some(mut room) = self.take(P::MOST as u16)
        {
            piece.put(&mut room, Here(()));
            return Some(());
        }
        Output::try_push(self, piece)
    }
}

macro_rules! values { ($([$($g:tt)*] $t:ty;)*) => {$(
    impl<$($g)*> Put for $t {
        type Item = $t;
        const MOST: usize = 1;
        const EXACT: bool = true;
        #[inline(always)]
        fn put(self, to: &mut Output<'_, $t>, _: Here) {
            to.push_one(self)
        }
        #[op]
        fn put_first_n(self, n: usize, to: &mut Output<'_, $t>, _: Here) {
            to.extend_first(&[self], n)
        }
        #[inline(always)]
        fn put_all<const N: usize>(all: [$t; N], to: &mut Output<'_, $t>, _: Here) {
            to.extend_first(&all, N)
        }
    }
)*}; }
values! { [T: Lane] T; [] Ascii; }

impl<T: Copy, const N: usize> Put for &[T; N] {
    type Item = T;
    const MOST: usize = N;
    const IN_MEMORY: bool = true;
    const EXACT: bool = true;
    #[inline(always)]
    fn put(self, to: &mut Output<'_, T>, _: Here) {
        to.extend_first(self, N)
    }
    #[inline(always)]
    fn put_first_n(self, n: usize, to: &mut Output<'_, T>, _: Here) {
        to.extend_first(self, n)
    }
    #[op]
    fn try_put_first_n(self, n: usize, to: &mut Output<'_, T>, _: Here) -> Option<()> {
        choose! { Self::SMALL => at_once(FirstN(self, n), to), _ => self[..].try_put_first_n(n, to, Here(())) }
    }
}
macro_rules! slices { ($($(#[$m:meta])* $t:ty;)*) => {$(
    $(#[$m])*
    impl<T: Copy> Put for &$t {
        type Item = T;
        const MOST: usize = usize::MAX;
        const IN_MEMORY: bool = true;
        const EXACT: bool = true;
        #[op]
        fn put(self, to: &mut Output<'_, T>, _: Here) {
            to.extend_from_slice(self)
        }
        #[op]
        fn try_put(self, to: &mut Output<'_, T>, _: Here) -> Option<()> {
            if self.len() > to.room() {
                return None;
            }
            to.extend_from_slice(self);
            Some(())
        }
        #[op]
        fn try_put_first_n(self, n: usize, to: &mut Output<'_, T>, _: Here) -> Option<()> {
            self[..n.min(self.len())].try_put(to, Here(()))
        }
    }
)*}; }
slices! {
    [T];
    &[T];
    &mut [T];
    #[cfg(feature = "alloc")] alloc::vec::Vec<T>;
    #[cfg(feature = "alloc")] alloc::boxed::Box<[T]>;
}
impl<T: Lane, W: Width, S: Isa> Put for Simd<T, W, S> {
    type Item = T;
    const MOST: usize = Self::LANES;
    const EXACT: bool = true;
    #[op]
    fn put(self, to: &mut Output<'_, T>, _: Here) {
        to.push_first(self, Self::LANES)
    }
    #[inline(always)]
    fn put_first_n(self, n: usize, to: &mut Output<'_, T>, _: Here) {
        to.push_first(self, n)
    }
    #[op]
    fn try_put_first_n(self, n: usize, to: &mut Output<'_, T>, _: Here) -> Option<()> {
        // It takes less code.
        return_if!(W::BYTES > 2 * S::REGISTER, at_once(FirstN(self, n), to));
        if is_far(to, Self::LANES)
            && let Some(mut to) = to.far(Self::LANES)
        {
            to.push_first(self, n);
            return Some(());
        }
        core::hint::cold_path();
        near_the_end(self, n, to)
    }
}

#[op]
fn near_the_end<T: Lane, W: Width, S: Isa>(v: Simd<T, W, S>, n: usize, to: &mut Output<'_, T>) -> Option<()> {
    if n.min(Simd::<T, W, S>::LANES) > to.room() {
        return None;
    }
    to.window(to.room()).push_partial(v, n);
    // For speed: else LLVM makes an inner loop of the way that adds nothing, and moves work from here to the outer one.
    if const { crate::Tag::<S, T, W>::BY_BITS } {
        to.truncate(crate::regs::number(to.len() as u64) as usize);
    }
    Some(())
}

/// What tuples and arrays share. Near the end, or if there is no bound, each part has its check, unless several are cut.
macro_rules! several {
    ($T:ty, $cut:expr, |$it:ident, $to:ident| $each:expr) => {
        #[op]
        fn put_at_once(self, to: &mut Output<'_, $T>, _: Here) {
            self.put(&mut to.window(Self::MOST), Here(()))
        }
        #[op]
        fn try_put(self, $to: &mut Output<'_, $T>, _: Here) -> Option<()> {
            return_if!(Self::SMALL && $cut > 1 || Self::EXACT && Self::MOST != usize::MAX, at_once(self, $to));
            if const { Self::MOST != usize::MAX } {
                if is_far($to, Self::MOST)
                    && let Some(mut room) = $to.far(Self::MOST)
                {
                    self.put(&mut room, Here(()));
                    return Some(());
                }
                core::hint::cold_path();
            }
            let ($it, start) = (self, $to.len());
            if $each {
                return Some(());
            }
            $to.truncate(start);
            None
        }
    };
}
impl<P: Put, const N: usize> Put for [P; N] {
    type Item = P::Item;
    const MOST: usize = N.saturating_mul(P::MOST);
    const EXACT: bool = P::EXACT;
    #[op]
    fn put(self, to: &mut Output<'_, P::Item>, _: Here) {
        P::put_all(self, to, Here(()))
    }
    several!(P::Item, N, |all, to| {
        let mut i = 0;
        while i < N && all[i].try_put(to, Here(())).is_some() {
            i += 1;
        }
        i == N
    });
}
macro_rules! tuples { ($(($($p:ident $i:tt)+))*) => {$(
    impl<T: Copy, $($p: Put<Item = T>),+> Put for ($($p,)+) {
        type Item = T;
        const MOST: usize = 0usize $(.saturating_add($p::MOST))+;
        const EXACT: bool = $($p::EXACT)&&+;
        #[op]
        fn put(self, to: &mut Output<'_, T>, _: Here) {
            $(self.$i.put(to, Here(()));)+
        }
        several!(T, 0 $(+ !$p::EXACT as usize)+, |all, to| $(all.$i.try_put(to, Here(())).is_some())&&+);
    }
)*}; }
tuples!((A 0 B 1) (A 0 B 1 C 2) (A 0 B 1 C 2 D 3) (A 0 B 1 C 2 D 3 E 4) (A 0 B 1 C 2 D 3 E 4 F 5));

macro_rules! parts { ($($name:ident<$($p:ident),*>($($t:ty),*))*) => {$(
    #[doc(hidden)]
    #[derive(Clone, Copy)]
    #[must_use = "it is to be pushed to an `Output`"]
    pub struct $name<$($p),*>($($t),*);
)*}; }
parts!(FirstN<P>(P, usize) SelectedLanes<V, K>(V, K) LowBytes<V, M>(V, M, usize) AsAscii<V>(V));

impl<P: Put> Put for FirstN<P> {
    type Item = P::Item;
    const MOST: usize = P::MOST;
    const EXACT: bool = false;
    #[op]
    fn put(self, to: &mut Output<'_, P::Item>, _: Here) {
        self.0.put_first_n(self.1, to, Here(()))
    }
    #[op]
    fn try_put(self, to: &mut Output<'_, P::Item>, _: Here) -> Option<()> {
        if is_known!(self.1) && self.1 >= P::MOST {
            return self.0.try_put(to, Here(()));
        }
        self.0.try_put_first_n(self.1, to, Here(()))
    }
}
impl<T: Lane, W: Width, S: Isa, K: Keep<T, W, S>> Put for SelectedLanes<Simd<T, W, S>, K> {
    type Item = T;
    const MOST: usize = Simd::<T, W, S>::LANES;
    const EXACT: bool = false;
    #[op]
    fn put(self, to: &mut Output<'_, T>, _: Here) {
        to.push_selected(self.0, self.1)
    }
    #[op]
    fn try_put(self, to: &mut Output<'_, T>, _: Here) -> Option<()> {
        // It is compressed in one step, before the check of the room.
        if_here!(
            W::BYTES == 16 && T::BITS < 64,
            if let Some(mask) = self.1.whole() {
                let (kept, count) = self.0.compress_counted(mask, true);
                return kept.try_put_first_n(count, to, Here(()));
            }
        );
        return_if!(
            (crate::X86 || T::BITS < 64) && W::BYTES <= S::COMPRESS[size_of::<T>().trailing_zeros() as usize],
            {
                let bits = self.1.kept(self.0.tag()) & Simd::<T, W, S>::all_bits_of_lanes();
                let count = crate::ops::count_bits_on::<S>(bits, Self::MOST);
                self.0.compress_own(bits).try_put_first_n(count, to, Here(()))
            }
        );
        return_if!(W::BYTES > 2 * S::REGISTER, at_once(self, to));
        if is_far(to, Self::MOST)
            && let Some(mut to) = to.far(Self::MOST)
        {
            self.put(&mut to, Here(()));
            return Some(());
        }
        core::hint::cold_path();
        let bits = self.1.kept(self.0.tag()) & Simd::<T, W, S>::all_bits_of_lanes();
        near_the_end(self.0.compress_relaxed(self.1), crate::ops::count_bits_on::<S>(bits, Self::MOST), to)
    }
}
impl<T: Unsigned, W: Width, S: Isa, M: MoreBytes<T, W, S>> Put for LowBytes<Simd<T, W, S>, M> {
    type Item = u8;
    const MOST: usize = W::BYTES;
    const EXACT: bool = false;
    #[op]
    fn put(self, to: &mut Output<'_, u8>, _: Here) {
        to.push_low(self.0, self.1);
        to.truncate(to.len() - self.2);
    }
}
impl<W: Width, S: Isa> Put for AsAscii<Simd<u8, W, S>> {
    type Item = Ascii;
    const MOST: usize = W::BYTES;
    const EXACT: bool = true;
    #[inline(always)]
    fn put(self, to: &mut Output<'_, Ascii>, _: Here) {
        to.push_ascii(self.0)
    }
}

impl<T: Lane, W: Width, S: Isa> Simd<T, W, S> {
    /// The first `n` lanes, as a [`Piece`]. `selected`, `low_bytes` and `ascii` can follow, and then see only these lanes.
    #[doc(alias("StoreN", "push_exact", "take"))]
    #[inline(always)]
    pub fn first_n(self, n: usize) -> FirstN<Self> {
        FirstN(self, n)
    }
    /// The lanes that are kept, as a [`Piece`].
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (v, mut all) = (u8x16::load_or_default(b"a b"), Vec::new());
    /// Output::append(&mut all, 2).push(v.first_n(3).selected(v.simd_ne(b' ')));
    /// assert_eq!(all, b"ab");
    /// # } example()
    /// ```
    #[doc(alias("CompressStore", "push_compressed"))]
    #[op]
    #[track_caller]
    pub fn selected<K: Keep<T, W, S>>(self, keep: K) -> SelectedLanes<Self, K> {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        SelectedLanes(self, keep)
    }
}
impl<T: Unsigned, W: Width, S: Isa> Simd<T, W, S> {
    /// What [`store_low_bytes`](Simd::store_low_bytes) stores, as a [`Piece`]. For fewer lanes, `v.first_n(n).low_bytes(more)`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (text, mut room) = (u8x4::from(b"a\"b\\").cast::<u16>(), [0; 9]);
    /// let escaped = text.simd_eq(b'"' as u16) | text.simd_eq(b'\\' as u16);
    /// let (both, mut out) = (escaped.select(text << 8 | b'\\' as u16, text), Output::overwrite(&mut room));
    /// out.push(both.low_bytes(escaped));
    /// out.push(both.first_n(2).low_bytes(escaped));
    /// assert_eq!(out.filled(), br#"a\"b\\a\""#);
    /// # } example()
    /// ```
    #[doc(alias("escape", "varint", "stuffing"))]
    #[op]
    #[track_caller]
    pub fn low_bytes<M: MoreBytes<T, W, S>>(self, more: M) -> LowBytes<Self, M> {
        require!(of Simd<T, W, S>, "a `u64` has too few bits for so many lanes, which have 2 bytes or more", Simd::<T, W, S>::LANES * bits::<T>() <= 64, at any width size_of::<T>() > 1);
        LowBytes(self, more, 0)
    }
}
impl<T: Lane, W: Width, S: Isa> FirstN<Simd<T, W, S>> {
    #[op]
    #[track_caller]
    pub fn selected(self, keep: impl Keep<T, W, S>) -> SelectedLanes<Simd<T, W, S>, u64> {
        self.0.selected(keep.kept(self.0.tag()) & !(!0u64).unbounded_shl(self.1.min(64) as u32))
    }
}
impl<W: Width, S: Isa> FirstN<Simd<u8, W, S>> {
    #[op]
    pub fn ascii(self) -> FirstN<AsAscii<Simd<u8, W, S>>> {
        FirstN(AsAscii(self.0), self.1)
    }
}
impl<T: Unsigned, W: Width, S: Isa> FirstN<Simd<T, W, S>> {
    #[op]
    #[track_caller]
    pub fn low_bytes(self, more: impl MoreBytes<T, W, S>) -> LowBytes<Simd<T, W, S>, u64> {
        require!(of Simd<T, W, S>, "a `u64` has too few bits for so many lanes, which have 2 bytes or more", Simd::<T, W, S>::LANES * bits::<T>() <= 64, at any width size_of::<T>() > 1);
        // Without their bits, the other lanes add one byte each, which `put` drops.
        let lanes = Simd::<T, W, S>::LANES;
        let n = self.1.min(lanes);
        LowBytes(self.0, more.packed() & !(!0u64).unbounded_shl((n * bits::<T>()) as u32), lanes - n)
    }
}
impl<W: Width, S: Isa> Simd<u8, W, S> {
    /// The lanes without their highest bits, as a [`Piece`] of [`Ascii`].
    #[inline(always)]
    pub fn ascii(self) -> AsAscii<Self> {
        AsAscii(self)
    }
}
