//! Sees to it that code which runs more than once does little between two operations that count work or go back.

use crate::Error;
use crate::compile::memory::{fill, push, reserve};
use crate::program::{Op, Program, ScopeKind, Target};

pub(super) const MAX_UNCOUNTED: u32 = 256;

#[derive(Clone, Copy, Default)]
struct Arrival {
    /// The ways here that have not been looked at.
    waiting: u32,
    /// The most on any way here. Nothing if this runs once.
    uncounted: Option<u32>,
    /// All ways here move on in the subject.
    is_fresh: bool,
}

fn accounts_for_work(op: &Op) -> bool {
    matches!(
        op,
        Op::Load { metered: true, .. }
            | Op::Pop { .. }
            | Op::Spend { .. }
            | Op::Again { .. }
            | Op::Turned { .. }
    )
}

impl Program {
    fn for_each_successor(&self, index: usize, mut visit: impl FnMut(usize)) {
        let mut op = self.ops[index];
        match op {
            Op::Choose { .. } => {}
            Op::Switch { table, .. } => {
                let cases = self.switches[table.index()].cases();
                cases.iter().for_each(|it| visit(it.target.index()));
            }
            Op::Resume { slot } => {
                if let ScopeKind::Choice {
                    first_target,
                    end_target,
                    ..
                } = self.scopes[slot.scope.index()].kind
                {
                    let targets = &self.choice_targets[first_target as usize..end_target as usize];
                    targets.iter().for_each(|it| visit(it.index()));
                }
            }
            Op::Retreat { id, none } => {
                visit(none.index());
                visit(self.loops[id.index()].back_into_turn.index());
            }
            _ => op.target_mut().into_iter().for_each(|it| visit(it.index())),
        }
        if op.falls_through() {
            visit(index + 1);
        }
    }

    /// Where work has to be counted, and how much. `fresh` are the targets at which a search goes on.
    fn find_uncounted_work(&self, fresh: &[Target]) -> Result<Vec<(u32, u32)>, Error> {
        let (ops, mut arrivals) = (&self.ops, Vec::new());
        fill(&mut arrivals, ops.len(), Arrival::default())?;
        for target in fresh {
            if let Some(arrival) = arrivals.get_mut(target.index()) {
                (arrival.is_fresh, arrival.uncounted) = (true, Some(0));
            }
        }
        for (index, op) in ops.iter().enumerate() {
            self.for_each_successor(index, |next| {
                let arrival = &mut arrivals[next];
                match accounts_for_work(op) || arrival.is_fresh {
                    true => arrival.uncounted = Some(0),
                    false => arrival.waiting += 1,
                }
            });
        }
        let (mut ready, mut found) = (Vec::new(), Vec::new());
        reserve(&mut ready, ops.len())?;
        ready.extend((0..ops.len() as u32).filter(|&it| arrivals[it as usize].waiting == 0));
        while let Some(index) = ready.pop() {
            let op = &ops[index as usize];
            let mut uncounted = arrivals[index as usize].uncounted;
            uncounted = uncounted.map(|before| before + op.fixed_work());
            if let Some(work) = uncounted.filter(|&it| it > MAX_UNCOUNTED) {
                push(&mut found, (index, work))?;
                uncounted = Some(0);
            }
            if accounts_for_work(op) {
                continue;
            }
            self.for_each_successor(index as usize, |next| {
                let arrival = &mut arrivals[next];
                if !arrival.is_fresh {
                    arrival.uncounted = arrival.uncounted.max(uncounted);
                    arrival.waiting -= 1;
                    if arrival.waiting == 0 {
                        ready.push(next as u32);
                    }
                }
            });
        }
        debug_assert!(arrivals.iter().all(|it| it.waiting == 0));
        found.sort_unstable();
        Ok(found)
    }

    pub(super) fn count_work(&mut self, fresh: &[Target]) -> Result<(), Error> {
        let found = self.find_uncounted_work(fresh)?;
        if found.is_empty() {
            return Ok(());
        }
        let shift = |target: &mut Target| {
            let inserted = found.partition_point(|it| it.0 < target.0);
            target.0 = target.0.saturating_add(inserted as u32);
        };
        self.for_each_target(shift);
        self.joins.iter_mut().for_each(|it| shift(&mut it.at));
        let ops = &mut self.ops;
        let mut end = ops.len();
        reserve(ops, found.len())?;
        ops.resize(end + found.len(), Op::NoMatch);
        for (before, &(index, work)) in found.iter().enumerate().rev() {
            let index = index as usize;
            ops.copy_within(index..end, index + before + 1);
            ops[index + before] = Op::Spend { work };
            end = index;
        }
        Ok(())
    }
}
