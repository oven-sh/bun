//! Memory budgeting for the [`crate::Store`].
//!
//! The store accounts for every byte it retains (vector capacities, not
//! lengths) and enforces a hard cap: an insertion that would push the
//! accounted total past the cap is rejected *before* anything grows, so the
//! accounted total never exceeds the cap.

/// Returned by [`crate::Store::upsert`] when adding the entry would push the
/// store's retained bytes past its budget. The entry was not added; the store
/// is unchanged apart from its `truncated` flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BudgetExceeded;

impl core::fmt::Display for BudgetExceeded {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("file index memory budget exceeded")
    }
}

impl core::error::Error for BudgetExceeded {}

/// The capacity a `Vec<T>` is grown to when `required` elements no longer fit
/// in `cap`: amortized doubling, but never less than `required` and never less
/// than a small floor so tiny vectors don't reallocate per push.
///
/// The store performs every growth itself (`reserve_exact` to this value), so
/// the bytes it accounts for are the bytes actually retained — it never relies
/// on `Vec`'s internal growth policy.
pub(crate) fn grown_capacity(cap: usize, required: usize, floor: usize) -> usize {
    if required <= cap {
        return cap;
    }
    cap.saturating_mul(2).max(required).max(floor)
}

/// Grow `vec` to exactly `target` capacity (no-op if already large enough).
pub(crate) fn reserve_to<T>(vec: &mut Vec<T>, target: usize) {
    if target > vec.capacity() {
        vec.reserve_exact(target - vec.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grown_capacity_doubles_and_respects_floor_and_requirement() {
        assert_eq!(grown_capacity(0, 1, 8), 8);
        assert_eq!(grown_capacity(8, 9, 8), 16);
        assert_eq!(grown_capacity(8, 100, 8), 100);
        // Already fits: unchanged.
        assert_eq!(grown_capacity(16, 10, 8), 16);
        // Saturates instead of overflowing.
        assert_eq!(grown_capacity(usize::MAX, usize::MAX, 1), usize::MAX);
    }

    #[test]
    fn reserve_to_is_exact_and_idempotent() {
        let mut v: Vec<u8> = Vec::new();
        reserve_to(&mut v, 32);
        assert_eq!(v.capacity(), 32);
        reserve_to(&mut v, 16);
        assert_eq!(v.capacity(), 32);
    }
}
