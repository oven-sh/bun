//! `pdep` and `pext`, which 32-bit x86 does in two parts, with masks that no caller passes there.

#[crate::kernel(targets = crate::Targets::ALL)]
fn both(bits: u64, at: u64) -> Option<[u64; 2]> {
    let s = S::default();
    if S::BMI1 { Some([s.deposit(bits, at), s.extract(bits, at)]) } else { None }
}

#[test]
fn deposit_and_extract() {
    let mut state = 1;
    for i in 0..if cfg!(miri) { 6 } else { 300 } {
        let (bits, a, b) = (super::random(&mut state), super::random(&mut state), super::random(&mut state));
        for at in [a, a & b, a | b, !0 >> (i % 64), !0 << (i % 64), 1 << (i % 64), 0] {
            let places = || (0..64).filter(|bit| at >> bit & 1 == 1).enumerate();
            let want = [
                places().map(|(k, bit)| (bits >> k & 1) << bit).sum(),
                places().map(|(k, bit)| (bits >> bit & 1) << k).sum(),
            ];
            for target in both::targets() {
                let got = both::to(target, bits, at).unwrap();
                assert!(got.is_none_or(|it| it == want), "{target:?} {bits:x} {at:x}");
            }
        }
    }
}

#[crate::kernel(targets = crate::Targets::ALL)]
fn compressed() -> [usize; 4] {
    S::COMPRESS
}

/// The widest vector that is compressed in registers, for lanes of 1, 2, 4 and 8 bytes. Many branches take 64 to mean that there are instructions for it.
#[test]
fn what_is_compressed_in_registers() {
    for target in compressed::targets() {
        let (has, wide) = (|it| target.has(it), !target.has_word("narrow"));
        let all = has("avx512vbmi2");
        let want = [1, 2, 4, 8].map(|size| match size {
            _ if all => 64,
            4 | 8 if has("avx512f") => 64,
            _ if has("avx512f") && wide => 16 * size,
            4 | 8 if has("avx2") => 32,
            _ => (8 * size).min(16),
        });
        assert_eq!(compressed::to(target), Some(want), "{target:?}");
    }
}

#[crate::kernel(targets = crate::Targets::ALL)]
fn first(n: usize) -> u64 {
    let s = S::default();
    crate::partial::first_on(s, n)
}

/// Also on the targets for which nothing calls it.
#[test]
fn the_first_bits() {
    for target in first::targets() {
        for n in (0..300).chain([511, 512, 1 << 16, usize::MAX]) {
            assert_eq!(first::to(target, n), Some((0..n.min(64)).map(|bit| 1 << bit).sum()), "{target:?} {n}");
        }
    }
}
