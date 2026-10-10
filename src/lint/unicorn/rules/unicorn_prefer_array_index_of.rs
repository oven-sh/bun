use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, is_method_call, static_property_info};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces using `indexOf` or `lastIndexOf` instead of `findIndex` or `findLastIndex` when the callback is a simple
/// strict equality comparison.
pub struct PreferArrayIndexOf;

const PREFER_ARRAY_INDEX_OF: Message =
    Message::new("", "Prefer `indexOf` over `findIndex` for simple equality checks");

/// `x => x === a`, `function (x) { return a === x }`, where that is the only `x`.
fn is_simple_compare_callback_function<'a>(e: Expr<'a>) -> bool {
    let Some(func) = get_inner_expression(e).as_fn().filter(|it| !it.is_async() && !it.is_generator()) else {
        return false;
    };
    let mut params = func.params().iter().filter(|it| !it.is_rest());
    let (Some(param), None) = (params.next(), params.next()) else {
        return false;
    };
    let query = match func.body() {
        FnBody::Expr(body) => Some(body),
        _ => func.body_statements().and_then(|it| it.iter().find(|it| it.directive().is_none())).and_then(|it| {
            match it.kind() {
                StmtKind::Return(argument) => argument,
                _ => None,
            }
        }),
    };
    let Some(ExprKind::Binary { op: BinOp::EqEqEq, left, right }) =
        query.filter(|it| !it.is_parenthesized()).map(Expr::kind)
    else {
        return false;
    };
    let Some(symbol) = param.pat().symbol().filter(|_| param.pat().tag() == PatTag::Ident) else {
        return false;
    };
    let is_param = |it: Expr<'a>| get_inner_expression(it).symbol() == Some(symbol);
    // Not what the default value of the parameter is written to.
    (is_param(left) || is_param(right))
        && symbol.references().filter(|it| !matches!(it.node(), Node::Pat(_))).take(2).count() == 1
}

impl Rule for PreferArrayIndexOf {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-index-of", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferArrayIndexOf
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&["findIndex", "findLastIndex"]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && is_method_call(call, None, Some(&["findIndex", "findLastIndex"]), Some(1), Some(1))
            && call.args().first().is_some_and(is_simple_compare_callback_function)
        {
            let property = as_member_expression(call.callee()).and_then(static_property_info);
            cx.report(property.map_or_else(|| e.span(), |it| it.0), PREFER_ARRAY_INDEX_OF);
        }
    }
}
