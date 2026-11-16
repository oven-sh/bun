//! Compares the feature tables with what rustc knows about features and CPUs. Runs on any machine.
#![cfg(not(miri))]
use bun_simd_trusted::Target::{self, *};
use bun_simd_trusted::{aarch64, x86_64};
use std::collections::BTreeSet;
use std::process::Command;

const X86_64: &str = "x86_64-unknown-linux-gnu";
/// Its baseline lacks SSE, which shows the features that imply it.
const I586: &str = "i586-unknown-linux-gnu";
const AARCH64: &str = "aarch64-unknown-linux-gnu";

type Names = BTreeSet<String>;

fn enabled(target: &str, flag: &str) -> Names {
    let arguments = ["--print", "cfg", "--target", target, flag];
    let rustc = Command::new("rustc").args(arguments).output().unwrap();
    assert!(rustc.status.success(), "{rustc:?}");
    let lines = String::from_utf8(rustc.stdout).unwrap();
    let values = lines
        .lines()
        .filter_map(|line| line.strip_prefix("target_feature="));
    values.map(|value| value.trim_matches('"').into()).collect()
}

fn set<'a>(names: impl Iterator<Item = &'a str>) -> Names {
    names.map(Into::into).collect()
}

fn all_of_x86_64() -> Names {
    let last_leaves = |leaf, _| match leaf {
        0 => [0x24, 0, 0, 0],
        0x8000_0000 => [0x8000_0008, 0, 0, 0],
        _ => [!0; 4],
    };
    set(x86_64::decode(last_leaves, !0).names())
}

fn all_of_aarch64() -> Names {
    set(aarch64::from_hwcap(!0, !0).names())
}

/// Otherwise code for a feature could have instructions that were never detected.
fn each_needs_what_it_implies(target: &str, all: Names, needs: impl Fn(&str) -> Names) {
    let baseline = enabled(target, "-Copt-level=0");
    for name in &all {
        let implied = enabled(target, &format!("-Ctarget-feature=+{name}"));
        assert!(implied.contains(name), "rustc has no {name}");
        let missing = &(&implied - &baseline) - &needs(name);
        assert!(missing.is_empty(), "{name} implies {missing:?}");
    }
}

#[test]
fn implied_features_on_x86_64() {
    let all = all_of_x86_64();
    assert_eq!(all.len(), 59);
    each_needs_what_it_implies(I586, all, |name| {
        set(x86_64::Features::named(&[name]).names())
    });
}

#[test]
fn implied_features_on_aarch64() {
    let all = all_of_aarch64();
    assert_eq!(all.len(), 36);
    each_needs_what_it_implies(AARCH64, all, |name| {
        set(aarch64::Features::named(&[name]).names())
    });
}

/// `more` and `fewer` are the differences between the machine and LLVM's model of it.
fn is_like_model(target: &str, cpu: &str, all: &Names, got: Names, more: &str, fewer: &str) {
    let model = &enabled(target, &format!("-Ctarget-cpu={cpu}")) & all;
    let differences = (&got - &model, &model - &got);
    let expected = (set(more.split_whitespace()), set(fewer.split_whitespace()));
    assert_eq!(differences, expected, "{cpu}");
}

const INTEL: [u32; 3] = [0x756E_6547, 0x6C65_746E, 0x4965_6E69];
const AMD: [u32; 3] = [0x6874_7541, 0x444D_4163, 0x6974_6E65];

/// Real machines, from the test data of libcpuid, libvirt and hwloc. Some lack leaf 0xD, 1.
#[rustfmt::skip]
const X86_64_CPUS: &[(&str, Target, [u32; 3], &str, &str, [u32; 11])] = &[
    ("penryn", Portable, INTEL, "", "",
        [0xB, 0xCE3BD, 0xBFEBFBFF, 0, 0, 0, 0, 0, 0, 0, 1]),
    ("nehalem", Sse4, INTEL, "", "",
        [0xB, 0x9CE3BD, 0xBFEBFBFF, 0, 0, 0, 0, 0, 0, 0, 1]),
    ("westmere", Sse4, INTEL, "aes", "",
        [0xB, 0x29EE3FF, 0xBFEBFBFF, 0, 0, 0, 0, 0, 0, 0, 1]),
    ("sandybridge", Sse4, INTEL, "aes", "",
        [0xD, 0x1FBEE3FF, 0xBFEBFBFF, 0, 0, 0, 0, 0, 0, 1, 1]),
    ("ivybridge", Sse4, INTEL, "ermsb", "",
        [0xD, 0x7DBEE3FF, 0xBFEBFBFF, 0, 0x281, 0, 0, 0, 0, 1, 1]),
    ("haswell", Avx2, INTEL, "aes", "",
        [0xF, 0x7FFEFBFF, 0xBFEBFBFF, 0, 0x37AB, 0, 0, 0, 0, 1, 0x21]),
    ("broadwell", Avx2, INTEL, "aes", "",
        [0x14, 0x7FFEFBFF, 0xBFEBFBFF, 0, 0x21CBFBB, 0, 0, 0, 0, 1, 0x121]),
    ("skylake", Avx2, INTEL, "", "",
        [0x16, 0x7FFAFBFF, 0xBFEBFBFF, 0, 0x29C6FBF, 0x40000000, 0x9C000000, 0, 0, 0xF, 0x121]),
    ("skylake-avx512", Avx512Skx, INTEL, "", "",
        [0x16, 0x7FFEFBFF, 0xBFEBFBFF, 0, 0xD39FFFFB, 0x18, 0, 0, 0, 0xF, 0x121]),
    ("cascadelake", Avx512Skx, INTEL, "", "",
        [0x16, 0x7FFEFBFF, 0xBFEBFBFF, 0, 0xD39FFFFB, 0x818, 0xBC000400, 0, 0, 0xF, 0x121]),
    ("cooperlake", Avx512Skx, INTEL, "", "",
        [0x1F, 0x7FFEFBFF, 0xBFEBFBFF, 1, 0xD39FFFFB, 0x818, 0xBC000400, 0x20, 0, 0xF, 0x121]),
    ("cannonlake", Avx512Skx, INTEL, "", "",
        [0x16, 0x7FFAFBBF, 0xBFEBFBFF, 0, 0xF2BF67EB, 0xE, 0x9C000000, 0, 0, 0xF, 0x121]),
    ("icelake-server", Avx512Icl, INTEL, "", "",
        [0x1B, 0x7FFEFBFF, 0xBFEBFBFF, 0, 0xF3BFFFFF, 0x40417F5E, 0xBC000012, 0, 0, 0xF, 0x121]),
    ("tigerlake", Avx512Icl, INTEL, "", "xsavec xsaveopt",
        [0x1B, 0x7FFAFBBF, 0xBFEBFBFF, 0, 0xF3BFA7EB, 0x18C05FDE, 0xFC100510, 0, 0, 0, 0x121]),
    ("rocketlake", Avx512Icl, INTEL, "", "",
        [0x1B, 0x7FFAFBBF, 0xBFEBFBFF, 0, 0xF2BF67EB, 0x405F4E, 0xBC000410, 0, 0, 0xF, 0x121]),
    ("raptorlake", Avx2, INTEL, "ermsb", "",
        [0x20, 0x7FFAFBFF, 0xBFEBFBFF, 2, 0x239C27EB, 0x98C027BC, 0xFC1CC410,
            0x400810, 0x40000, 0xF, 0x121]),
    ("sapphirerapids", Avx512Icl, INTEL, "", "",
        [0x20, 0x7FFEFBFF, 0xBFEBFBFF, 2, 0xF3BFB7EF, 0xFB417FFE, 0xFFDD4432,
            0x1C30, 0x40000, 0x1F, 0x121]),
    ("knl", Avx2, INTEL, "ermsb", "",
        [0xD, 0x7FF8F3BF, 0xBFEBFBFF, 0, 0x1C0D23AB, 1, 0, 0, 0, 1, 0x121]),
    ("goldmont-plus", Sse4, INTEL, "ermsb", "xsavec xsaveopt",
        [0x18, 0x4FF8EBBF, 0xBFEBFBFF, 0, 0x2294E287, 0x40400004, 0x2C000000, 0, 0, 0, 0x101]),
    ("tremont", Sse4, INTEL, "ermsb", "",
        [0x1B, 0x4FF8EBFF, 0xBFEBFBFF, 0, 0x2394B2C3, 0x1A400124, 0xFC000400, 0, 0, 0xF, 0x101]),
    ("amdfam10", Portable, AMD, "", "",
        [5, 0x802009, 0x178BFBFF, 0, 0, 0, 0, 0, 0, 0, 0x37FF]),
    ("btver2", Sse4, AMD, "", "xsaveopt",
        [0xD, 0x3ED8220B, 0x178BFBFF, 0, 8, 0, 0, 0, 0, 0, 0x154037FF]),
    ("bdver2", Sse4, AMD, "", "",
        [0xD, 0x3E98320B, 0x178BFBFF, 0, 8, 0, 0, 0, 0, 0, 0x1EBBFFF]),
    ("znver1", Avx2, AMD, "", "",
        [0xD, 0x7ED8320B, 0x178BFBFF, 0, 0x209C01A9, 0, 0, 0, 0, 0xF, 0x35C233FF]),
    ("znver2", Avx2, AMD, "", "",
        [0x10, 0x7ED8320B, 0x178BFBFF, 0, 0x219C91A9, 0x400004, 0, 0, 0, 0xF, 0x75C237FF]),
    ("znver3", Avx2, AMD, "", "",
        [0x10, 0x7EDA320B, 0x178BFBFF, 0, 0x219C95A9, 0x40069C, 0, 0, 0, 0xF, 0x75C237FF]),
    ("znver4", Avx512Icl, AMD, "ermsb", "",
        [0x10, 0x7EFA320B, 0x178BFBFF, 1, 0xF1BF97A9, 0x415FDE, 0x10000010,
            0x20, 0, 0xF, 0x75C237FF]),
];

#[test]
fn x86_64_cpus() {
    let all = all_of_x86_64();
    for &(cpu, best, [b, c, d], more, fewer, registers) in X86_64_CPUS {
        let [last, l1c, l1d, l7a, l7b, l7c, l7d, l71a, l71d, lda, e1c] = registers;
        let cpuid = |leaf, subleaf| match (leaf, subleaf) {
            (0, _) => [last, b, c, d],
            (0x8000_0000, _) => [0x8000_0008, 0, 0, 0],
            (0x8000_0001, _) => [0, 0, e1c, 0],
            _ if leaf > last => [!0; 4],
            (1, _) => [0, 0, l1c, l1d],
            (7, 0) => [l7a, l7b, l7c, l7d],
            (7, 1) if l7a == 0 => [!0; 4],
            (7, 1) => [l71a, 0, 0, l71d],
            (0xD, 1) => [lda, 0, 0, 0],
            _ => [0; 4],
        };
        let got = x86_64::decode(cpuid, 0xE7);
        is_like_model(X86_64, cpu, &all, set(got.names()), more, fewer);
        let has = |target: &Target| got.contains(x86_64::Features::named(target.features()));
        let first = [Avx512Icl, Avx512Skx, Avx2, Sse4, Portable]
            .into_iter()
            .find(has);
        assert_eq!(first, Some(best), "{cpu}");
    }
}

const OPTIONAL: &str = "aes sha2 sha3 sm4 sve2-aes sve2-bitperm sve2-sha3 sve2-sm4";

/// `AT_HWCAP` and `AT_HWCAP2`, as QEMU 8.2 reports them.
const AARCH64_CPUS: &[(&str, u64, u64, &str, &str)] = &[
    ("cortex-a53", 0x8FB, 0, "", ""),
    ("cortex-a55", 0x11_9FFB, 0, "", ""),
    ("cortex-a72", 0x8FB, 0, "", ""),
    ("cortex-a710", 0xEFFF_FFFB, 0x6_73FF, OPTIONAL, ""),
    ("neoverse-n1", 0x11_9FFB, 0, "", ""),
    ("neoverse-v1", 0xCFFF_FFFB, 0x1_3201, "", "bf16"),
    ("neoverse-n2", 0xEFFF_FFFB, 0x7_73FF, OPTIONAL, ""),
    ("a64fx", 0x41_5FFB, 0, "", ""),
];

#[test]
fn aarch64_cpus() {
    let all = all_of_aarch64();
    for &(cpu, hwcap, hwcap2, more, fewer) in AARCH64_CPUS {
        let got = set(aarch64::from_hwcap(hwcap, hwcap2).names());
        is_like_model(AARCH64, cpu, &all, got, more, fewer);
    }
}

#[test]
fn apple_cpus() {
    let all = all_of_aarch64();
    for (cpu, lacks) in [("apple-m1", "BF16 I8MM CSSC HBC"), ("apple-m2", "CSSC HBC")] {
        let is_set = |name: &core::ffi::CStr| {
            let name = name.to_str().unwrap();
            !lacks.split_whitespace().any(|it| name.ends_with(it))
        };
        is_like_model(
            AARCH64,
            cpu,
            &all,
            set(aarch64::from_sysctl(is_set).names()),
            "",
            "",
        );
    }
}
