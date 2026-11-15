//! The targets, and the step into code that is compiled for one.

macro_rules! targets {
    ($d:tt $($target:ident: $arch:literal, [$($feature:tt),+];)*) => {
        /// Name, architecture, features. The best of an architecture comes first.
        pub const TARGETS: &[(&str, &str, &[&str])] =
            &[$((stringify!($target), $arch, &[$($feature),+])),*];

        $(
            pub mod $target {
                /// The whole program is compiled for it.
                pub const IS_IN_BUILD: bool =
                    cfg!(all(target_arch = $arch, $(target_feature = $feature),+));

                #[cfg(target_arch = $arch)]
                #[inline]
                pub fn is_supported() -> bool {
                    const NEEDS: crate::Features = crate::Features::named(&[$($feature),+]);
                    IS_IN_BUILD || crate::detected().contains(NEEDS)
                }
            }
        )*

        /// `kernel` as a plain `fn` pointer, if the CPU has the target.
        #[macro_export]
        macro_rules! if_supported {
            $(($target, $d F:ty, $d kernel:path) => {{
                $(#[target_feature(enable = $feature)])+
                #[inline]
                fn pick() -> $d F {
                    $d kernel
                }
                // SAFETY: the features that `pick` enables are the ones that were just detected.
                // rustc lets `kernel` become a safe pointer only if it needs no others.
                $d crate::gate::$target::is_supported().then(|| unsafe { pick() })
            }};)*
        }
    };
}

targets! { $
    avx512_icl: "x86_64", [
        "popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx512cd", "avx512dq", "avx512vl",
        "avx512vbmi", "avx512vbmi2", "avx512bitalg", "avx512vpopcntdq", "avx512vnni", "gfni"
    ];
    avx512_skx: "x86_64", [
        "popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx512bw", "avx512cd", "avx512dq",
        "avx512vl"
    ];
    avx2: "x86_64", ["popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx2", "fma", "f16c"];
    sse4: "x86_64", ["popcnt", "sse4.2"];
    neon: "aarch64", ["neon"];
}
