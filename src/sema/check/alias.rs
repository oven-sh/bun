//! `Type.alias`. A type that is interned by what it is made of (a union, an intersection, a tuple, a reference, an indexed access)
//! keeps it, as part of what it is interned by. A type that is known by the node it is written at (a type literal, a function
//! type, a mapped type, a conditional type) has the alias whose body the node is, and keeps one only if it was instantiated under
//! another (`getTypeFromTypeAliasReference`).

use super::*;
use crate::bind::ScopeId;
use smallvec::SmallVec;

static NO_ORIGIN: UnionOrigin = UnionOrigin::None;

/// The alias `instantiateMappedType` is handed.
#[derive(Clone, Copy)]
pub(super) enum NewAlias<'a> {
    None,
    /// `getObjectTypeInstantiation`, given none: `instantiateTypeAlias(t.alias, m)`, of a type that keeps no alias. It is the alias
    /// whose body the node is, under the mapper.
    OfNode,
    Given(Sym, &'a [TypeId]),
}

impl<'p> Checker<'p> {
    /// `UnionType.origin`
    #[inline]
    pub(super) fn origin(&self, ty: TypeId) -> &'p UnionOrigin {
        match self.p.types.provenance(ty) {
            Some(provenance) => &provenance.origin,
            None => &NO_ORIGIN,
        }
    }

    /// `getUnionTypeFromSortedList`: the members of `union`, with `origin` and no alias.
    pub(super) fn with_origin(&self, union: TypeId, origin: UnionOrigin) -> TypeId {
        self.p.types.intern_with(
            self.data(union).clone(),
            Provenance {
                origin,
                ..Provenance::default()
            },
        )
    }

    /// The alias `ty` keeps.
    #[inline]
    pub(super) fn stored_alias(&self, ty: TypeId) -> Option<&'p (Sym, Box<[TypeId]>)> {
        self.p.types.provenance(ty)?.alias.as_ref()
    }

    /// `ty` with `alias` and `type_arguments` for `Type.alias`.
    pub(super) fn with_alias(&self, ty: TypeId, alias: Sym, type_arguments: &[TypeId]) -> TypeId {
        let origin = match self.p.types.provenance(ty) {
            Some(provenance) => provenance.origin.clone(),
            None => UnionOrigin::None,
        };
        self.p.types.intern_with(
            self.data(ty).clone(),
            Provenance {
                alias: Some((alias, type_arguments.into())),
                origin,
                is_enum: self.files().flags(alias).intersects(SymFlags::ENUM),
            },
        )
    }

    /// `t.alias`. What is known by the node it is written at has the alias whose body the node is, with what its mapper puts for the
    /// type parameters of that.
    pub(super) fn alias_of_type(&self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        if let Some((alias, type_arguments)) = self.stored_alias(ty) {
            return Some((*alias, type_arguments.to_vec()));
        }
        let (file, node, mapper) = match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                mapper,
            }
            | TypeData::Cond { file, node, mapper } => (file, node, mapper),
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
        };
        self.alias_of_node_under(file, node, mapper)
    }

    /// The alias whose body `node` is, with what `mapper` puts for its type parameters.
    pub(super) fn alias_of_node_under(
        &self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> Option<(Sym, Vec<TypeId>)> {
        let scope = self.bound(file).type_scope[node.idx()];
        let (alias, parameters) = self.alias_for_type_node(file, scope, node)?;
        let map = |&parameter: &TypeId| self.p.types.map(mapper, parameter).unwrap_or(parameter);
        Some((alias, parameters.iter().map(map).collect()))
    }

    /// `source.alias.symbol == target.alias.symbol`: that alias, and `fillMissingTypeArguments` of the type arguments of each. Both
    /// lists are empty if neither has any. The flag: `len(source.alias.typeArguments) != 0`. `None` while the alias is being worked
    /// out too: nothing can be measured.
    pub(super) fn same_alias(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> Option<(Sym, Vec<TypeId>, Vec<TypeId>, bool)> {
        let (alias, sources) = self.alias_of_type(source)?;
        let (target_alias, targets) = self.alias_of_type(target)?;
        if alias != target_alias || self.stack.contains(&Query::Declared(alias)) {
            return None;
        }
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
        let alias = self.alias_with_body(file, scope, node)?;
        let symbol = self.bound(file).alias_symbol[alias.idx()];
        if symbol.is_none() {
            return None;
        }
        let alias = self.files().sym(file, symbol);
        // A class or an interface of the same name is what the name means.
        if self
            .files()
            .flags(alias)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return None;
        }
        Some((alias, self.local_type_params_of_symbol(alias)))
    }

    /// What `getTypeFromUnionTypeNode` does with `getAliasForTypeNode(node)`. `ty`: what `node` comes to.
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
            Some((alias, type_arguments)) => self.with_alias(ty, alias, &type_arguments),
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
        if self.p.types.deferred(ty).is_some() {
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
            // Only a deferred type reference goes through `getObjectTypeInstantiation`: the body of an alias, which has it for an alias.
            TypeData::Ref { .. } | TypeData::Tuple { .. } if self.stored_alias(ty).is_none() => {
                self.instantiate(ty, mapper)
            }
            _ => {
                let result = self.instantiate(ty, mapper);
                self.with_new_alias(ty, mapper, result, Some(alias))
            }
        }
    }

    /// `newAlias` of `getObjectTypeInstantiation`, on `result`, which is what `ty` comes to under `mapper`: `alias`, or else
    /// `instantiateTypeAlias(t.alias, m)` if `ty` keeps one.
    pub(super) fn with_new_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        result: TypeId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let kept = self.stored_alias(ty);
        if alias.is_none() && kept.is_none() || self.p.types.deferred(result).is_some() {
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
            // What mentions no type parameter is not instantiated.
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
        // `getIndexedAccessTypeEx(.., t.accessFlags, nil)`: there is no node to complain at, so what is not there is `unknown`.
        self.indexed_access_flagged(obj, index, undefined, alias)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// `ty` as `createTypeReference` makes it: a reference or a tuple without the alias of the deferred reference it is.
    pub(super) fn without_alias_of_reference(&mut self, ty: TypeId) -> TypeId {
        if self.stored_alias(ty).is_none() && self.p.types.deferred(ty).is_none() {
            return ty;
        }
        let arguments = self.type_arguments(ty);
        self.create_type_reference(ty, arguments)
    }
}
