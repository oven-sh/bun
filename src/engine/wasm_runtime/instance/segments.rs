//! Element and data segments. Only passive ones are there for instructions, until they are dropped.

use core::cell::Cell;

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{
    ConstExpr, DataIndex, DataMode, ElemIndex, ElemItem, ElemMode, OutOfMemory,
};

use super::{ConstantError, Instance};
use crate::alloc::{try_boxed, try_defaults, try_push};
use crate::module::Module;
use crate::table::Table;
use crate::value::Reference;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SegmentError {
    ElementsOutOfBounds,
    DataOutOfBounds {
        memory_length: u64,
        segment_length: u32,
        offset: u64,
    },
    OutOfMemory,
}

struct Bitset(Box<[Cell<u64>]>);

impl Bitset {
    fn new(bits: impl ExactSizeIterator<Item = bool>) -> Result<Self, OutOfMemory> {
        let words: Box<[Cell<u64>]> = try_defaults(bits.len().div_ceil(64))?;
        for (index, bit) in bits.enumerate() {
            words[index / 64].update(|word| word | u64::from(bit) << (index % 64));
        }
        Ok(Self(words))
    }

    fn has(&self, index: u32) -> bool {
        self.0[index as usize / 64].get() >> (index % 64) & 1 != 0
    }

    fn remove(&self, index: u32) {
        self.0[index as usize / 64].update(|word| word & !(1 << (index % 64)));
    }
}

pub(super) struct Segments {
    available_elems: Bitset,
    available_data: Bitset,
}

impl Segments {
    pub(super) fn new(module: &Module) -> Result<Self, OutOfMemory> {
        let elems = module.elems().iter();
        let data = module.data_segments().iter();
        Ok(Self {
            available_elems: Bitset::new(elems.map(|elem| elem.mode == ElemMode::Passive))?,
            available_data: Bitset::new(data.map(|data| data.mode == DataMode::Passive))?,
        })
    }
}

fn is_code(item: ElemItem) -> bool {
    matches!(item.expr(), ConstExpr::Code(_))
}

/// The items of a segment.
#[derive(Clone, Copy)]
pub(crate) struct Elements<'a> {
    items: &'a [ElemItem],
    /// In `Traced::evaluated`.
    evaluated: Option<usize>,
}

impl Elements<'_> {
    pub(crate) fn has_range(&self, start: u64, count: u64) -> bool {
        let end = start.checked_add(count);
        end.is_some_and(|end| end <= self.items.len() as u64)
    }
}

impl Instance {
    pub(super) fn evaluate_elements(&self) -> Result<(), ConstantError> {
        for (elem, index) in self.module.elems().iter().zip(0..) {
            let items = self.module.elem_items(elem);
            if !items.iter().copied().any(is_code) {
                continue;
            }
            try_boxed(items.iter().map(|_| Reference(0)))
                .and_then(|values| {
                    let evaluated = &mut self.traced.lock().evaluated;
                    try_push(evaluated, (ElemIndex(index), values))
                })
                .map_err(|OutOfMemory| Trap::OutOfMemory)?;
            for (position, item) in items.iter().enumerate() {
                if is_code(*item) {
                    let value = Reference(self.evaluate(item.expr())? as u64);
                    let mut traced = self.traced.lock();
                    traced.evaluated.last_mut().expect("it was pushed").1[position] = value;
                    drop(traced);
                    self.write_barrier();
                }
            }
        }
        Ok(())
    }

    /// What was written before an error stays.
    pub fn apply_segments(&self) -> Result<(), SegmentError> {
        for (elem, index) in self.module.elems().iter().zip(0..) {
            if elem.mode != ElemMode::Passive {
                self.apply_elem(ElemIndex(index))?;
                self.drop_elements(ElemIndex(index));
            }
        }
        for data in self.module.data_segments() {
            let DataMode::Active { memory, offset } = data.mode else {
                continue;
            };
            let (memory, offset) = (self.memory(memory), self.evaluate_offset(offset)?);
            let written = memory.write(offset, self.module.bytes(data.bytes));
            written.map_err(|_| SegmentError::DataOutOfBounds {
                memory_length: memory.len(),
                segment_length: data.bytes.len,
                offset,
            })?;
        }
        Ok(())
    }

    fn apply_elem(&self, index: ElemIndex) -> Result<(), SegmentError> {
        let elem = self.module.elem(index);
        let ElemMode::Active { table, offset } = elem.mode else {
            return Ok(());
        };
        let (table, offset) = (self.table(table), self.evaluate_offset(offset)?);
        let (dst, count) = table
            .check_range(offset, elem.len.into())
            .map_err(|_| SegmentError::ElementsOutOfBounds)?;
        let elements = self.elements_of(index, self.module.elem_items(elem));
        // SAFETY: in bounds, and the module was validated.
        unsafe { self.copy_elements(table, dst, elements, 0, count) }
            .map_err(|_| SegmentError::OutOfMemory)
    }

    fn evaluate_offset(&self, offset: ConstExpr) -> Result<u64, SegmentError> {
        let offset = self.evaluate(offset);
        Ok(offset.map_err(|_| SegmentError::OutOfMemory)? as u64)
    }

    /// `None` if the range is out of bounds.
    pub(crate) fn data(&self, data: DataIndex, start: u64, count: u64) -> Option<&[u8]> {
        let bytes = match self.segments.available_data.has(data.0) {
            true => self.module.bytes(self.module.data(data).bytes),
            false => &[],
        };
        bytes.get(start as usize..start.checked_add(count)? as usize)
    }

    pub(crate) fn drop_data(&self, data: DataIndex) {
        self.segments.available_data.remove(data.0);
    }

    pub(crate) fn elements(&self, elem: ElemIndex) -> Elements<'_> {
        let items = match self.segments.available_elems.has(elem.0) {
            true => self.module.elem_items(self.module.elem(elem)),
            false => &[],
        };
        self.elements_of(elem, items)
    }

    fn elements_of<'a>(&self, elem: ElemIndex, items: &'a [ElemItem]) -> Elements<'a> {
        let evaluated = &self.traced.lock().evaluated;
        Elements {
            items,
            evaluated: evaluated.binary_search_by_key(&elem, |entry| entry.0).ok(),
        }
    }

    pub(crate) fn drop_elements(&self, elem: ElemIndex) {
        self.segments.available_elems.remove(elem.0);
        let evaluated = &mut self.traced.lock().evaluated;
        if let Ok(position) = evaluated.binary_search_by_key(&elem, |entry| entry.0) {
            evaluated[position].1 = Box::default();
        }
    }

    pub(crate) fn element(&self, elements: Elements<'_>, index: u32) -> Result<Reference, Trap> {
        match elements.items[index as usize].expr() {
            ConstExpr::Code(_) => {
                let position = elements.evaluated.expect("an initialized instance");
                Ok(self.traced.lock().evaluated[position].1[index as usize])
            }
            expr => Ok(Reference(self.evaluate(expr).map_err(|it| it.trap)? as u64)),
        }
    }

    /// # Safety
    /// The table has the range, and the items have the type of its elements.
    pub(crate) unsafe fn copy_elements(
        &self,
        table: &Table,
        dst: u32,
        elements: Elements<'_>,
        src: u32,
        count: u32,
    ) -> Result<(), Trap> {
        // What is written without a barrier can be reached from the instance meanwhile.
        let copied = (0..count).try_for_each(|index| {
            let (dst, src) = (dst + index, src + index);
            if let ConstExpr::RefFunc(func) = elements.items[src as usize].expr() {
                let reference = self.existing_function_reference(func);
                // SAFETY: the caller's.
                unsafe { table.write_callable(dst, self.callable(func), reference) };
                return Ok(());
            }
            let value = self.element(elements, src)?;
            // SAFETY: the caller's.
            unsafe { table.fill(dst.into(), value, 1) }
        });
        table.finish_writes();
        copied
    }
}
