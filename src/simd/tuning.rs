//! Words for what is fast on some CPUs only. They choose among entries, and prove nothing. See docs/quirks.md.

#[allow(unused_imports)]
use crate::{CpuVendor::*, cpu_model};

cfg_select! {
    any(target_arch = "x86", target_arch = "x86_64") => {
        pub(crate) const NAMES: &[&str] = &["fast_pdep", "fast_gather", "fast_zmm", "fast_compress_store", "full_zmm"];
        use core::sync::atomic::{AtomicU32, Ordering::Relaxed};
        static MASKED_LOADS: AtomicU32 = AtomicU32::new(!0);

        /// All bits, or none where `vpmaskmov` from memory is slow. They join the test of the address, which so costs one more load.
        #[inline(always)]
        pub(crate) fn masked_loads() -> u32 {
            MASKED_LOADS.load(Relaxed)
        }

        fn test(has: impl Fn(&str) -> bool) -> [bool; 5] {
            let cpu = crate::detect::first_model();
            // Westmere gets none of these words.
            let intel = cpu.vendor == Intel && (cpu.family, cpu.model) != (6, 0x2c);
            let zen = |family| cpu.vendor == Amd && cpu.family >= family;
            let before_zen2 = cpu.vendor == Amd && (cpu.family, cpu.model) < (0x17, 0x30) || cpu.vendor == Hygon;
            MASKED_LOADS.store(if before_zen2 { 0 } else { !0 }, Relaxed);
            // Alder Lake, Sapphire Rapids and later.
            let recent = intel && (has("avxvnni") || has("avx512fp16"));
            let full = has("avx512f") && (intel || zen(0x1a) && crate::detect::fp512());
            [intel || zen(0x19), recent, has("avx512f") && (recent || zen(0x19)), intel || zen(0x1a), full]
        }
    }
    target_arch = "aarch64" => {
        pub(crate) const NAMES: &[&str] = &["fast_sha3", "fast_clmul", "fast_pdep"];

        fn test(has: impl Fn(&str) -> bool) -> [bool; 3] {
            let (sha3, bits) = (has("sha3"), has("sve2-bitperm") && !cfg!(target_os = "android"));
            if !sha3 && !bits {
                return [false; 3];
            }
            let cpu = cpu_model();
            let (apple, n3) = (cpu.vendor == Apple, cpu.vendor == Arm && cpu.model == 0xd8e);
            // Unknown, Neoverse N2 (also under other names) and N3, Cortex-A510, A520, A710, A715, A720 and A725.
            let narrow = [0, 0xd49, 0xd8e, 0xd46, 0xd80, 0xd47, 0xd4d, 0xd81, 0xd87].contains(&cpu.model);
            // Neoverse N2 (also as Cobalt 100), V2, V3 and N3, which have no small cores next to them.
            let server =
                matches!((cpu.family, cpu.model), (0x41, 0xd49 | 0xd4f | 0xd83 | 0xd84 | 0xd8e) | (0x6d, 0xd49));
            [
                sha3 && (apple || n3),
                sha3 && has("aes") && (apple || has("bf16") && !narrow),
                bits && server && wide(true),
            ]
        }
    }
    _ => {
        pub(crate) const NAMES: &[&str] = &[];

        fn test(_: impl Fn(&str) -> bool) -> [bool; 0] {
            []
        }
    }
}

/// For the operations of the crate: a load and a branch that always goes the same way, where that pays.
#[inline(always)]
pub(crate) fn fast_gather() -> bool {
    crate::X86 && (cfg!(target_feature = "avx512fp16") || crate::gate::is_tuned::<1>())
}

/// `vpconflict` and `vp2intersect`: Zen 4 and later, which alone have `fast_zmm` without `fast_gather`. The two features meet from Zen 5 on.
#[inline(always)]
pub(crate) fn fast_conflict() -> bool {
    cfg!(all(target_feature = "avx512vp2intersect", target_feature = "avx512bf16"))
        || crate::X86 && crate::gate::is_tuned::<2>() && !crate::gate::is_tuned::<1>()
}

/// `vpmaskmov` to memory is slow on the same CPUs as `vpcompress`, and on all before them.
#[inline(always)]
pub(crate) fn fast_masked_store() -> bool {
    crate::X86 && crate::gate::is_tuned::<3>()
}

/// Intel has one port for the minimum and the maximum of 64 bytes.
#[inline(always)]
pub(crate) fn one_port() -> bool {
    use crate::gate::is_tuned;
    crate::X86 && is_tuned::<4>() && (is_tuned::<1>() || !is_tuned::<2>())
}

/// What `set_cpu` takes out of `words`. It asks the CPU only if they have it.
pub(crate) fn dropped(words: u64) -> u64 {
    use core::sync::atomic::{AtomicBool, Ordering::Relaxed};
    static OTHER: AtomicBool = AtomicBool::new(false);
    if crate::X86 && words & 8 != 0 && !OTHER.load(Relaxed) {
        let cpu = cpu_model();
        OTHER.store((cpu.vendor, cpu.family, cpu.model) != (Intel, 6, 0x2c), Relaxed);
    }
    if crate::X86 && !OTHER.load(Relaxed) { 8 } else { 0 }
}

pub(crate) fn detect(has: impl Fn(&str) -> bool) -> u64 {
    test(has).iter().rfold(0, |bits, &it| bits << 1 | it as u64)
}

/// Before 6.2, Linux turns SVE off in each system call, and its next instruction traps. AT_RSEQ_FEATURE_SIZE came with 6.3.
pub(crate) fn wide(sve2: bool) -> bool {
    cfg_select! {
        all(target_arch = "aarch64", not(miri), any(target_os = "linux", target_os = "android")) => {
            !sve2 || crate::detect::os::auxv([27]) != [0]
        }
        _ => sve2 | true,
    }
}
