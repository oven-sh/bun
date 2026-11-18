//! Something rare inside every match, from which to look back for the start.

use super::frequency::Frequencies;
use super::prefix::{MAX_COLUMNS, Prefixes};
use super::{Next, plan_scan};
use crate::Error;
use crate::compile::character::set_of;
use crate::compile::graph::{Graph, Id, Kind, Step, masked_units};
use crate::program::{Approach, Direction, Scan, Width};
use crate::set::Set;
use crate::surrogate::SURROGATES;

const MAX_VISITS: u32 = 64;
const MAX_DEPTH: u32 = 8;

pub(crate) enum Landmark {
    Units(Scan),
    /// The end of the subject.
    End,
}

impl Graph {
    /// Adds all that the terms can pass. Nothing if that is not known.
    fn add_units_passed(
        &self,
        terms: &[Id],
        units: &mut Next,
        depth: u32,
        visits: &mut u32,
    ) -> Option<()> {
        for &term in terms {
            *visits = visits.checked_sub(1)?;
            let children = match self[term].kind {
                _ if self[term].max == 0 => continue,
                Kind::Steps(steps) => {
                    *visits = visits.checked_sub(steps.len() as u32 / 4)?;
                    let steps = self.steps[steps.range()].iter();
                    *units = steps.fold(*units, |all, &step| all | self.units_of_step(step));
                    continue;
                }
                Kind::StepCount { class, .. }
                | Kind::Run {
                    class,
                    code_points: false,
                    ..
                } => {
                    *units = *units | *self.units_of(class);
                    continue;
                }
                Kind::Pair(class) | Kind::CodePoint(class) | Kind::Run { class, .. } => {
                    *units = *units | *self.units_of(class);
                    units.insert_wide(SURROGATES);
                    continue;
                }
                Kind::Sequence(children) | Kind::Alternation(children) => {
                    self.children_of(children)
                }
                Kind::Repeat { ref body, .. } | Kind::Turn(ref body) => core::slice::from_ref(body),
                _ => return None,
            };
            (depth < MAX_DEPTH)
                .then(|| self.add_units_passed(children, units, depth + 1, visits))??;
        }
        Some(())
    }

    fn share_of_rarest_unit(&self, term: Id, frequencies: &Frequencies) -> f32 {
        let share = |step: &Step| match *step {
            Step::Unit { value, mask } if mask != self.width.max_unit() => {
                masked_units(value, mask)
                    .map(|it| frequencies.of_unit(it))
                    .sum()
            }
            _ => 1.0,
        };
        match self[term].kind {
            Kind::Edge(Direction::Forward) => 0.0,
            Kind::Steps(steps) => {
                let steps = self.steps[steps.range()].iter().take(MAX_COLUMNS);
                // More units leave more to tell it by.
                let (count, rarest) = (steps.len(), steps.map(share).fold(1.0, f32::min));
                rarest / count as f32
            }
            _ => 1.0,
        }
    }
}

/// `to_beat` is the share of the positions at which attempts would be made otherwise.
pub(crate) fn find_landmark(
    graph: &mut Graph,
    root: Id,
    frequencies: &Frequencies,
    to_beat: f32,
) -> Result<Option<(Landmark, Approach)>, Error> {
    let terms = graph.terms(&root);
    let mut length = 0u32;
    let ends_prefix = |&it: &Id| {
        length = length.saturating_add(graph[it].min);
        graph[it].min != graph[it].max || length >= MAX_COLUMNS as u32
    };
    let Some(last_of_prefix) = terms.iter().position(ends_prefix) else {
        return Ok(None);
    };
    let candidates = (last_of_prefix + 1..terms.len()).take(MAX_VISITS as usize);
    let shares =
        candidates.map(|index| (index, graph.share_of_rarest_unit(terms[index], frequencies)));
    let best = shares.min_by(|a, b| a.1.total_cmp(&b.1));
    let Some((index, _)) = best.filter(|it| it.1 < to_beat) else {
        return Ok(None);
    };
    let (before, from_landmark) = terms.split_at(index);
    let (mut units, mut visits) = (Next::NOTHING, MAX_VISITS);
    let (min, max) = graph.lengths(before);
    if (graph.add_units_passed(before, &mut units, 0, &mut visits)).is_none() {
        return Ok(None);
    }
    let landmark = if graph[from_landmark[0]].kind == Kind::Edge(Direction::Forward) {
        Landmark::End
    } else {
        let mut prefixes = Prefixes::default();
        prefixes.find(graph, from_landmark);
        if prefixes.some_are_at_start || prefixes.longest_at_end.is_some() {
            return Ok(None);
        }
        let (rest, _) = graph.lengths(from_landmark);
        match plan_scan(graph, &prefixes, frequencies)? {
            Some((scan, share)) if share < to_beat => Landmark::Units(Scan {
                need: scan.need.max(rest),
                ..scan
            }),
            _ => return Ok(None),
        }
    };
    let passed = match !units.has_wide() || graph.width == Width::Latin1 {
        true => Set::from_latin1(*units.latin1()),
        false => set_of(units.ranges())?,
    };
    let class = graph.add_class(passed)?;
    Ok(Some((landmark, Approach { class, min, max })))
}
