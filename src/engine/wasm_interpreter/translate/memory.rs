//! Memories and tables.

use bun_engine_asm::{AtomicOp, Size, Width};
use bun_engine_wasm_format::{
    DataIndex, ElemIndex, LoadOp, MemArg, MemoryIndex, StoreOp, TableIndex, ValKind, ValType,
    VisitMemory,
};

use super::emit::Register;
use super::operands::{Effect, Operand, pair, usual};
use super::{Done, Translator};
use crate::machine::Handler;
use crate::run::memory::{self, Access, Source};
use crate::run::{atomic, operation};

/// See [`Access`].
#[derive(Clone, Copy)]
pub(super) struct Address {
    pub(super) access: Access,
    pub(super) source: Source,
    pub(super) slot: u16,
    pub(super) imm: u32,
    offset: u64,
}

impl Address {
    /// The records after the first.
    pub(super) fn more(&self) -> &[u64] {
        match self.access {
            Access::Any => core::slice::from_ref(&self.offset),
            _ => &[],
        }
    }
}

fn int(width: Width) -> ValKind {
    ValType::int(width).kind()
}

impl Translator<'_> {
    fn view_of(&self, memory: MemoryIndex) -> u32 {
        self.module.layout().memory(memory) as u32
    }

    fn address_in_any_memory(&mut self, arg: MemArg, address: Operand) -> Done<Address> {
        Ok(Address {
            access: Access::Any,
            source: Source::Slot,
            slot: self.in_slot(address, 0)?,
            imm: self.view_of(arg.memory),
            offset: arg.offset,
        })
    }

    /// The source is not `Constant`. Whatever else the instruction needs is in a slot already.
    pub(super) fn address_in_slot(&mut self, arg: MemArg, address: Operand) -> Done<Address> {
        let memory = self.module.memory(arg.memory);
        if arg.memory.0 != 0 || memory.address == Width::W64 {
            return self.address_in_any_memory(arg, address);
        }
        let slot = self.in_slot(address, 0)?;
        Ok(Address {
            access: if memory.shared {
                Access::FirstShared
            } else {
                Access::First
            },
            source: if self.is_last(Register::Int, slot) {
                Source::Last
            } else {
                Source::Slot
            },
            slot,
            imm: arg.offset as u32,
            offset: 0,
        })
    }

    fn address(&mut self, arg: MemArg, address: Operand) -> Done<Address> {
        let memory = self.module.memory(arg.memory);
        let is_first = arg.memory.0 == 0 && memory.address == Width::W32;
        let sum = address.constant().filter(|_| is_first);
        let Some(Ok(imm)) = sum.map(|it| u32::try_from(it + arg.offset)) else {
            return self.address_in_slot(arg, address);
        };
        Ok(Address {
            access: if memory.shared {
                Access::FirstShared
            } else {
                Access::First
            },
            source: Source::Constant,
            slot: 0,
            imm,
            offset: 0,
        })
    }

    pub(super) fn emit_store(&mut self, handler: Handler, address: Address, value: u16) -> Done {
        self.emit(handler, address.slot, value, address.imm)?;
        (address.more().iter()).try_for_each(|&bits| self.extend_wide(bits))
    }

    fn atomic_result(&mut self, width: Width, handler: Handler, arg: MemArg, more: &[u64]) -> Done {
        let address = self.pop();
        let Address { slot, imm, .. } = self.address_in_any_memory(arg, address)?;
        let records = [arg.offset, more.first().copied().unwrap_or(0)];
        self.produce_with(
            usual(int(width)),
            handler,
            slot,
            imm,
            &records[..=more.len()],
        )
    }

    fn pop_as(&mut self, number: u16) -> Done<u16> {
        let operand = self.pop();
        self.in_slot(operand, number)
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitMemory for Translator<'_> {
    fn load(&mut self, op: LoadOp, arg: MemArg) -> Done {
        let address = self.pop();
        let address = self.address(arg, address)?;
        let handler = memory::for_load(op.into(), address.access, address.source);
        let result = usual(op.value_type().kind());
        self.produce_with(result, handler, address.slot, address.imm, address.more())
    }

    fn store(&mut self, op: StoreOp, arg: MemArg) -> Done {
        let (value, address) = (self.pop(), self.pop());
        let unused_bits = 64 - op.size().bits();
        let extended = |bits| ((bits << unused_bits) as i64) >> unused_bits;
        let short = value
            .constant()
            .and_then(|bits| i16::try_from(extended(bits)).ok());
        let address = self.address(arg, address)?;
        let Address { access, source, .. } = address;
        if let (Some(short), true) = (short, access != Access::Any) {
            let handler = memory::for_store(op, access, source, Source::Constant);
            return self.emit_store(handler, address, short as u16);
        }
        let slot = self.in_slot(value, 1)?;
        let handler = if access == Access::Any {
            memory::for_store(op, access, source, Source::Slot)
        } else if self.is_last(Register::Int, slot) {
            memory::for_store(op, access, source, Source::Last)
        } else if self.is_last(Register::of(value.kind), slot) {
            memory::for_store_of_last_float(op, access, source)
        } else {
            memory::for_store(op, access, source, Source::Slot)
        };
        self.emit_store(handler, address, slot)
    }

    fn memory_size(&mut self, index: MemoryIndex) -> Done {
        let kind = int(self.module.memory(index).address);
        self.produce(kind, memory::size, 0, self.view_of(index))
    }

    fn memory_grow(&mut self, memory: MemoryIndex) -> Done {
        let kind = int(self.module.memory(memory).address);
        self.operate(operation::memory_grow, 1, memory.0, None, Some(kind))
    }

    fn memory_fill(&mut self, memory: MemoryIndex) -> Done {
        self.operate(operation::memory_fill, 3, memory.0, None, None)
    }

    fn memory_copy(&mut self, dst: MemoryIndex, src: MemoryIndex) -> Done {
        self.operate(operation::memory_copy, 3, dst.0, Some(index(src.0)), None)
    }

    fn memory_init(&mut self, memory: MemoryIndex, data: DataIndex) -> Done {
        self.operate(
            operation::memory_init,
            3,
            memory.0,
            Some(index(data.0)),
            None,
        )
    }

    fn data_drop(&mut self, data: DataIndex) -> Done {
        self.operate(operation::data_drop, 0, data.0, None, None)
    }

    fn atomic_load(&mut self, width: Width, size: Size, arg: MemArg) -> Done {
        self.atomic_result(width, atomic::for_load(size), arg, &[])
    }

    fn atomic_store(&mut self, _: Width, size: Size, arg: MemArg) -> Done {
        let (value, address) = (self.pop_as(1)?, self.pop());
        let Address { slot, imm, .. } = self.address_in_any_memory(arg, address)?;
        self.emit(atomic::for_store(size), value, slot, imm)?;
        self.extend_wide(arg.offset)
    }

    fn atomic_update(&mut self, op: AtomicOp, width: Width, size: Size, arg: MemArg) -> Done {
        let operand = self.pop_as(1)?;
        self.atomic_result(width, atomic::for_update(size, op), arg, &[operand.into()])
    }

    fn atomic_compare_exchange(&mut self, width: Width, size: Size, arg: MemArg) -> Done {
        let (replacement, expected) = (self.pop_as(2)?, self.pop_as(1)?);
        let operands = pair(expected, replacement).into();
        self.atomic_result(width, atomic::for_compare_exchange(size), arg, &[operands])
    }

    fn atomic_wait(&mut self, width: Width, arg: MemArg) -> Done {
        let handler = match width {
            Width::W32 => operation::atomic_wait32,
            Width::W64 => operation::atomic_wait64,
        };
        self.operate(
            handler,
            3,
            arg.memory.0,
            Some(arg.offset),
            Some(ValKind::I32),
        )
    }

    fn atomic_notify(&mut self, arg: MemArg) -> Done {
        let (memory, offset) = (arg.memory.0, Some(arg.offset));
        self.operate(
            operation::atomic_notify,
            2,
            memory,
            offset,
            Some(ValKind::I32),
        )
    }

    fn atomic_fence(&mut self) -> Done {
        self.emit(atomic::full_fence, 0, 0, 0)
    }

    fn table_get(&mut self, table: TableIndex) -> Done {
        self.operate(operation::table_get, 1, table.0, None, Some(ValKind::Ref))
    }

    fn table_set(&mut self, table: TableIndex) -> Done {
        self.operate(operation::table_set, 2, table.0, None, None)
    }

    fn table_size(&mut self, table: TableIndex) -> Done {
        let result = (int(self.module.table(table).address), Effect::Forgets);
        self.produce_with(result, operation::table_size, 0, table.0, &[])
    }

    fn table_grow(&mut self, table: TableIndex) -> Done {
        let kind = int(self.module.table(table).address);
        self.operate(operation::table_grow, 2, table.0, None, Some(kind))
    }

    fn table_fill(&mut self, table: TableIndex) -> Done {
        self.operate(operation::table_fill, 3, table.0, None, None)
    }

    fn table_copy(&mut self, dst: TableIndex, src: TableIndex) -> Done {
        self.operate(operation::table_copy, 3, dst.0, Some(index(src.0)), None)
    }

    fn table_init(&mut self, table: TableIndex, elem: ElemIndex) -> Done {
        self.operate(operation::table_init, 3, table.0, Some(index(elem.0)), None)
    }

    fn elem_drop(&mut self, elem: ElemIndex) -> Done {
        self.operate(operation::elem_drop, 0, elem.0, None, None)
    }
}

/// A record with it in `imm`.
pub(super) fn index(index: u32) -> u64 {
    u64::from(index) << 32
}
