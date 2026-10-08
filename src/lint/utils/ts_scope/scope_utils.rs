//! typescript-eslint's `util/scopeUtils.ts`.

use crate::ast::{Name, Node};

/// typescript-eslint's `isReferenceToGlobalFunction`. `node` is where `callee_name` is used: the
/// call, the type reference, the identifier.
///
/// As upstream, it looks at the first reference to that name that is written directly in the scope
/// of `node`. `true` if there is none, or if nothing in the file declares what it refers to.
pub fn is_reference_to_global_function<'a>(
    callee_name: Name<'a>,
    node: impl Into<Node<'a>>,
) -> bool {
    let mut references = node.into().scope().references();
    references
        .find(|reference| reference.name() == callee_name)
        .is_none_or(|reference| reference.symbol().is_none())
}
