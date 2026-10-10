use crate::react::{is_create_element_call, is_jsx};
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Disallow void DOM elements (e.g. `<img />`, `<br />`) from receiving children
pub struct VoidDomElementsNoChildren;

const NO_CHILDREN_IN_VOID_EL: Message =
    Message::new("noChildrenInVoidEl", "Void DOM element <{{element}} /> cannot receive children.");
const VOID_DOM_ELEMENTS_NO_CHILDREN: Message =
    Message::new("", "Void DOM element <\"{{tag}}\" /> cannot receive children.");

const VOID_DOM_ELEMENTS: [&str; 16] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "menuitem", "meta", "param",
    "source", "track", "wbr",
];

const CHILDREN_OR_DANGER: [&str; 2] = ["children", "dangerouslySetInnerHTML"];

impl Rule for VoidDomElementsNoChildren {
    const META: Meta = Meta::plugin(Plugin::React, "void-dom-elements-no-children", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma. oxlint knows none.
    type State<'a> = OnceCell<&'a [u8]>;

    fn new(_: &Options) -> Self {
        VoidDomElementsNoChildren
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // For upstream `React.#createElement()` is a call of `createElement`.
        let has_private_call = || !file.language().is_oxlint && file.mentions("#createElement");
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if file.mentions("createElement") || has_private_call() { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // oxlint does not run the rule on a file that cannot have JSX.
        (!file.language().is_oxlint || is_jsx(file)).then(OnceCell::new)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => jsx(e, cx),
            ExprTag::Call => call(e, cx),
            _ => {}
        }
    }
}

/// A void element with children, by one or by both of `reasons`. `name_node` is where `name` is written.
fn report<'a>(
    element: Expr<'a>,
    name_node: Expr<'a>,
    name: Name<'a>,
    reasons: [bool; 2],
    cx: &Cx<'a, VoidDomElementsNoChildren>,
) {
    if cx.language().is_oxlint {
        // oxlint points at the name, once.
        if reasons.contains(&true) {
            cx.report(name_node, VOID_DOM_ELEMENTS_NO_CHILDREN).data("tag", name);
        }
        return;
    }
    for _ in reasons.into_iter().filter(|it| *it) {
        cx.report(element, NO_CHILDREN_IN_VOID_EL).data("element", name);
    }
}

fn jsx<'a>(e: Expr<'a>, cx: &Cx<'a, VoidDomElementsNoChildren>) {
    let ExprKind::Jsx(jsx) = e.kind() else {
        return;
    };
    if let Some(identifier) = jsx.tag()
        && let Some(name) = identifier.as_ident()
        && name.is_any(&VOID_DOM_ELEMENTS)
    {
        let has_children = jsx.children_with_whitespace().next().is_some();
        let has_children_attribute_or_danger = jsx
            .attrs()
            .iter()
            .filter_map(Prop::key)
            .any(|key| key.name().is_some_and(|it| it.is_any(&CHILDREN_OR_DANGER)));
        report(e, identifier, name, [has_children, has_children_attribute_or_danger], cx);
    }
}

fn call<'a>(e: Expr<'a>, cx: &Cx<'a, VoidDomElementsNoChildren>) {
    let Some(call) = e.as_call() else {
        return;
    };
    let is_oxlint = cx.language().is_oxlint;
    // oxlint has a node for parentheses.
    let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
    let arguments = call.args();
    if let Some(element_name) = arguments.first().filter(is_seen)
        && let Some(name) = element_name.as_string()
        && name.is_any(&VOID_DOM_ELEMENTS)
        && let Some(ExprKind::Object(properties)) = arguments.get(1).filter(is_seen).map(Expr::kind)
        // oxlint takes the `createElement` of everything but `document`.
        && match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state.get_or_init(|| get_from_context(cx.file()))),
        }
    {
        let has_children_prop_or_danger = properties.iter().filter_map(Prop::key).any(|key| match is_oxlint {
            // oxlint: not `[children]: ..`
            true => matches!(key.kind(), KeyKind::Ident(name) if name.is_any(&CHILDREN_OR_DANGER)),
            false => name_of_key(key).is_some_and(|it| CHILDREN_OR_DANGER.iter().any(|name| name.as_bytes() == it)),
        });
        report(e, element_name, name, [arguments.len() > 2, has_children_prop_or_danger], cx);
    }
}
