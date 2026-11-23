//! Lists of targets that have a name, add to the default, or refuse what they lack.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{kernel, target, target::*};

macro_rules! crypto_kernels { ($($module:tt)*) => { #[bun_simd::simd(avx2 + vaes, sse4 + aes, neon + aes)] $($module)* }; }

crypto_kernels! {
    mod rounds {
        use bun_simd::prelude::*;
        pub fn round(state: [u8; 16], key: [u8; 16]) -> [u8; 16] {
            u8x16::from(state).aes_round(key).to_array()
        }
    }
}

crypto_kernels! {
    mod cipher {
        use super::rounds::round;
        use bun_simd::prelude::*;

        #[kernel]
        pub fn by_pick(state: [u8; 16]) -> Option<[u8; 16]> {
            pick! { aes => Some(round(state, [0; 16])), _ => { let _ = state; None } }
        }
        #[kernel]
        pub fn by_has(state: [u8; 16]) -> Option<[u8; 16]> {
            if has!(portable) {
                return None;
            }
            Some(u8x16::from(state).aes_round(0).to_array())
        }
    }
}

#[bun_simd::simd(avx2 + sha512, icelake + sha, sve2, default, "bmi2")]
mod more {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn all() -> Target {
        S::TARGET
    }
    #[kernel(default)]
    pub fn usual() -> Target {
        S::TARGET
    }
    #[kernel(sve2, default)]
    pub fn one_more() -> Target {
        S::TARGET
    }
}

#[bun_simd::simd(super::more)]
mod like_more {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn all() -> Target {
        S::TARGET
    }
    #[kernel(default)]
    pub fn usual() -> Target {
        S::TARGET
    }
    #[bun_simd::simd(super)]
    pub mod inner {
        #[bun_simd::simd(super::super::super::rounds)]
        pub mod other {
            #[kernel]
            pub fn all() {}
        }
        #[kernel]
        pub fn all() {}
    }
}

#[test]
fn a_path_stands_for_the_list_of_that_module() {
    assert!(
        like_more::all::targets().eq(more::all::targets()) && like_more::usual::targets().eq(more::usual::targets())
    );
    assert!(like_more::inner::all::targets().eq(more::all::targets()));
    assert!(like_more::inner::other::all::targets().eq(cipher::by_has::targets()));
    for target in more::all::targets() {
        assert_eq!(like_more::all::to(target), more::all::to(target));
    }
}

#[kernel(avx2 + sha512, sve2, default)]
fn generic() -> Target {
    S::TARGET
}

// One test, because set_cpu is global.
#[test]
fn lists() {
    const FIRST: Targets = Targets(&[target!(avx2 + sha512), target!(icelake + sha), target!(sve2)]);
    for target in Target::combinations().filter(|&it| set_cpu(it)) {
        let aes = target.has("aes") || cfg!(target_feature = "aes");
        assert_eq!([cipher::by_pick([0; 16]), cipher::by_has([0; 16])], [aes.then_some([0x63; 16]); 2], "{target:?}");
        let (first, usual) = (FIRST.choose(target), Targets::DEFAULT.choose(target));
        assert_eq!(more::usual(), usual);
        assert_eq!(more::all(), if first == Target::Portable { usual } else { first });
        assert_eq!(more::one_more(), if first == target!(sve2) { first } else { usual });
        assert_eq!(generic(), if first == Target::Portable || first == target!(icelake + sha) { usual } else { first });
    }
    reset_cpu();
}

#[bun_simd::simd(avx2 + sha + "adx", sse4 + fast_pdep, neon82 + sha512 + fast_sha3, neon + sha + "lse", neon + crc32c)]
mod rare {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn words() -> [bool; 3] {
        [has!(sha), has!(sha512), has!(crc32c)]
    }
}

#[test]
fn kernels_list_their_targets() {
    const ALL: Targets = Targets(&[
        target!(avx2 + sha + "adx"),
        target!(sse4 + fast_pdep),
        target!(neon82 + sha3 + fast_sha3),
        target!(neon + aes + "lse"),
        target!(neon + crc),
        target!(portable),
    ]);
    assert!(
        rare::words::targets().eq(ALL.0.iter().copied().filter(|it| it.is_supported()))
            && ALL.supported().eq(rare::words::targets())
    );
    for it in rare::words::targets() {
        assert_eq!(
            rare::words::to(it),
            Some([it.has("sha") || it.has("neon") && it.has("aes"), it.has("sha3"), it.has("sse4.2") || it.has("crc")]),
            "{it:?}"
        );
    }
    assert!(
        generic::targets().all(|it| generic::to(it) == Some(it)) && generic::targets().last() == Some(Target::Portable)
    );
}

#[test]
fn words_that_come_together_stand_for_each_other() {
    assert_eq!(
        [target!(neon + sha + sha512 + crc32c), target!(neon + sha3 + sha512 + crc + aes + sha)],
        [target!(neon + aes + crc + sha3); 2]
    );
    assert_eq!(
        [target!(neon82 + sha + fcma), target!(neon86 + sm4 + sha512), target!(sve2 + sha)],
        [target!(neon82 + aes + fcma), target!(neon86 + sha3 + sm4), target!(sve2 + aes)]
    );
    assert_eq!([target!(neon86 + fhm), target!(sve2 + fhm)], [target!(neon86 + fcma), target!(sve2)]);
    if cfg!(all(target_arch = "aarch64", target_endian = "little")) {
        assert_eq!(Target::parse("neon + sha + sha512 + crc32c"), Some(target!(neon + aes + crc + sha3)));
    }
}
