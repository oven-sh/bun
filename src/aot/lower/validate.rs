mod expected_result;
mod misuse;
mod nodes;
mod plans;
mod rules;
mod unsupported;

use std::rc::Rc;

use bun_sema::atom::Atom;
use bun_sema::check::aot::{GaveUp, Queries, WrittenPlace};
use bun_sema::hir::{self, ExprId};
use rustc_hash::FxHashMap;

use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{LimitId, ValidationNode};
use crate::ir::{ExpectedResultId, LayoutId, PropertyKeyId, StringId, TypeId};

pub use self::plans::{PlanInputs, PlannedCall, PlannedFile, plan_validated_calls};

#[derive(Default)]
pub(crate) struct ValidationState {
    nodes_by_type: FxHashMap<(CheckerTypeId, WrittenPlace), Rc<[ValidationNode]>>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum ValidationError {
    TypeParameter { text: Vec<u8> },
    Unsupported { described: Vec<u8> },
    TooLarge,
    GaveUp(GaveUp),
}

/// The file that holds a call which validates by its type argument: what the nodes of the type are made with.
pub(crate) trait ValidatedFile<'c, 'p: 'c, 's: 'p> {
    fn queries(&mut self) -> &mut Queries<'c, 'p, 's>;
    fn hir(&self) -> &'p hir::File<'s>;
    fn limit(&self, limit: LimitId) -> u64;
    fn gave_up(&mut self, limit: LimitId, position: u32);
    fn validation(&mut self) -> &mut ValidationState;
    fn intern_atom(&mut self, atom: Atom) -> StringId;
    fn intern_bytes(&mut self, bytes: &[u8]) -> StringId;
    fn name_key(&mut self, name: Atom) -> PropertyKeyId;
    /// What compiled code knows of a value that the node has accepted.
    fn result_type(&mut self, ty: CheckerTypeId, position: u32) -> TypeId;
    fn object_type_layout(&mut self, ty: CheckerTypeId) -> Option<LayoutId>;
    fn find_field(&mut self, layout: LayoutId, key: PropertyKeyId) -> Option<u32>;
    fn calls_parse_of_bun(&self, callee: ExprId) -> bool;
    fn report_at(&mut self, expression: ExprId, code: Code, arguments: &[&[u8]]);
    fn add_expected_result(
        &mut self,
        call: ExprId,
        ty: CheckerTypeId,
        validation: Vec<ValidationNode>,
    ) -> Result<ExpectedResultId, ValidationError>;
}

impl<'c, 'p: 'c, 's: 'p> ValidatedFile<'c, 'p, 's> for FileLowering<'_, 'c, 'p, 's> {
    fn queries(&mut self) -> &mut Queries<'c, 'p, 's> {
        self.queries
    }

    fn hir(&self) -> &'p hir::File<'s> {
        self.hir
    }

    fn limit(&self, limit: LimitId) -> u64 {
        self.inputs.limits.get(limit)
    }

    fn gave_up(&mut self, limit: LimitId, position: u32) {
        FileLowering::gave_up(self, limit, position);
    }

    fn validation(&mut self) -> &mut ValidationState {
        &mut self.modules.validation
    }

    fn intern_atom(&mut self, atom: Atom) -> StringId {
        FileLowering::intern_atom(self, atom)
    }

    fn intern_bytes(&mut self, bytes: &[u8]) -> StringId {
        FileLowering::intern_bytes(self, bytes)
    }

    fn name_key(&mut self, name: Atom) -> PropertyKeyId {
        FileLowering::name_key(self, name)
    }

    fn result_type(&mut self, ty: CheckerTypeId, position: u32) -> TypeId {
        FileLowering::result_type(self, ty, position)
    }

    fn object_type_layout(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        FileLowering::object_type_layout(self, ty)
    }

    fn find_field(&mut self, layout: LayoutId, key: PropertyKeyId) -> Option<u32> {
        FileLowering::find_field(self, layout, key)
    }

    fn calls_parse_of_bun(&self, callee: ExprId) -> bool {
        FileLowering::calls_parse_of_bun(self, callee)
    }

    fn report_at(&mut self, expression: ExprId, code: Code, arguments: &[&[u8]]) {
        FileLowering::report_at(self, expression, code, arguments);
    }

    fn add_expected_result(
        &mut self,
        call: ExprId,
        ty: CheckerTypeId,
        validation: Vec<ValidationNode>,
    ) -> Result<ExpectedResultId, ValidationError> {
        FileLowering::add_expected_result(self, call, ty, validation)
    }
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
