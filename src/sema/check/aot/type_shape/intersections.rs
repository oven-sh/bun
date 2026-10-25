use super::walk::WalkStep;
use super::{AnythingReason, ShapeKind, TypeShape};
use crate::check::aot::answers::GaveUp;
use crate::check::aot::builtin_types::Denotation;
use crate::check::aot::queries::Queries;
use crate::types::{Origin, TypeData, TypeId};
use smallvec::SmallVec;

#[derive(Default)]
struct IntersectionSummary<'c> {
    has_generic_part: bool,
    has_any_part: bool,
    has_never_part: bool,
    has_composite_part: bool,
    narrow_primitive: Option<TypeShape<'c>>,
    wide_primitive: Option<TypeShape<'c>>,
    first_object: Option<TypeShape<'c>>,
    exact_builtin: Option<TypeShape<'c>>,
    object_count: usize,
}

impl<'c> IntersectionSummary<'c> {
    fn add_object(&mut self, shape: TypeShape<'c>) {
        self.first_object.get_or_insert(shape);
        self.object_count += 1;
    }

    fn add(&mut self, shape: TypeShape<'c>) {
        match shape.kind {
            ShapeKind::Anything(reason) => match reason {
                AnythingReason::Any => self.has_any_part = true,
                // A brand is a phantom: no value has it when the program runs. `void & { brand }` holds `undefined`.
                AnythingReason::Void => {
                    let undefined = TypeShape::undeclared(ShapeKind::Undefined);
                    self.wide_primitive.get_or_insert(undefined);
                }
                AnythingReason::Unknown | AnythingReason::EmptyObjectType => {}
            },
            ShapeKind::TypeVariable { .. } => self.has_generic_part = true,
            ShapeKind::Never => self.has_never_part = true,
            ShapeKind::BooleanLiteral(_)
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::StringLiteral(_)
            | ShapeKind::TemplateLiteral { .. } => {
                self.narrow_primitive.get_or_insert(shape);
            }
            ShapeKind::Union(_) | ShapeKind::Int32 { .. } => {
                self.has_composite_part = true;
                self.add_object(shape);
            }
            ShapeKind::Array { .. } | ShapeKind::Tuple { .. } | ShapeKind::Builtin { .. } => {
                if shape.builtin_denotation() == Some(Denotation::Exact) {
                    self.exact_builtin.get_or_insert(shape);
                }
                self.add_object(shape);
            }
            ShapeKind::AnyObject
            | ShapeKind::Function(_)
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Class(_)
            | ShapeKind::Object => self.add_object(shape),
            _ => {
                self.wide_primitive.get_or_insert(shape);
            }
        }
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn walk_intersection(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
    ) -> Result<WalkStep<'c>, GaveUp> {
        if self.c.reduced(ty).is_never() {
            return Ok(WalkStep::Finished(TypeShape::undeclared(ShapeKind::Never)));
        }
        let rest: SmallVec<[TypeId; 4]> = parts
            .iter()
            .copied()
            .filter(|&part| !self.is_int32_tag(part))
            .collect();
        if rest.is_empty() || rest.len() == parts.len() {
            return Ok(WalkStep::Finished(self.shape_of_intersection(ty, parts)?));
        }
        let base = match rest[..] {
            [only] => only,
            _ => self.c.intersection(&rest),
        };
        Ok(WalkStep::Finished(TypeShape::undeclared(
            ShapeKind::Int32 { base },
        )))
    }

    fn is_int32_tag(&self, part: TypeId) -> bool {
        match *self.c.data(part) {
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node),
                ..
            } => self.c.p.aot_symbols().is_int32_tag(file, node),
            _ => false,
        }
    }

    fn shape_of_intersection(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
    ) -> Result<TypeShape<'c>, GaveUp> {
        let mut summary = IntersectionSummary::default();
        let mut rest: SmallVec<[TypeId; 4]> = SmallVec::new();
        for &part in parts {
            let shape = self.type_shape(part)?;
            summary.add(shape);
            if !matches!(shape.kind, ShapeKind::TypeVariable { .. }) {
                rest.push(part);
            }
        }
        if summary.has_generic_part {
            let constraint = match rest[..] {
                [] => None,
                [only] => Some(only),
                _ => Some(self.c.intersection(&rest)),
            };
            return Ok(TypeShape::undeclared(ShapeKind::TypeVariable {
                constraint,
                parameter: None,
            }));
        }
        if summary.has_any_part {
            return Ok(TypeShape::undeclared(ShapeKind::Anything(
                AnythingReason::Any,
            )));
        }
        if summary.has_never_part {
            return Ok(TypeShape::undeclared(ShapeKind::Never));
        }
        if let Some(primitive) = summary.narrow_primitive.or(summary.wide_primitive) {
            return Ok(primitive);
        }
        let Some(first_object) = summary.first_object else {
            return Ok(TypeShape::undeclared(ShapeKind::Anything(
                AnythingReason::EmptyObjectType,
            )));
        };
        if summary.object_count == 1 {
            return Ok(first_object);
        }
        if let Some(builtin) = summary.exact_builtin {
            return Ok(builtin);
        }
        if summary.has_composite_part {
            return Ok(TypeShape::undeclared(ShapeKind::TypeVariable {
                constraint: None,
                parameter: None,
            }));
        }
        Ok(self.shape_of_object_type(ty))
    }
}
