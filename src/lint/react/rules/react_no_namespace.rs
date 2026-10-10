use crate::react::is_create_element_call;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Enforce that namespaces are not used in React elements
pub struct NoNamespace;

const NO_NAMESPACE: Message = Message::new(
    "noNamespace",
    "React component {{name}} must not be in a namespace, as React does not support them",
);
const OXLINT: Message =
    Message::new("", "React component {{component_name}} must not be in a namespace, as React does not support them.");

impl Rule for NoNamespace {
    const META: Meta = Meta::plugin(Plugin::React, "no-namespace", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma. oxlint knows none.
    type State<'a> = OnceCell<&'a [u8]>;

    fn new(_: &Options) -> Self {
        NoNamespace
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // Upstream takes `React.#createElement` for `React.createElement`.
        if !file.mentions("createElement") && (file.language().is_oxlint || !file.mentions("#createElement")) {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(OnceCell::new())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let call = e.as_call();
        // In a tag, where a name with a hyphen or a colon is a string, or the first argument of `createElement`.
        let name = match call {
            // oxlint has a node for parentheses.
            Some(call) => call.args().first().filter(|it| !is_oxlint || !it.is_parenthesized()),
            None => match e.kind() {
                ExprKind::Jsx(jsx) => jsx.tag(),
                _ => None,
            },
        };
        let Some(name) = name else {
            return;
        };
        let Some(component_name) = name.as_string().filter(|it| strings::contains_char(it.bytes(), b':')) else {
            return;
        };
        // oxlint takes the `createElement` of everything but `document`.
        let is_element = call.is_none_or(|call| match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state.get_or_init(|| get_from_context(cx.file()))),
        });
        if !is_element {
            return;
        }
        if is_oxlint {
            // oxlint points at the name.
            cx.report(name, OXLINT).data("component_name", component_name);
            return;
        }
        let whole = match e.kind() {
            ExprKind::Jsx(jsx) => jsx.opening_span(),
            _ => e.span(),
        };
        cx.report(whole, NO_NAMESPACE).data("name", component_name);
    }
}
