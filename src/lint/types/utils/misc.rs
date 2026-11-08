//! The parts of `misc.ts` that deal with `ts.Node`s.

use crate::types::{SyntaxKind, TsNode};

/// `isRestParameterDeclaration(decl)`: `...name` in a function's parameter list.
pub fn is_rest_parameter_declaration(decl: TsNode) -> bool {
    decl.kind() == SyntaxKind::Parameter && decl.has_dot_dot_dot_token()
}
