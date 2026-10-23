use bun_lint::ast::svelte::{SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow use of `{@html}` to prevent XSS attack
pub struct NoAtHtmlTags;

const UNEXPECTED: Message = Message::new("unexpected", "`{@html}` can lead to XSS attack.");

impl Rule for NoAtHtmlTags {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-at-html-tags", Kind::Suggestion).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::MustacheTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAtHtmlTags
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        if node.kind() == SvelteKind::Raw {
            cx.report(node, UNEXPECTED)
                .by_selector("SvelteMustacheTag[kind=raw]");
        }
    }
}
