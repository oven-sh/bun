use bun_lint_oxlint::ast_util::{as_member_expression, is_method_call};
use crate::unicorn::does_expr_match_any_path;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the use of the `thisArg` parameter in array iteration methods such as `map`, `filter`, `some`, `every`,
/// and similar methods.
pub struct NoArrayMethodThisArgument;

const NO_ARRAY_METHOD_THIS_ARGUMENT: Message = Message::new("", "Avoid using 'thisArg' with array iteration methods");

const METHODS: [&str; 10] =
    ["every", "filter", "find", "findLast", "findIndex", "findLastIndex", "flatMap", "forEach", "map", "some"];

impl Rule for NoArrayMethodThisArgument {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-method-this-argument", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayMethodThisArgument
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| matches!(it.args().len(), 2 | 3) && !it.is_optional()) else {
                return;
            };
            let arguments = call_expr.args();
            let is_spread = |it: Expr| it.tag() == ExprTag::Spread;
            match (arguments.first(), arguments.get(1), arguments.get(2)) {
                // `array.map(callback, thisArgument)`
                (Some(callback), Some(this_argument), None) => {
                    if is_method_call(call_expr, None, Some(&METHODS), None, None)
                        && !is_node_not_function(callback)
                        && !is_spread(this_argument)
                        && !does_expr_match_any_path(call_expr.callee(), IGNORED)
                    {
                        cx.report(callback.outer_span(), NO_ARRAY_METHOD_THIS_ARGUMENT);
                    }
                }
                // `Array.from(iterable, callback, thisArgument)`
                (Some(iterable), Some(callback), Some(this_argument)) => {
                    if is_method_call(call_expr, Some(&["Array"]), Some(&["from", "fromAsync"]), None, None)
                        && !as_member_expression(call_expr.callee()).is_some_and(Expr::is_optional)
                        && !is_spread(iterable)
                        && !is_spread(this_argument)
                        && !is_node_not_function(callback)
                    {
                        cx.report(this_argument.outer_span(), NO_ARRAY_METHOD_THIS_ARGUMENT);
                    }
                }
                _ => {}
            }
        });
    }
}

fn is_node_not_function(expr: Expr) -> bool {
    if expr.tag() == ExprTag::Spread {
        return true;
    }
    if expr.is_parenthesized() || expr.is_chain_root() {
        return false;
    }
    match expr.kind() {
        ExprKind::Array(_)
        | ExprKind::Class(_)
        | ExprKind::Null
        | ExprKind::Regex(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Number(_)
        | ExprKind::Template(_)
        | ExprKind::Unary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Await(_)
        | ExprKind::New(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::This => true,
        ExprKind::Binary { op, left, .. } => {
            !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                && left.tag() != ExprTag::PrivateIdentifier
        }
        ExprKind::Ident(name) => name.is("undefined"),
        ExprKind::Call(call_expr) => !is_method_call(call_expr, None, Some(&["bind"]), None, None),
        _ => false,
    }
}

const IGNORED: &[&[&str]] = &[
    &["lodash", "every"],
    &["_", "every"],
    &["underscore", "every"],
    &["lodash", "filter"],
    &["_", "filter"],
    &["underscore", "filter"],
    &["Vue", "filter"],
    &["R", "filter"],
    &["lodash", "find"],
    &["_", "find"],
    &["underscore", "find"],
    &["R", "find"],
    &["lodash", "findLast"],
    &["_", "findLast"],
    &["underscore", "findLast"],
    &["R", "findLast"],
    &["lodash", "findIndex"],
    &["_", "findIndex"],
    &["underscore", "findIndex"],
    &["R", "findIndex"],
    &["lodash", "findLastIndex"],
    &["_", "findLastIndex"],
    &["underscore", "findLastIndex"],
    &["R", "findLastIndex"],
    &["lodash", "flatMap"],
    &["_", "flatMap"],
    &["lodash", "forEach"],
    &["_", "forEach"],
    &["React", "Children", "forEach"],
    &["Children", "forEach"],
    &["R", "forEach"],
    &["lodash", "map"],
    &["_", "map"],
    &["underscore", "map"],
    &["React", "Children", "map"],
    &["Children", "map"],
    &["jQuery", "map"],
    &["$", "map"],
    &["R", "map"],
    &["lodash", "some"],
    &["_", "some"],
];
