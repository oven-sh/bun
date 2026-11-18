//! Leaving a frame to enter it again.

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Jump, Register, ResumeMode, Specialization, op};
use bun_engine_vm::{CellType, Coroutine, CoroutineState};
use smallvec::SmallVec;

use super::{Compiler, slot};
use crate::emit::{ARGUMENT_COUNT, Emit, WORD, at};
use crate::registers::*;

const VALUE: Register = Register::argument(0);
const MODE: Register = Register::argument(1);
const MOST_UNROLLED: usize = 24;

const fn coroutine(reg: Gpr, field: usize) -> Address {
    at(reg, field)
}

impl Compiler<'_> {
    fn first_saved_register(&self, reg: Gpr) -> Address {
        at(reg, Coroutine::offset_of_registers(self.coroutine_type))
    }

    pub(super) fn resume_dispatch(&mut self) {
        let end = self.end();
        self.m.branch_if_not_zero32(ARGUMENT_COUNT, end);
        let points = self.body.suspend_points().iter();
        let labels: SmallVec<[Label; 16]> = points.map(|it| self.label_at(it.resume)).collect();
        self.m.load64(T0, slot(Register::THIS));
        match labels[..] {
            [] => {}
            [only] => self.m.jump(only),
            _ => {
                self.m.load32(T0, coroutine(T0, Coroutine::OFFSET_OF_POINT));
                self.m.jump_table(T0, &labels);
            }
        }
    }

    pub(super) fn suspend(&mut self, op: op::Suspend) {
        let registers = self.body.saved_registers(op.point);
        if registers.len() > MOST_UNROLLED {
            return self.call_slow_path();
        }
        self.load_both(op.value, op.generator.into());
        let first = self.first_saved_register(T1);
        for it in registers {
            (self.m).transfer64(first.plus(it.word as i32 * WORD), slot(it.register));
        }
        (self.m).store32(coroutine(T1, Coroutine::OFFSET_OF_POINT), op.point.0);
        let state = CoroutineState::from(op.kind) as i32;
        (self.m).store32(coroutine(T1, Coroutine::OFFSET_OF_STATE), state);
        self.barrier();
        let end = self.end.take().expect("the barrier goes there");
        self.m.bind(end);
        self.epilogue();
    }

    pub(super) fn resume(&mut self, op: op::Resume) {
        let registers = self.body.saved_registers(op.point);
        if registers.len() > MOST_UNROLLED {
            return self.call_slow_path();
        }
        self.m.load64(T0, slot(Register::THIS));
        let first = self.first_saved_register(T0);
        for it in registers {
            (self.m).transfer64(slot(it.register), first.plus(it.word as i32 * WORD));
        }
        self.store_result(op.generator);
    }

    pub(super) fn resume_normally(&mut self, dst: Register, word: u32, normal: Option<Jump>) {
        let slow = self.slow();
        (self.m).branch32(Cond::Ne, slot(MODE), ResumeMode::Normal as i32, slow);
        self.m.load64(T0, slot(VALUE));
        self.store_profiled_result(dst, word);
        if let Some(normal) = normal {
            let normal = self.target(normal);
            self.m.jump(normal);
        }
    }

    pub(super) fn resume_after_delegate(&mut self, op: op::ResumeAfterDelegate) {
        self.m.transfer64(slot(op.mode), slot(MODE));
        self.m.load64(T0, slot(VALUE));
        self.store_profiled_result(op.value, op.metadata);
    }

    pub(super) fn generator_return(&mut self, op: op::GeneratorReturn) {
        self.load_both(op.value, op.generator.into());
        let completed = CoroutineState::Completed as i32;
        (self.m).store32(coroutine(T1, Coroutine::OFFSET_OF_STATE), completed);
        (self.m).store32(coroutine(T1, Coroutine::OFFSET_OF_SAVED_COUNT), 0);
        self.epilogue();
    }

    pub(super) fn resume_generator(&mut self, op: op::ResumeGenerator) {
        let (prepare, prepared) = self.cold_preparation();
        self.load(T5, op.value);
        self.load(T6, op.mode);
        self.load(T7, op.generator);
        self.m.branch_if_not_cell(T7, prepare);
        self.m.branch_if_not_type(T7, CellType::Generator, prepare);
        let (state, executing) = (
            coroutine(T7, Coroutine::OFFSET_OF_STATE),
            CoroutineState::Executing as i32,
        );
        self.m.branch32(Cond::AboveEq, state, executing, prepare);
        self.m
            .load64(T0, coroutine(T7, Coroutine::OFFSET_OF_CALLEE));
        self.check_callee(op.metadata, prepare);
        self.m.store32(state, executing);
        self.store(Register::outgoing_argument(op.frame, 0), T5);
        self.store(Register::outgoing_argument(op.frame, 1), T6);
        self.m.move64(T1, T7);
        (self.m).load64(EXECUTABLE, coroutine(T1, Coroutine::OFFSET_OF_EXECUTABLE));
        self.fill_header(op.frame, 0, Specialization::Call);
        self.m.bind(prepared);
        self.make_call(op.frame);
        self.store_profiled_result(op.dst, op.metadata);
    }
}
