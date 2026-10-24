use bun_sema::check::aot::{
    AnythingReason, CallTarget, FunctionRef, GaveUp, ShapeKind, WrittenType,
};
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, FnBody, MemberKey, NodeData};
use bun_sema::util::SharedSort;

use super::nodes::validation_nodes;
use super::{ValidatedFile, ValidationError};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, BuiltinName, MemberLookup};
use crate::builtins::{builtin_class_of, builtin_value_of};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{
    ExpectedResult, LimitId, TypeSiteKind, ValidationNode, ValidationShape,
};
use crate::ir::{ExpectedResultId, Primitives, TypeId, TypeTable};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::{CheckerTypeId, FileLowering};
pub(super) use crate::validation_plans::ValidatingFunction;

pub(super) fn find_validating_function(builtin: BuiltinId) -> Option<ValidatingFunction> {
    match builtin {
        BuiltinId::JSONParse | BuiltinId::BunJSONParse => Some(ValidatingFunction::Parse),
        BuiltinId::BunBundleValidate => Some(ValidatingFunction::Validate),
        _ => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // `const config: Config = JSON.parse(text)`, `JSON.parse(text) as Order`: the parse may build its answer with the layouts of the type that it is written under.
    fn note_what_a_parse_may_build(&mut self, answer: ExprId) {
        let Ok(Some(written)) = self.queries.contextual_type(answer) else {
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
    pub(super) fn note_what_an_awaited_parse_may_build(
        &mut self,
        awaiting: ExprId,
        operand: ExprId,
    ) {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[self.skip_type_syntax(operand)].kind else {
            return;
        };
        let callee = self.skip_type_syntax(hir[id].callee);
        if hir.list_at(hir[id].type_args).is_empty() && self.calls_parser_of_receiver(callee) {
            self.note_what_a_parse_may_build(awaiting);
        }
    }

    pub(super) fn find_expected_result(&mut self, call: ExprId) -> Option<ExpectedResultId> {
        let hir = self.hir;
        let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
            return None;
        };
        let site = hir[id];
        let callee = self.skip_type_syntax(site.callee);
        let resolved = self.builtins.builtin_of_expression(callee);
        let resolved = resolved.and_then(find_validating_function);
        let has_type_arguments = !hir.list_at(site.type_args).is_empty();
        match resolved {
            Some(ValidatingFunction::Validate) => {
                return self.find_validated_result(call, &site, ValidatingFunction::Validate);
            }
            Some(ValidatingFunction::Parse) if !has_type_arguments => {
                self.note_what_a_parse_may_build(call);
                return self.find_validated_result(call, &site, ValidatingFunction::Parse);
            }
            None if !has_type_arguments => return None,
            // Whatever signature the callee is written under, what is called is `parse`.
            Some(ValidatingFunction::Parse) => {
                return self.find_validated_result(call, &site, ValidatingFunction::Parse);
            }
            None => {}
        }
        let Ok(Some(target)) = self.queries.resolved_call(call) else {
            return None;
        };
        let builtin_types = self.inputs.builtin_types;
        let declared = target
            .declaration
            .and_then(|declaration| builtin_types.value_of_call_signature(declaration))
            .and_then(builtin_value_of)
            .and_then(find_validating_function);
        let Some(function) = declared else {
            return self.find_written_result(call, &target);
        };
        let expected = self.find_validated_result(call, &site, function);
        if expected.is_some() {
            self.report_at(call, Code::TypedParseCalleeIsNotResolved, &[]);
        }
        expected
    }

    pub(in crate::lower) fn asks_for_no_check(&mut self, call: ExprId) -> bool {
        self.is_any_written(call)
    }

    // `parse` of the `JSON` that "bun" exports throws when it is reached.
    pub(in crate::lower) fn calls_parse_of_bun(&self, callee: ExprId) -> bool {
        let callee = self.skip_type_syntax(callee);
        self.builtins.builtin_of_expression(callee) == Some(BuiltinId::BunJSONParse)
    }

    pub(super) fn result_type(&mut self, ty: CheckerTypeId, position: u32) -> TypeId {
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
        let expected = ExpectedResult {
            ty,
            layouts,
            site: None,
            validation: Vec::new(),
        };
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

    pub(super) fn add_expected_result(
        &mut self,
        call: ExprId,
        ty: CheckerTypeId,
        validation: Vec<ValidationNode>,
    ) -> Result<ExpectedResultId, ValidationError> {
        let position = self.hir[call].pos;
        let result = self.result_type(ty, position);
        let limit = LimitId::MaxValidationNodes;
        let Some(mut layouts) = self.collect_reached_layouts(result, limit) else {
            self.gave_up(limit, position);
            return Err(ValidationError::TooLarge);
        };
        for node in &validation {
            if let ValidationShape::Object {
                layout: Some(layout),
                ..
            } = &node.shape
            {
                layouts.push(*layout);
            }
        }
        layouts.shared_sort_unstable();
        layouts.dedup();
        let origin = SiteOrigin {
            kind: TypeSiteKind::CallResult,
            position,
        };
        let site = Some(positions::add_type_site(self, origin, Some(ty)));
        Ok(self.fragment.add_expected_result(ExpectedResult {
            ty: result,
            layouts,
            site,
            validation,
        }))
    }

    pub(super) fn report_at(&mut self, expression: ExprId, code: Code, arguments: &[&[u8]]) {
        let span = self.span_of(NodeData::Expr(expression));
        self.diagnostics.report(code, span, arguments);
    }
}

/// A call of `JSON.parse<T>()` or `validate<T>()`: the nodes of `T`, or what is wrong with the call.
pub(super) trait FindsValidatedResults<'c, 'p: 'c, 's: 'p>:
    ValidatedFile<'c, 'p, 's> + Sized
{
    fn find_validated_result(
        &mut self,
        call: ExprId,
        site: &Call,
        function: ValidatingFunction,
    ) -> Option<ExpectedResultId> {
        match function {
            ValidatingFunction::Validate => {
                if let Err(code) = self.check_validate_call(site) {
                    self.report_at(call, code, &[]);
                    return None;
                }
            }
            ValidatingFunction::Parse if self.hir().list_at(site.type_args).is_empty() => {
                if self.calls_parse_of_bun(site.callee) {
                    self.report_at(call, Code::TypedParseNeedsTypeArgument, &[]);
                }
                return None;
            }
            ValidatingFunction::Parse => {}
        }
        let checked = match self.queries().resolved_call(call) {
            Ok(Some(target)) => target.result.checked,
            // The callee is `any` to the checker, and so is what it returns.
            Ok(None) => {
                self.report_unless_any_is_written(call);
                return None;
            }
            Err(reason) => Err(reason),
        };
        let ty = match checked {
            Ok(ty) => ty,
            Err(reason) => {
                let error = ValidationError::GaveUp(reason);
                self.report_validation_error(call, function, None, &error);
                return None;
            }
        };
        let shape = self.queries().type_shape(ty).map(|shape| shape.kind);
        if let Ok(ShapeKind::Anything(AnythingReason::Any | AnythingReason::Unknown)) = shape {
            self.report_unless_any_is_written(call);
            return None;
        }
        let position = self.hir()[call].pos;
        let written = self.hir().ids(self.hir().list_at(site.type_args)).next()?;
        let expected = match validation_nodes(self, ty, written, position) {
            Ok(nodes) => self.add_expected_result(call, ty, nodes.to_vec()),
            Err(error) => Err(error),
        };
        match expected {
            Ok(expected) => Some(expected),
            Err(error) => {
                self.report_validation_error(call, function, Some(ty), &error);
                None
            }
        }
    }

    // Only the two words themselves ask for no check, and only alone. A name that stands for one of them may do so by an oversight.
    fn is_any_written(&mut self, call: ExprId) -> bool {
        let hir = self.hir();
        let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
            return false;
        };
        let is_alone = hir.ids(hir.list_at(hir[id].type_args)).count() == 1;
        let written = self.find_type_text(call, None);
        is_alone && matches!(written.trim_ascii(), b"any" | b"unknown")
    }

    fn report_unless_any_is_written(&mut self, call: ExprId) {
        if !self.is_any_written(call) {
            let written = self.find_type_text(call, None);
            self.report_at(call, Code::ValidationTypeIsAny, &[written.as_slice()]);
        }
    }

    fn check_validate_call(&self, site: &Call) -> Result<(), Code> {
        let hir = self.hir();
        if hir.is_js {
            return Err(Code::ValidateNeedsTypeScript);
        }
        if hir.list_at(site.type_args).is_empty() {
            return Err(Code::ValidateNeedsTypeArgument);
        }
        if site.chain == Chain::Start {
            return Err(Code::ValidateOptionalCall);
        }
        match hir.ids(site.args).next() {
            Some(argument)
                if site.args.len() == 1 && !matches!(hir[argument].kind, ExprKind::Spread(_)) =>
            {
                Ok(())
            }
            Some(_) | None => Err(Code::ValidateArgumentCount),
        }
    }

    fn report_validation_error(
        &mut self,
        call: ExprId,
        function: ValidatingFunction,
        ty: Option<CheckerTypeId>,
        error: &ValidationError,
    ) {
        let described = match error {
            ValidationError::TypeParameter { text } => {
                self.report_at(call, Code::ValidationTypeParameter, &[text.as_slice()]);
                return;
            }
            // The checker's own error may have been silenced (`// @ts-ignore`, `// @ts-nocheck`).
            ValidationError::GaveUp(GaveUp::ErrorType) => {
                let written = self.find_type_text(call, None);
                self.report_at(call, Code::ValidationTypeIsAny, &[written.as_slice()]);
                return;
            }
            ValidationError::Unsupported { described } => Some(described.as_slice()),
            ValidationError::TooLarge
            | ValidationError::GaveUp(
                GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::UnreachedNode,
            ) => None,
        };
        let type_text = self.find_type_text(call, ty);
        let described = described.unwrap_or(type_text.as_slice());
        let arguments = [callee_text(function), type_text.as_slice(), described];
        self.report_at(call, Code::UnsupportedValidationType, &arguments);
    }

    fn find_type_text(&mut self, call: ExprId, ty: Option<CheckerTypeId>) -> Vec<u8> {
        if let Some(ty) = ty {
            return self.queries().type_text(ty);
        }
        let hir = self.hir();
        let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
            return Vec::new();
        };
        let Some(argument) = hir.ids(hir.list_at(hir[id].type_args)).next() else {
            return Vec::new();
        };
        let range = hir[argument].pos as usize..hir[argument].end as usize;
        hir.text.get(range).unwrap_or_default().to_vec()
    }
}

impl<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>> FindsValidatedResults<'c, 'p, 's> for F {}

fn callee_text(function: ValidatingFunction) -> &'static [u8] {
    match function {
        ValidatingFunction::Parse => b"JSON.parse",
        ValidatingFunction::Validate => b"validate",
    }
}

fn has_body(file: &FileLowering<'_, '_, '_, '_>, declaration: FunctionRef) -> bool {
    match file.queries.files().hir(declaration.file)[declaration.function].body {
        FnBody::None => false,
        FnBody::Block(_) | FnBody::Expr(_) => true,
    }
}
