//! Removes instructions and parameters on which no effect depends.

use super::Analyses;
use crate::analysis::Cfg;
use crate::bitset::BitSet;
use crate::ir::{Block, Entity, Function, Op, Value};
use crate::target::Target;

struct Marks<'a> {
    function: &'a Function,
    cfg: &'a Cfg,
    live: BitSet,
    seen_states: BitSet,
    pending: Vec<Value>,
}

impl Marks<'_> {
    #[inline]
    fn mark_uses(&mut self, user: Value, mut mark: impl FnMut(&mut Self, Value)) {
        let function = self.function;
        for &operand in function.operands(user) {
            mark(self, operand);
        }
        if let Some(state) = function.state_of(user).expand()
            && self.seen_states.insert(state.index())
        {
            for &value in function.state(state) {
                mark(self, value);
            }
        }
    }

    /// The sweep, which is at the top of `block`, does not come back to what it has passed.
    fn mark_behind_sweep(&mut self, value: Value, block: Block) {
        let (function, cfg) = (self.function, self.cfg);
        let mark = |marks: &mut Self, value: Value| {
            if marks.live.insert(value.index())
                && let Some(home) = function.block_of(value).expand()
                && cfg.position(home) >= cfg.position(block)
            {
                marks.pending.push(value);
            }
        };
        mark(self, value);
        while let Some(value) = self.pending.pop() {
            if let Op::Param(position) = *function.op(value) {
                for &edge in cfg.predecessors(function.block_of(value)) {
                    mark(self, function.args(edge)[position as usize]);
                }
            } else {
                self.mark_uses(value, mark);
            }
        }
    }

    /// Goes against the order, which puts uses before definitions except along backward edges.
    fn sweep(&mut self, suspects: &mut Vec<Value>) {
        let (function, cfg) = (self.function, self.cfg);
        for &block in cfg.order().iter().rev() {
            for edge in function.successors(block) {
                let params = function.params(function.target(edge));
                for (&param, &arg) in params.iter().zip(function.args(edge)) {
                    if self.live.contains(param.index()) {
                        self.live.insert(arg.index());
                    }
                }
            }
            for value in function.instructions_backward(block) {
                if self.live.contains(value.index()) || function.effects(value).must_execute() {
                    self.mark_uses(value, |marks, used| {
                        marks.live.insert(used.index());
                    });
                } else {
                    suspects.push(value);
                }
            }
            for &edge in cfg.predecessors(block) {
                if cfg.is_backward(function, edge) {
                    for (&param, &arg) in function.params(block).iter().zip(function.args(edge)) {
                        if self.live.contains(param.index()) {
                            self.mark_behind_sweep(arg, block);
                        }
                    }
                }
            }
        }
    }
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let is_simplified = analyses.simplified_at == Some(function.revision());
    let cfg = analyses.cfg(function);
    // Only what keeps itself in use escapes `simplify`.
    if is_simplified && cfg.loops().len() == 0 {
        return;
    }
    let mut marks = Marks {
        function,
        cfg,
        live: BitSet::with_size(function.value_count()),
        seen_states: BitSet::with_size(function.state_count()),
        pending: Vec::new(),
    };
    let mut suspects = Vec::new();
    marks.sweep(&mut suspects);
    let live = marks.live;
    for value in suspects {
        if !live.contains(value.index()) {
            function.remove(value);
        }
    }
    for &block in cfg.order() {
        drop_dead_params(function, cfg, &live, block);
    }
}

fn drop_dead_params(function: &mut Function, cfg: &Cfg, live: &BitSet, block: Block) {
    let incoming = cfg.predecessors(block);
    let is_entry = incoming.is_empty();
    let is_live = |param: &Value| live.contains(param.index());
    if is_entry || function.params(block).iter().all(is_live) {
        return;
    }
    for position in 0..function.params(block).len() {
        let param = function.params(block)[position];
        if !is_live(&param) {
            function.remove_param(param);
        }
    }
    function.drop_dead_params(block, incoming);
}
