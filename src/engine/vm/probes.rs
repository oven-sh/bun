//! What optimized code shares with the run time when a build with assertions is asked to try it.

use core::cell::Cell;
use core::mem::offset_of;

use crate::Vm;

bitflags::bitflags! {
    /// What the code that has called the run time counts on not to happen.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    #[repr(transparent)]
    pub struct Forbidden: u32 {
        const SCRIPTS = 1 << 0;
        const COLLECTING = 1 << 1;
        const INVALIDATING = 1 << 2;
    }
}

#[repr(C)]
pub struct Probes {
    /// How many more checks pass before the run time is asked whether one should fail.
    pub checks_left: Cell<i32>,
    /// To the latest question. Zero is to go on.
    pub answer: Cell<u32>,
    pub forbidden: Cell<Forbidden>,
}

impl Probes {
    pub const OFFSET_OF_CHECKS_LEFT: usize = offset_of!(Probes, checks_left);
    pub const OFFSET_OF_ANSWER: usize = offset_of!(Probes, answer);
    pub const OFFSET_OF_FORBIDDEN: usize = offset_of!(Probes, forbidden);

    pub(crate) fn new() -> Probes {
        Probes {
            checks_left: Cell::new(1),
            answer: Cell::new(0),
            forbidden: Cell::default(),
        }
    }
}

impl Vm {
    #[inline(always)]
    #[track_caller]
    pub(crate) fn assert_is_allowed(&self, what: Forbidden) {
        debug_assert!(
            !self.probes().forbidden.get().intersects(what),
            "optimized code does not expect this"
        );
    }
}
