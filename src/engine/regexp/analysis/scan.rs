//! Chooses the units to look at when searching for the start of a match.

use smallvec::SmallVec;

use super::Next;
use super::frequency::Frequencies;
use super::prefix::{Cell, MAX_COLUMNS, MAX_ROWS, Prefixes};
use crate::Error;
use crate::compile::character::set_of;
use crate::compile::graph::{Graph, Step, masked_units};
use crate::program::{Probe, RowProbe, Scan, Width};
use crate::set::{CharRange, Latin1Set, Set};

// Costs are in cycles for sixteen positions.
const COST_OF_LOOP: f32 = 1.2;
const COST_OF_STOP: f32 = 16.0 * 24.0;
const COST_OF_LOW_HALVES: f32 = 0.8;
const COST_OF_BOTH_HALVES: f32 = 2.2;
const COST_OF_NARROWING: f32 = 1.6;

/// Above this the attempts themselves are the quickest search.
const MAX_STOPS: f32 = 0.3;
const FREQUENT_STOPS: f32 = 1.0 / 64.0;
/// Neighbours in text are not independent of each other.
const LEAST_SHARE_OF_LATER_PROBE: f32 = 0.02;
const LEAST_SHARE_IN_ROW: f32 = LEAST_SHARE_OF_LATER_PROBE / 4.0;

type Columns = SmallVec<[Column; MAX_COLUMNS + 1]>;

/// What all rows allow at an offset.
#[derive(Clone, Copy)]
struct Column {
    offset: i16,
    /// If it is the same for all.
    step: Option<Step>,
    share: f32,
    cost: f32,
}

type Few = SmallVec<[u16; 4]>;

/// Also returns the share of the positions at which it is expected to stop.
pub(crate) fn plan_scan(
    graph: &mut Graph,
    prefixes: &Prefixes,
    frequencies: &Frequencies,
) -> Result<Option<(Scan, f32)>, Error> {
    let planner = Planner {
        graph,
        prefixes,
        frequencies,
    };
    let mut columns = Columns::new();
    planner.list_columns(&mut columns);
    let (chosen, share, cost) = choose_probes(&columns);
    let rows = planner.choose_row_probes(&columns, cost);
    let share = rows.as_ref().map_or(share, |rows| rows.1);
    let rarest =
        || (0..columns.len()).min_by(|&a, &b| columns[a].share.total_cmp(&columns[b].share));
    let first = chosen.first().copied().or_else(rarest);
    let Some(first) = first.filter(|_| share <= MAX_STOPS) else {
        return Ok(None);
    };
    let mut probe = |column: Column| {
        let planner = Planner {
            graph,
            prefixes,
            frequencies,
        };
        let step = match column.step {
            Some(step) => step,
            None => {
                let set = planner.set_at(column.offset)?;
                Step::Class(graph.add_class(set)?)
            }
        };
        let offset = column.offset;
        Ok::<_, Error>(Probe { offset, step })
    };
    let mut scan = Scan {
        need: 0,
        first: probe(columns[first])?,
        others: SmallVec::new(),
        rows: rows.map_or_else(Vec::new, |rows| rows.0),
        stops_often: share > FREQUENT_STOPS,
    };
    for &other in chosen.iter().skip(1).filter(|_| scan.rows.is_empty()) {
        scan.others.push(probe(columns[other])?);
    }
    scan.need = scan.offsets().max().map_or(0, |last| last + 1) as u32;
    Ok(Some((scan, share)))
}

/// Returns their indices, the share of the positions that pass them, and the cost.
fn choose_probes(columns: &[Column]) -> (SmallVec<[usize; Scan::MAX_PROBES]>, f32, f32) {
    let (mut chosen, mut share, mut fixed) = (SmallVec::new(), 1.0, COST_OF_LOOP);
    let (mut taken, mut floor) = (0u32, 0.0);
    while chosen.len() < Scan::MAX_PROBES {
        let (mut best, mut least) = (None, share * COST_OF_STOP);
        for (index, column) in columns.iter().enumerate() {
            let total = column.cost + share * column.share.max(floor) * COST_OF_STOP;
            if total < least && taken >> index & 1 == 0 {
                (best, least) = (Some(index), total);
            }
        }
        let Some(best) = best else {
            break;
        };
        share *= columns[best].share.max(floor);
        fixed += columns[best].cost;
        chosen.push(best);
        (taken, floor) = (taken | 1 << best, LEAST_SHARE_OF_LATER_PROBE);
    }
    (chosen, share, fixed + share * COST_OF_STOP)
}

struct Planner<'a> {
    graph: &'a Graph,
    prefixes: &'a Prefixes,
    frequencies: &'a Frequencies,
}

impl Planner<'_> {
    fn cells_at(&self, offset: i16) -> impl Iterator<Item = Cell> {
        let rows = self.prefixes.rows.iter();
        rows.filter_map(move |row| match usize::try_from(offset) {
            Ok(column) => row.cells().get(column).copied(),
            Err(_) => row.before,
        })
    }

    fn list_columns(&self, columns: &mut Columns) {
        let rows = &self.prefixes.rows;
        let length = rows.iter().map(|row| row.cells().len()).min().unwrap_or(0);
        let has_before = rows.iter().all(|row| row.before.is_some());
        for offset in -i16::from(has_before)..length as i16 {
            columns.push(self.column(offset));
        }
    }

    #[inline(always)]
    fn column(&self, offset: i16) -> Column {
        let mut cells = self.cells_at(offset);
        let step = match cells.next() {
            Some(first @ Cell::Step(step)) if cells.all(|it| it == first) => Some(step),
            _ => None,
        };
        let of_unit = |unit| self.frequencies.of_unit(unit);
        let (share, cost) = match step {
            Some(Step::Unit { value, mask: 0 }) => (
                of_unit(value),
                0.6 * self.graph.width.bytes_per_unit() as f32,
            ),
            Some(Step::Unit { mask, .. }) if mask == self.graph.width.max_unit() => (1.0, 0.0),
            Some(Step::Unit { value, mask }) => {
                let share = masked_units(value, mask).map(of_unit).sum();
                (share, 0.9 * self.graph.width.bytes_per_unit() as f32)
            }
            _ => {
                let (units, few) = self.units_at(offset);
                let share = match &few {
                    Some(few) => few.iter().copied().map(of_unit).sum(),
                    None => self.share_of(&units),
                };
                (share, self.cost_of(&units, few.as_deref()))
            }
        };
        Column {
            offset,
            step,
            share,
            cost,
        }
    }

    /// And all of them, if they are few.
    fn units_at(&self, offset: i16) -> (Next, Option<Few>) {
        let (mut units, mut few) = (Next::NOTHING, Some(Few::new()));
        for cell in self.cells_at(offset) {
            units = units | self.prefixes.units(self.graph, cell);
            few = few.and_then(|few| self.with_members(few, cell));
        }
        (units, few)
    }

    fn set_at(&self, offset: i16) -> Result<Set, Error> {
        let (units, few) = self.units_at(offset);
        if !units.has_wide() || self.graph.width == Width::Latin1 {
            Ok(Set::from_latin1(*units.latin1()))
        } else if let Some(few) = few {
            set_of(few.iter().map(|&unit| CharRange::single(unit.into())))
        } else {
            set_of(units.ranges())
        }
    }

    fn with_members(&self, mut few: Few, cell: Cell) -> Option<Few> {
        let mut add = |unit: u16| {
            if !few.contains(&unit) {
                (few.len() < few.inline_size()).then(|| few.push(unit))?;
            }
            Some(())
        };
        match cell {
            Cell::Step(Step::Unit { value, mask }) => {
                masked_units(value, mask).try_for_each(add)?
            }
            Cell::Step(Step::Class(class)) => {
                let ranges = self.graph[class]
                    .ranges()
                    .take_while(|it| it.first <= 0xffff);
                let mut members = ranges.flat_map(|it| it.first..=it.last.min(0xffff));
                members.try_for_each(|c| add(c as u16))?;
            }
            Cell::Union(_) => {
                let units = self.prefixes.units(self.graph, cell);
                if units.has_wide() && self.graph.width == Width::Utf16 {
                    return None;
                }
                units.latin1().iter().try_for_each(|c| add(c.into()))?;
            }
        }
        Some(few)
    }

    fn share_of(&self, units: &Next) -> f32 {
        let latin1 = self.frequencies.of_latin1(units.latin1());
        if self.graph.width == Width::Latin1 {
            return latin1;
        }
        let wide = units.wide_ranges().map(|it| self.frequencies.of_wide(it));
        latin1 + wide.sum::<f32>()
    }

    fn cost_of(&self, units: &Next, few: Option<&[u16]>) -> f32 {
        let compared = match few {
            Some([_]) => Some(0.6),
            Some(&[a, b]) if (a ^ b).is_power_of_two() => Some(0.9),
            Some(few @ ([_, _] | [_, _, _])) => Some(0.6 * few.len() as f32),
            _ if units.ranges().nth(1).is_none() => Some(1.1),
            _ => None,
        };
        match (compared, self.graph.width) {
            (Some(cost), width) => cost * width.bytes_per_unit() as f32,
            (None, Width::Latin1) => COST_OF_BOTH_HALVES,
            (None, Width::Utf16) => COST_OF_BOTH_HALVES + COST_OF_NARROWING,
        }
    }

    /// The members as a row probe sees them.
    fn bytes(&self, cell: Cell) -> Latin1Set {
        let units = self.prefixes.units(self.graph, cell);
        let mut bytes = *units.latin1();
        if units.has_wide() && self.graph.width == Width::Utf16 {
            bytes.insert(0xff);
        }
        bytes
    }

    /// Returns them and the share of the positions that pass them, if they cost less than that.
    fn choose_row_probes(&self, columns: &[Column], to_beat: f32) -> Option<(Vec<RowProbe>, f32)> {
        let rows = self.prefixes.rows.len();
        if rows < 2 || columns.len() < 2 || to_beat <= COST_OF_LOOP + 2.0 * COST_OF_LOW_HALVES {
            return None;
        }
        let by_low_half = self.frequencies.of_ascii_by_low_half();
        let narrowing = match self.graph.width {
            Width::Latin1 => 0.0,
            Width::Utf16 => COST_OF_NARROWING,
        };
        let mut candidates = SmallVec::<[Candidate; 16]>::new();
        for column in columns {
            let mut exact = Candidate::new(column.offset, COST_OF_BOTH_HALVES + narrowing);
            let mut coarse = Candidate::new(column.offset, COST_OF_LOW_HALVES + narrowing);
            for (row, cell) in self.cells_at(column.offset).enumerate() {
                let bytes = self.bytes(cell);
                let (low, high) = halves(&bytes);
                for half in set_bits(low) {
                    exact.probe.low[half] |= 1 << row;
                    coarse.shares[row] += by_low_half[half];
                }
                for half in set_bits(high) {
                    exact.probe.high[half] |= 1 << row;
                }
                exact.shares[row] = self.frequencies.of_latin1(&bytes).max(LEAST_SHARE_IN_ROW);
                coarse.shares[row] = coarse.shares[row].max(LEAST_SHARE_IN_ROW);
            }
            coarse.probe.low = exact.probe.low;
            let is_ascii = exact.probe.high[8..] == [0; 8];
            coarse.probe.high[..if is_ascii { 8 } else { 16 }].fill(u8::MAX);
            candidates.push(exact);
            candidates.push(coarse);
        }

        let mut shares = [0.0; MAX_ROWS];
        shares[..rows].fill(1.0);
        let (mut chosen, mut taken) = (SmallVec::<[usize; Scan::MAX_ROW_PROBES]>::new(), 0u32);
        let (mut share, mut fixed) = (rows as f32, COST_OF_LOOP);
        while chosen.len() < Scan::MAX_ROW_PROBES && fixed < to_beat {
            let (mut best, mut least) = (None, share * COST_OF_STOP);
            for (index, candidate) in candidates.iter().enumerate() {
                let total = candidate.cost + sum(candidate.after(&shares)) * COST_OF_STOP;
                if total < least && taken >> (index / 2) & 1 == 0 {
                    (best, least) = (Some(index), total);
                }
            }
            let Some(best) = best else {
                break;
            };
            shares = candidates[best].after(&shares);
            (share, fixed) = (sum(shares), fixed + candidates[best].cost);
            chosen.push(best);
            taken |= 1 << (best / 2);
        }
        let probes = || chosen.iter().map(|&it| candidates[it].probe).collect();
        (fixed + share * COST_OF_STOP < to_beat).then(|| (probes(), share))
    }
}

fn sum([a, b, c, d, e, f, g, h]: [f32; MAX_ROWS]) -> f32 {
    ((a + e) + (c + g)) + ((b + f) + (d + h))
}

struct Candidate {
    probe: RowProbe,
    shares: [f32; MAX_ROWS],
    cost: f32,
}

impl Candidate {
    fn new(offset: i16, cost: f32) -> Candidate {
        Candidate {
            probe: RowProbe {
                offset,
                low: [0; 16],
                high: [0; 16],
            },
            shares: [0.0; MAX_ROWS],
            cost,
        }
    }

    fn after(&self, shares: &[f32; MAX_ROWS]) -> [f32; MAX_ROWS] {
        core::array::from_fn(|row| shares[row] * self.shares[row])
    }
}

fn set_bits(bits: u16) -> impl Iterator<Item = usize> {
    let left = core::iter::successors(Some(bits), |&it| Some(it & it.wrapping_sub(1)));
    (left.take_while(|&it| it != 0)).map(|it| it.trailing_zeros() as usize)
}

/// The low and the high four bits that the members have.
fn halves(set: &Latin1Set) -> (u16, u16) {
    let (mut low, mut high) = (0, 0);
    for (index, word) in set.words().iter().enumerate() {
        for part in 0..4 {
            let row = (word >> (16 * part)) as u16;
            low |= row;
            high |= u16::from(row != 0) << (index * 4 + part);
        }
    }
    (low, high)
}
