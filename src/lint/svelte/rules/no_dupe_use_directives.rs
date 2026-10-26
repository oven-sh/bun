use crate::duplicates::{duplicates, line_of_other};
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow duplicate `use:` directives
pub struct NoDupeUseDirectives;

const DUPLICATION: Message = Message::new(
    "duplication",
    "This `{{keyText}}` directive is the same and duplicate directives in L{{lineNo}}.",
);

/// `getAttributeKeyText` for a `use:` directive: `use:name|modifier|..`.
fn key_text(directive: SvelteNode<'_>) -> Vec<u8> {
    let mut text = [&b"use:"[..], directive.name()].concat();
    if let Some(key) = directive.child(Role::Key) {
        let component = directive.file().svelte().map_or(&[][..], |it| it.text());
        for modifier in key.parts(Role::Modifier) {
            text.push(b'|');
            text.extend_from_slice(component.get(modifier.0.range()).unwrap_or_default());
        }
    }
    text
}

impl Rule for NoDupeUseDirectives {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-dupe-use-directives", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::StartTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeUseDirectives
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        for (key_text, group) in duplicates(node, SvelteKind::Action, key_text) {
            for &directive in &group {
                cx.report(directive, DUPLICATION)
                    .on_exit(true)
                    .data("keyText", key_text.clone())
                    .data("lineNo", line_of_other(&group, directive).to_string());
            }
        }
    }
}
