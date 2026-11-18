//! Calls of functions and of operations of the run time.

use bun_engine_asm::Reg;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{
    CodeIndex, FuncIndex, FuncType, FunctionFlags, TableIndex, TypeIndex, ValKind, ValType,
};

use super::cold::Cold;
use super::operand::{self, Operand};
use super::{Compiled, Function};
use crate::abi::{
    ARGUMENT_FPRS, ARGUMENT_GPRS, CallProfile, Callable, FunctionElement, FunctionSlot, INSTANCE,
    InstanceLayout, MEMORY_BASE, NULL, Operation, PROFILE, Place, RESULT_FPRS, RESULT_GPRS,
    Registers, SLOT, Signature, TableView, Trap, UNCHECKED_STACK_EXTENSION, frame,
};
use crate::cast::RttCheck;
use crate::tail_call;

#[derive(Clone, Copy)]
pub(super) enum Callee {
    Func(FuncIndex),
    Element(TypeIndex, TableIndex),
    Reference(TypeIndex),
}

/// Whether the callee takes the place of the caller.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Leaves {
    No,
    Yes,
}

/// An argument of an operation.
#[derive(Clone, Copy)]
pub(super) enum Parameter {
    Immediate(u64),
    /// An integer or a reference that was popped, or the slot of anything, to be read as an integer.
    Value(Operand),
    /// Based on the stack pointer.
    Address(Address),
}

const TARGET: Gpr = abi::NON_ARGUMENT_GPRS[1];

fn has_only_registers(ty: FuncType<'_>) -> bool {
    ty.params.len() <= ARGUMENT_GPRS.len().min(ARGUMENT_FPRS.len())
        && ty.results.len() <= RESULT_GPRS.len().min(RESULT_FPRS.len())
}

fn outgoing(offset: i32) -> Address {
    Address::new(
        abi::STACK_POINTER,
        frame::CALLEE_FRAME_FROM_STACK_POINTER + offset,
    )
}

impl Function<'_> {
    pub(super) fn call_function(&mut self, callee: Callee, site: u32, leaves: Leaves) -> Compiled {
        let ty = match callee {
            Callee::Func(func) => self.module.func_type(func),
            Callee::Element(ty, _) | Callee::Reference(ty) => self.module.types().func_type(ty),
        };
        let target = match callee {
            Callee::Func(_) => None,
            Callee::Element(..) | Callee::Reference(_) => Some(self.pop()),
        };
        let first = self.height() - ty.params.len() as u32;
        if leaves == Leaves::No {
            self.write_back_all(self.registers.dirty);
            self.spill_below(self.registers.allocatable, first);
        }
        if let Some(target) = target {
            self.add_move(TARGET, target);
        }
        let signature =
            (leaves == Leaves::Yes || !has_only_registers(ty)).then(|| Signature::new(ty));
        match &signature {
            None => {
                let mut registers = Registers::for_arguments();
                let mut vacant = self.registers.free - self.registers.locked;
                for position in first as usize..self.stack.len() {
                    let value = self.stack[position];
                    let reg = registers.next(value.kind());
                    let reg = reg.expect("there are few arguments");
                    if vacant.contains(reg) {
                        vacant.remove(reg);
                        self.move_operand(reg, value);
                    } else {
                        self.add_move(reg, value);
                    }
                }
            }
            Some(signature) => self.pass_arguments(signature, first),
        }
        self.emit_moves();
        self.unbind_all(self.registers.cached);
        self.registers.free = self.registers.allocatable;
        self.stack.truncate(first as usize);

        let code = match callee {
            Callee::Func(func) => self.find_function(func, site, leaves),
            Callee::Element(ty, table) => {
                self.find_element(ty, table);
                self.enter_instance(Address::new(TARGET, 0), Some(site));
                None
            }
            Callee::Reference(_) => {
                if target.is_some_and(|target| self.may_be_null(target)) {
                    let trap = self.trap_label(Trap::NullFunction);
                    self.masm.branch64(Cond::Eq, TARGET, NULL, trap);
                }
                let callable = Address::new(TARGET, self.env.host.function_callable);
                self.enter_instance(callable, Some(site));
                None
            }
        };

        let entry = Address::new(SLOT, FunctionSlot::ENTRY);
        if leaves == Leaves::Yes {
            let signature = signature.expect("made above");
            tail_call::leave_frame(&mut self.masm, &self.signature, &signature);
            self.masm.jump_indirect(entry);
            self.stack_depth = self.frame.size();
            return self.check_size();
        }
        match code {
            Some(code) if self.counters.is_none() => self.call_directly(code),
            _ => self.masm.call_indirect(entry),
        }
        let handler = self.innermost().handler;
        self.note_call_site(handler);

        let returns_itself = code.is_some_and(|code| {
            let flags = self.env.module.facts(code).flags;
            !flags.contains(FunctionFlags::HAS_TAIL_CALL)
        });
        if !returns_itself {
            let bottom = Address::new(abi::FRAME_POINTER, -(self.stack_depth as i32));
            self.masm.compute_address(abi::STACK_POINTER, bottom);
            let instance = Address::new(abi::FRAME_POINTER, frame::INSTANCE);
            self.masm.load64(INSTANCE, instance);
            self.load_guarded_memory();
        }
        self.load_checked_memory();

        match &signature {
            None => {
                let mut registers = Registers::for_results();
                for &ty in ty.results {
                    let reg = registers.next(ty.kind());
                    self.push_register(ty, reg.expect("there are few results"));
                }
                Ok(())
            }
            Some(signature) => self.push_results(signature, ty.results),
        }
    }

    #[inline(never)]
    fn pass_arguments(&mut self, signature: &Signature, first: u32) {
        self.lower_stack(signature.stack_bytes);
        for (position, &place) in (first as usize..).zip(&signature.params) {
            let value = self.stack[position];
            match place {
                Place::Register(reg) => self.add_move(reg, value),
                Place::Stack(offset) => self.store_operand(outgoing(offset), value),
            }
        }
    }

    #[inline(never)]
    fn push_results(&mut self, signature: &Signature, types: &[ValType]) -> Compiled {
        for (&ty, &place) in types.iter().zip(&signature.results) {
            match place {
                Place::Register(reg) => self.push_register(ty, reg),
                Place::Stack(offset) => {
                    let slot = self.frame_address(self.frame.operand(self.height()));
                    self.transfer(ty.kind(), slot, outgoing(offset));
                    self.push_slot(ty);
                }
            }
        }
        if signature.stack_bytes != 0 {
            let stack_pointer = abi::STACK_POINTER;
            (self.masm).add64(stack_pointer, stack_pointer, signature.stack_bytes);
            self.stack_depth -= signature.stack_bytes;
        }
        self.check_size()
    }

    pub(super) fn lower_stack(&mut self, bytes: u32) {
        let stack_pointer = abi::STACK_POINTER;
        if bytes > UNCHECKED_STACK_EXTENSION {
            let overflow = self.trap_label(Trap::StackOverflow);
            let limit = Address::new(INSTANCE, InstanceLayout::stack_limit(self.env.host));
            self.masm.push(TARGET);
            self.masm.sub64(TARGET, stack_pointer, bytes);
            self.masm.branch64(Cond::Lt, TARGET, limit, overflow);
            self.masm.pop(TARGET);
        }
        if bytes != 0 {
            self.masm.sub64(stack_pointer, stack_pointer, bytes);
            self.stack_depth += bytes;
        }
    }

    fn slot_address(&self, code: CodeIndex) -> usize {
        self.env.slots + code.usize() * FunctionSlot::SIZE
    }

    fn profile_address(&self, site: u32) -> Option<usize> {
        Some(self.counters?.call_profiles + site as usize * CallProfile::SIZE)
    }

    /// Returns the index of a function of this module.
    fn find_function(&mut self, func: FuncIndex, site: u32, leaves: Leaves) -> Option<CodeIndex> {
        let count = self
            .profile_address(site)
            .map(|profile| profile + CallProfile::COUNT as usize);
        let Some(code) = self.module.code_index(func) else {
            if let Some(count) = count {
                self.masm.add32_to_memory(Absolute(count), 1);
            }
            self.enter_instance(Address::new(INSTANCE, self.env.layout.import(func)), None);
            return None;
        };
        let slot = self.slot_address(code);
        if count.is_some() || leaves == Leaves::Yes {
            self.masm.move64(SLOT, slot);
        }
        if let Some(count) = count {
            match i32::try_from(count.wrapping_sub(slot) as isize) {
                Ok(distance) => self.masm.add32_to_memory(Address::new(SLOT, distance), 1),
                Err(_) => self.masm.add32_to_memory(Absolute(count), 1),
            }
        }
        Some(code)
    }

    fn call_directly(&mut self, callee: CodeIndex) {
        let entry = self.masm.new_label();
        let end = self.masm.patchable_call(entry);
        self.direct_calls.push((end, callee));
        let slot = self.slot_address(callee);
        self.cold.push(Cold::JumpThroughSlot { entry, slot });
    }

    /// Turns the index in `TARGET` into the address of the element.
    fn find_element(&mut self, ty: TypeIndex, table: TableIndex) {
        let view = Address::new(INSTANCE, self.env.layout.table(table));
        let out_of_bounds = self.trap_label(Trap::IndirectCallOutOfBounds);
        let length = view.plus(TableView::LENGTH);
        (self.masm).branch64(Cond::AboveEq, TARGET, length, out_of_bounds);
        self.masm.shl64(TARGET, TARGET, FunctionElement::SIZE_LOG2);
        (self.masm).add64(TARGET, TARGET, view.plus(TableView::ELEMENTS));

        let mismatch = self.trap_label(Trap::SignatureMismatch);
        let rtt = Address::new(TARGET, Callable::RTT);
        match RttCheck::new(self.module.types(), ty) {
            RttCheck::Is { expected } => self.masm.branch64(Cond::Ne, rtt, expected, mismatch),
            check => {
                self.masm.load64(SLOT, rtt);
                self.masm.branch_if_zero64(SLOT, mismatch);
                self.check_rtt(check, SLOT, mismatch);
            }
        }
    }

    /// `site` is that of a call that may reach any function.
    fn enter_instance(&mut self, callable: Address, site: Option<u32>) {
        self.masm.load64(SLOT, callable.plus(Callable::SLOT));
        if let Some(profile) = site.and_then(|site| self.profile_address(site)) {
            let (entry, resume) = (self.masm.new_label(), self.masm.new_label());
            self.masm.move64(PROFILE, profile);
            (self.masm).add32_to_memory(Address::new(PROFILE, CallProfile::COUNT), 1);
            let first = Address::new(PROFILE, CallProfile::SLOT);
            self.masm.branch64(Cond::Ne, first, SLOT, entry);
            self.masm.bind(resume);
            self.cold.push(Cold::NoteOtherCallee { entry, resume });
        }
        (self.masm).load64(INSTANCE, callable.plus(Callable::INSTANCE));
        let base = Address::new(INSTANCE, InstanceLayout::memory_base(self.env.host));
        self.masm.load64(MEMORY_BASE, base);
    }

    fn overwritten_by_operations(&self) -> RegisterSet {
        if self.uses_simd {
            abi::CALLER_SAVED | abi::CALLEE_SAVED_LOW_HALF
        } else {
            abi::CALLER_SAVED
        }
    }

    /// The result is in the first of [`RESULT_GPRS`], which is free.
    pub(super) fn call_operation(&mut self, operation: Operation, parameters: &[Parameter]) {
        let overwritten = self.overwritten_by_operations();
        self.write_back_all(self.registers.dirty & overwritten);
        self.spill_below(overwritten, self.height());
        self.add_move(
            ARGUMENT_GPRS[0],
            Operand::in_register(ValType::I64, INSTANCE),
        );
        for (&reg, &parameter) in ARGUMENT_GPRS[1..].iter().zip(parameters) {
            match parameter {
                Parameter::Immediate(bits) => {
                    self.add_move(reg, Operand::of_bits(ValType::I64, bits));
                }
                Parameter::Value(value) => self.add_move(reg, value),
                Parameter::Address(_) => {}
            }
        }
        self.emit_moves();
        for (&reg, &parameter) in ARGUMENT_GPRS[1..].iter().zip(parameters) {
            if let Parameter::Address(address) = parameter {
                self.masm.compute_address(reg, address);
            }
        }
        self.unbind_all(self.registers.cached & overwritten);
        self.registers.locked = RegisterSet::EMPTY;
        (self.masm).call_address(self.env.stubs.operations[operation as usize]);
    }

    pub(super) fn push_operation_result(&mut self, ty: ValType) {
        self.push_register(ty, RESULT_GPRS[0]);
    }

    /// The low and the high half of the bits of the value at the top of the stack.
    pub(super) fn pop_bits(&mut self) -> [Parameter; 2] {
        let value = self.pop();
        let nothing = Parameter::Immediate(0);
        let int = match value.kind() {
            ValKind::I32 | ValKind::I64 | ValKind::Ref => {
                return [Parameter::Value(value), nothing];
            }
            ValKind::F32 => ValType::I32,
            ValKind::F64 | ValKind::V128 => ValType::I64,
        };
        if let Some(bits) = value.constant() {
            return [Parameter::Immediate(bits), nothing];
        }
        let offset = self.frame.operand(self.height());
        if !matches!(value.place(), operand::Place::Slot(_)) {
            self.store_operand(self.frame_address(offset), value);
        }
        let half = |offset| Parameter::Value(Operand::in_slot(int, offset));
        match value.kind() {
            ValKind::V128 => [half(offset), half(offset + 8)],
            _ => [half(offset), nothing],
        }
    }

    /// Calls an operation on a path that is rarely taken, which keeps all registers but `result`.
    pub(super) fn call_operation_at(
        &mut self,
        entry: Label,
        operation: Operation,
        given: &[Argument],
        result: Option<Gpr>,
    ) {
        let mut arguments = [Argument::Imm(0); 2];
        arguments[..given.len()].copy_from_slice(given);
        let used = self.registers.allocatable - self.registers.free;
        let mut live = used & self.overwritten_by_operations();
        if let Some(result) = result {
            live.remove(Reg::from(result));
        }
        let resume = self.masm.here();
        self.cold.push(Cold::Operation {
            entry,
            resume,
            operation,
            arguments,
            result,
            live,
        });
    }
}
