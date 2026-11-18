//! Entering, leaving and taking over frames.

use bun_engine_asm::prelude::*;
use bun_engine_vm::ic::{CallProfile, CallTargetCount};
use bun_engine_vm::{
    CallFrame, CellType, CodeBlock, ElementKind, FunctionRareData, ImmutableArray, IndexingMode,
    JsFunction, Vm, call,
};

use super::Emitter;
use super::arrays::branch_unless_dense;
use crate::compiler::ENTRY;
use crate::emit::*;
use crate::registers::*;
use crate::runtime::{self, FindStart};

impl Emitter {
    /// The lowest address of the frame of the code block in `code_block`.
    pub(super) fn frame_bottom(&mut self, dst: Gpr, code_block: Gpr) {
        self.m
            .load32(dst, at(code_block, CodeBlock::OFFSET_OF_LOCALS));
        self.m.shl64(dst, dst, 3);
        self.m.neg64(dst, dst);
        self.m.add64(dst, dst, FP);
    }

    pub(super) fn pad_arguments(&mut self) {
        let (m, parameters) = (&mut self.m, ARGUMENTS[0]);
        let overflow = m.new_label();
        m.load64(T1, at(FP, CallFrame::OFFSET_OF_CODE_BLOCK));
        m.load32(parameters, at(T1, CodeBlock::OFFSET_OF_PARAMETERS));
        m.shl64(T1, parameters, 3);
        m.sub64(T1, FP, T1);
        let limit = at(VM, Vm::OFFSET_OF_REAL_STACK_LIMIT);
        m.branch64(Cond::Lt, T1, limit, overflow);
        m.jump_address(call::pad_arguments());
        m.bind(overflow);
        m.leave_frame();
        m.jump_address(bun_engine_interpreter::entry());
    }

    pub(super) fn return_unless_told_to_jump(&mut self) {
        let jump = self.m.new_label();
        self.m.branch_if_not_zero64(T0, jump);
        self.m.ret();
        self.m.bind(jump);
        self.m.jump_indirect(T0);
    }

    pub(super) fn finish_prologue(&mut self) {
        self.call_with_frame(runtime::finish_prologue as *const () as usize);
        self.return_unless_told_to_jump();
    }

    pub(super) fn tier_up_in_loop(&mut self) {
        self.call_with_frame(runtime::tier_up_in_loop as *const () as usize);
        self.return_unless_told_to_jump();
    }

    /// `load_offset` puts the offset of the instruction in the second argument register.
    pub(super) fn take_over(
        &mut self,
        find: FindStart,
        load_offset: impl FnOnce(&mut MacroAssembler),
    ) {
        self.m.load_tags();
        self.m.load_pinned_registers();
        self.frame_bottom(T0, CODE_BLOCK);
        self.m.move64(SP, T0);
        load_offset(&mut self.m);
        self.m.move64(ARGUMENTS[0], FP);
        self.m.call_address(find as usize);
        self.m.move64(T4, T0);
        self.m.move64(T0, SECOND_RESULT);
        self.m.jump_indirect(T4);
    }

    pub(super) fn resume(&mut self) {
        self.take_over(runtime::find_start, |m| {
            let instructions = at(CODE_BLOCK, CodeBlock::OFFSET_OF_INSTRUCTIONS);
            m.load32(ARGUMENTS[1], CALL_SITE);
            m.sub32(ARGUMENTS[1], ARGUMENTS[1], instructions);
        });
    }

    pub(super) fn catch(&mut self) {
        let offset = at(VM, Vm::OFFSET_OF_CATCH_BYTECODE_OFFSET);
        self.take_over(runtime::find_start, |m| m.load32(ARGUMENTS[1], offset));
    }

    pub(super) fn leave(&mut self) {
        self.count_surprise(10, self.compile_again);
        let instructions = at(CODE_BLOCK, CodeBlock::OFFSET_OF_INSTRUCTIONS);
        self.m.add32(T0, ARGUMENTS[2], instructions);
        self.m.store32(CALL_SITE, T0);
        self.m.jump_address(bun_engine_interpreter::resume_entry());
        self.m.bind(self.compile_again);
        self.take_over(runtime::compile_again, |m| {
            m.move32(ARGUMENTS[1], ARGUMENTS[2]);
        });
    }

    pub(super) fn check_callee(&mut self) {
        let m = &mut self.m;
        let [plain, found, only, expected, unknown, known, counted] =
            core::array::from_fn(|_| m.new_label());
        m.branch_if_not_cell(T0, unknown);
        m.branch_unless_type_in(T0, CellType::FUNCTIONS, T2, unknown);
        m.load64(EXECUTABLE, at(T0, JsFunction::OFFSET_OF_EXECUTABLE));
        m.load64(T2, at(T1, CallProfile::OFFSET_OF_EXECUTABLE));
        m.branch_if_not_type(EXECUTABLE, CellType::FunctionRareData, plain);
        let executable = at(EXECUTABLE, FunctionRareData::OFFSET_OF_EXECUTABLE);
        m.load64(EXECUTABLE, executable);
        m.branch64(Cond::Eq, T2, EXECUTABLE, only);
        m.jump(found);
        m.bind(plain);
        m.branch64(Cond::Eq, T2, EXECUTABLE, expected);
        m.bind(found);
        m.branch64(
            Cond::Eq,
            T0,
            at(T1, CallProfile::OFFSET_OF_CALLEE),
            expected,
        );
        m.branch64(Cond::Eq, T2, CallProfile::MEGAMORPHIC, known);
        m.branch64(Cond::Ne, T2, CallProfile::POLYMORPHIC, unknown);
        m.load64(T1, at(T1, CallProfile::OFFSET_OF_TARGETS));
        let size = size_of::<CallTargetCount>();
        m.add64(T4, T1, size * CallProfile::MAX_TARGETS);
        let next = m.here();
        m.load64(T2, at(T1, core::mem::offset_of!(CallTargetCount, target)));
        m.branch64(Cond::Eq, T2, EXECUTABLE, counted);
        m.branch64(Cond::Eq, T2, T0, counted);
        m.add64(T1, T1, size);
        m.branch64(Cond::Below, T1, T4, next);
        m.bind(unknown);
        m.move32(T1, 0);
        m.ret();
        m.bind(counted);
        m.add32_to_memory(at(T1, core::mem::offset_of!(CallTargetCount, count)), 1);
        m.bind(known);
        m.move32(T1, 1);
        m.ret();
        // Other code would have found out by itself.
        m.bind(expected);
        self.count_surprise(1, unknown);
        self.m.bind(only);
        (self.m).load64(EXECUTABLE, at(T1, CallProfile::OFFSET_OF_TARGETS));
        self.m.ret();
    }

    pub(super) fn tail_call(&mut self) {
        let m = &mut self.m;
        let (new_frame, target, count) = (T1, T2, T5);
        let round_up = |m: &mut MacroAssembler, dst: Gpr, count: Gpr| {
            m.add32(dst, count, CallFrame::HEADER_WORDS + 1);
            m.and32(dst, dst, -2);
        };
        m.load32(T0, ARGUMENT_COUNT);
        m.load32(T6, at(CODE_BLOCK, CodeBlock::OFFSET_OF_PARAMETERS));
        m.select32(Cond::Below, T0, T0, T6, T6, T0);
        round_up(m, T0, T0);
        m.load32(count, at(new_frame, CallFrame::OFFSET_OF_ARGUMENT_COUNT));
        round_up(m, T6, count);
        m.sub64(T0, T0, T6);
        m.compute_address(target, Address::indexed(FP, T0, Scale::Eight, 0));
        m.load_pair64(T6, T7, at(FP, 0));
        m.add32(count, count, CallFrame::HEADER_WORDS - 1);
        let next = m.here();
        m.load64(T0, Address::indexed(new_frame, count, Scale::Eight, 0));
        m.store64(Address::indexed(target, count, Scale::Eight, 0), T0);
        m.sub32(count, count, 1);
        m.branch32(
            Cond::AboveEq,
            count,
            CallFrame::LINKAGE_SIZE as i32 / WORD,
            next,
        );
        m.store_pair64(at(target, 0), T6, T7);
        m.move64(FP, target);
        m.leave_frame();
        m.jump_indirect(ENTRY);
    }

    pub(super) fn size_frame_for_list(&mut self) {
        const MOST: i32 = 256;
        let m = &mut self.m;
        let [own, none, shared, found, other] = core::array::from_fn(|_| m.new_label());
        let (first, count, skip, bottom) = (T2, T5, T6, T7);
        m.branch_if_zero64(T5, own);
        m.branch_if_not_cell(T5, none);
        m.load_indexing_mode(T1, T5, IndexingMode::KIND_MASK);
        m.branch32(Cond::Eq, T1, ElementKind::Double as i32, other);
        branch_unless_dense(m, T1, other);
        m.branch_if_type(T5, CellType::ImmutableArray, shared);
        m.branch_if_not_type(T5, CellType::Array, other);
        m.load64(first, storage(T5));
        m.load32(count, public_length(first));
        m.jump(found);
        m.bind(shared);
        m.add64(first, T5, ImmutableArray::OFFSET_OF_ELEMENTS);
        m.load32(count, public_length(first));
        m.jump(found);
        m.bind(own);
        m.add64(first, FP, CallFrame::OFFSET_OF_ARGUMENTS);
        m.load32(count, ARGUMENT_COUNT);
        let noted = m.new_label();
        m.load16(
            T1,
            at(CODE_BLOCK, CodeBlock::OFFSET_OF_USUAL_ARGUMENT_COUNT),
        );
        m.branch32(Cond::Eq, T1, count, noted);
        let several = u32::from(CodeBlock::SEVERAL_ARGUMENT_COUNTS);
        m.branch32(Cond::Ne, T1, several, other);
        m.bind(noted);
        m.sub32(count, count, 1);
        m.bind(found);
        m.compute_address(first, Address::indexed(first, skip, Scale::Eight, 0));
        let sized = m.new_label();
        m.sub32(count, count, skip);
        m.branch32(Cond::Ge, count, 0, sized);
        m.bind(none);
        m.move32(count, 0);
        m.bind(sized);
        m.branch32(Cond::Above, count, MOST, other);
        m.add32(T1, count, CallFrame::HEADER_WORDS + 2);
        m.and32(T1, T1, -2);
        m.shl64(T1, T1, 3);
        m.sub64(T1, bottom, T1);
        let limit = at(VM, Vm::OFFSET_OF_REAL_STACK_LIMIT);
        m.branch64(Cond::Lt, T1, limit, other);
        m.ret();
        m.bind(other);
        m.move32(T1, 0);
        m.ret();
    }
}
