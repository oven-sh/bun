use bun_core::strings;
use bun_lint::ast::svelte::{InComponent, Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// require keyed `{#each}` block
pub struct RequireEachKey;

const EXPECTED_KEY: Message = Message::new("expectedKey", "Each block should have a key");

impl Rule for RequireEachKey {
    const META: Meta = Meta::plugin(Plugin::Svelte, "require-each-key", Kind::Suggestion).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::EachBlock]);
    no_state!();

    fn new(_: &Options) -> Self {
        RequireEachKey
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        // Without an item it needs no key.
        let Some(context) = node.code(Role::Context) else {
            return;
        };
        if node.code(Role::Key).is_some() {
            return;
        }
        // The index, or the item without its type, as svelte-eslint-parser has it.
        let end = match node.code(Role::Index) {
            Some(index) => index.span().end,
            None => {
                let file = cx.file();
                let pattern = context.node().map(|it| match it {
                    Node::Param(param) => param.pat().span(),
                    it => it.span(),
                });
                match (pattern, file.view()) {
                    (Some(pattern), Some(view)) if !pattern.is_empty() => {
                        view.in_file(pattern.end - 1) + 1
                    }
                    _ => context.span().end,
                }
            }
        };
        // Up to the end of the token after it: `}`, or a type's `:`.
        let text = cx.file().svelte().map_or(&[][..], |it| it.text());
        let rest = text.get(end as usize..).unwrap_or_default();
        let blank = rest.len() - strings::trim_js_whitespace_start(rest).len();
        let at = InComponent(Span::new(node.span().start, end + blank as u32 + 1));
        cx.report(at, EXPECTED_KEY);
    }
}
