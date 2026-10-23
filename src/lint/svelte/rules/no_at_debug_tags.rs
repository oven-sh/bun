use bun_lint::ast::svelte::{SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow the use of `{@debug}`
pub struct NoAtDebugTags;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected `{@debug}`.");
const SUGGEST_REMOVE: Message = Message::new("suggestRemove", "Remove `{@debug}` from the source");

impl Rule for NoAtDebugTags {
    const META: Meta =
        Meta::plugin(Plugin::Svelte, "no-at-debug-tags", Kind::Problem).recommended().has_suggestions();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::DebugTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAtDebugTags
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        cx.report(node, UNEXPECTED)
            .suggest(SUGGEST_REMOVE, |fixer| fixer.remove(node));
    }
}
