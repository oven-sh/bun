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

    /// `instantiateTypeWithAlias`, given an alias.
    pub(super) fn instantiate_with_alias(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
        alias: (Sym, &[TypeId]),
    ) -> TypeId {
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
        if alias.is_none() && kept.is_none() {
            return result;
        }
        // `createDeferredTypeReference`, `instantiateAnonymousType`
        let is_instantiation = match (self.data(ty), self.data(result)) {
            (
                TypeData::Ref { .. } | TypeData::Tuple { .. },
                TypeData::Ref { .. } | TypeData::Tuple { .. },
            )
            | (TypeData::LazyAlias { .. }, TypeData::LazyAlias { .. })
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
}
