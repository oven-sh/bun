use crate::style::declaration_sets;
use bun_lint::ast::svelte::{InComponent, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// disallow duplicate style properties
pub struct NoDupeStyleProperties;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate property '{{name}}'.");

impl Rule for NoDupeStyleProperties {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-dupe-style-properties", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::StartTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeStyleProperties
    }

    /// Reports a property that an earlier set of declarations has, and that earlier declaration. An inline style's
    /// declarations form one set.
    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let sets = declaration_sets(node);
        let all: Vec<_> = sets.iter().flatten().collect();
        let mut is_reported = vec![false; all.len()];
        // The last declaration of each property so far, by its index in `all`.
        let mut before: FxHashMap<&[u8], usize> = FxHashMap::default();
        let mut at = 0;
        for set in &sets {
            for (i, declaration) in (at..).zip(set) {
                let Some(&already) = before.get(declaration.prop) else {
                    continue;
                };
                for it in [already, i] {
                    if let Some(reported) = is_reported.get_mut(it).filter(|it| !**it) {
                        *reported = true;
                        let Some(found) = all.get(it) else {
                            continue;
                        };
                        cx.report(InComponent(found.span), UNEXPECTED)
                            .data("name", found.prop)
                            .listened_on(node);
                    }
                }
            }
            for (i, declaration) in (at..).zip(set) {
                before.insert(declaration.prop, i);
            }
            at += set.len();
        }
    }
}
