use bun_lint_oxlint::ast_util::{as_call_expression, as_function_expression, get_inner_expression, is_method_call};
use crate::jsx::{as_jsx_element, get_prop_value};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use smallvec::{SmallVec, smallvec};

/// Warn if an element uses an Array index in its key.
pub struct NoArrayIndexKey;

const NO_ARRAY_INDEX_KEY: Message = Message::new("", "Usage of Array index in keys is not allowed");

impl Rule for NoArrayIndexKey {
    const META: Meta = Meta::oxlint(Plugin::React, "no-array-index-key", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The parameter that is the index in the callback of the innermost `a.map(..)` or the like around something.
    type State<'a> = AncestorMemo<'a, Option<Symbol<'a>>>;

    fn new(_: &Options) -> Self {
        NoArrayIndexKey
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Jsx]);
        if file.mentions("cloneElement") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("key") {
            return None;
        }
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                let Some(jsx) = as_jsx_element(e) else {
                    return;
                };
                let keys = jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("key")));
                check(e, keys.filter_map(|it| Some((it, get_prop_value(it)?.as_expression()?))), cx);
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_method_call(call, Some(&["React"]), Some(&["cloneElement"]), Some(2), Some(3))
                    && let Some(ExprKind::Object(properties)) =
                        call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
                {
                    let keys = properties
                        .iter()
                        .filter(|it| matches!(it.key().map(Key::kind), Some(KeyKind::Ident(key)) if key.is("key")));
                    check(e, keys.filter_map(|it| Some((it, it.value()?))), cx);
                }
            }
            _ => {}
        }
    }
}

/// `keys`: the attributes or the properties of `node` that are named `key`, with their values.
fn check<'a>(node: Expr<'a>, keys: impl Iterator<Item = (Prop<'a>, Expr<'a>)>, cx: &mut Cx<'a, NoArrayIndexKey>) {
    let mut keys = keys.peekable();
    if keys.peek().is_none() {
        return;
    }
    let Some(index_param) = cx.state.find(Node::Expr(node), |_, ancestor| find_index_param(ancestor)).flatten() else {
        return;
    };
    for (key, _) in keys.filter(|it| expression_uses_index(index_param, it.1)) {
        cx.report(key, NO_ARRAY_INDEX_KEY);
    }
}

fn is_index_reference<'a>(symbol: Symbol<'a>, expr: Expr<'a>) -> bool {
    get_inner_expression(expr).symbol() == Some(symbol)
}

/// `BinaryExpression`: not `a && b`, `a, b` and `#a in b`
fn as_binary_expression(expr: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match expr.kind() {
        ExprKind::Binary { op, left, right }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                && left.tag() != ExprTag::PrivateIdentifier
                && !expr.is_parenthesized() =>
        {
            Some((left, right))
        }
        _ => None,
    }
}

/// `expr` is `1 + index`, `a + (b - index)` without the parentheses, and so on.
fn binary_expression_uses_index<'a>(symbol: Symbol<'a>, expr: Expr<'a>) -> bool {
    let mut pending: SmallVec<[Expr<'a>; 4]> = smallvec![expr];
    while let Some(expr) = pending.pop() {
        if let Some((left, right)) = as_binary_expression(expr) {
            if is_index_reference(symbol, left) || is_index_reference(symbol, right) {
                return true;
            }
            pending.extend([left, right]);
        }
    }
    false
}

fn expression_uses_index<'a>(symbol: Symbol<'a>, expr: Expr<'a>) -> bool {
    // key={index}
    if is_index_reference(symbol, expr) {
        return true;
    }
    if expr.is_parenthesized() {
        return false;
    }
    match expr.kind() {
        // key={`abc${index}`}
        ExprKind::Template(template) => template.exprs().iter().any(|it| is_index_reference(symbol, it)),
        // key={1 + index}
        ExprKind::Binary { .. } => binary_expression_uses_index(symbol, expr),
        _ => as_call_expression(expr).is_some_and(|call| {
            let callee = call.callee();
            match callee.kind() {
                _ if callee.is_parenthesized() => false,
                // key={index.toString()}
                ExprKind::Dot { obj, name, .. } => name.name().is("toString") && is_index_reference(symbol, obj),
                // key={String(index)}
                ExprKind::Ident(name) => {
                    name.is("String")
                        && call
                            .args()
                            .first()
                            .is_some_and(|arg| arg.tag() != ExprTag::Spread && is_index_reference(symbol, arg))
                }
                _ => false,
            }
        }),
    }
}

/// `ancestor` is `a.map(..)` or the like: the parameter of its callback that is the index, if it has one.
fn find_index_param(ancestor: Node<'_>) -> Option<Option<Symbol<'_>>> {
    let call = ancestor.as_expr()?.as_call()?;
    let callee = Some(call.callee()).filter(|it| !it.is_parenthesized())?;
    let position = match callee.member_name()?.bytes() {
        b"every" | b"filter" | b"find" | b"findIndex" | b"flatMap" | b"forEach" | b"map" | b"some" => 1,
        b"reduce" | b"reduceRight" => 2,
        _ => return None,
    };
    let param =
        || call.args().first().and_then(as_function_expression)?.params().get(position).filter(|it| !it.is_rest());
    Some(param().and_then(|it| it.pat().symbol()))
}
