use bun_lint::ast::svelte::variables::DefNode;
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// enforce keys to use variables defined in the `{#each}` block
pub struct ValidEachKey;

const KEY_USE_EACH_VARS: Message = Message::new(
    "keyUseEachVars",
    "Expected key to use the variables which are defined by the `{#each}` block.",
);

impl Rule for ValidEachKey {
    const META: Meta = Meta::plugin(Plugin::Svelte, "valid-each-key", Kind::Suggestion).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::EachBlock]);
    no_state!();

    fn new(_: &Options) -> Self {
        ValidEachKey
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = node.code(Role::Key) else {
            return;
        };
        let Some(key_node) = key.node() else {
            return;
        };
        let file = cx.file();
        let within = key_node.span();
        // A variable in the key's scope that this block's item or index declares, and that the key uses.
        let uses_its_variable = file.svelte_variables_of(key_node.scope()).any(|variable| {
            let is_declared_here = variable.definitions().any(|it| it.node() == Some(DefNode::Svelte(node)));
            is_declared_here && variable.references().any(|it| within.contains(it.span()))
        });
        if !uses_its_variable {
            cx.report(key, KEY_USE_EACH_VARS);
        }
    }
}
