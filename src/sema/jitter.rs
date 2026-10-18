//! Injects delays that make races between tasks likely. Used to test the state that running tasks share.
//!
//! The result of a check must not depend on thread timing. One correct run proves little, because the race windows are
//! only a few instructions wide. So a test makes threads pause right before or right after they change shared state.
//! The seed picks the length of each pause, and the test compares the reports from many seeds. `ignores_stamps` is the
//! control: with it set, the same test must find a difference.
//!
//! Everything is off unless `seed` is set. Only the standalone tool sets it.

/// Delay settings from `PlanOptions`. Every task has a copy.
#[derive(Copy, Clone, Default)]
pub struct Jitter {
    /// 0 turns every delay off. All other fields except `ignores_stamps` are then ignored.
    pub seed: u64,
    /// Bit set of the `Place`s where threads pause.
    pub places: u32,
    /// If nonzero, one commit in `stretches_one_in` sleeps this many microseconds at each `Jitter::stretch` call.
    pub stretch: u32,
    pub stretches_one_in: u32,
    /// Makes a commit store its entries keyed by syntax in an order derived from the seed.
    pub shuffles: bool,
    /// Makes an entry keyed by syntax visible to every task as soon as it is stored. See `check::commit::View`.
    pub ignores_stamps: bool,
}

/// A point where a thread has just changed shared state or is about to.
#[derive(Copy, Clone)]
pub enum Place {
    /// A record is published, but no table has an entry for it yet.
    RecordPublished,
    /// A task has reserved ids that don't have records yet.
    IdsTaken,
    AtomPublished,
    /// Right before an immediate write of an entry (`Task::may_write_at_once`). That is after the lookup that missed,
    /// and between two stores of the same evaluation.
    BeforeEntry,
    /// Right after an immediate write. The entry is visible, but the caller's next store isn't.
    AfterEntry,
    /// Before and after the call to `Program::claim_variances`.
    Claim,
    /// Before and after the call to `Program::share_variances`.
    VariancesShared,
    TaskBegins,
    /// A task has started visiting a file.
    FileBegins,
    /// In `Checker::commit`, before it locks the mutex.
    CommitBegins,
    /// In a commit, after each entry it stores. Only part of the commit is visible.
    EntryStored,
    /// In a commit, before it marks itself as fully stored.
    CommitEnds,
}

impl Place {
    #[cfg(test)]
    const NAMES: [&str; 12] = [
        "record-published",
        "ids-taken",
        "atom-published",
        "before-entry",
        "after-entry",
        "claim",
        "variances-shared",
        "task-begins",
        "file-begins",
        "commit-begins",
        "entry-stored",
        "commit-ends",
    ];

    /// Returns how many of 256 visits pause, and log2 of the longest pause. Both are smaller for places that tasks
    /// visit more often.
    fn weight(self) -> (u64, u64) {
        match self {
            Place::RecordPublished
            | Place::AtomPublished
            | Place::BeforeEntry
            | Place::AfterEntry
            | Place::EntryStored => (8, 12),
            Place::IdsTaken | Place::FileBegins => (32, 16),
            Place::Claim
            | Place::VariancesShared
            | Place::TaskBegins
            | Place::CommitBegins
            | Place::CommitEnds => (128, 18),
        }
    }
}

/// SplitMix64
fn mix(seed: u64, salt: u64) -> u64 {
    let mut random = seed ^ salt.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    random = (random ^ random >> 30).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    random = (random ^ random >> 27).wrapping_mul(0x94D0_49BB_1331_11EB);
    random ^ random >> 31
}

impl Jitter {
    /// Pauses at `place` if the seed picks this call. `salt` distinguishes this call from the others and must be the
    /// same in every run with the same seed.
    #[inline]
    pub(crate) fn wait_at(&self, place: Place, salt: u64) {
        if self.seed != 0 {
            self.wait(place, salt);
        }
    }

    #[cold]
    #[inline(never)]
    fn wait(&self, place: Place, salt: u64) {
        if self.places >> place as u32 & 1 == 0 {
            return;
        }
        let random = mix(self.seed ^ (place as u64) << 58, salt);
        let (times_of_256, longest) = place.weight();
        if random & 0xff >= times_of_256 {
            return;
        }
        // Pick the order of magnitude uniformly. A race window can be a few instructions or a whole commit.
        let magnitude = (random >> 8 & 0xff) % (longest + 1);
        let iterations = (1 << magnitude) | random >> 16 & ((1 << magnitude) - 1);
        if random >> 60 == 0 {
            // Let the scheduler run another thread on this core.
            for _ in 0..iterations.min(64) {
                std::thread::yield_now();
            }
        } else {
            for _ in 0..iterations {
                std::hint::spin_loop();
            }
        }
    }

    /// Called between two phases of a commit. Sleeps if the seed picks this commit. `commit` is the commit's unique
    /// number.
    #[inline]
    pub(crate) fn stretch(&self, commit: u64) {
        if self.seed != 0 && self.stretch != 0 {
            self.sleep(commit);
        }
    }

    #[cold]
    #[inline(never)]
    fn sleep(&self, commit: u64) {
        if mix(self.seed, commit).is_multiple_of(u64::from(self.stretches_one_in.max(1))) {
            std::thread::sleep(std::time::Duration::from_micros(u64::from(self.stretch)));
        }
    }

    /// Returns the sort key of the item that `salt` identifies, or `None` if shuffling is off.
    #[inline]
    pub(crate) fn order(&self, salt: u64) -> Option<u64> {
        (self.seed != 0 && self.shuffles).then(|| mix(self.seed, salt))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_happens_without_a_seed() {
        let off = Jitter {
            places: u32::MAX,
            stretch: u32::MAX,
            stretches_one_in: 1,
            shuffles: true,
            ..Jitter::default()
        };
        off.wait_at(Place::CommitEnds, 1);
        off.stretch(1);
        assert_eq!(off.order(1), None);
    }

    #[test]
    fn one_seed_gives_one_order() {
        let on = Jitter {
            seed: 7,
            shuffles: true,
            ..Jitter::default()
        };
        assert_eq!(on.order(3), on.order(3));
        assert_ne!(on.order(3), on.order(4));
        assert_eq!(Place::NAMES.len(), Place::CommitEnds as usize + 1);
    }
}
