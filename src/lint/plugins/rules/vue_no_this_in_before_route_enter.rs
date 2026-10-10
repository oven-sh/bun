use crate::oxlint::vue::{Enclosing, EnclosingFunctions, enclosing_function, exported_object, find_property, is_vue_file};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Disallow `this` usage in a `beforeRouteEnter` method.
pub struct NoThisInBeforeRouteEnter;

const NO_THIS_IN_BEFORE_ROUTE_ENTER: Message =
    Message::new("", "`beforeRouteEnter` does NOT have access to `this` component instance.");

impl Rule for NoThisInBeforeRouteEnter {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-this-in-before-route-enter", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoThisInBeforeRouteEnter
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || !file.mentions("beforeRouteEnter") || !file.has_exprs([ExprTag::This]) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let guards: FxHashSet<Func> = cx.file().stmts_of_kind(StmtTag::ExportDefault).filter_map(before_route_enter).collect();
        if guards.is_empty() {
            return;
        }
        let mut memo = EnclosingFunctions::default();
        for this_expr in cx.file().exprs_of_kind(ExprTag::This).filter(|it| !it.is_jsx_tag_name()) {
            if let Some(function) = enclosing_function(Node::Expr(this_expr), Enclosing::Function, &mut memo)
                && guards.contains(&function)
                && function.body_span().is_some_and(|it| it.contains(this_expr.span()))
            {
                cx.report(this_expr, NO_THIS_IN_BEFORE_ROUTE_ENTER);
            }
        }
    }
}

/// The function with a body that is the `beforeRouteEnter` of an `export default { .. }`.
fn before_route_enter(stmt: Stmt<'_>) -> Option<Func<'_>> {
    let value = exported_object(stmt).and_then(|it| find_property(it, "beforeRouteEnter")).and_then(Prop::value);
    value.filter(|it| !it.is_parenthesized()).and_then(Expr::as_fn).filter(|it| !it.is_arrow() && it.body_span().is_some())
}
