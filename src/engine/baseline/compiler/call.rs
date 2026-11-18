//! Calls.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Operand, Register, Shape, Specialization};
use bun_engine_vm::code::metadata::{Call, SuperConstruct, WeakCell};
use bun_engine_vm::ic::CallProfile;
use bun_engine_vm::{CallFrame, CellType, CodeBlock, Executable, JsFunction, options};

use super::{Cold, Compiler, metadata, slot};
use crate::emit::{ARGUMENT_COUNT, Emit, UNDEFINED, WORD, at};
use crate::registers::*;

#[derive(Clone, Copy)]
pub(super) struct FixedCall {
    pub(super) dst: Register,
    pub(super) callee: Operand,
    pub(super) this: Operand,
    /// With `this`.
    pub(super) count: u32,
    pub(super) arguments: [Option<Operand>; 2],
    pub(super) frame: u32,
    pub(super) metadata: u32,
    pub(super) specialization: Specialization,
    pub(super) is_tail: bool,
    pub(super) is_super: bool,
}

impl FixedCall {
    pub(super) fn argument(&self, index: u32) -> Operand {
        let given = self.arguments.get(index as usize).copied().flatten();
        given.unwrap_or_else(|| Register::outgoing_argument(self.frame, index).into())
    }
}

/// Holds the entry while a call is being set up.
pub(crate) const ENTRY: Gpr = T4;
const MOST_UNROLLED: u32 = 8;

/// A field of the header of the frame that is `distance` words below.
pub(super) const fn new_frame(distance: u32, field: usize) -> Address {
    Address::new(FP, field as i32 - distance as i32 * WORD)
}

pub(super) const fn frame_words(count_including_this: u32) -> u32 {
    (CallFrame::HEADER_WORDS as u32 + count_including_this).next_multiple_of(2)
}

impl Compiler<'_> {
    /// Fills the frame the general way, and leaves the entry and the executable in their registers.
    fn prepare_call(&mut self, cold: &Cold) {
        let opcode = self.raw(cold.offset).opcode;
        self.m.move32(ARGUMENTS[2], cold.offset);
        (self.m).call_address(self.thunks.prepare_call(opcode, false));
        self.m.jump(cold.resume);
    }

    /// Where to go to have the call prepared, and where that comes back to.
    pub(super) fn cold_preparation(&mut self) -> (Label, Label) {
        let prepared = self.m.new_label();
        let prepare = self.cold_alone(prepared, |c, cold| c.prepare_call(cold));
        (prepare, prepared)
    }

    /// With the callee in `T0`. Goes on, with what to call it through in `EXECUTABLE`, if the profile knows of it.
    pub(super) fn check_callee(&mut self, word: u32, otherwise: Label) {
        let known = self.m.new_label();
        let other = self.cold_with(known, otherwise, |c, cold| {
            let word = c.raw(cold.offset).metadata;
            (c.m).compute_address(T1, metadata(word, offset_of!(Call, profile)));
            c.m.call_address(c.thunks.check_callee);
            c.m.branch_if_not_zero64(T1, cold.resume);
            c.m.jump(cold.slow);
        });
        let profile = |field| metadata(word, offset_of!(Call, profile) + field);
        if self.profiles.calls_closures(word) {
            self.m.branch_if_not_cell(T0, otherwise);
            self.m.branch_if_not_type(T0, CellType::Function, other);
            self.m.load64(T1, at(T0, JsFunction::OFFSET_OF_EXECUTABLE));
            let seen = profile(CallProfile::OFFSET_OF_EXECUTABLE);
            self.m.branch64(Cond::Ne, T1, seen, other);
        } else {
            (self.m).branch64(Cond::Ne, T0, profile(CallProfile::OFFSET_OF_CALLEE), other);
        }
        (self.m).load64(EXECUTABLE, profile(CallProfile::OFFSET_OF_TARGETS));
        self.m.bind(known);
    }

    /// With the callee in `T0`, `this` in `T1` and the executable in its register.
    pub(super) fn fill_header(&mut self, frame: u32, count: u32, specialization: Specialization) {
        let code_block = Executable::offset_of_code_block(specialization);
        self.m.load64(T2, at(EXECUTABLE, code_block));
        let header = new_frame(frame, CallFrame::OFFSET_OF_CODE_BLOCK);
        self.m.store_pair64(header, T2, T0);
        (self.m).store64(new_frame(frame, CallFrame::OFFSET_OF_ARGUMENT_COUNT), count);
        (self.m).store64(new_frame(frame, CallFrame::OFFSET_OF_THIS), T1);
        let entry = Executable::offset_of_entry(specialization);
        self.m.load64(ENTRY, at(EXECUTABLE, entry));
        self.store_call_site();
    }

    /// Leaves the result in `T0`.
    pub(super) fn make_call(&mut self, frame: u32) {
        (self.m).compute_address(SP, new_frame(frame, CallFrame::LINKAGE_SIZE));
        self.m.call_indirect(ENTRY);
        self.return_point();
    }

    pub(super) fn fixed_call(&mut self, call: &FixedCall) {
        let native = self.only_native_callee(call);
        let is_tail = call.is_tail && options().use_tail_calls;
        let parameters = (self.profiles).parameters_of_callee(call.metadata, call.specialization);
        if let Some(parameters) = parameters.filter(|&it| it > call.count && it <= MOST_UNROLLED)
            && !is_tail
            && self.is_provisional
        {
            return self.padded_call(call, parameters);
        }
        let mut done = [native.and_then(|it| self.try_intrinsic(call, it)), None];
        let (prepare, prepared) = self.cold_preparation();
        let moved = (0..).zip(call.arguments).filter_map(|(index, argument)| {
            let target = Register::outgoing_argument(call.frame, index);
            Some((target, argument.filter(|&it| it != target)?))
        });
        let temps = [T5, T6];
        for ((_, argument), temp) in moved.clone().zip(temps) {
            self.load(temp, argument);
        }
        self.load(T7, call.this);
        self.load(T0, call.callee);
        self.check_callee(call.metadata, prepare);
        self.check_new_target(call, prepare);
        for ((target, _), temp) in moved.zip(temps) {
            self.store(target, temp);
        }
        self.m.move64(T1, T7);
        done[1] = match native {
            Some(_) if !is_tail => done[0].is_none().then(|| self.try_native_call(call)),
            Some(it)
                if it.picks_kind_of_number() && self.records && call.count <= MOST_UNROLLED =>
            {
                Some(self.try_on_numbers(call, it))
            }
            _ => None,
        };
        self.fill_header(call.frame, call.count, call.specialization);
        self.m.bind(prepared);
        if is_tail {
            self.replace_frame(call.frame, call.count);
        } else {
            self.make_call(call.frame);
        }
        for label in done.into_iter().flatten() {
            self.m.bind(label);
        }
        if !is_tail || done != [None; 2] {
            self.store_profiled_result(call.dst, call.metadata);
        }
    }

    /// In `T7`.
    fn check_new_target(&mut self, call: &FixedCall, otherwise: Label) {
        if call.is_super {
            let known = self.m.new_label();
            let seen = metadata(call.metadata, offset_of!(SuperConstruct, new_target));
            self.m.branch64(Cond::Eq, T7, seen, known);
            self.m.branch64(Cond::Ne, seen, WeakCell::MANY, otherwise);
            self.m.bind(known);
        }
    }

    /// Of a function with more parameters than there are arguments. Spares it moving the frame.
    fn padded_call(&mut self, call: &FixedCall, parameters: u32) {
        let ready = self.m.new_label();
        let prepare = self.cold_alone(ready, |c, cold| {
            let raw = c.raw(cold.offset);
            let mut operands = raw.opcode.shapes().iter().zip(raw.words());
            let is_frame = |it: &Shape| matches!(it, Shape::Frame | Shape::Frame1 | Shape::Frame2);
            let (_, &frame) = operands.find(|it| is_frame(it.0)).expect("a call");
            c.m.move32(ARGUMENTS[2], cold.offset);
            c.m.call_address(c.thunks.prepare_call(raw.opcode, true));
            (c.m).compute_address(SP, new_frame(frame, CallFrame::LINKAGE_SIZE));
            c.m.jump(cold.resume);
        });
        let given = call.arguments.into_iter().flatten().zip([T5, T6]);
        for (argument, temp) in given.clone() {
            self.load(temp, argument);
        }
        self.load(T7, call.this);
        self.load(T0, call.callee);
        self.check_callee(call.metadata, prepare);
        self.check_new_target(call, prepare);
        let code_block = Executable::offset_of_code_block(call.specialization);
        self.m.load64(T2, at(EXECUTABLE, code_block));
        self.m.branch_if_zero64(T2, prepare);
        let expected = at(T2, CodeBlock::OFFSET_OF_PARAMETERS);
        self.m.branch32(Cond::Ne, expected, parameters, prepare);

        let frame = call.frame + frame_words(parameters) - frame_words(call.count);
        (self.m).compute_address(SP, new_frame(frame, CallFrame::LINKAGE_SIZE));
        let place = |index| slot(Register::outgoing_argument(frame, index));
        for (index, (_, temp)) in (0..).zip(given.clone()) {
            self.m.store64(place(index), temp);
        }
        if frame != call.frame {
            for index in given.count() as u32..call.count - 1 {
                let source = slot(Register::outgoing_argument(call.frame, index));
                self.m.transfer64(place(index), source);
            }
        }
        for index in call.count - 1..parameters - 1 {
            self.m.store64(place(index), UNDEFINED);
        }
        let field = |offset| new_frame(frame, offset);
        (self.m).store_pair64(field(CallFrame::OFFSET_OF_CODE_BLOCK), T2, T0);
        let count = u64::from(CallFrame::IS_PADDED) << 32 | u64::from(call.count);
        (self.m).store64(field(CallFrame::OFFSET_OF_ARGUMENT_COUNT), count);
        self.m.store64(field(CallFrame::OFFSET_OF_THIS), T7);
        let entry = Executable::offset_of_entry(call.specialization);
        self.m.load64(ENTRY, at(EXECUTABLE, entry));
        self.store_call_site();
        self.m.bind(ready);
        self.m.call_indirect(ENTRY);
        self.return_point();
        self.store_profiled_result(call.dst, call.metadata);
    }

    /// Moves the new frame to where this one ends, and jumps to the entry.
    fn replace_frame(&mut self, frame: u32, count: u32) {
        if count > MOST_UNROLLED {
            self.m.compute_address(T1, new_frame(frame, 0));
            return self.m.jump_address(self.thunks.tail_call);
        }
        let parameters = self.body.parameters();
        self.m.load32(T0, ARGUMENT_COUNT);
        if parameters > 1 {
            self.m.move32(T1, parameters);
            self.m.select32(Cond::Below, T0, T0, T1, T1, T0);
        }
        self.m.add32(T0, T0, CallFrame::HEADER_WORDS + 1);
        self.m.and32(T0, T0, -2);
        let distance = -(frame_words(count) as i32) * WORD;
        (self.m).compute_address(T1, Address::indexed(FP, T0, Scale::Eight, distance));
        self.m.load_pair64(T5, T6, at(FP, 0));
        let first = CallFrame::LINKAGE_SIZE as u32 / WORD as u32;
        for word in (first..CallFrame::HEADER_WORDS as u32 + count).rev() {
            let offset = word as usize * WORD as usize;
            self.m.load64(T0, new_frame(frame, offset));
            self.m.store64(at(T1, offset), T0);
        }
        self.m.store_pair64(at(T1, 0), T5, T6);
        self.m.move64(FP, T1);
        self.m.leave_frame();
        self.m.jump_indirect(ENTRY);
    }

    pub(super) fn to_argument_list(&mut self, dst: Register, value: Operand) {
        let (slow, store) = (self.slow(), self.m.new_label());
        self.load(T1, value);
        self.m.branch_if_zero64(T1, store);
        self.m.branch_if_null_or_undefined(T1, T0, store);
        self.m.call_address(self.thunks.is_argument_list);
        self.m.branch_if_zero32(T0, slow);
        self.m.bind(store);
        self.m.move64(T0, T1);
        self.store_result(dst);
    }

    /// Leaves the new frame in the stack pointer, and the entry and the executable in their registers.
    fn prepare_varargs_call(&mut self) {
        let opcode = self.raw(self.offset).opcode;
        self.m.move32(ARGUMENTS[2], self.offset);
        self.m.call_address(self.thunks.size_frame(opcode));
        self.m.move64(SP, T0);
        self.m.move64(ARGUMENTS[3], T0);
        self.m.move32(ARGUMENTS[2], self.offset);
        self.m.call_address(self.thunks.fill_frame(opcode));
    }

    fn make_varargs_call(&mut self, dst: Register, word: u32, is_tail: bool) {
        if is_tail && options().use_tail_calls {
            self.m.move64(T1, SP);
            return self.m.jump_address(self.thunks.tail_call);
        }
        self.m.add64(SP, SP, CallFrame::LINKAGE_SIZE);
        self.m.call_indirect(ENTRY);
        self.return_point();
        self.store_profiled_result(dst, word);
    }

    pub(super) fn call_with_spread(&mut self, dst: Register, word: u32, is_tail: bool) {
        self.prepare_varargs_call();
        self.make_varargs_call(dst, word, is_tail);
    }

    /// `call.count` and `call.frame` do not apply.
    pub(super) fn list_call(
        &mut self,
        call: &FixedCall,
        list: Operand,
        [skip_in_list, skip_in_frame]: [u32; 2],
    ) {
        let (new_frame, first, count) = (T1, T2, T5);
        let [prepared, next, copied] = core::array::from_fn(|_| self.m.new_label());
        let prepare = self.cold_alone(prepared, |c, cold| {
            c.prepare_varargs_call();
            c.m.jump(cold.resume);
        });
        self.load(T5, list);
        self.load(T7, call.this);
        self.load(T0, call.callee);
        self.check_callee(call.metadata, prepare);
        self.check_new_target(call, prepare);
        self.m.move32(T6, skip_in_list);
        if skip_in_frame != skip_in_list {
            self.m.move32(T7, skip_in_frame);
            self.m.select(Width::W64, Cond::Eq, T6, T5, 0, T7, T6);
        }
        self.m.move64(T7, SP);
        self.m.call_address(self.thunks.size_frame_for_list);
        self.m.branch_if_zero64(new_frame, prepare);
        self.m.move64(SP, new_frame);
        let field = |offset| at(new_frame, offset);
        self.m.add32(T4, count, 1);
        (self.m).store64(field(CallFrame::OFFSET_OF_ARGUMENT_COUNT), T4);
        self.m.branch_if_zero32(count, copied);
        self.m.move32(T6, UNDEFINED);
        self.m.bind(next);
        let last = |base, offset| Address::indexed(base, count, Scale::Eight, offset - WORD);
        self.m.load64(T4, last(first, 0));
        self.m.select(Width::W64, Cond::Eq, T4, T4, 0, T6, T4);
        (self.m).store64(last(new_frame, CallFrame::OFFSET_OF_ARGUMENTS as i32), T4);
        self.m.sub32(count, count, 1);
        self.m.branch_if_not_zero32(count, next);
        self.m.bind(copied);
        let code_block = Executable::offset_of_code_block(call.specialization);
        self.m.load64(T2, at(EXECUTABLE, code_block));
        (self.m).store_pair64(field(CallFrame::OFFSET_OF_CODE_BLOCK), T2, T0);
        self.load(T2, call.this);
        self.m.store64(field(CallFrame::OFFSET_OF_THIS), T2);
        let entry = Executable::offset_of_entry(call.specialization);
        self.m.load64(ENTRY, at(EXECUTABLE, entry));
        self.store_call_site();
        self.m.bind(prepared);
        self.make_varargs_call(call.dst, call.metadata, call.is_tail);
    }
}
