//! What a marker has yet to do.

/// In an entry, below the address of the cell: its memory has been counted by an earlier visit.
pub(super) const REVISIT: usize = 1;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RunKind {
    Words,
    /// Records of two words, the second of which is no value.
    Keys,
    /// The same of three.
    KeysAndValues,
    /// See `Visitor::append_ephemerons`.
    Ephemerons,
    /// Addresses of cells that the barrier passes over, as they have been remembered.
    Remembered,
    /// The same, which it has been heeding again since before the last time that scripts were stopped.
    Changed,
    /// Addresses of cells whose output constraints are due.
    OutputOfCells,
    /// References to blocks, for those of their cells that are marked.
    OutputOfBlocks,
    /// References to them.
    ChunksOfWeakHandles,
    WeakHandles,
    /// See `Visitor::count_marks`.
    BlocksToCount,
    /// See `Survivors::condemn_keys`, and `condemn_keys_with_values`.
    WeakKeys,
    WeakKeysWithValues,
}

impl RunKind {
    /// The others are gone through again in any case before marking ends.
    pub(super) fn can_be_visited_while_scripts_run(self) -> bool {
        !matches!(
            self,
            RunKind::OutputOfCells
                | RunKind::OutputOfBlocks
                | RunKind::ChunksOfWeakHandles
                | RunKind::WeakHandles
        )
    }

    const fn words_per_item(self) -> usize {
        match self {
            RunKind::Keys | RunKind::WeakKeys => 2,
            RunKind::KeysAndValues | RunKind::Ephemerons | RunKind::WeakKeysWithValues => 3,
            _ => 1,
        }
    }

    const fn items_per_chunk(self) -> usize {
        match self {
            RunKind::OutputOfCells => 16,
            RunKind::OutputOfBlocks | RunKind::ChunksOfWeakHandles => 1,
            RunKind::BlocksToCount => 32,
            RunKind::WeakHandles => 64,
            _ => RECORDS_PER_CHUNK,
        }
    }
}

pub(super) const RECORDS_PER_CHUNK: usize = 256;

/// Items that follow each other in memory, which stays until they have been seen to.
#[derive(Clone, Copy)]
pub(super) struct Run {
    pub(super) kind: RunKind,
    pub(super) first: usize,
    pub(super) count: usize,
}

impl Run {
    pub(super) fn of<T>(kind: RunKind, items: &[T]) -> Run {
        const { assert!(size_of::<T>() == size_of::<usize>()) };
        Run {
            kind,
            first: items.as_ptr().expose_provenance(),
            count: items.len(),
        }
    }

    /// # Safety
    /// Made by `of` with that type.
    pub(super) unsafe fn items<'a, T>(self) -> &'a [T] {
        // SAFETY: the caller's.
        unsafe {
            core::slice::from_raw_parts(core::ptr::with_exposed_provenance(self.first), self.count)
        }
    }

    fn split_off_first(&mut self, count: usize) -> Run {
        let first = Run { count, ..*self };
        self.first += count * self.kind.words_per_item() * size_of::<usize>();
        self.count -= count;
        first
    }
}

/// For another marker.
pub(super) enum Share {
    Cells(Vec<usize>),
    Runs(Vec<Run>),
}

#[derive(Default)]
pub(super) struct MarkStack {
    pub(super) cells: Vec<usize>,
    /// So many of the first cells have been given away.
    pub(super) given: usize,
    /// They wait until there are no cells, so that there are never many.
    runs: Vec<Run>,
}

impl MarkStack {
    pub(super) fn is_empty(&self) -> bool {
        self.cells.len() == self.given && self.runs.is_empty()
    }

    #[inline(always)]
    pub(super) fn push(&mut self, entry: usize) {
        self.cells.push(entry);
    }

    pub(super) fn pop(&mut self) -> Option<usize> {
        if self.cells.len() == self.given {
            return None;
        }
        self.cells.pop()
    }

    pub(super) fn reserve(&mut self, additional: usize) {
        if self.given >= self.cells.len() / 2 {
            self.cells.drain(..core::mem::take(&mut self.given));
        }
        self.cells.reserve(additional);
    }

    #[inline(always)]
    pub(super) fn has_runs(&self) -> bool {
        !self.runs.is_empty()
    }

    /// One that is sure to be worth waking a helper for.
    pub(super) fn has_long_run(&self) -> bool {
        const CHUNKS: usize = 512;
        (self.runs.first()).is_some_and(|run| run.count >= CHUNKS * run.kind.items_per_chunk())
    }

    pub(super) fn push_run(&mut self, run: Run) {
        if run.count != 0 {
            self.runs.push(run);
        }
    }

    pub(super) fn pop_chunk(&mut self) -> Option<Run> {
        let run = self.runs.last_mut()?;
        let items = run.kind.items_per_chunk();
        if run.count > items {
            return Some(run.split_off_first(items));
        }
        self.runs.pop()
    }

    /// About half of it, if that is enough to be worth it. What is at the bottom has the most behind it.
    pub(super) fn take_share(&mut self) -> Option<Share> {
        /// A marker fetches the memory of a few cells at once as it is.
        const MIN_CELLS: usize = 32;
        const MAX_SHARE: usize = 4096;
        let cells = self.cells.len() - self.given;
        match &mut self.runs[..] {
            [run] if run.count >= 2 * run.kind.items_per_chunk() => {
                return Some(Share::Runs(vec![run.split_off_first(run.count / 2)]));
            }
            [] => {}
            [_] if cells == 0 => {}
            runs => {
                let count = runs.len().div_ceil(2);
                return Some(Share::Runs(self.runs.drain(..count).collect()));
            }
        }
        if cells < MIN_CELLS {
            return None;
        }
        let first = self.given;
        self.given += (cells / 2).min(MAX_SHARE);
        Some(Share::Cells(self.cells[first..self.given].to_vec()))
    }

    /// `None` once it is empty.
    pub(super) fn take_all(&mut self) -> Option<Share> {
        if self.has_runs() {
            return Some(Share::Runs(core::mem::take(&mut self.runs)));
        }
        let cells = self.cells.split_off(self.given);
        (!cells.is_empty()).then_some(Share::Cells(cells))
    }

    pub(super) fn clear(&mut self) {
        self.cells.truncate(self.given);
        self.runs.clear();
    }

    pub(super) fn accept(&mut self, share: Share) {
        match share {
            Share::Cells(cells) => {
                self.reserve(cells.len());
                self.cells.extend(cells);
            }
            Share::Runs(runs) => self.runs.extend(runs),
        }
    }

    /// It is empty.
    pub(super) fn shrink(&mut self) {
        const KEPT_CELLS: usize = 4096;
        self.reserve(0);
        self.cells.shrink_to(KEPT_CELLS);
        self.runs = Vec::new();
    }
}
