use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks for invalid raw HTML elements
pub struct NoRawSpecialElements;

const DEPRECATED_ELEMENT: Message = Message::new(
    "deprecatedElement",
    "Special {{name}} element is deprecated in v5, use svelte:{{name}} instead.",
);

const INVALID_HTML_ELEMENTS: [&[u8]; 6] = [
    b"head",
    b"body",
    b"window",
    b"document",
    b"element",
    b"options",
];

impl Rule for NoRawSpecialElements {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-raw-special-elements", Kind::Problem).recommended()
        .fixable(Fixable::Code);
    const ON: On = On::new().svelte_nodes(&[SvelteTag::Element]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoRawSpecialElements
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let name = node.name();
        if node.kind() != SvelteKind::Html || !INVALID_HTML_ELEMENTS.contains(&name) {
            return;
        }
        cx.report(node, DEPRECATED_ELEMENT)
            .by_selector(r#"SvelteElement[kind="html"]"#)
            .data("name", name)
            .fix(|fixer| {
                let mut fixes =
                    vec![fixer.insert_before(Span::empty(node.span().start + 1), "svelte:")];
                if let Some(end_tag) = node.child(Role::EndTag) {
                    fixes.push(
                        fixer.insert_before(Span::empty(end_tag.span().start + 2), "svelte:"),
                    );
                }
                fixes
            });
    }
}
