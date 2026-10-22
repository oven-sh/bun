use crate::conditions::Condition;
use bun_lint::ast::svelte::{KitFileType, Role, SvelteNode, SvelteTag};

/// Where the SvelteKit route rules run.
pub(crate) const IN_ROUTES: &[Condition] = &[Condition {
    svelte_versions: &[],
    svelte_file_types: &[],
    runes: &[],
    kit_file_types: &[KitFileType::Page, KitFileType::Error, KitFileType::Layout],
    svelte_kit_versions: &[],
}];

/// The attributes named `name` on `script`'s start tag.
pub(crate) fn attributes<'a>(
    script: SvelteNode<'a>,
    name: &'a [u8],
) -> impl Iterator<Item = SvelteNode<'a>> + 'a {
    let start_tag = script.child(Role::StartTag);
    let all = start_tag
        .into_iter()
        .flat_map(|it| it.nodes(Role::Attributes));
    all.filter(move |it| it.tag() == SvelteTag::Attribute && it.name() == name)
}

/// True if `attribute` has the text `module` among its values: `context="module"`.
pub(crate) fn says_module(attribute: SvelteNode<'_>) -> bool {
    (attribute.nodes(Role::Value))
        .any(|it| it.tag() == SvelteTag::Literal && it.text() == b"module")
}

/// True for a top-level script in the component: `Program > SvelteScriptElement`.
pub(crate) fn is_top_level(script: SvelteNode<'_>) -> bool {
    script.tag() == SvelteTag::ScriptElement
        && script
            .parent()
            .is_some_and(|it| it.tag() == SvelteTag::Program)
}
