//! Baseline code that has been replaced is freed when no stack needs it any more.
//!
//! Every thread that has an instance of the module when the code is replaced keeps it until its collector, looking at
//! the stack, finds no address in it. No thread can enter it anew.

use std::sync::Arc;

use bun_threading::Guarded;

use super::InstalledCode;

/// What a thread keeps.
#[derive(Default)]
pub(crate) struct RetiredCode(Guarded<Vec<Arc<InstalledCode>>>);

impl RetiredCode {
    pub(super) fn add(&self, code: Arc<InstalledCode>) {
        self.0.lock().push(code);
    }

    /// # Safety
    /// The thread is in native code, and all return addresses on its stacks are among `words`.
    pub(crate) unsafe fn release_all_but(&self, words: &[usize]) {
        let mut candidates = core::mem::take(&mut *self.0.lock());
        if candidates.is_empty() {
            return;
        }
        let mut words = words.to_vec();
        words.sort_unstable();
        candidates.retain(|code| {
            let mut is_needed = false;
            code.for_each_range(|range| {
                let first = words.partition_point(|word| word < range.start());
                is_needed |= words.get(first).is_some_and(|word| range.contains(word));
            });
            is_needed
        });
        self.0.lock().append(&mut candidates);
    }
}
