//! The properties of an intersection that has only been asked for properties by name.
//!
//! The members of an intersection are a list with a copy of every property of every constituent, and an index of their
//! names. `Props & Omit<React.HTMLAttributes<T>, keyof Props>` has 300 of them, and takes no list to be asked for `children`
//! and `className`. So the first lookup by name leaves the properties where they are, in the constituents. The list is
//! made when something asks for it (`members`), or when a quarter of the names were asked for.
//!
//! tsgo lists the properties of an intersection before it looks the first one up (`getReducedType`), and what that resolves
//! can report errors, close cycles, create types and add to `instantiationCount`. So nothing that computes anything waits:
//! - `build_intersection_shape` asks every constituent for its members, instantiates every property
//!   (`instantiation_of_prop`) and the first signatures, and combines the properties that several constituents have, all in
//!   the order and at the moment in which it does so for a list, inside the same query and the same scope.
//! - What waits takes what that has returned and copies it: `Constituent::copy_of_property`, `list_properties`. It reads no
//!   table, so the list is the same whenever it is made, whatever is in progress by then.
//! - The properties wait only if the list would have been stored: the query ended without a cycle or a taint and no
//!   counter moved. Otherwise the list is made at once, and goes the way it went before.
//! - The members of a constituent are kept by reference, so they have to be the stored ones (`has_stored_members`): others
//!   do not outlive the file.
//! - The list of some intersections is noted for `Program::validate` when it is assigned (`listing_alias`). Those are listed.
//! - A task whose entries another task reads lists as before (`Task::is_read_later`). Another task would otherwise find
//!   no list where it found one, and would ask the constituents itself, with what it has in progress. The tasks of the
//!   last step, which check nearly all the files, publish nothing.
//!
//! A property that is found by name is equal to the one in the list, field by field. It is not at the same address. Only
//! `UnionPropertyBuilder::symbols` tells properties apart by address, and `property_holder`, which feeds it, lists.
//!
//! All of this belongs to one checker, and so to one task. The thresholds change the time, never a result.

use super::super::instantiate::PropInstantiation;
use super::super::*;
use super::{Built, IntersectionBuilder, RECENT_MEMBERS, Resolved};
use crate::util::PositionSet;
use smallvec::SmallVec;

/// `false`: the first lookup by name lists the properties, as before.
pub(super) const ENABLED: bool = true;

/// The list of every intersection that is left without one is made the long way as well, and compared with the list that
/// would be made later. And every property that is found by name is compared with the one in that list. A difference is a
/// panic that names the intersection and the file. For debugging.
const SHADOW: bool = false;

/// With fewer properties in its constituents, an intersection is listed at once. Most intersections are small: a list of
/// theirs is soon made, and a name is found faster in it than in a table by type and then in each constituent.
const MIN_PROPERTIES: usize = 32;

/// With more constituents it is listed at once: each is compared with each other for the names that they share.
const MOST_CONSTITUENTS: usize = 8;

/// A constituent of an intersection, and what `build_intersection_shape` has computed for its properties.
pub(super) struct Constituent<'p> {
    /// `Program::members` has `members` for this type.
    asked: TypeId,
    members: Members<'p>,
    /// What `instantiation_of_prop` has returned for each property. Empty: `Members::mapper` is the identity, or the
    /// properties take it as it is (`take_any_mapper`).
    instantiations: Box<[PropInstantiation]>,
    /// The positions of the properties whose name another constituent has too. See `Unlisted::combined`.
    shared: PositionSet,
}

pub(super) type Constituents<'p> = SmallVec<[Constituent<'p>; 4]>;

impl<'p> Constituent<'p> {
    #[inline]
    fn props(&self) -> &'p [Prop<'p>] {
        &self.members.shape().props
    }

    /// The property at `position` as `instantiate_prop` makes it.
    fn copy_of_property<'s>(&self, position: usize, arena: &'s Arena) -> Prop<'s> {
        let mut own = self.props()[position].clone_in(arena);
        match self.instantiations.get(position) {
            Some(instantiation) => instantiation.apply_to(&mut own),
            None if self.members.mapper != MapperId::IDENTITY => own.mapper = self.members.mapper,
            None => {}
        }
        own
    }
}

/// Whether `instantiation_of_prop(prop, mapper)` is `mapper` for each of `props`, and computes nothing.
fn take_any_mapper(props: &[Prop]) -> bool {
    props.iter().all(|prop| {
        prop.mapper == MapperId::IDENTITY
            && matches!(
                prop.source,
                PropSource::Symbol(_)
                    | PropSource::Literal(..)
                    | PropSource::Intersected(..)
                    | PropSource::ReverseMapped(..)
            )
    })
}

/// Sets `Constituent::shared`. Of two constituents, the names of the one that has fewer are looked up in the other.
fn find_shared_names(constituents: &mut [Constituent]) {
    for constituent in constituents.iter_mut() {
        constituent.shared = PositionSet::new(constituent.props().len());
    }
    for later in 1..constituents.len() {
        let (earlier, rest) = constituents.split_at_mut(later);
        let later = &mut rest[0];
        for earlier in earlier {
            if !(earlier.members.resolved).may_share_a_name_with(later.members.resolved) {
                continue;
            }
            let (few, many) = match earlier.props().len() <= later.props().len() {
                true => (&mut *earlier, &mut *later),
                false => (&mut *later, &mut *earlier),
            };
            for (position, prop) in few.props().iter().enumerate() {
                if let Some(other) = many.members.resolved.position(prop.name) {
                    few.shared.insert(position);
                    many.shared.insert(other);
                }
            }
        }
    }
}

impl<'s> IntersectionBuilder<'s> {
    /// Adds the properties of `constituents`.
    pub(super) fn add_all(&mut self, constituents: &[Constituent], arena: &'s Arena) {
        for constituent in constituents {
            let count = constituent.props().len();
            self.b.reserve(count);
            for position in 0..count {
                self.add(constituent.copy_of_property(position, arena), arena);
            }
        }
    }

    /// Adds the properties of `constituents` whose name several of them have.
    pub(super) fn add_shared(&mut self, constituents: &mut [Constituent], arena: &'s Arena) {
        find_shared_names(constituents);
        for constituent in constituents.iter() {
            for position in constituent.shared.iter() {
                self.add(constituent.copy_of_property(position, arena), arena);
            }
        }
    }
}

/// An intersection whose properties are not listed.
struct Unlisted<'p> {
    constituents: Constituents<'p>,
    /// What `build_intersection_shape` has returned: the properties whose name several constituents have, and all that the
    /// members of an intersection have besides properties.
    combined: &'p Resolved<'p>,
    /// For the list.
    stored: Stored,
    /// The properties of one constituent that were asked for.
    found: FxHashMap<Atom, &'p Prop<'p>>,
    /// How many properties the constituents have.
    count: usize,
}

impl<'p> Unlisted<'p> {
    fn find<'s: 'p>(&mut self, name: Atom, arena: &'s Arena) -> Option<&'p Prop<'p>> {
        let combined = self.combined;
        if let Some(prop) = combined.prop(name) {
            return Some(prop);
        }
        if let Some(&prop) = self.found.get(&name) {
            return Some(prop);
        }
        for constituent in &self.constituents {
            let Some(position) = constituent.members.resolved.position_past_filter(name) else {
                continue;
            };
            let copy: &'p Prop<'p> = arena.alloc(constituent.copy_of_property(position, arena));
            self.found.insert(name, copy);
            return Some(copy);
        }
        None
    }
}

#[derive(Default)]
pub(in super::super) struct UnlistedIntersections<'p> {
    by_type: FxHashMap<TypeId, Unlisted<'p>>,
}

impl<'p, 's> Checker<'p, 's> {
    /// What `build_intersection_shape` computes for the properties in `members`, which are the members of `asked`.
    pub(super) fn instantiate_constituent(
        &mut self,
        asked: TypeId,
        members: Members<'p>,
    ) -> Constituent<'p> {
        let props = &members.shape().props;
        let computes_nothing = members.mapper == MapperId::IDENTITY || take_any_mapper(props);
        let instantiations: Box<[PropInstantiation]> = if computes_nothing {
            Box::default()
        } else {
            (props.iter())
                .map(|prop| self.instantiation_of_prop(prop, members.mapper))
                .collect()
        };
        Constituent {
            asked,
            members,
            instantiations,
            shared: PositionSet::default(),
        }
    }

    /// Whether the properties of the intersection `whole` of `parts` may stay in `constituents`, if the list of them would
    /// be stored.
    pub(super) fn may_stay_unlisted(
        &self,
        whole: TypeId,
        parts: &[TypeId],
        constituents: &[Constituent<'p>],
    ) -> bool {
        let count: usize = constituents.iter().map(|it| it.props().len()).sum();
        count >= MIN_PROPERTIES
            && constituents.len() <= MOST_CONSTITUENTS
            // Two properties of one constituent that have one name are combined as well.
            && (constituents.iter()).all(|it| it.members.resolved.has_distinct_names())
            && (constituents.iter()).all(|it| self.has_stored_members(it.asked, it.members))
            && self.listing_alias(whole, parts, false).is_none()
    }

    /// The properties of the intersection `ty` of `parts` stay in `constituents`. `combined`, `constituents`: what
    /// `build_intersection_shape` has returned. `stored`: for the list. The result is not the members of `ty`:
    /// `members_for_a_name` drops it.
    pub(super) fn leave_unlisted(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
        combined: Shape<'s>,
        constituents: Constituents<'p>,
        stored: Stored,
    ) -> Built<'p> {
        let combined: &'p Resolved<'p> = self.arena.alloc(Resolved::new(combined));
        if SHADOW {
            self.check_unlisted_intersection(ty, parts, combined, &constituents);
        }
        let unlisted = Unlisted {
            count: constituents.iter().map(|it| it.props().len()).sum(),
            constituents,
            combined,
            stored,
            found: FxHashMap::default(),
        };
        self.unlisted_intersections.by_type.insert(ty, unlisted);
        Built {
            resolved: combined,
            kept: None,
        }
    }

    /// The list of the properties of `ty`, if `leave_unlisted` has left `ty` without one, and the permission to store it.
    pub(super) fn list_unlisted_intersection(&mut self, ty: TypeId) -> Option<(Shape<'s>, Stored)> {
        let unlisted = self.unlisted_intersections.by_type.remove(&ty)?;
        let shape = Self::list_properties(unlisted.combined, &unlisted.constituents, self.arena);
        Some((shape, unlisted.stored))
    }

    /// What `build_intersection_shape` returns where nothing waits, from what it has returned where `constituents` do.
    pub(super) fn list_properties(
        combined: &Resolved,
        constituents: &[Constituent<'p>],
        arena: &'s Arena,
    ) -> Shape<'s> {
        let of_one = |it: &Constituent| it.props().len() - it.shared.iter().count();
        let count = constituents.iter().map(of_one).sum::<usize>() + combined.shape.props.len();
        let mut shape = Shape::new_in(arena);
        shape.props.reserve_exact(count);
        // A property is where the first constituent that has the name has it.
        let mut is_listed = PositionSet::new(combined.shape.props.len());
        for constituent in constituents {
            for (position, prop) in constituent.props().iter().enumerate() {
                if !constituent.shared.contains(position) {
                    (shape.props).push(constituent.copy_of_property(position, arena));
                } else if let Some(at) = combined.position(prop.name)
                    && !is_listed.contains(at)
                {
                    is_listed.insert(at);
                    shape.props.push(combined.shape.props[at].clone_in(arena));
                }
            }
        }
        shape.call = combined.shape.call.clone_in(arena);
        shape.construct = combined.shape.construct.clone_in(arena);
        shape.properties_of = combined.shape.properties_of;
        shape
    }

    /// `members(ty)` for the intersection `ty`, for a caller that looks one name up in them. `None`: the properties of `ty`
    /// are not listed, and `property_of_unlisted_intersection` finds them.
    #[inline]
    pub(super) fn members_for_a_name(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let recent = self.recent_members[ty.0 as usize % RECENT_MEMBERS];
        if recent.ty == ty
            && self.unresolved_members.is_empty()
            && let Some(resolved) = recent.resolved
        {
            return Some(Members {
                resolved,
                mapper: recent.mapper,
            });
        }
        self.members_for_a_name_not_recent(ty)
    }

    #[inline(never)]
    fn members_for_a_name_not_recent(&mut self, ty: TypeId) -> Option<Members<'p>> {
        if self.task.is_read_later() || self.p.members.get(&self.task, &ty).is_some() {
            return self.members_not_recent(ty);
        }
        if self.unlisted_intersections.by_type.contains_key(&ty) {
            return None;
        }
        let TypeData::Intersection(parts) = self.data(ty) else {
            return self.members_not_recent(ty);
        };
        // `members_on_cache_miss`
        let scope = self.begin_scope();
        let built = self.properties_of_intersection(ty, parts, true);
        let members = self.keep_members(ty, scope, Some((built, MapperId::IDENTITY)));
        match self.unlisted_intersections.by_type.contains_key(&ty) {
            true => None,
            false => members,
        }
    }

    /// `property_of_holder` for the intersection `ty`, for which `members_for_a_name` has returned `None`.
    #[inline(never)]
    pub(super) fn property_of_unlisted_intersection(
        &mut self,
        ty: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        let arena = self.arena;
        let unlisted = self.unlisted_intersections.by_type.get_mut(&ty)?;
        let found = unlisted.find(name, arena);
        let combined = unlisted.combined;
        let is_asked_often = unlisted.found.len() * 4 >= unlisted.count;
        if SHADOW {
            self.check_property_of_unlisted_intersection(ty, name, found);
        }
        if is_asked_often {
            let _ = self.members(ty);
        }
        if let Some(prop) = found {
            return Some((prop, MapperId::IDENTITY));
        }
        if skip_object_function_property_augment {
            return None;
        }
        // It does not have the name either, and has the signatures that say which global types `ty` has properties of.
        let members = Members {
            resolved: combined,
            mapper: MapperId::IDENTITY,
        };
        self.property_in_type(ty, &members, name)
    }

    /// Under `SHADOW`, in `leave_unlisted`.
    #[cold]
    #[inline(never)]
    fn check_unlisted_intersection(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
        combined: &Resolved,
        constituents: &[Constituent<'p>],
    ) {
        let count = self.instantiation_count;
        let (long_way, _) = self.build_intersection_shape(ty, parts, false);
        self.instantiation_count = count;
        if Self::list_properties(combined, constituents, self.arena) != long_way {
            self.fact_differs_for("the properties of an unlisted intersection", &[ty]);
        }
    }

    /// Under `SHADOW`: `found` is what `Unlisted::find` has returned for the property `name` of `ty`.
    #[cold]
    #[inline(never)]
    fn check_property_of_unlisted_intersection(
        &mut self,
        ty: TypeId,
        name: Atom,
        found: Option<&Prop>,
    ) {
        let Some(unlisted) = self.unlisted_intersections.by_type.get(&ty) else {
            return;
        };
        let listed = Self::list_properties(unlisted.combined, &unlisted.constituents, self.arena);
        if listed.prop(name) != found {
            self.fact_differs_for("a property of an unlisted intersection", &[ty]);
        }
    }
}
