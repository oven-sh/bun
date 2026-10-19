//! What in `misc.ts` is about `ts.Node`s.

use crate::types::{SyntaxKind, TsNode};

/// `isRestParameterDeclaration(decl)`: `...name` among the parameters of a function.
pub fn is_rest_parameter_declaration(decl: TsNode) -> bool {
    decl.kind() == SyntaxKind::Parameter && decl.has_dot_dot_dot_token()
}
