//! Decodes the answers of the operating system.
use crate::features::{Arch, Feature, major_and_minor, row};
use core::ffi::CStr;

/// Every entry of a list is required. An empty list means that the system cannot report it.
pub struct Source {
    /// Bits of `AT_HWCAP`, and from 64 on, of `AT_HWCAP2`.
    hwcap: &'static [u8],
    sysctl: &'static [&'static CStr],
    /// `PF_ARM_..` in winnt.h
    windows: &'static [u8],
}

const fn from(
    hwcap: &'static [u8],
    sysctl: &'static [&'static CStr],
    windows: &'static [u8],
) -> Source {
    Source {
        hwcap,
        sysctl,
        windows,
    }
}

pub struct Aarch64;

pub type Features = crate::features::Features<Aarch64>;

impl Arch for Aarch64 {
    type Source = Source;

    #[rustfmt::skip]
    const FEATURES: &'static [Feature<Source>] = &[
        row!("neon", [], from(
            &[0, 1], &[c"hw.optional.floatingpoint", c"hw.optional.neon"], &[19],
        )),
        row!("crc", [], from(&[7], &[c"hw.optional.armv8_crc32"], &[31])),
        row!("lse", [], from(&[8], &[c"hw.optional.arm.FEAT_LSE"], &[34])),
        row!("lse2", [], from(&[25], &[c"hw.optional.arm.FEAT_LSE2"], &[62])),
        row!("lse128", ["lse"], from(&[64 + 47], &[], &[])),
        row!("rcpc", [], from(&[15], &[c"hw.optional.arm.FEAT_LRCPC"], &[45])),
        row!("rcpc2", ["rcpc"], from(&[26], &[c"hw.optional.arm.FEAT_LRCPC2"], &[])),
        row!("rcpc3", ["rcpc2"], from(&[64 + 46], &[], &[])),
        row!("flagm", [], from(&[27], &[c"hw.optional.arm.FEAT_FlagM"], &[])),
        row!("flagm2", ["flagm"], from(&[64 + 7], &[c"hw.optional.arm.FEAT_FlagM2"], &[])),
        row!("cssc", [], from(&[64 + 34], &[c"hw.optional.arm.FEAT_CSSC"], &[])),
        row!("mops", [], from(&[64 + 43], &[], &[])),
        row!("hbc", [], from(&[64 + 44], &[c"hw.optional.arm.FEAT_HBC"], &[])),
        row!("aes", ["neon"], from(
            &[3, 4], &[c"hw.optional.arm.FEAT_AES", c"hw.optional.arm.FEAT_PMULL"], &[30],
        )),
        row!("sha2", ["neon"], from(
            &[5, 6], &[c"hw.optional.arm.FEAT_SHA1", c"hw.optional.arm.FEAT_SHA256"], &[30],
        )),
        row!("sha3", ["sha2"], from(
            &[17, 21], &[c"hw.optional.arm.FEAT_SHA3", c"hw.optional.arm.FEAT_SHA512"], &[64, 65],
        )),
        row!("sm4", ["neon"], from(&[18, 19], &[], &[])),
        row!("rdm", ["neon"], from(&[12], &[c"hw.optional.arm.FEAT_RDM"], &[43])),
        row!("jsconv", ["neon"], from(&[13], &[c"hw.optional.arm.FEAT_JSCVT"], &[44])),
        row!("fcma", ["neon"], from(&[14], &[c"hw.optional.arm.FEAT_FCMA"], &[])),
        row!("dotprod", ["neon"], from(&[20], &[c"hw.optional.arm.FEAT_DotProd"], &[43])),
        row!("fp16", ["neon"], from(&[9, 10], &[c"hw.optional.arm.FEAT_FP16"], &[67])),
        row!("fhm", ["fp16"], from(&[23], &[c"hw.optional.arm.FEAT_FHM"], &[])),
        row!("frintts", ["neon"], from(&[64 + 8], &[c"hw.optional.arm.FEAT_FRINTTS"], &[])),
        row!("i8mm", ["neon"], from(&[64 + 13], &[c"hw.optional.arm.FEAT_I8MM"], &[66])),
        row!("bf16", ["neon"], from(&[64 + 14], &[c"hw.optional.arm.FEAT_BF16"], &[68])),
        row!("lut", ["neon"], from(&[64 + 49], &[], &[])),
        row!("faminmax", ["neon"], from(&[64 + 50], &[], &[])),
        row!("sve", ["fp16"], from(&[22], &[], &[46])),
        row!("f32mm", ["sve"], from(&[64 + 10], &[], &[58])),
        row!("sve2", ["sve"], from(&[64 + 1], &[], &[47])),
        row!("sve2p1", ["sve2"], from(&[64 + 36], &[], &[48])),
        row!("sve2-aes", ["sve2", "aes"], from(&[64 + 2, 64 + 3], &[], &[49, 50])),
        row!("sve2-bitperm", ["sve2"], from(&[64 + 4], &[], &[51])),
        row!("sve2-sha3", ["sve2", "sha3"], from(&[64 + 5], &[], &[55])),
        row!("sve2-sm4", ["sve2", "sm4"], from(&[64 + 6], &[], &[])),
    ];
}

/// With SVE, the compiler uses the SVE forms of these two, which are reported separately.
fn with_sve_forms(features: Features, i8mm: bool, bf16: bool) -> Features {
    let has_sve = features.0 >> Features::index_of("sve") & 1 != 0;
    let lacks = |name, has: bool| u64::from(has_sve && !has) << Features::index_of(name);
    Features::from_bits(features.0 & !(lacks("i8mm", i8mm) | lacks("bf16", bf16)))
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

pub const HWCAP_SVE: u64 = 1 << 22;

/// Before 6.2, SVE traps after each system call. RHEL 9 has a fix in 5.14.0.
pub fn kept_by_linux(hwcap: u64, release: &[u8]) -> u64 {
    match major_and_minor(release) {
        Some((6, 2..) | (7.., _)) => hwcap,
        _ if release.starts_with(b"5.14.0") => hwcap,
        _ => hwcap & !HWCAP_SVE,
    }
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
