//! The remaining checks of operators, assertions, templates and `yield`: 1186 1355 1360, 2412 2462
//! 2566 2701 2731 2737, 2778 2779, 2796, 2860 2861, 7057, and 2364 for `=`.
//!
//! Follows `checkAssignmentOperator` for `=`, the pattern grammar part of
//! `checkDestructuringAssignment`, `checkAssertion`, `checkSatisfiesExpression`,
//! `checkTemplateExpression`, `resolveTaggedTemplateExpression`, `checkInstanceOfExpression`,
//! `resolveInstanceofExpression` and `checkYieldExpression` of TypeScript 7.0.2's checker.go, and
//! `checkGrammarBigIntLiteral` and `checkGrammarBindingElement` of its grammarchecks.go.
//!
//! Must be called after `check_assignments`: 2412 replaces the 2322 reported there.

use super::*;
use crate::bind::Parent;
use crate::resolve::ScriptTarget;

impl Checker<'_> {
    /// `a = b`. Runs after `check_assignments`, whose diagnostics it replaces.
    pub(super) fn check_x_operators(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Assign) {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[e].kind
                && !bound.is_unchecked(e.idx())
            {
                check_plain_assignment(self, file, target, value);
            }
        }
    }

    /// From `checkAssertion`: 1355.
    pub(super) fn check_const_assertion(&mut self, file: FileId, operand: ExprId) {
        if !matches!(self.hir(file)[operand].kind, ExprKind::Missing)
            && !self.is_valid_const_assertion_argument(file, operand)
        {
            self.error(file, self.hir(file).child(operand), 1355, &[]);
        }
    }

    /// `checkGrammarBigIntLiteral`: 2737. A bigint literal type is not an expression here.
    pub(super) fn check_grammar_big_int_literal(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        if language_version(self) < ScriptTarget::ES2020 && !hir.is_ambient(hir.node(e)) {
            self.error_at((file, hir[e].pos, 0), 2737, &[]);
        }
    }
}

/// `checkGrammarBindingElement`, for an element with `...`: 2462, 2566, 1186. The parser reports the trailing comma (1013).
pub(super) fn check_grammar_rest_element(
    c: &mut Checker<'_>,
    file: FileId,
    name: PatId,
    is_last: bool,
    has_property_name: bool,
    default: ExprId,
) {
    if !is_last {
        c.error(file, name, 2462, &[]);
    } else if has_property_name {
        c.error(file, name, 2566, &[]);
    } else if default.is_some()
        && let Some(start) = start_of_equals_before(c, file, default)
    {
        c.error_at((file, start, 0), 1186, &[]);
    }
}

// ───────────────────────────── source text ─────────────────────────────

/// `GetEmitScriptTarget`: defaults to the latest standard.
pub(super) fn language_version(c: &Checker<'_>) -> ScriptTarget {
    match c.p.files.options.target {
        ScriptTarget::None => ScriptTarget::ES2025,
        reported => reported,
    }
}

/// The end of `GetErrorRangeForNode` of `e` as it appears in the source. 0 if no caller will read
/// it.
fn error_end(c: &Checker<'_>, file: FileId, e: ExprId) -> u32 {
    c.error_end_of(file, e)
}

/// `SkipOuterExpressions(e, OEKAssertions | OEKParentheses)`
fn skip_assertions(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. }
    | ExprKind::Satisfies { expr, .. }
    | ExprKind::AsConst(expr)
    | ExprKind::NonNull(expr) = hir[e].kind
    {
        e = expr;
    }
    e
}

/// Position of the `=` directly before `value`.
pub(super) fn start_of_equals_before(c: &Checker<'_>, file: FileId, value: ExprId) -> Option<u32> {
    let text = &c.hir(file).text;
    let start = (c.start_of(file, value) as usize).min(text.len());
    let end = skip_trivia_back(text, start);
    (end > 0 && text[end - 1] == b'=').then(|| end as u32 - 1)
}

/// Position of the `...` directly before `operand`.
pub(super) fn start_of_dots_before(c: &Checker<'_>, file: FileId, operand: ExprId) -> Option<u32> {
    let text = &c.hir(file).text;
    let start = (c.start_of(file, operand) as usize).min(text.len());
    let end = skip_trivia_back(text, start);
    text[..end].ends_with(b"...").then(|| end as u32 - 3)
}

// ───────────────────────────── kinds of types ─────────────────────────────

/// `TypeFlagsUndefined`
fn is_undefined(_: &Checker<'_>, ty: TypeId) -> bool {
    ty.is_undefined()
}

/// The types of two operands, if both were fully resolved.
fn operand_types(
    c: &mut Checker<'_>,
    file: FileId,
    left: ExprId,
    right: ExprId,
) -> Option<(TypeId, TypeId)> {
    let (l, r) = (c.type_of_expr(file, left), c.type_of_expr(file, right));
    Some((l, r))
}

// ───────────────────────────── binary operators ─────────────────────────────

/// `isLiteralExpressionOfObject`
pub(super) fn is_literal_expression_of_object(hir: &File, e: ExprId) -> bool {
    let is_literal = match hir[e].kind {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Regex | ExprKind::Class(_) => true,
        ExprKind::Fn(f) => hir[f].kind == FnKind::Expr,
        _ => false,
    };
    is_literal && !is_parenthesized(hir, e)
}

// ───────────────────────────── assignment targets ─────────────────────────────

/// `checkReferenceExpression`
fn check_reference_expression(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    invalid: u32,
    optional_chain: u32,
) -> bool {
    let Some(code) = why_no_reference(c.hir(file), e, invalid, optional_chain) else {
        return true;
    };

    c.error(file, c.hir(file).child(e), code, &[]);
    false
}

/// `checkReferenceExpression`: which of the two codes is reported for `e`, if it is not a
/// reference.
pub(super) fn why_no_reference(
    hir: &File,
    e: ExprId,
    invalid: u32,
    optional_chain: u32,
) -> Option<u32> {
    match hir[skip_assertions(hir, e)].kind {
        ExprKind::Ident(_)
        | ExprKind::Missing
        | ExprKind::Dot {
            chain: Chain::No, ..
        }
        | ExprKind::Index {
            chain: Chain::No, ..
        } => None,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => Some(optional_chain),
        _ => Some(invalid),
    }
}

/// `a = b`, as in `checkBinaryLikeExpression`. A pattern is handled by
/// `checkDestructuringAssignment`.
fn check_plain_assignment(c: &mut Checker<'_>, file: FileId, target: ExprId, value: ExprId) {
    let hir = c.hir(file);
    if !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
        || is_parenthesized(hir, target)
    {
        check_assignment_operator(c, file, target, value);
    }
}

/// `checkAssignmentOperator`. `value`: the assigned expression, or `NONE` where the operator
/// transforms it first.
fn check_assignment_operator(c: &mut Checker<'_>, file: FileId, target: ExprId, value: ExprId) {
    if !check_reference_expression(c, file, target, 2364, 2779)
        || value.is_none()
        || !c.p.files.options.exact_optional_property_types
    {
        return;
    }
    // An optional property does not thereby accept `undefined`.
    let hir = c.hir(file);
    let ExprKind::Dot { obj, name, .. } = hir[target].kind else {
        return;
    };
    let Some((object, source)) = operand_types(c, file, obj, value) else {
        return;
    };
    if c.is_any(object) {
        return;
    }
    // A target that cannot be assigned has the error type, to which anything is assignable.
    let left = c.type_of_expr(file, target);
    if c.is_error_type(left) {
        return;
    }
    let there = c.non_nullable(object);
    let Some(expected) = exact_optional_write_type(c, there, name) else {
        return;
    };
    // `isExactOptionalPropertyMismatch`. Only an unparenthesized property access changes the head message. The property is looked
    // up in the type of `obj` itself: an object that is possibly `undefined` or `null` has no such property.
    let is_mismatch = !is_parenthesized(hir, target)
        && c.maybe_type_of_kind(source, is_undefined)
        && c.type_of_property_of_type(object, name)
            .is_some_and(|declared| c.contains_missing_type(declared));
    let at = c.start_of(file, target);
    if !c.check_assignable_with_end(
        file,
        source,
        expected,
        at,
        error_end(c, file, target),
        value,
        if is_mismatch { 2412 } else { 2322 },
    ) && is_mismatch
    {
        c.reported.retain(|d| d.start != at || d.code != 2322);
    }
}

/// The type an assignment to the property `name` of `object` must fit: the type of the property without the missing type
/// (`removeMissingType` in `getFlowTypeOfAccessExpression`). `None` if the property is not optional in any member of `object`, or
/// if some member lacks it.
pub(super) fn exact_optional_write_type(
    c: &mut Checker<'_>,
    object: TypeId,
    name: Atom,
) -> Option<TypeId> {
    let object = c.reduced(object);
    let mut types = Vec::new();
    // `createUnionOrIntersectionProperty`: a property of a union is optional if it is optional in any member.
    let mut is_optional = false;
    for &part in c.parts(object) {
        let apparent = c.apparent_type(part);
        let (prop, mapper) = c.prop_of(apparent, name)?;
        is_optional |= prop.flags.contains(PropFlags::OPTIONAL);
        types.push(c.type_of_prop(&prop, mapper));
    }
    if !is_optional {
        return None;
    }
    let ty = c.union(&types);
    Some(c.remove_missing_type(ty, true))
}

// ───────────────────────────── unary operators ─────────────────────────────

// ───────────────────────────── assertions ─────────────────────────────

/// `checkSatisfiesExpression`
pub(super) fn check_satisfies(
    c: &mut Checker<'_>,
    file: FileId,
    node: ExprId,
    expr: ExprId,
    ty: TypeNodeId,
) {
    let source = c.type_of_expr(file, expr);
    let target = c.type_from_node(file, ty);
    if c.is_assignable(source, target) {
        return;
    }
    let at = c.error_start_inside_parentheses(file, node);
    c.check_type_assignable_to_and_optionally_elaborate(
        source,
        target,
        Some(c.place_of_token(file, at)),
        Some((file, expr)),
        false,
        Some(1360),
        None,
    );
}

// ───────────────────────────── templates ─────────────────────────────

/// `checkTemplateExpression` for the substitutions.
pub(super) fn check_template_spans(c: &mut Checker<'_>, file: FileId, spans: IdList<ExprId>) {
    for span in c.hir(file).ids(spans) {
        let ty = c.type_of_expr(file, span);
        if c.maybe_type_of_kind_considering_base_constraint(ty, Checker::is_symbol_like) {
            c.error(file, c.hir(file).child(span), 2731, &[]);
        }
    }
}

/// `resolveTaggedTemplateExpression`, the paths that do not reach `resolveCall`.
pub(super) fn check_tagged_template(c: &mut Checker<'_>, file: FileId, e: ExprId, call: CallId) {
    let hir = c.hir(file);
    let data = hir[call];
    let tag = c.type_of_expr(file, data.callee);
    let apparent = c.apparent_type(tag);
    let has_call_signatures = !c.signatures(apparent, false).is_empty();
    // `isUntypedFunctionCall`
    let is_untyped = c.is_any(tag)
        || c.is_any(apparent) && matches!(c.data(tag), TypeData::TypeParam(..))
        || !has_call_signatures
            && c.signatures(apparent, true).is_empty()
            && !c.is_union(apparent)
            && !apparent.is_never()
            && {
                let function = c.global_ref(known::Function, &[]);
                c.is_assignable(tag, function)
            };
    if !is_untyped {
        if has_call_signatures {
            return;
        }
        if matches!(c.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Array(_)))
            && !is_parenthesized(hir, e)
        {
            c.error(file, c.hir(file).child(data.callee), 2796, &[]);
        }
    }
    // `resolveUntypedCall`: the template is checked like an untagged one.
    check_template_spans(c, file, data.args);
}

// ───────────────────────────── `instanceof` and `in` ─────────────────────────────

/// `checkInstanceOfExpression`, `resolveInstanceofExpression` for `e`, which is `left instanceof
/// right`: 2358 2359, and 2860 2861 from checking against the signature it resolves to.
pub(super) fn check_instance_of_expression(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    left: ExprId,
    right: ExprId,
) {
    let (l, r) = (c.type_of_expr(file, left), c.type_of_expr(file, right));
    if !c.is_any(l) && c.is_all_assignable_to_primitives(l) {
        c.error(file, c.hir(file).child(left), 2358, &[]);
    }
    if c.is_any(r) {
        return;
    }
    let Some(method) = c.symbol_has_instance_method_of_object_type(r) else {
        let function = c.global_ref(known::Function, &[]);
        if c.signatures(r, false).is_empty()
            && c.signatures(r, true).is_empty()
            && !c.is_subtype(r, function)
        {
            c.error(file, c.hir(file).child(right), 2359, &[]);
        }
        return;
    };
    // The constraint of a type parameter may not have been resolved.
    let apparent_right = c.apparent_type(r);
    if c.is_any(apparent_right) {
        return;
    }
    let apparent = c.apparent_type(method);
    if c.is_any(method) {
        return;
    }
    let signatures = c.signatures(apparent, false);
    if signatures.is_empty() {
        return;
    }
    let resolved = c.resolved_signature(file, e);
    let resolved = c.with_return_type(resolved);
    c.report_call_resolution(file, e);
    let at = c.error_start_of(file, right);
    c.check_type_assignable_to(
        resolved.ret,
        TypeId::BOOLEAN,
        Some((file, at, error_end(c, file, right))),
        Some(2861),
    );
}

/// `hasEmptyObjectIntersection`
pub(super) fn has_empty_object_intersection(c: &mut Checker<'_>, ty: TypeId) -> bool {
    for &part in c.parts(ty) {
        // The `{}` that remains of `unknown`, as opposed to one that is declared or that represents
        // instances of unknown shape.
        if part == TypeId::UNKNOWN_EMPTY_OBJECT {
            return true;
        }
        let TypeData::Intersection(members) = c.data(part) else {
            continue;
        };
        // `T & {}` is `T` where `T extends {}`.
        let mut is_reducible = false;
        for &m in members.iter() {
            if c.is_deferred(m)
                && let Some(constraint) = c.base_constraint_of(m)
            {
                is_reducible |= c.is_empty_anonymous_object_type(constraint);
            }
        }
        let base = c.base_constraint_of(part).unwrap_or(part);
        if !is_reducible && c.is_empty_anonymous_object_type(base) {
            return true;
        }
    }
    false
}

// ───────────────────────────── `yield` ─────────────────────────────

/// `expressionResultIsUnused`
fn is_result_unused(hir: &File, bound: &Bound, mut e: ExprId) -> bool {
    loop {
        match bound.expr_parent[e.idx()] {
            Parent::Stmt(s) if s.is_some() => {
                return match hir[s].kind {
                    StmtKind::Expr(_) => true,
                    StmtKind::For { update, .. } => update == e,
                    _ => false,
                };
            }
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } => {
                    if left == e {
                        return true;
                    }
                    e = parent;
                }
                _ => return false,
            },
            _ => return false,
        }
    }
}

/// The end of `checkYieldExpression`: 7057, nothing specifies the type `yield` evaluates to, and
/// that type matters.
pub(super) fn check_yield_result(c: &mut Checker<'_>, file: FileId, e: ExprId) {
    if !c.p.files.options.no_implicit_any {
        return;
    }
    let (hir, bound) = (c.hir(file), c.bound(file));
    let Some(func) = c.containing_generator(file, e) else {
        return;
    };
    let f = &hir[func];
    if f.ret.is_some() {
        return;
    }
    // `getContextualIterationType`
    if let Some(expected) = c.declared_or_contextual_return_type(file, func, ContextFlags::empty())
        && (!c.is_any(expected)
            && c.iteration_types(expected, f.flags.contains(Flags::ASYNC))
                .is_some())
    {
        return;
    }
    if is_result_unused(hir, bound, e) {
        return;
    }
    // `getContextualTypeForArgumentAtIndex`: the argument of `import()` has the contextual type
    // string.
    if matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::ImportCall { .. }))
    {
        return;
    }
    match c.contextual_type(file, e, ContextFlags::empty()) {
        // `isTypeAny`
        Some(expected) if c.has_any_flag(expected) => {}
        Some(_) => return,
        None => {}
    }
    c.error_at((file, hir[e].pos, 0), 7057, &[]);
}
