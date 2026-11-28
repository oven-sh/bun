//! One check for a vector at an index.

/// Panics unless `n` values from `at` on are within `len`. The test has the form of that of a loop. LLVM doesn't always see that it implies those of `[at..][..n]`.
#[inline(always)]
#[track_caller]
pub(crate) fn check(len: usize, at: usize, n: usize) {
    assert!(len >= n && at <= len - n);
    // SAFETY: this follows from the line above.
    #[allow(unsafe_code)]
    unsafe {
        core::hint::assert_unchecked(at <= len);
        core::hint::assert_unchecked(len - at >= n);
    }
}
