//! Operations for sets and for columns of values.

use crate::pattern as p;
use crate::{B2, B4, B8, B16, B32, B64, Int, Isa, Lane, MaskOf, Simd, Tag, Width};

/// What [`is_in`](Simd::is_in) takes: an array of any length, a vector of 16 bytes, a reference to these, or one number.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is no set of `{T}`",
    label = "expected an array of `{T}`, or a vector of 16 bytes",
    note = "a slice: `first_chunk::<N>()`. A wider vector: the array that it is loaded from",
    note = "bytes that are only known at run time: `ByteSet::of(bytes).contains(v)`"
)]
pub trait Members<T: Int, S: Isa>: Copy + crate::seals::Members<T, S> {
    #[doc(hidden)]
    fn have<W: Width, const NONZERO: bool>(this: Self, v: Simd<T, W, S>) -> MaskOf<T, W, S>;
}
macro_rules! members { ($([$($n:tt)*] $t:ty, |$this:ident, $v:ident| $e:expr;)*) => {$(
    #[diagnostic::do_not_recommend]
    #[sealed]
    impl<T: Int, S: Isa, $($n)*> Members<T, S> for $t {
        #[op]
        fn have<W: Width, const NONZERO: bool>($this: Self, $v: Simd<T, W, S>) -> MaskOf<T, W, S> { $e }
    }
)*}; }
members! {
    [] T, |it, v| v.simd_eq(it);
    [] Simd<T, B16, S>, |set, v| v.among_lanes::<NONZERO>(set);
    [] &Simd<T, B16, S>, |set, v| v.among_lanes::<NONZERO>(*set);
    [const N: usize] [T; N], |set, v| v.among_values::<N, NONZERO>(&set, 1);
    [const N: usize] &[T; N], |set, v| v.among_values::<N, NONZERO>(set, v.one(set));
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// In each block: whether a lane is equal to any lane of `set`.
    #[op]
    #[track_caller]
    pub(crate) fn matches_any(self, set: Self) -> MaskOf<T, W, S> {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        match T::BITS {
            8 => self.with_bytes::<T>(self.s.match_u8::<W>(self.bytes(), set.bytes())).matched(),
            16 => self.with_bytes::<T>(self.s.match_u16::<W>(self.bytes(), set.bytes())).matched(),
            32 => {
                self.simd_eq(set)
                    | self.simd_eq(set.shuffle0321())
                    | (self.simd_eq(set.shuffle1032()) | self.simd_eq(set.shuffle2103()))
            }
            _ => self.simd_eq(set) | self.simd_eq(set.swap_pairs()),
        }
    }
    #[op]
    fn matched(self) -> MaskOf<T, W, S> {
        if const { S::SVE2 } { self.full_mask() } else { self.to_mask() }
    }
    /// The same, and faster on x86. The result is unspecified if a lane of either is zero.
    #[op]
    #[track_caller]
    pub(crate) fn matches_any_nonzero(self, set: Self) -> MaskOf<T, W, S> {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        match T::BITS {
            8 => self.with_bytes::<T>(self.s.match_nonzero_u8::<W>(self.bytes(), set.bytes())).matched(),
            16 => self.with_bytes::<T>(self.s.match_nonzero_u16::<W>(self.bytes(), set.bytes())).matched(),
            _ => self.matches_any(set),
        }
    }
    #[op]
    fn among_lanes<const NONZERO: bool>(self, set: Simd<T, B16, S>) -> MaskOf<T, W, S> {
        let set = set.to_array();
        return_if!(T::BITS == 16 && Self::ZMM && !NONZERO, self.is_each::<8>(set.as_ref(), 1));
        return_if!(T::BITS == 32 && W::BYTES > 16, self.is_each::<4>(set.as_ref(), 1));
        return_if!(T::BITS == 64 && W::BYTES > 16, self.is_each::<2>(set.as_ref(), 1));
        let set = self.tag().dup128(set);
        if NONZERO { self.matches_any_nonzero(set) } else { self.matches_any(set) }
    }
    #[op]
    fn among_values<const N: usize, const NONZERO: bool>(self, set: &[T; N], one: usize) -> MaskOf<T, W, S> {
        if const { S::AVX512VBMI && Self::many(N) } && crate::tuning::fast_conflict() {
            return live!(S::AVX512VBMI && Self::many(N), self.at_once(set));
        }
        // Otherwise the CPU was asked on the way here.
        if const { S::AVX512VBMI && cfg!(target_feature = "avx512vbmi") && Self::many(N) }
            && crate::gate::is_here(S::TARGET).is_none()
        {
            crate::gate::cpu();
        }
        let among = always!(|part| self.among_lanes::<NONZERO>(part));
        choose! {
            N == 0 => self.tag().mask_false(),
            Self::takes_each(N, NONZERO) => self.is_each::<N>(set, one),
            N * size_of::<T>() >= 16 => self.among_parts(set, among),
            N * size_of::<T>() >= 8 => among(self.ends::<B8>(set)),
            N * size_of::<T>() >= 4 => among(self.s.fixed().from_parts(0, &mut passed!(|_| self.ends::<B4>(set)))),
            _ => among(self.s.fixed().from_parts(0, &mut passed!(|_| self.ends::<B2>(set)))),
        }
    }
    const ZMM: bool = S::REGISTER == 64 && W::BYTES >= 64;
    /// With fewer values, or wider ones, a test of the CPU costs the others 10 to 40%.
    const fn many(n: usize) -> bool {
        Self::ZMM && T::BITS == 32 && n >= 16
    }
    /// For speed: 1, hidden. LLVM then loads each number by itself, not by way of a wider load.
    #[op]
    fn one<const N: usize>(self, set: &[T; N]) -> usize {
        choose! { crate::X86 && Self::many(N) => if is_known!(set[0]) { 1 } else { crate::regs::count(1) }, _ => 1 }
    }
    /// Whether a comparison with each value beats the forms for 16 bytes.
    const fn takes_each(n: usize, nonzero: bool) -> bool {
        if T::BITS >= 32 || !S::SSE42 && !S::SVE2 {
            return T::BITS >= 32 && W::BYTES > 16 || n * size_of::<T>() % 16 != 0;
        }
        n <= 2
            || n <= 4 && !S::SVE2
            || T::BITS == 16 && Self::ZMM && n <= 6 * n.div_ceil(8)
            || S::AVX2 && W::BYTES > 16 && (n <= 6 || !nonzero && (n <= 8 || T::BITS == 16 || n <= 12 && Self::ZMM))
    }
    #[op]
    fn ends<X: Width>(self, set: &[T]) -> Simd<T, X::Twice, S> {
        self.s.fixed::<T, X>().load(set).concat(self.s.fixed::<T, X>().load_last(set))
    }
    /// The last part overlaps the one before.
    #[op]
    fn among_parts<X: Width, R: core::ops::BitOrAssign, const N: usize>(
        self,
        set: &[T; N],
        has: impl Fn(Simd<T, X, S>) -> R,
    ) -> R {
        let d = self.s.fixed::<T, X>();
        let mut found = has(d.load_last(set));
        unrolled!(
            4,
            for k in 0..((N - 1) / d.lanes()) {
                found |= has(d.load(&set[k * d.lanes()..]));
            }
        );
        found
    }
    /// A number is repeated as it is loaded.
    #[op]
    fn is_each<const N: usize>(self, set: &[T], one: usize) -> MaskOf<T, W, S> {
        let is = always!(|k: usize| self.simd_eq(set[k.min(N - 1).checked_sub(1).map_or(0, |k| k + one)]));
        let four = always!(|k: usize| is(k) | is(k + 1) | (is(k + 2) | is(k + 3)));
        let mut found = four((N - 1) / 4 * 4);
        unrolled!(8, for k in 0..const (N.saturating_sub(1) / 4) {
            found |= four(4 * k);
        });
        found
    }
    #[on(X86)]
    #[op]
    fn at_once<const N: usize>(self, set: &[T; N]) -> MaskOf<T, W, S> {
        let Some(it) = crate::asked::Intersect::here() else {
            return self.conflicts(set).any_bits(T::from_u64(255));
        };
        let members = always!(|part: Simd<T, B64, S>| {
            let part = self.tag().from_parts(0, &mut always!(|_| part));
            self.with_bytes::<T>(self.s.members::<W>(self.bytes(), part.bytes(), it)).full_mask()
        });
        self.among_parts(set, members)
    }
    /// The lowest byte of a lane of 32 bits is zero unless `set` has it.
    #[on(X86)]
    #[op]
    fn conflicts<const N: usize>(self, set: &[T; N]) -> Self {
        halves_if!(W::BYTES > 32, |v: Self = self, set: &[T; N] = set| {
            v.tag().combine(v.upper_half().conflicts(set), v.lower_half().conflicts(set))
        });
        let after = always!(|part: Simd<T, B32, S>| {
            let both = part.concat(self.same::<T, B32>());
            both.with_bytes::<T>(self.s.conflicts::<B64>(both.bytes()))
        });
        self.among_parts(set, after).upper_half().same()
    }
    /// In each block: how many lanes of `set` a lane is equal to.
    #[op]
    #[track_caller]
    pub(crate) fn count_matches(self, set: Self) -> Self {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        self.equals_counted(set)
    }
    #[op]
    fn equals_counted(self, set: Self) -> Self {
        return_if!(S::SVE2 && size_of::<T>() == 1, self.with_bytes(self.s.count_u8::<W>(self.bytes(), set.bytes())));
        apart!(self.s, {
            let less = always!(|set: Simd<u32, W, S>| self.simd_eq(set.bitcast::<T>()).to_simd::<T>());
            let two = always!(|set: Simd<u32, W, S>| less(set) + less(set.shuffle1032()));
            let four = always!(|set: Simd<u32, W, S>| two(set) + two(set.shuffle0321()));
            let eight = always!(|set: Simd<u32, W, S>| four(set) + four(set.rotate_left(16)));
            let set = set.bitcast::<u32>();
            self.tag().zero()
                - choose! { size_of::<T>() == 1 => eight(set) + eight(set.rotate_left(8)), size_of::<T>() == 2 => eight(set), size_of::<T>() == 4 => four(set), _ => two(set) }
        })
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// The last lane in all lanes.
    #[op]
    pub fn splat_last(self) -> Self {
        // A loop often waits for this. LLVM would take two shuffles for one.
        return_if!(S::AVX2 && W::BYTES >= 32 && W::BYTES <= S::REGISTER && (size_of::<T>() == 4 || size_of::<T>() == 2 && S::REGISTER == 64 || size_of::<T>() == 1 && S::AVX512VBMI && W::BYTES == 64 && cfg!(not(miri))), |v: Self = self| {
            v.swizzle_dyn_relaxed(v.tag().to_unsigned().set(Lane::from_usize(Self::LANES - 1)).black_box())
        });
        self.shuffle::<{ p::BROADCAST_LAST }, 0>(self)
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// A bit for each of up to 64 values: whether it matches. The other bits are zero.
    #[op]
    #[track_caller]
    pub(crate) fn bits_if<E: crate::Readable<T>>(
        self,
        values: &[E],
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> u64 {
        assert!(values.len() <= 64);
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        let n = Self::LANES;
        if values.len() < 64 {
            if const { Self::LANES == 64 } {
                return matches(self.load_any_n(values)).to_bitmask() & !(!0 << values.len());
            }
            let mut all = 0;
            if const { Self::LANES >= 16 }
                && let Some(last) = values.len().checked_sub(n)
            {
                return_if!(
                    Self::BITS_AT_ONCE,
                    self.fewer_bits_of(
                        last,
                        #[inline(always)]
                        |at| matches(self.load_any_at(values, at))
                    )
                );
                unrolled!(4 theirs, for i in 0..(64 / n) {
                    let at = if i == 64 / n - 1 { last } else { last.min(i * n) };
                    all |= matches(self.load_any_at(values, at)).to_bitmask() << at;
                });
                return all;
            }
            return_if!(Self::LANES >= 16, matches(self.load_any_n(values)).to_bitmask() & !(!0 << values.len()));
            let mut at = 0;
            for (v, counts) in crate::Over::<T, W, S, E>::new(self.simd(), values).padded() {
                (all, at) = (all | (matches(v).to_bitmask() & counts) << at, at + n);
            }
            return all;
        }
        self.bits_of(
            #[inline(always)]
            |at| matches(self.load_any(&values[at..])),
        )
    }
    const MASK_BY_MASK: bool = S::REGISTER == 64
        || W::BYTES != S::REGISTER && !(S::AVX2 && W::BYTES == 16 && size_of::<T>() == 2)
        || !S::ARM && Self::LANES >= 8 && size_of::<T>() != 2;
    /// The bits of four masks take as long as those of one.
    pub(crate) const BITS_AT_ONCE: bool = S::A64 && Self::LANES == 16 && W::BYTES == 16;
    /// Of fewer, whose last mask starts at `last`.
    #[op]
    pub(crate) fn fewer_bits_of(self, last: usize, mask_at: impl Fn(usize) -> MaskOf<T, W, S>) -> u64 {
        let all = self.bits_of(
            #[inline(always)]
            |at| mask_at(at.min(last)),
        );
        all & !(!0 << last) | all >> (64 - Self::LANES) << last
    }
    /// Of 64 values, whose masks start at multiples of the number of lanes.
    #[op]
    pub(crate) fn bits_of(self, mask_at: impl Fn(usize) -> MaskOf<T, W, S>) -> u64 {
        let n = Self::LANES;
        return_if!(S::AVX2 && S::REGISTER == 32 && W::BYTES == 32 && size_of::<T>() >= 4, {
            // Packed within blocks, and put in order at the end. All bits of a lane are the same, so saturation keeps them.
            let half = always!(|first: usize| {
                let (d8, d16) = (self.repartition::<i8>(), self.repartition::<i16>());
                let at = always!(|k: usize| mask_at(first + k * n).to_vector().bitcast::<i32>());
                let of32 = always!(
                    |k: usize| choose! { size_of::<T>() == 8 => d16.reorder_demote2_to(at(2 * k), at(2 * k + 1)).bitcast::<i32>(), _ => at(k) }
                );
                let bytes = d8.reorder_demote2_to(
                    d16.reorder_demote2_to(of32(0), of32(1)),
                    d16.reorder_demote2_to(of32(2), of32(3)),
                );
                let ordered: Simd<i8, W, S> = choose! {
                    size_of::<T>() == 8 => bytes.bitcast::<u16>().swizzle(#[inline(always)] |i| i / 2 + i % 2 * 8).bitcast(),
                    _ => bytes.bitcast::<u32>().swizzle(#[inline(always)] |i| i / 2 + i % 2 * 4).bitcast(),
                };
                ordered.full_mask().to_bitmask()
            });
            let lower = half(0);
            lower | crate::regs::number(half(32)) << 32
        });
        if const { Self::MASK_BY_MASK } {
            let mut all = 0;
            unrolled!(64 theirs, for i in 0..const (64 / if Self::LANES == 0 { 1 } else { Self::LANES }) {
                all |= mask_at(i * n).to_bitmask() << (i * n);
                // For speed: LLVM would join the numbers in a vector.
                when!(S::REGISTER == 64, all = crate::regs::number(all));
            });
            return all;
        }
        // One byte for each value, and then the bits.
        live!(!Self::MASK_BY_MASK, {
            let mut bytes = [self.repartition::<i8>().zero(); 4];
            unrolled!(4 theirs, for i in 0..(64 / W::BYTES) {
                let at = always!(|k: usize| mask_at(i * W::BYTES + k * n).to_vector());
                let (d8, d16, d32) = (self.repartition::<i8>(), self.repartition::<i16>(), self.repartition::<i32>());
                let of64 = always!(|i: usize| d32.concat_even(at(i + 1).bitcast(), at(i).bitcast()));
                let of32 = always!(|i: usize| if size_of::<T>() == 8 { of64(2 * i) } else { at(i).bitcast() });
                let of16 = always!(|i: usize| {
                    if size_of::<T>() >= 4 { d16.narrow_masks(of32(2 * i), of32(2 * i + 1)) } else { at(i).bitcast() }
                });
                bytes[i] = if size_of::<T>() >= 2 { d8.narrow_masks(of16(0), of16(1)) } else { at(0).bitcast() };
            });
            return_if!(S::AVX2 && W::BYTES == 16, {
                // With longer registers, short slices take more time.
                let bits = always!(|i: usize| bytes[i].black_box().full_mask().to_bitmask() << (16 * i));
                bits(0) | bits(1) | bits(2) | bits(3)
            });
            let d = Tag::<S, i8, B64>::new(self.s());
            if const { W::BYTES == 16 } {
                let block = always!(|i: usize| d.half().half().resize_bitcast(bytes[i]));
                let all = d.combine(d.half().combine(block(3), block(2)), d.half().combine(block(1), block(0)));
                return all.full_mask().to_bitmask();
            }
            d.combine(d.half().resize_bitcast(bytes[1]), d.half().resize_bitcast(bytes[0])).full_mask().to_bitmask()
        })
    }
    #[inline(always)]
    fn s(self) -> S {
        self.simd()
    }
    /// For lanes that are 0 or -1.
    #[op]
    fn narrow_masks<U: Int>(self, a: Simd<U, W, S>, b: Simd<U, W, S>) -> Simd<T, W, S> {
        choose! { S::ARM => self.concat_even(b.bitcast(), a.bitcast()), _ => self.ordered_demote2_to(a, b) }
    }
}
