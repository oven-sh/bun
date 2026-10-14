//! `assertionFunctionUtils.ts`

use crate::ast::{Expr, ExprKind};
use crate::types::{Type, TypePredicate, TypePredicateKind};

/// The argument of the call `node` that the type predicate of the called function is about, with
/// that predicate. Nothing is known about what follows a spread argument.
///
/// `wraps_around`: a predicate about a name that is no parameter has the index -1 upstream, which
/// `checkableArguments.at(-1)` takes for the last argument and `checkableArguments[-1]` for none.
fn find_asserted_argument(
    node: Expr<'_>,
    wraps_around: bool,
) -> Option<(Expr<'_>, TypePredicate<'_>)> {
    let arguments = node.as_call()?.args();
    let is_spread = |argument: Expr| matches!(argument.kind(), ExprKind::Spread(_));
    let checkable_arguments = arguments
        .iter()
        .position(is_spread)
        .unwrap_or_else(|| arguments.len());
    if checkable_arguments == 0 {
        return None;
    }
    let type_predicate = node.resolved_signature()?.get_type_predicate()?;
    let is_about_a_name = matches!(
        type_predicate.kind(),
        TypePredicateKind::Identifier | TypePredicateKind::AssertsIdentifier
    );
    let parameter_index = match type_predicate.parameter_index() {
        Some(parameter_index) => parameter_index,
        None if wraps_around && is_about_a_name => checkable_arguments - 1,
        None => return None,
    };
    let argument = arguments
        .get(parameter_index)
        .filter(|_| parameter_index < checkable_arguments)?;
    Some((argument, type_predicate))
}

/// `findTruthinessAssertedArgument(services, node)`: if the call `node` calls a function that
/// `asserts x`, the argument that is `x`.
pub fn find_truthiness_asserted_argument(node: Expr<'_>) -> Option<Expr<'_>> {
    let (argument, type_predicate) = find_asserted_argument(node, true)?;
    let asserts_truthiness = type_predicate.kind() == TypePredicateKind::AssertsIdentifier
        && type_predicate.ty().is_none();
    asserts_truthiness.then_some(argument)
}

/// What [`find_type_guard_asserted_argument`] returns.
#[derive(Copy, Clone, Debug)]
pub struct TypeGuardAssertedArgument<'a> {
    pub argument: Expr<'a>,
    /// `asserts x is T`, as opposed to `x is T`.
    pub asserts: bool,
    /// Upstream's `type`: the `T`.
    pub ty: Type<'a>,
}

/// `findTypeGuardAssertedArgument(services, node)`: if the call `node` calls a function whose
/// return type is `x is T` or `asserts x is T`, the argument that is `x`.
pub fn find_type_guard_asserted_argument(node: Expr<'_>) -> Option<TypeGuardAssertedArgument<'_>> {
    let (argument, type_predicate) = find_asserted_argument(node, false)?;
    let asserts = match type_predicate.kind() {
        TypePredicateKind::AssertsIdentifier => true,
        TypePredicateKind::Identifier => false,
        TypePredicateKind::This | TypePredicateKind::AssertsThis => return None,
    };
    Some(TypeGuardAssertedArgument {
        argument,
        asserts,
        ty: type_predicate.ty()?,
    })
}
