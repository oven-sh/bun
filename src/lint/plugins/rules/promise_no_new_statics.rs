use bun_lint_oxlint::ast_util::{get_member_expr, is_reference_to_global_variable, static_property_name};
use crate::oxlint::promise::PROMISE_STATIC_METHODS;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows calling new on static `Promise` methods.
pub struct NoNewStatics;

const STATIC_PROMISE: Message = Message::new("", "Do not use `new` on `Promise.{{static_name}}`");

impl Rule for NoNewStatics {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-new-statics", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewStatics
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Promise") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let Some(member_expr) = e.callee().and_then(get_member_expr) else {
                return;
            };
            let Some(ident) = member_expr.object().filter(|it| it.is_ident("Promise") && !it.is_parenthesized()) else {
                return;
            };
            let Some(prop_name) = static_property_name(member_expr).filter(|it| it.is_any(&PROMISE_STATIC_METHODS)) else {
                return;
            };
            if is_reference_to_global_variable(ident) {
                let (start, end) = (e.span().start, ident.span().start);
                cx.report(Span::new(start, end.saturating_sub(1)), STATIC_PROMISE)
                    .data("static_name", prop_name)
                    .fix(|fixer| fixer.remove(Span::new(start, end)));
            }
        });
    }
}
