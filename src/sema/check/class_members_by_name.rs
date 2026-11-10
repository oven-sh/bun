use super::super::*;
use super::{Builder, MemberBinding, MembersInPlace, Resolved};
use smallvec::SmallVec;

#[derive(Copy, Clone)]
struct PlainClass<'p> {
    declared: &'p Resolved<'p>,
    base: Option<(Sym, MapperId)>,
    maps_only_this: bool,
}

#[derive(Default)]
pub(in super::super) struct ClassMembersByName<'p> {
    pub(in super::super) is_on: bool,
    classes: FxHashMap<Sym, Option<PlainClass<'p>>>,
    inherited: FxHashMap<(Sym, Atom), Option<&'p Prop<'p>>>,
    depths: FxHashMap<Sym, u32>,
    least_depth_of_name: FxHashMap<Atom, u32>,
    pub(super) with_stored_ancestry: crate::util::FxHashSet<Sym>,
    pub(super) rows_known: crate::util::FxHashSet<(Sym, Sym)>,
    with_only_this_all_the_way_up: crate::util::FxHashSet<Sym>,
    without_properties_all_the_way_up: crate::util::FxHashSet<Sym>,
    first_unit_properties: FxHashMap<Sym, Option<(Atom, TypeId)>>,
    static_sides: FxHashMap<Sym, Option<(&'p Resolved<'p>, TypeId)>>,
}

impl<'p, 's> Checker<'p, 's> {
    #[inline(never)]
    pub(super) fn property_of_unlisted_class(
        &mut self,
        apparent: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<Option<(&'p Prop<'p>, MapperId)>> {
        let skips = skip_object_function_property_augment;
        let target = match *self.data(apparent) {
            TypeData::Ref { target, .. } => target,
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                mapper: MapperId::IDENTITY,
            } => return self.property_of_unlisted_static_side(apparent, class, name, skips),
            _ => return None,
        };
        if self.resolved_members(apparent).is_some() || !self.resolves_no_members() {
            return None;
        }
        self.plain_class(target)?;
        let mapper = self.mapper_of_reference(apparent, target)?;
        if let Some(prop) = self.member_of_plain_class(target, name)? {
            return Some(Some((prop, mapper)));
        }
        if skips {
            return Some(None);
        }
        let resolved = self.plain_class(target)?.declared;
        Some(self.property_in_type(apparent, &Members { resolved, mapper }, name))
    }

    fn property_of_unlisted_static_side(
        &mut self,
        apparent: TypeId,
        class: Sym,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<Option<(&'p Prop<'p>, MapperId)>> {
        if self.resolved_members(apparent).is_some() || !self.resolves_no_members() {
            return None;
        }
        let (exports, base) = self.exports_of_class(class)?;
        if let Some(prop) = exports.prop(name) {
            return Some(Some((prop, MapperId::IDENTITY)));
        }
        let inherited = match self.flags(base) & tf::OBJECT != 0 {
            true => self.prop_ref(base, name),
            false if base == TypeId::UNDEFINED => None,
            false => return None,
        };
        match inherited.filter(|found| !self.is_static_private_name(found.0)) {
            Some((prop, MapperId::IDENTITY)) => Some(Some((prop, MapperId::IDENTITY))),
            Some(_) => None,
            None => skip_object_function_property_augment.then_some(None),
        }
    }

    fn exports_of_class(&mut self, class: Sym) -> Option<(&'p Resolved<'p>, TypeId)> {
        if let Some(&known) = self.class_members_by_name.static_sides.get(&class) {
            return known;
        }
        let scope = self.begin_scope();
        let counters = self.non_cacheable_mark();
        let (binding, until) = (MemberBinding::Late, MembersInPlace::Exports);
        let shape = self.build_origin_shape(Origin::ClassStatic(class), binding, until);
        let base = self.base_constructor_type_of_class(class);
        if self.end_scope(scope).is_err() || self.non_cacheable_mark() != counters {
            return None;
        }
        let exports: &'p Resolved<'p> = self.arena.alloc(Resolved::new(shape));
        let known = exports.has_distinct_names().then_some((exports, base));
        self.class_members_by_name.static_sides.insert(class, known);
        known
    }

    pub(in super::super) fn declared_by_unlisted_class(
        &mut self,
        ty: TypeId,
    ) -> Option<Members<'p>> {
        let &TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        if !self.class_members_by_name.is_on
            || self.resolved_members(ty).is_some()
            || !self.resolves_no_members()
            || !self.has_only_this_all_the_way_up(target)
        {
            return None;
        }
        let resolved = self.plain_class(target)?.declared;
        let mapper = self.mapper_of_reference(ty, target)?;
        Some(Members { resolved, mapper })
    }

    pub(in super::super) fn has_required_properties_of_unlisted_class(
        &mut self,
        source: TypeId,
        ty: TypeId,
    ) -> Option<bool> {
        let &TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        if !self.class_members_by_name.is_on
            || self.resolved_members(ty).is_some()
            || !self.resolves_no_members()
            || !self.has_only_this_all_the_way_up(target)
        {
            return None;
        }
        let mut at = target;
        loop {
            let plain = self.plain_class(at)?;
            for prop in &plain.declared.shape.props {
                if prop.flags.contains(PropFlags::OPTIONAL)
                    || self.get_property_of_type(source, prop.name).is_some()
                {
                    continue;
                }
                let listed = match at == target {
                    true => prop,
                    false => self.member_of_plain_class(target, prop.name)??,
                };
                if !listed.flags.contains(PropFlags::OPTIONAL) {
                    return Some(false);
                }
            }
            match plain.base {
                Some((base, _)) => at = base,
                None => return Some(true),
            }
        }
    }

    fn unlisted_class_of(&mut self, ty: TypeId) -> Option<Sym> {
        let &TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        let is_unlisted = self.class_members_by_name.is_on
            && self.resolved_members(ty).is_none()
            && self.resolves_no_members()
            && self.has_only_this_all_the_way_up(target);
        is_unlisted.then_some(target)
    }

    pub(in super::super) fn is_empty_unlisted_class(&mut self, ty: TypeId) -> Option<bool> {
        let mut at = self.unlisted_class_of(ty)?;
        let mut heirs: SmallVec<[Sym; 8]> = SmallVec::new();
        while !(self.class_members_by_name.without_properties_all_the_way_up).contains(&at) {
            let plain = self.plain_class(at)?;
            if !plain.declared.shape.props.is_empty() {
                return Some(false);
            }
            heirs.push(at);
            let Some((base, _)) = plain.base else {
                break;
            };
            at = base;
        }
        (self.class_members_by_name.without_properties_all_the_way_up).extend(heirs);
        Some(true)
    }

    pub(in super::super) fn first_unit_property_of_unlisted_class(
        &mut self,
        ty: TypeId,
    ) -> Option<Option<(Atom, TypeId)>> {
        let mut at = self.unlisted_class_of(ty)?;
        if !self.instantiated_symbol_links.is_empty() {
            return None;
        }
        let before = self.non_cacheable_mark();
        let is_changed =
            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES | ObjectFlags::HAS_OTHER_INSTANTIATION;
        let mut heirs: SmallVec<[Sym; 8]> = SmallVec::new();
        let found = 'row: loop {
            if let Some(&known) = self.class_members_by_name.first_unit_properties.get(&at) {
                break known;
            }
            let plain = self.plain_class(at)?;
            if let Some((base, _)) = plain.base {
                for prop in &plain.declared.shape.props {
                    if self.member_of_plain_class(base, prop.name)?.is_some() {
                        return None;
                    }
                }
            }
            heirs.push(at);
            for prop in &plain.declared.shape.props {
                let PropSource::Symbol(symbol) = prop.source else {
                    return None;
                };
                let declared = self.type_of_symbol(symbol);
                if before != self.non_cacheable_mark() {
                    return None;
                }
                if self.flags(declared) & tf::OBJECT != 0 {
                    continue;
                }
                let is_adjusted = PropFlags::OPTIONAL | PropFlags::WIDEN | PropFlags::REGULAR;
                if prop.flags.intersects(is_adjusted)
                    || self.types().object_flags(declared).intersects(is_changed)
                {
                    return None;
                }
                if self.is_unit(declared) {
                    break 'row Some((prop.name, self.with_freshness(declared, false)));
                }
            }
            let Some((base, _)) = plain.base else {
                break None;
            };
            at = base;
        };
        let known = &mut self.class_members_by_name.first_unit_properties;
        known.extend(heirs.into_iter().map(|heir| (heir, found)));
        Some(found)
    }

    pub(super) fn resolves_no_members(&self) -> bool {
        self.inheriting.is_empty()
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
                let this = self.intern(TypeData::ThisParam(class));
                let base = self.type_with_this_argument(base, this);
                let base = self.reduced_apparent_type_as_object(base);
                let base = self.type_with_this_argument(base, this);
                let &TypeData::Ref { target, .. } = self.data(base) else {
                    return None;
                };
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

    pub(super) fn inherit_from_plain_classes(&mut self, b: &mut Builder<'s>, class: Sym) -> bool {
        if !self.has_only_this_all_the_way_up(class) {
            return false;
        }
        let mut above: SmallVec<[(&'p Resolved<'p>, MapperId); 8]> = SmallVec::new();
        let mut count = 0;
        let mut at = class;
        loop {
            let Some(plain) = self.plain_class(at).filter(|plain| plain.maps_only_this) else {
                return false;
            };
            if at != class {
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

    fn has_only_this_all_the_way_up(&mut self, class: Sym) -> bool {
        let mut heirs: SmallVec<[Sym; 8]> = SmallVec::new();
        let mut at = class;
        while !(self.class_members_by_name.with_only_this_all_the_way_up).contains(&at) {
            let Some(plain) = self.plain_class(at).filter(|plain| plain.maps_only_this) else {
                return false;
            };
            heirs.push(at);
            let Some((base, _)) = plain.base else {
                break;
            };
            at = base;
        }
        (self.class_members_by_name.with_only_this_all_the_way_up).extend(heirs);
        true
    }

    fn list_of_plain_class(&mut self, class: Sym) -> Option<&'p Resolved<'p>> {
        let declared_type = self.declared_type(class);
        let list = self.p.shapes.handle(&self.task, &declared_type)?;
        Some(self.p.shapes.at(&self.task, list))
    }

    pub(in super::super) fn declared_by_plain_class(
        &mut self,
        class: Sym,
    ) -> Option<(&'p Resolved<'p>, Option<Sym>)> {
        let plain = self
            .plain_class(class)
            .filter(|plain| plain.maps_only_this)?;
        Some((plain.declared, plain.base.map(|base| base.0)))
    }

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
        for (&param, &arg) in params.iter().zip(args).take(actual) {
            pairs.push((param, arg));
        }
        pairs.push((self.intern(TypeData::ThisParam(class)), this));
        Some(self.types().mapper_of(&pairs))
    }

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

    fn member_of_plain_class(&mut self, class: Sym, name: Atom) -> Option<Option<&'p Prop<'p>>> {
        let depth = self.depth_of_plain_class(class)?;
        let least_depth = self.class_members_by_name.least_depth_of_name.get(&name);
        if least_depth.is_none_or(|&least_depth| least_depth > depth) {
            return Some(None);
        }
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
