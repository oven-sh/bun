use bun_sema::check::aot::{
    BuiltinTypeClass, SchemaConstraint, ShapeKind, TupleElement, TupleElementKind,
};

use super::{EdgeKind, TypeEdge, TypeEdges};
use crate::builtins::type_name_of;
use crate::lower::{CheckerTypeId, FileLowering};

pub(super) fn has_int32_constraint(constraints: &[SchemaConstraint]) -> bool {
    constraints
        .iter()
        .any(|constraint| matches!(constraint, SchemaConstraint::Int32))
}

pub(super) fn collect_edges(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> TypeEdges {
    let mut edges = TypeEdges::new();
    let Ok(shape) = file.queries.type_shape(ty) else {
        return edges;
    };
    match shape.kind {
        ShapeKind::Union(members) => edges.extend(members.iter().copied().map(transparent_edge)),
        ShapeKind::TypeVariable {
            parameter: None,
            constraint: Some(constraint),
        } => edges.push(transparent_edge(constraint)),
        ShapeKind::Constrained { base, constraints } => {
            if !has_int32_constraint(constraints) {
                edges.push(transparent_edge(base));
            }
        }
        ShapeKind::Array { element, .. } => edges.push(contents_edge(element)),
        ShapeKind::Tuple { elements, .. } => push_tuple_edges(&mut edges, elements),
        ShapeKind::Builtin { class, arguments } => push_builtin_edges(&mut edges, class, arguments),
        // A type parameter is a layout of its own, whatever its constraint is.
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable {
            parameter: Some(_), ..
        }
        | ShapeKind::TypeVariable {
            parameter: None,
            constraint: None,
        }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::Number
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::String
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Class(_)
        | ShapeKind::Object => {}
    }
    edges
}

fn transparent_edge(target: CheckerTypeId) -> TypeEdge {
    TypeEdge {
        kind: EdgeKind::Transparent,
        target,
    }
}

fn contents_edge(target: CheckerTypeId) -> TypeEdge {
    TypeEdge {
        kind: EdgeKind::Contents,
        target,
    }
}

fn push_tuple_edges(edges: &mut TypeEdges, elements: &[TupleElement]) {
    for element in elements {
        match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                edges.push(contents_edge(element.ty));
            }
            TupleElementKind::Variadic => {}
        }
    }
}

fn push_builtin_edges(edges: &mut TypeEdges, class: BuiltinTypeClass, arguments: &[CheckerTypeId]) {
    let Some(type_name) = type_name_of(class) else {
        return;
    };
    for (slot, &argument) in type_name.type_arguments.iter().zip(arguments) {
        if slot.is_some() {
            edges.push(contents_edge(argument));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int32_constraint_is_found_among_others() {
        let constraints = [SchemaConstraint::Min(0.0), SchemaConstraint::Int32];
        assert!(has_int32_constraint(&constraints));
    }

    #[test]
    fn other_constraints_are_not_int32() {
        let constraints = [SchemaConstraint::Int, SchemaConstraint::Min(0.0)];
        assert!(!has_int32_constraint(&constraints));
        assert!(!has_int32_constraint(&[]));
    }
}
