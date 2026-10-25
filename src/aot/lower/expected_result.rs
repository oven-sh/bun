use bun_sema::check::aot::{CallTarget, FunctionRef, ShapeKind, WrittenType};
use bun_sema::hir::{ExprId, ExprKind, FnBody, MemberKey};

use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, BuiltinName, MemberLookup};
use crate::builtins::{builtin_class_of, builtin_value_of};
use crate::ir::generated::{ExpectedResult, LimitId};
use crate::ir::{ExpectedResultId, Primitives, TypeId, TypeTable, ValueId};

impl FileLowering<'_, '_, '_, '_> {
    // `const config: Config = JSON.parse(text)`, `JSON.parse(text) as Order`: the parse may build its answer with the layouts of the type that it is written under.
    // So may `return JSON.parse(text)` and `return await response.json()` in a function that declares what it returns.
    fn note_what_a_parse_may_build(&mut self, answer: ExprId) {
        let Ok(Some(written)) = self.queries.contextual_type_of_settled_value(answer) else {
            return;
        };
        let position = self.hir[answer].pos;
        let ty = self.result_type(written, position);
        if ty != TypeTable::ANYTHING {
            self.note_what_is_built(ty, LimitId::MaxExpectedResultLayouts);
        }
    }

    fn has_parser_under(&mut self, receiver: CheckerTypeId, name: BuiltinName) -> bool {
        let class = match self.queries.type_shape(receiver).map(|shape| shape.kind) {
            Ok(ShapeKind::Builtin { class, .. }) => class,
            Ok(ShapeKind::Union(members)) => {
                return members
                    .iter()
                    .any(|&member| self.has_parser_under(member, name));
            }
            Ok(_) | Err(_) => return false,
        };
        let prototype =
            builtin_class_of(class.class).and_then(|class| table::class_data(class).prototype);
        prototype.is_some_and(|prototype| match table::member(prototype, name) {
            MemberLookup::Found(method) => table::is_parser(table::canonical_id(method)),
            MemberLookup::Unknown | MemberLookup::Absent => false,
        })
    }

    // The type of the receiver says which class it is of, and the table what the prototype of the class holds under the name.
    fn calls_parser_of_receiver(&mut self, callee: ExprId) -> bool {
        let Some((receiver, MemberKey::Name(name))) = self.hir.member_key(callee) else {
            return false;
        };
        let Some(name) = self.inputs.builtin_names.get(name) else {
            return false;
        };
        match self.queries.expression_type(receiver) {
            Ok(receiver) => self.has_parser_under(receiver, name),
            Err(_) => false,
        }
    }

    // `(await request.json()) as Order`, `const order: Order = await response.json()`: the type is written over the await.
    fn note_what_an_awaited_parse_may_build(&mut self, awaiting: ExprId, operand: ExprId) {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[self.skip_type_syntax(operand)].kind else {
            return;
        };
        let callee = self.skip_type_syntax(hir[id].callee);
        if hir.list_at(hir[id].type_args).is_empty() && self.calls_parser_of_receiver(callee) {
            self.note_what_a_parse_may_build(awaiting);
        }
    }

    fn is_untyped_parse(&mut self, expression: ExprId) -> bool {
        let hir = self.hir;
        let (call, is_awaited) = match hir[expression].kind {
            ExprKind::Await(operand) => (self.skip_type_syntax(operand), true),
            _ => (expression, false),
        };
        let ExprKind::Call(id) = hir[call].kind else {
            return false;
        };
        let callee = self.skip_type_syntax(hir[id].callee);
        hir.list_at(hir[id].type_args).is_empty()
            && match is_awaited {
                true => self.calls_parser_of_receiver(callee),
                false => self.builtins.builtin_of_expression(callee) == Some(BuiltinId::JSONParse),
            }
    }

    // An async function converts what it returns to `Order | PromiseLike<Order>`, which names no layout. A parse answers an `Order`.
    fn type_of_returned_parse(&mut self, returned: ExprId) -> Option<TypeId> {
        if !self.is_untyped_parse(returned) || self.queries.contextual_type(returned) != Ok(None) {
            return None;
        }
        let written = self
            .queries
            .contextual_type_of_settled_value(returned)
            .ok()??;
        let ty = self.result_type(written, self.hir[returned].pos);
        (ty != TypeTable::ANYTHING).then_some(ty)
    }

    fn find_expected_result(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        let hir = self.hir;
        let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
            return None;
        };
        let site = hir[id];
        if hir.list_at(site.type_args).is_empty() {
            let callee = self.skip_type_syntax(site.callee);
            if self.builtins.builtin_of_expression(callee) == Some(BuiltinId::JSONParse) {
                self.note_what_a_parse_may_build(call);
            }
            return None;
        }
        let target = self.queries.resolved_call(call).ok()??;
        self.find_written_result(call, &target)
    }

    fn result_type(&mut self, ty: CheckerTypeId, position: u32) -> TypeId {
        let mapped = self.map_type_at(ty, position);
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
        let written = match target.result.written {
            WrittenType::Written(written) => written,
            WrittenType::Unwritten | WrittenType::GaveUp(_) => return None,
        };
        // The record says what code that the engine cannot see creates. It sees a body.
        if target
            .declaration
            .is_some_and(|declaration| has_body(self, declaration))
        {
            return None;
        }
        let position = self.hir[call].pos;
        let ty = self.result_type(written, position);
        if ty == TypeTable::ANYTHING {
            return None;
        }
        let limit = LimitId::MaxExpectedResultLayouts;
        let Some(layouts) = self.collect_reached_layouts(ty, limit) else {
            self.gave_up(limit, position);
            return None;
        };
        let expected = ExpectedResult { ty, layouts };
        // A built-in may build what its type argument says: `response.json<T>()`.
        let builtin_types = self.inputs.builtin_types;
        let is_builtin = target
            .declaration
            .and_then(|declaration| builtin_types.value_of_call_signature(declaration))
            .and_then(builtin_value_of)
            .is_some();
        Some(match is_builtin {
            true => self.fragment.add_expected_result(expected),
            false => self.fragment.add_described_result(expected),
        })
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn expect_returned_parse(&mut self, returned: ExprId, value: ValueId) -> ValueId {
        match self.file.type_of_returned_parse(returned) {
            Some(ty) => self.expect_type(value, ty),
            None => value,
        }
    }

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

fn has_body(file: &FileLowering<'_, '_, '_, '_>, declaration: FunctionRef) -> bool {
    match file.queries.files().hir(declaration.file)[declaration.function].body {
        FnBody::None => false,
        FnBody::Block(_) | FnBody::Expr(_) => true,
    }
}
