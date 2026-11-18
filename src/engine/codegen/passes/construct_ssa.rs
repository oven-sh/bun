//! Replaces variables with parameters of blocks.

use super::Analyses;
use super::reaching::{Held, Reaching, Read};
use crate::analysis::Cfg;
use crate::bitset::BitSet;
use crate::ir::{Block, Entity, Function, Op, Table, Value, Variable};
use crate::target::Target;

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    if function.variable_count() == 0 {
        return;
    }
    let (cfg, dominators) = analyses.dominators(function);
    let mut reaching = Reaching::new(cfg, dominators);
    for index in 0..function.variable_count() {
        reaching.add_variable(function.variable_type(Variable::from_index(index)));
    }
    let open = resolve_within_blocks(function, cfg, &mut reaching);
    let first_new = function.value_count();
    reaching.solve(function);
    for (get, read) in open {
        function.replace(get, function.resolve(reaching.answer(read)));
    }
    let mut used = Used {
        first_new,
        seen: BitSet::with_size(function.value_count() - first_new),
        unvisited: Vec::new(),
    };
    used.resolve_and_mark(function, cfg);
    used.remove_other_params(function, cfg);
    function.forget_variables();
}

/// Returns the instructions that get what a variable holds at the start of their block.
fn resolve_within_blocks(
    function: &mut Function,
    cfg: &Cfg,
    reaching: &mut Reaching<'_>,
) -> Vec<(Value, Read)> {
    let mut known = Table::filled(function.variable_count(), (Block::NONE, Value::NONE));
    let mut open = Vec::new();
    for &block in cfg.order() {
        let mut value = function.first(block);
        while !value.is_none() {
            match *function.op(value) {
                Op::GetVariable(variable) if known[variable].0 == block => {
                    function.replace(value, known[variable].1);
                }
                Op::GetVariable(variable) => {
                    open.push((value, reaching.read(variable, block)));
                    known[variable] = (block, value);
                }
                Op::SetVariable(variable, stored) => {
                    let stored = function.resolve(stored);
                    if known[variable] != (block, stored) {
                        known[variable] = (block, stored);
                        reaching.define(variable, block, Held::Value(stored));
                    }
                    function.remove(value);
                }
                _ => {}
            }
            value = function.next(value);
        }
    }
    open
}

/// The values from `first_new` on that have a use other than as argument for a new parameter without any.
struct Used {
    first_new: usize,
    seen: BitSet,
    unvisited: Vec<Value>,
}

impl Used {
    #[inline]
    fn mark(&mut self, value: Value) {
        if let Some(index) = value.index().checked_sub(self.first_new)
            && self.seen.insert(index)
        {
            self.unvisited.push(value);
        }
    }

    fn resolve_and_mark(&mut self, function: &mut Function, cfg: &Cfg) {
        let mut seen_states = BitSet::with_size(function.state_count());
        for &block in cfg.order() {
            let mut value = function.first(block);
            while !value.is_none() {
                function.resolve_operands(value);
                for &operand in function.operands(value) {
                    self.mark(operand);
                }
                if let Some(state) = function.state_of(value).expand()
                    && seen_states.insert(state.index())
                {
                    function.resolve_state(state);
                    for &kept in function.state(state) {
                        self.mark(kept);
                    }
                }
                value = function.next(value);
            }
            for edge in function.successors(block) {
                function.resolve_args(edge);
                let params = function.params(function.target(edge));
                let old = params.partition_point(|param| param.index() < self.first_new);
                for &arg in &function.args(edge)[..old] {
                    self.mark(arg);
                }
            }
        }
        while let Some(value) = self.unvisited.pop() {
            if let Op::Param(position) = *function.op(value) {
                for &edge in cfg.predecessors(function.block_of(value)) {
                    self.mark(function.args(edge)[position as usize]);
                }
            }
        }
    }

    fn remove_other_params(&self, function: &mut Function, cfg: &Cfg) {
        let mut shrunk = Vec::new();
        for index in self.first_new..function.value_count() {
            let value = Value::from_index(index);
            if !self.seen.contains(index - self.first_new)
                && matches!(function.op(value), Op::Param(_))
            {
                function.remove_param(value);
                shrunk.push(function.block_of(value));
            }
        }
        shrunk.sort_unstable();
        shrunk.dedup();
        for block in shrunk {
            function.drop_dead_params(block, cfg.predecessors(block));
        }
    }
}
