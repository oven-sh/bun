//! Atomic accesses to linear memory.

use bun_engine_asm::AtomicOp;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{MemArg, ValType};

use super::Function;
use super::operand::{Operand, Place};
use crate::abi::Trap;

const OVERWRITTEN: RegisterSet = MacroAssembler::ATOMIC_CLOBBERS;

impl Function<'_> {
    fn aligned_access(&mut self, arg: MemArg, size: Size, index: Operand) -> Option<Address> {
        let address = self.access(arg, size.bytes(), index)?;
        let mask = u64::from(size.bytes()) - 1;
        if let Some(index) = index.constant() {
            if index.wrapping_add(arg.offset) & mask != 0 {
                self.trap(Trap::UnalignedAtomic);
                return None;
            }
        } else if mask != 0 {
            let mut low_bits = self.gpr(index);
            if arg.offset & mask != 0 {
                let sum = self.take_gpr();
                self.masm.add32(sum, low_bits, arg.offset & mask);
                self.registers.locked.remove(sum);
                low_bits = sum;
            }
            let trap = self.trap_label(Trap::UnalignedAtomic);
            (self.masm).branch_test32(TestCond::NonZero, low_bits, mask, trap);
        }
        Some(address)
    }

    /// Leaves it where it can be read more than once.
    fn pop_index(&mut self) -> Operand {
        let index = self.pop();
        match index.place() {
            Place::Slot(_) | Place::Sum(..) => {
                Operand::in_register(index.ty(), self.writable(index))
            }
            _ => index,
        }
    }

    pub(super) fn load_atomically(&mut self, width: Width, size: Size, arg: MemArg) {
        let index = self.pop_index();
        if let Some(address) = self.aligned_access(arg, size, index) {
            let dst = self.take_gpr();
            self.masm.atomic_load(size, dst, address);
            self.push_register(ValType::int(width), dst);
        }
    }

    pub(super) fn store_atomically(&mut self, size: Size, arg: MemArg) {
        let value = self.pop_gpr();
        let index = self.pop_index();
        if let Some(address) = self.aligned_access(arg, size, index) {
            self.masm.atomic_store(size, address, value);
        }
    }

    pub(super) fn update_atomically(
        &mut self,
        op: AtomicOp,
        width: Width,
        size: Size,
        arg: MemArg,
    ) {
        self.claim(OVERWRITTEN);
        let operand = self.pop_gpr();
        let index = self.pop_index();
        if let Some(address) = self.aligned_access(arg, size, index) {
            let dst = OVERWRITTEN.gprs().next().unwrap_or_else(|| self.take_gpr());
            let temp = self.take_gpr();
            (self.masm).atomic_update(op, size, dst, address, operand, temp);
            self.push_register(ValType::int(width), dst);
        }
    }

    pub(super) fn compare_and_exchange(&mut self, width: Width, size: Size, arg: MemArg) {
        self.claim(OVERWRITTEN);
        let (replacement, expected) = (self.pop_gpr(), self.pop_gpr());
        let index = self.pop_index();
        if let Some(address) = self.aligned_access(arg, size, index) {
            let dst = OVERWRITTEN.gprs().next().unwrap_or_else(|| self.take_gpr());
            let temp = self.take_gpr();
            (self.masm).atomic_compare_exchange(size, dst, address, expected, replacement, temp);
            self.push_register(ValType::int(width), dst);
        }
    }
}
