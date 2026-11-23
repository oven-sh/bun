//! Memory that is not a plain slice.

use crate::raw::Raw;
use crate::{Isa, Lane, Readable, Simd, Tag, Width};
use core::cell::Cell;
use core::ops::Range;
use core::sync::atomic::{AtomicU16, AtomicU32, Ordering::Relaxed};

/// The length of a [`Place`], and its parts.
pub trait Region: Sized {
    /// The number of values.
    fn len(&self) -> usize;
    /// Panics if the range is out of bounds. A loop that advances with this needs no bounds checks.
    fn slice(self, range: Range<usize>) -> Self;
    /// What is left after the first `n` values.
    #[op]
    fn skip(self, n: usize) -> Self {
        let len = self.len();
        self.slice(n..len)
    }
    /// Whether there are no values.
    #[inline(always)]
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// What a kernel can read vectors from. A kernel that is generic over this also works on memory that `&[T]` must not
/// refer to, such as memory that another thread writes to.
#[diagnostic::on_unimplemented(
    message = "vectors of `{T}` can't be read from `{Self}`",
    label = "expected something like `&[{T}]`",
    note = "`&x[..]` makes a slice of a `Vec` or an array"
)]
pub trait Source<T: Copy>: Region + Copy {
    /// The `N` values from `at` on. Panics if they are not all there.
    fn read<const N: usize>(self, at: usize) -> [T; N];
    /// Panics if `at` is out of bounds.
    #[inline(always)]
    fn get(self, at: usize) -> T {
        self.read::<1>(at)[0]
    }
    /// Whether there is `as_slice`. LLVM gets no code of a branch that a constant leaves out.
    #[doc(hidden)]
    const SLICE: bool = false;
    /// Allows masked loads.
    #[inline(always)]
    fn as_slice(&self) -> Option<&[T]> {
        None
    }
    /// Whether `read_vector_n` is a masked load on the targets that have one.
    #[doc(hidden)]
    const MASKED: bool = false;
    /// To align loops. 0 if it isn't known.
    #[doc(hidden)]
    #[op]
    fn address(&self) -> usize {
        self.as_slice().map_or(0, |it| it.as_ptr().addr())
    }
    #[doc(hidden)]
    #[op]
    fn read_vector<S: Isa, W: Width>(self, d: Tag<S, T, W>, at: usize) -> Simd<T, W, S>
    where
        T: Lane,
    {
        Simd::new(d.simd(), Raw::read(self, at))
    }
    #[doc(hidden)]
    #[inline(always)]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        T: Lane,
    {
        read_in_parts(self, d)
    }
    /// The first four vectors, or the first two twice if they have more than 32 bytes.
    #[doc(hidden)]
    #[inline(always)]
    fn read_group<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> [Simd<T, W, S>; 4]
    where
        T: Lane,
    {
        d.read_one_by_one(self)
    }
}

/// A [`Sink`](crate::Sink) by value.
pub trait Place<T: Copy>: Region {
    type Again<'a>: Place<T>
    where
        Self: 'a;
    /// The same, for a shorter time.
    fn again(&mut self) -> Self::Again<'_>;
    /// Only the first `n` values count.
    #[inline(always)]
    fn keep(&mut self, _n: usize) {}
    /// To align loops.
    #[op]
    fn address(&mut self) -> Option<usize> {
        self.uninit_address().or(self.shared_address()).or(self.as_mut_slice().map(|to| to.as_ptr().addr()))
    }
    /// Whether it can be read at the same time.
    const SHARED: bool = true;
    /// LLVM makes one store of `write`.
    const AT_ONCE: bool = !Self::SHARED;
    /// Values can be written in any order, and wrong ones before the right ones.
    const ANY_ORDER: bool = false;
    /// Whole vectors can go around the caches.
    const STREAMS: bool = false;
    /// `write` changes the values.
    const CHANGES: bool = false;
    /// What `write` does to each value, so that LLVM can leave it out there.
    #[inline(always)]
    fn ahead<S: Isa, W: Width>(v: Simd<T, W, S>) -> Simd<T, W, S>
    where
        T: Lane,
    {
        v
    }
    /// Whether `write_vector_n` is a masked store on the targets that have one.
    const MASKED: bool = false;
    #[inline(always)]
    fn store<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>)
    where
        T: Lane,
    {
        self.write_vector(at, v)
    }
    #[op]
    fn zipped<S: Isa, F: Lane, W: Width, U: Lane, X: Width, Y: Width>(
        self,
        d: Tag<S, F, W>,
        from: (&[impl Readable<F>], Tag<S, U, X>, &[impl Readable<U>]),
        f: impl Fn(Simd<F, W, S>, Simd<U, X, S>) -> Simd<T, Y, S>,
    ) where
        T: Lane,
    {
        d.zip_in_order(from, self, f)
    }
    /// It has the length of the result.
    #[op]
    fn mapped<S: Isa, F: Lane, W: Width, X: Width>(
        self,
        d: Tag<S, F, W>,
        from: impl Source<F>,
        f: impl Fn(Simd<F, W, S>) -> Simd<T, X, S>,
    ) where
        T: Lane,
    {
        d.transform_all(from, self, f)
    }
    /// Writes `N` values from `at` on. Panics if there is no room for all.
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]);
    /// Whether there is `as_mut_slice`.
    const SLICE: bool = false;
    /// Allows masked stores.
    #[inline(always)]
    fn as_mut_slice(&mut self) -> Option<&mut [T]> {
        None
    }
    #[doc(hidden)]
    #[inline(always)]
    fn uninit_address(&self) -> Option<usize> {
        None
    }
    /// Of cells or shared bytes, for which `write_vector_n` is a masked store on the targets that have one.
    #[doc(hidden)]
    #[inline(always)]
    fn shared_address(&self) -> Option<usize> {
        None
    }
    #[doc(hidden)]
    #[inline(always)]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>)
    where
        T: Lane,
        Self: Sized,
    {
        v.raw.write(self, at)
    }
    #[doc(hidden)]
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>)
    where
        T: Lane,
        Self: Sized,
    {
        write_in_parts(self, at, v)
    }
}

#[inline(always)]
pub(crate) fn read_in_parts<S: Isa, T: Lane, W: Width>(from: impl Source<T>, d: Tag<S, T, W>) -> Simd<T, W, S> {
    apart!(d.simd(), {
        if from.len() >= d.lanes() {
            return d.read(from, 0);
        }
        return_if!(
            Tag::<S, T, W>::LANES <= 2,
            if from.is_empty() { d.zero() } else { d.zero().with_lane_dyn(0, from.get(0)) }
        );
        live!(
            Tag::<S, T, W>::LANES > 2,
            apart!(d.isa(), {
                let half = d.half();
                let has_lower = from.len() >= half.lanes();
                let last = half.read_n(from.slice(if has_lower { half.lanes() } else { 0 }..from.len()));
                if has_lower { d.combine(last, half.read(from, 0)) } else { d.zero_extend(last) }
            })
        )
    })
}

#[op]
pub(crate) fn write_in_parts<S: Isa, T: Lane, W: Width, P: Place<T>>(to: &mut P, at: usize, v: Simd<T, W, S>) {
    #[cfg(target_arch = "aarch64")]
    if const { Tag::<S, T, W>::BY_LOOKUP } {
        return v.store_by_lookup(to, at);
    }
    apart_unoptimized!(v.isa(), |to: &mut P| {
        let (lanes, room) = (v.tag().lanes(), to.len() - at);
        if room >= lanes {
            return v.write(to, at);
        }
        return_if!(
            Tag::<S, T, W>::LANES <= 2,
            if room > 0 {
                to.write(at, [v.get_lane()])
            }
        );
        let has_lower = room >= lanes / 2;
        if has_lower {
            v.lower_half().write(to, at);
        }
        let (done, last) = if has_lower { (lanes / 2, v.upper_half()) } else { (0, v.lower_half()) };
        live!(Tag::<S, T, W>::LANES > 2, again!(Simd::write_n, last, to, at + done))
    })
}

/// The same by two writes that overlap, where nothing else can look.
#[op]
pub(crate) fn write_ends<S: Isa, T: Lane, W: Width>(to: &mut impl Place<T>, at: usize, v: Simd<T, W, S>) {
    if to.len() - at >= v.tag().lanes() { v.write(to, at) } else { write_fewer(to, at, v) }
}

#[op]
fn write_fewer<S: Isa, T: Lane, W: Width, P: Place<T>>(to: &mut P, at: usize, v: Simd<T, W, S>) {
    return_if!(
        Tag::<S, T, W>::LANES <= 2,
        if to.len() > at {
            to.write(at, [v.get_lane()])
        }
    );
    apart!(v.isa(), |to: &mut P| {
        let half = Tag::<S, T, W>::LANES / 2;
        let Some(more) = (to.len() - at).checked_sub(half) else { return write_fewer(to, at, v.lower_half()) };
        v.lower_half().write(to, at);
        choose! { |to: &mut P = to, at: usize = at, more: usize = more, v: Simd<T, W, S> = v|
            Simd::<T, W, S>::SLIDES => v.lanes_from(more).lower_half().write(to, at + more),
            S::AVX2 && W::BYTES <= S::REGISTER => v.down_by(more).lower_half().write(to, at + more),
            _ => write_fewer(to, at + Tag::<S, T, W>::LANES / 2, v.upper_half()),
        }
    })
}

impl<T> Region for &[T] {
    #[inline(always)]
    fn len(&self) -> usize {
        <[T]>::len(self)
    }
    #[inline(always)]
    fn slice(self, range: Range<usize>) -> Self {
        &self[range]
    }
}

impl<T> Region for &mut [T] {
    #[inline(always)]
    fn len(&self) -> usize {
        <[T]>::len(self)
    }
    #[inline(always)]
    fn slice(self, range: Range<usize>) -> Self {
        &mut self[range]
    }
}

macro_rules! slices {
    ($([$($generics:tt)*] $t:ty, $source:ty, $sink:ty, |$r:ident| $read:expr, |$w:ident, $v:ident| $write:expr;)*) => {$(
        impl<$($generics)*> Source<$t> for $source {
            #[op]
            fn read<const N: usize>(self, at: usize) -> [$t; N] {
                let from = &self[at..][..N];
                core::array::from_fn(|i| { let $r = &from[i]; $read })
            }
        }
        impl<$($generics)*> Place<$t> for $sink {
            type Again<'a> = Self where Self: 'a;
            #[inline(always)]
            fn again(&mut self) -> Self { self }
            #[op]
            fn write<const N: usize>(&mut self, at: usize, values: [$t; N]) {
                let to = &self[at..][..N];
                for i in 0..N { let ($w, $v) = (&to[i], values[i]); $write }
            }
        }
    )*};
}

impl<T: Copy> Source<T> for &[Cell<T>] {
    const MASKED: bool = crate::X86;
    #[op]
    fn read<const N: usize>(self, at: usize) -> [T; N] {
        let from = &self[at..][..N];
        core::array::from_fn(|i| from[i].get())
    }
    #[inline(always)]
    fn address(&self) -> usize {
        self.as_ptr().addr()
    }
    #[op]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> Simd<T, W, S>
    where
        T: Lane,
    {
        return_if!(!Tag::<S, T, W>::CELLS_BY_BITS, read_in_parts(self, d));
        if !crate::tag::near_absent_page_by_bits::<_, W>(d.simd(), self) {
            return Simd::new(d.simd(), Raw::load_cells(d.simd(), self, 0));
        }
        core::hint::cold_path();
        if self.is_empty() {
            return d.zero();
        }
        let skip = crate::tag::missing::<T, W>(self.len());
        Simd::new(d.simd(), Raw::load_cells(d.simd(), self, skip)).down_by(skip)
    }
}

impl<T: Copy> Place<T> for &[Cell<T>] {
    const ANY_ORDER: bool = true;
    const AT_ONCE: bool = true;
    const MASKED: bool = crate::X86;
    type Again<'a>
        = Self
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> Self {
        self
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        let to = &self[at..][..N];
        for i in 0..N {
            to[i].set(values[i])
        }
    }
    #[op]
    fn shared_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>)
    where
        T: Lane,
    {
        return_if!(!Tag::<S, T, W>::CELLS_BY_BITS, write_in_parts(self, at, v));
        let to = &self[at..];
        if !crate::tag::near_absent_page_by_bits::<_, W>(v.isa(), to) {
            return v.raw.store_cells(v.isa(), to, 0);
        }
        core::hint::cold_path();
        if !to.is_empty() {
            let skip = crate::tag::missing::<T, W>(to.len());
            v.up_by(skip).raw.store_cells(v.isa(), to, skip)
        }
    }
}

// An access to a wide atomic is one lane wide, so those are correct and slow.
slices! {
    [] u16, &[AtomicU16], &[AtomicU16], |it| it.load(Relaxed), |it, value| it.store(value, Relaxed);
    [] u32, &[AtomicU32], &[AtomicU32], |it| it.load(Relaxed), |it, value| it.store(value, Relaxed);
}
#[cfg(target_has_atomic = "64")]
slices! { [] u64, &[core::sync::atomic::AtomicU64], &[core::sync::atomic::AtomicU64], |it| it.load(Relaxed), |it, value| it.store(value, Relaxed); }

impl<T: crate::Lane> Source<T> for &[T] {
    const MASKED: bool = true;
    #[op]
    fn read<const N: usize>(self, at: usize) -> [T; N] {
        *self[at..].first_chunk().unwrap()
    }
    #[cfg(bun_simd_unoptimized)]
    #[inline(always)]
    fn read_vector<S: Isa, W: Width>(self, d: Tag<S, T, W>, at: usize) -> Simd<T, W, S> {
        d.load(&self[at..])
    }
    #[inline(always)]
    fn get(self, at: usize) -> T {
        self[at]
    }
    #[inline(always)]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.load_n(self)
    }
    const SLICE: bool = true;
    #[inline(always)]
    fn as_slice(&self) -> Option<&[T]> {
        Some(self)
    }
}

impl<T: crate::Lane> Place<T> for &mut [T] {
    const ANY_ORDER: bool = true;
    const SHARED: bool = false;
    type Again<'a>
        = &'a mut [T]
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> &mut [T] {
        self
    }
    const MASKED: bool = true;
    #[inline(always)]
    fn store<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.store(&mut self[at..])
    }
    #[op]
    fn zipped<S: Isa, F: Lane, W: Width, U: Lane, X: Width, Y: Width>(
        self,
        d: Tag<S, F, W>,
        from: (&[impl Readable<F>], Tag<S, U, X>, &[impl Readable<U>]),
        f: impl Fn(Simd<F, W, S>, Simd<U, X, S>) -> Simd<T, Y, S>,
    ) {
        d.zip_to_slice(from, self, f)
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        *self[at..].first_chunk_mut().unwrap() = values;
    }
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        choose! { cfg!(bun_simd_unoptimized) || crate::X86 && W::BYTES > S::REGISTER => v.store(&mut self[at..]), _ => v.raw.write(self, at) }
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.store_n(&mut self[at..])
    }
    const SLICE: bool = true;
    #[inline(always)]
    fn as_mut_slice(&mut self) -> Option<&mut [T]> {
        Some(self)
    }
}

impl<T: crate::Lane> Place<T> for &mut [core::mem::MaybeUninit<T>] {
    const ANY_ORDER: bool = true;
    const SHARED: bool = false;
    type Again<'a>
        = &'a mut [core::mem::MaybeUninit<T>]
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> &mut [core::mem::MaybeUninit<T>] {
        self
    }
    const MASKED: bool = true;
    #[inline(always)]
    fn store<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.store(&mut self[at..])
    }
    #[op]
    fn zipped<S: Isa, F: Lane, W: Width, U: Lane, X: Width, Y: Width>(
        self,
        d: Tag<S, F, W>,
        from: (&[impl Readable<F>], Tag<S, U, X>, &[impl Readable<U>]),
        f: impl Fn(Simd<F, W, S>, Simd<U, X, S>) -> Simd<T, Y, S>,
    ) {
        d.zip_to_slice(from, self, f)
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        crate::raw::copy::to_uninit(values, &mut self[at..])
    }
    #[op]
    fn uninit_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        choose! { Tag::<S, T, W>::TO_UNINIT => v.store_first(&mut self[at..]), _ => write_in_parts(self, at, v) }
    }
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        choose! { crate::X86 && W::BYTES > S::REGISTER => v.store(&mut self[at..]), _ => v.raw.write(self, at) }
    }
}
