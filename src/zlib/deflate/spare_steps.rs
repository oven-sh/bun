//! How far chains are followed that have other bytes than the ones that are looked for.

use core::cell::Cell;

/// To get to a candidate that starts like the target. More than that are spare steps.
pub(super) const FIRST_STEPS: u32 = 8;
const PER_POSITION: u32 = 2;
/// In positions. Three times what a gigabyte of files of all kinds has taken.
const MAX_SPENT_AHEAD: u32 = 4096;
/// The longest that is followed while there are none.
const SHORT_CHAIN: u32 = 2 * FIRST_STEPS;

#[derive(Default)]
pub(super) struct SpareSteps {
    /// Those of all positions in front of it have been taken.
    spent_until: Cell<u32>,
    max_chain: Cell<u32>,
}

impl SpareSteps {
    /// Whether there are any. Until it is asked again, `max_chain()` is `wanted` only if so.
    pub(super) fn check(&self, position: u32, wanted: u32) -> bool {
        let has_some = self.spent_until.get() <= position + MAX_SPENT_AHEAD;
        let max = if has_some { wanted } else { SHORT_CHAIN };
        self.max_chain.set(wanted.min(max));
        has_some
    }

    #[inline(always)]
    pub(super) fn max_chain(&self) -> u32 {
        self.max_chain.get()
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
        assert!(!steps.check(40_000, 9) && steps.max_chain() == 9);
        steps.slide(32_768);
        assert!(!steps.check(7232, 99) && steps.check(7233, 99));
        steps.slide(32_768);
        assert!(steps.check(0, 99));
    }
}
