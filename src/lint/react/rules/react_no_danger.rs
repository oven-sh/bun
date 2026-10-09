use bun_lint_oxlint::ast_util::static_name;
use crate::jsx::{as_jsx_element, has_jsx_prop};
use crate::react::{is_create_element_call, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prevents the use of `dangerouslySetInnerHTML` prop.
pub struct NoDanger;

const NO_DANGER: Message = Message::new("", "Do not use `dangerouslySetInnerHTML` prop");

impl Rule for NoDanger {
    const META: Meta = Meta::oxlint(Plugin::React, "no-danger", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDanger
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) || !file.mentions("dangerouslySetInnerHTML") {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            if let Some(key) = as_jsx_element(e).and_then(|jsx| has_jsx_prop(jsx, "dangerouslySetInnerHTML")?.key()) {
                cx.report(key.span(cx.file()), NO_DANGER);
            }
        });
        if !file.mentions("createElement") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call) = e.as_call()
                && is_create_element_call(call)
                && let Some(ExprKind::Object(properties)) =
                    call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
            {
                let is_danger = |key: &Key| static_name(*key).is_some_and(|name| name.is("dangerouslySetInnerHTML"));
                for key in properties.iter().filter_map(Prop::key).filter(is_danger) {
                    cx.report(key.inner_span(cx.file()), NO_DANGER);
                }
            }
        });
    }
}
