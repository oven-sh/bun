//! Parameters that always get the same value.

use super::{Effort, Simplifier};
use crate::ir::{Block, Edge, Op, Value};

/// The marks of parameters: zero is for one that stands for itself, and the others are values plus one.
const NOT_REACHED: u32 = u32::MAX;

impl Simplifier<'_> {
    fn arg(&self, edge: Edge, position: usize) -> Value {
        self.function.resolve(self.function.args(edge)[position])
    }

    fn only_arg(&self, param: Value, position: usize, edges: &[Edge]) -> Option<Value> {
        let mut args = edges.iter().map(|&edge| self.arg(edge, position));
        let first = args.find(|&arg| arg != param)?;
        args.all(|arg| arg == first || arg == param)
            .then_some(first)
    }

    fn replace_param(&mut self, param: Value, replacement: Value) {
        self.pass_uses_on(param, replacement);
        self.function.replace_param(param, replacement);
    }

    fn drop_dead_params(&mut self, block: Block, edges: &[Edge]) {
        for position in 0..self.function.params(block).len() {
            if !matches!(self.op(self.function.params(block)[position]), Op::Param(_)) {
                for &edge in edges {
                    self.release(self.function.args(edge)[position]);
                }
            }
        }
        self.function.drop_dead_params(block, edges);
        self.remove_unused();
    }

    /// On entering the block. Unless it `is_entered`, it may be part of a cycle that nothing reaches.
    pub(super) fn simplify_params(&mut self, is_entered: bool) {
        let block = self.block;
        let attached = self.take_attached_edges(block);
        let (edges, mut has_dead) = (&attached[..], false);
        for position in 0..self.function.params(block).len() {
            let param = self.function.params(block)[position];
            if self.tables.values[param].uses == 0 {
                self.hit();
                self.function.remove_param(param);
            } else if let Some(arg) = self.only_arg(param, position, edges) {
                let home = self.function.block_of(arg).expand();
                if !is_entered
                    && home.is_some_and(|home| !self.dominators.strictly_dominates(home, block))
                {
                    continue;
                }
                self.hit();
                self.replace_param(param, arg);
            } else {
                continue;
            }
            has_dead = true;
        }
        has_dead |= is_entered && self.effort == Effort::High && self.replace_twins(block, edges);
        if has_dead {
            self.drop_dead_params(block, edges);
        }
        self.tables.edges = attached;
    }

    fn take_attached_edges(&mut self, block: Block) -> Vec<Edge> {
        let mut edges = core::mem::take(&mut self.tables.edges);
        edges.clear();
        let incoming = self.cfg.predecessors(block).iter();
        edges.extend(incoming.filter(|&&edge| self.function.is_attached(edge)));
        edges
    }

    /// Whether two parameters get the same argument along the edge.
    fn repeats_arg(&mut self, edge: Edge) -> bool {
        let this_time = self.position + 1;
        self.function.args(edge).iter().any(|&arg| {
            let seen = &mut self.tables.values[self.function.resolve(arg)].last_passed;
            core::mem::replace(seen, this_time) == this_time
        })
    }

    /// Parameters that get the same arguments, or each itself.
    fn replace_twins(&mut self, block: Block, edges: &[Edge]) -> bool {
        if self.function.params(block).len() < 2 || !self.repeats_arg(edges[0]) {
            return false;
        }
        let input = |this: &Self, edge: Edge, position: u32| {
            let arg = this.arg(edge, position as usize);
            (arg != this.function.params(block)[position as usize]).then_some(arg)
        };
        let mut signatures = core::mem::take(&mut self.tables.signatures);
        signatures.clear();
        for (position, &param) in (0..).zip(self.function.params(block)) {
            if let Op::Param(_) = self.op(param) {
                let inputs = edges.iter().map(|&edge| input(self, edge, position));
                let hash = inputs.fold(0u32, |hash, arg| {
                    (hash ^ arg.unwrap_or(Value::NONE).0)
                        .wrapping_mul(0x9e37_79b9)
                        .rotate_left(13)
                });
                signatures.push((hash, position));
            }
        }
        signatures.sort_unstable();
        let mut found = false;
        for group in signatures.chunk_by(|a, b| a.0 == b.0) {
            let first = group[0].1;
            for &(_, other) in &group[1..] {
                if edges
                    .iter()
                    .all(|&edge| input(self, edge, first) == input(self, edge, other))
                {
                    self.hit();
                    let params = self.function.params(block);
                    self.replace_param(params[other as usize], params[first as usize]);
                    found = true;
                }
            }
        }
        self.tables.signatures = signatures;
        found
    }

    /// The one value that reaches the parameter as far as is known, the parameter itself if several do, and whether
    /// that can change.
    fn source_of(&self, param: Value) -> (Value, bool) {
        let Op::Param(position) = self.op(param) else {
            unreachable!("not a parameter")
        };
        let (mut found, mut found_for_good) = (Value::NONE, Value::NONE);
        for &edge in self.cfg.predecessors(self.function.block_of(param)) {
            if !self.function.is_attached(edge) {
                continue;
            }
            let arg = self.arg(edge, position as usize);
            let mark = match self.op(arg) {
                Op::Param(_) => self.tables.values[arg].mark,
                _ => 0,
            };
            if mark == 0 {
                if !found_for_good.is_none() && found_for_good != arg {
                    return (param, false);
                }
                found_for_good = arg;
            }
            let source = mark.checked_sub(1).map_or(arg, Value);
            if mark != NOT_REACHED && arg != param && source != param && source != found {
                found = if found.is_none() { source } else { param };
            }
        }
        (found, true)
    }

    /// Parameters that pass one value around among themselves. It assumes that all do until it finds otherwise.
    /// Returns whether there are any.
    pub(super) fn replace_cycles_of_params(&mut self) -> bool {
        const MOST_SWEEPS: usize = 8;
        let mut candidates = core::mem::take(&mut self.tables.list);
        candidates.clear();
        for outermost in self.cfg.loops().keys() {
            if self.cfg.loops()[outermost].parent.is_none() {
                for &block in self.cfg.blocks_of(outermost) {
                    candidates.extend(self.function.params(block));
                }
            }
        }
        for &param in &candidates {
            self.tables.values[param].mark = NOT_REACHED;
        }
        let has_settled = (0..MOST_SWEEPS).any(|_| {
            let mut is_unchanged = true;
            candidates.retain(|&param| {
                let (found, may_change) = self.source_of(param);
                let mark = match found.expand() {
                    _ if !may_change => 0,
                    Some(found) => found.0 + 1,
                    None => NOT_REACHED,
                };
                is_unchanged &=
                    core::mem::replace(&mut self.tables.values[param].mark, mark) == mark;
                may_change
            });
            // What differs inside a nest of loops spreads outward.
            candidates.reverse();
            is_unchanged
        });
        candidates.retain(|&param| {
            let mark = core::mem::take(&mut self.tables.values[param].mark);
            let is_redundant = has_settled && mark != NOT_REACHED && mark - 1 != param.0;
            if is_redundant {
                self.hit();
                self.replace_param(param, Value(mark - 1));
            }
            is_redundant
        });
        candidates.dedup_by_key(|param| self.function.block_of(*param));
        for &param in &candidates {
            let block = self.function.block_of(param);
            let edges = self.take_attached_edges(block);
            self.drop_dead_params(block, &edges);
            self.tables.edges = edges;
        }
        let found_any = !candidates.is_empty();
        self.tables.list = candidates;
        found_any
    }
}
