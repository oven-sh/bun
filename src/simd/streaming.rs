//! Loops and sinks whose stores go around the caches, on top of `stream.rs`.

use crate::closures::inlined_here;
use crate::stream::{self, AnyBytes, Lendable, Streamed, Streaming, streaming};
use crate::{Columns, Isa, Items, Lane, Over, OverMut, Place, Readable, Region, Simd, Source, Tag, Width, Writable};

type V<T, W, S> = Simd<T, W, S>;

/// Arm finds out by itself that whole lines are written. Sanitizers don't see the stores.
const STREAMS: bool = cfg!(all(
    target_arch = "x86_64",
    target_feature = "sse2",
    not(any(miri, bun_simd_sanitize = "address", bun_simd_sanitize = "memory", bun_simd_sanitize = "thread"))
));

/// How far the place of `to` in its page is after that of `from`: 1 to 4096. A load waits for an earlier store to the same place in
/// another page. So if the stores are just ahead of the loads, the loops load four vectors first.
#[op]
pub(crate) fn ahead(to: usize, from: usize) -> usize {
    4096 - from.wrapping_sub(to) % 4096
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    pub(crate) const STREAMS: bool = STREAMS && !S::PORTABLE && W::BYTES >= 16;
    /// Whether `stream_in_order` takes so many values.
    #[op]
    pub(crate) fn streams(self, len: usize) -> bool {
        (const { Self::STREAMS }) && len >= 64 + 2 * Self::LANES
    }
    /// Writes `f(0)`, `f(1)` and so on, which are called in order, up to `whole`, and then as much of `rest` as fits. Two neighbors make an aligned vector.
    #[op]
    pub(crate) fn stream_in_order<F>(
        self,
        mut to: impl Place<T>,
        (whole, gap): (usize, usize),
        mut state: F,
        f: impl Fn(&mut F, usize) -> V<T, W, S>,
        rest: impl FnOnce(&mut F) -> V<T, W, S>,
    ) {
        let (n, skip) = (Self::LANES, to.address().unwrap_or(0).wrapping_neg() % 64 / size_of::<T>());
        let (mut before, mut k) = (f(&mut state, 0), 1);
        while k * n <= skip {
            before.write_n(&mut to.again().slice((k - 1) * n..k * n), 0);
            (before, k) = (f(&mut state, k), k + 1);
        }
        // A line that is written in both ways has to be fetched, or waited for.
        before.write_n(&mut to.again().slice((k - 1) * n..skip), 0);
        let (mut to, done) = (to.skip(skip), skip % n);
        while const { W::BYTES <= S::REGISTER } && 2 * gap <= 7 * W::BYTES && k + 4 <= whole {
            let (a, b, c, d) = (f(&mut state, k), f(&mut state, k + 1), f(&mut state, k + 2), f(&mut state, k + 3));
            self.line_of(before, a, done).write(&mut to, 0);
            self.line_of(a, b, done).write(&mut to, n);
            self.line_of(b, c, done).write(&mut to, 2 * n);
            self.line_of(c, d, done).write(&mut to, 3 * n);
            (to, before, k) = (to.skip(4 * n), d, k + 4);
        }
        while k < whole {
            let v = f(&mut state, k);
            self.line_of(before, v, done).write(&mut to, 0);
            (to, before, k) = (to.skip(n), v, k + 1);
        }
        if to.len() > n - done {
            let v = rest(&mut state);
            if to.len() < n {
                return self.line_of(before, v, done).write_n(&mut to, 0);
            }
            self.line_of(before, v, done).write(&mut to, 0);
            (to, before) = (to.skip(n), v);
        }
        let last = before.down_by(done);
        if to.len() == n { last.write(&mut to, 0) } else { last.write_n(&mut to, 0) }
    }
    /// `end_of`, a register at a time.
    #[op]
    fn line_of(self, before: V<T, W, S>, v: V<T, W, S>, done: usize) -> V<T, W, S> {
        return_if!(W::BYTES > S::REGISTER, {
            let (half, n) = (self.half(), Self::LANES / 2);
            let (a, b, c, d) = (before.lower_half(), before.upper_half(), v.lower_half(), v.upper_half());
            let (a, b, c) = if done < n { (a, b, c) } else { (b, c, d) };
            self.combine(half.line_of(b, c, done % n), half.line_of(a, b, done % n))
        });
        if done == 0 { before } else { self.end_of(before, v, done) }
    }
    /// The last `len % LANES` lanes of `v` come first.
    #[op]
    pub(crate) fn odd_end(self, v: V<T, W, S>, len: usize) -> V<T, W, S> {
        v.down_by(Self::LANES - len % Self::LANES)
    }
    /// Writes `f(at)` at `at`, for enough places to cover `to`. Without shifts, it takes up to a third less time on AVX2.
    #[op]
    fn stream(self, to: &[Streamed<T>], gap: usize, f: impl Fn(usize) -> V<T, W, S>) {
        let (n, skip, mut at) = (Self::LANES, to.as_ptr().addr().wrapping_neg() % 64 / size_of::<T>(), 0);
        while at < skip {
            f(at).write_n(&mut &to[at..skip], 0);
            at += n;
        }
        let (mut rest, mut at) = (&to[skip..], skip);
        while const { W::BYTES <= S::REGISTER }
            && 2 * gap <= 5 * W::BYTES
            && let Some((first, more)) = rest.split_at_checked(4 * n)
        {
            let (a, b, c, d) = (f(at), f(at + n), f(at + 2 * n), f(at + 3 * n));
            a.stream_aligned(&first[..n]);
            b.stream_aligned(&first[n..2 * n]);
            c.stream_aligned(&first[2 * n..3 * n]);
            d.stream_aligned(&first[3 * n..]);
            (rest, at) = (more, at + 4 * n);
        }
        while let Some((first, more)) = rest.split_at_checked(n) {
            f(at).stream_aligned(first);
            (rest, at) = (more, at + n);
        }
        if !rest.is_empty() {
            f(to.len() - n).down_by(n - rest.len()).write_n(&mut rest, 0);
        }
    }
    /// The same, and the fence.
    #[op]
    fn stream_all<E: Writable<T>>(self, to: &mut [E], gap: usize, f: impl Fn(usize) -> V<T, W, S>) {
        let (n, len) = (Self::LANES, to.len());
        streaming(
            #[inline(always)]
            |s| {
                // These can start anywhere.
                return_if!(
                    E::BYTES,
                    self.repartition::<u8>().stream_in_order(
                        s.lend(E::bytes(to)),
                        (len / n, gap),
                        (),
                        #[inline(always)]
                        |_, k| f(k * n).bitcast(),
                        #[inline(always)]
                        |_| self.odd_end(f(len - n), len).bitcast()
                    )
                );
                let to = match E::plain(to) {
                    Ok(to) => s.lend(to),
                    Err(to) => s.lend(to),
                };
                self.stream(to, gap, f)
            },
        )
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Whether it did. `to` has as many bytes.
    #[op]
    fn stream_to<E>(self, to: &[Streamed<E>]) -> bool {
        if !to.as_ptr().addr().is_multiple_of(W::BYTES.min(S::REGISTER)) {
            return false;
        }
        self.stream_aligned(to);
        true
    }
    #[op]
    fn stream_aligned<E>(self, to: &[Streamed<E>]) {
        return_if!(W::BYTES > S::REGISTER, |this: Self = self, to: &[Streamed<E>] = to| {
            let (lower, upper) = to.split_at(Self::LANES / 2);
            this.lower_half().stream_aligned(lower);
            this.upper_half().stream_aligned(upper)
        });
        #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
        {
            let (to, v) = (stream::Part::of(to), self.bytes());
            if const { W::BYTES == 64 } {
                self.s.stream_64(to, W::to64(v))
            } else if const { W::BYTES == 32 } {
                self.s.stream_32(to, W::to32(v))
            } else {
                self.s.stream_16(to, W::to16(v))
            }
        }
    }
}

impl<T: Lane> Place<T> for &[Streamed<T>] {
    const STREAMS: bool = STREAMS;
    // The loops then write each place once.
    const SHARED: bool = STREAMS;
    const ANY_ORDER: bool = !STREAMS;
    const AT_ONCE: bool = true;
    const MASKED: bool = !STREAMS;
    type Again<'a>
        = Self
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> Self {
        self
    }
    #[op]
    fn uninit_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, it: [T; N]) {
        stream::values(&self[at..], it)
    }
    #[op]
    #[track_caller]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, it: V<T, W, S>) {
        crate::window::check(self.len(), at, V::<T, W, S>::LANES);
        let to = &self[at..][..V::<T, W, S>::LANES];
        if const { Tag::<S, T, W>::STREAMS } && live!(Tag::<S, T, W>::STREAMS, it.stream_to(to)) {
            return;
        }
        // LLVM would store the upper half first, which takes up to 1.6 times as long.
        return_if!(S::A64 && W::BYTES > 32, |to: &[Streamed<T>] = to, v: V<T, W, S> = it| {
            let (mut lower, mut upper) = to.split_at(V::<T, W, S>::LANES / 2);
            lower.write_vector(0, v.lower_half());
            upper.write_vector(0, v.upper_half())
        });
        stream::vector(to, it)
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, it: V<T, W, S>) {
        // On Zen 4, short copies take 1.5 times as long with a masked store, whose vector reaches into the next line.
        let to = &self[at..];
        if const { STREAMS || cfg!(miri) } { stream::ends(to, it) } else { stream::vector_n(to, it) }
    }
    #[op]
    fn mapped<S: Isa, F: Lane, W: Width, X: Width>(
        self,
        d: Tag<S, F, W>,
        from: impl Source<F>,
        f: impl Fn(V<F, W, S>) -> V<T, X, S>,
    ) {
        let (n, len, to) = (V::<F, W, S>::LANES, self.len(), d.simd().fixed::<T, X>());
        if to.streams(len) {
            return live!(Tag::<S, T, X>::STREAMS, {
                let last = to.odd_end(f(d.read(from, from.len() - n)), len);
                to.stream_in_order(
                    self,
                    (from.len() / n, ahead(self.as_ptr().addr(), from.address())),
                    (),
                    #[inline(always)]
                    |_, k| f(d.read(from, k * n)),
                    #[inline(always)]
                    |_| last,
                )
            });
        }
        d.transform_all(from, self, f)
    }
    #[op]
    fn zipped<S: Isa, F: Lane, W: Width, U: Lane, X: Width, Y: Width>(
        self,
        d: Tag<S, F, W>,
        (x, other, y): (&[impl Readable<F>], Tag<S, U, X>, &[impl Readable<U>]),
        f: impl Fn(V<F, W, S>, V<U, X, S>) -> V<T, Y, S>,
    ) {
        let (n, len, to) = (V::<F, W, S>::LANES, self.len(), d.simd().fixed::<T, Y>());
        if to.streams(len) {
            let f = always!(|at| f(d.load_any_at(x, at), other.load_any_at(y, at)));
            return live!(Tag::<S, T, Y>::STREAMS, {
                let (last, at) = (to.odd_end(f(len - n), len), self.as_ptr().addr());
                to.stream_in_order(
                    self,
                    (len / n, ahead(at, x.as_ptr().addr()).min(ahead(at, y.as_ptr().addr()))),
                    (),
                    #[inline(always)]
                    |_, k| f(k * n),
                    #[inline(always)]
                    |_| last,
                )
            });
        }
        d.zip_in_order((x, other, y), self, f)
    }
}

macro_rules! lendable { ($($(#[$m:meta])* [$($g:tt)*] $from:ty, $slice:ty;)*) => {$(
    $(#[$m])*
    #[sealed]
    impl<'scope, $($g)*> Lendable<'scope> for $from {
        type Lent = <$slice as Lendable<'scope>>::Lent;
        #[op]
        fn lent(self, s: Streaming<'scope, '_>) -> Self::Lent { <$slice>::lent(self, s) }
    }
)*}; }
lendable! {
    [E: AnyBytes, const N: usize] &'scope mut [E; N], &'scope mut [E];
    #[cfg(feature = "alloc")] [E: AnyBytes] &'scope mut alloc::vec::Vec<E>, &'scope mut [E];
    #[cfg(feature = "alloc")] [E: AnyBytes] &'scope mut alloc::boxed::Box<[E]>, &'scope mut [E];
}

impl<T: Lane, W: Width, S: Isa, E: Readable<T>> Over<'_, T, W, S, E> {
    /// [`map_into`](Self::map_into), but on x86-64 the stores go around the caches. If `to` is larger than those, this takes 10 to 45% less time, but
    /// on Skylake-X and Cascade Lake, where one thread takes up to 30% more, and eight take 20% less. If `to` fits, it is up to 20 times slower, and more below 1 KiB. `f` has to return as many lanes as it gets, and can't work on groups. It waits at its start and its end: for other loops, and for many short ones, see [`streaming`].
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (from, mut to) = (vec![1u8; 1000], vec![0; 1000]);
    /// over(&from).stream_into(&mut to, |v| v + 1);
    /// assert_eq!(to, [2; 1000]);
    /// # } example()
    /// ```
    #[doc(alias("Stream", "FlushStream", "non_temporal", "nontemporal", "movnt", "movntdq"))]
    #[op]
    #[track_caller]
    pub fn stream_into<U: Lane, X: Width>(self, to: &mut [impl Writable<U>], f: impl Fn(V<T, W, S>) -> V<U, X, S>) {
        require!("the result has to have as many lanes", V::<T, W, S>::LANES == V::<U, X, S>::LANES);
        let (s, from) = self.parts();
        if !s.fixed::<U, X>().streams(from.len()) {
            return self.map_into(to, f);
        }
        inlined_here!(s, f(a));
        let gap = ahead(to.as_ptr().addr(), from.as_ptr().addr());
        s.fixed().stream_all(
            &mut to[..from.len()],
            gap,
            #[inline(always)]
            |at| f(E::load_at(from, at, s)),
        )
    }
}

impl<T: Lane, W: Width, S: Isa, I: Items<T, W, S>> Columns<T, W, S, I> {
    /// [`map_into`](Self::map_into) with the stores of [`Over::stream_into`]. `f` can't work on groups.
    #[op]
    #[track_caller]
    pub fn stream_into<R: Lane, Y: Width>(self, to: &mut [impl Writable<R>], f: impl Fn(I::Item) -> V<R, Y, S>) {
        require!("the result has to have as many lanes", V::<T, W, S>::LANES == V::<R, Y, S>::LANES);
        let (s, len) = (self.isa(), self.len());
        if !s.fixed::<R, Y>().streams(len) {
            return self.map_into(to, f);
        }
        inlined_here!(s, f(a));
        let gap = self.behind(to.as_ptr().addr());
        s.fixed().stream_all(
            &mut to[..len],
            gap,
            #[inline(always)]
            |at| f(self.at(at)),
        )
    }
}

impl<T: Lane, W: Width, S: Isa> OverMut<'_, T, W, S> {
    /// [`fill_with`](Self::fill_with) with the stores of [`Over::stream_into`]. For what is larger than the caches, it is up to four times as fast, but little or no faster on Zen 4 and 5. On Skylake-X and Cascade Lake one thread takes 40% more time, and eight take 20% less.
    #[op]
    pub fn stream_fill_with(self, f: impl Fn(V<T::Unsigned, W, S>) -> V<T, W, S>) {
        let (s, to) = self.parts();
        if !s.fixed::<T, W>().streams(to.len()) {
            return OverMut::new(s, to).fill_with(f);
        }
        inlined_here!(s, f(a));
        s.fixed().stream_all(
            to,
            4096,
            #[inline(always)]
            |at| f(s.fixed().iota(Lane::from_usize(at))),
        )
    }
}

#[test]
fn gaps() {
    assert_eq!([ahead(8192, 4096), ahead(1, 4096), ahead(4096, 1), ahead(100, 8200)], [4096, 1, 4095, 92]);
    let (s, all, bits) = (crate::baseline(), [0u8; 300], [0u64; 5]);
    let (to, over) = (all.as_ptr().addr() + 100, |at: usize| Over::<u8, crate::B16, _, _>::new(s, &all[at..]));
    assert_eq!([over(10).zip(&all[30..]).behind(to), over(30).zip(&all[10..]).behind(to)], [70; 2]);
    assert_eq!([over(10).windows::<3>().behind(to), over(10).interleaved::<2>().behind(to)], [88, 4096]);
    assert_eq!(
        [over(10).enumerate::<u8>().behind(to), over(10).zip_bits(&bits).behind(to), over(10).pad(1).behind(to)],
        [90; 3]
    );
}
