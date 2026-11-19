//! How far chains are followed that have other bytes than the ones that are looked for.

use core::cell::Cell;

/// To get to a candidate that starts like the target. More than that are spare steps.
pub(super) const FIRST_STEPS: u32 = 8;
const PER_POSITION: u32 = 2;
/// In positions. Three times what a gigabyte of files of all kinds has taken.
const MAX_SPENT_AHEAD: u32 = 4096;
/// The longest that is followed while there are none.
pub(super) const SHORT_CHAIN: u32 = 2 * FIRST_STEPS;

#[derive(Default)]
pub(super) struct SpareSteps {
    /// Those of all positions in front of it have been taken.
    spent_until: Cell<u32>,
}

impl SpareSteps {
    #[inline(always)]
    pub(super) fn has_some(&self, position: u32) -> bool {
        self.spent_until.get() <= position + MAX_SPENT_AHEAD
    }

    pub(super) fn spend(&self, position: u32, steps: u32) {
        let from = position.max(self.spent_until.get());
        self.spent_until.set(from + steps.div_ceil(PER_POSITION));
    }

    pub(super) fn slide(&mut self, window_size: u32) {
        self.spent_until.update(|it| it.saturating_sub(window_size));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn they_go_with_the_positions() {
        let mut steps = SpareSteps::default();
        steps.spend(40_000, 2 * 4096 + 1);
        assert!(!steps.has_some(40_000));
        steps.slide(32_768);
        assert!(!steps.has_some(7232) && steps.has_some(7233));
        steps.slide(32_768);
        assert!(steps.has_some(0));
    }
}
