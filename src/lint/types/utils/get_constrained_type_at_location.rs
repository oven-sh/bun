//! `getConstrainedTypeAtLocation.ts`

use super::Located;
use crate::types::Type;

/// `getConstrainedTypeAtLocation(services, node)`: the node's type, or its constraint if it's a type variable that has
/// one. A type variable without a constraint is returned as is, not as `unknown`.
pub fn get_constrained_type_at_location<'a>(node: impl Located<'a>) -> Type<'a> {
    let node_type = node.to_type();
    node_type.get_base_constraint_of_type().unwrap_or(node_type)
}
