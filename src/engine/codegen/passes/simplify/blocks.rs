//! Blocks and edges that are not needed.

use super::Simplifier;
use crate::ir::{Block, Edge, Entity, Op, Value};

impl Simplifier<'_> {
    /// While control flows as it did.
    #[inline]
    pub(super) fn looks_untidy(&self, block: Block) -> bool {
        let mut edges = self.function.successors(block);
        match (edges.next(), edges.next()) {
            (Some(edge), None) => {
                let count = |block| self.cfg.predecessors(block).len();
                count(self.function.target(edge)) == 1 && self.only_jump(block).is_some()
                    || self.way_past(block, count(block)).is_some()
            }
            (Some(first), Some(second)) => {
                self.function.target(first) == self.function.target(second)
                    && self.goes_one_way(block)
            }
            _ => false,
        }
    }

    pub(super) fn tidy_blocks(&mut self) {
        let order = self.cfg.order();
        let counts = &mut self.tables.predecessor_counts;
        counts.refill(self.function.block_count(), 0);
        for &block in order {
            for edge in self.function.successors(block) {
                counts[self.function.target(edge)] += 1;
            }
        }
        let would_find_more = self.would_find_more;
        for &block in order.iter().rev() {
            self.tidy(block);
        }
        self.would_find_more = would_find_more;
        for &block in order {
            while let Some(edge) = self.only_jump(block)
                && self.tables.predecessor_counts[self.function.target(edge)] == 1
                && self.tables.entered.contains(block.index())
            {
                self.hit();
                self.merge(block, edge);
            }
        }
    }

    /// What comes later in the order is tidy already.
    fn tidy(&mut self, block: Block) {
        let count = self.function.successors(block).len();
        if count > 1 && self.goes_one_way(block) {
            self.hit();
            let kept = self.function.successor(block, 0);
            self.tables.predecessor_counts[self.function.target(kept)] -= count as u32 - 1;
            self.jump_along(kept);
        }
        let predecessors = self.tables.predecessor_counts[block];
        if let Some(onward) = self.way_past(block, predecessors as usize) {
            self.hit();
            for &edge in self.cfg.predecessors(block) {
                if self.function.is_attached(edge) {
                    self.lead_past(edge, onward);
                }
            }
            self.tables.predecessor_counts[self.function.target(onward)] += predecessors - 1;
            self.discard_blocks(&[block]);
        }
    }

    fn only_jump(&self, block: Block) -> Option<Edge> {
        let last = self.function.last(block).expand()?;
        matches!(self.op(last), Op::Jump).then(|| self.function.successor(block, 0))
    }

    fn goes_one_way(&self, block: Block) -> bool {
        let function = &*self.function;
        let first = function.successor(block, 0);
        let is_same = |edge: Edge| {
            let mut pairs = function.args(edge).iter().zip(function.args(first));
            function.target(edge) == function.target(first)
                && pairs.all(|(&a, &b)| function.resolve(a) == function.resolve(b))
        };
        matches!(
            self.op(function.last(block)),
            Op::Branch(_) | Op::Switch(..) | Op::JumpTable(..)
        ) && function.successors(block).skip(1).all(is_same)
    }

    fn merge(&mut self, block: Block, edge: Edge) {
        let next = self.function.target(edge);
        for position in 0..self.function.params(next).len() {
            let arg = self.function.resolve(self.function.args(edge)[position]);
            self.pass_uses_on(self.function.params(next)[position], arg);
            self.release(arg);
            (self.left_aliases, self.would_find_more) = (true, true);
        }
        self.function.merge_with_successor(block);
        self.changed_control = true;
        self.remove_unused();
    }

    /// The jump of an empty block, if nothing else uses the parameters and copies of its other arguments are few.
    fn way_past(&self, empty: Block, predecessors: usize) -> Option<Edge> {
        const MOST_COPIES: usize = 8;
        let function = &*self.function;
        if function.first(empty) != function.last(empty)
            || predecessors == 0
            || self.cfg.loop_headed_by(empty).is_some()
        {
            return None;
        }
        let onward = self.only_jump(empty)?;
        let is_own = |&&arg: &&Value| function.block_of(function.resolve(arg)) == empty;
        let passed_on = function.args(onward).iter().filter(is_own).count();
        let params = function.params(empty).iter();
        let uses: u32 = params.map(|&param| self.tables.values[param].uses).sum();
        let copies = (function.args(onward).len() - passed_on) * (predecessors - 1);
        (uses as usize == passed_on && copies <= MOST_COPIES).then_some(onward)
    }

    fn lead_past(&mut self, edge: Edge, onward: Edge) {
        let (function, empty) = (&*self.function, self.function.target(edge));
        let mut args = core::mem::take(&mut self.tables.list);
        args.clear();
        args.extend(function.args(onward).iter().map(|&arg| {
            let arg = function.resolve(arg);
            match *function.op(arg) {
                Op::Param(position) if function.block_of(arg) == empty => {
                    function.resolve(function.args(edge)[position as usize])
                }
                _ => arg,
            }
        }));
        self.retain_all(&args);
        self.release_args(edge);
        self.function
            .redirect(edge, self.function.target(onward), &args);
        self.tables.list = args;
    }
}
