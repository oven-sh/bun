//! Dispatch. The compiler can't check this file completely.
//!
//! Calling a `#[target_feature]` function is undefined behavior on a CPU that lacks the features, and Rust has no way
//! to prove a run-time check to the compiler. [`enter`] makes that call. It is sound because:
//!
//! 1. A `Target` has private fields, and its `needs` has the bits of all features of its token, with all that these imply
//!    (`IMPLIED`). A name that `detect.rs` doesn't know gives `NEVER`. The lists in `levels!` are used both for
//!    `#[target_feature]` and for `NEEDS`.
//! 2. A bit of `HAVE` for a feature is only set if that was detected or the program is compiled for it, and a bit for a level
//!    only if all of its features are. `CLASS` is 0, or names a level for which that holds. Each value stands by itself, so
//!    the order of the writes doesn't matter. The bits in `HINTS` prove nothing, and no entry relies on them.
//! 3. Entry `i` of a `List` needs no feature that target `i` lacks, and is called if the bits of that target are in `HAVE`,
//!    in the class, or were just detected. All lists and tables are constants that this file computes. The consumer only
//!    holds a `Choice<L>`, whose field is private. It names a target of `L` whose bits were in `HAVE`, and all kernels that use
//!    it have the targets of `L`. An old value is as true as a new one: `EPOCH` is only there for `set_cpu`.
//! 4. The type of a token is the proof. It has no name outside of this crate, and appears in no signature, field, constant or
//!    `impl` but its own, unless the whole program is compiled for it. `Named::generic` alone puts it in the place of a parameter, for the
//!    entry of its target. So code that is an instance for it runs only after that entry has, and `here` and the functions of `Enter`
//!    need no other check. The compiler checks that these have the features of each group of operations in the token.
//! 5. What a list adds to a level is in the type too. Entry `i` has `Nth<L, i>`, which claims the bits of target `i`. `featured.rs` relies on it.
//!
//! It trusts `detect.rs`, and assumes that all cores have the same features, they don't go away, and the flags that
//! the program is compiled with (`-Ctarget-cpu`) are true. It also needs LLVM 23 or later
//! (llvm/llvm-project#205113).

use crate::{Isa, Kernel, detect, tuning};
use core::marker::PhantomData;
use core::sync::atomic::Ordering::{Acquire, Relaxed, Release};
use core::sync::atomic::{AtomicU8, AtomicU32};

type Entry<A, R> = <A as Spread>::Entry<R>;

/// Functions take their arguments one by one, so that these are in registers.
macro_rules! arities { ($then:ident $($more:tt)*) => { $then! { $($more)*
        (run0 apart0 plain0 [])
        (run1 apart1 plain1 [a A0])
        (run2 apart2 plain2 [a A0 b A1])
        (run3 apart3 plain3 [a A0 b A1 c A2])
        (run4 apart4 plain4 [a A0 b A1 c A2 d A3])
        (run5 apart5 plain5 [a A0 b A1 c A2 d A3 e A4])
        (run6 apart6 plain6 [a A0 b A1 c A2 d A3 e A4 f A5])
        (run7 apart7 plain7 [a A0 b A1 c A2 d A3 e A4 f A5 g A6])
        (run8 apart8 plain8 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7])
        (run9 apart9 plain9 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8])
        (run10 apart10 plain10 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9])
        (run11 apart11 plain11 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9 k A10])
        (run12 apart12 plain12 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9 k A10 l A11])
        (run13 apart13 plain13 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9 k A10 l A11 m A12])
} }; }

/// A tuple of arguments.
#[allow(private_bounds)]
#[diagnostic::on_unimplemented(message = "the arguments of a kernel are a tuple of up to 13")]
pub(crate) trait Args: Spread {}
impl<A: Spread> Args for A {}

trait Spread: Sized {
    type Entry<R>: Copy;
    type Run<S: Enter, K: Kernel<Self>>: Is<Self::Entry<K::Output>>;
    type Apart<S: Enter, K: Kernel<Self>>: Is<Self::Entry<K::Output>>;
    type Plain<K: Kernel<Self>>: Is<Self::Entry<K::Output>>;
    fn enter<R>(entry: Self::Entry<R>, args: Self) -> R;
}
trait Is<T> {
    const IT: T;
}
struct Run<S, K, A>(S, K, A);
struct Apart<S, K, A>(S, K, A);
struct Plain<K, A>(K, A);

/// The callers in this file pass an entry whose features the CPU has.
#[inline(always)]
fn enter<A: Args, R>(entry: Entry<A, R>, args: A) -> R {
    A::enter(entry, args)
}

macro_rules! spread { ($(($run:ident $apart:ident $plain:ident [$($a:ident $A:ident)*]))*) => {
    $(
        #[allow(unsafe_code)]
        impl<$($A),*> Spread for ($($A,)*) {
            type Entry<R> = unsafe fn($($A),*) -> R;
            type Run<S: Enter, K: Kernel<Self>> = Run<S, K, Self>;
            type Apart<S: Enter, K: Kernel<Self>> = Apart<S, K, Self>;
            type Plain<K: Kernel<Self>> = Plain<K, Self>;
            #[inline(always)]
            fn enter<R>(entry: Self::Entry<R>, ($($a,)*): Self) -> R {
                // SAFETY: every entry is a safe function but for its target features. See the top of the file for those.
                unsafe { entry($($a),*) }
            }
        }
        impl<S: Enter, K: Kernel<($($A,)*)>, $($A),*> Is<Entry<($($A,)*), K::Output>> for Run<S, K, ($($A,)*)> {
            const IT: Entry<($($A,)*), K::Output> = S::$run::<K, $($A),*>;
        }
        impl<S: Enter, K: Kernel<($($A,)*)>, $($A),*> Is<Entry<($($A,)*), K::Output>> for Apart<S, K, ($($A,)*)> {
            const IT: Entry<($($A,)*), K::Output> = S::$apart::<K, $($A),*>;
        }
        impl<K: Kernel<($($A,)*)>, $($A),*> Is<Entry<($($A,)*), K::Output>> for Plain<K, ($($A,)*)> {
            const IT: Entry<($($A,)*), K::Output> = $plain::<K, $($A),*>;
        }
        /// What can be inlined has a copy in each unit of code generation that mentions it.
        #[inline(never)]
        #[allow(clippy::too_many_arguments)]
        fn $plain<K: Kernel<($($A,)*)>, $($A),*>($($a: $A),*) -> K::Output {
            K::run(tokens::Portable::new(), ($($a,)*))
        }
    )*

    /// Not nameable outside of this crate.
    ///
    /// # Safety
    /// The functions that are `unsafe` need the features of the token, and nothing else.
    #[allow(unsafe_code, private_bounds, clippy::too_many_arguments)]
    pub(crate) trait Enter: Copy {
        const COMPILED_FOR: bool;
        /// An instance that names the token has its features, and only dispatch leads to one.
        fn here() -> Self;
        unsafe fn place() -> *const u8;
        /// See `closures.rs`.
        fn only_call<F: FnOnce() -> R, R>(self, f: F) -> R;
        /// It is inlined if it is short, and leaves the adapters of `core` around it shorter.
        #[inline(always)]
        fn short_call<F: FnOnce() -> R, R>(self, f: F) -> R {
            if const { Self::COMPILED_FOR } { f() } else { enter(<(F,) as Spread>::Run::<Self, Call>::IT, (f,)) }
        }
        $(
            unsafe fn $run<K: Kernel<($($A,)*)>, $($A),*>($($a: $A),*) -> K::Output;
            unsafe fn $apart<K: Kernel<($($A,)*)>, $($A),*>($($a: $A),*) -> K::Output;
        )*
        /// As a function of its own.
        #[inline(always)]
        fn enter<K: Kernel<A>, A: Args>(self, args: A) -> K::Output {
            enter(A::Apart::<Self, K>::IT, args)
        }
    }
}; }
arities!(spread);

/// Not nameable outside of this crate.
pub trait Sealed {}

/// Not nameable outside of this crate.
pub trait TokenOf<const NAMED: u8> {
    type Token: Isa;
}

/// Makes all combinations of each level with its words, and the steps from one to another by a word.
#[rules]
macro_rules! levels {
    (@words [$($done:tt)*] [$($steps:tt)*] [$($all:tt)*] [$($these:tt)*] ; $($rest:tt)*) => {
        levels! { @level [$($done)* $($all)*] [$($steps)* $($these)*] $($rest)* }
    };
    (@words $done:tt $steps:tt
        [$(($name:ident $about:tt [$($text:tt)*] [$($words:tt)*] [$($features:tt)*] [$($groups:tt)*]))*] [$(($from:ident $by:ident $to:ident))*]
        + $word:ident $w:tt $f:tt $g:tt else $other:tt $($rest:tt)*
    ) => {
        levels! { @words $done $steps [
            $(($name $about [$($text)*] [$($words)*] [$($features)*] [$($groups)* $other]))*
            $((${concat($name, _, $word)} $about [$($text)* $word] [$($words)* $w] [$($features)* $f] [$($groups)* $g]))*
        ] [
            $(($name $word ${concat($name, _, $word)}) (${concat($name, _, $word)} $word ${concat($name, _, $word)}))*
            $(($from $by $to) (${concat($from, _, $word)} $by ${concat($to, _, $word)}))*
        ] $($rest)* }
    };
    // Each word of a chain brings the ones before it. After the usual lists come the tokens with the last word so far,
    // the steps among them, and where each token of the chain goes by that word.
    (@words $done:tt $steps:tt [$(($name:ident $($x:tt)*))*] $these:tt ~ $($rest:tt)*) => {
        levels! { @chain $done $steps [$(($name $($x)*))*] $these [$(($name $($x)*))*] $these [$(($name $name))*] ~ $($rest)* }
    };
    (@chain $done:tt $steps:tt [$($all:tt)*] [$($these:tt)*]
        [$(($name:ident $about:tt [$($text:tt)*] [$($words:tt)*] [$($features:tt)*] [$($groups:tt)*]))*] [$(($from:ident $by:ident $to:ident))*] [$(($low:ident $high:ident))*]
        ~ $word:ident $w:tt $f:tt $g:tt $($rest:tt)*
    ) => {
        levels! { @chain $done $steps
            [$($all)* $((${concat($name, _, $word)} $about [$($text)* $word] [$($words)* $w] [$($features)* $f] [$($groups)* $g]))*]
            [$($these)* $(($low $word ${concat($high, _, $word)}))* $((${concat($name, _, $word)} $word ${concat($name, _, $word)}))* $((${concat($from, _, $word)} $by ${concat($to, _, $word)}))*]
            [$((${concat($name, _, $word)} $about [$($text)* $word] [$($words)* $w] [$($features)* $f] [$($groups)* $g]))*]
            [$((${concat($name, _, $word)} $word ${concat($name, _, $word)}))* $((${concat($from, _, $word)} $by ${concat($to, _, $word)}))*]
            [$(($low ${concat($high, _, $word)}))* $((${concat($name, _, $word)} ${concat($name, _, $word)}))*]
            $($rest)*
        }
    };
    (@chain $done:tt $steps:tt $all:tt [$($these:tt)*] [$(($name:ident $($x:tt)*))*] [$($last:tt)*] [$(($low:ident $high:ident))*] aka $other:ident $($rest:tt)*) => {
        levels! { @chain $done $steps $all [$($these)* $(($low $other $high))*] [$(($name $($x)*))*] [$($last)* $(($name $other $name))*] [$(($low $high))*] $($rest)* }
    };
    (@chain $done:tt $steps:tt $all:tt $these:tt $last:tt $its:tt $pairs:tt $($rest:tt)*) => { levels! { @words $done $steps $all $these $($rest)* } };
    (@words $done:tt $steps:tt [$(($name:ident $($x:tt)*))*] [$($these:tt)*] > $word:ident $to:ident $($rest:tt)*) => {
        levels! { @words $done $steps [$(($name $($x)*))*] [$($these)* $(($name $word $to))*] $($rest)* }
    };
    (@words $done:tt $steps:tt [$(($name:ident $($x:tt)*))*] $these:tt + $word:ident $w:tt $f:tt $g:tt aka $other:ident $($rest:tt)*) => {
        levels! { @words $done $steps [$(($name $($x)*))*] $these + $word $w $f $g else {} aka $other $word [$($name)*] $($rest)* }
    };
    (@words $done:tt $steps:tt $all:tt [$($these:tt)*] aka $other:ident $word:ident [$($name:ident)*] $($rest:tt)*) => {
        levels! { @words $done $steps $all [
            $($these)* $(($name $other ${concat($name, _, $word)}) (${concat($name, _, $word)} $other ${concat($name, _, $word)}))*
        ] $($rest)* }
    };
    (@words $done:tt $steps:tt $all:tt $these:tt + $word:ident $w:tt $f:tt $g:tt $($rest:tt)*) => {
        levels! { @words $done $steps $all $these + $word $w $f $g else {} $($rest)* }
    };
    (@level $done:tt $steps:tt $level:ident $text:literal in $module:ident $arch:tt ($($word:ident)*) $f:tt $g:tt $($rest:tt)*) => {
        levels! { @words $done $steps [($level ($level $text $module $arch) [] [($($word)*)] [$f] [$g])] [$(($level $word $level))*] $($rest)* }
    };
    (@level [$((
        $name:ident ($level:ident $first:literal $module:ident ($arch:meta)) [$($text:ident)*] [$(($($word:ident)*))*] [$([$($feature:tt)*])*] [$({$($group:ident)*})*]
    ))*] $steps:tt) => {
        targets! { $steps $(($name $level $first $module [$arch] [$($text)*] [$($($word)*)*] [$($($feature)*)*] [$($($group)*)*]))* }
    };
    ($($table:tt)*) => { levels! { @level [] [
        (avx2 aes avx2_aes) (avx2 sha avx2_aes_sha) (avx2 vaes avx2_aes_vaes) (avx2 gfni avx2_aes_vaes_gfni) (avx2 vnni avx2_aes_vaes_gfni_vnni)
        (avx512 aes avx512_aes) (avx512 vnni avx512_aes_vnni) (avx512 bf16 avx512_aes_vnni_bf16) (avx512_narrow aes avx512_aes_narrow)
        (avx512_narrow vnni avx512_aes_vnni_narrow) (avx512_narrow bf16 avx512_aes_vnni_bf16_narrow) (wasm relaxed wasm_relaxed)
    ] $($table)* } };
}

macro_rules! targets {
    ($steps:tt $(($name:ident $level:ident $first:literal $module:ident [$arch:meta] [$($text:ident)*] [$($word:ident)*] [$($feature:tt)*] [$($group:ident)*]))*) => {
        /// The combinations that have a token.
        #[doc(hidden)]
        #[derive(Copy, Clone, PartialEq, Eq)]
        #[allow(non_camel_case_types)]
        pub enum Named { Portable, $($name,)* }

        impl Named {
            const ALL: &[Named] = &[Named::Portable, $(Named::$name,)*];
            /// Those of the architecture that the program is compiled for.
            pub(crate) const NATIVE: &[Named] = &[Named::Portable, $(#[cfg($arch)] Named::$name,)*];

            const fn features(self) -> &'static [&'static str] {
                match self { Named::Portable => &[], $(Named::$name => &[$($feature),*],)* }
            }
            #[inline(always)]
            const fn words(self) -> &'static [&'static str] {
                match self { Named::Portable => &["portable"], $(Named::$name => &[$(stringify!($word)),*],)* }
            }
            const fn text(self) -> &'static str {
                match self { Named::Portable => "portable", $(Named::$name => concat!($first $(, " + ", stringify!($text))*),)* }
            }
            const fn level(self) -> Named {
                match self { Named::Portable => Named::Portable, $(Named::$name => Named::$level,)* }
            }
            const fn is_native(self) -> bool {
                match self { Named::Portable => true, $(Named::$name => cfg!($arch),)* }
            }
            const fn generic<K: Kernel<A>, A: Args, M: More>(self) -> Entry<A, K::Output> {
                // A function of its own, as all constants in a function that is called are evaluated.
                const fn of<S: Enter, K: Kernel<A>, A: Args>() -> Entry<A, K::Output> {
                    const fn run<S: Enter, K: Kernel<A>, A: Args>() -> Entry<A, K::Output> { A::Run::<S, K>::IT }
                    const fn apart<S: Enter, K: Kernel<A>, A: Args>() -> Entry<A, K::Output> { A::Apart::<S, K>::IT }
                    if S::COMPILED_FOR && !K::APART { run::<S, K, A>() } else { apart::<S, K, A>() }
                }
                #[allow(unreachable_patterns)]
                match self { $(#[cfg($arch)] Named::$name => of::<tokens::$name<M>, K, A>(),)* _ => of::<tokens::Portable<M>, K, A>() }
            }
        }

        crate::words::about_targets! { $steps $(($name [$arch] [$($word)*] [$($feature)*]))* }

        #[allow(non_camel_case_types, unused_imports)] // The entries of a token are in the unit of code generation of its module.
        pub(crate) mod tokens {
            use crate::{Isa, Named, Target, shared::Shared, width::Of};
            use {crate::simd::prelude::*, core::sync::atomic::AtomicU8};
            pub use crate::ops::{LikeNarrow, LikeIcelake, LikeAvx512, LikeAvx2, LikeSse4, LikeNeon, LikeB64, LikeB32, LikeB16, Portable};
            $(#[cfg($arch)] pub use each::$name::$name;)* mod each { $(#[cfg($arch)] pub mod $name { use super::super::*; crate::ops::define_token!(
                $module $name concat!($first $(, " + ", stringify!($text))*), [$($feature)*] [$($group)*] [$($word)*]
            ); })* }
        }

        #[allow(unused_imports)] // Several targets have a word.
        mod words_of { $(#[cfg($arch)] pub(crate) mod $name { pub(crate) use crate::only::yes::{$($word),*}; })* }
        /// The words that a target of this architecture has.
        #[allow(unused_imports)]
        pub(crate) mod native_words { pub(crate) use crate::only::yes::portable; $(#[cfg($arch)] pub(crate) use super::words_of::$name::*;)* }

        mod entries {
            use super::*;
            entries!(Portable here []);
            entries!(@portable LikeNarrow LikeIcelake LikeAvx512 LikeAvx2 LikeSse4 LikeNeon LikeB64 LikeB32 LikeB16);
            $(#[cfg($arch)] entries!($name here [$($feature)*]);)*
        }
    };
}

macro_rules! entries {
    ($name:ident $new:ident [$($feature:tt)*]) => {
        entries!(@enter $name $new [$($feature)*]);
        #[cfg(all($(target_feature = $feature),*))]
        impl TokenOf<{ Named::$name as u8 }> for Target {
            type Token = tokens::$name;
        }
    };
    (@portable $($name:ident)*) => { $(entries!(@enter $name here []);)* };
    (@enter $name:ident $new:ident [$($feature:tt)*]) => {
        // rustc makes a unit of code generation out of each module, so LLVM works on the targets in parallel.
        #[allow(non_snake_case)]
        mod $name {
            use super::*;
            #[allow(unsafe_code)]
            impl<M: More> Enter for tokens::$name<M> {
                const COMPILED_FOR: bool = cfg!(all($(target_feature = $feature),*));
                #[inline(always)]
                #[allow(unused_unsafe)]
                fn here() -> Self {
                    // SAFETY: no code can name the type but what dispatch has led to. See point 4 at the top of the file.
                    unsafe { tokens::$name::$new() }
                }
                #[inline]
                #[allow(unknown_lints, dangling_pointers_from_locals)]
                $(#[target_feature(enable = $feature)])*
                unsafe fn place() -> *const u8 {
                    let it = 0;
                    &raw const it
                }
                #[inline(always)]
                fn only_call<F: FnOnce() -> R, R>(self, f: F) -> R {
                    if const { Self::COMPILED_FOR } {
                        return crate::closures::only_call(f);
                    }
                    Entering::<Self>::inlined0(f)
                }
                arities!(entries @all $name $new [$($feature)*]);
            }
        }
    };
    (@all $name:ident $new:ident $features:tt $($arity:tt)*) => { $(entries!(@one $name $new $features $arity);)* };
    (@one $name:ident $new:ident [$($feature:tt)*] ($run:ident $apart:ident $plain:ident [$($a:ident $A:ident)*])) => {
        #[inline]
        $(#[target_feature(enable = $feature)])*
        unsafe fn $run<K: Kernel<($($A,)*)>, $($A),*>($($a: $A),*) -> K::Output {
            K::run(tokens::$name::<M>::$new(), ($($a,)*))
        }
        #[inline(never)]
        $(#[target_feature(enable = $feature)])*
        unsafe fn $apart<K: Kernel<($($A,)*)>, $($A),*>($($a: $A),*) -> K::Output {
            K::run(tokens::$name::<M>::$new(), ($($a,)*))
        }
    };
}

// level "text" in module (cfg) (words) [features] {groups of operations}, and then + word (words) [features] {groups} else {groups},
// or aka another_word (after else or aka, with the word and the tokens so far), and > word token. With ~ for +, a word brings those before it, as all CPUs with the one have the others.
levels! {
    // All CPUs with one of the other words have AES. This halves the number of combinations.
    avx2 "avx2" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")) (sse2 sse4 avx2 bmi crc32c fma)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"]
        {sse2 sse4 bmi avx2 fma f16c avx2_only shared_avx}
        > ifma avx2_dot > dot avx2_dot > sha512 avx2_sha512 > sm4 avx2_sha512;
    avx2_aes "avx2 + aes" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")) (sse2 sse4 avx2 aes bmi crc32c fma)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "pclmulqdq" "aes" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"]
        {sse2 sse4 clmul_16 bmi avx2 fma f16c avx2_only shared_avx}
        ~ vaes (vaes) ["vaes" "vpclmulqdq"] {clmul_32}
        ~ gfni (gfni) ["gfni"] {gfni_16 gfni_32}
        ~ vnni (vnni) ["avxvnni"] {avx_vnni}
        + sha (sha) ["sha"] {sha}
        > ifma avx2_dot > dot avx2_dot > sha512 avx2_sha512 > sm4 avx2_sha512;
    // Sierra Forest and Arrow Lake-H, and then Arrow Lake-S and Lunar Lake. These have all that is older.
    avx2_dot "avx2 + dot" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))
        (sse2 sse4 avx2 aes bmi crc32c dot fma gfni ifma sha vaes vnni)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "pclmulqdq" "aes" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"
            "gfni" "avxifma" "sha" "vaes" "vpclmulqdq" "avxvnni" "avxvnniint8"]
        {sse2 sse4 clmul_16 clmul_32 bmi avx2 fma f16c avx2_only shared_avx gfni_16 gfni_32 avx_ifma sha avx_vnni vnni_int8}
        > sha512 avx2_sha512 > sm4 avx2_sha512;
    avx2_sha512 "avx2 + sha512" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))
        (sse2 sse4 avx2 aes bmi crc32c dot fma gfni ifma sha sha512 sm4 vaes vnni)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "pclmulqdq" "aes" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"
            "gfni" "avxifma" "sha" "vaes" "vpclmulqdq" "avxvnni" "avxvnniint8" "avxvnniint16" "sha512" "sm3" "sm4"]
        {sse2 sse4 clmul_16 clmul_32 bmi avx2 fma f16c avx2_only shared_avx gfni_16 gfni_32 avx_ifma sha avx_vnni vnni_int8 vnni_int16 sha512 sm4};
    sse2 "sse2" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")) (sse2) ["sse2"] {sse2 shared_sse};
    sse4 "sse4" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")) (sse2 sse4 crc32c)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt"] {sse2 sse4 sse4_only shared_sse}
        ~ aes (aes) ["pclmulqdq" "aes"] {clmul_16}
        ~ gfni (gfni) ["gfni"] {gfni_16}
        + sha (sha) ["sha"] {sha}
        + bmi (bmi) ["bmi1" "bmi2" "lzcnt"] {bmi};
    // Not on macOS: golang/go#49233.
    icelake "icelake" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))
        (sse2 sse4 avx2 avx512 icelake aes bmi crc32c fma gfni ifma masked vaes vnni)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "pclmulqdq" "aes" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"
            "avx512f" "avx512cd" "avx512vl" "avx512dq" "avx512bw"
            "vpclmulqdq" "vaes" "gfni" "avx512vbmi" "avx512vbmi2" "avx512vnni" "avx512bitalg" "avx512vpopcntdq" "avx512ifma"]
        {sse2 sse4 clmul_16 clmul_32 clmul_64 bmi avx2 fma fma_64 avx512 ice_lake gfni_16 gfni_32 gfni_64 avx512_vnni ifma shared_avx shared_avx512}
        ~ sha (sha) ["sha"] {sha}
        ~ bf16 (bf16) ["avx512bf16"] {bf16}
        ~ fp16 (fp16) ["avx512fp16"] {fp16}
        + narrow (narrow) [] {};
    avx512 "avx512" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))
        (sse2 sse4 avx2 avx512 bmi crc32c fma masked)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"
            "avx512f" "avx512cd" "avx512vl" "avx512dq" "avx512bw"]
        {sse2 sse4 bmi avx2 fma fma_64 avx512 shared_avx shared_avx512}
        + narrow (narrow) [] {} else {avx512_only};
    avx512_aes "avx512 + aes" in x86 (all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))
        (sse2 sse4 avx2 avx512 aes bmi crc32c fma masked)
        ["sse3" "ssse3" "sse4.1" "sse4.2" "popcnt" "pclmulqdq" "aes" "avx" "avx2" "bmi1" "bmi2" "fma" "f16c" "lzcnt" "movbe"
            "avx512f" "avx512cd" "avx512vl" "avx512dq" "avx512bw"]
        {sse2 sse4 clmul_16 bmi avx2 fma fma_64 avx512 shared_avx shared_avx512}
        ~ vnni (vnni) ["avx512vnni"] {avx512_vnni}
        ~ bf16 (bf16) ["avx512bf16"] {bf16}
        + narrow (narrow) [] {} else {avx512_only};
    neon "neon" in arm (all(target_arch = "aarch64", target_feature = "neon", target_endian = "little")) (neon fma) ["neon"] {neon shared no_dot}
        ~ aes (aes sha) ["aes" "sha2"] {pmull sha2} aka sha
        ~ sha3 (sha3 sha512) ["sha3"] {sha512} aka sha512
        ~ sm4 (sm4) ["sm4"] {sm4}
        + crc (crc crc32c) ["crc"] {crc} aka crc32c;
    neon82 "neon82" in arm (all(target_arch = "aarch64", target_feature = "neon", target_endian = "little")) (neon neon82 crc crc32c dot fma)
        ["neon" "crc" "rdm" "dotprod"] {neon shared crc dot rdm no_i8mm}
        ~ aes (aes sha) ["aes" "sha2"] {pmull sha2} aka sha
        ~ sha3 (sha3 sha512) ["sha3"] {sha512} aka sha512
        ~ sm4 (sm4) ["sm4"] {sm4}
        + fcma (fcma) ["fcma"] {fcma}
        + fp16 (fp16) ["fp16"] {fp16};
    neon86 "neon86" in arm (all(target_arch = "aarch64", target_feature = "neon", target_endian = "little")) (neon neon82 neon86 bf16 crc crc32c dot fma fp16 i8mm)
        ["neon" "crc" "rdm" "dotprod" "fp16" "i8mm" "bf16"] {neon shared crc dot rdm i8mm fp16 bf16}
        ~ aes (aes sha) ["aes" "sha2"] {pmull sha2} aka sha
        ~ sha3 (sha3 sha512) ["sha3"] {sha512} aka sha512
        ~ sm4 (sm4) ["sm4"] {sm4}
        + fcma (fcma fhm) ["fcma" "fhm"] {fcma fcma16 fhm} aka fhm;
    // Apple has no such CPU.
    sve2 "sve2" in arm (all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(target_vendor = "apple"))) (neon neon82 neon86 sve2 bf16 crc crc32c dot fcma fhm fma fp16 i8mm masked)
        ["neon" "crc" "rdm" "dotprod" "fp16" "i8mm" "bf16" "fcma" "fhm" "sve" "sve2"] {neon shared crc dot rdm i8mm fp16 bf16 fcma fcma16 fhm sve2}
        ~ aes (aes sha) ["aes" "sha2"] {pmull sha2} aka sha
        ~ sha3 (sha3 sha512) ["sha3"] {sha512} aka sha512
        ~ sm4 (sm4) ["sm4"] {sm4};
    // An engine rejects a module with instructions that it lacks: only what the program is compiled for is there.
    wasm "wasm" in wasm (all(target_arch = "wasm32", target_feature = "simd128")) (wasm) ["simd128"] {simd128 strict};
    wasm_relaxed "wasm + relaxed" in wasm (all(target_arch = "wasm32", target_feature = "relaxed-simd")) (wasm relaxed) ["simd128" "relaxed-simd"] {simd128 relaxed};
}

// The bits that describe a CPU or a target. Those from `FEATURES` on are the ones of `detect.rs`.
const KNOWN: u64 = 1;
/// Vectors of 64 bytes are wanted, or SVE.
const WIDE: u64 = 2;
/// One for each of `LEVELS`, which stands for all of its features. A test of one low bit is short.
const LEVEL: u32 = 2;
const TUNING: u32 = 6;
const FEATURES: u32 = 12;
/// No CPU has this.
const NEVER: u64 = 1 << 63;
const HINTS: u64 = WIDE | 63 << TUNING;

const LEVELS: [Named; 4] = {
    use Named::*;
    cfg_select! {
        any(target_arch = "x86", target_arch = "x86_64") => [sse4, avx2, avx512, icelake],
        _ => [neon, neon82, neon86, sve2],
    }
};

/// Miri lacks most intrinsics of NEON.
const USABLE: u64 = if cfg!(all(miri, target_arch = "aarch64")) { 0 } else { !0 };
const BASELINE: u64 = {
    let bits = detect::BASELINE << FEATURES & USABLE;
    if bits & (bit("avx512f") | bit("sve2")) != 0 { bits | WIDE } else { bits }
};

/// What rustc or LLVM enable along with a feature.
const IMPLIED: &[(&str, &[&str])] = if crate::X86 {
    &[
        ("sse3", &["sse2"]),
        ("ssse3", &["sse3"]),
        ("sse4.1", &["ssse3"]),
        ("sse4.2", &["sse4.1"]),
        ("avx", &["sse4.2"]),
        ("fma", &["avx"]),
        ("f16c", &["avx"]),
        ("avx2", &["avx"]),
        ("vaes", &["avx2", "aes"]),
        ("vpclmulqdq", &["avx", "pclmulqdq"]),
        ("sha512", &["avx2"]),
        ("sm3", &["avx"]),
        ("sm4", &["avx2"]),
        ("avxvnni", &["avx2"]),
        ("avxifma", &["avx2"]),
        ("avxvnniint8", &["avx2"]),
        ("avxneconvert", &["avx2"]),
        ("avxvnniint16", &["avx2"]),
        ("avx512f", &["avx2", "fma", "f16c"]),
        ("avx512dq", &["avx512f"]),
        ("avx512ifma", &["avx512f"]),
        ("avx512cd", &["avx512f"]),
        ("avx512bw", &["avx512f"]),
        ("avx512vl", &["avx512f"]),
        ("avx512vbmi", &["avx512bw"]),
        ("avx512vbmi2", &["avx512bw"]),
        ("avx512vnni", &["avx512f"]),
        ("avx512bitalg", &["avx512bw"]),
        ("avx512vpopcntdq", &["avx512f"]),
        ("avx512vp2intersect", &["avx512f"]),
        ("avx512fp16", &["avx512bw", "avx512vl"]),
        ("avx512bf16", &["avx512bw"]),
    ]
} else {
    &[
        ("aes", &["neon"]),
        ("sha2", &["neon"]),
        ("sha3", &["sha2"]),
        ("sm4", &["neon"]),
        ("fp16", &["neon"]),
        ("rdm", &["neon"]),
        ("jsconv", &["neon"]),
        ("fcma", &["neon"]),
        ("dotprod", &["neon"]),
        ("fhm", &["fp16"]),
        ("frintts", &["neon"]),
        ("i8mm", &["neon"]),
        ("bf16", &["neon"]),
        ("sve", &["fp16"]),
        ("sve2", &["sve"]),
        ("sve2-aes", &["sve2", "aes"]),
        ("sve2-bitperm", &["sve2"]),
        ("sve2-sha3", &["sve2", "sha3"]),
        ("sve2-sm4", &["sve2", "sm4"]),
        ("relaxed-simd", &["simd128"]),
    ]
};

#[inline(always)]
const fn position(names: &[&str], name: &str) -> Option<u32> {
    let mut i = 0;
    // Most differ in length, and this is evaluated often.
    while i < names.len() && (names[i].len() != name.len() || !detect::same_text(names[i], name)) {
        i += 1;
    }
    if i < names.len() { Some(i as u32) } else { None }
}

#[inline(always)]
const fn bit(name: &str) -> u64 {
    const { assert!(detect::NAMES.len() as u32 + FEATURES <= 63 && tuning::NAMES.len() as u32 + TUNING <= FEATURES) };
    if let Some(i) = detect::index(name) {
        return 1 << (FEATURES + i);
    }
    match position(tuning::NAMES, name) {
        Some(i) => 1 << (TUNING + i),
        None => NEVER,
    }
}

/// For each feature, itself and all that it implies.
const CLOSURES: [u64; detect::NAMES.len()] = CLOSURES_ONCE;
// Each crate evaluates a constant again, but takes the value of a static from the metadata.
static CLOSURES_ONCE: [u64; detect::NAMES.len()] = {
    let (mut table, mut i) = ([0; detect::NAMES.len()], 0);
    while i < table.len() {
        table[i] = 1 << (FEATURES + i as u32);
        i += 1;
    }
    // Each row builds on the ones above.
    let mut row = 0;
    while row < IMPLIED.len() {
        let (name, implied) = IMPLIED[row];
        if let Some(at) = position(detect::NAMES, name) {
            let mut i = 0;
            while i < implied.len() {
                let mut later = row;
                while later < IMPLIED.len() {
                    assert!(!detect::same_text(IMPLIED[later].0, implied[i]));
                    later += 1;
                }
                table[at as usize] |=
                    if let Some(it) = position(detect::NAMES, implied[i]) { table[it as usize] } else { NEVER };
                i += 1;
            }
        }
        row += 1;
    }
    table
};

/// With all that they imply.
const fn bits(names: &[&str]) -> u64 {
    let (mut all, mut i) = (0, 0);
    while i < names.len() {
        all |= if let Some(it) = position(detect::NAMES, names[i]) { CLOSURES[it as usize] } else { bit(names[i]) };
        i += 1;
    }
    all
}

const NEEDS: [u64; Named::ALL.len()] = NEEDS_ONCE;
/// The features of a token start with those of its level, which comes before it.
static NEEDS_ONCE: [u64; Named::ALL.len()] = {
    let (mut table, mut i) = ([NEVER; Named::ALL.len()], 0);
    while i < Named::NATIVE.len() {
        let (named, level) = (Named::NATIVE[i], Named::NATIVE[i].level());
        let features = if named as u8 == level as u8 {
            bits(named.features())
        } else {
            table[level as usize] & !WIDE | bits(named.features().split_at(level.features().len()).1)
        };
        table[named as usize] = features | if named.is_wide() { WIDE } else { 0 };
        i += 1;
    }
    table
};

impl Named {
    pub(crate) const fn register(self) -> usize {
        match (position(self.features(), "avx512f"), position(self.features(), "avx2")) {
            (Some(_), _) => 64,
            (_, Some(_)) => 32,
            _ => 16,
        }
    }

    pub(crate) const fn bytes(self) -> usize {
        if position(self.words(), "narrow").is_some() { 32 } else { self.register() }
    }

    /// These, and no others.
    pub(crate) const fn has_words(self, words: &[&str]) -> bool {
        let mut i = 0;
        while i < words.len() && position(self.words(), words[i]).is_some() {
            i += 1
        }
        i == words.len() && i == self.words().len()
    }

    const fn is_wide(self) -> bool {
        self.bytes() == 64 || position(self.features(), "sve2").is_some()
    }

    /// The one of `among` of the highest level and with the most features that needs no more than `have`.
    const fn best(among: &[Named], have: u64) -> usize {
        let (mut best, mut rank, mut i) = (0, 0, 0);
        while i < among.len() {
            let needs = NEEDS[among[i] as usize];
            let this = (NEEDS[among[i].level() as usize] & !WIDE).count_ones() << 8 | needs.count_ones();
            if needs & !have == 0 && this > rank {
                (best, rank) = (i, this);
            }
            i += 1;
        }
        best
    }
}

/// A level plus features. [`target!`](macro@crate::target) makes one.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Target {
    named: Named,
    /// All features, with what they imply.
    needs: u64,
}

impl Target {
    /// The best target that the whole program is compiled for.
    pub(crate) const BASELINE: Target = Target::of(Named::NATIVE[Named::best(Named::NATIVE, BASELINE)], &[]);

    #[doc(hidden)]
    pub const fn of(named: Named, more: &[&str]) -> Target {
        Target { named, needs: if named.is_native() { NEEDS[named as usize] | bits(more) } else { NEVER } }
    }

    const fn from_bits(have: u64) -> Target {
        let named = Named::NATIVE[Named::best(Named::NATIVE, have)];
        Target { named, needs: have & !WIDE | NEEDS[named as usize] }
    }

    #[doc(hidden)]
    pub const fn named(self) -> Named {
        self.named
    }

    const fn is(self, other: Target) -> bool {
        self.named as u8 == other.named as u8 && self.needs == other.needs
    }

    /// Every combination of a level and its words on the architecture that the program is compiled for.
    #[doc(hidden)]
    pub fn combinations() -> impl Iterator<Item = Target> {
        Named::NATIVE.iter().map(|&it| Target::of(it, &[]))
    }

    /// Those of the level and its words, as in `#[target_feature]`.
    pub const fn features(self) -> &'static [&'static str] {
        self.named.features()
    }

    /// Whether it has a feature that is named as in `#[target_feature]`. The name can be of another architecture.
    /// In a kernel, [`has!`](macro@crate::has) is the constant: outside of `const`, this relies on the optimizer, which folds a literal.
    ///
    /// ```
    /// # use bun_simd::target;
    /// assert!(target!(avx2).has("fma") && !target!(sse4).has("avx"));
    /// ```
    #[inline(always)]
    pub const fn has(self, feature: &str) -> bool {
        if self.needs & NEVER == 0 {
            self.needs & bit(feature) != 0
        } else {
            position(self.features(), feature).is_some()
        }
    }

    #[doc(hidden)]
    #[inline(always)]
    pub const fn has_word(self, word: &str) -> bool {
        position(self.named.words(), word).is_some() || position(tuning::NAMES, word).is_some() && self.has(word)
    }

    /// Whether this CPU can run it. Words such as `fast_pdep` don't count.
    #[inline]
    pub fn is_supported(self) -> bool {
        self.needs & !HINTS & !(detect::all() << FEATURES & USABLE) == 0
    }

    /// Whether the whole program is compiled for it.
    pub const fn is_baseline(self) -> bool {
        self.needs & !BASELINE == 0
    }

    /// Whether both are of this architecture, and `self` has all that `other` has.
    pub const fn includes(self, other: Target) -> bool {
        (self.needs | other.needs) & NEVER == 0 && other.needs & !self.needs == 0
    }

    /// Without a feature that is named as in `#[target_feature]`, and all that build on it. It is for [`set_cpu`].
    pub fn without(self, feature: &str) -> Target {
        let gone = bit(feature) & !NEVER;
        let names = detect::NAMES.iter().filter(|&&it| bits(&[it]) & gone != 0);
        if self.needs & NEVER != 0 {
            self
        } else {
            Target::from_bits(names.fold(self.needs & !gone, |have, it| have & !bit(it)))
        }
    }

    /// With a feature that is named as in `#[target_feature]`, or a word such as `fast_gather`. It is for [`set_cpu`], which refuses a feature that the CPU lacks, and a name that doesn't exist.
    ///
    /// ```
    /// # use bun_simd::target::*;
    /// // From Skylake to Ice Lake, gathers are fast unless the microcode against Downfall is on. The CPU doesn't tell.
    /// // Nor does Linux in most virtual machines. There, a program can time a kernel with the word and without.
    /// let known = std::fs::read_to_string("/sys/devices/system/cpu/vulnerabilities/gather_data_sampling");
    /// if known.is_ok_and(|it| it.starts_with("Vulnerable")) {
    ///     set_cpu(cpu().with("fast_gather"));
    /// }
    /// ```
    pub fn with(self, feature: &str) -> Target {
        Target { needs: self.needs | bits(&[feature]), ..self }
    }

    pub(crate) fn words(self) -> (&'static str, impl Iterator<Item = &'static str>) {
        let more = self.needs & !NEEDS[self.named as usize];
        (self.named.text(), detect::NAMES.iter().chain(tuning::NAMES).copied().filter(move |it| more & bit(it) != 0))
    }

    /// The bits to look for in `HAVE`.
    const fn test(self) -> u64 {
        let mut i = LEVELS.len();
        while i > 0 {
            i -= 1;
            let level = NEEDS[LEVELS[i] as usize] & !WIDE;
            if level & !self.needs == 0 && level & !BASELINE != 0 {
                return self.needs & !level & !BASELINE | 1 << (LEVEL + i as u32);
            }
        }
        self.needs & !BASELINE
    }
}

/// The levels with the most common words. The best of these that a CPU has includes all others that it has.
const CLASSES: [Named; 11] = {
    use Named::*;
    cfg_select! {
        any(target_arch = "x86", target_arch = "x86_64") => [
            Portable, sse4, sse4_aes, avx2, avx2_aes, avx512_narrow, avx512, avx512_aes_narrow, avx512_aes,
            icelake_narrow, icelake,
        ],
        _ => [Portable, neon, neon_crc, neon_aes, neon_aes_crc, neon82, neon82_aes, neon86, neon86_aes, sve2, sve2_aes],
    }
};

// What the functions below take as given.
#[allow(long_running_const_eval)]
const _: () = {
    assert!(NEEDS[CLASSES[0] as usize] == 0 && Target::Portable.needs == 0);
    let mut i = 0;
    while i < Named::NATIVE.len() {
        let (named, level, mut at) = (Named::NATIVE[i], Named::NATIVE[i].level(), 0);
        let (all, first) = (named.features(), level.features());
        assert!(level.is_native() && level as u8 <= named as u8);
        while at < first.len() && level as u8 != named as u8 {
            assert!(detect::same_text(all[at], first[at]));
            at += 1;
        }
        i += 1;
    }
};

// Both start as zero, so that the first write doesn't have to copy a page of the file.
/// 1 more than an index in `CLASSES`.
static CLASS: AtomicU8 = AtomicU8::new(0);
cfg_select! {
    target_has_atomic = "64" => {
        static HAVE: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);
    }
    _ => {
        /// Nothing is detected on these.
        struct Have;
        static HAVE: Have = Have;
        impl Have {
            fn load(&self, _: core::sync::atomic::Ordering) -> u64 {
                BASELINE | KNOWN
            }
            fn store(&self, _: u64, _: core::sync::atomic::Ordering) {}
            fn compare_exchange(
                &self,
                _: u64,
                _: u64,
                _: core::sync::atomic::Ordering,
                _: core::sync::atomic::Ordering,
            ) -> core::result::Result<u64, u64> {
                Err(BASELINE | KNOWN)
            }
        }
    }
}

fn with_levels(have: u64) -> u64 {
    let have = have | BASELINE;
    have | KNOWN
        | LEVELS.iter().rfold(0, |bits, &it| bits << 1 | (NEEDS[it as usize] & !WIDE & !have == 0) as u64) << LEVEL
}

fn class(have: u64) -> u8 {
    Named::best(&CLASSES, have) as u8 + 1
}

/// A value of `HAVE` that is not 0, and its class.
#[cold]
#[inline(never)]
fn detect() -> (u64, u8) {
    let mut have = HAVE.load(Relaxed);
    if have == 0 {
        let features = detect::all() << FEATURES & USABLE;
        // What a feature implies can be hidden.
        let features = features & CLOSURES.iter().filter(|&it| it & !features == 0).fold(0, |all, it| all | it);
        let hints = (if tuning::wide(features & bit("sve2") != 0) { WIDE } else { 0 }
            | tuning::detect(|name| features & bit(name) != 0) << TUNING)
            & HINTS;
        let new = with_levels(features | hints);
        have = HAVE.compare_exchange(0, new, Acquire, Relaxed).err().unwrap_or(new);
        // Where this is missing, there is no target to choose.
        #[cfg(target_has_atomic = "8")]
        let _ = CLASS.compare_exchange(0, class(new), Relaxed, Relaxed);
    }
    (have, class(have))
}

/// Whether the CPU is known to have a word of `tuning.rs`. For a choice between forms of an operation that have the same result.
#[inline(always)]
pub(crate) fn is_tuned<const BIT: u32>() -> bool {
    HAVE.load(Relaxed) as u32 & 1 << (TUNING + BIT) != 0
}

/// Whether the CPU has all of `target`, if that is known yet: a kernel with one target is entered without asking. See `asked.rs`.
#[inline(always)]
pub(crate) fn is_here(target: Target) -> Option<bool> {
    let have = HAVE.load(Relaxed);
    if target.needs & !have == 0 {
        Some(true)
    } else if have == 0 {
        None
    } else {
        Some(false)
    }
}

/// All that this CPU has, unless [`set_cpu`] chose less. A feature counts with all that it implies. After the first call it takes a few loads.
#[inline]
pub fn cpu() -> Target {
    let epoch = EPOCH.load(Acquire);
    let have = HAVE.load(Relaxed);
    let have = (if have == 0 { detect().0 } else { have }) & !(KNOWN | 15 << LEVEL);
    let seen = (SEEN.load(Relaxed) ^ epoch << 8) as usize;
    let named = Named::NATIVE[if 0 < seen && seen <= Named::NATIVE.len() { seen - 1 } else { see(epoch, have) }];
    Target { named, needs: have & !WIDE | NEEDS[named as usize] }
}

/// The lowest 12 bits are 0, or 1 more than the index that `from_bits` finds. The others are from `EPOCH`.
static SEEN: AtomicU32 = AtomicU32::new(0);

#[cold]
fn see(epoch: u32, have: u64) -> usize {
    let best = Named::best(Named::NATIVE, have);
    SEEN.store(epoch << 8 | (best as u32).wrapping_add(1), Relaxed);
    best
}

/// Makes kernels treat this CPU as if it had only `target`. Returns false, and does nothing, if it lacks that.
/// With `narrow`, they take no version whose native width is 64 bytes. Words such as `fast_gather` count only if `target` has them, so
/// `target!(icelake)` stands for an Ice Lake, whose gathers are single loads, also on a later CPU. Not all CPUs take all words.
/// For what the whole program is compiled for, such as [`Target::Portable`], it doesn't ask the CPU.
/// Of calls at the same time, each can hold for some kernels, until the next call.
///
/// ```
/// # use bun_simd::target::*;
/// for &target in Target::ALL {
///     if set_cpu(target) {
///         // Call the kernels.
///     }
/// }
/// reset_cpu();
/// ```
pub fn set_cpu(target: Target) -> bool {
    let have = with_levels(target.needs & !(tuning::dropped(target.needs >> TUNING) << TUNING));
    (target.is_baseline() || target.is_supported()).then(|| store(have, class(have))).is_some()
}

/// Undoes [`set_cpu`].
pub fn reset_cpu() {
    store(0, 0)
}

/// What is kept for an epoch comes from a `HAVE` that is no older, and who replaces a zero there does so in `CLASS`.
fn store(have: u64, class: u8) {
    CLASS.store(class, Relaxed);
    HAVE.store(have, Release);
    // Without these, `HAVE` is a constant.
    #[cfg(target_has_atomic = "64")]
    EPOCH.fetch_add(16, Release);
}

/// None of the three ways leads here again.
#[inline(always)]
fn first_call<K: Entries<A>, A: Args>(args: A) -> K::Output {
    let epoch = EPOCH.load(Acquire);
    let (have, class) = detect();
    if const { Table::<K, A>::ONLY_LEVELS } {
        return enter(Table::<K, A>::BY_CLASS[(class & 15) as usize], args);
    }
    if const { Table::<K, A>::LAST + 1 < TABLE }
        && let Some(choice) = K::choice()
    {
        let index = first_in(&const { K::LIST.targets }, have) + 1;
        choice.store(epoch | index as u32, Relaxed);
        return enter(Table::<K, A>::BY_CHOICE[index & 15], args);
    }
    enter(by_bits::<K, A>(have), args)
}

/// The targets that a kernel is compiled for. The first that the CPU has wins. Those of other architectures are ignored.
#[derive(Copy, Clone)]
pub struct Targets(pub &'static [Target]);

impl Targets {
    const fn get(self, i: usize) -> Option<Target> {
        if i < self.0.len() { Some(self.0[i]) } else { None }
    }

    #[doc(hidden)]
    pub const fn checked(self) -> Targets {
        let mut i = 0;
        while let Some(later) = self.get(i) {
            // The default can repeat one, and what it has depends on the flags.
            let (mut k, mut never, mut usual) = (0, false, later.is_baseline() && later.is(Self::DEFAULT.0[0]));
            while k < i {
                let first = self.0[k];
                (never, usual) = (never || later.includes(first), (usual || later.is(first)) && first.needs != 0);
                k += 1;
            }
            assert!(!never || usual, "a target is never chosen, as one before it needs less: the best comes first");
            i += 1;
        }
        self
    }

    /// The first of these that needs no more than `cpu` and the baseline have, or else [`Target::Portable`].
    pub const fn choose(self, cpu: Target) -> Target {
        let mut i = 0;
        while let Some(target) = self.get(i) {
            if target.needs & !(cpu.needs & !NEVER | BASELINE) == 0 {
                return target;
            }
            i += 1;
        }
        Target::Portable
    }
}

const MOST: usize = 16;
/// LLVM turns a call through a table of up to 10 small functions into a `match` at each caller.
const TABLE: usize = 16;

/// Entry `i` needs nothing that target `i` lacks. After `len`, there is the one for `Portable`.
struct List<A: Args, R> {
    len: usize,
    targets: [Target; MOST + 1],
    entries: [Entry<A, R>; MOST + 1],
}

impl<A: Args, R> List<A, R> {
    const fn new(portable: Entry<A, R>) -> Self {
        List { len: 0, targets: [Target::Portable; MOST + 1], entries: [portable; MOST + 1] }
    }

    const fn push(&mut self, target: Target, entry: Entry<A, R>) {
        if target.needs & NEVER == 0 {
            assert!(self.len < MOST, "a kernel has up to 16 targets on each architecture");
            (self.targets[self.len], self.entries[self.len]) = (target, entry);
            self.len += 1;
        }
    }
}

const fn first_in(targets: &[Target; MOST + 1], have: u64) -> usize {
    let mut i = 0;
    while targets[i].needs & !(have | BASELINE) != 0 {
        i += 1;
    }
    i
}

trait Entries<A: Args> {
    type Output;
    const LIST: List<A, Self::Output>;
    /// No entry can be inlined.
    const APART: bool = false;
    /// It is only shared with kernels that have the same targets.
    #[inline(always)]
    fn choice() -> Option<&'static AtomicU32> {
        None
    }
}

/// The targets of a kernel, and a place to keep which one was chosen.
#[doc(hidden)]
pub trait Listed: Sized + 'static {
    const TARGETS: Targets;
    fn choice() -> &'static Choice<Self>;
}

/// The lowest four bits are 0, or 1 more than the index of a target of `L` that the CPU has. The others are from `EPOCH`.
/// It is invariant in `L`.
#[doc(hidden)]
pub struct Choice<L>(AtomicU32, PhantomData<fn(L) -> L>);

impl<L> Choice<L> {
    #[allow(clippy::new_without_default)]
    pub const fn new() -> Self {
        Choice(AtomicU32::new(0), PhantomData)
    }
}

/// A multiple of 16 that changes with `HAVE`.
static EPOCH: AtomicU32 = AtomicU32::new(0);

struct Generic<K>(K);
struct Tested<K>(K);
struct First<K>(K);
struct Last<K>(K);
struct Table<K, A>(K, A);

const fn generic<K: Kernel<A>, A: Args>(targets: Targets) -> List<A, K::Output> {
    let (mut list, mut i) = (List::new(Named::Portable.generic::<K, A, ()>()), 0);
    while let Some(target) = targets.get(i) {
        let more = target.needs & !NEEDS[target.named as usize] & !HINTS;
        assert!(more == 0 || more & NEVER != 0, "a feature in quotes needs #[kernel]");
        list.push(target, target.named.generic::<K, A, ()>());
        i += 1;
    }
    list
}

/// What a list adds to a token: features in quotes, and words for tuning. Not nameable outside of this crate.
pub trait More: Copy + Send + Sync + 'static {
    const NEEDS: u64;
}
impl More for () {
    const NEEDS: u64 = 0;
}
/// All of target `I` among those of this architecture. Only entry `I` names it.
struct Nth<L, const I: usize>(PhantomData<fn(L) -> L>);
impl<L, const I: usize> Copy for Nth<L, I> {}
impl<L, const I: usize> Clone for Nth<L, I> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<L: Listed, const I: usize> More for Nth<L, I> {
    const NEEDS: u64 = {
        let (mut i, mut left) = (0, I);
        while L::TARGETS.0[i].needs & NEVER != 0 || left > 0 {
            left -= (L::TARGETS.0[i].needs & NEVER == 0) as usize;
            i += 1;
        }
        L::TARGETS.0[i].needs
    };
}
impl Target {
    pub(crate) const fn and<M: More>(self) -> Target {
        Target { needs: self.needs | M::NEEDS, ..self }
    }
}

const fn listed<K: Kernel<A>, A: Args, L: Listed>() -> List<A, K::Output> {
    let (mut list, mut i) = (List::new(Named::Portable.generic::<K, A, ()>()), 0);
    while let Some(target) = L::TARGETS.get(i) {
        macro_rules! nth { ($($i:literal)*) => { match list.len {
            $($i if target.needs != NEEDS[target.named as usize] => target.named.generic::<K, A, Nth<L, $i>>(),)*
            _ => target.named.generic::<K, A, ()>(),
        } }; }
        list.push(target, nth!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15));
        i += 1;
    }
    list
}

impl<K: Kernel<A>, A: Args> Entries<A> for Generic<K> {
    type Output = K::Output;
    const LIST: List<A, K::Output> = generic::<K, A>(K::TARGETS);
}

impl<K: Kernel<A>, A: Args> Entries<A> for Tested<K> {
    type Output = K::Output;
    const LIST: List<A, K::Output> = generic::<K, A>(Targets::ALL);
}

impl<K: Entries<A>, A: Args> Kernel<A> for First<K> {
    type Output = K::Output;
    #[inline(always)]
    fn run<S: Isa>(_: S, args: A) -> K::Output {
        first_call::<K, A>(args)
    }
}

impl<K: Entries<A>, A: Args> Kernel<A> for Last<K> {
    type Output = K::Output;
    #[inline(always)]
    fn run<S: Isa>(_: S, args: A) -> K::Output {
        baseline::<K, A>(args)
    }
}

impl<K: Entries<A>, A: Args> Table<K, A> {
    const FIRST: Entry<A, K::Output> = A::Plain::<First<K>>::IT;
    /// The first that needs no detection. Those after it are never chosen.
    const LAST: usize = first_in(&K::LIST.targets, 0);
    /// Whether the class of the CPU is enough to choose.
    const ONLY_LEVELS: bool = {
        let (mut i, mut only) = (0, true);
        while i < Self::LAST {
            let needs = K::LIST.targets[i].needs;
            only &= needs & !BASELINE & !NEEDS[CLASSES[Named::best(&CLASSES, needs | BASELINE)] as usize] == 0;
            i += 1;
        }
        only
    };
    const BY_CHOICE: [Entry<A, K::Output>; TABLE] = {
        let (mut table, mut i) = ([Self::FIRST; TABLE], 0);
        while i <= Self::LAST && i + 1 < TABLE {
            table[i + 1] = Self::outlined(i);
            i += 1;
        }
        table
    };
    const BY_CLASS: [Entry<A, K::Output>; TABLE] = {
        let (mut table, mut i) = ([Self::FIRST; TABLE], 0);
        while i < CLASSES.len() {
            table[i + 1] = Self::outlined(first_in(&K::LIST.targets, NEEDS[CLASSES[i] as usize] & !NEVER));
            i += 1;
        }
        table
    };

    const fn outlined(i: usize) -> Entry<A, K::Output> {
        if i < Self::LAST {
            K::LIST.entries[i]
        } else if K::APART {
            K::LIST.entries[Self::LAST]
        } else {
            A::Plain::<Last<K>>::IT
        }
    }
}

#[inline(always)]
fn best<K: Entries<A>, A: Args>(args: A) -> K::Output {
    if const { Table::<K, A>::LAST == 0 } {
        return baseline::<K, A>(args);
    }
    if const { Table::<K, A>::ONLY_LEVELS } {
        return enter(Table::<K, A>::BY_CLASS[(CLASS.load(Relaxed) & 15) as usize], args);
    }
    if const { Table::<K, A>::LAST + 1 < TABLE }
        && let Some(choice) = K::choice()
    {
        let index = (choice.load(Relaxed) ^ EPOCH.load(Relaxed)) as usize;
        return enter(Table::<K, A>::BY_CHOICE[if index < TABLE { index } else { 0 }], args);
    }
    enter(by_bits::<K, A>(HAVE.load(Relaxed)), args)
}

#[inline(always)]
fn by_bits<K: Entries<A>, A: Args>(have: u64) -> Entry<A, K::Output> {
    let missing = !have;
    let mut entry: Entry<A, K::Output> = if missing & KNOWN != 0 {
        Table::<K, A>::FIRST
    } else {
        const { Table::<K, A>::outlined(Table::<K, A>::LAST) }
    };
    macro_rules! last_to_first { ($($i:literal)*) => {$(
        if const { $i < Table::<K, A>::LAST } && missing & const { K::LIST.targets[$i].test() } == 0 {
            entry = const { Table::<K, A>::outlined($i) };
        }
    )*}; }
    last_to_first!(15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0);
    entry
}

#[inline(always)]
fn baseline<K: Entries<A>, A: Args>(args: A) -> K::Output {
    enter(const { K::LIST.entries[Table::<K, A>::LAST] }, args)
}

fn exactly<K: Entries<A>, A: Args>(target: Target) -> Option<Entry<A, K::Output>> {
    let list = &const { K::LIST };
    // Words such as `fast_gather` count from then on.
    if HAVE.load(Relaxed) == 0 {
        detect();
    }
    list.targets.iter().position(|it| *it == target).filter(|_| target.is_supported()).map(|i| list.entries[i])
}

/// What a kernel is for dispatch. `#[kernel]` implements this.
#[doc(hidden)]
pub trait Native<A> {
    /// It only tells the result, with the lifetimes of the arguments.
    type Signature: Returns<A>;
    type List: Listed;
    /// It has `#[inline(never)]`, as the entries have that need detection.
    const APART: bool = false;
    /// It is never called. It makes the crate of the kernel compile the entries, and other crates use these, as they are `#[inline(never)]`.
    fn best(args: A) -> Result<Self, A>;
    fn on<S: Isa>(args: A) -> Result<Self, A>
    where
        crate::Code: crate::At<S>;
}
type Result<K, A> = <<K as Native<A>>::Signature as Returns<A>>::It;
#[doc(hidden)]
pub trait Returns<A> {
    type It;
}
macro_rules! returns { ($(($run:ident $apart:ident $plain:ident [$($a:ident $A:ident)*]))*) => {$(
    impl<F: FnOnce($($A),*) -> R, R, $($A),*> Returns<($($A,)*)> for F {
        type It = R;
    }
)*}; }
arities!(returns);
struct Natives<K>(K);
impl<K: Native<A>, A: Args> Kernel<A> for Natives<K> {
    type Output = Result<K, A>;
    const TARGETS: Targets = K::List::TARGETS;
    const APART: bool = K::APART;
    #[inline(always)]
    fn run<S: Isa>(_: S, args: A) -> Self::Output {
        K::on::<S>(args)
    }
}
impl<K: Native<A>, A: Args> Entries<A> for Natives<K> {
    type Output = Result<K, A>;
    const LIST: List<A, Self::Output> = listed::<Self, A, K::List>();
    const APART: bool = K::APART;
    #[inline(always)]
    fn choice() -> Option<&'static AtomicU32> {
        Some(&K::List::choice().0)
    }
}
#[doc(hidden)]
pub struct Usual;
crate::list_of_targets!(Usual Targets::DEFAULT);

/// What the name S stands for: a target, or [Outside].
#[doc(hidden)]
pub trait Caller {
    /// If it is known without a look at the caller.
    const INSIDE: bool;
    type Token: Isa;
}
/// Code without the attributes, into which a macro of a marked module can write a closure.
pub enum Outside {}
impl Caller for Outside {
    const INSIDE: bool = true;
    type Token = tokens::Portable;
}
impl<S: Isa> Caller for S {
    const INSIDE: bool = S::COMPILED_FOR && cfg!(bun_simd_unoptimized);
    type Token = S;
}
/// Whether the function that this is inlined into has the features. Then LLVM inlines `place` too, and sees two variables. Otherwise it sees
/// the same call twice. Only speed depends on the answer.
#[inline(always)]
fn inside<S: Isa>() -> bool {
    enter::<(), *const u8>(S::place, ()) != enter::<(), *const u8>(S::place, ())
}
/// How the bodies of functions and closures get the features of the target.
#[doc(hidden)]
pub struct Entering<S, const DEBUG: bool = false, const CLOSURE: bool = false>(S);
struct Call;
/// The same, inlined whatever its size where the caller has the features. The inliner takes what is behind the reference for unknown, and
/// counts the short branch only. After that, the number is known. Where it stays a call, it calls itself. Only speed depends on the branch.
struct Inlined;
struct Late<'a, A: Later + 'a, R: 'a> {
    number: u32,
    again: Entry<A::With<'a, R>, R>,
    /// Always `None`.
    next: Option<&'a Self>,
}
/// A copy that only its call mentions. LLVM doesn't unroll a loop around such a call, so a function of `core` stays short, and is inlined.
struct Once;
impl<A: Args> Kernel<A> for Once
where
    Inlined: Kernel<A>,
{
    type Output = <Inlined as Kernel<A>>::Output;
    #[inline(always)]
    fn run<S: Isa>(_: S, args: A) -> Self::Output {
        enter(A::Run::<S, Inlined>::IT, args)
    }
}
trait Later {
    type With<'a, R: 'a>: Args
    where
        Self: 'a;
}
macro_rules! entering { ($(($inlined:ident $inside:ident $apart:ident $cold:ident [$($a:ident $A:ident)*]))*) => {$(
    impl<F: FnOnce($($A),*) -> R, R, $($A),*> Kernel<(F, $($A,)*)> for Call {
        type Output = R;
        #[inline(always)]
        fn run<S: Isa>(_: S, (body, $($a,)*): (F, $($A,)*)) -> R {
            body($($a),*)
        }
    }
    impl<F, $($A),*> Later for (F, $($A,)*) {
        type With<'a, R: 'a> = (Option<&'a Late<'a, Self, R>>, F, $($A,)*) where Self: 'a;
    }
    impl<'a, F: FnOnce($($A),*) -> R, R, $($A),*> Kernel<(Option<&'a Late<'a, (F, $($A,)*), R>>, F, $($A,)*)> for Inlined {
        type Output = R;
        #[inline(always)]
        fn run<S: Isa>(_: S, (late, body, $($a,)*): (Option<&'a Late<'a, (F, $($A,)*), R>>, F, $($A,)*)) -> R {
            match late {
                Some(it) if !crate::hints::is_folded::<true>(it.number) => enter(it.again, (it.next, body, $($a,)*)),
                _ => body($($a),*),
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    impl<S: Caller, const COPIED: bool, const CLOSURE: bool> Entering<S, COPIED, CLOSURE> {
        /// By itself, LLVM loads several fields of a struct at once, which then stays in memory. A copy takes longer to compile.
        /// On the baseline, a closure needs nothing. On Apple, LLVM calls `memset_pattern16` for `[k; 4]` if it first sees a constant `k`.
        #[op]
        pub fn $inlined<F: FnOnce($($A),*) -> R, R, $($A),*>($($a: $A,)* body: F) -> R {
            if const { S::INSIDE || (COPIED || CLOSURE && !cfg!(target_vendor = "apple")) && S::Token::COMPILED_FOR } {
                return body($($a),*);
            }
            if const { COPIED && crate::OPTIMIZED } && inside::<S::Token>() {
                return body($($a),*);
            }
            #[cfg(all(bun_simd_unoptimized, not(miri)))]
            return enter(Run::<S::Token, Call, _>::IT, (body, $($a,)*));
            #[cfg(not(all(bun_simd_unoptimized, not(miri))))]
            {
                // The inliner counts less for a constant than for three stores.
                let late = const { Late::<(F, $($A,)*), R> { number: crate::hints::SIGNALING, again: Run::<S::Token, Inlined, _>::IT, next: None } };
                let entry = const { if CLOSURE { Run::<S::Token, Once, _>::IT } else { Run::<S::Token, Inlined, _>::IT } };
                enter(entry, (Some(&late), body, $($a,)*))
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    impl<S: Caller, const DEBUG: bool> Entering<S, DEBUG> {
        /// For what only code with the features calls, by a constant pointer. Without optimization, that stays a call.
        #[inline(always)]
        pub fn $inside<R, $($A),*>($($a: $A,)* body: impl FnOnce($($A),*) -> R) -> R {
            if const { DEBUG || cfg!(bun_simd_unoptimized) } { Entering::<S>::$inlined($($a,)* body) } else { body($($a),*) }
        }
    }
    #[allow(clippy::too_many_arguments)]
    impl<S: Isa> Entering<S> {
        #[inline(always)]
        pub fn $apart<R, $($A),*>($($a: $A,)* body: impl FnOnce($($A),*) -> R) -> R {
            S::here().enter::<Call, _>((body, $($a,)*))
        }
        // What LLVM inlines tells the branch in the caller nothing.
        #[cold]
        #[inline(never)]
        pub fn $cold<R, $($A),*>($($a: $A,)* body: impl FnOnce($($A),*) -> R) -> R {
            Self::$apart($($a,)* body)
        }
    }
)*}; }
entering! {
    (inlined0 inside0 apart0 cold0 [])
    (inlined1 inside1 apart1 cold1 [a A0])
    (inlined2 inside2 apart2 cold2 [a A0 b A1])
    (inlined3 inside3 apart3 cold3 [a A0 b A1 c A2])
    (inlined4 inside4 apart4 cold4 [a A0 b A1 c A2 d A3])
    (inlined5 inside5 apart5 cold5 [a A0 b A1 c A2 d A3 e A4])
    (inlined6 inside6 apart6 cold6 [a A0 b A1 c A2 d A3 e A4 f A5])
    (inlined7 inside7 apart7 cold7 [a A0 b A1 c A2 d A3 e A4 f A5 g A6])
    (inlined8 inside8 apart8 cold8 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7])
    (inlined9 inside9 apart9 cold9 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8])
    (inlined10 inside10 apart10 cold10 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9])
    (inlined11 inside11 apart11 cold11 [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9 k A10])
}
#[doc(hidden)]
#[inline(always)]
#[allow(private_bounds)]
pub fn call_best<K: Native<A>, A: Args>(args: A) -> Result<K, A> {
    best::<Natives<K>, A>(args)
}
/// For `Native::best`.
#[doc(hidden)]
#[inline(always)]
#[allow(private_bounds)]
pub fn call_by_table<K: Native<A>, A: Args>(args: A) -> Result<K, A> {
    (const {
        if Table::<Natives<K>, A>::LAST == 0 && !K::APART {
            (|_| unreachable!()) as fn(A) -> Result<K, A>
        } else {
            best::<Natives<K>, A>
        }
    })(args)
}
#[doc(hidden)]
#[inline(always)]
#[allow(private_bounds)]
pub fn call_here<S: Isa, K: Native<A>, A: Args, const INLINED: bool>(args: A) -> Result<K, A> {
    (const {
        let (mut i, mut listed) = (0, matches!(S::TARGET, Target::Portable));
        while let Some(it) = K::List::TARGETS.get(i) {
            listed |= it.named as u8 == S::TARGET.named as u8 && S::LISTED.includes(it);
            i += 1;
        }
        if listed && INLINED && S::COMPILED_FOR && !K::APART {
            K::on::<S> as fn(A) -> Result<K, A>
        } else if listed {
            on_token::<S, K, A>
        } else if S::TARGET.is_baseline() {
            baseline::<Natives<K>, A>
        } else {
            call_best::<K, A>
        }
    })(args)
}
#[inline(always)]
fn on_token<S: Isa, K: Native<A>, A: Args>(args: A) -> Result<K, A> {
    if const { K::APART } {
        return enter(A::Apart::<S, Natives<K>>::IT, args);
    }
    enter(A::Run::<S, Natives<K>>::IT, args)
}
/// On a target of its list, if the CPU has it.
#[doc(hidden)]
#[allow(private_bounds)]
pub fn call_to<K: Native<A>, A: Args>(target: Target, args: A) -> Option<Result<K, A>> {
    exactly::<Natives<K>, A>(target).map(|entry| enter(entry, args))
}

/// Runs the kernel on the first of [`Kernel::TARGETS`] that this CPU has.
#[inline(always)]
#[allow(private_bounds)]
pub fn dispatch<K: Kernel<A>, A: Args>(args: A) -> K::Output {
    best::<Generic<K>, A>(args)
}

/// Runs the kernel on the first of [`Kernel::TARGETS`] that the whole program is compiled for. The call can be inlined.
#[inline(always)]
#[allow(private_bounds)]
pub fn dispatch_static<K: Kernel<A>, A: Args>(args: A) -> K::Output {
    baseline::<Generic<K>, A>(args)
}

/// Runs the kernel on `target` if this CPU has it, and it is one of [`Kernel::TARGETS`] or [`Target::ALL`].
/// This compiles the kernel for all of them: it is for tests.
#[allow(private_bounds)]
pub fn dispatch_to<K: Kernel<A>, A: Args>(target: Target, args: A) -> Option<K::Output> {
    exactly::<Tested<K>, A>(target).or_else(|| exactly::<Generic<K>, A>(target)).map(|entry| enter(entry, args))
}

#[cfg(test)]
#[path = "tests/unit/gate.rs"]
mod unit;
