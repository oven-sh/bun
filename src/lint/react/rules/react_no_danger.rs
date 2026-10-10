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
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDanger
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_jsx(file) || !file.mentions("dangerouslySetInnerHTML") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                if let Some(key) = as_jsx_element(e).and_then(|jsx| has_jsx_prop(jsx, "dangerouslySetInnerHTML")?.key())
                {
                    cx.report(key.span(cx.file()), NO_DANGER);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_create_element_call(call)
                    && let Some(ExprKind::Object(properties)) =
                        call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
                {
                    let is_danger =
                        |key: &Key| static_name(*key).is_some_and(|name| name.is("dangerouslySetInnerHTML"));
                    for key in properties.iter().filter_map(Prop::key).filter(is_danger) {
                        cx.report(key.inner_span(cx.file()), NO_DANGER);
                    }
                }
            }
            _ => {}
        }
    }
}
