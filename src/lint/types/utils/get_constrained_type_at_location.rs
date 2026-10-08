//! `getConstrainedTypeAtLocation.ts`

use super::Located;
use crate::types::Type;

/// `getConstrainedTypeAtLocation(services, node)`: the type of the node, or its constraint if it is
/// a type variable that has one. One without a constraint is returned as it is, not as `unknown`.
pub fn get_constrained_type_at_location<'a>(node: impl Located<'a>) -> Type<'a> {
    let node_type = node.to_ts_node().get_type_at_location();
    node_type.get_base_constraint_of_type().unwrap_or(node_type)
}
