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

    // `const config: Config = JSON.parse(text)`, `JSON.parse(text) as Order`: the parse may build its answer with the layouts of the type that it is written under.
    // So may `return JSON.parse(text)` in a function that declares what it returns. An async function converts what it returns to `Order | PromiseLike<Order>`,
    // which names no layout, and a parse answers an `Order`.
    fn find_result_written_over_parse(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let callee = self.skip_type_syntax(hir[id].callee);
        if self.builtins.builtin_of_expression(callee) != Some(BuiltinId::JSONParse) {
            return None;
        }
        // A reviver answers whatever it likes.
        let mut arguments = hir.ids(hir[id].args);
        let (Some(text), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        if matches!(hir[text].kind, ExprKind::Spread(_)) {
            return None;
        }
        let written = self.queries.contextual_type_of_settled_value(call).ok()??;
        let ty = self.result_type(written);
        if ty == TypeTable::ANYTHING {
            return None;
        }
        let limit = LimitId::MaxExpectedResultLayouts;
        let layouts = self.collect_reached_layouts(ty, limit)?;
        self.note_what_is_built(ty, limit);
        let flags = ExpectedResultFlags::default();
        let expected = ExpectedResult { ty, layouts, flags };
        Some(self.fragment.add_expected_result(expected))
    }

    // The signature is the same whatever holds the function: `sql` of "bun", what `new SQL(..)` made, a parameter of that type.
    fn find_builtin_of_signature(&self, target: &CallTarget) -> Option<BuiltinId> {
        let types = self.inputs.builtin_types;
        let index = types.value_of_call_signature(self.queries.files(), target.declaration?)?;
        builtin_value_of(index).map(table::canonical_id)
    }

    fn answers_query(&self, target: &CallTarget) -> bool {
        let builtin = self.find_builtin_of_signature(target);
        builtin.is_some_and(table::answers_query)
    }

    // ``await sql<Row[]>`..` ``, ``const rows: Row[] = await sql`..` ``: a query settles to its rows.
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
        // Every mapped type admits `undefined` and `null`.
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
        // The record says what code that the engine cannot see creates. It sees a body.
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
        let flags = match answers_query {
            true => ExpectedResultFlags::IS_ROWS_OF_QUERY,
            false => ExpectedResultFlags::default(),
        };
        let expected = ExpectedResult { ty, layouts, flags };
        // A built-in may build what its type argument says: `response.json<T>()`.
        if builtin.is_none() {
            return Some(self.fragment.add_described_result(expected));
        }
        if builtin.is_some_and(table::is_parser) {
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
