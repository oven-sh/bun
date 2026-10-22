use super::PrimitiveKinds;
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
        let ty = self.declared_type_of_this(ty);
        if !self.type_shape(ty)?.can_accept_primitives() {
            return Ok(accepted);
        }
        let members = self.c.members(ty);
        // A string satisfies `Iterable<T>` for some `T`, and is not assignable to it while `T` is free.
        let for_some_arguments = self.c.permissive_instantiation(ty);
        // That a source shares no property with a type of optional properties alone is an error for whoever writes the assignment.
        let relation = match self.c.is_weak_type(for_some_arguments) {
            true => Relation::Comparable,
            false => Relation::Assignable,
        };
        for (kind, source) in PRIMITIVE_SOURCES {
            let can_be_related = match members {
                Some(members) => self.has_required_properties(source, members.shape()),
                None => true,
            };
            if can_be_related && self.is_related(source, for_some_arguments, relation)? {
                accepted |= kind;
            }
        }
        Ok(accepted)
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
