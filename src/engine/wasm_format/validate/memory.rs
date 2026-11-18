use bun_engine_asm::{AtomicOp, Size, Width};

use super::{Checked, Validator, is};
use crate::index::{DataIndex, ElemIndex, MemoryIndex, TableIndex};
use crate::ops::{LoadOp, MemArg, StoreOp};
use crate::types::ValType;
use crate::visitor::VisitMemory;

const I32: ValType = ValType::I32;

impl Validator<'_> {
    #[inline(always)]
    pub(super) fn address_type(&self, memory: MemoryIndex) -> ValType {
        ValType::int(self.header.memory(memory).address)
    }

    fn table_types(&self, table: TableIndex) -> (ValType, ValType) {
        let table = self.header.table(table);
        (ValType::int(table.address), table.element.into())
    }

    /// In the order of the stack.
    pub(super) fn pop_operands<const N: usize>(
        &mut self,
        name: &'static str,
        operands: [(&'static str, ValType); N],
    ) -> Checked {
        for (value, (role, expected)) in self.pop_array::<N>(name)?.into_iter().zip(operands) {
            ensure!(
                self.fits(value, expected),
                validation,
                "{name} {role} to type {value} expected {expected}"
            );
        }
        Ok(())
    }

    /// In the order of the stack.
    fn pop_atomic_operands<const N: usize>(
        &mut self,
        operands: [(&'static str, ValType); N],
    ) -> Checked {
        let mut values = [ValType::UNKNOWN; N];
        for (value, (role, _)) in values.iter_mut().zip(operands).rev() {
            *value = self.pop(role)?;
        }
        for (value, (role, expected)) in values.into_iter().zip(operands) {
            ensure!(is(value, expected), numbered, " {role} type mismatch");
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn rare_load(&mut self, address: ValType, result: ValType) -> Checked {
        let pointer = self.pop("load pointer")?;
        ensure!(is(pointer, address), named, " pointer type mismatch");
        self.push(result)
    }

    #[inline(never)]
    fn pop_store_operands(&mut self, address: ValType, expected: ValType) -> Checked {
        let value = self.pop("store value")?;
        let pointer = self.pop("store pointer")?;
        ensure!(is(pointer, address), named, " pointer type mismatch");
        ensure!(is(value, expected), named, " value type mismatch");
        Ok(())
    }
}

/// The type of a length that has to fit both address types.
fn narrower(a: ValType, b: ValType) -> ValType {
    if a == b { a } else { I32 }
}

fn lowercase(width: Width) -> &'static str {
    match width {
        Width::W32 => "i32",
        Width::W64 => "i64",
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitMemory for Validator<'_> {
    #[inline(always)]
    fn load(&mut self, op: LoadOp, arg: MemArg) -> Checked {
        let address = self.address_type(arg.memory);
        if let Some([top]) = self.top()
            && *top == address
        {
            *top = op.value_type();
            return Ok(());
        }
        self.rare_load(address, op.value_type())
    }

    #[inline(always)]
    fn store(&mut self, op: StoreOp, arg: MemArg) -> Checked {
        let address = self.address_type(arg.memory);
        if let Some(top) = self.top()
            && ValType::pair(*top) == ValType::pair([address, op.value_type()])
        {
            self.height -= 2;
            return Ok(());
        }
        self.pop_store_operands(address, op.value_type())
    }

    #[inline(never)]
    fn memory_size(&mut self, memory: MemoryIndex) -> Checked {
        self.push(self.address_type(memory))
    }

    #[inline(never)]
    fn memory_grow(&mut self, memory: MemoryIndex) -> Checked {
        let width = self.header.memory(memory).address;
        let delta = self.pop(match width {
            Width::W32 => "expect an i32 argument to grow_memory on the stack",
            Width::W64 => "expect an i64 argument to grow_memory on the stack",
        })?;
        ensure!(
            is(delta, ValType::int(width)),
            validation,
            "grow_memory with non-{} delta argument has type: {delta}",
            lowercase(width)
        );
        self.push(ValType::int(width))
    }

    fn memory_fill(&mut self, memory: MemoryIndex) -> Checked {
        let address = self.address_type(memory);
        let operands = [
            ("dstAddress", address),
            ("targetValue", I32),
            ("size", address),
        ];
        self.pop_operands("memory.fill", operands)
    }

    fn memory_copy(&mut self, dst: MemoryIndex, src: MemoryIndex) -> Checked {
        let (dst, src) = (self.address_type(dst), self.address_type(src));
        let operands = [
            ("dstAddress", dst),
            ("targetValue", src),
            ("size", narrower(dst, src)),
        ];
        self.pop_operands("memory.copy", operands)
    }

    fn memory_init(&mut self, memory: MemoryIndex, _: DataIndex) -> Checked {
        let address = self.address_type(memory);
        let operands = [
            ("dst address", address),
            ("src address", I32),
            ("length", I32),
        ];
        self.pop_operands("memory.init", operands)
    }

    fn data_drop(&mut self, _: DataIndex) -> Checked {
        Ok(())
    }

    fn atomic_load(&mut self, width: Width, _: Size, arg: MemArg) -> Checked {
        let pointer = self.pop("load pointer")?;
        ensure!(
            is(pointer, self.address_type(arg.memory)),
            numbered,
            " pointer type mismatch"
        );
        self.push(ValType::int(width))
    }

    fn atomic_store(&mut self, width: Width, _: Size, arg: MemArg) -> Checked {
        self.pop_store_operands(self.address_type(arg.memory), ValType::int(width))
    }

    fn atomic_update(&mut self, _: AtomicOp, width: Width, _: Size, arg: MemArg) -> Checked {
        let (address, ty) = (self.address_type(arg.memory), ValType::int(width));
        self.pop_atomic_operands([("pointer", address), ("value", ty)])?;
        self.push(ty)
    }

    fn atomic_compare_exchange(&mut self, width: Width, _: Size, arg: MemArg) -> Checked {
        let (address, ty) = (self.address_type(arg.memory), ValType::int(width));
        self.pop_atomic_operands([("pointer", address), ("expected", ty), ("value", ty)])?;
        self.push(ty)
    }

    fn atomic_wait(&mut self, width: Width, arg: MemArg) -> Checked {
        let (address, ty) = (self.address_type(arg.memory), ValType::int(width));
        self.pop_atomic_operands([
            ("pointer", address),
            ("value", ty),
            ("timeout", ValType::I64),
        ])?;
        self.push(I32)
    }

    fn atomic_notify(&mut self, arg: MemArg) -> Checked {
        self.pop_atomic_operands([("pointer", self.address_type(arg.memory)), ("count", I32)])?;
        self.push(I32)
    }

    fn atomic_fence(&mut self) -> Checked {
        Ok(())
    }

    #[inline(never)]
    fn table_get(&mut self, table: TableIndex) -> Checked {
        let (address, element) = self.table_types(table);
        self.pop_operands("table.get", [("index", address)])?;
        self.push(element)
    }

    #[inline(never)]
    fn table_set(&mut self, table: TableIndex) -> Checked {
        let (address, element) = self.table_types(table);
        self.pop_operands("table.set", [("index", address), ("value", element)])
    }

    fn table_size(&mut self, table: TableIndex) -> Checked {
        self.push(self.table_types(table).0)
    }

    fn table_grow(&mut self, table: TableIndex) -> Checked {
        let (address, element) = self.table_types(table);
        let width = lowercase(self.header.table(table).address);
        let [fill, delta] = self.pop_array("table.grow")?;
        ensure!(
            self.fits(fill, element),
            validation,
            "table.grow expects fill value of type {element} got {fill}"
        );
        ensure!(
            is(delta, address),
            validation,
            "table.grow expects an {width} delta value, got {delta}"
        );
        self.push(address)
    }

    fn table_fill(&mut self, table: TableIndex) -> Checked {
        let (address, element) = self.table_types(table);
        let [offset, fill, count] = self.pop_array("table.fill")?;
        ensure!(
            self.fits(fill, element),
            validation,
            "table.fill expects fill value of type {element} got {fill}"
        );
        for (value, role) in [(offset, "offset"), (count, "count")] {
            ensure!(
                is(value, address),
                validation,
                "table.fill expects an {address} {role} value, got {value}"
            );
        }
        Ok(())
    }

    fn table_copy(&mut self, dst: TableIndex, src: TableIndex) -> Checked {
        let ((dst, to), (src, from)) = (self.table_types(dst), self.table_types(src));
        ensure!(
            self.fits(from, to),
            validation,
            "type mismatch at table.copy. got {from} and {to}"
        );
        let operands = [
            ("dst_offset", dst),
            ("src_offset", src),
            ("length", narrower(dst, src)),
        ];
        self.pop_operands("table.copy", operands)
    }

    fn table_init(&mut self, table: TableIndex, elem: ElemIndex) -> Checked {
        let ((address, to), from) = (self.table_types(table), self.header.elem(elem).ty);
        ensure!(
            self.fits(from, to),
            validation,
            "table.init requires table's type \"{to}\" and element's type \"{from}\" are the same"
        );
        let operands = [
            ("dst_offset", address),
            ("src_offset", I32),
            ("length", I32),
        ];
        self.pop_operands("table.init", operands)
    }

    fn elem_drop(&mut self, _: ElemIndex) -> Checked {
        Ok(())
    }
}
