//! The loops for targets without vectors. A closure gets one value in all lanes, and LLVM removes all lanes but the first.

use crate::lane::Int;
use crate::raw::Raw;
use crate::{Isa, Lane, MaskOf, Place, Readable, Simd, Source, Tag, Width};

type V<T, W, S> = Simd<T, W, S>;
type M<T, W, S> = MaskOf<T, W, S>;

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// See simd/packed.rs.
    pub(crate) const PACKED: bool = size_of::<T>() < crate::simd::PACKED + 1
        && (size_of::<T>() == 1 || matches!(T::KIND, crate::lane::Kind::Unsigned));
    pub(crate) const ONE_BY_ONE: bool = S::SCALAR && !Self::PACKED;
    #[op]
    fn holds(self, mask: M<T, W, S>) -> bool {
        let v = mask.to_vector().cast_unsigned();
        choose! { Self::PACKED => v >> (T::BITS - 1), _ => v }.get_lane() != Default::default()
    }
    #[op]
    pub(crate) fn find_one<const LAST: bool>(
        self,
        within: impl Source<T>,
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> Option<usize> {
        let len = within.len();
        for i in 0..len {
            let at = if LAST { len - 1 - i } else { i };
            if self.holds(matches(self.set(within.get(at)))) {
                return Some(at);
            }
        }
        None
    }
    #[op]
    pub(crate) fn count_ones_by_one(self, within: impl Source<T>, matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize {
        let mut count = 0;
        for at in 0..within.len() {
            count += self.holds(matches(self.set(within.get(at)))) as usize;
        }
        count
    }
    #[op]
    #[allow(clippy::manual_find, reason = "it is not always inlined")]
    pub(crate) fn find_pair<U: Lane, X: Width>(
        self,
        (x, other, y): (&[impl Readable<T>], Tag<S, U, X>, &[impl Readable<U>]),
        matches: impl Fn(V<T, W, S>, V<U, X, S>) -> M<T, W, S>,
    ) -> Option<usize> {
        for at in 0..x.len().min(y.len()) {
            if self.holds(matches(self.set(x[at].value()), other.set(y[at].value()))) {
                return Some(at);
            }
        }
        None
    }
    /// `put` gets each value, and whether to keep it.
    #[op]
    pub(crate) fn sift(
        self,
        from: &[impl Readable<T>],
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
        mut put: impl FnMut(T, bool),
    ) {
        let mut from = from;
        while const { Self::PACKED } && from.len() >= Self::LANES {
            let v = self.load_any(from);
            let kept = matches(v).to_vector().cast_unsigned() >> (T::BITS - 1);
            for (value, kept) in v.to_array().into_iter().zip(kept.to_array()) {
                put(value, kept != Default::default());
            }
            from = &from[Self::LANES..];
        }
        for at in 0..from.len() {
            let value = from[at].value();
            put(value, self.holds(matches(self.set(value))));
        }
    }
    #[op]
    pub(crate) fn copy_ones(
        self,
        from: &[impl Readable<T>],
        to: &mut [impl crate::Writable<T>],
        matches: impl Fn(V<T, W, S>) -> M<T, W, S>,
    ) -> usize {
        let mut count = 0;
        self.sift(
            from,
            matches,
            #[inline(always)]
            |value, kept| {
                match to.get_mut(count) {
                    Some(place) => crate::Writable::write_lane(place, value),
                    None => assert!(!kept),
                }
                count += kept as usize;
            },
        );
        count
    }
    #[op]
    pub(crate) fn retain_ones(self, values: &mut [T], matches: impl Fn(V<T, W, S>) -> M<T, W, S>) -> usize {
        let (mut count, mut first) = (0, 0);
        while const { Self::PACKED && Self::LANES <= 64 } && values.len() - first >= Self::LANES {
            let v = self.load(&values[first..]);
            count += v.keep_ones(matches(v).own_bits(), &mut values[count..][..Self::LANES]);
            first += Self::LANES;
        }
        for at in first..values.len() {
            let value = values[at];
            values[count] = value;
            count += self.holds(matches(self.set(value))) as usize;
        }
        count
    }
    #[op]
    pub(crate) fn until_one<U: Lane, X: Width>(
        self,
        from: &[impl Readable<T>],
        to: impl Place<U>,
        stop: impl Fn(V<T, W, S>) -> M<T, W, S>,
        f: impl Fn(V<T, W, S>) -> V<U, X, S>,
    ) -> usize {
        let (mut to, mut at) = (to.slice(0..from.len()), 0);
        while at < from.len() {
            let v = self.set(from[at].value());
            if self.holds(stop(v)) {
                break;
            }
            to.write(at, [f(v).get_lane()]);
            at += 1;
        }
        to.keep(at);
        at
    }
    /// For `step` that works lane by lane.
    #[op]
    pub(crate) fn fold_ones(
        self,
        from: &[impl Readable<T>],
        init: T,
        step: impl Fn(V<T, W, S>, V<T, W, S>) -> V<T, W, S>,
    ) -> T {
        let mut all = init;
        for at in 0..from.len() {
            all = step(self.set(all), self.set(from[at].value())).get_lane();
        }
        all
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// Of the lanes `FROM..TO` among those in the place of each lane of the result, added and shifted right.
    #[op]
    pub(crate) fn products<U: Int, R: Int, const FROM: usize, const TO: usize>(
        self,
        other: V<U, W, S>,
        by: u32,
    ) -> V<R, W, S> {
        let (a, b, step) = (self.to_array(), other.to_array(), size_of::<R>() / size_of::<T>());
        let product = always!(|i: usize| a.as_ref()[i].to_u64().wrapping_mul(b.as_ref()[i].to_u64()));
        Tag::new(self.s).from_fn(
            #[inline(always)]
            |i| {
                let mut sum = 0u64;
                unrolled!(4, for k in FROM..const TO {
                    sum = sum.wrapping_add(product(i * step + k));
                });
                R::from_u64(sum >> by)
            },
        )
    }
}

/// What moves lanes, by way of memory.
impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    pub(crate) fn before(self, next: Self) -> V<T, W::Twice, S> {
        Simd::new(self.s, self.raw.shuffle::<_, { crate::pattern::PART }, 0>(next.raw))
    }
    #[op]
    pub(crate) fn each_at<X: Width>(self, indices: V<T::Unsigned, X, S>) -> V<T, X, S> {
        let (all, at) = (self.to_array(), indices.to_array());
        Tag::new(self.s).from_fn(
            #[inline(always)]
            |i| all.as_ref()[at.as_ref()[i].to_u64() as usize % Self::LANES],
        )
    }
    /// From lane `n` of both on.
    #[op]
    pub(crate) fn followed_by(self, next: Self, n: usize) -> Self {
        // A load of what several stores have written would wait for them.
        return_if!(Tag::<S, T, W>::PACKED && (W::BYTES == 8 || W::BYTES == 16), {
            let (all, by) =
                (self.before(next).reinterpret::<u8>().bitcast::<u64>().to_array(), (n * size_of::<T>() * 8) as u32);
            let word = always!(|i: usize| all.as_ref()[(i + by as usize / 64) % (W::BYTES / 4)]);
            let moved = self.tag().repartition::<u64>().from_fn(
                #[inline(always)]
                |i| word(i) >> (by % 64) | word(i + 1) << 1 << (!by % 64),
            );
            moved.bitcast::<u8>().reinterpret()
        });
        self.tag().load(&self.before(next).to_array().as_ref()[n..])
    }
    /// `to` has a place for each lane.
    #[op]
    pub(crate) fn keep_ones(self, bits: u64, to: &mut [impl crate::Writable<T>]) -> usize {
        let (lanes, mut count) = (self.to_array(), 0);
        unrolled!(16, for i in 0..const (Self::LANES) {
            crate::Writable::write_lane(&mut to[count % Self::LANES], lanes.as_ref()[i]);
            count += (bits >> i & 1) as usize;
        });
        count
    }
    /// The reverse. The other lanes are unspecified.
    #[op]
    pub(crate) fn spread_ones(self, bits: u64) -> Self {
        let (lanes, mut count) = (self.to_array(), 0);
        self.tag().from_fn(
            #[inline(always)]
            |i| {
                let lane = lanes.as_ref()[count % Self::LANES];
                count += (bits >> i & 1) as usize;
                lane
            },
        )
    }
    pub(crate) const CHAINS: bool = cfg!(all(target_arch = "s390x", not(miri)))
        && (S::SCALAR || crate::simd::ARRAYS)
        && !T::IS_FLOAT
        && !Tag::<S, T, W>::PACKED;
    #[op]
    pub(crate) fn chosen(self, with: impl crate::Operand<T, W, S>) -> Self {
        if crate::Operand::number(with).is_some() {
            return self;
        }
        let lanes = self.to_array();
        self.tag().from_fn(
            #[inline(always)]
            |i| T::from_u64(crate::regs::chosen(T::unsigned(lanes.as_ref())[i].to_u64())),
        )
    }
    /// The even lanes, and the odd ones.
    #[op]
    pub(crate) fn times_number(self, n: T) -> Self {
        use crate::simd::Word;
        let (v, n, even) = (
            self.reinterpret::<Word>(),
            T::unsigned(&[n])[0].to_u64() as Word,
            Word::MAX / ((1 << (T::BITS % 32)) + 1),
        );
        let times = always!(|v: V<Word, W, S>| v.with((v & even).raw.mul(Raw::splat(n))) & even);
        (times(v) | times(v >> T::BITS) << T::BITS).reinterpret()
    }
    /// For sums that fit in their lanes.
    #[op]
    pub(crate) fn add_small(self, other: Self) -> Self {
        (self.reinterpret::<crate::simd::Word>() + other.reinterpret()).reinterpret()
    }
}
