//! What a target has, includes and is called.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{Isa, Width, kernel, target, target::*};
use std::collections::BTreeSet;
#[path = "framework/names.rs"]
mod names;
use names::*;

#[test]
fn sets_of_names() {
    let level = |it: Target| {
        names(Target::parse(format!("{it:?}").split(' ').next().unwrap()).unwrap()).len()
            - it.has_word("avx512") as usize
            - it.has_word("sve2") as usize
    };
    let all: Vec<_> =
        Target::combinations().map(|it| (it, names(it), format!("{it:?}"), (level(it), names(it).len()))).collect();
    let single: Vec<_> = cpu_features().map(|it| (it.0, only(it.0))).collect();
    for (a, of_a, text, _) in all.iter().cloned() {
        assert!(
            a.features().iter().all(|it| a.has(it))
                && !a.has("no such thing")
                && !a.has_word("fast_pdep")
                && !a.has_word("sse4.2")
        );
        assert_eq!((a.without("no such thing"), Target::parse(&format!("{a:?}"))), (a, Some(a)));
        assert_eq!(a.is_baseline(), names(a).is_subset(&given()));
        for (b, of_b, other, _) in all.iter().filter(|_| PLAIN) {
            assert_eq!((a.includes(*b), a == *b), (of_b.is_subset(&of_a), text == *other));
        }
        for (gone, _) in single.iter().filter(|it| PLAIN && a.has(it.0)) {
            let less = a.without(gone);
            let left: BTreeSet<_> = single.iter().filter(|it| a.has(it.0) && !it.1.has(gone)).map(|it| it.0).collect();
            assert_eq!(&names(less) - &["wide vectors"].into(), left);
            // No other token fits that is of a higher level, or has more.
            let token = all
                .iter()
                .find(|it| it.0.features() == less.features() && it.0.has_word("narrow") == less.has_word("narrow"))
                .unwrap();
            assert!(
                all.iter().filter(|it| a.includes(it.0) && !it.0.has(gone)).all(|it| it.3 <= token.3),
                "{a:?} without {gone}: {less:?}"
            );
        }
        for word in TUNING {
            let tuned = Target::parse(&format!("{a:?} + {word}")).unwrap();
            assert!(
                tuned.has_word(word)
                    && tuned.includes(a)
                    && !a.includes(tuned)
                    && tuned.without(word) == a
                    && !tuned.is_baseline()
            );
            assert_eq!(
                (TUNING.iter().filter(|it| tuned.has(it)).count(), format!("{tuned:?}")),
                (1, format!("{a:?} + {word}"))
            );
        }
    }
}

#[test]
fn of_another_architecture() {
    let (it, feature, text) = if X86 {
        (target!(neon + aes), "sha2", "neon + aes")
    } else {
        (target!(sse4 + aes), "pclmulqdq", "sse4 + aes")
    };
    if native(it) {
        return;
    }
    assert!(
        it.has(feature)
            && it.has_word("aes")
            && !it.has("avx")
            && !it.is_supported()
            && !it.is_baseline()
            && !it.includes(it)
            && !cpu().includes(it)
            && !it.includes(Target::Portable)
    );
    assert_eq!((it.without(feature), format!("{it:?}"), Target::parse(text)), (it, text.into(), None));
    assert_eq!(Targets(&[]).choose(it), Target::Portable);
    assert_eq!(
        Targets(&[target!(neon + aes), target!(sse4 + aes)]).choose(it),
        first(&[target!(neon + aes), target!(sse4 + aes)], Target::Portable)
    );
    assert!(
        Target::ALL.iter().all(|&it| native(it))
            && Target::ALL[0] == Target::Portable
            && Targets::ALL.0.iter().rev().eq(&Target::ALL[1..])
    );
}

/// As in the Reference of Rust, "codegen attributes".
#[test]
fn implied() {
    let chains = if X86 {
        "avx512vbmi2>avx512bw>avx512f>avx2>avx>sse4.2>sse4.1>ssse3>sse3 fma>avx f16c>avx vaes>avx2 vaes>aes vpclmulqdq>avx vpclmulqdq>pclmulqdq \
        sha512>avx2 sm3>avx sm4>avx2 avxvnni>avx2 avxifma>avx2 avxvnniint8>avx2 avxneconvert>avx2 avxvnniint16>avx2 avx512f>fma avx512f>f16c avx512dq>avx512f avx512ifma>avx512f \
        avx512cd>avx512f avx512vl>avx512f avx512vbmi>avx512bw avx512vnni>avx512f avx512bitalg>avx512bw avx512vpopcntdq>avx512f avx512vp2intersect>avx512f avx512fp16>avx512bw avx512bf16>avx512bw"
    } else {
        "sve2>sve>fp16>neon aes>neon sha3>sha2>neon sm4>neon rdm>neon jsconv>neon fcma>neon dotprod>neon fhm>fp16 sve2-aes>sve2 sve2-aes>aes \
        sve2-bitperm>sve2 sve2-sha3>sve2 sve2-sha3>sha3 sve2-sm4>sve2 sve2-sm4>sm4"
    };
    for chain in chains.split(' ').filter(|_| PLAIN).map(|it| it.split('>').collect::<Vec<_>>()) {
        assert!(
            chain.windows(2).all(|it| only(it[0]).includes(only(it[1])) && !only(it[1]).includes(only(it[0]))),
            "{chain:?}"
        );
    }
}

#[test]
fn implied_beyond_rustc() {
    let has = |it: Target, names: &[&str]| assert!(!native(it) || names.iter().all(|name| it.has(name)), "{it:?}");
    has(target!("sse3"), &["sse2"]);
    has(target!("avx512fp16"), &["avx512vl"]);
    for it in [target!("frintts"), target!("i8mm"), target!("bf16")] {
        has(it, &["neon"]);
    }
    has(target!("relaxed-simd"), &["simd128"]);
}

#[test]
fn sve2_is_more_than_its_features() {
    let (it, features) = (target!(sve2), target!(neon86 + fcma + "sve2"));
    assert!(!native(it) || !features.includes(it) && it.features().iter().all(|it| features.has(it)));
}

#[test]
fn the_level_counts_first() {
    let it = target!(icelake + sha + narrow + "avxvnni");
    assert!(
        !native(it) || ["avx512vnni", "avx512vbmi"].iter().fold(it, |it, gone| it.without(gone)).has_word("avx512")
    );
}

#[test]
#[cfg(panic = "unwind")]
fn the_best_comes_first() {
    let _ = Targets(&[]).checked();
    let last_two: Vec<_> = Targets::ALL.0.iter().copied().chain([Target::Portable; 2]).collect();
    assert!(std::panic::catch_unwind(|| Targets(last_two.leak()).checked()).is_err());
    let n = Target::ALL.len();
    for i in 0..n * n * n {
        let [a, b, c] = [i % n, i / n % n, i / n / n].map(|it| Target::ALL[it]);
        let refused = std::panic::catch_unwind(|| Targets(vec![a, b, c].leak()).checked())
            .err()
            .map(|it| it.downcast_ref::<&str>().unwrap().starts_with("a target is never chosen"));
        let never = |it: Target, before: &[Target]| {
            let usual = (it.is_baseline() && it == Targets::DEFAULT.0[0] || before.contains(&it))
                && !before.contains(&Target::Portable);
            before.iter().any(|&first| it.includes(first)) && !usual
        };
        assert_eq!(refused, (never(b, &[a]) || never(c, &[a, b])).then_some(true));
    }
}

#[test]
fn parse() {
    let ok = |text, it: Target| assert_eq!(Target::parse(text), native(it).then_some(it), "{text}");
    ok(" sse4+aes ", target!(sse4 + aes));
    ok("sse4 + sha", target!(sse4 + sha));
    ok("sse4 + gfni", target!(sse4 + gfni));
    ok("avx2", target!(avx2));
    ok("avx2 + crc32c + fma", target!(avx2));
    for (text, it) in [
        ("avx2 + gfni", target!(avx2 + gfni)),
        ("avx2 + ifma", target!(avx2 + ifma)),
        ("sse4 + bmi", target!(sse4 + bmi)),
        ("avx2 + bmi", target!(avx2)),
        ("avx2 + sha", target!(avx2 + sha)),
        ("avx2 + vaes", target!(avx2 + vaes)),
        ("avx2 + vnni", target!(avx2 + vnni)),
        ("avx512 + bf16", target!(avx512 + bf16)),
        ("avx512 + vnni", target!(avx512 + vnni)),
        ("avx512 + narrow", target!(avx512 + narrow)),
        ("avx512 + vnni + narrow", target!(avx512 + aes + narrow + vnni)),
        ("icelake + narrow + fp16", target!(icelake + fp16 + narrow)),
        ("neon + sha", target!(neon + aes)),
        ("neon + crc32c", target!(neon + crc)),
        ("neon82 + sha512", target!(neon82 + sha3)),
        ("neon + sm4", target!(neon + sm4)),
        ("portable", Target::Portable),
    ] {
        ok(text, it);
    }
    assert!(
        [
            "", "+", "sse4 +", "sse4 + neon", "neon + sse4", "aes", "sse4 aes", "sse4 + \"lse\"", "neon + \"adx\"",
            "icelake + dot"
        ]
        .iter()
        .all(|it| Target::parse(it).is_none())
    );
}

#[kernel(targets = Targets::ALL)]
fn sizes() -> (usize, usize) {
    (S::Native::BYTES, S::REGISTERS)
}

#[test]
fn registers() {
    for it in sizes::targets() {
        let word = |words: &[&str]| words.iter().any(|word| it.has_word(word));
        let bytes = if word(&["narrow"]) {
            32
        } else if word(&["avx512"]) {
            64
        } else if word(&["avx2"]) {
            32
        } else {
            16
        };
        let many = cfg!(target_arch = "aarch64") || word(&["avx512"]);
        assert_eq!(
            sizes::to(it),
            Some((
                bytes,
                if cfg!(target_arch = "x86") {
                    8
                } else if many {
                    32
                } else {
                    16
                }
            )),
            "{it:?}"
        );
    }
}

#[kernel(targets = Targets::ALL)]
fn words() -> [bool; 4] {
    use bun_simd::has;
    [has!(S: "aes"), has!(S: aes + "avx2"), has!(S: sse4 + aes | neon + crc), has!(S: portable)]
}

#[bun_simd::simd(sse4, neon)]
mod by_token {
    use bun_simd::prelude::*;
    #[kernel]
    #[allow(clippy::bool_comparison)]
    pub fn same() -> bool {
        has!(S: portable) == has!(portable) && has!(Other: portable)
    }
    type Other = bun_simd::target::Portable;
}

#[test]
fn words_in_generic_code() {
    #[bun_simd::simd]
    fn on() {
        assert!(by_token::same::targets().all(|it| by_token::same::to(it) == Some(true)));
        assert_eq!([bun_simd::has!(portable), bun_simd::has!(sse2), bun_simd::has!(avx2 | neon)], [true, false, false]);
        assert_eq!([bun_simd::pick! { portable => 1, _ => 2 }, bun_simd::pick! { sse2 | neon => 1, _ => 2 }], [1, 2]);
        for it in words::targets() {
            let both = |a, b| it.has_word(a) && it.has_word(b);
            let want = [
                it.has("aes"),
                it.has_word("aes") && it.has("avx2"),
                both("sse4", "aes") || both("neon", "crc"),
                it == Target::Portable,
            ];
            assert_eq!(words::to(it), Some(want), "{it:?}");
        }
    }
    on::<bun_simd::target::Portable>()
}

#[test]
#[cfg(not(all(miri, target_arch = "aarch64")))]
fn compiled_for() {
    macro_rules! each { ($($name:tt)*) => { $(assert_eq!(target!($name).is_baseline(), native(target!($name)) && (cfg!(target_feature = $name) || !PLAIN && target!($name).is_baseline()));)* }; }
    each!("sse2" "sse4.2" "avx2" "avx512f" "avx512vl" "neon" "aes" "sve2");
}

#[test]
fn default_list() {
    let below = if target!(avx2).is_baseline() { target!(avx2) } else { target!(sse4) };
    let want = [target!(icelake), target!(avx2 + aes), below, target!(neon), target!(wasm + relaxed), target!(wasm)];
    assert!(!PLAIN || cfg!(target_arch = "aarch64") || want.starts_with(Targets::DEFAULT.0));
    // That of modules.
    let listed = bun_simd::resolve_targets! { {target [@all] []} default }.0;
    assert!(listed.iter().filter(|&&it| native(it)).eq(Targets::DEFAULT.0.iter().filter(|&&it| native(it))));
    assert!(!target!(neon).is_baseline() || Targets::DEFAULT.choose(Target::Portable) == <Baseline as Isa>::TARGET);
    let text = listed.iter().map(|it| format!("{it:?}")).collect::<Vec<_>>().join(", ");
    assert_eq!(
        text,
        match () {
            _ if target!(avx2).is_baseline() => "icelake, avx2 + aes, avx2",
            _ if cfg!(target_arch = "aarch64") && listed.len() == 2 => {
                assert!(cfg!(miri) || listed[0] == <Baseline as Isa>::TARGET);
                format!("{:?}, neon", listed[0]).leak()
            }
            _ => "icelake, avx2 + aes, sse4, neon, wasm + relaxed, wasm",
        }
    );
    assert_eq!(
        <Baseline as Isa>::TARGET,
        Target::combinations().filter(|it| it.is_baseline()).max_by_key(|&it| names(it).len()).unwrap()
    );
}

#[test]
fn what_is_found_is_supported() {
    for (name, found) in cpu_features().filter(|_| !cfg!(miri)) {
        let all_found = cpu_features().all(|it| it.1 || !only(name).has(it.0));
        assert_eq!(only(name).is_supported(), found && all_found, "{name}");
    }
}

#[test]
fn a_writer_that_fails() {
    struct Full(usize);
    impl std::fmt::Write for Full {
        fn write_str(&mut self, _: &str) -> std::fmt::Result {
            self.0 = self.0.checked_sub(1).ok_or(std::fmt::Error)?;
            Ok(())
        }
    }
    assert!(std::fmt::write(&mut Full(0), format_args!("{:?}", Target::Portable)).is_err());
    assert!(std::fmt::write(&mut Full(1), format_args!("{:?}", Target::Portable)).is_ok());
}

#[test]
fn unknown_names_are_never_there() {
    let it = bun_simd::target::Target::of(bun_simd::Named::Portable, &["unknown"]);
    assert!(!it.is_supported() && !it.is_baseline());
}
