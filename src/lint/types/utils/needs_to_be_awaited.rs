//! `needsToBeAwaited.ts`

use super::{get_constraint_info, is_type_any_type, is_type_unknown_type};
use crate::types::tsutils::is_thenable_type;
use crate::types::{Locate, Type};

/// `Awaitable`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Awaitable {
    Always,
    Never,
    May,
}

/// `needsToBeAwaited(checker, node, type)`: `Always` for a thenable, `May` for `any`, `unknown` and
/// a type parameter without a constraint, also for a type that the checker gave up on.
pub fn needs_to_be_awaited<'a>(node: impl Locate<'a>, ty: Type<'a>) -> Awaitable {
    // An unconstrained type parameter is treated as `unknown`.
    let Some(constraint_type) = get_constraint_info(ty).constraint_type else {
        return Awaitable::May;
    };
    if is_type_any_type(constraint_type)
        || is_type_unknown_type(constraint_type)
        || constraint_type.is_unresolved()
    {
        return Awaitable::May;
    }
    match is_thenable_type(node, constraint_type) {
        true => Awaitable::Always,
        false => Awaitable::Never,
    }
}
