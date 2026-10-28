use super::answers::{ClassRef, TypeParameterRef};
use super::builtin_types::{BuiltinTypeClass, Denotation};
use super::trust::Trust;
use crate::atom::Atom;
use crate::types::{SigId, TypeId};

mod builtin_subtypes;
mod intersections;
mod objects;
mod primitives;
mod recursive_conditionals;
mod unions;
mod walk;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum AnythingReason {
    Any,
    Unknown,
    Void,
    EmptyObjectType,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TupleElementKind {
    Required,
    Optional,
    Rest,
    Variadic,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TupleElement {
    pub ty: TypeId,
    pub kind: TupleElementKind,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct PrimitiveKinds: u8 {
        const STRING = 1;
        const NUMBER = 2;
        const BOOLEAN = 4;
        const BIGINT = 8;
        const SYMBOL = 16;
    }
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum ShapeKind<'c> {
    Anything(AnythingReason),
    TypeVariable {
        constraint: Option<TypeId>,
        parameter: Option<TypeParameterRef>,
    },
    Never,
    Undefined,
    Null,
    Boolean,
    BooleanLiteral(bool),
    Number,
    NumberLiteral(f64),
    NumericEnumMember(f64),
    BigInt,
    BigIntLiteral {
        digits: Atom,
        is_negative: bool,
    },
    String,
    StringLiteral(Atom),
    TemplateLiteral {
        texts: &'c [Atom],
        types: &'c [TypeId],
    },
    Symbol,
    AnyObject,
    Function(&'c [SigId]),
    ClassConstructor(ClassRef),
    Array {
        element: TypeId,
        is_readonly: bool,
    },
    Tuple {
        elements: &'c [TupleElement],
        is_readonly: bool,
    },
    Builtin {
        class: BuiltinTypeClass,
        arguments: &'c [TypeId],
    },
    Class(ClassRef),
    Object,
    Union(&'c [TypeId]),
    /// `int32`, or `int32 & T`. `base` is the type without the tag.
    Int32 {
        base: TypeId,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BuiltinShape {
    Array,
    Class(BuiltinTypeClass),
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct TypeShape<'c> {
    pub kind: ShapeKind<'c>,
    pub trust: Trust,
}

impl<'c> TypeShape<'c> {
    pub(super) fn undeclared(kind: ShapeKind<'c>) -> TypeShape<'c> {
        TypeShape {
            kind,
            trust: Trust::Trusted,
        }
    }

    pub(super) fn declared(kind: ShapeKind<'c>, trust: Trust) -> TypeShape<'c> {
        TypeShape { kind, trust }
    }

    pub fn has_members(self) -> bool {
        matches!(self.kind, ShapeKind::Object | ShapeKind::Class(_))
    }

    pub(super) fn builtin_denotation(self) -> Option<Denotation> {
        Some(match self.builtin_shape()? {
            BuiltinShape::Array => Denotation::Exact,
            BuiltinShape::Class(class) => class.denotation,
        })
    }

    pub fn builtin_shape(self) -> Option<BuiltinShape> {
        match self.kind {
            ShapeKind::Array { .. } | ShapeKind::Tuple { .. } => Some(BuiltinShape::Array),
            ShapeKind::Builtin { class, .. } => Some(BuiltinShape::Class(class)),
            _ => None,
        }
    }

    pub fn can_accept_primitives(self) -> bool {
        matches!(
            self.kind,
            ShapeKind::Object | ShapeKind::Class(_) | ShapeKind::Builtin { .. }
        )
    }
}
