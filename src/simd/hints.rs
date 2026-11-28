//! Hints to LLVM for which stable Rust has no words. No result depends on them.

use crate::raw::Raw;

/// Whether LLVM knows the number. Each use can give any answer.
macro_rules! is_known {
    ($value:expr $(,)?) => {
        crate::hints::number($value)
    };
}
/// The same for all lanes.
macro_rules! are_known {
    ($value:expr $(,)?) => {
        crate::hints::lanes($value)
    };
}

/// A loop whose first rounds, up to the number in front, are written out. The body is a closure. If the ends are constants of the
/// function, LLVM drops the rounds that are too many before it inlines them.
macro_rules! unrolled {
    ($most:tt, for $($rest:tt)*) => { unrolled!(@by call $most $($rest)*) };
    // If the body calls a closure of the consumer, which looks for the features of the function that it ends up in.
    ($most:tt theirs, for $($rest:tt)*) => { unrolled!(@by call_here $most $($rest)*) };
    (@by $call:ident $most:tt $i:tt in $from:tt..const $to:tt $body:block) => { unrolled!(@loop $call $most [const $to] $i $from $to $body) };
    (@by $call:ident $most:tt $i:tt in $from:tt..$to:tt $body:block) => { unrolled!(@loop $call $most [] $i $from $to $body) };
    (@loop $call:ident $most:tt $known:tt $i:tt $from:tt $to:tt $body:block) => {{
        #[allow(unused_parens)]
        let (from, to): (usize, usize) = ($from, $to);
        #[allow(unused_mut)]
        let mut round = crate::hints::round(#[inline(always)] |$i: usize| $body);
        #[allow(unused_labels, unused_parens)]
        'all: {
            #[cfg(not(bun_simd_unoptimized))]
            unrolled!(@$most $known 'all $call round from to);
            let mut i = from + if cfg!(bun_simd_unoptimized) { 0 } else { $most };
            while i < to {
                crate::hints::$call(&mut round, i);
                i += 1;
            }
        }
    }};
    (@64 $($all:tt)*) => { unrolled!(@32 $($all)*); unrolled!(@rounds 64 [32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63] $($all)*) };
    (@32 $($all:tt)*) => { unrolled!(@16 $($all)*); unrolled!(@rounds 32 [16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31] $($all)*) };
    (@16 $($all:tt)*) => { unrolled!(@8 $($all)*); unrolled!(@rounds 16 [8 9 10 11 12 13 14 15] $($all)*) };
    (@8 $($all:tt)*) => { unrolled!(@4 $($all)*); unrolled!(@rounds 8 [4 5 6 7] $($all)*) };
    (@4 $($all:tt)*) => { unrolled!(@2 $($all)*); unrolled!(@rounds 4 [2 3] $($all)*) };
    (@2 $($all:tt)*) => { unrolled!(@rounds 2 [0 1] $($all)*) };
    (@rounds $done:tt [$($k:tt)*] [$(const $end:tt)?] $all:lifetime $call:ident $round:ident $from:ident $to:ident) => {
        $(
            if $from + $k >= $to { break $all; }
            crate::hints::$call(&mut $round, $from + $k);
        )*
        // rustc makes no code of what follows.
        $(if const { $end <= $done } { break $all; })?
    };
}
#[inline(always)]
pub(crate) fn round<F: FnMut(usize)>(f: F) -> F {
    f
}

/// LLVM simplifies the round once, and then copies it. See closures.rs.
#[inline(always)]
pub(crate) fn call<F: FnMut(usize)>(f: &mut F, i: usize) {
    #[inline(always)]
    fn caller<F: FnMut(usize)>(f: &mut F, i: usize) {
        if crate::closures::never() { caller(f, i) } else { f(i) }
    }
    (const { caller::<F> as fn(&mut F, usize) })(f, i)
}

/// The same for an operation.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(always)]
pub(crate) fn once<R, F: FnOnce() -> R>(f: F) -> R {
    #[inline(always)]
    fn caller<R, F: FnOnce() -> R>(f: F) -> R {
        if crate::closures::never() { caller(f) } else { f() }
    }
    if const { crate::OPTIMIZED } { (const { caller::<R, F> as fn(F) -> R })(f) } else { f() }
}

#[inline(always)]
pub(crate) fn call_here<F: FnMut(usize)>(f: &mut F, i: usize) {
    f(i)
}

/// The same value.
#[inline(always)]
pub(crate) const fn unseen<T: Copy>(it: T) -> T {
    if cfg!(not(miri)) { core::hint::black_box(it) } else { it }
}

/// All bits.
pub trait Folded: Copy {
    fn folded(self) -> [u64; 2];
}
macro_rules! folded { ($($($t:ty)* => |$x:ident| $to:expr;)*) => {$($(
    impl Folded for $t { #[inline(always)] fn folded(self) -> [u64; 2] { let $x = self; $to } }
)*)*}; }
folded! {
    bool u8 u16 u32 u64 usize i8 i16 i32 i64 => |x| [x as u64, 0];
    crate::f16 crate::bf16 f32 => |x| [x.to_bits() as u64, 0];
    f64 => |x| [x.to_bits(), 0];
    u128 => |x| [x as u64, (x >> 64) as u64];
}

/// Rust leaves open whether a cast makes a signaling NaN quiet.
#[inline(always)]
fn quieted(x: [u64; 2]) -> bool {
    if const { !crate::OPTIMIZED || cfg!(bun_simd_no_known) } {
        return false;
    }
    // See closures.rs.
    #[inline(always)]
    fn apart(all: u64) -> bool {
        if crate::closures::never() {
            return apart(all);
        }
        // LLVM makes a choice between two constants of most other expressions.
        is_folded::<false>(SIGNALING | 0xff >> (all.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 61))
    }
    // Without it, nothing counts as known.
    let Some([all, _]) = crate::simd::only_combined(x, x) else { return false };
    (const { apart as fn(u64) -> bool })(all)
}
/// The same, for `zero` of simd/wasm.rs.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(always)]
pub(crate) fn combined(zero: u32) -> bool {
    #[inline(always)]
    fn apart(zero: u32) -> bool {
        if crate::closures::never() { apart(zero) } else { is_folded::<false>(SIGNALING | zero) }
    }
    (const { crate::OPTIMIZED && !cfg!(bun_simd_no_known) }) && (const { apart as fn(u32) -> bool })(zero)
}
pub(crate) const SIGNALING: u32 = 0x7fa0_0000;
/// With a sign, LLVM keeps a branch, and the inliner counts less for the answer no.
#[inline(always)]
pub(crate) fn is_folded<const SIGNED: bool>(signaling: u32) -> bool {
    const REST: u64 = 0x7ffc_0000_0000_0000 - (1 << 29);
    let base = (f32::from_bits(signaling) as f64).to_bits().wrapping_sub(REST);
    let base = if SIGNED { (base as i64).wrapping_pow(1) as u64 } else { base.wrapping_pow(1) };
    (f64::from_bits(base.wrapping_add(REST)) as f32).to_bits() != signaling
}

#[inline(always)]
pub(crate) fn number<T: Folded>(x: T) -> bool {
    quieted(x.folded())
}
/// A second question, with any answer.
#[inline(always)]
pub(crate) fn confirmed(x: u64) -> bool {
    !(cfg!(all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri)))
        && is_known!(x ^ crate::regs::beside(0, 0)))
}
/// Whether LLVM sees that this is a number without a bit.
#[op]
pub(crate) fn zero<T: crate::Lane>(x: Option<T>) -> bool {
    matches!(x, Some(x) if is_known!(x.folded()[0]) && x.folded()[0] == 0)
}

#[inline(always)]
pub(crate) fn lanes<R: Raw>(v: R) -> bool {
    if const { size_of::<R>() > 64 || !crate::OPTIMIZED } {
        return false;
    }
    let bytes = crate::plain::read_as::<u8>(v.lanes());
    if const { size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() < 16 } {
        let all = match size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() {
            8 => u64::from_ne_bytes(bytes.as_chunks().0[0]),
            4 => u32::from_ne_bytes(bytes.as_chunks().0[0]) as u64,
            2 => u16::from_ne_bytes(bytes.as_chunks().0[0]) as u64,
            _ => bytes[0] as u64,
        };
        return quieted([all, 0]);
    }
    // In words, so that LLVM soon sees no other use of a vector that it can look into.
    let words = bytes.as_chunks().0;
    let mut all = [u64::from_ne_bytes(words[0]), u64::from_ne_bytes(words[1])];
    unrolled!(4, for i in 0..const ((size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() - 1) / 16) {
        let next = [u64::from_ne_bytes(words[2 * i + 2]), u64::from_ne_bytes(words[2 * i + 3])];
        all = crate::simd::only_combined(all, next).unwrap_or(all)
    });
    quieted(all)
}

/// On a way out of a loop. LLVM aligns only loops that seem to run often.
#[inline(always)]
pub(crate) fn leaves() {
    if const { crate::X86 } {
        core::hint::cold_path();
    }
}
