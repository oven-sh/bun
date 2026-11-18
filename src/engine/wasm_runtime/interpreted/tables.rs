//! Tables, and references to functions.

use bun_engine_wasm_format::{ElemIndex, FuncIndex, TableIndex};

use super::Context;
use crate::operations::table as operations;
use crate::outcome::Failure;
use crate::value::Reference;

impl Context<'_> {
    pub fn table_size(&self, table: TableIndex) -> u64 {
        self.instance.table(table).len().into()
    }

    pub fn table_get(&self, table: TableIndex, index: u64) -> Result<u64, Failure> {
        Ok(self.instance.table(table).get(index)?.0)
    }

    pub fn table_set(&self, table: TableIndex, [index, value]: [u64; 2]) -> Result<u64, Failure> {
        // SAFETY: validated, as in all that follow.
        unsafe { operations::set(self.instance, table, index, Reference(value)) }.into_result()
    }

    pub fn table_grow(&self, table: TableIndex, [value, count]: [u64; 2]) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::grow(self.instance, table, Reference(value), count) }.into_result()
    }

    pub fn table_fill(&self, table: TableIndex, operands: [u64; 3]) -> Result<u64, Failure> {
        let ([dst, _, count], value) = (operands, Reference(operands[1]));
        // SAFETY: as above.
        unsafe { operations::fill(self.instance, table, dst, value, count) }.into_result()
    }

    pub fn table_copy(
        &self,
        to: TableIndex,
        from: TableIndex,
        [dst, src, count]: [u64; 3],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::copy(self.instance, to, from, dst, src, count) }.into_result()
    }

    pub fn table_init(
        &self,
        table: TableIndex,
        elem: ElemIndex,
        [dst, src, count]: [u64; 3],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::init(self.instance, table, elem, dst, src, count) }.into_result()
    }

    pub fn elem_drop(&self, elem: ElemIndex) {
        self.instance.drop_elements(elem);
    }

    pub fn ref_func(&self, func: FuncIndex) -> Result<u64, Failure> {
        Ok(self.instance.function_reference(func)?.0)
    }
}
