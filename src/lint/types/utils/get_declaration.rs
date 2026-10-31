//! `getDeclaration.ts`

use super::Located;
use crate::types::TsNode;

/// `getDeclaration(services, node)`: the first declaration of the symbol the node refers to.
pub fn get_declaration<'a>(node: impl Located<'a>) -> Option<TsNode<'a>> {
    node.to_ts_node()
        .get_symbol_at_location()?
        .declarations()
        .next()
}
