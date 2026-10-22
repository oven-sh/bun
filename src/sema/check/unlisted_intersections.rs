//! Properties of an intersection that has only had properties looked up by name.
//!
//! An intersection's members are a list with a copy of every property of every constituent, plus an index of their
//! names. `Props & Omit<React.HTMLAttributes<T>, keyof Props>` has 300 properties, and looking up `children` and
//! `className` doesn't need that list. So the first lookup by name leaves the properties in the constituents. The list
//! is built when something requests it (`members`), or after a quarter as many lookups as there are names.
//!
//! tsgo lists an intersection's properties before it looks up the first one (`getReducedType`), and what that resolves
//! can report errors, close cycles, create types and add to `instantiationCount`. So nothing that computes anything is
//! deferred:
//! - `build_intersection_shape` gets every constituent's members, instantiates every property (`instantiation_of_prop`)
//!   and the first signatures, and combines the properties that several constituents have. It does all that in the same
//!   order and at the same moment as when it builds a list, inside the same query and the same scope.
//! - The deferred part only copies those results: `Constituent::copy_of_property`, `list_properties`. It doesn't read
//!   any table, so the list is the same whenever it's built, whatever is in progress at that point.
//! - The list is deferred only if it would have been stored: the query ended without a cycle or a taint and no counter
//!   moved. Otherwise the list is built immediately and handled the usual way.
//! - A constituent's members are held by reference, so they have to be the stored ones (`has_stored_members`). Others
//!   don't outlive the file.
//! - Another task doesn't find a list until one is built, as if this task hadn't looked yet, and builds its own.
//!
//! A property found by name equals the one in the list, field by field, but it isn't at the same address. Only
//! `UnionPropertyBuilder::symbols` distinguishes properties by address, and it identifies an intersection's property by
//! the intersection.
//!
//! All of this belongs to one checker, and so to one task. The thresholds only affect speed, never a result.

use super::super::instantiate::PropInstantiation;
use super::super::*;
use super::{Built, FEW_MEMBERS, IntersectionBuilder, RECENT_MEMBERS, Resolved, SharedNames};
use crate::util::PositionSet;
use smallvec::SmallVec;

/// An intersection whose constituents have fewer properties than this is listed immediately. Most intersections are
/// small. Their list is cheap to build, and finding a name in it is faster than a lookup in a table by type followed by
/// one in each constituent.
const MIN_PROPERTIES: usize = 32;

/// A constituent of an intersection, with what `build_intersection_shape` computed for its properties.
pub(super) struct Constituent<'p> {
    /// The type whose entry in `Program::members` is `members`.
    queried_type: TypeId,
    members: Members<'p>,
    /// The result of `instantiation_of_prop` for each property. Empty if `Members::mapper` is the identity, or if the
    /// properties take the mapper as is (`mapper_applies_unchanged`).
    instantiations: Box<[PropInstantiation]>,
    /// Positions of the properties whose name another constituent also has. See `Unlisted::combined`.
    shared: PositionSet,
}

pub(super) type Constituents<'p> = SmallVec<[Constituent<'p>; 4]>;

impl<'p> Constituent<'p> {
    #[inline]
    fn props(&self) -> &'p [Prop<'p>] {
        &self.members.shape().props
    }

    /// Returns the property at `position`, as `instantiate_prop` would produce it.
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

/// True if `instantiation_of_prop(prop, mapper)` is `mapper` for each of `props` and computes nothing.
fn mapper_applies_unchanged(props: &[Prop]) -> bool {
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

/// Sets `Constituent::shared` and returns the number of shared properties. No constituent has the same name twice. For
/// each pair of constituents, the names of the one with fewer properties are looked up in the other.
fn find_shared_names(constituents: &mut [Constituent]) -> usize {
    for constituent in constituents.iter_mut() {
        constituent.shared = PositionSet::new(constituent.props().len());
    }
    let all: SmallVec<[Members; 8]> = constituents.iter().map(|it| it.members).collect();
    if all.len() > FEW_MEMBERS {
        let names = SharedNames::of(&all);
        for &(at, position) in names.iter().flatten() {
            constituents[at as usize].shared.insert(position as usize);
        }
        return names.iter().map(<[_]>::len).sum();
    }
    for later in 1..constituents.len() {
        let (earlier, rest) = constituents.split_at_mut(later);
        let later = &mut rest[0];
        for earlier in earlier {
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
    constituents.iter().map(|it| it.shared.iter().count()).sum()
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

    /// Adds the properties of `constituents` whose name several of them have. Returns false if that's more than half of
    /// the properties, in which case it has added all of them. `Components[keyof Components]` in a parameter has little
    /// else.
    pub(super) fn add_shared(
        &mut self,
        constituents: &mut [Constituent],
        arena: &'s Arena,
    ) -> bool {
        let shared = find_shared_names(constituents);
        let count: usize = constituents.iter().map(|it| it.props().len()).sum();
        if shared * 2 > count {
            self.add_all(constituents, arena);
            return false;
        }
        for constituent in constituents.iter() {
            for position in constituent.shared.iter() {
                self.add(constituent.copy_of_property(position, arena), arena);
            }
        }
        true
    }
}

/// An intersection whose properties aren't listed.
struct Unlisted<'p> {
    constituents: Constituents<'p>,
    /// The result of `build_intersection_shape`: the properties whose name several constituents have, and everything an
    /// intersection's members have besides properties.
    combined: &'p Resolved<'p>,
    /// Permission to store the list.
    stored: Stored,
    /// The properties looked up so far that only one constituent has.
    found: FxHashMap<Atom, &'p Prop<'p>>,
    /// Total number of properties in the constituents.
    count: usize,
    /// Number of `property_of_unlisted_intersection` calls.
    lookups: usize,
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
            let Some(position) = constituent.members.resolved.position(name) else {
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
    /// The last intersection of many constituents that was tested for `never`, if its constituents share the names of
    /// more than half of their properties. See `add_shared`. Its properties are requested next.
    shares_most_names: Option<TypeId>,
}

impl<'p, 's> Checker<'p, 's> {
    /// Computes what `build_intersection_shape` needs for the properties in `members`, which are the members of
    /// `queried_type`.
    pub(super) fn instantiate_constituent(
        &mut self,
        queried_type: TypeId,
        members: Members<'p>,
    ) -> Constituent<'p> {
        let props = &members.shape().props;
        let computes_nothing =
            members.mapper == MapperId::IDENTITY || mapper_applies_unchanged(props);
        let instantiations: Box<[PropInstantiation]> = if computes_nothing {
            Box::default()
        } else {
            (props.iter())
                .map(|prop| self.instantiation_of_prop(prop, members.mapper))
                .collect()
        };
        Constituent {
            queried_type,
            members,
            instantiations,
            shared: PositionSet::default(),
        }
    }

    /// `names`: the names of `ty`'s constituents.
    pub(super) fn note_names_of_constituents(&mut self, ty: TypeId, names: &SharedNames) {
        let shared: usize = names.iter().map(<[_]>::len).sum();
        self.unlisted_intersections.shares_most_names =
            (shared * 2 > names.holders.len()).then_some(ty);
    }

    /// True if the properties of the intersection `whole` may stay in `constituents`, provided their list would be
    /// stored.
    pub(super) fn may_stay_unlisted(
        &self,
        whole: TypeId,
        constituents: &[Constituent<'p>],
    ) -> bool {
        let count: usize = constituents.iter().map(|it| it.props().len()).sum();
        count >= MIN_PROPERTIES
            && self.unlisted_intersections.shares_most_names != Some(whole)
            // Two same-named properties of one constituent are combined too.
            && (constituents.iter()).all(|it| it.members.resolved.has_distinct_names())
            && (constituents.iter()).all(|it| self.has_stored_members(it.queried_type, it.members))
    }

    /// Leaves the properties of the intersection `ty` in `constituents`. `combined` and `constituents` are the results
    /// of `build_intersection_shape`. `stored` is the permission to store the list. The result isn't `ty`'s members,
    /// and `members_for_a_name` drops it.
    pub(super) fn leave_unlisted(
        &mut self,
        ty: TypeId,
        combined: Shape<'s>,
        constituents: Constituents<'p>,
        stored: Stored,
    ) -> Built<'p> {
        let combined: &'p Resolved<'p> = self.arena.alloc(Resolved::new(combined));
        let unlisted = Unlisted {
            count: constituents.iter().map(|it| it.props().len()).sum(),
            constituents,
            combined,
            stored,
            found: FxHashMap::default(),
            lookups: 0,
        };
        self.unlisted_intersections.by_type.insert(ty, unlisted);
        Built {
            resolved: combined,
            store_handle: None,
        }
    }

    /// Returns the property list of `ty` and the permission to store it, if `leave_unlisted` left `ty` without a list.
    pub(super) fn list_unlisted_intersection(&mut self, ty: TypeId) -> Option<(Shape<'s>, Stored)> {
        let unlisted = self.unlisted_intersections.by_type.remove(&ty)?;
        let shape = Self::list_properties(unlisted.combined, &unlisted.constituents, self.arena);
        Some((shape, unlisted.stored))
    }

    /// Builds what `build_intersection_shape` returns when nothing is deferred, from what it returned when
    /// `constituents` were left unlisted.
    pub(super) fn list_properties(
        combined: &Resolved,
        constituents: &[Constituent<'p>],
        arena: &'s Arena,
    ) -> Shape<'s> {
        let unshared_count = |it: &Constituent| it.props().len() - it.shared.iter().count();
        let count =
            constituents.iter().map(unshared_count).sum::<usize>() + combined.shape.props.len();
        let mut shape = Shape::new_in(arena);
        shape.props.reserve_exact(count);
        // A property's position is where the first constituent with that name has it.
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
        shape.call.extend_from_slice(&combined.shape.call);
        shape.construct.extend_from_slice(&combined.shape.construct);
        shape.properties_of = combined.shape.properties_of();
        shape
    }

    /// `members(ty)` for the intersection `ty`, for a caller that looks up one name in them. Returns `None` if `ty`'s
    /// properties aren't listed. Then `property_of_unlisted_intersection` finds them.
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
        if self.p.members.get(&self.task, &ty).is_some() {
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
        let members = self.cache_members(ty, scope, Some((built, MapperId::IDENTITY)));
        match self.unlisted_intersections.by_type.contains_key(&ty) {
            true => None,
            false => members,
        }
    }

    /// `property_of_holder` for the intersection `ty`, for which `members_for_a_name` returned `None`.
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
        unlisted.lookups += 1;
        // Misses count too, because a union looks up every member's names in all the other members.
        let is_looked_up_often = unlisted.lookups * 4 >= unlisted.count;
        if is_looked_up_often {
            let _ = self.members(ty);
        }
        if let Some(prop) = found {
            return Some((prop, MapperId::IDENTITY));
        }
        if skip_object_function_property_augment {
            return None;
        }
        // `combined` doesn't have the name either, but it has the signatures that determine which global types `ty`
        // inherits properties from.
        let members = Members {
            resolved: combined,
            mapper: MapperId::IDENTITY,
        };
        self.property_in_type(ty, &members, name)
    }

    /// True if `prop` is an own property of the intersection `ty`. `property_of_unlisted_intersection` has just found
    /// it, either there or in a global type whose properties `ty` inherits, and may have listed the properties.
    pub(super) fn is_own_property_of_intersection(&mut self, ty: TypeId, prop: &Prop) -> bool {
        match self.unlisted_intersections.by_type.get(&ty) {
            Some(unlisted) => {
                unlisted.found.contains_key(&prop.name)
                    || unlisted.combined.prop(prop.name).is_some()
            }
            None => {
                (self.members(ty)).is_some_and(|members| members.resolved.prop(prop.name).is_some())
            }
        }
    }
}
