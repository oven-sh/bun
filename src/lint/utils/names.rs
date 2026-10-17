//! For a fix that gives a variable a name: whether every name in the file still refers to the same thing afterwards.

use crate::semantic::{Scope, ScopeKind};

/// Whether a variable that `scope` declares, and that is used in the scopes `uses`, can be called `name`.
pub fn is_free<'a>(
    name: &[u8],
    scope: Scope<'a>,
    uses: impl IntoIterator<Item = Scope<'a>>,
) -> bool {
    let declares = |it: Scope<'a>| it.get_bytes(name).is_some();
    // The block of a `catch` can't declare the name of the parameter again.
    let is_taken =
        declares(scope) || scope.kind() == ScopeKind::Catch && scope.children().any(declares);
    // The name is used inside for an outer variable or a global. That use would refer to the variable.
    let captures = || scope.through().any(|it| it.name().bytes() == name);
    // A scope between the variable and one of its uses declares the name. That use would refer to the inner one.
    let is_captured = |it: Scope<'a>| it.chain().take_while(|it| *it != scope).any(declares);
    !is_taken && !captures() && !uses.into_iter().any(is_captured)
}
