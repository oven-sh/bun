//! Loops that do not count their turns, and take single characters in some.

use smallvec::SmallVec;

use super::Next;
use super::backtracking::Analysis;
use crate::Error;
use crate::compile::character::has_all_pairs_and_halves;
use crate::compile::graph::{Graph, Id, Kind, Span, Step, Traits};
use crate::compile::memory::reserve;
use crate::program::{ClassId, Direction, UNBOUNDED};

const MAX_ALTERNATIVES: usize = 16;

/// What holds for the runs that take the place of turns.
#[derive(Clone, Copy)]
pub(super) struct Merging {
    pub(super) can_stop_in_pair: bool,
    pub(super) can_be_in_vain: bool,
    pub(super) is_counted: bool,
}

impl Graph {
    fn without_turn(&self, body: Id) -> Id {
        match self[body].kind {
            Kind::Turn(inner) => inner,
            _ => body,
        }
    }

    /// The terms that do more than keep books.
    fn tests<'a>(&'a self, id: &'a Id) -> impl Iterator<Item = Id> {
        let terms = self.terms(id).iter().copied();
        terms.filter(|&it| !self[it].is_bookkeeping())
    }

    /// The ways to take a turn.
    fn ways<'a>(&'a self, body: &'a Id) -> &'a [Id] {
        let mut tests = self.tests(body);
        match (tests.next().map(|it| self[it].kind), tests.next()) {
            (Some(Kind::Alternation(children)), None) => self.children_of(children),
            _ => core::slice::from_ref(body),
        }
    }

    /// The run, if the node is one, with or without a required member.
    fn whole_run(&self, id: Id) -> Option<Id> {
        let mut tests = self.tests(&id);
        let (first, second) = (tests.next()?, tests.next()?);
        let run = match (self[first].kind, self[second].kind) {
            (Kind::Run { .. }, Kind::NotEmpty) => first,
            (Kind::CodePoint(member), Kind::Run { class, .. }) if member == class => second,
            (
                Kind::Steps(steps),
                Kind::Run {
                    code_points: false, ..
                },
            ) if steps.len() == 1
                && self.first(first) == self.first(second)
                && !self.first(first).has_wide() =>
            {
                second
            }
            (Kind::Steps(steps), Kind::Run { class, .. })
                if self.steps[steps.range()] == [Step::Class(class)] =>
            {
                second
            }
            _ => return None,
        };
        let is_unlimited = matches!(
            self[run].kind,
            Kind::Run {
                max: UNBOUNDED,
                greedy: true,
                ..
            }
        );
        (is_unlimited && tests.next().is_none()).then_some(run)
    }

    /// The body of a negative look in the direction with which the node starts.
    fn excluded_at_start(&self, id: Id, direction: Direction) -> Option<Id> {
        match self[self.tests(&id).next()?].kind {
            Kind::Look {
                body,
                direction: toward,
                negated: true,
            } if toward == direction => Some(body),
            _ => None,
        }
    }

    fn is_same_reference(&self, a: Id, b: Id) -> bool {
        match (self[a].kind, self[b].kind) {
            (
                Kind::BackReference { pairs, ignore_case },
                Kind::BackReference {
                    pairs: other_pairs,
                    ignore_case: other_ignores_case,
                },
            ) => {
                self.referenced_pairs[pairs.range()] == self.referenced_pairs[other_pairs.range()]
                    && ignore_case == other_ignores_case
            }
            _ => false,
        }
    }
}

impl Analysis<'_> {
    /// What a run that is a whole turn gives back, only another such turn takes.
    #[inline(never)]
    pub(super) fn keep_whole_runs(&mut self, body: Id, after_loop: &Next) {
        let (body, graph) = (self.graph.without_turn(body), &mut *self.graph);
        let count = graph.ways(&body).len();
        if count > MAX_ALTERNATIVES || graph[body].is(Traits::REFERENCED) {
            return;
        }
        for index in 0..count {
            let ways = graph.ways(&body);
            let Some(run) = graph.whole_run(ways[index]) else {
                continue;
            };
            let members = graph.first(run);
            let mut others = ways[..index].iter().chain(&ways[index + 1..]);
            if !members.intersects(after_loop)
                && !others.any(|&it| graph.first(it).intersects(&members))
            {
                graph[run].traits |= Traits::KEEPS_ALL;
            }
        }
    }

    /// Whether no turn starts where `reference`, which follows the loop and sees the same captures, matches.
    #[inline(never)]
    pub(super) fn avoids_reference(&self, body: Id, reference: Id, after_loop: &Next) -> bool {
        let graph = &*self.graph;
        let avoids = |&way: &Id| {
            !graph[way].is(Traits::OPEN) && !graph.first(way).intersects(after_loop)
                || (graph.excluded_at_start(way, self.direction))
                    .is_some_and(|excluded| graph.is_same_reference(excluded, reference))
        };
        !graph[body].is(Traits::REFERENCED) && graph.ways(&body).iter().all(avoids)
    }

    /// Lets a turn that takes one character take all that would be taken in the same way. The loop is possessive.
    /// Returns the new body.
    #[inline(never)]
    pub(super) fn merge_turns(&mut self, body: Id, merging: Merging) -> Result<Id, Error> {
        let terms = self.graph.terms(&body);
        let (alternation, group) = match *terms {
            [only] => (only, None),
            [open, only, close] => (only, Some((open, close))),
            _ => return Ok(body),
        };
        let is_group = |(open, close): (Id, Id)| {
            matches!(self.graph[open].kind, Kind::Open(_))
                && matches!(self.graph[close].kind, Kind::Close(_))
        };
        let children = match self.graph[alternation].kind {
            Kind::Alternation(children) => children,
            _ if group.is_none() => return self.merge_way(body, &Next::NOTHING, None, merging),
            _ => return Ok(body),
        };
        if children.len() > MAX_ALTERNATIVES
            || !group.is_none_or(is_group)
            || group.is_some() && self.graph[body].is(Traits::REFERENCED)
            || group.is_some() && self.graph[alternation].is(Traits::WRITES)
        {
            return Ok(body);
        }
        let mut earlier = Next::NOTHING;
        let mut has_merged = false;
        for index in children.range() {
            let way = self.graph.children[index];
            let merged = self.merge_way(way, &earlier, group, merging)?;
            has_merged |= merged != way;
            self.graph.children[index] = merged;
            earlier = earlier | self.graph.first_before(way, &Next::ANYTHING);
        }
        if !has_merged {
            return Ok(body);
        }
        if let Some(group) = group {
            self.enclose_ways(children, group)?;
        }
        let cuts = (self.graph[body].traits | self.graph[alternation].traits) & Traits::CUTS;
        self.graph.refresh(alternation);
        self.graph[alternation].traits |= cuts;
        Ok(alternation)
    }

    /// The class of the one character that the node takes, whether that is a code point, and what has to be left out
    /// for the rest of the node to succeed.
    fn single_character(&mut self, way: Id) -> Result<Option<(ClassId, bool, Next)>, Error> {
        let (excluded, last) = match *self.graph.terms(&way) {
            [only] => (Next::NOTHING, only),
            [_, last] => match self.graph.excluded_at_start(way, self.direction) {
                Some(excluded) => (self.graph.first_before(excluded, &Next::ANYTHING), last),
                None => return Ok(None),
            },
            _ => return Ok(None),
        };
        Ok(match self.graph[last].kind {
            Kind::Steps(steps) if steps.len() == 1 => {
                let step = self.graph.steps[steps.range().start];
                Some((self.graph.class_of_step(step)?, false, excluded))
            }
            Kind::CodePoint(class) => Some((class, true, excluded)),
            _ => None,
        })
    }

    fn merge_way(
        &mut self,
        way: Id,
        earlier: &Next,
        group: Option<(Id, Id)>,
        merging: Merging,
    ) -> Result<Id, Error> {
        let Some((class, code_points, excluded)) = self.single_character(way)? else {
            return Ok(way);
        };
        let passed = match code_points && group.is_some() {
            true => None,
            false => self.passed_at_once(class, &(*earlier | excluded), code_points)?,
        };
        let Some(class) = passed else {
            return Ok(way);
        };
        let kind = Kind::Run {
            class,
            max: UNBOUNDED,
            code_points: code_points
                && (merging.can_stop_in_pair || !has_all_pairs_and_halves(&self.graph[class])),
            greedy: true,
            filter: None,
            is_counted: merging.is_counted,
        };
        let run = self.graph.leaf_with_first(kind, self.graph.first(way))?;
        (self.graph[run].traits).set(Traits::CAN_BE_IN_VAIN, merging.can_be_in_vain);
        let last_turn = match group {
            Some((open, close)) => Some(self.graph.capture_unit_passed(
                open,
                close,
                self.direction,
            )?),
            None => None,
        };
        let terms = self.graph.terms(&way).iter().copied();
        let terms: SmallVec<[Id; 4]> = terms.chain([run]).chain(last_turn).collect();
        self.replace_way(way, &terms)
    }

    fn replace_way(&mut self, way: Id, terms: &[Id]) -> Result<Id, Error> {
        const OF_ALTERNATIVE: Traits = Traits::EXCLUSIVE
            .union(Traits::CONTINUED)
            .union(Traits::DIFFERS_FROM_NEXT);
        let new = self.graph.sequence(terms)?;
        let kept = match self.graph[way].kind {
            Kind::Sequence(_) => OF_ALTERNATIVE | Traits::CUTS,
            _ => OF_ALTERNATIVE,
        };
        let kept = self.graph[way].traits & kept;
        self.graph[new].traits |= kept;
        Ok(new)
    }

    /// Puts the parentheses around each alternative that does not have them yet.
    fn enclose_ways(&mut self, children: Span, (open, close): (Id, Id)) -> Result<(), Error> {
        let pair = self.graph[open].pairs;
        for index in children.range() {
            let way = self.graph.children[index];
            if self.graph[way].pairs != pair {
                let mut terms = Vec::new();
                reserve(&mut terms, self.graph.terms(&way).len() + 2)?;
                terms.push(open);
                terms.extend_from_slice(self.graph.terms(&way));
                terms.push(close);
                terms.retain(|&it| self.graph[it].kind != Kind::Empty);
                self.graph.children[index] = self.replace_way(way, &terms)?;
            }
        }
        Ok(())
    }
}
