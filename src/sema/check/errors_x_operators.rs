//! Operators, assertions, templates, `await`, `yield`, and the way things are gone through:
//! 1186 1320 1355 1360, 2412 2462 2490 2495 2566 2638 2701 2731 2736 2737, 2763 2764 2765 2766 2767, 2777 2778 2779, 2791 2796 2839,
//! 2860 2861, 6807, 7057.
//!
//! The functions followed say more, which is said here as well wherever they say it: 1062, 2357 2359 2364 2469, 2461 2488 2489 2504
//! 2519 2547 2768 2802, and what `checkNonNullType` has to say of the operand of `+`, `-` and `~`.
//!
//! Follows `checkBinaryLikeExpression`, `checkAssignmentOperator`, `checkReferenceExpression`, `checkDestructuringAssignment` with what
//! it calls, `checkPrefixUnaryExpression`, `checkPostfixUnaryExpression`, `checkAssertion`, `checkSatisfiesExpression`,
//! `checkTemplateExpression`, `resolveTaggedTemplateExpression`, `checkInstanceOfExpression`, `resolveInstanceofExpression`,
//! `checkInExpression`, `checkAwaitExpression`, `getAwaitedTypeNoAliasEx`, `checkYieldExpression`, `getIteratedTypeOrElementType` and
//! `getIterationTypesOfIterable` with what they call, of TypeScript 7.0.2's checker.go, and `checkGrammarBigIntLiteral` and
//! `checkGrammarBindingElement` of its grammarchecks.go.
//!
//! To be called after `check_assignments`: 2412 takes the place of the 2322 that is said there.

use super::call::CallLike;
use super::errors::Diagnostic;
use super::explain::Line;
use super::relate::Relation;
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent, PatParent};
use crate::resolve::ScriptTarget;
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_x_operators(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let mut sites = Vec::new();
        let mut awaiting = Awaiting::new(file, 1320);
        for i in 0..hir.exprs.len() {
            if bound.is_unchecked(i) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Binary { .. } | ExprKind::Assign { op: Some(_), .. } => {
                    check_binary_like(self, file, e, out)
                }
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => check_plain_assignment(self, file, target, value, &mut sites, out),
                ExprKind::Unary { op, operand } => check_unary(self, file, op, operand, out),
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
                        && !is_in_ambient_context(self, file, e)
                    {
                        out.push(Diagnostic {
                            start: hir.exprs[i].pos,
                            code: 2737,
                        });
                    }
                }
                // `checkAwaitExpression`. What has been awaited has nothing left to await, or was an error and can be anything.
                ExprKind::Await(operand) if !matches!(hir[operand].kind, ExprKind::Await(_)) => {
                    let ty = self.type_of_expr(file, operand);
                    if !self.is_uncertain(file, operand) {
                        awaiting.begin(hir.exprs[i].pos, ErrorNode::Inside(e));
                        has_awaited_type(self, ty, &mut awaiting);
                        if !awaiting.unknown {
                            out.append(&mut awaiting.said);
                        }
                    }
                }
                ExprKind::Yield { value, star: true } => {
                    note_yield_star(self, file, e, value, &mut sites)
                }
                ExprKind::Yield { star: false, .. } => check_yield_result(self, file, e, out),
                // `checkSpreadExpression`: `[...x]`, `f(...x)`
                ExprKind::Spread(inner)
                    if matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Array(_) | ExprKind::Call(_) | ExprKind::New(_)))
                        && !self.is_assignment_target(file, e) =>
                {
                    let input = self.type_of_expr(file, inner);
                    if !self.is_uncertain(file, inner) {
                        let at = self.error_start_of(file, inner);
                        sites.push(IterationSite {
                            usage: IterationUse::Spread,
                            input,
                            sent: TypeId::UNDEFINED,
                            at,
                            node: ErrorNode::Written(inner),
                        });
                    }
                }
                _ => {}
            }
        }
        for s in 0..hir.stmts.len() {
            let StmtKind::ForOf {
                left,
                expr,
                is_await,
                ..
            } = hir.stmts[s].kind
            else {
                continue;
            };
            if matches!(bound.stmt_parent[s], Parent::None) {
                continue;
            }
            // `checkForOfStatement`: what is on the left may be a pattern.
            let pattern = match hir[left].kind {
                StmtKind::Expr(target)
                    if matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                        && !is_parenthesized(hir, target) =>
                {
                    check_assignment_pattern(self, file, target, out);
                    target
                }
                _ => ExprId::NONE,
            };
            // `checkRightHandSideOfForOf`
            let given = self.type_of_expr(file, expr);
            if self.is_uncertain(file, expr) {
                continue;
            }
            let given = self.non_null_type(given);
            let usage = if is_await {
                IterationUse::ForAwaitOf
            } else {
                IterationUse::ForOf
            };
            let at = self.error_start_of(file, expr);
            sites.push(IterationSite {
                usage,
                input: given,
                sent: TypeId::UNDEFINED,
                at,
                node: ErrorNode::Written(expr),
            });
            if pattern.is_some() && self.is_known(given) && !self.is_any(given) {
                let input = self.iterated_type(given, is_await);
                note_assignment_pattern(self, file, pattern, input, &mut sites);
            }
        }
        // `getBindingElementTypeFromParentType`: what an array pattern takes apart is gone through, for the sake of an element.
        for p in 0..hir.pats.len() {
            let PatKind::Array(elems) = hir.pats[p].kind else {
                continue;
            };
            if matches!(bound.pat_parent[p], PatParent::None)
                || elems
                    .iter()
                    .all(|elem| matches!(hir[hir[elem].pat].kind, PatKind::Missing))
            {
                continue;
            }
            let mut given = self.type_of_pat(file, PatId(p as u32));
            if let PatParent::Param(param) = bound.pat_parent[p] {
                // What nothing types is what the pattern makes of it.
                if hir[param].ty.is_none() {
                    continue;
                }
                if hir[param].flags.contains(Flags::OPTIONAL) {
                    given = self.without_undefined(given);
                }
            }
            sites.push(IterationSite {
                usage: IterationUse::Destructuring,
                input: given,
                sent: TypeId::UNDEFINED,
                at: hir.pats[p].pos,
                node: ErrorNode::Pat(PatId(p as u32)),
            });
        }
        // What is found wrong with the way something is gone through is said the first time it is gone through that way.
        sites.sort_by_key(|site| site.at);
        let mut cached = Vec::new();
        // `getGlobalIterableType() != emptyGenericType`
        let iterable_exists =
            !sites.is_empty() && self.global_type_of_arity(known::Iterable, 3).is_some();
        for site in &sites {
            check_iterated_type(self, file, site, iterable_exists, &mut cached, out);
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
    default: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    let start = hir[name].pos;
    let before = skip_trivia_back(&hir.text, (start as usize).min(hir.text.len()));
    if !is_last {
        out.push(Diagnostic { start, code: 2462 });
        c.note(start, c.end_of_pat(file, name), 2462, Vec::new());
    } else if hir.text[..before].ends_with(b":") {
        // `...a: b`: the property name is not kept.
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
fn language_version(c: &Checker<'_>) -> ScriptTarget {
    match c.p.files.options.target {
        ScriptTarget::None => ScriptTarget::ES2025,
        said => said,
    }
}

/// The node an error is about.
#[derive(Copy, Clone)]
enum ErrorNode {
    /// An expression as it is written, in its parentheses.
    Written(ExprId),
    /// An expression less the parentheses around it.
    Inside(ExprId),
    Pat(PatId),
}

/// `GetErrorRangeForNode`: where an error about `node` ends. 0 if nobody is going to read it.
fn error_end(c: &Checker<'_>, file: FileId, node: ErrorNode) -> u32 {
    if !c.explains {
        return 0;
    }
    match node {
        ErrorNode::Written(e) => c.error_end_of(file, e),
        ErrorNode::Inside(e) => c.error_end_inside_parentheses(file, e),
        ErrorNode::Pat(pat) => c.end_of_pat(file, pat),
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

/// `NodeFlagsAmbient`: whether `e` is written in something that is only declared. In a computed name of which it is not kept track
/// what it is the name of, it is taken to be.
fn is_in_ambient_context(c: &Checker<'_>, file: FileId, e: ExprId) -> bool {
    let (hir, bound) = (c.hir(file), c.bound(file));
    let mut parent = bound.expr_parent[e.idx()];
    loop {
        let flags = match parent {
            Parent::None | Parent::File => return false,
            Parent::Key(owner) if owner.is_some() => {
                parent = Parent::Expr(owner);
                continue;
            }
            Parent::Key(_) | Parent::MemberKey => return true,
            Parent::VarInit(d) => hir[d].flags,
            Parent::EnumInit(m) => hir[bound.enum_member_owner[m.idx()]].flags,
            Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => hir[m].flags | hir[class].flags,
                _ => hir[m].flags,
            },
            Parent::FnBody(f) => hir[f].flags,
            Parent::ParamDefault(p) => hir[bound.param_fn[p.idx()]].flags,
            Parent::Module(m) => hir[m].flags,
            _ => Flags::empty(),
        };
        if flags.contains(Flags::AMBIENT) {
            return true;
        }
        parent = c.outward(file, parent);
    }
}

// ───────────────────────────── kinds of types ─────────────────────────────

/// `number` or the type of a numeric literal: assignable to `number | bigint`, and no `bigint`.
fn is_plain_number(c: &Checker<'_>, ty: TypeId) -> bool {
    ty == TypeId::NUMBER || matches!(c.data(ty), TypeData::NumberLit { .. })
}

/// `TypeFlagsUndefined`
fn is_undefined(_: &Checker<'_>, ty: TypeId) -> bool {
    ty.is_undefined()
}

/// `allTypesAssignableToKind(t, TypeFlagsPrimitive | TypeFlagsNever)`
fn is_all_primitive_or_never(c: &Checker<'_>, ty: TypeId) -> bool {
    ty == TypeId::NEVER
        || c.every_type(ty, |c, m| match c.data(m) {
            // `string & { brand: 1 }` is a string.
            TypeData::Intersection(parts) => parts.iter().any(|&p| c.is_primitive(p)),
            _ => c.is_primitive(m),
        })
}

/// The types of two operands, if both were found out for sure.
fn operand_types(
    c: &mut Checker<'_>,
    file: FileId,
    left: ExprId,
    right: ExprId,
) -> Option<(TypeId, TypeId)> {
    let (l, r) = (c.type_of_expr(file, left), c.type_of_expr(file, right));
    (c.is_known(l) && c.is_known(r) && !c.is_uncertain(file, left) && !c.is_uncertain(file, right))
        .then_some((l, r))
}

/// Whether `source` is related to `target`. `None`: the comparison was cut short, and what it came to is
/// not to be gone by.
fn is_related_for_sure(
    c: &mut Checker<'_>,
    source: TypeId,
    target: TypeId,
    relation: Relation,
) -> Option<bool> {
    let gave_up_before = std::mem::replace(&mut c.relation_gave_up, false);
    let is_related = c.related(source, target, relation);
    let is_sure = !c.relation_gave_up && !c.timed_out();
    c.relation_gave_up |= gave_up_before;
    is_sure.then_some(is_related)
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
    let ty = c.force(ty);
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
fn is_literal_expression_of_object(hir: &File, e: ExprId) -> bool {
    let is_literal = match hir[e].kind {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Regex | ExprKind::Class(_) => true,
        ExprKind::Fn(f) => hir[f].kind == FnKind::Expr,
        _ => false,
    };
    is_literal && !is_parenthesized(hir, e)
}

/// `checkBinaryLikeExpression`, of `a op b` and `a op= b`: 2791 6807 2839, and on to what has a function of its own.
fn check_binary_like(c: &mut Checker<'_>, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
    let hir = c.hir(file);
    let (op, left, right, is_assignment) = match hir[e].kind {
        ExprKind::Binary { op, left, right } => (op, left, right, false),
        ExprKind::Assign {
            op: Some(op),
            target,
            value,
        } => (op, target, value, true),
        _ => return,
    };
    match op {
        BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Pow
        | BinOp::Shl
        | BinOp::Shr
        | BinOp::UShr
        | BinOp::BitAnd
        | BinOp::BitOr
        | BinOp::BitXor => {
            let Some((l, r)) = operand_types(c, file, left, right) else {
                return;
            };
            // Two numbers fit, and give a number.
            if !(is_plain_number(c, l) && is_plain_number(c, r)) {
                let (l, r) = (c.non_null_type(l), c.non_null_type(r));
                // Of two booleans another operator is suggested, and that is all.
                let is_boolean =
                    |c: &Checker<'_>, t: TypeId| t == TypeId::BOOLEAN || c.is_boolean_like(t);
                if matches!(op, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor)
                    && is_boolean(c, l)
                    && is_boolean(c, r)
                {
                    return;
                }
                let numeric = c.union(&[TypeId::NUMBER, TypeId::BIGINT]);
                let both_fit = c.is_assignable(l, numeric) && c.is_assignable(r, numeric);
                let is_anything = |c: &Checker<'_>, t: TypeId| c.is_any(t) || t == TypeId::UNKNOWN;
                let gives_number = is_anything(c, l) && is_anything(c, r)
                    || !c.maybe_type_of_kind(l, Checker::is_bigint_like)
                        && !c.maybe_type_of_kind(r, Checker::is_bigint_like);
                if op == BinOp::Pow
                    && !gives_number
                    && c.is_assignable(l, TypeId::BIGINT)
                    && c.is_assignable(r, TypeId::BIGINT)
                    && language_version(c) < ScriptTarget::ES2016
                {
                    let start = c.start_inside_parentheses(file, e);
                    out.push(Diagnostic { start, code: 2791 });
                    c.note(start, c.end_inside_parentheses(file, e), 2791, Vec::new());
                }
                if !both_fit {
                    return;
                }
            }
            if is_assignment {
                check_assignment_operator(c, file, left, ExprId::NONE, out);
            }
            // `errorOrSuggestion`: a suggestion anywhere else, it is an error in the initializer of a member of an enum.
            let is_error = matches!(c.bound(file).expr_parent[e.idx()], Parent::EnumInit(_));
            if matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr)
                && (is_error || c.captures_suggestions())
                && let Some(EnumValue::Number(bits)) = c.constant_value(file, right)
                && f64::from_bits(bits).abs() >= 32.0
            {
                let start = c.start_inside_parentheses(file, e);
                out.push(Diagnostic { start, code: 6807 });
                if !is_error {
                    c.note_suggestion(start, 6807);
                }
                let end = c.end_inside_parentheses(file, e);
                c.explain_to(start, end, 6807, |c| {
                    let operator = match (op, is_assignment) {
                        (BinOp::Shl, false) => "<<",
                        (BinOp::Shl, true) => "<<=",
                        (BinOp::Shr, false) => ">>",
                        (BinOp::Shr, true) => ">>=",
                        (_, false) => ">>>",
                        (_, true) => ">>>=",
                    };
                    vec![
                        c.source_text(file, c.start_of(file, left), c.end_of_expr(file, left)),
                        operator.to_owned(),
                        crate::atom::number_to_string(f64::from_bits(bits) % 32.0),
                    ]
                });
            }
        }
        BinOp::Add if is_assignment => {
            let Some((mut l, mut r)) = operand_types(c, file, left, right) else {
                return;
            };
            // Two numbers give a number.
            if is_plain_number(c, l) && is_plain_number(c, r) {
                return check_assignment_operator(c, file, left, ExprId::NONE, out);
            }
            if !c.is_assignable(l, TypeId::STRING) && !c.is_assignable(r, TypeId::STRING) {
                l = c.non_null_type(l);
                r = c.non_null_type(r);
            }
            // `isTypeAssignableToKindEx(t, kind, strict)`
            let is_strictly = |c: &mut Checker<'_>, t: TypeId, kind: TypeId| {
                !c.is_any(t) && t != TypeId::UNKNOWN && !c.is_nullish(t) && c.is_assignable(t, kind)
            };
            let has_result = is_strictly(c, l, TypeId::NUMBER) && is_strictly(c, r, TypeId::NUMBER)
                || is_strictly(c, l, TypeId::BIGINT) && is_strictly(c, r, TypeId::BIGINT)
                || is_strictly(c, l, TypeId::STRING)
                || is_strictly(c, r, TypeId::STRING)
                || c.is_any(l)
                || c.is_any(r);
            // `checkForDisallowedESSymbolOperand`
            if has_result
                && !c.maybe_type_of_kind_considering_base_constraint(l, Checker::is_symbol_like)
                && !c.maybe_type_of_kind_considering_base_constraint(r, Checker::is_symbol_like)
            {
                check_assignment_operator(c, file, left, ExprId::NONE, out);
            }
        }
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
            // A JavaScript file reports only `===` and `!==`.
            if (is_literal_expression_of_object(hir, left)
                || is_literal_expression_of_object(hir, right))
                && (!hir.is_js || matches!(op, BinOp::EqEqEq | BinOp::NotEqEq))
            {
                let start = c.start_inside_parentheses(file, e);
                out.push(Diagnostic { start, code: 2839 });
                let always = if matches!(op, BinOp::EqEq | BinOp::EqEqEq) {
                    "false"
                } else {
                    "true"
                };
                let end = c.end_inside_parentheses(file, e);
                c.note(start, end, 2839, vec![always.to_owned()]);
            }
        }
        BinOp::Instanceof => check_instanceof(c, file, e, left, right, out),
        BinOp::In => check_right_operand_of_in(c, file, right, out),
        BinOp::And | BinOp::Or | BinOp::Nullish if is_assignment => {
            check_assignment_operator(c, file, left, right, out)
        }
        _ => {}
    }
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
    let hir = c.hir(file);
    let code = match hir[skip_assertions(hir, e)].kind {
        ExprKind::Ident(_)
        | ExprKind::Missing
        | ExprKind::Dot {
            chain: Chain::No, ..
        }
        | ExprKind::Index {
            chain: Chain::No, ..
        } => return true,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => optional_chain,
        _ => invalid,
    };
    let start = c.error_start_of(file, e);
    out.push(Diagnostic { start, code });
    c.note(start, c.error_end_of(file, e), code, Vec::new());
    false
}

/// `a = b`, as `checkBinaryLikeExpression` has it.
fn check_plain_assignment(
    c: &mut Checker<'_>,
    file: FileId,
    target: ExprId,
    value: ExprId,
    sites: &mut Vec<IterationSite>,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    if !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
        || is_parenthesized(hir, target)
    {
        return check_assignment_operator(c, file, target, value, out);
    }
    let source = c.type_of_expr(file, value);
    if !c.is_uncertain(file, value) {
        note_assignment_pattern(c, file, target, source, sites);
    }
    check_assignment_pattern(c, file, target, out);
}

/// Whether `e`, which stands in a pattern, is a pattern itself, with or without a default.
fn is_nested_pattern(hir: &File, mut e: ExprId) -> bool {
    if let ExprKind::Assign {
        op: None, target, ..
    } = hir[e].kind
        && !is_parenthesized(hir, e)
    {
        e = target;
    }
    matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_)) && !is_parenthesized(hir, e)
}

/// `checkDestructuringAssignment`, for the array literals in `target`, which is assigned a `source`: `checkArrayLiteralAssignment`
/// goes through what each of them takes apart.
fn note_assignment_pattern(
    c: &mut Checker<'_>,
    file: FileId,
    mut target: ExprId,
    mut source: TypeId,
    sites: &mut Vec<IterationSite>,
) {
    let hir = c.hir(file);
    // A default sees to it that it is not missing. What the default itself is taken apart into is seen to with the assignment it is.
    if let ExprKind::Assign {
        op: None,
        target: inner,
        ..
    } = hir[target].kind
        && !is_parenthesized(hir, target)
    {
        target = inner;
        source = c.without_undefined(source);
    }
    let source = c.force(source);
    if is_parenthesized(hir, target) || !c.is_known(source) || c.is_any(source) {
        return;
    }
    match hir[target].kind {
        ExprKind::Object(props) => {
            let mut named = Vec::new();
            for p in props.iter() {
                let prop = &hir[p];
                let is_pattern = prop.value.is_some() && is_nested_pattern(hir, prop.value);
                if prop.kind == PropKind::Spread {
                    if is_pattern {
                        let rest = c.rest_of_object(source, &named, TypeId::NEVER);
                        note_assignment_pattern(c, file, prop.value, rest, sites);
                    }
                    continue;
                }
                let Some(name) = c.member_name(file, prop.key) else {
                    continue;
                };
                named.push(name);
                if is_pattern {
                    let object = c.apparent_type(source);
                    if let Some(ty) = c.type_of_property(object, name) {
                        note_assignment_pattern(c, file, prop.value, ty, sites);
                    }
                }
            }
        }
        ExprKind::Array(items) => {
            sites.push(IterationSite {
                usage: IterationUse::Destructuring,
                input: source,
                sent: TypeId::UNDEFINED,
                at: hir[target].pos,
                node: ErrorNode::Inside(target),
            });
            let is_pattern = |item: ExprId| match hir[item].kind {
                ExprKind::Spread(rest) => is_nested_pattern(hir, rest),
                _ => is_nested_pattern(hir, item),
            };
            if !hir.ids(items).any(is_pattern) {
                return;
            }
            let iterated = c.iterated_type(source, false);
            if !c.is_known(iterated) {
                return;
            }
            for (index, item) in hir.ids(items).enumerate() {
                if !is_pattern(item) {
                    continue;
                }
                let (inner, is_rest) = match hir[item].kind {
                    // A rest that is not the last, or that has a default, is refused as a whole.
                    ExprKind::Spread(rest)
                        if index + 1 < items.len()
                            || matches!(hir[rest].kind, ExprKind::Assign { .. }) =>
                    {
                        continue;
                    }
                    ExprKind::Spread(rest) => (rest, true),
                    _ => (item, false),
                };
                let ty = c.element_of_destructured(source, index, is_rest);
                note_assignment_pattern(c, file, inner, ty, sites);
            }
        }
        _ => {}
    }
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
        |c| error_end(c, file, ErrorNode::Written(target)),
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
    let object = c.force(object);
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

/// `checkPrefixUnaryExpression`, `checkPostfixUnaryExpression`
fn check_unary(
    c: &mut Checker<'_>,
    file: FileId,
    op: UnOp,
    operand: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let hir = c.hir(file);
    if !matches!(
        op,
        UnOp::Plus
            | UnOp::Minus
            | UnOp::BitNot
            | UnOp::PreInc
            | UnOp::PreDec
            | UnOp::PostInc
            | UnOp::PostDec
    ) {
        return;
    }
    let ty = c.type_of_expr(file, operand);
    if !c.is_known(ty) || c.is_uncertain(file, operand) {
        return;
    }
    if !matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot) {
        let fits = is_plain_number(c, ty) || {
            let there = c.non_null_type(ty);
            let numeric = c.union(&[TypeId::NUMBER, TypeId::BIGINT]);
            c.is_assignable(there, numeric)
        };
        if fits {
            check_reference_expression(c, file, operand, 2357, 2777, out);
        }
        return;
    }
    // A signed literal is a literal.
    if matches!(
        (hir[operand].kind, op),
        (ExprKind::Number(_), UnOp::Plus | UnOp::Minus) | (ExprKind::BigInt(_), UnOp::Minus)
    ) && !is_parenthesized(hir, operand)
    {
        return;
    }
    c.check_not_nullish(file, operand, ty, out);
    if c.maybe_type_of_kind_considering_base_constraint(ty, Checker::is_symbol_like) {
        let start = c.error_start_of(file, operand);
        out.push(Diagnostic { start, code: 2469 });
        let operator = match op {
            UnOp::Plus => "+",
            UnOp::Minus => "-",
            _ => "~",
        };
        let end = c.error_end_of(file, operand);
        c.note(start, end, 2469, vec![operator.to_owned()]);
    }
    if op == UnOp::Plus
        && c.maybe_type_of_kind_considering_base_constraint(ty, Checker::is_bigint_like)
    {
        let start = c.error_start_of(file, operand);
        out.push(Diagnostic { start, code: 2736 });
        let end = c.error_end_of(file, operand);
        c.explain_to(start, end, 2736, |c| {
            let base = c.base_of_literal(ty);
            vec!["+".to_owned(), c.type_to_string(base)]
        });
    }
}

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
            && !c.is_uncertain(file, span)
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
    if !c.is_known(tag) || c.is_uncertain(file, data.callee) {
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
            && apparent != TypeId::NEVER
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
    if !c.is_known(r) || c.is_any(r) || c.is_uncertain(file, right) {
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
    if !c.is_known(l) || c.is_uncertain(file, left) {
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
        |c| error_end(c, file, ErrorNode::Written(right)),
        ExprId::NONE,
        2861,
        out,
    );
}

/// `checkInExpression`, once the right operand has been found to be an object: 2638
fn check_right_operand_of_in(
    c: &mut Checker<'_>,
    file: FileId,
    right: ExprId,
    out: &mut Vec<Diagnostic>,
) {
    let ty = c.type_of_expr(file, right);
    if !c.is_known(ty) || c.is_uncertain(file, right) {
        return;
    }
    let there = c.non_null_type(ty);
    if c.is_assignable(there, TypeId::OBJECT) && has_empty_object_intersection(c, ty) {
        let start = c.error_start_of(file, right);
        out.push(Diagnostic { start, code: 2638 });
        let end = c.error_end_of(file, right);
        c.explain_to(start, end, 2638, |c| vec![c.type_to_string(ty)]);
    }
}

/// `hasEmptyObjectIntersection`
fn has_empty_object_intersection(c: &mut Checker<'_>, ty: TypeId) -> bool {
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

// ───────────────────────────── `await` ─────────────────────────────

/// What `getAwaitedTypeNoAliasEx` is given besides the type, and what it says.
struct Awaiting {
    file: FileId,
    /// Where the node the errors are about starts.
    at: u32,
    node: ErrorNode,
    /// What to say of something with a `then` that is no promise.
    message: u32,
    /// `thisTypeForError`: the `this` that the last `then` looked at asks for, if no `then` takes what is awaited for `this`.
    this_type_for_error: Option<TypeId>,
    /// `awaitedTypeStack`
    stack: Vec<TypeId>,
    /// `cachedTypes`: the types that awaiting gives something for though something was found wrong on the way. What they give is
    /// kept, and what was found wrong is not said again.
    settled: Vec<TypeId>,
    said: Vec<Diagnostic>,
    /// Something on the way could not be found out: nothing is to be said.
    unknown: bool,
}

impl Awaiting {
    fn new(file: FileId, message: u32) -> Awaiting {
        Awaiting {
            file,
            at: 0,
            node: ErrorNode::Inside(ExprId::NONE),
            message,
            this_type_for_error: None,
            stack: Vec::new(),
            settled: Vec::new(),
            said: Vec::new(),
            unknown: false,
        }
    }

    /// On to `node`, which starts at `at`.
    fn begin(&mut self, at: u32, node: ErrorNode) {
        self.at = at;
        self.node = node;
        self.stack.clear();
        self.said.clear();
        self.unknown = false;
    }
}

/// `getAwaitedTypeNoAliasEx`: whether there is such a thing as what awaiting a `t` gives.
fn has_awaited_type(c: &mut Checker<'_>, t: TypeId, a: &mut Awaiting) -> bool {
    let t = c.force(t);
    if a.settled.contains(&t) {
        return true;
    }
    let said_before = a.said.len();
    let has = has_awaited_type_uncached(c, t, a);
    if has && !a.unknown && a.said.len() > said_before {
        a.settled.push(t);
    }
    has
}

fn has_awaited_type_uncached(c: &mut Checker<'_>, t: TypeId, a: &mut Awaiting) -> bool {
    if !c.is_known(t) || a.stack.len() > 40 {
        a.unknown = true;
        return true;
    }
    if c.is_any(t) || c.awaited_argument(t).is_some() {
        return true;
    }
    if c.is_union(t) {
        if a.stack.contains(&t) {
            a.said.push(Diagnostic {
                start: a.at,
                code: 1062,
            });
            c.note(a.at, error_end(c, a.file, a.node), 1062, Vec::new());
            return false;
        }
        a.stack.push(t);
        let mut has_some = false;
        for &part in c.parts(t) {
            has_some |= has_awaited_type(c, part, a);
        }
        a.stack.pop();
        return has_some;
    }
    // `isAwaitedTypeNeeded`, or else what it extends has no `then`.
    if c.is_generic_object_type(t) {
        return true;
    }
    a.this_type_for_error = None;
    if let Some(promised) = promised_type_of_promise(c, t, a) {
        let promised = c.force(promised);
        if t == promised || a.stack.contains(&promised) {
            a.said.push(Diagnostic {
                start: a.at,
                code: 1062,
            });
            c.note(a.at, error_end(c, a.file, a.node), 1062, Vec::new());
            return false;
        }
        a.stack.push(t);
        let has = has_awaited_type(c, promised, a);
        a.stack.pop();
        return has;
    }
    if !a.unknown && is_thenable_type(c, t) {
        a.said.push(Diagnostic {
            start: a.at,
            code: a.message,
        });
        c.note(a.at, error_end(c, a.file, a.node), a.message, Vec::new());
        if let Some(this) = a.this_type_for_error {
            c.explain_chain(a.at, a.message, |c| {
                vec![Line {
                    code: 2684,
                    args: vec![c.type_to_string(t), c.type_to_string(this)],
                    level: 1,
                }]
            });
        }
        return false;
    }
    true
}

/// `getPromisedTypeOfPromiseEx`
fn promised_type_of_promise(c: &mut Checker<'_>, t: TypeId, a: &mut Awaiting) -> Option<TypeId> {
    if let Some(args) = c.is_global_ref(t, known::Promise) {
        return args.first().copied();
    }
    let base = c.base_constraint_of(t).unwrap_or(t);
    if is_all_primitive_or_never(c, base) {
        return None;
    }
    let then = type_of_declared_property(c, t, known::then)?;
    if !c.is_known(then) {
        a.unknown = true;
        return None;
    }
    if c.is_any(then) {
        return None;
    }
    // The ways to call `then` on a `t`.
    let mut callbacks = Vec::new();
    let mut refused_by = None;
    for sig in c.signatures(then, false) {
        if let Some(this) = c.sig_this_type(sig)
            && this != TypeId::VOID
        {
            let takes_it = if c.is_known(this) {
                is_related_for_sure(c, t, this, Relation::Subtype)
            } else {
                None
            };
            match takes_it {
                Some(true) => {}
                Some(false) => {
                    refused_by = Some(this);
                    continue;
                }
                None => {
                    a.unknown = true;
                    return None;
                }
            }
        }
        let params = c.sig_params(sig);
        callbacks.push(c.param_type_at(&params, 0).unwrap_or(TypeId::NEVER));
    }
    if callbacks.is_empty() {
        a.this_type_for_error = refused_by;
        return None;
    }
    let on_fulfilled = c.union(&callbacks);
    // `getTypeWithFacts(.., TypeFactsNEUndefinedOrNull)`
    let on_fulfilled = c.filter(on_fulfilled, |c, m| !c.is_nullish(m));
    if !c.is_known(on_fulfilled) {
        a.unknown = true;
        return None;
    }
    if c.is_any(on_fulfilled) {
        return None;
    }
    let mut values = Vec::new();
    for sig in c.signatures(on_fulfilled, false) {
        let params = c.sig_params(sig);
        values.push(c.param_type_at(&params, 0).unwrap_or(TypeId::NEVER));
    }
    if values.is_empty() {
        return None;
    }
    Some(c.union_reduced(&values))
}

/// `isThenableType`
fn is_thenable_type(c: &mut Checker<'_>, t: TypeId) -> bool {
    let base = c.base_constraint_of(t).unwrap_or(t);
    if is_all_primitive_or_never(c, base) {
        return false;
    }
    let Some(then) = type_of_declared_property(c, t, known::then) else {
        return false;
    };
    // `getTypeWithFacts(.., TypeFactsNEUndefinedOrNull)`
    let then = c.filter(then, |c, m| !c.is_nullish(m));
    !c.signatures(then, false).is_empty()
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
    let Some(func) = c.enclosing_fn_of_expr(file, e) else {
        return;
    };
    let f = &hir[func];
    if !f.flags.contains(Flags::GENERATOR) || f.ret.is_some() {
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
    if matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::ImportCall(..)))
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

/// `getYieldedTypeOfYieldExpression`, of `yield* value`.
fn note_yield_star(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    value: ExprId,
    sites: &mut Vec<IterationSite>,
) {
    let hir = c.hir(file);
    let Some(func) = c.enclosing_fn_of_expr(file, e) else {
        return;
    };
    let f = &hir[func];
    if !f.flags.contains(Flags::GENERATOR) || value.is_none() {
        return;
    }
    let is_async = f.flags.contains(Flags::ASYNC);
    let input = c.type_of_expr(file, value);
    if c.is_uncertain(file, value) {
        return;
    }
    // What the generator says it is sent. Which member of a union it goes by is not looked into.
    let mut sent = TypeId::ANY;
    if f.ret.is_some() {
        let declared = c.type_from_node(file, f.ret);
        if !c.is_known(declared) {
            return;
        }
        if !c.is_union(declared)
            && let Some(types) = c.iteration_types(declared, is_async)
        {
            sent = types.next;
        }
    }
    let usage = if is_async {
        IterationUse::AsyncYieldStar
    } else {
        IterationUse::YieldStar
    };
    sites.push(IterationSite {
        usage,
        input,
        sent,
        at: c.error_start_of(file, value),
        node: ErrorNode::Written(value),
    });
}

// ───────────────────────────── what is gone through ─────────────────────────────

/// `IterationUse`
#[derive(Copy, Clone, PartialEq, Eq)]
enum IterationUse {
    ForOf,
    ForAwaitOf,
    Spread,
    Destructuring,
    YieldStar,
    AsyncYieldStar,
}

impl IterationUse {
    /// `IterationUseAllowsAsyncIterablesFlag`
    fn allows_async(self) -> bool {
        matches!(
            self,
            IterationUse::ForAwaitOf | IterationUse::AsyncYieldStar
        )
    }

    /// `IterationUseForOfFlag`, with which `IterationUseAllowsStringInputFlag` goes.
    fn is_for_of(self) -> bool {
        matches!(self, IterationUse::ForOf | IterationUse::ForAwaitOf)
    }

    /// What is said when `next` does not take what it will be sent.
    fn code_for_what_is_sent(self) -> u32 {
        match self {
            IterationUse::ForOf | IterationUse::ForAwaitOf => 2763,
            IterationUse::Spread => 2764,
            IterationUse::Destructuring => 2765,
            IterationUse::YieldStar | IterationUse::AsyncYieldStar => 2766,
        }
    }
}

/// Where something is gone through: what `checkIteratedTypeOrElementType` is given.
struct IterationSite {
    usage: IterationUse,
    input: TypeId,
    /// What `next` will be sent.
    sent: TypeId,
    /// Where the node the errors are about starts.
    at: u32,
    node: ErrorNode,
}

/// `IterationTypes`
#[derive(Copy, Clone, Default)]
struct Iteration {
    yielded: Option<TypeId>,
    returned: Option<TypeId>,
    next: Option<TypeId>,
}

impl Iteration {
    const ANY: Iteration = Iteration {
        yielded: Some(TypeId::ANY),
        returned: Some(TypeId::ANY),
        next: Some(TypeId::ANY),
    };

    fn has_types(&self) -> bool {
        self.yielded.is_some() || self.returned.is_some() || self.next.is_some()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum IteratorMethod {
    Next,
    Return,
    Throw,
}

/// What looking for iteration types finds to say.
struct IterationReport {
    file: FileId,
    /// Where the node the errors are about starts.
    at: u32,
    node: ErrorNode,
    /// What is said whatever comes of it.
    said: Vec<Diagnostic>,
    /// `diagnosticOutput`: what is said only if there turns out to be something to go through.
    held: Vec<Diagnostic>,
    /// What becomes of that if there turns out to be nothing to go through: related information.
    held_as_related: Vec<super::explain::Related>,
    /// Something on the way could not be found out: nothing is to be said.
    unknown: bool,
}

impl IterationReport {
    fn new(file: FileId, at: u32, node: ErrorNode) -> IterationReport {
        IterationReport {
            file,
            at,
            node,
            said: Vec::new(),
            held: Vec::new(),
            held_as_related: Vec::new(),
            unknown: false,
        }
    }

    fn give_up(&mut self) -> Iteration {
        self.unknown = true;
        Iteration::default()
    }
}

/// `checkIteratedTypeOrElementType`. `cached`: `iterationTypesCache`, the types that were found to have iteration types, and for which
/// kind of use.
fn check_iterated_type(
    c: &mut Checker<'_>,
    file: FileId,
    site: &IterationSite,
    iterable_exists: bool,
    cached: &mut Vec<(TypeId, bool, bool)>,
    out: &mut Vec<Diagnostic>,
) {
    let &IterationSite {
        usage,
        input,
        sent,
        at,
        node,
    } = site;
    let input = c.force(input);
    let input = c.reduced(input);
    // That there is nothing there at all is said otherwise.
    if !c.is_known(input)
        || c.is_any(input)
        || c.every_type(input, |_, m| {
            m == TypeId::NEVER || m.is_null() || m.is_undefined()
        })
    {
        return;
    }
    // What the library that has `Iterable` says of arrays and tuples: they can be gone through, and `next` takes whatever it is sent.
    if iterable_exists
        && !usage.allows_async()
        && c.every_type(input, |c, m| c.is_array_or_tuple(m))
    {
        return;
    }
    if iterable_exists || usage.allows_async() {
        let mut report = IterationReport::new(file, at, node);
        let types = iteration_types_of_iterable(c, input, usage, iterable_exists, &mut report);
        if report.unknown {
            return;
        }
        let key = (input, usage.allows_async(), usage.is_for_of());
        if !types.has_types() {
            out.append(&mut report.said);
            // `reportTypeNotIterableError`
            if iterable_exists {
                let code = if usage.allows_async() { 2504 } else { 2488 };
                // What `check_iteration` has said of it is not said again.
                let is_said = out.iter().any(|d| d.start == at && d.code == code);
                out.push(Diagnostic { start: at, code });
                if !is_said {
                    let end = error_end(c, file, node);
                    c.explain_to(at, end, code, |c| vec![c.type_to_string(input)]);
                    c.relate(at, code, |c| {
                        c.hint_to_await_what_is_gone_through(input, usage.allows_async(), at, end)
                    });
                }
                // `getIterationTypesOfIterableWorker`: what was found on the way goes with it.
                let found = std::mem::take(&mut report.held_as_related);
                c.relate(at, code, |_| found);
            }
        } else if !cached.contains(&key) {
            cached.push(key);
            out.append(&mut report.said);
        }
        if let Some(next) = types.next {
            c.check_assignable_with_end_from(
                file,
                sent,
                next,
                at,
                |c| error_end(c, file, node),
                ExprId::NONE,
                usage.code_for_what_is_sent(),
                out,
            );
        }
        if types.yielded.is_some() || iterable_exists {
            return;
        }
    }
    // Without `Iterable` there are arrays, and strings where they will do.
    let mut array_type = input;
    if usage.is_for_of() {
        array_type = c.filter(input, |c, m| !c.is_string_like(m));
        if array_type == TypeId::NEVER {
            return;
        }
    }
    // `isArrayLikeType`
    let any_list = c.readonly_array_of(TypeId::ANY);
    if c.is_array(array_type)
        || !c.is_nullish(array_type)
            && is_related_for_sure(c, array_type, any_list, Relation::Assignable) != Some(false)
    {
        return;
    }
    // `getIterationDiagnosticDetails`
    let mut quiet = IterationReport::new(file, at, node);
    let yielded = iteration_types_of_iterable(c, input, usage, false, &mut quiet).yielded;
    if quiet.unknown {
        return;
    }
    let is_later_iterable = matches!(c.data(input), TypeData::Ref { target, .. } if matches!(
        c.files().atoms.bytes(c.files().symbol(*target).name),
        b"Float32Array" | b"Float64Array" | b"Int16Array" | b"Int32Array" | b"Int8Array" | b"NodeList" | b"Uint16Array" | b"Uint32Array" | b"Uint8Array" | b"Uint8ClampedArray"
    ));
    let code = if yielded.is_some() || is_later_iterable {
        2802
    } else if usage.is_for_of() && array_type == input {
        2495
    } else {
        2461
    };
    out.push(Diagnostic { start: at, code });
    let end = error_end(c, file, node);
    c.explain_to(at, end, code, |c| vec![c.type_to_string(array_type)]);
}

/// `getIterationTypesOfIterable`. `reports`: there is a node to put errors on.
fn iteration_types_of_iterable(
    c: &mut Checker<'_>,
    t: TypeId,
    usage: IterationUse,
    reports: bool,
    report: &mut IterationReport,
) -> Iteration {
    let t = c.force(t);
    let t = c.reduced(t);
    if !c.is_known(t) {
        return report.give_up();
    }
    if c.is_any(t) {
        return Iteration::ANY;
    }
    // Of the members of a union nothing is said, but that one of them cannot be gone through.
    if c.is_union(t) {
        let mut all = Vec::new();
        for &part in c.parts(t) {
            let types = iteration_types_of_iterable(c, part, usage, false, report);
            if !types.has_types() {
                return Iteration::default();
            }
            all.push(types);
        }
        return combine_iteration_types(c, &all);
    }
    for is_async in [true, false] {
        if is_async && !usage.allows_async() {
            continue;
        }
        let names = if is_async {
            [
                known::AsyncIterable,
                known::AsyncIteratorObject,
                known::AsyncIterableIterator,
                known::AsyncGenerator,
            ]
        } else {
            [
                known::Iterable,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ]
        };
        let types = iteration_types_of_global_reference(c, t, names, is_async);
        if types.has_types() {
            let is_awaited = if is_async {
                usage.is_for_of()
            } else {
                usage.allows_async()
            };
            return if is_awaited {
                async_from_sync_iteration_types(c, types)
            } else {
                types
            };
        }
        let types = iteration_types_of_iterable_slow(c, t, is_async, reports, report);
        if types.has_types() {
            report.said.append(&mut report.held);
            return if !is_async && usage.allows_async() {
                async_from_sync_iteration_types(c, types)
            } else {
                types
            };
        }
    }
    // It cannot be gone through, which is what is said: the rest only goes to explain that.
    report.held.clear();
    Iteration::default()
}

/// `getIterationTypesOfIterableFast`, `getIterationTypesOfIteratorFast`: of an instantiation of one of the global types `names`, or of
/// one of the iterators the library has for its own collections.
fn iteration_types_of_global_reference(
    c: &mut Checker<'_>,
    t: TypeId,
    names: [Atom; 4],
    is_async: bool,
) -> Iteration {
    let TypeData::Ref { target, .. } = c.data(t) else {
        return Iteration::default();
    };
    // The one name it can be a reference to a global type by. A class expression may have none.
    let name = c.files().symbol(*target).name;
    if name.is_none() {
        return Iteration::default();
    }
    if names.contains(&name)
        && let Some(&[yielded, returned, next]) = c.is_global_ref(t, name)
    {
        return resolved_iteration_types(c, yielded, returned, next, is_async);
    }
    const BUILTIN: [&[u8]; 4] = [
        b"ArrayIterator",
        b"MapIterator",
        b"SetIterator",
        b"StringIterator",
    ];
    const BUILTIN_ASYNC: [&[u8]; 1] = [b"ReadableStreamAsyncIterator"];
    let builtin: &[&[u8]] = if is_async { &BUILTIN_ASYNC } else { &BUILTIN };
    let text = c.files().atoms.bytes(name);
    if builtin.iter().any(|&one| one == text)
        && let Some(&[yielded]) = c.is_global_ref(t, name)
    {
        // `getBuiltinIteratorReturnType`
        let returned = if c.p.files.options.strict_builtin_iterator_return {
            TypeId::UNDEFINED
        } else {
            TypeId::ANY
        };
        return resolved_iteration_types(c, yielded, returned, TypeId::UNKNOWN, is_async);
    }
    Iteration::default()
}

/// `getResolvedIterationTypes`
fn resolved_iteration_types(
    c: &mut Checker<'_>,
    yielded: TypeId,
    returned: TypeId,
    next: TypeId,
    is_async: bool,
) -> Iteration {
    if is_async {
        return Iteration {
            yielded: Some(c.awaited(yielded)),
            returned: Some(c.awaited(returned)),
            next: Some(next),
        };
    }
    Iteration {
        yielded: Some(yielded),
        returned: Some(returned),
        next: Some(next),
    }
}

/// `combineIterationTypes`
fn combine_iteration_types(c: &mut Checker<'_>, all: &[Iteration]) -> Iteration {
    let mut union_of = |pick: fn(&Iteration) -> Option<TypeId>| {
        let types: Vec<TypeId> = all.iter().filter_map(pick).collect();
        if types.is_empty() {
            None
        } else {
            Some(c.union(&types))
        }
    };
    Iteration {
        yielded: union_of(|t| t.yielded),
        returned: union_of(|t| t.returned),
        next: union_of(|t| t.next),
    }
}

/// `getAsyncFromSyncIterationTypes`
fn async_from_sync_iteration_types(c: &mut Checker<'_>, types: Iteration) -> Iteration {
    Iteration {
        yielded: types.yielded.map(|t| c.awaited(t)),
        returned: types.returned.map(|t| c.awaited(t)),
        next: types.next,
    }
}

/// `getIterationTypesOfIterableSlow`
fn iteration_types_of_iterable_slow(
    c: &mut Checker<'_>,
    t: TypeId,
    is_async: bool,
    reports: bool,
    report: &mut IterationReport,
) -> Iteration {
    let apparent = c.apparent_type(t);
    // What a type parameter extends may not have been found out. What the members of a union have in common is not made up here.
    if !c.is_known(apparent) || c.is_any(apparent) || c.is_union(apparent) {
        return report.give_up();
    }
    let name = if is_async {
        known::sym_async_iterator
    } else {
        known::sym_iterator
    };
    let Some((prop, mapper)) = c.prop_ref(apparent, name) else {
        return Iteration::default();
    };
    if prop.flags.contains(PropFlags::OPTIONAL) {
        return Iteration::default();
    }
    let method = c.type_of_prop(prop, mapper);
    if !c.is_known(method) {
        return report.give_up();
    }
    if c.is_any(method) {
        return Iteration::ANY;
    }
    // What the ways to call it without an argument give.
    let mut iterators: SmallVec<[TypeId; 2]> = SmallVec::new();
    for sig in c.signatures(method, false) {
        let params = c.sig_params(sig);
        if c.min_argument_count(&params) == 0 {
            iterators.push(c.sig_return(sig));
        }
    }
    if iterators.is_empty() {
        // `checkTypeAssignableToEx(t, getGlobalIterableTypeChecked(), errorNode, nil, diagnosticOutput)`
        let iterable = if is_async {
            known::AsyncIterable
        } else {
            known::Iterable
        };
        if reports
            && c.explains
            && !c.signatures(method, false).is_empty()
            && let Some(iterable) = c.global_type_of_arity(iterable, 3)
        {
            let target = c.declared_type(iterable);
            let lines = c.assignability_lines(t, target, 0);
            if let Some((first, under)) = lines.split_first() {
                let mut args = first.args.clone();
                args.extend(under.iter().map(|line| {
                    let template = crate::messages::message(line.code).map_or("", |m| m.1);
                    let said = crate::messages::format(template, &line.args);
                    format!("\n{}{said}", "  ".repeat(line.level as usize))
                }));
                let end = error_end(c, report.file, report.node);
                report.held_as_related.push(super::explain::Related {
                    at: Some((report.file, report.at, end)),
                    code: first.code,
                    args,
                });
            }
        }
        return Iteration::default();
    }
    let iterator = c.intersection(&iterators);
    iteration_types_of_iterator(c, iterator, is_async, reports, report)
}

/// `getIterationTypesOfIteratorWorker`
fn iteration_types_of_iterator(
    c: &mut Checker<'_>,
    t: TypeId,
    is_async: bool,
    reports: bool,
    report: &mut IterationReport,
) -> Iteration {
    let t = c.force(t);
    if !c.is_known(t) {
        return report.give_up();
    }
    if c.is_any(t) {
        return Iteration::ANY;
    }
    let names = if is_async {
        [
            known::AsyncIterator,
            known::AsyncIteratorObject,
            known::AsyncIterableIterator,
            known::AsyncGenerator,
        ]
    } else {
        [
            known::Iterator,
            known::IteratorObject,
            known::IterableIterator,
            known::Generator,
        ]
    };
    let types = iteration_types_of_global_reference(c, t, names, is_async);
    if types.has_types() {
        return types;
    }
    // `getIterationTypesOfIteratorSlow`
    let all = [
        IteratorMethod::Next,
        IteratorMethod::Return,
        IteratorMethod::Throw,
    ]
    .map(|method| iteration_types_of_method(c, t, is_async, method, reports, report));
    combine_iteration_types(c, &all)
}

/// `resolveIterationType`: what an asynchronous iterator gives is awaited.
fn resolve_iteration_type(
    c: &mut Checker<'_>,
    t: TypeId,
    is_async: bool,
    reports: bool,
    report: &mut IterationReport,
) -> Option<TypeId> {
    if !is_async {
        return Some(t);
    }
    let mut awaiting = Awaiting::new(report.file, 1320);
    awaiting.begin(report.at, report.node);
    let has = has_awaited_type(c, t, &mut awaiting);
    report.unknown |= awaiting.unknown;
    if reports {
        report.said.append(&mut awaiting.said);
    }
    has.then(|| c.awaited(t))
}

/// `getIterationTypesOfMethod`
fn iteration_types_of_method(
    c: &mut Checker<'_>,
    t: TypeId,
    is_async: bool,
    method: IteratorMethod,
    reports: bool,
    report: &mut IterationReport,
) -> Iteration {
    let is_next = method == IteratorMethod::Next;
    let name = match method {
        IteratorMethod::Next => known::next,
        IteratorMethod::Return => c.files().atoms.intern(b"return"),
        IteratorMethod::Throw => c.files().atoms.intern(b"throw"),
    };
    let apparent = c.apparent_type(t);
    if !c.is_known(apparent) || c.is_any(apparent) || c.is_union(apparent) {
        return report.give_up();
    }
    let found = c.prop_of(apparent, name);
    // `return` and `throw` may be missing.
    if found.is_none() && !is_next {
        return Iteration::default();
    }
    let mut signatures = Vec::new();
    if let Some((prop, mapper)) = &found
        && !(is_next && prop.flags.contains(PropFlags::OPTIONAL))
    {
        let ty = c.type_of_prop(prop, *mapper);
        // `getTypeWithFacts(.., TypeFactsNEUndefinedOrNull)`
        let ty = if is_next {
            ty
        } else {
            c.filter(ty, |c, m| !c.is_nullish(m))
        };
        if !c.is_known(ty) {
            return report.give_up();
        }
        if c.is_any(ty) {
            return Iteration::ANY;
        }
        signatures = c.signatures(ty, false).into_vec();
    }
    if signatures.is_empty() {
        if reports {
            let code = match (is_next, is_async) {
                (true, false) => 2489,
                (true, true) => 2519,
                (false, false) => 2767,
                (false, true) => 2768,
            };
            report.held.push(Diagnostic {
                start: report.at,
                code,
            });
            let end = error_end(c, report.file, report.node);
            c.note(report.at, end, code, vec![c.atom_text(name)]);
            report.held_as_related.push(super::explain::Related {
                at: Some((report.file, report.at, end)),
                code,
                args: if is_next {
                    Vec::new()
                } else {
                    vec![c.atom_text(name)]
                },
            });
        }
        return Iteration::default();
    }
    // What comes from the global `Iterator` or `Generator` and from nowhere else goes by their type arguments, in which what may be
    // left out is not `undefined`.
    if let ([_], Some((prop, mapper))) = (&signatures[..], &found)
        && let PropSource::Members(members) = &prop.source
        && let [(of, member)] = members[..]
        && let MemberOwner::Interface(interface) = c.bound(of).member_owner[member.idx()]
    {
        let owner = c
            .files()
            .sym(of, c.bound(of).interface_symbol[interface.idx()]);
        let (generator, iterator) = if is_async {
            (known::AsyncGenerator, known::AsyncIterator)
        } else {
            (known::Generator, known::Iterator)
        };
        if (c.global_type_symbol(generator) == Some(owner)
            || c.global_type_symbol(iterator) == Some(owner))
            && let [yielded, returned, next] = c.type_params_of_symbol(owner)[..]
        {
            let mut argument = |param: TypeId| {
                let ty = c.instantiate(param, prop.mapper);
                Some(c.instantiate(ty, *mapper))
            };
            return Iteration {
                yielded: argument(yielded),
                returned: argument(returned),
                next: if is_next { argument(next) } else { None },
            };
        }
    }
    let (mut parameter_types, mut return_types) = (Vec::new(), Vec::new());
    for &sig in &signatures {
        let params = c.sig_params(sig);
        if method != IteratorMethod::Throw
            && let Some(first) = c.param_type_at(&params, 0)
        {
            parameter_types.push(first);
        }
        return_types.push(c.sig_return(sig));
    }
    let mut returned = Vec::new();
    let mut next = None;
    if method != IteratorMethod::Throw {
        let parameter = if parameter_types.is_empty() {
            TypeId::UNKNOWN
        } else {
            c.union(&parameter_types)
        };
        if !c.is_known(parameter) {
            return report.give_up();
        }
        if is_next {
            // What `next` is given is not awaited, what `return` is given is.
            next = Some(parameter);
        } else {
            returned.push(
                resolve_iteration_type(c, parameter, is_async, reports, report)
                    .unwrap_or(TypeId::ANY),
            );
        }
    }
    let result = c.intersection(&return_types);
    if !c.is_known(result) {
        return report.give_up();
    }
    let result =
        resolve_iteration_type(c, result, is_async, reports, report).unwrap_or(TypeId::ANY);
    let types = iteration_types_of_iterator_result(c, result, report);
    if report.unknown {
        return Iteration::default();
    }
    let mut yielded = types.yielded;
    if types.has_types() {
        returned.extend(types.returned);
    } else {
        if reports {
            let code = if is_async { 2547 } else { 2490 };
            report.held.push(Diagnostic {
                start: report.at,
                code,
            });
            let end = error_end(c, report.file, report.node);
            c.note(report.at, end, code, vec![c.atom_text(name)]);
        }
        yielded = Some(TypeId::ANY);
        returned.push(TypeId::ANY);
    }
    Iteration {
        yielded,
        returned: Some(c.union(&returned)),
        next,
    }
}

/// `isIteratorResult`: `done` is `false` or left out while it goes on, `true` at the end.
fn is_iterator_result(c: &mut Checker<'_>, t: TypeId, is_done: bool) -> bool {
    let done = type_of_property_of_type(c, t, known::done).unwrap_or(TypeId::FALSE);
    c.is_assignable(if is_done { TypeId::TRUE } else { TypeId::FALSE }, done)
}

/// `getIterationTypesOfIteratorResult`
fn iteration_types_of_iterator_result(
    c: &mut Checker<'_>,
    t: TypeId,
    report: &mut IterationReport,
) -> Iteration {
    let t = c.force(t);
    if !c.is_known(t) {
        return report.give_up();
    }
    if c.is_any(t) {
        return Iteration::ANY;
    }
    if let Some(name) = c.files().atoms.lookup(b"IteratorYieldResult")
        && let Some(&[value]) = c.is_global_ref(t, name)
    {
        return Iteration {
            yielded: Some(value),
            ..Iteration::default()
        };
    }
    if let Some(name) = c.files().atoms.lookup(b"IteratorReturnResult")
        && let Some(&[value]) = c.is_global_ref(t, name)
    {
        return Iteration {
            returned: Some(value),
            ..Iteration::default()
        };
    }
    let mut value_of = |is_done: bool| {
        let results = c.filter(t, |c, m| is_iterator_result(c, m, is_done));
        if results == TypeId::NEVER {
            None
        } else {
            type_of_property_of_type(c, results, known::value)
        }
    };
    let (yielded, returned) = (value_of(false), value_of(true));
    if yielded.is_none() && returned.is_none() {
        return Iteration::default();
    }
    if [yielded, returned]
        .into_iter()
        .flatten()
        .any(|ty| !c.is_known(ty))
    {
        return report.give_up();
    }
    Iteration {
        yielded,
        returned: Some(returned.unwrap_or(TypeId::VOID)),
        next: None,
    }
}
