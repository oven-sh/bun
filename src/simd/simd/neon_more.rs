//! Shuffles, conversions, reductions and memory.
use super::super::convert::one_by_one as converted;
use super::*;

#[inline(always)]
fn joined<B, A: Pod>(a: A, b: A, single: bool) -> Q {
    if single {
        return cast(run!(vcombine_f32(cast(a), cast(b))));
    }
    match size_of::<B>() {
        8 => cast(run!(vcombine_u64(cast(a), cast(b)))),
        2 => cast(run!(vcombine_u16(cast(a), cast(b)))),
        4 => cast(run!(vcombine_u32(cast(a), cast(b)))),
        _ => run!(vcombine_u8(cast(a), cast(b))),
    }
}
#[inline(always)]
pub fn one_single(value: f32) -> Q {
    cast(run!(vsetq_lane_f32::<0>(value, run!(vdupq_n_f32(0.0)))))
}
#[inline(always)]
pub fn single_of<const I: usize>(v: D) -> f32 {
    if I == 0 { run!(vget_lane_f32::<0>(cast(v))) } else { run!(vget_lane_f32::<1>(cast(v))) }
}
#[inline(always)]
pub fn first_single(v: Q) -> f32 {
    run!(vgetq_lane_f32::<0>(cast(v)))
}
#[inline(always)]
pub fn lower_singles(v: Q) -> D {
    cast(run!(vget_low_f32(cast(v))))
}
impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize, const R: usize> Plan<B, P, N, M, R> {
    /// Of bytes, in four registers from `4 * group` on.
    const fn bytes(group: usize) -> Q {
        let (mut index, mut i, size, from, (used, count)) = ([255u8; 16], 0, size_of::<B>(), Self::FROM, Self::USED);
        while i < 16 && 4 * group < count {
            let ((register, lane), mut place) = (from[i / size], 0);
            while used[place] != register {
                place += 1;
            }
            if place / 4 == group {
                index[i] = (place % 4 * 16 + lane as usize * size + i % size) as u8
            }
            i += 1;
        }
        cast(index)
    }
    const FIRST: Q = Self::bytes(0);
    /// The size of the lanes, or of what stays together, up to 4 bytes.
    const UNIT: usize = {
        let (at, mut unit, mut i): ([u8; 16], usize, usize) =
            (cast(Self::FIRST), if size_of::<B>() == 8 { 8 } else { 4 }, 0);
        while i < 16 {
            while at[i] as usize % unit != i % unit || at[i] as usize / unit != at[i - i % unit] as usize / unit {
                unit /= 2;
                i = 0;
            }
            i += 1;
        }
        unit
    };
    /// Whether the first 8 bytes are a half of a register.
    const HALF: bool = {
        let at: [u64; 2] = cast(Self::FIRST);
        at[0] == at[0] % 256 / 8 * 0x0808_0808_0808_0808 + 0x0706_0504_0302_0100
    };
    /// LLVM makes one shuffle of these insertions. It sees more through it than through one of bytes.
    #[inline]
    fn mixed<U: Pod, V: Pod, O: Pod>(a: V, b: V) -> O {
        mix::<U, V, O>(a, b, const { &cast::<Q, [u8; 16]>(Self::FIRST) })
    }
    /// The same. By way of memory, rustc would take the lanes as integers.
    #[inline]
    fn singles(a: float32x4_t, b: float32x4_t) -> float32x4_t {
        let (mut v, at) = (a, const { &cast::<Q, [u8; 16]>(Self::bytes(0)) });
        macro_rules! lane { ($i:literal: $($k:literal)*) => { match at[4 * $i] / 4 % 8 { $($k => run!(vgetq_lane_f32::<$k>(a)), k if k == 4 + $k => run!(vgetq_lane_f32::<$k>(b)),)* _ => unreachable!() } }; }
        macro_rules! lanes { ($($i:literal)*) => { $(set_part::<_, f32>(&mut v, $i, lane!($i: 0 1 2 3));)* }; }
        lanes!(0 1 2 3);
        v
    }
    #[inline(always)]
    fn apart<U: Pod, V: Pod, P2: Pod, O: Reg>(from: Sources<B, N>) -> O {
        // rustc inlines no call of a pointer.
        cast((Self::mixed::<U, V, P2> as fn(_, _) -> _)(cast(from.at(0)), cast(from.at(1))))
    }
    #[inline(always)]
    fn of_singles<O: Reg>(from: Sources<B, N>) -> O {
        let v = (Self::singles as fn(_, _) -> _)(cast(from.at(0)), cast(from.at(1)));
        at!(size_of::<O>() == 16 => cast(v));
        cast(run!(vget_low_f32(v)))
    }
    #[inline(always)]
    fn moved<O: Reg>(from: Sources<B, N>) -> O {
        macro_rules! rows { ($($t:ident $q:ident $d:ident)*) => {
            chosen!(fn(Sources<B, N>) -> O: !cfg!(bun_simd_unoptimized) && P::SINGLE && Self::USED.1 <= 2 => Self::of_singles, $(
                !cfg!(bun_simd_unoptimized) && Self::USED.1 <= 2 && Self::UNIT == size_of::<$t>() && size_of::<O>() == 16 => Self::apart::<$t, $q, $q, O>,
                !cfg!(bun_simd_unoptimized) && Self::USED.1 <= 2 && Self::UNIT == size_of::<$t>() && !Self::HALF => Self::apart::<$t, $q, $d, O>,
            )* Self::USED.1 == 1 => Self::in_one, Self::USED.1 == 2 => Self::in_two, Self::USED.1 == 3 => Self::in_three, _ => Self::in_more)(from)
        }; }
        rows!(u16 uint16x8_t uint16x4_t u32 uint32x4_t uint32x2_t u64 uint64x2_t uint64x1_t)
    }
    /// LLVM makes shuffles of lookups in one or two registers.
    #[inline(always)]
    fn in_one<O: Reg>(from: Sources<B, N>) -> O {
        #[cfg(not(bun_simd_unoptimized))]
        at!(size_of::<O>() == 8 && Self::HALF && size_of::<B>() == 2 =>
            if const { Self::FROM[0].1 == 0 } { cast(run!(vget_low_u16(cast(from.at(0))))) } else { cast(run!(vget_high_u16(cast(from.at(0))))) });
        at!(size_of::<O>() == 8 => cast(run!(vqtbl1_u8(from.at(0), start(Self::FIRST)))));
        cast(run!(vqtbl1q_u8(from.at(0), Self::FIRST)))
    }
    #[inline(always)]
    fn in_two<O: Reg>(from: Sources<B, N>) -> O {
        at!(size_of::<O>() == 8 => cast(run!(vqtbl2_u8(uint8x16x2_t(from.at(0), from.at(1)), start(Self::FIRST)))));
        cast(run!(vqtbl2q_u8(uint8x16x2_t(from.at(0), from.at(1)), Self::FIRST)))
    }
    #[inline(always)]
    fn in_three<O: Reg>(from: Sources<B, N>) -> O {
        start(run!(vqtbl3q_u8(uint8x16x3_t(from.at(0), from.at(1), from.at(2)), Self::FIRST)))
    }
    #[inline(always)]
    fn in_more<O: Reg>(from: Sources<B, N>) -> O {
        let first = Self::FIRST;
        let mut v = run!(vqtbl4q_u8(uint8x16x4_t(from.at(0), from.at(1), from.at(2), from.at(3)), first));
        // There are 8 registers of bytes, or 8 lanes.
        if const { Self::USED.1 > 4 } {
            v = run!(vqtbx4q_u8(
                v,
                uint8x16x4_t(from.at(4), from.at(5), from.at(6), from.at(7)),
                const { Self::bytes(1) }
            ));
        }
        start(v)
    }
}
#[inline(always)]
fn mix<U: Pod, V: Pod, O: Pod>(a: V, b: V, at: &[u8; 16]) -> O {
    let (both, mut v) = ([a, b], start(a));
    macro_rules! lanes { ($($i:literal)*) => {$(
        if const { $i < size_of::<O>() / size_of::<U>() } { set_part::<O, U>(&mut v, $i, part(&both, at[$i * size_of::<U>() % 16] as usize % 32 / size_of::<U>())); }
    )*}; }
    lanes!(0 1 2 3 4 5 6 7);
    v
}
include!("plan.rs");

#[rules]
macro_rules! reduce { ($($name:ident $op:ident $f:ident [$($size:literal $s:ident $u:ident)*] $($last:ident)?;)*) => {$(
    #[inline(always)]
    pub fn $name<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
        lazily!(N * T::SIZE < 8 || N == 1 => v.reduce::<S, op::$op<T>>());
        $(at!(N * T::SIZE == 8 && T::SIZE == $size => if T::SIGNED { cast(run!(${concat($f, "_", $s)}(cast(v.0)))) } else { cast(run!(${concat($f, "_", $u)}(cast(v.0)))) });)*
        let mut all = v.0;
        macro_rules! halve { ($k:literal) => { if const { N * T::SIZE > 16 * $k } {
            each!(i < if N * T::SIZE > 16 * $k { $k } else { 0 } => { let x = part::<_, Q>(&all, i).$op::<S, T>(part(&all, i + $k)); set_part(&mut all, i, x) });
        } }; }
        halve!(16); halve!(8); halve!(4); halve!(2); halve!(1);
        let q: Q = start(all);
        $(at!(T::SIZE == $size => if T::SIGNED { cast(run!(${concat($f, q_, $s)}(cast(q)))) } else { cast(run!(${concat($f, q_, $u)}(cast(q)))) });)*
        $(at!(true => cast(run!($last(cast(q)))));)?
        part(&q.$op::<S, T>(run!(vextq_u8::<8>(q, q))), 0)
    }
)*}; }
reduce! {
    reduce_sum add vaddv [1 u8 u8 2 u16 u16 4 u32 u32] vaddvq_u64;
    reduce_min min vminv [1 s8 u8 2 s16 u16 4 s32 u32];
    reduce_max max vmaxv [1 s8 u8 2 s16 u16 4 s32 u32];
}

/// To lanes of twice the size.
#[inline(always)]
fn up<T: E>(v: D) -> Q {
    at!(T::FLOAT => cast(run!(vcvt_f64_f32(cast(v)))));
    at!(T::SIZE == 1 => if T::SIGNED { cast(run!(vmovl_s8(cast(v)))) } else { cast(run!(vmovl_u8(v))) });
    at!(T::SIZE == 2 => if T::SIGNED { cast(run!(vmovl_s16(cast(v)))) } else { cast(run!(vmovl_u16(cast(v)))) });
    if T::SIGNED { cast(run!(vmovl_s32(cast(v)))) } else { cast(run!(vmovl_u32(cast(v)))) }
}
#[inline(always)]
fn twice<T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    if const { size_of::<RegOf<T, N>>() == 8 } {
        return Simd::of(start(up::<T>(cast(v.0))));
    }
    let mut out = Simd::<U, N>::zero();
    each!(i < size_of::<RegOf<T, N>>() / 16 => {
        let q: Q = part(&v.0, i);
        set_part(&mut out.0, 2 * i, up::<T>(run!(vget_low_u8(q))));
        set_part(&mut out.0, 2 * i + 1, up::<T>(run!(vget_high_u8(q))));
    });
    out
}
/// To lanes of half the size.
#[inline(always)]
fn down<T: E, const SATURATE: bool>(v: Q) -> D {
    at!(T::FLOAT => cast(run!(vcvt_f32_f64(cast(v)))));
    macro_rules! rows { ($($size:literal $cut:ident $s:ident $u:ident)*) => {$(
        at!(T::SIZE == $size => if !SATURATE { cast(run!($cut(cast(v)))) } else if T::SIGNED { cast(run!($s(cast(v)))) } else { cast(run!($u(cast(v)))) });
    )*}; }
    rows!(2 vmovn_u16 vqmovn_s16 vqmovn_u16 4 vmovn_u32 vqmovn_s32 vqmovn_u32 8 vmovn_u64 vqmovn_s64 vqmovn_u64);
    unreachable!()
}
#[inline(always)]
fn half<T: Fits<N>, U: Fits<N>, const N: usize, const SATURATE: bool>(v: Simd<T, N>) -> Simd<U, N> {
    if const { size_of::<RegOf<T, N>>() == 8 } {
        let d: D = cast(v.0);
        return Simd::of(cast(down::<T, SATURATE>(run!(vcombine_u8(d, d)))));
    }
    if const { size_of::<RegOf<T, N>>() == 16 } {
        return Simd::of(cast(down::<T, SATURATE>(cast(v.0))));
    }
    let mut out = Simd::<U, N>::zero();
    each!(i < size_of::<RegOf<U, N>>() / 16 => {
        let (a, b) = (down::<T, SATURATE>(part(&v.0, 2 * i)), down::<T, SATURATE>(part(&v.0, 2 * i + 1)));
        set_part(&mut out.0, i, match U::SIZE { 1 => run!(vcombine_u8(a, b)), 2 => cast(run!(vcombine_u16(cast(a), cast(b)))), _ => cast(run!(vcombine_u32(cast(a), cast(b)))) })
    });
    out
}
include!("steps.rs");
struct Same<T, U>(T, U);
impl<T: E, U: E> Op1 for Same<T, U> {
    #[inline(always)]
    fn run<S: Cpu, R: Prim>(v: R, _: u32) -> R {
        macro_rules! rows { ($($bytes:literal $size:literal $fs:ident $fu:ident $sf:ident $uf:ident)*) => {$(
            at!(size_of::<R>() == $bytes && T::SIZE == $size && U::FLOAT => if T::SIGNED { cast(run!($fs(cast(v)))) } else { cast(run!($fu(cast(v)))) });
            at!(size_of::<R>() == $bytes && T::SIZE == $size => if U::SIGNED { cast(run!($sf(cast(v)))) } else { cast(run!($uf(cast(v)))) });
        )*}; }
        rows!(8 4 vcvt_f32_s32 vcvt_f32_u32 vcvt_s32_f32 vcvt_u32_f32 16 4 vcvtq_f32_s32 vcvtq_f32_u32 vcvtq_s32_f32 vcvtq_u32_f32
            8 8 vcvt_f64_s64 vcvt_f64_u64 vcvt_s64_f64 vcvt_u64_f64 16 8 vcvtq_f64_s64 vcvtq_f64_u64 vcvtq_s64_f64 vcvtq_u64_f64);
        unreachable!()
    }
}
#[inline(always)]
fn same<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    Simd::of(cast(v.0.map1::<S, Same<T, U>>(0)))
}
#[cfg_attr(not(bun_simd_unoptimized), inline(always))]
pub fn convert<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    macro_rules! steps { ($($name:ident($v:ident) $body:expr;)*) => {
        $(#[inline(always)] fn $name<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>($v: Simd<T, N>) -> Simd<U, N> { $body })*
    }; }
    steps! {
        of_signed(v) same::<S, U::Mask, U, N>(resized::<T, U::Mask, N, true, false>(v));
        of_unsigned(v) same::<S, U::Bits, U, N>(resized::<T, U::Bits, N, false, false>(v));
        to_long(v) same::<S, f64, U, N>(twice(v));
        to_signed(v) resized::<T::Mask, U, N, true, true>(same::<S, T, T::Mask, N>(v));
        to_unsigned(v) resized::<T::Bits, U, N, false, true>(same::<S, T, T::Bits, N>(v));
    }
    chosen!(fn(Simd<T, N>) -> Simd<U, N>:
        !T::FLOAT && !U::FLOAT && T::SIGNED && T::SIZE < U::SIZE => resized::<T, U, N, true, false>,
        !T::FLOAT && !U::FLOAT => resized::<T, U, N, false, false>,
        T::FLOAT && U::FLOAT && T::SIZE < U::SIZE => twice,
        T::FLOAT && U::FLOAT => half::<T, U, N, false>,
        T::SIZE == U::SIZE => same::<S, T, U, N>,
        // It would be rounded twice.
        U::FLOAT && T::SIZE > U::SIZE => converted,
        U::FLOAT && T::SIGNED => of_signed::<S, T, U, N>,
        U::FLOAT => of_unsigned::<S, T, U, N>,
        T::SIZE < U::SIZE => to_long::<S, T, U, N>,
        U::SIGNED => to_signed::<S, T, U, N>,
        _ => to_unsigned::<S, T, U, N>,
    )(v)
}
#[cfg_attr(not(bun_simd_unoptimized), inline(always))]
pub fn cast_mask<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(m: Mask<T, N>) -> Mask<U, N> {
    Mask::of(resized::<T, U, N, true, false>(Simd::of(m.0)).0)
}

struct Turns<const K: usize, const N: usize, const STORE: bool, const FROM: usize>;
impl<const K: usize, const N: usize, const STORE: bool, const FROM: usize, const M: usize> Swizzle<M>
    for Turns<K, N, STORE, FROM>
{
    // To memory from two registers, each of which has two vectors in its halves.
    const INDEX: [usize; M] = {
        let (mut all, mut i) = ([0; M], 0);
        while i < M {
            all[i] = if STORE { i % K * M / 2 + i / K % N } else { (FROM + i % N * K) % M };
            i += 1;
        }
        all
    };
}
/// For vectors of up to 4 bytes.
#[inline(always)]
pub fn stored_short<T: Fits<N>, const K: usize, const N: usize>(all: [Simd<T, N>; K]) -> [[T; N]; 4] {
    let pair = |i: usize| joined::<u32, D>(cast(all[i].0), cast(all[(i + 1) % K].0), false);
    macro_rules! rows { ($($t:ident $m:literal)*) => {$(
        at!(T::SIZE == size_of::<$t>() => start(shuffle::<$t, Turns<K, N, true, 0>, $m, $m>(pair(0), pair(2))));
    )*}; }
    rows!(u8 16 u16 8 u32 4);
    unreachable!()
}
#[inline(always)]
pub fn loaded_short<T: Fits<N>, const K: usize, const N: usize, const I: usize>(all: Q) -> Simd<T, N> {
    macro_rules! rows { ($($t:ident $m:literal)*) => {$(
        at!(T::SIZE == size_of::<$t>() => Simd::of(start(shuffle::<$t, Turns<K, N, false, I>, $m, $m>(all, all))));
    )*}; }
    rows!(u8 16 u16 8 u32 4);
    unreachable!()
}
/// Each two registers as one value for LLVM, which then makes `st2` of an interleaving, and sees extensions as a whole.
#[inline(always)]
pub fn united<T: Fits<N>, const N: usize>(v: Simd<T, N>) -> [T; N] {
    let mut all = [T::default(); N];
    macro_rules! rows { ($i:ident: $($t:ident $n:literal)*) => {$(if const { T::SIZE == size_of::<$t>() } {
        // The first store has the type of the whole, and is overwritten.
        let mut two = [0; 2 * $n];
        store2::<$t, $n>([Simd::zero(); 2], &mut two);
        *two.first_chunk_mut().unwrap() = part::<_, Simd<$t, $n>>(&v.0, 2 * $i).to_array();
        *two.last_chunk_mut().unwrap() = part::<_, Simd<$t, $n>>(&v.0, 2 * $i + 1).to_array();
        set_part::<_, [u8; 32]>(&mut all, $i, cast(two));
    })*}; }
    each!(i < N * T::SIZE / 32 => { rows!(i: u8 16 u16 8 u32 4); });
    all
}
const fn register<T: E, const N: usize>() -> usize {
    if N * T::SIZE < 16 { N * T::SIZE } else { 16 }
}
/// `each!` without a closure.
macro_rules! each_here { ($i:ident < $n:expr => $body:expr) => {
    each_here!(@ $i $n, $body; 0 [0] 1 [1] 2 [2 3] 4 [4 5 6 7] 8 [8 9 10 11 12 13 14 15] 16 [16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31]) };
    (@ $i:ident $n:expr, $body:expr; $($from:literal [$($k:literal)*])*) => { $(if const { $n > $from } { $({ #[allow(non_upper_case_globals)] const $i: usize = $k; $body; })* })* };
}
macro_rules! interleaved { ($($load:ident $store:ident $k:literal [$($i:tt)*] $($bytes:literal $size:literal $ld:ident $st:ident $tuple:ident)*;)*) => {$(
    /// For whole registers.
    #[inline(always)]
    pub fn $load<T: Fits<N>, const N: usize>(from: &[T]) -> [Simd<T, N>; $k] {
        let (from, mut out) = (&from[..$k * N], [Simd::<T, N>::zero(); $k]);
        let lanes = const { register::<T, N>() / T::SIZE };
        each_here!(i < (N * T::SIZE).div_ceil(16) => {
            let at = from[i * $k * lanes..][..$k * lanes].as_ptr();
            interleaved!(@ld out i at [$($i)*] $($bytes $size $ld)*);
        });
        out
    }
    interleaved! { @ $store $k [$($i)*] $($bytes $size $st $tuple)* }
)*};
    (@ $store:ident $k:literal [$($i:tt)*] $($bytes:literal $size:literal $st:ident $tuple:ident)*) => {
        #[inline(always)]
        pub fn $store<T: Fits<N>, const N: usize>(vectors: [Simd<T, N>; $k], to: &mut [T]) {
            let to = &mut to[..$k * N];
            let lanes = const { register::<T, N>() / T::SIZE };
            each_here!(i < (N * T::SIZE).div_ceil(16) => {
                let at = to[i * $k * lanes..][..$k * lanes].as_mut_ptr();
                interleaved!(@st vectors i at [$($i)*] $($bytes $size $st $tuple)*);
            });
        }
    };
    (@ld $out:ident $r:ident $at:ident $all:tt $($bytes:literal $size:literal $ld:ident)*) => { $(interleaved!(@ld1 $out $r $at $all $bytes $size $ld);)* };
    (@st $v:ident $r:ident $at:ident $all:tt $($bytes:literal $size:literal $st:ident $tuple:ident)*) => { $(interleaved!(@st1 $v $r $at $all $bytes $size $st $tuple);)* };
    (@ld1 $out:ident $r:ident $at:ident [$($i:tt)*] $bytes:literal $size:literal $ld:ident) => {
        // SAFETY: the slice has the lanes of all registers.
        if const { T::SIZE == $size && register::<T, N>() == $bytes } { #[allow(unsafe_code)] let all = unsafe { $ld($at.cast()) }; $(set_part(&mut $out[$i].0, $r, all.$i);)* }
    };
    (@st1 $v:ident $r:ident $at:ident [$($i:tt)*] $bytes:literal $size:literal $st:ident $tuple:ident) => {
        // SAFETY: the same.
        if const { T::SIZE == $size && register::<T, N>() == $bytes } { #[allow(unsafe_code)] unsafe { $st($at.cast(), $tuple($(part(&$v[$i].0, $r)),*)) } }
    };
}
interleaved! {
    @ store2 2 [0 1] 8 1 vst2_u8 uint8x8x2_t 8 2 vst2_u16 uint16x4x2_t 8 4 vst2_u32 uint32x2x2_t 8 8 vst2_u64 uint64x1x2_t
        16 1 vst2q_u8 uint8x16x2_t 16 2 vst2q_u16 uint16x8x2_t 16 4 vst2q_u32 uint32x4x2_t 16 8 vst2q_u64 uint64x2x2_t
}
interleaved! {
    load3 store3 3 [0 1 2] 8 1 vld3_u8 vst3_u8 uint8x8x3_t 8 2 vld3_u16 vst3_u16 uint16x4x3_t 8 4 vld3_u32 vst3_u32 uint32x2x3_t 8 8 vld3_u64 vst3_u64 uint64x1x3_t
        16 1 vld3q_u8 vst3q_u8 uint8x16x3_t 16 2 vld3q_u16 vst3q_u16 uint16x8x3_t 16 4 vld3q_u32 vst3q_u32 uint32x4x3_t 16 8 vld3q_u64 vst3q_u64 uint64x2x3_t;
    load4 store4 4 [0 1 2 3] 8 1 vld4_u8 vst4_u8 uint8x8x4_t 8 2 vld4_u16 vst4_u16 uint16x4x4_t 8 4 vld4_u32 vst4_u32 uint32x2x4_t 8 8 vld4_u64 vst4_u64 uint64x1x4_t
        16 1 vld4q_u8 vst4q_u8 uint8x16x4_t 16 2 vld4q_u16 vst4q_u16 uint16x8x4_t 16 4 vld4q_u32 vst4q_u32 uint32x4x4_t 16 8 vld4q_u64 vst4q_u64 uint64x2x4_t;
}
