use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, static_property_info};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of findDOMNode
pub struct NoFindDomNode;

const NO_FIND_DOM_NODE: Message = Message::new(
    "noFindDOMNode",
    "Do not use findDOMNode. It doesn’t work with function components and is deprecated in StrictMode. See https://reactjs.org/docs/react-dom.html#finddomnode",
);
const OXLINT: Message = Message::new("", "Unexpected call to `findDOMNode`.");

impl Rule for NoFindDomNode {
    const META: Meta = Meta::plugin(Plugin::React, "no-find-dom-node", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFindDomNode
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint passes over `a.#findDOMNode()`.
        let is_mentioned =
            file.mentions("findDOMNode") || (!file.language().is_oxlint && file.mentions("#findDOMNode"));
        is_mentioned.then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.callee() else {
            return;
        };
        if !cx.language().is_oxlint {
            if callee.is_ident("findDOMNode") || is_member_called(callee, "findDOMNode") {
                cx.report(callee, NO_FIND_DOM_NODE);
            }
            return;
        }
        // oxlint looks through parentheses and TypeScript's wrappers, knows three objects, and points at the name.
        let ident = get_inner_expression(callee);
        if ident.tag() == ExprTag::Ident {
            if ident.is_ident("findDOMNode") {
                cx.report(ident, OXLINT);
            }
            return;
        }
        if let Some(member) = get_member_expr(callee)
            && let Some((span, name)) = static_property_info(member)
            && name.is("findDOMNode")
            && let Some(object) = member.object().and_then(|it| get_inner_expression(it).as_ident())
            && object.is_any(&["React", "ReactDOM", "ReactDom"])
        {
            cx.report(span, OXLINT);
        }
    }
}
