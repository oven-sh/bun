use crate::react::is_create_element_call;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that namespaces are not used in React elements.
pub struct NoNamespace;

const NO_NAMESPACE: Message =
    Message::new("", "React component {{component_name}} must not be in a namespace, as React does not support them.");

impl Rule for NoNamespace {
    const META: Meta = Meta::oxlint(Plugin::React, "no-namespace", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNamespace
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                if let ExprKind::Jsx(jsx) = e.kind()
                    && let Some(name) = jsx.tag()
                {
                    check(name, cx);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_create_element_call(call)
                    && let Some(name) = call.args().first().filter(|it| !it.is_parenthesized())
                {
                    check(name, cx);
                }
            }
            _ => {}
        }
    }
}

/// `name`: in a tag, where one with a hyphen or a colon is a string, or the first argument of `createElement`.
fn check<'a>(name: Expr<'a>, cx: &Cx<'a, NoNamespace>) {
    if let Some(component_name) = name.as_string().filter(|it| strings::contains_char(it.bytes(), b':')) {
        cx.report(name, NO_NAMESPACE).data("component_name", component_name);
    }
}
