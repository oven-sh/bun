use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;

/// The directives of `kind` (`EventHandler`, `Action`) on a start tag that repeat another one: the same key, and the
/// same expression tokens or no expression on either. Grouped by key in order of first appearance, then into groups
/// with equal expressions, in order. This is what `svelte/no-dupe-on-directives` and `svelte/no-dupe-use-directives`
/// report when they leave the tag.
pub(crate) fn duplicates<'a>(
    start_tag: SvelteNode<'a>,
    kind: SvelteKind,
    key_of: impl Fn(SvelteNode<'a>) -> Vec<u8>,
) -> Vec<(Vec<u8>, Vec<SvelteNode<'a>>)> {
    let file = start_tag.file();
    let expression = |it: SvelteNode<'a>| {
        let code = it.code(Role::Expression)?;
        code.roots().next().map(|it| it.node())
    };
    let is_same = |a: Option<Node<'a>>, b: Option<Node<'a>>| match (a, b) {
        (Some(a), Some(b)) => ast_utils::equal_tokens(file, a, b),
        (a, b) => a.is_none() && b.is_none(),
    };
    let mut keys: Vec<(Vec<u8>, Vec<(Option<Node<'a>>, Vec<SvelteNode<'a>>)>)> = Vec::new();
    let directives = start_tag.nodes(Role::Attributes);
    for directive in directives.filter(|it| it.tag() == SvelteTag::Directive && it.kind() == kind) {
        let (key, e) = (key_of(directive), expression(directive));
        let at = match keys.iter().position(|it| it.0 == key) {
            Some(at) => at,
            None => {
                keys.push((key, Vec::new()));
                keys.len() - 1
            }
        };
        let Some((_, groups)) = keys.get_mut(at) else {
            continue;
        };
        match groups.iter_mut().find(|it| is_same(it.0, e)) {
            Some(group) => group.1.push(directive),
            None => groups.push((e, vec![directive])),
        }
    }
    let groups = keys
        .into_iter()
        .flat_map(|(key, groups)| groups.into_iter().map(move |it| (key.clone(), it.1)));
    groups.filter(|it| it.1.len() > 1).collect()
}

/// `loc.start.line` of the first directive in `group` other than `node`: the first one, or the second if `node` is the
/// first.
pub(crate) fn line_of_other<'a>(group: &[SvelteNode<'a>], node: SvelteNode<'a>) -> u32 {
    let other = match group.first() {
        Some(&first) if first != node => first,
        _ => group.get(1).copied().unwrap_or(node),
    };
    let component = node.file().svelte();
    component.map_or(1, |it| it.position(other.span().start).line)
}
