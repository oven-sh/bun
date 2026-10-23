mod expected_result;
mod misuse;
mod nodes;
mod rules;
mod unsupported;

use std::rc::Rc;

use bun_sema::check::aot::{GaveUp, WrittenPlace};
use bun_sema::hir::ExprId;
use rustc_hash::FxHashMap;

use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::ir::ExpectedResultId;
use crate::ir::generated::ValidationNode;

#[derive(Default)]
pub(crate) struct ValidationState {
    nodes_by_type: FxHashMap<(CheckerTypeId, WrittenPlace), Rc<[ValidationNode]>>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
enum ValidationError {
    TypeParameter { text: Vec<u8> },
    Unsupported { described: Vec<u8> },
    TooLarge,
    GaveUp(GaveUp),
}

pub(crate) fn find_expected_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ExpectedResultId> {
    expected_result::find_expected_result(lowering.file, call)
}

pub(in crate::lower) fn report_misused_compiler_functions(file: &mut FileLowering<'_, '_, '_, '_>) {
    misuse::report_misused_compiler_functions(file);
}
