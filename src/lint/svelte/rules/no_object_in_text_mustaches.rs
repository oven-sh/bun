use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow objects in text mustache interpolation
pub struct NoObjectInTextMustaches;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected {{phrase}} in text mustache interpolation.",
);

impl Rule for NoObjectInTextMustaches {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-object-in-text-mustaches", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::MustacheTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoObjectInTextMustaches
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(Node::Expr(e)) = node.code(Role::Expression).and_then(|it| it.node()) else {
            return;
        };
        let phrase = match e.kind() {
            ExprKind::Object(_) => "object",
            ExprKind::Array(_) => "array",
            ExprKind::Fn(_) => "function",
            ExprKind::Class(_) => "class",
            _ => return,
        };
        // Maybe props.
        if let Some(parent) = node.parent()
            && parent.tag() == SvelteTag::Attribute
            && parent.nodes(Role::Value).count() == 1
        {
            return;
        }
        cx.report(node, UNEXPECTED).data("phrase", phrase);
    }
}
