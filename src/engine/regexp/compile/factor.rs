//! Brings alternatives that start alike together, and matches what they share once.

use super::graph::{Graph, Id, Kind, Span, Step, Traits};
use super::lower::Lowering;
use super::memory::{push, reserve};
use crate::Error;
use crate::analysis::Next;
use crate::set::Set;

/// An alternative without its first steps.
#[derive(Clone, Copy)]
struct Branch {
    node: Id,
    skipped: u32,
    /// Among all alternatives.
    index: u32,
}

/// First steps of which no two have a unit in common. Alternatives that start with them can change places.
struct Distinct {
    /// Ascending.
    steps: Vec<u64>,
    wide_units: Next,
    others: Next,
}

const MAX_STEPS_MOVED: usize = 1 << 9;

fn key(step: Step) -> u64 {
    match step {
        Step::Unit { value, mask } => u64::from(value) << 16 | u64::from(mask),
        Step::Class(class) => 1 << 32 | class.index() as u64,
    }
}

impl Distinct {
    fn clear(&mut self) {
        self.steps.clear();
        (self.wide_units, self.others) = (Next::NOTHING, Next::NOTHING);
    }

    /// Whether it is among them now.
    fn admit(&mut self, graph: &Graph, step: Step) -> Result<bool, Error> {
        let Err(place) = self.steps.binary_search(&key(step)) else {
            return Ok(true);
        };
        let units = graph.units_of_step(step);
        let is_wide_unit = matches!(
            step,
            Step::Unit {
                value: 0x100..,
                mask: 0
            }
        );
        if units.intersects(&self.others)
            || !is_wide_unit && units.intersects(&self.wide_units)
            || self.steps.len() - place > MAX_STEPS_MOVED
        {
            return Ok(false);
        }
        let known = if is_wide_unit {
            &mut self.wide_units
        } else {
            &mut self.others
        };
        *known = *known | units;
        reserve(&mut self.steps, 1)?;
        self.steps.insert(place, key(step));
        Ok(true)
    }
}

impl Graph {
    pub(crate) fn leading_steps(&self, id: Id) -> Option<Span> {
        match self[*self.terms(&id).first()?].kind {
            Kind::Steps(steps) => Some(steps),
            _ => None,
        }
    }

    fn steps_of(&self, branch: Branch) -> &[Step] {
        let steps = self.leading_steps(branch.node);
        steps.map_or(&[], |steps| {
            &self.steps[steps.range()][branch.skipped as usize..]
        })
    }
}

impl Lowering<'_> {
    /// Takes the alternatives off the terms.
    pub(super) fn finish_alternation(&mut self, start: usize) -> Result<Id, Error> {
        let mut branches = Vec::new();
        reserve(&mut branches, self.terms.len() - start)?;
        let alternatives = self.terms.drain(start..).zip(0..);
        branches.extend(alternatives.map(|(node, index)| Branch {
            node,
            skipped: 0,
            index,
        }));
        self.factor(&mut branches)
    }

    fn factor(&mut self, mut branches: &mut [Branch]) -> Result<Id, Error> {
        self.stack.check()?;
        let start = self.terms.len();
        let mut distinct = Distinct {
            steps: Vec::new(),
            wide_units: Next::NOTHING,
            others: Next::NOTHING,
        };
        while !branches.is_empty() {
            distinct.clear();
            let mut count = 0;
            while let Some(&step) = branches
                .get(count)
                .and_then(|&it| self.graph.steps_of(it).first())
                && distinct.admit(self.graph, step)?
            {
                count += 1;
            }
            let (run, rest) = branches.split_at_mut(count.max(1));
            branches = rest;
            if distinct.steps.len() < count {
                run.sort_unstable_by_key(|&it| (key(self.graph.steps_of(it)[0]), it.index));
            }
            self.factor_run(run, start)?;
        }
        let alternation = self.graph.alternation(&self.terms[start..]);
        self.terms.truncate(start);
        alternation
    }

    /// Those that start with the same step are next to each other.
    fn factor_run(&mut self, mut run: &mut [Branch], start: usize) -> Result<(), Error> {
        let start_of_run = self.terms.len();
        while let [first, others @ ..] = &*run {
            let step = self.graph.steps_of(*first).first().copied();
            let is_alike = |&&it: &&Branch| self.graph.steps_of(it).first().copied() == step;
            let count = 1 + others.iter().take_while(is_alike).count();
            let (group, rest) = run.split_at_mut(count);
            run = rest;
            let alternative = match group {
                [only] => self.remainder(*only)?,
                _ => self.share_prefix(group)?,
            };
            let is_first_of_run = self.terms.len() == start_of_run;
            if !self.join_with_last(alternative, start, is_first_of_run)? {
                push(self.terms, alternative)?;
            }
        }
        let alternatives = self.terms.get(start_of_run..).unwrap_or_default();
        for (index, &alternative) in alternatives.iter().enumerate() {
            let is_last = index + 1 == alternatives.len();
            if alternative != Graph::EMPTY {
                (self.graph[alternative].traits).set(Traits::DIFFERS_FROM_NEXT, !is_last);
            }
        }
        Ok(())
    }

    fn share_prefix(&mut self, group: &mut [Branch]) -> Result<Id, Error> {
        let is_shared = |&(index, step): &(usize, &Step)| {
            let mut others = group[1..].iter();
            others.all(|&it| self.graph.steps_of(it).get(index) == Some(step))
        };
        let first = self.graph.steps_of(group[0]).iter().enumerate();
        let length = first.take_while(is_shared).count();
        let steps = self
            .graph
            .leading_steps(group[0].node)
            .expect("the branch has steps");
        let from = steps.range().start + group[0].skipped as usize;
        group.iter_mut().for_each(|it| it.skipped += length as u32);
        let prefix = self
            .graph
            .leaf(Kind::Steps(Span::new(from..from + length)))?;
        let suffixes = self.factor(group)?;
        self.join(&[prefix, suffixes])
    }

    fn remainder(&mut self, branch: Branch) -> Result<Id, Error> {
        let Some(steps) = self
            .graph
            .leading_steps(branch.node)
            .filter(|_| branch.skipped != 0)
        else {
            return Ok(branch.node);
        };
        let start = self.terms.len();
        let left = Span::new(steps.range().start + branch.skipped as usize..steps.range().end);
        if left.len() != 0 {
            let left = self.graph.leaf(Kind::Steps(left))?;
            push(self.terms, left)?;
        }
        let others = &self.graph.terms(&branch.node)[1..];
        reserve(self.terms, others.len())?;
        self.terms.extend_from_slice(others);
        self.finish_sequence(start)
    }

    fn only_step(&self, id: Id) -> Option<Step> {
        match self.graph[id].kind {
            Kind::Steps(steps) if steps.len() == 1 => Some(self.graph.steps[steps.range().start]),
            _ => None,
        }
    }

    /// Makes one step of two alternatives that are a step each, and drops a second empty one.
    fn join_with_last(
        &mut self,
        alternative: Id,
        start: usize,
        is_first_of_run: bool,
    ) -> Result<bool, Error> {
        let Some((&last, before)) = self.terms[start..].split_last() else {
            return Ok(false);
        };
        let has_to_differ = |&it: &Id| self.graph[it].is(Traits::DIFFERS_FROM_NEXT);
        if is_first_of_run && before.last().is_some_and(has_to_differ) {
            return Ok(false);
        }
        let (Some(a), Some(b)) = (self.only_step(last), self.only_step(alternative)) else {
            return Ok(last == Graph::EMPTY && alternative == Graph::EMPTY);
        };
        let both = self
            .graph
            .set_of_step(a)?
            .union(&self.graph.set_of_step(b)?)?;
        if both.above().len() > RANGES_JOINED {
            return Ok(false);
        }
        let step = self.graph.step(&both)?.expect("the set has members");
        let joined = self.graph.add_steps([step].into_iter())?;
        *self.terms.last_mut().expect("there is one") = joined;
        Ok(true)
    }
}

const RANGES_JOINED: usize = 32;

impl Graph {
    fn set_of_step(&self, step: Step) -> Result<Set, Error> {
        match step {
            Step::Class(class) => Ok(self[class].try_clone()?),
            Step::Unit { value, mask } => self.set_of_units(value, mask),
        }
    }
}
