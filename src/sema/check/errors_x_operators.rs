//! What is left of the operators, assertions, templates and `yield`: 1186 1355 1360, 2412 2462 2566 2701 2731 2737, 2778 2779, 2796,
//! 2860 2861, 7057, and 2364 of `=`.
//!
//! Follows `checkAssignmentOperator` for `=`, `checkDestructuringAssignment` as far as the grammar of a pattern goes, `checkAssertion`,
//! `checkSatisfiesExpression`, `checkTemplateExpression`, `resolveTaggedTemplateExpression`, `checkInstanceOfExpression`,
//! `resolveInstanceofExpression` and `checkYieldExpression` of TypeScript 7.0.2's checker.go, and `checkGrammarBigIntLiteral` and
//! `checkGrammarBindingElement` of its grammarchecks.go.
//!
//! To be called after `check_assignments`: 2412 takes the place of the 2322 that is said there.

use super::call::CallLike;
use super::errors::Diagnostic;
use super::*;
use crate::bind::{FnOwner, Parent, PatParent};
use crate::resolve::ScriptTarget;

impl Checker<'_> {
    pub(super) fn check_x_operators(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        for i in 0..hir.exprs.len() {
            if bound.is_unchecked(i) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    left,
                    right,
                } => check_instanceof(self, file, e, left, right, out),
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => check_plain_assignment(self, file, target, value, out),
                // `checkAssertion`
                ExprKind::AsConst(operand) => {
                    if !matches!(self.hir(file)[operand].kind, ExprKind::Missing)
                        && !self.is_valid_const_assertion_argument(file, operand)
                    {
                        let start = start_of_const_asserted(self, file, operand);
                        out.push(Diagnostic { start, code: 1355 });
                        let end = if start < self.start_inside_parentheses(file, operand) {
                            self.end_of_expr_from(file, operand, start)
                        } else {
                            self.error_end_inside_parentheses(file, operand)
                        };
                        self.note(start, end, 1355, Vec::new());
                    }
                }
                ExprKind::Satisfies { expr, ty } => check_satisfies(self, file, e, expr, ty, out),
                // `checkTaggedTemplateExpression` never comes to `checkTemplateExpression`.
                ExprKind::Template { .. }
                    if matches!(bound.expr_parent[i], Parent::Expr(p)
                        if matches!(hir[p].kind, ExprKind::TaggedTemplate(c) if hir[c].template == e)) =>
                    {}
                ExprKind::Template { exprs, .. } => check_template_spans(self, file, exprs, out),
                ExprKind::TaggedTemplate(call) => check_tagged_template(self, file, e, call, out),
                // `checkGrammarBigIntLiteral`. One that is a type is not an expression here.
                ExprKind::BigInt(_) => {
                    if language_version(self) < ScriptTarget::ES2020
                        && !hir.has_errors
                        && !hir.is_ambient(hir.node(e))
                    {
                        out.push(Diagnostic {
                            start: hir.exprs[i].pos,
                            code: 2737,
                        });
                    }
                }
                ExprKind::Yield { star: false, .. } => check_yield_result(self, file, e, out),
                _ => {}
            }
        }
        for s in 0..hir.stmts.len() {
            // `checkForOfStatement`: what is on the left may be a pattern.
            if let StmtKind::ForOf { left, .. } = hir.stmts[s].kind
                && !matches!(bound.stmt_parent[s], Parent::None)
                && let StmtKind::Expr(target) = hir[left].kind
                && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                && !is_parenthesized(hir, target)
            {
                check_assignment_pattern(self, file, target, out);
            }
        }
        // `checkGrammarBindingElement`
        if !has_parse_diagnostics(hir) {
            for p in 0..hir.pats.len() {
                if matches!(bound.pat_parent[p], PatParent::None) {
                    continue;
                }
                match hir.pats[p].kind {
                    PatKind::Array(elems) => {
                        for (i, elem) in elems
                            .iter()
                            .map(|e| &hir[e])
                            .enumerate()
                            .filter(|(_, elem)| elem.is_rest)
                        {
                            check_grammar_rest_element(
                                self,
                                file,
                                elem.pat,
                                i + 1 == elems.len(),
                                false,
                                elem.default,
                                out,
                            );
                        }
                    }
                    PatKind::Object(props) => {
                        for (i, prop) in props
                            .iter()
                            .map(|q| &hir[q])
                            .enumerate()
                            .filter(|(_, prop)| prop.is_rest)
                        {
                            check_grammar_rest_element(
                                self,
                                file,
                                prop.value,
                                i + 1 == props.len(),
                                !matches!(prop.key, PropKey::None),
                                prop.default,
                                out,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// `checkGrammarBindingElement`, for an element with `...`: 2462, 2566, 1186. The parser reports the trailing comma (1013).
fn check_grammar_rest_element(
    c: &Checker<'_>,
    file: FileId,
    name: PatId,
    is_last: bool,
    has_property_name: bool,
    default: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    let start = hir[name].pos;
    if !is_last {
        out.push(Diagnostic { start, code: 2462 });
        c.note(start, c.end_of_pat(file, name), 2462, Vec::new());
    } else if has_property_name {
        out.push(Diagnostic { start, code: 2566 });
        c.note(start, c.end_of_pat(file, name), 2566, Vec::new());
    } else if default.is_some()
        && let Some(start) = start_of_equals_before(c, file, default)
    {
        out.push(Diagnostic { start, code: 1186 });
    }
}

// ───────────────────────────── how it is written ─────────────────────────────

/// `GetEmitScriptTarget`: unsaid, it is the latest standard.
pub(super) fn language_version(c: &Checker<'_>) -> ScriptTarget {
    match c.p.files.options.target {
        ScriptTarget::None => ScriptTarget::ES2025,
        said => said,
    }
}

/// The end of `GetErrorRangeForNode` of `e` as it is written. 0 if nobody is going to read it.
fn error_end(c: &Checker<'_>, file: FileId, e: ExprId) -> u32 {
    if c.explains {
        c.error_end_of(file, e)
    } else {
        0
    }
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

/// Where the `=` right before `value` is.
fn start_of_equals_before(c: &Checker<'_>, file: FileId, value: ExprId) -> Option<u32> {
    let text = &c.hir(file).text;
    let start = (c.start_of(file, value) as usize).min(text.len());
    let end = skip_trivia_back(text, start);
    (end > 0 && text[end - 1] == b'=').then(|| end as u32 - 1)
}

/// Where the `...` right before `operand` is.
fn start_of_dots_before(c: &Checker<'_>, file: FileId, operand: ExprId) -> Option<u32> {
    let text = &c.hir(file).text;
    let start = (c.start_of(file, operand) as usize).min(text.len());
    let end = skip_trivia_back(text, start);
    text[..end].ends_with(b"...").then(|| end as u32 - 3)
}

/// From `from`, right before which `open` parentheses open: how many of them have closed by the time `as const` is written outside
/// every bracket opened since. The first `skip` times it is written do not count.
fn closed_before_const_assertion(text: &[u8], from: usize, open: usize, mut skip: usize) -> usize {
    let (mut i, mut depth, mut closed) = (from, 0usize, 0usize);
    while i < text.len() && closed < open {
        let b = text[i];
        match b {
            b'"' | b'\'' | b'`' => {
                i += 1;
                while i < text.len() && text[i] != b {
                    i += if text[i] == b'\\' { 2 } else { 1 };
                }
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => closed += 1,
            b')' | b']' | b'}' => depth -= 1,
            _ if !word_at(text, i).is_empty() => {
                let word = word_at(text, i);
                i += word.len();
                if depth == 0 && word == b"as" && is_word_at(text, skip_trivia(text, i), b"const") {
                    if skip == 0 {
                        return closed;
                    }
                    skip -= 1;
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    closed
}

/// Where the operand of `operand as const` starts. Parentheses are noted on the outermost assertion made of an expression, whether
/// they are around the assertion or around what is asserted: the text tells which.
fn start_of_const_asserted(c: &Checker<'_>, file: FileId, operand: ExprId) -> u32 {
    let hir = c.hir(file);
    let inside = c.start_inside_parentheses(file, operand);
    let text = &hir.text;
    // The parentheses that open right before it, from the inside out.
    let mut open = Vec::new();
    let mut at = (inside as usize).min(text.len());
    loop {
        let end = skip_trivia_back(text, at);
        if end == 0 || text[end - 1] != b'(' {
            break;
        }
        at = end - 1;
        open.push(at as u32);
    }
    if open.is_empty() {
        return c.error_start_inside_parentheses(file, operand);
    }
    // The `as const` that are part of the operand.
    let (mut within, mut x) = (0, operand);
    loop {
        x = match hir[x].kind {
            ExprKind::AsConst(inner) => {
                within += 1;
                inner
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => expr,
            _ => break,
        };
    }
    match closed_before_const_assertion(text, inside as usize, open.len(), within) {
        0 => c.error_start_inside_parentheses(file, operand),
        closed => open[closed - 1],
    }
}

// ───────────────────────────── kinds of types ─────────────────────────────

/// `TypeFlagsUndefined`
fn is_undefined(_: &Checker<'_>, ty: TypeId) -> bool {
    ty.is_undefined()
}

/// The types of two operands, if both were found out for sure.
fn operand_types(
    c: &mut Checker<'_>,
    file: FileId,
    left: ExprId,
    right: ExprId,
) -> Option<(TypeId, TypeId)> {
    let (l, r) = (c.type_of_expr(file, left), c.type_of_expr(file, right));
    (c.is_known(l) && c.is_known(r)).then_some((l, r))
}

/// `getTypeOfPropertyOfType`, of a type that is not a union: index signatures do not count.
fn type_of_declared_property(c: &mut Checker<'_>, ty: TypeId, name: Atom) -> Option<TypeId> {
    let apparent = c.apparent_type(ty);
    let members = c.members(apparent)?;
    let (prop, mapper) = c.property_of_type(&members, name)?;
    Some(c.type_of_prop(&prop, mapper))
}

/// `getTypeOfPropertyOfType`. In a union, a member that lacks what another declares may make up for it with an index signature.
pub(super) fn type_of_property_of_type(
    c: &mut Checker<'_>,
    ty: TypeId,
    name: Atom,
) -> Option<TypeId> {
    let ty = c.reduced(ty);
    if !c.is_union(ty) {
        return type_of_declared_property(c, ty, name);
    }
    let mut is_declared = false;
    for &part in c.parts(ty) {
        is_declared |= type_of_declared_property(c, part, name).is_some();
    }
    if is_declared {
        c.type_of_property(ty, name)
    } else {
        None
    }
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

// ───────────────────────────── what is assigned to ─────────────────────────────

/// `checkReferenceExpression`
fn check_reference_expression(
    c: &Checker<'_>,
    file: FileId,
    e: ExprId,
    invalid: u32,
    optional_chain: u32,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let Some(code) = why_no_reference(c.hir(file), e, invalid, optional_chain) else {
        return true;
    };
    let start = c.error_start_of(file, e);
    out.push(Diagnostic { start, code });
    c.note(start, c.error_end_of(file, e), code, Vec::new());
    false
}

/// `checkReferenceExpression`: which of the two codes `e` gets, if it is no reference.
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

/// `a = b`, as `checkBinaryLikeExpression` has it.
fn check_plain_assignment(
    c: &mut Checker<'_>,
    file: FileId,
    target: ExprId,
    value: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    if !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
        || is_parenthesized(hir, target)
    {
        return check_assignment_operator(c, file, target, value, out);
    }
    check_assignment_pattern(c, file, target, out);
}

/// `checkObjectLiteralAssignment`, `checkArrayLiteralAssignment`, for what they say of the targets themselves.
fn check_assignment_pattern(
    c: &Checker<'_>,
    file: FileId,
    pattern: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    match hir[pattern].kind {
        ExprKind::Object(props) => {
            for (i, p) in props.iter().enumerate() {
                let prop = &hir[p];
                let is_rest = prop.kind == PropKind::Spread;
                if prop.value.is_none() {
                    continue;
                }
                // Nothing else is checked of a rest that is not the last, nor of a member that is no property.
                if is_rest && i + 1 < props.len() {
                    if let Some(start) = start_of_dots_before(c, file, prop.value) {
                        out.push(Diagnostic { start, code: 2462 });
                        c.note(start, c.end_of_prop(file, p), 2462, Vec::new());
                    }
                } else if is_rest || matches!(prop.kind, PropKind::Init | PropKind::Shorthand) {
                    check_assignment_element(c, file, prop.value, is_rest, out);
                }
            }
        }
        ExprKind::Array(items) => {
            for (i, item) in hir.ids(items).enumerate() {
                match hir[item].kind {
                    ExprKind::Missing => {}
                    ExprKind::Spread(_) if i + 1 < items.len() => {
                        let start = hir[item].pos;
                        out.push(Diagnostic { start, code: 2462 });
                        c.note(start, c.end_of_expr(file, item), 2462, Vec::new());
                    }
                    ExprKind::Spread(rest) => match hir[rest].kind {
                        ExprKind::Assign {
                            op: None, value, ..
                        } if !is_parenthesized(hir, rest) => {
                            if let Some(start) = start_of_equals_before(c, file, value) {
                                out.push(Diagnostic { start, code: 1186 });
                            }
                        }
                        _ => check_assignment_element(c, file, rest, false, out),
                    },
                    _ => check_assignment_element(c, file, item, false, out),
                }
            }
        }
        _ => {}
    }
}

/// `checkDestructuringAssignment`, of what stands in a pattern. `is_object_rest`: it is what follows the dots in `{ ...x }`.
fn check_assignment_element(
    c: &Checker<'_>,
    file: FileId,
    e: ExprId,
    is_object_rest: bool,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    if !is_parenthesized(hir, e) {
        match hir[e].kind {
            // With a default it is an assignment, and is looked at as the assignment it is.
            ExprKind::Assign { op: None, .. } => return,
            ExprKind::Object(_) | ExprKind::Array(_) => {
                return check_assignment_pattern(c, file, e, out);
            }
            _ => {}
        }
    }
    // `checkReferenceAssignment`
    let (invalid, optional_chain) = if is_object_rest {
        (2701, 2778)
    } else {
        (2364, 2779)
    };
    check_reference_expression(c, file, e, invalid, optional_chain, out);
}

/// `checkAssignmentOperator`. `value`: what is assigned, or `NONE` where the operator makes something else of it first.
fn check_assignment_operator(
    c: &mut Checker<'_>,
    file: FileId,
    target: ExprId,
    value: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    if !check_reference_expression(c, file, target, 2364, 2779, out)
        || value.is_none()
        || !c.p.files.options.exact_optional_property_types
    {
        return;
    }
    // What may be left out is not for that reason allowed to be `undefined`.
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
    // What cannot be written to has the error type, and anything goes into that.
    let left = c.type_of_expr(file, target);
    if c.is_error_type(left) {
        return;
    }
    let there = c.non_nullable(object);
    let Some(wanted) = exact_optional_write_type(c, there, name) else {
        return;
    };
    // `isExactOptionalPropertyMismatch`. Only an unparenthesized property access changes the head message. The property is looked
    // up in the type of `obj` itself: an object that is possibly `undefined` or `null` has no such property.
    let is_mismatch = !is_parenthesized(hir, target)
        && c.maybe_type_of_kind(source, is_undefined)
        && type_of_property_of_type(c, object, name)
            .is_some_and(|declared| c.contains_missing_type(declared));
    let at = c.start_of(file, target);
    if !c.check_assignable_with_end_from(
        file,
        source,
        wanted,
        at,
        |c| error_end(c, file, target),
        value,
        if is_mismatch { 2412 } else { 2322 },
        out,
    ) && is_mismatch
    {
        out.retain(|d| d.start != at || d.code != 2322);
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
fn check_satisfies(
    c: &mut Checker<'_>,
    file: FileId,
    node: ExprId,
    expr: ExprId,
    ty: TypeNodeId,
    out: &mut Vec<Diagnostic>,
) {
    let source = c.type_of_expr(file, expr);
    let target = c.type_from_node(file, ty);
    if !c.is_known(source) || !c.is_known(target) || c.is_assignable(source, target) {
        return;
    }
    let at = c.error_start_inside_parentheses(file, node);
    c.check_assignable(file, source, target, at, expr, 1360, out);
}

// ───────────────────────────── templates ─────────────────────────────

/// `checkTemplateExpression`, of what is substituted.
fn check_template_spans(
    c: &mut Checker<'_>,
    file: FileId,
    spans: IdList<ExprId>,
    out: &mut Vec<Diagnostic>,
) {
    for span in c.hir(file).ids(spans) {
        let ty = c.type_of_expr(file, span);
        if c.is_known(ty)
            && c.maybe_type_of_kind_considering_base_constraint(ty, Checker::is_symbol_like)
        {
            let start = c.error_start_of(file, span);
            out.push(Diagnostic { start, code: 2731 });
            c.note(start, c.error_end_of(file, span), 2731, Vec::new());
        }
    }
}

/// `resolveTaggedTemplateExpression`, where it does not come to `resolveCall`.
fn check_tagged_template(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    call: CallId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    let data = hir[call];
    let tag = c.type_of_expr(file, data.callee);
    if !c.is_known(tag) {
        return;
    }
    let apparent = c.apparent_type(tag);
    if !c.is_known(apparent) {
        return;
    }
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
            let start = c.error_start_of(file, data.callee);
            out.push(Diagnostic { start, code: 2796 });
            c.note(start, c.error_end_of(file, data.callee), 2796, Vec::new());
        }
    }
    // `resolveUntypedCall`: the template is looked at like one without a tag.
    check_template_spans(c, file, data.args, out);
}

// ───────────────────────────── `instanceof` and `in` ─────────────────────────────

/// What `checkInstanceOfExpression` makes of the signature `e`, which is `left instanceof right`, resolves to: 2860 2861
fn check_instanceof(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    left: ExprId,
    right: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let r = c.type_of_expr(file, right);
    if !c.is_known(r) || c.is_any(r) {
        return;
    }
    // What a type parameter extends may not have been found out.
    let apparent_right = c.apparent_type(r);
    if !c.is_known(apparent_right) || c.is_any(apparent_right) {
        return;
    }
    let Some(method) = c.symbol_has_instance_method_of_object_type(r) else {
        return;
    };
    let apparent = c.apparent_type(method);
    if !c.is_known(method) || !c.is_known(apparent) || c.is_any(method) {
        return;
    }
    let l = c.type_of_expr(file, left);
    if !c.is_known(l) {
        return;
    }
    let signatures = c.signatures(apparent, false);
    if signatures.is_empty() {
        return;
    }
    let resolved = c.resolve_call(file, e);
    let node = CallLike::InstanceOf { left, right };
    c.report_call_resolution(file, e, node, &signatures, resolved, Some(2860), out);
    let at = c.error_start_of(file, right);
    c.check_assignable_with_end_from(
        file,
        resolved.ret,
        TypeId::BOOLEAN,
        at,
        |c| error_end(c, file, right),
        ExprId::NONE,
        2861,
        out,
    );
}

/// `hasEmptyObjectIntersection`
pub(super) fn has_empty_object_intersection(c: &mut Checker<'_>, ty: TypeId) -> bool {
    for &part in c.parts(ty) {
        // The `{}` that is left of `unknown`, as opposed to one that is written or stands for instances nothing is known of.
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

/// The end of `checkYieldExpression`: 7057, nothing says what `yield` gives, and it is not all the same.
fn check_yield_result(c: &mut Checker<'_>, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
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
    if let FnOwner::Expr(owner) = bound.fns[func.idx()].owner
        && !c.is_context_known(file, owner)
    {
        return;
    }
    if let Some(expected) = c.declared_or_contextual_return_type(file, func)
        && (!c.is_known(expected)
            || !c.is_any(expected)
                && c.iteration_types(expected, f.flags.contains(Flags::ASYNC))
                    .is_some())
    {
        return;
    }
    if is_result_unused(hir, bound, e) {
        return;
    }
    // `getContextualTypeForArgumentAtIndex`: what `import()` is given is expected to be a string.
    if matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::ImportCall { .. }))
    {
        return;
    }
    match c.contextual_type(file, e) {
        // `isTypeAny`
        Some(expected) if c.has_any_flag(expected) => {}
        Some(_) => return,
        None if !c.is_context_known(file, e) => return,
        None => {}
    }
    out.push(Diagnostic {
        start: hir[e].pos,
        code: 7057,
    });
}
