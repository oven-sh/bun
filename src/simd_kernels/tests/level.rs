use bun_simd::target::{Target, cpu, reset_cpu, set_cpu};
use bun_simd_kernels::level::{detect, detected, lower_to_baseline};
use bun_simd_kernels::zstd::{count_bytes, write_codes};
use std::io::Write;

/// Whether the baseline is above some of the levels.
const IS_HIGH: bool = cfg!(any(target_feature = "avx2", target_feature = "dotprod"));

#[test]
fn names_and_lowers() {
    assert_eq!(detected(), "baseline");
    for (target, name) in [
        ("sse4", "sse4"),
        ("avx2", "avx2 without aes"),
        ("avx2 + aes", "avx2"),
        ("avx512", "avx2 without aes"),
        ("avx512 + aes", "avx512"),
        ("icelake", "icelake"),
        ("neon", "neon"),
        ("neon82", "neon82"),
    ] {
        if Target::parse(target).is_some_and(set_cpu) {
            detect();
            assert!(detected() == name || IS_HIGH && cpu().is_baseline());
            let runs = detected() == "icelake" || cfg!(feature = "test_support");
            assert_eq!(count_bytes(&[]).is_some(), runs);
            assert_eq!(write_codes(&[], &[0; 256], &mut []).is_some(), runs);
        }
    }
    // Not `eprintln!`, which a test that passes doesn't show.
    let all = Target::ALL.iter();
    let skipped: Vec<_> = all
        .filter(|&&it| it.includes(it) && !it.is_supported())
        .collect();
    drop(writeln!(std::io::stderr(), "not on this CPU: {skipped:?}"));
    reset_cpu();
    detect();
    let best = detected();
    lower_to_baseline();
    assert!(cpu().is_baseline());
    assert_eq!(detected(), best);
}
