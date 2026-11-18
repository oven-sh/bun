//! Linear memories and tables.

use bun_engine_asm::{AtomicOp, Sign, Size, Width};
use bun_engine_codegen::ir::{Access, AccessFlags, Heap, Type, Unary, Value};
use bun_engine_wasm_format::limits::{MAX_MEMORY32_PAGES, MAX_TABLE_ENTRIES};
use bun_engine_wasm_format::{
    AbstractHeapType, DataIndex, ElemIndex, LoadOp, MemArg, MemoryIndex, StoreOp, TableIndex,
    ValType, VisitMemory,
};
use smallvec::SmallVec;

use super::translator::{Translator, Visited, ir_type};
use crate::abi::{
    FunctionElement, GUARD_SIZE, MemoryView, Operation, PAGE_SIZE_LOG2, TableView, Trap,
};

/// The longest copy or fill that is done without a call.
const MAX_BYTES_IN_LINE: u64 = 64;
const REFERENCE_SIZE_LOG2: u8 = 3;

/// The operands of an access to linear memory.
#[derive(Clone, Copy)]
pub(super) struct Location {
    pub(super) address: Value,
    pub(super) offset: i32,
    heap: Heap,
    /// Whether the address may be out of bounds.
    traps: bool,
    /// Whether it is within bounds no matter how control gets here.
    is_always_valid: bool,
}

impl Location {
    pub(super) fn for_store(self) -> Access {
        let mut flags = AccessFlags::empty();
        flags.set(AccessFlags::TRAPS, self.traps);
        Access::new(self.heap, flags)
    }

    pub(super) fn for_load(self) -> Access {
        let mut flags = self.for_store().flags();
        flags.set(AccessFlags::ALWAYS_READABLE, self.is_always_valid);
        Access::new(self.heap, flags)
    }

    fn for_atomic(self) -> Access {
        Access::new(self.heap, self.for_store().flags() | AccessFlags::ATOMIC)
    }
}

/// Offsets and sizes of accesses that cover `count` bytes. The last may overlap the one before.
fn pieces(count: u64) -> impl Iterator<Item = (i32, u32)> {
    let size = 1u64 << count.min(16).ilog2();
    let starts = (0..count.div_ceil(size)).map(move |index| (index * size).min(count - size));
    starts.map(move |start| (start as i32, size as u32))
}

impl Translator<'_> {
    fn is_guarded(&self, memory: MemoryIndex) -> bool {
        memory.0 == 0 && !self.memory_base.is_none()
    }

    fn base_of(&mut self, memory: MemoryIndex) -> Value {
        if self.is_guarded(memory) {
            return self.memory_base;
        }
        let offset = self.env.layout.memory(memory) + MemoryView::BASE;
        if self.module.memory(memory).shared {
            return self.load_fixed(Type::I64, self.instance, offset);
        }
        self.load_readable(Type::I64, self.instance, offset, self.named.memory_views)
    }

    /// In bytes.
    fn length_of(&mut self, memory: MemoryIndex) -> Value {
        let (data, view) = (self.module.memory(memory), self.env.layout.memory(memory));
        let pages = data.pages.initial;
        if data.pages.maximum == Some(pages) && pages <= MAX_MEMORY32_PAGES {
            return self.b.const64((pages << PAGE_SIZE_LOG2) as i64);
        }
        if data.shared {
            // What another thread's grow leaves, as in the other tier: the read is ordered and stays where it is.
            let address =
                self.load_fixed(Type::I64, self.instance, view + MemoryView::SHARED_LENGTH);
            let access = Access::new(self.named.memory_views, AccessFlags::ATOMIC);
            return self.b.load(Type::I64, address, 0, access);
        }
        let offset = view + MemoryView::LENGTH;
        self.load_readable(Type::I64, self.instance, offset, self.named.memory_views)
    }

    fn least_length_of(&self, memory: MemoryIndex) -> u64 {
        let pages = self.module.memory(memory).pages.initial;
        pages.min(MAX_MEMORY32_PAGES) << PAGE_SIZE_LOG2
    }

    /// `index` has 64 bits. `end` is the distance from it to the end of the access, which is not empty.
    fn check_bounds(&mut self, memory: MemoryIndex, index: Value, end: u64) {
        let length = self.length_of(memory);
        if self.module.memory(memory).address == Width::W32 {
            let last = self.b.add(index, end - 1);
            let is_outside = self.b.above_or_equal(last, length);
            return self.trap_if(is_outside, Trap::MemoryOutOfBounds);
        }
        if end > self.least_length_of(memory) {
            let is_short = self.b.below(length, end);
            self.trap_if(is_short, Trap::MemoryOutOfBounds);
        }
        let greatest = self.b.sub(length, end);
        let is_outside = self.b.above(index, greatest);
        self.trap_if(is_outside, Trap::MemoryOutOfBounds);
    }

    fn locate_range(&mut self, index: Value, arg: MemArg, size: u64) -> Location {
        let MemArg { mut offset, memory } = arg;
        let mut index = self.widen(index);
        if let Some(sum) = (self.b.constant_bits(index)).and_then(|start| start.checked_add(offset))
        {
            (index, offset) = (self.b.const64(0), sum);
        }
        let end = offset.saturating_add(size);
        let is_always_valid =
            self.b.is_int_constant(index, 0) && end <= self.least_length_of(memory);
        let traps = !is_always_valid && self.is_guarded(memory) && end <= GUARD_SIZE;
        if !is_always_valid && !traps {
            self.check_bounds(memory, index, end);
        }
        let base = self.base_of(memory);
        let mut address = self.b.add(base, index);
        let offset = i32::try_from(end).map_or_else(
            |_| {
                address = self.b.add(address, offset);
                0
            },
            |_| offset as i32,
        );
        Location {
            address,
            offset,
            heap: (self.heaps).memory(self.b.function, &self.named, self.module, memory),
            traps,
            is_always_valid,
        }
    }

    #[inline]
    pub(super) fn locate(&mut self, index: Value, arg: MemArg, log2_size: u8) -> Location {
        self.locate_range(index, arg, 1 << log2_size)
    }

    /// With an offset of zero.
    fn locate_aligned(&mut self, index: Value, arg: MemArg, size: Size) -> Location {
        let mut location = self.locate(index, arg, size.log2_bytes());
        let mask = u64::from(size.bytes() - 1);
        if mask != 0 {
            let start = self.b.add(index, arg.offset & mask);
            let excess = self.b.and(start, mask);
            self.trap_if(excess, Trap::UnalignedAtomic);
        }
        location.address = self.b.add(location.address, location.offset);
        location.offset = 0;
        location
    }

    fn load_int(&mut self, to: Width, size: Size, sign: Sign, at: Location, how: Access) -> Value {
        let loaded = if size < Size::S32 {
            self.b.load_narrow(size, sign, at.address, at.offset, how)
        } else {
            self.b.load(size.width().into(), at.address, at.offset, how)
        };
        if to == size.width() {
            loaded
        } else {
            self.b.convert(Unary::Widen(sign), Type::I64, loaded)
        }
    }

    /// If it is a constant that is small enough.
    fn count_in_line(&self) -> Option<u64> {
        let count = self.stack.last().expect("the code was validated").value;
        (self.b.constant_bits(count)).filter(|count| (1..=MAX_BYTES_IN_LINE).contains(count))
    }

    /// Nothing is written unless all can be.
    fn locate_destination(&mut self, index: Value, memory: MemoryIndex, count: u64) -> Location {
        let mut to = self.locate_range(index, MemArg { offset: 0, memory }, count);
        if to.traps {
            let last = to.offset + count as i32 - 1;
            (self.b).load_narrow(Size::S8, Sign::Unsigned, to.address, last, to.for_load());
            to.traps = false;
        }
        to
    }

    fn store_piece(&mut self, value: Value, to: Location, (offset, size): (i32, u32)) {
        let (offset, access) = (to.offset + offset, to.for_store());
        match size {
            1 => (self.b).store_sized(Size::S8, value, to.address, offset, access),
            2 => (self.b).store_sized(Size::S16, value, to.address, offset, access),
            4 => (self.b).store_sized(Size::S32, value, to.address, offset, access),
            _ => self.b.store(value, to.address, offset, access),
        }
    }

    fn copy_in_line(&mut self, dst: MemoryIndex, src: MemoryIndex, count: u64) {
        let [to, from, _] = self.pop_values();
        let to = self.locate_destination(to, dst, count);
        let (offset, memory) = (0, src);
        let from = self.locate_range(from, MemArg { offset, memory }, count);
        let load = |(offset, size): (i32, u32)| {
            let (address, offset, access) = (from.address, from.offset + offset, from.for_load());
            match size {
                1 => (self.b).load_narrow(Size::S8, Sign::Unsigned, address, offset, access),
                2 => (self.b).load_narrow(Size::S16, Sign::Unsigned, address, offset, access),
                4 => self.b.load(Type::I32, address, offset, access),
                8 => self.b.load(Type::I64, address, offset, access),
                _ => self.b.load(Type::V128, address, offset, access),
            }
        };
        let values: SmallVec<[Value; 4]> = pieces(count).map(load).collect();
        for (value, piece) in values.into_iter().zip(pieces(count)) {
            self.store_piece(value, to, piece);
        }
    }

    fn fill_in_line(&mut self, memory: MemoryIndex, count: u64, byte: u8) {
        let [to, _, _] = self.pop_values();
        let to = self.locate_destination(to, memory, count);
        let value = if count < 16 {
            self.b.const64(i64::from_le_bytes([byte; 8]))
        } else {
            self.b.const_v128(u128::from_le_bytes([byte; 16]))
        };
        pieces(count).for_each(|piece| self.store_piece(value, to, piece));
    }

    /// The address of the first of `count` bytes, which has 64 bits.
    fn range_of_memory(&mut self, memory: MemoryIndex, start: Value, count: Value) -> Value {
        let (start, length) = (self.widen(start), self.length_of(memory));
        let end = self.b.add(start, count);
        if self.module.memory(memory).address == Width::W64 {
            let wraps = self.b.below(end, start);
            self.trap_if(wraps, Trap::MemoryOutOfBounds);
        }
        let is_outside = self.b.above(end, length);
        self.trap_if(is_outside, Trap::MemoryOutOfBounds);
        let base = self.base_of(memory);
        self.b.add(base, start)
    }

    fn push_address(&mut self, value: Value, width: Width) {
        let value = match width {
            Width::W32 => self.b.wrap(value),
            Width::W64 => value,
        };
        self.push(value, ValType::int(width));
    }

    // Tables

    fn holds_functions(&self, table: TableIndex) -> bool {
        let heap_type = self.module.table(table).element.heap_type();
        heap_type.abstract_type().top() == AbstractHeapType::Func
    }

    fn has_fixed_size(&self, table: TableIndex) -> bool {
        let limits = self.module.table(table).limits;
        limits.maximum == Some(limits.initial) && limits.initial <= MAX_TABLE_ENTRIES.into()
    }

    fn table_length(&mut self, table: TableIndex) -> Value {
        if self.has_fixed_size(table) {
            return (self.b).const64(self.module.table(table).limits.initial as i64);
        }
        let offset = self.env.layout.table(table) + TableView::LENGTH;
        self.load_readable(Type::I64, self.instance, offset, self.named.table_views)
    }

    pub(super) fn element_address(
        &mut self,
        table: TableIndex,
        index: Value,
        size_log2: u8,
        trap: Trap,
    ) -> Value {
        let index = self.widen(index);
        let least_length = self.module.table(table).limits.initial;
        if (self.b.constant_bits(index)).is_none_or(|index| index >= least_length) {
            let length = self.table_length(table);
            let is_outside = self.b.above_or_equal(index, length);
            self.trap_if(is_outside, trap);
        }
        let offset = self.env.layout.table(table) + TableView::ELEMENTS;
        let elements = if self.has_fixed_size(table) {
            self.load_fixed(Type::I64, self.instance, offset)
        } else {
            self.load_readable(Type::I64, self.instance, offset, self.named.table_views)
        };
        let distance = self.b.shl(index, i32::from(size_log2));
        self.b.add(elements, distance)
    }

    fn change_table<const OPERANDS: usize>(
        &mut self,
        operation: Operation,
        immediates: &[u32],
    ) -> Visited {
        let writes = self.named.tables;
        self.call_for_instruction::<OPERANDS>(operation, immediates, Type::Void, writes);
        Ok(())
    }

    fn synchronize<const OPERANDS: usize>(&mut self, operation: Operation, arg: MemArg) -> Visited {
        let mut args: SmallVec<[Value; 5]> = SmallVec::new();
        args.push(self.b.const32(arg.memory.0 as i32));
        args.push(self.b.const64(arg.offset as i64));
        args.extend(self.pop_values::<OPERANDS>());
        let result = self.call_operation(operation, &args, Type::I32, self.named.mutable);
        self.push(result, ValType::I32);
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitMemory for Translator<'_> {
    fn load(&mut self, op: LoadOp, arg: MemArg) -> Visited {
        let index = self.pop_value();
        let at = self.locate(index, arg, op.size().log2_bytes());
        let ty = ir_type(op.value_type());
        let value = if ty.is_int() {
            self.load_int(ty.width(), op.size(), op.sign(), at, at.for_load())
        } else {
            self.b.load(ty, at.address, at.offset, at.for_load())
        };
        self.push(value, op.value_type());
        Ok(())
    }

    fn store(&mut self, op: StoreOp, arg: MemArg) -> Visited {
        let [index, value] = self.pop_values();
        let at = self.locate(index, arg, op.size().log2_bytes());
        (self.b).store_sized(op.size(), value, at.address, at.offset, at.for_store());
        Ok(())
    }

    fn memory_size(&mut self, memory: MemoryIndex) -> Visited {
        let length = self.length_of(memory);
        let pages = self.b.shr(length, i32::from(PAGE_SIZE_LOG2));
        self.push_address(pages, self.module.memory(memory).address);
        Ok(())
    }

    fn memory_grow(&mut self, memory: MemoryIndex) -> Visited {
        let (width, writes) = (self.module.memory(memory).address, self.named.memories);
        let operation = Operation::MemoryGrow;
        let old = self.call_for_instruction::<1>(operation, &[memory.0], width.into(), writes);
        self.push(old, ValType::int(width));
        Ok(())
    }

    fn memory_fill(&mut self, memory: MemoryIndex) -> Visited {
        let value = self.stack[self.stack.len() - 2].value;
        if let (Some(count), Some(value)) = (self.count_in_line(), self.b.constant_bits(value)) {
            self.fill_in_line(memory, count, value as u8);
            return Ok(());
        }
        let [to, value, count] = self.pop_values();
        let count = self.widen(count);
        let to = self.range_of_memory(memory, to, count);
        let heap = (self.heaps).memory(self.b.function, &self.named, self.module, memory);
        self.call_for_bytes(self.env.stubs.fill_bytes, [to, value, count], heap);
        Ok(())
    }

    fn memory_copy(&mut self, dst: MemoryIndex, src: MemoryIndex) -> Visited {
        if let Some(count) = self.count_in_line() {
            self.copy_in_line(dst, src, count);
            return Ok(());
        }
        let [to, from, count] = self.pop_values();
        let count = self.widen(count);
        let to = self.range_of_memory(dst, to, count);
        let from = self.range_of_memory(src, from, count);
        let heap = (self.heaps).memory(self.b.function, &self.named, self.module, dst);
        self.call_for_bytes(self.env.stubs.move_bytes, [to, from, count], heap);
        Ok(())
    }

    fn memory_init(&mut self, memory: MemoryIndex, data: DataIndex) -> Visited {
        let writes = (self.heaps).memory(self.b.function, &self.named, self.module, memory);
        let immediates = [memory.0, data.0];
        self.call_for_instruction::<3>(Operation::MemoryInit, &immediates, Type::Void, writes);
        Ok(())
    }

    fn data_drop(&mut self, data: DataIndex) -> Visited {
        self.call_for_instruction::<0>(Operation::DataDrop, &[data.0], Type::Void, Heap::NOTHING);
        Ok(())
    }

    fn atomic_load(&mut self, width: Width, size: Size, arg: MemArg) -> Visited {
        let index = self.pop_value();
        let at = self.locate_aligned(index, arg, size);
        let value = self.load_int(width, size, Sign::Unsigned, at, at.for_atomic());
        self.push(value, ValType::int(width));
        Ok(())
    }

    fn atomic_store(&mut self, _: Width, size: Size, arg: MemArg) -> Visited {
        let [index, value] = self.pop_values();
        let at = self.locate_aligned(index, arg, size);
        (self.b).store_sized(size, value, at.address, 0, at.for_atomic());
        Ok(())
    }

    fn atomic_update(&mut self, op: AtomicOp, width: Width, size: Size, arg: MemArg) -> Visited {
        let [index, operand] = self.pop_values();
        let at = self.locate_aligned(index, arg, size);
        let old = (self.b).atomic_update(op, size, operand, at.address, at.for_atomic());
        self.push(old, ValType::int(width));
        Ok(())
    }

    fn atomic_compare_exchange(&mut self, width: Width, size: Size, arg: MemArg) -> Visited {
        let [index, expected, replacement] = self.pop_values();
        let at = self.locate_aligned(index, arg, size);
        let (address, access) = (at.address, at.for_atomic());
        let old = (self.b).atomic_compare_exchange(size, expected, replacement, address, access);
        self.push(old, ValType::int(width));
        Ok(())
    }

    fn atomic_wait(&mut self, width: Width, arg: MemArg) -> Visited {
        let operation = match width {
            Width::W32 => Operation::AtomicWait32,
            Width::W64 => Operation::AtomicWait64,
        };
        self.synchronize::<3>(operation, arg)
    }

    fn atomic_notify(&mut self, arg: MemArg) -> Visited {
        self.synchronize::<2>(Operation::AtomicNotify, arg)
    }

    fn atomic_fence(&mut self) -> Visited {
        self.b.fence(Heap::EVERYTHING, Heap::EVERYTHING);
        Ok(())
    }

    fn table_get(&mut self, table: TableIndex) -> Visited {
        let index = self.pop_value();
        let ty = self.module.table(table).element;
        let heap = self.heaps.table(self.b.function, self.module, table);
        let trap = Trap::TableOutOfBounds;
        let value = if self.holds_functions(table) {
            let element = self.element_address(table, index, FunctionElement::SIZE_LOG2, trap);
            let known = (self.b).load(Type::I64, element, FunctionElement::REFERENCE, heap);
            let args = [self.b.const32(table.0 as i32), index];
            self.or_make(known, Operation::TableGet, &args)
        } else {
            let element = self.element_address(table, index, REFERENCE_SIZE_LOG2, trap);
            self.b.load(Type::I64, element, 0, heap)
        };
        self.push(value, ty);
        Ok(())
    }

    fn table_set(&mut self, table: TableIndex) -> Visited {
        if self.holds_functions(table) {
            return self.change_table::<2>(Operation::TableSet, &[table.0]);
        }
        let (value, index) = (self.pop(), self.pop_value());
        let heap = self.heaps.table(self.b.function, self.module, table);
        let trap = Trap::TableOutOfBounds;
        let element = self.element_address(table, index, REFERENCE_SIZE_LOG2, trap);
        self.b.store(value.value, element, 0, heap);
        let offset = self.env.layout.table(table) + TableView::OWNER;
        let owner = self.load_fixed(Type::I64, self.instance, offset);
        self.write_barrier(owner, value, heap);
        Ok(())
    }

    fn table_size(&mut self, table: TableIndex) -> Visited {
        let length = self.table_length(table);
        self.push_address(length, self.module.table(table).address);
        Ok(())
    }

    fn table_grow(&mut self, table: TableIndex) -> Visited {
        let (width, writes) = (self.module.table(table).address, self.named.tables);
        let operation = Operation::TableGrow;
        let old = self.call_for_instruction::<2>(operation, &[table.0], width.into(), writes);
        self.push(old, ValType::int(width));
        Ok(())
    }

    fn table_fill(&mut self, table: TableIndex) -> Visited {
        self.change_table::<3>(Operation::TableFill, &[table.0])
    }

    fn table_copy(&mut self, dst: TableIndex, src: TableIndex) -> Visited {
        self.change_table::<3>(Operation::TableCopy, &[dst.0, src.0])
    }

    fn table_init(&mut self, table: TableIndex, elem: ElemIndex) -> Visited {
        self.change_table::<3>(Operation::TableInit, &[table.0, elem.0])
    }

    fn elem_drop(&mut self, elem: ElemIndex) -> Visited {
        self.call_for_instruction::<0>(Operation::ElemDrop, &[elem.0], Type::Void, Heap::NOTHING);
        Ok(())
    }
}
