//! The nesting depth limit: as deep as the stack allows.

use bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;
use std::cell::Cell;

/// The check for code that builds a tree, and for the first recursive walk of a tree that a loop built. See
/// [`bun_core::StackCheck::with_at_most`]. The cap leaves stack for the walks that come later, and code whose time or
/// memory is quadratic in the depth never sees a deeper tree on a large stack than on the smallest one.
pub(crate) fn check_for_tree() -> bun_core::StackCheck {
    bun_core::StackCheck::init().with_at_most(DEFAULT_THREAD_STACK_SIZE as usize)
}

/// Nested input is parsed, walked and printed by recursive functions. Each calls [`Stack::has_room`] before it
/// recurses. If that returns false, it can continue with any placeholder, because the result is discarded. The
/// top-level caller checks [`Stack::ran_out`] at the end and returns
/// [`FormatError::NestedTooDeeply`](crate::FormatError).
pub(crate) struct Stack {
    check: bun_core::StackCheck,
    ran_out: Cell<bool>,
}

impl Stack {
    /// For code that walks a tree that has already been walked once.
    pub(crate) fn new() -> Stack {
        Stack {
            check: bun_core::StackCheck::init(),
            ran_out: Cell::new(false),
        }
    }

    /// See [`check_for_tree`].
    pub(crate) fn for_tree() -> Stack {
        Stack {
            check: check_for_tree(),
            ran_out: Cell::new(false),
        }
    }

    /// Stays false once the stack has run out, because the remaining work is discarded anyway.
    #[inline]
    pub(crate) fn has_room(&self) -> bool {
        let has_room = !self.ran_out.get() && self.check.is_safe_to_recurse();
        if !has_room {
            self.ran_out.set(true);
        }
        has_room
    }

    pub(crate) fn ran_out(&self) -> bool {
        self.ran_out.get()
    }
}
