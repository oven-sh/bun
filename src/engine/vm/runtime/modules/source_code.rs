use bun_engine_macros::cell;

use crate::{Gc, JsCell, SourceCode, TypeFlags, Vm};

/// What the promise of a fetch is fulfilled with.
#[cell(name = "JSSourceCode", cell_type = SourceCode, flags = TypeFlags::SHAPE_IS_IMMORTAL,
    export = "engine_class_SourceCode")]
pub struct JsSourceCode {
    base: JsCell,
    source: SourceCode,
}

impl JsSourceCode {
    pub const OFFSET_OF_SOURCE: usize = core::mem::offset_of!(JsSourceCode, source);

    pub fn create(vm: &Vm, source: SourceCode) -> Gc<JsSourceCode> {
        let base = vm.shape_for::<JsSourceCode>();
        vm.allocate::<JsSourceCode>(JsSourceCodeInit { base, source })
    }

    pub fn source(&self) -> &SourceCode {
        &self.source
    }
}
