//! `Type.alias`. A type that's interned structurally (a union, an intersection, a tuple, a
//! reference, an indexed access) stores it as part of its interning key. A type that's identified
//! by its type node (a type literal, a function type, a mapped type, a conditional type) has the
//! alias whose body is that node, and only stores one if it was instantiated under a different
//! alias (`getTypeFromTypeAliasReference`).

use super::links::AliasArguments;
use super::*;
use crate::bind::ScopeId;
use smallvec::SmallVec;

static NO_ORIGIN: UnionOrigin = UnionOrigin::None;

/// The alias passed to `instantiateMappedType`.
#[derive(Clone, Copy)]
pub(super) enum NewAlias<'a> {
    /// `getObjectTypeInstantiation` without an alias: `instantiateTypeAlias(t.alias, m)` for a type
    /// that doesn't store an alias. It's the alias whose body is the node, instantiated with the
    /// mapper.
    OfNode,
    Given(Sym, &'a [TypeId]),
}

impl<'p, 's> Checker<'p, 's> {
    /// `UnionType.origin`
    #[inline]
    pub(super) fn origin(&self, ty: TypeId) -> &'p UnionOrigin<'p> {
        match self.types().provenance(ty) {
            Some(provenance) => &provenance.origin,
            None => &NO_ORIGIN,
        }
    }

    /// Interns `key` with `alias` as `Type.alias` and `origin` as `UnionType.origin`.
    pub(super) fn intern_key_with_alias(
        &self,
        key: TypeKey<'_>,
        alias: Option<(Sym, &[TypeId])>,
        origin: OriginKey<'_>,
    ) -> TypeId {
        let is_enum =
            alias.is_some_and(|(alias, _)| self.files().flags(alias).intersects(SymFlags::ENUM));
        // `!isNonGenericTopLevelType`
        let has_other_instantiation = alias.is_some_and(|(alias, type_arguments)| {
            type_arguments.is_empty()
                && self
                    .types()
                    .has_constituent_with_other_instantiation(key, origin)
                && !self.is_non_generic_top_level_alias(alias)
        });
        self.types().intern_key_with(
            key,
            &ProvenanceKey {
                alias,
                origin,
                is_enum,
                stored_under: None,
                is_array_literal: false,
                is_array_pattern: false,
                has_other_instantiation,
            },
        )
    }

    /// `getUnionTypeFromSortedList`: returns a union with `union`'s members, `origin` and no alias.
    pub(super) fn with_origin(&self, union: TypeId, origin: OriginKey<'_>) -> TypeId {
        self.intern_key_with_alias(TypeKey::Data(self.data(union)), None, origin)
    }

    /// The alias stored in `ty`.
    #[inline]
    pub(super) fn stored_alias(&self, ty: TypeId) -> Option<&'p (Sym, ArenaBox<'p, [TypeId]>)> {
        self.types().provenance(ty)?.alias.as_ref()
    }

    /// Returns `ty` with `alias` and `type_arguments` as `Type.alias`.
    pub(super) fn with_alias(&self, ty: TypeId, alias: Sym, type_arguments: &[TypeId]) -> TypeId {
        let key = TypeKey::Data(self.data(ty));
        let alias = Some((alias, type_arguments));
        self.intern_key_with_alias(key, alias, self.origin(ty).into())
    }

    /// The end of `getUnionTypeWorker` when it's given an alias. `created` is the union without the
    /// alias. If a named union already has every member, `getUnionTypeWorker` returns it when
    /// there's no alias and uses it as the `origin` when there is one.
    pub(super) fn union_type_with_alias(
        &self,
        created: TypeId,
        alias: Sym,
        type_arguments: &[TypeId],
    ) -> TypeId {
        // `addNamedUnions`
        let is_named = match self.types().provenance(created) {
            Some(own) => match own.origin {
                UnionOrigin::None | UnionOrigin::Union(_) => own.alias.is_some() && !own.is_enum,
                UnionOrigin::Intersection(_) | UnionOrigin::Keyof(_) => true,
            },
            None => false,
        };
        if !is_named {
            return self.with_alias(created, alias, type_arguments);
        }
        let origin = [created];
        let could_contain_type_variables = !self.is_non_generic_top_level_alias(alias)
            && (self.parts(created).iter()).any(|&t| self.could_contain_type_variables(t));
        let provenance = ProvenanceKey {
            alias: Some((alias, type_arguments)),
            origin: OriginKey::Union(&origin),
            is_enum: false,
            stored_under: None,
            is_array_literal: false,
            is_array_pattern: false,
            has_other_instantiation: could_contain_type_variables,
        };
        (self.types()).intern_key_with(TypeKey::Data(self.data(created)), &provenance)
    }

    /// `t.alias`. A type identified by its type node has the alias whose body is that node, with
    /// the alias's type parameters instantiated by the type's mapper.
    pub(super) fn alias_of_type(&self, ty: TypeId) -> Option<(Sym, AliasArguments)> {
        if let Some((alias, type_arguments)) = self.stored_alias(ty) {
            return Some((*alias, SmallVec::from_slice(type_arguments)));
        }

        self.alias_symbol_of_type(ty)?;
        self.derive_alias_of_node_type(ty)
    }

    /// Computes `alias_of_type` for a type that doesn't store its alias.
    fn derive_alias_of_node_type(&self, ty: TypeId) -> Option<(Sym, AliasArguments)> {
        let (file, node, mapper) = self.alias_node_of_type(ty)?;
        let (alias, type_arguments) = self.alias_of_node_under(file, node, mapper)?;
        Some((alias, SmallVec::from_vec(type_arguments)))
    }

    /// `t.alias.symbol`, without computing the alias type arguments.
    pub(super) fn alias_symbol_of_type(&self, ty: TypeId) -> Option<Sym> {
        // FOR SPEED: tsgo reads a field of the type. `CompareTypes` looks this up for both types of
        // every comparison, and for the members of intersections.

        if let Some(cached) = self.links.alias_symbol(ty) {
            return cached;
        }
        let alias = self.derive_alias_symbol_of_type(ty);
        self.links.cache_alias_symbol(ty, alias);
        alias
    }

    fn derive_alias_symbol_of_type(&self, ty: TypeId) -> Option<Sym> {
        match self.stored_alias(ty) {
            Some((alias, _)) => Some(*alias),
            None => self.alias_node_of_type(ty).and_then(|(file, node, _)| {
                let scope = self.bound(file).type_scope[node.idx()];
                self.alias_symbol_for_type_node(file, scope, node)
            }),
        }
    }

    /// The type node that identifies `ty`, and its mapper. A type that doesn't store an alias has
    /// the alias whose body is that node.
    fn alias_node_of_type(&self, ty: TypeId) -> Option<(FileId, TypeNodeId, MapperId)> {
        Some(match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                mapper,
            }
            | TypeData::Cond {
                file, node, mapper, ..
            } => (file, node, mapper),
            TypeData::Fns { ref decls, mapper } => {
                let [(file, func)] = decls[..] else {
                    return None;
                };
                let crate::bind::FnOwner::Type(node) = self.bound(file).fns[func.idx()].owner
                else {
                    return None;
                };
                (file, node, mapper)
            }
            _ => return None,
        })
    }

    /// The alias whose body is `node`, with its type parameters instantiated by `mapper`.
    pub(super) fn alias_of_node_under(
        &self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> Option<(Sym, Vec<TypeId>)> {
        let scope = self.bound(file).type_scope[node.idx()];
        let (alias, parameters) = self.alias_for_type_node(file, scope, node)?;
        let map = |&parameter: &TypeId| self.types().map(mapper, parameter).unwrap_or(parameter);
        Some((alias, parameters.iter().map(map).collect()))
    }

    /// Returns `created` with the given `newAlias`. `created` is an instantiation that
    /// `getObjectTypeInstantiation` stores under
    /// `getTypeInstantiationKey(typeArguments, newAlias)`. If `newAlias` equals the alias that
    /// `created` already has from its node, the result doesn't store an alias, so both ways of
    /// passing it produce the same key.
    pub(super) fn with_alias_of_instantiation(
        &self,
        created: TypeId,
        alias: Sym,
        type_arguments: &[TypeId],
    ) -> TypeId {
        let node_and_mapper = self.alias_node_of_type(created);
        let is_alias_of_node = node_and_mapper.is_some_and(|(file, node, mapper)| {
            let scope = self.bound(file).type_scope[node.idx()];
            if self.alias_symbol_for_type_node(file, scope, node) != Some(alias) {
                return false;
            }
            let parameters = self.local_type_params_of_symbol(alias);
            let map = |parameter: TypeId| self.types().map(mapper, parameter).unwrap_or(parameter);
            parameters.len() == type_arguments.len()
                && (parameters.iter().zip(type_arguments))
                    .all(|(&parameter, &argument)| map(parameter) == argument)
        });
        if is_alias_of_node {
            self.intern_key(TypeKey::Data(self.data(created)))
        } else {
            self.with_alias(created, alias, type_arguments)
        }
    }

    /// If `source.alias.symbol == target.alias.symbol`, returns that alias,
    /// `fillMissingTypeArguments` of each type's alias type arguments, and
    /// `len(source.alias.typeArguments) != 0`. Both lists are empty if neither type has any. Also
    /// returns `None` while the alias is in progress, because nothing can be measured yet.
    pub(super) fn same_alias(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> Option<(Sym, AliasArguments, AliasArguments, bool)> {
        // Fast path for the common failure. Two types that don't store an alias only have the same
        // alias if they have the same type node, because an alias declaration has one body.
        if self.stored_alias(source).is_none() && self.stored_alias(target).is_none() {
            let (source, target) = (
                self.alias_node_of_type(source)?,
                self.alias_node_of_type(target)?,
            );
            if (source.0, source.1) != (target.0, target.1) {
                return None;
            }
        }
        // The symbols are compared before any alias type argument is computed.
        let alias = self.alias_symbol_of_type(source)?;
        if self.alias_symbol_of_type(target)? != alias
            || self.stack.contains(&Query::Declared(alias))
        {
            return None;
        }
        let ((_, sources), (_, targets)) =
            (self.alias_of_type(source)?, self.alias_of_type(target)?);
        if sources.is_empty() && targets.is_empty() {
            return Some((alias, sources, targets, false));
        }
        let has_type_arguments = !sources.is_empty();
        let params = self.local_type_params_of_symbol(alias);
        let sources = self.fill_alias_arguments(&params, sources);
        let targets = self.fill_alias_arguments(&params, targets);
        Some((alias, sources, targets, has_type_arguments))
    }

    /// `fillMissingTypeArguments`. Returns a complete list unchanged.
    fn fill_alias_arguments(
        &mut self,
        params: &[TypeId],
        type_arguments: AliasArguments,
    ) -> AliasArguments {
        if type_arguments.len() == params.len() {
            return type_arguments;
        }
        SmallVec::from_vec(self.fill_type_args(params, &type_arguments))
    }

    /// `getAliasForTypeNode`
    pub(super) fn alias_for_type_node(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<(Sym, SmallVec<[TypeId; 4]>)> {
        let alias = self.alias_symbol_for_type_node(file, scope, node)?;
        Some((alias, self.local_type_params_of_symbol(alias)))
    }

    /// `getAliasSymbolForTypeNode`
    fn alias_symbol_for_type_node(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<Sym> {
        let alias = self.alias_with_body(file, scope, node)?;
        let symbol = self.bound(file).alias_symbol[alias.idx()];
        if symbol.is_none() {
            return None;
        }
        let alias = self.files().sym(file, symbol);
        // If a class or an interface has the same name, the name refers to it.
        if self
            .files()
            .flags(alias)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return None;
        }
        Some(alias)
    }

    /// Does what `getTypeFromUnionTypeNode` does with `getAliasForTypeNode(node)`. `ty` is the type
    /// that `node` resolves to.
    pub(super) fn with_alias_for_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        ty: TypeId,
    ) -> TypeId {
        if !self.bound(file).type_by_alias[node.idx()]
            || !matches!(self.hir(file)[node].kind, TypeNodeKind::Union(_))
            || !self.is_union(ty)
        {
            return ty;
        }
        let scope = self.bound(file).type_scope[node.idx()];
        match self.alias_for_type_node(file, scope, node) {
            Some((alias, type_arguments)) => self.union_type_with_alias(ty, alias, &type_arguments),
            None => ty,
        }
    }

    /// `instantiateTypeWithAlias`, given an alias.
    pub(super) fn instantiate_with_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: (Sym, &[TypeId]),
    ) -> TypeId {
        if self.types().instantiation_class(ty) == InstantiationClass::Unchanged {
            return ty;
        }
        // For any other type the worker calls `instantiate`, which counts the instantiation level itself.
        let is_instantiated_here = self.types().deferred(ty).is_some()
            || match self.data(ty) {
                TypeData::Union(_)
                | TypeData::Intersection(_)
                | TypeData::IndexedAccess { .. }
                | TypeData::Cond { .. }
                | TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                } => true,
                TypeData::Tuple { .. } => self.stored_alias(ty).is_none(),
                _ => false,
            };
        if !is_instantiated_here {
            return self.instantiate_with_alias_worker(ty, mapper, alias);
        }
        self.in_instantiation(mapper, |c| {
            c.instantiate_with_alias_worker(ty, mapper, alias)
        })
    }

    fn instantiate_with_alias_worker(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: (Sym, &[TypeId]),
    ) -> TypeId {
        if self.types().deferred(ty).is_some() {
            return self.instantiate_deferred_type_reference(ty, mapper, Some(alias));
        }
        match self.data(ty) {
            TypeData::Union(_) | TypeData::Intersection(_) => {
                self.instantiate_union_or_intersection(ty, mapper, Some(alias))
            }
            TypeData::IndexedAccess { .. } => {
                self.instantiate_indexed_access(ty, mapper, Some(alias))
            }
            &TypeData::Cond {
                file,
                node,
                mapper: own,
                ..
            } => {
                let new = self.map_mapper(own, mapper);
                self.conditional_type_instantiation(file, node, new, Some(alias))
            }
            &TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper: own,
            } => {
                let new = self.map_mapper(own, mapper);
                if new == own {
                    return ty;
                }
                self.instantiate_mapped_type(file, node, new, NewAlias::Given(alias.0, alias.1))
            }
            // Only a deferred type reference goes through `getObjectTypeInstantiation`. It's the
            // body of an alias and has that alias.
            TypeData::Ref { .. } if self.stored_alias(ty).is_none() => self.instantiate(ty, mapper),
            // Only `links.instantiations`, whose key includes the alias, caches the result, so
            // `createNormalizedTupleType` reports a tuple that's too large once per alias.
            TypeData::Tuple {
                flags, readonly, ..
            } if self.stored_alias(ty).is_none() => {
                let elems = self.type_arguments(ty);
                let elems = self.instantiate_all(elems, mapper);
                self.normalized_tuple(&elems, flags, *readonly)
            }
            _ => {
                let result = self.instantiate(ty, mapper);
                self.with_new_alias(ty, mapper, result, Some(alias))
            }
        }
    }

    /// Applies `getObjectTypeInstantiation`'s `newAlias` to `result`, the instantiation of `ty`
    /// with `mapper`. `newAlias` is `alias`, or else `instantiateTypeAlias(t.alias, m)` if `ty`
    /// stores an alias.
    pub(super) fn with_new_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        result: TypeId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let own_alias = self.stored_alias(ty);
        if alias.is_none() && own_alias.is_none() || self.types().deferred(result).is_some() {
            return result;
        }
        // `createDeferredTypeReference`, `instantiateAnonymousType`
        let is_instantiation = match (self.data(ty), self.data(result)) {
            (
                TypeData::Ref { .. } | TypeData::Tuple { .. },
                TypeData::Ref { .. } | TypeData::Tuple { .. },
            )
            | (TypeData::Fns { .. }, TypeData::Fns { .. })
            | (TypeData::Synth(_), TypeData::Synth(_)) => true,
            (TypeData::Anon { origin: a, .. }, TypeData::Anon { origin: b, .. }) => a == b,
            _ => false,
        };
        if !is_instantiation {
            return result;
        }
        match (alias, own_alias) {
            // A type that doesn't reference a type parameter isn't instantiated.
            (Some(_), _) if result == ty => ty,
            (Some((alias, type_arguments)), _) => {
                self.with_alias_of_instantiation(result, alias, type_arguments)
            }
            // A stored alias has a different symbol than the node's alias, or fewer type arguments.
            (None, Some((alias, type_arguments))) => {
                let instantiated = self.instantiate_all(type_arguments, mapper);
                if result == ty && instantiated[..] == type_arguments[..] {
                    return ty;
                }
                self.with_alias(result, *alias, &instantiated)
            }
            (None, None) => result,
        }
    }

    /// The branch of `instantiateTypeWorker` for a union or an intersection.
    pub(super) fn instantiate_union_or_intersection(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        // Instantiates through its `origin`, if that's a union or an intersection.
        let (types, is_intersection): (&[TypeId], _) = match (self.data(ty), self.origin(ty)) {
            (TypeData::Union(_), UnionOrigin::Intersection(origin)) => (origin, true),
            (TypeData::Union(_), UnionOrigin::Union(origin)) => (origin, false),
            (TypeData::Union(members), _) => (members, false),
            (TypeData::Intersection(members), _) => (members, true),
            _ => return ty,
        };
        let new = self.instantiate_all(types, mapper);
        let own = self.stored_alias(ty);
        // A declared type has no mapper in tsgo. Here it has a mapper of identity pairs.
        if new[..] == *types
            && (alias.map(|alias| alias.0) == own.map(|own| own.0)
                || alias.is_none() && !self.is_instantiating(mapper))
        {
            return ty;
        }
        let instantiated;
        let alias = match (alias, own) {
            (None, Some((symbol, type_arguments))) => {
                instantiated = self.instantiate_all(type_arguments, mapper);
                Some((*symbol, &instantiated[..]))
            }
            _ => alias,
        };
        if is_intersection {
            self.intersection_with_alias(&new, alias)
        } else {
            self.union_with_alias(&new, alias)
        }
    }

    /// The branch of `instantiateTypeWorker` for an indexed access.
    pub(super) fn instantiate_indexed_access(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let &TypeData::IndexedAccess {
            obj: declared,
            index,
            undefined,
        } = self.data(ty)
        else {
            return ty;
        };
        let (obj, index) = (
            self.instantiate(declared, mapper),
            self.instantiate(index, mapper),
        );
        let instantiated;
        let alias = match (alias, self.stored_alias(ty)) {
            (None, Some((symbol, type_arguments))) => {
                instantiated = self.instantiate_all(type_arguments, mapper);
                Some((*symbol, &instantiated[..]))
            }
            _ => alias,
        };
        // `getIndexedAccessTypeEx(.., t.accessFlags, nil)`: there is no node to report at, so a
        // missing property is `unknown`.
        self.indexed_access_flagged(obj, index, undefined, alias)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// Returns `ty` as `createTypeReference` creates it: a reference or a tuple without the alias
    /// it has as a deferred reference.
    pub(super) fn without_alias_of_reference(&mut self, ty: TypeId) -> TypeId {
        if self.stored_alias(ty).is_none() && self.types().deferred(ty).is_none() {
            return ty;
        }
        let arguments = self.type_arguments(ty);
        self.create_type_reference(ty, arguments)
    }
}
