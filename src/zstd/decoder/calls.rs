//! Functions of their own for loops. They are aligned: the speed of a loop does not depend on what is linked before it.

use bun_simd::prelude::*;

/// Compiles `run` a second time, with BMI1, BMI2 and LZCNT. It and what it calls have to be `#[inline(always)]`.
#[inline(always)]
pub fn with_bmi2<R>(run: impl FnOnce() -> R) -> R {
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "bmi1,bmi2,lzcnt")]
    #[inline(never)]
    #[rustc_align(64)]
    fn bmi2<R>(run: impl FnOnce() -> R) -> R {
        run()
    }
    #[bun_simd::kernel("bmi1" + "bmi2" + "lzcnt")]
    fn best<R, F: FnOnce() -> R>() -> fn(F) -> R {
        pick! {
            "bmi1" + "bmi2" + "lzcnt" => (|run| bmi2(run)) as fn(F) -> R,
            _ => out_of_line as fn(F) -> R,
        }
    }
    best()(run)
}

#[inline(never)]
#[rustc_align(64)]
pub fn out_of_line<R>(run: impl FnOnce() -> R) -> R {
    run()
}
