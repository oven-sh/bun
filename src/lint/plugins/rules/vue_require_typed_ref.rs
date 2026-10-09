use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::oxlint::vue::{EnclosingDeclarators, enclosing_variable_declarator};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require `ref` and `shallowRef` functions to be strongly typed.
pub struct RequireTypedRef;

const REQUIRE_TYPED_REF: Message =
    Message::new("", "Specify type parameter for `{{name}}` function, otherwise created variable will not be typechecked.");

impl Rule for RequireTypedRef {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-typed-ref", Kind::Suggestion);
    type State<'a> = EnclosingDeclarators<'a>;

    fn new(_: &Options) -> Self {
        RequireTypedRef
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.is_javascript() || !file.mentions_any(&["ref", "shallowRef"]) {
            return EnclosingDeclarators::default();
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            let Some(name) = get_inner_expression(call_expr.callee()).as_ident().filter(|it| it.is_any(&["ref", "shallowRef"])) else {
                return;
            };
            // `ref()`, `ref(null)`, `ref(undefined)`
            let is_value = |it: Expr| it.is_parenthesized() || it.tag() != ExprTag::Null && !it.is_ident("undefined");
            let is_valid_first_arg = call_expr.args().first().is_some_and(is_value);
            if !is_valid_first_arg
                && call_expr.type_args().angle_brackets_span().is_none()
                && !enclosing_variable_declarator(e, &mut cx.state).is_some_and(|it| it.ty().is_some())
            {
                cx.report(e, REQUIRE_TYPED_REF).data("name", name);
            }
        });
        EnclosingDeclarators::default()
    }
}
