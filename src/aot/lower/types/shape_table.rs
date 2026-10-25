use bun_sema::check::aot::{
    BuiltinShape, BuiltinTypeClass, Denotation, KeptFact, MemberName, ObjectOrigin, PrimitiveKinds,
    ShapeKind, TupleElement, TupleElementKind,
};
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

use super::shape_edges::collect_edges;
use super::{EdgeKind, MapChild, TypeEdge};
use crate::builtins::id::BuiltinClass;
use crate::builtins::table::{class_data, contents_index};
use crate::builtins::{builtin_class_of, type_name_of};
use crate::ir::generated::{MAX_TRACKED_INTEGER, NameClass};
use crate::ir::{LayoutId, Mapped, Primitives, Type, TypeFlags, TypeId, TypeTable, classify_name};
use crate::lower::{CheckerTypeId, FileLowering};

const ACCEPTED_PRIMITIVE_TYPES: [(PrimitiveKinds, TypeId); 5] = [
    (PrimitiveKinds::STRING, TypeTable::STRING),
    (PrimitiveKinds::NUMBER, TypeTable::NUMBER),
    (PrimitiveKinds::BOOLEAN, TypeTable::BOOLEAN),
    (PrimitiveKinds::BIGINT, TypeTable::BIGINT),
    (PrimitiveKinds::SYMBOL, TypeTable::SYMBOL),
];

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn map_shape(&mut self, ty: CheckerTypeId, children: &mut MapChild<'_>) -> Mapped {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return Mapped::UNKNOWN;
        };
        let mut mapped = match shape.kind {
            ShapeKind::Anything(_)
            | ShapeKind::TypeVariable {
                parameter: None,
                constraint: None,
            } => Mapped::UNKNOWN,
            ShapeKind::TypeVariable {
                parameter: Some(parameter),
                constraint,
            } => {
                let layout = self.type_parameter_layout(parameter);
                if let Some(constraint) = constraint {
                    self.record_type_flow(ty, constraint, 0);
                }
                self.intern_checked(Type::layout(layout))
            }
            ShapeKind::TypeVariable {
                parameter: None,
                constraint: Some(constraint),
            } => self.map_child(children, EdgeKind::Transparent, constraint),
            ShapeKind::Never => Mapped::checked(TypeTable::NEVER),
            ShapeKind::Undefined => Mapped::checked(TypeTable::UNDEFINED),
            ShapeKind::Null => Mapped::checked(TypeTable::NULL),
            ShapeKind::Boolean => Mapped::checked(TypeTable::BOOLEAN),
            ShapeKind::BooleanLiteral(true) => {
                self.intern_checked(Type::primitives(Primitives::TRUE))
            }
            ShapeKind::BooleanLiteral(false) => {
                self.intern_checked(Type::primitives(Primitives::FALSE))
            }
            ShapeKind::Number => Mapped::checked(TypeTable::NUMBER),
            ShapeKind::NumberLiteral(value) => self.intern_checked(number_literal_type(value)),
            ShapeKind::NumericEnumMember(value) => self.intern_checked(enum_member_type(value)),
            ShapeKind::BigInt | ShapeKind::BigIntLiteral { .. } => {
                Mapped::checked(TypeTable::BIGINT)
            }
            ShapeKind::String | ShapeKind::TemplateLiteral { .. } => {
                Mapped::checked(TypeTable::STRING)
            }
            ShapeKind::StringLiteral(atom) => {
                let string = self.intern_atom(atom);
                self.intern_checked(Type::string_literal(string))
            }
            ShapeKind::Symbol => Mapped::checked(TypeTable::SYMBOL),
            ShapeKind::AnyObject => match self.module_type_layout(ty) {
                Some(layout) => self.map_object(ty, Some(layout)),
                None => Mapped::checked(TypeTable::OBJECT),
            },
            ShapeKind::ClassConstructor(class) => {
                let function_type = self.find_class_function_type(class);
                self.intern_checked(Type::function(function_type))
            }
            ShapeKind::Function(signatures) => match self.find_function_type(signatures) {
                Some(function_type) => self.intern_checked(Type::function(function_type)),
                None => Mapped::checked(TypeTable::FUNCTION),
            },
            ShapeKind::Array { element, .. } => {
                let contents = self.map_child(children, EdgeKind::Contents, element);
                self.intern_class(BuiltinClass::Array, &[contents])
            }
            ShapeKind::Tuple { elements, .. } => self.map_tuple(elements, children),
            ShapeKind::Builtin { class, arguments } => {
                self.map_builtin(ty, class, arguments, children)
            }
            ShapeKind::Class(class) => {
                let layout = self.class_type_layout(class, ty);
                self.map_object(ty, Some(layout))
            }
            ShapeKind::Object => {
                let layout = self.object_type_layout(ty);
                let mapped = self.map_object(ty, layout);
                match (layout, self.requires_field(ty)) {
                    (Some(_), true) => {
                        let mapped = self.add_accepted_builtin_classes(ty, mapped);
                        self.add_accepted_class_constructors(ty, mapped)
                    }
                    (Some(_), false) => Mapped::expected(mapped.ty),
                    (None, _) => mapped,
                }
            }
            ShapeKind::Union(members) => self.map_union(members, children),
            ShapeKind::Int32 { .. } => Mapped::checked(TypeTable::INT32),
        };
        if !shape.trust.is_trusted() {
            mapped = Mapped::expected(mapped.ty);
        }
        let types = &mut self.fragment.types;
        if holds_reference(types.get(mapped.ty)) {
            mapped.ty = types.with_nullish(mapped.ty);
        }
        mapped
    }

    fn map_child(
        &mut self,
        children: &mut MapChild<'_>,
        kind: EdgeKind,
        target: CheckerTypeId,
    ) -> Mapped {
        children(self, TypeEdge { kind, target })
    }

    fn intern_checked(&mut self, ty: Type) -> Mapped {
        Mapped::checked(self.fragment.types.intern(ty))
    }

    // No test looks at the contents of a container, so what is only expected of them leaves the class checked.
    fn intern_class(&mut self, class: BuiltinClass, contents: &[Mapped]) -> Mapped {
        let contents: SmallVec<[TypeId; 2]> = contents.iter().map(|mapped| mapped.ty).collect();
        self.intern_checked(Type::class(class, &contents))
    }

    fn union_all(&mut self, members: &[Mapped]) -> Mapped {
        let types = &mut self.fragment.types;
        let ty = types.union_all(members.iter().map(|mapped| mapped.ty));
        match members.iter().all(|mapped| mapped.is_checked) {
            true => Mapped::checked(ty),
            false => Mapped::expected(ty),
        }
    }

    fn is_numeric_enum_member(&mut self, ty: CheckerTypeId) -> bool {
        match self.queries.type_shape(ty) {
            Ok(shape) => matches!(shape.kind, ShapeKind::NumericEnumMember(_)),
            Err(_) => false,
        }
    }

    fn map_union(&mut self, members: &[CheckerTypeId], children: &mut MapChild<'_>) -> Mapped {
        let mut mapped_members: SmallVec<[Mapped; 4]> = SmallVec::with_capacity(members.len() + 1);
        let mut enum_member_count = 0;
        for &member in members {
            mapped_members.push(self.map_child(children, EdgeKind::Transparent, member));
            enum_member_count += usize::from(self.is_numeric_enum_member(member));
        }
        // TypeScript lets every number into a type that lists members of a numeric enum, and `a | b` of two flags is no member.
        if enum_member_count > 1 {
            mapped_members.push(Mapped::checked(TypeTable::INT32));
        }
        self.union_all(&mapped_members)
    }

    fn map_tuple(&mut self, elements: &[TupleElement], children: &mut MapChild<'_>) -> Mapped {
        let mut contents: SmallVec<[Mapped; 4]> = SmallVec::with_capacity(elements.len());
        for element in elements {
            contents.push(match element.kind {
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => {
                    self.map_child(children, EdgeKind::Contents, element.ty)
                }
                TupleElementKind::Variadic => Mapped::UNKNOWN,
            });
        }
        let contents = self.union_all(&contents);
        self.intern_class(BuiltinClass::Array, &[contents])
    }

    fn map_builtin(
        &mut self,
        ty: CheckerTypeId,
        class: BuiltinTypeClass,
        arguments: &[CheckerTypeId],
        children: &mut MapChild<'_>,
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
            let mapped = self.map_child(children, EdgeKind::Contents, argument);
            if let Some(index) = contents_index(builtin_class, slot) {
                contents[index] = mapped;
            }
        }
        let whole = match is_function_class(builtin_class) {
            true => Mapped::checked(TypeTable::FUNCTION),
            false => self.intern_class(builtin_class, &contents),
        };
        // A view is also the type of objects that are no instances of the class.
        let denoted = match class.denotation {
            Denotation::Exact => whole,
            Denotation::View => Mapped::expected(whole.ty),
        };
        self.add_accepted_primitives(ty, denoted)
    }

    fn map_object(&mut self, ty: CheckerTypeId, layout: Option<LayoutId>) -> Mapped {
        let layout_type = match layout {
            Some(layout) => self.fragment.types.intern(Type::layout(layout)),
            None => TypeTable::OBJECT,
        };
        self.add_accepted_primitives(ty, Mapped::checked(layout_type))
    }

    fn add_accepted_primitives(&mut self, ty: CheckerTypeId, mapped: Mapped) -> Mapped {
        let Ok(accepted) = self.queries.accepted_primitives(ty) else {
            return Mapped::expected(mapped.ty);
        };
        let types = &mut self.fragment.types;
        let mut widened = mapped;
        for (kind, primitive) in ACCEPTED_PRIMITIVE_TYPES {
            if accepted.contains(kind) {
                widened.ty = types.union(widened.ty, primitive);
            }
        }
        widened
    }

    // A layout tells objects apart by their fields. Every object is of a type that requires none, so its layout is only expected.
    fn requires_field(&mut self, ty: CheckerTypeId) -> bool {
        let Ok(members) = self.queries.member_presence(ty) else {
            return true;
        };
        members.iter().any(|member| match member.name {
            MemberName::String(name) if !member.is_optional => !matches!(
                classify_name(self.queries.atom_bytes(name)),
                NameClass::Index | NameClass::CanonicalNumericString | NameClass::Proto
            ),
            MemberName::String(_) | MemberName::Symbol(_) | MemberName::Private(_) => false,
        })
    }

    fn add_accepted_builtin_classes(&mut self, ty: CheckerTypeId, mapped: Mapped) -> Mapped {
        let Ok(builtins) = self.queries.accepted_builtins(ty) else {
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
                false => self.intern_class(class, &contents).ty,
            };
            widened.ty = self.fragment.types.union(widened.ty, instances);
            let data = class_data(class);
            widened.is_checked &=
                data.has_instance_test && data.type_names.iter().any(|name| !name.is_view);
        }
        widened
    }

    fn add_accepted_class_constructors(&mut self, ty: CheckerTypeId, mapped: Mapped) -> Mapped {
        let Ok(classes) = self.queries.accepted_class_constructors(ty) else {
            return Mapped::expected(mapped.ty);
        };
        let mut widened = mapped;
        for &class in classes {
            let function_type = self.find_class_function_type(class);
            let constructor = self.fragment.types.intern(Type::function(function_type));
            widened.ty = self.fragment.types.union(widened.ty, constructor);
        }
        widened
    }

    fn is_seen_alike_in_every_file(
        &mut self,
        ty: CheckerTypeId,
        pending: &mut Vec<CheckerTypeId>,
    ) -> bool {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return false;
        };
        match shape.kind {
            ShapeKind::Object => match self.queries.object_origin(ty) {
                ObjectOrigin::ObjectLiteral { .. } => false,
                // The layout of an interface has edges to the layouts of what it extends.
                ObjectOrigin::Symbol(interface) => {
                    match self.queries.declared_base_types(interface) {
                        Ok(bases) => {
                            pending.extend(bases);
                            true
                        }
                        Err(_) => false,
                    }
                }
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
            | ShapeKind::Int32 { .. } => true,
        }
    }

    fn walk_alike_types(&mut self, root: CheckerTypeId, tables: &mut AlikeWalkTables) -> bool {
        let AlikeWalkTables {
            visited,
            pending,
            reached,
        } = tables;
        let fact = KeptFact::IsMappedAlikeInEveryFile;
        let unstable_answers = self.queries.count_unstable_answers();
        visited.insert(root);
        pending.push(root);
        while let Some(ty) = pending.pop() {
            match self.find_known_fact(ty, fact) {
                Some(true) => continue,
                Some(false) => return false,
                None => {}
            }
            if !self.is_seen_alike_in_every_file(ty, reached) {
                return false;
            }
            reached.extend(collect_edges(self, ty).iter().map(|edge| edge.target));
            pending.extend(reached.drain(..).filter(|&target| visited.insert(target)));
        }
        for &ty in visited.iter() {
            self.keep_fact(ty, fact, true, unstable_answers);
        }
        true
    }

    fn holds_every_number(&mut self, ty: CheckerTypeId) -> bool {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return false;
        };
        if let ShapeKind::Union(members) = shape.kind {
            return members
                .iter()
                .any(|&member| self.holds_every_number(member));
        }
        matches!(shape.kind, ShapeKind::Number)
    }
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

fn is_function_class(class: BuiltinClass) -> bool {
    core::iter::successors(Some(class), |&class| class_data(class).parent)
        .any(|class| class == BuiltinClass::Function)
}

pub(super) fn has_layout_in_every_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    file.requires_field(ty)
        && matches!(file.queries.accepted_builtins(ty), Ok([]))
        && matches!(file.queries.accepted_class_constructors(ty), Ok([]))
}

/// Empty between two walks, which use their memory one after the other.
#[derive(Default)]
pub(super) struct AlikeWalkTables {
    visited: FxHashSet<CheckerTypeId>,
    pending: Vec<CheckerTypeId>,
    reached: Vec<CheckerTypeId>,
}

pub(super) fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    root: CheckerTypeId,
) -> bool {
    let mut tables = core::mem::take(&mut file.types.alike_walk);
    let is_alike = file.walk_alike_types(root, &mut tables);
    tables.visited.clear();
    tables.pending.clear();
    tables.reached.clear();
    file.types.alike_walk = tables;
    is_alike
}

pub(super) fn lists_int32(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    match shape.kind {
        ShapeKind::Int32 { .. } => true,
        // `int32 | number` holds every number: there is nothing to prove.
        ShapeKind::Union(members) => {
            members.iter().any(|&member| lists_int32(file, member))
                && !members
                    .iter()
                    .any(|&member| file.holds_every_number(member))
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
