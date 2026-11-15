//! Which copy runs, and which items the macros accept.
#![forbid(unsafe_code)]
use bun_simd::{Isa, Target, limit_to};

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
    pub fn baseline() -> &'static str {
        name()
    }

    #[export]
    pub fn properties() -> (usize, [bool; 3]) {
        let has = [
            isa::Isa::HAS_MASK_REGISTERS,
            isa::Isa::HAS_UNSIGNED_COMPARE,
            isa::Isa::HAS_INTERLEAVED_MEMORY,
        ];
        (U8::LEN, has)
    }

    struct Table<const N: usize>(isa::Vector<u8, N>);

    impl Default for Table<{ U8::LEN }> {
        fn default() -> Self {
            Self(U8::repeat_16([7; 16]))
        }
    }

    impl Table<{ U8::LEN }> {
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
    pub fn names_of_the_macro(is_allowed: Kernel, choose: AtomicFn) -> u8 {
        from_macro(U8::zero())[0] + is_allowed.0 + choose.0
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
            simd::baseline(),
        ];
        let want = match limit {
            Portable64 | Portable32 => [limit.name(); 4],
            _ => [
                match limit {
                    Avx512Skx => best(&[Avx512Skx, Avx2, Sse4, Neon, Portable], limit),
                    _ => best(&[Avx512Icl, Avx2, Sse4, Neon, Portable], limit),
                },
                best(&[Avx512Icl, Avx512Skx, Avx2, Sse4, Neon, Portable], limit),
                best(&[Avx2, Sse4, Neon, Portable], limit),
                best(&[Sse4, Neon, Portable], limit),
            ],
        };
        assert_eq!(got, want, "{limit:?}");
        assert_eq!(simd::all_kinds_of_items(0, |byte| byte * 2), Some(18));
        assert_eq!(simd::names_of_the_macro(Kernel(1), AtomicFn(2)), 3);
    }
}

#[test]
fn best_copy_runs_without_a_limit() {
    use Target::*;
    let got = std::thread::spawn(simd::long_running).join().unwrap();
    let all = [Avx512Icl, Avx512Skx, Avx2, Sse4, Neon, Portable];
    assert_eq!(got, best(&all, Avx512Icl));
}

#[test]
fn portable_copies_take_the_paths_of_the_others() {
    use Target::*;
    for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
        limit_to(target);
        let want = match target {
            Avx512Icl | Avx512Skx | Portable64 => (64, [true, true, false]),
            Avx2 | Portable32 => (32, [false, false, false]),
            Sse4 => (16, [false, false, false]),
            Neon | Portable => (16, [false, true, true]),
        };
        assert_eq!(simd::properties(), want, "{target:?}");
    }
}
