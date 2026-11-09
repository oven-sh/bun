//! typescript-eslint's `util/scopeUtils.ts`.

use crate::ast::{Name, Node};
use crate::semantic::Reference;

/// typescript-eslint's `isReferenceToGlobalFunction`. `node` is where `callee_name` is used: the
/// call, the type reference, the identifier.
///
/// Like upstream, it checks the first reference to that name that's directly in `node`'s scope, in the order
/// typescript-eslint creates them. `true` if there's none, or if nothing in the file declares what it refers to, which
/// is also the case for a function's implicit `arguments`.
pub fn is_reference_to_global_function<'a>(
    callee_name: Name<'a>,
    node: impl Into<Node<'a>>,
) -> bool {
    let scope = node.into().scope();
    let is_global = |it: Reference<'a>| {
        it.symbol()
            .is_none_or(|symbol| symbol.declarations().len() == 0)
    };
    let is_named = |it: &Reference<'a>| it.name() == callee_name;
    let mut named = (scope.references_with_names_of_patterns_first()).filter(is_named);
    let Some(answer) = named.next().map(is_global) else {
        return true;
    };
    // Which one comes first only matters if they differ.
    match named.all(|it| is_global(it) == answer) {
        true => answer,
        false => scope.references().find(is_named).is_none_or(is_global),
    }
}
