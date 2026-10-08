//! `find-variable.mjs`, `get-innermost-scope.mjs`

use crate::ast::{Expr, Node};
use crate::semantic::{Scope, Symbol};

/// eslint-utils' `findVariable(initialScope, name)`: what `name` means in `scope`.
///
/// A global variable that the file does not declare is not a [`Symbol`]: the result is `None`,
/// where upstream finds the variable of the global scope that the configuration defines.
pub fn find_variable<'a>(scope: Scope<'a>, name: impl AsRef<[u8]>) -> Option<Symbol<'a>> {
    scope.resolve_bytes(name.as_ref())
}

/// eslint-utils' `findVariable(initialScope, identifierNode)`: what the name of the identifier
/// `expr` means where it is written. As upstream, it looks the name up in the scopes, and finds a type
/// of that name as well, which is not what a reference resolves to ([`Expr::reference`]). `None` for
/// a global variable, as with [`find_variable`].
pub fn find_variable_of(expr: Expr<'_>) -> Option<Symbol<'_>> {
    Node::Expr(expr).scope().resolve_name(expr.as_ident()?)
}

/// eslint-utils' `getInnermostScope`: the innermost scope that contains the start of `node`. For a
/// node that creates a scope, that scope. It is `node.scope()`, whatever `initial_scope` is.
#[inline]
pub fn get_innermost_scope<'a>(_initial_scope: Scope<'a>, node: impl Into<Node<'a>>) -> Scope<'a> {
    node.into().scope()
}
