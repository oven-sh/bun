//! `discriminateAnyType.ts`

use super::{MAX_DEPTH, is_type_any_array_type, is_type_any_type};
use crate::types::tsutils::{is_thenable_type, type_constituents};
use crate::types::{Locate, TsNode, Type};
use smallvec::SmallVec;

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
    discriminate_any_type_worker(ty, ts_node.locate(ty.file()), &mut SmallVec::new())
}

fn discriminate_any_type_worker<'a>(
    ty: Type<'a>,
    ts_node: TsNode<'a>,
    visited: &mut SmallVec<[Type<'a>; 4]>,
) -> AnyType {
    if visited.contains(&ty) || visited.len() > MAX_DEPTH as usize {
        return AnyType::Safe;
    }
    visited.push(ty);
    if is_type_any_type(ty) {
        return AnyType::Any;
    }
    if is_type_any_array_type(ty) {
        return AnyType::AnyArray;
    }
    for part in type_constituents(ty) {
        if is_thenable_type(ts_node, part)
            && let Some(awaited_type) = part.get_awaited_type()
            && discriminate_any_type_worker(awaited_type, ts_node, visited) == AnyType::Any
        {
            return AnyType::PromiseAny;
        }
    }
    AnyType::Safe
}
