// The first definition of a link counts.
#![doc = "[guide]: crate::guide\n[speed]: crate::guide::speed\n[programs]: crate::guide::programs\n[marks]: crate::guide::programs#many-files-and-crates\n[index]: crate::index\n[targets]: mod@crate::target\n[highway]: crate::guide::highway\n[panics]: crate::guide::panics\n"]
#![doc = include_str!("README.md")]
#![recursion_limit = "256"]
#![cfg_attr(not(test), no_std)]
// Only the nightly compiler has these two.
#![cfg_attr(any(bun_simd_sanitize = "cfi", bun_simd_sanitize = "kcfi"), feature(sanitize))]
#![deny(unsafe_code)]
#![deny(missing_docs)]
#![cfg_attr(all(doc, feature = "alloc"), deny(rustdoc::broken_intra_doc_links))]
// What is used depends on the architecture.
#![allow(dead_code, unused_imports, unused_macros, unused_mut, unused_variables)]
#![allow(clippy::multiple_bound_locations)] // the rows of tables add bounds to those of the macro
#![allow(clippy::redundant_closure)] // a closure can be `#[inline(always)]`
#![allow(clippy::bad_bit_mask)] // constants of one architecture
#![allow(clippy::manual_is_multiple_of)] // a call without optimization
#![allow(clippy::ptr_eq)] // the same
#![allow(clippy::extra_unused_type_parameters)] // where clauses read them
#![allow(clippy::chunks_exact_to_as_chunks)] // the number of lanes is generic
#![allow(clippy::ptr_as_ptr, clippy::ref_as_ptr, clippy::borrow_as_ptr)] // the methods are calls without optimization
#![allow(clippy::large_types_passed_by_value, clippy::needless_pass_by_value)] // all of it is inlined
#![allow(clippy::or_fun_call)] // vectors have `or` too
#![allow(clippy::disallowed_methods, clippy::disallowed_types)] // it depends on nothing of Bun
#![allow(unreachable_pub)] // public traits name items of private modules
#![cfg_attr(mordant, allow(unused_pub, generic_body_not_generic))] // a library, of which Bun uses a part
#![cfg_attr(mordant, allow(tuple_wants_struct, bare_bool_args, arg_named_like_other_param))] // private helpers, and rounds of SHA that swap names
#![allow(internal_features, private_bounds, private_interfaces)]

#[cfg(feature = "alloc")]
extern crate alloc;
#[macro_use(rules, on, sealed, op)]
extern crate bun_simd_macros;
extern crate self as bun_simd;

#[macro_use]
#[forbid(unsafe_code)]
mod hints;

/// A condition on types and constants. The build fails if it is false where code is made. The part that no width and no
/// `T::Wide` or `T::Narrow` excuses has to hold in dead branches too.
macro_rules! require {
    ($message:literal, $($rest:tt)*) => { require!(of Self, $message, $($rest)*) };
    (of $of:ty, $message:literal, $here:expr $(, at any width $always:expr)? $(,)?) => {
        $(const { assert!($always, $message) };)?
        if const { !($here) } {
            bun_simd_macros::rule!($message);
            // The errors of constants have a note with the caller. Optimizations can find this one in dead branches.
            #[cfg(bun_simd_misfits_where)]
            crate::only::keep(&None::<[(*const Rule<$of>, $of); usize::MAX]> as *const _ as _);
            crate::does_not_fit(&(crate::broken::<Rule<$of>> as _))
        }
    };
}
/// An error, but only if code is made for it, as `only::other`.
fn broken<Rule>() -> &'static str {
    #[cfg(not(any(miri, bun_simd_misfits_panic)))]
    {
        let it: Option<[*const Rule; usize::MAX]> = None; // Guard it by `if const { .. }`. --cfg bun_simd_misfits_where finds it.
        only::keep(&raw const it as _);
    }
    core::any::type_name::<Rule>()
}
/// It takes a pointer: with many instances of a function that is called by name, rustc inlines less in the consumer.
#[cold]
#[inline(never)]
#[allow(clippy::trivially_copy_pass_by_ref)] // A borrowed constant costs nothing in dead branches.
#[track_caller]
fn does_not_fit(rule: &fn() -> &'static str) -> ! {
    panic!("{}", rule())
}
#[cold]
#[inline(never)]
#[track_caller]
fn out_of_range(message: &'static str) -> ! {
    panic!("{message}")
}
/// Defines `here!`, which tells whether one of some constants can be true on this architecture.
#[rules]
macro_rules! architectures {
    ([$($never:ident)*]) => { macro_rules! here {
        $(([$never $$($$more:ident)*] $$($$rest:tt)*) => { here! { [$$($$more)*] $$($$rest)* } };)*
        ([] $$name:ident [$$($$state:tt)*] $$($$all:tt)*) => { $$name! { $$($$state)* @dead $$($$all)* } };
        ($$other:tt $$name:ident [$$($$state:tt)*] $$($$all:tt)*) => { $$name! { $$($$state)* @live $$($$all)* } };
    } };
    ([$($never:ident)*] $arch:meta => $($flag:ident)+; $($rest:tt)*) => { cfg_select! {
        any($arch, bun_simd_all_branches) => { architectures! { [$($never)*] $($rest)* } }
        _ => { architectures! { [$($never)* $($flag)+] $($rest)* } }
    } };
}
architectures! { []
    any(target_arch = "x86", target_arch = "x86_64") => X86 x86 avx512 SSE2 BY_HAND SSSE3 SSE41 SSE42 AVX2 AVX512F AVX512BW AVX512CD AVX512DQ AVX512VL AVX512VBMI AVX512VBMI2 AVX512VNNI
        AVX512BITALG AVX512VPOPCNTDQ AVX512FP16 AVXVNNI AVXVNNIINT16 BMI1 F16C GFNI LZCNT POPCNT NO_POPCNT HAS_MUL52 BY_BITS PSHUFB MASKMOV AGAIN CARRIED X86_HALF WORDS BY_PRODUCT;
    target_arch = "aarch64" => NEON ARM PAIR TINY BY_MASK A64 SVE SVE2 RDM FCMA FHM HAS_MAT_MUL TBL COMPACTS BREAKS ACROSS OR_NAN;
    target_arch = "wasm32" => WASM RELAXED;
    not(any(target_arch = "x86", target_arch = "x86_64")) => VECTOR_MASKS OTHERS;
}
/// Defines a macro for a branch. If its condition starts with constants of other architectures, `@dead` gets it, which drops the code and
/// checks that the whole condition is false. `a && b || c` needs parentheses if `c` is for another architecture than `a`.
#[rules]
macro_rules! branch { ($name:ident $([$($state:tt)*] [$($same:tt)*] $end:tt)+ { $($arms:tt)* }) => { macro_rules! $name {
    $(
        ($($state)* $$($$s:ident::$$flag:ident)||+ $end $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] $$($$s::$$flag)||+ $end $$($$rest)* } };
        ($($state)* $$($$s:ident::$$flag:ident)||+ && $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] $$($$s::$$flag)||+ && $$($$rest)* } };
        ($($state)* ($$($$s:ident::$$flag:ident)||+) && $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] ($$($$s::$$flag)||+) && $$($$rest)* } };
        ($($state)* ($$($$s:ident::$$flag:ident)||+ && $$($$more:tt)*) && $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] ($$($$s::$$flag)||+ && $$($$more)*) && $$($$rest)* } };
        ($($state)* !crate::X86 $end $$($$rest:tt)*) => { here! { [OTHERS] $name [$($same)*] !crate::X86 $end $$($$rest)* } };
        ($($state)* !crate::X86 && $$($$rest:tt)*) => { here! { [OTHERS] $name [$($same)*] !crate::X86 && $$($$rest)* } };
        ($($state)* const { $$($$s:ident::$$flag:ident)||+ } $end $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] $$($$s::$$flag)||+ $end $$($$rest)* } };
        ($($state)* const { $$($$s:ident::$$flag:ident)||+ } && $$($$rest:tt)*) => { here! { [$$($$flag)*] $name [$($same)*] ($$($$s::$$flag)||+) && $$($$rest)* } };
        ($($state)* X86 $end $$($$rest:tt)*) => { here! { [X86] $name [$($same)*] X86 $end $$($$rest)* } };
        ($($state)* X86 && $$($$rest:tt)*) => { here! { [X86] $name [$($same)*] X86 && $$($$rest)* } };
        ($($state)* $$flag:ident::<S>$$args:tt $end $$($$rest:tt)*) => { here! { [$$flag] $name [$($same)*] $$flag::<S>$$args $end $$($$rest)* } };
        ($($state)* $$flag:ident::<S>$$args:tt && $$($$rest:tt)*) => { here! { [$$flag] $name [$($same)*] $$flag::<S>$$args && $$($$rest)* } };
        ($($state)* cfg!($$cfg:meta) && $$($$rest:tt)*) => { cfg_select! {
            any($$cfg, bun_simd_all_branches) => { $name! { $($same)* @live cfg!($$cfg) && $$($$rest)* } }
            _ => { $name! { $($same)* @dead false && $$($$rest)* } }
        } };
    )+
    $($arms)*
} }; }
/// The value, after a method of on_x86.rs.
macro_rules! on_x86 { ($v:expr, $($method:tt)*) => { cfg_select! { all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)) => $v.$($method)*, _ => $v } }; }
/// The same for on_other.rs.
macro_rules! on_arch {
    ($f:path, $v:expr) => {
        cfg_select! {
            all(target_arch = "powerpc64", not(miri)) => $f($v),
            _ => $v,
        }
    };
}
macro_rules! on_these {
    ([$($flag:ident)+] $($item:tt)*) => { here! { [$($flag)+] on_these [] $($item)* } };
    (@live $($item:tt)*) => { $($item)* };
    (@dead $($item:tt)*) => {};
}
#[allow(unused_macros)]
macro_rules! never {
    ($when:expr) => {
        const { assert!(!$when, "a branch of another architecture is taken") }
    };
}

/// Supertraits that no other crate can name, and so implement. `#[sealed]` implements them.
mod seals {
    pub trait Appendable<T> {}
    pub trait ChunkAt<T> {}
    pub trait Count<T, W, S> {}
    pub trait FlatArray<T> {}
    pub trait Items<T, W, S> {}
    pub trait Keep<T, W, S> {}
    pub trait Lendable<'scope> {}
    pub trait Mapped<R, S> {}
    pub trait Members<T, S> {}
    pub trait MoreBytes<T, W, S> {}
    pub trait Readable<T> {}
    pub trait Sink<T> {}
    pub trait Sinks<R, O, S> {}
    pub trait Slice {}
    pub trait SubArray<T> {}
    pub trait Widens<U> {}
    pub trait Writable<T> {}
}
/// A closure that is always inlined, where stable Rust takes no attribute.
macro_rules! always { ($($closure:tt)*) => { (#[inline(always)] $($closure)*,).0 }; }
/// The same, if its types are inferred from the function that gets it.
macro_rules! passed { ($($closure:tt)*) => { crate::itself(#[inline(always)] $($closure)*) }; }
#[inline(always)]
fn itself<F>(f: F) -> F {
    f
}
macro_rules! inferred {
    ($name:ident) => {
        _
    };
}
#[rules]
macro_rules! called_once { ($($name:ident)+) => { called_once!(@ ${count($name)}) };
    (@ 1) => { crate::once::of1 }; (@ 2) => { crate::once::of2 }; (@ 3) => { crate::once::of3 }; (@ 4) => { crate::once::of4 };
    (@ 5) => { crate::once::of5 };
}
branch! { live [] [] , {
    (@dead $live:expr, $($body:tt)*) => {{ never!($live); crate::ops::never(()) }};
    // The value of a branch that is taken if the constant is true. rustc walks through all that a dead branch calls, for each combination of
    // types, but not through a constant. For LLVM, this is a direct call of a function that is always inlined. `#[track_caller]` ends here.
    ($(@live)? $live:expr, $body:expr) => {
        (const { crate::caller($live) })({
            let once = crate::Once;
            always!(|| {
                let _once = once;
                $body
            })
        })
    };
} }
// `if const { live } { body }`
branch! { when [] [] , {
    (@dead $live:expr, $($body:tt)*) => { never!($live) };
    ($(@live)? $live:expr, $body:expr) => {
        if const { $live } {
            live!($live, $body)
        }
    };
} }
// The same without a closure, for a condition that starts with an architecture, if the body is short or has to be in the function itself.
branch! { if_here [] [] , {
    (@dead $live:expr, $($body:tt)*) => { never!($live) };
    ($(@live)? $live:expr, $body:expr) => {
        if const { $live } {
            $body
        }
    };
} }
// `if const { live } { return body }`
branch! { return_if [] [] , {
    (@dead $live:expr, $($body:tt)*) => { never!($live) };
    ($(@live)? $live:expr, |$($name:ident: $t:ty = $value:tt),+| $body:expr) => {
        if const { $live } {
            return (const { if $live { called_once!($($name)+)(#[inline(always)] |$($name: $t),+| $body) as fn($(inferred!($name)),+) -> _ } else { called_once!($($name)+)(|$(_: $t),+| loop {}) } })($($value),+);
        }
    };
    ($(@live)? $live:expr, $body:expr) => { if const { $live } { return live!($live, $body); } };
} }
// Like `match` on constants. Only the chosen arm is compiled, so that operations can be made of each other.
branch! { choose [@in $names:tt] [@in $names] => [@after $not:tt] [@after $not] => {
    (|$($name:ident: $t:ty = $value:tt),+| $($arms:tt)*) => { (const { choose!(@in [$($name: $t),+] $($arms)*) })($($value),+) };
    (@in [$($name:ident: $t:ty),+] _ => $other:expr $(,)?) => {
        called_once!($($name)+)(#[inline(always)] #[allow(unused_variables)] |$($name: $t),+| $other) as fn($(inferred!($name)),+) -> _
    };
    (@in $names:tt @dead $when:expr => $then:expr, $($rest:tt)*) => {{ assert!(!$when, "a branch of another architecture is taken"); choose!(@in $names $($rest)*) }};
    (@in $names:tt $(@live)? $when:expr => $then:expr, $($rest:tt)*) => { if $when { choose!(@in $names _ => $then) } else { choose!(@in $names $($rest)*) } };
    (@after [$($not:tt)*] _ => $other:ident $(,)?) => { $other };
    (@after [$($not:tt)*] _ => $other:expr $(,)?) => { live!($($not)* true, $other) };
    (@after $not:tt @dead $when:expr => $then:expr, $($rest:tt)*) => {{ never!($when); choose!(@after $not $($rest)*) }};
    (@after [$($not:tt)*] $(@live)? $when:expr => $then:ident, $($rest:tt)*) => { if const { $when } { $then } else { choose!(@after [$($not)* !($when) &&] $($rest)*) } };
    (@after [$($not:tt)*] $(@live)? $when:expr => $then:expr, $($rest:tt)*) => {
        if const { $when } { live!($($not)* ($when), $then) } else { choose!(@after [$($not)* !($when) &&] $($rest)*) }
    };
    ($($arms:tt)*) => { choose!(@after [] $($arms)*) };
} }
/// A closure that consumes this is `FnOnce` only.
struct Once;
const fn caller<F: FnOnce() -> R, R>(live: bool) -> fn(F) -> R {
    /// rustc looks at an instance for each dead branch, and at all that it calls or drops.
    #[allow(clippy::empty_loop)]
    fn dead<F, R>(_: F) -> R {
        loop {}
    }
    #[inline(always)]
    fn call<F: FnOnce() -> R, R>(f: F) -> R {
        f()
    }
    if live { call } else { dead }
}
/// `body`, which LLVM simplifies once by itself, and then inlines (`closures.rs`). What is only `#[inline(always)]` is copied with
/// all that it calls and with its stack slots, and some passes take quadratic time in the sum. For long operations.
/// It borrows the variables, since LLVM can make one long vector of those in a tuple. What is `&mut` has to be listed.
macro_rules! apart {
    ($s:expr, |$($name:ident: $t:ty),+| $body:expr) => { crate::closures::apart($s, #[inline(always)] |($($name,)+): ($($t,)+)| $body, ($($name,)+)) };
    ($s:expr, $body:expr) => { crate::closures::apart($s, #[inline(always)] |()| $body, ()) };
    // Where there is no token.
    ($body:expr) => { crate::closures::only_call(#[inline(always)] || $body) };
}
/// `apart!` in builds without optimization, where it makes one function of what would be copied for each use, or with assertions.
macro_rules! apart_unoptimized { ($s:expr, $(|$($name:ident: $t:ty),+|)? $body:block) => {
    cfg_select! { any(bun_simd_unoptimized, debug_assertions) => apart!($s, $(|$($name: $t),+|)? $body), _ => $body }
}; }
/// The same for short operations, on vectors of many registers. At the end of a function.
macro_rules! apart_if_long {
    ($s:expr, $body:expr) => {
        cfg_select! {
            all(debug_assertions, not(bun_simd_unoptimized)) => {{
                return_if!(W::BYTES > 64, apart!($s, $body));
                $body
            }},
            _ => $body,
        }
    };
}
// `return_if!` and `apart!`, for an operation that calls itself on halves.
branch! { halves_if [] [] , {
    (@dead $live:expr, $($body:tt)*) => { never!($live) };
    ($(@live)? $live:expr, |$first:ident: $of:ty = $given:tt $(, $name:ident: $t:ty = $value:tt)*| $body:expr) => {
        return_if!($live, |$first: $of = $given $(, $name: $t = $value)*| apart!($first.isa(), $body))
    };
} }
/// A call of the function itself, for another width. rustc would follow it up to the recursion limit in search of what it can inline.
macro_rules! again {
    ($f:path, $($a:expr),+) => { (const { $f as fn($(again!(@ $a)),+) -> _ })($($a),+) };
    (@ $a:expr) => { _ };
}
/// For a constant that takes long. Each crate evaluates a constant again, and this one twice, but takes the value of a static from the metadata.
macro_rules! once {
    ($t:ty = $value:expr) => {{
        static ONCE: $t = $value;
        ONCE
    }};
}
/// A pointer to any other kind of closure points to a wrapper, which isn't always inlined.
mod once {
    macro_rules! arities { ($($name:ident($($a:ident)+))*) => {$(
        pub const fn $name<$($a,)+ R, F: FnOnce($($a),+) -> R>(closure: F) -> F { closure }
    )*}; }
    arities! { of1(A) of2(A B) of3(A B C) of4(A B C D) of5(A B C D E) }
}

mod asked;
mod detect;
#[macro_use]
mod simd;
#[forbid(unsafe_code)]
mod mask;
mod regs;
mod rolled;
mod gate;
#[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
mod brain_arm;
#[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
mod sve;
#[forbid(unsafe_code)]
mod soft;
#[forbid(unsafe_code)]
mod tuning;
#[forbid(unsafe_code)]
mod kernel;
#[forbid(unsafe_code)]
mod attributes;
#[forbid(unsafe_code)]
mod words;
#[forbid(unsafe_code)]
mod make;
mod output;
mod plain;
mod same;
mod checked;
#[forbid(unsafe_code)]
mod chunk_at;
#[forbid(unsafe_code)]
mod whole;
#[cfg(any(target_arch = "x86", target_arch = "x86_64", bun_simd_all_branches))]
#[cfg_attr(not(target_feature = "sse2"), allow(unused))]
mod maskmov;
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
mod unaligned;
#[cfg_attr(not(target_arch = "x86_64"), allow(unused_macros))]
#[allow(clippy::unnecessary_cast)]
mod indexed;
#[cfg_attr(not(target_arch = "x86_64"), allow(unused_macros, unused_mut, unused_variables))]
#[allow(clippy::unused_unit)]
mod partial;
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
#[forbid(unsafe_code)]
mod on_x86;
#[cfg(all(target_arch = "powerpc64", not(miri)))]
#[forbid(unsafe_code)]
mod on_other;
mod rows;
mod window;
mod prefetch;
mod shared;
#[cfg_attr(any(target_vendor = "apple", miri, not(target_arch = "x86_64")), allow(unused_macros))]
mod stream;
#[forbid(unsafe_code)]
mod accumulate;
#[forbid(unsafe_code)]
mod closures;
#[cfg(any(target_arch = "x86", target_arch = "x86_64", bun_simd_all_branches))]
#[forbid(unsafe_code)]
mod shift_same;
#[forbid(unsafe_code)]
mod tails;
#[path = "bf16.rs"]
#[forbid(unsafe_code)]
mod brain;
#[path = "f16.rs"]
#[forbid(unsafe_code)]
mod binary16;
#[forbid(unsafe_code)]
mod half;
#[forbid(unsafe_code)]
mod half_raw;
#[forbid(unsafe_code)]
mod utf8;
#[forbid(unsafe_code)]
mod arithmetic;
#[forbid(unsafe_code)]
mod cast;
#[forbid(unsafe_code)]
mod bitmaps;
#[forbid(unsafe_code)]
mod columns;
#[forbid(unsafe_code)]
mod interleaved_tails;
#[forbid(unsafe_code)]
mod load;
#[forbid(unsafe_code)]
mod masks;
#[forbid(unsafe_code)]
mod matches;
#[forbid(unsafe_code)]
mod moves;
#[forbid(unsafe_code)]
mod one_by_one;
#[forbid(unsafe_code)]
mod other_lanes;
#[forbid(unsafe_code)]
mod over;
#[forbid(unsafe_code)]
mod polynomial;
#[forbid(unsafe_code)]
mod products;
#[forbid(unsafe_code)]
mod records;
#[forbid(unsafe_code)]
mod rounding;
#[forbid(unsafe_code)]
mod several;
#[forbid(unsafe_code)]
mod sink;
#[forbid(unsafe_code)]
mod staged;
#[forbid(unsafe_code)]
mod std_loops;
#[forbid(unsafe_code)]
mod std_masks;
#[forbid(unsafe_code)]
mod std_names;
#[forbid(unsafe_code)]
mod std_numbers;
#[forbid(unsafe_code)]
mod streaming;
#[forbid(unsafe_code)]
mod access;
#[forbid(unsafe_code)]
mod chains;
#[forbid(unsafe_code)]
mod clamped;
#[forbid(unsafe_code)]
mod tables;
#[forbid(unsafe_code)]
mod algo;
#[forbid(unsafe_code)]
mod bits;
#[forbid(unsafe_code)]
mod convert;
#[forbid(unsafe_code)]
mod endian;
#[forbid(unsafe_code)]
mod swizzle;
#[forbid(unsafe_code)]
mod byte_set;
#[forbid(unsafe_code)]
mod arch;
#[forbid(unsafe_code)]
mod lane;
#[forbid(unsafe_code)]
mod fields;
#[forbid(unsafe_code)]
mod low_bytes;
#[forbid(unsafe_code)]
mod minifloat;
#[forbid(unsafe_code)]
mod planes;
#[forbid(unsafe_code)]
mod passing;
#[forbid(unsafe_code)]
mod linear;
#[forbid(unsafe_code)]
mod many;
#[forbid(unsafe_code)]
mod memory;
#[forbid(unsafe_code)]
mod more;
#[forbid(unsafe_code)]
mod mul52;
#[forbid(unsafe_code)]
mod multiply;
#[forbid(unsafe_code)]
mod numeric;
#[forbid(unsafe_code)]
mod ops;
#[forbid(unsafe_code)]
mod padded;
#[forbid(unsafe_code)]
mod pattern;
#[forbid(unsafe_code)]
mod piece;
#[forbid(unsafe_code)]
mod raw;
#[forbid(unsafe_code)]
mod rotate;
#[forbid(unsafe_code)]
mod sets;
#[forbid(unsafe_code)]
mod sha;
#[forbid(unsafe_code)]
mod aes;
#[forbid(unsafe_code)]
mod aes_fallback;
#[forbid(unsafe_code)]
mod unroll;
#[doc(hidden)]
pub mod __index {
    pub use crate::unroll::*;
}
#[cfg(bun_simd_check)]
mod lost;
#[forbid(unsafe_code)]
mod tag;
#[forbid(unsafe_code)]
mod vector;
#[forbid(unsafe_code)]
mod wide_sums;
#[forbid(unsafe_code)]
mod width;
#[forbid(unsafe_code)]
mod shared_memory;
#[forbid(unsafe_code)]
mod slices;
#[cfg(any(target_arch = "x86", target_arch = "x86_64", bun_simd_all_branches))]
#[forbid(unsafe_code)]
mod sse2;
#[forbid(unsafe_code)]
mod vqsort;
#[forbid(unsafe_code)]
mod any_of;
#[forbid(unsafe_code)]
mod ascii;
#[forbid(unsafe_code)]
mod fixed_point;
#[forbid(unsafe_code)]
mod interleave3;
#[forbid(unsafe_code)]
mod large_angles;
#[allow(clippy::approx_constant, reason = "tables of coefficients")]
#[path = "math.rs"]
#[forbid(unsafe_code)]
mod elementary;
#[forbid(unsafe_code)]
mod matrix;
#[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
#[forbid(unsafe_code)]
mod arm;
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
#[forbid(unsafe_code)]
mod x86;
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[forbid(unsafe_code)]
mod wasm;

#[doc(hidden)]
#[allow(unused_imports)]
pub use gate::{Choice, Listed, Named, on};
#[doc(hidden)]
pub use plain::derived as __plain;
/// For macros.
#[doc(hidden)]
pub mod __core {
    pub use core::{
        assert, cfg,
        clone::Clone,
        compile_error, concat,
        fmt::Debug,
        iter::Iterator,
        marker::{Copy, PhantomData},
        option::Option,
        prelude::v1::derive,
        primitive, stringify,
    };
}
/// Arrays of vectors.
#[forbid(unsafe_code)]
pub mod array;
pub use arithmetic::Count;
#[doc(hidden)]
pub use kernel::WithToken;
pub use lane::Scaled;
pub use lane::{Float, HasSign, Int, Lane, Signed, Unsigned};
pub use load::Keep;
pub use low_bytes::MoreBytes;
pub use make::{InBlocks, IntoSimd};
pub use {
    attributes::{except, only, shared, simd},
    kernel::{Isa, kernel},
};
pub use {binary16::f16, brain::bf16};
/// The mask for lanes of `T`: `MaskOf<u8, W, S>` is `Mask<i8, W, S>`.
pub type MaskOf<T, W, S> = mask::Mask<<T as Lane>::Signed, W, S>;
pub use bitmaps::Selected;
pub use cast::Widens;
pub use columns::{Columns, Items, Mapped, Sinks};
#[doc(hidden)]
pub use gate::Usual as __Targets;
pub use gate::{Caller, Outside};
#[doc(hidden)]
pub use gate::{Entering, Native as NativeKernel, Returns, Usual, call_best, call_by_table, call_here, call_to};
pub use lane::SameSize;
pub use mask::Mask;
#[cfg_attr(doc, doc(hidden))]
pub use masks::CastMask;
pub use moves::{ByUpper, U128s};
#[doc(hidden)]
pub use other_lanes::ForShared as _;
pub use other_lanes::{all::*, of_masks::*, of_vectors::*};
pub use over::{Over, OverMut, Zip, ZipMut};
pub use products::{Dot, Factor, MatMul, SumGroups};
pub use rolled::not_unrolled;
pub use rounding::Rounding;
pub use sets::Members;
pub use vector::{Array, Bools, Operand, Simd};
pub use vqsort::sort;
#[doc(hidden)]
#[forbid(unsafe_code)]
pub mod native;
pub(crate) use native::{Code, On as At};
#[doc(hidden)]
pub use native::{NeedsAttributeSimdOrKernel, ThisFunction};
#[doc(hidden)]
#[forbid(unsafe_code)]
#[allow(missing_docs)]
pub mod only;
#[doc(hidden)]
#[allow(missing_docs)]
pub mod featured;
#[doc(hidden)]
pub use bun_simd_macros::{list, twins};
pub use width::{B2, B4, B8, B16, B32, B64, B128, B256, B512, Width};
pub(crate) use {
    memory::{Place, Region, Source},
    tag::Tag,
};

/// Memory that is not a plain slice: shared, uninitialized, aligned, or in rows.
pub mod mem {
    pub use crate::access::Aligned;
    pub use crate::chunk_at::{ChunkAt, FlatArray, SubArray};
    pub use crate::lane::{as_bytes, as_bytes_mut, as_cells};
    pub use crate::load::{Readable, Writable};
    pub use crate::output::{Appendable, Appending, Output, Room};
    pub use crate::piece::Piece;
    pub use crate::plain::{
        AsBytes, Plain, bitcast_slice, bitcast_slice_mut, try_bitcast_slice, try_bitcast_slice_mut,
    };
    pub use crate::prefetch::{Prefetch, prefetch, prefetch_with};
    pub use crate::rows::{Rows, RowsMut};
    pub use crate::shared::Shared;
    pub use crate::sink::{Part, Sink};
    pub use crate::stream::{Lendable, Streamed, Streaming, streaming};
    pub use crate::whole::{Slice, SliceMut};
}

/// Targets, and how one is chosen.
#[cfg_attr(doc, doc = "", doc = include_str!("docs/targets.md"))]
pub mod target {
    pub use crate::detect::{CpuModel, CpuVendor, cpu_features, cpu_model};
    pub use crate::gate::{Target, Targets, cpu, reset_cpu, set_cpu};
    pub use crate::kernel::{Baseline, baseline};
    /// Uses only what the whole program is compiled for. Every CPU has it.
    pub type Portable = crate::ops::Portable<()>;
    /// Kernels by hand.
    #[doc(hidden)]
    pub use crate::{
        gate::{dispatch, dispatch_static, dispatch_to},
        kernel::Kernel,
    };
}

/// Sets and classes of bytes.
pub mod text {
    pub use crate::ascii::Ascii;
    pub use crate::byte_set::{ByteClasses, ByteSet};
    #[cfg(feature = "alloc")]
    pub use crate::checked::string_from_utf8;
    pub use crate::checked::{Utf8, from_utf8};
}

/// The states of hash functions. The rounds of AES and SM4 are methods of vectors.
pub mod crypto {
    pub use crate::sha::{Sha1, Sha256, Sha512, Sm3};
}

/// Helpers for numbers. The elementary functions are methods of vectors.
pub mod math {
    pub use crate::linear::{LinearMap, galois_matrix, galois_nibbles};
    pub use crate::minifloat::Minifloat;
    pub use crate::multiply::Divisor;
    pub use crate::products::{AbsDiffSums, PairSums};
    pub use crate::rounding::Round;
    pub use crate::slices::Xoshiro;
}

pub(crate) use {crypto::*, math::*, mem::*, target::*};

/// All of the crate, for what has [`simd`](macro@simd) or [`kernel`](macro@kernel).
pub mod prelude {
    #[doc(inline)]
    pub use __inside::*;
    #[doc(hidden)]
    pub mod __inside {
        crate::target_names!(pub use crate::on::Portable);
        pub use crate::Isa as _;
        pub use crate::not_unrolled;
        pub use crate::target::{Baseline, Target, baseline};
        pub use crate::{crypto::*, math::*, mem::*, text::*, *};
        /// A function that declares the target by hand lacks its instructions.
        #[allow(hidden_glob_reexports)]
        struct Isa;
        #[allow(hidden_glob_reexports)]
        struct WithToken;
    }
    /// The target, where no attribute has declared it.
    pub type S = crate::Outside;
}

/// For code that declares `S: Isa` by hand and passes the target as a value. It lacks the instructions of the target unless it is inlined.
#[doc(hidden)]
pub mod generic {
    #[doc(hidden)]
    pub use crate::Usual as __Targets;
    pub use crate::target::{Baseline, Target, Targets, baseline};
    pub use crate::{crypto::*, math::*, mem::*, text::*, *};
    crate::target_names!(pub use crate::on::Portable);
}

/// Otherwise the compiler knows no value, and what tests for that can be left out. Miri answers at random.
const OPTIMIZED: bool = !cfg!(all(bun_simd_unoptimized, not(miri)));
/// Windows with the library of GCC.
const MINGW: bool = X86 && cfg!(all(windows, target_env = "gnu", not(target_abi = "llvm")));
const WASM: bool = cfg!(all(target_arch = "wasm32", target_feature = "simd128"));
const X86: bool = cfg!(any(target_arch = "x86", target_arch = "x86_64"));

#[cfg(any(doc, doctest))]
#[doc = "[index]: crate::index\n[speed]: crate::guide::speed\n[slow]: crate::guide::speed#slow-operations\n[strips]: crate::guide::loops#strips\n[loops]: crate::guide::loops\n[targets]: mod@crate::target\n[panics]: crate::guide::panics\n[quirks]: crate::guide::quirks\n[highway]: crate::guide::highway\n[programs]: crate::guide::programs\n[marks]: crate::guide::programs#many-files-and-crates\n"]
#[doc = include_str!("docs/guide.md")]
pub mod guide {
    #[doc = include_str!("docs/highway.md")]
    pub mod highway {}
    #[doc = "[speed]: crate::guide::speed\n[memory]: crate::guide#memory\n"]
    #[doc = include_str!("docs/loops.md")]
    #[doc(alias("pipelining", "stencil", "tile", "matmul"))]
    pub mod loops {}
    #[doc = include_str!("docs/panics.md")]
    pub mod panics {}
    #[doc = "[guide]: crate::guide\n[slow]: crate::guide::speed#slow-operations\n[targets]: mod@crate::target\n"]
    #[doc = include_str!("docs/programs.md")]
    pub mod programs {}
    #[doc = "[speed]: crate::guide::speed\n"]
    #[doc = include_str!("docs/quirks.md")]
    pub mod quirks {}
    #[doc = "[guide]: crate::guide\n[neighbors]: crate::guide#neighbors\n[memory]: crate::guide#memory\n[loops]: crate::guide::loops\n[ahead]: crate::guide::loops#one-step-ahead\n[strips]: crate::guide::loops#strips\n[tiles]: crate::guide::loops#tiles\n[quirks]: crate::guide::quirks\n"]
    #[doc = include_str!("docs/speed.md")]
    #[doc(alias("cold_path", "unlikely", "branchless", "mispredict", "short_inputs", "bounds_checks"))]
    #[doc(alias("slow", "fast", "sve"))]
    pub mod speed {}
}

#[cfg(all(doc, feature = "alloc"))]
#[doc = concat!(include_str!("docs/index.md"), include_str!("docs/index-links.md"))]
#[allow(rustdoc::redundant_explicit_links)]
#[doc(alias(
    "andnot", "and_not", "ternary", "ternlog", "vpternlog", "ptest", "vptest", "newton", "refine", "hash", "histogram",
    "conflict", "vpconflict", "scatter_add", "fast_gather", "fast_pdep", "fast_zmm", "fast_compress_store", "full_zmm",
    "vaes", "vpclmulqdq", "ifma", "struct", "lower_bound", "partition_point", "binary_search", "merge", "union",
    "delta", "zigzag", "recurrence", "hamming", "rank", "atoi", "digits", "decimal", "convolution", "resolve",
    "function_pointer", "vtable", "fir", "decimate", "iq", "montgomery", "barrett", "bitpack"
))]
pub mod index {}

#[cfg(doctest)]
#[doc = include_str!("tests/errors.md")]
struct Errors;

/// The constant is evaluated where code is made, so not by `cargo check`, clippy and rustdoc.
#[doc(hidden)]
#[inline(never)]
pub fn needs_a_recent_llvm() {
    const { assert!(cfg!(any(bun_simd_recent_llvm, miri)), "bun_simd needs LLVM 23 or later, which build.rs didn't find") }
}

#[cfg(all(
    any(target_feature = "altivec", target_feature = "partword-atomics"),
    not(target_feature = "vsx"),
    target_endian = "little",
    not(miri)
))]
compile_error!("PowerPC without VSX is not supported: use -Ctarget-cpu=pwr8 or later");
#[cfg(all(
    target_endian = "big",
    any(all(target_arch = "arm", target_feature = "neon"), target_feature = "msa"),
    not(miri)
))]
compile_error!("big-endian 32-bit Arm with NEON and big-endian MIPS with MSA are not tested");

#[cfg(all(test, feature = "slow-tests"))]
#[forbid(unsafe_code)]
#[path = "tests/unit/raw.rs"]
mod unit;
#[cfg(test)]
#[forbid(unsafe_code)]
#[path = "tests/unit/utf8.rs"]
mod unit_utf8;
