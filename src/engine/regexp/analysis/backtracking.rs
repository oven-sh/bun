//! Finds the choices that have to be remembered.

use super::Next;
use super::turns::Merging;
use crate::Error;
use crate::compile::character::{has_all_pairs_and_halves, set_of};
use crate::compile::graph::{Form, Graph, Id, Kind, MAX_REACH, Span, Traits};
use crate::compile::memory::StackLimit;
use crate::program::{ClassId, Direction, Stride, UNBOUNDED, Width};
use crate::set::Set;
use crate::surrogate::{ASTRAL, LEADS, SURROGATES, TRAILS};

/// When it can help to go back into a node that has succeeded.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Retry {
    Never,
    /// What follows fails only if the turn of a loop has passed nothing.
    IfEmpty,
    Possibly,
}

#[derive(Clone, Copy)]
struct After<'a> {
    /// What can come next if the rest of the pattern is to succeed.
    next: &'a Next,
    retry: Retry,
    /// The back reference that is matched next.
    reference: Option<Id>,
}

const END: After<'static> = After {
    next: &Next::ANYTHING,
    retry: Retry::Never,
    reference: None,
};

pub(crate) fn decide_backtracking(
    graph: &mut Graph,
    root: Id,
    stack: StackLimit,
) -> Result<(), Error> {
    let mut analysis = Analysis {
        graph,
        direction: Direction::Forward,
        is_looking: false,
        saved_entries_left: SAVED_ENTRIES,
        stack,
    };
    analysis.node(root, END)
}

pub(super) struct Analysis<'a> {
    pub(super) graph: &'a mut Graph,
    pub(super) direction: Direction,
    is_looking: bool,
    saved_entries_left: usize,
    stack: StackLimit,
}

/// Loops without frames need cells for the captures inside them, also those of other such loops.
const SAVED_ENTRIES: usize = 1 << 18;
const LEFT_BEHIND: Traits = Traits::REENTERED.union(Traits::FRAMES);

impl Analysis<'_> {
    fn node(&mut self, id: Id, mut after: After<'_>) -> Result<(), Error> {
        self.stack.check()?;
        let node = &self.graph[id];
        let ends_alike = node.min == node.max && !node.is(Traits::REFERENCED);
        if ends_alike || after.retry == Retry::IfEmpty && node.min != 0 {
            after.retry = Retry::Never;
        }
        let mut left = match node.kind {
            Kind::Sequence(children) => self.sequence(children, after)?,
            Kind::Alternation(children) => self.alternation(id, children, after)?,
            Kind::Repeat { .. } => self.repeat(id, after)?,
            Kind::Turn(body) => {
                self.node(body, after)?;
                self.graph[body].traits & LEFT_BEHIND
            }
            Kind::Look {
                body, direction, ..
            } => {
                let outer = (self.direction, self.is_looking);
                (self.direction, self.is_looking) = (direction, true);
                self.node(body, END)?;
                (self.direction, self.is_looking) = outer;
                return Ok(());
            }
            Kind::Run { .. } => return self.run(id, after),
            _ => return Ok(()),
        };
        if after.retry == Retry::Never {
            left.remove(Traits::REENTERED);
        }
        let node = &mut self.graph[id];
        if left == Traits::FRAMES && !node.is(Traits::ACCEPTS) {
            left = Traits::CUTS;
        }
        node.traits |= left;
        Ok(())
    }

    fn sequence(&mut self, children: Span, after: After<'_>) -> Result<Traits, Error> {
        let (mut next, mut retry, mut reference) = (*after.next, after.retry, None);
        let mut left = Traits::empty();
        for index in children.range().rev() {
            let child = self.graph.children[index];
            let after_child = After {
                next: &next,
                retry,
                reference,
            };
            self.node(child, after_child)?;
            let node = &self.graph[child];
            left |= node.traits & LEFT_BEHIND;
            reference = match node.kind {
                Kind::BackReference { .. } => Some(child),
                _ if node.is_bookkeeping() && !node.is(Traits::REFERENCED) => reference,
                _ => None,
            };
            retry = match (node.kind, retry) {
                (Kind::NotEmpty, Retry::Never) => Retry::IfEmpty,
                (_, Retry::IfEmpty) if node.min != 0 => Retry::Possibly,
                _ if node.is(Traits::CANNOT_FAIL) => retry,
                _ => Retry::Possibly,
            };
            next = self.graph.first_before(child, &next);
        }
        Ok(left)
    }

    fn alternation(&mut self, id: Id, children: Span, after: After<'_>) -> Result<Traits, Error> {
        let children = self.rearrange(id, children, after);
        let (mut later, mut differing) = (Next::NOTHING, Next::NOTHING);
        let mut left = Traits::empty();
        for index in children.range().rev() {
            let child = self.graph.children[index];
            self.node(child, after)?;
            let first = self.graph.first(child);
            let first_to_succeed = self.graph.first_before(child, after.next);
            let successors = &self.graph.children[index + 1..children.range().end];
            let is_replaced_in_vain = || {
                self.graph
                    .is_replaced_in_vain(child, successors, after.next)
            };
            let node = &self.graph[child];
            if !node.is(Traits::DIFFERS_FROM_NEXT) {
                later = later | core::mem::replace(&mut differing, Next::NOTHING);
            }
            let is_last = index + 1 == children.range().end;
            let is_final = match after.retry {
                Retry::Never => true,
                Retry::IfEmpty => node.min != 0,
                Retry::Possibly => false,
            };
            if !node.is(Traits::OPEN) && !first.intersects(&later) {
                self.graph[child].traits |= Traits::EXCLUSIVE;
            } else if !is_last && !is_final && !is_replaced_in_vain() {
                self.graph[child].traits |= Traits::CONTINUED;
                left |= Traits::REENTERED;
            }
            left |= self.graph[child].traits & LEFT_BEHIND;
            differing = differing | first_to_succeed;
        }
        Ok(left)
    }

    /// Drops the alternatives that are never tried, and puts one last that would only be tried in vain before others.
    #[inline(never)]
    fn rearrange(&mut self, id: Id, children: Span, after: After<'_>) -> Span {
        let graph = &mut *self.graph;
        let range = children.range();
        if after.retry == Retry::Never {
            let always = range
                .clone()
                .find(|&index| graph[graph.children[index]].is(Traits::CANNOT_FAIL));
            let kept = Span::new(range.start..always.map_or(range.end, |index| index + 1));
            graph[id].kind = Kind::Alternation(kept);
            return kept;
        }
        let open = range
            .clone()
            .rfind(|&index| graph[graph.children[index]].is(Traits::OPEN));
        if let Some(open) = open.filter(|&index| index + 1 != range.end) {
            let first = graph.first_before(graph.children[open], after.next);
            let mut later = graph.children[open + 1..range.end].iter();
            if !later.any(|&it| graph.first_before(it, after.next).intersects(&first)) {
                graph.children[open..range.end].rotate_left(1);
            }
        }
        children
    }

    fn repeat(&mut self, id: Id, after: After<'_>) -> Result<Traits, Error> {
        let Kind::Repeat {
            mut body,
            min,
            mut max,
            mut greedy,
            mut is_counted,
            ..
        } = self.graph[id].kind
        else {
            unreachable!("the node is a loop")
        };
        let of_body = self.graph[body];
        let first = self.graph.first(body);
        let is_distinct = !of_body.is(Traits::OPEN) && !first.intersects(after.next)
            || (after.reference).is_some_and(|it| self.avoids_reference(body, it, after.next));
        let counts_turns = min > 1 || max != UNBOUNDED;
        if !counts_turns {
            self.keep_whole_runs(body, after.next);
        }
        if !greedy && after.retry == Retry::Never {
            max = min;
        }
        greedy |= min == max;
        let is_final = match after.retry {
            Retry::Never => true,
            Retry::IfEmpty => min == 0,
            Retry::Possibly => false,
        };
        is_counted &= !is_final || !greedy || counts_turns || self.is_looking;
        let next = self.graph.first_before(body, after.next) | *after.next;
        let retry = match greedy && is_final && min <= 1 {
            true => Retry::Never,
            false => Retry::Possibly,
        };
        let after_turn = After {
            next: &next,
            retry,
            reference: None,
        };
        self.node(body, after_turn)?;

        let entries_left = (self.saved_entries_left).checked_sub(of_body.pairs.entries().len());
        let (form, left) = if self.graph[body].is(Traits::REENTERED) || entries_left.is_none() {
            (Form::Stacked, LEFT_BEHIND)
        } else if min == max || is_distinct || greedy && is_final {
            greedy = true;
            self.saved_entries_left = entries_left.unwrap_or(0);
            (Form::Possessive, Traits::empty())
        } else if !greedy {
            (Form::Extended, Traits::REENTERED)
        } else if self.graph.turns_are_alike(body) {
            (Form::Stepped, Traits::REENTERED)
        } else {
            (Form::Stacked, LEFT_BEHIND)
        };
        if form == Form::Possessive && !counts_turns && max != min {
            let can_stop_in_pair = !is_final && after.next.intersects_wide(SURROGATES);
            let merging = Merging {
                can_stop_in_pair,
                can_be_in_vain: !is_final,
                is_counted,
            };
            body = self.merge_turns(body, merging)?;
        }
        (self.graph[id].traits).set(Traits::CAN_BE_IN_VAIN, !is_final);
        self.graph[id].kind = Kind::Repeat {
            body,
            min,
            max,
            greedy,
            form,
            is_counted,
        };
        Ok(left)
    }

    #[inline(never)]
    fn run(&mut self, id: Id, after: After<'_>) -> Result<(), Error> {
        let Kind::Run {
            class,
            max,
            mut code_points,
            mut greedy,
            is_counted,
            ..
        } = self.graph[id].kind
        else {
            unreachable!("the node is a run")
        };
        if !greedy && after.retry == Retry::Never {
            self.graph[id].kind = Kind::Empty;
            return Ok(());
        }
        let is_distinct = !self.graph.first(id).intersects(after.next);
        greedy |= is_distinct;
        let keeps_by_itself = is_distinct || greedy && after.retry != Retry::Possibly;
        let is_possessive = keeps_by_itself || self.graph[id].is(Traits::KEEPS_ALL);
        let second_halves = match self.direction {
            Direction::Forward => TRAILS,
            Direction::Backward => LEADS,
        };
        let can_stop_in_pair = !keeps_by_itself && after.next.intersects_wide(second_halves);
        if max == UNBOUNDED && !can_stop_in_pair && has_all_pairs_and_halves(&self.graph[class]) {
            code_points = false;
        }
        let filter = if is_possessive {
            None
        } else if greedy && !code_points {
            self.filter_for_giving_back(class, after.next)?
        } else if !greedy && max == UNBOUNDED {
            self.passed_at_once(class, after.next, code_points)?
        } else {
            None
        };
        let node = &mut self.graph[id];
        let can_be_in_vain = after.retry == Retry::Possibly;
        node.traits.set(Traits::REENTERED, !is_possessive);
        node.traits.set(Traits::CAN_BE_IN_VAIN, can_be_in_vain);
        node.kind = Kind::Run {
            class,
            max,
            code_points,
            greedy,
            filter,
            is_counted: is_counted && (can_be_in_vain || self.is_looking),
        };
        Ok(())
    }

    fn filter_for_giving_back(
        &mut self,
        class: ClassId,
        next: &Next,
    ) -> Result<Option<ClassId>, Error> {
        if self.graph[class].latin1().is_subset_of(next.latin1()) {
            return Ok(None);
        }
        let filter = match !next.has_wide() || self.graph.width == Width::Latin1 {
            true => Set::from_latin1(*next.latin1()),
            false => set_of(next.ranges())?,
        };
        self.graph.add_class(filter).map(Some)
    }

    /// The members of the class that the rest of the pattern cannot start with.
    pub(super) fn passed_at_once(
        &mut self,
        class: ClassId,
        next: &Next,
        code_points: bool,
    ) -> Result<Option<ClassId>, Error> {
        let members = &self.graph[class];
        let latin1 = *members.latin1() - *next.latin1();
        let passed = if !next.has_wide() || self.graph.width == Width::Latin1 {
            members.with_latin1(latin1)?
        } else {
            let pairs = (code_points && next.intersects_wide(SURROGATES)).then_some(ASTRAL);
            members.difference(&set_of(next.ranges().chain(pairs))?)?
        };
        match passed.is_empty() {
            true => Ok(None),
            false => self.graph.add_class(passed).map(Some),
        }
    }
}

impl Graph {
    /// Whether none of the others leads to a match where the alternative has succeeded.
    #[inline(never)]
    fn is_replaced_in_vain(&self, alternative: Id, others: &[Id], after: &Next) -> bool {
        const MAX_OTHERS: usize = 8;
        const MAX_STEPS: usize = 16;
        let steps = |id| {
            self.leading_steps(id)
                .map_or(&[][..], |it| &self.steps[it.range()])
        };
        let passed = steps(alternative);
        let is_in_vain = |&other: &Id| {
            let pairs = passed.iter().zip(steps(other)).take(MAX_STEPS);
            let mut units = pairs.map(|(&a, &b)| (self.units_of_step(a), self.units_of_step(b)));
            let next = passed.get(steps(other).len());
            let is_shorter = matches!(self[other].kind, Kind::Steps(_) | Kind::Empty);
            units.any(|(a, b)| !a.intersects(&b))
                || is_shorter && next.is_some_and(|&it| !self.units_of_step(it).intersects(after))
        };
        others.len() <= MAX_OTHERS && others.iter().all(is_in_vain)
    }

    /// Whether all turns have the same length and their captures at the same distances.
    pub(crate) fn turns_are_alike(&self, body: Id) -> bool {
        let node = &self[body];
        let has_fixed_captures = node.pairs.is_empty()
            || self.terms(&body).iter().all(|&term| {
                let term = &self[term];
                term.is_bookkeeping() || !term.is(Traits::WRITES) && term.min == term.max
            }) && !node.is(Traits::REFERENCED)
                && node.min <= MAX_REACH;
        node.min == node.max && Stride::of_units(node.min).is_some() && has_fixed_captures
    }
}
