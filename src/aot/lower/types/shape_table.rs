use bun_sema::check::aot::{
    BuiltinShape, BuiltinTypeClass, Denotation, KeptFact, MemberName, ObjectOrigin, PrimitiveKinds,
    ShapeKind, TupleElement, TupleElementKind,
};
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

use super::shape_edges::{collect_edges, has_int32_constraint};
use super::{ChildTypes, EdgeKind, TypeEdge};
use crate::builtins::id::BuiltinClass;
use crate::builtins::table::{class_data, contents_index};
use crate::builtins::{builtin_class_of, type_name_of};
use crate::ir::generated::{MAX_TRACKED_INTEGER, NameClass};
use crate::ir::{LayoutId, Mapped, Primitives, Type, TypeFlags, TypeId, TypeTable, classify_name};
use crate::lower::{CheckerTypeId, FileLowering, convert, function_types, layouts};

const ACCEPTED_PRIMITIVE_TYPES: [(PrimitiveKinds, TypeId); 5] = [
    (PrimitiveKinds::STRING, TypeTable::STRING),
    (PrimitiveKinds::NUMBER, TypeTable::NUMBER),
    (PrimitiveKinds::BOOLEAN, TypeTable::BOOLEAN),
    (PrimitiveKinds::BIGINT, TypeTable::BIGINT),
    (PrimitiveKinds::SYMBOL, TypeTable::SYMBOL),
];

pub(super) fn map_shape(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    children: &mut dyn ChildTypes,
) -> Mapped {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return Mapped::UNKNOWN;
    };
    let mut mapped = map_shape_kind(file, ty, shape.kind, children);
    if !shape.trust.is_trusted() {
        mapped = Mapped::expected(mapped.ty);
    }
    let types = &mut file.fragment.types;
    if holds_reference(types.get(mapped.ty)) {
        mapped.ty = types.with_nullish(mapped.ty);
    }
    mapped
}

// `undefined` and `null` are members of every type that holds a reference.
fn holds_reference(ty: &Type) -> bool {
    let raw_primitives = Primitives::NUMBER | Primitives::BOOLEAN | Primitives::NULLISH;
    let raw_part = Type {
        primitives: ty.primitives & raw_primitives,
        flags: ty.flags & TypeFlags::HAS_INTEGERS,
        minimum: ty.minimum,
        maximum: ty.maximum,
        ..Type::default()
    };
    *ty != raw_part
}

fn map_shape_kind(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    kind: ShapeKind<'_>,
    children: &mut dyn ChildTypes,
) -> Mapped {
    match kind {
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable {
            parameter: None,
            constraint: None,
        } => Mapped::UNKNOWN,
        ShapeKind::TypeVariable {
            parameter: Some(parameter),
            constraint,
        } => {
            let layout = layouts::type_parameter_layout(file, parameter);
            if let Some(constraint) = constraint {
                convert::record_type_flow(file, ty, constraint, 0);
            }
            Mapped::checked(file.fragment.types.intern(Type::layout(layout)))
        }
        ShapeKind::TypeVariable {
            parameter: None,
            constraint: Some(constraint),
        } => map_child(file, children, EdgeKind::Transparent, constraint),
        ShapeKind::Never => Mapped::checked(TypeTable::NEVER),
        ShapeKind::Undefined => Mapped::checked(TypeTable::UNDEFINED),
        ShapeKind::Null => Mapped::checked(TypeTable::NULL),
        ShapeKind::Boolean => Mapped::checked(TypeTable::BOOLEAN),
        ShapeKind::BooleanLiteral(value) => {
            let primitive = if value {
                Primitives::TRUE
            } else {
                Primitives::FALSE
            };
            map_literal(file, Type::primitives(primitive))
        }
        ShapeKind::Number => Mapped::checked(TypeTable::NUMBER),
        ShapeKind::NumberLiteral(value) => map_literal(file, number_literal_type(value)),
        ShapeKind::NumericEnumMember(value) => map_literal(file, enum_member_type(value)),
        ShapeKind::BigInt | ShapeKind::BigIntLiteral { .. } => Mapped::checked(TypeTable::BIGINT),
        ShapeKind::String | ShapeKind::TemplateLiteral { .. } => Mapped::checked(TypeTable::STRING),
        ShapeKind::StringLiteral(atom) => {
            let string = file.intern_atom(atom);
            map_literal(file, Type::string_literal(string))
        }
        ShapeKind::Symbol => Mapped::checked(TypeTable::SYMBOL),
        ShapeKind::AnyObject => match layouts::module_type_layout(file, ty) {
            Some(layout) => map_object(file, ty, Some(layout)),
            None => Mapped::checked(TypeTable::OBJECT),
        },
        ShapeKind::ClassConstructor(class) => {
            let function_type = function_types::find_class_function_type(file, class);
            Mapped::checked(file.fragment.types.intern(Type::function(function_type)))
        }
        ShapeKind::Function(signatures) => {
            match function_types::find_function_type(file, signatures) {
                Some(function_type) => {
                    Mapped::checked(file.fragment.types.intern(Type::function(function_type)))
                }
                None => Mapped::checked(TypeTable::FUNCTION),
            }
        }
        ShapeKind::Array { element, .. } => {
            let contents = map_child(file, children, EdgeKind::Contents, element);
            intern_class(file, BuiltinClass::Array, &[contents])
        }
        ShapeKind::Tuple { elements, .. } => map_tuple(file, elements, children),
        ShapeKind::Builtin { class, arguments } => {
            map_builtin(file, ty, class, arguments, children)
        }
        ShapeKind::Class(class) => {
            let layout = layouts::class_type_layout(file, class, ty);
            map_object(file, ty, Some(layout))
        }
        ShapeKind::Object => {
            let layout = layouts::object_type_layout(file, ty);
            let mapped = map_object(file, ty, layout);
            match (layout, requires_field(file, ty)) {
                (Some(_), true) => {
                    let mapped = add_accepted_builtin_classes(file, ty, mapped);
                    add_accepted_class_constructors(file, ty, mapped)
                }
                (Some(_), false) => Mapped::expected(mapped.ty),
                (None, _) => mapped,
            }
        }
        ShapeKind::Union(members) => map_union(file, members, children),
        ShapeKind::Constrained { base, constraints } => match has_int32_constraint(constraints) {
            true => Mapped::checked(TypeTable::INT32),
            false => map_child(file, children, EdgeKind::Transparent, base),
        },
    }
}

fn map_child(
    file: &mut FileLowering<'_, '_, '_, '_>,
    children: &mut dyn ChildTypes,
    kind: EdgeKind,
    target: CheckerTypeId,
) -> Mapped {
    children.map_child(file, TypeEdge { kind, target })
}

fn map_literal(file: &mut FileLowering<'_, '_, '_, '_>, literal: Type) -> Mapped {
    Mapped::checked(file.fragment.types.intern(literal))
}

// No test looks at the contents of a container, so what is only expected of them leaves the class checked.
fn intern_class(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: BuiltinClass,
    contents: &[Mapped],
) -> Mapped {
    let contents: SmallVec<[TypeId; 2]> = contents.iter().map(|mapped| mapped.ty).collect();
    Mapped::checked(file.fragment.types.intern(Type::class(class, &contents)))
}

fn union_all(file: &mut FileLowering<'_, '_, '_, '_>, members: &[Mapped]) -> Mapped {
    let ty = file
        .fragment
        .types
        .union_all(members.iter().map(|mapped| mapped.ty));
    match members.iter().all(|mapped| mapped.is_checked) {
        true => Mapped::checked(ty),
        false => Mapped::expected(ty),
    }
}

fn is_numeric_enum_member(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    match file.queries.type_shape(ty) {
        Ok(shape) => matches!(shape.kind, ShapeKind::NumericEnumMember(_)),
        Err(_) => false,
    }
}

fn map_union(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[CheckerTypeId],
    children: &mut dyn ChildTypes,
) -> Mapped {
    let mut mapped_members: SmallVec<[Mapped; 4]> = SmallVec::with_capacity(members.len() + 1);
    let mut enum_member_count = 0;
    for &member in members {
        mapped_members.push(map_child(file, children, EdgeKind::Transparent, member));
        enum_member_count += usize::from(is_numeric_enum_member(file, member));
    }
    // TypeScript lets every number into a type that lists members of a numeric enum, and `a | b` of two flags is no member.
    if enum_member_count > 1 {
        mapped_members.push(Mapped::checked(TypeTable::INT32));
    }
    union_all(file, &mapped_members)
}

fn map_tuple(
    file: &mut FileLowering<'_, '_, '_, '_>,
    elements: &[TupleElement],
    children: &mut dyn ChildTypes,
) -> Mapped {
    let mut contents: SmallVec<[Mapped; 4]> = SmallVec::with_capacity(elements.len());
    for element in elements {
        contents.push(match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                map_child(file, children, EdgeKind::Contents, element.ty)
            }
            TupleElementKind::Variadic => Mapped::UNKNOWN,
        });
    }
    let contents = union_all(file, &contents);
    intern_class(file, BuiltinClass::Array, &[contents])
}

fn is_function_class(class: BuiltinClass) -> bool {
    core::iter::successors(Some(class), |&class| class_data(class).parent)
        .any(|class| class == BuiltinClass::Function)
}

fn map_builtin(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    class: BuiltinTypeClass,
    arguments: &[CheckerTypeId],
    children: &mut dyn ChildTypes,
) -> Mapped {
    let (Some(builtin_class), Some(type_name)) =
        (builtin_class_of(class.class), type_name_of(class))
    else {
        debug_assert!(
            false,
            "a built-in type names a class and a type name of the table"
        );
        return Mapped::expected(TypeTable::OBJECT);
    };
    let mut contents: SmallVec<[Mapped; 2]> =
        smallvec![Mapped::UNKNOWN; class_data(builtin_class).contents.len()];
    for (&slot, &argument) in type_name.type_arguments.iter().zip(arguments) {
        let Some(slot) = slot else {
            continue;
        };
        let mapped = map_child(file, children, EdgeKind::Contents, argument);
        if let Some(index) = contents_index(builtin_class, slot) {
            contents[index] = mapped;
        }
    }
    let whole = match is_function_class(builtin_class) {
        true => Mapped::checked(TypeTable::FUNCTION),
        false => intern_class(file, builtin_class, &contents),
    };
    // A view is also the type of objects that are no instances of the class.
    let denoted = match class.denotation {
        Denotation::Exact => whole,
        Denotation::View => Mapped::expected(whole.ty),
    };
    add_accepted_primitives(file, ty, denoted)
}

fn map_object(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    layout: Option<LayoutId>,
) -> Mapped {
    let layout_type = match layout {
        Some(layout) => file.fragment.types.intern(Type::layout(layout)),
        None => TypeTable::OBJECT,
    };
    add_accepted_primitives(file, ty, Mapped::checked(layout_type))
}

fn add_accepted_primitives(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    mapped: Mapped,
) -> Mapped {
    let Ok(accepted) = file.queries.accepted_primitives(ty) else {
        return Mapped::expected(mapped.ty);
    };
    let types = &mut file.fragment.types;
    let mut widened = mapped;
    for (kind, primitive) in ACCEPTED_PRIMITIVE_TYPES {
        if accepted.contains(kind) {
            widened.ty = types.union(widened.ty, primitive);
        }
    }
    widened
}

fn names_field(file: &FileLowering<'_, '_, '_, '_>, name: MemberName) -> bool {
    let name = match name {
        MemberName::String(name) => name,
        MemberName::Symbol(_) | MemberName::Private(_) => return false,
    };
    !matches!(
        classify_name(file.queries.atom_bytes(name)),
        NameClass::Index | NameClass::CanonicalNumericString | NameClass::Proto
    )
}

// A layout tells objects apart by their fields. Every object is of a type that requires none, so its layout is only expected.
fn requires_field(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(members) = file.queries.member_presence(ty) else {
        return true;
    };
    members
        .iter()
        .any(|member| !member.is_optional && names_field(file, member.name))
}

fn has_exact_type(class: BuiltinClass) -> bool {
    let data = class_data(class);
    data.has_instance_test && data.type_names.iter().any(|name| !name.is_view)
}

fn add_accepted_builtin_classes(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    mapped: Mapped,
) -> Mapped {
    let Ok(builtins) = file.queries.accepted_builtins(ty) else {
        return Mapped::expected(mapped.ty);
    };
    let mut widened = mapped;
    for &builtin in builtins {
        let class = match builtin {
            BuiltinShape::Array => Some(BuiltinClass::Array),
            BuiltinShape::Class(class) => builtin_class_of(class.class),
        };
        let Some(class) = class else {
            widened.is_checked = false;
            continue;
        };
        let contents: SmallVec<[Mapped; 2]> =
            smallvec![Mapped::UNKNOWN; class_data(class).contents.len()];
        let instances = match is_function_class(class) {
            true => TypeTable::FUNCTION,
            false => intern_class(file, class, &contents).ty,
        };
        widened.ty = file.fragment.types.union(widened.ty, instances);
        widened.is_checked &= has_exact_type(class);
    }
    widened
}

fn add_accepted_class_constructors(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    mapped: Mapped,
) -> Mapped {
    let Ok(classes) = file.queries.accepted_class_constructors(ty) else {
        return Mapped::expected(mapped.ty);
    };
    let mut widened = mapped;
    for &class in classes {
        let function_type = function_types::find_class_function_type(file, class);
        let constructor = file.fragment.types.intern(Type::function(function_type));
        widened.ty = file.fragment.types.union(widened.ty, constructor);
    }
    widened
}

pub(super) fn has_layout_in_every_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    requires_field(file, ty)
        && file
            .queries
            .accepted_builtins(ty)
            .is_ok_and(|builtins| builtins.is_empty())
        && file
            .queries
            .accepted_class_constructors(ty)
            .is_ok_and(|classes| classes.is_empty())
}

fn is_seen_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    pending: &mut Vec<CheckerTypeId>,
) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    match shape.kind {
        ShapeKind::Object => match file.queries.object_origin(ty) {
            ObjectOrigin::ObjectLiteral { .. } => false,
            // The layout of an interface has edges to the layouts of what it extends.
            ObjectOrigin::Symbol(interface) => match file.queries.declared_base_types(interface) {
                Ok(bases) => {
                    pending.extend(bases);
                    true
                }
                Err(_) => false,
            },
            _ => true,
        },
        ShapeKind::AnyObject
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Class(_)
        | ShapeKind::TypeVariable {
            parameter: Some(_), ..
        } => false,
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable {
            parameter: None, ..
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
        | ShapeKind::Function(_)
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Union(_)
        | ShapeKind::Constrained { .. } => true,
    }
}

/// Empty between two walks, which use their memory one after the other.
#[derive(Default)]
pub(super) struct AlikeWalkTables {
    visited: FxHashSet<CheckerTypeId>,
    pending: Vec<CheckerTypeId>,
    reached: Vec<CheckerTypeId>,
}

fn find_known_alike(file: &FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Option<bool> {
    let kept = file
        .queries
        .find_kept_fact(ty, KeptFact::IsMappedAlikeInEveryFile);
    kept.or_else(|| file.types.mapped_alike.get(&ty).copied())
}

pub(super) fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    root: CheckerTypeId,
) -> bool {
    let mut tables = core::mem::take(&mut file.types.alike_walk);
    let is_alike = walk_alike_types(file, root, &mut tables);
    tables.visited.clear();
    tables.pending.clear();
    tables.reached.clear();
    file.types.alike_walk = tables;
    is_alike
}

fn walk_alike_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    root: CheckerTypeId,
    tables: &mut AlikeWalkTables,
) -> bool {
    let AlikeWalkTables {
        visited,
        pending,
        reached,
    } = tables;
    let unstable_answers = file.queries.count_unstable_answers();
    visited.insert(root);
    pending.push(root);
    while let Some(ty) = pending.pop() {
        match find_known_alike(file, ty) {
            Some(true) => continue,
            Some(false) => return false,
            None => {}
        }
        if !is_seen_alike_in_every_file(file, ty, reached) {
            return false;
        }
        reached.extend(collect_edges(file, ty).iter().map(|edge| edge.target));
        pending.extend(reached.drain(..).filter(|&target| visited.insert(target)));
    }
    for &ty in visited.iter() {
        let fact = KeptFact::IsMappedAlikeInEveryFile;
        if !file.queries.keep_fact(ty, fact, true, unstable_answers) {
            file.types.mapped_alike.insert(ty, true);
        }
    }
    true
}

fn holds_every_number(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    if let ShapeKind::Union(members) = shape.kind {
        return members
            .iter()
            .any(|&member| holds_every_number(file, member));
    }
    matches!(shape.kind, ShapeKind::Number)
}

pub(super) fn lists_int32(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    match shape.kind {
        ShapeKind::Constrained { base, constraints } => {
            has_int32_constraint(constraints) || lists_int32(file, base)
        }
        // `int32 | number` holds every number: there is nothing to prove.
        ShapeKind::Union(members) => {
            members.iter().any(|&member| lists_int32(file, member))
                && !members
                    .iter()
                    .any(|&member| holds_every_number(file, member))
        }
        _ => false,
    }
}

// TypeScript's `0` is also the type of `-0`, which no integer range holds.
fn number_literal_type(value: f64) -> Type {
    let integer = value as i64;
    let is_tracked = integer as f64 == value
        && integer != 0
        && (-MAX_TRACKED_INTEGER..=MAX_TRACKED_INTEGER).contains(&integer);
    if is_tracked {
        Type::integers(integer, integer)
    } else {
        Type::primitives(Primitives::NUMBER)
    }
}

// A member that is written `0` is the integer.
fn enum_member_type(value: f64) -> Type {
    if value == 0.0 && value.is_sign_positive() {
        return Type::integers(0, 0);
    }
    number_literal_type(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enum_member_types() {
        assert_eq!(enum_member_type(0.0), Type::integers(0, 0));
        assert_eq!(enum_member_type(4.0), Type::integers(4, 4));
        for value in [-0.0, 1.5] {
            assert_eq!(
                enum_member_type(value),
                Type::primitives(Primitives::NUMBER)
            );
        }
    }

    #[test]
    fn number_literal_types() {
        assert_eq!(number_literal_type(1.0), Type::integers(1, 1));
        assert_eq!(number_literal_type(-1.0), Type::integers(-1, -1));
        for value in [1.5, 0.0, -0.0, 4611686018427387904.0, f64::NAN] {
            assert_eq!(
                number_literal_type(value),
                Type::primitives(Primitives::NUMBER)
            );
        }
    }

    #[test]
    fn numbers_and_booleans_hold_no_reference() {
        let optional_number = Primitives::NUMBER | Primitives::UNDEFINED;
        let raw_types = [
            Type::never(),
            Type::integers(1, 4),
            Type::primitives(Primitives::NULLISH),
            Type::primitives(Primitives::TRUE),
            Type::primitives(optional_number),
        ];
        for ty in raw_types {
            assert!(!holds_reference(&ty), "{ty:?}");
        }
    }

    #[test]
    fn cells_are_references() {
        let reference_types = [
            Type::anything(),
            Type::any_object(),
            Type::any_function(),
            Type::primitives(Primitives::STRING),
            Type::primitives(Primitives::SYMBOL),
            Type::primitives(Primitives::BIG_INT),
            Type::primitives(Primitives::NUMBER | Primitives::STRING),
            Type::class(BuiltinClass::Array, &[TypeTable::NUMBER]),
        ];
        for ty in reference_types {
            assert!(holds_reference(&ty), "{ty:?}");
        }
    }
}
