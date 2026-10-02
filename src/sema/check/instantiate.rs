//! Replacing type parameters by what they stand for.

use super::alias::NewAlias;
use super::*;

/// The last answers to questions that go by two numbers, not both 0. It belongs to one checker and stands in front of something that
/// takes longer to ask. An answer takes the place of whichever one was in its place.
#[derive(Default)]
pub(super) struct Recent {
    /// The two numbers and the answer. There are none to begin with, then a power of two of them.
    places: Vec<[u32; 3]>,
    /// What is left of a hash shifted by so much is a place.
    shift: u32,
    /// How many answers were put in since the places were last made more.
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
            Some(&[x, y, answer]) if x == a && y == b => Some(answer),
            _ => None,
        }
    }

    #[inline]
    pub(super) fn put(&mut self, a: u32, b: u32, answer: u32) {
        if self.added == self.places.len() && self.added < Self::MOST_PLACES {
            self.grow();
        }
        self.added += 1;
        let place = self.place(a, b);
        self.places[place] = [a, b, answer];
    }

    /// Most files need few places, and the few that need many are where the time goes.
    #[cold]
    fn grow(&mut self) {
        let len = (self.places.len() * 4).max(64);
        let old = std::mem::replace(&mut self.places, vec![[0; 3]; len]);
        self.shift = 64 - len.trailing_zeros();
        self.added = 0;
        for [a, b, answer] in old {
            if (a, b) != (0, 0) {
                let place = self.place(a, b);
                self.places[place] = [a, b, answer];
            }
        }
    }
}

impl<'p> Checker<'p> {
    pub fn mapper_from(&mut self, params: &[TypeId], args: &[TypeId]) -> MapperId {
        self.p
            .types
            .mapper(params.iter().copied().zip(args.iter().copied()).collect())
    }

    /// `first`, then `second`.
    pub fn compose(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY {
            return second;
        }
        if second == MapperId::IDENTITY {
            return first;
        }
        if let Some(kept) = self.p.composed.get(&(first, second)) {
            return kept;
        }
        let cycles_before = self.cycles;
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for &(param, value) in self.p.types.mapping(first) {
            pairs.push((param, self.instantiate(value, second)));
        }
        for &(param, value) in self.p.types.mapping(second) {
            if self.p.types.map(first, param).is_none() {
                pairs.push((param, value));
            }
        }
        let composed = self.p.types.mapper(pairs);
        if self.cycles == cycles_before {
            self.p.composed.insert((first, second), composed);
        }
        composed
    }

    /// `first`, then `second`, for the parameters `first` is about.
    pub fn map_mapper(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY || second == MapperId::IDENTITY {
            return first;
        }
        let mapping = self.p.types.mapping(first);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            smallvec::SmallVec::with_capacity(mapping.len());
        let mut changed = false;
        for &(param, value) in mapping {
            let new = self.instantiate(value, second);
            changed |= new != value;
            pairs.push((param, new));
        }
        if !changed {
            return first;
        }
        self.p.types.mapper_of(&pairs)
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

    /// `instantiateType(t, c.restrictiveMapper)`, `instantiateType(t, c.permissiveMapper)`: `map` is the mapper. What is deferred says
    /// what each type parameter around it stands for, so a mapper reaches the type parameters `any_type_in` finds and no other.
    /// `getObjectTypeInstantiation` maps the outer type parameters: those a signature in `t` declares stay.
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
                    if let SigData::Synth { type_params, .. } = self.p.types.sig(sig) {
                        own.extend_from_slice(type_params);
                    }
                }
            }
            false
        });
        pairs.retain(|pair| pair.0 != pair.1 && !own.contains(&pair.0));
        let mapper = self.p.types.mapper(pairs);
        self.instantiate(t, mapper)
    }

    /// `getRestrictiveInstantiation`, with `getRestrictiveTypeParameter`. A restrictive instantiation is known by having one.
    pub(super) fn restrictive_instantiation(&mut self, t: TypeId) -> TypeId {
        self.instantiate_type_parameters(t, |c, param| match c.data(param) {
            TypeData::Marker(
                Marker::Super | Marker::Other | Marker::SuperForCheck | Marker::Restrictive(_),
            ) => param,
            // `getConstraintDeclaration(tp) == nil`
            // A clone may have been given something to extend (`tp.constraint == nil`): `syntheticParam` of `reportErrorResults`.
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
        let (data, flags) = self.p.types.get_with_flags(ty);
        if !flags.contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES) {
            return ty;
        }
        if let TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) = data {
            return self.p.types.map(mapper, ty).unwrap_or(ty);
        }
        if let Some(known) = self.recent_instantiations.get(ty.0, mapper.0) {
            return TypeId(known);
        }
        self.instantiate_kept(ty, mapper)
    }

    /// `instantiate`, of a type that mentions type parameters, is none itself and was not asked about lately.
    #[inline(never)]
    fn instantiate_kept(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        if let Some(known) = self.p.instantiations.get(&(ty, mapper)) {
            self.recent_instantiations.put(ty.0, mapper.0, known.0);
            return known;
        }
        let outermost = self.frames.first().map_or(0, |frame| frame.serial);
        if self.limits != 0
            && let Some(&(under, known)) = self.instantiations_up_to_a_limit.get(&(ty, mapper))
            && under == outermost
        {
            // Reading it leaves the marks that working it out again would.
            self.limits += 1;
            self.mark_tainted_from(0);
            return known;
        }
        // `instantiationDepth == 100`: 2589 and the error type, which is cached like any other result.
        if self.instantiation_depth >= 100 {
            return self.instantiation_too_deep();
        }
        self.instantiation_depth += 1;
        let (cycles_before, limits_before) = (self.cycles, self.limits);
        let result = self.instantiate_uncached(ty, mapper);
        let result = self.with_new_alias(ty, mapper, result, None);
        self.instantiation_depth -= 1;
        if self.cycles != cycles_before {
            return result;
        }
        if self.limits != limits_before {
            self.instantiations_up_to_a_limit
                .insert((ty, mapper), (outermost, result));
        } else {
            let kept = self.p.instantiations.insert((ty, mapper), result);
            // The table keeps nothing local under a key that is shared.
            if ty.is_local() || mapper.is_local() || !result.is_local() {
                self.recent_instantiations.put(ty.0, mapper.0, kept.0);
            }
        }
        result
    }

    /// Whether `getOuterTypeParameters` of the object literal that `written` is a property of returns only type parameters declared
    /// around it. A context sensitive function adds those of its contextual signature (`assignContextualParameterTypes`).
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

    /// `getObjectTypeInstantiation`, of a deferred type reference: only what the type parameters around the node stand for changes.
    /// `alias`: what it is handed, or else `instantiateTypeAlias(t.alias, m)`.
    pub(super) fn instantiate_deferred_type_reference(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let Some(deferred) = self.p.types.deferred(ty) else {
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
        if self.p.types.deferred(ty).is_some() {
            return self.instantiate_deferred_type_reference(ty, mapper, None);
        }
        match self.data(ty) {
            // `instantiateTypeWorker`: what does not change stays as it is, unreduced if it was.
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
                let cycles_before = self.cycles;
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
                new.spread_of = shape.spread_of.map(|(left, right)| {
                    (
                        self.instantiate(left, mapper),
                        self.instantiate(right, mapper),
                    )
                });
                // `instantiateAnonymousType`
                new.instantiation_expression = shape.instantiation_expression;
                new.is_js_literal = shape.is_js_literal;
                let instantiated = self.synth(new);
                if self.is_generic_single_signature(shape) {
                    let holds = self.cycles == cycles_before;
                    return self.single_signature_instantiation(ty, mapper, instantiated, holds);
                }
                instantiated
            }
            TypeData::Cond {
                file,
                node,
                mapper: own,
            } => {
                // A declared type has no mapper in tsgo. Here it has one of identity pairs.
                if self.p.types.mapping(mapper).iter().all(|p| p.0 == p.1) {
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
                if self.p.types.mapping(mapper).iter().all(|p| p.0 == p.1) {
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

    /// `createNormalizedTupleType`, as far as the variadic elements go: `...T` is spelled out wherever `T` is known. `tuple` does
    /// the rest.
    pub fn normalized_tuple(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> TypeId {
        if !flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) {
            return self.tuple(elems, flags, readonly);
        }
        // An alias is what it stands for.
        let is_spread = |i: usize| flags[i].contains(ElemFlags::VARIADIC);
        // `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`, and `[A, ...never]` is `never`.
        if let Some(i) = (0..elems.len())
            .find(|&i| is_spread(i) && (elems[i].is_never() || self.is_union(elems[i])))
        {
            // What is too complex to represent is taken for an array.
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
            // What is generic stays as it is: `TypeFlagsInstantiableNonPrimitive`, `isGenericMappedType`.
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
            // Anything else is taken for an array.
            let element = match self.array_element(elem) {
                Some(element) => element,
                None if !self.is_known(elem) => TypeId::UNRESOLVED,
                None => {
                    // `isArrayLikeType`, `getIndexTypeOfType(t, numberType)`. What is not like an array is an error.
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

    /// Whether all there is to `shape` is one made-up signature that has type parameters.
    fn is_generic_single_signature(&self, shape: &Shape) -> bool {
        let only = match (shape.call.as_slice(), shape.construct.as_slice()) {
            ([only], []) | ([], [only]) => *only,
            _ => return false,
        };
        shape.props.is_empty()
            && shape.index.is_empty()
            && matches!(self.p.types.sig(only), SigData::Synth { type_params, .. } if !type_params.is_empty())
    }

    /// Where `instantiations` keeps what goes with the single signature type `ty` and `arguments`: under a mapper from `ty`
    /// itself, which nothing is instantiated with.
    fn single_signature_key(&self, ty: TypeId, arguments: TypeId) -> (TypeId, MapperId) {
        (ty, self.p.types.mapper_of(&[(ty, arguments)]))
    }

    /// `getSignatureInstantiation` with `inferredTypeParameters`: `made` is the type of the clone of the signature of `returned`
    /// (`ObjectFlagsSingleSignatureType`), and `inferred` is its mapper (`instantiatedSignature.mapper`). Keeps the outer type
    /// parameters of the declaration of that signature as `inferred` has them, as a tuple.
    pub(super) fn note_single_signature_type(
        &mut self,
        made: TypeId,
        returned: TypeId,
        inferred: MapperId,
    ) {
        let TypeData::Fns { mapper: outer, .. } = self.data(returned) else {
            return;
        };
        let arguments: Vec<TypeId> = self
            .p
            .types
            .mapping(*outer)
            .iter()
            .map(|&(param, _)| self.p.types.map(inferred, param).unwrap_or(param))
            .collect();
        if arguments.is_empty() || !self.has_type_variables(made) {
            return;
        }
        let flags = vec![ElemFlags::REQUIRED; arguments.len()];
        let arguments = self.tuple(&arguments, &flags, false);
        let key = self.single_signature_key(made, made);
        self.p.instantiations.insert(key, arguments);
    }

    /// `getObjectTypeInstantiation` of a type that `note_single_signature_type` was told of. `ObjectType.instantiations` goes by the
    /// type arguments for the outer type parameters of the declaration: the first instantiation with the same ones is the
    /// answer, whatever else `mapper` says. `instantiated`: `ty` under `mapper`. `holds`: it may be kept.
    fn single_signature_instantiation(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        instantiated: TypeId,
        holds: bool,
    ) -> TypeId {
        let noted = self.single_signature_key(ty, ty);
        let Some(arguments) = self.p.instantiations.get(&noted) else {
            return instantiated;
        };
        let arguments = self.instantiate(arguments, mapper);
        let key = self.single_signature_key(ty, arguments);
        if let Some(first) = self.p.instantiations.get(&key) {
            return first;
        }
        if instantiated == ty || !holds {
            return instantiated;
        }
        self.p.instantiations.insert(key, instantiated)
    }

    pub fn instantiate_sig(&mut self, sig: SigId, mapper: MapperId) -> SigId {
        if mapper == MapperId::IDENTITY {
            return sig;
        }
        let data = match self.p.types.sig(sig) {
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
                ret,
                this,
                of,
            } => {
                // `instantiateSignatureEx`: the type parameters that are still to be given are made anew where what is around them
                // changes, and everything in the signature speaks of the new ones.
                let mut remaining: Vec<TypeId> = Vec::with_capacity(type_params.len());
                let mut fresh: Vec<(TypeId, TypeId)> = Vec::new();
                for &param in type_params.iter() {
                    if self.p.types.map(mapper, param).is_some() {
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
                    let fresh = self.p.types.mapper(fresh);
                    self.compose(fresh, mapper)
                };
                let params: Vec<SigParam> = params
                    .iter()
                    .map(|p| SigParam {
                        ty: self.instantiate(p.ty, mapper),
                        ..p.clone()
                    })
                    .collect();
                SigData::Synth {
                    type_params: remaining.into(),
                    params: params.into(),
                    ret: self.instantiate(*ret, mapper),
                    this: this.map(|t| self.instantiate(t, mapper)),
                    of: of
                        .iter()
                        .map(|&part| self.instantiate_sig(part, mapper))
                        .collect(),
                }
            }
            // `cloneSignature` with a return type of its own, which goes through the same mapper as the rest.
            SigData::WithReturn { sig: inner, ret } => {
                let (inner, ret) = (*inner, *ret);
                let sig = self.instantiate_sig(inner, mapper);
                // That mapper begins with the type parameters made anew.
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
        self.p.types.intern_sig(data)
    }

    /// Whether `ty` is one of the type parameters `list` of `file`, as declared.
    fn is_declared_among(&self, ty: TypeId, file: FileId, list: Span<TypeParamId>) -> bool {
        matches!(*self.data(ty), TypeData::TypeParam(f, tp, MapperId::IDENTITY) if f == file && list.range().contains(&tp.idx()))
    }

    /// The type parameter `tp` of `func` as a signature of `func` that has `mapper` has it, if it is still to be given: the
    /// declared one, or the one made anew for what `mapper` says of the type parameters around the signature. Anything else it
    /// stands for is a type argument, be it the declared one (`f<T>(x)` inside `f`) or that of another instantiation.
    pub(super) fn open_type_param(
        &self,
        file: FileId,
        func: FnId,
        tp: TypeParamId,
        mapper: MapperId,
    ) -> Option<TypeId> {
        let declared = self.type_param(file, tp);
        let Some(value) = self.p.types.map(mapper, declared) else {
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
            .p
            .types
            .mapping(mapper)
            .iter()
            .copied()
            .filter(|pair| !self.is_declared_among(pair.0, file, own))
            .collect();
        (around == self.p.types.mapper(outer)).then_some(value)
    }

    /// `instantiateSignatureEx`: the mapper of a signature of `func` that has `own`, after `second`. It says what the type
    /// parameters around the signature stand for and what its own were given. One of its own that is still to be given stands for
    /// one made anew (`cloneTypeParameter`) wherever something is filled in around the signature: that may mention the declared
    /// one (`then` of what `then` returns), and means another.
    fn sig_mapper(
        &mut self,
        file: FileId,
        func: FnId,
        own: MapperId,
        second: MapperId,
    ) -> MapperId {
        let type_params = self.hir(file)[func].type_params;
        let mapping = self.p.types.mapping(own);
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> =
            smallvec::SmallVec::with_capacity(mapping.len() + type_params.len());
        for &(param, value) in mapping {
            if !self.is_declared_among(param, file, type_params) {
                pairs.push((param, self.instantiate(value, second)));
            }
        }
        if type_params.is_empty() {
            return self.p.types.mapper_of(&pairs);
        }
        let outer = pairs.len();
        let mut around = None;
        for tp in type_params.iter() {
            let declared = self.type_param(file, tp);
            match self.open_type_param(file, func, tp, own) {
                // `second` goes by what the signature has.
                Some(open) => match self.p.types.map(second, open) {
                    Some(given) => pairs.push((declared, given)),
                    None => {
                        // Where nothing is filled in it is the declared one, which needs no saying.
                        let around =
                            *around.get_or_insert_with(|| self.p.types.mapper_of(&pairs[..outer]));
                        let fresh = self.cloned_type_param(file, tp, around);
                        if fresh != declared {
                            pairs.push((declared, fresh));
                        }
                    }
                },
                None => {
                    if let Some(given) = self.p.types.map(own, declared) {
                        pairs.push((declared, self.instantiate(given, second)));
                    }
                }
            }
        }
        self.p.types.mapper_of(&pairs)
    }

    /// The same of a construct signature of `class`, whose type parameters are those of the class. They are not made anew.
    fn class_sig_mapper(&mut self, class: Sym, own: MapperId, second: MapperId) -> MapperId {
        let mut pairs: smallvec::SmallVec<[(TypeId, TypeId); 8]> = smallvec::SmallVec::new();
        for &(param, value) in self.p.types.mapping(own) {
            pairs.push((param, self.instantiate(value, second)));
        }
        // Those of what the class is declared in count as well: its static side is instantiated with them
        // (`getObjectTypeInstantiation`, `resolveAnonymousTypeMembers`).
        for param in self.all_type_params_of_symbol(class).iter().copied() {
            if self.p.types.map(own, param).is_none()
                && let Some(value) = self.p.types.map(second, param)
            {
                pairs.push((param, value));
            }
        }
        self.p.types.mapper_of(&pairs)
    }

    /// `getReturnTypeOfSignature`, `getTypePredicateOfSignature`: what `signature.target` has, through `signature.mapper`. `ty`: what
    /// `func` is declared to return or to assert. A signature of `func` that was given type arguments is an instantiation of the
    /// one found where the type parameters around it stand for what `mapper` says, so `ty` goes through that first and through
    /// the type arguments after. By then `unknown | U` is `unknown` and `any & U` is `any`, which only `any` and `never` for `U`
    /// would have come out on top of: with other type arguments one step comes to the same. The types of parameters go
    /// through both at once (`instantiateSymbol`).
    pub(super) fn instantiate_result_of_sig(
        &mut self,
        ty: TypeId,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> TypeId {
        let own = self.hir(file)[func].type_params;
        let may_differ = !own.is_empty()
            && self.p.types.mapping(mapper).iter().any(|pair| {
                (self.has_any_flag(pair.1) || pair.1.is_never())
                    && self.is_declared_among(pair.0, file, own)
            });
        if !may_differ {
            return self.instantiate(ty, mapper);
        }
        let mut first: smallvec::SmallVec<[(TypeId, TypeId); 8]> = self
            .p
            .types
            .mapping(mapper)
            .iter()
            .copied()
            .filter(|pair| !self.is_declared_among(pair.0, file, own))
            .collect();
        // Nothing is filled in around it: it is an instantiation of the declared one.
        if first.iter().all(|pair| pair.0 == pair.1) {
            return self.instantiate(ty, mapper);
        }
        let around = self.p.types.mapper_of(&first);
        let mut second: smallvec::SmallVec<[(TypeId, TypeId); 4]> = smallvec::SmallVec::new();
        for tp in own.iter() {
            let declared = self.type_param(file, tp);
            if let Some(given) = self.p.types.map(mapper, declared) {
                let open = self.cloned_type_param(file, tp, around);
                first.push((declared, open));
                if given != open {
                    second.push((open, given));
                }
            }
        }
        let (first, second) = (
            self.p.types.mapper_of(&first),
            self.p.types.mapper_of(&second),
        );
        let open = self.instantiate(ty, first);
        self.instantiate(open, second)
    }
}
