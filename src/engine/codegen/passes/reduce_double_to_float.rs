//! Narrows parameters of 64 bits that only hold floats of 32 bits, or of which nothing more is wanted. What that
//! makes possible is left to `simplify`.

use super::Analyses;
use crate::analysis::Cfg;
use crate::ir::{Block, Entity, Function, Op, State, Table, Type, Unary, Value};
use crate::target::Target;

#[derive(Clone, Copy)]
struct ValueInfo {
    is_candidate: bool,
    /// By something other than a demotion, be it through other parameters.
    is_used_wide: bool,
    may_hold_wide: bool,
    /// Something could do with the narrow form.
    is_wanted_narrow: bool,
    narrow: Value,
}

struct Reduction<'a> {
    function: &'a mut Function,
    cfg: &'a Cfg,
    values: Table<Value, ValueInfo>,
    candidates: Vec<Value>,
    demotions: Vec<(Value, Value)>,
}

fn narrow_constant(op: &Op) -> Option<f32> {
    let Op::ConstF64(bits) = op else {
        return None;
    };
    let wide = f64::from_bits(bits.get());
    Some(wide as f32).filter(|&narrow| f64::from(narrow) == wide)
}

fn holds_narrow(op: &Op) -> bool {
    matches!(op, Op::Unary(Unary::Promote, _)) || narrow_constant(op).is_some()
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let mut values = (0..function.value_count()).map(Value::from_index);
    let changes_width = |value| {
        matches!(
            function.op(value),
            Op::Unary(Unary::Promote | Unary::Demote, _)
        )
    };
    if !values.any(changes_width) {
        return;
    }
    let cfg = analyses.cfg(function);
    let inner_blocks = cfg
        .order()
        .iter()
        .filter(|&&block| !cfg.predecessors(block).is_empty());
    let params = inner_blocks
        .flat_map(|&block| function.params(block))
        .copied();
    let candidates: Vec<Value> = params
        .filter(|&param| function.type_of(param) == Type::F64)
        .collect();
    if candidates.is_empty() {
        return;
    }
    let values = function.value_table(ValueInfo {
        is_candidate: false,
        is_used_wide: false,
        may_hold_wide: false,
        is_wanted_narrow: false,
        narrow: Value::NONE,
    });
    let mut pass = Reduction {
        function,
        cfg,
        values,
        candidates,
        demotions: Vec::new(),
    };
    pass.look_at_uses();
    pass.look_at_args();
    pass.narrow();
}

impl Reduction<'_> {
    fn args_of(&self, param: Value) -> impl Iterator<Item = Value> {
        let Op::Param(position) = *self.function.op(param) else {
            unreachable!("not a parameter")
        };
        let incoming = self.cfg.predecessors(self.function.block_of(param)).iter();
        incoming.map(move |&edge| self.function.args(edge)[position as usize])
    }

    /// Passes a property on from parameters to the parameters among their arguments.
    fn spread_backward(&mut self, flag: impl Fn(&mut ValueInfo) -> &mut bool) {
        let mut pending = self.candidates.clone();
        pending.retain(|&param| *flag(&mut self.values[param]));
        let mut args = Vec::new();
        while let Some(param) = pending.pop() {
            args.extend(self.args_of(param));
            for arg in args.drain(..) {
                let info = &mut self.values[arg];
                if !core::mem::replace(flag(info), true) && info.is_candidate {
                    pending.push(arg);
                }
            }
        }
    }

    /// Demoting the argument before the jump costs nothing once it is simplified.
    fn demotes_for_free(&self, arg: Value) -> bool {
        let op = self.function.op(arg);
        let is_narrow = |&operand: &Value| holds_narrow(self.function.op(operand));
        self.values[arg].is_candidate
            || holds_narrow(op)
            || op.is_constant()
            || matches!(op, Op::Binary(..) | Op::Unary(..))
                && op.inline_operands().iter().all(is_narrow)
    }

    fn look_at_uses(&mut self) {
        for &param in &self.candidates {
            self.values[param].is_candidate = true;
        }
        let function = &*self.function;
        for user in self
            .cfg
            .order()
            .iter()
            .flat_map(|&block| function.instructions(block))
        {
            if let Op::Unary(Unary::Demote, wide) = *function.op(user) {
                self.demotions.push((user, wide));
                self.values[wide].is_wanted_narrow = true;
                for &operand in function.op(wide).inline_operands() {
                    self.values[operand].is_wanted_narrow = true;
                }
                continue;
            }
            let compares = matches!(function.op(user), Op::FloatCompare(..));
            for &operand in function.operands(user) {
                self.values[operand].is_used_wide = true;
                self.values[operand].is_wanted_narrow |= compares;
            }
        }
        for state in (0..function.state_count()).map(State::from_index) {
            for &kept in function.state(state) {
                self.values[kept].is_used_wide = true;
            }
        }
        for &param in &self.candidates {
            let is_free = self.args_of(param).all(|arg| self.demotes_for_free(arg));
            self.values[param].is_used_wide |= !is_free;
        }
        self.spread_backward(|info| &mut info.is_used_wide);
    }

    fn look_at_args(&mut self) {
        const MOST_SWEEPS: usize = 8;
        let has_settled = (0..MOST_SWEEPS).any(|_| {
            let mut is_unchanged = true;
            for &param in &self.candidates {
                let is_wide = |arg| match self.values[arg] {
                    info if info.is_candidate => info.may_hold_wide,
                    _ => !holds_narrow(self.function.op(arg)),
                };
                if !self.values[param].may_hold_wide && self.args_of(param).any(is_wide) {
                    (self.values[param].may_hold_wide, is_unchanged) = (true, false);
                }
            }
            is_unchanged
        });
        for &param in &self.candidates {
            let info = &mut self.values[param];
            info.may_hold_wide |= !has_settled;
            info.is_wanted_narrow &= !info.may_hold_wide;
        }
        self.spread_backward(|info| &mut info.is_wanted_narrow);
    }

    fn narrow(&mut self) {
        let values = &self.values;
        self.candidates
            .retain(|&param| !values[param].is_used_wide || values[param].is_wanted_narrow);
        if self.candidates.is_empty() {
            return;
        }
        let candidates = core::mem::take(&mut self.candidates);
        for &param in &candidates {
            let block = self.function.block_of(param);
            self.values[param].narrow = self.function.add_param(block, Type::F32);
        }
        for &param in &candidates {
            self.pass_narrow_args(param);
        }
        for &(demotion, wide) in &self.demotions {
            let info = self.values[wide];
            if !info.narrow.is_none() && !info.is_used_wide {
                self.function.replace(demotion, info.narrow);
            }
        }
        let mut blocks: Vec<Block> = Vec::new();
        for &param in &candidates {
            let (block, info) = (self.function.block_of(param), self.values[param]);
            if info.is_used_wide {
                let first = self.function.first(block);
                let (op, origin) = (
                    Op::Unary(Unary::Promote, info.narrow),
                    self.function.origin(first),
                );
                let promoted = self.function.insert_before(first, op, Type::F64, origin);
                self.function.replace_param(param, promoted);
            } else {
                self.function.remove_param(param);
            }
            blocks.push(block);
        }
        blocks.dedup();
        for block in blocks {
            self.function
                .drop_dead_params(block, self.cfg.predecessors(block));
        }
        self.function.resolve_aliases();
    }

    fn pass_narrow_args(&mut self, param: Value) {
        let Op::Param(position) = *self.function.op(param) else {
            unreachable!("not a parameter")
        };
        let keeps_value = self.values[param].is_used_wide;
        for &edge in self.cfg.predecessors(self.function.block_of(param)) {
            let arg = self.function.args(edge)[position as usize];
            let (info, op) = (self.values[arg], *self.function.op(arg));
            let narrow = match (op, narrow_constant(&op)) {
                _ if !info.narrow.is_none() && info.is_used_wide == keeps_value => info.narrow,
                (_, Some(constant)) => self.function.const_f32(constant),
                (Op::Unary(Unary::Promote, original), _) if keeps_value => original,
                _ => {
                    let end = self.function.last(self.function.source(edge));
                    let (op, origin) = (Op::Unary(Unary::Demote, arg), self.function.origin(end));
                    self.function.insert_before(end, op, Type::F32, origin)
                }
            };
            self.function.push_arg(edge, narrow);
        }
    }
}
