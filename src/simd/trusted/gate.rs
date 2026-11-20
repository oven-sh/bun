/// `kernel` as a plain `fn` pointer of type `F`, if the CPU has the features.
#[macro_export]
macro_rules! if_supported {
    ($(<$($T:ident $(: $Bound:path)?),+>)? [$($feature:literal),+], $F:ty, $kernel:path) => {{
        $(#[target_feature(enable = $feature)])+
        #[inline]
        fn pick$(<$($T $(: $Bound)?),+>)?() -> $F {
            $kernel
        }
        // SAFETY: the features that `pick` enables are the ones that were just detected. rustc lets
        // `kernel` become a safe pointer only if it needs no others.
        $crate::is_supported(const { $crate::Features::named(&[$($feature),+]) })
            .then(|| unsafe { pick$(::<$($T),+>)?() })
    }};
}
