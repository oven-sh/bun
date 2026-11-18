//! What is done with tables without a call.

use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{AbstractHeapType, TableIndex, ValType};

use super::Function;
use crate::abi::{FunctionElement, INSTANCE, Operation, TableView, Trap};

impl Function<'_> {
    fn table_view(&self, table: TableIndex) -> Address {
        Address::new(INSTANCE, self.env.layout.table(table))
    }

    pub(super) fn push_table_size(&mut self, table: TableIndex) {
        let dst = self.take_gpr();
        (self.masm).load64(dst, self.table_view(table).plus(TableView::LENGTH));
        self.push_register(ValType::int(self.module.table(table).address), dst);
    }

    pub(super) fn get_element(&mut self, table: TableIndex) {
        let (view, element) = (self.table_view(table), self.module.table(table).element);
        let index = self.pop_gpr();
        let dst = self.take_gpr();
        let trap = self.trap_label(Trap::TableOutOfBounds);
        (self.masm).branch64(Cond::AboveEq, index, view.plus(TableView::LENGTH), trap);
        if element.heap_type().abstract_type().top() == AbstractHeapType::Func {
            self.masm.shl64(dst, index, FunctionElement::SIZE_LOG2);
            self.masm.add64(dst, dst, view.plus(TableView::ELEMENTS));
            (self.masm).load64(dst, Address::new(dst, FunctionElement::REFERENCE));
            let missing = self.masm.new_label();
            self.masm.branch_if_zero64(dst, missing);
            let arguments = [table.0.into(), index.into()];
            self.call_operation_at(missing, Operation::TableGet, &arguments, Some(dst));
        } else {
            self.masm.load64(dst, view.plus(TableView::ELEMENTS));
            (self.masm).load64(dst, Address::indexed(dst, index, Scale::Eight, 0));
        }
        self.push_register(element.into(), dst);
    }
}
