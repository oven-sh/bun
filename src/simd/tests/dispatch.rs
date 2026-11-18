//! Which copy runs, and which items the macros accept.
#![cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#![forbid(unsafe_code)]
use bun_simd::{Isa, Target, limit_to, limit_to_named, limit_to_with};

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

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod listed {
    #[export]
    pub fn len() -> usize {
        isa::U8::LEN
    }
}

#[test]
fn portable_copies_have_the_widths_in_the_list() {
    let lens = [Target::Portable64, Target::Portable32, Target::Portable].map(|target| {
        limit_to(target);
        [listed::len(), capped_simd::len()]
    });
    assert_eq!(lens, [[16, 64], [32, 16], [16, 16]]);
}

#[test]
fn baseline_is_what_the_lowest_copy_has() {
    use bun_simd::baseline::Isa as Baseline;
    let got = [
        Baseline::HAS_INTERLEAVED_MEMORY,
        Baseline::HAS_LEADING_ZEROS,
    ];
    assert_eq!(got, [!cfg!(target_arch = "x86_64"); 2]);
    assert_eq!(Baseline::MASKED_BYTES, 0);
}

fn neither() -> &'static str {
    "neither"
}

#[bun_simd::foreach_target(avx2 + "vaes", sse4 + "aes" + "pclmulqdq", sse4, neon + "aes")]
mod listed_simd {
    #[export(or = neither)]
    pub fn module() -> &'static str {
        module_path!().rsplit("::").next().unwrap()
    }

    #[export(or = neither)]
    pub fn last_feature() -> &'static str {
        MORE_FEATURES.last().unwrap_or(&stringify!(this_target))
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
        assert_eq!(best.rsplit('_').next(), Some(listed_simd::last_feature()));
        limit_to(target);
        assert_eq!(listed_simd::module(), plain, "{target:?}");
        assert_eq!(listed_simd::last_feature(), plain, "{target:?}");
        limit_to_named(format!("{}+vaes+aes+pclmulqdq", target.name()).as_bytes());
        limit_to_named(b"none+aes");
        assert_eq!(listed_simd::module(), best, "{target:?}");
        assert_ne!(capped_simd::module(), "avx512_skx", "{target:?}");
    }
}
