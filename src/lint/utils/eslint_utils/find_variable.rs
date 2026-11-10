//! `find-variable.mjs`

use crate::ast::{Expr, Node};
use crate::semantic::{Scope, Symbol};

/// eslint-utils' `findVariable(initialScope, name)`: resolves `name` in `scope`.
///
/// A global variable that the file doesn't declare isn't a [`Symbol`], so the result is `None` where upstream finds the
/// global scope's variable that the configuration defines.
pub fn find_variable<'a>(scope: Scope<'a>, name: impl AsRef<[u8]>) -> Option<Symbol<'a>> {
    scope.resolve_bytes(name.as_ref())
}

/// eslint-utils' `findVariable(initialScope, identifierNode)`: resolves the identifier `expr`'s name at its position.
/// Like upstream, it looks the name up in the scopes, so it also finds a type with that name, which isn't what a
/// reference resolves to ([`Expr::reference`]). `None` for a global variable, as with [`find_variable`].
pub fn find_variable_of(expr: Expr<'_>) -> Option<Symbol<'_>> {
    Node::Expr(expr).scope().resolve_name(expr.as_ident()?)
}
