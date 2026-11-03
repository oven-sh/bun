//! A member of a class, found by its name without listing what the class inherits.
//!
//! The members of a class are a list with a copy of every member of every class above it, plus an index of their
//! names. In a row of a thousand classes that extend one another that's half a million copies, each with a mapper of
//! its own for `this`, and `super.m()` or the type of a class's own field needs one of them. So while the compiler's
//! questions are answered (`Checker::with_queries`), a lookup by name goes up from class to class and copies the one
//! member it finds, with the same step that `inherit` uses for every member (`copy_for_heir`).
//!
//! It's off while a file is checked: tsgo lists the members before it looks up the first one, and what that resolves,
//! and when, decides which errors a circular program gets.
//!
//! Only the plain case is answered here: a class that declares properties and nothing else, has at most one base type,
//! which is again such a class, and whose base type doesn't depend on its type arguments, at a moment when no members
//! or base types are being resolved. Everything else gets the list (`members`), and so does whoever asks for the list.
//! A member found here equals the one in the list field by field. Nothing here is stored where another task sees it.
//!
//! The list of such a class is made from what the classes above it declare, up to the first that has a list
//! (`inherit_from_plain_classes`), so asking for the list of the lowest class of a row doesn't list the whole row.

use super::super::*;
use super::{Builder, Resolved};
use smallvec::SmallVec;

/// What `resolveObjectTypeMembers` starts from for one class.
#[derive(Copy, Clone)]
struct PlainClass<'p> {
    /// `resolveDeclaredMembers`
    declared: &'p Resolved<'p>,
    /// The class it extends, and the mapper of the members of `getTypeWithThisArgument(baseType, thisType)`.
    base: Option<(Sym, MapperId)>,
    /// True if `this` is its only type parameter, its outer type parameters included.
    maps_only_this: bool,
}

#[derive(Default)]
pub(in super::super) struct ClassMembersByName<'p> {
    pub(in super::super) is_on: bool,
    /// `None` for a class that isn't plain.
    classes: FxHashMap<Sym, Option<PlainClass<'p>>>,
    /// The inherited members looked up so far, in every class between the one that was asked and the one that declares
    /// the member. `None`, for the class that was asked alone, if no class above has the name.
    inherited: FxHashMap<(Sym, Atom), Option<&'p Prop<'p>>>,
    /// How many classes stand above a class, if they're all plain.
    depths: FxHashMap<Sym, u32>,
    /// The least depth at which a class in `depths` declares the name. A class that stands higher has no such member,
    /// which is what most lookups in the class above find: it doesn't have the field that the class below declares.
    least_depth_of_name: FxHashMap<Atom, u32>,
    /// Classes and interfaces whose base types are stored, and those of their base types, and so on up. All that stands
    /// above a member is a member, so what isn't a member stands above none of them: `has_base` passes them by when it
    /// looks for something else, which is how a class that is getting its base types finds that it isn't its own base
    /// without walking up the whole row.
    pub(super) with_stored_ancestry: crate::util::FxHashSet<Sym>,
}

impl<'p, 's> Checker<'p, 's> {
    /// `property_of_holder(property_holder_for_a_name(ty), ..)`, where `apparent` is `getReducedApparentType(ty)`.
    /// The outer `None` means it isn't answered here.
    #[inline(never)]
    pub(super) fn property_of_unlisted_class(
        &mut self,
        apparent: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<Option<(&'p Prop<'p>, MapperId)>> {
        let &TypeData::Ref { target, .. } = self.data(apparent) else {
            return None;
        };
        if self.resolved_members(apparent).is_some() || !self.resolves_no_members() {
            return None;
        }
        self.plain_class(target)?;
        let mapper = self.mapper_of_reference(apparent, target)?;
        if let Some(prop) = self.member_of_plain_class(target, name)? {
            return Some(Some((prop, mapper)));
        }
        if skip_object_function_property_augment {
            return Some(None);
        }
        // The declared members don't have the name either, and like the list they have no signatures, which determine
        // the global types that `apparent` has the properties of.
        let resolved = self.plain_class(target)?.declared;
        Some(self.property_in_type(apparent, &Members { resolved, mapper }, name))
    }

    /// True if what `members_uncached` and `shape_memo_bound` do for a type reference doesn't depend on what's in
    /// progress.
    pub(super) fn resolves_no_members(&self) -> bool {
        self.unresolved_members.is_empty()
            && self.inheriting.is_empty()
            && self.late_binding.is_empty()
            && self.base_types_so_far.is_empty()
            && self.resolving_at_base_types.is_empty()
            && self.members_resolved_before_base_types.is_empty()
            && self.declared_members_in_progress.is_empty()
            && self.declared_index_infos_in_progress.is_empty()
            && self.anonymous_members_in_place.is_empty()
            && self.mapped_types_in_progress.is_empty()
            && self.this_types_in_progress.is_empty()
    }

    fn plain_class(&mut self, class: Sym) -> Option<PlainClass<'p>> {
        if let Some(&known) = self.class_members_by_name.classes.get(&class) {
            return known;
        }
        let scope = self.begin_scope();
        let counters = self.non_cacheable_mark();
        let plain = self.compute_plain_class(class);
        // What a cycle or a limit has cut short is asked again.
        if self.end_scope(scope).is_err() || self.non_cacheable_mark() != counters {
            return None;
        }
        self.class_members_by_name.classes.insert(class, plain);
        plain
    }

    fn compute_plain_class(&mut self, class: Sym) -> Option<PlainClass<'p>> {
        if !self.files().flags(class).contains(SymFlags::CLASS) {
            return None;
        }
        let declared_type = self.declared_type(class);
        if !matches!(self.data(declared_type), TypeData::Ref { .. })
            || self.inherits_from_type_arguments(class)
            || (self.p.circular_base_types.get(&self.task, &class)).is_some()
        {
            return None;
        }
        let shape = self.resolve_declared_members(class);
        let declares_only_properties = shape.call.is_empty()
            && shape.construct.is_empty()
            && shape.index.is_empty()
            && (shape.props.iter()).all(|prop| matches!(prop.source, PropSource::Symbol(_)));
        if !declares_only_properties {
            return None;
        }
        let declared: &'p Resolved<'p> = self.arena.alloc(Resolved::new(shape));
        if !declared.has_distinct_names() {
            return None;
        }
        let base = match self.base_types(class)[..] {
            [] => None,
            [base] => {
                // As `inherit` gets the members of a base type.
                let this = self.intern(TypeData::ThisParam(class));
                let base = self.type_with_this_argument(base, this);
                let base = self.reduced_apparent_type_as_object(base);
                let base = self.type_with_this_argument(base, this);
                let &TypeData::Ref { target, .. } = self.data(base) else {
                    return None;
                };
                // The class above is asked whether it's plain when a lookup gets there, so that a row of classes isn't
                // a row of calls.
                if !self.files().flags(target).contains(SymFlags::CLASS) || target == class {
                    return None;
                }
                Some((target, base))
            }
            _ => return None,
        };
        let base = match base {
            Some((target, reference)) => {
                Some((target, self.mapper_of_reference(reference, target)?))
            }
            None => None,
        };
        let maps_only_this = self.type_arguments(declared_type).is_empty();
        Some(PlainClass {
            declared,
            base,
            maps_only_this,
        })
    }

    /// `inherit` for all the classes above `class` at once. Returns false, and adds nothing, unless `class` and all of
    /// them are plain and have no type parameter but `this`.
    ///
    /// `inherit` copies a member from list to list, and maps its mapper at each step: from the `this` of the class that
    /// declares it to the `this` of the next class down, and so on. Here the steps are put together on the way up, one
    /// mapper for each class, and each member is copied once.
    pub(super) fn inherit_from_plain_classes(&mut self, b: &mut Builder<'s>, class: Sym) -> bool {
        let mut above: SmallVec<[(&'p Resolved<'p>, MapperId); 8]> = SmallVec::new();
        let mut count = 0;
        let mut at = class;
        loop {
            let Some(plain) = self.plain_class(at).filter(|plain| plain.maps_only_this) else {
                return false;
            };
            if at != class {
                // A class that has its list passes it on, as it does in `inherit`.
                let listed = self.list_of_plain_class(at);
                let members = listed.unwrap_or(plain.declared);
                count += members.shape.props.len();
                let last = above.len() - 1;
                above[last].0 = members;
                if listed.is_some() {
                    break;
                }
            }
            let Some((base, step)) = plain.base else {
                break;
            };
            let to_class = match above.last() {
                Some(&(_, so_far)) => self.map_mapper(step, so_far),
                None => step,
            };
            above.push((plain.declared, to_class));
            at = base;
        }
        b.reserve(count);
        for (members, to_class) in above {
            let mut composed = (MapperId::IDENTITY, true, to_class);
            for prop in &members.shape.props {
                if !b.has(prop.name) {
                    let prop = self.copy_for_heir(prop, to_class, &mut composed);
                    b.add_new(prop);
                }
            }
        }
        true
    }

    /// The list of the members of the plain class `class`, if it has been made.
    fn list_of_plain_class(&mut self, class: Sym) -> Option<&'p Resolved<'p>> {
        let declared_type = self.declared_type(class);
        let list = self.p.shapes.handle(&self.task, &declared_type)?;
        Some(self.p.shapes.at(&self.task, list))
    }

    /// The properties that the plain class `class` declares, and the class it extends. `None` if it has a type parameter
    /// other than `this`.
    pub(in super::super) fn declared_by_plain_class(
        &mut self,
        class: Sym,
    ) -> Option<(&'p Resolved<'p>, Option<Sym>)> {
        let plain = self
            .plain_class(class)
            .filter(|plain| plain.maps_only_this)?;
        Some((plain.declared, plain.base.map(|base| base.0)))
    }

    /// Where `get_named_members` puts `prop` in the list of the plain class `class`: two properties are in the order of
    /// these, then of their names.
    pub(in super::super) fn place_in_list_of_plain_class(
        &mut self,
        class: Sym,
        prop: &Prop,
    ) -> Option<(bool, (u8, (bool, u32, u32)))> {
        let plain = self.plain_class(class)?;
        let is_outside = plain.declared.prop(prop.name).is_none() && {
            let ranges = self.ranges_of_declarations(class);
            !self.is_within_ranges_of_declarations(prop, &ranges)
        };
        Some((is_outside, self.order_of_property(prop)))
    }

    /// `Members::mapper` of `members(ty)`, where `ty` is a reference to the plain class `class` and so shares the shape of
    /// the declared type. See `members_uncached`.
    pub(in super::super) fn mapper_of_reference(
        &mut self,
        ty: TypeId,
        class: Sym,
    ) -> Option<MapperId> {
        let declared = self.declared_type(class);
        if !matches!(self.data(declared), TypeData::Ref { .. }) {
            return None;
        }
        let (params, args) = (self.type_arguments(declared), self.type_arguments(ty));
        if self.resolved_type_arguments(ty) != Some(args) {
            return None;
        }
        let this = args.get(params.len()).copied().unwrap_or(ty);
        let actual = if declared == ty {
            0
        } else {
            params.len().min(args.len())
        };
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::new();
        pairs.extend(
            params
                .iter()
                .copied()
                .zip(args.iter().copied())
                .take(actual),
        );
        pairs.push((self.intern(TypeData::ThisParam(class)), this));
        Some(self.types().mapper_of(&pairs))
    }

    /// `None` unless `class` and all the classes above it are plain.
    fn depth_of_plain_class(&mut self, class: Sym) -> Option<u32> {
        let mut heirs: SmallVec<[Sym; 8]> = SmallVec::new();
        let mut at = class;
        let mut depth = loop {
            if let Some(&known) = self.class_members_by_name.depths.get(&at) {
                break known + 1;
            }
            heirs.push(at);
            match self.plain_class(at)?.base {
                Some((base, _)) => at = base,
                None => break 0,
            }
        };
        let by_name = &mut self.class_members_by_name;
        while let Some(heir) = heirs.pop() {
            by_name.depths.insert(heir, depth);
            for prop in &by_name.classes[&heir]?.declared.shape.props {
                let least_depth = by_name
                    .least_depth_of_name
                    .entry(prop.name)
                    .or_insert(depth);
                *least_depth = depth.min(*least_depth);
            }
            depth += 1;
        }
        Some(depth - 1)
    }

    /// The property `name` in the list of the declared type of `class`. The outer `None` means a class on the way up
    /// isn't plain.
    fn member_of_plain_class(&mut self, class: Sym, name: Atom) -> Option<Option<&'p Prop<'p>>> {
        let depth = self.depth_of_plain_class(class)?;
        let least_depth = self.class_members_by_name.least_depth_of_name.get(&name);
        if least_depth.is_none_or(|&least_depth| least_depth > depth) {
            return Some(None);
        }
        // The classes passed on the way up, each with the mapper of its base type's members.
        let mut heirs: SmallVec<[(Sym, MapperId); 8]> = SmallVec::new();
        let mut at = class;
        let mut found = loop {
            let plain = self.plain_class(at)?;
            if let Some(prop) = plain.declared.prop(name) {
                break Some(prop);
            }
            if let Some(&known) = self.class_members_by_name.inherited.get(&(at, name)) {
                break known;
            }
            if let Some(list) = self.list_of_plain_class(at) {
                break list.prop(name);
            }
            let Some((base, mapper)) = plain.base else {
                break None;
            };
            heirs.push((at, mapper));
            at = base;
        };
        if found.is_none() {
            if !heirs.is_empty() {
                (self.class_members_by_name.inherited).insert((class, name), None);
            }
            return Some(None);
        }
        while let Some((heir, mapper)) = heirs.pop() {
            if let Some(prop) = found {
                let mut composed = (MapperId::IDENTITY, true, mapper);
                let copy = self.copy_for_heir(prop, mapper, &mut composed);
                found = Some(self.arena.alloc(copy));
            }
            (self.class_members_by_name.inherited).insert((heir, name), found);
        }
        Some(found)
    }
}
