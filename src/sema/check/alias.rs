//! `Type.alias`. A type that is interned by what it is made of (a union, an intersection, a tuple, a reference, an indexed access)
//! keeps it, as part of what it is interned by. A type that is known by the node it is written at (a type literal, a function
//! type, a mapped type, a conditional type) has the alias whose body the node is, and keeps one only if it was instantiated under
//! another (`getTypeFromTypeAliasReference`).

use super::decl::is_variadic_tuple_element;
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
                alias: None,
                origin,
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
        let aliased = self.p.types.intern_with(
            self.data(ty).clone(),
            Provenance {
                alias: Some((alias, type_arguments.into())),
                origin,
            },
        );
        if self.p.deferred_references.get(&ty).is_some() {
            self.p.deferred_references.insert(aliased, ());
        }
        aliased
    }

    /// `t.alias`. What is known by the node it is written at has the alias whose body the node is, with what its mapper puts for the
    /// type parameters of that.
    pub(super) fn alias_of_type(&self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        if let Some((alias, type_arguments)) = self.stored_alias(ty) {
            return Some((*alias, type_arguments.to_vec()));
        }
        let (file, node, mapper) = match *self.data(ty) {
            TypeData::LazyAlias { sym, ref args } => return Some((sym, args.to_vec())),
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

    /// What `getTypeFromUnionTypeNode` and `createDeferredTypeReference` of an array or a tuple type do with
    /// `getAliasForTypeNode(node)`. `ty`: what `node` comes to.
    pub(super) fn with_alias_for_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        ty: TypeId,
    ) -> TypeId {
        if !self.bound(file).type_by_alias[node.idx()] {
            return ty;
        }
        let hir = self.hir(file);
        let (keeps_alias, is_reference) = match (hir[node].kind, self.data(ty)) {
            (TypeNodeKind::Union(_), TypeData::Union(_)) => (true, false),
            (TypeNodeKind::Array(_), TypeData::Ref { .. }) => (true, true),
            // `[]` is its target, and a tuple type with a variadic element is never deferred. `getTupleTargetType`: `[...X[]]` is an
            // array.
            (TypeNodeKind::Tuple(elems), TypeData::Tuple { .. } | TypeData::Ref { .. }) => (
                !elems.is_empty()
                    && !elems
                        .iter()
                        .any(|e| is_variadic_tuple_element(hir, &hir[e])),
                true,
            ),
            _ => (false, false),
        };
        if !keeps_alias {
            return ty;
        }
        let scope = self.bound(file).type_scope[node.idx()];
        let Some((alias, type_arguments)) = self.alias_for_type_node(file, scope, node) else {
            return ty;
        };
        let made_before = self.p.types.len();
        let aliased = self.with_alias(ty, alias, &type_arguments);
        if is_reference {
            self.p.types.mark_manifest(aliased, made_before);
        }
        aliased
    }

    /// `instantiateTypeAlias`, and where `instantiateTypeWorker` puts what it gives: `result` is what `ty`, which keeps an alias,
    /// comes to under `mapper`.
    pub(super) fn with_instantiated_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        result: TypeId,
    ) -> TypeId {
        let Some((alias, type_arguments)) = self.stored_alias(ty) else {
            return result;
        };
        let takes_alias = match (self.data(ty), self.data(result)) {
            // `getIndexedAccessTypeEx` is handed it.
            (TypeData::IndexedAccess { .. }, _) => false,
            // `getConditionalType` gives what is handed no alias `root.alias`: the alias whose body the node is.
            (TypeData::Cond { .. }, _) => false,
            _ => self.takes_alias_of(ty, result),
        };
        if !takes_alias {
            return result;
        }
        let instantiated = self.instantiate_all(type_arguments, mapper);
        if result == ty && instantiated[..] == type_arguments[..] {
            return ty;
        }
        self.with_alias(result, *alias, &instantiated)
    }

    /// Whether `result`, an instantiation of `ty`, is of a kind that the alias given to `instantiateTypeWithAlias` ends up on:
    /// `createDeferredTypeReference`, `instantiateAnonymousType`, `getConditionalType` where it defers. A union or an intersection
    /// goes by `instantiate_union_or_intersection`, an indexed access by `instantiate_indexed_access`.
    pub(super) fn takes_alias_of(&self, ty: TypeId, result: TypeId) -> bool {
        match (self.data(ty), self.data(result)) {
            (
                TypeData::Ref { .. } | TypeData::Tuple { .. },
                TypeData::Ref { .. } | TypeData::Tuple { .. },
            )
            | (TypeData::LazyAlias { .. }, TypeData::LazyAlias { .. })
            | (TypeData::Fns { .. }, TypeData::Fns { .. })
            | (TypeData::Cond { .. }, TypeData::Cond { .. })
            | (TypeData::Synth(_), TypeData::Synth(_)) => true,
            (TypeData::Anon { origin: a, .. }, TypeData::Anon { origin: b, .. }) => a == b,
            _ => false,
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
        // `indexed_access_of_alias_under_way`: the access goes on waiting while the type arguments of the alias are generic.
        // `getTypeArguments` of the instantiated reference starts over until `instantiationDepth == 100` and stores the access all
        // the same. `force_reference` reports that where the alias is first looked into.
        if matches!(self.data(declared), TypeData::LazyAlias { .. }) && self.has_type_variables(obj)
        {
            if obj != declared {
                self.p
                    .excessive
                    .insert(Deep::Instantiation(obj, MapperId::IDENTITY), ());
                self.p
                    .has_excessive
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            let waiting = self.intern(TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            });
            return match alias {
                Some((alias, type_arguments)) => self.with_alias(waiting, alias, type_arguments),
                None => waiting,
            };
        }
        // `getIndexedAccessTypeEx(.., t.accessFlags, nil)`: there is no node to complain at, so what is not there is `unknown`.
        self.indexed_access_flagged(obj, index, undefined, alias)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// `ty` as `createTypeReference` makes it: a reference or a tuple without the alias of the deferred reference it is.
    pub(super) fn without_alias_of_reference(&self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            data @ (TypeData::Ref { .. } | TypeData::Tuple { .. })
                if self.stored_alias(ty).is_some() =>
            {
                self.intern(data.clone())
            }
            _ => ty,
        }
    }

    /// `getTypeAliasInstantiation(hosted, hosted_arguments, alias)`: `ty` is what the reference to the generic alias `hosted` comes
    /// to, and it is the whole body of `alias`, under which `instantiateTypeWithAlias` instantiates the declared type of `hosted`.
    pub(super) fn instantiated_under_alias(
        &mut self,
        hosted: Sym,
        hosted_arguments: &[TypeId],
        ty: TypeId,
        alias: Sym,
        type_arguments: &[TypeId],
    ) -> TypeId {
        // It is instantiated when it is forced.
        if matches!(self.data(ty), TypeData::LazyAlias { .. }) {
            return self.with_alias(ty, alias, type_arguments);
        }
        if self.stack.contains(&Query::Declared(hosted)) {
            return ty;
        }
        let declared = self.declared_type(hosted);
        let takes_alias = match self.data(declared) {
            data @ (TypeData::Union(_)
            | TypeData::Intersection(_)
            | TypeData::IndexedAccess { .. }) => {
                let params = self.local_type_params_of_symbol(hosted);
                let filled = self.fill_type_args(&params, hosted_arguments);
                let mapper = self.mapper_from(&params, &filled);
                let alias = Some((alias, type_arguments));
                return if matches!(data, TypeData::IndexedAccess { .. }) {
                    self.instantiate_indexed_access(declared, mapper, alias)
                } else {
                    self.instantiate_union_or_intersection(declared, mapper, alias)
                };
            }
            // `getObjectTypeInstantiation`, `instantiateMappedType`
            &TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper: own,
            } => {
                let params = self.local_type_params_of_symbol(hosted);
                let filled = self.fill_type_args(&params, hosted_arguments);
                let mapper = self.mapper_from(&params, &filled);
                let new = self.map_mapper(own, mapper);
                if new == own {
                    return ty;
                }
                let alias = NewAlias::Given(alias, type_arguments);
                return self.instantiate_mapped_type(file, node, new, alias);
            }
            // `getConditionalTypeInstantiation`: `mapTypeWithAlias`, where it distributes over a union. What a branch comes to is
            // given no alias.
            TypeData::Cond { file, node, .. } if self.is_union(ty) => {
                let (file, node) = (*file, *node);
                let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
                    return ty;
                };
                let check = self.type_from_node(file, check);
                let params = self.local_type_params_of_symbol(hosted);
                let filled = self.fill_type_args(&params, hosted_arguments);
                let Some(at) = params.iter().position(|&param| param == check) else {
                    return ty;
                };
                let distribution_type = self.force(filled[at]);
                let distribution_type = self.reduced(distribution_type);
                self.is_union(distribution_type) && self.is_distributive_conditional(file, node)
            }
            // Only a deferred type reference goes through `getObjectTypeInstantiation`: the body of an alias, which has it for an alias.
            TypeData::Ref { .. } | TypeData::Tuple { .. }
                if self.stored_alias(declared).is_none() =>
            {
                false
            }
            // `getObjectTypeInstantiation`: what mentions no type parameter is not instantiated.
            _ => ty != declared && self.takes_alias_of(declared, ty),
        };
        if takes_alias {
            self.with_alias(ty, alias, type_arguments)
        } else {
            ty
        }
    }
}
