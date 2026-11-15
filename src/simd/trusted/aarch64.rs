//! From what the system says to features. Asks nothing itself.
use core::ffi::CStr;

/// All of a list have to be there. With an empty one, the system has no way to tell.
struct Source {
    /// Bits of `AT_HWCAP`, and from 64 on of `AT_HWCAP2`.
    hwcap: &'static [u8],
    sysctl: &'static [&'static CStr],
    /// `PF_ARM_..` in winnt.h
    windows: &'static [u8],
}

const fn c_str(name: &str) -> &CStr {
    match CStr::from_bytes_with_nul(name.as_bytes()) {
        Ok(name) => name,
        Err(_) => panic!(),
    }
}

macro_rules! from {
    ([$($hwcap:expr),*] [$($sysctl:literal),*] [$($windows:literal),*]) => {
        Source {
            hwcap: &[$($hwcap),*],
            sysctl: &[$(c_str(concat!("hw.optional.", $sysctl, "\0"))),*],
            windows: &[$($windows),*],
        }
    };
}

features! { "aarch64", Source;
    "neon" = from!([0, 1] ["floatingpoint", "neon"] [19]);
    "crc" = from!([7] ["armv8_crc32"] [31]);
    "lse" = from!([8] ["arm.FEAT_LSE"] [34]);
    "lse2" = from!([25] ["arm.FEAT_LSE2"] [62]);
    "lse128" ("lse") = from!([64 + 47] [] []);
    "rcpc" = from!([15] ["arm.FEAT_LRCPC"] [45]);
    "rcpc2" ("rcpc") = from!([26] ["arm.FEAT_LRCPC2"] []);
    "rcpc3" ("rcpc2") = from!([64 + 46] [] []);
    "flagm" = from!([27] ["arm.FEAT_FlagM"] []);
    "flagm2" ("flagm") = from!([64 + 7] ["arm.FEAT_FlagM2"] []);
    "cssc" = from!([64 + 34] ["arm.FEAT_CSSC"] []);
    "mops" = from!([64 + 43] [] []);
    "hbc" = from!([64 + 44] ["arm.FEAT_HBC"] []);
    "aes" ("neon") = from!([3, 4] ["arm.FEAT_AES", "arm.FEAT_PMULL"] [30]);
    "sha2" ("neon") = from!([5, 6] ["arm.FEAT_SHA1", "arm.FEAT_SHA256"] [30]);
    "sha3" ("sha2") = from!([17, 21] ["arm.FEAT_SHA3", "arm.FEAT_SHA512"] [64, 65]);
    "sm4" ("neon") = from!([18, 19] [] []);
    "rdm" ("neon") = from!([12] ["arm.FEAT_RDM"] [43]);
    "jsconv" ("neon") = from!([13] ["arm.FEAT_JSCVT"] [44]);
    "fcma" ("neon") = from!([14] ["arm.FEAT_FCMA"] []);
    "dotprod" ("neon") = from!([20] ["arm.FEAT_DotProd"] [43]);
    "fp16" ("neon") = from!([9, 10] ["arm.FEAT_FP16"] [67]);
    "fhm" ("fp16") = from!([23] ["arm.FEAT_FHM"] []);
    "frintts" ("neon") = from!([64 + 8] ["arm.FEAT_FRINTTS"] []);
    "i8mm" ("neon") = from!([64 + 13] ["arm.FEAT_I8MM"] [66]);
    "bf16" ("neon") = from!([64 + 14] ["arm.FEAT_BF16"] [68]);
    "lut" ("neon") = from!([64 + 49] [] []);
    "faminmax" ("neon") = from!([64 + 50] [] []);
    "sve" ("fp16") = from!([22] [] [46]);
    "f32mm" ("sve") = from!([64 + 10] [] [58]);
    "f64mm" ("sve") = from!([64 + 11] [] [59]);
    "sve2" ("sve") = from!([64 + 1] [] [47]);
    "sve2p1" ("sve2") = from!([64 + 36] [] [48]);
    "sve2-aes" ("sve2", "aes") = from!([64 + 2, 64 + 3] [] [49, 50]);
    "sve2-bitperm" ("sve2") = from!([64 + 4] [] [51]);
    "sve2-sha3" ("sve2", "sha3") = from!([64 + 5] [] [55]);
    "sve2-sm4" ("sve2", "sm4") = from!([64 + 6] [] []);
}

/// Next to SVE, the compiler uses the SVE forms of these two, which are reported apart.
fn with_sve_forms(features: Features, i8mm: bool, bf16: bool) -> Features {
    let has_sve = features.0 >> index_of("sve") & 1 != 0;
    let lacks = |name, has: bool| u64::from(has_sve && !has) << index_of(name);
    Features(features.0 & !(lacks("i8mm", i8mm) | lacks("bf16", bf16)))
}

fn all<T>(list: &[T], has: impl Fn(&T) -> bool) -> bool {
    !list.is_empty() && list.iter().all(has)
}

/// Linux, Android, FreeBSD and OpenBSD
pub fn from_hwcap(hwcap: u64, hwcap2: u64) -> Features {
    let has = |&bit: &u8| (u128::from(hwcap2) << 64 | u128::from(hwcap)) >> bit & 1 != 0;
    with_sve_forms(
        Features::reported(|source| all(source.hwcap, has)),
        has(&(64 + 9)),
        has(&(64 + 12)),
    )
}

/// Before Android 9, the kernel for the Exynos 9810 reports what only its small cores have.
pub fn on_android(hwcap: u64, hwcap2: u64, ro_arch: &[u8]) -> Features {
    if ro_arch.starts_with(b"exynos9810") {
        from_hwcap(hwcap & 0xFF, 0)
    } else {
        from_hwcap(hwcap, hwcap2)
    }
}

pub fn from_sysctl(is_set: impl Fn(&CStr) -> bool) -> Features {
    Features::reported(|source| all(source.sysctl, |name| is_set(name)))
}

pub fn from_windows(is_present: impl Fn(u32) -> bool) -> Features {
    with_sve_forms(
        Features::reported(|source| all(source.windows, |&n| is_present(n.into()))),
        is_present(57),
        is_present(52),
    )
}
