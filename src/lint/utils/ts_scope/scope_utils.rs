//! typescript-eslint's `util/scopeUtils.ts`.

use crate::ast::{Name, Node};

/// typescript-eslint's `isReferenceToGlobalFunction`. `node` is where `callee_name` is used: the
/// call, the type reference, the identifier.
///
/// As upstream, it looks at the first reference to that name that is directly in the scope of
/// `node`, in the order typescript-eslint creates them. `true` if there is none, or if nothing in
/// the file declares what it refers to, which also holds for the implicit `arguments` of a function.
pub fn is_reference_to_global_function<'a>(
    callee_name: Name<'a>,
    node: impl Into<Node<'a>>,
) -> bool {
    let first = (node.into().scope().references()).find(|it| it.name() == callee_name);
    first.is_none_or(|it| {
        it.symbol()
            .is_none_or(|symbol| symbol.declarations().len() == 0)
    })
}
