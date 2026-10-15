//! How deep something can be nested: as deep as there is stack for.

use bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;
use std::cell::Cell;

/// For what builds a tree, and for the first that calls itself for what is nested in a tree that a loop has built: see
/// [`bun_core::StackCheck::with_at_most`]. So what comes afterwards has room, and what takes time or memory in proportion
/// to the square of the depth meets nothing deeper on a large stack than on the smallest.
pub(crate) fn check_for_tree() -> bun_core::StackCheck {
    bun_core::StackCheck::init().with_at_most(DEFAULT_THREAD_STACK_SIZE as usize)
}

/// What is nested is read, walked and written by functions that call themselves. Each asks before it goes a level
/// deeper. One that is told no goes on with anything: what is being made is of no use then, and whoever started it
/// asks [`Stack::ran_out`] at the end and answers with [`FormatError::NestedTooDeeply`](crate::FormatError).
pub(crate) struct Stack {
    check: bun_core::StackCheck,
    ran_out: Cell<bool>,
}

impl Stack {
    /// For what walks a tree that has been walked.
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

    /// Not any more once it has run out: what is left to do is of no use.
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
