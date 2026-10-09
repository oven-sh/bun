use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_member_expr, is_import_from_module, is_import_symbol, static_property_name,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the usage of `React.Children`, as it is considered a bad practice.
pub struct NoReactChildren;

const NO_REACT_CHILDREN: Message = Message::new("", "`React.Children` should not be used.");

impl Rule for NoReactChildren {
    const META: Meta = Meta::oxlint(Plugin::React, "no-react-children", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoReactChildren
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Children") || !file.has_stmts([StmtTag::Import]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(member) = e.callee().and_then(get_member_expr) else {
                return;
            };
            let Some(object) = member.object().map(get_inner_expression) else {
                return;
            };
            let is_children = match object.tag() {
                // `Children.map(..)`, where `Children` is what `react` exports under this name
                ExprTag::Ident => is_import_symbol(object, "react", "Children"),
                // `React.Children.map(..)`, where `React` is anything that is imported from `react`
                ExprTag::Dot | ExprTag::Index => {
                    !object.is_chain_root()
                        && static_property_name(object).is_some_and(|name| name.is("Children"))
                        && object.object().is_some_and(|it| is_import_from_module(get_inner_expression(it), "react"))
                }
                _ => false,
            };
            if is_children {
                cx.report(member, NO_REACT_CHILDREN);
            }
        });
    }
}
