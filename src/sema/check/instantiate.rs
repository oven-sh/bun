//! Instantiation: substituting type arguments for type parameters.

use super::alias::NewAlias;
use super::*;
use smallvec::SmallVec;

/// A direct-mapped cache of results keyed by two numbers, not both 0. It belongs to one checker and
/// sits in front of a slower lookup. A new entry overwrites whatever occupied its slot.
#[derive(Default)]
pub(super) struct Recent {
    /// The two key numbers, the result and a tag. Initially empty, then a power of two of entries.
    places: Vec<[u32; 4]>,
    /// A hash shifted right by this amount is a slot index.
    shift: u32,
    /// Number of entries inserted since the table last grew.
    added: usize,
}

impl Recent {
    const MOST_PLACES: usize = 1 << 14;

    #[inline]
    fn place(&self, a: u32, b: u32) -> usize {
        let both = u64::from(a) << 32 | u64::from(b);
        (both.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> self.shift) as usize
    }

    #[inline]
    pub(super) fn get(&self, a: u32, b: u32) -> Option<u32> {
        match self.places.get(self.place(a, b)) {
            Some(&[x, y, answer, _]) if x == a && y == b => Some(answer),
            _ => None,
        }
    }

    /// The result, and the tag for the caller to read and replace.
    #[inline]
    fn get_tagged(&mut self, a: u32, b: u32) -> Option<(u32, &mut u32)> {
        let place = self.place(a, b);
        match self.places.get_mut(place) {
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
        if self.added == self.places.len() && self.added < Self::MOST_PLACES {
            self.grow();
        }
        self.added += 1;
        let place = self.place(a, b);
        self.places[place] = [a, b, answer, tag];
    }

    /// Most files need few slots, and the few that need many dominate the time.
    #[cold]
    fn grow(&mut self) {
        let len = (self.places.len() * 4).max(64);
        let old = std::mem::replace(&mut self.places, vec![[0; 4]; len]);
        self.shift = 64 - len.trailing_zeros();
        self.added = 0;
        for entry @ [a, b, ..] in old {
            if (a, b) != (0, 0) {
                let place = self.place(a, b);
                self.places[place] = entry;
            }
        }
    }
}

/// `activeMappers`. tsgo caches the instantiations under a mapper for as long as an instantiation
/// with that mapper is in progress (`activeTypeMappersCaches`), and a hit in that cache does not
/// add to `instantiationCount`. The results are cached elsewhere here. This records what that
/// cache would hold, for the count.
#[derive(Default)]
pub(super) struct ActiveMappers {
    mappers: Vec<MapperId>,
    activations: Vec<Activation>,
    pushed: u32,
}

struct Activation {
    /// Unique, and never 0. The tag of an entry of `recent_instantiations` made under it.
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

impl<'p> Checker<'p> {
    pub fn mapper_from(&mut self, params: &[TypeId], args: &[TypeId]) -> MapperId {
        self.types()
            .mapper(params.iter().copied().zip(args.iter().copied()).collect())
    }

    /// The pairs of `mapper` by the declaration of the type parameter, as `typeParameters` and `outerTypeParameters` are. A mapper
    /// stores them in `arrival_order`, which depends on the schedule, so nothing observable may follow the stored order. That includes
    /// the order of evaluation: a creation stamp is exact only if a transaction evaluates in the order of the sequential execution.
    pub(super) fn mapping_in_declaration_order(
        &self,
        mapper: MapperId,
    ) -> std::borrow::Cow<'p, [(TypeId, TypeId)]> {
        let declaration = |param: TypeId| match *self.data(param) {
            TypeData::TypeParam(file, tp, _) => (0u8, file.0, tp.0),
            _ => (1, 0, 0),
        };
        let stored = self.types().mapping(mapper);
        if stored.is_sorted_by(|x, y| declaration(x.0) < declaration(y.0)) {
            return stored.into();
        }
        let mut pairs = stored.to_vec();
        // Clones of one declaration, and the `this` types of nested classes, have one key.
        pairs.sort_by(|x, y| {
            (declaration(x.0).cmp(&declaration(y.0))).then_with(|| self.creation_order(x.0, y.0))
        });
        pairs.into()
    }

    /// `first`, then `second`.
    pub fn compose(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY {
            return second;
        }
        if second == MapperId::IDENTITY {
            return first;
        }
        if let Some(kept) = self.p.composed.get(&mut self.task, &(first, second)) {
            return kept;
        }
        let scope = self.begin_scope();
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for &(param, value) in self.mapping_in_declaration_order(first).iter() {
            pairs.push((param, self.instantiate(value, second)));
        }
        for &(param, value) in self.types().mapping(second) {
            if self.types().map(first, param).is_none() {
                pairs.push((param, value));
            }
        }
        let composed = self.types().mapper(pairs);
        match self.end_scope_by_counters(scope) {
            Ok(stored) => {
                (self.p.composed).insert(&mut self.task, (first, second), composed, stored)
            }
            Err(_) => composed,
        }
    }

    /// `first`, then `second`, for the parameters `first` maps.
    pub fn map_mapper(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY || second == MapperId::IDENTITY {
            return first;
        }
        let mapping = self.mapping_in_declaration_order(first);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            smallvec::SmallVec::with_capacity(mapping.len());
        let mut changed = false;
        for &(param, value) in mapping.iter() {
            let new = self.instantiate(value, second);
            changed |= new != value;
            pairs.push((param, new));
        }
        if !changed {
            return first;
        }
        self.types().mapper_of(&pairs)
    }

    pub fn instantiate_all(&mut self, types: &[TypeId], mapper: MapperId) -> Vec<TypeId> {
        types.iter().map(|&t| self.instantiate(t, mapper)).collect()
    }

    /// `getInstantiatedSymbol`
    pub(super) fn instantiate_prop(&mut self, prop: &mut Prop, mapper: MapperId) {
        match &mut prop.source {
            PropSource::Type(ty) | PropSource::Copy(ty, ..) => *ty = self.instantiate(*ty, mapper),
            _ => prop.mapper = self.compose(prop.mapper, mapper),
        }
    }

    /// `instantiateType(t, c.restrictiveMapper)`, `instantiateType(t, c.permissiveMapper)`: `map`
    /// is the mapper. A deferred type records the mapping of each of its outer type parameters, so
    /// a mapper reaches the type parameters `any_type_in` finds and no others.
    /// `getObjectTypeInstantiation` maps the outer type parameters: those declared by a signature
    /// in `t` stay.
    fn instantiate_type_parameters(
        &mut self,
        t: TypeId,
        map: fn(&Self, TypeId) -> TypeId,
    ) -> TypeId {
        if self.flags(t) & (tf::PRIMITIVE | tf::ANY | tf::UNKNOWN | tf::NEVER) != 0 {
            return t;
        }
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
        self.instantiate(t, mapper)
    }

    /// `getRestrictiveInstantiation`, with `getRestrictiveTypeParameter`. Restrictive type
    /// parameters map to themselves, so the restrictive instantiation of a restrictive instantiation is itself.
    pub(super) fn restrictive_instantiation(&mut self, t: TypeId) -> TypeId {
        self.instantiate_type_parameters(t, |c, param| match c.data(param) {
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
        })
    }

    /// `getPermissiveInstantiation`
    pub(super) fn permissive_instantiation(&mut self, t: TypeId) -> TypeId {
        self.instantiate_type_parameters(t, |_, _| TypeId::WILDCARD)
    }

    pub(super) fn is_assignable_restrictive(&mut self, source: TypeId, target: TypeId) -> bool {
        let (source, target) = (
            self.restrictive_instantiation(source),
            self.restrictive_instantiation(target),
        );
        self.restrictive_operands.push((source, target));
        let result = self.is_assignable(source, target);
        self.restrictive_operands.pop();
        result
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
        if mapper == MapperId::IDENTITY {
            return ty;
        }
        let (data, could_contain_type_variables) = self.types().get_for_instantiation(ty);
        if !could_contain_type_variables {
            return ty;
        }
        // Before any cache: at the limit tsgo fails every instantiation, that of a type parameter
        // too.
        if self.instantiation_depth >= 100 || self.instantiation_count >= 5_000_000 {
            return self.instantiation_too_deep();
        }
        let active = self.active_mappers.find(mapper);
        if let TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) = data {
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
        if let Some((known, tag)) = self.recent_instantiations.get_tagged(ty.0, mapper.0) {
            if serial == 0 || *tag != serial {
                *tag = serial;
                self.instantiation_count += 1;
            }
            return TypeId(known);
        }
        self.instantiation_count += 1;
        self.instantiate_cached(ty, mapper, serial)
    }

    /// `instantiate` for a type that mentions type parameters, is not one itself and is not in the
    /// cache of recent results.
    /// `serial`: of the activation of `mapper`, or 0 if it is not active.
    #[inline(never)]
    fn instantiate_cached(&mut self, ty: TypeId, mapper: MapperId, serial: u32) -> TypeId {
        if let Some(known) = self.p.instantiations.get(&mut self.task, &(ty, mapper)) {
            self.recent_instantiations
                .put_tagged(ty.0, mapper.0, known.0, serial);
            return known;
        }
        if serial != 0
            && self.instantiation_limit_hits != 0
            && let Some(&(under, known, is_tainted)) =
                self.instantiations_up_to_a_limit.get(&(ty, mapper))
            && under == serial
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
        self.instantiation_depth += 1;
        if serial == 0 {
            self.active_mappers.push(mapper);
        }
        let cycles_before = self.cycles;
        let scope = self.begin_scope();
        let result = self.instantiate_uncached(ty, mapper);
        let result = self.with_new_alias(ty, mapper, result, None);
        if serial == 0 {
            self.active_mappers.pop();
        }
        self.instantiation_depth -= 1;
        // tsgo has no cache of instantiations but that of the active mappers. So a result with the
        // error type of the limit in it is computed again by a caller that has more depth left.
        let hit_the_limit = self.instantiation_limit_hits != hits_before;
        match self.end_scope_by_counters(scope) {
            Ok(stored) if !hit_the_limit => {
                let kept =
                    (self.p.instantiations).insert(&mut self.task, (ty, mapper), result, stored);
                // The table stores nothing task-local under a shared key.
                if ty.is_local() || mapper.is_local() || !result.is_local() {
                    self.recent_instantiations
                        .put_tagged(ty.0, mapper.0, kept.0, serial);
                }
                kept
            }
            _ => {
                // `cache[key] = result`, which `popActiveMapper` clears.
                if self.cycles == cycles_before && hit_the_limit && serial != 0 {
                    let is_tainted = self.limits != limits_before;
                    self.instantiations_up_to_a_limit
                        .insert((ty, mapper), (serial, result, is_tainted));
                }
                result
            }
        }
    }

    /// Whether `getOuterTypeParameters` of the object literal that `written` is a property of
    /// returns only type parameters declared in its enclosing declarations. A context sensitive
    /// function adds those of its contextual signature (`assignContextualParameterTypes`).
    fn has_only_declared_outer_type_params(&self, file: FileId, written: PropId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let literal = bound.prop_owner[written.idx()];
        if literal.is_none() || !matches!(hir[literal].kind, ExprKind::Object(_)) {
            return false;
        }
        let mut scope = self.scope_of_expr(file, literal);
        if scope.is_none() {
            return false;
        }
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
    /// parameters enclosing the node changes.
    /// `alias`: the alias passed in, or else `instantiateTypeAlias(t.alias, m)`.
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
        let arguments = TypeArguments::deferred(file, node, new);
        let reference = match self.data(ty) {
            TypeData::Ref { target, .. } => TypeData::Ref {
                target: *target,
                args: arguments,
            },
            TypeData::Tuple {
                flags, readonly, ..
            } => TypeData::Tuple {
                elems: arguments,
                flags: flags.clone(),
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
                let args = self.type_arguments(ty);
                let args = self.instantiate_all(args, mapper);
                self.intern(TypeData::Ref {
                    target: *target,
                    args: args.into(),
                })
            }
            TypeData::Tuple {
                flags, readonly, ..
            } => {
                let elems = self.type_arguments(ty);
                let elems = self.instantiate_all(elems, mapper);
                self.normalized_tuple(&elems, flags, *readonly)
            }
            TypeData::Anon {
                origin,
                mapper: own,
            } => {
                let new = self.map_mapper(*own, mapper);
                if new == *own {
                    return ty;
                }
                if let Origin::Mapped(file, node) = *origin {
                    // `newAlias`: `instantiateTypeAlias(t.alias, m)`
                    let kept = self.stored_alias(ty).map(|(alias, type_arguments)| {
                        (*alias, self.instantiate_all(type_arguments, mapper))
                    });
                    let alias = match &kept {
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
                self.intern(TypeData::Fns {
                    decls: decls.clone(),
                    mapper: new,
                })
            }
            TypeData::Synth(shape) => {
                let scope = self.begin_scope();
                let mut new = Shape {
                    literal: shape.literal,
                    is_regular: shape.is_regular,
                    contains_widening_type: shape.contains_widening_type,
                    ..Shape::default()
                };
                for p in &shape.props {
                    let mut p = p.clone();
                    match p.source {
                        // `getObjectTypeInstantiation` maps the outer type parameters of the literal and nothing else.
                        // `p.mapper` has a key for each of them.
                        PropSource::Literal(file, written)
                            if self.has_only_declared_outer_type_params(file, written) =>
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
                new.call = shape
                    .call
                    .iter()
                    .map(|&s| self.instantiate_sig(s, mapper))
                    .collect();
                new.construct = shape
                    .construct
                    .iter()
                    .map(|&s| self.instantiate_sig(s, mapper))
                    .collect();
                new.symbol_declared_at = shape.symbol_declared_at;
                new.spread_rank = shape.spread_rank;
                new.spread_of = shape.spread_of.map(|(left, right)| {
                    (
                        self.instantiate(left, mapper),
                        self.instantiate(right, mapper),
                    )
                });
                // `instantiateAnonymousType`
                new.instantiation_expression = shape.instantiation_expression;
                new.is_js_literal = shape.is_js_literal;
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
                // It can be resolved to the base type in the same cases as the conditional type resolves to its true branch.
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

    /// `createNormalizedTupleType`, the part for variadic elements: `...T` is expanded wherever `T`
    /// is known. `tuple` does the rest.
    pub fn normalized_tuple(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> TypeId {
        if !flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) {
            return self.tuple(elems, flags, readonly);
        }
        let is_spread = |i: usize| flags[i].contains(ElemFlags::VARIADIC);
        // `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`, and `[A, ...never]` is `never`.
        if let Some(i) = (0..elems.len())
            .find(|&i| is_spread(i) && (elems[i].is_never() || self.is_union(elems[i])))
        {
            // A type that is too complex to represent is treated as an array.
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
                out_flags.push(ElemFlags::REST.with_label(flag.label()));
                continue;
            }
            // A generic element stays as it is: `TypeFlagsInstantiableNonPrimitive`,
            // `isGenericMappedType`.
            let waits = match self.data(elem) {
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
            if waits {
                out_elems.push(elem);
                out_flags.push(flag);
                continue;
            }
            if let TypeData::Tuple {
                flags: inner_flags, ..
            } = self.data(elem)
            {
                let inner = self.type_arguments(elem);
                // Too large to represent (2799, 2800): the error type.
                if inner.len() + out_elems.len() >= 10_000 {
                    // `IsPartOfTypeNode(c.currentNode)`
                    let is_type_node =
                        matches!(self.current_node(), Some(CurrentNode::TypeNode(..)));
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
                    // `isArrayLikeType`, `getIndexTypeOfType(t, numberType)`. A type that is not
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
            out_flags.push(ElemFlags::REST.with_label(flag.label()));
        }
        self.tuple(&out_elems, &out_flags, readonly)
    }

    /// The key under which `instantiations` caches the entry for the single signature type `ty` and
    /// `arguments`: a mapper from `ty` itself, which no instantiation uses.
    fn single_signature_key(&self, ty: TypeId, arguments: TypeId) -> (TypeId, MapperId) {
        (ty, self.types().mapper_of(&[(ty, arguments)]))
    }

    /// `getSignatureInstantiation` with `inferredTypeParameters`: the type of `sig`, the clone of the signature of `returned`
    /// (`ObjectFlagsSingleSignatureType`), with `inferred` as its mapper (`instantiatedSignature.mapper`).
    pub(super) fn single_signature_type(
        &mut self,
        sig: SigId,
        construct: bool,
        returned: TypeId,
        inferred: MapperId,
    ) -> TypeId {
        let created = self.type_of_signature(sig, construct);
        let (TypeData::Fns { mapper: outer, .. }, TypeData::Synth(shape)) =
            (self.data(returned), self.data(created))
        else {
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
            ..(**shape).clone()
        })
    }

    /// `getObjectTypeInstantiation` of a type with `single_signature_arguments`.
    /// `ObjectType.instantiations` is keyed on the type arguments for the outer type parameters of
    /// the declaration: the first instantiation with the same ones is the result, whatever else
    /// `mapper` maps. `instantiated`: `ty` under `mapper`, and `stored`: how its computation ended.
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
        if let Some(first) = self.p.instantiations.get(&mut self.task, &key) {
            return first;
        }
        match stored {
            Ok(stored) if instantiated != ty => {
                (self.p.instantiations).insert(&mut self.task, key, instantiated, stored)
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
                let mut remaining: Vec<TypeId> = Vec::with_capacity(type_params.len());
                let mut fresh: Vec<(TypeId, TypeId)> = Vec::new();
                for &param in type_params.iter() {
                    if self.types().map(mapper, param).is_some() {
                        continue;
                    }
                    let mut new = param;
                    if let TypeData::TypeParam(file, tp, around) = *self.data(param)
                        && around != MapperId::IDENTITY
                    {
                        let around = self.map_mapper(around, mapper);
                        new = self.cloned_type_param(file, tp, around);
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
                let params: Vec<SigParam> = params
                    .iter()
                    .map(|p| SigParam {
                        ty: self.instantiate(p.ty, mapper),
                        ..*p
                    })
                    .collect();
                // `getReturnTypeOfSignature`, `case sig.target != nil`
                let ret = self.sig_return(sig);
                SigData::Synth {
                    type_params: remaining.into(),
                    params: params.into(),
                    ret: self.instantiate(ret, mapper),
                    this: this.map(|t| self.instantiate(t, mapper)),
                    of: of
                        .iter()
                        .map(|&part| self.instantiate_sig(part, mapper))
                        .collect(),
                    is_union: *is_union,
                }
            }
            // `cloneSignature` with its own return type, which is instantiated with the same mapper
            // as the rest.
            SigData::WithReturn { sig: inner, ret } => {
                let (inner, ret) = (*inner, *ret);
                let sig = self.instantiate_sig(inner, mapper);
                // That mapper begins with the cloned type parameters.
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

    /// Whether `ty` is one of the type parameters `list` of `file`, as declared.
    fn is_declared_among(&self, ty: TypeId, file: FileId, list: Span<TypeParamId>) -> bool {
        matches!(*self.data(ty), TypeData::TypeParam(f, tp, MapperId::IDENTITY) if f == file && list.range().contains(&tp.idx()))
    }

    /// The type parameter `tp` of `func` as seen by a signature of `func` that has `mapper`, if it
    /// has no type argument yet: the declared one, or the clone created for the mapping `mapper`
    /// gives the outer type parameters of the signature. Anything else it maps to is a type
    /// argument, be it the declared one (`f<T>(x)` inside `f`) or that of another instantiation.
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
        let TypeData::TypeParam(f, t, around) = *self.data(value) else {
            return None;
        };
        if (f, t) != (file, tp) || around == MapperId::IDENTITY {
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
        (around == self.types().mapper(outer)).then_some(value)
    }

    /// `instantiateSignatureEx`: the mapper of a signature of `func` that has `own`, composed with
    /// `second`. It maps the outer type parameters of the signature and records the type arguments
    /// of its own. One of its own without a type argument maps to a clone (`cloneTypeParameter`)
    /// wherever an outer type parameter is instantiated: the instantiation may mention the declared
    /// one (`then` of the return type of `then`), and means a different one.
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
            // `sig.typeParameters = context.typeParameters`: they are its own, and `own` need not mention them.
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
        let mut around = None;
        for tp in type_params.iter() {
            let declared = self.type_param(file, tp);
            match self.open_type_param(file, func, tp, own) {
                // `second` is keyed by the type parameter the signature has.
                Some(open) => match self.types().map(second, open) {
                    Some(actual) => pairs.push((declared, actual)),
                    None => {
                        // Where no outer type parameter is instantiated it is the declared one,
                        // which needs no entry.
                        let around =
                            *around.get_or_insert_with(|| self.types().mapper_of(&pairs[..outer]));
                        let fresh = self.cloned_type_param(file, tp, around);
                        if fresh != declared {
                            pairs.push((declared, fresh));
                        }
                    }
                },
                None => {
                    if let Some(actual) = self.types().map(own, declared) {
                        pairs.push((declared, self.instantiate(actual, second)));
                    }
                }
            }
        }
        self.types().mapper_of(&pairs)
    }

    /// The same for a construct signature of `class`, whose type parameters are those of the class.
    /// They are not cloned.
    fn class_sig_mapper(&mut self, class: Sym, own: MapperId, second: MapperId) -> MapperId {
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> = smallvec::SmallVec::new();
        for &(param, value) in self.mapping_in_declaration_order(own).iter() {
            pairs.push((param, self.instantiate(value, second)));
        }
        // The type parameters of the declarations enclosing the class count as well: its static
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

    /// `getReturnTypeOfSignature`, `getTypePredicateOfSignature`: the value of `signature.target`,
    /// instantiated with `signature.mapper`. `ty`: the declared return type or predicate type of
    /// `func`. A signature of `func` with type arguments is an instantiation of the signature whose
    /// outer type parameters are mapped as `mapper` specifies, so `ty` is instantiated with that
    /// mapping first and with the type arguments afterwards. By then `unknown | U` is `unknown` and
    /// `any & U` is `any`, which only `any` and `never` for `U` would have overridden: with other
    /// type arguments a single step yields the same result. The types of parameters are
    /// instantiated with both at once (`instantiateSymbol`).
    pub(super) fn instantiate_result_of_sig(
        &mut self,
        ty: TypeId,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> TypeId {
        let own = self.hir(file)[func].type_params;
        let may_differ = !own.is_empty()
            && self.types().mapping(mapper).iter().any(|pair| {
                (self.has_any_flag(pair.1) || pair.1.is_never())
                    && self.is_declared_among(pair.0, file, own)
            });
        if !may_differ {
            return self.instantiate(ty, mapper);
        }
        let mut first: smallvec::SmallVec<[(TypeId, TypeId); 8]> = self
            .types()
            .mapping(mapper)
            .iter()
            .copied()
            .filter(|pair| !self.is_declared_among(pair.0, file, own))
            .collect();
        // No outer type parameter is instantiated: it is an instantiation of the declared
        // signature.
        if first.iter().all(|pair| pair.0 == pair.1) {
            return self.instantiate(ty, mapper);
        }
        let around = self.types().mapper_of(&first);
        let mut second: smallvec::SmallVec<[(TypeId, TypeId); 4]> = smallvec::SmallVec::new();
        for tp in own.iter() {
            let declared = self.type_param(file, tp);
            if let Some(actual) = self.types().map(mapper, declared) {
                let open = self.cloned_type_param(file, tp, around);
                first.push((declared, open));
                if actual != open {
                    second.push((open, actual));
                }
            }
        }
        let (first, second) = (
            self.types().mapper_of(&first),
            self.types().mapper_of(&second),
        );
        let open = self.instantiate(ty, first);
        self.instantiate(open, second)
    }
}
