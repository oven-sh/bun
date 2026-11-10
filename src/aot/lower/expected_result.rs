use bun_sema::bind::Parent;
use bun_sema::check::aot::{CallTarget, FunctionRef, WrittenType};
use bun_sema::hir::{ExprId, ExprKind, FnBody};

use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::builtins::{builtin_value_of, table};
use crate::ir::generated::{ExpectedResult, ExpectedResultFlags, LimitId};
use crate::ir::{ExpectedResultId, Primitives, TypeId, TypeTable};

impl FileLowering<'_, '_, '_, '_> {
    fn find_expected_result(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        let hir = self.hir;
        let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
            return None;
        };
        let has_type_arguments = !hir.list_at(hir[id].type_args).is_empty();
        let may_be_query =
            matches!(hir[call].kind, ExprKind::TaggedTemplate(_)) && self.is_checked();
        if !has_type_arguments && !may_be_query {
            return self.find_result_written_over_parse(call);
        }
        let target = self.queries.resolved_call(call).ok()??;
        if !has_type_arguments && !self.answers_query(&target) {
            return None;
        }
        self.find_written_result(call, &target)
    }

    fn find_result_written_over_parse(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let callee = self.skip_type_syntax(hir[id].callee);
        if self.builtins.builtin_of_expression(callee) != Some(BuiltinId::JSONParse) {
            return None;
        }
        let mut arguments = hir.ids(hir[id].args);
        let (Some(text), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        if matches!(hir[text].kind, ExprKind::Spread(_)) {
            return None;
        }
        let ty = self.find_type_written_over(call)?;
        let limit = LimitId::MaxExpectedResultLayouts;
        let layouts = self.collect_reached_layouts(ty, limit)?;
        self.note_what_is_built(ty, limit);
        let flags = ExpectedResultFlags::IS_MADE_BY_PARSER;
        let expected = ExpectedResult { ty, layouts, flags };
        Some(self.fragment.add_expected_result(expected))
    }

    fn find_type_written_over(&mut self, mut value: ExprId) -> Option<TypeId> {
        loop {
            let written = self.queries.contextual_type_of_settled_value(value).ok()?;
            let ty = written.map_or(TypeTable::ANYTHING, |written| self.result_type(written));
            if ty != TypeTable::ANYTHING {
                return Some(ty);
            }
            let Parent::Expr(around) = self.bound.parent_of_expr(value) else {
                return None;
            };
            if !matches!(self.hir[around].kind, ExprKind::As { expr, .. } if expr == value) {
                return None;
            }
            value = around;
        }
    }

    fn find_builtin_of_signature(&self, target: &CallTarget) -> Option<BuiltinId> {
        let types = self.inputs.builtin_types;
        let index = types.value_of_call_signature(self.queries.files(), target.declaration?)?;
        builtin_value_of(index).map(table::canonical_id)
    }

    fn answers_query(&self, target: &CallTarget) -> bool {
        let builtin = self.find_builtin_of_signature(target);
        builtin.is_some_and(table::answers_query)
    }

    fn type_of_rows(&mut self, call: ExprId, query: CheckerTypeId) -> TypeId {
        let settled = match self.queries.awaited_type(query) {
            Ok(settled) => self.result_type(settled),
            Err(_) => TypeTable::ANYTHING,
        };
        if settled != TypeTable::ANYTHING {
            return settled;
        }
        match self.queries.contextual_type_of_settled_value(call) {
            Ok(Some(written)) => self.result_type(written),
            Ok(None) | Err(_) => TypeTable::ANYTHING,
        }
    }

    fn result_type(&mut self, ty: CheckerTypeId) -> TypeId {
        let mapped = self.map_type_at(ty);
        if !mapped.is_checked || mapped.ty == TypeTable::ANYTHING {
            return TypeTable::ANYTHING;
        }
        match self.queries.without_nullish(ty) {
            Ok(listed) if listed == ty => self
                .fragment
                .types
                .without_primitives(mapped.ty, Primitives::NULLISH),
            Ok(_) | Err(_) => mapped.ty,
        }
    }

    fn find_written_result(
        &mut self,
        call: ExprId,
        target: &CallTarget,
    ) -> Option<ExpectedResultId> {
        if target
            .declaration
            .is_some_and(|declaration| has_body(self, declaration))
        {
            return None;
        }
        let builtin = self.find_builtin_of_signature(target);
        let answers_query = builtin.is_some_and(table::answers_query);
        let ty = match (answers_query, target.result.written) {
            (true, _) => self.type_of_rows(call, target.result.checked.ok()?),
            (false, WrittenType::Written(written)) => self.result_type(written),
            (false, WrittenType::Unwritten | WrittenType::GaveUp(_)) => return None,
        };
        if ty == TypeTable::ANYTHING {
            return None;
        }
        let limit = LimitId::MaxExpectedResultLayouts;
        let layouts = self.collect_reached_layouts(ty, limit)?;
        let is_made_by_parser = builtin.is_some_and(table::is_parser);
        let flags = match (answers_query, is_made_by_parser) {
            (true, _) => ExpectedResultFlags::IS_ROWS_OF_QUERY,
            (false, true) => ExpectedResultFlags::IS_MADE_BY_PARSER,
            (false, false) => ExpectedResultFlags::default(),
        };
        let expected = ExpectedResult { ty, layouts, flags };
        if builtin.is_none() {
            return Some(self.fragment.add_described_result(expected));
        }
        if is_made_by_parser {
            self.note_what_is_built(ty, limit);
        }
        Some(self.fragment.add_expected_result(expected))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn find_expected_result(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        self.file.find_expected_result(call)
    }
}

fn has_body(file: &FileLowering<'_, '_, '_, '_>, declaration: FunctionRef) -> bool {
    match file.queries.files().hir(declaration.file)[declaration.function].body {
        FnBody::None => false,
        FnBody::Block(_) | FnBody::Expr(_) => true,
    }
}
