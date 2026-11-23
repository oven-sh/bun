//! Visual runs (L2) and the index map of a text whose levels are resolved. ICU4C: ubidiln.cpp

use crate::common::memory::{try_push, try_with_capacity};
use crate::common::slice_ext::{SliceExt, slices_equal};
use crate::common::ubidi::{Direction, MAX_RUN_COUNT, UBiDi, UBiDiLevel, skip_equal};
use crate::common::umutex::Mutex;
use crate::common::utypes::{U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use std::mem::{MaybeUninit, take};
use std::slice;
use std::sync::OnceLock;

struct Run {
    logical_start: usize,
    length: usize,
    level: UBiDiLevel,
}

/// Iterates over the runs of equal levels.
fn level_runs(levels: &[UBiDiLevel]) -> impl Iterator<Item = Run> {
    let mut limit = 0;
    std::iter::from_fn(move || {
        let (start, &level) = (limit, levels.get(limit)?);
        limit = skip_equal(levels, start + 1, level);
        Some(Run {
            logical_start: start,
            length: limit - start,
            level,
        })
    })
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

/// The runs in visual order. Several threads can call the functions that read them, also before they are computed.
#[derive(Default)]
pub(crate) struct Runs {
    /// The only run, if the text is known to have one. It needs no memory.
    one: Option<Run>,
    many: OnceLock<Vec<Run>>,
    /// The memory of an earlier text. It moves to `many` with the runs, and back in `clear`.
    spare: Mutex<Vec<Run>>,
}

impl Runs {
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
            self.spare = Mutex::new(runs);
        }
    }

    /// For an empty text, after `clear`.
    pub(crate) fn set_empty(&mut self) {
        let mut runs = take(&mut *self.spare.lock());
        runs.clear();
        self.many = OnceLock::from(runs);
    }
}

impl UBiDi {
    /// Stores the run of a text that has exactly one.
    pub(crate) fn init_single_run(&mut self) {
        let level = if self.direction != Direction::Mixed {
            self.para_level
        } else if let Some((&first, rest)) = self.levels.split_first()
            && slices_equal(rest, self.levels.slice(..rest.len()))
        {
            first
        } else {
            return;
        };
        self.runs.one = Some(Run {
            logical_start: 0,
            length: self.length,
            level,
        });
    }

    /// Computes the runs on first use. `self` is valid.
    #[inline]
    fn init_runs(&self) -> Result<&[Run], UErrorCode> {
        self.runs.get().map_or_else(|| self.init_many_runs(), Ok)
    }

    #[inline(never)]
    fn init_many_runs(&self) -> Result<&[Run], UErrorCode> {
        let run_count = level_runs(&self.levels).count();
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
        // Perf: `add` passes each run through the stack, which stalls the processor.
        level_runs(&self.levels).for_each(|run| _ = try_push(&mut runs, run));
        reorder_line(&mut runs);
        Ok(self.runs.many.get_or_init(|| runs))
    }

    /// `ubidi_countRuns`. `self` is valid.
    pub(crate) fn count_runs(&self) -> Result<usize, UErrorCode> {
        self.init_runs().map(<[Run]>::len)
    }

    /// `ubidi_getVisualMap`. `self` is valid, and `index_map` is as long as the text.
    pub(crate) fn get_visual_map(
        &self,
        index_map: &mut [MaybeUninit<i32>],
    ) -> Result<(), UErrorCode> {
        fn number<'a>(slots: impl Iterator<Item = &'a mut MaybeUninit<i32>>, first: usize) {
            slots
                .zip(first..)
                .for_each(|(slot, index)| _ = slot.write(index as i32));
        }
        let mut rest = index_map;
        for run in self.init_runs()? {
            let slots;
            (slots, rest) = rest.split_soft_mut(run.length);
            if run.level & 1 != 0 {
                number(slots.iter_mut().rev(), run.logical_start);
            } else {
                number(slots.iter_mut(), run.logical_start);
            }
        }
        Ok(())
    }
}
