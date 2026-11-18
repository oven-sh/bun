//! The entry of a function.

use bun_engine_asm::Bank;
use bun_engine_asm::prelude::*;

use super::Function;
use super::cold::Cold;
use super::operand::{Operand, bank};
use super::registers::{Local, Registers};
use crate::abi::{
    ARGUMENT_FPRS, FunctionSlot, INSTANCE, InstanceLayout, NULL, Place, SLOT, UNCHECKED_FRAME_SIZE,
    UNCHECKED_STACK_EXTENSION, callee_word, frame,
};

const TEMP: Gpr = abi::NON_ARGUMENT_GPRS[1];
const ZERO: Fpr = Fpr::new(ARGUMENT_FPRS.len() as u8);
const MOST_BYTES_FILLED_IN_LINE: i32 = 256;

impl Function<'_> {
    pub(super) fn emit_prologue(&mut self) {
        if self.loop_entry.is_none() {
            self.masm.bind(self.entry);
        }
        self.masm.enter_frame();
        let header = Address::new(abi::FRAME_POINTER, frame::INSTANCE);
        let callee = callee_word(self.body.func_index());
        if cfg!(target_arch = "aarch64") {
            self.masm.move32(TEMP, callee);
            self.masm.store_pair64(header, INSTANCE, TEMP);
        } else {
            self.masm.store64(header, INSTANCE);
            self.masm.store64(header.plus(8), callee);
        }
        self.make_frame();
        if let Some(counters) = self.counters {
            let entry = self.masm.new_label();
            let countdown = Address::new(SLOT, FunctionSlot::COUNTDOWN);
            let (cond, increment) = (ResultCond::NonNegative, counters.entry_increment);
            (self.masm).branch_add32_to_memory(cond, countdown, increment, entry);
            let resume = self.masm.here();
            self.cold.push(Cold::TierUpAtEntry { entry, resume });
        }
        self.load_checked_memory();

        self.loops.start(&self.body);
        self.keeps_all_locals = self.body.facts().call_count == 0 && self.can_keep_all_locals();
        if !self.keeps_all_locals {
            self.initialize_locals_in_frame();
        }
        self.take_parameters();
        if self.keeps_all_locals {
            self.initialize_locals_in_registers();
        }
    }

    fn make_frame(&mut self) {
        let (size, stack_pointer) = (self.frame.size(), abi::STACK_POINTER);
        if size <= UNCHECKED_FRAME_SIZE && self.body.facts().call_count == 0 {
            return self.masm.sub64(stack_pointer, stack_pointer, size);
        }
        let entry = self.masm.new_label();
        let limit = Address::new(INSTANCE, InstanceLayout::entry_limit(self.env.host));
        let bottom = match size <= UNCHECKED_STACK_EXTENSION {
            true => stack_pointer,
            false => TEMP,
        };
        self.masm.sub64(bottom, stack_pointer, size);
        self.masm.branch64(Cond::Lt, bottom, limit, entry);
        let resume = self.masm.here();
        self.cold.push(Cold::CheckEntry { entry, resume });
        self.masm.move64(stack_pointer, bottom);
    }

    fn can_keep_all_locals(&self) -> bool {
        let mut left = [self.pin_limit(Bank::Gpr), self.pin_limit(Bank::Fpr)];
        self.locals.iter().all(|local| {
            let left = &mut left[bank(local.ty.kind()) as usize];
            left.checked_sub(1).map(|fewer| *left = fewer).is_some()
        })
    }

    fn take_parameters(&mut self) {
        for index in 0..self.signature.params.len() {
            match self.signature.params[index] {
                Place::Register(reg) => {
                    self.bind(index as u32, reg);
                    self.registers.dirty.insert(reg);
                }
                Place::Stack(given) => {
                    let Local { ty, offset, .. } = self.locals[index];
                    if offset != given {
                        let (dst, src) = (self.frame_address(offset), self.frame_address(given));
                        self.transfer(ty.kind(), dst, src);
                    }
                }
            }
        }
    }

    fn initialize_locals_in_registers(&mut self) {
        for index in 0..self.locals.len() {
            let local = self.locals[index];
            if self.register_of(index as u32).is_some() {
                continue;
            }
            let mut vacant = self.registers.free.in_bank(bank(local.ty.kind()));
            vacant.remove(SLOT);
            let reg = Registers::best_for_local(vacant).expect("there are few locals");
            let value = if index < self.signature.params.len() {
                Operand::in_slot(local.ty, local.offset)
            } else if local.ty.is_ref() {
                Operand::of_bits(local.ty, NULL as u64)
            } else {
                Operand::of_bits(local.ty, 0)
            };
            self.move_operand(reg, value);
            self.bind(index as u32, reg);
            self.registers.dirty.insert(reg);
        }
        self.registers.pinned = self.registers.cached;
        self.registers.unsaved = self.registers.cached;
        self.loops.keep_all(self.locals.len() as u32);
    }

    fn initialize_locals_in_frame(&mut self) {
        let mut next = self.signature.params.len();
        if next == self.locals.len() {
            return;
        }
        let range = self.frame.declared_locals();
        self.masm.move_vector_constant(ZERO, 0);
        self.fill(
            range.start,
            range.end,
            32,
            |masm, address, size| match size {
                16 => masm.store_vector(address, ZERO),
                _ => masm.store_pair_vector(address, ZERO, ZERO),
            },
        );
        for (count, ty) in self.body.local_groups() {
            if ty.is_ref() && count != 0 {
                let start = self.locals[next + count as usize - 1].offset;
                self.fill(start, start + count as i32 * 8, 8, |masm, address, _| {
                    masm.store64(address, NULL);
                });
            }
            next += count as usize;
        }
    }

    /// Calls `store` for pieces of `step` bytes, of which one may be shorter.
    fn fill(
        &mut self,
        mut start: i32,
        end: i32,
        step: i32,
        store: impl Fn(&mut MacroAssembler, Address, i32),
    ) {
        let rest = (end - start) % step;
        if rest != 0 {
            let address = self.frame_address(start);
            store(&mut self.masm, address, rest);
            start += rest;
        }
        if end - start <= MOST_BYTES_FILLED_IN_LINE {
            for offset in (start..end).step_by(step as usize) {
                let address = self.frame_address(offset);
                store(&mut self.masm, address, step);
            }
            return;
        }
        (self.masm).compute_address(TEMP, Address::new(abi::FRAME_POINTER, start));
        (self.masm).compute_address(SLOT, Address::new(abi::FRAME_POINTER, end));
        let again = self.masm.here();
        store(&mut self.masm, Address::new(TEMP, 0), step);
        self.masm.add64(TEMP, TEMP, step);
        self.masm.branch64(Cond::Ne, TEMP, SLOT, again);
    }
}
