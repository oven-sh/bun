#![cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use bun_simd_trusted::{AtomicFn, Features, Target, detected, if_supported};

#[test]
fn atomic_fn_with_a_concurrent_set() {
    static F: AtomicFn<fn(&[u8]) -> &u8> = AtomicFn::new(|bytes| &bytes[0]);
    std::thread::scope(|s| {
        s.spawn(|| F.set(|bytes| &bytes[1]));
        assert!(matches!(F.get()(&[1, 2]), 1 | 2));
    });
    assert_eq!(*F.get()(&[1, 2]), 2);
}

#[test]
fn target_is_supported_if_its_features_are() {
    for target in Target::ALL {
        let is_for_this_arch = target.arch().is_none_or(|it| it == std::env::consts::ARCH);
        let has_features = || detected().contains(Features::named(target.features()));
        assert_eq!(target.is_supported(), is_for_this_arch && has_features());
    }
}

#[test]
fn features_in_the_build() {
    let is_in_build = |name| Features::IN_BUILD.contains(Features::named(&[name]));
    cfg_select! {
        target_arch = "x86_64" => {
            assert!(["fxsr", "sse", "sse2"].into_iter().all(is_in_build));
            assert_eq!(
                is_in_build("cmpxchg16b"),
                cfg!(target_feature = "cmpxchg16b")
            );
            assert_eq!(is_in_build("avx512bw"), cfg!(target_feature = "avx512bw"));
        }
        _ => {
            assert!(is_in_build("neon"));
            assert_eq!(is_in_build("crc"), cfg!(target_feature = "crc"));
            assert_eq!(is_in_build("sve2"), cfg!(target_feature = "sve2"));
        }
    }
    assert!(detected().contains(Features::IN_BUILD));
}

#[test]
fn gate_opens_if_the_features_are_detected() {
    cfg_select! {
        target_arch = "x86_64" => {
            #[target_feature(enable = "avx512bw")]
            fn kernel() {}
            let (feature, gated) = ("avx512bw", if_supported!(["avx512bw"], fn(), kernel));
        }
        _ => {
            #[target_feature(enable = "sve2")]
            fn kernel() {}
            let (feature, gated) = ("sve2", if_supported!(["sve2"], fn(), kernel));
        }
    }
    assert_eq!(gated.is_some(), detected().names().any(|it| it == feature));
}

#[cfg(all(
    miri,
    target_arch = "x86_64",
    target_os = "linux",
    not(target_feature = "sse3")
))]
#[test]
fn miri_has_the_features_in_the_build() {
    assert!(detected().names().eq(["fxsr", "sse", "sse2"]));
}

/// The names in /proc/cpuinfo. None if Linux does not report the feature.
#[cfg(all(target_os = "linux", not(miri)))]
const IN_CPUINFO: &str = cfg_select! {
    target_arch = "x86_64" => {
        "
        sse3=pni sse4.1=sse4_1 sse4.2=sse4_2 lzcnt=abm cmpxchg16b=cx16 lahfsahf=lahf_lm
        prfchw=3dnowprefetch ermsb=erms sha=sha_ni avxvnni=avx_vnni avx512vbmi2=avx512_vbmi2
        avx512vnni=avx512_vnni avx512bitalg=avx512_bitalg avx512vpopcntdq=avx512_vpopcntdq
        avx512vp2intersect=avx512_vp2intersect avx512fp16=avx512_fp16 avx512bf16=avx512_bf16
        sm3= sm4= sha512= avxifma= avxvnniint8= avxneconvert= avxvnniint16= avx10.1= avx10.2="
    }
    _ => {
        "
        neon=asimd crc=crc32 lse=atomics lse2=uscat rcpc=lrcpc rcpc2=ilrcpc rcpc3=lrcpc3
        rdm=asimdrdm jsconv=jscvt dotprod=asimddp fp16=asimdhp fhm=asimdfhm frintts=frint
        f32mm=svef32mm sve2-aes=svepmull sve2-bitperm=svebitperm
        sve2-sha3=svesha3 sve2-sm4=svesm4"
    }
};

#[cfg(all(target_os = "linux", not(miri)))]
#[test]
fn agrees_with_proc_cpuinfo() {
    let all = cfg_select! {
        target_arch = "x86_64" => bun_simd_trusted::x86_64::decode(
            |leaf, _| {
                if leaf == 0x8000_0000 {
                    [leaf + 1; 4]
                } else {
                    [!0; 4]
                }
            },
            !0,
        ),
        _ => bun_simd_trusted::aarch64::from_hwcap(
            bun_simd_trusted::aarch64::kept_by_linux(
                !0,
                &std::fs::read("/proc/sys/kernel/osrelease").unwrap(),
            ),
            !0,
        ),
    };
    let cpuinfo = std::fs::read_to_string("/proc/cpuinfo").unwrap();
    let is_list = |line: &&str| line.starts_with("flags") || line.starts_with("Features");
    let list = cpuinfo.lines().find(is_list).unwrap();
    for feature in all.names() {
        let mut pairs = IN_CPUINFO
            .split_whitespace()
            .filter_map(|it| it.split_once('='));
        let name = pairs.find(|it| it.0 == feature).map_or(feature, |it| it.1);
        if !name.is_empty() {
            assert_eq!(
                detected().contains(Features::named(&[feature])),
                list.split_whitespace().any(|it| it == name),
                "{feature}"
            );
        }
    }
}
