use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, static_property_info};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule disallows the use of `findDOMNode`, which was deprecated in 2018 and removed in React 19.
pub struct NoFindDomNode;

const NO_FIND_DOM_NODE: Message = Message::new("", "Unexpected call to `findDOMNode`.");

impl Rule for NoFindDomNode {
    const META: Meta = Meta::oxlint(Plugin::React, "no-find-dom-node", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFindDomNode
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("findDOMNode") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(callee) = e.callee() else {
                return;
            };
            let ident = get_inner_expression(callee);
            if ident.tag() == ExprTag::Ident {
                if ident.is_ident("findDOMNode") {
                    cx.report(ident, NO_FIND_DOM_NODE);
                }
                return;
            }
            if let Some(member) = get_member_expr(callee)
                && let Some((span, name)) = static_property_info(member)
                && name.is("findDOMNode")
                && let Some(object) = member.object().and_then(|it| get_inner_expression(it).as_ident())
                && object.is_any(&["React", "ReactDOM", "ReactDom"])
            {
                cx.report(span, NO_FIND_DOM_NODE);
            }
        });
    }
}
