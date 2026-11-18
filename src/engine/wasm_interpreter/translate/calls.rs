//! Calls.

use bun_engine_wasm_format::{FuncIndex, FuncType, TableIndex, TypeIndex, ValKind};
use bun_engine_wasm_runtime::interpreted::slot_count;

use super::{Done, Translator};
use crate::machine::Handler;
use crate::run::calls;

impl Translator<'_> {
    /// The first record.
    fn begin_call(&mut self, ty: FuncType<'_>, handler: Handler, imm: u32) -> Done {
        let first = self.pop_settled(ty.params.len())?;
        self.emit_low(handler, first, imm)
    }

    fn end_call(&mut self, ty: FuncType<'_>) -> Done {
        self.forget_last_results();
        match *ty.results {
            [result] if result.kind() != ValKind::V128 => self.push_returned(result.kind()),
            _ => self.push_all(ty.results),
        }
        Ok(())
    }

    fn is_import(&self, func: FuncIndex) -> bool {
        self.module.code_index(func).is_none()
    }

    /// All but the last record.
    fn begin_call_of_element(
        &mut self,
        ty: TypeIndex,
        table: TableIndex,
        handler: Handler,
    ) -> Done {
        let (types, view) = (self.module.types(), self.module.layout().table(table));
        self.begin_call(types.func_type(ty), handler, view as u32)?;
        self.extend_wide(types.rtt(ty).address() as u64)
    }

    pub(super) fn call_function(&mut self, func: FuncIndex) -> Done {
        let ty = self.module.func_type(func);
        let handler = match self.is_import(func) {
            true => calls::call_import,
            false => calls::call,
        };
        self.begin_call(ty, handler, func.0)?;
        self.end_call(ty)
    }

    pub(super) fn call_element(&mut self, ty: TypeIndex, table: TableIndex) -> Done {
        let (index, _) = self.pop_in_slot()?;
        self.begin_call_of_element(ty, table, calls::call_indirect)?;
        self.extend(index.into(), 0)?;
        self.end_call(self.module.types().func_type(ty))
    }

    pub(super) fn call_reference(&mut self, ty: TypeIndex) -> Done {
        let ((function, _), ty) = (self.pop_in_slot()?, self.module.types().func_type(ty));
        self.begin_call(ty, calls::call_ref, function.into())?;
        self.end_call(ty)
    }

    pub(super) fn leave_to_function(&mut self, func: FuncIndex) -> Done {
        let ty = self.module.func_type(func);
        let handler = match self.is_import(func) {
            true => calls::return_call_import,
            false => calls::return_call,
        };
        self.begin_call(ty, handler, func.0)?;
        self.extend(0, slot_count(ty.params) as u32)
    }

    pub(super) fn leave_to_element(&mut self, ty: TypeIndex, table: TableIndex) -> Done {
        let (index, _) = self.pop_in_slot()?;
        self.begin_call_of_element(ty, table, calls::return_call_indirect)?;
        let params = self.module.types().func_type(ty).params;
        self.extend(index.into(), slot_count(params) as u32)
    }

    pub(super) fn leave_to_reference(&mut self, ty: TypeIndex) -> Done {
        let ((function, _), ty) = (self.pop_in_slot()?, self.module.types().func_type(ty));
        self.begin_call(ty, calls::return_call_ref, function.into())?;
        self.extend(0, slot_count(ty.params) as u32)
    }
}
