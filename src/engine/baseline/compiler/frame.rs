//! Entering, leaving, and what is in the frame.

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{CodeFlags, Operand, Register, op};
use bun_engine_vm::{CellType, CodeBlock, JsFunction, MappedArguments, Vm};

use super::{Compiler, slot};
use crate::emit::{ARGUMENT_COUNT, Emit, UNDEFINED, WORD, at};
use crate::ic::abi::BASE;
use crate::ic::load_array_length;
use crate::registers::*;

const MOST_UNROLLED: u32 = 8;
const COUNTER: Address = at(CODE_BLOCK, CodeBlock::OFFSET_OF_EXECUTION_COUNTER);
const STACK_LIMIT: Address = at(VM, Vm::OFFSET_OF_STACK_LIMIT);

impl Compiler<'_> {
    pub(super) fn prologue(&mut self) -> Label {
        let entry = self.m.here();
        self.m.enter_frame();
        let parameters = self.body.parameters();
        if parameters > 1 {
            let padded = self.m.new_label();
            let pad = self.cold_alone(padded, |c, cold| {
                c.m.call_address(c.thunks.pad_arguments);
                c.m.jump(cold.resume);
            });
            // With the call site above it.
            (self.m).branch64(Cond::Below, ARGUMENT_COUNT, parameters, pad);
            self.m.bind(padded);
        }
        let interrupted = self.cold_alone(entry, |c, _| {
            c.m.leave_frame();
            c.m.jump_address(bun_engine_interpreter::entry());
        });
        let bottom = Address::new(FP, -(self.body.locals() as i32) * WORD);
        self.m.compute_address(T0, bottom);
        self.m.branch64(Cond::Lt, T0, STACK_LIMIT, interrupted);
        self.m.move64(SP, T0);
        self.m.load_pinned_registers();
        let done = self.m.new_label();
        let finish = self.cold_alone(done, |c, cold| {
            c.m.call_address(c.thunks.finish_prologue);
            c.m.jump(cold.resume);
        });
        if self.records {
            for index in 0..parameters as i32 {
                let profile = self.linked(0).plus((index - parameters as i32) * WORD);
                (self.m).transfer64(profile, slot(Register::THIS).plus(index * WORD));
            }
            let weight = CodeBlock::ENTRY_WEIGHT;
            (self.m).branch_add32_to_memory(ResultCond::NonNegative, COUNTER, weight, finish);
        }
        self.m.branch_if_needs_barrier(CODE_BLOCK, T0, finish);
        self.m.bind(done);
        entry
    }

    pub(super) fn epilogue(&mut self) {
        self.m.leave_frame();
        self.m.ret();
    }

    pub(super) fn enter(&mut self, op: op::Enter) {
        if self.reads_scope {
            self.m.load64(T0, slot(Register::CALLEE));
            self.m.load64(T0, at(T0, JsFunction::OFFSET_OF_SCOPE));
            self.store_result(Register::SCOPE);
        }
        if op.variables == 0 {
            return;
        }
        self.m.move64(T1, UNDEFINED);
        if op.variables <= MOST_UNROLLED {
            for index in 1..=op.variables {
                self.store(Register::local(index), T1);
            }
            return;
        }
        self.m.move32(T2, op.variables);
        let next = self.m.here();
        let lowest = slot(Register::local(op.variables + 1)).offset();
        (self.m).store64(Address::indexed(FP, T2, Scale::Eight, lowest), T1);
        self.m.branch_sub32(ResultCond::NonZero, T2, T2, 1, next);
    }

    pub(super) fn mov(&mut self, op: op::Move) {
        match self.immediate(op.src) {
            Some(bits) if self.int32_constant(op.src).is_none() => {
                self.store(op.dst, bits);
                if self.incoming != Some(op.dst) {
                    self.pass_on_incoming();
                }
            }
            _ => {
                self.load(T0, op.src);
                self.store_result(op.dst);
            }
        }
    }

    pub(super) fn loop_hint(&mut self) {
        if self.records {
            let end = self.end();
            let tier_up = self.cold_alone(end, |c, cold| {
                c.m.move32(ARGUMENTS[2], c.offset);
                c.m.call_address(c.thunks.tier_up_in_loop);
                c.m.jump(cold.resume);
            });
            (self.m).branch_add32_to_memory(ResultCond::NonNegative, COUNTER, 1, tier_up);
        }
        let slow = self.slow();
        self.m.branch64(Cond::Below, FP, STACK_LIMIT, slow);
    }

    pub(super) fn ret(&mut self, op: op::Return) {
        self.load(T0, op.value);
        self.epilogue();
    }

    pub(super) fn to_this(&mut self, op: op::ToThis) {
        let slow = self.slow();
        self.load(T0, op.this);
        self.m.branch_if_not_cell(T0, slow);
        self.m.branch_if_cell_is_no_object(T0, slow);
        self.m.branch_if_type(T0, CellType::GlobalObject, slow);
        self.record_value(op.metadata);
        self.keep(op.this);
    }

    pub(super) fn slow_if_empty(&mut self, value: Register) {
        let slow = self.slow();
        self.load(T0, value);
        self.m.branch_if_empty(T0, slow);
        self.keep(value);
    }

    pub(super) fn slow_unless_empty(&mut self, value: Register) {
        let slow = self.slow();
        self.m.branch_if_not_empty(slot(value), slow);
    }

    pub(super) fn bind_this(&mut self, op: op::BindThis) {
        self.slow_unless_empty(op.this);
        self.load(T0, op.value);
        self.store_result(op.this);
    }

    /// Without `this`.
    fn load_argument_count(&mut self, dst: Gpr) {
        self.m.load32(dst, ARGUMENT_COUNT);
        self.m.sub32(dst, dst, 1);
        debug_assert!(!self.body.flags().contains(CodeFlags::SUSPENDS));
    }

    pub(super) fn argument_count(&mut self, op: op::ArgumentCount) {
        if self.body.flags().contains(CodeFlags::SUSPENDS) {
            return self.call_slow_path();
        }
        self.load_argument_count(T0);
        self.m.box_int32(T0, T0);
        self.store_result(op.dst);
    }

    pub(super) fn get_argument(&mut self, op: op::GetArgument) {
        let absent = self.m.new_label();
        self.m.move64(T0, UNDEFINED);
        (self.m).branch32(Cond::BelowEq, ARGUMENT_COUNT, op.index + 1, absent);
        self.m.load64(T0, slot(Register::argument(op.index)));
        self.m.bind(absent);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn get_arguments_length(&mut self, op: op::GetArgumentsLength) {
        let (exists, found, slow) = (self.m.new_label(), self.m.new_label(), self.slow());
        self.load(BASE, op.arguments);
        self.m.branch_if_not_empty(BASE, exists);
        self.load_argument_count(T0);
        if op.skip != 0 {
            self.m.sub32(T0, T0, op.skip as i32);
            self.m.branch32(Cond::Ge, T0, 0, found);
            self.m.move32(T0, 0);
        }
        self.m.jump(found);
        self.m.bind(exists);
        load_array_length(&mut self.m, slow);
        self.m.bind(found);
        self.m.box_int32(T0, T0);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn get_argument_by_val(&mut self, op: op::GetArgumentByVal) {
        let (end, done) = (self.end(), self.target(op.done));
        self.load(T0, op.key);
        self.m.branch_if_not_empty(slot(op.arguments), end);
        self.m.sub64(T0, T0, NUMBER_TAG);
        self.load_argument_count(T1);
        if op.skip != 0 {
            self.m.sub32(T1, T1, op.skip as i32);
            self.m.branch32(Cond::Lt, T1, 0, end);
        }
        self.m.branch64(Cond::AboveEq, T0, T1, end);
        let first = Register::argument(op.skip).offset() * 8;
        (self.m).load64(T0, Address::indexed(FP, T0, Scale::Eight, first));
        self.record_value(op.metadata);
        self.store(op.dst, T0);
        self.m.jump(done);
    }

    pub(super) fn get_from_arguments(&mut self, op: op::GetFromArguments) {
        self.load(T0, op.arguments);
        (self.m).load64(T0, at(T0, MappedArguments::offset_of_slot(op.index)));
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn put_to_arguments(&mut self, op: op::PutToArguments) {
        self.store_in_cell(
            op.arguments.into(),
            MappedArguments::offset_of_slot(op.index),
            op.value,
        );
    }

    pub(super) fn store_in_cell(&mut self, cell: Operand, offset: usize, value: Operand) {
        self.load_both(value, cell);
        self.m.store64(at(T1, offset), T0);
        self.barrier_for(value, T0);
        self.keep(value);
    }
}
