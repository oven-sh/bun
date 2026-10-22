use crate::conditions::{Condition, should_run};
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow explicit children snippet where it's not needed
pub struct NoUselessChildrenSnippet;

const USELESS_SNIPPET: Message =
    Message::new("uselessSnippet", "Found an unnecessary children snippet.");

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[],
    runes: &[],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

impl Rule for NoUselessChildrenSnippet {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-useless-children-snippet", Kind::Suggestion).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::SnippetBlock]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessChildrenSnippet
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        should_run(file, CONDITIONS).then_some(())
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let is_in_element = node.parent().is_some_and(|it| it.tag() == SvelteTag::Element);
        let is_children = node.code(Role::Id).is_some_and(|it| it.text() == b"children");
        // Only comments can be between the parentheses.
        let has_params = node.code(Role::Params).is_some_and(|it| it.roots().next().is_some());
        if is_in_element && is_children && !has_params {
            cx.report(node, USELESS_SNIPPET);
        }
    }
}
