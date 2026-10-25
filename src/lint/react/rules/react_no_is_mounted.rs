use crate::react::is_jsx;
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_type_name;
use bun_lint_oxlint::ast_util::{as_member_expression, as_method_definition, as_object_property, static_property_name};

/// Disallow usage of isMounted
pub struct NoIsMounted;

const NO_IS_MOUNTED: Message = Message::new("noIsMounted", "Do not use isMounted");
const OXLINT: Message = Message::new("", "Do not use `isMounted`.");

impl Rule for NoIsMounted {
    const META: Meta = Meta::plugin(Plugin::React, "no-is-mounted", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Caches whether a node is inside an object's property or a class's method.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoIsMounted
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // oxlint only checks files that can contain JSX, and skips `this.#isMounted()`.
        let is_candidate = match file.language().is_oxlint {
            true => is_jsx(file) && file.mentions("isMounted"),
            false => file.mentions("isMounted") || file.mentions("#isMounted"),
        };
        is_candidate.then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let Some(callee) = e.callee() else {
            return;
        };
        // oxlint accepts `this["isMounted"]` but not `this[isMounted]`. Its AST has a node for parentheses.
        let is_called = match is_oxlint {
            true => as_member_expression(callee).and_then(static_property_name).is_some_and(|it| it.is("isMounted")),
            false => is_member_called(callee, "isMounted"),
        };
        let is_this = |object: Expr| object.tag() == ExprTag::This && !(is_oxlint && object.is_parenthesized());
        if !is_called || !callee.object().is_some_and(is_this) {
            return;
        }
        // oxlint doesn't count a pattern's property.
        let is_method = |node: Node<'a>| match is_oxlint {
            true => as_object_property(node).is_some() || as_method_definition(node).is_some(),
            false => matches!(estree_type_name(node), "Property" | "MethodDefinition"),
        };
        if cx.state.find(Node::Expr(e), |_, parent| is_method(parent).then_some(())).is_none() {
            return;
        }
        // oxlint reports the call.
        match is_oxlint {
            true => cx.report(e, OXLINT),
            false => cx.report(callee, NO_IS_MOUNTED),
        };
    }
}
