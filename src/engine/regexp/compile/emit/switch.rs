//! Which alternative is tried first, and which after it.

use core::cmp::Reverse;
use std::collections::BinaryHeap;

use smallvec::SmallVec;

use super::Emitter;
use super::output::Label;
use super::state::Fail;
use crate::Error;
use crate::analysis::Next;
use crate::compile::graph::{Id, Kind, Span, Step, Traits, masked_units};
use crate::compile::memory::{push, reserve};
use crate::program::{Case, Op, Switch, SwitchId, Width};
use crate::set::CharRange;

pub(super) struct Route {
    pub(super) entry: Label,
    /// The index of the alternative to try if this one fails.
    pub(super) next: Option<u32>,
    /// A failure after the first tests is one of all that follow.
    pub(super) is_final_after_tests: bool,
    pub(super) first_step_passed: Option<Step>,
    /// The next unit is among those that the alternative can start with.
    is_fitting: bool,
}

pub(super) struct Routes {
    pub(super) routes: SmallVec<[Route; 4]>,
    pub(super) switches: bool,
    pub(super) needs_undo: bool,
}

const LEAST_SWITCHED: usize = 4;
const MAX_SWITCHED: usize = NONE as usize;
const MAX_WIDE_RANGES: usize = 1 << 16;
pub(super) const WIDE_RANGES_SWITCHED: usize = 1 << 17;
const LOOKED_THROUGH_FOR_NEXT: usize = 64;
const NONE: u16 = u16::MAX;

impl Emitter<'_> {
    /// And whether it is tested before anything changes.
    fn first_step(&self, alternative: Id) -> Option<(Step, bool)> {
        let terms = self.graph.terms(&alternative).iter();
        let first = terms
            .map(|&it| &self.graph[it])
            .find(|it| !it.is_bookkeeping())?;
        match first.kind {
            Kind::Steps(steps) => Some((
                self.graph.steps[steps.range().start],
                first.is(Traits::RIGID),
            )),
            _ => None,
        }
    }

    fn is_worth_a_switch(&self, alternatives: &[Id]) -> bool {
        let closed = alternatives
            .iter()
            .take_while(|&&it| !self.graph[it].is(Traits::OPEN));
        let wide_ranges = alternatives.iter().map(|&it| match self.first_step(it) {
            Some((Step::Class(class), _)) => self.graph[class].above().len(),
            _ => 1,
        });
        closed.count() >= LEAST_SWITCHED
            && alternatives.len() <= MAX_SWITCHED
            && wide_ranges.sum::<usize>() <= self.wide_ranges_left.min(MAX_WIDE_RANGES)
    }

    fn starts_of(&self, alternative: Id) -> Next {
        self.graph.first_before(alternative, &Next::ANYTHING)
    }

    #[inline(never)]
    pub(super) fn plan_routes(&mut self, children: Span) -> Result<Routes, Error> {
        let alternatives = self.graph.children_of(children);
        let switches = self.is_worth_a_switch(alternatives);
        let has_unit = self.has_toward(self.direction, 1);
        let mut routes = SmallVec::<[Route; 4]>::new();
        routes
            .try_reserve(alternatives.len())
            .map_err(|_| Error::OutOfMemory)?;
        for &alternative in alternatives {
            let first_step = self.first_step(alternative);
            routes.push(Route {
                entry: self.output.label()?,
                next: None,
                is_final_after_tests: first_step.is_some_and(|it| it.1)
                    && self.graph[alternative].is(Traits::EXCLUSIVE),
                first_step_passed: first_step.filter(|_| switches).map(|it| it.0),
                is_fitting: switches
                    && (has_unit || !self.starts_of(alternative).intersects(&Next::EDGE)),
            });
        }
        let mut needs_undo = false;
        for (index, &alternative) in alternatives.iter().enumerate() {
            let route = &routes[index];
            let (next, is_fitting) = match route.is_fitting {
                true if self.graph[alternative].is(Traits::EXCLUSIVE) => continue,
                true => self.next_that_fits(alternatives, index),
                false => (index + 1, false),
            };
            needs_undo |= next < alternatives.len() && !route.is_final_after_tests;
            if let Some(successor) = routes.get_mut(next) {
                successor.is_fitting &= is_fitting;
                successor.first_step_passed = None;
                routes[index].next = Some(next as u32);
            }
        }
        Ok(Routes {
            routes,
            switches,
            needs_undo,
        })
    }

    /// The first that can start like the one at `index`, and whether it can start with all that one can.
    fn next_that_fits(&self, alternatives: &[Id], index: usize) -> (usize, bool) {
        let starts = self.starts_of(alternatives[index]);
        let end = alternatives.len().min(index + 1 + LOOKED_THROUGH_FOR_NEXT);
        for next in index + 1..end {
            let common = self.starts_of(alternatives[next]) & starts;
            if common != Next::NOTHING {
                return (next, common == starts && !starts.has_wide());
            }
        }
        (end, false)
    }

    #[inline(never)]
    pub(super) fn switch(
        &mut self,
        children: Span,
        routes: &Routes,
        fail: Fail,
    ) -> Result<(), Error> {
        let none = self.target(fail)?;
        let label = |index: u16| {
            routes
                .routes
                .get(usize::from(index))
                .map_or(none, |it| it.entry)
        };
        if !self.has_toward(self.direction, 1) {
            let mut alternatives = self.graph.children_of(children).iter();
            let at_edge = alternatives.position(|&it| self.starts_of(it).intersects(&Next::EDGE));
            let at_edge = self.fail_directly_to(label(at_edge.map_or(NONE, |it| it as u16)))?;
            self.need(1, at_edge)?;
        }
        let mut latin1 = [NONE; 256];
        for (index, &alternative) in self.graph.children_of(children).iter().enumerate().rev() {
            for range in self.starts_of(alternative).latin1().ranges() {
                latin1[range.first as usize..=range.last as usize].fill(index as u16);
            }
        }
        let mut switch = Switch {
            cases: Vec::new(),
            latin1: [0; 256],
        };
        for (unit, index) in latin1.into_iter().enumerate() {
            add_case(&mut switch.cases, unit as u16, label(index))?;
            switch.latin1[unit] = (switch.cases.len() - 1) as u8;
        }
        if self.graph.width == Width::Utf16 {
            let mut next = 0x100;
            let routes = self.wide_routes(children)?;
            self.wide_ranges_left = self.wide_ranges_left.saturating_sub(routes.len());
            for (range, index) in routes {
                if range.first > next {
                    add_case(&mut switch.cases, next as u16, none)?;
                }
                add_case(&mut switch.cases, range.first as u16, label(index))?;
                next = range.last + 1;
            }
            if let Ok(next) = u16::try_from(next) {
                add_case(&mut switch.cases, next, none)?;
            }
        }
        let mut last = self.graph.width.max_unit();
        for case in switch.cases.iter_mut().rev() {
            case.weight += (self.frequencies.of_range(case.first, last).min(1.0) * 4096.0) as u16;
            last = case.first.saturating_sub(1);
        }
        let table = SwitchId(self.output.program.switches.len() as u32);
        push(&mut self.output.program.switches, switch)?;
        let offset = self.offset_toward(self.direction, 1) as i16;
        self.op(Op::Switch { offset, table })?;
        self.state.is_reachable = false;
        Ok(())
    }

    /// The first alternative for the units above Latin-1, in ascending ranges.
    fn wide_routes(&self, children: Span) -> Result<Vec<(CharRange, u16)>, Error> {
        let mut found = Vec::new();
        for (index, &alternative) in self.graph.children_of(children).iter().enumerate() {
            let mut add = |range| push(&mut found, (range, index as u16));
            match self.first_step(alternative).map(|it| it.0) {
                Some(Step::Unit { value, mask }) if mask != u16::MAX => {
                    let mut units = masked_units(value, mask).filter(|&it| it > 0xff);
                    units.try_for_each(|it| add(CharRange::single(it.into())))?;
                }
                Some(Step::Class(class)) => {
                    let ranges = self.graph[class].above().iter();
                    let mut ranges = ranges.take_while(|it| it.first <= 0xffff);
                    ranges.try_for_each(|it| add(CharRange::new(it.first, it.last.min(0xffff))))?;
                }
                _ => self
                    .starts_of(alternative)
                    .wide_ranges()
                    .try_for_each(add)?,
            }
        }
        found.sort_unstable_by_key(|(range, _)| range.first);
        first_by_unit(&found)
    }
}

/// Where ranges overlap, the least index counts. They are sorted by their starts.
fn first_by_unit(ranges: &[(CharRange, u16)]) -> Result<Vec<(CharRange, u16)>, Error> {
    let (mut result, mut open) = (Vec::new(), Vec::new());
    reserve(&mut open, ranges.len())?;
    let mut open = BinaryHeap::from(open);
    let (mut waiting, mut next) = (ranges.iter().peekable(), 0);
    loop {
        while let Some(&(range, index)) = waiting.next_if(|(range, _)| range.first <= next) {
            open.push(Reverse((index, range.last)));
        }
        while open.peek().is_some_and(|&Reverse((_, last))| last < next) {
            open.pop();
        }
        let before_waiting = waiting.peek().map(|(range, _)| range.first - 1);
        match (open.peek(), before_waiting) {
            (Some(&Reverse((index, last))), _) => {
                let last = last.min(before_waiting.unwrap_or(last));
                push(&mut result, (CharRange::new(next, last), index))?;
                next = last + 1;
            }
            (None, Some(before)) => next = before + 1,
            (None, None) => return Ok(result),
        }
    }
}

fn add_case(cases: &mut Vec<Case>, first: u16, target: Label) -> Result<(), Error> {
    match cases.last() {
        Some(last) if last.target == target => Ok(()),
        _ => {
            let case = Case {
                first,
                weight: 1,
                target,
            };
            push(cases, case)
        }
    }
}
