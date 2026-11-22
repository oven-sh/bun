//! Debug assertions that do not fire after a failed allocation. The code goes on with a default value.

#[inline(always)]
#[cfg_attr(debug_assertions, track_caller)]
pub(crate) fn soft_unreachable() {
    debug_assert!(crate::common::memory::is_oom());
}

macro_rules! soft_assert {
    ($condition:expr) => {
        debug_assert!($condition || $crate::common::memory::is_oom());
    };
}
pub(crate) use soft_assert;
