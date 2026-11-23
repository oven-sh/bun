//! Conversions and memory.
use super::super::convert::one_by_one as converted;
use super::*;

/// The bytes of a register for vectors of `R`.
const fn chunk<S: Cpu, R>() -> usize {
    let most = if S::LEVEL >= AVX512 {
        64
    } else if S::LEVEL >= AVX2 {
        32
    } else {
        16
    };
    if size_of::<R>() < most { size_of::<R>() } else { most }
}
/// The bytes from `at` on, up to the end of their block.
#[inline(always)]
fn block_from<A: Pod>(a: &A, at: usize) -> X {
    let v: X = part(a, at / 16);
    macro_rules! by { ($($k:literal)*) => { match at % 16 { $($k => run!(SSE2 _mm_srli_si128::<$k>(v)),)* _ => v } }; }
    by!(2 4 6 8 10 12 14)
}
macro_rules! ups { ($($from:literal $to:literal $i:ident $u:ident)*) => {
    /// From the first lanes.
    #[inline(always)]
    fn up_x<S: Cpu, T: E, U: E>(v: X) -> X {
        named!(SSE2 if T::FLOAT => f!(_mm _cvtps_pd(v)));
        named!(SSE2 if U::FLOAT && T::SIGNED => f!(_mm _cvtepi32_pd(v)));
        named!(AVX512 if U::FLOAT => f!(_mm _cvtepu32_pd(v)));
        $(named!(SSE4 if Size::<T, $from>::IS && Size::<U, $to>::IS => if T::SIGNED { call!(SSE4 _mm $i(v)) } else { call!(SSE4 _mm $u(v)) });)*
        unreachable!()
    }
    #[inline(always)]
    fn up_y<S: Cpu, T: E, U: E>(v: X) -> Y {
        named!(AVX2 if T::FLOAT => f!(_mm256 _cvtps_pd(v)));
        named!(AVX2 if U::FLOAT && T::SIGNED => f!(_mm256 _cvtepi32_pd(v)));
        named!(AVX512 if U::FLOAT => f!(_mm256 _cvtepu32_pd(v)));
        $(named!(AVX2 if Size::<T, $from>::IS && Size::<U, $to>::IS => if T::SIGNED { call!(AVX2 _mm256 $i(v)) } else { call!(AVX2 _mm256 $u(v)) });)*
        unreachable!()
    }
    #[inline(always)]
    fn up_z<S: Cpu, T: E, U: E, R: Prim>(v: R) -> Z {
        named!(AVX512 if T::FLOAT => f!(_mm512 _cvtps_pd(v)));
        named!(AVX512 if U::FLOAT && T::SIGNED => f!(_mm512 _cvtepi32_pd(v)));
        named!(AVX512 if U::FLOAT => f!(_mm512 _cvtepu32_pd(v)));
        $(named!(AVX512 if Size::<T, $from>::IS && Size::<U, $to>::IS => if T::SIGNED { call!(AVX512 _mm512 $i(cast(v))) } else { call!(AVX512 _mm512 $u(cast(v))) });)*
        unreachable!()
    }
}; }
ups! { 1 2 _cvtepi8_epi16 _cvtepu8_epi16 1 4 _cvtepi8_epi32 _cvtepu8_epi32 1 8 _cvtepi8_epi64 _cvtepu8_epi64
2 4 _cvtepi16_epi32 _cvtepu16_epi32 2 8 _cvtepi16_epi64 _cvtepu16_epi64 4 8 _cvtepi32_epi64 _cvtepu32_epi64 }
/// Number `i` of the registers that the lanes of `v` fill. Signed lanes go to the top, and are shifted.
#[inline(always)]
fn unpacked<S: Cpu, T: E, U: E>(mut v: X, i: usize) -> X {
    macro_rules! step { ($size:literal $lower:ident $upper:ident, $signed:expr) => { if const { T::SIZE <= $size && $size < U::SIZE } {
        let (a, b) = if T::SIGNED { $signed } else { (v, X::ZERO) };
        v = if i & U::SIZE / $size / 2 == 0 { run!(SSE2 $lower(a, b)) } else { run!(SSE2 $upper(a, b)) };
    } }; }
    step!(1 _mm_unpacklo_epi8 _mm_unpackhi_epi8, (v, v));
    step!(2 _mm_unpacklo_epi16 _mm_unpackhi_epi16, (if T::SIZE == 1 { v } else { X::ZERO }, v));
    if const { T::SIGNED && U::SIZE == 2 } {
        v = v.shr_by::<S, i16>(8);
    } else if const { T::SIGNED && T::SIZE < 4 } {
        v = v.shr_by::<S, i32>(32 - 8 * T::SIZE as u32);
    }
    step!(4 _mm_unpacklo_epi32 _mm_unpackhi_epi32, (v, v.negative::<S, i32>()));
    v
}
/// From a part that is a number. LLVM then extends from memory, if that is where it is.
#[cfg_attr(target_arch = "x86", allow(unused_variables))]
#[inline(always)]
fn up_number<S: Cpu, T: E, U: E, A: Pod, R: Pod>(v: &A, out: &mut R, i: usize) {
    #[cfg(target_arch = "x86_64")]
    macro_rules! rows { ($($level:ident $r:ident $n:ident $set:ident: $($from:literal $to:literal $float:literal $i:ident $u:ident)*;)*) => {$($(
        if const { chunk::<S, R>() == size_of::<$r>() && T::SIZE == $from && U::SIZE == $to && U::FLOAT == $float } {
            $level! { fn signed(v: $n) -> $r { cast($i(cast($set(v)))) } }
            $level! { fn other(v: $n) -> $r { cast($u(cast($set(v)))) } }
            return set_part(out, i, if T::SIGNED && !T::FLOAT { run!($level signed(part(v, i))) } else { run!($level other(part(v, i))) });
        }
    )*)*}; }
    #[cfg(target_arch = "x86_64")]
    rows! {
        AVX2 Y i64 _mm_cvtsi64_si128: 1 4 false _mm256_cvtepi8_epi32 _mm256_cvtepu8_epi32;
        SSE4 X i64 _mm_cvtsi64_si128: 2 4 false _mm_cvtepi16_epi32 _mm_cvtepu16_epi32;
        SSE2 X i64 _mm_cvtsi64_si128: 4 8 true _mm_cvtepi32_pd _mm_cvtps_pd;
        SSE4 X i32 _mm_cvtsi32_si128: 1 4 false _mm_cvtepi8_epi32 _mm_cvtepu8_epi32;
    }
    unreachable!()
}
/// Logic that follows would be done in a general register.
const fn by_number<S: Cpu, T: E, U: E, R, const NO_LOGIC: bool>() -> bool {
    let (chunk, step) = (chunk::<S, R>(), chunk::<S, R>() * T::SIZE / U::SIZE);
    let source = size_of::<R>() * T::SIZE / U::SIZE;
    let has = if U::FLOAT { T::SIZE == 4 && T::SIGNED } else { NO_LOGIC && U::SIZE == 4 && S::LEVEL >= SSE4 };
    cfg!(all(target_arch = "x86_64", not(bun_simd_unoptimized)))
        && has
        && chunk <= 32
        && (step == 4 || step == 8)
        && source >= 16
}
#[inline(always)]
fn up_part<S: Cpu, T: E, U: E, A: Pod, R: Pod, const NO_LOGIC: bool>(v: &A, out: &mut R, i: usize) {
    macro_rules! ways { ($($name:ident($v:ident, $i:ident, $at:ident) $e:expr;)*) => {$(
        #[inline(always)]
        fn $name<S: Cpu, T: E, U: E, A: Pod, R: Pod>($v: &A, out: &mut R, $i: usize) {
            let $at = $i * const { chunk::<S, R>() * T::SIZE / U::SIZE };
            set_part(out, $i, $e)
        }
    )*}; }
    ways! {
        old(v, i, at) unpacked::<S, T, U>(part(v, at / 16), i);
        x(v, i, at) up_x::<S, T, U>(block_from(v, at));
        y(v, i, at) up_y::<S, T, U>(block_from(v, at));
        z(v, i, _at) up_z::<S, T, U, Y>(part(v, i));
        z_of_less(v, i, at) up_z::<S, T, U, X>(block_from(v, at));
    }
    chosen!(fn(&A, &mut R, usize) -> (): by_number::<S, T, U, R, NO_LOGIC>() => up_number::<S, T, U, A, R>, chunk::<S, R>() == 16 && S::LEVEL < SSE4 && !U::FLOAT => old::<S, T, U, A, R>, chunk::<S, R>() == 16 => x::<S, T, U, A, R>,
        chunk::<S, R>() == 32 => y::<S, T, U, A, R>, U::SIZE == 2 * T::SIZE => z::<S, T, U, A, R>, _ => z_of_less::<S, T, U, A, R>)(
        v, out, i,
    )
}
#[inline(always)]
fn up<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    up_before::<S, T, U, N, false>(v)
}
#[inline(always)]
fn up_before<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize, const NO_LOGIC: bool>(v: Simd<T, N>) -> Simd<U, N> {
    let mut out = Simd::<U, N>::zero();
    each!(i < size_of::<RegOf<U, N>>() / chunk::<S, RegOf<U, N>>() => up_part::<S, T, U, _, _, NO_LOGIC>(&v.0, &mut out.0, i));
    out
}
/// LLVM sees a shift of bytes in this, for which it has `vgf2p8affineqb`.
#[inline(always)]
pub(super) fn bytes_shifted<S: Cpu, T: E, R: Pod, const LEFT: bool>(v: R, n: u32) -> R {
    macro_rules! by { ($p:ident $up:ident $v:expr) => {{
        let wide = $up::<S, T, i16>($v);
        call!(AVX512 $p _cvtepi16_epi8(if LEFT { wide.shl_by::<S, u16>(n % 8) } else if T::SIGNED { wide.shr_by::<S, i16>(n % 8) } else { wide.shr_by::<S, u16>(n % 8) }))
    }}; }
    #[inline(always)]
    fn up<S: Cpu, T: E, U: E>(v: Y) -> Z {
        up_z::<S, T, U, Y>(v)
    }
    if const { size_of::<R>() == 16 } {
        return cast(by!(_mm256 up_y cast(v)));
    }
    if const { size_of::<R>() == 32 } {
        return cast(by!(_mm512 up cast(v)));
    }
    joined_bytes::<Y, R>(by!(_mm512 up part(&v, 0)), by!(_mm512 up part(&v, 1)))
}
/// See `by_lanes`.
#[inline]
fn strided<T: Fits<N>, U: Fits<N>, const N: usize>(v: RegOf<T, N>) -> RegOf<U, N> {
    struct Every<T, U, const N: usize>(T, U);
    impl<T: Fits<N>, U: Fits<N>, const N: usize> Places for Every<T, U, N> {
        const FROM: [u16; 256] = {
            let (mut all, mut i, step, end, lanes) = (
                [0; 256],
                0,
                T::SIZE / U::SIZE,
                size_of::<RegOf<T, N>>() / U::SIZE,
                size_of::<RegOf<U, N>>() / U::SIZE,
            );
            while i < lanes {
                all[i] = (i * step % end) as u16;
                i += 1;
            }
            all
        };
    }
    moved::<U::Bits, <RegOf<T, N> as Reg>::Unit, _, _, Every<T, U, N>>(&v, <RegOf<U, N>>::ZERO)
}
const fn packs<S: Cpu, T: E, U: E>(n: usize) -> bool {
    S::LEVEL < AVX512 && U::SIZE < T::SIZE && T::SIZE <= 4 && n * U::SIZE >= 16
}
/// The lower parts of the lanes of two or four registers, block by block.
#[rules]
macro_rules! packs { ($($name:ident $r:ident $p:ident $base:ident $four:ident)*) => {$(
    #[inline(always)]
    fn $name<S: Cpu, T: E, U: E, A: Pod, const MASK: bool>(all: &A, i: usize) -> $r {
        let low = <$r>::set::<S, T::Bits>(T::Bits::of_bits(!0 >> (64 - 8 * U::SIZE)));
        let of = |k: usize| part::<A, $r>(all, k);
        macro_rules! low { ($$k:expr) => { of($$k).and::<S, T::Bits>(low) }; }
        if const { MASK && T::SIZE == 2 } { return call!($base $p _packs_epi16(of(2 * i), of(2 * i + 1))); }
        if const { MASK && U::SIZE == 2 } { return call!($base $p _packs_epi32(of(2 * i), of(2 * i + 1))); }
        if const { MASK } { return call!($base $p _packs_epi16(call!($base $p _packs_epi32(of(4 * i), of(4 * i + 1))), call!($base $p _packs_epi32(of(4 * i + 2), of(4 * i + 3))))); }
        if const { T::SIZE == 2 } { return call!($base $p _packus_epi16(low!(2 * i), low!(2 * i + 1))); }
        if const { U::SIZE == 1 } {
            let (a, b) = (call!($base $p _packs_epi32(low!(4 * i), low!(4 * i + 1))), call!($base $p _packs_epi32(low!(4 * i + 2), low!(4 * i + 3))));
            return call!($base $p _packus_epi16(a, b));
        }
        named!($four => { call!($four $p _packus_epi32(low!(2 * i), low!(2 * i + 1))) });
        macro_rules! signed { ($$k:expr) => { of($$k).shl_by::<S, i32>(16).shr_by::<S, i32>(16) }; }
        call!($base $p _packs_epi32(signed!(2 * i), signed!(2 * i + 1)))
    }
)*}; }
packs! { pack_x X _mm SSE2 SSE4 pack_y Y _mm256 AVX2 AVX2 }
#[inline(always)]
fn ordered<S: Cpu, T: E, U: E>(it: Y) -> Y {
    if const { T::SIZE == 2 * U::SIZE } {
        run!(AVX2 _mm256_permute4x64_epi64::<0xd8>(it))
    } else {
        run!(AVX2 _mm256_permutevar8x32_epi32(it, cast([0, 4, 1, 5, 2, 6, 3, 7])))
    }
}
#[inline(always)]
fn packed<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize, const MASK: bool>(v: Simd<T, N>) -> Simd<U, N> {
    let mut out = Simd::<U, N>::zero();
    if const { S::LEVEL >= AVX2 && N * U::SIZE >= 32 } {
        each!(i < N * U::SIZE / 32 => {
            let it = pack_y::<S, T, U, _, MASK>(&v.0, i);
            set_part(&mut out.0, i, ordered::<S, T, U>(it))
        });
    } else if const { S::LEVEL >= AVX2 } {
        let v = if MASK { v } else { v.and(Simd::splat(T::of_bits(!0 >> (64 - 8 * U::SIZE)))) };
        if const { T::SIZE == 2 * U::SIZE } {
            return Simd::of(cast(pack_x::<S, T, U, _, MASK>(&v.0, 0)));
        }
        let [a, b]: [X; 2] = cast(run!(AVX2 _mm256_packs_epi32(part(&v.0, 0), part(&v.0, 1))));
        return Simd::of(cast(
            run!(SSE2 _mm_shuffle_epi32::<0xd8>(if MASK { run!(SSE2 _mm_packs_epi16(a, b)) } else { run!(SSE2 _mm_packus_epi16(a, b)) })),
        ));
    } else {
        each!(i < N * U::SIZE / 16 => set_part(&mut out.0, i, pack_x::<S, T, U, _, MASK>(&v.0, i)));
    }
    out
}
/// LLVM sees a truncation in this, if it is by itself: the sum gives the type of the lanes, and the zero is only known after inlining.
macro_rules! halved { ($($level:ident $name:ident $r:ident $h:ident $t:ident $add:ident [$($i:literal)*])*) => {$(
    $level! { fn $name(a: $r, zero: $r) -> $h {
        let a = $add(a, zero);
        let mut v = a;
        $(set_part::<$r, $t>(&mut v, $i, part(&a, 2 * $i));)*
        part(&v, 0)
    } }
)*}; }
halved! { AVX2 words_y Y X u16 _mm256_add_epi32 [0 1 2 3 4 5 6 7] AVX2 bytes_y Y X u8 _mm256_add_epi16 [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15] }
#[inline(always)]
#[cfg(not(bun_simd_unoptimized))]
fn halved<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    let mut out = Simd::<U, N>::zero();
    macro_rules! half { ($level:ident $words:ident $bytes:ident $r:ident $i:expr) => {
        if T::SIZE == 4 { run!($level $words(part(&v.0, $i), $r::ZERO)) } else { run!($level $bytes(part(&v.0, $i), $r::ZERO)) }
    }; }
    if const { N * U::SIZE == 16 } {
        return Simd::of(cast(half!(AVX2 words_y bytes_y Y 0)));
    } else {
        each!(i < N * U::SIZE / 32 => set_part::<_, Y>(&mut out.0, i, joined(half!(AVX2 words_y bytes_y Y 2 * i), half!(AVX2 words_y bytes_y Y 2 * i + 1))));
    }
    out
}
#[inline(always)]
fn truncated<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    // LLVM joins the halves.
    #[cfg(not(bun_simd_unoptimized))]
    {
        lazily!(S::LEVEL == AVX2 && packs::<S, T, U>(N) && T::SIZE == 2 * U::SIZE => halved::<S, T, U, N>(v));
        lazily!(S::LEVEL == AVX2 && packs::<S, T, U>(N) && T::SIZE == 4 * U::SIZE => halved::<S, u16, U, N>(halved::<S, T, u16, N>(v)));
    }
    if const { packs::<S, T, U>(N) } {
        return chosen!(fn(_) -> _: packs::<S, T, U>(N) => packed::<S, T, U, N, false>, _ => |_| unreachable!())(v);
    }
    if const { S::LEVEL == AVX2 && T::SIZE >= 4 * U::SIZE && matches!(N * T::SIZE, 32 | 64) && N * U::SIZE <= 16 } {
        // Each block to its place, with zeros around.
        let at: [Y; 2] = const {
            let (mut at, mut i, each) = ([0x80u8; 64], 0, 16 / T::SIZE * U::SIZE);
            while i < N * U::SIZE && i < 16 {
                at[i / each * 16 % 64 + i] = (i % each / U::SIZE * T::SIZE + i % U::SIZE) as u8;
                i += 1;
            }
            cast(at)
        };
        let mut all = run!(AVX2 _mm256_shuffle_epi8(part(&v.0, 0), at[0]));
        if const { N * T::SIZE == 64 } {
            all = all.or::<S, u8>(run!(AVX2 _mm256_shuffle_epi8(part(&v.0, 1), at[1])));
        }
        let [a, b]: [X; 2] = cast(all);
        return Simd::of(cast(a.or::<S, u8>(b)));
    }
    if const { S::LEVEL < AVX512 && T::SIZE == 4 && U::SIZE == 1 && N == 8 } {
        let [a, b]: [X; 2] = cast(v.and(Simd::splat(T::of_bits(255))).0);
        let words = run!(SSE2 _mm_packs_epi32(a, b));
        return Simd::of(cast(run!(SSE2 _mm_packus_epi16(words, words))));
    }
    macro_rules! rows { ($($from:literal $to:literal $f:ident)*) => {$(
        at!(AVX512 if T::SIZE == $from && U::SIZE == $to && N * $from <= 16 => Simd::of(f!(AVX512 _mm $f(v.0))));
        at!(AVX512 if T::SIZE == $from && U::SIZE == $to && N * $from == 32 => Simd::of(f!(AVX512 _mm256 $f(v.0))));
        at!(AVX512 if T::SIZE == $from && U::SIZE == $to && N * $from == 64 => Simd::of(f!(AVX512 _mm512 $f(v.0))));
    )*}; }
    rows!(2 1 _cvtepi16_epi8 4 1 _cvtepi32_epi8 8 1 _cvtepi64_epi8 4 2 _cvtepi32_epi16 8 2 _cvtepi64_epi16 8 4 _cvtepi64_epi32);
    Simd::of(
        chosen!(fn(_) -> _: !packs::<S, T, U>(N) && (S::LEVEL < AVX512 || N * T::SIZE > 64) => strided::<T, U, N>, _ => |_| unreachable!())(
            v.0,
        ),
    )
}
/// To less than a register, where LLVM doesn't take the limits into the truncation.
#[inline(always)]
pub fn saturated<S: Cpu, T: E, U: E, const N: usize>(v: Simd<u8, N>) -> Simd<u8, 16>
where
    u8: Fits<N>,
{
    macro_rules! rows { ($($from:literal $to:literal $i:ident $u:ident)*) => {$(if const { T::SIZE == $from && U::SIZE == $to } {
        at!(AVX512 if N == 16 => Simd::of(if U::SIGNED { f!(AVX512 _mm $i(v.0)) } else { f!(AVX512 _mm $u(v.0)) }));
        at!(AVX512 if N == 32 => Simd::of(if U::SIGNED { f!(AVX512 _mm256 $i(v.0)) } else { f!(AVX512 _mm256 $u(v.0)) }));
        at!(AVX512 if N == 64 => Simd::of(if U::SIGNED { f!(AVX512 _mm512 $i(v.0)) } else { f!(AVX512 _mm512 $u(v.0)) }));
    })*}; }
    rows!(2 1 _cvtsepi16_epi8 _cvtusepi16_epi8 4 1 _cvtsepi32_epi8 _cvtusepi32_epi8 8 1 _cvtsepi64_epi8 _cvtusepi64_epi8
        4 2 _cvtsepi32_epi16 _cvtusepi32_epi16 8 2 _cvtsepi64_epi16 _cvtusepi64_epi16 8 4 _cvtsepi64_epi32 _cvtusepi64_epi32);
    unreachable!()
}
/// From a float to lanes of half its size.
#[inline(always)]
fn down<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    #[inline(always)]
    fn x<S: Cpu, U: E>(v: X) -> X {
        if U::FLOAT { f!(SSE2 _mm _cvtpd_ps(v)) } else { f!(SSE2 _mm _cvttpd_epi32(v)) }
    }
    #[inline(always)]
    fn y<S: Cpu, U: E>(v: Y) -> X {
        if U::FLOAT { f!(AVX2 _mm256 _cvtpd_ps(v)) } else { f!(AVX2 _mm256 _cvttpd_epi32(v)) }
    }
    #[inline(always)]
    fn z<S: Cpu, U: E>(v: Z) -> Y {
        if U::FLOAT { f!(AVX512 _mm512 _cvtpd_ps(v)) } else { f!(AVX512 _mm512 _cvttpd_epi32(v)) }
    }
    let mut out = Simd::<U, N>::zero();
    if const { N * T::SIZE <= 16 } {
        return Simd::of(cast(x::<S, U>(start(v.0))));
    }
    if const { chunk::<S, RegOf<T, N>>() == 16 } {
        each!(i < N * T::SIZE / 32 => set_part(&mut out.0, i, run!(SSE2 _mm_unpacklo_epi64(x::<S, U>(part(&v.0, 2 * i)), x::<S, U>(part(&v.0, 2 * i + 1))))));
    } else if const { chunk::<S, RegOf<T, N>>() == 32 } {
        each!(i < N * T::SIZE / 32 => set_part(&mut out.0, i, y::<S, U>(part(&v.0, i))));
    } else {
        each!(i < N * T::SIZE / 64 => set_part(&mut out.0, i, z::<S, U>(part(&v.0, i))));
    }
    out
}
struct Same<T, U>(T, U);
macro_rules! same { ($($size:literal $p:ident $base:ident)*) => {
    impl<T: E, U: E> Op1 for Same<T, U> {
        #[inline(always)]
        fn run<S: Cpu, R: Prim>(v: R, _: u32) -> R {
            $(if const { size_of::<R>() == $size } {
                named!($base if Size::<T, 4>::IS && T::FLOAT && U::SIGNED => f!($p _cvttps_epi32(v)));
                named!($base if Size::<T, 4>::IS && U::FLOAT && T::SIGNED => f!($p _cvtepi32_ps(v)));
                named!(AVX512 if Size::<T, 4>::IS => if T::FLOAT { f!(AVX512 $p _cvttps_epu32(v)) } else { start(run!(AVX512 _mm512_cvtepu32_ps(super::super::bits::widened(v)))) });
                named!(AVX512 if T::FLOAT => if U::SIGNED { f!(AVX512 $p _cvttpd_epi64(v)) } else { f!(AVX512 $p _cvttpd_epu64(v)) });
                named!(AVX512 => if T::SIGNED { f!(AVX512 $p _cvtepi64_pd(v)) } else { f!(AVX512 $p _cvtepu64_pd(v)) });
            })*
            unreachable!()
        }
    }
}; }
same! { 16 _mm SSE2 32 _mm256 AVX2 64 _mm512 AVX512 }
#[inline(always)]
fn same<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    Simd::of(cast(v.0.map1::<S, Same<T, U>>(0)))
}

#[inline(always)]
pub fn convert<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    chosen!(fn(_) -> _: !T::FLOAT && !U::FLOAT && T::SIZE < U::SIZE => up::<S, T, U, N>, !T::FLOAT && !U::FLOAT => truncated::<S, T, U, N>,
        T::FLOAT && U::FLOAT && T::SIZE < U::SIZE => up::<S, T, U, N>, T::FLOAT && U::FLOAT => down::<S, T, U, N>, _ => mixed::<S, T, U, N>)(
        v,
    )
}
#[inline(always)]
fn mixed<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    macro_rules! quick {
        () => {
            (S::LEVEL >= AVX512 || T::SIZE <= 4 && T::SIGNED)
        };
    }
    macro_rules! same {
        () => {
            (T::FLOAT && T::SIZE == U::SIZE && (S::LEVEL >= AVX512 || T::SIZE == 4 && U::SIGNED))
        };
    }
    lazily!(U::FLOAT && T::SIZE < 4 => <u32 as SameLanes<T, N>>::through::<S, U>(v));
    lazily!(U::FLOAT && T::SIZE == U::SIZE && quick!() => same::<S, T, U, N>(v));
    lazily!(U::FLOAT && T::SIZE == 4 && U::SIZE == 8 && quick!() => up::<S, T, U, N>(v));
    lazily!(U::FLOAT && T::SIZE == 4 && U::SIZE == 4 && !quick!() => {
        // Each half is exact.
        let part = |v: Simd<T, N>| same::<S, T::Mask, U, N>(v.bits());
        part(v.shr_by(16)).mul(Simd::splat(U::of_f32(65536.0))).add(part(v.and(Simd::splat(T::of_bits(0xffff)))))
    });
    lazily!(same!() && !U::SIGNED => same::<S, T, U, N>(v.simd_gt(Simd::zero()).select(v, Simd::zero())));
    lazily!(same!() && U::SIGNED => {
        let over: Simd<U, N> = v.simd_ge(Simd::splat(T::of_u64(1 << (8 * T::SIZE - 1)))).to_simd().bits();
        same::<S, T, U, N>(v).xor(over).and(v.simd_eq(v).to_simd().bits())
    });
    lazily!(T::FLOAT && (U::SIZE < 4 || U::SIZE < T::SIZE && U::SIGNED) => {
        let (least, most) = const { let bits = 8 * U::SIZE as u32 % 63; if U::SIGNED { (-1i64 << (bits - 1), !(-1i64 << (bits - 1))) } else { (0, !(-1i64 << bits)) } };
        let (least, most) = (Simd::splat(T::of_i64(least)), Simd::splat(T::of_i64(most)));
        let within = v.simd_max(least).simd_min(most);
        let within = if U::SIGNED { within.and(v.simd_eq(v).to_simd().bits()) } else { within };
        let whole: Simd<i32, N> = chosen!(fn(_) -> _: T::SIZE == 4 => same::<S, T, i32, N>, _ => down::<S, T, i32, N>)(within);
        if const { U::SIZE == 4 } { whole.bits() } else { truncated::<S, i32, U, N>(whole) }
    });
    converted(v)
}
/// All classes have the same numbers of lanes, which generic code doesn't see.
trait SameLanes<T: Fits<N>, const N: usize> {
    fn through<S: Cpu, U: Fits<N>>(v: Simd<T, N>) -> Simd<U, N>;
}
impl<T: Fits<N>, const N: usize> SameLanes<T, N> for u32 {
    #[inline(always)]
    fn through<S: Cpu, U: Fits<N>>(v: Simd<T, N>) -> Simd<U, N> {
        let wide: Simd<U::Mask, N> = up_before::<S, T, U::Mask, N, true>(v);
        if const { U::SIZE == 4 || S::LEVEL >= AVX512 } { same::<S, U::Mask, U, N>(wide) } else { converted(v) }
    }
}
#[inline(always)]
pub fn cast_mask<S: Cpu, T: Fits<N>, U: Fits<N>, const N: usize>(m: Mask<T, N>) -> Mask<U, N> {
    lazily!(S::LEVEL >= AVX512 => Mask::from_bitmask(m.to_bitmask()));
    lazily!(packs::<S, T, U>(N) => Mask::of(packed::<S, T, U, N, true>(Simd::of(m.0)).0));
    if const { U::SIZE < T::SIZE && T::SIZE <= 4 } {
        let (a, b): (X, X) = (start(m.0), part(&m.0, N * T::SIZE / 32));
        let v = if T::SIZE == 4 { run!(SSE2 _mm_packs_epi32(a, b)) } else { run!(SSE2 _mm_packs_epi16(a, b)) };
        return Mask::of(cast(if T::SIZE == 4 * U::SIZE { run!(SSE2 _mm_packs_epi16(v, v)) } else { v }));
    }
    lazily!(S::LEVEL < SSE4 && U::SIZE > T::SIZE => {
        let mut out = Simd::<U, N>::zero();
        each!(i < size_of::<RegOf<U, N>>() / 16 => {
            let mut v: X = part(&m.0, i * T::SIZE / U::SIZE);
            macro_rules! twice { ($($size:literal $lower:ident $upper:ident)*) => {$(if const { T::SIZE <= $size && $size < U::SIZE } {
                v = if i & U::SIZE / $size / 2 == 0 { run!(SSE2 $lower(v, v)) } else { run!(SSE2 $upper(v, v)) };
            })*}; }
            twice!(1 _mm_unpacklo_epi8 _mm_unpackhi_epi8 2 _mm_unpacklo_epi16 _mm_unpackhi_epi16 4 _mm_unpacklo_epi32 _mm_unpackhi_epi32);
            set_part(&mut out.0, i, v)
        });
        Mask::of(out.0)
    });
    lazily!(S::LEVEL < AVX512 && !(U::SIZE < T::SIZE && T::SIZE <= 4) && !(S::LEVEL < SSE4 && U::SIZE > T::SIZE) => Mask::of(convert::<S, T::Mask, U::Mask, N>(Simd::of(m.0)).0));
    unreachable!()
}
