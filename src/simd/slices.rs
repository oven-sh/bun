//! Sums, extremes, products and copies of slices, like `hwy/contrib/algo`, `dot` and `matvec`.

use crate::lane::Kind;
use crate::{Float, Isa, Lane, MaskOf, Readable, Simd, Tag, Width, Writable};
use core::hint::{black_box, select_unpredictable};

type V<S, T, W> = Simd<T, W, S>;

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// The last `left < LANES` values of `all`, which fills a vector, and `padding`. They are in the first lanes if `IN_PLACE`, and else anywhere.
    #[op]
    fn load_rest<const IN_PLACE: bool>(self, all: &[impl Readable<T>], left: usize, padding: V<S, T, W>) -> V<S, T, W> {
        let n = Self::LANES;
        return_if!(
            IN_PLACE && Self::SLIDES && crate::vector::two_tables::<S, T>(),
            self.end_of(self.load_any_last(all), padding, n - left)
        );
        return_if!(IN_PLACE && S::PARTIAL, self.load_any_or(&all[all.len() - left..], padding));
        return_if!(IN_PLACE, self.padded_with(self.first_n(left), self.load_any_last(all).down_by(n - left), padding));
        self.by_place(self.all_but_last(left), padding, self.load_any_last(all))
    }
    /// `rest`, which is the end of `all` and doesn't fill a vector, and zeros. Without masks, a partial load has branches that are hard to predict.
    #[op]
    pub(crate) fn load_end<E: Readable<T>>(self, all: &[E], rest: &[E]) -> V<S, T, W> {
        if const { Self::SLIDES && S::REGISTER == 16 && E::PLAIN } && all.len() >= Self::LANES {
            return live!(Self::SLIDES && S::REGISTER == 16, self.load_any_last(all).down_by(Self::LANES - rest.len()));
        }
        return_if!(crate::X86 && Self::CELLS_BY_BITS && E::PLAIN, self.load_masked::<false>(E::plain(rest)));
        E::load_partial(rest, self.simd())
    }
    /// LLVM unrolls short loops for x86 and Apple's CPUs only.
    pub(crate) const ROLLED: bool = S::A64 && crate::OPTIMIZED && W::BYTES <= 16;
    /// Four pipes with two cycles or more for each step need eight chains.
    const fn eight<A>() -> bool {
        Self::ROLLED && size_of::<A>() <= 16
    }
    pub(crate) const SLIDES: bool =
        (S::A64 && !S::PARTIAL || S::WASM || S::SSE41 && (W::BYTES < 64 || size_of::<T>() > 1 || S::AVX512VBMI))
            && W::BYTES >= 16
            && W::BYTES <= S::REGISTER;
    /// The lanes of `before` from `left` on, and then the first `left` of `rest`: what goes to the end of a slice in one store.
    #[op]
    pub(crate) fn end_of(self, before: V<S, T, W>, rest: V<S, T, W>, left: usize) -> V<S, T, W> {
        return_if!(
            S::A64,
            before
                .bitcast::<u8>()
                .concat_swizzle_dyn_relaxed(
                    rest.bitcast::<u8>(),
                    self.repartition::<u8>().iota((left * size_of::<T>()) as u8)
                )
                .bitcast()
        );
        return_if!(
            crate::vector::two_tables::<S, T>(),
            before.concat_swizzle_dyn_relaxed(rest, self.to_unsigned().iota(Lane::from_usize(left)))
        );
        return_if!(
            crate::X86 && V::<S, T, W>::SLIDES_BY_TABLE && (W::BYTES == 16 || size_of::<T>() < 4),
            before.spliced(left.min(Self::LANES), rest)
        );
        self.first_n(left).if_then_else(rest, before).rotate_elements_left_dyn(left)
    }
    /// The lanes of `v` from `seen < LANES` on, and then `or`.
    #[op]
    pub(crate) fn after_or(self, v: V<S, T, W>, seen: usize, or: T) -> V<S, T, W> {
        return_if!(crate::vector::two_tables::<S, T>(), self.end_of(v, self.set(or), seen));
        self.padded_with(self.first_n(Self::LANES - seen), v.down_by(seen), self.set(or))
    }
    /// How many values `from` starts after a multiple of the width.
    #[op]
    fn odd(self, from: &[impl Readable<T>]) -> usize {
        from.as_ptr().addr() / size_of::<T>() % Self::LANES
    }

    /// Folds the values into four accumulators that start as `init`, and joins those. The last vector is padded with
    /// `padding`. `Unroller`.
    #[op]
    pub(crate) fn fold<A: Copy>(
        self,
        from: &[impl Readable<T>],
        padding: T,
        init: A,
        step: impl Fn(A, V<S, T, W>) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        self.fold_in::<true, false, A>(from, padding, init, step, join)
    }
    /// Whether so many of these leave enough registers.
    const fn fit<A>(states: usize) -> bool {
        !crate::OPTIMIZED || S::SCALAR || states * size_of::<A>() <= S::REGISTERS * 3 / 4 * S::REGISTER
    }
    /// Not if it mostly waits for loads.
    const fn in_turns<A>() -> bool {
        !Self::fit::<A>(if size_of::<A>() < 3 * W::BYTES && !S::ARM { 2 } else { 4 })
    }
    /// What `fold` does if its four states don't. They get the same vectors, two or one at a time, in parts that stay in the cache.
    #[op]
    fn fold_in_turns<E, F, A: Copy>(
        mut x: &[E],
        mut y: &[F],
        init: A,
        step: impl Fn(A, &[E], &[F]) -> A,
        last: impl Fn(A) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        let (n, most, each) = (Self::LANES, 4096 / size_of::<T>(), 1 + Self::fit::<A>(2) as usize);
        let turn = always!(|mut a: A, mut b: A, k: usize, mut x: &[E], mut y: &[F], ahead: bool| {
            while x.len() >= 4 * n && y.len() >= 4 * n {
                let (p, q) = (&x[..4 * n], &y[..4 * n]);
                for line in 0..if ahead { (each * W::BYTES).div_ceil(64) } else { 0 } {
                    crate::prefetch::prefetch(p, most + k * n + line * (64 / size_of::<T>()));
                    crate::prefetch::prefetch(q, most + k * n + line * (64 / size_of::<T>()));
                }
                a = step(a, &p[k * n..], &q[k * n..]);
                when!(Self::fit::<A>(2), b = step(b, &p[(k | 1) * n..], &q[(k | 1) * n..]));
                (x, y) = (&x[4 * n..], &y[4 * n..]);
            }
            (a, b)
        });
        if x.len() < 2 * n {
            return join(join(init, init), join(last(init), step(init, x, y)));
        }
        if x.len() < 4 * n {
            let lower = join(step(init, x, y), step(init, &x[n..], &y[n..]));
            let d = if x.len() < 3 * n { init } else { step(init, &x[2 * n..], &y[2 * n..]) };
            return join(lower, join(last(init), d));
        }
        let (mut kept, long) = ([None; 4], x.len() > 2 * most);
        while x.len() > 2 * most && y.len() > 2 * most {
            let mut k = 0;
            while k < 4 {
                let all = black_box(&mut kept);
                let (a, b) = turn(all[k].unwrap_or(init), all[k | 1].unwrap_or(init), k, &x[..most], &y[..most], true);
                when!(Self::fit::<A>(2), all[k | 1] = Some(b));
                all[k] = Some(a);
                k = black_box(k + each);
            }
            (x, y) = (&x[most..], &y[most..]);
        }
        let two = always!(|k: usize| {
            let (a, b) = if long { (kept[k].unwrap_or(init), kept[k + 1].unwrap_or(init)) } else { (init, init) };
            choose! { Self::fit::<A>(2) => turn(a, b, k, x, y, false), _ => (turn(a, a, k, x, y, false).0, turn(b, b, k + 1, x, y, false).0) }
        });
        let ((mut a, mut b), whole) = (two(0), x.len() & !(4 * n - 1));
        let (mut p, mut q) = (&x[whole..], &y[whole..]);
        if p.len() >= 2 * n && q.len() >= 2 * n {
            (a, b, p, q) = (step(a, p, q), step(b, &p[n..], &q[n..]), &p[2 * n..], &q[2 * n..]);
        }
        let (lower, (c, mut d)) = (join(a, b), two(2));
        if p.len() >= n && q.len() >= n {
            d = step(d, p, q);
        }
        join(lower, join(last(c), d))
    }
    /// With `ALIGN`, what goes to which lane depends on the address.
    #[inline(always)]
    pub(crate) fn fold_in<const IN_PLACE: bool, const ALIGN: bool, A: Copy>(
        self,
        from: &[impl Readable<T>],
        padding: T,
        init: A,
        step: impl Fn(A, V<S, T, W>) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        apart_unoptimized!(self.simd(), {
            let zero = S::A64 && crate::arithmetic::known(crate::Int::to_u64(T::unsigned(&[padding])[0]) == 0);
            let (n, padding) = (Self::LANES, self.set(padding));
            if from.len() < n {
                let short = always!(|| if zero { self.load_any_n(from) } else { self.load_any_or(from, padding) });
                let only = if IN_PLACE && from.is_empty() { init } else { step(init, short()) };
                return choose! { IN_PLACE => join(join(init, init), join(only, init)), _ => only };
            }
            return_if!(!ALIGN && Self::in_turns::<A>(), {
                let left = from.len() % n;
                let last = always!(|c| if IN_PLACE && left == 0 {
                    c
                } else {
                    step(c, self.load_rest::<IN_PLACE>(from, left, padding))
                });
                Self::fold_in_turns(
                    from,
                    from,
                    init,
                    #[inline(always)]
                    |it, x, _| step(it, self.load_any(x)),
                    last,
                    &join,
                )
            });
            let [mut a, mut b, mut c, mut d] = [init; 4];
            // Then the padding is zero.
            let ends = const { !IN_PLACE && Self::ROLLED && W::BYTES == 16 };
            let new = always!(|sum: A, k: usize, len: usize, i: usize| live!(
                S::A64,
                step(sum, self.unseen_of(self.load_any(&from[from.len() - k * n..][i * n..]), len.wrapping_neg(), i))
            ));
            if ends && from.len() <= 2 * n {
                return join(step(a, self.load_any(from)), new(b, 1, from.len() + 2 * n, 0));
            }
            if ends && from.len() <= 4 * n {
                let len = from.len();
                (a, b) = (step(a, self.load_any(from)), step(b, self.load_any(&from[n..])));
                return join(join(a, b), join(new(c, 2, len, 0), new(d, 2, len, 1)));
            }
            macro_rules! four {
                ($of:ident) => {
                    (a, b) = (step(a, self.load_any($of)), step(b, self.load_any(&$of[n..])));
                    (c, d) = (step(c, self.load_any(&$of[2 * n..])), step(d, self.load_any(&$of[3 * n..])));
                };
            }
            let mut rest = from;
            if (ALIGN || ends) && from.len() >= if ends { 64 * n } else { 16 * n } {
                if ALIGN {
                    let first = n - self.odd(from);
                    (d, rest) =
                        (step(d, self.by_place(self.first_n(first), self.load_any(from), padding)), &from[first..]);
                }
                if ends {
                    let [mut e, mut f, mut g, mut h] = [init; 4];
                    while rest.len() > 8 * n {
                        four!(rest);
                        let at = always!(|i: usize| self.load_any(&rest[i * n..]));
                        (e, f, g, h) = (step(e, at(4)), step(f, at(5)), step(g, at(6)), step(h, at(7)));
                        rest = &rest[8 * n..];
                    }
                    (a, b, c, d) = (join(a, e), join(b, f), join(c, g), join(d, h));
                }
            }
            if ends {
                let len = rest.len();
                while rest.len() > 4 * n {
                    crate::not_unrolled();
                    four!(rest);
                    rest = &rest[4 * n..];
                }
                return join(join(new(a, 4, len, 0), new(b, 4, len, 1)), join(new(c, 4, len, 2), new(d, 4, len, 3)));
            }
            while let Some((chunk, after)) = rest.split_at_checked(4 * n) {
                four!(chunk);
                rest = after;
            }
            // A loop would have to move the accumulators.
            if rest.len() >= n {
                if rest.len() >= 2 * n {
                    (a, b, rest) = (step(a, self.load_any(rest)), step(b, self.load_any(&rest[n..])), &rest[2 * n..]);
                }
                if rest.len() >= n {
                    (d, rest) = (step(d, self.load_any(rest)), &rest[n..]);
                }
            }
            if !IN_PLACE || !rest.is_empty() {
                c = step(c, self.load_rest::<IN_PLACE>(from, rest.len(), padding));
            }
            join(join(a, b), join(c, d))
        })
    }

    /// The same for two slices of the same length, which are padded with zeros.
    #[inline(always)]
    pub(crate) fn fold2<const IN_PLACE: bool, U: Lane, X: Width, A: Copy>(
        self,
        x: &[impl Readable<T>],
        other: Tag<S, U, X>,
        y: &[impl Readable<U>],
        init: A,
        step: impl Fn(A, V<S, T, W>, V<S, U, X>) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        apart_unoptimized!(self.simd(), {
            let n = Self::LANES;
            assert!(x.len() == y.len());
            if x.len() < n {
                let only =
                    if IN_PLACE && x.is_empty() { init } else { step(init, self.load_any_n(x), other.load_any_n(y)) };
                return choose! { IN_PLACE => join(join(init, init), join(only, init)), _ => only };
            }
            let (mut p, mut q) = (x, y);
            let last = always!(|c| {
                let left = x.len() % n;
                step(
                    c,
                    self.load_rest::<IN_PLACE>(x, left, self.zero()),
                    other.load_rest::<IN_PLACE>(y, left, other.zero()),
                )
            });
            return_if!(Self::in_turns::<A>(), {
                let last = always!(|c| if IN_PLACE && x.len() % n == 0 { c } else { last(c) });
                Self::fold_in_turns(
                    x,
                    y,
                    init,
                    #[inline(always)]
                    |it, x, y| step(it, self.load_any(x), other.load_any(y)),
                    last,
                    &join,
                )
            });
            let [mut a, mut b, mut c, mut d] = [init; 4];
            let ends = const { !IN_PLACE && Self::ROLLED && W::BYTES == 16 && X::BYTES == 16 };
            let new = always!(|sum: A, k: usize, len: usize, i: usize| live!(S::A64, {
                let (at, seen) = (x.len() - k * n, len.wrapping_neg());
                let v = other.load_any(&y[at..][i * n..]);
                step(
                    sum,
                    self.unseen_of(self.load_any(&x[at..][i * n..]), seen, i),
                    choose! { U::IS_FLOAT => other.unseen_of(v, seen, i), _ => v },
                )
            }));
            let first = always!(|i: usize| step(init, self.load_any(&x[i * n..]), other.load_any(&y[i * n..])));
            if ends && x.len() <= 2 * n {
                return join(first(0), new(b, 1, x.len() + 2 * n, 0));
            }
            if ends && x.len() <= 4 * n {
                let len = x.len();
                return join(join(first(0), first(1)), join(new(c, 2, len, 0), new(d, 2, len, 1)));
            }
            const fn aligns<S: Isa, T: Lane, W: Width>(in_place: bool) -> bool {
                !in_place && !T::IS_FLOAT && S::AVX2 && W::BYTES >= 32
            }
            if const { aligns::<S, T, W>(IN_PLACE) } && x.len() >= 16 * n {
                let first = n - self.odd(x);
                d = step(d, self.first_n(first).if_then_else_zero(self.load_any(x)), other.load_any(y));
                (p, q) = (&x[first..], &y[first..]);
            }
            while p.len() >= 4 * n + ends as usize && q.len() >= 4 * n + ends as usize {
                let (g, h) = (&p[..4 * n], &q[..4 * n]);
                (a, b) = (
                    step(a, self.load_any(g), other.load_any(h)),
                    step(b, self.load_any(&g[n..]), other.load_any(&h[n..])),
                );
                c = step(c, self.load_any(&g[2 * n..]), other.load_any(&h[2 * n..]));
                d = step(d, self.load_any(&g[3 * n..]), other.load_any(&h[3 * n..]));
                (p, q) = (&p[4 * n..], &q[4 * n..]);
            }
            if ends {
                let len = x.len();
                return join(join(new(a, 4, len, 0), new(b, 4, len, 1)), join(new(c, 4, len, 2), new(d, 4, len, 3)));
            }
            if p.len() >= n {
                if p.len() >= 2 * n && q.len() >= 2 * n {
                    (a, b) = (
                        step(a, self.load_any(p), other.load_any(q)),
                        step(b, self.load_any(&p[n..]), other.load_any(&q[n..])),
                    );
                    (p, q) = (&p[2 * n..], &q[2 * n..]);
                }
                if p.len() >= n && q.len() >= n {
                    (d, p) = (step(d, self.load_any(p), other.load_any(q)), &p[n..]);
                }
            }
            if !IN_PLACE || !p.is_empty() {
                let left = if const { aligns::<S, T, W>(IN_PLACE) } { p.len() % n } else { x.len() % n };
                c = step(
                    c,
                    self.load_rest::<IN_PLACE>(x, left, self.zero()),
                    other.load_rest::<IN_PLACE>(y, left, other.zero()),
                );
            }
            join(join(a, b), join(c, d))
        })
    }

    /// For what stays the same if it gets a value twice. `from` is not empty.
    #[op]
    pub(crate) fn fold_overlapping<A: Copy>(
        self,
        from: &[impl Readable<T>],
        first: impl Fn(V<S, T, W>) -> A,
        step: impl Fn(A, V<S, T, W>) -> A,
        join: impl Fn(A, A) -> A,
    ) -> A {
        self.fold_pairs(from, first, always!(|(a, b), v, w| (step(a, v), step(b, w))), join)
    }
    /// The same, two vectors at a time.
    #[inline(always)]
    fn fold_pairs<A: Copy>(
        self,
        from: &[impl Readable<T>],
        first: impl Fn(V<S, T, W>) -> A,
        step: impl Fn((A, A), V<S, T, W>, V<S, T, W>) -> (A, A),
        join: impl Fn(A, A) -> A,
    ) -> A {
        apart_unoptimized!(self.simd(), {
            let (n, len) = (Self::LANES, from.len());
            if len < n {
                return first(
                    choose! { S::PARTIAL => self.load_any_or(from, from[0].value()), S::A64 && Self::IN_QUARTERS => self.load_quarters(Readable::source(from)).0, _ => self.load_ends(Readable::source(from)) },
                );
            }
            let (mut a, mut d) = (first(self.load_any(from)), first(self.load_any_last(from)));
            if len <= 2 * n {
                return join(a, d);
            }
            let (mut b, mut c) = (first(self.load_any(&from[n..])), first(self.load_any(&from[len - 2 * n..])));
            if len > 4 * n {
                let mut rest = &from[2 * n - self.odd(from)..];
                if const { Self::eight::<A>() } && len >= 64 * n {
                    let [mut e, mut f, mut g, mut h] = [a, b, c, d];
                    while rest.len() > 8 * n {
                        let at = always!(|i: usize| self.load_any(&rest[i * n..]));
                        ((a, b), (c, d)) = (step((a, b), at(0), at(1)), step((c, d), at(2), at(3)));
                        ((e, f), (g, h)) = (step((e, f), at(4), at(5)), step((g, h), at(6), at(7)));
                        rest = &rest[8 * n..];
                    }
                    (a, b, c, d) = (join(a, e), join(b, f), join(c, g), join(d, h));
                }
                while rest.len() > 4 * n {
                    (a, b) = step((a, b), self.load_any(rest), self.load_any(&rest[n..]));
                    (c, d) = step((c, d), self.load_any(&rest[2 * n..]), self.load_any(&rest[3 * n..]));
                    rest = &rest[4 * n..];
                }
                let last = &from[len - 4 * n..];
                (a, b) = step((a, b), self.load_any(last), self.load_any(&last[n..]));
            }
            join(join(a, b), join(c, d))
        })
    }

    /// Integers wrap. The order of the additions is unspecified.
    #[op]
    pub(crate) fn sum(self, values: &[impl Readable<T>]) -> T {
        let add = always!(|a, b| a + b);
        let zero = (T::default(), self.zero());
        return_if!(Self::ONE_BY_ONE && !matches!(T::KIND, Kind::Float), self.fold_ones(values, zero.0, add));
        return_if!(
            matches!(T::KIND, Kind::Float),
            self.fold_in::<false, false, _>(values, zero.0, zero.1, add, add).reduce_sum()
        );
        self.fold_in::<false, true, _>(values, zero.0, zero.1, add, add).reduce_sum()
    }
    /// Lane by lane, in any lane. `step` adds nothing for `padding`, which is zero on Arm.
    #[op]
    pub(crate) fn add_up<U: Lane>(
        self,
        values: &[impl Readable<T>],
        padding: T,
        step: impl Fn(V<S, U, W>, V<S, T, W>) -> V<S, U, W>,
    ) -> V<S, U, W> {
        self.fold_in::<false, true, _>(values, padding, self.repartition().zero(), step, always!(|a, b| a + b))
    }
    /// SSE and AVX2 compare lanes of 64 bits with a sign only. What was found so far stays in that order.
    const AS_SIGNED: bool =
        crate::X86 && S::REGISTER < 64 && !S::SCALAR && T::BITS == 64 && matches!(T::KIND, Kind::Unsigned);
    #[op]
    fn signed(v: V<S, T, W>) -> V<S, i64, W> {
        v.bitcast::<i64>() ^ i64::MIN
    }
    #[op]
    fn unsigned(found: i64) -> T {
        T::from_u64((found ^ i64::MIN) as u64)
    }
    /// SSE2 can't compare integers of 64 bits.
    const BY_NUMBERS: bool = cfg!(target_arch = "x86_64") && S::ONLY_SSE2 && T::BITS == 64 && !T::IS_FLOAT;
    #[on(X86)]
    #[op]
    fn extremes(self, values: &[impl Readable<T>]) -> Option<(T, T)> {
        let join = always!(|(min, max): (T, T), (a, b): (T, T)| {
            (select_unpredictable(a < min, a, min), select_unpredictable(b > max, b, max))
        });
        let both = always!(|it: T| (it, it));
        // It is left over if the length is odd.
        let [mut a, mut b] = [both(values.last()?.value()); 2];
        for [x, y] in values.as_chunks().0 {
            crate::not_unrolled();
            (a, b) = (join(a, both(x.value())), join(b, both(y.value())));
        }
        Some(join(a, b))
    }
    /// The result is unspecified if a value is NaN. `MinValue`.
    #[op]
    pub(crate) fn min_value(self, values: &[impl Readable<T>]) -> Option<T> {
        return_if!(crate::X86 && Self::BY_NUMBERS, Some(self.extremes(values)?.0));
        let min = always!(|a: V<S, T, W>, b: V<S, T, W>| a.simd_min_relaxed(b));
        return_if!(
            Self::ONE_BY_ONE,
            values.split_first().map(
                #[inline(always)]
                |(first, rest)| self.fold_ones(rest, first.value(), min)
            )
        );
        return_if!(
            Self::AS_SIGNED,
            if values.is_empty() {
                None
            } else {
                let min = always!(|a: V<S, i64, W>, b| a.simd_min(b));
                Some(Self::unsigned(
                    self.fold_overlapping(
                        values,
                        Self::signed,
                        #[inline(always)]
                        |a, v| min(a, Self::signed(v)),
                        min,
                    )
                    .reduce_min(),
                ))
            }
        );
        if values.is_empty() {
            None
        } else {
            Some(
                self.fold_overlapping(
                    values,
                    #[inline(always)]
                    |v| v,
                    min,
                    min,
                )
                .reduce_min_relaxed(),
            )
        }
    }
    /// The result is unspecified if a value is NaN. `MaxValue`.
    #[op]
    pub(crate) fn max_value(self, values: &[impl Readable<T>]) -> Option<T> {
        return_if!(crate::X86 && Self::BY_NUMBERS, Some(self.extremes(values)?.1));
        let max = always!(|a: V<S, T, W>, b: V<S, T, W>| a.simd_max_relaxed(b));
        return_if!(
            Self::ONE_BY_ONE,
            values.split_first().map(
                #[inline(always)]
                |(first, rest)| self.fold_ones(rest, first.value(), max)
            )
        );
        return_if!(
            Self::AS_SIGNED,
            if values.is_empty() {
                None
            } else {
                let max = always!(|a: V<S, i64, W>, b| a.simd_max(b));
                Some(Self::unsigned(
                    self.fold_overlapping(
                        values,
                        Self::signed,
                        #[inline(always)]
                        |a, v| max(a, Self::signed(v)),
                        max,
                    )
                    .reduce_max(),
                ))
            }
        );
        if values.is_empty() {
            None
        } else {
            Some(
                self.fold_overlapping(
                    values,
                    #[inline(always)]
                    |v| v,
                    max,
                    max,
                )
                .reduce_max_relaxed(),
            )
        }
    }
    /// Both in one pass.
    #[op]
    pub(crate) fn min_max_value(self, values: &[impl Readable<T>]) -> Option<(T, T)> {
        return_if!(crate::X86 && Self::BY_NUMBERS, self.extremes(values));
        if values.is_empty() {
            return None;
        }
        return_if!(Self::AS_SIGNED, {
            let join = always!(|a: (V<S, i64, W>, V<S, i64, W>), b: (_, _)| (a.0.simd_min(b.0), a.1.simd_max(b.1)));
            let both = always!(|v| (Self::signed(v), Self::signed(v)));
            let (min, max) = self.fold_overlapping(
                values,
                both,
                #[inline(always)]
                |a, v| join(a, both(v)),
                join,
            );
            Some((Self::unsigned(min.reduce_min()), Self::unsigned(max.reduce_max())))
        });
        let step =
            always!(|a: (V<S, T, W>, V<S, T, W>), min, max| (a.0.simd_min_relaxed(min), a.1.simd_max_relaxed(max)));
        let (min, max) = self.fold_pairs(
            values,
            #[inline(always)]
            |v| (v, v),
            #[inline(always)]
            |(a, b), v, w| {
                // Intel has one port for these.
                return_if!(S::AVX512F && S::REGISTER == 64 && W::BYTES >= 64 && !T::IS_FLOAT, {
                    let min = v.simd_min_relaxed(w);
                    (step(a, min, min.xor3(v, w)), b)
                });
                (step(a, v, v), step(b, w, w))
            },
            #[inline(always)]
            |a, b| (a.0.simd_min_relaxed(b.0), a.1.simd_max_relaxed(b.1)),
        );
        Some((min.reduce_min_relaxed(), max.reduce_max_relaxed()))
    }
    /// The first index at which two slices of the same length match.
    #[inline(always)]
    pub(crate) fn find2_if<U: Lane, X: Width, E: Readable<T>, F: Readable<U>>(
        self,
        x: &[E],
        other: Tag<S, U, X>,
        y: &[F],
        matches: impl Fn(V<S, T, W>, V<S, U, X>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        apart_unoptimized!(self.simd(), {
            return_if!(Self::ONE_BY_ONE, self.find_pair((x, other, y), matches));
            let (n, len) = (Self::LANES, x.len().min(y.len()));
            let (x, y) = (&x[..len], &y[..len]);
            if len < n {
                return_if!(Self::BY_BITS && Self::LANES <= 64, {
                    let at = matches(self.load_any_n(x), other.load_any_n(y)).to_bitmask().trailing_zeros() as usize;
                    (at < len).then_some(at)
                });
                return_if!(S::SVE2, {
                    let at = matches(self.load_any_n(x), other.load_any_n(y)).count_before_first();
                    (at < len).then_some(at)
                });
                return_if!(
                    S::PARTIAL,
                    (self.first_n(len) & matches(self.load_any_n(x), other.load_any_n(y))).first_set()
                );
                if len == 0 {
                    return None;
                }
                let (v, quarters) = self.load_quarters(Readable::source(x));
                let lane = matches(v, other.load_quarters(Readable::source(y)).0).first_set()?;
                return Some(self.place(quarters, lane, len));
            }
            let at = always!(|x: &[E], y: &[F], i: usize| matches(self.load_any(&x[i..]), other.load_any(&y[i..])));
            if let Some(at) = self.find_in::<false>(at(x, y, 0)) {
                return Some(at);
            }
            if len > 2 * n {
                let both = always!(|x: &[E], y: &[F], i: usize| (self.load_any(&x[i..]), other.load_any(&y[i..])));
                let four = always!(|x: &[E], y: &[F]| {
                    self.first_pair::<false, _, _>(
                        [both(x, y, 0), both(x, y, n), both(x, y, 2 * n), both(x, y, 3 * n)],
                        &matches,
                    )
                });
                if len <= 4 * n {
                    // One mask, used twice.
                    let last = both(x, y, len - n);
                    let at =
                        self.first_pair::<true, _, _>([both(x, y, n), both(x, y, len - 2 * n), last, last], &matches)?;
                    return Some(at.wrapping_add(select_unpredictable(at < n, n, len.wrapping_sub(3 * n))));
                }
                // Many differ soon, and then a group takes too long.
                let single = if const { crate::X86 && W::BYTES <= 32 } { 4 } else { 1 };
                macro_rules! one { ($($i:literal)*) => {$(
                if $i < single && let Some(at) = self.find_in::<false>(at(x, y, $i * n)) {
                    return Some($i * n + at);
                }
            )*}; }
                one!(1 2 3);
                let skip = single * n - self.odd(x);
                // To keep the masks would take copies of registers, so the group with the match is loaded again.
                return_if!(S::SSE2 && S::REGISTER == 16 && W::BYTES == 16 && E::PLAIN && F::PLAIN, {
                    let (mut done, last) = (skip, len - 4 * n);
                    while done < last {
                        let (p, q) = (&x[done..][..4 * n], &y[done..][..4 * n]);
                        if !(at(p, q, 0) | at(p, q, n)).neither(at(p, q, 2 * n) | at(p, q, 3 * n)) {
                            break;
                        }
                        done += 4 * n;
                    }
                    let done = crate::tag::uncounted(done).min(last);
                    four(&x[done..], &y[done..]).map(|at| done + at)
                });
                let (mut p, mut q) = (&x[skip..], &y[skip..]);
                loop {
                    if p.len() <= 4 * n || q.len() <= 4 * n {
                        crate::hints::leaves();
                        break;
                    }
                    if let Some(at) = four(p, q) {
                        return Some(len - p.len() + at);
                    }
                    (p, q) = (&p[4 * n..], &q[4 * n..]);
                }
                return four(&x[len - 4 * n..], &y[len - 4 * n..]).map(|at| len - 4 * n + at);
            }
            let last = at(x, y, len - n);
            // With `first_set` here, LLVM makes a branch of the choice for `len < n`.
            return_if!(S::SVE2, if last.none() { None } else { Some(len - n + last.count_before_first()) });
            self.find_in::<false>(last).map(|at| len - n + at)
        })
    }
    #[op]
    fn pair_masks<const TWICE: bool, U: Lane, X: Width>(
        [a, b, c, d]: [(V<S, T, W>, V<S, U, X>); 4],
        matches: &impl Fn(V<S, T, W>, V<S, U, X>) -> MaskOf<T, W, S>,
    ) -> [MaskOf<T, W, S>; 4] {
        let (a, b, c) = (matches(a.0, a.1), matches(b.0, b.1), matches(c.0, c.1));
        [a, b, c, choose! { TWICE => c, _ => matches(d.0, d.1) }]
    }
    #[op]
    fn any_pair<const TWICE: bool, U: Lane, X: Width>(
        v: [(V<S, T, W>, V<S, U, X>); 4],
        matches: &impl Fn(V<S, T, W>, V<S, U, X>) -> MaskOf<T, W, S>,
    ) -> Option<([(V<S, T, W>, V<S, U, X>); 4], [MaskOf<T, W, S>; 4])> {
        let found = Self::pair_masks::<TWICE, _, _>(v, matches);
        if (found[0] | found[1]).neither(found[2] | found[3]) { None } else { Some((v, found)) }
    }
    /// In four pairs of vectors as if they were one. With `TWICE`, the last two are the same.
    #[op]
    fn first_pair<const TWICE: bool, U: Lane, X: Width>(
        self,
        v: [(V<S, T, W>, V<S, U, X>); 4],
        matches: &impl Fn(V<S, T, W>, V<S, U, X>) -> MaskOf<T, W, S>,
    ) -> Option<usize> {
        let (v, found) = if const { S::AVX2 } {
            let found = Self::pair_masks::<TWICE, _, _>(v, matches);
            if (found[0] | found[1]).neither(found[2] | found[3]) {
                return None;
            }
            crate::hints::leaves();
            (v, found)
        } else {
            Self::any_pair::<TWICE, _, _>(v, matches)?
        };
        Some(
            choose! { Self::AGAIN => self.first_in_four(Self::pair_masks::<TWICE, _, _>(v, matches)) & (4 * Self::LANES - 1), _ => self.first_in_four(found) },
        )
    }
    /// Whether the two match at all indices, or at any.
    #[inline(always)]
    pub(crate) fn test2<const ALL: bool, U: Lane, X: Width>(
        self,
        x: &[impl Readable<T>],
        other: Tag<S, U, X>,
        y: &[impl Readable<U>],
        matches: impl Fn(V<S, T, W>, V<S, U, X>) -> MaskOf<T, W, S>,
    ) -> bool {
        apart_unoptimized!(self.simd(), {
            let (n, len) = (Self::LANES, x.len().min(y.len()));
            let (x, y) = (&x[..len], &y[..len]);
            let join = always!(|a: MaskOf<T, W, S>, b| if ALL { a & b } else { a | b });
            let end = always!(|mask: MaskOf<T, W, S>| if ALL { mask.all() } else { mask.any() });
            if len < n {
                return_if!(S::PARTIAL, {
                    let (found, valid) = (matches(self.load_any_n(x), other.load_any_n(y)), self.first_n(len));
                    if ALL { found.and_not(valid).none() } else { (found & valid).any() }
                });
                return if len == 0 {
                    ALL
                } else {
                    end(matches(self.load_quarters(Readable::source(x)).0, other.load_quarters(Readable::source(y)).0))
                };
            }
            let two = always!(|at: usize, len: usize| {
                let (x, y) = (&x[at..][..len], &y[at..][..len]);
                join(
                    matches(self.load_any(x), other.load_any(y)),
                    matches(self.load_any_last(x), other.load_any_last(y)),
                )
            });
            if len <= 2 * n {
                return end(two(0, len));
            }
            let four = always!(|a: usize, b: usize| end(join(two(a, 2 * n), two(b, 2 * n))));
            if len <= 4 * n {
                return four(0, len - 2 * n);
            }
            let (first, last) = (if const { W::BYTES < 64 } { 4 * n } else { 2 * n }, len - 4 * n);
            if choose! { W::BYTES < 64 => four(0, 2 * n), _ => end(two(0, 2 * n)) } != ALL {
                return !ALL;
            }
            if last > first {
                let mut done = Self::back(first, self.odd(x));
                while done < last {
                    if four(done, done + 2 * n) != ALL {
                        crate::hints::leaves();
                        return !ALL;
                    }
                    done += 4 * n;
                }
            }
            four(last, last + 2 * n)
        })
    }
    /// `Find`.
    #[op]
    pub(crate) fn find(self, within: &[impl Readable<T>], value: T) -> Option<usize> {
        self.find_if(
            Readable::source(within),
            #[inline(always)]
            |v| v.simd_eq(value),
        )
    }

    /// Whether to use the function below.
    const FOUR_AT_ONCE: bool =
        S::ARM && cfg!(target_endian = "little") && W::BYTES == 16 && size_of::<T>() > 1 && !V::<S, T, W>::COMPACTS;
    /// The bits of each mask, and how many are set up to it, but for what is above `8 * LANES`. NEON takes long to move them one by one.
    #[op]
    fn bits_of_four(self, masks: [MaskOf<T, W, S>; 4]) -> ([u64; 4], [usize; 4]) {
        macro_rules! pairs {
            ($t:ty, $weights:expr) => {{
                let at = always!(
                    |i: usize| masks[i].to_vector().bitcast::<$t>() & self.repartition::<$t>().dup128($weights)
                );
                (at(0).pairwise_add128(at(1)), at(2).pairwise_add128(at(3)))
            }};
        }
        let all = choose! {
            size_of::<T>() == 2 => {
                let (a, b) = pairs!(u16, [257, 258, 260, 264, 272, 288, 320, 384]); let v = a.pairwise_add128(b); v.pairwise_add128(v)
            },
            size_of::<T>() == 4 => {
                let (a, b) = pairs!(u32, [257, 258, 260, 264]); let v = a.pairwise_add128(b).bitcast::<u16>(); v.tag().concat_even(v, v)
            },
            _ => {
                let (a, b) = pairs!(u64, [257, 258]); let v = self.repartition::<u32>().concat_even(b.bitcast(), a.bitcast()).bitcast::<u16>(); v.tag().concat_even(v, v)
            },
        };
        let all = all.bitcast::<u64>().get_lane();
        let sums = (all >> 8 & 0x000f_000f_000f_000f).wrapping_mul(0x0001_0001_0001_0001);
        let sum = always!(|i: u32, below: usize| (sums >> (16 * i)) as usize & (below - 1));
        let n = Self::LANES;
        ([all, all >> 16, all >> 32, all >> 48], [sum(0, 4 * n), sum(1, 4 * n), sum(2, 4 * n), sum(3, 8 * n)])
    }
    /// `to` needs room for five vectors if `FOUR_AT_ONCE`, and else for four.
    #[op]
    pub(crate) fn compress_four(
        self,
        v: [V<S, T, W>; 4],
        matches: impl Fn(usize) -> MaskOf<T, W, S>,
        to: &mut [impl Writable<T>],
    ) -> usize {
        return_if!(Self::FOUR_AT_ONCE, {
            let kept = [matches(0), matches(1), matches(2), matches(3)];
            let (bits, ends) = self.bits_of_four(kept);
            let part = always!(
                |i: usize| choose! { V::<S, T, W>::PAIR => v[i].compress_mask(kept[i]), _ => v[i].compress_own(bits[i]) }
            );
            part(0).store(to);
            part(1).store(&mut to[ends[0]..]);
            part(2).store(&mut to[ends[1]..]);
            part(3).store(&mut to[ends[2]..]);
            ends[3]
        });
        let mut at = 0;
        unrolled!(4 theirs, for i in 0..4 {
            at += v[i].compress_mask_store(matches(i), &mut to[at..]);
        });
        at
    }
    /// The same for an empty output.
    #[op]
    pub(crate) fn push_four(
        self,
        v: [V<S, T, W>; 4],
        matches: &impl Fn(V<S, T, W>) -> MaskOf<T, W, S>,
        to: &mut crate::Output<'_, T>,
    ) {
        return_if!(Self::FOUR_AT_ONCE && !V::<S, T, W>::PAIR, {
            let bits = self.bits_of_four([matches(v[0]), matches(v[1]), matches(v[2]), matches(v[3])]).0;
            to.push_compressed_bits(v[0], bits[0]);
            to.push_compressed_bits(v[1], bits[1]);
            to.push_compressed_bits(v[2], bits[2]);
            to.push_compressed_bits(v[3], bits[3])
        });
        unrolled!(4 theirs, for i in 0..4 {
            let kept = matches(v[i]);
            choose! { Self::LANES <= 64 => to.push_compressed(v[i], kept), _ => to.push_first(v[i].compress_mask(kept), kept.count()) }
        });
    }
    #[op]
    pub(crate) fn load_four(self, from: &[impl Readable<T>]) -> [V<S, T, W>; 4] {
        let (n, from) = (Self::LANES, &from[..4 * Self::LANES]);
        [self.load_any(from), self.load_any(&from[n..]), self.load_any(&from[2 * n..]), self.load_any(&from[3 * n..])]
    }
    /// Copies the values that match to the start of `to`, and returns their number. What is after them in `to` can
    /// change. Panics if they don't fit. `CopyIf`.
    #[op]
    pub(crate) fn copy_if(
        self,
        from: &[impl Readable<T>],
        to: &mut [impl Writable<T>],
        matches: impl Fn(V<S, T, W>) -> MaskOf<T, W, S>,
    ) -> usize {
        return_if!(S::SCALAR, self.copy_ones(from, to, matches));
        let (n, all) = (Self::LANES, to.len());
        if from.len() < n {
            let (counts, v) = (self.first_n(from.len()), self.load_any_n(from));
            return self.put_kept(v, (counts & matches(v)).whole_lanes(), to);
        }
        let (last, mut rest, mut room) = (self.load_any_last(from), from, to);
        while rest.len() >= 4 * n && room.len() >= if const { Self::FOUR_AT_ONCE } { 5 * n } else { 4 * n } {
            let v = self.load_four(rest);
            let count = self.compress_four(v, always!(|i: usize| matches(v[i])), room);
            (rest, room) = (&rest[4 * n..], &mut room[count..]);
        }
        while rest.len() >= n && room.len() >= n {
            crate::not_unrolled();
            let v = self.load_any(rest);
            let count = v.compress_mask_store(matches(v), room);
            (rest, room) = (&rest[n..], &mut room[count..]);
        }
        while rest.len() >= n {
            crate::not_unrolled();
            let v = self.load_any(rest);
            let kept = matches(v);
            rest = &rest[n..];
            // With so little room, most have nothing.
            if rest.len() < 4 * n || kept.any() {
                let count = self.put_kept(v, kept, room);
                room = &mut room[count..];
            }
        }
        all - room.len() + self.put_kept(last, (!self.first_n(n - rest.len()) & matches(last)).whole_lanes(), room)
    }
    #[inline(always)]
    fn put_kept<E: Writable<T>>(self, v: V<S, T, W>, kept: MaskOf<T, W, S>, to: &mut [E]) -> usize {
        apart_unoptimized!(self.simd(), |to: &mut [E]| {
            if to.len() >= Self::LANES {
                return v.compress_mask_store(kept, to);
            }
            let count = to[..kept.count()].len();
            // Without masks, the branches follow the room, which is easier to predict.
            v.compress_mask(kept).store_rest(if const { Self::BY_BITS } { &mut to[..count] } else { to });
            count
        })
    }
    /// The last vector of `all`, and where its last `left < LANES` values are.
    #[op]
    pub(crate) fn last_values(self, all: &[impl Readable<T>], left: usize) -> (V<S, T, W>, MaskOf<T, W, S>) {
        (self.load_any_last(all), !self.first_n(Self::LANES - left))
    }
    /// `load_n` and `store_n`, with one test for the end of a page.
    #[op]
    pub(crate) fn replace_n<R>(self, values: &mut [T], f: impl Fn(V<S, T, W>) -> (V<S, T, W>, R)) -> R {
        if const { crate::X86 && Self::CELLS_BY_BITS } && !crate::tag::near_absent_page::<T, W>(values) {
            return live!(crate::X86 && Self::CELLS_BY_BITS, {
                let (v, result) =
                    f(Simd::new(self.simd(), crate::raw::Raw::load_by_bits(self.simd(), values, 0, self.zero().raw)));
                v.store_by_bits(values, 0);
                result
            });
        }
        let (v, result) = f(self.load_n(values));
        v.store_n(values);
        result
    }
    /// Moves the values that match to the start, and returns their number. What is after them can change.
    #[op]
    pub(crate) fn retain(self, values: &mut [T], matches: impl Fn(V<S, T, W>) -> MaskOf<T, W, S>) -> usize {
        return_if!(S::SCALAR, self.retain_ones(values, matches));
        let (n, mut at, mut count) = (Self::LANES, 0, 0);
        if values.len() < n {
            let counts = self.first_n(values.len());
            return self.replace_n(
                values,
                always!(|v| {
                    let kept = (counts & matches(v)).whole_lanes();
                    (v.compress_mask(kept), kept.count())
                }),
            );
        }
        // To load it later would have to wait for the stores.
        let (last, counts) = self.last_values(values, values.len() % n);
        // What is before the first value that goes stays, and a search stores nothing.
        if values.len() >= 32 * n {
            at = self.find_if(&*values, always!(|v| !matches(v))).unwrap_or(values.len()) / n * n;
            count = at;
        }
        let room = if const { Self::FOUR_AT_ONCE } { 5 * n } else { 4 * n };
        while values.len() - at >= room {
            let v = self.load_four(&values[at..]);
            count += self.compress_four(v, always!(|i: usize| matches(v[i])), &mut values[count..][..room]);
            at += 4 * n;
        }
        while values.len() - at >= n {
            crate::not_unrolled();
            let v = self.load(&values[at..]);
            count += v.compress_mask_store(matches(v), &mut values[count..]);
            at += n;
        }
        let kept = (counts & matches(last)).whole_lanes();
        last.compress_mask(kept).store_n(&mut values[count..]);
        count + kept.count()
    }
    /// How many values to leave out, so that no store of 64 bytes is in two cache lines. Zero if it doesn't pay.
    #[op]
    pub(crate) fn to_cache_line<E>(self, to: &[E], smallest_lane: usize) -> usize {
        let pays = const { W::BYTES >= 64 && S::REGISTER == 64 } && to.len() >= 8 * Self::LANES;
        let largest_group = 1usize << (to.len() | (16 / smallest_lane)).trailing_zeros();
        if pays { (to.as_ptr().addr().wrapping_neg() % 64 / size_of::<T>()) & largest_group.wrapping_neg() } else { 0 }
    }
    /// Writes `f` of the indices, as lanes that wrap. `Generate`.
    #[op]
    pub(crate) fn generate(self, to: &mut [T], f: impl Fn(V<S, T::Unsigned, W>) -> V<S, T, W>) {
        let d = self.to_unsigned();
        let mut indices = d.iota(Default::default());
        let Some(last) = to.len().checked_sub(Self::LANES) else { return f(indices).store_n(to) };
        let mut rest = &mut *to;
        // On x86, a store across a cache line takes twice as long.
        if_here!(
            crate::X86 && W::BYTES >= 32,
            if size_of_val(rest) >= 2048 {
                core::hint::cold_path();
                let skip = rest.as_ptr().addr().wrapping_neg() / size_of::<T>() % Self::LANES;
                f(indices).store(rest);
                (indices, rest) = (d.iota(Lane::from_usize(skip)), &mut rest[skip..]);
            }
        );
        let (n, step) = (Self::LANES, always!(|k: usize| d.set(Lane::from_usize(k * Self::LANES))));
        if const { Self::ROLLED } && rest.len() > 4 * n {
            let four = always!(|indices: V<S, T::Unsigned, W>, to: &mut [T]| for i in 0..4 {
                f(indices + step(i)).store(&mut to[i * n..]);
            });
            while rest.len() > 4 * n {
                four(indices, rest);
                (indices, rest) = (indices + step(4), &mut rest[4 * n..]);
            }
            return four(d.iota(Lane::from_usize(last - 3 * n)), &mut to[last - 3 * n..]);
        }
        for chunk in rest.chunks_exact_mut(Self::LANES) {
            when!(Self::ROLLED, crate::not_unrolled());
            f(indices).store(chunk);
            indices += d.set(Lane::from_usize(Self::LANES));
        }
        f(d.iota(Lane::from_usize(last))).store_last(to);
    }
}

impl<S: Isa, T: Float, W: Width> Tag<S, T, W> {
    /// The sum of the products. Panics if the lengths differ. `Dot::Compute`.
    #[op]
    pub(crate) fn dot(self, x: &[impl Readable<T>], y: &[impl Readable<T>]) -> T {
        self.fold2::<false, _, _, _>(
            x,
            self,
            y,
            self.zero(),
            #[inline(always)]
            |sum, a, b| a.mul_add_relaxed(b, sum),
            #[inline(always)]
            |a, b| a + b,
        )
        .reduce_sum()
    }
    /// `matrix` has a row of `x.len()` values for each value of `to`. `MatVec`.
    #[op]
    pub(crate) fn mat_vec(self, matrix: &[impl Readable<T>], x: &[impl Readable<T>], to: &mut [T]) {
        let (n, columns) = (Self::LANES, x.len());
        assert!(matrix.len() == columns * to.len());
        let (fours, rest) = to.as_chunks_mut::<4>();
        let matrix = if const { crate::vector::two_tables::<S, T>() && W::BYTES == 64 && size_of::<T>() >= 4 }
            && columns >= 16 * n
            && columns % n == 0
        {
            self.four_rows::<true, _>(matrix, x, fours)
        } else {
            self.four_rows::<false, _>(matrix, x, fours)
        };
        for (i, to) in rest.iter_mut().enumerate() {
            *to = self.dot(&matrix[i * columns..][..columns], x);
        }
    }
    /// Returns the other rows. `ALIGN` is as in `fold_in`.
    #[op]
    fn four_rows<'a, const ALIGN: bool, E: Readable<T>>(
        self,
        mut matrix: &'a [E],
        x: &[impl Readable<T>],
        fours: &mut [[T; 4]],
    ) -> &'a [E] {
        let (n, columns) = (Self::LANES, x.len());
        let skip = if ALIGN { self.odd(matrix).wrapping_neg() % n } else { 0 };
        for to in fours {
            let (a, after) = matrix.split_at(columns);
            let (b, after) = after.split_at(columns);
            let (c, after) = after.split_at(columns);
            let (d, after) = after.split_at(columns);
            matrix = after;
            let [mut s0, mut s1, mut s2, mut s3] = [self.zero(); 4];
            if ALIGN && skip != 0 {
                let first = always!(|row: &[_]| self.end_of(self.zero(), self.load_any(row) * self.load_any(x), skip));
                (s0, s1, s2, s3) = (first(a), first(b), first(c), first(d));
            }
            let mut at = skip;
            while columns >= n && at <= columns - n {
                let (i, v) = (at, self.load_any(&x[at..]));
                at += n;
                (s0, s1) =
                    (self.load_any(&a[i..]).mul_add_relaxed(v, s0), self.load_any(&b[i..]).mul_add_relaxed(v, s1));
                (s2, s3) =
                    (self.load_any(&c[i..]).mul_add_relaxed(v, s2), self.load_any(&d[i..]).mul_add_relaxed(v, s3));
            }
            let i = columns - (columns - skip) % n;
            if i < columns {
                let v = self.load_any_n(&x[i..]);
                let end = always!(
                    |row: &[E]| choose! { S::A64 && Self::LANES > 2 => self.load_end(row, &row[i..]), _ => self.load_any_n(&row[i..]) }
                );
                (s0, s1) = (end(a).mul_add_relaxed(v, s0), end(b).mul_add_relaxed(v, s1));
                (s2, s3) = (end(c).mul_add_relaxed(v, s2), end(d).mul_add_relaxed(v, s3));
            }
            let sum = always!(|v: V<S, T, W>| if ALIGN { v + self.zero() } else { v }.reduce_sum());
            choose! {
                S::A64 && Self::LANES == 4 && W::BYTES == 16 => s0.add_pairs(s1).add_pairs(s2.add_pairs(s3)).store(to),
                _ => *to = [sum(s0), sum(s1), sum(s2), sum(s3)],
            }
        }
        matrix
    }
}

macro_rules! dots { ($($name:ident $a:ident $b:ident $sum:ident, |$s:ident, $x:ident, $y:ident| $step:expr;)*) => {$(
    impl<S: Isa, W: Width> Tag<S, $a, W> {
        /// The sum of the products, which wraps. Panics if the lengths differ.
        #[op]
        pub fn $name(self, x: &[impl Readable<$a>], y: &[impl Readable<$b>]) -> $sum {
            let zero = self.repartition::<$sum>().zero();
            self.fold2::<false, _, _, _>(x, self.repartition(), y, zero, #[inline(always)] |$s, $x, $y| $step, #[inline(always)] |a, b| a + b)
                .reduce_sum()
        }
    }
)*}; }
dots! {
    dot_wide u8 u8 u32, |sum, a, b| a.add_products(b, sum);
    dot_wide_i8 u8 i8 i32, |sum, a, b| a.sum_of_mul_quad_accumulate_i8(b, sum);
    dot_wide i8 i8 i32, |sum, a, b| a.add_products(b, sum);
}

impl<S: Isa, W: Width> Tag<S, i16, W> {
    /// The sum of the products, which wraps. Panics if the lengths differ.
    #[op]
    pub(crate) fn dot_wide(self, x: &[impl Readable<i16>], y: &[impl Readable<i16>]) -> i32 {
        let zero = self.repartition::<i32>().zero();
        let (a, b) = self.fold2::<false, _, _, _>(
            x,
            self,
            y,
            (zero, zero),
            #[inline(always)]
            |sums, a, b| a.reorder_widen_mul_accumulate(b, sums.0, sums.1),
            #[inline(always)]
            |a, b| (a.0 + b.0, a.1 + b.1),
        );
        (a + b).reduce_sum()
    }
}

/// One xoshiro256++ generator in each lane. It is not for cryptography. `VectorXoshiro`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut random = Xoshiro::<B32, S>::new(1);
/// assert!(random.next_f64().within(0.0..=1.0).all());
/// # } example()
/// ```
#[doc(alias("random", "rng", "rand", "prng", "xorshift", "noise"))]
pub struct Xoshiro<W: Width, S: Isa>([V<S, u64, W>; 4]);

impl<S: Isa, W: Width> Xoshiro<W, S> {
    #[op]
    pub(crate) fn on(s: S, seed: u64) -> Self {
        let d = s.fixed::<u64, W>();
        let mut state = [d.iota(0) * 0x9e37_79b9_7f4a_7c15u64.wrapping_mul(4) + seed; 4];
        for (i, lanes) in state.iter_mut().enumerate() {
            let z = *lanes + 0x9e37_79b9_7f4a_7c15u64.wrapping_mul(i as u64 + 1);
            let z = (z ^ z >> 30) * 0xbf58_476d_1ce4_e5b9u64;
            let z = (z ^ z >> 27) * 0x94d0_49bb_1331_11ebu64;
            *lanes = z ^ z >> 31;
        }
        Self(state)
    }
    /// All bits are random.
    #[op]
    pub fn next_u64(&mut self) -> V<S, u64, W> {
        let [a, b, c, d] = self.0;
        let (c, e) = (c ^ a, d ^ b);
        self.0 = [a ^ e, b ^ c, c ^ b << 17, e.rotate_left(45)];
        (a + d).rotate_left(23) + a
    }
    /// Uniform in `0.0..1.0`: the upper 52 bits, divided by `2^52`.
    #[doc(alias("uniform"))]
    #[op]
    pub fn next_f64(&mut self) -> V<S, f64, W> {
        (self.next_u64() >> 12 | 1f64.to_bits()).bitcast::<f64>() - 1.0
    }
    /// Uniform in `0.0..1.0`: the upper 23 bits of each half, divided by `2^23`.
    #[doc(alias("uniform"))]
    #[op]
    pub fn next_f32(&mut self) -> V<S, f32, W> {
        (self.next_u64().bitcast::<u32>() >> 9 | 1f32.to_bits()).bitcast::<f32>() - 1.0
    }
}
