use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, static_property_name};
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Prefer using a negative index over `.length - index` when possible.
pub struct PreferNegativeIndex;

const PREFER_NEGATIVE_INDEX: Message = Message::new("", "Prefer negative index over `.length - index` when possible.");

enum TypeOptions {
    String,
    Array,
    TypedArray,
    Literal,
    Unknown,
}

impl Rule for PreferNegativeIndex {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-negative-index", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferNegativeIndex
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("length") && file.mentions_any(&["slice", "at", "splice", "subarray", "toSpliced"]))
            .then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(self, e, cx);
    }
}

fn check<'a>(_: &PreferNegativeIndex, e: Expr<'a>, cx: &mut Cx<'a, PreferNegativeIndex>) {
    let Some(call_expr) = e.as_call().filter(|it| !it.args().is_empty()) else {
        return;
    };
    let Some((callee, callee_object_expr)) =
        as_member_expression(call_expr.callee()).and_then(|it| Some((it, it.object()?)))
    else {
        return;
    };
    let Some(name) = static_property_name(callee) else {
        return;
    };
    // `Array.prototype.slice.call(a, ..)`
    let prototype_method = as_member_expression(callee_object_expr).filter(|_| name.is_any(&["call", "apply"]));
    let (callee_name, callee_type) = match prototype_method {
        Some(method) => match (static_property_name(method), method.object()) {
            (Some(callee_name), Some(object)) => (callee_name, get_prototype_callee_type(object)),
            _ => return,
        },
        None => (name, TypeOptions::Literal),
    };
    if !matches!(
        (callee_type, callee_name.bytes()),
        (TypeOptions::String, b"slice" | b"at")
            | (TypeOptions::TypedArray, b"slice" | b"at" | b"subarray")
            | (TypeOptions::Array, b"slice" | b"at" | b"splice" | b"toSpliced")
            | (TypeOptions::Literal, b"slice" | b"at" | b"splice" | b"subarray" | b"toSpliced")
    ) {
        return;
    }
    let is_prototype = prototype_method.is_some();
    let identifier_expr = match (is_prototype, call_expr.args().first()) {
        (false, _) => callee_object_expr,
        (true, Some(first_arg)) if first_arg.tag() != ExprTag::Spread => first_arg,
        _ => return,
    };
    let range_increment = if callee_name.is_any(&["slice", "subarray"]) { 2 } else { 1 };
    let arg_range_end = usize::from(is_prototype) + if is_prototype && name.is("apply") { 1 } else { range_increment };
    let length_of_it = |binary_expr: Expr<'a>| {
        get_binary_left_expr(binary_expr)
            .filter(|it| it.object().is_some_and(|object| is_same_node(identifier_expr, object)))
    };
    let mut member_exprs: SmallVec<[Expr<'a>; 2]> = SmallVec::new();
    for arg_expr in call_expr.args().iter().take(arg_range_end).filter(|it| !it.is_parenthesized()) {
        match arg_expr.kind() {
            ExprKind::Binary { .. } => member_exprs.extend(length_of_it(arg_expr)),
            ExprKind::Array(elements) => {
                let elements = elements.iter().take(range_increment).filter(|it| !it.is_parenthesized());
                member_exprs.extend(elements.filter_map(length_of_it));
            }
            _ => {}
        }
    }
    if member_exprs.is_empty() {
        return;
    }
    cx.report(e, PREFER_NEGATIVE_INDEX).fix(|fixer| {
        // With the blank after it.
        let with_blank = |span: Span| match fixer.file().text().get(span.end as usize) {
            Some(b' ') => Span::new(span.start, span.end + 1),
            _ => span,
        };
        member_exprs.iter().map(|it| fixer.remove(with_blank(it.span()))).collect::<Vec<_>>()
    });
}

fn is_same_node<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    let (mut left, mut right) = (left, right);
    loop {
        if left.is_parenthesized() || right.is_parenthesized() {
            return false;
        }
        if is_same_expression(left, right) {
            return true;
        }
        if left.is_chain_root() || right.is_chain_root() {
            return false;
        }
        return match (left.kind(), right.kind()) {
            // Whatever they are of.
            (ExprKind::Index { index: left_index, .. }, ExprKind::Index { index: right_index, .. }) => {
                (left, right) = (left_index, right_index);
                continue;
            }
            (ExprKind::String(string), ExprKind::Number(_)) => string.bytes() == right.text(),
            (ExprKind::Number(_), ExprKind::String(string)) => left.text() == string.bytes(),
            (ExprKind::Template(template), ExprKind::String(string))
            | (ExprKind::String(string), ExprKind::Template(template)) => template.as_static() == Some(string),
            _ => false,
        };
    }
}

fn get_prototype_callee_type(expression: Expr) -> TypeOptions {
    if expression.is_parenthesized() || expression.is_chain_root() {
        return TypeOptions::Unknown;
    }
    match expression.kind() {
        ExprKind::Array(_) => TypeOptions::Array,
        ExprKind::String(_) => TypeOptions::String,
        ExprKind::Dot { obj, name, .. } if name.name().is("prototype") => {
            match get_inner_expression(obj).as_ident().map(Name::bytes).unwrap_or_default() {
                b"String" => TypeOptions::String,
                b"Array" => TypeOptions::Array,
                b"Int8Array" | b"Uint8Array" | b"Uint8ClampedArray" | b"Int16Array" | b"Uint16Array"
                | b"Int32Array" | b"Uint32Array" | b"Float32Array" | b"Float64Array" | b"BigInt64Array"
                | b"BigUint64Array" | b"ArrayBuffer" => TypeOptions::TypedArray,
                _ => TypeOptions::Unknown,
            }
        }
        _ => TypeOptions::Unknown,
    }
}

/// The `a.length` of `a.length - 1 - 2`, where each number is not 0. `binary_expr`: not in parentheses.
fn get_binary_left_expr(binary_expr: Expr<'_>) -> Option<Expr<'_>> {
    let mut at = binary_expr;
    while let ExprKind::Binary { op: BinOp::Sub, left, right } = at.kind() {
        if !matches!(right.kind(), ExprKind::Number(n) if n != 0.0) || right.is_parenthesized() {
            return None;
        }
        // One pair of parentheses is looked into.
        if left.tag() == ExprTag::Binary && left.parens().len() <= 1 {
            at = left;
            continue;
        }
        return Some(left).filter(|it| {
            !it.is_parenthesized()
                && !it.is_chain_root()
                && matches!(it.kind(), ExprKind::Dot { name, .. } if name.name().is("length"))
        });
    }
    None
}
