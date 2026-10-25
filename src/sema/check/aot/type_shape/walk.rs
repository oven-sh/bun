use super::{AnythingReason, ShapeKind, TupleElement, TupleElementKind, TypeShape};
use crate::check::aot::answers::GaveUp;
use crate::check::aot::queries::Queries;
use crate::check::aot::trust::Trust;
use crate::program::Sym;
use crate::types::{ElemFlags, EnumValue, Intrinsic, TypeData, TypeId, UniqueSymbolDeclaration};
use smallvec::SmallVec;

pub(super) enum WalkStep<'c> {
    Finished(TypeShape<'c>),
    Continue(TypeId),
}

fn shape_of_intrinsic<'c>(intrinsic: Intrinsic) -> Result<ShapeKind<'c>, GaveUp> {
    Ok(match intrinsic {
        Intrinsic::Unresolved => return Err(GaveUp::Unresolved),
        Intrinsic::Error => return Err(GaveUp::ErrorType),
        Intrinsic::Any
        | Intrinsic::Auto
        | Intrinsic::IntrinsicMarker
        | Intrinsic::Wildcard
        | Intrinsic::NonInferrableAny => ShapeKind::Anything(AnythingReason::Any),
        Intrinsic::Unknown => ShapeKind::Anything(AnythingReason::Unknown),
        Intrinsic::Void => ShapeKind::Anything(AnythingReason::Void),
        Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening => {
            ShapeKind::Undefined
        }
        Intrinsic::Null | Intrinsic::NullWidening => ShapeKind::Null,
        Intrinsic::String => ShapeKind::String,
        Intrinsic::Number => ShapeKind::Number,
        Intrinsic::BigInt => ShapeKind::BigInt,
        Intrinsic::Symbol => ShapeKind::Symbol,
        Intrinsic::Object => ShapeKind::AnyObject,
        _ => ShapeKind::Never,
    })
}

fn tuple_element_kind(flags: ElemFlags) -> TupleElementKind {
    if flags.contains(ElemFlags::VARIADIC) {
        TupleElementKind::Variadic
    } else if flags.contains(ElemFlags::REST) {
        TupleElementKind::Rest
    } else if flags.contains(ElemFlags::OPTIONAL) {
        TupleElementKind::Optional
    } else {
        TupleElementKind::Required
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(in crate::check::aot) fn compute_type_shape(
        &mut self,
        ty: TypeId,
    ) -> Result<TypeShape<'c>, GaveUp> {
        if self.c.is_stack_low() {
            return Err(GaveUp::Unresolved);
        }
        let mut current = ty;
        let mut visited: SmallVec<[TypeId; 4]> = SmallVec::new();
        loop {
            if visited.contains(&current) {
                return Err(GaveUp::Unresolved);
            }
            visited.push(current);
            match self.compute_walk_step(current)? {
                WalkStep::Finished(shape) => return Ok(shape),
                WalkStep::Continue(next) => current = next,
            }
        }
    }

    fn compute_walk_step(&mut self, ty: TypeId) -> Result<WalkStep<'c>, GaveUp> {
        let shape = match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => {
                TypeShape::undeclared(shape_of_intrinsic(*intrinsic)?)
            }
            TypeData::UnresolvedName { .. } => return Err(GaveUp::ErrorType),
            TypeData::StringLit { value, .. } => {
                TypeShape::undeclared(ShapeKind::StringLiteral(*value))
            }
            TypeData::NumberLit { bits, .. } => {
                TypeShape::undeclared(ShapeKind::NumberLiteral(f64::from_bits(*bits)))
            }
            TypeData::BigIntLit { text, negative, .. } => {
                TypeShape::undeclared(ShapeKind::BigIntLiteral {
                    digits: *text,
                    is_negative: *negative,
                })
            }
            TypeData::BoolLit { value, .. } => {
                TypeShape::undeclared(ShapeKind::BooleanLiteral(*value))
            }
            TypeData::EnumLit { member, value, .. } => self.shape_of_enum_member(*member, *value),
            TypeData::Enum { symbol, .. } => {
                TypeShape::declared(ShapeKind::Number, self.symbol_trust(*symbol))
            }
            TypeData::EvolvingArray(_) => {
                TypeShape::undeclared(ShapeKind::Anything(AnythingReason::Any))
            }
            TypeData::UniqueSymbol { symbol, .. } => self.shape_of_unique_symbol(*symbol),
            TypeData::TypeParam(file, id, _) => {
                let kind = ShapeKind::TypeVariable {
                    constraint: self.c.constraint_of_type_param(ty),
                    parameter: self.compiled_type_parameter(*file, *id),
                };
                TypeShape::declared(kind, self.file_trust(*file))
            }
            TypeData::Marker(_) => TypeShape::undeclared(ShapeKind::TypeVariable {
                constraint: None,
                parameter: None,
            }),
            TypeData::Cond { .. } | TypeData::IndexedAccess { .. } | TypeData::Keyof(_) => {
                let constraint = match self.has_costly_base_constraint(ty) {
                    true => None,
                    false => self.c.base_constraint_of(ty),
                };
                let constraint = constraint.filter(|&constraint| constraint != ty);
                TypeShape::undeclared(ShapeKind::TypeVariable {
                    constraint,
                    parameter: None,
                })
            }
            TypeData::ThisParam(symbol) => {
                return Ok(WalkStep::Continue(self.c.declared_type(*symbol)));
            }
            TypeData::Substitution { base, .. } => return Ok(WalkStep::Continue(*base)),
            TypeData::Union(members) => self.shape_of_union(members)?,
            TypeData::Intersection(parts) => return self.walk_intersection(ty, parts),
            TypeData::Ref { target, .. } => self.shape_of_reference(ty, *target)?,
            TypeData::Tuple {
                flags, readonly, ..
            } => self.shape_of_tuple(ty, flags, *readonly),
            TypeData::Anon { origin, .. } => self.shape_of_anonymous_type(ty, *origin),
            TypeData::Fns { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } => {
                self.shape_of_object_type(ty)
            }
            TypeData::Template { texts, types } => {
                TypeShape::undeclared(ShapeKind::TemplateLiteral {
                    texts: self.list(texts),
                    types: self.list(types),
                })
            }
            TypeData::StringMapping { .. } => TypeShape::undeclared(ShapeKind::String),
        };
        Ok(WalkStep::Finished(shape))
    }

    fn shape_of_enum_member(&mut self, member: Sym, value: EnumValue) -> TypeShape<'c> {
        let kind = match (value, self.rests_on_inexact_power(member)) {
            (EnumValue::String(text), false) => ShapeKind::StringLiteral(text),
            (EnumValue::String(_), true) => ShapeKind::String,
            (EnumValue::Number(bits), false) => ShapeKind::NumericEnumMember(f64::from_bits(bits)),
            (EnumValue::Number(_), true) => ShapeKind::Number,
        };
        TypeShape::declared(kind, self.symbol_trust(member))
    }

    fn shape_of_unique_symbol(&self, declaration: UniqueSymbolDeclaration) -> TypeShape<'c> {
        let trust = match declaration {
            UniqueSymbolDeclaration::Variable(symbol) => self.symbol_trust(symbol),
            UniqueSymbolDeclaration::Member(file, _) => self.file_trust(file),
            UniqueSymbolDeclaration::SymbolConstructor => Trust::Trusted,
        };
        TypeShape::declared(ShapeKind::Symbol, trust)
    }

    fn shape_of_tuple(&mut self, ty: TypeId, flags: &[ElemFlags], readonly: bool) -> TypeShape<'c> {
        let arguments = self.c.type_arguments(ty);
        let elements: SmallVec<[TupleElement; 8]> = arguments
            .iter()
            .zip(flags)
            .map(|(&ty, &flags)| TupleElement {
                ty,
                kind: tuple_element_kind(flags),
            })
            .collect();
        TypeShape::undeclared(ShapeKind::Tuple {
            elements: self.list(&elements),
            is_readonly: readonly,
        })
    }
}
