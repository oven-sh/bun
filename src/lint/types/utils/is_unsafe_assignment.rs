//! `isUnsafeAssignment.ts`

use super::{MAX_DEPTH, is_type_any_type, is_type_unknown_type};
use crate::ast::{Expr, ExprKind};
use crate::types::Type;
use crate::types::tsutils::is_type_reference;
use smallvec::SmallVec;

/// What [`is_unsafe_assignment`] returns for an assignment that is unsafe.
#[derive(Copy, Clone, Debug)]
pub struct UnsafeAssignment<'a> {
    pub receiver: Type<'a>,
    pub sender: Type<'a>,
}

/// `isUnsafeAssignment(type, receiver, checker, senderNode)`: whether an `any` is assigned to what
/// is not `any`, also as a type argument: `Set<any>` to `Set<string>`. `None` is upstream's
/// `false`.
///
/// `sender_node`, an [`Expr`] or `None`, is what is assigned: `new Map()` is safe though it is a
/// `Map<any, any>`.
pub fn is_unsafe_assignment<'a>(
    ty: Type<'a>,
    receiver: Type<'a>,
    sender_node: impl Into<Option<Expr<'a>>>,
) -> Option<UnsafeAssignment<'a>> {
    is_unsafe_assignment_worker(ty, receiver, sender_node.into(), &mut SmallVec::new(), 0)
}

fn is_unsafe_assignment_worker<'a>(
    ty: Type<'a>,
    receiver: Type<'a>,
    sender_node: Option<Expr<'a>>,
    visited: &mut SmallVec<[(Type<'a>, Type<'a>); 8]>,
    depth: u32,
) -> Option<UnsafeAssignment<'a>> {
    if is_type_any_type(ty) {
        // Allow assignment of any ==> unknown.
        if is_type_unknown_type(receiver) {
            return None;
        }
        if !is_type_any_type(receiver) && !receiver.is_unresolved() {
            return Some(UnsafeAssignment {
                receiver,
                sender: ty,
            });
        }
    }
    // Only a pair of type references is looked into, so no other pair needs to be remembered.
    // tsgolint leaves out a deferred one, which is what an alias of a tuple, of an array or of an
    // instantiation is: `type A = Set<string>`.
    let is_looked_into = |it: Type<'a>| match it.file().language().is_oxlint {
        true => it.is_non_deferred_type_reference(),
        false => is_type_reference(it),
    };
    if depth > MAX_DEPTH || !is_looked_into(ty) || !is_looked_into(receiver) {
        return None;
    }
    if visited.contains(&(ty, receiver)) {
        return None;
    }
    visited.push((ty, receiver));

    // References to different types are assumed to be safe: their type arguments need not
    // correspond.
    if !have_the_same_target(ty, receiver) {
        return None;
    }
    if sender_node.is_some_and(is_new_map_without_arguments) {
        return None;
    }
    let receiver_type_arguments = receiver.get_type_arguments();
    for (i, arg) in ty.get_type_arguments().iter().enumerate() {
        let Some(receiver_arg) = receiver_type_arguments.get(i) else {
            break;
        };
        if is_unsafe_assignment_worker(arg, receiver_arg, sender_node, visited, depth + 1).is_some()
        {
            return Some(UnsafeAssignment {
                receiver,
                sender: ty,
            });
        }
    }
    None
}

/// `type.target === receiver.target`. TypeScript has one target for all tuple types of a shape.
fn have_the_same_target<'a>(ty: Type<'a>, receiver: Type<'a>) -> bool {
    ty.has_same_target_as(receiver)
}

/// `new Map()`, whose type is `Map<any, any>`.
fn is_new_map_without_arguments(sender_node: Expr) -> bool {
    match sender_node.kind() {
        ExprKind::New(call) => {
            call.callee().is_ident("Map") && call.args().is_empty() && call.type_args().is_empty()
        }
        _ => false,
    }
}
