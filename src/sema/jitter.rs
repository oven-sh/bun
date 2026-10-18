//! Makes races likely, for the tests of what tasks share while they run.
//!
//! The result of a check may not depend on which thread is first anywhere. A run that is right proves little: the windows
//! are a few instructions wide. So a test asks the threads to wait where what the others see has just changed or is about
//! to, each time for as long as a seed says, and compares the reports of many seeds. `ignores_stamps` is the control: with
//! it the same test has to find a difference.
//!
//! All of it is off unless `seed` is set, which only the standalone tool does.

/// A field of `PlanOptions`. Every task has a copy.
#[derive(Copy, Clone, Default)]
pub struct Jitter {
    /// 0: no thread waits anywhere, and the other fields but `ignores_stamps` mean nothing.
    pub seed: u64,
    /// Where threads wait: a bit set by `Place`.
    pub places: u32,
    /// Nonzero: one commit in `stretches_one_in` sleeps this many microseconds at each `Jitter::stretch`.
    pub stretch: u32,
    pub stretches_one_in: u32,
    /// A commit stores what is keyed by syntax in an order that follows from the seed.
    pub shuffles: bool,
    /// An entry that is keyed by syntax counts for every task as soon as it is stored: see `check::commit::View`.
    pub ignores_stamps: bool,
}

/// Where a thread has just made something visible to the others, or is about to.
#[derive(Copy, Clone)]
pub enum Place {
    /// A record can be found, and nothing is stored about it yet.
    RecordPublished,
    /// A task has reserved ids, which have no record yet.
    IdsTaken,
    AtomPublished,
    /// Before an entry is written at once: between the look that has found nothing and the store, and between the stores
    /// of one evaluation.
    BeforeEntry,
    /// After it: the entry is there, and what the caller stores next is not.
    AfterEntry,
    /// `Program::claim_variances`, before it asks and after it was answered.
    Claim,
    /// `Program::share_variances`, before and after.
    VariancesShared,
    TaskBegins,
    /// A task has begun to visit a file.
    FileBegins,
    /// `Checker::commit`, before it asks for the mutex.
    CommitBegins,
    /// .. after an entry: part of what the commit stores is there.
    EntryStored,
    /// .. before it says that everything is stored.
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

    /// Of 256 times that a thread comes by, how many times it waits, and the binary logarithm of the longest wait. The more
    /// often a task comes by a place, the less.
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
    /// `salt`: tells this time from the others, and is the same in every run with one seed.
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
        // Every order of magnitude is as likely as any other: a window may be a few instructions or a whole commit.
        let magnitude = (random >> 8 & 0xff) % (longest + 1);
        let iterations = (1 << magnitude) | random >> 16 & ((1 << magnitude) - 1);
        if random >> 60 == 0 {
            // The scheduler may give the core to somebody else.
            for _ in 0..iterations.min(64) {
                std::thread::yield_now();
            }
        } else {
            for _ in 0..iterations {
                std::hint::spin_loop();
            }
        }
    }

    /// Between two parts of a commit. `commit`: a number that no other commit has.
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

    /// `Some`: what to sort by in place of the order that things are in. `salt`: of one of them.
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
