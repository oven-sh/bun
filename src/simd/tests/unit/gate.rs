//! What only the compiler runs otherwise.

use super::*;

fn words(it: Named) -> Vec<&'static str> {
    it.text().split(" + ").collect()
}

#[test]
fn sizes_on_all_architectures() {
    for &it in Named::ALL {
        let (level, less) = (words(it)[0], words(it).contains(&"narrow"));
        let (register, bytes) = match level {
            "avx512" | "icelake" => (64, 64),
            "avx2" => (32, 32),
            _ => (16, 16),
        };
        let bytes = if less { 32 } else { bytes };
        assert_eq!(
            (it.register(), it.bytes(), it.is_wide()),
            (register, bytes, bytes == 64 || level == "sve2"),
            "{}",
            it.text()
        );
        let target = Target::of(it, &[]);
        assert!(target.named() == it && (target.needs == NEVER) != Named::NATIVE.contains(&it));
        for &other in Named::ALL {
            assert_eq!(target.is(Target::of(other, &[])), it.text() == other.text());
        }
        assert_eq!(target.is(Target::of(it, &["no such thing"])), !Named::NATIVE.contains(&it));
    }
}

#[test]
fn the_bits_of_levels_stand_for_their_features() {
    let singles = || detect::NAMES.iter().chain(tuning::NAMES).map(|&it| Target::of(Named::Portable, &[it]));
    for cpu in Target::combinations().chain(singles()) {
        for target in Target::combinations().chain(singles()) {
            let lacks = (0..64).any(|bit| target.needs >> bit & 1 > (cpu.needs | BASELINE) >> bit & 1);
            assert_eq!(target.test() & !with_levels(cpu.needs) != 0, lacks, "{target:?} on {cpu:?}");
        }
    }
}

struct Which;
impl Kernel<()> for Which {
    type Output = Target;
    const TARGETS: Targets = Targets::ALL;
    fn run<S: Isa>(_: S, (): ()) -> Target {
        S::TARGET
    }
}
const FOREIGN: Target = Target::of(if crate::X86 { Named::neon } else { Named::sse4 }, &[]);

#[test]
fn lists() {
    let with_foreign: Vec<_> = [FOREIGN].iter().chain(Targets::ALL.0).copied().collect();
    let list = generic::<Which, ()>(Targets(with_foreign.leak()));
    assert_eq!(list.targets[..list.len], *Targets::ALL.0);
    let last = Targets::ALL.0.iter().position(|it| it.is_baseline()).unwrap_or(list.len);
    for (i, &target) in list.targets.iter().enumerate().filter(|it| it.1.is_supported()) {
        assert_eq!(enter(list.entries[i], ()), target);
        assert_eq!(enter(Table::<Generic<Which>, ()>::outlined(i), ()), list.targets[i.min(last)]);
    }
    assert_eq!(enter(FOREIGN.named.generic::<Which, (), ()>(), ()), Target::Portable);
    assert_eq!(Choice::<()>::new().0.into_inner(), 0);
}

#[test]
#[cfg(panic = "unwind")]
fn refused_lists() {
    let why = |all: Vec<Target>| {
        std::panic::catch_unwind(|| generic::<Which, ()>(Targets(all.leak())).len)
            .map_err(|it| *it.downcast::<&str>().unwrap())
    };
    assert_eq!(why(vec![Target::Portable; 16]), Ok(16));
    assert_eq!(why(vec![Target::Portable; 17]), Err("a kernel has up to 16 targets on each architecture"));
    assert_eq!(why(vec![Target::of(Named::Portable, &["no such thing"]); 3]), Ok(0));
    for &name in tuning::NAMES {
        assert_eq!(why(vec![Target::of(Named::Portable, &[name])]), Ok(1));
    }
    for &name in detect::NAMES {
        assert_eq!(why(vec![Target::of(Named::Portable, &[name])]), Err("a feature in quotes needs #[kernel]"));
    }
}

fn number<const N: usize>() -> usize {
    N
}
/// `N` times a target that no class stands for, and then one more than the index comes back.
struct Many<const N: usize, const KEPT: bool>;
static KEPT: AtomicU32 = AtomicU32::new(0);
const ODD: Target = Target { named: Named::Portable, needs: 1 << TUNING };
impl<const N: usize, const CHOICE: bool> Entries<()> for Many<N, CHOICE> {
    type Output = usize;
    const LIST: List<(), usize> = {
        let (mut list, all): (_, [Entry<(), usize>; 16]) = (
            List::new(number::<0> as _),
            [
                number::<1>, number::<2>, number::<3>, number::<4>, number::<5>, number::<6>, number::<7>, number::<8>,
                number::<9>, number::<10>, number::<11>, number::<12>, number::<13>, number::<14>, number::<15>,
                number::<16>,
            ],
        );
        while list.len < N {
            list.push(ODD, all[list.len]);
        }
        list
    };
    fn choice() -> Option<&'static AtomicU32> {
        CHOICE.then_some(&KEPT)
    }
}
struct Classes;
impl Kernel<()> for Classes {
    type Output = Target;
    const TARGETS: Targets = Targets(&{
        let (mut all, mut i) = ([Target::Portable; 10], 0);
        while i < 10 {
            all[i] = Target::of(CLASSES[10 - i], &[]);
            all[i] = if all[i].named as u8 == 0 { FOREIGN } else { all[i] };
            i += 1;
        }
        all
    });
    fn run<S: Isa>(_: S, (): ()) -> Target {
        S::TARGET
    }
}

/// The only test here that changes what dispatch remembers.
#[test]
#[cfg(target_has_atomic = "64")]
fn what_is_remembered() {
    assert_eq!(EPOCH.load(Relaxed), 0);
    let (class, all) = (detect().1, cpu());
    assert_eq!((CLASS.load(Relaxed), all.needs & (KNOWN | 15 << LEVEL)), (class, 0));
    assert_eq!(all, Target::from_bits(all.needs));
    for (round, target) in Target::combinations().filter(|it| it.is_supported()).enumerate() {
        assert!(set_cpu(target));
        let epoch = 16 * (round as u32 + 1);
        let (have, n) = (HAVE.load(Relaxed), Named::NATIVE.len());
        assert_eq!(
            (EPOCH.load(Relaxed), have, detect()),
            (epoch, with_levels(target.needs), (have, CLASS.load(Relaxed)))
        );
        let now = cpu();
        assert!(Named::NATIVE[(SEEN.load(Relaxed) - (epoch << 8) - 1) as usize] == now.named);
        for (seen, want) in
            [(1, Named::Portable), (n, Named::NATIVE[n - 1]), (0, now.named), (n + 1, now.named), (4097, now.named)]
        {
            SEEN.store((epoch << 8) + seen as u32, Relaxed);
            assert!(cpu().named == want, "{seen}");
        }
        // The class alone decides.
        for class in 1..=CLASS.load(Relaxed) {
            let it = Target::of(CLASSES[class as usize - 1], &[]);
            if target.includes(it) {
                let old = CLASS.swap(class, Relaxed);
                assert_eq!(best::<Generic<Classes>, ()>(()), Classes::TARGETS.choose(it));
                CLASS.store(old, Relaxed);
            }
        }
    }
    let epoch = EPOCH.load(Relaxed);
    for (have, want) in [(KNOWN, 0), (KNOWN | ODD.needs, 1)] {
        HAVE.store(have, Relaxed);
        macro_rules! lists { ($($n:literal $kept:literal)*) => {$(
            KEPT.store(epoch - 16 + 1, Relaxed);
            assert_eq!((best::<Many<$n, true>, ()>(()), best::<Many<$n, false>, ()>(())), (want, want));
            assert_eq!(KEPT.load(Relaxed), if $kept { epoch + if want == 1 { 1 } else { $n + 1 } } else { epoch - 16 + 1 });
            for index in 1..=$n + 1 {
                KEPT.store(epoch + index as u32, Relaxed);
                assert_eq!(best::<Many<$n, true>, ()>(()), if $kept { index % ($n + 1) } else { want });
            }
            for (index, &it) in Table::<Many<$n, true>, ()>::BY_CHOICE.iter().enumerate() {
                assert_eq!(enter(it, ()), if index == 0 || index > $n + 1 { want } else { index % ($n + 1) });
            }
        )*}; }
        lists!(1 true 2 true 13 true 14 true 15 false 16 false);
    }
    HAVE.store(0, Relaxed);
    assert_eq!(dispatch_to::<Which, ()>(Target::Portable, ()), Some(Target::Portable));
    assert_ne!(HAVE.load(Relaxed), 0);
    // Without this bit, the first call detects.
    HAVE.store(0, Relaxed);
    best::<Many<15, true>, ()>(());
    assert_ne!(HAVE.load(Relaxed), 0);
    for bit in 0..16 {
        HAVE.store(KNOWN | 1 << bit, Relaxed);
        assert_eq!(
            [is_tuned::<0>(), is_tuned::<1>(), is_tuned::<2>(), is_tuned::<3>()],
            [0, 1, 2, 3].map(|it| bit == TUNING + it)
        );
        let is = |name| crate::X86 && 1 << bit == super::bit(name);
        assert_eq!(
            (tuning::fast_gather(), tuning::fast_masked_store()),
            (is("fast_gather") || cfg!(target_feature = "avx512fp16"), is("fast_compress_store"))
        );
        assert_eq!(tuning::one_port(), is("full_zmm"));
        HAVE.store(KNOWN | 1 << bit | 0b10100 << TUNING, Relaxed);
        assert_eq!(tuning::one_port(), is("fast_gather"));
    }
    for target in Target::combinations().filter(|it| it.needs != 0) {
        let here = |have| (HAVE.store(have, Relaxed), is_here(target)).1;
        // Another test can detect in between.
        assert!((0..100).any(|_| here(0).is_none()) && here(target.needs) == Some(true));
        assert!((0..64).all(|bit| here(!(1 << bit)) == Some(target.needs >> bit & 1 == 0)));
    }
    reset_cpu();
    assert_eq!((cpu(), EPOCH.load(Relaxed)), (all, epoch + 16));
}

#[test]
#[allow(clippy::assertions_on_constants)]
fn ways_to_choose() {
    assert!(
        Table::<Generic<Classes>, ()>::ONLY_LEVELS
            && Table::<Many<0, true>, ()>::ONLY_LEVELS
            && !Table::<Many<1, true>, ()>::ONLY_LEVELS
    );
    assert_eq!((Table::<Many<0, true>, ()>::LAST, Table::<Many<16, true>, ()>::LAST), (0, 16));
    for it in LEVELS.into_iter().chain(CLASSES) {
        let level = words(it)[0];
        let other = Named::NATIVE.iter().find(|other| words(**other)[0] != "portable");
        let arch = |it: &str| {
            ["sse avx ice", "neon sve"].iter().position(|all| all.split(' ').any(|start| it.starts_with(start)))
        };
        assert!(
            ["portable", "wasm"].contains(&level)
                || other.is_none_or(|&other| words(other)[0] == "wasm" || arch(words(other)[0]) == arch(level))
        );
    }
    assert_eq!(crate::OPTIMIZED, cfg!(any(miri, not(bun_simd_unoptimized))));
    #[allow(unexpected_cfgs)]
    let mingw = cfg!(any(as_mingw, all(target_os = "windows", target_env = "gnu", not(target_abi = "llvm"))));
    assert_eq!(crate::MINGW, mingw);
    let wide =
        cfg!(any(all(target_feature = "sve2", not(miri)), all(target_arch = "x86_64", target_feature = "avx512f")));
    assert_eq!(BASELINE & WIDE != 0, wide);
    // A level is tested by its bit alone.
    for (i, level) in LEVELS.into_iter().enumerate().filter(|it| it.1.is_native()) {
        let (it, wide) = (Target::of(level, &[]), NEEDS[level as usize] & WIDE & !BASELINE);
        assert_eq!(
            it.test(),
            if NEEDS[level as usize] & !WIDE & !BASELINE == 0 { wide } else { 1 << (LEVEL + i as u32) | wide }
        );
    }
    assert_eq!(Target { needs: BASELINE | ODD.needs, ..ODD }.test(), ODD.needs);
    let fields = [KNOWN, WIDE, 15 << LEVEL, 15 << TUNING, ((1 << detect::NAMES.len()) - 1) << FEATURES, NEVER];
    assert_eq!(fields.iter().fold(0, |all, it| all | it).count_ones(), 11 + detect::NAMES.len() as u32);
}

/// Miri only gets to targets that the program is compiled for.
#[test]
fn both_ways_in() {
    struct Elsewhere;
    impl Caller for Elsewhere {
        const INSIDE: bool = false;
        type Token = tokens::Portable;
    }
    for i in 0..20 {
        let owned = std::vec![i];
        assert_eq!(Entering::<Elsewhere>::inlined2(owned, 2, |a, b| a[0] + b), i + 2);
        let _ = inside::<tokens::Portable>();
        let late = Late { number: crate::hints::SIGNALING, again: Run::<tokens::Portable, Inlined, _>::IT, next: None };
        let first = |a: std::vec::Vec<i32>| a[0];
        assert_eq!(enter(Run::<tokens::Portable, Once, _>::IT, (Some(&late), first, std::vec![i])), i);
    }
    assert_eq!(Entering::<crate::target::Baseline>::apart2(1, 2, |a, b| a + b), 3);
}

#[test]
fn has_words() {
    let is = |words| Named::sse4.has_words(words);
    assert!(is(&["sse2", "sse4", "crc32c"]) && is(&["crc32c", "sse2", "sse4"]));
    assert!(!is(&["sse2", "sse4"]) && !is(&["sse2", "sse4", "crc32c", "aes"]) && !is(&[]));
    assert!(!is(&["aes", "sse4", "crc32c"]) && !is(&["sse2", "aes", "crc32c"]) && !is(&["sse2", "sse4", "aes"]));
}

#[test]
fn what_miri_lacks() {
    assert_eq!(USABLE, if cfg!(all(miri, target_arch = "aarch64")) { 0 } else { !0 });
}
