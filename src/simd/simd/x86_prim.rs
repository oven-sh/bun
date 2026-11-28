/// By the size of the lanes.
macro_rules! sized { ($level:ident $(if $c:expr)?, $p:ident $args:tt: $($size:literal $n:ident)*) => { sized!(@ $level, true $(&& $c)?, $p $args: $($size $n)*) };
    (@ $level:ident, $c:expr, $p:ident $args:tt: $($size:literal $n:ident)*) => { $(named!($level if $c && Size::<T, $size>::IS => f!($p $n $args));)* };
}
/// In lanes of 32 bits, so that LLVM sees what happens to signs and masks.
macro_rules! typed {
    (X $p:ident $ps:ident _and_epi32 $args:tt) => {};
    (X $p:ident $ps:ident $int:ident $args:tt) => { sized!(AVX512, $p $args: 4 $int) };
    (Y $p:ident $ps:ident $int:ident $args:tt) => { sized!(AVX2, $p $args: 4 $ps) };
    (Z $p:ident $ps:ident $int:ident $args:tt) => { sized!(AVX512, $p $args: 4 $int) };
}
macro_rules! old { (Z $($t:tt)*) => {}; ($r:ident $($t:tt)*) => { $($t)* }; }
macro_rules! only { (X X $($t:tt)*) => { $($t)* }; (Y Y $($t:tt)*) => { $($t)* }; (Z Z $($t:tt)*) => { $($t)* }; ($a:ident $b:ident $($t:tt)*) => {}; }
macro_rules! movm { ($p:ident, $k:expr) => {{ let k = $k; match T::SIZE {
    1 => call!(AVX512 $p _movm_epi8(k as _)), 2 => call!(AVX512 $p _movm_epi16(k as _)), 4 => call!(AVX512 $p _movm_epi32(k as _)), _ => call!(AVX512 $p _movm_epi64(k as _)),
} }}; }
macro_rules! compare { ($r:ident $p:ident $a:ident $b:ident $imm:literal [$($size:literal $i:ident $u:ident)*] $ps:ident $pd:ident) => {
    named!(AVX512 if T::FLOAT && Size::<T, 4>::IS => movm!($p, call!(AVX512 $p _cmp_ps_mask::<$imm>(cast($a), cast($b)))));
    named!(AVX512 if T::FLOAT => movm!($p, call!(AVX512 $p _cmp_pd_mask::<$imm>(cast($a), cast($b)))));
    $(named!(AVX512 if Size::<T, $size>::IS && T::SIGNED => movm!($p, call!(AVX512 $p $i($a, $b))));
    named!(AVX512 if Size::<T, $size>::IS => movm!($p, call!(AVX512 $p $u($a, $b))));)*
    only! { $r X sized!(SSE2 if T::FLOAT, _mm($a, $b): 4 $ps 8 $pd); }
    only! { $r Y named!(AVX2 if T::FLOAT && Size::<T, 4>::IS => f!(_mm256 _cmp_ps::<$imm>($a, $b))); named!(AVX2 if T::FLOAT => f!(_mm256 _cmp_pd::<$imm>($a, $b))); }
}; }
/// `$over` is the truth table of overflow, from the signs of both operands and the result. There, the shift fills the lane with the wrong sign.
macro_rules! limited { ($p:ident $a:ident $b:ident $over:literal, $result:expr) => {{
    let result = $result;
    let over = call!(AVX512 $p _ternarylogic_epi64::<$over>($a, $b, result)).and::<S, T>(Self::set::<S, T>(T::of_bits(1 << (8 * T::SIZE - 1))));
    if T::SIZE == 4 { call!(AVX512 $p _srav_epi32(result, over)) } else { call!(AVX512 $p _srav_epi64(result, over)) }.xor::<S, T>(over)
}}; }
macro_rules! rounded { ($r:ident $p:ident $four:ident: $($name:ident $imm:literal)*) => {$(
    #[inline(always)]
    fn $name<S: Cpu, T: E>(self) -> Self {
        old! { $r named!($four if Size::<T, 4>::IS => f!($p _round_ps::<$imm>(self))); named!($four => f!($p _round_pd::<$imm>(self))); }
        only! { $r Z named!(AVX512 if Size::<T, 4>::IS => f!($p _roundscale_ps::<$imm>(self))); named!(AVX512 => f!($p _roundscale_pd::<$imm>(self))); }
        rest!(S::LEVEL < SSE4 => emulate::$name::<S, T, Self>, (self))
    }
)*}; }
fn none1<R>(_: R) -> R {
    unreachable!()
}
fn none2<A, B, R>(_: A, _: B) -> R {
    unreachable!()
}
fn none3<R>(_: R, _: R, _: R) -> R {
    unreachable!()
}
/// What is made of other operations, if the rows before can leave it over.
macro_rules! rest {
    ($c:expr => $f:expr, ($a:expr)) => { chosen!(fn(Self) -> Self: $c => $f, _ => none1)($a) };
    ($c:expr => $f:expr, ($a:expr, $b:expr)) => { chosen!(fn(_, _) -> Self: $c => $f, _ => none2)($a, $b) };
    ($c:expr => $f:expr, ($a:expr, $b:expr, $d:expr)) => { chosen!(fn(Self, Self, Self) -> Self: $c => $f, _ => none3)($a, $b, $d) };
}
macro_rules! made { ($($name:ident($a:ident, $b:ident) $body:expr;)*) => { $(#[inline(always)] fn $name<S: Cpu, T: E, R: Prim>($a: R, $b: R) -> R { $body })* }; }
made! {
    abs8(a, b) a.min::<S, u8>(b.neg::<S, T>()); abs16(a, b) a.max::<S, i16>(b.neg::<S, T>()); abs_by_sign(a, b) { let sign = b.negative::<S, T>(); a.xor::<S, T>(sign).sub::<S, T>(sign) };
    apart_by_sign(a, b) { let less = a.lt::<S, T>(b); a.sub::<S, T>(b).xor::<S, T>(less).sub::<S, T>(less) };
    min16(a, b) a.sub::<S, T>(a.saturating_sub::<S, T>(b)); max16(a, b) b.add::<S, T>(a.saturating_sub::<S, T>(b));
    not_le(a, b) b.le::<S, T>(a).not::<S, T>(); is_min(a, b) a.min::<S, T>(b).eq::<S, T>(a); le16(a, b) a.saturating_sub::<S, T>(b).eq::<S, T>(R::ZERO);
    sum_or_max(a, b) { let sum = a.add::<S, T>(b); sum.or::<S, T>(sum.lt::<S, T>(a)) }; difference_or_zero(a, b) a.sub::<S, T>(b).and::<S, T>(b.lt::<S, T>(a));
}
macro_rules! by { ($c:expr => $f:ident($a:ident, $b:ident)) => { if const { $c } { return rest!($c => $f::<S, T, Self>, ($a, $b)); } }; }
macro_rules! two { ($($name:ident($a:ident, $b:ident) $([$c:expr])? { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self, $b: Self) -> Self { { let $a = self; $($body)* rest!(true $(&& $c)? => emulate::$name::<S, T, Self>, ($a, $b)) } }
)*}; }
macro_rules! one { ($($name:ident($a:ident) $([$c:expr])? { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self) -> Self { let $a = self; $($body)* rest!(true $(&& $c)? => emulate::$name::<S, T, Self>, ($a)) }
)*}; }
macro_rules! float {
    (X 4) => {
        __m128
    };
    (Y 4) => {
        __m256
    };
    (Z 4) => {
        __m512
    };
    (X 8) => {
        __m128d
    };
    (Y 8) => {
        __m256d
    };
    (Z 8) => {
        __m512d
    };
}
/// See `whole`. It is called by a pointer, so that rustc doesn't inline it.
#[inline]
fn product(a: X, b: X) -> X {
    let cross = run!(SSE2 _mm_add_epi64(run!(SSE2 _mm_mul_epu32(run!(SSE2 _mm_srli_epi64::<32>(a)), b)), run!(SSE2 _mm_mul_epu32(a, run!(SSE2 _mm_srli_epi64::<32>(b))))));
    run!(SSE2 _mm_add_epi64(run!(SSE2 _mm_mul_epu32(a, b)), run!(SSE2 _mm_slli_epi64::<32>(cross))))
}
#[inline]
fn twice(value: f64) -> __m128d {
    let v = run!(SSE2 _mm_set_sd(value));
    run!(SSE2 _mm_unpacklo_pd(v, v))
}
const fn has_min<S: Cpu, T: E>() -> bool {
    !T::FLOAT
        && (S::LEVEL >= AVX512
            || S::LEVEL >= SSE4 && T::SIZE < 8
            || T::SIZE == 1 && !T::SIGNED
            || T::SIZE == 2 && T::SIGNED)
}

/// In a register, and unknown to LLVM.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
#[inline(always)]
fn kept<S: Cpu, R: Pod>(v: R) -> R {
    use crate::regs::{xmm as x, ymm as y, zmm as z};
    if const { size_of::<R>() == 16 } {
        cast(run!(SSE2 x(cast(v))))
    } else if const { size_of::<R>() == 32 } {
        cast(run!(AVX2 y(cast(v))))
    } else {
        cast(run!(AVX512 z(cast(v))))
    }
}
/// Each of two lanes of 64 bits by its own count.
#[inline(always)]
fn halves_by<S: Cpu, R: Prim, const LEFT: bool>(a: R, n: R) -> R {
    let (a, n): (X, X) = (cast(a), cast(n));
    let upper = run!(SSE2 _mm_unpackhi_epi64(n, n));
    let (x, y) = if LEFT {
        (run!(SSE2 _mm_sll_epi64(a, n)), run!(SSE2 _mm_sll_epi64(a, upper)))
    } else {
        (run!(SSE2 _mm_srl_epi64(a, n)), run!(SSE2 _mm_srl_epi64(a, upper)))
    };
    f!(SSE2 _mm _shuffle_pd::<2>(x, y))
}
#[rules]
macro_rules! prim { ($r:ident $p:ident $base:ident $four:ident $avx:ident $and:ident $or:ident $xor:ident $andnot:ident $set64:ident) => {
    impl Prim for $r {
        #[inline(always)]
        fn set<S: Cpu, T: E>(value: T) -> Self {
            only! { $r X if const { T::FLOAT && T::SIZE == 8 && !cfg!(bun_simd_unoptimized) } { return cast((twice as fn(_) -> _)(cast(value))); } }
            sized!($base if T::FLOAT, $p(value): 4 _set1_ps 8 _set1_pd);
            sized!($base, $p(value): 1 _set1_epi8 2 _set1_epi16 4 _set1_epi32 8 $set64);
            unreachable!()
        }
        #[inline(always)]
        fn repeat<S: Cpu>(block: [u8; 16]) -> Self { start([block, block, block, block]) }
        #[inline(always)]
        fn table<S: Cpu>(self, indices: Self) -> Self { named!($four => f!($p _shuffle_epi8(self, indices))); unreachable!() }
        #[inline(always)]
        fn sign_bits<S: Cpu, T: E>(self) -> u64 {
            named!(AVX512 => match T::SIZE { 1 => call!(AVX512 $p _movepi8_mask(self)) as u64, 2 => call!(AVX512 $p _movepi16_mask(self)) as u64,
                4 => call!(AVX512 $p _movepi32_mask(self)) as u64, _ => call!(AVX512 $p _movepi64_mask(self)) as u64 });
            old! { $r
                named!($base if Size::<T, 1>::IS => call!($base $p _movemask_epi8(self)) as u32 as u64);
                named!($base if Size::<T, 4>::IS => call!($base $p _movemask_ps(cast(self))) as u32 as u64);
                named!($base if Size::<T, 8>::IS => call!($base $p _movemask_pd(cast(self))) as u32 as u64);
            }
            only! { $r X named!(SSE2 => run!(SSE2 _mm_movemask_epi8(run!(SSE2 _mm_packs_epi16(self, self)))) as u8 as u64); }
            only! { $r Y let [a, b]: [X; 2] = cast(self); named!(SSE2 => run!(SSE2 _mm_movemask_epi8(run!(SSE2 _mm_packs_epi16(a, b)))) as u32 as u64); }
            unreachable!()
        }
        #[inline(always)]
        fn of_bits<S: Cpu, T: E>(bits: u64) -> Self {
            named!(AVX512 => movm!($p, bits));
            only! { $r X named!(SSE2 if Size::<T, 1>::IS && !Has::<S>::SSE4 => {
                let v = run!(SSE2 _mm_cvtsi32_si128(bits as i32));
                let v = run!(SSE2 _mm_unpacklo_epi8(v, v));
                let (v, each) = (run!(SSE2 _mm_shuffle_epi32::<0x50>(run!(SSE2 _mm_unpacklo_epi16(v, v)))), run!(SSE2 _mm_set1_epi64x(0x8040_2010_0804_0201u64 as i64)));
                run!(SSE2 _mm_cmpeq_epi8(run!(SSE2 _mm_and_si128(v, each)), each))
            }); }
            chosen!(fn(u64) -> Self: S::LEVEL < AVX512 => emulate::of_bits::<S, T, Self>, _ => |_| unreachable!())(bits)
        }
        two! {
            add(a, b) [false] { sized!($base if T::FLOAT, $p(a, b): 4 _add_ps 8 _add_pd); sized!($base, $p(a, b): 1 _add_epi8 2 _add_epi16 4 _add_epi32 8 _add_epi64); }
            sub(a, b) [false] { sized!($base if T::FLOAT, $p(a, b): 4 _sub_ps 8 _sub_pd); sized!($base, $p(a, b): 1 _sub_epi8 2 _sub_epi16 4 _sub_epi32 8 _sub_epi64); }
            div(a, b) [false] { sized!($base, $p(a, b): 4 _div_ps 8 _div_pd); }
            mul(a, b) [false] {
                sized!($base if T::FLOAT, $p(a, b): 4 _mul_ps 8 _mul_pd);
                sized!($base, $p(a, b): 2 _mullo_epi16);
                sized!($four, $p(a, b): 4 _mullo_epi32);
                sized!(AVX512, $p(a, b): 8 _mullo_epi64);
                let low = Self::set::<S, u16>(0xff);
                if const { T::SIZE == 1 && S::LEVEL >= AVX512 } {
                    let odd = low.and_not::<S, u16>(a).mul::<S, u16>(b.shr_by::<S, u16>(8));
                    return call!(AVX512 $p _ternarylogic_epi64::<0xec>(a.mul::<S, u16>(b), odd, low));
                }
                if const { T::SIZE == 1 } {
                    return a.mul::<S, u16>(b).and::<S, u16>(low).or::<S, u16>(low.and_not::<S, u16>(a).mul::<S, u16>(b.shr_by::<S, u16>(8)));
                }
                #[allow(unused_macros)]
                macro_rules! even { ($$a:expr, $$b:expr) => { call!($base $p _mul_epu32($$a, $$b)) }; }
                only! { $r X if const { T::SIZE == 4 } {
                    let odd = even!(run!(SSE2 _mm_shuffle_epi32::<0xf5>(a)), run!(SSE2 _mm_shuffle_epi32::<0xf5>(b)));
                    return run!(SSE2 _mm_shuffle_epi32::<0xd8>(f!(SSE2 _mm _shuffle_ps::<0x88>(even!(a, b), odd))));
                } }
                only! { $r X return (product as fn(_, _) -> _)(a, b); }
                // By itself, LLVM sees that this is one product, and then what its operands are.
                $base! { fn whole(a: $r, b: $r) -> $r {
                    let cross = ${concat($p, _add_epi64)}(${concat($p, _mul_epu32)}(${concat($p, _srli_epi64)}::<32>(a), b), ${concat($p, _mul_epu32)}(a, ${concat($p, _srli_epi64)}::<32>(b)));
                    ${concat($p, _add_epi64)}(${concat($p, _mul_epu32)}(a, b), ${concat($p, _slli_epi64)}::<32>(cross))
                } }
                return run!($base whole(a, b));
            }
            and(a, b) [false] { typed!($r $p _and_ps _and_epi32(a, b)); named!($base => f!($p $and(a, b))); }
            or(a, b) [false] { typed!($r $p _or_ps _or_epi32(a, b)); named!($base => f!($p $or(a, b))); }
            xor(a, b) [false] { typed!($r $p _xor_ps _xor_epi32(a, b)); named!($base => f!($p $xor(a, b))); }
            and_not(a, b) [false] { named!($base => f!($p $andnot(a, b))); }
            min(a, b) [!T::FLOAT && T::SIZE != 2 && !has_min::<S, T>()] {
                sized!($base if T::FLOAT, $p(a, b): 4 _min_ps 8 _min_pd);
                sized!($base if T::SIGNED, $p(a, b): 2 _min_epi16); sized!($base if !T::SIGNED, $p(a, b): 1 _min_epu8);
                sized!($four if T::SIGNED && !T::FLOAT, $p(a, b): 1 _min_epi8 4 _min_epi32); sized!($four if !T::SIGNED, $p(a, b): 2 _min_epu16 4 _min_epu32);
                sized!(AVX512 if T::SIGNED && !T::FLOAT, $p(a, b): 8 _min_epi64); sized!(AVX512 if !T::SIGNED, $p(a, b): 8 _min_epu64);
                by!(T::SIZE == 2 && !has_min::<S, T>() => min16(a, b));
            }
            max(a, b) [!T::FLOAT && T::SIZE != 2 && !has_min::<S, T>()] {
                sized!($base if T::FLOAT, $p(a, b): 4 _max_ps 8 _max_pd);
                sized!($base if T::SIGNED, $p(a, b): 2 _max_epi16); sized!($base if !T::SIGNED, $p(a, b): 1 _max_epu8);
                sized!($four if T::SIGNED && !T::FLOAT, $p(a, b): 1 _max_epi8 4 _max_epi32); sized!($four if !T::SIGNED, $p(a, b): 2 _max_epu16 4 _max_epu32);
                sized!(AVX512 if T::SIGNED && !T::FLOAT, $p(a, b): 8 _max_epi64); sized!(AVX512 if !T::SIGNED, $p(a, b): 8 _max_epu64);
                by!(T::SIZE == 2 && !has_min::<S, T>() => max16(a, b));
            }
            eq(a, b) [false] {
                compare!($r $p a b 0 [1 _cmpeq_epi8_mask _cmpeq_epi8_mask 2 _cmpeq_epi16_mask _cmpeq_epi16_mask 4 _cmpeq_epi32_mask _cmpeq_epi32_mask 8 _cmpeq_epi64_mask _cmpeq_epi64_mask] _cmpeq_ps _cmpeq_pd);
                old! { $r sized!($base, $p(a, b): 1 _cmpeq_epi8 2 _cmpeq_epi16 4 _cmpeq_epi32); sized!($four, $p(a, b): 8 _cmpeq_epi64); }
                only! { $r X named!(SSE2 => { let halves = run!(SSE2 _mm_cmpeq_epi32(a, b)); run!(SSE2 _mm_and_si128(halves, run!(SSE2 _mm_shuffle_epi32::<0xb1>(halves)))) }); }
            }
            ne(a, b) [S::LEVEL < AVX512 && !T::FLOAT] {
                compare!($r $p a b 4 [1 _cmpneq_epi8_mask _cmpneq_epi8_mask 2 _cmpneq_epi16_mask _cmpneq_epi16_mask 4 _cmpneq_epi32_mask _cmpneq_epi32_mask 8 _cmpneq_epi64_mask _cmpneq_epi64_mask] _cmpneq_ps _cmpneq_pd);
            }
            unordered(a, b) [false] { compare!($r $p a b 3 [] _cmpunord_ps _cmpunord_pd); }
            lt(a, b) [!T::SIGNED && !has_min::<S, T>()] {
                compare!($r $p a b 1 [1 _cmplt_epi8_mask _cmplt_epu8_mask 2 _cmplt_epi16_mask _cmplt_epu16_mask 4 _cmplt_epi32_mask _cmplt_epu32_mask 8 _cmplt_epi64_mask _cmplt_epu64_mask] _cmplt_ps _cmplt_pd);
                old! { $r sized!($base if T::SIGNED, $p(b, a): 1 _cmpgt_epi8 2 _cmpgt_epi16 4 _cmpgt_epi32); sized!($four if T::SIGNED, $p(b, a): 8 _cmpgt_epi64); }
                by!(S::LEVEL < AVX512 && !T::SIGNED && has_min::<S, T>() => not_le(a, b));
                only! { $r X named!(SSE2 if Size::<T, 8>::IS && !Has::<S>::SSE4 => {
                    let bias = run!(SSE2 _mm_set1_epi64x(if T::SIGNED { 1 << 31 } else { 1 << 63 | 1 << 31 }));
                    let (a, b) = (run!(SSE2 _mm_xor_si128(a, bias)), run!(SSE2 _mm_xor_si128(b, bias)));
                    let (less, equal) = (run!(SSE2 _mm_cmpgt_epi32(b, a)), run!(SSE2 _mm_cmpeq_epi32(a, b)));
                    run!(SSE2 _mm_or_si128(run!(SSE2 _mm_and_si128(run!(SSE2 _mm_shuffle_epi32::<0xa0>(less)), run!(SSE2 _mm_shuffle_epi32::<0xf5>(equal)))), run!(SSE2 _mm_shuffle_epi32::<0xf5>(less))))
                }); }
            }
            le(a, b) [S::LEVEL < AVX512 && !T::FLOAT && (T::SIGNED || T::SIZE > 2 && !has_min::<S, T>())] {
                compare!($r $p a b 2 [1 _cmple_epi8_mask _cmple_epu8_mask 2 _cmple_epi16_mask _cmple_epu16_mask 4 _cmple_epi32_mask _cmple_epu32_mask 8 _cmple_epi64_mask _cmple_epu64_mask] _cmple_ps _cmple_pd);
                by!(S::LEVEL < AVX512 && !T::SIGNED && has_min::<S, T>() => is_min(a, b));
                by!(!T::SIGNED && T::SIZE == 2 && !has_min::<S, T>() => le16(a, b));
            }
            saturating_add(a, b) [T::SIZE > 2 && (T::SIGNED || has_min::<S, T>())] { sized!($base if T::SIGNED, $p(a, b): 1 _adds_epi8 2 _adds_epi16); sized!($base, $p(a, b): 1 _adds_epu8 2 _adds_epu16);
                by!(T::SIZE > 2 && !T::SIGNED && !has_min::<S, T>() => sum_or_max(a, b));
                named!(AVX512 if T::SIGNED => limited!($p a b 0x42, a.add::<S, T>(b)));
            }
            saturating_sub(a, b) [T::SIZE > 2 && (T::SIGNED || has_min::<S, T>())] { sized!($base if T::SIGNED, $p(a, b): 1 _subs_epi8 2 _subs_epi16); sized!($base, $p(a, b): 1 _subs_epu8 2 _subs_epu16);
                by!(T::SIZE > 2 && !T::SIGNED && !has_min::<S, T>() => difference_or_zero(a, b));
                named!(AVX512 if T::SIGNED => limited!($p a b 0x18, a.sub::<S, T>(b)));
            }
            average(a, b) [T::SIZE > 2] { sized!($base, $p(a, b): 1 _avg_epu8 2 _avg_epu16); }
            abs_diff(a, b) { if const { !T::SIGNED && T::SIZE == 2 && !has_min::<S, T>() } { return a.saturating_sub::<S, T>(b).or::<S, T>(b.saturating_sub::<S, T>(a)); }
                by!(!T::FLOAT && T::SIZE > 2 && !has_min::<S, T>() => apart_by_sign(a, b));
            }
            shl(a, b) [S::LEVEL < SSE4 && T::SIZE == 1] {
                let n = b.and::<S, T>(Self::set::<S, T>(T::of_bits(8 * T::SIZE as u64 - 1)));
                sized!($avx, $p(a, n): 4 _sllv_epi32 8 _sllv_epi64); sized!(AVX512, $p(a, n): 2 _sllv_epi16);
                if const { S::LEVEL >= AVX2 && T::SIZE == 2 || S::LEVEL >= AVX512 } { return rest!(S::LEVEL >= AVX2 && S::LEVEL < AVX512 && T::SIZE == 2 || S::LEVEL >= AVX512 && T::SIZE == 1 => emulate::shl_in_pairs::<S, T, Self>, (a, n)); }
                if const { S::LEVEL >= SSE4 && T::SIZE <= 2 } {
                    let at = if T::SIZE == 1 { n } else { n.or::<S, u16>(n.shl_by::<S, u16>(8)).xor::<S, u16>(Self::set::<S, u16>(0x800)) };
                    return a.mul::<S, T>(Self::repeat::<S>([1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0]).table::<S>(at));
                }
                if const { T::SIZE == 4 } {
                    let power = n.shl_by::<S, u32>(23).add::<S, u32>(Self::set::<S, u32>(0x3f80_0000));
                    return a.mul::<S, T>(f!($base $p _cvttps_epi32(power)));
                }
                if const { T::SIZE == 2 } {
                    let power = |n: Self, one: u32| -> Self { f!($base $p _cvttps_epi32(n.shl_by::<S, u32>(23).add::<S, u32>(Self::set::<S, u32>(one)))) };
                    return a.mul::<S, T>(power(n, 0x3f80_0000).or::<S, u32>(power(n.shr_by::<S, u32>(16), 0x4780_0000)));
                }
                if const { T::SIZE == 8 } { return halves_by::<S, Self, true>(a, n); }
            }
            shr(a, b) {
                let n = b.and::<S, T>(Self::set::<S, T>(T::of_bits(8 * T::SIZE as u64 - 1)));
                sized!($avx if !T::SIGNED, $p(a, n): 4 _srlv_epi32 8 _srlv_epi64); sized!($avx, $p(a, n): 4 _srav_epi32);
                sized!(AVX512 if !T::SIGNED, $p(a, n): 2 _srlv_epi16); sized!(AVX512, $p(a, n): 2 _srav_epi16 8 _srav_epi64);
                if const { S::LEVEL >= AVX2 && T::SIZE == 2 || S::LEVEL >= AVX512 } { return rest!(S::LEVEL >= AVX2 && S::LEVEL < AVX512 && T::SIZE == 2 || S::LEVEL >= AVX512 && T::SIZE == 1 => emulate::shr_in_pairs::<S, T, Self>, (a, n)); }
                if const { !T::SIGNED && T::SIZE == 8 } { return halves_by::<S, Self, false>(a, n); }
                if const { T::SIZE == 8 } {
                    let sign = Self::set::<S, u64>(1 << 63).shr::<S, u64>(n);
                    return a.shr::<S, u64>(n).xor::<S, u64>(sign).sub::<S, u64>(sign);
                }
                only! { $r X if const { T::SIZE == 4 } {
                    let (even, odd) = (n.and::<S, u64>(X::set::<S, u64>(31)), n.shr_by::<S, u64>(32));
                    macro_rules! by { ($$n:expr) => { if T::SIGNED { run!(SSE2 _mm_sra_epi32(a, $$n)) } else { run!(SSE2 _mm_srl_epi32(a, $$n)) } }; }
                    let lower = run!(SSE2 _mm_unpacklo_epi64(by!(even), by!(odd)));
                    let upper = run!(SSE2 _mm_unpackhi_epi64(by!(run!(SSE2 _mm_unpackhi_epi64(even, even))), by!(run!(SSE2 _mm_unpackhi_epi64(odd, odd)))));
                    return f!(SSE2 _mm _shuffle_ps::<0xcc>(lower, upper));
                } }
            }
        }
        #[inline(always)]
        fn shl_by<S: Cpu, T: E>(self, n: u32) -> Self {
            // One operation on Intel, not two. LLVM finds this for longer lanes.
            sized!(AVX512, $p(self, Self::set::<S, u16>(n.min(16) as u16)): 2 _sllv_epi16);
            let count = run!(SSE2 _mm_cvtsi32_si128(n as i32));
            sized!($base, $p(self, count): 2 _sll_epi16 4 _sll_epi32 8 _sll_epi64);
            chosen!(fn(_, _) -> Self: T::SIZE > 1 => none2, S::LEVEL >= ICE => bytes_shifted::<S, T, Self, true>, _ => emulate::shl_by::<S, T, Self>)(self, n)
        }
        #[inline(always)]
        fn shr_by<S: Cpu, T: E>(self, n: u32) -> Self {
            sized!(AVX512 if T::SIGNED, $p(self, Self::set::<S, u16>(n.min(16) as u16)): 2 _srav_epi16);
            sized!(AVX512, $p(self, Self::set::<S, u16>(n.min(16) as u16)): 2 _srlv_epi16);
            let count = run!(SSE2 _mm_cvtsi32_si128(n as i32));
            sized!($base if !T::SIGNED, $p(self, count): 2 _srl_epi16 4 _srl_epi32 8 _srl_epi64);
            sized!($base, $p(self, count): 2 _sra_epi16 4 _sra_epi32); sized!(AVX512, $p(self, count): 8 _sra_epi64);
            if const { T::SIGNED && T::SIZE == 1 } && n == 7 { return rest!(T::SIGNED && T::SIZE == 1 => Self::negative::<S, T>, (self)); }
            chosen!(fn(_, _) -> Self: S::LEVEL >= ICE && T::SIZE == 1 => bytes_shifted::<S, T, Self, false>,
                T::SIZE == 1 || T::SIZE == 8 && T::SIGNED && S::LEVEL < AVX512 => emulate::shr_by::<S, T, Self>, _ => none2)(self, n)
        }
        one! {
            // LLVM makes a negation of this, which it can fuse, if it sees floats, and lanes of their size. The other use keeps them floats until then.
            neg(a) {
                if const { T::FLOAT && T::SIZE >= 4 && cfg!(not(bun_simd_unoptimized)) } {
                    let never = !matches!(only_combined([0; 2], [0; 2]), Some([0, _]));
                    $base! { fn single(a: float!($r 4), never: bool) -> float!($r 4) { core::hint::select_unpredictable(never, a, cast(${concat($p, _add_epi32)}(cast(a), ${concat($p, _set1_epi32)}(i32::MIN)))) } }
                    $base! { fn double(a: float!($r 8), never: bool) -> float!($r 8) { core::hint::select_unpredictable(never, a, cast(${concat($p, _add_epi64)}(cast(a), ${concat($p, $set64)}(i64::MIN)))) } }
                    return if const { T::SIZE == 4 } { cast(run!($base single(cast(a), never))) } else { cast(run!($base double(cast(a), never))) };
                }
            }
            abs(a) [T::FLOAT || T::SIZE == 8 && S::LEVEL < AVX512] { sized!($four if !T::FLOAT, $p(a): 1 _abs_epi8 2 _abs_epi16 4 _abs_epi32); sized!(AVX512 if !T::FLOAT, $p(a): 8 _abs_epi64);
                by!(!T::FLOAT && S::LEVEL < SSE4 && T::SIZE == 1 => abs8(a, a)); by!(!T::FLOAT && S::LEVEL < SSE4 && T::SIZE == 2 => abs16(a, a)); by!(!T::FLOAT && S::LEVEL < SSE4 => abs_by_sign(a, a));
            }
            negative(a) { only! { $r X named!(SSE2 if Size::<T, 8>::IS && !Has::<S>::SSE4 => run!(SSE2 _mm_shuffle_epi32::<0xf5>(run!(SSE2 _mm_srai_epi32::<31>(a))))); } }
            sqrt(a) [false] { sized!($base, $p(a): 4 _sqrt_ps 8 _sqrt_pd); }
            swap_bytes(a) [T::SIZE == 1 || S::LEVEL < SSE4] {
                if const { T::SIZE > 1 && S::LEVEL >= SSE4 } {
                    return a.table::<S>(Self::repeat::<S>(const { let (mut at, mut i) = ([0; 16], 0); while i < 16 { at[i] = (i ^ (T::SIZE - 1)) as u8; i += 1; } at }));
                }
            }
            reverse_bits(a) [S::LEVEL < SSE4] {
                named!(ICE => f!($p _gf2p8affine_epi64_epi8::<0>(a.swap_bytes::<S, T>(), Self::set::<S, u64>(0x8040_2010_0804_0201))));
                if const { S::LEVEL >= SSE4 } {
                    const LOW: [u8; 16] = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
                    let (v, low, table) = (a.swap_bytes::<S, T>(), Self::set::<S, u8>(15), Self::repeat::<S>(LOW));
                    return table.shl_by::<S, u16>(4).table::<S>(v.and::<S, u8>(low)).or::<S, u8>(table.table::<S>(v.shr_by::<S, u8>(4)));
                }
            }
            count_ones(a) [S::LEVEL < SSE4] {
                sized!(ICE, $p(a): 1 _popcnt_epi8 2 _popcnt_epi16 4 _popcnt_epi32 8 _popcnt_epi64);
                named!($base if Size::<T, 8>::IS && !Has::<S>::SSE4 => f!($p _sad_epu8(a.count_ones::<S, u8>(), Self::ZERO)));
                if const { S::LEVEL >= SSE4 } {
                    let table = Self::repeat::<S>([0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]);
                    let bytes = table.table::<S>(a.and::<S, u8>(Self::set::<S, u8>(15))).add::<S, u8>(table.table::<S>(a.shr_by::<S, u8>(4)));
                    named!($base if Size::<T, 8>::IS => f!($p _sad_epu8(bytes, Self::ZERO)));
                    named!($four if Size::<T, 2>::IS => f!($p _maddubs_epi16(bytes, Self::set::<S, u8>(1))));
                    named!($four if Size::<T, 4>::IS => f!($p _madd_epi16(call!($four $p _maddubs_epi16(bytes, Self::set::<S, u8>(1))), Self::set::<S, u16>(1))));
                    return bytes;
                }
            }
            leading_zeros(a) { sized!(AVX512, $p(a): 4 _lzcnt_epi32 8 _lzcnt_epi64);
                if const { S::LEVEL >= AVX512 && T::SIZE == 2 } {
                    let stop = Self::set::<S, u32>(0x8000);
                    return a.or::<S, u32>(stop).leading_zeros::<S, u32>().shl_by::<S, u32>(16).or::<S, u32>(a.shl_by::<S, u32>(16).or::<S, u32>(stop).leading_zeros::<S, u32>());
                }
                if const { S::LEVEL >= ICE && T::SIZE == 1 } { return a.reverse_bits::<S, T>().trailing_zeros::<S, T>(); }
                if const { S::LEVEL >= SSE4 && T::SIZE == 1 } {
                    let (table, upper) = (Self::repeat::<S>([4, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]), a.shr_by::<S, u8>(4));
                    return table.table::<S>(upper).add::<S, u8>(table.table::<S>(a).and::<S, u8>(upper.eq::<S, u8>(Self::ZERO)));
                }
                if const { S::LEVEL >= SSE4 && T::SIZE == 2 } {
                    let bytes = a.leading_zeros::<S, u8>();
                    let lower = bytes.and::<S, u16>(a.shr_by::<S, u16>(8).eq::<S, u16>(Self::ZERO).shr_by::<S, u16>(8));
                    return bytes.shr_by::<S, u16>(8).add::<S, u16>(lower);
                }
            }
            trailing_zeros(a) {
                if const { S::LEVEL == AVX512 && T::SIZE >= 4 } {
                    let below = a.and_not::<S, T>(a.sub::<S, T>(Self::set::<S, T>(T::of_bits(1))));
                    return Self::set::<S, T>(T::of_bits(8 * T::SIZE as u64)).sub::<S, T>(below.leading_zeros::<S, T>());
                }
            }
            round(a) {
                if const { S::LEVEL >= SSE4 } {
                    let below_half = T::of_bits(T::of_f32(0.5).bits() - 1);
                    let sign = a.and::<S, T::Bits>(Self::set::<S, T>(T::of_f32(-0.0)));
                    return a.add::<S, T>(sign.or::<S, T::Bits>(Self::set::<S, T>(below_half))).trunc::<S, T>();
                }
            }
        }
        rounded! { $r $p $four: round_ties_even 8 floor 9 ceil 10 trunc 11 }
        #[inline(always)]
        fn select<S: Cpu, T: E>(self, yes: Self, no: Self) -> Self {
            named!(AVX512 if Size::<T, 1>::IS => call!(AVX512 $p _mask_blend_epi8(self.sign_bits::<S, T>() as _, no, yes)));
            named!(AVX512 if Size::<T, 2>::IS => call!(AVX512 $p _mask_blend_epi16(self.sign_bits::<S, T>() as _, no, yes)));
            named!(AVX512 if T::FLOAT && Size::<T, 4>::IS => cast(call!(AVX512 $p _mask_blend_ps(self.sign_bits::<S, T>() as _, cast(no), cast(yes)))));
            named!(AVX512 if T::FLOAT => cast(call!(AVX512 $p _mask_blend_pd(self.sign_bits::<S, T>() as _, cast(no), cast(yes)))));
            named!(AVX512 if Size::<T, 4>::IS => call!(AVX512 $p _mask_blend_epi32(self.sign_bits::<S, T>() as _, no, yes)));
            named!(AVX512 => call!(AVX512 $p _mask_blend_epi64(self.sign_bits::<S, T>() as _, no, yes)));
            old! { $r sized!($four, $p(no, yes, self): 1 _blendv_epi8 2 _blendv_epi8 4 _blendv_ps 8 _blendv_pd); }
            rest!(S::LEVEL < SSE4 => emulate::select::<S, T, Self>, (self, yes, no))
        }
        #[inline(always)]
        fn fma<S: Cpu, T: E>(self, b: Self, c: Self) -> Self {
            sized!($avx, $p(self, b, c): 4 _fmadd_ps 8 _fmadd_pd);
            rest!(S::LEVEL < AVX2 => emulate::fma::<S, T, Self>, (self, b, c))
        }
    }
}; }
prim! { X _mm SSE2 SSE4 AVX2 _and_si128 _or_si128 _xor_si128 _andnot_si128 _set1_epi64x }
prim! { Y _mm256 AVX2 AVX2 AVX2 _and_si256 _or_si256 _xor_si256 _andnot_si256 _set1_epi64x }
prim! { Z _mm512 AVX512 AVX512 AVX512 _and_si512 _or_si512 _xor_si512 _andnot_si512 _set1_epi64 }
