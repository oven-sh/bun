use crate::react::{is_create_element_call, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow void DOM elements (e.g. `<img />`, `<br />`) from receiving children.
pub struct VoidDomElementsNoChildren;

const VOID_DOM_ELEMENTS_NO_CHILDREN: Message =
    Message::new("", "Void DOM element <\"{{tag}}\" /> cannot receive children.");

const VOID_DOM_ELEMENTS: [&str; 16] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "menuitem", "meta", "param",
    "source", "track", "wbr",
];

const CHILDREN_OR_DANGER: [&str; 2] = ["children", "dangerouslySetInnerHTML"];

impl Rule for VoidDomElementsNoChildren {
    const META: Meta = Meta::oxlint(Plugin::React, "void-dom-elements-no-children", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        VoidDomElementsNoChildren
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            if let Some(identifier) = jsx.tag()
                && let Some(name) = identifier.as_ident()
                && name.is_any(&VOID_DOM_ELEMENTS)
                && (jsx.children_with_whitespace().next().is_some()
                    || jsx
                        .attrs()
                        .iter()
                        .filter_map(Prop::key)
                        .any(|key| key.name().is_some_and(|it| it.is_any(&CHILDREN_OR_DANGER))))
            {
                cx.report(identifier, VOID_DOM_ELEMENTS_NO_CHILDREN).data("tag", name);
            }
        });
        if !file.mentions("createElement") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|call| is_create_element_call(*call)) else {
                return;
            };
            let arguments = call.args();
            if let Some(element_name) = arguments.first().filter(|it| !it.is_parenthesized())
                && let Some(name) = element_name.as_string()
                && name.is_any(&VOID_DOM_ELEMENTS)
                && let Some(ExprKind::Object(properties)) =
                    arguments.get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
                && (arguments.len() > 2 || properties.iter().any(is_children_or_danger))
            {
                cx.report(element_name, VOID_DOM_ELEMENTS_NO_CHILDREN).data("tag", name);
            }
        });
    }
}

/// `children: ..`, not `"children": ..`
fn is_children_or_danger(property: Prop) -> bool {
    matches!(property.key().map(Key::kind), Some(KeyKind::Ident(name)) if name.is_any(&CHILDREN_OR_DANGER))
}
