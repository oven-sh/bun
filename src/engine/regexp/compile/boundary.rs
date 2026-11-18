//! Word boundaries next to something that is known to be in a word, or not to be.

use super::graph::{Graph, Id, Kind, Step, Traits};
use super::lower::Lowering;
use crate::Error;
use crate::analysis::Next;
use crate::program::ClassId;

const MAX_VISITS: u32 = 1 << 12;
const MAX_DEPTH: u32 = 32;

impl Graph {
    /// The last unit that the terms pass, and whether they can pass none. Nothing if that is not known.
    fn last_units(&self, terms: &[Id], depth: u32, visits: &mut u32) -> Option<(Next, bool)> {
        let mut units = Next::NOTHING;
        for &term in terms.iter().rev() {
            *visits = visits.checked_sub(1)?;
            let node = &self[term];
            let inner = |id: &Id, visits: &mut u32| {
                (depth < MAX_DEPTH).then(|| self.last_units(self.terms(id), depth + 1, visits))?
            };
            let (own, can_be_empty) = match node.kind {
                _ if node.max == 0 => continue,
                Kind::Steps(steps) => {
                    (self.units_of_step(self.steps[steps.range().end - 1]), false)
                }
                Kind::StepCount { class, .. } => (*self.units_of(class), false),
                Kind::Run {
                    class,
                    code_points: false,
                    ..
                } => (*self.units_of(class), true),
                Kind::Alternation(children) => {
                    let mut all = (Next::NOTHING, false);
                    for child in self.children_of(children) {
                        let (own, can_be_empty) = inner(child, visits)?;
                        all = (all.0 | own, all.1 || can_be_empty);
                    }
                    all
                }
                Kind::Repeat { body, .. } | Kind::Turn(body) => {
                    (inner(&body, visits)?.0, node.min == 0)
                }
                _ => return None,
            };
            units = units | own;
            if !can_be_empty {
                return Some((units, false));
            }
        }
        Some((units, true))
    }

    /// Whether all units are in words, or none is.
    fn is_in_word(&self, units: &Next, word: ClassId, other: ClassId) -> Option<bool> {
        if !units.intersects(self.units_of(other)) && !units.intersects(&Next::EDGE) {
            Some(true)
        } else if !units.intersects(self.units_of(word)) {
            Some(false)
        } else {
            None
        }
    }
}

impl Lowering<'_> {
    /// Among the terms of a sequence, which start at `start`.
    pub(super) fn simplify_boundaries(&mut self, start: usize) -> Result<(), Error> {
        let mut visits = MAX_VISITS;
        for index in start..self.terms.len() {
            let Kind::Boundary {
                word,
                other,
                negated,
            } = self.graph[self.terms[index]].kind
            else {
                continue;
            };
            let graph = &*self.graph;
            let before = graph.last_units(&self.terms[start..index], 0, &mut visits);
            let before = before
                .filter(|it| !it.1)
                .and_then(|it| graph.is_in_word(&it.0, word, other));
            let following = &self.terms[index + 1..];
            let mut near = following.iter().take(MAX_DEPTH as usize);
            let constraining = near.position(|&it| !graph[it].is(Traits::OPEN));
            let after = constraining.and_then(|last| {
                let (first, _) = graph.first_of_terms(&following[..=last]);
                graph.is_in_word(&first, word, other)
            });
            let (side, is_in_word) = match (before, after) {
                (Some(before), Some(after)) => {
                    let holds = (before != after) != negated;
                    self.terms[index] = if holds { Graph::EMPTY } else { Graph::FAIL };
                    continue;
                }
                (Some(before), None) => (self.direction, before),
                (None, Some(after)) => (self.direction.opposite(), after),
                (None, None) => continue,
            };
            self.terms[index] = self.peek(side, Step::Class(word), is_in_word != negated)?;
        }
        (self.terms.extract_if(start.., |it| *it == Graph::EMPTY)).for_each(drop);
        Ok(())
    }
}
