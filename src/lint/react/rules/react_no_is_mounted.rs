use bun_lint_oxlint::ast_util::{as_member_expression, as_method_definition, as_object_property, static_property_name};
use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// This rule prevents using `isMounted` in class components.
pub struct NoIsMounted;

const NO_IS_MOUNTED: Message = Message::new("", "Do not use `isMounted`.");

impl Rule for NoIsMounted {
    const META: Meta = Meta::oxlint(Plugin::React, "no-is-mounted", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Whether something is in a property of an object or in a method of a class.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoIsMounted
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_jsx(file) && file.mentions("isMounted")).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(member) = e.callee().and_then(as_member_expression) else {
            return;
        };
        if !static_property_name(member).is_some_and(|name| name.is("isMounted"))
            || !member.object().is_some_and(|object| object.tag() == ExprTag::This && !object.is_parenthesized())
        {
            return;
        }
        let is_method = |node: Node<'a>| as_object_property(node).is_some() || as_method_definition(node).is_some();
        if cx.state.find(Node::Expr(e), |_, parent| is_method(parent).then_some(())).is_some() {
            cx.report(e, NO_IS_MOUNTED);
        }
    }
}
