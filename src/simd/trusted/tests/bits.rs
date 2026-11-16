//! Which features are lost when a system does not report one bit. Runs on any machine.
#![cfg(not(miri))]
use bun_simd_trusted::features::{Arch, Features};
use bun_simd_trusted::{aarch64, x86_64};

fn names<A: Arch>(features: Features<A>) -> Vec<&'static str> {
    features.names().collect()
}

/// `all` without the features in `gone` and those that imply them.
fn without<A: Arch>(all: Features<A>, gone: &[&str]) -> Vec<&'static str> {
    let named = |name| Features::<A>::named(&[name]);
    let is_gone = |name| gone.iter().any(|other| named(name).contains(named(other)));
    all.names().filter(|name| !is_gone(name)).collect()
}

const EAX: usize = 0;
const EBX: usize = 1;
const ECX: usize = 2;
const EDX: usize = 3;

/// Leaf, subleaf, register, mask and feature, as in clang's cpuid.h.
const CPUID: &[(u32, u32, usize, u32, &str)] = &[
    (0x1, 0, ECX, 0x0000_0001, "sse3"),
    (0x1, 0, ECX, 0x0000_0002, "pclmulqdq"),
    (0x1, 0, ECX, 0x0000_0200, "ssse3"),
    (0x1, 0, ECX, 0x0000_1000, "fma"),
    (0x1, 0, ECX, 0x0000_2000, "cmpxchg16b"),
    (0x1, 0, ECX, 0x0008_0000, "sse4.1"),
    (0x1, 0, ECX, 0x0010_0000, "sse4.2"),
    (0x1, 0, ECX, 0x0040_0000, "movbe"),
    (0x1, 0, ECX, 0x0080_0000, "popcnt"),
    (0x1, 0, ECX, 0x0200_0000, "aes"),
    (0x1, 0, ECX, 0x0400_0000, "xsave"),
    (0x1, 0, ECX, 0x0800_0000, "xsave"),
    (0x1, 0, ECX, 0x1000_0000, "avx"),
    (0x1, 0, ECX, 0x2000_0000, "f16c"),
    (0x1, 0, EDX, 0x0100_0000, "fxsr"),
    (0x1, 0, EDX, 0x0200_0000, "sse"),
    (0x1, 0, EDX, 0x0400_0000, "sse2"),
    (0x7, 0, EBX, 0x0000_0008, "bmi1"),
    (0x7, 0, EBX, 0x0000_0020, "avx2"),
    (0x7, 0, EBX, 0x0000_0100, "bmi2"),
    (0x7, 0, EBX, 0x0000_0200, "ermsb"),
    (0x7, 0, EBX, 0x0001_0000, "avx512f"),
    (0x7, 0, EBX, 0x0002_0000, "avx512dq"),
    (0x7, 0, EBX, 0x0008_0000, "adx"),
    (0x7, 0, EBX, 0x0020_0000, "avx512ifma"),
    (0x7, 0, EBX, 0x0080_0000, "clflushopt"),
    (0x7, 0, EBX, 0x1000_0000, "avx512cd"),
    (0x7, 0, EBX, 0x2000_0000, "sha"),
    (0x7, 0, EBX, 0x4000_0000, "avx512bw"),
    (0x7, 0, EBX, 0x8000_0000, "avx512vl"),
    (0x7, 0, ECX, 0x0000_0002, "avx512vbmi"),
    (0x7, 0, ECX, 0x0000_0040, "avx512vbmi2"),
    (0x7, 0, ECX, 0x0000_0100, "gfni"),
    (0x7, 0, ECX, 0x0000_0200, "vaes"),
    (0x7, 0, ECX, 0x0000_0400, "vpclmulqdq"),
    (0x7, 0, ECX, 0x0000_0800, "avx512vnni"),
    (0x7, 0, ECX, 0x0000_1000, "avx512bitalg"),
    (0x7, 0, ECX, 0x0000_4000, "avx512vpopcntdq"),
    (0x7, 0, EDX, 0x0000_0100, "avx512vp2intersect"),
    (0x7, 0, EDX, 0x0080_0000, "avx512fp16"),
    (0x7, 1, EAX, 0x0000_0001, "sha512"),
    (0x7, 1, EAX, 0x0000_0002, "sm3"),
    (0x7, 1, EAX, 0x0000_0004, "sm4"),
    (0x7, 1, EAX, 0x0000_0010, "avxvnni"),
    (0x7, 1, EAX, 0x0000_0020, "avx512bf16"),
    (0x7, 1, EAX, 0x0080_0000, "avxifma"),
    (0x7, 1, EDX, 0x0000_0010, "avxvnniint8"),
    (0x7, 1, EDX, 0x0000_0020, "avxneconvert"),
    (0x7, 1, EDX, 0x0000_0400, "avxvnniint16"),
    (0x7, 1, EDX, 0x0008_0000, "avx10.1"),
    (0xD, 1, EAX, 0x0000_0001, "xsaveopt"),
    (0xD, 1, EAX, 0x0000_0002, "xsavec"),
    (0x24, 0, EBX, 0x0004_0000, "avx10.1"),
    (0x8000_0001, 0, ECX, 0x0000_0001, "lahfsahf"),
    (0x8000_0001, 0, ECX, 0x0000_0020, "lzcnt"),
    (0x8000_0001, 0, ECX, 0x0000_0040, "sse4a"),
    (0x8000_0001, 0, ECX, 0x0000_0100, "prfchw"),
    (0x8000_0001, 0, ECX, 0x0000_0800, "xop"),
    (0x8000_0001, 0, ECX, 0x0001_0000, "fma4"),
    (0x8000_0001, 0, ECX, 0x0020_0000, "tbm"),
];

const LEAVES: [(u32, u32); 6] = [
    (1, 0),
    (7, 0),
    (7, 1),
    (0xD, 1),
    (0x24, 0),
    (0x8000_0001, 0),
];
const INTEL: [u32; 4] = [0x24, 0x756E_6547, 0x6C65_746E, 0x4965_6E69];

/// A CPU that has everything, until `change` edits the answers.
fn cpu(xcr0: u64, change: impl Fn((u32, u32), &mut [u32; 4])) -> x86_64::Features {
    let cpuid = |leaf, subleaf| {
        let mut answer = match (leaf, subleaf) {
            (0, 0) => [0x24, 0, 0, 0],
            (0x8000_0000, 0) => [0x8000_0008, 0, 0, 0],
            asked if LEAVES.contains(&asked) => [!0; 4],
            asked => panic!("{asked:x?}"),
        };
        change((leaf, subleaf), &mut answer);
        answer
    };
    x86_64::decode(cpuid, xcr0)
}

fn all_but(gone: &[&str]) -> Vec<&'static str> {
    without(cpu(!0, |_, _| {}), gone)
}

fn reported_in(is_in: impl Fn(u32, u32, usize, u32) -> bool) -> Vec<&'static str> {
    let rows = CPUID.iter().filter(|row| is_in(row.0, row.1, row.2, row.3));
    rows.map(|row| row.4).collect()
}

#[test]
fn each_cpuid_bit() {
    for leaf in LEAVES {
        for register in [EAX, EBX, ECX, EDX] {
            for mask in (0..32).map(|bit| 1 << bit) {
                let got = cpu(!0, |asked, answer| {
                    if asked == leaf {
                        answer[register] &= !mask;
                    }
                });
                let gone = reported_in(|a, b, c, d| ((a, b), c, d) == (leaf, register, mask));
                assert_eq!(names(got), all_but(&gone), "{leaf:x?} {register} {mask:x}");
            }
        }
    }
}

#[test]
fn each_xcr0_bit() {
    for bit in 0..64 {
        let gone: &[_] = match bit {
            1 | 2 => &["avx"],
            5..=7 => &["avx512f"],
            _ => &[],
        };
        assert_eq!(names(cpu(!(1 << bit), |_, _| {})), all_but(gone), "{bit}");
    }
}

#[test]
fn xcr0_adds_nothing() {
    for xcr0 in [0, 0x07, !0] {
        let got = cpu(xcr0, |asked, answer| {
            if LEAVES.contains(&asked) {
                *answer = [0; 4];
            }
        });
        assert_eq!(got.names().next(), None, "{xcr0:x}");
    }
}

#[test]
fn max_leaf() {
    for last in 0..=0x24 {
        let got = cpu(!0, |asked, answer| {
            if asked == (0, 0) {
                answer[EAX] = last;
            }
        });
        let gone = reported_in(|leaf, _, _, _| (last + 1..0x8000_0000).contains(&leaf));
        assert_eq!(names(got), all_but(&gone), "{last:x}");
    }
}

#[test]
fn max_subleaf_of_leaf_7() {
    let got = cpu(!0, |asked, answer| {
        if asked == (7, 0) {
            answer[EAX] = 0;
        }
    });
    let gone = reported_in(|leaf, subleaf, _, _| (leaf, subleaf) == (7, 1));
    assert_eq!(names(got), all_but(&gone));
}

#[test]
fn max_extended_leaf() {
    for last in [0, 0x8000_0000, 0x9000_0000, !0] {
        let got = cpu(!0, |asked, answer| {
            if asked == (0x8000_0000, 0) {
                answer[EAX] = last;
            }
        });
        let gone = reported_in(|leaf, _, _, _| leaf == 0x8000_0001);
        assert_eq!(names(got), all_but(&gone), "{last:x}");
    }
}

#[test]
fn avx10_versions() {
    let first = [(0, &["avx10.1"][..]), (1, &["avx10.2"])];
    for (version, gone) in first.into_iter().chain((2..256).map(|it| (it, &[][..]))) {
        let got = cpu(!0, |asked, answer| {
            if asked == (0x24, 0) {
                answer[EBX] = 0x7_0000 | version;
            }
        });
        assert_eq!(names(got), all_but(gone), "{version}");
    }
}

#[test]
fn bits_to_ignore_on_intel() {
    let intel = |avx: u32| {
        cpu(!0, move |asked, answer| match asked {
            (0, 0) => *answer = INTEL,
            (1, 0) => answer[ECX] = !(1 << 28) | avx << 28,
            _ => {}
        })
    };
    assert_eq!(names(intel(1)), all_but(&["sse4a", "tbm"]));
    assert_eq!(
        names(intel(0)),
        all_but(&["sse4a", "tbm", "avx", "bmi1", "bmi2"])
    );
}

#[test]
fn named_twice() {
    let named = |list| names(x86_64::Features::named(list));
    assert_eq!(named(&["sse3", "sse2"]), ["sse", "sse2", "sse3"]);
    assert_eq!(named(&["popcnt", "popcnt"]), ["popcnt"]);
}

#[test]
#[should_panic = "index out of bounds"]
fn unknown_name() {
    x86_64::Features::named(&["avx3"]);
}

#[test]
fn avx_needs_osxsave() {
    assert!(!all_but(&["xsave"]).contains(&"avx"));
}

/// From bit 0 on, as in Linux's asm/hwcap.h.
const HWCAP: &str = "
    neon neon - aes aes sha2 sha2 crc lse fp16 fp16 - rdm jsconv fcma rcpc - sha3 sm4 sm4
    dotprod sha3 sve fhm - lse2 rcpc2 flagm";
const HWCAP2: &str = "
    - sve2 sve2-aes sve2-aes sve2-bitperm sve2-sha3 sve2-sm4 flagm2 frintts i8mm f32mm -
    bf16 i8mm bf16 - - - - - - - - - - - - - - - - - - - cssc - sve2p1 - - - - - - mops hbc
    - rcpc3 lse128 - lut faminmax";

#[test]
fn each_hwcap_bit() {
    let all = aarch64::from_hwcap(!0, !0);
    for bit in 0..64 {
        let gone = |names: &'static str| {
            let name = names
                .split_whitespace()
                .nth(bit)
                .filter(|&name| name != "-");
            without(all, name.as_slice())
        };
        let but = !(1 << bit);
        assert_eq!(names(aarch64::from_hwcap(but, !0)), gone(HWCAP), "{bit}");
        assert_eq!(
            names(aarch64::from_hwcap(!0, but)),
            gone(HWCAP2),
            "64 + {bit}"
        );
    }
}

#[test]
fn neon() {
    assert_eq!(
        names(aarch64::from_hwcap(!0b10, !0)).join(" "),
        "crc lse lse2 lse128 rcpc rcpc2 rcpc3 flagm flagm2 cssc mops hbc"
    );
}

#[test]
fn flagm() {
    assert!(!names(aarch64::from_hwcap(!(1 << 27), !0)).contains(&"flagm2"));
}

#[test]
fn i8mm_and_bf16_without_sve() {
    let features = aarch64::from_hwcap(0b11, 0b11 << 13);
    assert_eq!(names(features), ["neon", "i8mm", "bf16"]);
    let features = aarch64::from_windows(|n| [19, 66, 68].contains(&n));
    assert_eq!(names(features), ["neon", "i8mm", "bf16"]);
}

#[test]
fn i8mm_and_bf16_with_sve() {
    let names = names(aarch64::from_hwcap(0b11 | 0b11 << 9 | 1 << 22, 0b11 << 13));
    assert_eq!(names, ["neon", "fp16", "sve"]);
}

#[test]
fn each_windows_feature() {
    let all = aarch64::from_windows(|_| true);
    assert_eq!(names(all).len(), 21);
    for number in 0..100 {
        // As in winnt.h
        let gone: &[_] = match number {
            19 => &["neon"],
            30 => &["aes", "sha2"],
            31 => &["crc"],
            34 => &["lse"],
            43 => &["dotprod", "rdm"],
            44 => &["jsconv"],
            45 => &["rcpc"],
            46 => &["sve"],
            47 => &["sve2"],
            48 => &["sve2p1"],
            49 | 50 => &["sve2-aes"],
            51 => &["sve2-bitperm"],
            52 | 68 => &["bf16"],
            55 => &["sve2-sha3"],
            57 | 66 => &["i8mm"],
            58 => &["f32mm"],
            62 => &["lse2"],
            64 | 65 => &["sha3"],
            67 => &["fp16"],
            _ => &[],
        };
        let got = aarch64::from_windows(|n| n != number);
        assert_eq!(names(got), without(all, gone), "{number}");
    }
}

const SYSCTL: &str = "
    floatingpoint=neon neon=neon armv8_crc32=crc arm.FEAT_AES=aes arm.FEAT_BF16=bf16
    arm.FEAT_CSSC=cssc arm.FEAT_DotProd=dotprod arm.FEAT_FCMA=fcma arm.FEAT_FHM=fhm
    arm.FEAT_FlagM=flagm arm.FEAT_FlagM2=flagm2 arm.FEAT_FP16=fp16 arm.FEAT_FRINTTS=frintts
    arm.FEAT_HBC=hbc arm.FEAT_I8MM=i8mm arm.FEAT_JSCVT=jsconv arm.FEAT_LRCPC=rcpc
    arm.FEAT_LRCPC2=rcpc2 arm.FEAT_LSE=lse arm.FEAT_LSE2=lse2 arm.FEAT_PMULL=aes arm.FEAT_RDM=rdm
    arm.FEAT_SHA1=sha2 arm.FEAT_SHA256=sha2 arm.FEAT_SHA3=sha3 arm.FEAT_SHA512=sha3";

#[test]
fn each_sysctl_name() {
    let all = aarch64::from_sysctl(|_| true);
    assert_eq!(names(all).len(), 22);
    for (name, gone) in SYSCTL
        .split_whitespace()
        .filter_map(|it| it.split_once('='))
    {
        let name = format!("hw.optional.{name}");
        let got = aarch64::from_sysctl(|asked| asked.to_bytes() != name.as_bytes());
        assert_eq!(names(got), without(all, &[gone]), "{name}");
    }
}

#[test]
fn exynos_9810() {
    let on = |chip: &[u8]| names(aarch64::on_android(!0, !0xFF, chip));
    assert_eq!(on(b"exynos9810\0\0"), ["neon", "crc", "aes", "sha2"]);
    assert_eq!(on(b"\0\0"), names(aarch64::from_hwcap(!0, !0xFF)));
    assert_eq!(on(b"exynos981\0"), names(aarch64::from_hwcap(!0, !0xFF)));
}

#[test]
fn avx512_needs_darwin_21_3() {
    let before = ["9.8.0", "19.6.0", "20.9.0", "21.2.0", "22", "x.y", ""];
    let since = ["21.3.0", "21.10.0", "22.0.0", "25.1.0"];
    for (releases, saved) in [(&before[..], 0x07), (&since, 0xE7)] {
        for release in releases.iter().map(|release| format!("{release}\0")) {
            for xcr0 in [0x07, 0xE7] {
                let with = |avx512f| x86_64::saved_by_darwin(xcr0, avx512f, release.as_bytes());
                assert_eq!((with(true), with(false)), (saved, 0x07), "{release}");
            }
        }
    }
    assert_eq!(x86_64::saved_by_darwin(0x03, true, b"22.0.0\0"), 0xE3);
}

#[test]
fn sve_needs_linux_6_2() {
    let before = [
        "4.15.0",
        "5.10.1",
        "5.14.21-150500",
        "5.15.0-1",
        "6.1.112-122.amzn2023",
        "6",
        "x.y",
        "",
    ];
    let since = [
        "5.14.0-427.el9",
        "6.2",
        "6.2-rc1",
        "6.12.3",
        "7.0.0",
        "10.1.0",
    ];
    for (releases, kept) in [(&before[..], !(1 << 22)), (&since, !0)] {
        for release in releases.iter().map(|release| format!("{release}\0\0")) {
            let got = aarch64::kept_by_linux(!0, release.as_bytes());
            assert_eq!(got, kept, "{release}");
        }
    }
}
