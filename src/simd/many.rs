//! More than 64 lanes, which `crate::simd` doesn't have. They are the bytes of vectors that are wider than any register.

use crate::lane::{Element, Lane};
use crate::memory::{Place, Source};
use crate::pattern::{self as p, wrapped};
use crate::raw::{Raw, RawMask, copy, same};
#[allow(unused_imports)]
use crate::simd::{Cpu, Fits, Here, In};
use crate::simd::{Mask as CoreMask, MaskElement, Simd as Core, Swizzle};
use crate::{Isa, Mask, Signed, Simd, Tag, Width};
use core::mem::MaybeUninit;

/// `N` lanes in `K` parts. LLVM keeps them in registers, as all accesses are to whole parts.
#[derive(Copy, Clone)]
pub struct Many<T, const N: usize, const K: usize>([T; N]);
#[derive(Copy, Clone)]
pub struct ManyMask<M, const K: usize>([M; K]);

pub trait Holds<const N: usize> {
    type Raw;
}
macro_rules! holds { ($($n:literal $raw:ty;)*) => { $(impl<T: Element> Holds<$n> for T { type Raw = $raw; })* }; }
holds! { 8 Core<T, 8>; 16 Core<T, 16>; 32 Core<T, 32>; 64 Core<T, 64>; 128 Many<T, 128, 2>; 256 Many<T, 256, 4>; 512 Many<T, 512, 8>; }

type Part<T> = Core<T, 64>;

macro_rules! each { ($i:ident < $k:expr => $body:expr) => { each!(@ $i $k, $body; 0 1 2 3 4 5 6 7) };
    (@ $i:ident $k:expr, $body:expr; $($n:literal)*) => {$( if const { $n < $k } { #[allow(non_upper_case_globals)] const $i: usize = $n; $body; } )*};
}

impl<T: Element, const N: usize, const K: usize> Many<T, N, K> {
    #[op]
    pub(crate) fn part(&self, i: usize) -> Part<T> {
        copy::from_slice(&self.0[64 * i..])
    }
    #[inline(always)]
    pub(crate) fn of(mut part: impl FnMut(usize) -> Part<T>) -> Self {
        apart!({
            let mut all = [T::default(); N];
            each!(i < K => copy::to_slice(part(i), &mut all[64 * i..]));
            Self(all)
        })
    }
}
impl<M: RawMask, const K: usize> ManyMask<M, K> {
    #[op]
    fn of<S: Cpu>(part: impl Fn(usize) -> M) -> Self
    where
        Here: In<S>,
    {
        let mut all = [M::splat(false); K];
        each!(i < K => all[i] = part(i));
        Self(all)
    }
}

impl<M: RawMask, const K: usize> RawMask for ManyMask<M, K> {
    const PARTS: usize = K;
    #[op]
    fn splat<S: Cpu>(value: bool) -> Self
    where
        Here: In<S>,
    {
        Self([M::splat(value); K])
    }
    #[op]
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| self.0[i].and(other.0[i]),
        )
    }
    #[op]
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| self.0[i].or(other.0[i]),
        )
    }
    #[op]
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| self.0[i].xor(other.0[i]),
        )
    }
    #[op]
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| self.0[i].not(),
        )
    }
    #[op]
    fn any<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        let mut any = self.0[0];
        each!(i < K => any = any.or(self.0[i]));
        any.any()
    }
    #[op]
    fn all<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        !self.not().any()
    }
    fn to_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn from_bits<S: Cpu>(_: u64) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    // Only halves, two in a row, and another size of lanes.
    #[op]
    fn convert<R: RawMask, const OP: u8, const AT: usize, S: Cpu>(self, other: Self) -> R
    where
        Here: In<S>,
    {
        R::from_parts(
            #[inline(always)]
            |i| {
                let at = AT * R::PARTS + i;
                if at < K { self.0[at] } else { other.0[at - K] }
            },
        )
    }
    #[op]
    fn converted<E: MaskElement + Fits<P>, const N: usize, const P: usize, const OP: u8, const AT: usize, S: Cpu>(
        a: CoreMask<E, P>,
        b: CoreMask<E, P>,
    ) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| M::converted::<E, N, P, { p::REPEAT }, 0, _>(if i == 0 { a } else { b }, a),
        )
    }
    #[op]
    fn from_parts<Q: RawMask, S: Cpu>(part: impl Fn(usize) -> Q) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| part(i).convert::<M, { p::REPEAT }, 0, _>(part(i)),
        )
    }
}

/// Part `AT` of a result of `M` lanes, from operands of `N` lanes in parts of `P`.
struct Plan<
    T,
    const OP: u8,
    const K: usize,
    const N: usize,
    const P: usize,
    const M: usize,
    const AT: usize,
    const STEP: usize,
>(T);

impl<T, const OP: u8, const K: usize, const N: usize, const P: usize, const M: usize, const AT: usize>
    Plan<T, OP, K, N, P, M, AT, 0>
{
    const FROM: [usize; 64] = {
        let (mut from, mut i) = ([0; 64], 0);
        while i < 64 && 64 * AT < M {
            let at = wrapped(OP, K, (64 * AT + i) % M, N, M, size_of::<T>());
            from[i] = if at < N { at } else { at - N + N.next_multiple_of(P) };
            i += 1;
        }
        from
    };
    /// A bit for each part of the operands.
    const USED: u32 = {
        let (mut used, mut i) = (0, 0);
        while i < 64 {
            used |= 1 << (Self::FROM[i] / P);
            i += 1;
        }
        used
    };
    const fn used(n: usize) -> usize {
        let (mut rest, mut i) = (Self::USED, 1);
        while i <= n && rest.count_ones() > 1 {
            rest &= rest - 1;
            i += 1;
        }
        rest.trailing_zeros() as usize
    }
}

/// Step 0 takes two whole operands. Step 1 takes the first two parts that are used, and each other step one more.
impl<
    T,
    const OP: u8,
    const K: usize,
    const N: usize,
    const P: usize,
    const M: usize,
    const AT: usize,
    const STEP: usize,
> Swizzle<64> for Plan<T, OP, K, N, P, M, AT, STEP>
{
    const INDEX: [usize; 64] = {
        let (mut index, mut i) = (Plan::<T, OP, K, N, P, M, AT, 0>::FROM, 0);
        let (first, this) = (Plan::<T, OP, K, N, P, M, AT, 0>::used(0), Plan::<T, OP, K, N, P, M, AT, 0>::used(STEP));
        while i < 64 && STEP > 0 {
            let (part, at) = (index[i] / P, index[i] % P);
            index[i] = if STEP == 1 && part == first {
                at
            } else if part == this {
                P + at
            } else {
                i
            };
            i += 1;
        }
        index
    };
}

type Step<T, const OP: u8, const K: usize, const N: usize, const M: usize, const AT: usize, const STEP: usize> =
    Plan<T, OP, K, N, 64, M, AT, STEP>;

#[op]
pub fn pick<T: Element, const OP: u8, const K: usize, const N: usize, const M: usize, const AT: usize>(
    a: &[T; N],
    b: &[T; N],
) -> Part<T> {
    let count = const { Step::<T, OP, K, N, M, AT, 0>::USED.count_ones() };
    if const { Step::<T, OP, K, N, M, AT, 0>::USED.count_ones() > 4 } {
        let (mut all, from) = ([T::default(); 64], &Step::<T, OP, K, N, M, AT, 0>::FROM);
        for i in 0..64 {
            all[i] = if from[i] < N { a[from[i]] } else { b[from[i] - N] };
        }
        return copy::from_array(all);
    }
    macro_rules! part {
        ($n:literal) => {{
            let at = const { 64 * Step::<T, OP, K, N, M, AT, 0>::used($n) };
            copy::from_slice::<T, 64>(if at < N { &a[at..] } else { &b[at - N..] })
        }};
    }
    let mut v = Step::<T, OP, K, N, M, AT, 1>::concat_swizzle(part!(0), part!(1));
    if count > 2 {
        v = Step::<T, OP, K, N, M, AT, 2>::concat_swizzle(v, part!(2));
    }
    if count > 3 {
        v = Step::<T, OP, K, N, M, AT, 3>::concat_swizzle(v, part!(3));
    }
    v
}

macro_rules! by_parts { ($($name:ident($($arg:ident),*))*) => {$(
    #[op]
    fn $name<S: Cpu>(self $(, $arg: Self)*) -> Self where Here: In<S> { Self::of(#[inline(always)] |i| Raw::$name(self.part(i) $(, $arg.part(i))*)) }
)*}; }
macro_rules! compare { ($($name:ident($($arg:ident),*))*) => {$(
    #[inline(always)]
    fn $name<S: Cpu>(self $(, $arg: Self)*) -> Self::Mask where Here: In<S> { apart!(ManyMask::of(#[inline(always)] |i| Raw::$name(self.part(i) $(, $arg.part(i))*))) }
)*}; }
macro_rules! reduce { ($($name:ident $op:ident)*) => {$(
    /// The upper half with the lower half, and so on.
    #[op]
    #[allow(clippy::modulo_one)]
    fn $name<S: Cpu>(mut self) -> T where Here: In<S> {
        macro_rules! halve { ($k:literal) => {
            if const { K > $k } { self = Self::of(#[inline(always)] |i| Raw::$op(self.part(i % $k), self.part(i % $k + $k))); }
        }; }
        halve!(4); halve!(2); halve!(1);
        Raw::$name(self.part(0))
    }
)*}; }

impl<T: Element, const N: usize, const K: usize> Raw for Many<T, N, K>
where
    Part<T>: Raw<Lane = T>,
{
    type Lane = T;
    type Mask = ManyMask<<Part<T> as Raw>::Mask, K>;
    type ArrayWhoseSliceIsAsRefOrAsMut = [T; N];
    type BoolsWhoseSliceIsAsRefOrAsMut = [bool; N];
    #[inline(always)]
    fn bools(lane: impl FnMut(usize) -> bool) -> [bool; N] {
        crate::raw::bools(lane)
    }
    type Stored = Self;

    #[inline(always)]
    fn zero() -> Self {
        Self([T::default(); N])
    }
    #[op]
    fn shl_by<S: Cpu>(self, n: u32) -> Self {
        Self::of(
            #[inline(always)]
            |i| self.part(i).shl_by(n),
        )
    }
    #[op]
    fn shr_by<S: Cpu>(self, n: u32) -> Self {
        Self::of(
            #[inline(always)]
            |i| self.part(i).shr_by(n),
        )
    }
    #[inline(always)]
    fn from_stored(v: Self) -> Self {
        v
    }
    #[op]
    fn splat<S: Cpu>(value: T) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |_| Core::splat(value),
        )
    }
    #[op]
    fn iota<S: Cpu>() -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| <Part<T> as Raw>::iota().add(Core::splat(T::from_usize(64 * i))),
        )
    }
    #[inline(always)]
    fn to_array<S: Cpu>(self) -> [T; N]
    where
        Here: In<S>,
    {
        self.0
    }
    #[inline(always)]
    fn lanes(&self) -> &[T] {
        &self.0
    }
    #[inline(always)]
    fn lanes_mut(&mut self) -> &mut [T] {
        &mut self.0
    }
    #[inline(always)]
    fn from_array<S: Cpu>(array: [T; N]) -> Self
    where
        Here: In<S>,
    {
        Self(array)
    }
    #[op]
    #[track_caller]
    fn load<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        let from = &from[..N];
        Self::of(
            #[inline(always)]
            |i| copy::from_slice(&from[64 * i..]),
        )
    }
    #[op]
    #[track_caller]
    fn store<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        let to = &mut to[..N];
        each!(i < K => copy::to_slice(self.part(i), &mut to[64 * i..]));
    }
    #[op]
    fn load_in_parts<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| Raw::load_in_parts(&from[from.len().min(64 * i)..]),
        )
    }
    #[op]
    #[allow(clippy::unnecessary_min_or_max)]
    fn store_in_parts<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        let n = to.len();
        each!(i < K => self.part(i).store_in_parts(&mut to[n.min(64 * i)..]));
    }
    #[op]
    #[track_caller]
    fn store_uninit<S: Cpu>(self, to: &mut [MaybeUninit<T>])
    where
        Here: In<S>,
    {
        crate::raw::copy::to_uninit(self.0, to)
    }
    #[inline(always)]
    fn read<F: Source<T>, S: Cpu>(from: F, at: usize) -> Self
    where
        Here: In<S>,
    {
        Self(from.read(at))
    }
    #[inline(always)]
    fn write<F: Place<T>, S: Cpu>(self, to: &mut F, at: usize)
    where
        Here: In<S>,
    {
        to.write(at, self.0)
    }
    // The callers take halves.
    fn store_masked<S: Cpu>(self, _: &mut [T], _: Self::Mask)
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn load3(_: &[T]) -> [Self; 3] {
        unreachable!()
    }
    fn load4(_: &[T]) -> [Self; 4] {
        unreachable!()
    }
    fn store3(_: [Self; 3], _: &mut [T]) {
        unreachable!()
    }
    fn store4(_: [Self; 4], _: &mut [T]) {
        unreachable!()
    }
    fn gather<R: Raw, S: Cpu>(self, _: R, _: R::Mask, _: &[R::Lane]) -> R
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn scatter<R: Raw, S: Cpu>(self, _: R, _: R::Mask, _: &mut [R::Lane])
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn gathered<const M: usize, S: Cpu>(self, _: Self::Mask, _: &[T], _: Core<usize, M>) -> Self
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        unreachable!()
    }
    fn scattered<const M: usize, S: Cpu>(self, _: Self::Mask, _: &mut [T], _: Core<usize, M>)
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        unreachable!()
    }

    by_parts! {
        add(other) sub(other) mul(other) min(other) max(other) and(other) or(other) xor(other) not() neg() abs()
        shl(by) shr(by) saturating_add(other) saturating_sub(other) abs_diff(other) average_round(other)
        swap_bytes() reverse_bits() count_ones() leading_zeros() trailing_zeros()
        div(other) sqrt() fma(mul, add) floor() ceil() trunc() round() round_ties_even()
    }
    compare! { eq(other) ne(other) lt(other) le(other) top_bits() }
    reduce! { reduce_sum add reduce_min min reduce_max max }
    #[op]
    fn select<S: Cpu>(mask: Self::Mask, yes: Self, no: Self) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| Raw::select(mask.0[i], yes.part(i), no.part(i)),
        )
    }
    #[op]
    fn from_mask(mask: Self::Mask) -> Self {
        Self::of(
            #[inline(always)]
            |i| Raw::from_mask(mask.0[i]),
        )
    }

    #[op]
    fn casted<R: Raw, S: Cpu>(from: R) -> Self
    where
        Here: In<S>,
    {
        Self::of(
            #[inline(always)]
            |i| from.cast_part(i),
        )
    }
    #[op]
    fn cast_part<U: Element, S: Cpu>(self, i: usize) -> Part<U>
    where
        Here: In<S>,
    {
        self.part(i).cast_lanes()
    }
    #[op]
    fn cast_lanes<U: Element + Fits<Q>, const Q: usize, S: Cpu>(self) -> Core<U, Q>
    where
        Here: In<S>,
    {
        self.part(0).cast_lanes()
    }
    #[inline(always)]
    fn shuffle<R: Raw<Lane = T>, const OP: u8, const BY: usize>(self, other: Self) -> R {
        apart!(R::picked::<N, OP, BY>(&self.0, &other.0))
    }
    #[op]
    fn shuffled<const FROM: usize, const P: usize, const OP: u8, const BY: usize, const JOINED: bool>(
        a: Core<T, P>,
        b: Core<T, P>,
    ) -> Self
    where
        T: Fits<P>,
    {
        let mut all = [T::default(); N];
        each!(i < K => copy::to_slice(Plan::<T, OP, BY, FROM, P, N, i, 0>::concat_swizzle(a, b), &mut all[64 * i..]));
        Self(all)
    }
    #[op]
    fn picked<const FROM: usize, const OP: u8, const BY: usize>(a: &[T; FROM], b: &[T; FROM]) -> Self {
        let mut all = [T::default(); N];
        each!(i < K => copy::to_slice(pick::<T, OP, BY, FROM, N, i>(a, b), &mut all[64 * i..]));
        Self(all)
    }
}

type Halved<By, W> = <By as crate::width::Repr>::HalfIfWide<W>;

// For branches that are only taken if `By` is wider than 64 bytes.
impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[inline(always)]
    pub(crate) fn parts<By: Width>(self) -> [Simd<T, Halved<By, W>, S>; 2] {
        same(self.split())
    }
}
impl<S: Isa, T: Signed, W: Width> Mask<T, W, S> {
    #[op]
    pub(crate) fn parts<By: Width>(self) -> [Mask<T, Halved<By, W>, S>; 2] {
        same([self.lower_half(), self.upper_half()])
    }
    #[op]
    pub(crate) fn join<X: Width>(lower: Mask<T, X, S>, upper: Mask<T, X, S>) -> Self {
        Self::combine(same(upper), same(lower))
    }
}
impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[inline(always)]
    pub(crate) fn part<By: Width>(self) -> Tag<S, T, Halved<By, W>> {
        Tag::new(self.simd())
    }
    #[op]
    pub(crate) fn join<X: Width>(self, lower: Simd<T, X, S>, upper: Simd<T, X, S>) -> Simd<T, W, S> {
        self.combine(same(upper), same(lower))
    }
}
