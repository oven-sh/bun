//! What tests give where it is known what they look at.

use bun_engine_vm::{CellType, SpeculatedType as T, Value};

use crate::graph::{Graph, Kind, TypeName};

/// Never poses as undefined.
pub(super) const ORDINARY: T = T::OBJECT.difference(T::OTHER_OBJECT);

pub(super) fn is_test(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::IsType
            | Kind::IsCellOfType
            | Kind::IsCallable
            | Kind::HasObjectTypeName
            | Kind::ToBoolean
            | Kind::PlainToBoolean
            | Kind::GenericToBoolean
            | Kind::EqualNull
            | Kind::GenericEqualNull
    )
}

fn settled(always: bool, never: bool) -> Option<bool> {
    (always || never).then_some(always)
}

pub(super) fn from_type(graph: &Graph, (kind, data): (Kind, u32), ty: T) -> Option<bool> {
    let is = |wanted: T| settled(wanted.contains(ty), !wanted.intersects(ty));
    match kind {
        Kind::IsType => is(graph.interned_type(data)),
        Kind::IsCellOfType => settled(false, !T::of_cell_type(CellType(data as u8)).intersects(ty)),
        Kind::IsCallable => settled(
            T::FUNCTION.contains(ty),
            !TypeName::MAY_BE_CALLABLE.intersects(ty),
        ),
        Kind::HasObjectTypeName if !ty.intersects(T::OTHER_OBJECT | T::PROXY) => {
            is(TypeName::Object.types())
        }
        Kind::ToBoolean | Kind::PlainToBoolean | Kind::GenericToBoolean => {
            settled(ORDINARY.contains(ty), T::NULLISH.contains(ty))
        }
        Kind::EqualNull | Kind::GenericEqualNull if !ty.intersects(T::OTHER_OBJECT) => {
            is(T::NULLISH)
        }
        _ => None,
    }
}

pub(super) fn from_constant(graph: &Graph, node: (Kind, u32), bits: u64) -> Option<bool> {
    let ty = graph.type_of_constant(bits);
    match node.0 {
        Kind::ToBoolean | Kind::PlainToBoolean | Kind::GenericToBoolean
            if (T::BOOLEAN | T::INT32).contains(ty) =>
        {
            Some(bits != Value::FALSE.to_bits() && bits != Value::int32(0).to_bits())
        }
        _ => from_type(graph, node, ty),
    }
}

pub(super) fn are_strictly_equal(graph: &Graph, constants: [u64; 2]) -> Option<bool> {
    const BY_BITS: T = (T::OBJECT.union(T::SYMBOL).union(T::BOOLEAN))
        .union(T::NULLISH)
        .union(T::INT32);
    let [first, second] = constants.map(|it| graph.type_of_constant(it));
    BY_BITS
        .contains(first | second)
        .then_some(constants[0] == constants[1])
}
