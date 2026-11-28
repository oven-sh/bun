#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::no_effect)]
use bun_simd::{target::*, *};
#[path = "framework/on.rs"]
mod on;
use on::*;

const LAST: Targets = Targets(&[Target::ALL[Target::ALL.len() - 1]]);

#[kernel(targets = Targets::ALL)]
fn any() -> Target {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    S::TARGET
}
#[kernel]
fn default() -> Target {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    S::TARGET
}
#[kernel(targets = LAST)]
fn last() -> Target {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    S::TARGET
}
#[kernel(targets = Targets::ALL)]
fn nested() -> Target {
    any::here()
}
#[kernel(sse4 + aes + sha, avx2 + aes, neon82 + aes + sha3 + fcma + sm4, sve2 + aes + sha3)]
fn aside() -> Target {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    S::TARGET
}
#[kernel(sse4 + aes + sha, neon82 + aes + sha3 + fcma + sm4, neon)]
fn only_aside() -> Target {
    let s: S = bun_simd::prelude::isa();
    let _ = s;
    S::TARGET
}
#[kernel]
#[allow(clippy::needless_lifetimes)]
fn borrows<'a, T: Lane>(from: &'a [T], n: usize) -> &'a [T] {
    let s: S = bun_simd::prelude::isa();
    &from[n.min(s.native::<T>().lanes())..]
}
#[kernel]
fn panics(owned: String) {
    let s: S = bun_simd::prelude::isa();
    s.native::<u8>().load(owned.as_bytes());
}
#[kernel]
fn without_attribute(a: u8, b: u64) -> u64 {
    let s: S = bun_simd::prelude::isa();
    s.native::<u8>().splat(a)[0] as u64 + b
}

/// What the program is compiled for is added to the CPU.
fn with_baseline(cpu: Target, it: Target) -> bool {
    let wide = |it: Target| it.has_word("avx512") && !it.has_word("narrow");
    it.is_baseline()
        || it.features().iter().all(|it| cpu.has(it) || Baseline::TARGET.has(it))
            && (!wide(it) || wide(cpu) || cfg!(target_feature = "avx512f"))
}

// One test, because `set_cpu` is global.
#[test]
fn dispatch_picks_what_the_cpu_has() {
    let best = *Target::ALL.iter().rfind(|&&it| cpu().includes(it)).unwrap();
    // Not on old kernels.
    assert!(Target::ALL.iter().all(|&it| it.is_supported() == cpu().includes(it) || it.has("sve2")));
    let all = cpu();
    assert!(any() == best && all.includes(best) && all.is_supported());
    for (i, &target) in Target::ALL.iter().enumerate() {
        assert_eq!(set_cpu(target), target.is_supported());
        assert_eq!(any::to(target), target.is_supported().then_some(target));
        assert!(!target.is_baseline() || target.is_supported());
        for chosen in [any(), default(), last(), nested(), any::baseline(), default::baseline(), last::baseline()] {
            assert!(
                chosen.is_supported() && (cpu().includes(chosen) || chosen.is_baseline()),
                "{chosen:?} on {:?}",
                cpu()
            );
        }
        assert_eq!(nested(), any());
        if target.is_supported() && !Target::ALL[i + 1..].iter().any(|&it| with_baseline(target, it)) {
            assert_eq!(any(), target);
        }
    }
    for &target in Target::ALL.iter().filter(|&&it| {
        it == bun_simd::target!(sse4 + aes + sha) || it == bun_simd::target!(neon82 + aes + fcma + sha3 + sm4)
    }) {
        assert_eq!(set_cpu(target), target.is_supported());
        assert_eq!(any::to(target), target.is_supported().then_some(target));
        assert!(
            !target.is_supported()
                || (aside() == target
                    && (target.includes(cpu())
                        || !target.includes(Baseline::TARGET)
                        || cfg!(target_feature = "cmpxchg16b"))
                    && Target::ALL.contains(&any()))
        );
        set_cpu(Target::Portable);
        assert!(aside().is_baseline());
        reset_cpu();
        assert_eq!(
            (aside() == target, only_aside() == target, cpu()),
            (target.is_supported(), target.is_supported(), all)
        );
    }
    set_cpu(best);
    assert!(any::baseline().is_baseline() && Baseline::TARGET.is_baseline());
    assert!(Baseline::TARGET.includes(any::baseline()));
}

#[test]
fn includes_compares_features() {
    for &a in Target::ALL {
        for (i, &b) in Target::ALL.iter().enumerate() {
            let narrower = a.has_word("narrow") && b.has_word("avx512") && !b.has_word("narrow");
            assert_eq!(a.includes(b), !narrower && b.features().iter().all(|it| a.has(it)));
            let chosen = Targets(&Target::ALL[i..=i]).choose(a);
            assert_eq!(chosen, if with_baseline(a, b) { b } else { Target::Portable });
        }
    }
}

#[test]
fn arguments() {
    assert_eq!(borrows(&[1u32, 2, 3], 1), [2, 3]);
    assert_eq!(without_attribute(1, 2), 3);
    #[cfg(panic = "unwind")]
    assert!(std::panic::catch_unwind(|| panics("short".into())).is_err());
    panics("long".repeat(16));
}

#[test]
#[cfg(panic = "unwind")]
fn short_slices_panic() {
    macro_rules! panics { ($($e:expr;)*) => { $(assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { $e; })).is_err(), stringify!($e));)* }; }
    let (d, wide) = (baseline().of::<u16, B16>(), baseline().of::<u16, B64>());
    let (v, w) = (d.zero(), wide.zero());
    panics! {
        d.load(&[0; 7]); d.load_last(&[0; 7]); d.load_block(&[0; 7]); d.load_at(&[0u16; 8][..], 1); d.load_at(&[0u16; 8][..], usize::MAX);
        d.load_interleaved::<2>(&[0; 15]); d.load_interleaved::<3>(&[0; 23]); d.load_interleaved::<4>(&[0; 31]);
        wide.load_interleaved::<3>(&[0; 95]); wide.load_interleaved::<4>(&[0; 127]);
        v.store(&mut [0; 7][..]); v.store_last(&mut [0; 7][..]); v.store_at(&mut &mut [0u16; 8][..], 1);
        v.store(&mut [core::mem::MaybeUninit::uninit(); 7][..]);
        v.isa().store_interleaved([v, v], &mut [0; 15][..]); v.isa().store_interleaved([v, v, v], &mut [0; 23][..]); v.isa().store_interleaved([v, v, v, v], &mut [0; 31][..]);
        w.isa().store_interleaved([w, w, w], &mut [0; 95][..]); w.isa().store_interleaved([w, w, w, w], &mut [0; 127][..]);
        v.compress_store(&mut [0; 7][..], 0); w.compress_store(&mut [0; 31][..], 0);
        v[8]; v.with_lane_dyn(8, 0);
    }
}
