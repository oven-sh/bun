//! The words that name targets. Nothing here is trusted.
//!
//! `resolve!` turns each entry of a list into `{module token [cfg] [features] [words] [more features] [tuning]}`.

use crate::{Named, Target};

macro_rules! about_targets {
    ($steps:tt $(($name:ident [$arch:meta] [$($word:ident)*] [$($feature:tt)*]))*) => {
        crate::words::with_vocabulary! { $steps $(($name [$arch] [$($word)*] [$($feature)*]))* }

        /// What the prelude takes.
        #[doc(hidden)]
        #[allow(non_snake_case)]
        pub mod on {
            pub use crate::native::names as Portable;
        }
    };
}

#[rules]
macro_rules! vocabulary {
    (
        [$(($from:ident $by:ident $into:ident))*] [$(($name:ident [$its:meta] [$($its_word:ident)*] [$($its_feature:tt)*]))*]
        levels { $($level:ident)* } words { $($word:ident)* } tuning { $([$tuned:meta] { $($tuning:ident)* })* }
        features { $([$arch:meta] { $($feature:tt)* })* }
    ) => {
        #[doc(hidden)]
        #[macro_export]
        macro_rules! resolve_targets {
            // Only `target!` gets the result.
            (@list {target [@$$many:ident] []} $$done:tt $$pool:tt) => { $$crate::target! { @$$many $$done } };
            $((@list $$then:tt $$done:tt $$pool:tt $level $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add $level [] [] [] $$then $$done $$pool $$($$rest)* }
            };)*
            (@list $$then:tt $$done:tt $$pool:tt default $$(, $$($$rest:tt)*)?) => {
                $$crate::default_targets! { [@list $$then $$done $$pool] $$($$($$rest)*)? }
            };
            (@list $$then:tt $$done:tt $$pool:tt Upto<$$width:ident> $$(, $$($$rest:tt)*)?) => {
                $$crate::default_targets! { $$width [@list $$then $$done $$pool] $$($$($$rest)*)? }
            };
            (@list $$then:tt $$done:tt $$pool:tt no_downclock $$(, $$($$rest:tt)*)?) => {
                $$crate::resolve_targets! { @list $$then $$done $$pool icelake + fast_zmm, icelake + narrow, Upto<B32>, $$($$($$rest)*)? }
            };
            (@list $$then:tt $$done:tt $$pool:tt portable + $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add Portable [] [] [] $$then $$done $$pool + $$($$rest)* }
            };
            $((@list $$then:tt [$$($$done:tt)*] $$pool:tt = $name, $$($$rest:tt)*) => { $$crate::resolve_targets! {
                @list $$then [$$($$done)* {$name $name [$its] [$($its_feature)*] [$($its_word)*] [] []}] $$pool $$($$rest)*
            } };)*
            // The steps are few, as they count towards the recursion limit of the consumer.
            $((@add $name $$cfg:tt [] [] $$then:tt [$$($$done:tt)*] $$pool:tt $$(, $$($$rest:tt)*)?) => { $$crate::resolve_targets! {
                @list $$then [$$($$done)* {$name $name [$its] [$($its_feature)*] [$($its_word)*] [] []}] $$pool $$($$($$rest)*)?
            } };)*
            (@add Portable [$$($$cfg:tt)*] [$$($$f:tt)*] [$$($$t:tt)*] $$then:tt [$$($$done:tt)*] [$$next:ident $$($$pool:ident)*] $$(, $$($$rest:tt)*)?) => {
                $$crate::resolve_targets! {
                    @list $$then [$$($$done)* {$$next Portable [all($$($$cfg)*)] [$$($$f)*] [portable $$($$t)*] [$$($$f)*] [$$($$t)*]}]
                    [$$($$pool)*] $$($$($$rest)*)?
                }
            };
            $((@add $name $$cfg:tt [$$($$f:tt)*] [$$($$t:tt)*] $$then:tt [$$($$done:tt)*] [$$next:ident $$($$pool:ident)*] $$(, $$($$rest:tt)*)?) => {
                $$crate::resolve_targets! {
                    @list $$then [$$($$done)* {$$next $name [$its] [$($its_feature)* $$($$f)*] [$($its_word)* $$($$t)*] [$$($$f)*] [$$($$t)*]}]
                    [$$($$pool)*] $$($$($$rest)*)?
                }
            };)*
            $((@add $from $$cfg:tt $$f:tt $$t:tt $$then:tt $$done:tt $$pool:tt + $by $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add $into $$cfg $$f $$t $$then $$done $$pool $$($$rest)* }
            };)*
            $($((@add $$name:ident [$$($$cfg:tt)*] $$f:tt [$$($$t:tt)*] $$then:tt $$done:tt $$pool:tt + $tuning $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add $$name [$$($$cfg)* $tuned,] $$f [$$($$t)* $tuning] $$then $$done $$pool $$($$rest)* }
            };)*)*
            (@add $$name:ident $$cfg:tt $$f:tt $$t:tt $$then:tt $$done:tt $$pool:tt + $$word:ident $$($$rest:tt)*) => {{
                $$crate::known_words! { $$word }
                $$crate::__core::compile_error! { $$crate::__core::concat!("this level can't have `", $$crate::__core::stringify!($$word), "`. A feature in quotes works with all levels") }
            }};
            $($((@add $$name:ident [$$($$cfg:tt)*] [$$($$f:tt)*] $$t:tt $$then:tt $$done:tt $$pool:tt + $feature $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add $$name [$$($$cfg)* $arch,] [$$($$f)* $feature] $$t $$then $$done $$pool $$($$rest)* }
            };)*)*
            (@add $$name:ident $$cfg:tt $$f:tt $$t:tt $$then:tt $$done:tt $$pool:tt + $$other:tt $$($$rest:tt)*) => { $$crate::known_words! { $$other } };
            (@add $$name:ident $$cfg:tt $$f:tt $$t:tt $$then:tt $$done:tt [] $$(, $$($$rest:tt)*)?) => {
                $$crate::__core::compile_error! { "a list has up to 12 targets with a feature in quotes or a word for tuning" }
            };
            (@add $$($$rest:tt)*) => { $$crate::__core::compile_error! { "a target is a level plus features, as in `avx2 + sha + \"adx\"`" } };
            (@list $$then:tt $$done:tt $$pool:tt portable $$(,)?) => { $$crate::resolve_targets! { @list $$then $$done $$pool } };
            (@list $$then:tt $$done:tt $$pool:tt portable $$($$rest:tt)*) => { $$crate::__core::compile_error! { "`portable` ends each list" } };
            (@list $$then:tt $$done:tt $$pool:tt $$other:ident $$($$rest:tt)*) => {
                $$crate::__core::compile_error! { $$crate::__core::concat!("`", $$crate::__core::stringify!($$other), "` is not a level:" $(, " ", $$crate::__core::stringify!($level))*, " portable") }
            };
            (@list $$then:tt $$done:tt $$pool:tt $$feature:tt $$($$rest:tt)*) => {
                $$crate::resolve_targets! { @add Portable [] [] [] $$then $$done $$pool + $$feature $$($$rest)* }
            };
            ($$then:tt $$($$list:tt)*) => { $$crate::resolve_targets! {
                @list $$then [] [custom0 custom1 custom2 custom3 custom4 custom5 custom6 custom7 custom8 custom9 custom10 custom11] $$($$list)*
            } };
        }

        #[derive(bun_simd_macros::Kept)]
        struct Kept(
            #[it(([portable] [] Portable) {$($level)* portable})] (),
            $(#[cfg($its)] #[it(([$($its_word)*] [$($its_feature)*] $name))] (),)*
            $(#[cfg($tuned)] #[it([$($tuning)*])] (),)* $(#[cfg($arch)] #[it([$($feature)*])] (),)*
            #[cfg(bun_simd_native = "16")] #[it(B16)] (), #[cfg(bun_simd_native = "32")] #[it(B32)] (), #[cfg(bun_simd_native = "64")] #[it(B64)] (),
        );
        use crate::words::of_this_architecture;

        /// Refuses what is not a word.
        #[doc(hidden)]
        #[macro_export]
        macro_rules! known_words {
            (+) => {};
            (|) => {};
            (portable) => {};
            (B16) => {};
            (B32) => {};
            (B64) => {};
            $(($level) => {};)* $(($word) => {};)* $($(($tuning) => {};)*)* $($(($feature) => {};)*)*
            ($$other:tt) => { $$crate::__core::compile_error! { $$crate::__core::concat!("`", $$crate::__core::stringify!($$other), "` is neither a level nor a feature") } };
            ($$($$word:tt)*) => { $$($$crate::known_words! { $$word })* };
        }


        #[allow(missing_docs, non_upper_case_globals)]
        impl Target {
            /// Needs nothing. See [`Portable`](crate::Portable).
            pub const Portable: Target = Target::of(Named::Portable, &[]);
        }
    };
}

macro_rules! with_vocabulary { ($steps:tt $($all:tt)*) => { crate::words::vocabulary! {
    $steps [$($all)*]
    levels { avx2 sse4 sse2 icelake avx512 neon neon82 neon86 sve2 wasm }
    words { aes bf16 bmi crc crc32c dot fcma fhm fma fp16 gfni i8mm ifma masked narrow relaxed sha sha3 sha512 sm4 vaes vnni }
    tuning {
        [any(target_arch = "x86", target_arch = "x86_64")] { fast_gather fast_zmm fast_compress_store full_zmm }
        [target_arch = "aarch64"] { fast_sha3 fast_clmul }
        [any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64")] { fast_pdep }
    }
    features {
        [any(target_arch = "x86", target_arch = "x86_64")] {
        "sse2" "sse3" "pclmulqdq" "ssse3" "cmpxchg16b" "sse4.1" "sse4.2" "movbe" "popcnt" "ermsb" "adx" "sha" "gfni" "bmi1" "bmi2"
        "lzcnt" "avx" "fma" "f16c" "avx2" "vaes" "vpclmulqdq" "sha512" "sm3" "avxvnni" "avxifma" "avxvnniint8"
        "avxneconvert" "avxvnniint16" "avx512f" "avx512dq" "avx512ifma" "avx512cd" "avx512bw" "avx512vl" "avx512vbmi"
        "avx512vbmi2" "avx512vnni" "avx512bitalg" "avx512vpopcntdq" "avx512vp2intersect" "avx512fp16" "avx512bf16"
        }
        [target_arch = "aarch64"] {
        "neon" "crc" "sha2" "dotprod" "i8mm" "sha3" "lse" "fp16" "rdm" "jsconv" "fcma" "rcpc" "fhm" "frintts" "bf16"
        "sve" "sve2" "sve2-aes" "sve2-bitperm" "sve2-sha3" "sve2-sm4"
        }
        [any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64")] { "aes" "sm4" }
        [all(target_arch = "wasm32", target_feature = "simd128")] { "simd128" }
        [all(target_arch = "wasm32", target_feature = "relaxed-simd")] { "relaxed-simd" }
    }
} }; }

macro_rules! all_words {
    ($then:ident) => {
        $then! {
            avx2 sse4 sse2 icelake avx512 neon neon82 neon86 sve2 wasm portable
            aes bf16 bmi crc crc32c dot fcma fhm fma fp16 gfni i8mm ifma masked narrow relaxed sha sha3 sha512 sm4 vaes vnni
        }
    };
}
/// For #[only] and #[except]: (words and features of a token), {levels}, [what a list can add].
macro_rules! of_this_architecture {
    ($done:tt ($d:tt)) => {
        #[doc(hidden)]
        #[macro_export]
        #[cfg(any(miri, not(target_arch = "aarch64")))]
        macro_rules! with_targets { ($d($d items:tt)*) => { $d crate::default_targets! { @twins $done $d($d items)* } }; }
        #[doc(hidden)]
        #[macro_export]
        #[cfg(not(any(miri, not(target_arch = "aarch64"))))]
        macro_rules! with_targets { ($d($d items:tt)*) => { $d crate::default_targets! { @no_fp16 $done $d($d items)* } }; }
    };
}

pub(crate) use {about_targets, all_words, of_this_architecture, vocabulary, with_vocabulary};

const fn native<const N: usize>(all: [Named; N]) -> ([Target; N], usize) {
    let (mut targets, mut n, mut i) = ([Target::Portable; N], 0, 0);
    while i < N {
        targets[n] = Target::of(all[i], &[]);
        n += targets[n].includes(Target::Portable) as usize;
        i += 1;
    }
    (targets, n)
}

impl Target {
    /// Common CPUs of the architecture that the program is compiled for, from [`Portable`](Self::Portable) to the newest. They
    /// reach most code that depends on a word. It is for tests.
    pub const ALL: &[Target] = {
        use Named::*;
        const BOTH: ([Target; 27], usize) = native([
            Portable, sse2, sse4, sse4_aes, sse4_aes_gfni, sse4_aes_sha, sse4_bmi, avx2_aes, avx2_aes_vaes,
            avx2_aes_vaes_gfni_vnni, avx2_sha512, avx512_aes_narrow, avx512_aes, avx512_aes_vnni, icelake,
            icelake_sha_bf16_fp16, neon, neon_aes_sha3_sm4, neon_crc, neon_aes_crc, neon82_aes, neon82_aes_sha3_fcma,
            neon82_aes_sha3_sm4_fcma, neon86_aes_sha3_fcma, sve2_aes_sha3, wasm, wasm_relaxed,
        ]);
        BOTH.0.split_at(BOTH.1).0
    };

    /// From the words of [`target!`](macro@crate::target), for the architecture that the program is compiled for.
    ///
    /// ```
    /// # use bun_simd::{target, target::Target};
    /// # #[cfg(target_arch = "x86_64")]
    /// assert_eq!(Target::parse("avx2 + aes"), Some(target!(avx2 + aes)));
    /// assert_eq!(Target::parse("avx3"), None);
    /// ```
    pub fn parse(text: &str) -> Option<Target> {
        let words = || text.split('+').map(|it| it.trim());
        let own = |it: Target| it.words().0.split(" + ");
        let level = words().next()?;
        let of_level = || {
            Target::combinations().filter(|&it| {
                own(it).next() == Some(level) && (!it.has_word("narrow") || words().any(|it| it == "narrow"))
            })
        };
        // The smallest combination with all words that one of the level has.
        let named = of_level()
            .filter(|it| words().all(|word| it.has_word(word) || !of_level().any(|other| other.has_word(word))))
            .min_by_key(|&it| it.features().len())?;
        let all = words().filter(|it| !named.has_word(it)).fold(named, |all, it| all.with(it.trim_matches('"')));
        all.includes(named).then_some(all)
    }
}

impl crate::Targets {
    /// Those that this CPU has, and then [`Target::Portable`]. It is for tests.
    pub fn supported(self) -> impl Iterator<Item = Target> {
        self.0.iter().copied().filter(|&it| it != Target::Portable && it.is_supported()).chain([Target::Portable])
    }
}

impl core::fmt::Debug for Target {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let (text, mut more) = self.words();
        f.write_str(text)?;
        more.try_for_each(|it| {
            if crate::tuning::NAMES.contains(&it) { write!(f, " + {it}") } else { write!(f, " + \"{it}\"") }
        })
    }
}

/// A [`Target`] from words: `target!(avx2 + sha)`. See [`simd`](macro@crate::simd).
///
/// ```
/// # use bun_simd::target;
/// if target!(avx2 + sha).is_supported() {
///     println!("SHA-NI");
/// }
/// ```
#[macro_export]
macro_rules! target {
    (portable) => { $crate::target::Target::Portable };
    (@one [$one:tt]) => { $crate::target!(@of $one) };
    (@all_of $all:tt) => { $crate::target!(@all $all) };
    (@all [$($one:tt)*]) => { $crate::target::Targets(&[$($crate::target!(@of $one)),*]).checked() };
    (@of {$module:ident $token:ident $cfg:tt $all:tt $words:tt [$($f:tt)*] [$($t:tt)*]}) => {
        const { $crate::target::Target::of($crate::Named::$token, &[$($f,)* $($crate::__core::stringify!($t)),*]) }
    };
    ($($words:tt)+) => { $crate::resolve_targets! { {target [@one] []} $($words)+ } };
}

/// Whether the target has all of the words: `has!(gfni)`, `has!(avx2 + "adx")`, or one of several, `has!(vnni | dot)`. It is a
/// constant. `has!(Baseline: gfni)` names the target. Unsafe code can rely on it in the function that tests it, and not by way of a constant.
///
/// ```
/// use bun_simd::prelude::*;
/// #[simd]
/// fn mul_add(a: f32x4<S>, b: f32x4<S>, c: f32x4<S>) -> f32x4<S> {
///     if has!(fma) { a.mul_add(b, c) } else { a * b + c }
/// }
/// let v = f32x4::<Baseline>::splat(2.0);
/// assert_eq!(mul_add(v, v, v), [6.0; 4]);
/// ```
#[macro_export]
macro_rules! has {
    (@here B16) => { $crate::native::bytes() == 16 };
    (@here B32) => { $crate::native::bytes() == 32 };
    (@here B64) => { $crate::native::bytes() == 64 };
    (@of [$s:ty] B16) => { $crate::native::bytes::<$s>() == 16 };
    (@of [$s:ty] B32) => { $crate::native::bytes::<$s>() == 32 };
    (@of [$s:ty] B64) => { $crate::native::bytes::<$s>() == 64 };
    (@here $word:ident) => { $crate::native::has_word($crate::__core::stringify!($word)) };
    (@here $feature:tt) => { $crate::native::target().has($feature) };
    (@of [$s:ty] $word:ident) => { <$s as $crate::Isa>::WORDS.has_word($crate::__core::stringify!($word)) };
    (@of [$s:ty] $feature:tt) => { <$s as $crate::Isa>::WORDS.has($feature) };
    ($s:ident : $($word:tt $(+ $more:tt)*)|+) => {{ $crate::known_words! { $($word $($more)*)+ } $crate::native::real::<$s>(); const { $(($crate::has!(@of [$s] $word) $(&& $crate::has!(@of [$s] $more))*))||+ } }};
    ($($word:tt $(+ $more:tt)*)|+) => {{ $crate::known_words! { $($word $($more)*)+ } $crate::native::constants_and_const_fns_need_their_own_attribute(); const { $(($crate::has!(@here $word) $(&& $crate::has!(@here $more))*))||+ } }};
}
/// The first expression whose words the target has: `pick! { gfni => a, avx2 + vaes => b, _ => c }`. All have one type. In a function with a mark, each can take its words as known, and call `core::arch`.
#[macro_export]
macro_rules! pick {
    () => { () };
    // At the end of a block, the braces of an arm would be reported as unused.
    (@chosen ($($used:ident,)*) $ours:expr, $value:expr $(,)?) => { match $ours { () => { $(let _ = $used;)* match () { () => $value } } } };
    (@[$($test:expr, $then:block)*] _ => $value:expr $(,)?) => { $(if $test $then else)* { match () { () => $value } } };
    (@[$($test:expr, $then:block)*] $($word:tt $(+ $more:tt)*)|+ => $value:expr, $($rest:tt)+) => { $crate::pick! { @[$($test, $then)* $crate::has!($($word $(+ $more)*)|+), { match () { () => $value } }] $($rest)+ } };
    (@$before:tt $($word:tt $(+ $more:tt)*)|+ => $value:block $($rest:tt)+) => { $crate::pick! { @$before $($word $(+ $more)*)|+ => $value, $($rest)+ } };
    (@$($other:tt)*) => { $crate::__core::compile_error!("`pick!` takes `words => value,` and ends with `_ => value`") };
    ($word:tt $($rest:tt)+) => { $crate::pick! { @[] $word $($rest)+ } };
}
#[doc(hidden)]
#[macro_export]
macro_rules! list_of_targets {
    ($name:ident $targets:expr) => {
        const _: () = {
            const __TARGETS: $crate::target::Targets = $crate::target::Targets($targets.0);
            impl $crate::Listed for $name {
                const TARGETS: $crate::target::Targets = __TARGETS;
                #[inline(always)]
                fn choice() -> &'static $crate::Choice<Self> {
                    static CHOICE: $crate::Choice<$name> = $crate::Choice::new();
                    &CHOICE
                }
            }
        };
    };
}

/// By the names of the tokens, which takes the fewest steps.
#[rules]
macro_rules! defaults { ($($name:ident)*; $($b32:ident)*; $($b16:ident)*) => {
    impl crate::Targets {
        /// What a kernel is compiled for unless it says otherwise.
        pub const DEFAULT: Self = Self(&[$(Target::of(Named::$name, &[])),*]);
    }
    #[doc(hidden)]
    #[macro_export]
    macro_rules! default_targets {
        (@no_fp16 [$$($$table:tt)*] $$($$items:tt)*) => { $$crate::twins! { [$$($$table)* $($name)* no_fp16] $$($$items)* } };
        (@twins [$$($$table:tt)*] $$($$items:tt)*) => { $$crate::twins! { [$$($$table)* $($name)*] $$($$items)* } };
        ([$$($$then:tt)*] $$($$rest:tt)*) => { $$crate::resolve_targets! { $$($$then)* $(= $name,)* $$($$rest)* } };
        (B64 $$($$rest:tt)*) => { $$crate::default_targets! { $$($$rest)* } };
        (B32 [$$($$then:tt)*] $$($$rest:tt)*) => { $$crate::resolve_targets! { $$($$then)* $(= $b32,)* $$($$rest)* } };
        (B16 [$$($$then:tt)*] $$($$rest:tt)*) => { $$crate::resolve_targets! { $$($$then)* $(= $b16,)* $$($$rest)* } };
        ($$other:ident $$($$rest:tt)*) => { $$crate::__core::compile_error! { "registers have the widths B16, B32 and B64" } };
    }
}; }
/// All that the program is compiled for. The last is never chosen, but other modules can import from it.
#[cfg(target_arch = "aarch64")]
#[rules]
macro_rules! on_arm {
    (neon) => { defaults!(icelake avx2_aes sse4 neon wasm_relaxed wasm; avx2_aes sse4 neon wasm_relaxed wasm; sse4 neon wasm_relaxed wasm); };
    ($name:ident) => { defaults!($name neon; $name neon; $name neon); };
    ($name:ident crypto $($rest:tt)*) => { on_arm!($name aes ["aes" "sha2"] sha3 ["aes" "sha2" "sha3"] sm4 ["aes" "sha2" "sha3" "sm4"] $($rest)*); };
    ($name:ident $word:ident [$($feature:tt)*] $($rest:tt)*) => {
        #[cfg(all($(target_feature = $feature),*))]
        on_arm!(${concat($name, _, $word)} $($rest)*);
        #[cfg(not(all($(target_feature = $feature),*)))]
        on_arm!($name $($rest)*);
    };
}
// The last is the highest level that the program is compiled for.
cfg_select! {
    all(target_arch = "aarch64", target_feature = "crc", target_feature = "rdm", target_feature = "dotprod") => {
        cfg_select! {
            not(all(target_feature = "fp16", target_feature = "i8mm", target_feature = "bf16")) => {
                on_arm!(neon82 crypto fcma ["fcma"] fp16 ["fp16"]);
            }
            all(target_feature = "fcma", target_feature = "fhm", target_feature = "sve2", not(target_vendor = "apple")) =>
            {
                on_arm!(sve2 crypto);
            }
            _ => {
                on_arm!(neon86 crypto fcma ["fcma" "fhm"]);
            }
        }
    }
    target_arch = "aarch64" => {
        on_arm!(neon crypto crc ["crc"]);
    }
    all(
        target_feature = "avx2",
        target_feature = "bmi1",
        target_feature = "bmi2",
        target_feature = "fma",
        target_feature = "f16c",
        target_feature = "lzcnt",
        target_feature = "movbe",
        target_feature = "popcnt"
    ) => {
        defaults!(icelake avx2_aes avx2; avx2_aes avx2; sse4);
    }
    _ => {
        defaults!(icelake avx2_aes sse4 neon wasm_relaxed wasm; avx2_aes sse4 neon wasm_relaxed wasm; sse4 neon wasm_relaxed wasm);
    }
}
