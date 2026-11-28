//! Each way to choose a target, on each CPU that this one can pass for.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![recursion_limit = "512"]
use bun_simd::{kernel, target, target::*};
use std::collections::BTreeSet;
#[path = "framework/names.rs"]
mod names;
use names::*;

macro_rules! lists { ($($name:ident [$($word:tt $(+ $more:tt)*),*])*) => {
    $(#[bun_simd::simd($($word $(+ $more)*),*)]
    mod $name {
        use bun_simd::prelude::*;
        #[kernel]
        pub fn which() -> usize { [$(has!($word $(+ $more)*)),*].iter().fold(0, |n, &it| 2 * n + it as usize) }
        #[kernel]
        pub fn token() -> Target { S::TARGET }
    })*
    const LISTS: &[(&[Target], fn() -> usize, fn() -> Target, fn(Target) -> Option<usize>, fn() -> Target)] =
        &[$((&[$(target!($word $(+ $more)*)),*], $name::which, $name::token, $name::which::to, $name::token::baseline)),*];
}; }
lists! {
    levels [icelake, avx512 + aes, icelake + narrow, avx512, avx512 + aes + narrow, avx512 + narrow, avx2 + aes, avx2, sse4 + aes, sse4, sse2,
        sve2 + aes, sve2, neon86 + aes, neon86, neon82 + aes, neon82, neon + aes + crc, neon + aes, neon + crc, neon]
    upside_down [sse4 + aes, avx512, avx2, neon + aes, sve2, neon82]
    tuned [sse4 + full_zmm, sse4 + fast_compress_store, sse4 + fast_zmm, sse4 + fast_gather, sse4 + fast_pdep, avx2, neon + fast_pdep, neon + fast_clmul, neon + fast_sha3, neon82]
    one_more [avx512 + vnni, avx2 + "adx", sse4, neon82 + fp16, neon + "lse"]
    first_more [avx2 + "adx", avx2, sse4, neon + "lse", neon + crc, neon]
    single [avx2, neon + crc]
    of_both ["aes" + "lse", "aes" + "adx", "aes" + fast_sha3, "aes" + fast_pdep, "aes"]
    nothing_to_choose [sse2, neon]
    second_more [avx512, avx2 + "adx", avx2, neon82, neon + "lse", neon]
    one_token ["bmi2", "aes", "popcnt", "rdm", "lse"]
    fourteen [icelake + sha, icelake, avx512 + vnni, avx512 + aes, avx512, avx2 + sha + gfni, avx2 + gfni, avx2 + vaes, avx2 + sha, avx2 + "adx", avx2 + aes, avx2, sse4 + sha, "popcnt",
        sve2 + aes + sha3, sve2 + aes, sve2, neon86 + sha3, neon86 + aes, neon86, neon82 + sha3, neon82 + fp16, neon82 + aes, neon82, neon + sha3, neon + aes, neon + crc, "lse"]
    fifteen [icelake + sha, icelake, avx512 + vnni, avx512 + aes, avx512, avx2 + sha + gfni, avx2 + gfni, avx2 + vaes, avx2 + sha, avx2 + "adx", avx2 + aes, avx2, sse4 + sha, sse4 + aes, "popcnt",
        sve2 + aes + sha3, sve2 + aes, sve2, neon86 + sha3, neon86 + aes, neon86, neon82 + sha3, neon82 + fp16, neon82 + aes, neon82, neon + sha3, neon + aes, neon + crc, "rdm", "lse"]
    fifteen_rare [icelake + fp16, icelake + fp16 + narrow, avx2 + sha512, "avxneconvert" + "avx512vp2intersect", "avxneconvert" + "avx512fp16" + "avx512vl", "avxneconvert" + "avx512bf16" + "avx512vl", "avxneconvert" + "avx512vnni", "avxneconvert" + "avx512dq" + "avx512vl",
        "avxneconvert" + "avx512vl", "avxneconvert" + "avx512cd", "avxneconvert" + "sha512", "avxneconvert" + "sm3", "avxneconvert" + "sm4", "avxneconvert" + "gfni", "avxneconvert" + "vaes"]
    sixteen [icelake + sha, icelake, avx512 + vnni, avx512 + aes, avx512, avx2 + sha + gfni, avx2 + gfni, avx2 + vaes, avx2 + sha, avx2 + "adx", avx2 + aes, avx2, sse4 + sha, sse4 + aes, sse4, "popcnt",
        sve2 + aes + sha3, sve2 + aes, sve2, neon86 + sha3, neon86 + aes, neon86, neon82 + sha3, neon82 + fp16, neon82 + aes, neon82, neon + sha3, neon + aes, neon + crc, "rdm", "rcpc", "lse"]
}
const GENERIC: Targets = Targets(&[
    target!(sse4 + "lse"),
    target!(neon + "adx"),
    target!(avx512 + vnni + narrow),
    target!(sse4 + gfni),
    target!(avx2 + fast_gather),
    target!(sse4),
    target!(neon82 + fp16),
    target!(neon + fast_sha3),
    target!(neon + crc),
]);
#[kernel(targets = GENERIC)]
fn generic() -> Target {
    S::TARGET
}

// One test, because set_cpu is global.
#[test]
fn dispatch() {
    let all = cpu();
    assert!(LISTS.iter().all(|it| Some(it.1()) == it.3(first(it.0, all))));
    assert_eq!(all.without("no such thing"), all);
    let found: BTreeSet<_> = cpu_features().filter(|it| it.1).map(|it| it.0).collect();
    // What a feature implies can be hidden.
    let chain = ["sse3", "ssse3", "sse4.1", "sse4.2", "avx", "avx2", "avx512f"].map(|it| found.contains(it));
    let whole =
        |of: Target| chain.is_sorted_by(|a, b| a >= b) || cpu_features().all(|(name, has)| has || !of.has(name));
    if PLAIN {
        assert!(
            cpu_features().all(|(name, has)| only(name).is_supported() == all.has(name) && (has || !all.has(name)))
        );
        assert!(
            !all.has_word("narrow")
                && ["sse4.2", "avx2", "avx512f", "neon", "aes"]
                    .iter()
                    .all(|it| all.has(it) == (found.contains(it) && whole(only(it))))
        );
        for it in Target::combinations() {
            assert_eq!(it.is_supported(), it.features().iter().all(|it| found.contains(it)) && whole(it), "{it:?}");
        }
    }
    if cfg!(target_arch = "x86_64") && PLAIN {
        let (intel, zen) = (
            cpu_model().vendor == CpuVendor::Intel && (cpu_model().family, cpu_model().model) != (6, 0x2c),
            if cpu_model().vendor == CpuVendor::Amd { cpu_model().family } else { 0 },
        );
        let (golden_cove, zmm) = (intel && (all.has("avxvnni") || all.has("avx512fp16")), all.has("avx512f"));
        assert_eq!(
            TUNING.iter().map(|it| all.has(it)).collect::<Vec<_>>(),
            [
                intel || zen >= 0x19,
                golden_cove,
                zmm && (golden_cove || zen >= 0x19),
                intel || zen >= 0x1a,
                all.has("full_zmm")
            ]
        );
        assert!(if all.has("full_zmm") { zmm && (intel || zen >= 0x1a) } else { !(zmm && intel) });
    }
    // Not on kernels that are too old to have AT_RSEQ_FEATURE_SIZE.
    if cfg!(all(target_arch = "aarch64", target_os = "linux"))
        && PLAIN
        && let Ok(auxv) = std::fs::read("/proc/self/auxv")
    {
        assert_eq!(
            all.includes(target!(sve2)),
            target!(sve2).is_supported() && auxv.as_chunks::<16>().0.iter().any(|it| it[0] == 27)
                || target!(sve2).is_baseline()
        );
    }
    let tuned = TUNING.iter().flat_map(|word| {
        Target::combinations()
            .filter(|it| it.is_supported())
            .map(move |it| Target::parse(&format!("{it:?} + {word}")).unwrap())
    });
    let single = found.iter().filter_map(|it| Target::parse(&format!("portable + \"{it}\"")));
    for target in
        Target::combinations().chain(tuned).chain(single).chain(found.iter().map(|it| all.without(it))).chain([all])
    {
        let plain = TUNING.iter().fold(target, |it, word| it.without(word));
        assert_eq!(target.is_supported(), plain.is_supported());
        if !set_cpu(target) {
            continue;
        }
        let westmere = (cpu_model().vendor, cpu_model().family, cpu_model().model) == (CpuVendor::Intel, 6, 0x2c);
        let target = if westmere { cpu() } else { target };
        assert_eq!(&names(cpu()) | &given(), &names(target) | &given());
        for &(list, which, token, to, _) in LISTS {
            let want = first(list, target);
            assert_eq!(Targets(list).choose(target), want);
            // The first call chooses, and the second one remembers.
            assert_eq!([Some(which()); 2], [to(want), Some(which())], "{list:?} on {target:?}");
            // Each copy has the words that it is listed with.
            assert!(
                list.iter()
                    .position(|&it| it == want)
                    .map_or(which() == 0, |at| which() >> (list.len() - 1 - at) & 1 == 1),
                "{list:?} on {target:?}"
            );
            assert_eq!(
                (token().features(), token().has_word("narrow")),
                (want.features(), want.has_word("narrow")),
                "{list:?} on {target:?}"
            );
        }
        assert_eq!(
            [generic(), generic()].map(Target::features),
            [first(GENERIC.0, target).features(); 2],
            "{target:?}"
        );
    }
    for _ in 0..2 {
        for &(list, which, _, to, baseline) in LISTS {
            reset_cpu();
            assert_eq!([Some(which()), Some(which())], [to(first(list, all)); 2]);
            assert_eq!(baseline().features(), first(list, Target::Portable).features());
        }
        reset_cpu();
        assert_eq!(generic().features(), first(GENERIC.0, all).features());
        assert_eq!(cpu(), all);
    }
    assert!(
        GENERIC.0.iter().all(|&it| generic::to(it).map(Target::features) == it.is_supported().then_some(it.features()))
    );
    // A target that is refused changes nothing.
    assert!(!set_cpu(target!(wasm + "sse2")) && cpu() == all);
}
