fn joined<B, A>(_: A, _: A, _: bool) -> Q {
    unreachable!()
}
macro_rules! usual {
    ($($step:literal $turn:literal $size:literal: $($first:literal)*;)*) => {
        /// Engines have an instruction or two for these. For other shuffles of small lanes, V8 makes the indices anew each time.
        const USUAL: &[([u8; 16], fn(Q, Q) -> Q)] = &[$($(usual!(@ $step $turn $size $first [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]),)*)*];
    };
    (@ $step:literal $turn:literal $size:literal $first:literal [$($i:literal)*]) => {{
        const fn at(i: usize) -> usize { $first + i / $size / 2 * $step + i / $size % 2 * $turn + (i & ($size - 1)) }
        #[inline(always)]
        fn moved(a: Q, b: Q) -> Q { i8x16_shuffle::<$({ at($i) }),*>(a, b) }
        ([$(at($i) as u8),*], moved)
    }};
}
usual! { 1 16 1: 0 8; 2 16 2: 0 8; 4 2 1: 0 1; 8 4 2: 0 2; 2 16 1: 0 1; 4 16 2: 0 2; 2 1 1: 1 2 3 5 6 7 9 10 11 13 14 15; }
/// Its place in the list. With one register, a lookup beats taking each second lane.
const fn usual(at: &[u8; 16], one: bool) -> Option<usize> {
    let mut k = 0;
    while k < USUAL.len() {
        let mut i = 0;
        while i < 16 && (at[i] ^ at[0] & 16 ^ USUAL[k].0[i]) & if one { 15 } else { 31 } == 0 {
            i += 1;
        }
        if i == 16 && !(one && matches!(k, 4..12)) {
            return Some(k);
        }
        k += 1;
    }
    None
}
macro_rules! words { ($($name:ident<$($k:ident)*> $i:literal $next:ident;)*) => {$(
    const fn $name<$(const $k: usize),*>(at: &[u8; 16]) -> fn(Q, Q) -> Q {
        match at[4 * $i] / 4 {
            0 => $next::<$($k,)* 0>(at), 1 => $next::<$($k,)* 1>(at), 2 => $next::<$($k,)* 2>(at), 3 => $next::<$($k,)* 3>(at),
            4 => $next::<$($k,)* 4>(at), 5 => $next::<$($k,)* 5>(at), 6 => $next::<$($k,)* 6>(at), _ => $next::<$($k,)* 7>(at),
        }
    }
)*}; }
// Only for constants. The parameter keeps rustc from compiling them.
words! { words<Z> 0 words1; words1<Z A> 1 words2; words2<Z A B> 2 words3; words3<Z A B C> 3 words4; }
const fn words4<const Z: usize, const A: usize, const B: usize, const C: usize, const D: usize>(
    _: &[u8; 16],
) -> fn(Q, Q) -> Q {
    #[inline(always)]
    fn moved<const A: usize, const B: usize, const C: usize, const D: usize>(a: Q, b: Q) -> Q {
        i32x4_shuffle::<A, B, C, D>(a, b)
    }
    moved::<A, B, C, D>
}
impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize, const R: usize> Plan<B, P, N, M, R> {
    /// The bytes from register number `k` among those that are used, and zeros.
    const fn bytes(k: usize) -> [u8; 16] {
        let (mut index, mut i, size) = ([0x80; 16], 0, size_of::<B>());
        while i < 16 {
            if Self::place(Self::FROM[i / size].0) == k {
                index[i] = (Self::FROM[i / size].1 as usize * size + i % size) as u8;
            }
            i += 1;
        }
        index
    }
    /// One shuffle, whether it takes the registers the other way round, and whether it is in the list.
    const SHUFFLE: Option<(fn(Q, Q) -> Q, bool, bool)> = {
        let (mut at, other, mut whole, mut i) = (Self::bytes(0), Self::bytes(1), true, 0);
        while i < 16 {
            if at[i] > 15 {
                at[i] = 16 + other[i];
            }
            whole &= at[i] as usize % 4 == i % 4 && at[i] / 4 == at[i / 4 * 4] / 4;
            i += 1;
        }
        match usual(&at, Self::USED.1 == 1) {
            _ if Self::USED.1 > 2 => None,
            Some(k) => Some((USUAL[k].1, at[0] > 15, true)),
            None if whole => Some((words::<0>(&at), false, false)),
            None => None,
        }
    };
    /// LLVM would change the indices of the lanes that are not used. It has instructions for upper halves.
    const CUT: bool = P::END * size_of::<B>() < 16 && !(Self::USED.1 == 1 && Self::bytes(0)[0] == 8);
    /// The number of bytes by which all move, within the lower half.
    const DOWN: u8 = {
        let (at, mut i, n) = (Self::bytes(0), 0, P::END * size_of::<B>());
        while i < n && i < 8 && at[i] == at[0] + i as u8 && at[i] < 8 {
            i += 1;
        }
        if i == n && size_of::<B>() < 4 { at[0] } else { 0 }
    };
    /// These bytes as a mask, if all stay in their places.
    const fn kept(k: usize) -> Option<Q> {
        let (mut index, mut i) = (Self::bytes(k), 0);
        while i < 16 {
            if index[i] < 16 && index[i] as usize != i {
                return None;
            }
            index[i] = if index[i] < 16 { 255 } else { 0 };
            i += 1;
        }
        Some(cast(index))
    }
    #[inline(always)]
    fn one<const K: usize>(v: Q) -> Q {
        match const { Self::kept(K) } {
            Some(mask) => v128_and(v, unless_known(mask, v)),
            None => looked_up(v, const { cast(Self::bytes(K)) }),
        }
    }
    #[inline(always)]
    fn moved<O: Reg>(from: Sources<B, N>) -> O {
        at!(Self::DOWN > 0 => cast(u64x2_shr(from.at(0), 8 * Self::DOWN as u32)));
        at!(Self::SHUFFLE.is_some() && Self::USED.1 == 1 && (!Self::CUT || P::END == 1) => cast(i8x16_swizzle(from.at(0), const { cast(Self::bytes(0)) })));
        if const { matches!(Self::SHUFFLE, Some((_, _, listed)) if !listed || Self::USED.1 == 2) } {
            let first = const { matches!(Self::SHUFFLE, Some((_, true, _))) as usize };
            let v = (const {
                match Self::SHUFFLE {
                    Some(it) => it.0,
                    None => USUAL[0].1,
                }
            })(from.at(first), from.at(1 - first));
            return cast(if const { Self::CUT && P::END > 1 && matches!(Self::SHUFFLE, Some((_, _, true))) } {
                whole(v)
            } else {
                v
            });
        }
        let mut v = Self::one::<0>(from.at(0));
        macro_rules! more { ($($k:literal)*) => { $(if const { Self::USED.1 > $k } { v = v128_or(v, Self::one::<$k>(from.at($k))); })* }; }
        // There are 8 registers of bytes, or 8 lanes.
        more!(1 2 3 4 5 6 7);
        cast(v)
    }
}
include!("plan.rs");
#[inline(always)]
pub fn reduce_sum<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    v.reduce::<S, op::add<T>>()
}
#[inline(always)]
pub fn reduce_min<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    v.reduce::<S, op::min<T>>()
}
#[inline(always)]
pub fn reduce_max<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    v.reduce::<S, op::max<T>>()
}

/// To lanes of twice the size.
#[inline(always)]
fn up<T: E, U: E>(v: Q, high: bool) -> Q {
    if const { U::FLOAT } {
        let v = if high { i64x2_shuffle::<1, 1>(v, v) } else { v };
        return if T::FLOAT {
            f64x2_promote_low_f32x4(v)
        } else if T::SIGNED {
            f64x2_convert_low_i32x4(v)
        } else {
            f64x2_convert_low_u32x4(v)
        };
    }
    macro_rules! rows { ($($size:literal $signed:literal $low:ident $high:ident)*) => { $(at!(T::SIZE == $size && T::SIGNED == $signed => if high { $high(v) } else { $low(v) });)* }; }
    rows!(1 true i16x8_extend_low_i8x16 i16x8_extend_high_i8x16 1 false u16x8_extend_low_u8x16 u16x8_extend_high_u8x16 2 true i32x4_extend_low_i16x8 i32x4_extend_high_i16x8
        2 false u32x4_extend_low_u16x8 u32x4_extend_high_u16x8 4 true i64x2_extend_low_i32x4 i64x2_extend_high_i32x4 4 false u64x2_extend_low_u32x4 u64x2_extend_high_u32x4);
    unreachable!()
}
#[inline(always)]
fn twice<T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    let mut out = Simd::<U, N>::zero();
    each!(i < size_of::<RegOf<U, N>>() / 16 => set_part(&mut out.0, i, up::<T, U>(part(&v.0, i / 2), i % 2 == 1)));
    out
}
/// Two registers to one, whose lanes have half the size.
#[inline(always)]
fn down<T: E, U: E, const SATURATE: bool>(a: Q, b: Q) -> Q {
    at!(T::FLOAT && U::FLOAT => i64x2_shuffle::<0, 2>(whole(f32x4_demote_f64x2_zero(a)), whole(f32x4_demote_f64x2_zero(b))));
    at!(T::FLOAT && U::SIGNED => i64x2_shuffle::<0, 2>(whole(i32x4_trunc_sat_f64x2_zero(a)), whole(i32x4_trunc_sat_f64x2_zero(b))));
    at!(T::FLOAT => i64x2_shuffle::<0, 2>(whole(u32x4_trunc_sat_f64x2_zero(a)), whole(u32x4_trunc_sat_f64x2_zero(b))));
    at!(SATURATE && T::SIGNED && T::SIZE == 2 => i8x16_narrow_i16x8(opaque(a), opaque(b)));
    at!(SATURATE && T::SIGNED && T::SIZE == 4 => i16x8_narrow_i32x4(opaque(a), opaque(b)));
    at!(SATURATE && T::SIZE == 2 => u8x16_narrow_i16x8(opaque(u16x8_min(a, u16x8_splat(255))), opaque(u16x8_min(b, u16x8_splat(255)))));
    at!(SATURATE && T::SIZE == 4 => u16x8_narrow_i32x4(opaque(u32x4_min(a, u32x4_splat(65535))), opaque(u32x4_min(b, u32x4_splat(65535)))));
    // x86 clears the upper halves first.
    at!(T::SIZE == 2 => pick(is_zero(i16x8_add(u16x8_shr(a, 8), u16x8_shr(b, 8))), u8x16_narrow_i16x8(opaque(a), opaque(b)), i8x16_shuffle::<0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30>(a, b)));
    at!(T::SIZE == 4 => pick(is_zero(i32x4_add(u32x4_shr(a, 16), u32x4_shr(b, 16))), u16x8_narrow_i32x4(opaque(a), opaque(b)), i16x8_shuffle::<0, 2, 4, 6, 8, 10, 12, 14>(a, b)));
    i32x4_shuffle::<0, 2, 4, 6>(a, b)
}
#[inline(always)]
fn half<T: Fits<N>, U: Fits<N>, const N: usize, const SATURATE: bool>(v: Simd<T, N>) -> Simd<U, N> {
    if const { size_of::<RegOf<T, N>>() == 16 } {
        return Simd::of(cast(down::<T, U, SATURATE>(cast(v.0), cast(v.0))));
    }
    let mut out = Simd::<U, N>::zero();
    each!(i < size_of::<RegOf<U, N>>() / 16 => set_part(&mut out.0, i, down::<T, U, SATURATE>(part(&v.0, 2 * i), part(&v.0, 2 * i + 1))));
    out
}
/// By one lookup for each register.
#[inline(always)]
fn cut<T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    let (mut out, per) = (Simd::<U, N>::zero(), T::SIZE / U::SIZE);
    let all = const {
        let (mut at, mut i, n) = ([[0x80u8; 16]; 8], 0, 16 * U::SIZE / T::SIZE);
        while i < 16 {
            at[if N * T::SIZE > 16 { i / n } else { 0 }][i] = ((i / U::SIZE * T::SIZE + i % U::SIZE) % 16) as u8;
            i += 1;
        }
        &{ at }
    };
    each!(i < size_of::<RegOf<T, N>>() / 16 => {
        let before = part(&out.0, i / per);
        set_part(&mut out.0, i / per, v128_or(before, looked_up(part(&v.0, i), cast(all[i % per]))))
    });
    out
}
include!("steps.rs");
struct Same<T, U>(T, U);
impl<T: E, U: E> Op1 for Same<T, U> {
    #[inline(always)]
    fn run<S: Cpu, R: Prim>(v: R, _: u32) -> R {
        let v = cast(v);
        cast(if U::FLOAT {
            // From smaller lanes, LLVM would convert them one by one.
            let signed = f32x4_convert_i32x4(opaque(v));
            if T::SIGNED { signed } else { pick(is_zero(u32x4_shr(v, 31)), signed, f32x4_convert_u32x4(v)) }
        } else if U::SIGNED {
            i32x4_trunc_sat_f32x4(v)
        } else {
            u32x4_trunc_sat_f32x4(v)
        })
    }
}
#[inline(always)]
fn same<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    Simd::of(cast(v.0.map1::<S, Same<T, U>>(0)))
}
#[inline(always)]
pub fn convert<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    at!(!T::FLOAT && !U::FLOAT && T::SIGNED && T::SIZE < U::SIZE => resized::<T, U, N, true, false>(v));
    lazily!(!T::FLOAT && !U::FLOAT && T::SIZE > U::SIZE && U::SIZE < 4 && (N * T::SIZE <= 16 || T::SIZE > 2 * U::SIZE) => cut(v));
    at!(!T::FLOAT && !U::FLOAT => resized::<T, U, N, false, false>(v));
    at!(T::SIZE == 4 && U::SIZE == 4 => same::<S, T, U, N>(v));
    at!(T::SIZE == 4 && U::FLOAT => twice(v));
    at!(T::FLOAT && T::SIZE == 8 && U::SIZE == 4 => half::<T, U, N, false>(v));
    if const { U::FLOAT && T::SIZE < 4 } {
        let wide: Simd<i32, N> = if const { T::SIGNED } {
            resized::<T, i32, N, true, false>(v)
        } else {
            resized::<T, i32, N, false, false>(v)
        };
        return if const { U::SIZE == 4 } { same::<S, i32, U, N>(wide) } else { twice(wide) };
    }
    if const { T::FLOAT && U::SIZE < 4 } {
        at!(U::SIGNED => resized::<i32, U, N, true, true>(if const { T::SIZE == 4 } { same::<S, T, i32, N>(v) } else { half::<T, i32, N, false>(v) }));
        return resized::<u32, U, N, false, true>(if const { T::SIZE == 4 } {
            same::<S, T, u32, N>(v)
        } else {
            half::<T, u32, N, false>(v)
        });
    }
    converted(v)
}
#[inline(always)]
pub fn cast_mask<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(m: Mask<T, N>) -> Mask<U, N> {
    Mask::of(resized::<T, U, N, true, true>(Simd::of(m.0.map1::<S, Hidden>(0))).0)
}
/// LLVM would move booleans, one by one.
struct Hidden;
impl Op1 for Hidden {
    #[inline(always)]
    fn run<S: Cpu, R: Prim>(v: R, _: u32) -> R {
        cast(opaque(cast(v)))
    }
}
/// For `k` vectors of `n` lanes that alternate in memory: where each byte of vector `v` is in register `r`, or the reverse.
const fn turns(k: usize, n: usize, size: usize, v: usize, r: usize, load: bool) -> Option<Q> {
    let (mut index, mut i, mut any) = ([0x80u8; 16], 0, false);
    while i < n * size {
        let at = (i / size * k + v) * size + i % size;
        if at / 16 == r {
            any = true;
            if load { index[i % 16] = (at % 16) as u8 } else { index[at % 16] = i as u8 }
        }
        i += 1;
    }
    while load && i < 16 {
        index[i] = index[i - n * size];
        i += 1;
    }
    if any { Some(cast(index)) } else { None }
}
#[inline(always)]
fn turned<T, const K: usize, const N: usize, const LOAD: bool>(from: [Q; 4]) -> [Q; 4] {
    macro_rules! each { ($($to:literal)*) => { [$(each!(@ $to 0 1 2 3)),*] };
        (@ $to:literal $($i:literal)*) => {{
            let mut v = Q::ZERO;
            $(if let Some(at) = const { let (v, r) = if LOAD { ($to, $i) } else { ($i, $to) }; if v < K { turns(K, N, size_of::<T>(), v, r, LOAD) } else { None } } {
                v = v128_or(v, looked_up(from[$i], at));
            })*
            v
        }};
    }
    each!(0 1 2 3)
}
/// Of one register each.
#[inline(always)]
pub fn loaded<T: Fits<N>, const K: usize, const N: usize>(from: [[T; N]; K]) -> [Simd<T, N>; K] {
    let mut all = [Q::ZERO; 4];
    set_part(&mut all, 0, from);
    start(turned::<T, K, N, true>(all))
}
#[inline(always)]
pub fn stored<T: Fits<N>, const K: usize, const N: usize>(vectors: [Simd<T, N>; K]) -> [[T; N]; K] {
    let mut all = [Q::ZERO; 4];
    set_part(&mut all, 0, vectors);
    start(turned::<T, K, N, false>(all))
}
