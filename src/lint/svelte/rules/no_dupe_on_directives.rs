use crate::duplicates::{duplicates, line_of_other};
use bun_lint::ast::svelte::{SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow duplicate `on:` directives
pub struct NoDupeOnDirectives;

const DUPLICATION: Message = Message::new(
    "duplication",
    "This `on:{{type}}` directive is the same and duplicate directives in L{{lineNo}}.",
);

impl Rule for NoDupeOnDirectives {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-dupe-on-directives", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::StartTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeOnDirectives
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        for (name, group) in duplicates(node, SvelteKind::EventHandler, |it| it.name().to_vec()) {
            for &directive in &group {
                cx.report(directive, DUPLICATION)
                    .on_exit(true)
                    .data("type", name.clone())
                    .data("lineNo", line_of_other(&group, directive).to_string());
            }
        }
    }
}
