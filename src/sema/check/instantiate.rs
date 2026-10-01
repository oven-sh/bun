//! Replacing type parameters by what they stand for.

use super::*;

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
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for &(param, value) in self.p.types.mapping(first) {
            pairs.push((param, self.instantiate(value, second)));
        }
        for &(param, value) in self.p.types.mapping(second) {
            if self.p.types.map(first, param).is_none() {
                pairs.push((param, value));
            }
        }
        self.p.types.mapper(pairs)
    }

    /// `first`, then `second`, for the parameters `first` is about.
    pub fn map_mapper(&mut self, first: MapperId, second: MapperId) -> MapperId {
        if first == MapperId::IDENTITY || second == MapperId::IDENTITY {
            return first;
        }
        let mapping = self.p.types.mapping(first);
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::with_capacity(mapping.len());
        let mut changed = false;
        for &(param, value) in mapping {
            let new = self.instantiate(value, second);
            changed |= new != value;
            pairs.push((param, new));
        }
        if !changed {
            return first;
        }
        self.p.types.mapper(pairs)
    }

    pub fn instantiate_all(&mut self, types: &[TypeId], mapper: MapperId) -> Vec<TypeId> {
        types.iter().map(|&t| self.instantiate(t, mapper)).collect()
    }

    /// `instantiateTypeWithAlias`
    pub fn instantiate(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        self.time_trap();
        self.guard("instantiate");
        if mapper == MapperId::IDENTITY || !self.has_type_variables(ty) {
            return ty;
        }
        match self.data(ty) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) => {
                return self.p.types.map(mapper, ty).unwrap_or(ty);
            }
            _ => {}
        }
        let key = Deep::Instantiation(ty, mapper);
        if let Some(known) = self.p.instantiations.get(&(ty, mapper)) {
            self.note_depth(key, None);
            return known;
        }
        if self.instantiation_depth > 95 {
            // `getConditionalType` follows a tail call in a loop, at one `instantiationDepth`. `conditional_type` recurses, so
            // under a conditional type this depth is not comparable with tsgo's: the result is unknown and nothing is reported.
            if self.stack.iter().any(|q| matches!(q, Query::Cond(..))) {
                return TypeId::UNRESOLVED;
            }
            // `instantiationDepth == 100`: 2589 and the error type, which is cached like any other result.
            if self.instantiation_depth >= 100 {
                return self.excessively_deep();
            }
        }
        self.instantiation_depth += 1;
        let (cycles_before, events_before) = (self.cycles, self.deep_events);
        let result = self.instantiate_uncached(ty, mapper);
        self.instantiation_depth -= 1;
        if self.cycles == cycles_before {
            self.note_depth(key, Some(events_before));
            self.p.instantiations.insert((ty, mapper), result);
        }
        result
    }

    fn instantiate_uncached(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
        match self.data(ty) {
            // `instantiateTypeWorker`: what does not change stays as it is, unreduced if it was.
            TypeData::Union(members) => {
                // A union distributed from an intersection is instantiated through that intersection, its `origin`.
                if let Some(origin) = self.p.union_origins.get(&ty) {
                    let new = self.instantiate_all(&origin, mapper);
                    if new[..] == origin[..] {
                        return ty;
                    }
                    return self.intersection(&new);
                }
                let new = self.instantiate_all(members, mapper);
                if new[..] == members[..] {
                    return ty;
                }
                self.union(&new)
            }
            TypeData::Intersection(members) => {
                let new = self.instantiate_all(members, mapper);
                if new[..] == members[..] {
                    return ty;
                }
                self.intersection(&new)
            }
            TypeData::Ref { target, args } => {
                let args = self.instantiate_all(args, mapper);
                self.intern(TypeData::Ref {
                    target: *target,
                    args: args.into(),
                })
            }
            TypeData::LazyAlias { sym, args } => {
                let args = self.instantiate_all(args, mapper);
                self.intern(TypeData::LazyAlias {
                    sym: *sym,
                    args: args.into(),
                })
            }
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => {
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
                    return self.instantiate_mapped(file, node, new);
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
                let mut new = Shape {
                    literal: shape.literal,
                    ..Shape::default()
                };
                for p in &shape.props {
                    let mut p = p.clone();
                    match p.source {
                        PropSource::Type(t) => {
                            p.source = PropSource::Type(self.instantiate(t, mapper))
                        }
                        _ => p.mapper = self.compose(p.mapper, mapper),
                    }
                    new.props.push(p);
                }
                for i in &shape.index {
                    new.index.push(IndexInfo {
                        key: self.instantiate(i.key, mapper),
                        value: self.instantiate(i.value, mapper),
                        readonly: i.readonly,
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
                self.synth(new)
            }
            TypeData::Cond {
                file,
                node,
                mapper: own,
            } => {
                let new = self.map_mapper(*own, mapper);
                // `getConditionalType` returns the error type for a check type that is the error type. The error type is `any`
                // here, and a tuple type argument instantiates to `any` only as the error type.
                let (before, after) = (self.p.types.mapping(*own), self.p.types.mapping(new));
                if before
                    .iter()
                    .zip(after)
                    .any(|(b, a)| a.1 == TypeId::ANY && self.is_tuple(b.1))
                {
                    return TypeId::ANY;
                }
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
            TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            } => {
                // `cond_true_under` maps the checked `T[K]` of a conditional type as a whole: in the true branch it is a
                // substitution type (`getConditionalFlowTypeOfType`).
                if let Some(substituted) = self.p.types.map(mapper, ty) {
                    return substituted;
                }
                let undefined = *undefined;
                let (obj, index) = (
                    self.instantiate(*obj, mapper),
                    self.instantiate(*index, mapper),
                );
                // `getIndexedAccessTypeEx(.., t.accessFlags, nil)`: there is no node to complain at, so what is not there is `unknown`.
                self.indexed_access_flagged(obj, index, undefined)
                    .unwrap_or(TypeId::UNKNOWN)
            }
            TypeData::Keyof(t) => {
                let t = self.instantiate(*t, mapper);
                self.keyof(t)
            }
            TypeData::NoInfer(t) => {
                let t = self.instantiate(*t, mapper);
                self.no_infer(t)
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
        // An alias is what it stands for. `NoInfer<T>` waits as a type parameter does.
        let elems: Vec<TypeId> = elems
            .iter()
            .zip(flags)
            .map(|(&elem, flag)| {
                if flag.contains(ElemFlags::VARIADIC) && !self.is_no_infer(elem) {
                    self.force(elem)
                } else {
                    elem
                }
            })
            .collect();
        let is_spread = |i: usize| flags[i].contains(ElemFlags::VARIADIC);
        // `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`, and `[A, ...never]` is `never`.
        if let Some(i) = (0..elems.len())
            .find(|&i| is_spread(i) && (elems[i] == TypeId::NEVER || self.is_union(elems[i])))
        {
            // `checkCrossProductUnion`: from 100,000 on it is too complex to represent (2590), and what is spread is taken for an array.
            let size = (0..elems.len())
                .filter(|&j| is_spread(j))
                .fold(1usize, |n, j| n.saturating_mul(self.parts(elems[j]).len()));
            if size < 100_000 {
                let mut with = elems.clone();
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
                out_flags.push(ElemFlags::REST);
                continue;
            }
            // What is generic stays as it is: `TypeFlagsInstantiableNonPrimitive`, `isGenericMappedType`.
            let waits = match self.data(elem) {
                TypeData::TypeParam(..)
                | TypeData::ThisParam(_)
                | TypeData::Marker(_)
                | TypeData::IndexedAccess { .. }
                | TypeData::Cond { .. }
                | TypeData::NoInfer(_) => true,
                TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                } => self.is_generic(elem),
                // An alias that is still being worked out is looked at again when it is instantiated.
                TypeData::LazyAlias { .. } => {
                    self.is_no_infer(elem) || self.has_type_variables(elem)
                }
                _ => false,
            };
            if waits {
                out_elems.push(elem);
                out_flags.push(ElemFlags::VARIADIC);
                continue;
            }
            if let TypeData::Tuple {
                elems: inner,
                flags: inner_flags,
                ..
            } = self.data(elem)
            {
                // Too large to represent (2799, 2800): the error type.
                if inner.len() + out_elems.len() >= 10_000 {
                    // `c.error(c.currentNode, ..)`: 2799 is reported at the innermost type node being resolved. Inside an
                    // expression the error is 2800, which is not recorded here.
                    if let Some(&Query::TypeNode(file, node)) = self
                        .stack
                        .iter()
                        .rev()
                        .find(|q| matches!(q, Query::TypeNode(..) | Query::Expr(..)))
                    {
                        self.p.too_large_tuples.insert((file, node), ());
                    }
                    return TypeId::ANY;
                }
                out_elems.extend_from_slice(inner);
                out_flags.extend_from_slice(inner_flags);
                continue;
            }
            // Anything else is taken for an array.
            let element = match self.array_element(elem) {
                Some(element) => element,
                None if matches!(self.data(elem), TypeData::LazyAlias { .. })
                    || !self.is_known(elem) =>
                {
                    TypeId::UNRESOLVED
                }
                None => {
                    // `isArrayLikeType`, `getIndexTypeOfType(t, numberType)`. What is not like an array is an error.
                    let mut found = None;
                    if self.is_array_like(elem) {
                        let apparent = self.apparent_type(elem);
                        if let Some(members) = self.members(apparent)
                            && let Some(info) = members
                                .shape()
                                .index
                                .iter()
                                .find(|info| info.key == TypeId::NUMBER)
                        {
                            found = Some(self.instantiate(info.value, members.mapper));
                        }
                    }
                    found.unwrap_or(TypeId::ANY)
                }
            };
            out_elems.push(element);
            out_flags.push(ElemFlags::REST);
        }
        self.tuple(&out_elems, &out_flags, readonly)
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
        let mut pairs: Vec<(TypeId, TypeId)> =
            Vec::with_capacity(mapping.len() + type_params.len());
        for &(param, value) in mapping {
            if !self.is_declared_among(param, file, type_params) {
                pairs.push((param, self.instantiate(value, second)));
            }
        }
        if type_params.is_empty() {
            return self.p.types.mapper(pairs);
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
                        let around = *around
                            .get_or_insert_with(|| self.p.types.mapper(pairs[..outer].to_vec()));
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
        self.p.types.mapper(pairs)
    }

    /// The same of a construct signature of `class`, whose type parameters are those of the class. They are not made anew.
    fn class_sig_mapper(&mut self, class: Sym, own: MapperId, second: MapperId) -> MapperId {
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
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
        self.p.types.mapper(pairs)
    }
}
