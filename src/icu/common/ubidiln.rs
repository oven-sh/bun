//! Visual runs (L2) and the index map of a text whose levels are resolved. ICU4C: ubidiln.cpp

use crate::common::memory::{Appendable, try_push, try_with_capacity};
use crate::common::slice_ext::{SliceExt, slices_equal};
use crate::common::ubidi::{Direction, MAX_RUN_COUNT, Run, UBiDi, UBiDiLevel, skip_equal};
use crate::common::umutex::Mutex;
use crate::common::utypes::{U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use std::mem::{MaybeUninit, take};
use std::slice;
use std::sync::OnceLock;

impl Run {
    fn new(logical_start: usize, length: usize, level: UBiDiLevel) -> Self {
        Self {
            logical_start,
            is_odd: level & 1 != 0,
            level,
            visual_limit: length,
        }
    }
}

/// Iterates over the runs with their lengths.
fn with_lengths(runs: &[Run]) -> impl Iterator<Item = (&Run, usize)> {
    WithLengths {
        runs: runs.iter(),
        visual_start: 0,
    }
}

struct WithLengths<'a> {
    runs: std::slice::Iter<'a, Run>,
    /// Visual start of the first remaining run.
    visual_start: usize,
}

impl<'a> Iterator for WithLengths<'a> {
    type Item = (&'a Run, usize);

    fn next(&mut self) -> Option<Self::Item> {
        let run = self.runs.next()?;
        Some((
            run,
            run.visual_limit - std::mem::replace(&mut self.visual_start, run.visual_limit),
        ))
    }
}

/// Numbers `slots` from `first` on, backwards if the run is odd.
fn assign_indexes<'a>(
    run: &Run,
    slots: impl DoubleEndedIterator<Item = &'a mut MaybeUninit<i32>>,
    first: i32,
) {
    fn number<'a>(slots: impl Iterator<Item = &'a mut MaybeUninit<i32>>, mut next: i32) {
        for slot in slots {
            slot.write(next);
            next = next.wrapping_add(1);
        }
    }
    if run.is_odd {
        number(slots.rev(), first)
    } else {
        number(slots, first)
    }
}

/// Iterates over the runs of equal levels. `visual_limit` holds the length of the run.
fn level_runs(levels: &[UBiDiLevel]) -> impl Iterator<Item = Run> {
    let mut limit = 0;
    std::iter::from_fn(move || {
        let (start, &level) = (limit, levels.get(limit)?);
        limit = skip_equal(levels, start + 1, level);
        Some(Run::new(start, limit - start, level))
    })
}

/// The runs in visual order. Several threads can call the functions that read them, also before they are computed.
pub(crate) struct Runs {
    /// The only run, if the text is known to have one. It needs no memory.
    one: Option<Run>,
    many: OnceLock<Vec<Run>>,
    /// The memory of an earlier text. It moves to `many` with the runs, and back in `clear`.
    spare: Mutex<Vec<Run>>,
}

impl Default for Runs {
    fn default() -> Self {
        Self {
            one: None,
            many: OnceLock::new(),
            spare: Mutex::new(Vec::new()),
        }
    }
}

impl Runs {
    fn set_memory(&mut self, memory: Vec<Run>) {
        self.spare = Mutex::new(memory);
    }

    #[inline]
    fn get(&self) -> Option<&[Run]> {
        self.one
            .as_ref()
            .map(slice::from_ref)
            .or_else(|| self.many.get().map(Vec::as_slice))
    }

    pub(crate) fn clear(&mut self) {
        self.one = None;
        if let Some(runs) = self.many.take() {
            self.set_memory(runs);
        }
    }

    /// Keeps the larger of the two arrays.
    pub(crate) fn set(&mut self, mut runs: Vec<Run>) {
        self.clear();
        let mut memory = take(&mut *self.spare.lock());
        if memory.capacity() > runs.capacity() {
            memory.clear();
            memory.add_all(&runs);
            runs = memory;
        }
        self.many = OnceLock::from(runs);
    }
}

impl UBiDi {
    /// `ubidi_countRuns`. `self` is valid.
    pub(crate) fn count_runs(&self) -> Result<usize, UErrorCode> {
        self.runs
            .get()
            .map_or_else(|| self.init_many_runs(), Ok)
            .map(<[Run]>::len)
    }

    /// Iterates over the runs of a mixed text in logical order. `visual_limit` holds the length of the run.
    fn logical_runs(&self) -> impl Iterator<Item = Run> {
        level_runs(self.levels.slice(..self.length))
    }

    /// Reorders two or more runs (L2). The highest level is skipped: each sequence there is a single run.
    fn reorder_line(runs: &mut [Run]) {
        let (mut min_level, mut max_level) = (UBiDiLevel::MAX, 0);
        for run in &*runs {
            (min_level, max_level) = (min_level.min(run.level), max_level.max(run.level));
        }
        for level in (min_level + 1..max_level).rev() {
            runs.split_mut(|run| run.level < level)
                .for_each(<[Run]>::reverse);
        }
        if min_level & 1 != 0 {
            runs.reverse();
        }
    }

    /// Fills `runs`, which is empty and has the capacity. The text is mixed.
    fn compute_runs(&self, runs: &mut Vec<Run>) {
        debug_assert!(self.direction == Direction::Mixed);
        // Perf: `add` passes each run through the stack, which stalls the processor.
        self.logical_runs().for_each(|run| _ = try_push(runs, run));
        if runs.len() > 1 {
            Self::reorder_line(runs);
        }
        let mut visual_limit = 0;
        for run in runs {
            visual_limit += run.visual_limit;
            run.visual_limit = visual_limit;
        }
    }

    fn set_single_run(&mut self, level: UBiDiLevel) {
        self.runs.one = Some(Run::new(0, self.length, level));
    }

    /// Stores the run of a text that has exactly one.
    pub(crate) fn init_single_run(&mut self) {
        if self.direction != Direction::Mixed {
            self.set_single_run(self.para_level);
        } else if let Some((&first, rest)) = self.levels.slice(..self.length).split_first()
            && slices_equal(rest, self.levels.slice(..rest.len()))
        {
            self.set_single_run(first);
        }
    }

    /// Computes the runs on first use. `self` is valid. Fails with `U_MEMORY_ALLOCATION_ERROR` if there are more runs
    /// than `MAX_RUN_COUNT`.
    #[inline]
    fn init_runs(&self) -> Result<&[Run], UErrorCode> {
        self.runs.get().map_or_else(|| self.init_many_runs(), Ok)
    }

    #[inline(never)]
    fn init_many_runs(&self) -> Result<&[Run], UErrorCode> {
        let run_count = self.logical_runs().count();
        if run_count > MAX_RUN_COUNT {
            return Err(U_MEMORY_ALLOCATION_ERROR);
        }
        let spare = self.runs.spare.lock();
        if let Some(runs) = self.runs.many.get() {
            return Ok(runs);
        }
        // Other threads wait for the runs if the memory suffices. Otherwise each allocates its own, without the lock.
        let mut spare = (spare.capacity() >= run_count).then_some(spare);
        let mut runs = spare
            .as_deref_mut()
            .map_or_else(|| try_with_capacity(run_count), |memory| Ok(take(memory)))?;
        runs.clear();
        self.compute_runs(&mut runs);
        Ok(self.runs.many.get_or_init(|| runs))
    }

    /// `ubidi_getVisualMap`. `self` is valid, and `index_map` has at least the result length.
    pub(crate) fn get_visual_map(
        &self,
        index_map: &mut [MaybeUninit<i32>],
    ) -> Result<(), UErrorCode> {
        let runs = self.init_runs()?;
        let mut rest = index_map;
        for (run, length) in with_lengths(runs) {
            let slots;
            (slots, rest) = rest.split_at_mut(length.min(rest.len()));
            assign_indexes(run, slots.iter_mut(), run.logical_start as i32);
        }
        Ok(())
    }
}
