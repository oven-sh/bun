//! The tables of src/simd/detect.rs, against those of `std` on this CPU, and on made-up answers of CPUs and systems.
#![allow(dead_code, unreachable_pub)]
#![cfg_attr(any(bun_simd_sanitize = "cfi", bun_simd_sanitize = "kcfi"), feature(sanitize))]
#![allow(dead_code)]
#![allow(clippy::duplicate_mod)]

#[path = "../detect.rs"]
mod detect;
use detect::*;
use std::collections::HashMap;

/// The same tables, as on another system.
#[bun_simd_macros::rules]
macro_rules! as_on { ($($name:ident $os:tt)*) => { $(#[path = ".."] mod $name {
    macro_rules! cfg { (target_os = $os) => { true }; (target_os = $$os:tt) => { false }; ($$($$other:tt)*) => { core::cfg!($$($$other)*) }; }
    pub mod detect;
})* }; }
as_on! { netbsd "netbsd" freebsd "freebsd" android "android" windows "windows" }

fn names(bits: u64) -> Vec<&'static str> {
    NAMES.iter().enumerate().filter(|(bit, _)| bits >> bit & 1 != 0).map(|it| *it.1).collect()
}

macro_rules! of_std { ($arch:meta, $is:ident: $($name:tt)*) => {
    #[cfg($arch)]
    fn of_std() -> HashMap<&'static str, bool> { [$(($name, std::arch::$is!($name))),*].into() }
}; }
of_std! { any(target_arch = "x86", target_arch = "x86_64"), is_x86_feature_detected:
"sse2" "sse3" "pclmulqdq" "ssse3" "cmpxchg16b" "sse4.1" "sse4.2" "movbe" "popcnt" "aes" "ermsb" "adx" "sha" "gfni" "bmi1"
"bmi2" "lzcnt" "avx" "fma" "f16c" "avx2" "vaes" "vpclmulqdq" "sha512" "sm3" "sm4" "avxvnni"
"avxifma" "avxvnniint8" "avxneconvert" "avxvnniint16" "avx512f" "avx512dq" "avx512ifma" "avx512cd" "avx512bw"
"avx512vl" "avx512vbmi" "avx512vbmi2" "avx512vnni" "avx512bitalg" "avx512vpopcntdq" "avx512vp2intersect" "avx512fp16"
"avx512bf16" }
of_std! { target_arch = "aarch64", is_aarch64_feature_detected: "pmull"
"neon" "crc" "aes" "sha2" "sha3" "sm4" "lse" "fp16" "rdm" "jsconv" "fcma" "rcpc" "dotprod" "fhm" "frintts" "i8mm"
"bf16" "sve" "sve2" "sve2-aes" "sve2-bitperm" "sve2-sha3" "sve2-sm4" }
of_std! { not(any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64")), nothing: }

#[test]
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn agrees_with_std() {
    let (std, cpu) = (of_std(), bun_simd::target::cpu_model());
    let avx2 = if (cpu.family, cpu.model, cpu.stepping) == (6, 0x2c, 0) || std.get("avx") != Some(&true) {
        ""
    } else {
        "avx2"
    };
    for (name, ours) in bun_simd::target::cpu_features().filter(|it| std.contains_key(it.0)) {
        assert!(std[name] || !ours, "{name}");
        assert!(
            ours || !std[name] || !["sse4.2", "popcnt", avx2, "gfni", "crc", "sha2", "dotprod"].contains(&name),
            "{name}"
        );
    }
}

fn mask_of(name: &str) -> u64 {
    mask(&[name])
}

/// What the program is compiled for.
fn nothing() -> u64 {
    cfg_select! {
        all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
            decode(|_, _| [0; 4], || unreachable!())
        }
        all(target_arch = "aarch64", not(miri), any(target_vendor = "apple", target_os = "windows")) => {
            decode(|_| false)
        }
        target_arch = "aarch64" => decode(0, 0),
        _ => decode(),
    }
}

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads")]
fn threads_agree() {
    let all = || cpu_features().collect::<Vec<_>>();
    let seen: Vec<_> = std::thread::scope(|s| {
        (0..4).map(|_| s.spawn(all)).collect::<Vec<_>>().into_iter().map(|it| it.join().unwrap()).collect()
    });
    assert!(seen.iter().all(|it| *it == all() && *it == bun_simd::target::cpu_features().collect::<Vec<_>>()));
}

#[test]
#[cfg(panic = "unwind")]
fn unknown_names_panic() {
    assert!(std::panic::catch_unwind(|| mask_of("amx-tile")).is_err());
    assert!(has(mask(&[])));
}

#[test]
#[cfg(all(target_os = "linux", not(miri), any(target_arch = "x86_64", target_arch = "aarch64")))]
fn model_is_that_of_cpuinfo() {
    let (text, model) = (std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default(), cpu_model());
    if cfg!(target_arch = "aarch64") {
        let (cpu, tells) = (
            bun_simd::target::cpu(),
            std::fs::read("/proc/self/auxv").map_or(true, |it| it.as_chunks::<16>().0.iter().any(|it| it[0] == 27)),
        );
        let sve2 = bun_simd::target!(sve2);
        assert_eq!(cpu.includes(sve2), sve2.is_supported() && tells || sve2.is_baseline());
        assert!(!cpu.has("fast_sha3") || model.model != 0xd4f && model.model != 0xd40);
    }
    let any = |key: &str, value: u16| {
        let mut values = text
            .lines()
            .filter_map(|it| it.split_once(':'))
            .filter(|it| it.0.trim() == key)
            .map(|it| it.1.trim())
            .peekable();
        values.peek().is_none()
            || values
                .any(|it| it == format!("{value}") || it == format!("0x{value:02x}") || it == format!("0x{value:03x}"))
    };
    // An emulator can show the file of its host.
    if std::env::var_os("TARGET").is_some() {
        let keys = if cfg!(target_arch = "x86_64") { ["cpu family", "model"] } else { ["CPU implementer", "CPU part"] };
        assert!(any(keys[0], model.family) && any(keys[1], model.model), "{model:?}");
        assert_ne!(model.vendor, CpuVendor::Other);
    }
}

#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
mod x86 {
    use super::*;
    const INTEL: [u32; 3] = [0x756e6547, 0x6c65746e, 0x49656e69];
    const AMD: [u32; 3] = [0x68747541, 0x444d4163, 0x69746e65];

    /// Sets all bits, even of leaves that it doesn't have, but for one.
    fn cpu(
        vendor: [u32; 3],
        basic: u32,
        extended: u32,
        xcr0: u64,
        without: (u32, u32, usize, u32),
    ) -> Vec<&'static str> {
        let cpuid = |leaf: u32, sub| {
            assert!(leaf <= basic || (1 << 31..=extended.max(1 << 31)).contains(&leaf), "leaf {leaf:x}");
            let mut words = match leaf {
                0 => [basic, vendor[0], vendor[1], vendor[2]],
                0x8000_0000 => [extended, 0, 0, 0],
                7 if sub == 0 => [3, !0, !0, !0],
                _ => [!0; 4],
            };
            if (leaf, sub) == (without.0, without.1) {
                words[without.2] &= !(1 << without.3);
            }
            words
        };
        let read = || {
            assert!(without != (1, 0, 2, 26) && without != (1, 0, 2, 27) && basic >= 1, "XGETBV faults");
            xcr0
        };
        names(decode(cpuid, read) & !nothing())
    }
    const NONE: (u32, u32, usize, u32) = (99, 0, 0, 0);
    const LEGACY: &str =
        "sse3 pclmulqdq ssse3 cmpxchg16b sse4.1 sse4.2 movbe popcnt aes ermsb adx sha gfni bmi1 bmi2 lzcnt";
    fn wide(name: &str) -> bool {
        name.starts_with("avx512")
    }

    #[test]
    #[cfg_attr(any(miri, target_os = "netbsd"), ignore = "slow, or without AVX")]
    fn state_of_the_system() {
        let all = cpu(AMD, 0x24, 0x8000_0001, !0, NONE);
        assert_eq!(
            all,
            names(!nothing()).into_iter().filter(|it| !(cfg!(target_vendor = "apple") && wide(it))).collect::<Vec<_>>()
        );
        for bit in 0..64 {
            let expected = |name: &&str| match bit {
                1 | 2 => LEGACY.split(' ').any(|it| it == *name),
                5..=7 => !wide(name),
                _ => true,
            };
            assert_eq!(
                cpu(AMD, 0x24, 0x8000_0001, !(1 << bit), NONE),
                all.iter().copied().filter(expected).collect::<Vec<_>>(),
                "XCR0 {bit}"
            );
        }
        for bit in [26, 27] {
            assert!(
                cpu(AMD, 0x24, 0x8000_0001, !0, (1, 0, 2, bit)).iter().all(|it| LEGACY.split(' ').any(|l| l == *it))
            );
        }
    }

    #[test]
    #[cfg_attr(any(miri, target_os = "netbsd"), ignore = "slow, or without AVX")]
    fn each_feature_depends_on_a_bit_of_its_own() {
        let (all, mut lost) = (cpu(AMD, 0x24, 0x8000_0001, !0, NONE), vec![]);
        for (leaf, sub) in [(1, 0), (7, 0), (7, 1), (0x8000_0001, 0)] {
            for (word, bit) in (0..4).flat_map(|word| (0..32).map(move |bit| (word, bit))) {
                let left = cpu(AMD, 0x24, 0x8000_0001, !0, (leaf, sub, word, bit));
                let mut gone = all.iter().filter(|it| !left.contains(it));
                // FMA, F16C and "avx512f" take all of AVX-512 along.
                let first = if (leaf, word, bit) == (1, 2, 28) { Some(&"avx") } else { gone.next() };
                lost.extend(first.filter(|_| !(leaf == 1 && word == 2 && (bit == 26 || bit == 27))));
            }
        }
        lost.retain(|it| all.contains(it));
        lost.sort();
        // What takes others along is not seen to go, if the program is compiled for it.
        if cfg!(target_feature = "fma") {
            lost.dedup()
        }
        let mut sorted = all;
        sorted.sort();
        assert_eq!(lost, sorted);
    }

    #[test]
    fn windows_in_user_mode() {
        assert_eq!(windows::detect::all(), all());
    }

    #[test]
    fn odd_reports() {
        for basic in [0, 1, 6, 7, 0x23] {
            for extended in [0, 0x16, 1 << 31, !0] {
                let found = cpu(INTEL, basic, extended, !0, NONE);
                assert!(!found.contains(&"lzcnt"));
                assert!(basic >= 7 || !found.contains(&"avx2") && !found.contains(&"avxvnni"));
            }
        }
        let bmi = |vendor, without| cpu(vendor, 7, 0, 7, without).iter().filter(|it| it.starts_with("bmi")).count();
        if nothing() & mask(&["bmi1"]) == 0 {
            assert_eq!([bmi(INTEL, NONE), bmi(INTEL, (1, 0, 2, 28)), bmi(AMD, (1, 0, 2, 28))], [2, 0, 2]);
        }
        let subleaf = |it: u32| decode(|leaf, sub| [if (leaf, sub) == (7, 1) { it } else { !0 }; 4], || !0);
        assert_eq!(subleaf(!0), subleaf(0));
        // golang/go#80285
        let netbsd =
            netbsd::detect::decode(|leaf, _| if leaf == 1 << 31 { [leaf + 1, 0, 0, 0] } else { [!0; 4] }, || !0);
        assert!(
            names(netbsd & !nothing()).iter().all(|it| LEGACY.split(' ').any(|l| l == *it))
                && netbsd & mask_of("sse4.2") != 0
        );
    }
}

#[cfg(all(target_arch = "aarch64", not(any(target_vendor = "apple", target_os = "windows"))))]
mod hwcap {
    use super::*;
    fn found(a: u64, b: u64) -> String {
        names(decode(a, b) & !mask_of("neon")).join(" ")
    }

    #[test]
    fn odd_reports() {
        if nothing() & !mask(&["neon", "crc"]) != 0 {
            return;
        }
        assert_eq!(android::detect::decode(!0, !0), (1 << NAMES.len()) - 1);
        // Galaxy S9 with Android 8: golang/go#28431.
        assert_eq!(found(0x7ff, 0), "crc aes sha2");
        assert_eq!(
            found(0x17ff, 0),
            if cfg!(target_os = "android") { "crc aes sha2" } else { "crc aes sha2 lse fp16 rdm" }
        );
        assert_eq!(names(android::detect::decode(!(1 << 11), !0)), ["neon", "crc", "aes", "sha2"]);
        assert!(!names(freebsd::detect::decode(!0, !0)).join(" ").contains("sve"));
        // SVE2 without SVE, as in virtual machines on Apple M4: oven-sh/bun#45099.
        assert!(!found(!(1 << 22), !0).contains("sve"));
        for (name, bits) in
            [("aes", [3, 4]), ("sha2", [5, 6]), ("sha3", [17, 21]), ("sm4", [18, 19]), ("fp16", [9, 10])]
        {
            assert!(bits.iter().all(|bit| decode(!(1 << bit), !0) & mask_of(name) == 0));
        }
    }

    #[test]
    #[cfg(all(any(target_os = "linux", target_os = "android"), not(miri)))]
    fn the_kernel_tells_the_same_as_libc() {
        let keys = [16, 26, 6, 999];
        assert_eq!(os::from_kernel(keys), os::auxv(keys));
        assert!(os::auxv(keys)[0] != 0 && os::auxv(keys)[3] == 0);
    }
}
