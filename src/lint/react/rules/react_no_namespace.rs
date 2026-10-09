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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamespace
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            if let ExprKind::Jsx(jsx) = e.kind()
                && let Some(name) = jsx.tag()
            {
                check(name, cx);
            }
        });
        if !file.mentions("createElement") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call) = e.as_call()
                && is_create_element_call(call)
                && let Some(name) = call.args().first().filter(|it| !it.is_parenthesized())
            {
                check(name, cx);
            }
        });
    }
}

/// `name`: in a tag, where one with a hyphen or a colon is a string, or the first argument of `createElement`.
fn check<'a>(name: Expr<'a>, cx: &Cx<'a, NoNamespace>) {
    if let Some(component_name) = name.as_string().filter(|it| strings::contains_char(it.bytes(), b':')) {
        cx.report(name, NO_NAMESPACE).data("component_name", component_name);
    }
}
