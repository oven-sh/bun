//! `Type.alias`. A type that is interned structurally (a union, an intersection, a tuple, a
//! reference, an indexed access) stores it as part of its interning key. A type that is identified
//! by its type node (a type literal, a function type, a mapped type, a conditional type) has the
//! alias whose body is that node, and stores one only if it was instantiated under a different
//! alias (`getTypeFromTypeAliasReference`).

use super::*;
use crate::bind::ScopeId;
use smallvec::SmallVec;

static NO_ORIGIN: UnionOrigin = UnionOrigin::None;

/// The alias passed to `instantiateMappedType`.
#[derive(Clone, Copy)]
pub(super) enum NewAlias<'a> {
    None,
    /// `getObjectTypeInstantiation` without an alias: `instantiateTypeAlias(t.alias, m)` for a type
    /// that stores no alias. It is the alias whose body is the node, instantiated with the mapper.
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

    /// `getUnionTypeFromSortedList`: the members of `union`, with `origin` and no alias.
    pub(super) fn with_origin(&self, union: TypeId, origin: OriginKey<'_>) -> TypeId {
        self.types().intern_key_with(
            TypeKey::Data(self.data(union)),
            ProvenanceKey {
                alias: None,
                origin,
                is_enum: false,
            },
        )
    }

    /// The alias stored in `ty`.
    #[inline]
    pub(super) fn stored_alias(&self, ty: TypeId) -> Option<&'p (Sym, ArenaBox<'p, [TypeId]>)> {
        self.types().provenance(ty)?.alias.as_ref()
    }

    /// `ty` with `alias` and `type_arguments` as `Type.alias`.
    pub(super) fn with_alias(&self, ty: TypeId, alias: Sym, type_arguments: &[TypeId]) -> TypeId {
        self.types().intern_key_with(
            TypeKey::Data(self.data(ty)),
            ProvenanceKey {
                alias: Some((alias, type_arguments)),
                origin: self.origin(ty).into(),
                is_enum: self.files().flags(alias).intersects(SymFlags::ENUM),
            },
        )
    }

    /// The end of `getUnionTypeWorker`, given an alias. `created` is the union without one. A named
    /// union that has every member is the result without an alias, and the `origin` with one.
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
        let provenance = ProvenanceKey {
            alias: Some((alias, type_arguments)),
            origin: OriginKey::Union(&origin),
            is_enum: false,
        };
        (self.types()).intern_key_with(TypeKey::Data(self.data(created)), provenance)
    }

    /// `t.alias`. A type identified by its type node has the alias whose body is that node, with
    /// the type parameters of the alias instantiated by the mapper of the type.
    pub(super) fn alias_of_type(&self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        if let Some((alias, type_arguments)) = self.stored_alias(ty) {
            return Some((*alias, type_arguments.to_vec()));
        }
        let (file, node, mapper) = self.alias_node_of_type(ty)?;
        self.alias_of_node_under(file, node, mapper)
    }

    /// `t.alias.symbol`, without computing the alias type arguments.
    pub(super) fn alias_symbol_of_type(&self, ty: TypeId) -> Option<Sym> {
        if let Some((alias, _)) = self.stored_alias(ty) {
            return Some(*alias);
        }
        let (file, node, _) = self.alias_node_of_type(ty)?;
        self.alias_symbol_for_type_node(file, self.bound(file).type_scope[node.idx()], node)
    }

    /// The type node that identifies `ty`, and its mapper. A type that stores no alias has the alias whose body is that node.
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

    /// `source.alias.symbol == target.alias.symbol`: that alias, and `fillMissingTypeArguments` of
    /// the type arguments of each. Both lists are empty if neither has any. The flag:
    /// `len(source.alias.typeArguments) != 0`. Also `None` while the alias is in progress: nothing
    /// can be measured.
    pub(super) fn same_alias(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> Option<(Sym, Vec<TypeId>, Vec<TypeId>, bool)> {
        // Fast path for the common failure. Two types that store no alias have the same alias only
        // if they have the same type node: an alias declaration has one body.
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
        let sources = self.fill_type_args(&params, &sources);
        let targets = self.fill_type_args(&params, &targets);
        Some((alias, sources, targets, has_type_arguments))
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

    /// What `getTypeFromUnionTypeNode` does with `getAliasForTypeNode(node)`. `ty`: the type `node`
    /// resolves to.
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
        if !self.has_type_variables(ty)
            && !self.stored_alias(ty).is_some_and(|own| {
                own.1
                    .iter()
                    .any(|&argument| self.has_type_variables(argument))
            })
        {
            return ty;
        }
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
            // Only a deferred type reference goes through `getObjectTypeInstantiation`: it is the
            // body of an alias and has that alias.
            TypeData::Ref { .. } | TypeData::Tuple { .. } if self.stored_alias(ty).is_none() => {
                self.instantiate(ty, mapper)
            }
            _ => {
                let result = self.instantiate(ty, mapper);
                self.with_new_alias(ty, mapper, result, Some(alias))
            }
        }
    }

    /// `newAlias` of `getObjectTypeInstantiation`, applied to `result`, the instantiation of `ty`
    /// with `mapper`: `alias`, or else `instantiateTypeAlias(t.alias, m)` if `ty` stores one.
    pub(super) fn with_new_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        result: TypeId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let kept = self.stored_alias(ty);
        if alias.is_none() && kept.is_none() || self.types().deferred(result).is_some() {
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
        match (alias, kept) {
            // A type that references no type parameter is not instantiated.
            (Some(_), _) if result == ty => ty,
            (Some((alias, type_arguments)), _) => self.with_alias(result, alias, type_arguments),
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
        // Through its `origin`, if that is a union or an intersection.
        let (types, is_intersection): (&[TypeId], _) = match (self.data(ty), self.origin(ty)) {
            (TypeData::Union(_), UnionOrigin::Intersection(origin)) => (origin, true),
            (TypeData::Union(_), UnionOrigin::Union(origin)) => (origin, false),
            (TypeData::Union(members), _) => (members, false),
            (TypeData::Intersection(members), _) => (members, true),
            _ => return ty,
        };
        let new = self.instantiate_all(types, mapper);
        let own = self.stored_alias(ty);
        if new[..] == *types && alias.map(|alias| alias.0) == own.map(|own| own.0) {
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

    /// `ty` as `createTypeReference` creates it: a reference or a tuple without the alias of the
    /// deferred reference that it is.
    pub(super) fn without_alias_of_reference(&mut self, ty: TypeId) -> TypeId {
        if self.stored_alias(ty).is_none() && self.types().deferred(ty).is_none() {
            return ty;
        }
        let arguments = self.type_arguments(ty);
        self.create_type_reference(ty, arguments)
    }
}
