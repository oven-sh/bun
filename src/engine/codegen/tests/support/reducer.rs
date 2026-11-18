//! Takes away from a program what a failure does not need.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, Block, Builder, EffectFlags, Function, Op, State, Type, Value,
};

use super::harness::{Case, catching};
use super::promises::promises;

struct Reducer<'a> {
    case: Case,
    fails: &'a mut dyn FnMut(&Case) -> bool,
}

fn instructions(function: &Function) -> Vec<Value> {
    function
        .blocks()
        .flat_map(|block| function.instructions(block))
        .collect()
}

fn blocks(function: &Function) -> Vec<Block> {
    function.blocks().collect()
}

fn incoming(function: &Function, param: Value) -> Vec<Value> {
    let Op::Param(position) = *function.op(param) else {
        unreachable!()
    };
    let cfg = Cfg::new(function);
    let edges = cfg.predecessors(function.block_of(param)).iter();
    let args = edges.map(|&edge| function.args(edge)[position as usize]);
    args.filter(|&arg| arg != param).collect()
}

fn is_present(function: &Function, value: Value) -> bool {
    !matches!(function.op(value), Op::Removed | Op::Alias(_))
}

fn ends_block(function: &Function, value: Value) -> bool {
    function.effects(value).has(EffectFlags::ENDS_BLOCK)
}

fn neutralize(function: &mut Function, value: Value) {
    match function.type_of(value) {
        _ if ends_block(function, value) => {}
        // An address may go through the variable.
        _ if matches!(function.op(value), Op::SetVariable(..))
            && !promises(function).is_empty() => {}
        Type::Void => function.remove(value),
        Type::Tuple => {
            for user in instructions(function) {
                if matches!(*function.op(user), Op::Extract(tuple, _) if tuple == value) {
                    neutralize(function, user);
                }
            }
            function.remove(value);
        }
        ty => {
            let zero = function.zero(ty);
            function.replace(value, zero);
        }
    }
}

fn drop_param(function: &mut Function, param: Value, replacement: Value) {
    let block = function.block_of(param);
    function.replace_param(param, replacement);
    let cfg = Cfg::new(function);
    function.drop_dead_params(block, cfg.predecessors(block));
}

fn is_entry(function: &Function, block: Block) -> bool {
    function.entries().iter().any(|entry| entry.block == block)
}

fn withdraw_promise(function: &mut Function, value: Value) {
    if let Op::Load { access, .. } | Op::LoadLane { access, .. } = function.op_mut(value) {
        *access = Access::new(access.heap(), access.flags() - AccessFlags::ALWAYS_READABLE);
    }
}

impl Reducer<'_> {
    fn function(&self) -> &Function {
        &self.case.program.function
    }

    /// Keeps the change if the program is still good and still fails.
    fn attempt(&mut self, change: impl FnOnce(&mut Function)) -> bool {
        let candidate = catching(|| {
            let mut function = self.function().clone();
            change(&mut function);
            Cfg::new(&function).remove_unreachable_blocks(&mut function);
            function.resolve_aliases();
            for value in instructions(&function) {
                let before = self.function();
                if before.is_valid_value(value)
                    && before.operands(value) != function.operands(value)
                {
                    withdraw_promise(&mut function, value);
                }
            }
            self.case.with_function(function)
        });
        match candidate.flatten() {
            Ok(candidate) if (self.fails)(&candidate) => {
                self.case = candidate;
                true
            }
            _ => false,
        }
    }

    fn keep_one_input(&mut self) {
        for input in self.case.inputs.clone() {
            let Case {
                seed,
                world,
                program,
                ..
            } = self.case.clone();
            let candidate = Case::new(seed, world, program, vec![input]).unwrap();
            if (self.fails)(&candidate) {
                self.case = candidate;
                return;
            }
        }
    }

    /// What is not promised cannot be broken by later steps.
    fn withdraw_promises(&mut self) {
        let is_promised = |&value: &Value| {
            let access = self.function().op(value).access();
            access.is_some_and(|access| access.has(AccessFlags::ALWAYS_READABLE))
        };
        let all = instructions(self.function()).into_iter();
        let loads: Vec<Value> = all.filter(is_promised).collect();
        let withdraw_all = |function: &mut Function| {
            for &load in &loads {
                withdraw_promise(function, load);
            }
        };
        if !self.attempt(withdraw_all) {
            for load in loads {
                self.attempt(|function| withdraw_promise(function, load));
            }
        }
    }

    fn cut_edges(&mut self) -> bool {
        let mut progress = false;
        for block in blocks(self.function()) {
            if self.function().is_removed(block)
                || *self.function().op(self.function().last(block)) == Op::Jump
            {
                continue;
            }
            let mut edges = self.function().successors(block);
            progress |=
                edges.any(|edge| self.attempt(|function| function.keep_only_successor(edge)));
        }
        progress
    }

    fn return_early(&mut self) -> bool {
        let is_return = |&value: &Value| matches!(self.function().op(value), Op::Return(_));
        let Some(model) = instructions(self.function()).into_iter().find(is_return) else {
            return false;
        };
        let types: Vec<Type> = self
            .function()
            .operands(model)
            .iter()
            .map(|&result| self.function().type_of(result))
            .collect();
        let mut progress = false;
        for block in blocks(self.function()) {
            if !self.function().is_removed(block) && self.function().successors(block).len() != 0 {
                progress |= self.attempt(|function| {
                    function.remove(function.last(block));
                    let zeros: Vec<Value> = types.iter().map(|&ty| function.zero(ty)).collect();
                    Builder::at_end(function, block).ret(&zeros);
                });
            }
        }
        progress
    }

    fn neutralize_runs(&mut self) -> bool {
        let mut progress = false;
        let mut length = instructions(self.function()).len().next_power_of_two();
        while length != 0 {
            for run in instructions(self.function()).rchunks(length) {
                if run.iter().any(|&value| !ends_block(self.function(), value)) {
                    progress |= self.attempt(|function| {
                        for &value in run.iter().rev() {
                            if is_present(function, value) {
                                neutralize(function, value);
                            }
                        }
                    });
                }
            }
            length /= 2;
        }
        progress
    }

    fn bypass_instructions(&mut self) -> bool {
        let mut progress = false;
        for value in instructions(self.function()).into_iter().rev() {
            let ty = self.function().type_of(value);
            if !ty.is_data() {
                continue;
            }
            let entry = self.function().entries()[self.case.inputs[0].entry].block;
            let candidates = [
                self.function().operands(value),
                self.function().params(entry),
            ]
            .concat();
            progress |= candidates.into_iter().any(|other| {
                self.function().type_of(other) == ty
                    && self.attempt(|function| function.replace(value, other))
            });
            if ty != Type::V128 && is_present(self.function(), value) {
                progress |= [1, u64::MAX].into_iter().any(|bits| {
                    self.attempt(|function| {
                        let constant = function.constant(ty, bits);
                        function.replace(value, constant);
                    })
                });
            }
        }
        progress
    }

    fn drop_params(&mut self) -> bool {
        let mut progress = false;
        for block in blocks(self.function()) {
            if is_entry(self.function(), block) {
                continue;
            }
            for param in self.function().params(block).to_vec() {
                let args = incoming(self.function(), param);
                progress |= self.attempt(|function| {
                    let zero = function.zero(function.type_of(param));
                    drop_param(function, param, zero);
                }) || args
                    .into_iter()
                    .any(|arg| self.attempt(|function| drop_param(function, param, arg)));
            }
        }
        progress
    }

    fn merge_blocks(&mut self) -> bool {
        let mut progress = false;
        for block in blocks(self.function()) {
            let function = self.function();
            if function.is_removed(block) || *function.op(function.last(block)) != Op::Jump {
                continue;
            }
            let next = function.target(function.successor(block, 0));
            if next != block && Cfg::new(function).predecessors(next).len() == 1 {
                progress |= self.attempt(|function| function.merge_with_successor(block));
            }
        }
        progress
    }

    fn shorten_lists(&mut self) -> bool {
        let mut progress = false;
        for value in instructions(self.function()) {
            if !self.function().state_of(value).is_none() {
                progress |= self.attempt(|function| function.set_state_of(value, State::NONE));
            }
            for position in (0..self.function().state(self.function().state_of(value)).len()).rev()
            {
                progress |= self.attempt(|function| {
                    let mut values = function.state(function.state_of(value)).to_vec();
                    values.remove(position);
                    let state = function.add_state(&values);
                    function.set_state_of(value, state);
                });
            }
            let is_custom = |function: &Function| matches!(*function.op(value), Op::Patchpoint(patchpoint) if function.patchpoint(patchpoint).action == Action::Custom);
            if is_custom(self.function()) {
                for position in (1..self.function().operands(value).len()).rev() {
                    progress |= self.attempt(|function| drop_operand(function, value, position));
                }
            }
        }
        progress
    }

    fn clear_uses(&mut self) -> bool {
        let mut progress = false;
        for value in instructions(self.function()) {
            if !matches!(
                self.function().op(value),
                Op::Return(_)
                    | Op::Patchpoint(_)
                    | Op::Store { .. }
                    | Op::Node { .. }
                    | Op::WideNode { .. }
            ) {
                continue;
            }
            for (position, operand) in self
                .function()
                .operands(value)
                .to_vec()
                .into_iter()
                .enumerate()
            {
                if !self.function().op(operand).is_floating() {
                    progress |= self.attempt(|function| {
                        let zero = function.zero(function.type_of(operand));
                        function.operands_mut(value)[position] = zero;
                    });
                }
            }
        }
        for block in blocks(self.function()) {
            for edge in self.function().successors(block) {
                for (position, arg) in self.function().args(edge).to_vec().into_iter().enumerate() {
                    if !self.function().op(arg).is_floating() {
                        progress |= self.attempt(|function| {
                            let zero = function.zero(function.type_of(arg));
                            function.args_mut(edge)[position] = zero;
                        });
                    }
                }
            }
        }
        progress
    }
}

fn drop_operand(function: &mut Function, value: Value, position: usize) {
    let Op::Patchpoint(old) = *function.op(value) else {
        unreachable!()
    };
    let inputs = function.inputs(old).iter().copied();
    let mut operands: Vec<_> = function
        .operands(value)
        .iter()
        .copied()
        .zip(inputs)
        .collect();
    operands.remove(position);
    let (data, outputs) = (*function.patchpoint(old), function.outputs(old).to_vec());
    *function.op_mut(value) = Op::Patchpoint(function.add_patchpoint(&data, &operands, &outputs));
}

pub(crate) fn reduce(case: Case, fails: &mut dyn FnMut(&Case) -> bool) -> Case {
    let mut reducer = Reducer { case, fails };
    reducer.keep_one_input();
    reducer.withdraw_promises();
    let steps = [
        Reducer::cut_edges,
        Reducer::return_early,
        Reducer::neutralize_runs,
        Reducer::shorten_lists,
        Reducer::clear_uses,
        Reducer::drop_params,
        Reducer::merge_blocks,
        Reducer::bypass_instructions,
    ];
    while steps
        .iter()
        .fold(false, |progress, step| step(&mut reducer) | progress)
    {}
    reducer.case
}
