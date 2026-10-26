use bun_lint::ast::svelte::variables::SvelteVariable;
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;

/// eslint-plugin-svelte's `findVariable` (`ast-utils.ts`): what the identifier `e` resolves to at its position, and for
/// a `$x` that resolves to nothing, what `x` resolves to, because svelte-eslint-parser has no variable for a store's
/// `$x`.
pub(crate) fn find_variable<'a>(e: Expr<'a>) -> Option<SvelteVariable<'a>> {
    let (file, name) = (e.file(), e.as_ident()?);
    let scope = Node::Expr(e).scope();
    if let Some(found) = file.svelte_find_variable(scope, name) {
        return Some(found);
    }
    let rest = std::str::from_utf8(name.bytes().strip_prefix(b"$")?).ok()?;
    file.svelte_find_variable(scope, file.name_of(rest))
}

/// The component node of `tag` that has `e` as its code in `role`: svelte-eslint-parser's `node.parent`, where that
/// isn't a program node.
pub(crate) fn owner_as<'a>(e: Expr<'a>, tag: SvelteTag, role: Role) -> Option<SvelteNode<'a>> {
    let (owner, code) = e.file().svelte_owner(Node::Expr(e))?;
    let is_it = owner.tag() == tag
        && owner.code(role).is_some_and(|it| it.id() == code.id())
        && code.node() == Some(Node::Expr(e));
    is_it.then_some(owner)
}
