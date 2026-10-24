mod expected_result;
mod misuse;
mod nodes;
mod rules;
mod unsupported;

use std::rc::Rc;

use bun_sema::check::aot::{GaveUp, WrittenPlace};
use bun_sema::hir::ExprId;
use rustc_hash::FxHashMap;

use super::{CheckerTypeId, FunctionLowering};
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn find_expected_result(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        self.file.find_expected_result(call)
    }

    pub(crate) fn note_what_an_awaited_parse_may_build(
        &mut self,
        awaiting: ExprId,
        operand: ExprId,
    ) {
        self.file
            .note_what_an_awaited_parse_may_build(awaiting, operand);
    }
}
