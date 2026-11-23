//! Arrays, for targets without stable intrinsics.
#![allow(clippy::unnecessary_cast, clippy::absurd_extreme_comparisons)]
use super::{
    SimdElement as E,
    bits::{pod, start},
    convert::one_by_one as converted,
    *,
};

#[forbid(unsafe_code)]
#[path = "packed.rs"]
mod packed;
use packed::Packed;

/// Numbers of 16 bits with a sign tend to be multiplied.
const fn packs<T: E>() -> bool {
    T::SIZE <= PACKED && (T::SIZE == 1 || !T::SIGNED)
}
macro_rules! packed {
    ($name:ident($v:ident $(, $a:ident)* $(; $x:expr)?)) => {
        lazily!(packs::<T>() && (T::SIZE == 1 || !matches!(stringify!($name).as_bytes(), b"shl" | b"shr" | b"leading_zeros" | b"trailing_zeros")) => each($v, #[inline(always)] |_i, _a: Word| Packed::<T>::$name(_a $(, part(&$a, _i))* $(, $x)?)));
    };
}

#[derive(Copy, Clone)]
#[repr(C, align(8))]
pub struct Array<B, const N: usize>([B; N]);
pub const fn level(_: &[&str]) -> u8 {
    0
}
macro_rules! plain {
    ($item:item) => {
        #[inline]
        $item
    };
}
within!(0, plain);
macro_rules! registers { ($m:ident) => { $m! {
    u8: 1 8 arch::Array<u8, 8>, 2 8 arch::Array<u8, 8>, 4 8 arch::Array<u8, 8>, 8 8 arch::Array<u8, 8>, 16 16 arch::Array<u8, 16>, 32 32 arch::Array<u8, 32>, 64 64 arch::Array<u8, 64>;
    u16: 1 4 arch::Array<u16, 4>, 2 4 arch::Array<u16, 4>, 4 4 arch::Array<u16, 4>, 8 8 arch::Array<u16, 8>, 16 16 arch::Array<u16, 16>, 32 32 arch::Array<u16, 32>, 64 64 arch::Array<u16, 64>;
    u32: 1 2 arch::Array<u32, 2>, 2 2 arch::Array<u32, 2>, 4 4 arch::Array<u32, 4>, 8 8 arch::Array<u32, 8>, 16 16 arch::Array<u32, 16>, 32 32 arch::Array<u32, 32>, 64 64 arch::Array<u32, 64>;
    u64: 1 1 arch::Array<u64, 1>, 2 2 arch::Array<u64, 2>, 4 4 arch::Array<u64, 4>, 8 8 arch::Array<u64, 8>, 16 16 arch::Array<u64, 16>, 32 32 arch::Array<u64, 32>, 64 64 arch::Array<u64, 64>;
} }; }
pub(super) use registers;

#[inline(always)]
fn each<T: E, U: E, R: Pod>(mut v: R, lane: impl Fn(usize, T) -> U) -> R {
    for i in 0..size_of::<R>() / T::SIZE {
        let it = lane(i, part(&v, i));
        set_part(&mut v, i, it)
    }
    v
}
#[inline(always)]
fn words<R: Pod>(v: R) -> impl Iterator<Item = (usize, Word)> {
    (0..size_of::<R>() / size_of::<Word>()).map(move |i| (i, part(&v, i)))
}
#[inline(always)]
fn lane_bits<T: E>(value: T) -> Word {
    cast::<T, T::Bits>(value).bits() as Word
}
#[inline(always)]
fn chosen<T: E>(it: T) -> T {
    #[cfg(all(target_arch = "s390x", not(miri)))]
    if const { !T::FLOAT } {
        return T::of_bits(crate::regs::chosen(it.bits()));
    }
    it.apart()
}
macro_rules! by_lanes {
    (one $($name:ident)*) => { $(#[inline(always)] fn $name<S: Cpu, T: E>(self) -> Self { packed!($name(self)); each(self, #[inline(always)] |_, a: T| a.$name()) })* };
    (two $($name:ident)*) => { $(#[inline(always)] fn $name<S: Cpu, T: E>(self, b: Self) -> Self { packed!($name(self, b)); each(self, #[inline(always)] |i, a: T| a.$name(part(&b, i))) })* };
    (usual $($name:ident($($a:ident),*))*) => {
        $(#[inline(always)] fn $name<S: Cpu, T: E>(self $(, $a: Self)*) -> Self { packed!($name(self $(, $a)*)); emulate::$name::<S, T, Self>(self $(, $a)*) })*
    };
    ($($name:ident |$a:ident, $b:ident| $lane:expr;)*) => {
        $(#[inline(always)] fn $name<S: Cpu, T: E>(self, b: Self) -> Self { packed!($name(self, b)); each(self, #[inline(always)] |i, $a: T| { let $b: T = part(&b, i); $lane }) })*
    };
}
macro_rules! arrays { ($($b:ident: $($n:literal)*;)*) => {$($(
    pod!([] Array<$b, $n>);
    const _: () = assert!(size_of::<Array<$b, $n>>() == $n * size_of::<$b>());
)*)*}; }
arrays! { u8: 8 16 32 64; u16: 4 8 16 32 64; u32: 2 4 8 16 32 64; u64: 1 2 4 8 16 32 64; }
// LLVM simplifies each operation once. rustc inlines no call of a pointer.
impl<B: E, const N: usize> Reg for Array<B, N>
where
    Self: Pod,
{
    const ZERO: Self = start([0u64; 64]);
    #[inline(always)]
    fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self {
        #[inline]
        fn on<O: Op1, R: Prim>(a: R, x: u32) -> R {
            O::on::<Base, R>(a, x)
        }
        (const { on::<O, Self> as fn(_, _) -> _ })(self, x)
    }
    #[inline(always)]
    fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self {
        #[inline]
        fn on<O: Op2, R: Prim>(a: R, b: R) -> R {
            O::on::<Base, R>(a, b)
        }
        (const { on::<O, Self> as fn(_, _) -> _ })(self, b)
    }
    #[inline(always)]
    fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self {
        #[inline]
        fn on<O: Op3, R: Prim>(a: R, b: R, c: R) -> R {
            O::on::<Base, R>(a, b, c)
        }
        (const { on::<O, Self> as fn(_, _, _) -> _ })(self, b, c)
    }
    #[inline]
    fn splat<S: Cpu, T: E>(value: T) -> Self {
        Self::set::<S, T>(value)
    }
    #[inline]
    fn to_bits<S: Cpu, T: E>(self) -> u64 {
        self.sign_bits::<S, T>()
    }
    #[inline]
    fn from_bits<S: Cpu, T: E>(bits: u64) -> Self {
        Self::of_bits::<S, T>(bits)
    }
    #[inline]
    fn any<S: Cpu, T: E>(self) -> bool {
        lazily!(T::SIZE <= PACKED => words(self).fold(0, |all, (_, it)| all | it) & Packed::<T>::TOP != 0);
        (0..N).fold(0, |all, i| all | self.0[i].bits()) != 0
    }
    #[inline]
    fn all<S: Cpu, T: E>(self) -> bool {
        lazily!(T::SIZE <= PACKED => words(self).fold(0, |all, (_, it)| all | !it) & Packed::<T>::TOP == 0);
        (0..N).fold(!0, |all, i| all & self.0[i].bits()) == B::of_bits(!0).bits()
    }
}
impl<B: E, const N: usize> Prim for Array<B, N>
where
    Self: Pod,
{
    #[inline(always)]
    fn set<S: Cpu, T: E>(value: T) -> Self {
        lazily!(B::SIZE <= PACKED && packs::<T>() => each(Self::ZERO, #[inline(always)] |_, _: Word| Packed::<T>::splat(lane_bits(value))));
        each(
            Self::ZERO,
            #[inline(always)]
            |_, _: T| value,
        )
    }
    #[inline(always)]
    fn sign_bits<S: Cpu, T: E>(self) -> u64 {
        lazily!(T::SIZE <= PACKED => words(self).fold(0, |all, (i, it)| all | (Packed::<T>::sign_bits(it) as u64) << (i as u32 * Packed::<T>::LANES)));
        (0..size_of::<Self>() / T::SIZE)
            .fold(0, |all, i| all | part::<Self, T::Bits>(&self, i).bits() >> (8 * T::SIZE - 1) << i)
    }
    #[inline(always)]
    fn of_bits<S: Cpu, T: E>(bits: u64) -> Self {
        lazily!(T::SIZE <= PACKED => each(Self::ZERO, #[inline(always)] |i, _: Word| Packed::<T>::of_bits((bits >> (i as u32 * Packed::<T>::LANES)) as Word)));
        each(
            Self::ZERO,
            #[inline(always)]
            |i, _: T::Bits| T::Bits::of_bits((bits >> i & 1).wrapping_neg()),
        )
    }
    by_lanes!(one swap_bytes reverse_bits count_ones leading_zeros trailing_zeros);
    by_lanes!(usual not() neg() abs() negative() add(b) sub(b) and(b) or(b) xor(b) and_not(b) eq(b) ne(b) average(b) select(yes, no));
    by_lanes!(two shl shr saturating_add saturating_sub);
    by_lanes! {
        lt |a, b| T::told(a.apart() < b);
        le |a, b| T::told(a.apart() <= b);
        min |a, b| (if a.apart() < b { a } else { b }).apart();
        max |a, b| (if b.apart() < a { a } else { b }).apart();
        abs_diff |a, b| if a < b { b.sub(a) } else { a.sub(b) };
    }
    #[inline(always)]
    fn shl_by<S: Cpu, T: E>(self, n: u32) -> Self {
        packed!(shl_by(self; n as Word));
        each(
            self,
            #[inline(always)]
            |_, a: T| a.shl(T::of_bits(n as u64)),
        )
    }
    #[inline(always)]
    fn shr_by<S: Cpu, T: E>(self, n: u32) -> Self {
        packed!(shr_by(self; n as Word));
        each(
            self,
            #[inline(always)]
            |_, a: T| a.shr(T::of_bits(n as u64)),
        )
    }
}

#[inline(always)]
pub fn shuffle<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    chosen!(fn(_, _) -> _: Plan::<B, P, N, M>::SHORT => by_words::<B, P, N, M>, _ => by_lanes::<B, P, N, M>)(a, b)
}
struct Plan<B, P, const N: usize, const M: usize>(B, P);
impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize> Plan<B, P, N, M> {
    const MOVES: &[[packed::Move; 8]; 16] =
        &packed::plan(Full::<B, P, N, M>::INDEX, size_of::<B>(), <B as Class<M>>::FULL);
    /// Else LLVM does better with lanes, which it follows through several shuffles.
    const SHORT: bool = size_of::<B>() <= PACKED
        && (size_of::<B>() == 1 || !P::SIGNED)
        && 2 * packed::count(Self::MOVES) <= <B as Class<M>>::FULL;
}
#[inline]
fn by_words<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    let (both, mut v) = ([a, b], <B as Class<M>>::Reg::ZERO);
    each!(i < size_of::<<B as Class<M>>::Reg>() / size_of::<Word>() => {
        let mut word = 0;
        each!(k < size_of::<Word>() / size_of::<B>() => {
            let it = &Plan::<B, P, N, M>::MOVES[i][k];
            let from: Word = part(&both, it.from as usize);
            word |= (if it.turned { from.swap_bytes() } else { from } << it.left >> it.right & it.keep) * it.times;
        });
        set_part(&mut v, i, word);
    });
    v
}
macro_rules! reduce { ($($name:ident $op:ident |$a:ident, $b:ident| $both:expr;)*) => {$(
    #[inline]
    pub fn $name<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
        lazily!(packs::<T>() && N * T::SIZE >= 8 => {
            let word = words(v).skip(1).fold(part(&v, 0), |all, (_, it)| Packed::<T>::$op(all, it));
            let mut $a: T = part(&word, 0);
            for i in 1..Packed::<T>::LANES as usize { let $b = part(&word, i); $a = $both }
            $a
        });
        let mut $a = v[0];
        for i in 1..N { let $b = v[i]; $a = $both }
        $a
    }
)*}; }
#[inline]
pub fn reduce_sum<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    lazily!(packs::<T>() && N * T::SIZE >= 8 => T::of_bits(Packed::<T>::sum(words(v).fold(0, |all, (_, it)| Packed::<T>::add(all, it))) as u64));
    (1..N).fold(v[0], |all, i| all.add(v[i]))
}
reduce! { reduce_min min |a, b| chosen(if a < b { a } else { b }); reduce_max max |a, b| chosen(if b < a { a } else { b }); }
#[inline]
pub fn convert<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    lazily!(packs::<T>() && packs::<U>() && !T::FLOAT && !U::FLOAT && (T::SIZE > U::SIZE || !T::SIGNED) => Simd::of(resized::<T, _, _>(v.0)));
    converted(v)
}
/// Between bytes and 16 bits, without a sign.
#[inline(always)]
fn resized<T: E, A: Reg, R: Reg>(v: A) -> R {
    let (first, count) = (cfg!(target_endian = "big") as usize, size_of::<A>() / size_of::<Word>());
    each(
        R::ZERO,
        #[inline(always)]
        |i, _: Word| {
            if T::SIZE == 1 {
                return packed::apart(part::<_, Word>(&v, i / 2) >> (((i % 2) ^ first) as u32 * Word::BITS / 2));
            }
            packed::together(part(&v, (2 * i + first) % count))
                | packed::together(part(&v, (2 * i + 1 - first) % count)) << (Word::BITS / 2)
        },
    )
}
#[inline]
pub fn cast_mask<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(m: Mask<T, N>) -> Mask<U, N> {
    lazily!(T::SIZE <= PACKED && U::SIZE <= PACKED => {
        let v: RegOf<U, N> = resized::<T, _, _>(m.0);
        Mask::of(if T::SIZE == 1 { each(v, #[inline(always)] |_, it: Word| it | it << 8) } else { v })
    });
    Mask::of(converted::<T::Mask, U::Mask, N>(Simd::of(m.0)).0)
}
#[inline(always)]
pub fn only_combined(_: [u64; 2], _: [u64; 2]) -> Option<[u64; 2]> {
    None
}
