//! Checks that a fix can give a variable a new name without changing what any name in the file refers to.

use crate::semantic::{Scope, ScopeKind};

/// True if a variable that's declared in `scope` and used in the scopes `uses` can be named `name`.
pub fn is_free<'a>(
    name: &[u8],
    scope: Scope<'a>,
    uses: impl IntoIterator<Item = Scope<'a>>,
) -> bool {
    let declares = |it: Scope<'a>| it.get_bytes(name).is_some();
    // A `catch` block can't redeclare the name of the `catch` parameter.
    let is_taken =
        declares(scope) || scope.kind() == ScopeKind::Catch && scope.children().any(declares);
    // Code inside `scope` uses the name for an outer variable or a global. That use would resolve to this variable.
    let captures = || scope.through().any(|it| it.name().bytes() == name);
    // A scope between the variable and one of its uses declares the name. That use would resolve to that declaration.
    let is_captured = |it: Scope<'a>| it.chain().take_while(|it| *it != scope).any(declares);
    !is_taken && !captures() && !uses.into_iter().any(is_captured)
}
