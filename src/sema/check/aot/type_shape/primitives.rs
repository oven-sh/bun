use super::PrimitiveKinds;
use crate::atom::Atom;
use crate::check::aot::answers::GaveUp;
use crate::check::aot::queries::Queries;
use crate::check::relate::Relation;
use crate::types::{Listed, PropFlags, TypeId};

const PRIMITIVE_SOURCES: [(PrimitiveKinds, TypeId); 5] = [
    (PrimitiveKinds::STRING, TypeId::STRING),
    (PrimitiveKinds::NUMBER, TypeId::NUMBER),
    (PrimitiveKinds::BOOLEAN, TypeId::BOOLEAN),
    (PrimitiveKinds::BIGINT, TypeId::BIGINT),
    (PrimitiveKinds::SYMBOL, TypeId::SYMBOL),
];

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(in crate::check::aot) fn compute_accepted_primitives(
        &mut self,
        ty: TypeId,
    ) -> Result<PrimitiveKinds, GaveUp> {
        let mut accepted = PrimitiveKinds::empty();
        let ty = self.resolve_object_type(ty);
        if !self.type_shape(ty)?.can_accept_primitives() {
            return Ok(accepted);
        }
        // A class of many members, most of them inherited, is not listed to find that no primitive has the first of them.
        let no_primitive_has_what_is_required = PRIMITIVE_SOURCES.iter().all(|&(_, source)| {
            self.c.has_required_properties_of_unlisted_class(source, ty) == Some(false)
        });
        if no_primitive_has_what_is_required {
            return Ok(accepted);
        }
        let mut possible = PrimitiveKinds::all();
        if let Some(members) = self.c.members(ty) {
            for prop in &members.shape().props {
                if prop.flags.contains(PropFlags::OPTIONAL) {
                    continue;
                }
                possible &= self.primitives_with_property(prop.name);
                if possible.is_empty() {
                    return Ok(accepted);
                }
            }
        }
        let for_some_arguments = self.c.permissive_instantiation(ty);
        let relation = match self.c.is_weak_type(for_some_arguments) {
            true => Relation::Comparable,
            false => Relation::Assignable,
        };
        for (kind, source) in PRIMITIVE_SOURCES {
            if possible.contains(kind) && self.is_related(source, for_some_arguments, relation)? {
                accepted |= kind;
            }
        }
        Ok(accepted)
    }

    fn primitives_with_property(&mut self, name: Atom) -> PrimitiveKinds {
        if let Some(&known) = self.kept.primitives_with_property.get(&name) {
            return known;
        }
        let mut found = PrimitiveKinds::empty();
        for (kind, source) in PRIMITIVE_SOURCES {
            if self.c.get_property_of_type(source, name).is_some() {
                found |= kind;
            }
        }
        if !name.is_own() {
            self.kept.primitives_with_property.insert(name, found);
        }
        found
    }

    pub(super) fn is_related(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
    ) -> Result<bool, GaveUp> {
        self.ask(|queries| {
            let source = queries.resolved(source)?;
            let target = queries.resolved(target)?;
            queries
                .c
                .try_is_type_related_to(source, target, relation, false)
                .map_err(|_| GaveUp::Unresolved)
        })
    }

    pub(super) fn has_required_properties(&mut self, source: TypeId, shape: &Listed<'_>) -> bool {
        shape.props.iter().all(|prop| {
            prop.flags.contains(PropFlags::OPTIONAL)
                || self.c.get_property_of_type(source, prop.name).is_some()
        })
    }
}
