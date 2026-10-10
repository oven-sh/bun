use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use crate::oxlint::promise::PROMISE_STATIC_METHODS;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow use of non-standard Promise static methods.
pub struct SpecOnly {
    allowed_methods: Vec<String>,
}

const SPEC_ONLY: Message = Message::new("", "Avoid using non-standard `Promise.{{prop_name}}` method.");

impl Rule for SpecOnly {
    const META: Meta = Meta::oxlint(Plugin::Promise, "spec-only", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        SpecOnly { allowed_methods: options.object(0).strings("allowedMethods").into_iter().map(String::from).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Promise").then_some(())
    }

    fn expr<'a>(&self, member_expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !member_expr.object().is_some_and(|object| get_inner_expression(object).is_ident("Promise")) {
            return;
        }
        let prop_name = match (static_property_name(member_expr), member_expr.index()) {
            (Some(name), _) => name.bytes(),
            // The name of `Promise[/a/]` is `/a/`.
            (None, Some(index)) if index.tag() == ExprTag::Regex && !index.is_parenthesized() => index.text(),
            _ => return,
        };
        if !PROMISE_STATIC_METHODS.iter().any(|it| it.as_bytes() == prop_name)
            && !self.allowed_methods.iter().any(|it| it.as_bytes() == prop_name)
            && !member_expr.is_jsx_tag_name()
            && !member_expr.is_in_type_query()
        {
            cx.report(member_expr, SPEC_ONLY).data("prop_name", prop_name);
        }
    }
}
