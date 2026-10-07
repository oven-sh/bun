//! Types computed from other types: `keyof`, `T[K]`, conditional, mapped and template literal types.

use super::alias::NewAlias;
use super::related::Place;
use super::*;
use crate::bind::Decl;
use crate::bind::Parent;
use smallvec::SmallVec;

/// `accessNode` of `getIndexedAccessTypeOrUndefined`. `None`: an access that instantiation or a constraint produces. `Other`: a name in a
/// pattern, where nothing is reported yet.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum AccessNode {
    None,
    IndexedAccessType(FileId, TypeNodeId),
    /// `accessExpression`
    ElementAccess(FileId, ExprId),
    /// `PropertyNameOrName` of an element of an object binding pattern.
    PropertyName(FileId, PatPropId),
    /// `declaration.Name()` of an element of an array binding pattern.
    BindingName(FileId, PatId),
    /// The name of a property in an assignment pattern, or an element of one (`createSyntheticExpression`).
    Name(Place),
    Other,
}

/// A `getObjectTypeInstantiation` of a mapped type: its target and its key.
pub(super) struct MappedInstantiation {
    target: (FileId, TypeNodeId),
    /// `InstantiationKey::type_arguments`
    type_arguments: MapperId,
    /// `NewAlias::Given`
    alias: Option<(Sym, SmallVec<[TypeId; 4]>)>,
    /// `InstantiationKey::nesting`
    nesting: u8,
}

impl<'p, 's> Checker<'p, 's> {
    /// The pairs of `mapper`, followed by `param` mapped to `ty`.
    fn mapper_with_pair(&self, mapper: MapperId, param: TypeId, ty: TypeId) -> MapperId {
        let mapping = self.types().mapping(mapper);
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::with_capacity(mapping.len() + 1);
        pairs.extend_from_slice(mapping);
        pairs.push((param, ty));
        self.types().mapper_of(&pairs)
    }

    /// `prependTypeMapping`: a `MergedTypeMapper`, so `source` maps to what `mapper` maps `target`
    /// to, which is not `target` if that is a type parameter `mapper` maps.
    pub(super) fn prepend_type_mapping(
        &self,
        source: TypeId,
        target: TypeId,
        mapper: MapperId,
    ) -> MapperId {
        let target = self.types().map(mapper, target).unwrap_or(target);
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> =
            SmallVec::from_slice(self.types().mapping(mapper));
        match pairs.iter_mut().find(|pair| pair.0 == source) {
            Some(pair) => pair.1 = target,
            None => pairs.push((source, target)),
        }
        self.types().mapper_of(&pairs)
    }

    /// `isGenericType`
    pub fn is_generic(&mut self, ty: TypeId) -> bool {
        self.get_generic_object_flags(ty) != (false, false)
    }

    /// `isGenericObjectType`
    pub(super) fn is_generic_object_type(&mut self, ty: TypeId) -> bool {
        self.get_generic_object_flags(ty).0
    }

    /// `isGenericIndexType`
    pub(super) fn is_generic_index_type(&mut self, ty: TypeId) -> bool {
        self.get_generic_object_flags(ty).1
    }

    /// `getGenericObjectFlags`: `ObjectFlagsIsGenericObjectType`, `ObjectFlagsIsGenericIndexType`.
    /// Whichever is asked for, a mapped type resolves its constraint type.
    fn get_generic_object_flags(&mut self, ty: TypeId) -> (bool, bool) {
        let both = |a: (bool, bool), b: (bool, bool)| (a.0 | b.0, a.1 | b.1);
        match *self.data(ty) {
            TypeData::Union(ref parts) | TypeData::Intersection(ref parts) => {
                // `ObjectFlagsIsGenericTypeComputed`
                if let Some(&flags) = self.generic_object_flags.get(&ty) {
                    return flags;
                }
                let mut flags = (false, false);
                for &part in parts.iter() {
                    flags = both(flags, self.get_generic_object_flags(part));
                }
                self.generic_object_flags.insert(ty, flags);
                flags
            }
            TypeData::Substitution { base, constraint } => both(
                self.get_generic_object_flags(base),
                self.get_generic_object_flags(constraint),
            ),
            _ => {
                let flags = self.flags(ty);
                (
                    flags & tf::INSTANTIABLE_NON_PRIMITIVE != 0
                        || self.is_generic_mapped_type(ty)
                        || self.is_generic_tuple_type(ty),
                    flags & (tf::INSTANTIABLE_NON_PRIMITIVE | tf::INDEX) != 0
                        || self.is_generic_string_like_type(ty),
                )
            }
        }
    }

    /// `isGenericStringLikeType`
    fn is_generic_string_like_type(&mut self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Template { .. } | TypeData::StringMapping { .. }
        ) && !self.is_pattern_literal(ty)
    }

    /// `isGenericMappedType`
    pub(super) fn is_generic_mapped_type(&mut self, ty: TypeId) -> bool {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(ty)
        else {
            return false;
        };
        let constraint = self.mapped_constraint(file, node, mapper);
        if self.is_generic_index_type(constraint) {
            return true;
        }
        // So is one whose `as` clause mentions something generic other than the key: the name is
        // generic even after the known keys are substituted for the key parameter.
        let mapped = self.mapped_decl(file, node);
        if mapped.name_ty.is_none() {
            return false;
        }
        let declared = self.type_from_node(file, mapped.name_ty);
        let param = self.type_param(file, mapped.param);
        let with_keys = self.mapper_with_pair(mapper, param, constraint);
        // The name may contain `ty`: `{ [K in keyof C as C[K] & string]: 1 }` as a member of
        // `C`. `isGenericMappedType` has no guard and caches nothing. Every level
        // instantiates the name with a mapper of its own, and does nothing else, until
        // `instantiationCount` is at its limit. The native stack does not last that long.
        // A recursion that ends, as in `PartialOnUndefinedDeep` of type-fest, is left alone.
        // After that the unions and intersections in the name have
        // `ObjectFlagsIsGenericTypeComputed`.
        if self.generic_mapped_types_cut_short.contains(&ty) {
            return false;
        }
        // In `{ [K in "a" as Z<T[]>]: 1 }` every level is another type of the one declaration.
        let is_in_progress = (self.generic_mapped_types_in_progress).contains(&(file, node));
        self.generic_mapped_types_in_progress.push((file, node));
        let name = if is_in_progress && self.is_half_of_stack_in_use() {
            self.generic_mapped_types_cut_short.push(ty);
            self.instantiation_count = 5_000_000;
            self.instantiation_too_deep()
        } else {
            self.instantiate(declared, with_keys)
        };
        let is_generic = self.is_generic_index_type(name);
        self.generic_mapped_types_in_progress.pop();
        is_generic
    }

    // ───────────────────────────── keyof ─────────────────────────────

    /// `getIndexType`
    pub fn keyof(&mut self, ty: TypeId) -> TypeId {
        self.get_index_type_ex(ty, IndexFlags::empty())
    }

    /// `getIndexTypeEx`
    pub(super) fn get_index_type_ex(&mut self, ty: TypeId, index_flags: IndexFlags) -> TypeId {
        if ty == TypeId::UNRESOLVED {
            return ty;
        }
        let ty = self.reduced(ty);
        if let TypeData::Substitution {
            base,
            constraint: TypeId::UNKNOWN,
        } = *self.data(ty)
        {
            let keys = self.get_index_type_ex(base, index_flags);
            return self.no_infer(keys);
        }
        if self.should_defer_index_type(ty, index_flags) {
            return self.intern(TypeData::Keyof(ty));
        }
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(ty) {
            let keys: SmallVec<[TypeId; 8]> = parts
                .iter()
                .map(|&part| self.get_index_type_ex(part, index_flags))
                .collect();
            return if self.is_union(ty) {
                self.intersection(&keys)
            } else {
                self.union(&keys)
            };
        }
        if self.mapped_origin(ty).is_some() {
            self.get_index_type_for_mapped_type(ty, index_flags)
        } else if ty == TypeId::WILDCARD {
            ty
        } else if ty == TypeId::UNKNOWN {
            TypeId::NEVER
        } else if self.has_any_flag(ty) || ty.is_never() {
            self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL])
        } else {
            self.get_literal_type_from_properties(ty, index_flags)
        }
    }

    /// `shouldDeferIndexType`
    pub(super) fn should_defer_index_type(&mut self, ty: TypeId, index_flags: IndexFlags) -> bool {
        self.flags(ty) & tf::INSTANTIABLE_NON_PRIMITIVE != 0
            || self.is_generic_tuple_type(ty)
            || self.is_generic_mapped_type(ty) && self.mapped_name_type(ty).is_some()
            || self.is_union(ty)
                && !index_flags.contains(IndexFlags::NO_REDUCIBLE_CHECK)
                && self.is_generic_reducible(ty)
            || matches!(self.data(ty), TypeData::Intersection(parts)
                if self.maybe_type_of_kind(ty, |c, t| c.is_instantiable(t))
                    && parts.iter().any(|&part| self.is_empty_anonymous_object_type(part)))
    }

    /// `getIndexTypeForMappedType`
    pub(super) fn get_index_type_for_mapped_type(
        &mut self,
        ty: TypeId,
        index_flags: IndexFlags,
    ) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(ty) else {
            return TypeId::NEVER;
        };
        let (decl, constraint) = (
            self.mapped_decl(file, node),
            self.mapped_constraint(file, node, mapper),
        );
        let no_index_signatures = index_flags.contains(IndexFlags::NO_INDEX_SIGNATURES);
        // "no mapping and no filtering required, just quickly bail to returning the constraint in the common case"
        if decl.name_ty.is_none() && !no_index_signatures {
            return constraint;
        }
        let keys = if self.is_generic_index_type(constraint) {
            // "it's not safe to resolve the shape of modifier type"
            if matches!(self.mapped_modifiers_source(file, node), Some((_, true))) {
                return self.intern(TypeData::Keyof(ty));
            }
            List::Kept(self.parts(constraint))
        } else {
            self.mapped_key_types(file, node, mapper, constraint).0
        };
        let name_type = if decl.name_ty.is_some() {
            Some((
                self.type_param(file, decl.param),
                self.type_from_node(file, decl.name_ty),
            ))
        } else {
            None
        };
        let mut key_types = Vec::with_capacity(keys.len() + 1);
        for key in keys {
            let name = match name_type {
                Some((param, declared)) => {
                    let with_key = self.mapper_with_pair(mapper, param, key);
                    self.instantiate(declared, with_key)
                }
                None => key,
            };
            key_types.push(name);
            // `stringOrNumberType`, as in `getLiteralTypeFromProperties`
            if name == TypeId::STRING {
                key_types.push(TypeId::NUMBER);
            }
        }
        let mut result = self.union(&key_types);
        if no_index_signatures {
            result = self.filter(result, |c, key| {
                !c.has_any_flag(key) && key != TypeId::STRING
            });
        }
        if self.is_union(result)
            && self.is_union(constraint)
            && self.parts(result) == self.parts(constraint)
        {
            return constraint;
        }
        result
    }

    /// `getLiteralTypeFromProperties`
    fn get_literal_type_from_properties(&mut self, ty: TypeId, index_flags: IndexFlags) -> TypeId {
        if !index_flags.is_empty() {
            return self.get_literal_type_from_properties_uncached(ty, index_flags);
        }
        if let Some(known) = self.p.keys_of_properties.get(&self.task, &ty) {
            return known;
        }
        let scope = self.begin_scope();
        let keys = self.get_literal_type_from_properties_uncached(ty, index_flags);
        let result = self.end_scope_by_counters(scope);
        // `c.propertiesTypes[key] = result`, whatever is in progress. `interface D extends M<D>`:
        // whether `M<D>` is a valid base type depends on `keyof D`, which has no key of `M<D>` from
        // then on. Unless that began with `keyof D`: the evaluation that ends last is the one that
        // stays.
        let replaces = (self.p.keys_of_properties.get(&self.task, &ty)).is_some();
        let stored = match result {
            Ok(stored) => stored,
            Err(_) if replaces || self.is_resolving_base_types_of(ty) => Stored::new(),
            Err(_) => return keys,
        };
        if replaces {
            (self.p.keys_of_properties).rewrite(&self.task, ty, keys, stored)
        } else {
            (self.p.keys_of_properties).insert(&self.task, ty, keys, stored)
        }
    }

    /// Whether `ty` is the declared type of a class or an interface that `getBaseTypes` is at,
    /// without `ObjectFlagsUnresolvedMembers`.
    fn is_resolving_base_types_of(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.base_types_so_far.iter().any(|it| it.0 == target)
            && !self.inheriting.contains(&ty)
            && self.declared_type(target) == ty
    }

    fn get_literal_type_from_properties_uncached(
        &mut self,
        ty: TypeId,
        index_flags: IndexFlags,
    ) -> TypeId {
        let include = tf::NUMBER_LIKE
            | tf::ES_SYMBOL_LIKE
            | if index_flags.contains(IndexFlags::NO_INDEX_SIGNATURES) {
                tf::STRING_LITERAL
            } else {
                tf::STRING_LIKE
            };
        let apparent = self.reduced_apparent_type_as_object(ty);
        let Some(members) = self.members(apparent) else {
            return TypeId::NEVER;
        };
        let mut keys: SmallVec<[TypeId; 16]> = SmallVec::with_capacity(members.shape().props.len());
        for prop in &members.shape().props {
            if !prop
                .flags
                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
            {
                keys.extend(self.key_type_of_prop(apparent, prop));
            }
        }
        // `enumNumberIndexInfo`, the reverse mapping from a number to the name of a member, is
        // omitted.
        if !matches!(
            self.data(apparent),
            TypeData::Anon {
                origin: Origin::EnumObject(_),
                ..
            }
        ) {
            for info in &members.shape().index {
                if self.is_key_type_included(info.key, include) {
                    // `stringOrNumberType`, one type
                    keys.push(if info.key == TypeId::STRING {
                        self.union(&[TypeId::STRING, TypeId::NUMBER])
                    } else {
                        info.key
                    });
                }
            }
        }
        // `getUnionTypeEx`: a list of one type is that type, whatever origin is given.
        if let [only] = keys[..] {
            return only;
        }
        let keys = self.union(&keys);
        let has_origin = index_flags.is_empty()
            && matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. })
            || self.alias_symbol_of_type(ty).is_some();
        if has_origin && self.is_union(keys) {
            self.with_origin(keys, OriginKey::Keyof(ty))
        } else {
            keys
        }
    }

    /// `isKeyTypeIncluded`
    fn is_key_type_included(&self, key: TypeId, include: u32) -> bool {
        self.flags(key) & include != 0
            || matches!(self.data(key), TypeData::Intersection(parts)
                if parts.iter().any(|&part| self.is_key_type_included(part, include)))
    }

    /// The literal type for the property name `name`, as far as the name alone determines it.
    /// `None` for private names.
    pub(super) fn key_type_of_name(&mut self, name: Atom) -> Option<TypeId> {
        let text = self.atoms().bytes(name);
        if self.is_private_identifier_symbol(name) {
            return None;
        }
        if let Some(rest) = text.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            // In the format `property_name_of_type` produces.
            let mut parts = rest.splitn(2, |&c| c == b'@');
            let symbol = self.atoms().intern(parts.next().unwrap());
            let number = |b: &[u8]| {
                std::str::from_utf8(b)
                    .ok()
                    .and_then(|s| s.parse::<u32>().ok())
            };
            let declaration = match parts
                .next()
                .map(|w| w.splitn(2, |&c| c == b'.').collect::<Vec<_>>())
            {
                Some(w) if w.len() == 2 => {
                    let file = FileId(number(w[0])?);
                    match w[1].strip_prefix(b"m") {
                        Some(member) => {
                            UniqueSymbolDeclaration::Member(file, MemberId(number(member)?))
                        }
                        None => UniqueSymbolDeclaration::Variable(Sym {
                            file,
                            id: crate::bind::SymbolId(number(w[1])?),
                        }),
                    }
                }
                _ => UniqueSymbolDeclaration::SymbolConstructor,
            };
            return Some(self.intern(TypeData::UniqueSymbol {
                symbol: declaration,
                name: symbol,
            }));
        }
        // `NaN`, `Infinity` and `-Infinity` parse as numbers but only ever occur as identifiers or
        // strings.
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        if digits.first().is_some_and(|c| c.is_ascii_digit()) && self.is_numeric_name(name) {
            let n: f64 = std::str::from_utf8(text).unwrap().parse().unwrap();
            return Some(self.number_literal(n, false));
        }
        Some(self.string_literal(name, false))
    }

    /// `getLiteralTypeFromProperty`: the literal type for the name of `prop`, a property of
    /// `owner`. `None` for private names. It uses the type the name was created from (`nameType`),
    /// then the syntax of the name in the declaration of the property: a name that parses as a
    /// number is the number only if it is a numeric literal in the source. A property without a
    /// declaration, like a tuple element, is named by a string.
    pub(super) fn key_type_of_prop(&mut self, owner: TypeId, prop: &Prop) -> Option<TypeId> {
        if prop.flags.contains(PropFlags::STRING_NAME) {
            return Some(self.string_literal(prop.name, false));
        }
        let text = self.atoms().bytes(prop.name);
        let (file, (key, name_kind)) = match &prop.source {
            PropSource::Symbol(sym)
                if let Some((file, Decl::Member(member))) =
                    self.files().value_declaration(*sym) =>
            {
                let hir = self.hir(file);
                (file, hir.key_of(hir.node(member)))
            }
            PropSource::Literal(file, written) => {
                let written = &self.hir(*file)[*written];
                (*file, (written.key, written.name_kind))
            }
            PropSource::Type(_)
                if self.is_tuple(owner) && text.first().is_some_and(|c| c.is_ascii_digit()) =>
            {
                return Some(self.string_literal(prop.name, false));
            }
            PropSource::Intersected(_, parts) => return self.key_type_of_props(owner, parts),
            // It has the `ValueDeclaration` of the first, and uses the syntax of the name there.
            PropSource::Copy(_, parts, true) => return self.key_type_of_prop(owner, &parts[0]),
            _ => return self.key_type_of_name(prop.name),
        };
        // The name of a symbol also identifies which symbol it is.
        let is_by_syntax = match key {
            PropKey::Name(_) => true,
            PropKey::Computed(_) => !text.starts_with(crate::atom::SYMBOL_NAME_PREFIX),
            _ => false,
        };
        if is_by_syntax
            && let Some(ty) = self.literal_type_from_property_name(file, key, name_kind)
            && self.property_name_of_type(ty) == Some(prop.name)
        {
            return Some(ty);
        }
        self.key_type_of_name(prop.name)
    }

    /// The same for the property that represents `props`, the properties of one name in the members
    /// of a union or an intersection; `owner` has the first. `createUnionOrIntersectionProperty`:
    /// it takes the `nameType` of the first. If that has none it uses the declaration, and has one
    /// only if all declared properties share one declaration.
    pub(super) fn key_type_of_props(&mut self, owner: TypeId, props: &[Prop]) -> Option<TypeId> {
        let first = &props[0];
        let key = self.key_type_of_prop(owner, first)?;
        // A member of a class, an interface, a type literal or an object literal.
        let member = |prop: &Prop| match prop.source {
            PropSource::Symbol(sym) => (self.files().value_declaration(sym))
                .filter(|declaration| matches!(declaration.1, Decl::Member(_))),
            PropSource::Literal(file, written) => Some((file, Decl::Property(written))),
            _ => None,
        };
        let of_first = member(first);
        let is_by_declaration = match of_first {
            Some((file, Decl::Member(m))) => matches!(self.hir(file)[m].key, PropKey::Name(_)),
            Some((file, Decl::Property(p))) => matches!(self.hir(file)[p].key, PropKey::Name(_)),
            _ => false,
        };
        let is_declared_elsewhere =
            |other: &Prop| member(other).is_some_and(|it| Some(it) != of_first);
        if is_by_declaration
            && matches!(self.data(key), TypeData::NumberLit { .. })
            && props[1..].iter().any(is_declared_elsewhere)
        {
            return Some(self.string_literal(first.name, false));
        }
        Some(key)
    }

    // ───────────────────────────── T[K] ─────────────────────────────

    /// `obj[index]` as a type. `unknown` if there is no such property.
    pub fn indexed_access(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        self.indexed_access_if_any(obj, index, false)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// The instantiation of a deferred `obj[index]`, now that more is known of `obj` or `index`.
    /// `undefined`: the flag preserved from its creation (`AccessFlagsPersistent`). It is no longer
    /// an expression access, so it is deferred by the rules for types.
    pub(super) fn indexed_access_flagged(
        &mut self,
        obj: TypeId,
        index: TypeId,
        undefined: bool,
        alias: Option<(Sym, &[TypeId])>,
    ) -> Option<TypeId> {
        let mut access_flags = AccessFlags::empty();
        access_flags.set(AccessFlags::INCLUDE_UNDEFINED, undefined);
        self.indexed_access_worker(obj, index, access_flags, AccessNode::None, alias)
    }

    /// `getTypeFromIndexedAccessTypeNode`. `None`: the type node `obj[index]` at `node` resolves to
    /// nothing.
    pub(super) fn indexed_access_of_type_node(
        &mut self,
        obj: TypeId,
        index: TypeId,
        node: (FileId, TypeNodeId),
        alias: Option<(Sym, &[TypeId])>,
    ) -> Option<TypeId> {
        let access_node = AccessNode::IndexedAccessType(node.0, node.1);
        self.indexed_access_worker(obj, index, AccessFlags::empty(), access_node, alias)
    }

    /// `None`: the expression `obj[index]` at `e` resolves to nothing.
    pub(super) fn indexed_access_of_element_access(
        &mut self,
        obj: TypeId,
        index: TypeId,
        access_flags: AccessFlags,
        e: (FileId, ExprId),
    ) -> Option<TypeId> {
        let access_node = AccessNode::ElementAccess(e.0, e.1);
        self.indexed_access_worker(obj, index, access_flags, access_node, None)
    }

    /// `None`: `obj` has nothing at `index` for the binding pattern element named by `access_node`.
    pub(super) fn indexed_access_of_binding_element(
        &mut self,
        obj: TypeId,
        index: TypeId,
        access_flags: AccessFlags,
        access_node: AccessNode,
    ) -> Option<TypeId> {
        self.indexed_access_worker(obj, index, access_flags, access_node, None)
    }

    /// `getIndexedAccessTypeOrUndefined(obj, index, access_flags, nil, nil)`
    pub(super) fn indexed_access_with_flags(
        &mut self,
        obj: TypeId,
        index: TypeId,
        access_flags: AccessFlags,
    ) -> Option<TypeId> {
        self.indexed_access_worker(obj, index, access_flags, AccessNode::None, None)
    }

    /// `None`: `obj` has nothing at `index`, or at a member of `index` if it is a union.
    /// `is_expression`: the access comes from an expression or a pattern, not a type.
    pub(super) fn indexed_access_if_any(
        &mut self,
        obj: TypeId,
        index: TypeId,
        is_expression: bool,
    ) -> Option<TypeId> {
        let (access_flags, access_node) = if is_expression {
            (AccessFlags::EXPRESSION_POSITION, AccessNode::Other)
        } else {
            (AccessFlags::empty(), AccessNode::None)
        };
        self.indexed_access_worker(obj, index, access_flags, access_node, None)
    }

    /// `getIndexedAccessTypeOrUndefined`
    fn indexed_access_worker(
        &mut self,
        obj: TypeId,
        index: TypeId,
        mut access_flags: AccessFlags,
        access_node: AccessNode,
        alias: Option<(Sym, &[TypeId])>,
    ) -> Option<TypeId> {
        if obj == TypeId::UNRESOLVED || index == TypeId::UNRESOLVED {
            return Some(TypeId::UNRESOLVED);
        }
        if obj == TypeId::WILDCARD || index == TypeId::WILDCARD {
            return Some(TypeId::WILDCARD);
        }
        // `getReducedType`: an intersection that reduces to `never` is removed.
        let obj = self.reduced(obj);
        let index = self.key_into_string_index_only(obj, index);
        if self.p.files.options.no_unchecked_indexed_access
            && access_flags.contains(AccessFlags::EXPRESSION_POSITION)
        {
            access_flags |= AccessFlags::INCLUDE_UNDEFINED;
        }
        // `accessNode != nil && !ast.IsIndexedAccessTypeNode(accessNode)`
        let is_expression = matches!(
            access_node,
            AccessNode::ElementAccess(..)
                | AccessNode::PropertyName(..)
                | AccessNode::BindingName(..)
                | AccessNode::Name(_)
                | AccessNode::Other
        );
        if self.is_generic_index_type(index) || self.defers_access(obj, index, is_expression) {
            if self.has_any_flag(obj) || obj == TypeId::UNKNOWN {
                return Some(obj);
            }
            let deferred = self.intern(TypeData::IndexedAccess {
                obj,
                index,
                undefined: access_flags.contains(AccessFlags::INCLUDE_UNDEFINED),
            });
            return Some(match alias {
                Some((alias, type_arguments)) => {
                    // `getIndexedAccessKey`
                    self.get_symbol_id(alias);
                    self.with_alias(deferred, alias, type_arguments)
                }
                None => deferred,
            });
        }
        let apparent = self.reduced_apparent_type(obj);
        if let TypeData::Union(keys) = self.data(index)
            && !self.is_boolean(index)
        {
            let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(keys.len());
            let mut was_missing_prop = false;
            for &key in keys.iter() {
                match self.property_type_for_index(
                    apparent,
                    (key, index),
                    access_node,
                    access_flags,
                ) {
                    Some(ty) => types.push(ty),
                    // "If there's no error node, we can immediately stop, since error reporting is off"
                    None if matches!(access_node, AccessNode::None | AccessNode::Other) => {
                        return None;
                    }
                    None => {
                        was_missing_prop = true;
                        access_flags |= AccessFlags::SUPPRESS_NO_IMPLICIT_ANY_ERROR;
                    }
                }
            }
            if was_missing_prop {
                return None;
            }
            return Some(if access_flags.contains(AccessFlags::WRITING) {
                self.intersection_with_alias(&types, alias)
            } else {
                self.union_with_alias(&types, alias)
            });
        }
        self.property_type_for_index(apparent, (index, index), access_node, access_flags)
    }

    /// The start of `getIndexedAccessTypeOrUndefined`: if `obj`, reduced, has a string index
    /// signature and nothing else, that signature applies to any key, and the key is `string` from
    /// there on.
    pub(super) fn key_into_string_index_only(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        if self.is_string_index_signature_only(obj)
            && !self.is_nullish(index)
            && (self.is_assignable(index, TypeId::NUMBER)
                || self.is_assignable(index, TypeId::STRING))
        {
            TypeId::STRING
        } else {
            index
        }
    }

    /// `isStringIndexSignatureOnlyType`
    pub(super) fn is_string_index_signature_only(&mut self, ty: TypeId) -> bool {
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(ty) {
            return parts
                .iter()
                .all(|&p| self.is_string_index_signature_only(p));
        }
        if !self.is_object_type(ty) || self.is_generic_mapped_type(ty) {
            return false;
        }
        // FOR SPEED: a tuple has a `length`. The members of a deferred one resolve its elements.
        if self.is_tuple(ty) && self.types().deferred(ty).is_none() {
            return false;
        }
        self.members(ty).is_some_and(|m| {
            m.shape().props.is_empty()
                && matches!(
                    m.shape().index[..],
                    [IndexInfo {
                        key: TypeId::STRING,
                        ..
                    }]
                )
        })
    }

    /// `shouldDeferIndexedAccessType`, the part for the object type.
    fn defers_access(&mut self, obj: TypeId, index: TypeId, is_expression: bool) -> bool {
        if let TypeData::Tuple { flags, .. } = self.data(obj) {
            if !flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) {
                return false;
            }
            let limit = Self::total_fixed_element_count(flags) as f64;
            // `indexTypeLessThan`
            return !self.every_type(index, |c, key| {
                let at: f64 = match *c.data(key) {
                    TypeData::NumberLit { bits, .. }
                    | TypeData::EnumLit {
                        value: EnumValue::Number(bits),
                        ..
                    } => f64::from_bits(bits),
                    TypeData::StringLit { value, .. }
                    | TypeData::EnumLit {
                        value: EnumValue::String(value),
                        ..
                    } if c.is_numeric_name(value) => {
                        crate::atom::parse_number(c.atoms().bytes(value)).unwrap_or(f64::NAN)
                    }
                    _ => return false,
                };
                at >= 0.0 && at < limit
            });
        }
        // An expression access uses the constraint of a type parameter. Only a type access is
        // deferred.
        !is_expression
            && self.has_type_variables(obj)
            && (self.is_generic_object_type(obj) || self.is_generic_reducible(obj))
    }

    /// `getTotalFixedElementCount`: the elements before the first and after the last
    /// variable-length element.
    pub(super) fn total_fixed_element_count(flags: &[ElemFlags]) -> usize {
        let variable = ElemFlags::REST | ElemFlags::VARIADIC;
        flags.iter().take_while(|f| !f.intersects(variable)).count()
            + flags
                .iter()
                .rev()
                .take_while(|f| !f.intersects(variable))
                .count()
    }

    /// `isGenericReducibleType`
    pub(super) fn is_generic_reducible(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) => {
                self.may_be_reduced(ty) && parts.iter().any(|&p| self.is_generic_reducible(p))
            }
            TypeData::Intersection(_) => self.is_reducible_intersection(ty),
            _ => false,
        }
    }

    /// `isReducibleIntersection`
    fn is_reducible_intersection(&mut self, ty: TypeId) -> bool {
        let filled = self.unique_literal_filled_instantiation(ty);
        self.reduced(filled) != filled
    }

    /// `getIndexNodeForAccessExpression`, as an error position.
    fn place_of_index_node(&self, access_node: AccessNode) -> Option<Place> {
        match access_node {
            AccessNode::ElementAccess(file, e) => match self.hir(file)[e].kind {
                ExprKind::Index { index, .. } => Some(self.span_of_parenthesized_expr(file, index)),
                _ => None,
            },
            AccessNode::IndexedAccessType(file, node) => match self.hir(file)[node].kind {
                TypeNodeKind::IndexedAccess { index, .. } => Some((
                    file,
                    self.hir(file)[index].pos,
                    self.end_of_type_node(file, index),
                )),
                _ => None,
            },
            // For a computed name, the expression in the brackets. `["a"]` is stored as the name
            // `a`.
            AccessNode::PropertyName(file, p) => {
                let (hir, prop) = (self.hir(file), &self.hir(file)[p]);
                Some(match (prop.key, prop.name_kind) {
                    (PropKey::Computed(k), _) => self.span_of_parenthesized_expr(file, k),
                    (_, NameKind::ComputedString | NameKind::ComputedNumber) => {
                        let at = hir.start(hir.node(p).with(Part::NameLiteral));
                        (file, at, self.end_of_name_at(file, at))
                    }
                    _ => (file, prop.pos, self.end_of_name_at(file, prop.pos)),
                })
            }
            AccessNode::BindingName(file, pat) => {
                Some((file, self.hir(file)[pat].pos, self.end_of_pat(file, pat)))
            }
            AccessNode::Name(place) => Some(place),
            AccessNode::None | AccessNode::Other => None,
        }
    }

    /// `errorIfWritingToReadonlyIndex`
    fn error_if_writing_to_readonly_index(
        &mut self,
        is_readonly: bool,
        object: TypeId,
        access_expression: Option<(FileId, ExprId)>,
    ) {
        if is_readonly
            && let Some((file, e)) = access_expression
            && (self.is_assignment_target(file, e)
                || matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p)
                    if matches!(self.hir(file)[p].kind, ExprKind::Unary { op: UnOp::Delete, .. })))
        {
            self.error_at(
                self.place_inside_parentheses(file, e),
                2542,
                &[Arg::Type(object)],
            );
        }
    }

    /// `getPropertyTypeForIndexType`. `object`: a reduced apparent type. `indexes`: `indexType`,
    /// which is not a union, and `fullIndexType`.
    fn property_type_for_index(
        &mut self,
        object: TypeId,
        (index, full_index): (TypeId, TypeId),
        access_node: AccessNode,
        access_flags: AccessFlags,
    ) -> Option<TypeId> {
        let include_undefined = access_flags.contains(AccessFlags::INCLUDE_UNDEFINED);
        let access_expression = match access_node {
            AccessNode::ElementAccess(file, e) => Some((file, e)),
            _ => None,
        };
        let name = self.property_name_of_type(index);
        if let Some(name) = name {
            if access_flags.contains(AccessFlags::CONTEXTUAL) {
                let ty = self.contextual_property(object, name);
                return Some(ty.unwrap_or(TypeId::ANY));
            }
            if let Some((prop, mapper)) = self.get_property_of_type(object, name) {
                if !access_flags.contains(AccessFlags::WRITING) {
                    let prop_type = self.type_of_prop(prop, mapper);
                    return Some(
                        if matches!(access_node, AccessNode::IndexedAccessType(..))
                            && self.contains_missing_type(prop_type)
                        {
                            self.union(&[prop_type, TypeId::UNDEFINED])
                        } else {
                            prop_type
                        },
                    );
                }
                if let Some((file, e)) = access_expression
                    && let ExprKind::Index { obj, .. } = self.hir(file)[e].kind
                    && self.is_assignment_to_readonly_entity(file, e, obj, prop)
                    && let Some(index_node) = self.place_of_index_node(access_node)
                {
                    self.error_at(index_node, 2540, &[Arg::Prop(prop)]);
                    return None;
                }
                // `getWriteTypeOfSymbol`
                let ty = self.write_type_of_prop(prop, mapper);
                let takes_undefined = prop.flags.contains(PropFlags::OPTIONAL)
                    && !self.p.files.options.exact_optional_property_types;
                return Some(if takes_undefined {
                    self.optional(ty)
                } else {
                    ty
                });
            }
            if self.is_numeric_name(name) && self.every_type(object, |c, t| c.is_tuple(t)) {
                let at = crate::atom::parse_number(self.atoms().bytes(name)).unwrap_or(f64::NAN);
                let ends = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Tuple { flags, .. } if Self::fixed_length(flags) == flags.len());
                if access_node != AccessNode::None
                    && !access_flags.contains(AccessFlags::ALLOW_MISSING)
                    && self.every_type(object, ends)
                {
                    let index_node = self.place_of_index_node(access_node);
                    if let TypeData::Tuple { flags, .. } = self.data(object) {
                        if at < 0.0 {
                            if let Some(index_node) = index_node {
                                self.error_at(index_node, 2514, &[]);
                            }
                            return Some(TypeId::UNDEFINED);
                        }
                        if let Some(index_node) = index_node {
                            let printed = self.apparent_type_of_intersection(object);
                            let args = [
                                Arg::Type(printed),
                                Arg::Number(flags.len()),
                                Arg::Atom(name),
                            ];
                            self.error_at(index_node, 2493, &args);
                        }
                    } else if let Some(index_node) = index_node {
                        let printed = self.apparent_type_of_intersection(object);
                        self.error_at(index_node, 2339, &[Arg::Atom(name), Arg::Type(printed)]);
                    }
                }
                if at >= 0.0 {
                    if access_expression.is_some() {
                        let is_readonly =
                            self.members_for_index_infos(object).is_some_and(|members| {
                                let infos = &members.shape().index;
                                infos
                                    .iter()
                                    .any(|info| info.key == TypeId::NUMBER && info.readonly)
                            });
                        self.error_if_writing_to_readonly_index(
                            is_readonly,
                            object,
                            access_expression,
                        );
                    }
                    // `getTupleElementTypeOutOfStartCount`
                    return Some(self.map_type(object, |c, t| {
                        let TypeData::Tuple { flags, .. } = c.data(t) else {
                            return t;
                        };
                        let (elems, fixed) = (c.type_arguments(t), Self::fixed_length(flags));
                        if fixed == flags.len() {
                            return TypeId::UNDEFINED;
                        }
                        let rest = c.tuple_element_union(&elems[fixed..], &flags[fixed..]);
                        if include_undefined && at >= Self::total_fixed_element_count(flags) as f64
                        {
                            c.with_missing(rest)
                        } else {
                            rest
                        }
                    }));
                }
            }
        }
        if self.is_key_like(index) {
            if self.is_any(object) || object.is_never() {
                return Some(object);
            }
            // "If no index signature is applicable, we default to the string index signature. In effect, this means the string index
            // signature applies even when accessing with a symbol-like type."
            let info = self.members_for_index_infos(object).and_then(|members| {
                self.applicable_index_info(&members, index)
                    .or_else(|| self.find_index_info(&members, TypeId::STRING))
            });
            if let Some(info) = info {
                if access_flags.contains(AccessFlags::NO_INDEX_SIGNATURES)
                    && info.key != TypeId::NUMBER
                {
                    if let Some((file, e)) = access_expression
                        && let ExprKind::Index { obj, .. } = self.hir(file)[e].kind
                    {
                        let at = self.place_inside_parentheses(file, e);
                        // `originalObjectType`
                        let original_object = self.type_of_expr(file, obj);
                        let original_object = self.non_null_type(original_object);
                        if access_flags.contains(AccessFlags::WRITING) {
                            self.error_at(at, 2862, &[Arg::Type(original_object)]);
                        } else {
                            self.error_at(
                                at,
                                2536,
                                &[Arg::Type(index), Arg::Type(original_object)],
                            );
                        }
                    }
                    return None;
                }
                // An enum knows the names of its own members.
                let is_own_member = matches!(
                    (self.data(object), self.data(index)),
                    (TypeData::Anon { origin: Origin::EnumObject(owner), .. }, TypeData::EnumLit { member, .. })
                        if self.files().sym(member.file, self.files().symbol(*member).parent) == *owner
                );
                if info.key == TypeId::STRING
                    && !self.is_assignable(index, TypeId::STRING)
                    && !self.is_assignable(index, TypeId::NUMBER)
                    && let Some(index_node) = self.place_of_index_node(access_node)
                {
                    self.error_at(index_node, 2538, &[Arg::Type(index)]);
                } else {
                    self.error_if_writing_to_readonly_index(
                        info.readonly,
                        object,
                        access_expression,
                    );
                }
                return Some(if include_undefined && !is_own_member {
                    self.with_missing(info.value)
                } else {
                    info.value
                });
            }
            if index.is_never() {
                return Some(TypeId::NEVER);
            }
            if self.is_js_literal_type(object) {
                return Some(TypeId::ANY);
            }
            if let Some((file, e)) = access_expression
                && !self.is_const_enum_object(object)
            {
                let no_implicit_any = self.p.files.options.no_implicit_any;
                if self.is_object_literal_type(object) {
                    if no_implicit_any
                        && self.flags(index) & (tf::STRING_LITERAL | tf::NUMBER_LITERAL) != 0
                        && let Some(name) = name
                    {
                        let at = self.place_inside_parentheses(file, e);
                        let printed = self.apparent_type_of_intersection(object);
                        self.error_at(at, 2339, &[Arg::Atom(name), Arg::Type(printed)]);
                        return Some(TypeId::UNDEFINED);
                    }
                    if index == TypeId::STRING || index == TypeId::NUMBER {
                        let members = self.members(object)?;
                        let mut types = vec![TypeId::UNDEFINED];
                        for prop in &members.shape().props {
                            types.push(self.type_of_prop(prop, members.mapper));
                        }
                        return Some(self.union(&types));
                    }
                }
                if let Some(name) = name
                    && matches!(
                        self.data(object),
                        TypeData::Anon {
                            origin: Origin::GlobalThis,
                            ..
                        }
                    )
                    && self.is_block_scoped_global(name)
                {
                    let at = self.place_inside_parentheses(file, e);
                    let printed = self.apparent_type_of_intersection(object);
                    self.error_at(at, 2339, &[Arg::Atom(name), Arg::Type(printed)]);
                } else if no_implicit_any
                    && !access_flags.contains(AccessFlags::SUPPRESS_NO_IMPLICIT_ANY_ERROR)
                {
                    let printed = self.apparent_type_of_intersection(object);
                    self.report_implicit_any_element((file, e), printed, (index, full_index), name);
                }
                return None;
            }
        }
        if access_flags.contains(AccessFlags::ALLOW_MISSING) && self.is_object_literal_type(object)
        {
            return Some(TypeId::UNDEFINED);
        }
        if self.is_js_literal_type(object) {
            return Some(TypeId::ANY);
        }
        if let Some(index_node) = self.place_of_index_node(access_node) {
            let is_bigint_literal = match access_node {
                AccessNode::ElementAccess(file, e) => {
                    matches!(self.hir(file)[e].kind, ExprKind::Index { index, .. }
                    if matches!(self.hir(file)[index].kind, ExprKind::BigInt(_)) && !is_parenthesized(self.hir(file), index))
                }
                AccessNode::PropertyName(file, prop) => match self.hir(file)[prop].key {
                    PropKey::Name(_) => is_bigint_literal_at(self.hir(file), index_node.1),
                    PropKey::Computed(k) => {
                        matches!(self.hir(file)[k].kind, ExprKind::BigInt(_))
                            && !is_parenthesized(self.hir(file), k)
                    }
                    _ => false,
                },
                AccessNode::Name((file, start, _)) => is_bigint_literal_at(self.hir(file), start),
                _ => false,
            };
            if is_bigint_literal {
                self.error_at(index_node, 2538, &[Arg::Bytes(b"bigint")]);
            } else if self.flags(index) & (tf::STRING_LITERAL | tf::NUMBER_LITERAL) != 0
                && let Some(name) = name
            {
                let printed = self.apparent_type_of_intersection(object);
                self.error_at(index_node, 2339, &[Arg::Atom(name), Arg::Type(printed)]);
            } else if index == TypeId::STRING || index == TypeId::NUMBER {
                let printed = self.apparent_type_of_intersection(object);
                self.error_at(index_node, 2537, &[Arg::Type(printed), Arg::Type(index)]);
            } else {
                self.error_at(index_node, 2538, &[Arg::Type(index)]);
            }
        }
        self.has_any_flag(index).then_some(index)
    }

    /// `indexType.flags&TypeFlagsNullable == 0 && isTypeAssignableToKind(indexType, StringLike|NumberLike|ESSymbolLike)`: each
    /// kind by itself.
    pub(super) fn is_key_like(&mut self, index: TypeId) -> bool {
        !self.is_nullish(index)
            && [TypeId::NUMBER, TypeId::STRING, TypeId::SYMBOL]
                .into_iter()
                .any(|kind| self.is_assignable(index, kind))
    }

    /// `getIndexTypeOfType`
    pub(super) fn index_type_of_type(&mut self, ty: TypeId, key_type: TypeId) -> Option<TypeId> {
        let ty = self.reduced_apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            let infos = self.union_index_infos(parts);
            return Some(infos.iter().find(|info| info.key == key_type)?.value);
        }
        let members = self.members(ty)?;
        let info = members
            .shape()
            .index
            .iter()
            .find(|info| info.key == key_type)?;
        Some(self.instantiate(info.value, members.mapper))
    }

    /// `getUnionIndexInfos`: the index signatures of the first member that all the others have too, for the same keys. A tuple
    /// has that of an array of all its elements.
    pub(super) fn union_index_infos(&mut self, parts: &[TypeId]) -> SmallVec<[IndexInfo; 2]> {
        let mut all = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            let Some(members) = self.members(apparent) else {
                return SmallVec::new();
            };
            all.push(members);
        }
        let mut infos = SmallVec::new();
        let Some(first) = all.first() else {
            return infos;
        };
        'infos: for info in &first.shape().index {
            let mut values = Vec::with_capacity(all.len());
            let mut readonly = false;
            for members in &all {
                let Some(same) = members.shape().index.iter().find(|i| i.key == info.key) else {
                    continue 'infos;
                };
                values.push(self.instantiate(same.value, members.mapper));
                readonly |= same.readonly;
            }
            infos.push(IndexInfo::new(info.key, self.union(&values), readonly));
        }
        infos
    }

    // ───────────────────────────── conditional types ─────────────────────────────

    /// `getInferTypeParameters` for the conditional type whose `extends` type node is `extends`:
    /// the type parameters among its locals, each identified by the declaration that
    /// `getDeclaredTypeOfSymbol` uses.
    pub(super) fn collect_infer_params(
        &self,
        file: FileId,
        extends: TypeNodeId,
        out: &mut Vec<TypeParamId>,
    ) {
        let bound = self.bound(file);
        let own = bound.type_scope[extends.idx()];
        if own.is_none() {
            return;
        }
        // The scope of `extends` alone (`ScopeKind::Extends`) is nested in the scope that has the
        // locals.
        let scope = bound.scopes[own.idx()].parent;
        for &(_, symbol) in bound.table(bound.scopes[scope.idx()].locals) {
            out.extend(
                bound.symbols[symbol.idx()]
                    .decls
                    .iter()
                    .find_map(|decl| match *decl {
                        crate::bind::Decl::TypeParam(declared) => Some(declared),
                        _ => None,
                    }),
            );
        }
        out.sort_unstable();
    }

    /// `getConditionalTypeInstantiation` without an alias.
    pub fn conditional_type(&mut self, file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeId {
        self.conditional_type_instantiation(file, node, mapper, None)
    }

    /// `getConditionalTypeInstantiation`: the conditional type at `node`, with `mapper` for its
    /// outer type parameters. A type created with an alias is not cached: `getConditionalTypeKey`
    /// includes the alias, `conditionals` does not.
    pub(super) fn conditional_type_instantiation(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let q = Query::Cond(file, node, mapper);
        if alias.is_none()
            && let Some(known) = (self.p.conditionals).get(&self.task, &(file, node, mapper))
        {
            return known;
        }
        if alias.is_none()
            && let Some(raw) = self.provisional(q)
        {
            return TypeId(raw as u32);
        }
        if !self.enter(q) {
            return self.excessively_deep();
        }
        let ty = self.conditional_type_uncached(file, node, mapper, false, alias);
        match (self.leave(q), alias) {
            // Where it was in progress several times, the outermost is the last to store.
            (Ok(stored), None) => {
                (self.p.conditionals).rewrite(&self.task, (file, node, mapper), ty, stored);
                ty
            }
            (Err(open), None) => {
                self.cache_provisionally(q, u64::from(ty.0), open);
                ty
            }
            (_, Some(_)) => ty,
        }
    }

    /// `ConditionalRoot.isDistributive`
    pub(super) fn is_distributive_conditional(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
            return false;
        };
        let declared = self.type_from_node(file, check);
        self.flags(declared) & tf::TYPE_PARAMETER != 0
    }

    /// `for_constraint`: the check type is not the type itself but its constraint, so failing the
    /// test does not rule out that the type passes it.
    pub(super) fn conditional_type_uncached(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        for_constraint: bool,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
            return TypeId::UNRESOLVED;
        };
        let check_declared = self.type_from_node(file, check);
        // `T extends U ? X : Y` with a naked `T` distributes over a union.
        if self.flags(check_declared) & tf::TYPE_PARAMETER != 0
            && let Some(value) = self.types().map(mapper, check_declared)
        {
            // `getConditionalTypeInstantiation`: an intersection that reduces to `never` is removed
            // before distribution.
            let value = self.reduced(value);
            if value.is_never() || self.is_union(value) {
                let distributed_over = mapper;
                let of_member = |c: &mut Self, part: TypeId| {
                    let one = c.prepend_type_mapping(check_declared, part, distributed_over);
                    if for_constraint {
                        // The type arguments of the union that is distributed over.
                        let for_constraint = distributed_over;
                        return c.resolve_conditional(
                            file,
                            node,
                            one,
                            distributed_over,
                            for_constraint,
                            None,
                        );
                    }
                    // FOR SPEED: `getConditionalType`, cached. `part` is no union, and without a
                    // type variable nothing is deferred, so no type has the merged mapper.
                    let has_type_variables = (c.types().mapper_flags(one))
                        .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES);
                    if !has_type_variables && c.types().map(one, check_declared) == Some(part) {
                        return c.conditional_type(file, node, one);
                    }
                    let for_constraint = MapperId::IDENTITY;
                    c.resolve_conditional(file, node, one, distributed_over, for_constraint, None)
                };
                return self.map_type_with_alias(value, of_member, alias);
            }
        }
        let for_constraint = if for_constraint {
            mapper
        } else {
            MapperId::IDENTITY
        };
        self.resolve_conditional(
            file,
            node,
            mapper,
            MapperId::IDENTITY,
            for_constraint,
            alias,
        )
    }

    /// The number of elements of the tuple type node at `node`, if none is optional or a rest.
    pub(super) fn simple_tuple_len(&self, file: FileId, node: TypeNodeId) -> Option<usize> {
        let hir = self.hir(file);
        let TypeNodeKind::Tuple(elems) = hir[node].kind else {
            return None;
        };
        (!elems.is_empty() && elems.iter().all(|e| !hir[e].optional && !hir[e].rest))
            .then(|| elems.iter().count())
    }

    pub(super) fn has_generic_element(&mut self, ty: TypeId) -> bool {
        self.is_tuple(ty) && self.type_arguments(ty).iter().any(|&e| self.is_generic(e))
    }

    /// `getConditionalType`. `distributed_over`, `for_constraint`: see `TypeData::Cond`.
    fn resolve_conditional(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        mut distributed_over: MapperId,
        for_constraint: MapperId,
        mut alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let (mut file, mut node, mut mapper) = (file, node, mapper);
        let mut extra_types: Vec<TypeId> = Vec::new();
        // `tailCount`
        let mut tail_count = 0;
        // The roots that the loop has reached through a type reference.
        let mut tail_roots: crate::util::FxHashSet<(FileId, TypeNodeId, MapperId)> =
            Default::default();
        // Whether each of their nodes is the body of a type alias.
        let mut has_alias: SmallVec<[((FileId, TypeNodeId), bool); 4]> = SmallVec::new();
        let result = loop {
            // `tailCount` does not count a root that is not the body of a type alias. In tsgo
            // `instantiationCount` ends a loop of those.
            if tail_count == 1000 || tail_roots.len() == 10_000 {
                return self.excessively_deep();
            }
            let TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } = self.hir(file)[node].kind
            else {
                return TypeId::UNRESOLVED;
            };
            let check_declared = self.type_from_node(file, check);
            let check_variable = self.actual_type_variable(check_declared);
            let check_ty = self.instantiate(check_variable, mapper);
            let extends_declared = self.type_from_node(file, extends);
            if check_ty == TypeId::UNRESOLVED {
                return TypeId::UNRESOLVED;
            }
            // `extendsType`, which is not `inferredExtendsType`.
            let extends_before_inference = self.instantiate(extends_declared, mapper);
            if check_ty == TypeId::ERROR || extends_before_inference == TypeId::ERROR {
                return TypeId::ERROR;
            }
            if check_ty == TypeId::WILDCARD || extends_before_inference == TypeId::WILDCARD {
                return TypeId::WILDCARD;
            }
            // `[A] extends [B]` is deferred on its elements like `A extends B` would be.
            let check_tuples = match (
                self.simple_tuple_len(file, check),
                self.simple_tuple_len(file, extends),
            ) {
                (Some(a), Some(b)) => a == b,
                _ => false,
            };
            let check_is_generic =
                self.is_generic(check_ty) || check_tuples && self.has_generic_element(check_ty);

            let mut infer_params = Vec::new();
            self.collect_infer_params(file, extends, &mut infer_params);
            let mut combined = mapper;
            if !infer_params.is_empty() {
                let params: SmallVec<[TypeId; 4]> = infer_params
                    .iter()
                    .map(|&p| self.type_param(file, p))
                    .collect();
                if !check_is_generic {
                    // The `infer` positions are found in the `extends` type with everything else
                    // instantiated.
                    let target = self.instantiate(extends_declared, mapper);
                    let inferred = self.infer_from_types(&params, check_ty, target, mapper);
                    let mapping = self.types().mapping(mapper);
                    let mut pairs = Vec::with_capacity(mapping.len() + params.len());
                    pairs.extend_from_slice(mapping);
                    pairs.extend(params.iter().copied().zip(inferred));
                    combined = self.types().mapper(pairs);
                }
            }
            let extends_ty = self.instantiate(extends_declared, combined);
            if extends_ty == TypeId::UNRESOLVED {
                return TypeId::UNRESOLVED;
            }
            if check_is_generic
                || self.is_generic(extends_ty)
                || check_tuples && self.has_generic_element(extends_ty)
            {
                break self.deferred_conditional_type(
                    file,
                    node,
                    mapper,
                    distributed_over,
                    for_constraint,
                    alias,
                );
            }
            let extends_is_top = self.has_any_flag(extends_ty) || extends_ty == TypeId::UNKNOWN;
            let (branch, branch_mapper, is_false_branch) = if !extends_is_top
                && (self.has_any_flag(check_ty)
                    || !self.is_assignable_permissive(check_ty, extends_ty))
            {
                // `any` may pass. So may a type constrained by `check_ty`, if some type that passes
                // is assignable to `check_ty`.
                let with_true = self.has_any_flag(check_ty)
                    || for_constraint != MapperId::IDENTITY && !extends_ty.is_never() && {
                        let (extends_ty, check_ty) = (
                            self.permissive_instantiation(extends_ty),
                            self.permissive_instantiation(check_ty),
                        );
                        self.parts(extends_ty)
                            .iter()
                            .any(|&t| self.is_assignable(t, check_ty))
                    };
                if with_true {
                    let yes_declared = self.type_from_node(file, yes);
                    extra_types.push(self.instantiate(yes_declared, combined));
                }
                (no, mapper, true)
            } else {
                if !extends_is_top && !self.is_assignable_restrictive(check_ty, extends_ty) {
                    break self.deferred_conditional_type(
                        file,
                        node,
                        mapper,
                        distributed_over,
                        for_constraint,
                        alias,
                    );
                }
                (yes, combined, false)
            };
            match self.tail_recursion_root(
                file,
                branch,
                branch_mapper,
                check_declared,
                is_false_branch,
            ) {
                Ok((root, is_tail_call)) => {
                    // `newRootMapper` is not a merged mapper.
                    if is_tail_call {
                        (alias, distributed_over) = (None, MapperId::IDENTITY);
                    }
                    // A root that is not the branch node itself is reached through a type
                    // reference. The other steps descend in the syntax.
                    if is_tail_call && (root.0, root.1) != (file, branch) {
                        // The loop is deterministic: a root that recurs under the same mapper
                        // recurs until a limit is hit.
                        if !tail_roots.insert(root) {
                            return self.excessively_deep();
                        }
                        // `newRoot.alias != nil`
                        let known = has_alias
                            .iter()
                            .find(|known| known.0 == (root.0, root.1))
                            .map(|known| known.1);
                        let root_has_alias = match known {
                            Some(known) => known,
                            None => {
                                let scope = self.bound(root.0).type_scope[root.1.idx()];
                                let found = scope.is_some()
                                    && self.alias_with_body(root.0, scope, root.1).is_some();
                                has_alias.push(((root.0, root.1), found));
                                found
                            }
                        };
                        if root_has_alias {
                            tail_count += 1;
                        }
                    }
                    (file, node, mapper) = root;
                }
                Err(declared) => break self.instantiate(declared, branch_mapper),
            }
        };
        if extra_types.is_empty() {
            return result;
        }
        extra_types.push(result);
        self.union(&extra_types)
    }

    /// `newConditionalType`, with `alias`. Without one it has `instantiateTypeAlias(root.alias,
    /// mapper)`, which the node determines.
    fn deferred_conditional_type(
        &self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        distributed_over: MapperId,
        for_constraint: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let deferred = self.intern(TypeData::Cond {
            file,
            node,
            mapper,
            distributed_over,
            for_constraint,
        });
        match alias {
            Some((alias, type_arguments)) => self.with_alias(deferred, alias, type_arguments),
            None => deferred,
        }
    }

    /// `Ok`: the conditional type that the loop of `getConditionalType` continues with instead of
    /// instantiating the branch at `branch` under `mapper`, and whether `getTailRecursionRoot`
    /// returns it. `Err`: the declared type of the branch, which is to be instantiated.
    /// `outer_check` is the declared check type of the conditional type that has the branch.
    fn tail_recursion_root(
        &mut self,
        file: FileId,
        branch: TypeNodeId,
        mapper: MapperId,
        outer_check: TypeId,
        is_false_branch: bool,
    ) -> Result<((FileId, TypeNodeId, MapperId), bool), TypeId> {
        let declared = self.type_from_node(file, branch);
        let TypeData::Cond {
            file: root_file,
            node: root,
            mapper: own,
            ..
        } = *self.data(declared)
        else {
            return Err(declared);
        };
        let TypeNodeKind::Cond { check, .. } = self.hir(root_file)[root].kind else {
            return Err(declared);
        };
        let root_mapper = self.map_mapper(own, mapper);
        let root_check = self.type_from_node(root_file, check);
        let is_distributive = self.is_distributive_conditional(root_file, root);
        // A conditional type immediately nested in the false branch is one construct with the outer one, unless it distributes
        // over another check type.
        if is_false_branch
            && (root_file, root) == (file, branch)
            && (!is_distributive || root_check == outer_check)
        {
            return Ok(((root_file, root, root_mapper), false));
        }
        // `getTailRecursionRoot`. A root without outer type parameters has the identity mapper,
        // which `map_mapper` returns unchanged.
        // A mapper that changes no type argument yields `declared` again.
        if root_mapper == own {
            return Err(declared);
        }
        if is_distributive
            && let Some(value) = self.types().map(root_mapper, root_check)
            && (self.is_union(value) || value.is_never())
        {
            return Err(declared);
        }
        Ok(((root_file, root, root_mapper), true))
    }

    /// `computeBaseConstraint` of the conditional type `this`.
    pub(super) fn constraint_of_conditional(&mut self, this: TypeId) -> Option<TypeId> {
        let (file, _, mapper, [check, ..]) = self.cond_origin(this);
        // `conditionalConstraintDepth`. The second test comes before `enter` would refuse a query
        // for lack of capacity on `stack`.
        if self.conditional_constraint_depth >= 100 || self.stack.len() + 20 >= MAX_DEPTH {
            self.bailed_out();
            return None;
        }
        self.conditional_constraint_depth += 1;
        // `getConstraintOfTypeParameter`: a type parameter with a circular constraint has no
        // constraint to substitute.
        let check_declared = self.type_from_node(file, check);
        let checked = self.instantiate(check_declared, mapper);
        let is_circular = self.flags(check_declared) & tf::TYPE_PARAMETER != 0
            && matches!(
                self.data(checked),
                TypeData::TypeParam(..) | TypeData::ThisParam(_)
            )
            && !self.has_non_circular_base_constraint(checked);
        let constraint = if is_circular {
            self.default_constraint_of_conditional(this)
        } else {
            self.constraint_from_conditional(this)
        };
        self.conditional_constraint_depth -= 1;
        // A remaining type variable is not a constraint. A mapped type over one is an ordinary
        // object type.
        let constraint = self.next_base_constraint(constraint)?;
        (!self.some_type(constraint, |c, m| c.is_deferred(m))).then_some(constraint)
    }

    // ───────────────────────────── mapped types ─────────────────────────────

    pub(super) fn mapped_decl(&self, file: FileId, node: TypeNodeId) -> &'p Mapped {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[node].kind else {
            unreachable!("a mapped type")
        };
        &hir[m]
    }

    /// `getConstraintOfTypeParameter` for the parameter of the mapped type at `node`.
    fn constraint_of_mapped_param(&mut self, file: FileId, node: TypeNodeId) -> Option<TypeId> {
        if let Some(known) = (self.p.mapped_param_constraints).get(&self.task, &(file, node)) {
            return known;
        }
        let scope = self.begin_scope();
        let param = self.type_param(file, self.mapped_decl(file, node).param);
        let constraint = self.constraint_of_type_param(param);
        if let Ok(stored) = self.end_scope_by_counters(scope) {
            return (self.p.mapped_param_constraints).insert(
                &self.task,
                (file, node),
                constraint,
                stored,
            );
        }
        constraint
    }

    /// `getConstraintTypeFromMappedType`: the type that the parameter of the mapped type ranges
    /// over. An `any` annotation there means every kind of key (`getConstraintFromTypeParameter`);
    /// a constraint that refers back to the parameter is an error.
    pub(super) fn mapped_constraint(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        // `getConstraintOfTypeParameter` is nil unless `hasNonCircularBaseConstraint`. Where
        // `pushTypeResolution` fails, every resolution above the first request is in the cycle.
        let key = (file, node, mapper);
        let mut in_progress = self.mapped_constraints_in_progress.iter();
        if let Some(&(_, height)) = in_progress.find(|it| it.0 == key) {
            if self.mark_cycle_from(height) {
                self.note_cycle();
                self.task.closed_a_cycle = true;
            }
            (self.p.circular_mapped_constraints).insert(&self.task, key, (), Stored::new());
            return TypeId::ERROR;
        }
        self.mapped_constraints_in_progress
            .push((key, self.stack.len()));
        let constraint = self.instantiated_constraint_of_mapped_param(file, node, mapper);
        self.mapped_constraints_in_progress.pop();
        // Afterwards: this may be the resolution in which the cycle was closed.
        match (self.p.circular_mapped_constraints).get(&self.task, &key) {
            Some(()) => TypeId::ERROR,
            None => constraint,
        }
    }

    /// `instantiateType(getConstraintTypeFromMappedType(t), m)`, where `t` is the mapped type as it
    /// is declared. The key of the instantiation is not being resolved.
    fn instantiated_constraint_of_mapped_param(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        let declared = self
            .constraint_of_mapped_param(file, node)
            .unwrap_or(TypeId::ERROR);
        self.instantiate(declared, mapper)
    }

    /// `getModifiersTypeFromMappedType`. For `{ [P in keyof T]: X }`, and for `{ [P in K]: X }`
    /// where `K` is an alias of `keyof T` or is constrained by it: `T` as declared. Its properties
    /// determine what is optional and what is read-only. Also returns whether the constraint node
    /// is `keyof T` (`isMappedTypeWithKeyofConstraintDeclaration`).
    pub(super) fn mapped_modifiers_source(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<(TypeId, bool)> {
        let param = &self.hir(file)[self.mapped_decl(file, node).param];
        let constraint = param.constraint;
        // Decided by the syntax: `keyof` of a non-generic type is a plain union by now. A
        // `ParenthesizedType` is not a type operator.
        if let TypeNodeKind::Keyof(of) = self.hir(file)[constraint].kind
            && (self.parenthesized_types_around(file, constraint, param.pos))
                .next()
                .is_none()
        {
            return Some((self.type_from_node(file, of), true));
        }
        let declared = self.type_from_node(file, constraint);
        match *self.data(declared) {
            TypeData::TypeParam(..) => match self.constraint_of_type_param(declared) {
                Some(c) => match *self.data(c) {
                    TypeData::Keyof(t) => Some((t, false)),
                    _ => None,
                },
                None => None,
            },
            TypeData::Keyof(t) => Some((t, false)),
            _ => None,
        }
    }

    /// `getHomomorphicTypeVariable`: the `T` of a mapped type whose constraint type is `keyof T`,
    /// regardless of its syntax.
    pub(super) fn homomorphic_type_variable(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> Option<TypeId> {
        let constraint = self.mapped_constraint(file, node, mapper);
        let TypeData::Keyof(target) = *self.data(constraint) else {
            return None;
        };
        let variable = self.actual_type_variable(target);
        (self.flags(variable) & tf::TYPE_PARAMETER != 0).then_some(variable)
    }

    /// `getResolvedApparentTypeOfMappedType`: `{ [P in keyof T]: X }` where `T` can only be an
    /// array or a tuple is one too.
    pub(super) fn apparent_type_of_mapped(&mut self, ty: TypeId) -> TypeId {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(ty)
        else {
            return ty;
        };
        let Some(source) = self.homomorphic_type_variable(file, node, MapperId::IDENTITY) else {
            return ty;
        };
        if self.mapped_decl(file, node).name_ty.is_some() {
            return ty;
        }
        // Not `source`: in the true branch of `T extends X[] ? .. : ..` the `T` of `keyof T` is a
        // substitution type, whose base constraint is `X[]`.
        let Some((modifiers, _)) = self.mapped_modifiers_source(file, node) else {
            return ty;
        };
        let modifiers = self.instantiate(modifiers, mapper);
        let base_constraint = if self.is_generic_mapped_type(modifiers) {
            Some(self.apparent_type_of_mapped(modifiers))
        } else {
            self.base_constraint_of(modifiers)
        };
        // `isArrayOrTupleType(t) || isArrayOrTupleOrIntersection(t)`
        let is_array_like = |c: &Self, t: TypeId| {
            c.is_array_or_tuple(t)
                || matches!(c.data(t), TypeData::Intersection(parts) if parts.iter().all(|&p| c.is_array_or_tuple(p)))
        };
        match base_constraint {
            Some(base_constraint) if self.every_type(base_constraint, is_array_like) => {
                let applied = self.prepend_type_mapping(source, base_constraint, mapper);
                self.instantiate_mapped(file, node, applied)
            }
            _ => ty,
        }
    }

    /// The mapped type at `node` under `mapper`, as `getObjectTypeInstantiation` creates it without
    /// an alias.
    pub fn instantiate_mapped(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        self.instantiate_mapped_type(file, node, mapper, NewAlias::OfNode)
    }

    /// `getObjectTypeInstantiation` of the mapped type at `node`, from where it finds nothing under
    /// its key to `data.instantiations[key] = result`. The same key may be asked for in between.
    pub(super) fn instantiate_mapped_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: NewAlias<'_>,
    ) -> TypeId {
        let nesting = self.mapped_instantiations_in_progress_under(file, node, mapper, alias);
        self.mapped_instantiations_in_progress
            .push(MappedInstantiation {
                target: (file, node),
                type_arguments: mapper,
                alias: match alias {
                    NewAlias::Given(alias, type_arguments) => {
                        Some((alias, SmallVec::from_slice(type_arguments)))
                    }
                    NewAlias::OfNode => None,
                },
                nesting,
            });
        let result = self.instantiate_mapped_type_worker(file, node, mapper, alias);
        self.mapped_instantiations_in_progress.pop();
        result
    }

    /// How many `instantiate_mapped_type` with the key of these arguments are in progress.
    fn mapped_instantiations_in_progress_under(
        &self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: NewAlias<'_>,
    ) -> u8 {
        let mut with_type_arguments = (self.mapped_instantiations_in_progress.iter().rev())
            .filter(|it| it.target == (file, node) && it.type_arguments == mapper)
            .peekable();
        // The target itself is under the key of its type parameters from the start.
        if with_type_arguments.peek().is_none() || !self.is_instantiating(mapper) {
            return 0;
        }
        // `instantiateTypeAlias(t.alias, m)` is one key, whether it is passed in or not.
        let of_node = self.alias_of_node_under(file, node, mapper);
        let of_node =
            (of_node.as_ref()).map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
        let new_alias = match alias {
            NewAlias::Given(alias, type_arguments) => Some((alias, type_arguments)),
            NewAlias::OfNode => of_node,
        };
        let innermost = with_type_arguments.find(|it| match &it.alias {
            Some((alias, type_arguments)) => Some((*alias, &type_arguments[..])) == new_alias,
            None => of_node == new_alias,
        });
        innermost.map_or(0, |it| it.nesting.saturating_add(1))
    }

    /// `InstantiationKey::nesting` of the innermost `instantiate_mapped_type`.
    fn nesting_of_mapped_instantiation(&self) -> u8 {
        (self.mapped_instantiations_in_progress.last()).map_or(0, |innermost| innermost.nesting)
    }

    /// `InstantiationKey::alias` for the alias passed to `instantiate_mapped_type`.
    fn alias_of_instantiation_key(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: NewAlias<'_>,
    ) -> Option<(Sym, TypeId)> {
        let NewAlias::Given(alias, type_arguments) = alias else {
            return None;
        };
        let of_node = self.alias_of_node_under(file, node, mapper);
        if of_node.is_some_and(|it| it.0 == alias && it.1 == type_arguments) {
            return None;
        }
        let flags = vec![ElemFlags::REQUIRED; type_arguments.len()];
        Some((alias, self.tuple(type_arguments, &flags, false)))
    }

    /// `instantiateMappedType`. A mapped type over the keys of an array is an array, and so on.
    fn instantiate_mapped_type_worker(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: NewAlias<'_>,
    ) -> TypeId {
        let anon = |c: &mut Self| {
            // `instantiateMappedType` instantiates the constraint type eagerly (its wildcard test),
            // so a cycle through the keys starts here. `getTypeFromMappedTypeNode` has resolved the
            // constraint of the declared type.
            if c.types()
                .mapping(mapper)
                .iter()
                .any(|pair| pair.0 != pair.1)
                && c.instantiated_constraint_of_mapped_param(file, node, mapper) == TypeId::WILDCARD
            {
                return TypeId::WILDCARD;
            }
            let created = TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            };
            let nesting = c.nesting_of_mapped_instantiation();
            if nesting != 0 {
                let given = c.alias_of_instantiation_key(file, node, mapper, alias);
                let could_contain_type_variables =
                    c.could_type_arguments_contain_type_variables(mapper);
                return c.types().intern_key_with(
                    TypeKey::Data(&created),
                    &ProvenanceKey {
                        alias: match alias {
                            NewAlias::Given(alias, type_arguments) if given.is_some() => {
                                Some((alias, type_arguments))
                            }
                            _ => None,
                        },
                        origin: OriginKey::None,
                        is_enum: false,
                        stored_under: Some(InstantiationKey {
                            type_arguments: mapper,
                            alias: given,
                            could_contain_type_variables,
                            nesting,
                        }),
                        is_array_literal: false,
                    },
                );
            }
            let created = c.intern(created);
            // `instantiateAnonymousType`
            match alias {
                NewAlias::Given(alias, type_arguments) => {
                    c.with_alias_of_instantiation(created, alias, type_arguments)
                }
                NewAlias::OfNode => created,
            }
        };
        let Some(source) = self.homomorphic_type_variable(file, node, MapperId::IDENTITY) else {
            return anon(self);
        };
        let Some(value) = self.types().map(mapper, source) else {
            return anon(self);
        };
        if value == source {
            return anon(self);
        }
        let value = self.reduced(value);
        let given = self.alias_of_instantiation_key(file, node, mapper, alias);
        // `instantiateTypeAlias(t.alias, m)`
        let of_node = match alias {
            NewAlias::OfNode if self.is_union(value) => {
                self.alias_of_node_under(file, node, mapper)
            }
            _ => None,
        };
        let alias = match alias {
            NewAlias::Given(alias, type_arguments) => Some((alias, type_arguments)),
            NewAlias::OfNode => {
                (of_node.as_ref()).map(|(alias, type_arguments)| (*alias, &type_arguments[..]))
            }
        };
        let result = self.map_type_with_alias(
            value,
            |c, t| c.instantiate_mapped_constituent(file, node, mapper, source, t, given),
            alias,
        );
        // `getObjectTypeInstantiation`: "If none of the type arguments for the outer type
        // parameters contain type variables, it follows that the instantiated type doesn't
        // reference type variables."
        let has_other_instantiation =
            (self.types().object_flags(result)).contains(ObjectFlags::HAS_OTHER_INSTANTIATION);
        if !has_other_instantiation
            || !self.is_union(result)
            || self.could_type_arguments_contain_type_variables(mapper)
        {
            return result;
        }
        let own = self.stored_alias(result);
        self.types().intern_key_with(
            TypeKey::Data(self.data(result)),
            &ProvenanceKey {
                alias: own.map(|(alias, type_arguments)| (*alias, &type_arguments[..])),
                origin: self.origin(result).into(),
                is_enum: false,
                stored_under: Some(InstantiationKey {
                    type_arguments: mapper,
                    alias: given,
                    could_contain_type_variables: false,
                    nesting: self.nesting_of_mapped_instantiation(),
                }),
                is_array_literal: false,
            },
        )
    }

    /// `core.Some(typeArguments, c.couldContainTypeVariables)` in `getObjectTypeInstantiation`
    fn could_type_arguments_contain_type_variables(&self, new_mapper: MapperId) -> bool {
        let mut type_arguments = self.types().mapping(new_mapper).iter();
        type_arguments.any(|pair| self.could_contain_type_variables(pair.1))
    }

    /// `hasArrayOrTypeTypeConstraint`, which `instantiateMappedType` asks unless
    /// `findResolutionCycleStartIndex` finds the base constraint of `type_variable`.
    fn has_array_or_tuple_type_constraint(&mut self, type_variable: TypeId) -> bool {
        if self.is_resolving(Query::Constraint(type_variable)) {
            self.task.closed_a_cycle = true;
            return false;
        }
        self.array_or_tuple_constraint_requests
            .push(self.stack.len());
        let constraint = self.constraint_of_type_param(type_variable);
        self.array_or_tuple_constraint_requests.pop();
        constraint.is_some_and(|it| self.every_type(it, |c, m| c.is_array_or_tuple(m)))
    }

    /// `instantiateConstituent`: the mapped type over the keys of `source`, with `t`, which is not
    /// a union, substituted for `source`. `given`: `InstantiationKey::alias`.
    fn instantiate_mapped_constituent(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        source: TypeId,
        t: TypeId,
        given: Option<(Sym, TypeId)>,
    ) -> TypeId {
        let is_mapped =
            tf::ANY | tf::UNKNOWN | tf::INSTANTIABLE_NON_PRIMITIVE | tf::OBJECT | tf::INTERSECTION;
        if self.flags(t) & is_mapped == 0
            || t == TypeId::UNRESOLVED
            || t == TypeId::WILDCARD
            || self.is_error_type(t)
        {
            return t;
        }
        let mapped = self.mapped_decl(file, node);
        let one = self.prepend_type_mapping(source, t, mapper);
        // `instantiateAnonymousType(t, prependTypeMapping(typeVariable, s, m), nil)`
        let anonymous = |c: &mut Self| {
            let created = TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper: one,
            };
            // `getObjectTypeInstantiation` stores the result under `m` and the alias.
            let nesting = c.nesting_of_mapped_instantiation();
            if one == mapper && given.is_none() && nesting == 0 {
                return c.intern(created);
            }
            // It sets the flag of its result from the type arguments. For a member of a union
            // `couldContainTypeVariables` computes it, and it holds for every mapped type.
            let distributed = c.types().map(mapper, source).unwrap_or(source);
            let distributed = c.reduced(distributed);
            let could_contain_type_variables =
                c.is_union(distributed) || c.could_type_arguments_contain_type_variables(mapper);
            c.types().intern_key_with(
                TypeKey::Data(&created),
                &ProvenanceKey {
                    alias: None,
                    origin: OriginKey::None,
                    is_enum: false,
                    stored_under: Some(InstantiationKey {
                        type_arguments: mapper,
                        alias: given,
                        could_contain_type_variables,
                        nesting,
                    }),
                    is_array_literal: false,
                },
            )
        };
        if mapped.name_ty.is_some() {
            return anonymous(self);
        }
        let param = self.type_param(file, mapped.param);
        // `instantiateMappedTypeTemplate`
        let template = |c: &mut Self, of: MapperId, key: TypeId, is_optional: bool| {
            // `getTemplateTypeFromMappedType`
            let declared = if mapped.ty.is_some() {
                c.type_from_node(file, mapped.ty)
            } else {
                TypeId::ERROR
            };
            let with_key = c.mapper_with_pair(of, param, key);
            let ty = c.instantiate(declared, with_key);
            if !c.p.files.options.strict_null_checks {
                return ty;
            }
            match mapped.optional {
                // `getTemplateTypeFromMappedType` adds the optionality to the declared template type.
                MappedModifier::Add => c.optional_property(ty),
                MappedModifier::Remove if is_optional => {
                    c.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
                }
                _ => ty,
            }
        };
        // `any` for a `T` constrained to arrays or tuples is mapped as an array.
        let any_as_array = self.has_any_flag(t) && self.has_array_or_tuple_type_constraint(source);
        // `instantiateMappedArrayType`
        if any_as_array || self.array_element(t).is_some() {
            let element = template(self, one, TypeId::NUMBER, true);
            if self.is_error_type(element) {
                return TypeId::ERROR;
            }
            let readonly = match mapped.readonly {
                MappedModifier::Add => true,
                MappedModifier::Remove => false,
                MappedModifier::None => self.is_reference_to_global(t, known::ReadonlyArray, 1),
            };
            return if readonly {
                self.readonly_array_of(element)
            } else {
                self.array_of(element)
            };
        }
        if let TypeData::Tuple {
            flags, readonly, ..
        } = self.data(t)
        {
            let elems = self.type_arguments(t);
            // `instantiateMappedTupleType`: up to the first rest or variadic element each element
            // is looked up by its index. From there on indexes are unknown: a variadic element is
            // mapped as a whole, the others as the element of a separate array.
            let fixed = Self::fixed_length(flags);
            let mut new_elems = Vec::with_capacity(elems.len());
            let mut new_flags = Vec::with_capacity(elems.len());
            for (i, &f) in flags.iter().enumerate() {
                let elem = if i < fixed {
                    let name = self.number_name(i as f64);
                    let key = self.string_literal(name, false);
                    template(self, one, key, f.contains(ElemFlags::OPTIONAL))
                } else if f.contains(ElemFlags::VARIADIC) {
                    let of_element = self.prepend_type_mapping(source, elems[i], mapper);
                    // `...T` in the tuple that `m` has for `T` is that tuple again, and the same
                    // instantiation starts over until `instantiationDepth == 100`.
                    if of_element == mapper {
                        return self.excessively_deep();
                    }
                    let declared = self.type_from_node(file, node);
                    self.instantiate(declared, of_element)
                } else {
                    let list = self.array_of(elems[i]);
                    let of_list = self.prepend_type_mapping(source, list, mapper);
                    // `getElementTypeOfArrayType` of the result of `instantiateMappedArrayType`,
                    // and the error type is not an array.
                    match template(self, of_list, TypeId::NUMBER, true) {
                        element if self.is_error_type(element) => TypeId::UNKNOWN,
                        element => element,
                    }
                };
                // `slices.Contains(newElementTypes, c.errorType)`
                if elem == TypeId::ERROR {
                    return TypeId::ERROR;
                }
                let flag = match mapped.optional {
                    MappedModifier::Add if f.contains(ElemFlags::REQUIRED) => {
                        ElemFlags::OPTIONAL.with_label(f.labeled_declaration())
                    }
                    MappedModifier::Remove if f.contains(ElemFlags::OPTIONAL) => {
                        ElemFlags::REQUIRED.with_label(f.labeled_declaration())
                    }
                    _ => f,
                };
                // `TupleNormalizer.add`: an optional element reads as `undefined` when omitted.
                new_elems.push(if flag.contains(ElemFlags::OPTIONAL) {
                    self.optional_property(elem)
                } else {
                    elem
                });
                new_flags.push(flag);
            }
            let readonly = match mapped.readonly {
                MappedModifier::Add => true,
                MappedModifier::Remove => false,
                MappedModifier::None => *readonly,
            };
            return self.normalized_tuple(&new_elems, &new_flags, readonly);
        }
        // `isArrayOrTupleOrIntersection`: member by member.
        if let TypeData::Intersection(parts) = self.data(t)
            && parts.iter().all(|&p| self.is_array_or_tuple(p))
        {
            let members: Vec<TypeId> = parts
                .iter()
                .map(|&p| self.instantiate_mapped_constituent(file, node, mapper, source, p, given))
                .collect();
            return self.intersection(&members);
        }
        anonymous(self)
    }

    /// `getKnownKeysOfTupleType`: the indexes before the first variable-length element, and the
    /// keys of `globalArrayType` or `globalReadonlyArrayType`.
    pub(super) fn known_keys_of_tuple_type(
        &mut self,
        flags: &[ElemFlags],
        readonly: bool,
    ) -> TypeId {
        let fixed = Self::fixed_length(flags);
        let mut keys: Vec<TypeId> = (0..fixed)
            .map(|i| self.string_literal(self.number_name(i as f64), false))
            .collect();
        let read_only = readonly.then_some(known::ReadonlyArray);
        let array = read_only
            .and_then(|name| self.global_type_of_arity(name, 1))
            .or_else(|| self.global_type_of_arity(known::Array, 1));
        if let Some(array) = array {
            let array = self.declared_type(array);
            keys.push(self.keyof(array));
        }
        self.union(&keys)
    }

    /// `getLowerBoundOfKeyType`: for keys that are still generic, those that exist in every
    /// instantiation.
    fn lower_bound_of_key_type(&mut self, ty: TypeId) -> TypeId {
        match *self.data(ty) {
            TypeData::Keyof(of) => {
                let apparent = self.apparent_type(of);
                if let TypeData::Tuple {
                    flags, readonly, ..
                } = self.data(apparent)
                    && flags.iter().any(|f| f.contains(ElemFlags::VARIADIC))
                {
                    return self.known_keys_of_tuple_type(flags, *readonly);
                }
                if apparent == of {
                    ty
                } else {
                    self.keyof(apparent)
                }
            }
            // `Exclude<keyof T, "a">`: over the lower bound of `keyof T`.
            TypeData::Cond {
                file, node, mapper, ..
            } => {
                let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
                    return ty;
                };
                if !self.is_distributive_conditional(file, node) {
                    return ty;
                }
                let declared = self.type_from_node(file, check);
                let Some(checked) = self.types().map(mapper, declared) else {
                    return ty;
                };
                let bound = self.lower_bound_of_key_type(checked);
                if bound == checked {
                    return ty;
                }
                let mapper = self.prepend_type_mapping(declared, bound, mapper);
                self.conditional_type(file, node, mapper)
            }
            // `mapTypeEx(.., noReductions)`: `string` from `keyof S` does not absorb the names next
            // to it.
            TypeData::Union(ref parts) => {
                let bounds: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.lower_bound_of_key_type(p))
                    .collect();
                if bounds[..] == parts[..] {
                    ty
                } else {
                    self.union_unreduced(&bounds)
                }
            }
            TypeData::Intersection(ref parts) => {
                // `string & {}` and the like are preserved.
                if let [first, TypeId::EMPTY_TYPE_LITERAL] = parts[..]
                    && matches!(first, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
                {
                    return ty;
                }
                // Also if none of them changes: `` `a${string}` & {} ``, which a type node keeps as
                // it is written, becomes `` `a${string}` ``.
                let bounds: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.lower_bound_of_key_type(p))
                    .collect();
                self.intersection(&bounds)
            }
            _ => ty,
        }
    }

    /// `{ [P in K]: E }[X]` where `K` is known and `X` is generic: `E` with `X` substituted for
    /// `P`, which preserves the per-key correlation in `E` that the union over all keys would lose.
    pub(super) fn substitute_indexed_mapped(
        &mut self,
        obj: TypeId,
        index: TypeId,
    ) -> Option<TypeId> {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(obj)
        else {
            return None;
        };
        let mapped = self.mapped_decl(file, node);
        if mapped.optional == MappedModifier::Remove
            || mapped.name_ty.is_some()
            || mapped.ty.is_none()
        {
            return None;
        }
        if self.is_generic(obj) || !self.is_generic(index) {
            return None;
        }
        let param = self.type_param(file, mapped.param);
        let with_key = self.mapper_with_pair(mapper, param, index);
        let template = self.type_from_node(file, mapped.ty);
        let template = self.instantiate(template, with_key);
        // `couldAccessOptionalProperty`: it may be one of the optional properties.
        let mut optional = mapped.optional == MappedModifier::Add;
        if !optional && let Some(keys) = self.base_constraint_of(index) {
            let members = self.members(obj)?;
            for prop in &members.shape().props {
                if prop.flags.contains(PropFlags::OPTIONAL)
                    && let Some(key) = self.key_type_of_prop(obj, prop)
                    && self.is_assignable(key, keys)
                {
                    optional = true;
                    break;
                }
            }
        }
        Some(if optional {
            self.optional_property(template)
        } else {
            template
        })
    }

    /// The base constraint of the result of `getSimplifiedIndexedAccessType` for an `obj[index]`
    /// that is deferred although `index` is known. `[A, ...T][1]` is `T[number]`. Where the keys of
    /// a mapped type are still generic, `(T & U)[K]` is `T[K] & U[K]`, and `{ [P in K]: E }[X]` is
    /// `E` with `X` substituted for `P`, whether or not `X` turns out to be a key.
    pub(super) fn simplified_access_to_intersection(
        &mut self,
        obj: TypeId,
        index: TypeId,
    ) -> Option<TypeId> {
        if self.is_generic(index) {
            return None;
        }
        if let TypeData::Tuple { flags, .. } = self.data(obj) {
            if !self.defers_access(obj, index, false) {
                return None;
            }
            let elems = self.type_arguments(obj);
            // `T[A | B]` is `T[A] | T[B]`.
            if let TypeData::Union(keys) = self.data(index) {
                let mut types = Vec::with_capacity(keys.len());
                for &key in keys.iter() {
                    let one = self.indexed_access(obj, key);
                    types.push(self.base_constraint(one));
                }
                return Some(self.union(&types));
            }
            if !self.is_number_like(index) {
                return None;
            }
            // With `number` it is any element, with a numeric literal any element from the first
            // variable-length element on.
            let from = if index == TypeId::NUMBER {
                0
            } else {
                flags
                    .iter()
                    .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                    .unwrap_or(0)
            };
            let element = self.tuple_element_union(&elems[from..], &flags[from..]);
            return Some(self.base_constraint(element));
        }
        let TypeData::Intersection(parts) = self.data(obj) else {
            return None;
        };
        let mut any = false;
        let mut types = Vec::with_capacity(parts.len());
        for &part in parts.iter() {
            if let TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } = *self.data(part)
                && self.is_generic(part)
            {
                let mapped = self.mapped_decl(file, node);
                if mapped.name_ty.is_some() || mapped.ty.is_none() {
                    return None;
                }
                any = true;
                let param = self.type_param(file, mapped.param);
                let with_key = self.mapper_with_pair(mapper, param, index);
                let template = self.type_from_node(file, mapped.ty);
                let template = self.instantiate(template, with_key);
                let template = if mapped.optional == MappedModifier::Add {
                    self.optional_property(template)
                } else {
                    template
                };
                types.push(self.base_constraint(template));
            } else {
                types.push(
                    self.indexed_access_if_any(part, index, false)
                        .unwrap_or(TypeId::UNKNOWN),
                );
            }
        }
        any.then(|| self.intersection(&types))
    }

    /// The properties available on a value of the union `ty` without knowing which member it is:
    /// `getPropertiesOfUnionOrIntersectionType`, and the index signatures common to all members.
    pub fn union_as_object(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.union_objects.get(&self.task, &ty) {
            return known;
        }
        let scope = self.begin_scope();
        let parts = self.parts(ty);
        let mut shape = Shape::new_in(self.arena);
        let mut checked = crate::util::FxHashSet::default();
        for &part in parts {
            // `getPropertiesOfType`. The apparent type of an intersection with a conditional type is a union if the constraint of the
            // conditional type is one.
            let apparent = self.apparent_type(part);
            let apparent = match self.is_union(apparent) {
                true => self.union_as_object(apparent),
                false => apparent,
            };
            let Some(members) = self.members(apparent) else {
                break;
            };
            for prop in &members.shape().props {
                if checked.insert(prop.name) {
                    shape.props.extend(
                        self.get_property_of_type(ty, prop.name)
                            .map(|it| it.0.clone_in(self.arena)),
                    );
                }
            }
            // A property common to all members is declared by name in the first member that has no
            // index signature to cover names.
            if members.shape().index.is_empty() {
                break;
            }
        }
        shape.index.extend(self.union_index_infos(parts));
        let object = self.synth(shape);
        match self.end_scope_by_counters(scope) {
            Ok(stored) => (self.p.union_objects).insert(&self.task, ty, object, stored),
            Err(_) => object,
        }
    }

    /// The key types that `resolveMappedTypeMembers` and `getIndexTypeForMappedType` iterate over,
    /// for the mapped type at `node` under `mapper`, whose constraint is `constraint`. Also returns
    /// the `T` of `keyof T` (`getModifiersTypeFromMappedType`) as an object, with its members.
    fn mapped_key_types(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        constraint: TypeId,
    ) -> (List<'p, TypeId>, Option<(TypeId, Members<'p>)>) {
        let source = self.mapped_modifiers_source(file, node);
        let over_keyof = matches!(source, Some((_, true)));
        // `getReducedApparentType`: the constraint of a type parameter, and an intersection that
        // reduces to `never` is removed.
        let modifiers_ty = match source {
            Some((source, _)) => {
                let ty = self.instantiate(source, mapper);
                Some(self.reduced_apparent_type(ty))
            }
            None => None,
        };
        // `getPropertiesOfType(modifiersType)`
        if over_keyof
            && !self.never_in_progress.is_empty()
            && let Some(ty) = modifiers_ty
        {
            self.create_properties_of_intersection_in_progress(ty);
        }
        let owner = match modifiers_ty {
            Some(ty) if self.is_union(ty) => Some(self.union_as_object(ty)),
            other => other,
        };
        let modifiers = match owner {
            Some(ty) => self.members(ty).map(|members| (ty, members)),
            None => None,
        };
        let keys = match modifiers {
            // `forEachMappedTypePropertyKeyTypeAndIndexSignatureKeyType`. Over `keyof T`, the
            // properties and index signatures of `T` one by one: in the union `keyof T`, `string`
            // has absorbed the names.
            Some((owner, m)) if over_keyof => {
                let renames = self.mapped_decl(file, node).name_ty.is_some();
                let mut keys = Vec::with_capacity(m.shape().props.len() + m.shape().index.len());
                for prop in &m.shape().props {
                    let is_public = !prop
                        .flags
                        .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED);
                    let key = if is_public {
                        self.key_type_of_prop(owner, prop)
                    } else {
                        None
                    };
                    match key {
                        Some(key) => keys.push(key),
                        // A non-public property has the key `never`, which only an `as` clause can
                        // turn into a name.
                        None if renames => keys.push(TypeId::NEVER),
                        None => {}
                    }
                }
                keys.extend(m.shape().index.iter().map(|i| i.key));
                List::Own(keys)
            }
            // A type that can be anything is iterated as if every string were a property name.
            _ if over_keyof && modifiers_ty.is_some_and(|ty| self.has_any_flag(ty)) => {
                List::One(TypeId::STRING)
            }
            // Only `T` is inspected: `never`, `unknown` and the like have nothing to iterate over,
            // whatever `keyof` yields for them.
            _ if over_keyof => List::Kept(&[]),
            // It is the type itself for every other.
            _ if self.is_generic(constraint)
                || (self.parts(constraint).iter()).any(|&key| self.is_intersection(key)) =>
            {
                let bound = self.lower_bound_of_key_type(constraint);
                self.each_type(bound)
            }
            _ => self.each_type(constraint),
        };
        (keys, modifiers)
    }

    /// What `forEachType` visits: the members of a union, and any other type itself, `never` too.
    fn each_type(&self, ty: TypeId) -> List<'p, TypeId> {
        match self.is_union(ty) {
            true => List::Kept(self.parts(ty)),
            false => List::One(ty),
        }
    }

    /// `getTypeOfMappedSymbol`: the type of a property of a mapped type, where `ty` is the
    /// instantiated template for it.
    /// `strips`: `-?` turns an optional property into a required one (`CheckFlagsStripOptional`).
    fn mapped_property_type(
        &mut self,
        ty: TypeId,
        modifier: MappedModifier,
        optional: bool,
        strips: bool,
    ) -> TypeId {
        if modifier == MappedModifier::Add {
            // `getTemplateTypeFromMappedType` adds the optionality to the declared template type, whatever it
            // instantiates to.
            self.optional_property(ty)
        } else if optional {
            // `maybeTypeOfKind(ty, TypeFlagsUndefined | TypeFlagsVoid)`
            if self.maybe_type_of_kind(ty, |_, t| t.is_undefined() || t == TypeId::VOID) {
                ty
            } else {
                self.optional_property(ty)
            }
        } else if strips {
            self.remove_missing_or_undefined_type(ty)
        } else {
            ty
        }
    }

    /// `links.containingType` of the symbol that `prop` stands for. `build_mapped_shape` created
    /// `prop` for the mapped type `of`: `prop.mapper` is the mapper of `of` with the key type for
    /// the type parameter. In a copy of the property that mapper is composed with another.
    /// `resolveObjectTypeMembers` instantiates the base type, and the instantiation of a mapped
    /// type with other type arguments has symbols of its own.
    pub(super) fn containing_type_of_mapped_prop(&self, of: TypeId, prop: &Prop) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(of) else {
            return of;
        };
        let types = self.types();
        let own = types.mapping(mapper);
        let type_argument = |&(param, value): &(TypeId, TypeId)| {
            (param, types.map(prop.mapper, param).unwrap_or(value))
        };
        if own.iter().all(|pair| type_argument(pair) == *pair) {
            return of;
        }
        let type_arguments: SmallVec<[(TypeId, TypeId); 8]> =
            own.iter().map(type_argument).collect();
        self.intern(TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper: types.mapper_of(&type_arguments),
        })
    }

    /// `links.syntheticOrigin` of the symbol that `prop` stands for: `modifiersProp` of
    /// `addMemberForKeyTypeWorker`. `build_mapped_shape` created `prop` for the mapped type `of`.
    pub(super) fn synthetic_origin(&mut self, of: TypeId, prop: &Prop) -> Option<&'p Prop<'p>> {
        let of = self.containing_type_of_mapped_prop(of, prop);
        let (file, node, mapper) = self.mapped_origin(of)?;
        let param = self.type_param(file, self.mapped_decl(file, node).param);
        let key_type = self.types().map(prop.mapper, param)?;
        // `keyType` is the union of the keys that have the name. The first created the symbol.
        let key = if self.is_union(key_type) {
            let constraint = self.mapped_constraint(file, node, mapper);
            let (keys, _) = self.mapped_key_types(file, node, mapper, constraint);
            let named_alike = self.parts(key_type);
            keys.iter().copied().find(|key| named_alike.contains(key))?
        } else {
            key_type
        };
        let name = self.property_name_of_type(key)?;
        let modifiers_type = self.mapped_modifiers_type(of).unwrap_or(TypeId::UNKNOWN);
        let (origin, _) = self.get_property_of_type(modifiers_type, name)?;
        Some(origin)
    }

    /// `getTypeOfMappedSymbol`: the type of `prop`, which `build_mapped_shape` created for the
    /// mapped type `of`, or of a copy of it. `strips` is `CheckFlagsStripOptional`.
    pub(super) fn type_of_mapped_prop(&mut self, of: TypeId, prop: &Prop, strips: bool) -> TypeId {
        let known = (self.p.mapped_prop_types).get(&self.task, &(of, prop.name));
        // `TypeFlagsAny`: no type variables, so it is the same under every mapper.
        if let Some(known) = known
            && self.has_any_flag(known)
        {
            return known;
        }
        let Some((file, node, _)) = self.mapped_origin(of) else {
            return TypeId::UNRESOLVED;
        };
        let created_for = of;
        let of = self.containing_type_of_mapped_prop(created_for, prop);
        let known = if of == created_for {
            known
        } else {
            (self.p.mapped_prop_types).get(&self.task, &(of, prop.name))
        };
        if let Some(known) = known {
            return known;
        }
        let q = Query::MappedProp(of, prop.name);
        if let Some(raw) = self.provisional(q) {
            return TypeId(raw as u32);
        }
        if !self.enter(q) {
            if !self.found_cycle {
                return TypeId::UNRESOLVED;
            }
            // `mappedType.containsError = true`
            let stored = self.cycle_result();
            (self.p.mapped_types_with_errors).insert(&self.task, of, (), stored);
            return TypeId::ERROR;
        }
        let mapped = self.mapped_decl(file, node);
        let template = if mapped.ty.is_some() {
            self.type_from_node(file, mapped.ty)
        } else {
            TypeId::ERROR
        };
        let ty = self.instantiate(template, prop.mapper);
        let ty = self.mapped_property_type(
            ty,
            mapped.optional,
            prop.flags.contains(PropFlags::OPTIONAL),
            strips,
        );
        let left = self.leave(q);
        if self.left_a_cycle {
            let stored = self.cycle_result();
            let kept = (self.p.mapped_prop_types).insert(
                &self.task,
                (of, prop.name),
                TypeId::ERROR,
                stored,
            );
            // After `links.resolvedType = c.errorType`: the message prints `of`, which has this
            // property.
            self.circular_mapped_property(of, prop.name);
            return kept;
        }
        match left {
            Ok(stored) => {
                (self.p.mapped_prop_types).insert(&self.task, (of, prop.name), ty, stored)
            }
            Err(open) => {
                self.cache_provisionally(q, u64::from(ty.0), open);
                ty
            }
        }
    }

    /// `resolveMappedTypeMembers`
    pub(super) fn build_mapped_shape(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> Shape<'s> {
        let mapped = self.mapped_decl(file, node);
        let param = self.type_param(file, mapped.param);
        let constraint = self.mapped_constraint(file, node, mapper);
        let mut shape = Shape::new_in(self.arena);
        let name_declared = if mapped.name_ty.is_some() {
            Some(self.type_from_node(file, mapped.name_ty))
        } else {
            None
        };
        let template_declared = if mapped.ty.is_some() {
            self.type_from_node(file, mapped.ty)
        } else {
            TypeId::ERROR
        };
        let (keys, modifiers) = self.mapped_key_types(file, node, mapper, constraint);
        let of = self.intern(TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        });
        if keys.len() > 4 {
            shape.props.reserve_exact(keys.len());
        }
        // `shouldLinkPropDeclarations`: `getMappedTypeNameTypeKind(mappedType) != MappedTypeNameTypeKindRemapping`
        let links_declarations = modifiers.is_some()
            && match name_declared {
                Some(declared) => self.is_assignable(declared, param),
                None => true,
            };
        // The index of each name in `shape.props`, once there are many.
        let mut places: FxHashMap<Atom, usize> = FxHashMap::default();
        for key in keys {
            let with_key = self.mapper_with_pair(mapper, param, key);
            let names = match name_declared {
                Some(declared) => self.instantiate(declared, with_key),
                None => key,
            };
            let key_name = self.property_name_of_type(key);
            // `modifiersProp`: `getPropertyOfType(modifiersType, ..)`
            let source_prop = match (&modifiers, key_name) {
                (Some((modifiers_type, m)), Some(name)) => self
                    .property_in_type(*modifiers_type, m, name)
                    .map(|(prop, _)| prop),
                _ => None,
            };
            // `addMemberForKeyTypeWorker`
            for &name_ty in self.parts(names) {
                let name = if name_ty == key {
                    key_name
                } else {
                    self.property_name_of_type(name_ty)
                };
                let place = match name {
                    Some(name) if shape.props.len() < 16 => {
                        shape.props.iter().position(|p| p.name == name)
                    }
                    Some(name) => {
                        if places.is_empty() {
                            places.extend(shape.props.iter().enumerate().map(|(i, p)| (p.name, i)));
                        }
                        places.get(&name).copied()
                    }
                    None => None,
                };
                match name {
                    Some(name) => match place {
                        // One property for all the keys that map to its name. Its `keyType` is
                        // their union. The first key determines the modifiers.
                        Some(i) => {
                            let so_far = self
                                .types()
                                .map(shape.props[i].mapper, param)
                                .unwrap_or(key);
                            let all = self.union(&[so_far, key]);
                            if all != so_far {
                                shape.props[i].mapper = self.mapper_with_pair(mapper, param, all);
                            }
                        }
                        None => {
                            let was_optional =
                                source_prop.is_some_and(|p| p.flags.contains(PropFlags::OPTIONAL));
                            let optional = match mapped.optional {
                                MappedModifier::Add => true,
                                MappedModifier::Remove => false,
                                MappedModifier::None => was_optional,
                            };
                            let readonly = match mapped.readonly {
                                MappedModifier::Add => true,
                                MappedModifier::Remove => false,
                                MappedModifier::None => source_prop
                                    .is_some_and(|p| p.flags.contains(PropFlags::READONLY)),
                            };
                            let strips = self.p.files.options.strict_null_checks
                                && !optional
                                && was_optional;
                            let mut flags = PropFlags::empty();
                            if optional {
                                flags |= PropFlags::OPTIONAL;
                            }
                            if readonly {
                                flags |= PropFlags::READONLY;
                            }
                            // `nameType`: created from a string, it is named by a string.
                            if self.is_string_like(name_ty) && self.is_numeric_name(name) {
                                flags |= PropFlags::STRING_NAME;
                            }
                            if !places.is_empty() {
                                places.insert(name, shape.props.len());
                            }
                            // `prop.Declarations = modifiersProp.Declarations`
                            let declared = match source_prop {
                                Some(modifiers_prop) if links_declarations => {
                                    Self::declared_properties(&[modifiers_prop], self.arena)
                                }
                                _ => SmallVec::new(),
                            };
                            let declared = (!declared.is_empty()).then(|| self.list_of(declared));
                            // The type is resolved on demand (`type_of_mapped_prop`): the template under `with_key`.
                            shape.props.push(Prop {
                                name,
                                flags,
                                source: PropSource::Mapped(of, strips, declared),
                                mapper: with_key,
                            });
                        }
                    },
                    None => {
                        // `isValidIndexKeyType`, `any` and enums: a name of type `any` is any
                        // string, one that is some member of an enum is any number. Anything else,
                        // like a type parameter or a template containing one, adds nothing.
                        let index_key = if self.is_any(name_ty) || name_ty == TypeId::STRING {
                            TypeId::STRING
                        } else if name_ty == TypeId::NUMBER
                            || matches!(self.data(name_ty), TypeData::Enum { .. })
                        {
                            TypeId::NUMBER
                        } else if name_ty == TypeId::SYMBOL || self.is_pattern_literal(name_ty) {
                            name_ty
                        } else if let TypeData::Intersection(parts) = self.data(name_ty)
                            && !self.is_generic(name_ty)
                            && parts.iter().any(|&p| {
                                matches!(p, TypeId::STRING | TypeId::NUMBER | TypeId::SYMBOL)
                                    || self.is_pattern_literal(p)
                            })
                        {
                            // `string & {}` is a distinct key type: no number matches it.
                            name_ty
                        } else {
                            continue;
                        };
                        let ty = self.instantiate(template_declared, with_key);
                        let ty = if mapped.optional == MappedModifier::Add {
                            self.optional_property(ty)
                        } else {
                            ty
                        };
                        let readonly = match (mapped.readonly, &modifiers) {
                            (MappedModifier::Add, _) => true,
                            // `getApplicableIndexInfo(modifiersType, propNameType)`
                            (MappedModifier::None, Some((_, m))) => self
                                .applicable_index_info(m, name_ty)
                                .is_some_and(|info| info.readonly),
                            _ => false,
                        };
                        // `appendIndexInfo`
                        match shape.index.iter_mut().find(|i| i.key == index_key) {
                            Some(existing) => {
                                existing.value = self.union(&[existing.value, ty]);
                                existing.readonly |= readonly;
                            }
                            None => shape.index.push(IndexInfo::new(index_key, ty, readonly)),
                        }
                    }
                }
            }
        }
        self.get_named_members(&mut shape.props, |_| true, &[]);
        shape
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// `getTemplateLiteralType`: `` `${A}text${B}` ``
    pub fn template_type(&mut self, texts: &[Atom], types: &[TypeId]) -> TypeId {
        // `mapType` returns a type with `TypeFlagsNever` as it is. After a union there is one for
        // each member, and their union is `never`.
        if let Some(at) = types.iter().position(|t| t.is_never()) {
            let follows_union = types[..at].iter().any(|&t| self.is_union(t));
            return if follows_union {
                TypeId::NEVER
            } else {
                types[at]
            };
        }
        if types.contains(&TypeId::UNRESOLVED) {
            return TypeId::UNRESOLVED;
        }
        if let Some(at) = types.iter().position(|&t| self.is_union(t)) {
            if !self.check_cross_product_union(types) {
                return TypeId::ERROR;
            }
            let parts = self.parts(types[at]).to_vec();
            let mut results = Vec::with_capacity(parts.len());
            for part in parts {
                let mut with = types.to_vec();
                with[at] = part;
                results.push(self.template_type(texts, &with));
            }
            return self.union(&results);
        }
        if types.contains(&TypeId::WILDCARD) {
            return TypeId::WILDCARD;
        }
        let mut new_texts: Vec<Vec<u8>> = vec![self.atoms().bytes(texts[0]).to_vec()];
        let mut new_types: Vec<TypeId> = Vec::new();
        for (i, &ty) in types.iter().enumerate() {
            let literal: Option<Vec<u8>> = match *self.data(ty.plain()) {
                TypeData::StringLit { value, .. }
                | TypeData::EnumLit {
                    value: EnumValue::String(value),
                    ..
                } => Some(self.atoms().bytes(value).to_vec()),
                TypeData::NumberLit { bits, .. }
                | TypeData::EnumLit {
                    value: EnumValue::Number(bits),
                    ..
                } => {
                    let name = self.number_name(f64::from_bits(bits));
                    Some(self.atoms().bytes(name).to_vec())
                }
                TypeData::BoolLit { value, .. } => Some(if value {
                    b"true".to_vec()
                } else {
                    b"false".to_vec()
                }),
                TypeData::BigIntLit { text, negative, .. } => {
                    let mut t = if negative { b"-".to_vec() } else { Vec::new() };
                    t.extend_from_slice(self.atoms().bytes(text));
                    Some(t)
                }
                TypeData::Intrinsic(Intrinsic::Null) => Some(b"null".to_vec()),
                TypeData::Intrinsic(Intrinsic::Undefined) => Some(b"undefined".to_vec()),
                _ => None,
            };
            let next = self.atoms().bytes(texts[i + 1]);
            match literal {
                Some(text) => {
                    let last = new_texts.last_mut().unwrap();
                    last.extend_from_slice(&text);
                    last.extend_from_slice(next);
                }
                None => {
                    if let TypeData::Template {
                        texts: inner_texts,
                        types: inner_types,
                    } = self.data(ty)
                    {
                        new_texts
                            .last_mut()
                            .unwrap()
                            .extend_from_slice(self.atoms().bytes(inner_texts[0]));
                        for (j, &t) in inner_types.iter().enumerate() {
                            new_types.push(t);
                            new_texts.push(self.atoms().bytes(inner_texts[j + 1]).to_vec());
                        }
                        new_texts.last_mut().unwrap().extend_from_slice(next);
                    } else if self.is_generic_index_type(ty)
                        || self.is_pattern_literal_placeholder(ty)
                    {
                        new_types.push(ty);
                        new_texts.push(next.to_vec());
                    } else {
                        // With anything else in it, a symbol or an object, all that can be said is that it is a string.
                        return TypeId::STRING;
                    }
                }
            }
        }
        for text in &mut new_texts {
            combine_surrogate_pairs(text);
        }
        if new_types.is_empty() {
            let value = self.atoms().intern(&new_texts[0]);
            return self.string_literal(value, false);
        }
        if new_texts.iter().all(Vec::is_empty) {
            if new_types.iter().all(|&t| t == TypeId::STRING) {
                return TypeId::STRING;
            }
            // `${Uppercase<string>}` is `Uppercase<string>`.
            if let [only] = new_types[..]
                && self.is_pattern_literal(only)
            {
                return only;
            }
        }
        self.intern(TypeData::Template {
            texts: self.list_of(new_texts.iter().map(|t| self.atoms().intern(t))),
            types: self.list(&new_types),
        })
    }

    /// `applyStringMapping`
    fn map_text(&self, kind: StringMappingKind, value: Atom) -> Atom {
        let mut mapped: Vec<u8> = Vec::new();
        // A lone surrogate, three bytes that are not valid UTF-8, has no case.
        for (i, chunk) in self.atoms().bytes(value).utf8_chunks().enumerate() {
            let text = chunk.valid();
            let mut chars = text.chars();
            let mut push =
                |c: char| mapped.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            // How much of `text` is left unchanged.
            let rest = match (kind, chars.next()) {
                (StringMappingKind::Uppercase, _) => {
                    text.chars()
                        .flat_map(char::to_uppercase)
                        .for_each(&mut push);
                    ""
                }
                // Not one character at a time: a sigma at the end of a word has a form of its own.
                (StringMappingKind::Lowercase, _) => {
                    text.to_lowercase().chars().for_each(&mut push);
                    ""
                }
                (StringMappingKind::Capitalize, Some(first)) if i == 0 => {
                    first.to_uppercase().for_each(&mut push);
                    chars.as_str()
                }
                (StringMappingKind::Uncapitalize, Some(first)) if i == 0 => {
                    first.to_lowercase().for_each(&mut push);
                    chars.as_str()
                }
                _ => text,
            };
            mapped.extend_from_slice(rest.as_bytes());
            mapped.extend_from_slice(chunk.invalid());
        }
        self.atoms().intern(&mapped)
    }

    /// `getStringMappingType`
    pub fn string_mapping(&mut self, kind: StringMappingKind, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(_) => self.map_type(ty, |c, m| c.string_mapping(kind, m)),
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral
                | Intrinsic::Unresolved,
            ) => ty,
            // `TypeFlagsStringLiteral`, which a string enum member has too: the result is a plain
            // string.
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let mapped = self.map_text(kind, *value);
                self.string_literal(mapped, false)
            }
            // `applyTemplateStringMapping`: a mapping of all letters applies to every part, a
            // mapping of the first letter to the first part.
            TypeData::Template { texts, types } => {
                let (mut texts, mut types) = (texts.to_vec(), types.to_vec());
                match kind {
                    StringMappingKind::Uppercase | StringMappingKind::Lowercase => {
                        for text in &mut texts {
                            *text = self.map_text(kind, *text);
                        }
                        for placeholder in &mut types {
                            *placeholder = self.string_mapping(kind, *placeholder);
                        }
                    }
                    _ if texts[0] != known::empty => texts[0] = self.map_text(kind, texts[0]),
                    _ => types[0] = self.string_mapping(kind, types[0]),
                }
                self.template_type(&texts, &types)
            }
            // The mapping is idempotent.
            TypeData::StringMapping { kind: same, .. } if *same == kind => ty,
            TypeData::Intrinsic(
                Intrinsic::Any
                | Intrinsic::Error
                | Intrinsic::Auto
                | Intrinsic::IntrinsicMarker
                | Intrinsic::Wildcard
                | Intrinsic::NonInferrableAny
                | Intrinsic::String,
            )
            | TypeData::UnresolvedName { .. }
            | TypeData::StringMapping { .. } => self.intern(TypeData::StringMapping { kind, ty }),
            _ if self.is_generic_index_type(ty) => {
                self.intern(TypeData::StringMapping { kind, ty })
            }
            // A number is mapped as its string form.
            _ if self.is_pattern_literal_placeholder(ty) => {
                let inner = self.template_type(&[known::empty, known::empty], &[ty]);
                self.intern(TypeData::StringMapping { kind, ty: inner })
            }
            _ => ty,
        }
    }
}

/// `CombineSurrogatePairs`: a lone high surrogate immediately before a lone low one combines with
/// it into one character. Each is three bytes (`EncodeJSStringRune`).
pub(super) fn combine_surrogate_pairs(text: &mut Vec<u8>) {
    let mut at = 0;
    while at + 6 <= text.len() {
        let [
            0xED,
            h1 @ 0xA0..=0xAF,
            h2 @ 0x80..=0xBF,
            0xED,
            l1 @ 0xB0..=0xBF,
            l2 @ 0x80..=0xBF,
        ] = text[at..at + 6]
        else {
            at += 1;
            continue;
        };
        let high = u32::from(h1 & 0x0F) << 6 | u32::from(h2 & 0x3F);
        let low = u32::from(l1 & 0x0F) << 6 | u32::from(l2 & 0x3F);
        let ch =
            char::from_u32(0x10000 + (high << 10 | low)).unwrap_or(char::REPLACEMENT_CHARACTER);
        text.splice(at..at + 6, ch.encode_utf8(&mut [0; 4]).bytes());
        at += 4;
    }
}
