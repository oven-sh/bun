//! Instantiation: substituting type arguments for type parameters.

use super::alias::NewAlias;
use super::links::FixedMapper;
use super::*;
use smallvec::SmallVec;

/// A direct-mapped cache of results keyed by two numbers, not both 0. It belongs to one checker and
/// sits in front of a slower lookup. A new entry overwrites whatever occupied its slot.
#[derive(Default)]
pub(super) struct Recent {
    /// The two key numbers, the result and a tag. Initially empty, then a power-of-two number of
    /// entries.
    slots: Vec<[u32; 4]>,
    /// A hash shifted right by this amount is a slot index.
    shift: u32,
    /// Number of entries inserted since the table last grew.
    added: usize,
}

impl Recent {
    const MAX_SLOTS: usize = 1 << 14;

    #[inline]
    fn slot(&self, a: u32, b: u32) -> usize {
        let both = u64::from(a) << 32 | u64::from(b);
        (both.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> self.shift) as usize
    }

    #[inline]
    pub(super) fn get(&self, a: u32, b: u32) -> Option<u32> {
        match self.slots.get(self.slot(a, b)) {
            Some(&[x, y, answer, _]) if x == a && y == b => Some(answer),
            _ => None,
        }
    }

    /// Returns the result, and the tag for the caller to read and replace.
    #[inline]
    fn get_tagged(&mut self, a: u32, b: u32) -> Option<(u32, &mut u32)> {
        let slot = self.slot(a, b);
        match self.slots.get_mut(slot) {
            Some([x, y, answer, tag]) if *x == a && *y == b => Some((*answer, tag)),
            _ => None,
        }
    }

    #[inline]
    pub(super) fn put(&mut self, a: u32, b: u32, answer: u32) {
        self.put_tagged(a, b, answer, 0);
    }

    #[inline]
    fn put_tagged(&mut self, a: u32, b: u32, answer: u32, tag: u32) {
        if self.added == self.slots.len() && self.added < Self::MAX_SLOTS {
            self.grow();
        }
        self.added += 1;
        let slot = self.slot(a, b);
        self.slots[slot] = [a, b, answer, tag];
    }

    /// Most files need few slots, and the few that need many dominate the time.
    #[cold]
    fn grow(&mut self) {
        let len = (self.slots.len() * 4).max(64);
        let old = std::mem::replace(&mut self.slots, vec![[0; 4]; len]);
        self.shift = 64 - len.trailing_zeros();
        self.added = 0;
        for entry @ [a, b, ..] in old {
            if (a, b) != (0, 0) {
                let slot = self.slot(a, b);
                self.slots[slot] = entry;
            }
        }
    }
}

/// The arguments of `steps_of_sig_mapper` and its result.
pub(super) type Steps = ((FileId, FnId, MapperId), Option<(MapperId, MapperId)>);

/// `activeMappers`. tsgo caches the instantiations under a mapper for as long as an instantiation
/// with that mapper is in progress (`activeTypeMappersCaches`), and a hit in that cache doesn't add
/// to `instantiationCount`. The results are cached elsewhere here. This records what that cache
/// would hold, for the count.
#[derive(Default)]
pub(super) struct ActiveMappers {
    mappers: Vec<MapperId>,
    activations: Vec<Activation>,
    pushed: u32,
}

struct Activation {
    /// Unique, and never 0. Entries of `recent_instantiations` made under it are tagged with it.
    serial: u32,
    /// The type parameters instantiated under it.
    params: SmallVec<[TypeId; 4]>,
}

impl ActiveMappers {
    /// `findActiveMapper`
    #[inline]
    fn find(&self, mapper: MapperId) -> Option<usize> {
        self.mappers.iter().rposition(|&m| m == mapper)
    }

    /// True if an `instantiate_cached` with `mapper` is in progress.
    #[inline]
    pub(super) fn is_active(&self, mapper: MapperId) -> bool {
        self.find(mapper).is_some()
    }

    /// True if no `instantiate_cached` is in progress.
    #[inline]
    pub(super) fn is_empty(&self) -> bool {
        self.mappers.is_empty()
    }

    /// `pushActiveMapper`
    fn push(&mut self, mapper: MapperId) {
        self.pushed = self.pushed.wrapping_add(1).max(1);
        self.mappers.push(mapper);
        self.activations.push(Activation {
            serial: self.pushed,
            params: SmallVec::new(),
        });
    }

    /// `popActiveMapper`
    fn pop(&mut self) {
        self.mappers.pop();
        self.activations.pop();
    }
}

/// The one field that instantiating a property replaces, with its new value. It lets an
/// uninstantiated property be compared with an instantiated one without copying it.
#[derive(Copy, Clone)]
pub(super) enum PropInstantiation {
    /// The type in `PropSource::Type` or `PropSource::Copy`.
    Type(TypeId),
    /// `Prop::mapper`, with any other source.
    Mapper(MapperId),
    /// `Prop::mapper` of a mapped type's property whose key was stored separately
    /// (`Types::separate_key`). This mapper includes the key.
    MapperWithKey(MapperId),
}

impl PropInstantiation {
    /// Instantiates `prop`, the property it was computed for.
    pub(super) fn apply_to(self, prop: &mut Prop) {
        match (self, &mut prop.source) {
            (Self::Type(new), PropSource::Type(ty) | PropSource::Copy(ty, ..)) => *ty = new,
            (Self::Type(_), _) => {}
            (Self::Mapper(mapper), _) => prop.mapper = mapper,
            (Self::MapperWithKey(mapper), _) => {
                (prop.mapper, prop.name_type) = (mapper, TypeId::UNRESOLVED);
            }
        }
    }

    /// True if `apply_to(own)` and `other.apply_to(theirs)` would make `own` and `theirs` equal.
    /// They have the same name.
    pub(super) fn yields_same_prop_as(self, own: &Prop, other: Self, theirs: &Prop) -> bool {
        let name_type = |it: Self, source_prop: &Prop| match it {
            Self::MapperWithKey(_) => TypeId::UNRESOLVED,
            Self::Type(_) | Self::Mapper(_) => source_prop.name_type,
        };
        let mapper = |it: Self, source_prop: &Prop| match it {
            Self::Mapper(mapper) | Self::MapperWithKey(mapper) => mapper,
            Self::Type(_) => source_prop.mapper,
        };
        own.flags == theirs.flags
            && name_type(self, own) == name_type(other, theirs)
            && mapper(self, own) == mapper(other, theirs)
            && match (self, other) {
                (Self::Type(new), Self::Type(other_new)) => {
                    new == other_new
                        && match (&own.source, &theirs.source) {
                            (PropSource::Type(_), PropSource::Type(_)) => true,
                            (
                                PropSource::Copy(_, declared, has_value_declaration),
                                PropSource::Copy(_, other_declared, other_has_value_declaration),
                            ) => {
                                has_value_declaration == other_has_value_declaration
                                    && declared == other_declared
                            }
                            _ => false,
                        }
                }
                (Self::Type(_), _) | (_, Self::Type(_)) => false,
                _ => own.source == theirs.source,
            }
    }

    /// True if `apply_to(source)` would make `source` equal to `instantiated`, which has the same
    /// name.
    pub(super) fn makes(self, instantiated: &Prop, source: &Prop) -> bool {
        let name_type = match self {
            Self::MapperWithKey(_) => TypeId::UNRESOLVED,
            Self::Type(_) | Self::Mapper(_) => source.name_type,
        };
        instantiated.flags == source.flags
            && instantiated.name_type == name_type
            && match self {
                Self::Mapper(mapper) | Self::MapperWithKey(mapper) => {
                    instantiated.mapper == mapper && instantiated.source == source.source
                }
                Self::Type(new) => {
                    instantiated.mapper == source.mapper
                        && match (&instantiated.source, &source.source) {
                            (PropSource::Type(ty), PropSource::Type(_)) => *ty == new,
                            (
                                PropSource::Copy(ty, declared, has_value_declaration),
                                PropSource::Copy(
                                    _,
                                    declared_of_source,
                                    source_has_value_declaration,
                                ),
                            ) => {
                                *ty == new
                                    && has_value_declaration == source_has_value_declaration
                                    && declared == declared_of_source
                            }
                            _ => false,
                        }
                }
            }
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn mapper_from(&mut self, params: &[TypeId], args: &[TypeId]) -> MapperId {
        let pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            params.iter().copied().zip(args.iter().copied()).collect();
        self.types().mapper_of(&pairs)
    }

    /// Returns `mapper`'s pairs sorted by type parameter declaration, like `typeParameters` and
    /// `outerTypeParameters`. A mapper stores them in `arrival_order`, which depends on the
    /// schedule, so nothing observable may depend on the stored order. That includes evaluation
    /// order: a creation stamp is exact only if a transaction evaluates in the same order as
    /// sequential execution.
    pub(super) fn mapping_in_declaration_order(
        &self,
        mapper: MapperId,
    ) -> std::borrow::Cow<'p, [(TypeId, TypeId)]> {
        let declaration = |param: TypeId| match *self.data(param) {
            TypeData::TypeParam(file, tp, _) => (0u8, file.0, tp.0),
            _ => (1, 0, 0),
        };
        let stored = self.types().mapping(mapper);
        if stored.len() <= 1 || stored.is_sorted_by(|x, y| declaration(x.0) < declaration(y.0)) {
            return stored.into();
        }
        let mut pairs = stored.to_vec();
        // Clones of one declaration, and the `this` types of nested classes, share a key.
        pairs.sort_by(|x, y| {
            (declaration(x.0).cmp(&declaration(y.0))).then_with(|| self.content_order(x.0, y.0))
        });
        pairs.into()
    }

    /// Returns the mapper that applies `first`, then `second`. See `unresolved_members`.
    #[inline(always)]
    pub fn compose(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY {
            return second;
        }
        if second == MapperId::IDENTITY {
            return first;
        }
        self.compose_two(first, second)
    }

    /// `compose` of two mappers that aren't the identity.
    fn compose_two(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if let Some(cached_mapper) = self.recent_composed.get(first.0, second.0) {
            return MapperId(cached_mapper);
        }
        let spread = match self.p.composed.get_or_hash(&self.task, &(first, second)) {
            Ok(cached_mapper) => {
                self.recent_composed.put(first.0, second.0, cached_mapper.0);
                return cached_mapper;
            }
            Err(spread) => spread,
        };
        let scope = self.begin_scope();
        self.unresolved_members.push((second, scope.frames));
        let (hits, in_place) = (self.unresolved_members_hits, self.members_in_place_hits);
        let hit_at = self.members_in_place_hit_at;
        let lowest_below = std::mem::replace(&mut self.lowest_unresolved_members_hit, u32::MAX);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> = smallvec::SmallVec::new();
        for &(param, value) in self.mapping_in_declaration_order(first).iter() {
            pairs.push((param, self.instantiate(value, second)));
        }
        for &(param, value) in self.types().mapping(second) {
            if self.types().map(first, param).is_none() {
                pairs.push((param, value));
            }
        }
        let composed = self.types().mapper_of(&pairs);
        self.unresolved_members.pop();
        let lowest = std::mem::replace(&mut self.lowest_unresolved_members_hit, lowest_below);
        // `resolveObjectTypeMembers` installs the members with the base types it has instantiated,
        // regardless of which members were installed in the meantime. See `members_in_place_hits`.
        let marks = self.members_in_place_hits - in_place;
        let is_open = self.non_cacheable_mark() != (scope.counters.0 + marks, scope.counters.1);
        if !is_open
            && marks != 0
            && marks == self.unresolved_members_hits - hits
            && lowest as usize >= self.unresolved_members.len()
            && self.lowest_taint >= scope.frames as usize
        {
            // Only the members of this type reference were read unresolved. No caller has seen
            // the marks.
            (self.unresolved_members_hits, self.members_in_place_hits) = (hits, in_place);
            (self.cycles, self.members_in_place_hit_at) = (scope.counters.0, hit_at);
            self.lowest_taint = usize::MAX;
        } else {
            self.lowest_unresolved_members_hit = lowest_below.min(lowest);
        }
        match self.end_scope_as(scope, is_open) {
            Ok(stored) => {
                let key = (first, second);
                let stored_mapper =
                    (self.p.composed).insert_absent(&self.task, spread, key, composed, stored);
                // Same rule as for `recent_instantiations`.
                if first.is_local() || second.is_local() || !stored_mapper.is_local() {
                    self.recent_composed.put(first.0, second.0, stored_mapper.0);
                }
                stored_mapper
            }
            Err(_) => composed,
        }
    }

    /// Applies `first`, then `second`, but only for the parameters `first` maps.
    pub fn map_mapper(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY || second == MapperId::IDENTITY {
            return first;
        }
        let mapping = self.mapping_in_declaration_order(first);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            smallvec::SmallVec::with_capacity(mapping.len());
        let mut changed = false;
        for &(param, value) in mapping.iter() {
            let new = if value == param {
                self.types().map(second, param).unwrap_or(param)
            } else {
                self.instantiate(value, second)
            };
            changed |= new != value;
            pairs.push((param, new));
        }
        if !changed {
            return first;
        }
        self.types().mapper_of(&pairs)
    }

    /// Runs `worker` inside `instantiateTypeWithAlias`'s bookkeeping. `worker` instantiates with
    /// `mapper` and neither reads nor writes `Program::instantiations`.
    pub(super) fn in_instantiation(
        &mut self,
        mapper: MapperId,
        worker: impl FnOnce(&mut Self) -> TypeId,
    ) -> TypeId {
        if (self.instantiation_depth >= 100 || self.instantiation_count >= 5_000_000)
            && !self.reset_instantiation_count_if_idle()
        {
            return self.instantiation_too_deep();
        }
        let is_active = self.active_mappers.is_active(mapper);
        self.instantiation_count += 1;
        self.instantiation_depth += 1;
        if !is_active {
            self.active_mappers.push(mapper);
        }
        self.instantiations_computed += 1;
        let result = worker(self);
        if !is_active {
            self.active_mappers.pop();
        }
        self.instantiation_depth -= 1;
        result
    }

    /// `instantiateType(baseType, mapper)` in `resolveObjectTypeMembers` of a tuple with the
    /// elements `flags`, and `instantiateIndexInfos` for the members of the result. Here `Array`'s
    /// members are instantiated lazily, so nothing is created. This only counts the calls, and
    /// fails where the innermost of them would.
    pub(super) fn count_instantiation_of_tuple_base_type(&mut self, flags: &[ElemFlags]) {
        // `getTupleBaseType`: a variadic element `T` is `T[number]`.
        let is_variadic = |flag: &&ElemFlags| flag.contains(ElemFlags::VARIADIC);
        let (elements, variadic) = (
            flags.len() as u32,
            flags.iter().filter(is_variadic).count() as u32,
        );
        // `Array<..>`, the union if there is more than one element, the elements, and the type
        // parameters in `T[number]`.
        let (levels, calls) = match elements {
            0 => (0, 0),
            1 => (1, 2),
            _ => (2, 2 + elements),
        };
        let levels = levels + u32::from(variadic != 0);
        if (self.instantiation_depth + levels >= 100 || self.instantiation_count >= 5_000_000)
            && !self.reset_instantiation_count_if_idle()
        {
            self.instantiation_too_deep();
        }
        self.instantiation_count = (self.instantiation_count).saturating_add(calls + variadic + 1);
    }

    pub fn instantiate_all(&mut self, types: &[TypeId], mapper: MapperId) -> SmallVec<[TypeId; 8]> {
        types.iter().map(|&t| self.instantiate(t, mapper)).collect()
    }

    /// `instantiate_all`, returning a list that can be stored.
    pub(super) fn instantiate_list(
        &mut self,
        types: &[TypeId],
        mapper: MapperId,
    ) -> ArenaBox<'s, [TypeId]> {
        let arena = self.arena;
        ArenaBox::from_iter_in(types.iter().map(|&t| self.instantiate(t, mapper)), arena)
    }

    /// `getInstantiatedSymbol`
    pub(super) fn instantiate_prop(&mut self, prop: &mut Prop, mapper: MapperId) {
        self.instantiation_of_prop(prop, mapper).apply_to(prop);
    }

    /// Returns what `instantiate_prop` would change in `prop`.
    pub(super) fn instantiation_of_prop(
        &mut self,
        prop: &Prop,
        mapper: MapperId,
    ) -> PropInstantiation {
        match &prop.source {
            PropSource::Type(ty) | PropSource::Copy(ty, ..) => {
                PropInstantiation::Type(self.instantiate(*ty, mapper))
            }
            // FOR SPEED: a mapped type's property keeps its mapper if that maps only to types
            // without type variables. Its type is the template under that mapper, which has an
            // entry for every type parameter the template mentions, so there's nothing left for
            // `mapper` to replace. An interface that extends `Omit<..>` has hundreds of these, each
            // with its own mapper, and every intersection that contains the interface maps its
            // `this` again.
            PropSource::Mapped(..)
                if mapper != MapperId::IDENTITY
                    && self.maps_to_closed_types(prop.mapper)
                    && (self.types().separate_key(prop))
                        .is_none_or(|key| self.is_closed_type(key)) =>
            {
                PropInstantiation::Mapper(prop.mapper)
            }
            PropSource::Mapped(..)
                if mapper != MapperId::IDENTITY && self.types().separate_key(prop).is_some() =>
            {
                let with_key = self.mapper_of_prop(prop);
                let composed = self.compose(with_key, mapper);
                match composed == with_key {
                    true => PropInstantiation::Mapper(prop.mapper),
                    false => PropInstantiation::MapperWithKey(composed),
                }
            }
            _ => PropInstantiation::Mapper(self.compose(prop.mapper, mapper)),
        }
    }

    /// True if no mapper changes `ty`.
    #[inline]
    fn is_closed_type(&self, ty: TypeId) -> bool {
        self.types().instantiation_class(ty) == InstantiationClass::Unchanged
    }

    /// True if no mapper changes any of the types that `mapper` maps to.
    fn maps_to_closed_types(&self, mapper: MapperId) -> bool {
        let types = self.types();
        let is_closed = |pair: &(TypeId, TypeId)| {
            types.instantiation_class(pair.1) == InstantiationClass::Unchanged
        };
        types.mapping(mapper).iter().all(is_closed)
    }

    /// `instantiateType(t, c.restrictiveMapper)` and `instantiateType(t, c.permissiveMapper)`, with
    /// `map` as the mapper. A deferred type records the mapping of each of its outer type
    /// parameters, so a mapper reaches the type parameters `any_type_in` finds and no others.
    /// `getObjectTypeInstantiation` maps the outer type parameters, so those declared by a
    /// signature in `t` are left as they are. tsgo makes the call once per `t`. `may_cache` is
    /// called after `map` was used, and returns whether `map` will return the same results from now
    /// on.
    fn instantiate_type_parameters(
        &mut self,
        t: TypeId,
        fixed: FixedMapper,
        map: fn(&Self, TypeId) -> TypeId,
        may_cache: fn(&Self) -> bool,
    ) -> TypeId {
        if self.flags(t) & (tf::PRIMITIVE | tf::ANY | tf::UNKNOWN | tf::NEVER) != 0 {
            return t;
        }

        if let Some(cached_type) = self.cached_with_fixed_mapper(fixed, t) {
            return cached_type;
        }
        let forgotten = self.links.restrictive_resets();
        let ((instantiated, _), stored) = self.derive_settled(
            |c| c.derive_instantiation_of_type_parameters(t, map),
            |c, &(_, mapper)| {
                c.is_mapper_idle(mapper)
                    && may_cache(c)
                    && c.links.restrictive_resets() == forgotten
            },
        );
        if let Some(stored) = stored {
            self.cache_with_fixed_mapper(fixed, t, instantiated, stored);
        }
        instantiated
    }

    /// Also returns the mapper.
    fn derive_instantiation_of_type_parameters(
        &mut self,
        t: TypeId,
        map: fn(&Self, TypeId) -> TypeId,
    ) -> (TypeId, MapperId) {
        let (mut pairs, mut own) = (Vec::new(), Vec::new());
        self.any_type_in(t, true, |part| {
            if self.flags(part) & tf::TYPE_PARAMETER != 0 {
                pairs.push((part, map(self, part)));
            } else if let TypeData::Synth(shape) = self.data(part) {
                for &sig in shape.call.iter().chain(&shape.construct) {
                    if let SigData::Synth { type_params, .. } = self.types().sig(sig) {
                        own.extend_from_slice(type_params);
                    }
                }
            }
            false
        });
        pairs.retain(|pair| pair.0 != pair.1 && !own.contains(&pair.0));
        let mapper = self.types().mapper(pairs);
        (self.instantiate(t, mapper), mapper)
    }

    /// `getRestrictiveInstantiation`, with `getRestrictiveTypeParameter`. Restrictive type
    /// parameters map to themselves, so the restrictive instantiation of a restrictive instantiation is itself.
    pub(super) fn restrictive_instantiation(&mut self, t: TypeId) -> TypeId {
        if !self.pinned_restrictive_instantiations.is_empty()
            && let Some(&pinned) = self.pinned_restrictive_instantiations.get(&t)
        {
            return pinned;
        }
        let outer_flag = self.left_a_renamed_param_unchanged.replace(false);
        let map: fn(&Self, TypeId) -> TypeId = |c, param| match c.data(param) {
            // `tp.constraint == nil && getConstraintDeclaration(tp) == nil`
            TypeData::TypeParam(..) if c.unresolved_renamed_params.contains(&param) => {
                c.left_a_renamed_param_unchanged.set(true);
                param
            }
            TypeData::Marker(
                Marker::Super | Marker::Other | Marker::SuperForCheck | Marker::Restrictive(_),
            ) => param,
            // `getConstraintDeclaration(tp) == nil`
            // A clone may have been assigned a constraint (`tp.constraint == nil`):
            // `syntheticParam` of `reportErrorResults`.
            TypeData::TypeParam(file, tp, MapperId::IDENTITY)
                if c.hir(*file)[*tp].constraint.is_none() =>
            {
                param
            }
            _ => c.intern(TypeData::Marker(Marker::Restrictive(param))),
        };
        // A result with such a type parameter goes in `pinned_restrictive_instantiations`, for as
        // long as it's valid.
        let result = self.instantiate_type_parameters(t, FixedMapper::Restrictive, map, |c| {
            !c.left_a_renamed_param_unchanged.get()
        });
        // Only `getConstraintOfDistributiveConditionalType` reads this set.
        if matches!(self.data(result), TypeData::Cond { .. }) {
            self.restrictive_instantiations.insert(result);
        }
        if self.left_a_renamed_param_unchanged.replace(outer_flag) {
            self.pinned_restrictive_instantiations.insert(t, result);
            self.pinned_restrictive_instantiations
                .insert(result, result);
        }
        result
    }

    /// `getPermissiveInstantiation`
    pub(super) fn permissive_instantiation(&mut self, t: TypeId) -> TypeId {
        let map: fn(&Self, TypeId) -> TypeId = |_, _| TypeId::WILDCARD;
        self.instantiate_type_parameters(t, FixedMapper::Permissive, map, |_| true)
    }

    /// `instantiateType(t, c.uniqueLiteralMapper)`
    pub(super) fn unique_literal_filled_instantiation(&mut self, t: TypeId) -> TypeId {
        let map: fn(&Self, TypeId) -> TypeId = |_, _| TypeId::UNIQUE_LITERAL;
        self.instantiate_type_parameters(t, FixedMapper::UniqueLiteral, map, |_| true)
    }

    pub(super) fn is_assignable_restrictive(&mut self, source: TypeId, target: TypeId) -> bool {
        let (source, target) = (
            self.restrictive_instantiation(source),
            self.restrictive_instantiation(target),
        );
        self.is_assignable(source, target)
    }

    pub(super) fn is_assignable_permissive(&mut self, source: TypeId, target: TypeId) -> bool {
        let (source, target) = (
            self.permissive_instantiation(source),
            self.permissive_instantiation(target),
        );
        self.is_assignable(source, target)
    }

    /// `instantiateTypeWithAlias`
    pub fn instantiate(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        self.instantiate_as::<false>(ty, mapper)
    }

    /// Same as `instantiate`, but caches the result in `Program::instantiations` if it's slow to compute again. Use it
    /// where tsgo caches the result permanently: the type of an instantiated symbol (`links.resolvedType`) and a type
    /// alias instantiation (`links.instantiations`). A program can re-read more of these than `recent_instantiations`
    /// holds, and from other files, which another checker may check.
    fn instantiate_and_cache(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        self.instantiate_as::<true>(ty, mapper)
    }

    #[inline(always)]
    fn instantiate_as<const IS_CACHED_BY_TSGO: bool>(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
    ) -> TypeId {
        if mapper == MapperId::IDENTITY {
            return ty;
        }
        let class = self.types().instantiation_class(ty);
        if class == InstantiationClass::Unchanged {
            return ty;
        }
        // This comes before any cache, because at the limit tsgo fails every instantiation, even a
        // type parameter's.
        if self.instantiation_depth >= 100 || self.instantiation_count >= 5_000_000 {
            cold_path();
            if !self.reset_instantiation_count_if_idle() {
                return self.instantiation_too_deep();
            }
        }
        let active = self.active_mappers.find(mapper);
        if class == InstantiationClass::TypeParameter {
            match active.map(|at| &mut self.active_mappers.activations[at].params) {
                Some(seen) if seen.contains(&ty) => {}
                Some(seen) => {
                    seen.push(ty);
                    self.instantiation_count += 1;
                }
                None => self.instantiation_count += 1,
            }
            return self.types().map(mapper, ty).unwrap_or(ty);
        }
        let serial = active.map_or(0, |at| self.active_mappers.activations[at].serial);
        if self.index_infos_in_instantiation.is_empty()
            && let Some((known, tag)) = self.recent_instantiations.get_tagged(ty.0, mapper.0)
        {
            if serial == 0 || *tag != serial {
                *tag = serial;
                self.instantiation_count += 1;
            }
            return TypeId(known);
        }
        self.instantiation_count += 1;
        self.instantiate_cached(ty, mapper, serial, IS_CACHED_BY_TSGO)
    }

    /// `instantiate` of the type parameter `param` with a mapper that tsgo creates for this one call, so it isn't an
    /// active mapper. `target` is the type it maps `param` to, if any. No mapper is created here.
    pub(super) fn instantiate_type_parameter_once(
        &mut self,
        param: TypeId,
        target: Option<TypeId>,
    ) -> TypeId {
        if (self.instantiation_depth >= 100 || self.instantiation_count >= 5_000_000)
            && !self.reset_instantiation_count_if_idle()
        {
            return self.instantiation_too_deep();
        }
        self.instantiation_count += 1;
        target.unwrap_or(param)
    }

    /// Returns `instantiate(ty, mapper)` if nothing has to be computed for it.
    pub(super) fn instantiation_if_known(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
    ) -> Option<TypeId> {
        if mapper == MapperId::IDENTITY {
            return Some(ty);
        }
        match self.types().instantiation_class(ty) {
            InstantiationClass::Unchanged => Some(ty),
            InstantiationClass::TypeParameter => Some(self.types().map(mapper, ty).unwrap_or(ty)),
            _ if !self.index_infos_in_instantiation.is_empty() => None,
            _ => match self.recent_instantiations.get_tagged(ty.0, mapper.0) {
                Some((known, _)) => Some(TypeId(known)),
                None => self.p.instantiations.get(&self.task, &(ty, mapper)),
            },
        }
    }

    /// `getTypeOfInstantiatedSymbol`. `links.resolvedType` caches the result, so only the first
    /// request for a symbol's type reaches `instantiateType`, adds to `instantiationCount` and can
    /// fail at a limit. There's no symbol here, so a cached result is treated as a symbol whose
    /// type is already resolved.
    pub(super) fn type_of_instantiated_symbol(
        &mut self,
        declared: TypeId,
        mapper: MapperId,
    ) -> TypeId {
        if self.index_infos_in_instantiation.is_empty()
            && let Some((known, _)) = self.recent_instantiations.get_tagged(declared.0, mapper.0)
        {
            return TypeId(known);
        }
        let (count, computed) = (self.instantiation_count, self.instantiations_computed);
        let ty = self.instantiate_and_cache(declared, mapper);
        if self.instantiations_computed == computed && self.instantiation_count < 5_000_000 {
            self.instantiation_count = count;
        }
        ty
    }

    /// Returns `links.resolvedType` of the symbol that `instantiateSymbol` creates from `sym` for `prop`, if
    /// `assign_resolved_type_of_instantiated_symbol` has stored one.
    pub(super) fn link_of_instantiated_symbol(
        &mut self,
        prop: &Prop,
        sym: Sym,
        outer: MapperId,
    ) -> Option<TypeId> {
        if !self.instantiated_symbol_links.contains_key(&sym) {
            return None;
        }
        let mapper = self.compose(prop.mapper, outer);
        let links = self.instantiated_symbol_links.get(&sym)?;
        links
            .iter()
            .find(|link| link.0 == mapper)
            .map(|link| link.1)
    }

    /// The assignment in `getTypeOfInstantiatedSymbol`, after a `getTypeOfSymbol(links.target)`
    /// that made a query. When `pushTypeResolution` fails, `getTypeOfAccessors` returns `errorType`
    /// without assigning it.
    #[inline(never)]
    pub(super) fn assign_resolved_type_of_instantiated_symbol(
        &mut self,
        prop: &Prop,
        sym: Sym,
        outer: MapperId,
        target_type: TypeId,
    ) {
        let is_unassigned = self.found_cycle
            && self.is_resolving(Query::Symbol(sym))
            && self.p.symbol_types.get(&self.task, &sym).is_none();
        if !is_unassigned && !self.instantiated_symbol_links.contains_key(&sym) {
            return;
        }
        if prop.flags.contains(PropFlags::THISLESS) {
            return;
        }
        let mapper = self.compose(prop.mapper, outer);
        if mapper == MapperId::IDENTITY || self.is_thisless_for_this_mapper(sym) {
            return;
        }
        // If `sym`'s type is assigned, the link is just its instantiation, so drop whatever a
        // nested request stored.
        let resolved_type = match is_unassigned {
            true => Some(self.instantiate(target_type, mapper)),
            false => None,
        };
        let links = self.instantiated_symbol_links.entry(sym).or_default();
        links.retain(|link| link.0 != mapper);
        links.extend(resolved_type.map(|ty| (mapper, ty)));
        if links.is_empty() {
            self.instantiated_symbol_links.remove(&sym);
        }
    }

    /// `getTypeAliasInstantiation` without an alias. `declared` is the symbol's declared type.
    /// `links.instantiations` is read no matter what's in progress.
    pub(super) fn type_alias_instantiation(
        &mut self,
        declared: TypeId,
        mapper: MapperId,
    ) -> TypeId {
        if !self.index_infos_in_instantiation.is_empty()
            && let Some(known) = self.p.instantiations.get(&self.task, &(declared, mapper))
        {
            return known;
        }
        self.instantiate_and_cache(declared, mapper)
    }

    /// `instantiate` for a type that mentions type parameters, isn't one itself and isn't in the
    /// cache of recent results. `serial` is the serial of `mapper`'s activation, or 0 if it isn't
    /// active.
    #[inline(never)]
    fn instantiate_cached(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        serial: u32,
        is_cached_by_tsgo: bool,
    ) -> TypeId {
        let mut absent = None;
        let skips_table = self.skips_instantiations_table(ty, is_cached_by_tsgo);
        if let Some(innermost) = self.index_infos_in_instantiation.last() {
            if let Some(&(known, is_marked)) = innermost.instantiations.get(&(ty, mapper)) {
                // A cache hit records the same marks as recomputing it would.
                if is_marked {
                    self.note_no_members_in_place();
                }
                return known;
            }
        } else if !skips_table {
            match self.p.instantiations.get_or_hash(&self.task, &(ty, mapper)) {
                Ok(known) => {
                    self.recent_instantiations
                        .put_tagged(ty.0, mapper.0, known.0, serial);
                    return known;
                }
                Err(spread) => absent = Some(spread),
            }
        }
        if self.instantiation_limit_hits != 0
            && let Some(&(under, known, is_tainted)) =
                self.instantiations_up_to_a_limit.get(&(ty, mapper))
            && (under == 0 || under == serial)
        {
            // A cache hit records the same marks as recomputing it would.
            self.instantiation_limit_hits += 1;
            if is_tainted {
                self.note_limit();
                self.mark_tainted_from(0);
            }
            return known;
        }
        let (hits_before, limits_before) = (self.instantiation_limit_hits, self.limits);
        let in_place_before = self.members_in_place_hits;
        if self.instantiation_depth == 0 && self.stack.is_empty() {
            self.reset_instantiation_count_if_idle();
        }
        self.instantiation_depth += 1;
        if serial == 0 {
            self.active_mappers.push(mapper);
        }
        let cycles_before = self.cycles;
        let scope = self.begin_scope();

        self.instantiations_computed += 1;
        // See `instantiations_in_progress`. A call that stores nothing in the table doesn't need to be listed.
        let is_listed = !skips_table && self.task.writes_immediately();
        let is_inner = is_listed && self.instantiations_in_progress.contains(&(ty, mapper));
        if is_listed {
            self.instantiations_in_progress.push((ty, mapper));
        }
        let result = self.instantiate_uncached(ty, mapper);
        let result = self.with_new_alias(ty, mapper, result, None);
        if is_listed {
            self.instantiations_in_progress.pop();
        }
        if serial == 0 {
            self.active_mappers.pop();
        }
        self.instantiation_depth -= 1;
        // tsgo's only instantiation cache is the active mappers' one. So a result that contains the
        // limit's error type is recomputed by a caller that has more depth left.
        let hit_the_limit = self.instantiation_limit_hits != hits_before;
        // See `IndexInfosInInstantiation::instantiations`. Until the index signatures are
        // instantiated, the results are cached only there.
        let marks = self.members_in_place_hits - in_place_before;
        if !hit_the_limit
            && self.non_cacheable_mark() == (scope.counters.0 + marks, scope.counters.1)
            && let Some(innermost) = self.index_infos_in_instantiation.last_mut()
        {
            let cache_entry = (result, marks != 0);
            innermost.instantiations.insert((ty, mapper), cache_entry);
        }
        match self.end_scope_by_counters(scope) {
            Ok(stored) if !hit_the_limit && self.index_infos_in_instantiation.is_empty() => {
                // `data.instantiations[key] = result`. When two instantiations with the same key
                // nest, the outer one assigns last.
                let (table, key) = (&self.p.instantiations, (ty, mapper));
                let stored = match is_inner {
                    true => stored.held_back(),
                    false => stored,
                };
                match absent {
                    _ if skips_table => {}
                    Some(spread) => table.rewrite_absent(&self.task, spread, key, result, stored),
                    None => table.rewrite(&self.task, key, result, stored),
                }
                // The table stores nothing task-local under a shared key.
                if ty.is_local() || mapper.is_local() || !result.is_local() {
                    self.recent_instantiations
                        .put_tagged(ty.0, mapper.0, result.0, serial);
                }
                result
            }
            _ => {
                let is_tainted = self.limits != limits_before;
                // `getObjectTypeInstantiation`, `getConditionalTypeInstantiation` and
                // `getTypeAliasInstantiation` store a result that contains the limit's error type
                // like any other, at any depth, so the next caller doesn't reach the limit and 2589
                // is reported once. `type A = [F<X>]; type B = F<X>;` meet at the object type in
                // `F`, not at `F<X>`, whose key has the alias `B`. The entry is valid until the end
                // of the file, because no activation has the serial number 0.
                let has_instantiations = self.instantiation_depth == 0
                    || matches!(self.data(ty), TypeData::Anon { .. } | TypeData::Cond { .. })
                    || self.types().deferred(ty).is_some();
                let is_stored =
                    has_instantiations && self.instantiation_count < 5_000_000 && !is_tainted;
                // Otherwise `cache[key] = result`, which `popActiveMapper` clears.
                if self.cycles == cycles_before && hit_the_limit && (is_stored || serial != 0) {
                    let under = if is_stored { 0 } else { serial };
                    self.instantiations_up_to_a_limit
                        .insert((ty, mapper), (under, result, is_tainted));
                }
                result
            }
        }
    }

    /// Returns true if instantiations of `ty` skip `Program::instantiations`.
    ///
    /// - A reference, object type, function type or conditional type always skips it. Instantiating one maps its type
    ///   arguments and looks up the type that has them, as `getObjectTypeInstantiation` and
    ///   `getConditionalTypeInstantiation` do. A second cache in front of that lookup costs more than it saves.
    /// - A union never skips it: rebuilding one is slow and the same unions are requested often. A synthesized object
    ///   type is copied, so it doesn't skip it either.
    /// - Anything else skips it unless `is_cached_by_tsgo`: see `instantiate_and_cache`.
    #[inline]
    fn skips_instantiations_table(&self, ty: TypeId, is_cached_by_tsgo: bool) -> bool {
        match self.data(ty) {
            TypeData::Ref { .. } | TypeData::Fns { .. } | TypeData::Cond { .. } => true,
            TypeData::Anon { origin, .. } if !matches!(origin, Origin::Mapped(..)) => true,
            TypeData::Union(_) | TypeData::Synth(_) | TypeData::ReverseMapped { .. } => false,
            _ => !is_cached_by_tsgo,
        }
    }

    /// True if `getOuterTypeParameters` of the object literal that `literal_prop` is a property of
    /// returns only type parameters declared in its enclosing declarations. A context sensitive
    /// function adds those of its contextual signature (`assignContextualParameterTypes`).
    fn has_only_declared_outer_type_params(&self, file: FileId, literal_prop: PropId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let literal = bound.prop_owner[literal_prop.idx()];
        if literal.is_none() || !matches!(hir[literal].kind, ExprKind::Object(_)) {
            return false;
        }
        let mut scope = self.enclosing_scope_of_expr(file, literal);
        while scope.is_some() {
            let enclosing = &bound.scopes[scope.idx()];
            if let crate::bind::ScopeKind::Fn(func) = enclosing.kind
                && let crate::bind::FnOwner::Expr(owner) = bound.fns[func.idx()].owner
                && self.is_context_sensitive(file, owner)
            {
                return false;
            }
            scope = enclosing.parent;
        }
        true
    }

    /// `getObjectTypeInstantiation` for a deferred type reference: only the mapping of the type
    /// parameters enclosing the node changes. `alias` is the alias passed in, or else
    /// `instantiateTypeAlias(t.alias, m)`.
    pub(super) fn instantiate_deferred_type_reference(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let Some(deferred) = self.types().deferred(ty) else {
            return ty;
        };
        let (file, node) = (deferred.file, deferred.node);
        let new = self.map_mapper(deferred.mapper, mapper);
        let arguments = TypeArguments::deferred_in(file, node, new, self.arena);
        let reference = match self.data(ty) {
            TypeData::Ref { target, .. } => TypeData::Ref {
                target: *target,
                args: arguments,
            },
            TypeData::Tuple {
                flags, readonly, ..
            } => TypeData::Tuple {
                elems: arguments,
                flags: flags.clone_in(self.arena),
                readonly: *readonly,
            },
            _ => return ty,
        };
        let instantiated;
        let alias = match (alias, self.stored_alias(ty)) {
            (None, Some((symbol, type_arguments))) => {
                instantiated = self.instantiate_all(type_arguments, mapper);
                Some((*symbol, &instantiated[..]))
            }
            _ => alias,
        };
        self.deferred_type_reference(reference, alias)
    }

    fn instantiate_uncached(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        if self.types().deferred(ty).is_some() {
            return self.instantiate_deferred_type_reference(ty, mapper, None);
        }
        match self.data(ty) {
            // `instantiateTypeWorker`: an unchanged type is returned as is, unreduced if it was.
            TypeData::Union(_) | TypeData::Intersection(_) => {
                self.instantiate_union_or_intersection(ty, mapper, None)
            }
            TypeData::Ref { target, .. } => {
                let resolved_type_arguments = self.type_arguments(ty);
                let args: SmallVec<[TypeId; 8]> = (resolved_type_arguments.iter())
                    .map(|&t| self.instantiate(t, mapper))
                    .collect();
                if args[..] == *resolved_type_arguments {
                    return ty;
                }
                self.intern_key(TypeKey::Ref {
                    target: *target,
                    args: &args,
                })
            }
            TypeData::Tuple {
                flags, readonly, ..
            } => {
                let resolved_type_arguments = self.type_arguments(ty);
                let elems = self.instantiate_all(resolved_type_arguments, mapper);
                if elems[..] == *resolved_type_arguments {
                    return ty;
                }
                self.normalized_tuple(&elems, flags, *readonly)
            }
            TypeData::Anon {
                origin,
                mapper: own,
            } => {
                let new = self.map_mapper(*own, mapper);
                // A declared type has no mapper in tsgo. Here it has one of identity pairs.
                let is_under_its_own_key = (self.types().provenance(ty))
                    .is_none_or(|provenance| provenance.stored_under.is_none());
                if new == *own && (is_under_its_own_key || !self.is_instantiating(mapper)) {
                    return ty;
                }
                if let Origin::Mapped(file, node) = *origin {
                    // `newAlias`: `instantiateTypeAlias(t.alias, m)`
                    let instantiated_alias =
                        self.stored_alias(ty).map(|(alias, type_arguments)| {
                            (*alias, self.instantiate_all(type_arguments, mapper))
                        });
                    let alias = match &instantiated_alias {
                        Some((alias, type_arguments)) => NewAlias::Given(*alias, type_arguments),
                        None => NewAlias::OfNode,
                    };
                    return self.instantiate_mapped_type(file, node, new, alias);
                }
                self.intern(TypeData::Anon {
                    origin: *origin,
                    mapper: new,
                })
            }
            TypeData::Fns { decls, mapper: own } => {
                let new = self.map_mapper(*own, mapper);
                self.intern_key(TypeKey::Fns { decls, mapper: new })
            }
            TypeData::Synth(shape) => {
                // `getObjectTypeInstantiation`: `newMapper` maps `links.outerTypeParameters`, and
                // `instantiateAnonymousType` instantiates the members of `target` with it, whatever
                // else they mention. If it maps them to what they're already mapped to, the type is
                // its own instantiation. See `Shape::mapper`.
                let (mut shape, mut mapper, mut target) = (shape, mapper, None);
                if shape.instantiation_expression.is_some() || shape.mapper != MapperId::IDENTITY {
                    let new_mapper = self.map_mapper(shape.mapper, mapper);
                    if new_mapper == shape.mapper {
                        return ty;
                    }
                    let created = shape.instantiation_target.unwrap_or(ty);
                    if let TypeData::Synth(as_created) = self.data(created) {
                        if new_mapper == as_created.mapper {
                            return created;
                        }
                        (shape, mapper, target) = (as_created, new_mapper, Some(created));
                    }
                }
                let scope = self.begin_scope();
                let mut new = Shape {
                    literal: shape.literal,
                    is_regular: shape.is_regular,
                    contains_widening_type: shape.contains_widening_type,
                    ..Shape::new_in(self.arena)
                };
                for p in &shape.props {
                    let mut p = p.clone_in(self.arena);
                    match p.source {
                        // `getObjectTypeInstantiation` maps the literal's outer type parameters and
                        // nothing else. `p.mapper` has an entry for each of them.
                        PropSource::Literal(file, literal_prop)
                            if self.has_only_declared_outer_type_params(file, literal_prop) =>
                        {
                            p.mapper = self.map_mapper(p.mapper, mapper)
                        }
                        _ => self.instantiate_prop(&mut p, mapper),
                    }
                    new.props.push(p);
                }
                for i in &shape.index {
                    new.index.push(IndexInfo {
                        key: self.instantiate(i.key, mapper),
                        value: self.instantiate(i.value, mapper),
                        ..*i
                    });
                }
                new.call.reserve_exact(shape.call.len());
                new.call
                    .extend(shape.call.iter().map(|&s| self.instantiate_sig(s, mapper)));
                new.construct.reserve_exact(shape.construct.len());
                (new.construct).extend(
                    shape
                        .construct
                        .iter()
                        .map(|&s| self.instantiate_sig(s, mapper)),
                );
                new.symbol_declared_at = shape.symbol_declared_at;
                new.symbol = shape.symbol;
                new.spread_rank = shape.spread_rank;
                new.created_from = shape.created_from.map(|(left, right)| {
                    (
                        self.instantiate(left, mapper),
                        self.instantiate(right, mapper),
                    )
                });
                // `instantiateAnonymousType`
                new.instantiation_expression = shape.instantiation_expression;
                new.instantiation_target = target;
                new.is_js_literal = shape.is_js_literal;
                new.is_object_rest_type = shape.is_object_rest_type;
                new.mapper = self.map_mapper(shape.mapper, mapper);
                let stored = self.end_scope_by_counters(scope);
                if let Some(arguments) = shape.single_signature_arguments {
                    // `new` has no arguments, so it never equals `shape`.
                    let is_unchanged = new.call == shape.call && new.construct == shape.construct;
                    let instantiated = if is_unchanged { ty } else { self.synth(new) };
                    return self.single_signature_instantiation(
                        ty,
                        arguments,
                        mapper,
                        instantiated,
                        stored,
                    );
                }
                self.synth(new)
            }
            TypeData::Cond {
                file,
                node,
                mapper: own,
                ..
            } => {
                // A declared type has no mapper in tsgo. Here it has one of identity pairs.
                if self.types().mapping(mapper).iter().all(|p| p.0 == p.1) {
                    return ty;
                }
                let new = self.map_mapper(*own, mapper);
                self.conditional_type(*file, *node, new)
            }
            // `instantiateReverseMappedType`
            TypeData::ReverseMapped { source, mapped, of } => {
                let (source, mapped, of) = (*source, *mapped, *of);
                let mapped = self.instantiate(mapped, mapper);
                if self.mapped_origin(mapped).is_none() {
                    return ty;
                }
                let of = self.instantiate(of, mapper);
                let keys = self.keyof(of);
                let TypeData::Keyof(of) = *self.data(keys) else {
                    return ty;
                };
                let source = self.instantiate(source, mapper);
                self.reverse_mapped_type(source, mapped, of).unwrap_or(ty)
            }
            TypeData::IndexedAccess { .. } => self.instantiate_indexed_access(ty, mapper, None),
            TypeData::Keyof(t) => {
                let t = self.instantiate(*t, mapper);
                self.keyof(t)
            }
            &TypeData::Substitution { base, constraint } => {
                // A declared type has no mapper in tsgo. Here it has one of identity pairs.
                if self.types().mapping(mapper).iter().all(|p| p.0 == p.1) {
                    return ty;
                }
                let base = self.instantiate(base, mapper);
                if constraint == TypeId::UNKNOWN {
                    return self.no_infer(base);
                }
                let constraint = self.instantiate(constraint, mapper);
                // It can be resolved to the base type in the same cases as the conditional type
                // resolves to its true branch.
                let is_variable = self.is_type_variable(base);
                if is_variable && self.is_generic(constraint) {
                    return self.substitution_type(base, constraint);
                }
                if self.is_any(constraint)
                    || constraint == TypeId::UNKNOWN
                    || self.is_assignable_restrictive(base, constraint)
                {
                    return base;
                }
                if is_variable {
                    return self.substitution_type(base, constraint);
                }
                self.intersection(&[constraint, base])
            }
            TypeData::Template { texts, types } => {
                let types = self.instantiate_all(types, mapper);
                self.template_type(texts, &types)
            }
            TypeData::StringMapping { kind, ty } => {
                let ty = self.instantiate(*ty, mapper);
                self.string_mapping(*kind, ty)
            }
            _ => ty,
        }
    }

    /// The variadic element part of `createNormalizedTupleType`: `...T` is expanded wherever `T` is
    /// known. `tuple` does the rest.
    pub fn normalized_tuple(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> TypeId {
        self.normalized_tuple_as(elems, flags, readonly, FirstRequest::NONE)
    }

    /// `normalized_tuple`. `first_request` applies to the result if it's a single tuple or array,
    /// see `Types::as_first_request`.
    pub(super) fn normalized_tuple_as(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
        first_request: FirstRequest,
    ) -> TypeId {
        if !flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) {
            return self.tuple_as(elems, flags, readonly, first_request);
        }
        let is_spread = |i: usize| flags[i].contains(ElemFlags::VARIADIC);
        // `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`, and `[A, ...never]` is `never`.
        if let Some(i) = (0..elems.len())
            .find(|&i| is_spread(i) && (elems[i].is_never() || self.is_union(elems[i])))
        {
            // A type that's too complex to represent is treated as an array.
            let spread: Vec<TypeId> = (0..elems.len())
                .filter(|&j| is_spread(j))
                .map(|j| elems[j])
                .collect();
            if self.check_cross_product_union(&spread) {
                let mut with = elems.to_vec();
                return self.map_type(elems[i], |c, member| {
                    with[i] = member;
                    c.normalized_tuple(&with, flags, readonly)
                });
            }
        }
        // `TupleNormalizer.normalize`
        let mut out_elems = Vec::with_capacity(elems.len());
        let mut out_flags = Vec::with_capacity(elems.len());
        for (&elem, &flag) in elems.iter().zip(flags) {
            if !flag.contains(ElemFlags::VARIADIC) {
                out_elems.push(elem);
                out_flags.push(flag);
                continue;
            }
            if self.is_any(elem) {
                out_elems.push(elem);
                out_flags.push(ElemFlags::REST.with_label(flag.labeled_declaration()));
                continue;
            }
            // A generic element is left as is: `TypeFlagsInstantiableNonPrimitive`,
            // `isGenericMappedType`.
            let stays_variadic = match self.data(elem) {
                TypeData::TypeParam(..)
                | TypeData::ThisParam(_)
                | TypeData::Marker(_)
                | TypeData::IndexedAccess { .. }
                | TypeData::Cond { .. }
                | TypeData::Substitution { .. } => true,
                TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                } => self.is_generic(elem),
                _ => false,
            };
            if stays_variadic {
                out_elems.push(elem);
                out_flags.push(flag);
                continue;
            }
            if let TypeData::Tuple {
                flags: inner_flags, ..
            } = self.data(elem)
            {
                let inner = self.type_arguments(elem);
                // Too large to represent (2799, 2800), so the result is the error type.
                if inner.len() + out_elems.len() >= 10_000 {
                    let is_type_node = self.is_current_node_part_of_type_node();
                    self.error_at_current_node(if is_type_node { 2799 } else { 2800 });
                    return TypeId::ERROR;
                }
                out_elems.extend_from_slice(inner);
                out_flags.extend_from_slice(inner_flags);
                continue;
            }
            // Anything else is treated as an array.
            let element = match self.array_element(elem) {
                Some(element) => element,
                None => {
                    // `isArrayLikeType`, `getIndexTypeOfType(t, numberType)`. A type that isn't
                    // array-like is an error.
                    let found = if self.is_array_like(elem) {
                        self.index_type_of_type(elem, TypeId::NUMBER)
                    } else {
                        None
                    };
                    found.unwrap_or(TypeId::ERROR)
                }
            };
            out_elems.push(element);
            out_flags.push(ElemFlags::REST.with_label(flag.labeled_declaration()));
        }
        self.tuple_as(&out_elems, &out_flags, readonly, first_request)
    }

    /// Returns the key under which `instantiations` caches the entry for the single signature type
    /// `ty` and `arguments`. It uses a mapper from `ty` itself, which no instantiation uses.
    fn single_signature_key(&self, ty: TypeId, arguments: TypeId) -> (TypeId, MapperId) {
        (ty, self.types().mapper_of(&[(ty, arguments)]))
    }

    /// The `couldContainTypeVariables` test for the type `getOrCreateTypeFromSignature` creates for
    /// `sig`, which has `sig.declaration`'s symbol. True if that's a function, a method or a type
    /// literal. A call or construct signature, a constructor and an accessor aren't.
    pub(super) fn has_instantiable_symbol(&self, sig: SigId) -> bool {
        let declared = self.sig_decl(self.types().sig_origin(sig));
        declared.is_some_and(|(file, func, _)| {
            matches!(
                self.hir(file)[func].kind,
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::FunctionType
                    | FnKind::ConstructorType
            )
        })
    }

    /// `getSignatureInstantiation` with `inferredTypeParameters`. Returns the type of `sig`, the
    /// clone of `returned`'s signature (`ObjectFlagsSingleSignatureType`), with `inferred` as its
    /// mapper (`instantiatedSignature.mapper`).
    pub(super) fn single_signature_type(
        &mut self,
        sig: SigId,
        construct: bool,
        returned: TypeId,
        inferred: MapperId,
    ) -> TypeId {
        let created = self.type_of_signature(sig, construct);
        let TypeData::Synth(shape) = self.data(created) else {
            return created;
        };
        let TypeData::Fns { mapper: outer, .. } = self.data(returned) else {
            return created;
        };
        let arguments: Vec<TypeId> = (self.mapping_in_declaration_order(*outer).iter())
            .map(|&(param, _)| self.types().map(inferred, param).unwrap_or(param))
            .collect();
        if arguments.is_empty() || !self.has_type_variables(created) {
            return created;
        }
        let flags = vec![ElemFlags::REQUIRED; arguments.len()];
        let arguments = self.tuple(&arguments, &flags, false);
        self.synth(Shape {
            single_signature_arguments: Some(arguments),
            ..(**shape).clone_in(self.arena)
        })
    }

    /// `getObjectTypeInstantiation` of a type with `single_signature_arguments`.
    /// `ObjectType.instantiations` is keyed on the type arguments for the declaration's outer type
    /// parameters, so the first instantiation with the same ones is the result, whatever else
    /// `mapper` maps. `instantiated` is `ty` under `mapper`, and `stored` records how its computation
    /// ended.
    fn single_signature_instantiation(
        &mut self,
        ty: TypeId,
        arguments: TypeId,
        mapper: MapperId,
        instantiated: TypeId,
        stored: Result<Stored, Open>,
    ) -> TypeId {
        let arguments = self.instantiate(arguments, mapper);
        let key = self.single_signature_key(ty, arguments);
        if let Some(first) = self.p.instantiations.get(&self.task, &key) {
            return first;
        }
        match stored {
            Ok(stored) if instantiated != ty => {
                (self.p.instantiations).insert(&self.task, key, instantiated, stored)
            }
            _ => instantiated,
        }
    }

    pub fn instantiate_sig(&mut self, sig: SigId, mapper: MapperId) -> SigId {
        if mapper == MapperId::IDENTITY {
            return sig;
        }
        let data = match self.types().sig(sig) {
            SigData::Decl {
                file,
                func,
                mapper: own,
            } => SigData::Decl {
                file: *file,
                func: *func,
                mapper: self.sig_mapper(*file, *func, *own, mapper),
            },
            SigData::Construct {
                class,
                file,
                func,
                mapper: own,
            } => SigData::Construct {
                class: *class,
                file: *file,
                func: *func,
                mapper: self.class_sig_mapper(*class, *own, mapper),
            },
            SigData::DefaultConstruct {
                class,
                base,
                mapper: own,
            } => SigData::DefaultConstruct {
                class: *class,
                base: *base,
                mapper: self.class_sig_mapper(*class, *own, mapper),
            },
            SigData::Synth {
                type_params,
                params,
                this,
                of,
                is_union,
                ..
            } => {
                // `instantiateSignatureEx`: the type parameters that have no type arguments yet are
                // cloned where their outer mapping changes, and everything in the signature refers
                // to the clones.
                let mut remaining = Vec::with_capacity_in(type_params.len(), self.arena);
                let mut fresh: Vec<(TypeId, TypeId)> = Vec::new();
                for &param in type_params.iter() {
                    if self.types().map(mapper, param).is_some() {
                        continue;
                    }
                    let mut new = param;
                    if let TypeData::TypeParam(file, tp, outer_mapper) = *self.data(param)
                        && outer_mapper != MapperId::IDENTITY
                    {
                        let outer_mapper = self.map_mapper(outer_mapper, mapper);
                        new = self.cloned_type_param(file, tp, outer_mapper);
                    }
                    if new != param {
                        fresh.push((param, new));
                    }
                    remaining.push(new);
                }
                let mapper = if fresh.is_empty() {
                    mapper
                } else {
                    let fresh = self.types().mapper(fresh);
                    self.compose(fresh, mapper)
                };
                let arena = self.arena;
                let params = params.iter().map(|p| SigParam {
                    ty: self.instantiate(p.ty, mapper),
                    ..*p
                });
                let params = ArenaBox::from_iter_in(params, arena);
                // `getReturnTypeOfSignature`, `case sig.target != nil`
                let ret = self.sig_return(sig);
                SigData::Synth {
                    type_params: remaining.into(),
                    params,
                    ret: self.instantiate(ret, mapper),
                    this: this.map(|t| self.instantiate(t, mapper)),
                    of: ArenaBox::from_iter_in(
                        of.iter().map(|&part| self.instantiate_sig(part, mapper)),
                        arena,
                    ),
                    is_union: *is_union,
                }
            }
            // `cloneSignature` with its own return type, which is instantiated with the same mapper
            // as the rest.
            SigData::WithReturn { sig: inner, ret } => {
                let (inner, ret) = (*inner, *ret);
                let sig = self.instantiate_sig(inner, mapper);
                // That mapper starts with the cloned type parameters.
                let (old, new) = (self.sig_type_params(inner), self.sig_type_params(sig));
                let mapper = if old.len() == new.len() && old != new {
                    let fresh = self.mapper_from(&old, &new);
                    self.compose(fresh, mapper)
                } else {
                    mapper
                };
                SigData::WithReturn {
                    sig,
                    ret: self.instantiate(ret, mapper),
                }
            }
        };
        self.types().intern_sig(data)
    }

    /// True if `ty` is one of `file`'s type parameters `list`, as declared.
    pub(super) fn is_declared_among(
        &self,
        ty: TypeId,
        file: FileId,
        list: Span<TypeParamId>,
    ) -> bool {
        matches!(*self.data(ty), TypeData::TypeParam(f, tp, MapperId::IDENTITY) if f == file && list.range().contains(&tp.idx()))
    }

    /// Returns the type parameter `tp` of `func` as seen by a signature of `func` that has
    /// `mapper`, if it has no type argument yet. That's the declared one, or the clone created for
    /// how `mapper` maps the signature's outer type parameters. Anything else it maps to is a type
    /// argument, whether that's the declared one (`f<T>(x)` inside `f`) or another instantiation's.
    pub(super) fn open_type_param(
        &self,
        file: FileId,
        func: FnId,
        tp: TypeParamId,
        mapper: MapperId,
    ) -> Option<TypeId> {
        let declared = self.type_param(file, tp);
        let Some(value) = self.types().map(mapper, declared) else {
            return Some(declared);
        };
        let TypeData::TypeParam(f, t, outer_mapper) = *self.data(value) else {
            return None;
        };
        if (f, t) != (file, tp) || outer_mapper == MapperId::IDENTITY {
            return None;
        }
        let own = self.hir(file)[func].type_params;
        let outer = self
            .types()
            .mapping(mapper)
            .iter()
            .copied()
            .filter(|pair| !self.is_declared_among(pair.0, file, own))
            .collect();
        (outer_mapper == self.types().mapper(outer)).then_some(value)
    }

    /// `instantiateSignatureEx`. Returns the mapper of a signature of `func` that has `own`,
    /// composed with `second`. It maps the signature's outer type parameters and records the type
    /// arguments of its own. One of its own without a type argument maps to a clone
    /// (`cloneTypeParameter`) wherever an outer type parameter is instantiated, because the
    /// instantiation may mention the declared one (`then` of the return type of `then`) and mean a
    /// different one.
    fn sig_mapper(
        &mut self,
        file: FileId,
        func: FnId,
        own: MapperId,
        second: MapperId,
    ) -> MapperId {
        let type_params = self.hir(file)[func].type_params;
        let mapping = self.mapping_in_declaration_order(own);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            smallvec::SmallVec::with_capacity(mapping.len() + type_params.len());
        for &(param, value) in mapping.iter() {
            if !self.is_declared_among(param, file, type_params) {
                pairs.push((param, self.instantiate(value, second)));
            }
        }
        if type_params.is_empty() {
            // `sig.typeParameters = context.typeParameters`: they're its own, and `own` need not
            // mention them.
            if self.takes_context(file, func).is_some() {
                for param in self.adopted_type_params_of(file, func, own) {
                    if let Some(actual) = self.types().map(second, param)
                        && !pairs.iter().any(|pair| pair.0 == param)
                    {
                        pairs.push((param, actual));
                    }
                }
            }
            return self.types().mapper_of(&pairs);
        }
        let outer = pairs.len();
        let mut outer_mapper = None;
        for tp in type_params.iter() {
            let declared = self.type_param(file, tp);
            match self.open_type_param(file, func, tp, own) {
                // `second` is keyed by the type parameter the signature has.
                Some(open) => match self.types().map(second, open) {
                    Some(actual) => pairs.push((declared, actual)),
                    None => {
                        // Where no outer type parameter is instantiated it's the declared one,
                        // which needs no entry.
                        let outer_mapper = *outer_mapper
                            .get_or_insert_with(|| self.types().mapper_of(&pairs[..outer]));
                        let fresh = self.cloned_type_param(file, tp, outer_mapper);
                        if fresh != declared {
                            pairs.push((declared, fresh));
                        }
                    }
                },
                // `CompositeTypeMapper.Map` instantiates a type argument when its type parameter
                // is mapped, which is never if the signature has no reference to it.
                None => {
                    if let Some(mut actual) = self.types().map(own, declared) {
                        if self.has_type_variables(actual)
                            && self.is_own_type_parameter_possibly_referenced(file, func, tp)
                        {
                            actual = self.instantiate(actual, second);
                        }
                        pairs.push((declared, actual));
                    }
                }
            }
        }
        self.types().mapper_of(&pairs)
    }

    /// `sig_mapper` for a construct signature of `class`, whose type parameters are the class's.
    /// They aren't cloned.
    fn class_sig_mapper(&mut self, class: Sym, own: MapperId, second: MapperId) -> MapperId {
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> = smallvec::SmallVec::new();
        for &(param, value) in self.mapping_in_declaration_order(own).iter() {
            pairs.push((param, self.instantiate(value, second)));
        }
        // The type parameters of the declarations enclosing the class count too, because its static
        // side is instantiated with them (`getObjectTypeInstantiation`,
        // `resolveAnonymousTypeMembers`).
        for param in self.all_type_params_of_symbol(class).iter().copied() {
            if self.types().map(own, param).is_none()
                && let Some(value) = self.types().map(second, param)
            {
                pairs.push((param, value));
            }
        }
        self.types().mapper_of(&pairs)
    }

    /// `getReturnTypeOfSignature` and `getTypePredicateOfSignature`. Returns `signature.target`'s
    /// value, instantiated with `signature.mapper`. `ty` is `func`'s declared return type or
    /// predicate type. After the first step `unknown | F<U>` is `unknown` and `any & F<U>` is
    /// `any`, whatever `F<U>` is with the type arguments.
    pub(super) fn instantiate_result_of_sig(
        &mut self,
        ty: TypeId,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> TypeId {
        if self.types().instantiation_class(ty) == InstantiationClass::Unchanged {
            return ty;
        }
        match self.steps_of_sig_mapper(file, func, mapper) {
            Some((first, second)) => {
                let open = self.instantiate(ty, first);
                self.instantiate(open, second)
            }
            None => self.instantiate(ty, mapper),
        }
    }

    /// Returns `signature.target.mapper` and `signature.mapper` of the signature of `func` that's
    /// stored with `mapper`. One with type arguments is an instantiation of the signature whose
    /// outer type parameters are mapped as `mapper` specifies and whose own are cloned
    /// (`sig_mapper`). Returns `None` if it has no type arguments, or its target is the declared
    /// signature, which has no mapper.
    pub(super) fn steps_of_sig_mapper(
        &self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> Option<(MapperId, MapperId)> {
        let own = self.hir(file)[func].type_params;
        if own.is_empty() {
            return None;
        }
        let recent = &self.recent_steps[mapper.0 as usize % RECENT_SIGS];
        if recent.get().0 == (file, func, mapper) {
            return recent.get().1;
        }
        let steps = self.derive_steps_of_sig_mapper(file, func, mapper);
        recent.set(((file, func, mapper), steps));
        steps
    }

    fn derive_steps_of_sig_mapper(
        &self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> Option<(MapperId, MapperId)> {
        let own = self.hir(file)[func].type_params;
        let outer = (self.types().mapping(mapper).iter().copied())
            .filter(|pair| !self.is_declared_among(pair.0, file, own));
        if outer.clone().all(|pair| pair.0 == pair.1) {
            return None;
        }
        let mut first: smallvec::SmallVec<[(TypeId, TypeId); 8]> = outer.collect();
        let outer_mapper = self.types().mapper_of(&first);
        let mut second: smallvec::SmallVec<[(TypeId, TypeId); 4]> = smallvec::SmallVec::new();
        for tp in own.iter() {
            let declared = self.type_param(file, tp);
            if let Some(actual) = self.types().map(mapper, declared) {
                let open = self.cloned_type_param(file, tp, outer_mapper);
                first.push((declared, open));
                if actual != open {
                    second.push((open, actual));
                }
            }
        }
        if second.is_empty() {
            return None;
        }
        Some((
            self.types().mapper_of(&first),
            self.types().mapper_of(&second),
        ))
    }
}
