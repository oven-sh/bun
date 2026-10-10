use crate::util_eslint::mark_variable_as_used;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow variables used in JSX to be incorrectly marked as unused
pub struct JsxUsesVars;

/// `isTagName`: `<div>`
fn is_tag_name(name: Name) -> bool {
    name.bytes().first().is_some_and(u8::is_ascii_lowercase)
}

impl Rule for JsxUsesVars {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-uses-vars", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        JsxUsesVars
    }

    fn expr<'a>(&self, e: Expr<'a>, _: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(mut tag) = jsx.tag() else {
            return;
        };
        let is_member = tag.tag() == ExprTag::Dot;
        while let Some(object) = tag.object() {
            tag = object;
        }
        let name = match tag.kind() {
            ExprKind::Ident(name) if is_member || !is_tag_name(name) => name,
            // A parameter of TypeScript.
            ExprKind::This if is_member => e.file().name_of("this"),
            // `<a:b>` and `<a-b>` are no names of variables.
            _ => return,
        };
        mark_variable_as_used(name, Node::Expr(e));
    }
}
