use bun_simd::{Target, limit_to};
use core::fmt::Debug;

pub(crate) fn targets() -> impl Iterator<Item = Target> {
    // Miri lacks some of the intrinsics.
    let is_skipped = |target: Target| cfg!(miri) && target.arch() == Some("aarch64");
    let all = Target::ALL.into_iter();
    let supported = all.filter(move |&it| it.is_supported() && !is_skipped(it));
    supported.inspect(|&target| limit_to(target))
}

/// Returns numbers below its argument.
pub(crate) fn random() -> impl FnMut(usize) -> usize {
    let mut x = 88172645463325252u64;
    move |n| {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x % n as u64) as usize
    }
}

/// Miri gets one in `n`.
pub(crate) fn sample<T>(all: impl IntoIterator<Item = T>, n: usize) -> impl Iterator<Item = T> {
    all.into_iter().step_by(if cfg!(miri) { n } else { 1 })
}

pub(crate) fn check<T: PartialEq + Debug>(want: T, kernel: impl Fn() -> T) {
    for target in targets() {
        assert_eq!(kernel(), want, "{target:?}");
    }
}

pub(crate) fn check_against_portable<T: PartialEq + Debug>(kernel: impl Fn() -> T) {
    limit_to(Target::Portable);
    check(kernel(), kernel);
}
