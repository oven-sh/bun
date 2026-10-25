use super::walk::WalkStep;
use super::{AnythingReason, ShapeKind, TypeShape};
use crate::atom::Atom;
use crate::check::aot::answers::{GaveUp, MemberName, SchemaConstraint};
use crate::check::aot::builtin_types::Denotation;
use crate::check::aot::program_symbols::{SchemaAlias, is_brand_key};
use crate::check::aot::queries::Queries;
use crate::check::aot::schema_constraints::{SchemaPart, closes_object, find_refusal};
use crate::types::TypeId;
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
            ShapeKind::Union(_) | ShapeKind::Constrained { .. } => {
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
        let mut constraints: SmallVec<[SchemaConstraint<'c>; 4]> = SmallVec::new();
        let mut rest: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut first_alias = None;
        for &part in parts {
            match self.schema_part(part)? {
                SchemaPart::NotSchema => rest.push(part),
                SchemaPart::Int32Tag => constraints.push(SchemaConstraint::Int32),
                SchemaPart::Alias(alias, constraint) => {
                    first_alias.get_or_insert(alias);
                    constraints.push(constraint);
                }
            }
        }
        if rest.len() == parts.len() {
            return Ok(WalkStep::Finished(self.shape_of_intersection(ty, parts)?));
        }
        let base = match rest[..] {
            [] => {
                let shape = match first_alias {
                    Some(alias) => self.shape_of_aliases_alone(alias, &constraints)?,
                    None => self.shape_of_intersection(ty, parts)?,
                };
                return Ok(WalkStep::Finished(shape));
            }
            [only] => only,
            _ => self.c.intersection(&rest),
        };
        // The type would promise of every key what only a key that matches no pattern holds.
        let has_patterns = constraints
            .iter()
            .any(|constraint| matches!(constraint, SchemaConstraint::PatternProperties { .. }));
        if has_patterns && !self.index_signatures(base)?.is_empty() {
            constraints.push(self.refuse_alias(SchemaAlias::PatternProperties)?);
        }
        Ok(WalkStep::Finished(TypeShape::undeclared(
            ShapeKind::Constrained {
                base,
                constraints: self.list(&constraints),
            },
        )))
    }

    // `{} & Schema.MinProperties<1>` and `unknown & Schema.MinProperties<1>` are `Schema.MinProperties<1>` alone, so rules alone do not say what they are rules of. `Schema.Strict` and `Schema.DeepStrict` do: an object without members.
    pub(super) fn shape_of_aliases_alone(
        &self,
        first_alias: SchemaAlias,
        constraints: &[SchemaConstraint<'c>],
    ) -> Result<TypeShape<'c>, GaveUp> {
        if constraints.iter().any(closes_object) {
            return Ok(TypeShape::undeclared(ShapeKind::Constrained {
                base: TypeId::EMPTY_TYPE_LITERAL,
                constraints: self.list(constraints),
            }));
        }
        let refusal = match find_refusal(constraints) {
            Some(refusal) => refusal,
            None => self.refuse_alias(first_alias)?,
        };
        Ok(TypeShape::undeclared(ShapeKind::Constrained {
            base: TypeId::UNKNOWN,
            constraints: self.list(&[refusal]),
        }))
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
            return self.shape_of_branded_primitive(parts, primitive);
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

    // Of several the first by its bytes, so that every build names the same one.
    fn find_brand_key(&mut self, part: TypeId) -> Result<Option<Atom>, GaveUp> {
        if !self.type_shape(part)?.has_members() {
            return Ok(None);
        }
        let members = self.listed_members(part)?;
        let keys = members.iter().filter_map(|member| match member.name {
            MemberName::String(name) => is_brand_key(self.atom_bytes(name)).then_some(name),
            MemberName::Symbol(_) | MemberName::Private(_) => None,
        });
        Ok(keys.min_by_key(|&key| self.atom_bytes(key)))
    }

    // Nobody reads the members of an object type that stands beside a primitive. `Readonly<Schema.MinLength<8>>` is not the type literal of the alias, so it gives no constraint, and the rule that it spells would be lost.
    fn shape_of_branded_primitive(
        &mut self,
        parts: &[TypeId],
        primitive: TypeShape<'c>,
    ) -> Result<TypeShape<'c>, GaveUp> {
        let mut rest: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut keys: SmallVec<[Atom; 1]> = SmallVec::new();
        for &part in parts {
            match self.find_brand_key(part)? {
                Some(key) => keys.push(key),
                None => rest.push(part),
            }
        }
        let Some(key) = keys.into_iter().min_by_key(|&key| self.atom_bytes(key)) else {
            return Ok(primitive);
        };
        let base = match rest[..] {
            [] => TypeId::UNKNOWN,
            [only] => only,
            _ => self.c.intersection(&rest),
        };
        Ok(TypeShape::undeclared(ShapeKind::Constrained {
            base,
            constraints: self.list(&[SchemaConstraint::Refused(key)]),
        }))
    }
}
