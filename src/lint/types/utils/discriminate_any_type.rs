//! `discriminateAnyType.ts`

use super::{has_room_on_the_stack, is_type_any_array_type, is_type_any_type};
use crate::types::tsutils::{is_thenable_type, is_union_or_intersection_type, type_constituents};
use crate::types::{IdSet, Locate, TsNode, Type};

/// `AnyType`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum AnyType {
    /// `any`
    Any,
    /// `Promise<any>`
    PromiseAny,
    /// `any[]`, `readonly any[]`
    AnyArray,
    Safe,
}

/// `discriminateAnyType(type, checker, program, tsNode)`: in which way the type is `any`, if it is.
pub fn discriminate_any_type<'a>(ty: Type<'a>, ts_node: impl Locate<'a>) -> AnyType {
    discriminate_any_type_worker(ty, ts_node.locate(ty.file()), &mut IdSet::new())
}

fn discriminate_any_type_worker<'a>(
    ty: Type<'a>,
    ts_node: TsNode<'a>,
    visited: &mut IdSet<Type<'a>>,
) -> AnyType {
    if !has_room_on_the_stack() || !visited.insert(ty) {
        return AnyType::Safe;
    }
    if is_type_any_type(ty) {
        return AnyType::Any;
    }
    if is_type_any_array_type(ty) {
        return AnyType::AnyArray;
    }
    // tsgolint's `TypeRecurser` asks the leaves of nested unions and intersections.
    let found_promise_any = match ty.file().language().is_oxlint {
        true => type_recurser(ty, &mut |part: Type<'a>| {
            is_promise_any(part, ts_node, visited)
        }),
        false => type_constituents(ty)
            .into_iter()
            .any(|part| is_promise_any(part, ts_node, visited)),
    };
    match found_promise_any {
        true => AnyType::PromiseAny,
        false => AnyType::Safe,
    }
}

fn is_promise_any<'a>(part: Type<'a>, ts_node: TsNode<'a>, visited: &mut IdSet<Type<'a>>) -> bool {
    is_thenable_type(ts_node, part)
        && part.get_awaited_type().is_some_and(|awaited_type| {
            discriminate_any_type_worker(awaited_type, ts_node, visited) == AnyType::Any
        })
}

/// `TypeRecurser(t, predicate)` of tsgolint's `utils.go`.
fn type_recurser<'a>(ty: Type<'a>, predicate: &mut dyn FnMut(Type<'a>) -> bool) -> bool {
    if !is_union_or_intersection_type(ty) {
        return predicate(ty);
    }
    if !has_room_on_the_stack() {
        return false;
    }
    for subtype in ty.types() {
        if type_recurser(subtype, &mut *predicate) {
            return true;
        }
    }
    false
}
