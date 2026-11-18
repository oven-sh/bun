//! Linear memory.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{AtomicOp, Bank};
use bun_engine_wasm_format::limits::MAX_MEMORY32_PAGES;
use bun_engine_wasm_format::{
    DataIndex, ElemIndex, LoadOp, MemArg, MemoryIndex, StoreOp, TableIndex, ValKind, ValType,
    VisitMemory,
};

use super::calls::Parameter;
use super::operand::{Operand, bank};
use super::{Compiled, Function};
use crate::abi::{
    GUARD_SIZE, INSTANCE, MEMORY_BASE, MemoryMode, MemoryView, Operation, PAGE_SIZE_LOG2, Trap,
};
use crate::output::Environment;

const MEMORY_LENGTH: Gpr = abi::NOT_CELL_MASK;
const MAX_MEMORY32_BYTES: u64 = MAX_MEMORY32_PAGES << PAGE_SIZE_LOG2;

/// What is kept in registers for memory 0.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FirstMemory {
    None,
    Guarded,
    Checked,
    /// Other threads change the length.
    CheckedAndShared,
}

impl FirstMemory {
    pub(super) fn new(env: &Environment<'_>) -> Self {
        match (env.module.memories().first(), env.mode) {
            (None, _) => Self::None,
            (Some(memory), MemoryMode::Guarded) if memory.address == Width::W32 => Self::Guarded,
            (Some(memory), _) if memory.shared => Self::CheckedAndShared,
            (Some(_), _) => Self::Checked,
        }
    }

    pub(super) fn registers(self) -> RegisterSet {
        match self {
            Self::None => RegisterSet::EMPTY,
            Self::Guarded | Self::CheckedAndShared => RegisterSet::of(&[MEMORY_BASE], &[]),
            Self::Checked => RegisterSet::of(&[MEMORY_BASE, MEMORY_LENGTH], &[]),
        }
    }
}

impl Function<'_> {
    fn memory_view(&self, memory: MemoryIndex) -> Address {
        Address::new(INSTANCE, self.env.layout.memory(memory))
    }

    /// After a call that may have been to another instance.
    pub(super) fn load_guarded_memory(&mut self) {
        if self.first_memory == FirstMemory::Guarded {
            let view = self.memory_view(MemoryIndex(0));
            self.masm.load64(MEMORY_BASE, view.plus(MemoryView::BASE));
        }
    }

    /// At every entry and after every call.
    #[inline]
    pub(super) fn load_checked_memory(&mut self) {
        const { assert!(MemoryView::LENGTH == MemoryView::BASE + 8) };
        match self.first_memory {
            FirstMemory::None | FirstMemory::Guarded => {}
            FirstMemory::Checked => {
                let base = self.memory_view(MemoryIndex(0)).plus(MemoryView::BASE);
                self.masm.load_pair64(MEMORY_BASE, MEMORY_LENGTH, base);
            }
            FirstMemory::CheckedAndShared => {
                let base = self.memory_view(MemoryIndex(0)).plus(MemoryView::BASE);
                self.masm.load64(MEMORY_BASE, base);
            }
        }
    }

    /// The offset of what follows the number at `start`.
    fn after_number(&self, start: usize) -> usize {
        let more = self.bytes[start..].iter().take_while(|&&byte| byte >= 0x80);
        start + more.count() + 1
    }

    #[inline(always)]
    pub(super) fn after_prefixed_opcode(&self) -> usize {
        self.after_number(self.offset + 1)
    }

    /// The offset of what follows the immediate at `start`, or of something that nothing looks for.
    #[inline(always)]
    pub(super) fn after_mem_arg(&self, start: usize) -> usize {
        const NAMES_MEMORY: u8 = 0x40;
        match self.bytes.get(start..start + 2) {
            Some([0..NAMES_MEMORY, 0..0x80]) => start + 2,
            Some([0..NAMES_MEMORY, _]) => self.after_number(start + 1),
            _ => self.offset,
        }
    }

    /// Where `bytes` are accessed. `None` if that cannot be, and control does not go on.
    #[inline(always)]
    pub(super) fn access(&mut self, arg: MemArg, bytes: u8, index: Operand) -> Option<Address> {
        if self.first_memory == FirstMemory::Guarded
            && arg.memory.0 == 0
            && arg.offset <= GUARD_SIZE - u64::from(bytes)
            && index.constant().is_none()
        {
            let (index, offset) = (self.gpr(index), arg.offset as i32);
            return Some(Address::indexed(MEMORY_BASE, index, Scale::One, offset));
        }
        self.check_access(arg, bytes, index)
    }

    #[inline(never)]
    fn check_access(&mut self, arg: MemArg, bytes: u8, index: Operand) -> Option<Address> {
        let memory = self.module.memory(arg.memory);
        let constant = index.constant();
        let greatest = match memory.address {
            Width::W32 => MAX_MEMORY32_BYTES - 1,
            Width::W64 => u64::MAX,
        };
        // From the index, or from the base if the index is known.
        let last = (arg.offset.checked_add(constant.unwrap_or(0)))
            .and_then(|first| first.checked_add(u64::from(bytes) - 1))
            .filter(|&last| last <= greatest);
        let Some(last) = last else {
            self.trap(Trap::MemoryOutOfBounds);
            return None;
        };
        let first = last - (u64::from(bytes) - 1);
        let is_guarded = arg.memory.0 == 0 && self.first_memory == FirstMemory::Guarded;
        let near = i32::try_from(last).is_ok().then_some(first as i32);

        if constant.is_some() {
            let needs_check = !is_guarded && last >> PAGE_SIZE_LOG2 >= memory.pages.initial;
            if let (Some(offset), false) = (near, needs_check) {
                return Some(Address::new(self.memory_base(arg.memory), offset));
            }
            let end = self.take_gpr();
            self.masm.move64(end, Untrusted(last));
            if needs_check {
                self.check_bounds(arg.memory, end);
            }
            let base = self.memory_base(arg.memory);
            return Some(Address::indexed(
                base,
                end,
                Scale::One,
                1 - i32::from(bytes),
            ));
        }

        let index = self.gpr(index);
        let end = if last == 0 { index } else { self.take_gpr() };
        if last != 0 && memory.address == Width::W64 {
            let trap = self.trap_label(Trap::MemoryOutOfBounds);
            (self.masm).branch_add64(ResultCond::Carry, end, index, Untrusted(last), trap);
        } else if last != 0 {
            self.masm.add64(end, index, Untrusted(last));
        }
        if is_guarded {
            let trap = self.trap_label(Trap::MemoryOutOfBounds);
            (self.masm).branch64(Cond::AboveEq, end, MAX_MEMORY32_BYTES, trap);
        } else {
            self.check_bounds(arg.memory, end);
        }
        let base = self.memory_base(arg.memory);
        Some(match near {
            Some(offset) => {
                if last != 0 {
                    self.registers.locked.remove(end);
                }
                Address::indexed(base, index, Scale::One, offset)
            }
            None => Address::indexed(base, end, Scale::One, 1 - i32::from(bytes)),
        })
    }

    fn memory_base(&mut self, memory: MemoryIndex) -> Gpr {
        if memory.0 == 0 {
            return MEMORY_BASE;
        }
        let base = self.take_gpr();
        (self.masm).load64(base, self.memory_view(memory).plus(MemoryView::BASE));
        base
    }

    /// `last` has the position of the last byte.
    fn check_bounds(&mut self, memory: MemoryIndex, last: Gpr) {
        let trap = self.trap_label(Trap::MemoryOutOfBounds);
        if memory.0 == 0 && self.first_memory == FirstMemory::Checked {
            self.masm.branch64(Cond::AboveEq, last, MEMORY_LENGTH, trap);
        } else if self.module.memory(memory).shared {
            let length = self.take_gpr();
            self.load_memory_length(length, memory);
            self.masm.branch64(Cond::AboveEq, last, length, trap);
            self.registers.locked.remove(length);
        } else {
            let length = self.memory_view(memory).plus(MemoryView::LENGTH);
            self.masm.branch64(Cond::AboveEq, last, length, trap);
        }
    }

    fn load_memory_length(&mut self, dst: Gpr, memory: MemoryIndex) {
        let view = self.memory_view(memory);
        if self.module.memory(memory).shared {
            self.masm.load64(dst, view.plus(MemoryView::SHARED_LENGTH));
            (self.masm).atomic_load(Size::S64, dst, Address::new(dst, 0));
        } else {
            self.masm.load64(dst, view.plus(MemoryView::LENGTH));
        }
    }

    /// For an operation that takes its operands in the order of the stack.
    pub(super) fn call_with_operands<const IMMEDIATES: usize, const OPERANDS: usize>(
        &mut self,
        operation: Operation,
        immediates: [u64; IMMEDIATES],
    ) {
        let mut parameters = [Parameter::Immediate(0); 5];
        for (parameter, immediate) in parameters.iter_mut().zip(immediates) {
            *parameter = Parameter::Immediate(immediate);
        }
        let count = IMMEDIATES + OPERANDS;
        for parameter in parameters[IMMEDIATES..count].iter_mut().rev() {
            *parameter = Parameter::Value(self.pop());
        }
        self.call_operation(operation, &parameters[..count]);
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitMemory for Function<'_> {
    #[inline(never)]
    fn load(&mut self, op: LoadOp, arg: MemArg) -> Compiled {
        let index = self.pop();
        let Some(address) = self.access(arg, op.size().bytes(), index) else {
            return Ok(());
        };
        let (ty, next) = (op.value_type(), self.after_mem_arg(self.offset + 1));
        let dst = match (bank(ty.kind()), address.index()) {
            (Bank::Gpr, Some((index, _))) => self.result_reusing(next, index),
            (bank, _) => self.result(next, bank),
        };
        match (ty.kind(), op.sign()) {
            (ValKind::F32, _) => self.masm.load_f32(dst.fpr(), address),
            (ValKind::F64, _) => self.masm.load_f64(dst.fpr(), address),
            (_, Sign::Unsigned) => self.masm.load(op.size(), dst.gpr(), address),
            (ValKind::I32, Sign::Signed) => {
                (self.masm).load_signed(op.size(), Width::W32, dst.gpr(), address);
            }
            (_, Sign::Signed) => {
                (self.masm).load_signed(op.size(), Width::W64, dst.gpr(), address);
            }
        }
        self.push_register(ty, dst);
        Ok(())
    }

    #[inline(never)]
    fn store(&mut self, op: StoreOp, arg: MemArg) -> Compiled {
        let (value, index) = (self.pop(), self.pop());
        if let Some(bits) = value.constant() {
            if let Some(address) = self.access(arg, op.size().bytes(), index) {
                self.masm.store(op.size(), address, Untrusted(bits));
            }
            return Ok(());
        }
        let src = self.register(value);
        let Some(address) = self.access(arg, op.size().bytes(), index) else {
            return Ok(());
        };
        match op {
            StoreOp::F32Store => self.masm.store_f32(address, src.fpr()),
            StoreOp::F64Store => self.masm.store_f64(address, src.fpr()),
            _ => self.masm.store(op.size(), address, src.gpr()),
        }
        Ok(())
    }

    #[inline(never)]
    fn memory_size(&mut self, memory: MemoryIndex) -> Compiled {
        let dst = self.take_gpr();
        self.load_memory_length(dst, memory);
        self.masm.shr64(dst, dst, PAGE_SIZE_LOG2);
        self.push_register(ValType::int(self.module.memory(memory).address), dst);
        Ok(())
    }

    #[inline(never)]
    fn memory_grow(&mut self, memory: MemoryIndex) -> Compiled {
        self.call_with_operands::<1, 1>(Operation::MemoryGrow, [memory.0.into()]);
        self.load_checked_memory();
        self.push_operation_result(ValType::int(self.module.memory(memory).address));
        Ok(())
    }

    fn memory_fill(&mut self, memory: MemoryIndex) -> Compiled {
        self.call_with_operands::<1, 3>(Operation::MemoryFill, [memory.0.into()]);
        Ok(())
    }

    fn memory_copy(&mut self, dst: MemoryIndex, src: MemoryIndex) -> Compiled {
        self.call_with_operands::<2, 3>(Operation::MemoryCopy, [dst.0.into(), src.0.into()]);
        Ok(())
    }

    fn memory_init(&mut self, memory: MemoryIndex, data: DataIndex) -> Compiled {
        self.call_with_operands::<2, 3>(Operation::MemoryInit, [memory.0.into(), data.0.into()]);
        Ok(())
    }

    fn data_drop(&mut self, data: DataIndex) -> Compiled {
        self.call_with_operands::<1, 0>(Operation::DataDrop, [data.0.into()]);
        Ok(())
    }

    fn atomic_load(&mut self, width: Width, size: Size, arg: MemArg) -> Compiled {
        self.load_atomically(width, size, arg);
        Ok(())
    }

    fn atomic_store(&mut self, _: Width, size: Size, arg: MemArg) -> Compiled {
        self.store_atomically(size, arg);
        Ok(())
    }

    fn atomic_update(&mut self, op: AtomicOp, width: Width, size: Size, arg: MemArg) -> Compiled {
        self.update_atomically(op, width, size, arg);
        Ok(())
    }

    fn atomic_compare_exchange(&mut self, width: Width, size: Size, arg: MemArg) -> Compiled {
        self.compare_and_exchange(width, size, arg);
        Ok(())
    }

    fn atomic_wait(&mut self, width: Width, arg: MemArg) -> Compiled {
        let operation = match width {
            Width::W32 => Operation::AtomicWait32,
            Width::W64 => Operation::AtomicWait64,
        };
        self.call_with_operands::<2, 3>(operation, [arg.memory.0.into(), arg.offset]);
        self.push_operation_result(ValType::I32);
        Ok(())
    }

    fn atomic_notify(&mut self, arg: MemArg) -> Compiled {
        let immediates = [arg.memory.0.into(), arg.offset];
        self.call_with_operands::<2, 2>(Operation::AtomicNotify, immediates);
        self.push_operation_result(ValType::I32);
        Ok(())
    }

    fn atomic_fence(&mut self) -> Compiled {
        self.masm.memory_fence();
        Ok(())
    }

    fn table_get(&mut self, table: TableIndex) -> Compiled {
        self.get_element(table);
        Ok(())
    }

    fn table_set(&mut self, table: TableIndex) -> Compiled {
        self.call_with_operands::<1, 2>(Operation::TableSet, [table.0.into()]);
        Ok(())
    }

    fn table_size(&mut self, table: TableIndex) -> Compiled {
        self.push_table_size(table);
        Ok(())
    }

    fn table_grow(&mut self, table: TableIndex) -> Compiled {
        self.call_with_operands::<1, 2>(Operation::TableGrow, [table.0.into()]);
        self.push_operation_result(ValType::int(self.module.table(table).address));
        Ok(())
    }

    fn table_fill(&mut self, table: TableIndex) -> Compiled {
        self.call_with_operands::<1, 3>(Operation::TableFill, [table.0.into()]);
        Ok(())
    }

    fn table_copy(&mut self, dst: TableIndex, src: TableIndex) -> Compiled {
        self.call_with_operands::<2, 3>(Operation::TableCopy, [dst.0.into(), src.0.into()]);
        Ok(())
    }

    fn table_init(&mut self, table: TableIndex, elem: ElemIndex) -> Compiled {
        self.call_with_operands::<2, 3>(Operation::TableInit, [table.0.into(), elem.0.into()]);
        Ok(())
    }

    fn elem_drop(&mut self, elem: ElemIndex) -> Compiled {
        self.call_with_operands::<1, 0>(Operation::ElemDrop, [elem.0.into()]);
        Ok(())
    }
}
