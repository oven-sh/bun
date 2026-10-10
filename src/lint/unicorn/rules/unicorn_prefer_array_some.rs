use bun_lint_oxlint::ast_util::{call_expr_method_callee_info, is_method_call, static_property_info, static_property_name};
use crate::unicorn::is_boolean_node;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer using `Array#some()` over various alternatives.
pub struct PreferArraySome;

const OVER_METHOD: Message = Message::new("", "Prefer `.some(…)` over `.find(…)` or `.findLast(…)`.");
const NON_ZERO_FILTER: Message = Message::new("", "Prefer `.some(…)` over non-zero length check from `.filter(…)`.");
const NEGATIVE_ONE_OR_ZERO_FILTER: Message =
    Message::new("", "Prefer `.some(…)` over `.findIndex(…)` or `.findLastIndex(…)`.");
const REPLACE_FILTER_LENGTH: Message = Message::new("", "Replace `.filter(…).length` with `.some(…)`");

impl Rule for PreferArraySome {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-some", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]).binaries(&[
        BinOp::NotEqEq,
        BinOp::NotEq,
        BinOp::Gt,
        BinOp::EqEqEq,
        BinOp::EqEq,
        BinOp::Ge,
        BinOp::Lt,
    ]);
    /// See [`is_boolean_node`].
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(_: &Options) -> Self {
        PreferArraySome
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let has_find = file.mentions_any(&["find", "findLast", "findIndex", "findLastIndex"]);
        if !has_find && !(file.mentions("filter") && file.mentions("length")) {
            return None;
        }
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.file().mentions_any(&["find", "findLast"]) {
            check_find(self, e, cx);
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if file.mentions_any(&["findIndex", "findLastIndex"]) {
            check_find_index(self, e, cx);
        }
        if file.mentions("filter")
            && file.mentions("length")
            && matches!(e.kind(), ExprKind::Binary { op: BinOp::Gt | BinOp::NotEqEq, .. })
        {
            check_filter_length(self, e, cx);
        }
    }
}

/// Where the name of the method is written, for a callee that is plainly `a.name` or `a["name"]`.
fn target_span(call: Call) -> Option<Span> {
    let callee = call.callee();
    static_property_info(callee).filter(|_| !callee.is_parenthesized()).map(|it| it.0)
}

/// A call that is not the whole of an optional chain.
fn as_call_expression(e: Expr<'_>) -> Option<Call<'_>> {
    e.as_call().filter(|_| !e.is_chain_root())
}

fn is_raw_zero(e: Expr) -> bool {
    e.tag() == ExprTag::Number && !e.is_parenthesized() && e.text() == b"0"
}

/// `.find(…)`, `.findLast(…)`
fn check_find<'a>(_: &PreferArraySome, e: Expr<'a>, cx: &mut Cx<'a, PreferArraySome>) {
    let Some(call) = e.as_call() else {
        return;
    };
    if !is_method_call(call, None, Some(&["find", "findLast"]), Some(1), Some(2)) {
        return;
    }
    let nullish_comparison = find_nullish_comparison_parent(e);
    if nullish_comparison.is_none() && !is_boolean_node(e, &mut cx.state) {
        return;
    }
    let Some((span, _)) = call_expr_method_callee_info(call) else {
        return;
    };
    cx.report(span, OVER_METHOD).suggest(OVER_METHOD, |fixer| {
        let target = target_span(call)?;
        let Some((comparison, should_negate)) = nullish_comparison else {
            return Some(fixer.replace(target, "some"));
        };
        let (file, left) = (fixer.file(), e.outer_span());
        let negation: &[u8] = if should_negate { b"!" } else { b"" };
        let (before, after) = (file.slice(Span::before(left.start, target)), file.slice(Span::after(target, left.end)));
        Some(fixer.replace(comparison, [negation, before, b"some", after].concat()))
    });
}

/// The `e == null` that `e` is in, and whether that is true if nothing is found.
fn find_nullish_comparison_parent(e: Expr<'_>) -> Option<(Expr<'_>, bool)> {
    let parent = e.parent().as_expr().filter(|_| !e.is_chain_root())?;
    let ExprKind::Binary { op, right, .. } = parent.kind() else {
        return None;
    };
    let is_strict_allowed = match right.kind() {
        ExprKind::Ident(name) if name.is("undefined") => true,
        ExprKind::Null => false,
        _ => return None,
    };
    match op {
        BinOp::EqEq => Some((parent, true)),
        BinOp::NotEq => Some((parent, false)),
        BinOp::EqEqEq if is_strict_allowed => Some((parent, true)),
        BinOp::NotEqEq if is_strict_allowed => Some((parent, false)),
        _ => None,
    }
}

/// `.findIndex(…) !== -1`, `.findIndex(…) >= 0`
fn check_find_index<'a>(_: &PreferArraySome, e: Expr<'a>, cx: &mut Cx<'a, PreferArraySome>) {
    let ExprKind::Binary { op, left, right } = e.kind() else {
        return;
    };
    let Some(call) = as_call_expression(left) else {
        return;
    };
    let is_compared = match op {
        BinOp::Ge | BinOp::Lt => is_raw_zero(right),
        _ => {
            matches!(right.kind(), ExprKind::Unary { op: UnOp::Minus, operand }
                if !operand.is_parenthesized()
                    && matches!(operand.kind(), ExprKind::Number(n) if (n - 1.0).abs() < f64::EPSILON))
                && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread)
        }
    };
    if is_compared
        && is_method_call(call, None, Some(&["findIndex", "findLastIndex"]), None, Some(1))
        && let Some((span, _)) = call_expr_method_callee_info(call)
    {
        cx.report(span, NEGATIVE_ONE_OR_ZERO_FILTER);
    }
}

/// `.filter(…).length > 0`, `.filter(…).length !== 0`
fn check_filter_length<'a>(_: &PreferArraySome, e: Expr<'a>, cx: &mut Cx<'a, PreferArraySome>) {
    let ExprKind::Binary { left, right, .. } = e.kind() else {
        return;
    };
    if !is_raw_zero(right) || left.is_chain_root() || !static_property_name(left).is_some_and(|it| it.is("length")) {
        return;
    }
    let Some(filter) = left.object() else {
        return;
    };
    let Some(call) = as_call_expression(filter) else {
        return;
    };
    if !is_method_call(call, None, Some(&["filter"]), None, None)
        || call.args().first().is_none_or(|it| it.tag() == ExprTag::Spread || is_node_value_not_function(it))
    {
        return;
    }
    let Some((span, _)) = call_expr_method_callee_info(call) else {
        return;
    };
    cx.report(span, NON_ZERO_FILTER).suggest(REPLACE_FILTER_LENGTH, |fixer| {
        Some([fixer.replace(target_span(call)?, "some"), fixer.remove(Span::after(filter.span(), e.span().end))])
    });
}

fn is_node_value_not_function(e: Expr) -> bool {
    if e.is_parenthesized() {
        return false;
    }
    match e.kind() {
        ExprKind::Binary { op, left, .. } => op != BinOp::Comma && left.tag() != ExprTag::PrivateIdentifier,
        ExprKind::Ident(name) => name.is("undefined"),
        ExprKind::Array(_)
        | ExprKind::Class(_)
        | ExprKind::Object(_)
        | ExprKind::Template(_)
        | ExprKind::Unary { .. }
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::String(_)
        | ExprKind::Assign { .. }
        | ExprKind::Await(_)
        | ExprKind::New(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::This => true,
        _ => false,
    }
}
