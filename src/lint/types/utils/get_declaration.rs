//! `getDeclaration.ts`

use super::Located;
use crate::types::TsNode;

/// `getDeclaration(services, node)`: the first declaration of what the node names.
pub fn get_declaration<'a>(node: impl Located<'a>) -> Option<TsNode<'a>> {
    node.to_ts_node()
        .get_symbol_at_location()?
        .declarations()
        .next()
}
