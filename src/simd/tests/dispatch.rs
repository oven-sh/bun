//! Which copy runs, and which items the macros accept.
#![cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#![feature(closure_track_caller)]
#![forbid(unsafe_code)]
use bun_simd::{Isa, Target, limit_to, limit_to_named, limit_to_with, out_of_line, with_bmi2};
use std::panic::Location;

struct Kernel(u8);
struct AtomicFn(u8);

#[bun_simd::foreach_target]
mod helpers {
    pub fn name() -> &'static str {
        stringify!(this_target)
    }
}

#[bun_simd::foreach_target]
mod simd {
    use crate::helpers::this_target::name;
    use isa::U8;

    #[export]
    pub fn by_default() -> &'static str {
        name()
    }

    #[export(long_running)]
    pub fn long_running() -> &'static str {
        name()
    }

    #[export(up_to = avx2)]
    pub fn up_to_avx2() -> &'static str {
        name()
    }

    #[export(baseline)]
    #[inline]
    pub fn baseline() -> &'static str {
        name()
    }

    /// With a comment.
    #[cfg(false)]
    #[export]
    pub fn left_out() {}

    #[expect(unused_variables)]
    #[export]
    pub fn with_an_attribute_for_the_copies(unused: u8) {}

    #[export(up_to = avx2, up_to = neon)]
    pub fn up_to_both() -> &'static str {
        name()
    }

    #[export]
    pub fn properties() -> ([usize; 2], [u8; 7]) {
        let has = [
            isa::Isa::HAS_MASK_REGISTERS,
            isa::Isa::HAS_UNSIGNED_COMPARE,
            isa::Isa::HAS_INTERLEAVED_MEMORY,
            isa::Isa::HAS_SINGLE_CYCLE_OPS,
            isa::Isa::HAS_LEADING_ZEROS,
            isa::Isa::MASKED_BYTES != 0 && isa::Isa::IS_SLOW_TO_SKIP_PAGE,
            isa::Isa::HAS_PAIRWISE_DOT,
        ];
        ([U8::LEN, isa::Isa::MASKED_BYTES], has.map(u8::from))
    }

    struct Table<const N: usize, const UNUSED: usize = 1>(isa::Vector<u8, N>);

    impl Default for Table<{ U8::LEN }, { U8::LEN / U8::LEN }> {
        fn default() -> Self {
            Self(U8::repeat([7; 16]))
        }
    }

    impl Table<{ U8::LEN }>
    where
        for<'a> &'a u8: Copy,
    {
        const fn first() -> u8 {
            1
        }

        #[inline(always)]
        fn lookup<const PLUS: u8>(&self, indices: U8) -> U8 {
            self.0.lookup(indices) + PLUS
        }
    }

    fn lanes(v: U8) -> impl Iterator<Item = u8> {
        let mut lanes = Vec::new();
        for lane in v.lookup(U8::zero()).to_array() {
            fn _in_a_loop(v: U8) -> U8 {
                v.lookup(v)
            }
            lanes.push(lane);
        }
        lanes.into_iter()
    }

    macro_rules! function {
        ($vis:vis, $name:ident) => {
            $vis fn $name(v: U8) -> U8 {
                v.lookup(v)
            }
        };
    }
    function!(pub(crate), from_macro);

    #[export]
    pub fn names_of_the_macro(is_allowed: Kernel, mut choose: AtomicFn) -> u8 {
        choose.0 += is_allowed.0;
        from_macro(U8::zero())[0] + choose.0
    }

    /// With a comment.
    #[export]
    #[must_use]
    pub(crate) fn all_kinds_of_items(mut byte: u8, callback: fn(u8) -> u8) -> Option<u8> {
        byte += Table::first();
        lanes(Table::default().lookup::<2>(U8::splat(byte)))
            .map(callback)
            .next()
    }
}

fn best(of: &[Target], limit: Target) -> &'static str {
    let is_candidate = |it: &&Target| it.is_supported() && **it as u8 >= limit as u8;
    of.iter().find(is_candidate).unwrap().name()
}

#[test]
fn best_copy_within_the_limit_runs() {
    use Target::*;
    for limit in Target::ALL {
        limit_to(limit);
        let got = [
            simd::by_default(),
            simd::long_running(),
            simd::up_to_avx2(),
            simd::up_to_both(),
            simd::baseline(),
        ];
        let want = match limit {
            Portable64 | Portable32 => [limit.name(); 5],
            _ => [
                match limit {
                    Avx512Skx => best(&[Avx512Skx, Avx2, Sse4, Sve2, Neon, Portable], limit),
                    _ => best(&[Avx512Icl, Avx2, Sse4, Sve2, Neon, Portable], limit),
                },
                best(
                    &[Avx512Icl, Avx512Skx, Avx2, Sse4, Sve2, Neon, Portable],
                    limit,
                ),
                best(&[Avx2, Sse4, Sve2, Neon, Portable], limit),
                best(&[Avx2, Sse4, Neon, Portable], limit),
                best(&[Sse4, Neon, Portable], limit),
            ],
        };
        assert_eq!(got, want, "{limit:?}");
        assert_eq!(simd::all_kinds_of_items(0, |byte| byte * 2), Some(18));
        assert_eq!(simd::names_of_the_macro(Kernel(1), AtomicFn(2)), 3);
        simd::with_an_attribute_for_the_copies(0);
    }
}

#[test]
fn best_copy_runs_without_a_limit() {
    use Target::*;
    let got = std::thread::spawn(simd::long_running).join().unwrap();
    let all = [Avx512Icl, Avx512Skx, Avx2, Sse4, Sve2, Neon, Portable];
    assert_eq!(got, best(&all, Avx512Icl));
}

#[test]
fn portable_copies_take_the_paths_of_the_others() {
    use Target::*;
    for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
        limit_to(target);
        let want = match target {
            Avx512Icl | Avx512Skx | Portable64 => ([64, 64], [1, 1, 0, 1, 1, 1, 1]),
            Avx2 | Portable32 => ([32, 0], [0, 0, 0, 1, 1, 0, 1]),
            Sse4 => ([16, 0], [0, 0, 0, 1, 0, 0, 1]),
            Sve2 => ([16, 16], [0, 1, 1, 0, 1, 0, 0]),
            Neon | Portable => ([16, 0], [0, 1, 1, 0, 1, 0, 0]),
        };
        assert_eq!(simd::properties(), want, "{target:?}");
    }
}

#[bun_simd::foreach_target(avx2 + "avx512vl", avx2, sse4, neon, portable)]
mod listed {
    #[export]
    pub fn len() -> usize {
        isa::U8::LEN
    }
}

#[bun_simd::foreach_target(avx512_icl, avx2 + "vaes", sse4 + "sse4.2", sve2 + "sve2-aes", sve2, portable,)]
mod listed_with_all_widths {
    #[export]
    pub fn len() -> usize {
        isa::U8::LEN
    }
}

#[test]
fn portable_copies_have_the_widths_in_the_list() {
    let lens = [Target::Portable64, Target::Portable32, Target::Portable].map(|target| {
        limit_to(target);
        [
            listed::len(),
            listed_with_all_widths::len(),
            capped_simd::len(),
        ]
    });
    assert_eq!(lens, [[16, 64, 64], [32, 32, 16], [16, 16, 16]]);
}

#[cfg(target_arch = "x86_64")]
const _: fn(bun_simd::baseline::U8) -> bun_simd::sse4::U8 = |v| v;
#[cfg(target_arch = "aarch64")]
const _: fn(bun_simd::baseline::U8) -> bun_simd::neon::U8 = |v| v;

fn neither() -> &'static str {
    "neither"
}

#[bun_simd::foreach_target(avx2 + "vaes", sse4 + "aes" + "pclmulqdq", sse4, neon + "aes")]
mod listed_simd {
    #[export(or = neither)]
    pub fn module() -> &'static str {
        let name = module_path!().rsplit("::").next().unwrap();
        assert!(name.split('_').skip(1).eq(MORE_FEATURES.iter().copied()));
        name
    }
}

#[bun_simd::foreach_target(avx512_skx, sse4, portable)]
mod capped_simd {
    #[export(up_to = avx2)]
    pub fn module() -> &'static str {
        stringify!(this_target)
    }

    #[export]
    pub fn len() -> usize {
        isa::U8::LEN
    }

    #[export]
    pub fn by_default() -> &'static str {
        stringify!(this_target)
    }

    #[export(up_to = neon, long_running)]
    pub fn long_running() -> &'static str {
        stringify!(this_target)
    }
}

#[bun_simd::foreach_target(avx512_icl, portable64)]
mod wide_simd {
    #[export(or = neither)]
    pub fn module() -> &'static str {
        stringify!(this_target)
    }
}

#[bun_simd::foreach_target(portable64, portable32)]
mod only_portable_simd {
    #[export(or = neither)]
    pub fn module() -> &'static str {
        stringify!(this_target)
    }
}

#[bun_simd::foreach_target(avx512_icl, avx2, sse4, neon, portable64, portable)]
mod named_and_implied {
    #[export]
    pub fn len() -> usize {
        isa::U8::LEN
    }
}

#[test]
fn portable_widths_by_name() {
    let lens = [Target::Portable64, Target::Portable32, Target::Portable].map(|target| {
        limit_to(target);
        named_and_implied::len()
    });
    assert_eq!(lens, [64, 32, 16]);
    for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
        limit_to(target);
        let want = match target {
            Target::Avx512Icl | Target::Portable64 => target.name(),
            _ => "neither",
        };
        assert_eq!(wide_simd::module(), want);
        let want = match target {
            Target::Portable64 | Target::Portable32 => target.name(),
            _ => "neither",
        };
        assert_eq!(only_portable_simd::module(), want);
    }
}

#[test]
fn closures_with_bmi2() {
    const FEATURES: [&str; 3] = ["bmi1", "bmi2", "lzcnt"];
    let caller = || {
        let owned = Vec::from(FEATURES);
        let (caller, owned) = with_bmi2(
            #[track_caller]
            move || (Location::caller(), owned),
        );
        assert_eq!(owned, FEATURES);
        caller
    };
    let plain = out_of_line(
        #[track_caller]
        || Location::caller(),
    );
    let runs_with_bmi2 = || caller() != plain;
    let has_all = FEATURES.map(|name| bun_simd::detected().names().any(|it| it == name));
    assert_eq!(runs_with_bmi2(), has_all == [true; 3]);
    for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
        let is_x86 = target.arch() == Some("x86_64");
        limit_to(target);
        assert_eq!(runs_with_bmi2(), is_x86 && target != Target::Sse4);
        limit_to_with(target, FEATURES);
        assert_eq!(runs_with_bmi2(), is_x86 && has_all == [true; 3]);
    }
    for missing in FEATURES {
        limit_to_with(
            Target::Sse4,
            FEATURES.into_iter().filter(|&it| it != missing),
        );
        assert!(!runs_with_bmi2(), "{missing}");
    }
}

#[test]
fn further_features() {
    let has = |name| bun_simd::detected().names().any(|it| it == name);
    for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
        let plain = match target.arch() {
            Some("x86_64") => "sse4",
            _ => "neither",
        };
        let best = match (target, target.arch()) {
            (Target::Sse4, _) if has("aes") && has("pclmulqdq") => "sse4_aes_pclmulqdq",
            (Target::Sse4, _) => plain,
            (_, Some("x86_64")) if has("vaes") => "avx2_vaes",
            (_, Some("x86_64")) if has("aes") => "sse4_aes_pclmulqdq",
            (_, Some("aarch64")) if has("aes") => "neon_aes",
            _ => plain,
        };
        limit_to_with(target, ["vaes", "aes", "pclmulqdq", "unknown"]);
        assert_eq!(listed_simd::module(), best, "{target:?}");
        limit_to(target);
        assert_eq!(listed_simd::module(), plain, "{target:?}");
        limit_to_named(format!("{}+vaes+aes+pclmulqdq", target.name()).as_bytes());
        limit_to_named(b"none+aes");
        assert_eq!(listed_simd::module(), best, "{target:?}");
        let capped = match (target, target.arch()) {
            (_, Some("x86_64")) => "sse4",
            (Target::Portable64, _) => "portable64",
            _ => "portable",
        };
        let want = match target {
            Target::Avx512Icl => [capped, "avx512_skx"],
            Target::Avx512Skx => ["avx512_skx"; 2],
            _ => [capped; 2],
        };
        let got = [capped_simd::by_default(), capped_simd::long_running()];
        assert_eq!((capped_simd::module(), got), (capped, want), "{target:?}");
    }
}
