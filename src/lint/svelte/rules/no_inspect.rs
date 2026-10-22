use crate::conditions::{Condition, should_run};
use bun_lint::ast::identifiers::{identifiers_of, owners};
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag, generic_names};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warns against the use of `$inspect` directive
pub struct NoInspect;

const UNEXPECTED: Message = Message::new("unexpected", "Do not use $inspect directive");

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[],
    runes: &[true],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

impl Rule for NoInspect {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-inspect", Kind::Suggestion).recommended();
    const ON: On = On::new()
        .nodes(NodeTags::ALL)
        .svelte_nodes(&[SvelteTag::GenericsDirective, SvelteTag::ShorthandAttribute]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoInspect
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        On::new()
            .nodes(owners())
            .svelte_nodes(&[SvelteTag::GenericsDirective, SvelteTag::ShorthandAttribute])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("$inspect") && should_run(file, CONDITIONS)).then_some(())
    }

    /// Each `Identifier` in ESLint's tree in the program, including both names of an import or export without `as`. Not
    /// the value of `{a}` in a component, which comes with its key.
    fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        identifiers_of(node, |it| {
            if it.name != b"$inspect" {
                return;
            }
            let owner = cx.file().svelte_owner(node);
            if owner.is_some_and(|(owner, code)| {
                owner.tag() == SvelteTag::ShorthandAttribute && code.node() == Some(node)
            }) {
                return;
            }
            cx.report(it, UNEXPECTED).listened_as_identifier(it, b"Identifier");
        });
    }

    /// A `generics` type parameter, which ESLint's tree has in the component, and `{a}`, whose key is an `Identifier`
    /// with the value's range, which the program has only once, as the value. ESLint visits the key first.
    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        if node.tag() == SvelteTag::ShorthandAttribute {
            let Some(value) = node.code(Role::Key).and_then(|it| it.node()) else {
                return;
            };
            identifiers_of(value, |it| {
                if it.name == b"$inspect" {
                    cx.report(it, UNEXPECTED)
                        .listened_in_component(it, b"Identifier");
                    cx.report(it, UNEXPECTED).listened_as_identifier(it, b"Identifier");
                }
            });
            return;
        }
        for name in generic_names(node).filter(|it| it.name == b"$inspect") {
            cx.report(name, UNEXPECTED)
                .listened_in_component(name, b"Identifier");
        }
    }
}
