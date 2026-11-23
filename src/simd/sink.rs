//! Where values go.

use crate::memory::{Place, Region};
use crate::output::Tail;
use crate::{Aligned, Isa, Lane, MaskOf, Output, Over, Readable, Simd, Tag, Width, Writable};
use core::ops::{Bound, RangeBounds};

type V<T, W, S> = Simd<T, W, S>;
type M<T, W, S> = MaskOf<T, W, S>;

/// All that vectors of `T` can be written to. [`store_at`](Simd::store_at), [`map_into`](Over::map_into) and the other loops take a mutable reference to it.
///
/// - A slice, array, `Vec` or `Box` of what is [`Writable`], and for bytes of [`Ascii`](crate::text::Ascii).
/// - A shared slice of cells, atomics or [`Shared`](crate::Shared) memory: `&mut &cells[..]`. It can be what the loop reads, or start before that. If it starts within, the values are unspecified.
/// - An [`Output`], which grows. Position 0 is its present end, and a write can't leave a gap.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// fn double(from: &[impl Readable<u8>], mut to: impl Sink<u8>) {
///     over(from).map_into(&mut to, |v| v + v);
/// }
/// let mut plain = [0; 3];
/// double(&[1u8, 2, 3], &mut plain);
/// let cells = core::cell::Cell::from_mut(&mut plain[..]).as_slice_of_cells();
/// double(cells, cells);
/// assert_eq!(plain, [4, 8, 12]);
/// # } example()
/// ```
#[doc(alias("Destination", "BufMut", "IntoSink", "StoreAt", "FilterInto", "SharedWritable"))]
#[diagnostic::on_unimplemented(
    message = "vectors of `{T}` can't be written to `{Self}`",
    label = "expected something like `[{T}]`",
    note = "`&mut x[..]` makes a slice, and `&mut &x[..]` is for cells and atomics"
)]
pub trait Sink<T: Lane>: crate::seals::Sink<T> {
    #[doc(hidden)]
    type Place<'a>: Place<T>
    where
        Self: 'a;
    #[doc(hidden)]
    const MOST: usize = usize::MAX;
    #[doc(hidden)]
    fn place(&mut self) -> Self::Place<'_>;
    #[doc(hidden)]
    #[op]
    #[track_caller]
    fn whole<W: Width, S: Isa>(&mut self, at: usize, v: V<T, W, S>) {
        self.place().write_vector(at, v)
    }
    #[doc(hidden)]
    #[op]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        &mut self,
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> usize {
        let (s, from) = from.parts();
        Tag::new(s).filter_in_order(from, self.place(), matches)
    }
    #[doc(hidden)]
    #[op]
    #[track_caller]
    fn with_room(&mut self, n: usize, job: impl Job<T>) -> usize {
        job.run(self.place().slice(0..n))
    }
    /// What `&mut to[range]` is for a slice. Panics if the range is out of bounds.
    #[doc(alias("tail", "slice"))]
    #[op]
    #[track_caller]
    fn part(&mut self, range: impl RangeBounds<usize>) -> Part<Self::Place<'_>> {
        let all = self.place();
        let start = match range.start_bound() {
            Bound::Included(&at) => at,
            Bound::Excluded(&at) => at.checked_add(1).unwrap(),
            Bound::Unbounded => 0,
        };
        let end = match range.end_bound() {
            Bound::Included(&at) => at.checked_add(1).unwrap(),
            Bound::Excluded(&at) => at,
            Bound::Unbounded => all.len(),
        };
        Part(all.slice(start..end))
    }
}

/// Writes to the first values of a sink, whose number is a constant. One check replaces those of the writes.
pub trait Job<T: Lane> {
    fn run(self, to: impl Place<T>) -> usize;
}

/// A part of a [`Sink`], for code that is generic over it. Its positions stay where they are, also in an [`Output`].
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// fn count(mut to: impl Sink<u8>) {
///     let (mut room, mut v) = (to.part(..), u8x4::iota(0));
///     while room.len() >= 4 {
///         v.store_at(&mut room, 0);
///         (room, v) = (room.skip(4), v + 4);
///     }
///     room.write(0, [99]);
/// }
/// let mut all = [0; 9];
/// count(&mut all);
/// assert_eq!(all, [0, 1, 2, 3, 4, 5, 6, 7, 99]);
/// # } example()
/// ```
pub struct Part<P>(P);

impl<P: Region> Part<P> {
    /// The number of values.
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// Whether there are no values.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    /// What is left after the first `n` values. Panics if there are fewer. A loop that advances with this needs no other checks.
    #[inline(always)]
    #[track_caller]
    pub fn skip(self, n: usize) -> Self {
        Self(self.0.skip(n))
    }
    /// Writes `N` values from `at` on. Panics if there is no room for all.
    #[inline(always)]
    #[track_caller]
    pub fn write<T: Lane, const N: usize>(&mut self, at: usize, values: [T; N])
    where
        P: Place<T>,
    {
        self.0.write(at, values)
    }
}

#[sealed]
impl<T: Lane, P: Place<T>> Sink<T> for Part<P> {
    type Place<'a>
        = P::Again<'a>
    where
        Self: 'a;
    #[inline(always)]
    fn place(&mut self) -> P::Again<'_> {
        self.0.again()
    }
}
#[sealed]
impl<T: Lane, E> Sink<T> for &[E]
where
    Self: Place<T>,
{
    type Place<'a>
        = Self
    where
        Self: 'a;
    #[inline(always)]
    fn place(&mut self) -> Self {
        self
    }
}
#[sealed]
impl<'b, T: Lane, E, const N: usize> Sink<T> for &'b [E; N]
where
    &'b [E]: Place<T>,
{
    type Place<'a>
        = &'b [E]
    where
        Self: 'a;
    const MOST: usize = N;
    #[inline(always)]
    fn place(&mut self) -> &'b [E] {
        *self
    }
}
#[sealed]
impl<T: Lane, E: Writable<T>> Sink<T> for [E] {
    type Place<'a>
        = E::Place<'a>
    where
        Self: 'a;
    #[inline(always)]
    fn place(&mut self) -> E::Place<'_> {
        E::place(self)
    }
    #[op]
    #[track_caller]
    fn whole<W: Width, S: Isa>(&mut self, at: usize, v: V<T, W, S>) {
        let n = V::<T, W, S>::LANES;
        crate::window::check(self.len(), at, n);
        v.store(&mut self[at..])
    }
    #[op]
    fn kept_from<W: Width, S: Isa, F: Readable<T>>(
        &mut self,
        from: Over<'_, T, W, S, F>,
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> usize {
        E::kept_from(self, from, matches)
    }
}
#[sealed]
impl<'b, T: Lane> Sink<T> for Output<'b, T> {
    type Place<'a>
        = Tail<'a, 'b, T>
    where
        Self: 'a;
    #[inline(always)]
    fn place(&mut self) -> Tail<'_, 'b, T> {
        self.tail()
    }
    #[op]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        &mut self,
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> usize {
        from.filter_to_output(self, matches)
    }
    #[op]
    #[track_caller]
    fn with_room(&mut self, n: usize, job: impl Job<T>) -> usize {
        job.run(self.window(n).tail())
    }
}
macro_rules! like { ($($(#[$m:meta])* [$($g:tt)*] $to:ty, $inner:ty, |$it:ident| $get:expr $(, $most:expr)?;)*) => {$(
    $(#[$m])*
    #[sealed]
    impl<$($g)*, T: Lane> Sink<T> for $to where $inner: Sink<T> {
        type Place<'a> = <$inner as Sink<T>>::Place<'a> where Self: 'a;
        const MOST: usize = [$($most,)? <$inner as Sink<T>>::MOST][0];
        #[op]
        fn place(&mut self) -> Self::Place<'_> { let $it = self; <$inner>::place($get) }
        #[op]
        #[track_caller]
        fn whole<W: Width, S: Isa>(&mut self, at: usize, v: V<T, W, S>) { let $it = self; <$inner>::whole($get, at, v) }
        #[op]
        #[track_caller]
        fn with_room(&mut self, n: usize, job: impl Job<T>) -> usize { let $it = self; <$inner as Sink<T>>::with_room($get, n, job) }
        #[op]
        fn kept_from<W: Width, S: Isa, F: Readable<T>>(&mut self, from: Over<'_, T, W, S, F>, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize {
            let $it = self;
            <$inner>::kept_from($get, from, matches)
        }
    }
)*}; }
like! {
    [X: ?Sized] &mut X, X, |it| it;
    ['b, E: Copy, To: crate::output::Grows<E>] crate::Appending<'b, E, To>, Output<'b, E>, |it| it;
    ['o, 'b, E: Copy] crate::Room<'o, 'b, E>, Output<'b, E>, |it| it;
    [E, const N: usize] [E; N], [E], |it| it, N;
    [A] Aligned<A>, A, |it| &mut it.0;
    #[cfg(feature = "alloc")] [E] alloc::vec::Vec<E>, [E], |it| it;
    #[cfg(feature = "alloc")] [X: ?Sized] alloc::boxed::Box<X>, X, |it| it;
}

/// The loops for what is not a slice. If the source can change, each value is read once, and before its place is written.
impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    fn filter_in_order<P: Place<T>>(
        self,
        from: &[impl Readable<T>],
        mut to: P,
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> usize {
        let (mut rest, mut at) = (from, 0);
        // The length first: the room is known late. On WebAssembly, one loop is faster.
        while !S::WASM
            && rest.len() >= Self::LANES
            && {
                // Keeps the two tests apart.
                when!(S::AVX512F && P::MASKED && P::SHARED, crate::not_unrolled());
                to.len() - at >= Self::LANES
            }
            && let Some(v) = self.read_from(&mut rest)
        {
            let kept = matches(v);
            let v = v.compress_mask(kept);
            // All lanes fit: no mask for cells and shared bytes. To stream stores that overlap is slow.
            choose! { S::AVX512F && P::MASKED && P::SHARED => v.write(&mut to, at), _ => v.write_n(&mut to, at) }
            at += kept.count();
        }
        let mut put = always!(|v: V<T, W, S>, kept: M<T, W, S>| {
            v.compress_mask(kept).write_n(&mut to, at);
            at += kept.count();
            assert!(at <= to.len());
        });
        while let Some(v) = self.read_from(&mut rest) {
            crate::not_unrolled();
            let kept = matches(v);
            // With so little room, most have nothing.
            if S::WASM || kept.any() {
                put(v, kept);
            }
        }
        if !rest.is_empty() {
            let v = self.load_any_n(rest);
            put(v, (matches(v) & self.first_n(rest.len())).whole_lanes());
        }
        to.keep(at);
        at
    }
    #[op]
    pub(crate) fn until<
        U: Lane,
        X: Width,
        E: Readable<T>,
        P: Place<U>,
        A: Fn(V<T, W, S>) -> M<T, W, S>,
        B: Fn(V<T, W, S>) -> V<U, X, S>,
    >(
        self,
        from: &[E],
        to: P,
        stop: A,
        f: B,
    ) -> usize {
        return_if!(Self::ONE_BY_ONE, self.until_one(from, to, stop, f));
        return_if!(!E::PLAIN, |d: Self = self, from: &[E] = from, to: P = to, stop: A = stop, f: B = f| d.until_in_order(from, to, stop, f));
        let mut to = to;
        let end = self.transform_until(from, to.again(), stop, f);
        to.keep(end);
        end
    }
    #[op]
    fn until_in_order<U: Lane, X: Width>(
        self,
        from: &[impl Readable<T>],
        to: impl Place<U>,
        stop: impl Fn(V<T, W, S>) -> M<T, W, S>,
        f: impl Fn(V<T, W, S>) -> V<U, X, S>,
    ) -> usize {
        let (mut rest, mut to, mut at) = (from, to.slice(0..from.len()), 0);
        let end = loop {
            let Some(v) = self.read_from(&mut rest) else {
                let v = self.load_any_n(rest);
                if !rest.is_empty() {
                    f(v).write_n(&mut to, at);
                }
                break at + (stop(v) | !self.first_n(rest.len())).count_before_first();
            };
            f(v).write(&mut to, at);
            if let Some(first) = stop(v).first_set() {
                break at + first;
            }
            at += Self::LANES;
        };
        to.keep(end);
        end
    }
    #[op]
    pub(crate) fn zip_in_order<U: Lane, X: Width, R: Lane, Y: Width, E: Readable<T>, F: Readable<U>, P: Place<R>>(
        self,
        (mut x, other, mut y): (&[E], Tag<S, U, X>, &[F]),
        mut to: P,
        f: impl Fn(V<T, W, S>, V<U, X, S>) -> V<R, Y, S>,
    ) {
        let n = Self::LANES;
        return_if!(E::PLAIN && F::PLAIN || !P::SHARED, {
            // It is other memory, so a value can be read and written twice.
            if x.len() < n {
                if const { S::PARTIAL && P::MASKED } && (P::ANY_ORDER || !x.is_empty()) {
                    f(self.load_any_n(x), other.load_any_n(y)).write_n(&mut to, 0);
                } else if !x.is_empty() {
                    f(self.load_ends(E::source(x)), other.load_ends(F::source(y))).store_ends(to);
                }
                return;
            }
            while x.len() >= 5 * n && y.len() >= 5 * n && to.len() >= 5 * n {
                for i in 0..4 {
                    f(self.load_any(&x[i * n..]), other.load_any(&y[i * n..])).write(&mut to, i * n);
                }
                (x, y, to) = (&x[4 * n..], &y[4 * n..], to.skip(4 * n));
            }
            while x.len() >= 2 * n && y.len() >= 2 * n && to.len() >= 2 * n {
                crate::not_unrolled();
                f(self.load_any(x), other.load_any(y)).write(&mut to, 0);
                (x, y, to) = (&x[n..], &y[n..], to.skip(n));
            }
            if x.len() > n {
                f(self.load_any(x), other.load_any(y)).write(&mut to, 0);
            }
            f(self.load_any_last(x), other.load_any_last(y)).write(&mut to, x.len() - n)
        });
        while x.len() >= n && y.len() >= n && to.len() >= n {
            f(self.load_any(x), other.load_any(y)).write(&mut to, 0);
            (x, y, to) = (&x[n..], &y[n..], to.skip(n));
        }
        f(self.load_any_n(x), other.load_any_n(y)).write_n(&mut to, 0)
    }
}
