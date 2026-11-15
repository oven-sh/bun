#![cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use bun_simd_trusted::{AtomicFn, Features, detected, gate};

#[test]
fn a_function_is_swapped_under_its_callers() {
    static F: AtomicFn<fn(&[u8]) -> &u8> = AtomicFn::new(|bytes| &bytes[0]);
    std::thread::scope(|s| {
        s.spawn(|| F.set(|bytes| &bytes[1]));
        assert!(matches!(F.get()(&[1, 2]), 1 | 2));
    });
    assert_eq!(*F.get()(&[1, 2]), 2);
}

#[test]
fn a_target_is_supported_if_its_features_are() {
    let is_supported = cfg_select! {
        target_arch = "x86_64" => [
            gate::avx512_icl::is_supported(),
            gate::avx512_skx::is_supported(),
            gate::avx2::is_supported(),
            gate::sse4::is_supported(),
        ],
        _ => [gate::neon::is_supported()],
    };
    let of_arch = gate::TARGETS
        .iter()
        .filter(|target| target.1 == std::env::consts::ARCH);
    let has_features = of_arch.map(|target| detected().contains(Features::named(target.2)));
    assert!(has_features.eq(is_supported));
}

#[cfg(all(
    miri,
    target_arch = "x86_64",
    target_os = "linux",
    not(target_feature = "sse3")
))]
#[test]
fn miri_has_what_the_program_is_compiled_for() {
    assert!(detected().names().eq(["fxsr", "sse", "sse2"]));
}

/// The names that Linux has for them. With none, it does not tell.
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
        f32mm=svef32mm f64mm=svef64mm sve2-aes=svepmull sve2-bitperm=svebitperm
        sve2-sha3=svesha3 sve2-sm4=svesm4"
    }
};

#[cfg(all(target_os = "linux", not(miri)))]
#[test]
fn linux_sees_the_same_features() {
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
        _ => bun_simd_trusted::aarch64::from_hwcap(!0, !0),
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
