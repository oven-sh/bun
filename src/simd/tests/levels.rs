#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{has, kernel, target, target::Target, target::cpu, target::reset_cpu, target::set_cpu};

#[bun_simd::simd]
mod helpers {
    use bun_simd::prelude::*;
    pub fn lanes() -> usize {
        u8xN::LANES
    }
}

#[bun_simd::simd(
    icelake + fast_zmm, icelake + narrow, avx2 + sha + "adx", avx2 + vaes + gfni, avx2 + sha, avx2, sse4 + sha + aes, "bmi2" + fast_pdep, "bmi2", sse4,
    sve2 + fast_sha3, sve2, neon + aes + fast_clmul, neon + sha3 + aes, neon82 + "lse", neon + crc, portable + "lse", neon, wasm,
)]
mod many {
    use super::helpers::lanes;
    use bun_simd::prelude::*;

    #[kernel]
    pub fn which() -> (Target, usize, [bool; 6]) {
        let words = [
            has!(portable),
            has!(sha),
            has!(gfni | sha3),
            has!(avx2 + "adx"),
            has!("bmi2" | "lse"),
            has!(fast_pdep | fast_sha3 | fast_clmul),
        ];
        (S::TARGET, lanes(), words)
    }

    #[kernel(avx2 + sha + "adx", "bmi2", neon82 + "lse")]
    pub fn some() -> Target {
        S::TARGET
    }

    #[kernel]
    pub fn low_bits(x: u64, n: u32) -> u64 {
        pick! { "bmi2" => by_instruction(x, n), _ => x & !(u64::MAX << n) }
    }
    #[only("bmi2")]
    fn by_instruction(x: u64, n: u32) -> u64 {
        #[cfg(target_arch = "x86_64")]
        return core::arch::x86_64::_bzhi_u64(x, n);
        #[cfg(not(target_arch = "x86_64"))]
        return x & !(u64::MAX << n);
    }

    fn hashes() -> bool {
        pick! { avx2 + sha | neon + aes => true, _ => false }
    }
    #[kernel]
    pub fn conjunction() -> (bool, bool) {
        (hashes(), has!(avx2 + sha | neon + aes))
    }
}

#[bun_simd::simd(icelake, avx512 + narrow, avx2 + aes, sse4 + aes, avx2, sse4, neon86 + aes, neon82, neon + aes, neon + crc, neon)]
mod only_levels {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn which() -> Target {
        S::TARGET
    }
}

#[kernel(avx2 + gfni, sse4 + gfni, neon82 + fcma, neon)]
fn generic() -> (Target, bool) {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    (S::TARGET, has!(S: gfni | neon + fcma))
}

const MANY: [Target; 19] = [
    target!(icelake + fast_zmm),
    target!(icelake + narrow),
    target!(avx2 + sha + "adx"),
    target!(avx2 + gfni + vaes),
    target!(avx2 + sha),
    target!(avx2 + fma),
    target!(sse4 + aes + sha),
    target!(portable + fast_pdep + "bmi2"),
    target!("bmi2"),
    target!(sse4),
    target!(sve2 + fast_sha3),
    target!(sve2),
    target!(neon + aes + fast_clmul),
    target!(neon + aes + sha3),
    target!(neon82 + "lse"),
    target!(neon + crc),
    target!("lse"),
    target!(neon),
    target!(wasm),
];
const LEVELS: [Target; 11] = [
    target!(icelake),
    target!(avx512 + narrow),
    target!(avx2 + aes),
    target!(sse4 + aes),
    target!(avx2),
    target!(sse4),
    target!(neon86 + aes),
    target!(neon82),
    target!(neon + aes),
    target!(neon + crc),
    target!(neon),
];

// One test, because set_cpu is global.
#[test]
fn the_first_that_the_cpu_has_wins() {
    let all = cpu();
    let fewer: Vec<_> = bun_simd::target::cpu_features().map(|(name, _)| all.without(name)).collect();
    for target in Target::combinations().chain(MANY).chain(fewer).chain([all]) {
        assert_eq!(set_cpu(target), target.is_supported());
        if !target.is_supported() {
            continue;
        }
        assert!(cpu().includes(target) && Target::parse(&format!("{target:?}")) == Some(target), "{target:?}");
        let first = |list: &'static [Target]| bun_simd::target::Targets(list).choose(target);
        let (token, lanes, words) = many::which();
        let chosen = first(&MANY);
        assert_eq!(many::which::to(chosen), Some((token, lanes, words)), "{target:?}");
        assert_eq!(token.features(), chosen.features());
        let has = |it| chosen.has(it);
        let portable = chosen.features().is_empty();
        assert_eq!(
            words,
            [
                portable,
                has("sha") || has("neon") && has("aes"),
                has("gfni") || has("sha3"),
                has("adx"),
                has("bmi2") || has("lse"),
                has("fast_pdep") || has("fast_sha3") || has("fast_clmul")
            ]
        );
        assert_eq!(
            lanes,
            if chosen == MANY[0] {
                64
            } else if has("avx2") {
                32
            } else {
                16
            }
        );
        assert_eq!(only_levels::which(), first(&LEVELS), "{target:?}");
        assert!(many::some().is_supported());
        assert_eq!(many::low_bits(0x1234, 8), 0x34);
        assert_eq!(many::conjunction().0, many::conjunction().1);
        let (token, word) = generic();
        assert_eq!(word, token.has("gfni") || token.has("fcma"));
    }
    reset_cpu();
    assert!(cpu().is_supported() && Target::parse(&format!("{:?}", cpu())) == Some(cpu()), "{:?}", cpu());
    assert_eq!(cpu(), all);
}

#[test]
fn features_come_with_what_they_imply() {
    if cfg!(all(target_arch = "x86_64", not(target_vendor = "apple"))) {
        assert!(target!("avx512vbmi").includes(target!("avx512bw" + "avx2" + "fma" + "ssse3")));
        assert!(
            !target!(icelake).without("avx2").has("avx512f")
                && target!(icelake + sha).without("avx512f").includes(target!(avx2 + sha + vaes + gfni))
        );
    }
    if cfg!(target_arch = "aarch64") {
        assert!(target!("sve2-sha3").includes(target!("sha2" + "fp16")));
    }
    assert_eq!(
        [target!(avx2 + sm4), target!(avx2 + vaes + sha512 + dot), target!(avx2 + dot + sm4 + aes)],
        [target!(avx2 + sha512); 3]
    );
    assert_eq!(target!(avx2 + gfni + dot + sha), target!(avx2 + dot));
    if cfg!(target_arch = "x86_64") {
        for (text, it) in [
            ("avx2 + sm4", target!(avx2 + sm4)),
            ("avx2+aes+sha+vaes+dot", target!(avx2 + dot)),
            ("avx2 + \"sha512\"", target!(avx2 + "sha512")),
        ] {
            assert_eq!(Target::parse(text), Some(it));
        }
        assert!(
            target!(avx2 + sha512).includes(target!(avx2 + dot + "sm3"))
                && target!(avx2 + dot).includes(target!(avx2 + gfni + ifma + sha + vaes + vnni))
        );
    }
    assert!(Target::parse("avx3").is_none() && Target::parse("portable + avx2,sha").is_none());
}

#[bun_simd::simd(icelake + narrow + sha, avx512 + narrow + vnni, avx2 + sha512, avx2 + ifma + gfni, avx2 + vnni, neon86 + sha3, neon82 + fcma, neon + aes)]
mod rare {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn mix(a: &[u8; 64], b: &[u8; 64]) -> [[u8; 64]; 6] {
        let (a, b) = (u8x64::load(a), u8x64::load(b));
        let (x, y) = (a.bitcast::<u64>(), b.bitcast::<u64>());
        let mut kept = [0; 64];
        a.compress(a.simd_gt(b)).store(&mut kept);
        [
            a.galois_mul(b).to_array(),
            a.dot::<i32>(b.bitcast::<i8>()).bitcast::<u8>().to_array(),
            (x >> 12).mul52_high_add(y >> 12, x).bitcast::<u8>().to_array(),
            kept,
            a.dot_add::<u32>(b, x.bitcast()).bitcast::<u8>().to_array(),
            a.cast_signed().dot_add::<i32>(b.cast_signed(), x.bitcast()).bitcast::<u8>().to_array(),
        ]
    }
}

#[test]
fn rare_combinations_agree() {
    let (a, b) = (core::array::from_fn(|i| (i * 37 + 11) as u8), core::array::from_fn(|i| (i * i * 5 + 200) as u8));
    let want = rare::mix::to(Target::Portable, &a, &b);
    assert!(Target::combinations().filter_map(|it| rare::mix::to(it, &a, &b)).all(|it| Some(it) == want));
}

#[test]
fn words_of_portable() {
    #[bun_simd::simd]
    fn on() {
        use bun_simd::{has, pick};
        assert_eq!(
            [has!(portable), has!(avx2 | portable), has!(portable | neon), has!(avx2 | neon), has!(portable + aes)],
            [true, true, true, false, false]
        );
        assert_eq!(
            [
                pick! { portable => 1, _ => 2 },
                pick! { avx2 | portable => 1, _ => 2 },
                pick! { avx2 | neon => 1, _ => 2 }
            ],
            [1, 1, 2]
        );
    }
    on::<bun_simd::target::Portable>()
}
