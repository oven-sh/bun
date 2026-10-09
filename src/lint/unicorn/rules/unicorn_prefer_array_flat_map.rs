use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers the use of `.flatMap()` when `map()` and `flat()` are used together.
pub struct PreferArrayFlatMap;

const PREFER_ARRAY_FLAT_MAP: Message =
    Message::new("", "`Array.flatMap` performs `Array.map` and `Array.flat` in one step.");

/// `Children.map(..)`, `React.Children.map(..)`
fn is_ignored_call_expression(call: Call) -> bool {
    let object = get_member_expr(call.callee()).and_then(Expr::object).map(get_inner_expression);
    object.is_some_and(|object| match object.kind() {
        ExprKind::Ident(name) => name.is("Children"),
        ExprKind::Dot { name, .. } => name.name().is("Children") && !object.is_chain_root(),
        _ => false,
    })
}

impl Rule for PreferArrayFlatMap {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-flat-map", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferArrayFlatMap
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("flat") || !file.mentions("map") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(flat_call) = e.as_call().filter(|it| it.args().len() <= 1 && !it.is_optional()) else {
                return;
            };
            let callee = flat_call.callee();
            if !is_method_call(flat_call, None, Some(&["flat"]), None, None)
                || callee.is_parenthesized()
                || callee.is_optional()
            {
                return;
            }
            let Some(object) = callee.object().filter(|it| !it.is_chain_root()) else {
                return;
            };
            let Some(map_call) = object.as_call().filter(|it| !it.is_optional()) else {
                return;
            };
            if !is_method_call(map_call, None, Some(&["map"]), None, None) || is_ignored_call_expression(map_call) {
                return;
            }
            // `.flat(1.5)` is `.flat(1)`.
            let is_one = |it: Expr| {
                !it.is_parenthesized() && matches!(it.kind(), ExprKind::Number(depth) if depth.floor() == 1.0)
            };
            if !flat_call.args().first().is_none_or(is_one) {
                return;
            }
            cx.report(e, PREFER_ARRAY_FLAT_MAP).fix(|fixer| {
                let end_of_map = map_call.callee().outer_span().end;
                [
                    fixer.remove(Span::after(object.outer_span(), e.span().end)),
                    fixer.replace(Span::new(end_of_map.saturating_sub(3), end_of_map), "flatMap"),
                ]
            });
        });
    }
}
