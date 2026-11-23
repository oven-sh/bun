//! A model of targets that knows sets of names only.
#![allow(dead_code)]
use bun_simd::target::*;
use std::{collections::BTreeSet, sync::OnceLock};

pub const TUNING: &[&str] = if cfg!(target_arch = "aarch64") {
    &["fast_sha3", "fast_clmul", "fast_pdep"]
} else if X86 {
    &["fast_pdep", "fast_gather", "fast_zmm", "fast_compress_store", "full_zmm"]
} else {
    &[]
};
pub const X86: bool = cfg!(any(target_arch = "x86", target_arch = "x86_64"));
/// On the others, it depends on the flags what can be detected.
pub const PLAIN: bool = cfg!(any(target_arch = "x86_64", target_arch = "aarch64")) && !cfg!(miri);

pub fn names(of: Target) -> BTreeSet<&'static str> {
    let wide = of.has_word("avx512") && !of.has_word("narrow") || of.has_word("sve2");
    cpu_features()
        .map(|it| it.0)
        .chain(TUNING.iter().copied())
        .filter(|it| of.has(it))
        .chain(wide.then_some("wide vectors"))
        .collect()
}
pub fn native(it: Target) -> bool {
    it.includes(Target::Portable)
}
/// What the whole program is compiled for.
pub fn given() -> BTreeSet<&'static str> {
    let wide = cfg!(any(all(target_arch = "x86_64", target_feature = "avx512f"), target_feature = "sve2"));
    static IT: OnceLock<BTreeSet<&str>> = OnceLock::new();
    IT.get_or_init(|| {
        cpu_features()
            .map(|it| it.0)
            .filter(|it| only(it).is_baseline())
            .chain(wide.then_some("wide vectors"))
            .collect()
    })
    .clone()
}
pub fn first(list: &[Target], cpu: Target) -> Target {
    let have = &names(cpu) | &given();
    list.iter().copied().find(|&it| native(it) && names(it).is_subset(&have)).unwrap_or(Target::Portable)
}

pub fn only(feature: &str) -> Target {
    Target::parse(&format!("portable + \"{feature}\"")).unwrap()
}
