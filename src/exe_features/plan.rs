//! What is live once some features are excluded, and where it goes.

use crate::table::{NO_UNIT, ROOT, Table};

pub(crate) struct Options<'a> {
    /// The ids of the features that are out.
    pub(crate) excluded: &'a [u32],
    #[cfg(feature = "tool")]
    pub(crate) testing: Testing,
}

/// The controls of the build.
#[cfg(feature = "tool")]
#[derive(Default, Clone, Copy)]
pub struct Testing {
    /// Take every conditional edge, so that everything stays: the output has to equal the input.
    pub keep_everything: bool,
    /// Break a run after every n-th piece, so that pieces that would travel together get displacements of their own and
    /// every reference between them is exercised. 0: do not.
    pub scatter: u32,
    /// What to leave between scattered pieces, where there is room.
    pub gap: u64,
}

impl<'a> Options<'a> {
    pub(crate) fn excluding(excluded: &'a [u32]) -> Self {
        Self {
            excluded,
            #[cfg(feature = "tool")]
            testing: Testing::default(),
        }
    }

    pub(crate) fn keeps_everything(&self) -> bool {
        #[cfg(feature = "tool")]
        return self.testing.keep_everything;
        #[cfg(not(feature = "tool"))]
        false
    }

    fn scatter(&self) -> (u32, u64) {
        #[cfg(feature = "tool")]
        return (
            self.testing.scatter,
            if self.testing.scatter != 0 {
                self.testing.gap
            } else {
                0
            },
        );
        #[cfg(not(feature = "tool"))]
        (0, 0)
    }

    pub(crate) fn is_excluded(&self, feature: u32) -> bool {
        self.excluded.contains(&feature)
    }

    fn holds(&self, condition: u32) -> bool {
        condition == 0
            || self.keeps_everything()
            || self.is_excluded((condition - 1) >> 1) == condition.is_multiple_of(2)
    }
}

/// Neighbouring live pieces, which move as one, so that the order and the padding between them stay as the linker made them.
#[derive(Clone, Copy)]
pub(crate) struct Run {
    pub(crate) start: u64,
    pub(crate) end: u64,
    pub(crate) delta: i64,
    align: u64,
    first_unit: usize,
    last_unit: usize,
}

pub(crate) struct Plan {
    pub(crate) is_unit_live: Vec<bool>,
    /// Per unit: is any unit of its piece live, and how far does the piece move?
    pub(crate) is_piece_live: Vec<bool>,
    pub(crate) delta: Vec<i64>,
    /// Per area of the table.
    pub(crate) runs: Vec<Vec<Run>>,
}

pub(crate) fn plan(t: &Table, o: &Options<'_>) -> Plan {
    // ---- what is live: whatever is reached from the roots
    let mut is_unit_live = vec![false; t.units.len()];
    let mut work: Vec<u32> = Vec::new();
    let touch = |unit: u32, is_unit_live: &mut [bool], work: &mut Vec<u32>| {
        if unit != NO_UNIT && !is_unit_live[unit as usize] {
            is_unit_live[unit as usize] = true;
            work.push(unit);
        }
    };
    for (u, unit) in t.units.iter().enumerate() {
        if unit.flags & ROOT != 0 {
            touch(u as u32, &mut is_unit_live, &mut work);
        }
    }
    // What is in no unit always stays.
    let mut u = 0;
    for f in &t.fixups {
        while u < t.units.len() && t.units[u].end() <= f.place {
            u += 1;
        }
        if (u == t.units.len() || f.place < t.units[u].start) && !f.form.is_weak() {
            touch(f.target, &mut is_unit_live, &mut work);
        }
    }
    while let Some(u) = work.pop() {
        let unit = &t.units[u as usize];
        for f in t.fixups_in(unit.start, unit.end()) {
            if !f.form.is_weak() {
                touch(f.target, &mut is_unit_live, &mut work);
            }
        }
        for flow in t.flows_from(u) {
            if o.holds(flow.condition) {
                touch(flow.to, &mut is_unit_live, &mut work);
            }
        }
    }

    let mut is_piece_live = vec![false; t.units.len()];
    let mut first = 0;
    while first < t.units.len() {
        let next = t.units[first + 1..]
            .iter()
            .position(|u| u.starts_piece())
            .map_or(t.units.len(), |n| first + 1 + n);
        let is_live = is_unit_live[first..next].contains(&true);
        is_piece_live[first..next].fill(is_live);
        first = next;
    }

    // ---- where it goes
    let (scatter, gap) = o.scatter();
    let gap = gap.cast_signed();
    let mut delta = vec![0i64; t.units.len()];
    let mut runs = Vec::with_capacity(t.areas.len());
    for area in &t.areas {
        let mut list: Vec<Run> = Vec::new();
        let mut is_open = false;
        let mut pieces = 0;
        let first = t.units.partition_point(|u| u.start < area.low);
        for (u, unit) in t
            .units
            .iter()
            .enumerate()
            .skip(first)
            .take_while(|(_, unit)| unit.start < area.high)
        {
            if !is_piece_live[u] {
                is_open = false;
                continue;
            }
            if is_open && unit.starts_piece() && scatter != 0 && pieces >= scatter {
                is_open = false;
            }
            if !is_open {
                list.push(Run {
                    start: unit.start,
                    end: 0,
                    delta: 0,
                    align: 1,
                    first_unit: u,
                    last_unit: u,
                });
                is_open = true;
                pieces = 0;
            }
            let run = list.last_mut().expect("just pushed");
            if unit.starts_piece() {
                pieces += 1;
                run.align = run.align.max(1 << unit.log2_align);
            }
            run.end = unit.end();
            run.last_unit = u;
        }
        // The largest multiple of the alignment that fits in `space`.
        let fit =
            |space: i64, align: u64| space.div_euclid(align.cast_signed()) * align.cast_signed();
        if area.towards_high {
            let mut cursor = area.high.cast_signed();
            for run in list.iter_mut().rev() {
                run.delta = fit(cursor - gap - run.end.cast_signed(), run.align);
                if run.delta < 0 {
                    run.delta = fit(cursor - run.end.cast_signed(), run.align);
                }
                cursor = run.start.cast_signed() + run.delta;
            }
        } else {
            let mut cursor = list.first().map_or(area.low, |run| run.start).cast_signed();
            for run in &mut list {
                run.delta = -fit(run.start.cast_signed() - cursor - gap, run.align);
                if run.delta > 0 {
                    run.delta = -fit(run.start.cast_signed() - cursor, run.align);
                }
                cursor = run.end.cast_signed() + run.delta;
            }
        }
        for run in &list {
            delta[run.first_unit..=run.last_unit].fill(run.delta);
        }
        runs.push(list);
    }
    Plan {
        is_unit_live,
        is_piece_live,
        delta,
        runs,
    }
}
