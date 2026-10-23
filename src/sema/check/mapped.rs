//! Types computed from other types: `keyof`, `T[K]`, conditional, mapped and template literal types.

use super::alias::NewAlias;
use super::related::FileSpan;
use super::shortcuts::task_fact;
use super::*;
use crate::bind::Decl;
use crate::bind::Parent;
use crate::resolve::{is_cased_since_unicode_16, to_lowercase_unicode_15, to_uppercase_unicode_15};
use crate::util::SharedSort;
use smallvec::SmallVec;

/// `accessNode` of `getIndexedAccessTypeOrUndefined`. `None` is an access produced by instantiation
/// or by a constraint. `Other` is a name in a pattern, where nothing is reported yet.
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
    Name(FileSpan),
    Other,
}

/// The target and key of a `getObjectTypeInstantiation` call on a mapped type.
pub(super) struct MappedInstantiation {
    target: (FileId, TypeNodeId),
    /// `InstantiationKey::type_arguments`
    type_arguments: MapperId,
    /// `NewAlias::Given`
    alias: Option<(Sym, SmallVec<[TypeId; 4]>)>,
    /// `InstantiationKey::nesting`
    nesting: u8,
}

/// The parts of tsgo's `ConditionalRoot` that `getConditionalType` reads on every call. See
/// `Checker::conditional_roots`.
#[derive(Clone)]
pub(super) struct ConditionalRoot {
    /// `root.checkType`
    check_declared: TypeId,
    /// `getActualTypeVariable(root.checkType)`
    check_variable: TypeId,
    /// `root.extendsType`
    extends_declared: TypeId,
    /// True if the check and extends nodes are tuples of the same length without optional or rest elements.
    check_tuples: bool,
    /// `root.inferTypeParameters`
    infer_params: SmallVec<[TypeId; 4]>,
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns `mapper` with the pair `param` -> `ty` appended.
    fn mapper_with_pair(&self, mapper: MapperId, param: TypeId, ty: TypeId) -> MapperId {
        let mapping = self.types().mapping(mapper);
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::with_capacity(mapping.len() + 1);
        pairs.extend_from_slice(mapping);
        pairs.push((param, ty));
        self.types().mapper_of(&pairs)
    }

    /// Returns `Prop::mapper`, with the key added if `prop` stores its key separately (`Types::separate_key`). Use this
    /// to read the mapper of any property that may belong to a mapped type, except to compare two properties.
    pub(super) fn mapper_of_prop(&self, prop: &Prop) -> MapperId {
        let (Some(key), PropSource::Mapped(of, ..)) =
            (self.types().separate_key(prop), &prop.source)
        else {
            return prop.mapper;
        };
        let Some((file, node, mapper)) = self.mapped_origin(*of) else {
            return prop.mapper;
        };
        let param = self.type_param(file, self.mapped_decl(file, node).param);
        self.mapper_with_pair(mapper, param, key)
    }

    /// Returns `compose(prop.mapper, outer)`, to be stored as `Prop::mapper` in a copy of `prop`. The flag is true if
    /// the copy still stores its key separately, like `prop`, because composing changed nothing.
    pub(super) fn composed_mapper_of_prop(
        &mut self,
        prop: &Prop,
        outer: MapperId,
    ) -> (MapperId, bool) {
        if self.types().separate_key(prop).is_none() {
            return (self.compose(prop.mapper, outer), false);
        }
        if outer == MapperId::IDENTITY {
            return (prop.mapper, true);
        }
        let with_key = self.mapper_of_prop(prop);
        let composed = self.compose(with_key, outer);
        match composed == with_key {
            true => (prop.mapper, true),
            false => (composed, false),
        }
    }

    /// Sets `prop.mapper` to `compose(prop.mapper, outer)`.
    pub(super) fn compose_mapper_of_prop(&mut self, prop: &mut Prop, outer: MapperId) {
        let had_separate_key = self.types().separate_key(prop).is_some();
        let (composed, has_separate_key) = self.composed_mapper_of_prop(prop, outer);
        prop.mapper = composed;
        if had_separate_key && !has_separate_key {
            prop.name_type = TypeId::UNRESOLVED;
        }
    }

    /// Call before changing `prop.source`. Clears a separately stored key, which is only valid for the current source.
    pub(super) fn forget_separate_key(&self, prop: &mut Prop) {
        if self.types().separate_key(prop).is_some() {
            prop.name_type = TypeId::UNRESOLVED;
        }
    }

    /// `prependTypeMapping`. It builds a `MergedTypeMapper`, so `source` maps to `mapper`'s result
    /// for `target`. That differs from `target` if `target` is a type parameter that `mapper` maps.
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
    /// A mapped type resolves its constraint type no matter which flag is requested.
    fn get_generic_object_flags(&mut self, ty: TypeId) -> (bool, bool) {
        let (object, index, _) = self.generic_object_flags_and_is_resolved(ty);
        (object, index)
    }

    /// `getGenericObjectFlags`, plus a third flag that is true if the answer depends on a mapped type, whether it was
    /// computed now or cached earlier. If the flag is false, nothing was resolved and the answer depends only on the
    /// structure of the types.
    fn generic_object_flags_and_is_resolved(&mut self, ty: TypeId) -> (bool, bool, bool) {
        match *self.data(ty) {
            TypeData::Union(ref parts) | TypeData::Intersection(ref parts) => {
                let known = if self.types().member_flags(ty) & (tf::INSTANTIABLE | tf::OBJECT) == 0
                {
                    // Only object types and instantiable types can be generic.
                    Some((false, false))
                } else {
                    self.types().generic_object_flags(ty)
                };
                if let Some((object, index)) = known {
                    return (object, index, false);
                }
                // `ObjectFlagsIsGenericTypeComputed`
                let known = self.task_facts.get(ty);
                if known & task_fact::GENERIC_OBJECT_FLAGS_COMPUTED != 0 {
                    return (
                        known & task_fact::IS_GENERIC_OBJECT_TYPE != 0,
                        known & task_fact::IS_GENERIC_INDEX_TYPE != 0,
                        true,
                    );
                }
                let (object, index, is_resolved) = self.generic_object_flags_of_all(parts);
                if !is_resolved {
                    (self.types()).set_generic_object_flags(ty, (object, index));
                } else {
                    let mut facts = task_fact::GENERIC_OBJECT_FLAGS_COMPUTED;
                    if object {
                        facts |= task_fact::IS_GENERIC_OBJECT_TYPE;
                    }
                    if index {
                        facts |= task_fact::IS_GENERIC_INDEX_TYPE;
                    }
                    let all = task_fact::GENERIC_OBJECT_FLAGS_COMPUTED
                        | task_fact::IS_GENERIC_OBJECT_TYPE
                        | task_fact::IS_GENERIC_INDEX_TYPE;
                    self.task_facts.replace(ty, all, facts);
                }
                (object, index, is_resolved)
            }
            TypeData::Substitution { base, constraint } => {
                self.generic_object_flags_of_all(&[base, constraint])
            }
            _ => {
                let flags = self.flags(ty);
                (
                    flags & tf::INSTANTIABLE_NON_PRIMITIVE != 0
                        || self.is_generic_mapped_type(ty)
                        || self.is_generic_tuple_type(ty),
                    flags & (tf::INSTANTIABLE_NON_PRIMITIVE | tf::INDEX) != 0
                        || self.is_generic_string_like_type(ty),
                    self.is_mapped_type(ty),
                )
            }
        }
    }

    /// ORs together `generic_object_flags_and_is_resolved` for each of `types`.
    fn generic_object_flags_of_all(&mut self, types: &[TypeId]) -> (bool, bool, bool) {
        let mut all = (false, false, false);
        for &ty in types {
            let one = self.generic_object_flags_and_is_resolved(ty);
            all = (all.0 | one.0, all.1 | one.1, all.2 | one.2);
        }
        all
    }

    /// `isGenericStringLikeType`
    fn is_generic_string_like_type(&mut self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Template { .. } | TypeData::StringMapping { .. }
        ) && !self.is_pattern_literal(ty)
    }

    /// `isGenericMappedType`
    #[inline(always)]
    pub(super) fn is_generic_mapped_type(&mut self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => self.is_mapped_type_generic(ty, file, node, mapper),
            _ => false,
        }
    }

    /// `isGenericMappedType` of the mapped type `ty`, which is declared at `node` and instantiated with `mapper`.
    #[inline(never)]
    fn is_mapped_type_generic(
        &mut self,
        ty: TypeId,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> bool {
        let constraint = self.mapped_keys(ty);
        if self.is_generic_index_type(constraint) {
            return true;
        }
        // It's also generic if its `as` clause mentions something generic other than the key, so
        // the name is still generic after the known keys are substituted for the key parameter.
        let mapped = self.mapped_decl(file, node);
        if mapped.name_ty.is_none() {
            return false;
        }
        let declared = self.declared_name_type_of_mapped(file, node);
        let param = self.type_param(file, mapped.param);
        let with_keys = self.mapper_with_pair(mapper, param, constraint);
        // The name may contain `ty`, as in `{ [K in keyof C as C[K] & string]: 1 }` as a member of `C`.
        // `isGenericMappedType` has no guard and caches nothing. Each level only instantiates the name with its own
        // mapper, until `instantiationCount` hits its limit. The native stack overflows before that, so the recursion
        // is cut short here. A recursion that terminates, as in type-fest's `PartialOnUndefinedDeep`, isn't cut. Once
        // the limit is hit, the unions and intersections in the name have `ObjectFlagsIsGenericTypeComputed`.
        if self.generic_mapped_types_cut_short.contains(&ty) {
            return false;
        }
        // In `{ [K in "a" as Z<T[]>]: 1 }`, every level is a different type from the same declaration.
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
                if self.maybe_type_of_kind(ty, tf::INSTANTIABLE)
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
        let (decl, constraint) = (self.mapped_decl(file, node), self.mapped_keys(ty));
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
            List::Permanent(self.parts(constraint))
        } else {
            self.mapped_key_types(file, node, mapper, constraint).0
        };
        let name_type = if decl.name_ty.is_some() {
            Some((
                self.type_param(file, decl.param),
                self.declared_name_type_of_mapped(file, node),
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
        let is_inner = self.keys_of_properties_in_progress.contains(&ty);
        self.keys_of_properties_in_progress.push(ty);
        let keys = self.get_literal_type_from_properties_uncached(ty, index_flags);
        self.keys_of_properties_in_progress.pop();
        let result = self.end_scope_by_counters(scope);
        // tsgo sets `c.propertiesTypes[key] = result` no matter what's in progress. In `interface D extends M<D>`,
        // whether `M<D>` is a valid base type depends on `keyof D`, which from then on lacks the keys of `M<D>`.
        // The exception is when it all began with `keyof D`, because the evaluation that finishes last wins.
        let replaces = (self.p.keys_of_properties.get(&self.task, &ty)).is_some();
        let stored = match result {
            Ok(stored) if is_inner => stored.held_back(),
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

    /// True if `ty` is the declared type of a class or interface whose `getBaseTypes` is in
    /// progress, and it doesn't have `ObjectFlagsUnresolvedMembers`.
    fn is_resolving_base_types_of(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.base_types_so_far.iter().any(|it| it.0 == target)
            && !self.inheriting.iter().any(|it| it.0 == ty)
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
        for info in self.structured(members).index_infos() {
            if !info.is_enum_number_index_info && self.is_key_type_included(info.key, include) {
                // `stringOrNumberType`, as a single type
                keys.push(if info.key == TypeId::STRING {
                    self.union(&[TypeId::STRING, TypeId::NUMBER])
                } else {
                    info.key
                });
            }
        }
        // `getUnionTypeEx` returns the only type of a one-element list and ignores the origin.
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

    /// Returns the literal type for the property name `name`, as far as the name alone determines
    /// it, or `None` for a private name.
    pub(super) fn key_type_of_name(&mut self, name: Atom) -> Option<TypeId> {
        let text = self.atoms().bytes(name);
        if self.atoms().is_private_symbol_name(name) {
            return None;
        }
        if let Some(rest) = text.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            // `property_name_of_type` produces this format.
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

    /// `getLiteralTypeFromProperty`. Returns the literal type for the name of `prop`, a property of
    /// `owner`, or `None` for a private name. It prefers the type the name was created from
    /// (`nameType`), then falls back to the name's syntax in the property's declaration. A name
    /// that parses as a number is a number literal type only if it's a numeric literal in the
    /// source. A property without a declaration, like a tuple element, gets a string literal type.
    pub(super) fn key_type_of_prop(&mut self, owner: TypeId, prop: &Prop) -> Option<TypeId> {
        let key = self.name_type_or_key_type_of_prop(owner, prop)?;
        // `t.flags&include != 0`. No caller includes unions. If two keys of a mapped type produce the same name, the
        // property's `nameType` is a union.
        Some(match self.is_union(key) {
            true => TypeId::NEVER,
            false => key,
        })
    }

    /// `key_type_of_prop` without the `t.flags&include` test.
    fn name_type_or_key_type_of_prop(&mut self, owner: TypeId, prop: &Prop) -> Option<TypeId> {
        // A separately stored key (`Types::separate_key`) is also the `nameType`, because there is no `as` clause.
        if prop.name_type != TypeId::UNRESOLVED {
            return Some(prop.name_type);
        }
        if let PropSource::Mapped(of, ..) = prop.source
            && let Some(name) = self.name_type_of_mapped_prop(of, prop)
        {
            return Some(name);
        }
        if prop.flags.contains(PropFlags::STRING_NAME) {
            return Some(self.string_literal(prop.name, false));
        }
        let text = self.atoms().bytes(prop.name);
        let (file, (key, name_kind)) = match &prop.source {
            PropSource::Symbol(sym) => match self.files().value_declaration(*sym) {
                Some((file, Decl::Member(member))) => {
                    let hir = self.hir(file);
                    (file, hir.key_of(hir.node(member)))
                }
                Some((
                    file,
                    Decl::Expando(e) | Decl::ThisProperty(e) | Decl::ExportsProperty(e),
                )) => {
                    let key = self.key_of_assignment_declaration(file, e);
                    (file, (key, Default::default()))
                }
                // An alias: `export { x as "0" }`.
                None if !text.starts_with(crate::atom::SYMBOL_NAME_PREFIX) => {
                    return Some(self.string_literal(prop.name, false));
                }
                _ => return self.key_type_of_name(prop.name),
            },
            PropSource::Literal(file, literal_prop) => {
                let literal_prop = &self.hir(*file)[*literal_prop];
                (*file, (literal_prop.key, literal_prop.name_kind))
            }
            PropSource::Type(_)
                if self.is_tuple(owner) && text.first().is_some_and(|c| c.is_ascii_digit()) =>
            {
                return Some(self.string_literal(prop.name, false));
            }
            PropSource::Intersected(_, parts) => return self.key_type_of_props(owner, parts),
            // The copy has the first part's `ValueDeclaration`, so it uses the name's syntax there.
            PropSource::Copy(_, parts, true) => {
                return self.name_type_or_key_type_of_prop(owner, &parts[0]);
            }
            _ => return self.key_type_of_name(prop.name),
        };
        // A symbol-keyed name also encodes which symbol it is, so it isn't read from the syntax.
        let is_by_syntax = match key {
            PropKey::Name(_) => true,
            PropKey::Computed(_) => !text.starts_with(crate::atom::SYMBOL_NAME_PREFIX),
            _ => false,
        };
        // A late-bound symbol has a `nameType`, which spells its name. The name of `[+2]` is `+2`.
        let is_late_bound =
            matches!(key, PropKey::Computed(e) if is_dynamic_name(self.hir(file), e));
        // The position argument is only read for a name that isn't stored.
        if is_by_syntax
            && let Some(ty) = self.literal_type_from_property_name(file, key, name_kind, 0)
            && (!is_late_bound || self.property_name_of_type(ty) == Some(prop.name))
        {
            return Some(ty);
        }
        self.key_type_of_name(prop.name)
    }

    /// Returns `Prop::name_type` for a symbol created from `prop`, a property of `owner`.
    pub(super) fn name_type_of_copy(&mut self, owner: TypeId, prop: &Prop) -> TypeId {
        if prop.name_type != TypeId::UNRESOLVED && self.types().separate_key(prop).is_none() {
            return prop.name_type;
        }
        // A `nameType` is stored for a late-bound name (`lateBindMember`), for a computed name in an
        // object literal (`checkObjectLiteral`), and by a mapped type.
        let is_stored = match &prop.source {
            PropSource::Type(_) => false,
            PropSource::Symbol(sym) => {
                matches!(self.files().value_declaration(*sym), Some((file, Decl::Member(m)))
                    if matches!(self.hir(file)[m].key, PropKey::Computed(_)))
            }
            PropSource::Literal(file, literal_prop) => {
                matches!(self.hir(*file)[*literal_prop].key, PropKey::Computed(_))
            }
            PropSource::Mapped(..)
            | PropSource::Intersected(..)
            | PropSource::Copy(..)
            | PropSource::ReverseMapped(..) => true,
        };
        let key = is_stored.then(|| self.name_type_or_key_type_of_prop(owner, prop));
        match key.flatten() {
            Some(key) if self.flags(key) & tf::ENUM_LITERAL != 0 => key,
            Some(key) if self.is_union(key) => key,
            _ => TypeId::UNRESOLVED,
        }
    }

    /// Returns the `nameType` of `prop`, a property of the mapped type `of`. That's `propNameType` in
    /// `addMemberForKeyTypeWorker`, for all the keys that map to the property's name. An enum member
    /// isn't the same type as the string it spells. Returns `None` if the property's key is unknown.
    fn name_type_of_mapped_prop(&mut self, of: TypeId, prop: &Prop) -> Option<TypeId> {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            ..
        } = *self.data(of)
        else {
            return None;
        };
        let mapped = self.mapped_decl(file, node);
        let param = self.type_param(file, mapped.param);
        let key = self.types().map(prop.mapper, param)?;
        let names = if mapped.name_ty.is_some() {
            let declared = self.declared_name_type_of_mapped(file, node);
            self.instantiate(declared, prop.mapper)
        } else {
            key
        };
        let mut matching_names: SmallVec<[TypeId; 2]> = SmallVec::new();
        for &name in self.parts(names) {
            if self.property_name_of_type(name) == Some(prop.name) {
                matching_names.push(name);
            }
        }
        match matching_names[..] {
            [] => None,
            [one] => Some(one),
            _ => Some(self.union(&matching_names)),
        }
    }

    /// `GetNonAssignedNameOfDeclaration` of `e`, an assignment or call that declares a property, as a
    /// member key: `a` for `f.a = v`, and `[k]` for `f[k] = v` and `Object.defineProperty(f, k, d)`.
    /// If `k` isn't a literal, its type becomes the symbol's `nameType`.
    pub(super) fn key_of_assignment_declaration(&self, file: FileId, e: ExprId) -> PropKey {
        let hir = self.hir(file);
        let argument = if let ExprKind::Assign { target, .. } = hir[e].kind {
            match hir[target].kind {
                ExprKind::Dot { name, .. } => return PropKey::Name(name),
                ExprKind::Index { index, .. } => Some(index),
                _ => None,
            }
        } else {
            crate::bind::define_property_call(hir, e).map(|call| call.1)
        };
        argument.map_or(PropKey::None, PropKey::Computed)
    }

    /// `key_type_of_prop` for the property that combines `props`, the same-named properties of a union's
    /// or intersection's members. `owner` has the first one. `createUnionOrIntersectionProperty` takes
    /// the first property's `nameType`. If that has none it uses the declaration, and the combined
    /// property has a declaration only if all declared properties share one.
    pub(super) fn key_type_of_props(&mut self, owner: TypeId, props: &[Prop]) -> Option<TypeId> {
        let first = &props[0];
        let key = self.key_type_of_prop(owner, first)?;
        // The declaration, if it's a member of a class, interface, type literal or object literal.
        let member = |prop: &Prop| match prop.source {
            PropSource::Symbol(sym) => (self.files().value_declaration(sym))
                .filter(|declaration| matches!(declaration.1, Decl::Member(_))),
            PropSource::Literal(file, literal_prop) => Some((file, Decl::Property(literal_prop))),
            _ => None,
        };
        let first_declaration = member(first);
        let is_by_declaration = match first_declaration {
            Some((file, Decl::Member(m))) => matches!(self.hir(file)[m].key, PropKey::Name(_)),
            Some((file, Decl::Property(p))) => matches!(self.hir(file)[p].key, PropKey::Name(_)),
            _ => false,
        };
        let is_declared_elsewhere =
            |other: &Prop| member(other).is_some_and(|it| Some(it) != first_declaration);
        if is_by_declaration
            && matches!(self.data(key), TypeData::NumberLit { .. })
            && props[1..].iter().any(is_declared_elsewhere)
        {
            return Some(self.string_literal(first.name, false));
        }
        Some(key)
    }

    // ───────────────────────────── T[K] ─────────────────────────────

    /// Returns `obj[index]` as a type, or `unknown` if there's no such property.
    pub fn indexed_access(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        self.indexed_access_if_any(obj, index)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// Instantiates a deferred `obj[index]` now that more is known about `obj` or `index`.
    /// `undefined` is the flag preserved from its creation (`AccessFlagsPersistent`). It's no
    /// longer an expression access, so the deferral rules for types apply.
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

    /// `getTypeFromIndexedAccessTypeNode`. Returns `None` if the type node `obj[index]` at `node`
    /// doesn't resolve to a type.
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

    /// Returns `None` if the expression `obj[index]` at `e` doesn't resolve to a type.
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

    /// Returns `None` if `obj` has nothing at `index` for the binding pattern element that `access_node` names.
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

    /// Returns `None` if `obj` has nothing at `index`, or at some member of `index` if it's a
    /// union.
    pub(super) fn indexed_access_if_any(&mut self, obj: TypeId, index: TypeId) -> Option<TypeId> {
        self.indexed_access_worker(obj, index, AccessFlags::empty(), AccessNode::None, None)
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
        // `getReducedType` removes an intersection that reduces to `never`.
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
                Some((alias, type_arguments)) => self.with_alias(deferred, alias, type_arguments),
                None => deferred,
            });
        }
        let apparent = self.reduced_apparent_type(obj);
        let holder = self.apparent_type_or_type_variable(obj, apparent);
        if let TypeData::Union(keys) = self.data(index)
            && !self.is_boolean(index)
        {
            let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(keys.len());
            let mut was_missing_prop = false;
            for &key in keys.iter() {
                match self.property_type_for_index(
                    (apparent, holder),
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
        self.property_type_for_index(
            (apparent, holder),
            (index, index),
            access_node,
            access_flags,
        )
    }

    /// The start of `getIndexedAccessTypeOrUndefined`. If the reduced `obj` has only a string index
    /// signature, that signature applies to any key, so the key becomes `string`.
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
        // FOR SPEED: a tuple has a `length`. A deferred tuple takes the slow path because
        // requesting its members resolves its elements.
        if self.is_tuple(ty) && self.types().deferred(ty).is_none() {
            return false;
        }
        self.members(ty).is_some_and(|m| {
            m.shape().props.is_empty()
                && matches!(
                    m.index_infos()[..],
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
                        bun_core::fmt::parse_f64(c.atoms().bytes(value)).unwrap_or(f64::NAN)
                    }
                    _ => return false,
                };
                at >= 0.0 && at < limit
            });
        }
        // An expression access uses a type parameter's constraint. Only a type access is deferred.
        !is_expression
            && self.has_type_variables(obj)
            && (self.is_generic_object_type(obj) || self.is_generic_reducible(obj))
    }

    /// `getTotalFixedElementCount`. Counts the elements before the first and after the last variable-length element.
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
    fn span_of_index_node(&self, access_node: AccessNode) -> Option<FileSpan> {
        match access_node {
            AccessNode::ElementAccess(file, e) => match self.hir(file)[e].kind {
                ExprKind::Index { index, .. } => Some(self.span_of_parenthesized_expr(file, index)),
                _ => None,
            },
            AccessNode::IndexedAccessType(file, node) => match self.hir(file)[node].kind {
                TypeNodeKind::IndexedAccess { index, .. } => {
                    let start = start_of_type(self.hir(file), index);
                    Some((file, start, self.end_of_type_node_from(file, index, start)))
                }
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
            AccessNode::Name(span) => Some(span),
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
                || matches!(self.bound(file).parent_of_expr(e), Parent::Expr(p)
                    if matches!(self.hir(file)[p].kind, ExprKind::Unary { op: UnOp::Delete, .. })))
        {
            self.error_at(self.span_of_expr(file, e), 2542, &[Arg::Type(object)]);
        }
    }

    /// `getPropertyTypeForIndexType`. `object` is a reduced apparent type, and `holder` is what
    /// `apparent_type_or_type_variable` returns for it. The index pair is `indexType`, which isn't a union, and
    /// `fullIndexType`.
    fn property_type_for_index(
        &mut self,
        (object, holder): (TypeId, TypeId),
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
            if let Some((prop, mapper)) = self.get_property_of_type(holder, name) {
                if !access_flags.contains(AccessFlags::WRITING) {
                    let prop_type = self.type_of_prop(prop, mapper);
                    return Some(match access_node {
                        AccessNode::ElementAccess(file, e) => {
                            self.flow_type_of_reference(file, e, prop_type)
                        }
                        AccessNode::IndexedAccessType(..)
                            if self.contains_missing_type(prop_type) =>
                        {
                            self.union(&[prop_type, TypeId::UNDEFINED])
                        }
                        _ => prop_type,
                    });
                }
                if let Some((file, e)) = access_expression
                    && let ExprKind::Index { obj, .. } = self.hir(file)[e].kind
                    && self.is_assignment_to_readonly_entity(file, e, obj, prop)
                    && let Some(index_node) = self.span_of_index_node(access_node)
                {
                    self.error_at(index_node, 2540, &[Arg::Prop(prop)]);
                    return None;
                }
                // `getWriteTypeOfSymbol`
                let ty = self.write_type_of_prop(prop, mapper);
                let takes_undefined = prop.flags.contains(PropFlags::OPTIONAL)
                    && !self.p.files.options.exact_optional_property_types;
                let prop_type = if takes_undefined {
                    self.optional(ty)
                } else {
                    ty
                };
                // `getAssignmentTargetKind(accessExpression) != AssignmentKindDefinite`
                return Some(match access_expression {
                    Some((file, e)) if access_flags.contains(AccessFlags::EXPRESSION_POSITION) => {
                        self.flow_type_of_reference(file, e, prop_type)
                    }
                    _ => prop_type,
                });
            }
            if self.is_numeric_name(name) && self.every_type(object, |c, t| c.is_tuple(t)) {
                let at = bun_core::fmt::parse_f64(self.atoms().bytes(name)).unwrap_or(f64::NAN);
                let ends = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Tuple { flags, .. } if Self::fixed_length(flags) == flags.len());
                if access_node != AccessNode::None
                    && !access_flags.contains(AccessFlags::ALLOW_MISSING)
                    && self.every_type(object, ends)
                {
                    let index_node = self.span_of_index_node(access_node);
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
                                let infos = members.index_infos();
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
            // "If no index signature is applicable, we default to the string index signature. In effect,
            // this means the string index signature applies even when accessing with a symbol-like type."
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
                        let at = self.span_of_expr(file, e);
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
                // An enum indexed by one of its own members always has an entry.
                let is_own_member = matches!(
                    (self.data(object), self.data(index)),
                    (TypeData::Anon { origin: Origin::EnumObject(owner), .. }, TypeData::EnumLit { member, .. })
                        if self.files().sym(member.file, self.files().symbol(*member).parent) == *owner
                );
                if info.key == TypeId::STRING
                    && !self.is_assignable(index, TypeId::STRING)
                    && !self.is_assignable(index, TypeId::NUMBER)
                    && let Some(index_node) = self.span_of_index_node(access_node)
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
                        let at = self.span_of_expr(file, e);
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
                    let at = self.span_of_expr(file, e);
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
        if let Some(index_node) = self.span_of_index_node(access_node) {
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

    /// `indexType.flags&TypeFlagsNullable == 0 && isTypeAssignableToKind(indexType,
    /// StringLike|NumberLike|ESSymbolLike)`. Each kind is tested separately.
    pub(super) fn is_key_like(&mut self, index: TypeId) -> bool {
        !self.is_nullish(index)
            && [TypeId::NUMBER, TypeId::STRING, TypeId::SYMBOL]
                .into_iter()
                .any(|kind| self.is_assignable(index, kind))
    }

    /// `getIndexTypeOfType`
    pub(super) fn index_type_of_type(&mut self, ty: TypeId, key_type: TypeId) -> Option<TypeId> {
        let members = self.members_for_index_infos(ty)?;
        let info = members
            .index_infos()
            .iter()
            .find(|info| info.key == key_type)?;
        Some(self.instantiate(info.value, members.mapper))
    }

    /// `getUnionIndexInfos`. Returns the first member's index signatures whose keys all the other
    /// members have too. A tuple has the index signature of an array of all its elements.
    pub(super) fn union_index_infos(&mut self, parts: &[TypeId]) -> SmallVec<[IndexInfo; 2]> {
        let mut all = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            let Some(members) = self.structured_members(apparent) else {
                return SmallVec::new();
            };
            all.push(members);
        }
        let mut infos = SmallVec::new();
        let Some(first) = all.first() else {
            return infos;
        };
        'infos: for info in first.index_infos() {
            let mut values = Vec::with_capacity(all.len());
            let mut readonly = false;
            for members in &all {
                let Some(same) = members.index_infos().iter().find(|i| i.key == info.key) else {
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

    /// `getInferTypeParameters` for the conditional type whose `extends` type node is `extends`. Collects the
    /// type parameters among its locals, each identified by the declaration that `getDeclaredTypeOfSymbol` uses.
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
        // `extends` has its own scope (`ScopeKind::Extends`), nested in the scope that has the locals.
        let scope = bound.scopes[own.idx()].parent;
        for &(_, symbol) in bound.table(bound.scopes[scope.idx()].locals) {
            out.extend(
                bound
                    .symbol(symbol)
                    .decls
                    .iter()
                    .find_map(|decl| match *decl {
                        crate::bind::Decl::TypeParam(declared) => Some(declared),
                        _ => None,
                    }),
            );
        }
        out.shared_sort_unstable();
    }

    /// `getConditionalTypeInstantiation` without an alias.
    pub fn conditional_type(&mut self, file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeId {
        self.conditional_type_instantiation(file, node, mapper, None)
    }

    /// `getConditionalTypeInstantiation`: the conditional type at `node`, with `mapper` for its
    /// outer type parameters. A type created with an alias isn't cached, because
    /// `getConditionalTypeKey` includes the alias and the key of `conditionals` doesn't.
    pub(super) fn conditional_type_instantiation(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        self.conditional_type_cached(file, node, mapper, alias, false)
    }

    /// `is_member` marks the `getConditionalType` call that `getConditionalTypeInstantiation` makes for each
    /// member of the union it distributes over. That call neither reads nor writes `root.instantiations`. FOR
    /// SPEED: it still shares the entries that it would only recompute, see `Program::conditionals`.
    fn conditional_type_cached(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        alias: Option<(Sym, &[TypeId])>,
        is_member: bool,
    ) -> TypeId {
        let q = Query::Cond(file, node, mapper);
        if alias.is_none()
            && let Some((known, is_repeatable)) =
                (self.p.conditionals).get(&self.task, &(file, node, mapper))
            && (is_repeatable || !is_member)
        {
            // The call in progress will overwrite the entry.
            if !is_repeatable && self.may_be_in_flight(q) && self.stack.contains(&q) {
                self.note_cycle();
            }
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
        let mark = self.non_cacheable_mark();
        let ty = self.conditional_type_uncached(file, node, mapper, false, alias);
        // A call that ends at `tailCount == 1000` reports that every time.
        let is_repeatable = self.non_cacheable_mark() == mark && !self.is_error_type(ty);
        match (self.leave(q), alias) {
            (Ok(stored), None) if is_member => {
                if is_repeatable {
                    (self.p.conditionals).insert(
                        &self.task,
                        (file, node, mapper),
                        (ty, true),
                        stored,
                    );
                }
                ty
            }
            // If the query was in progress several times, the outermost one stores last.
            (Ok(stored), None) => {
                let entry = (ty, is_repeatable);
                let is_inner = self.may_be_in_flight(q) && self.stack.contains(&q);
                let stored = match is_inner || !is_repeatable {
                    true => stored.held_back(),
                    false => stored,
                };
                (self.p.conditionals).rewrite(&self.task, (file, node, mapper), entry, stored);
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

    /// `for_constraint` means the check type is the type's constraint rather than the type itself,
    /// so the type may still pass a test that the constraint fails.
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
            // `getConditionalTypeInstantiation` removes an intersection that reduces to `never` before it distributes.
            let value = self.reduced(value);
            if value.is_never() || self.is_union(value) {
                let distributed_over = mapper;
                let map_member = |c: &mut Self, part: TypeId| {
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
                    // FOR SPEED: a cached `getConditionalType`. `part` isn't a union, and without a
                    // type variable nothing is deferred, so no type ends up with the merged mapper.
                    let has_type_variables = (c.types().mapper_flags(one))
                        .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES);
                    if !has_type_variables && c.types().map(one, check_declared) == Some(part) {
                        return c.conditional_type_cached(file, node, one, None, true);
                    }
                    let for_constraint = MapperId::IDENTITY;
                    c.resolve_conditional(file, node, one, distributed_over, for_constraint, None)
                };
                return self.map_type_with_alias(value, map_member, alias);
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

    /// Returns the element count of the tuple type node at `node`, if it has no optional or rest elements.
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

    /// `getConditionalType`. For `distributed_over` and `for_constraint`, see `TypeData::Cond`.
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
        // For each of their nodes, true if it's the body of a type alias.
        let mut has_alias: SmallVec<[((FileId, TypeNodeId), bool); 4]> = SmallVec::new();
        let result = loop {
            // `tailCount` skips roots that aren't the body of a type alias. In tsgo,
            // `instantiationCount` ends a loop of those.
            if tail_count == 1000 || tail_roots.len() == 10_000 {
                return self.too_many_tail_calls();
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
            // A cache hit skips the lookups below. A miss does them in tsgo's order and fills the cache afterwards.
            let root = self.conditional_roots.get(&(file, node)).cloned();
            let mark = self.non_cacheable_mark();
            let (check_declared, check_variable) = match &root {
                Some(root) => (root.check_declared, root.check_variable),
                None => {
                    let check_declared = self.type_from_node(file, check);
                    (check_declared, self.actual_type_variable(check_declared))
                }
            };
            let check_ty = self.instantiate(check_variable, mapper);
            let extends_declared = match &root {
                Some(root) => root.extends_declared,
                None => self.type_from_node(file, extends),
            };
            if check_ty == TypeId::UNRESOLVED {
                return TypeId::UNRESOLVED;
            }
            // `extendsType`, as opposed to `inferredExtendsType`.
            let extends_before_inference = self.instantiate(extends_declared, mapper);
            if check_ty == TypeId::ERROR || extends_before_inference == TypeId::ERROR {
                return TypeId::ERROR;
            }
            if check_ty == TypeId::WILDCARD || extends_before_inference == TypeId::WILDCARD {
                return TypeId::WILDCARD;
            }
            // `[A] extends [B]` is deferred on its elements like `A extends B` would be.
            let check_tuples = match &root {
                Some(root) => root.check_tuples,
                None => match (
                    self.simple_tuple_len(file, check),
                    self.simple_tuple_len(file, extends),
                ) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                },
            };
            let check_is_generic =
                self.is_generic(check_ty) || check_tuples && self.has_generic_element(check_ty);

            let params: SmallVec<[TypeId; 4]> = match root {
                Some(root) => root.infer_params,
                None => {
                    let mut infer_params = Vec::new();
                    self.collect_infer_params(file, extends, &mut infer_params);
                    let params: SmallVec<[TypeId; 4]> = infer_params
                        .iter()
                        .map(|&p| self.type_param(file, p))
                        .collect();
                    if self.non_cacheable_mark() == mark
                        && self.is_type_node_settled(file, check)
                        && self.is_type_node_settled(file, extends)
                    {
                        let root = ConditionalRoot {
                            check_declared,
                            check_variable,
                            extends_declared,
                            check_tuples,
                            infer_params: params.clone(),
                        };
                        self.conditional_roots.insert((file, node), root);
                    }
                    params
                }
            };
            let mut combined = mapper;
            if !params.is_empty() {
                if !check_is_generic {
                    // The `infer` positions are found in the `extends` type with everything else
                    // instantiated.
                    let target = self.instantiate(extends_declared, mapper);
                    let inferred = self.infer_from_types(&params, check_ty, target, mapper);
                    let mut pairs: SmallVec<[(TypeId, TypeId); 8]> =
                        SmallVec::from_slice(self.types().mapping(mapper));
                    // `combineTypeMappers(context.mapper, mapper)`: an inferred type is
                    // instantiated with `mapper`.
                    for (&param, inferred) in params.iter().zip(inferred) {
                        pairs.push((param, self.instantiate(inferred, mapper)));
                    }
                    combined = self.types().mapper_of(&pairs);
                } else if params
                    .iter()
                    .any(|param| (self.p.type_param_constraints.get(&self.task, param)).is_none())
                {
                    // `instantiateType(root.extendsType, context.mapper)` fixes the `infer` type
                    // parameters in the extends type. FOR SPEED: nothing reads the result, so this
                    // only resolves what `getInferredType` resolves, which can close a cycle.
                    let mentioned = self.params_mentioned_in(extends_declared, &params);
                    for (&param, _) in params.iter().zip(mentioned).filter(|it| it.1) {
                        self.constraint_of_type_param(param);
                    }
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
                let deferred = self.deferred_conditional_type(
                    file,
                    node,
                    mapper,
                    distributed_over,
                    for_constraint,
                    alias,
                );
                self.instantiate_narrowed_check_type(file, node, mapper);
                break deferred;
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
                    let deferred = self.deferred_conditional_type(
                        file,
                        node,
                        mapper,
                        distributed_over,
                        for_constraint,
                        alias,
                    );
                    self.instantiate_narrowed_check_type(file, node, mapper);
                    break deferred;
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
                    // `newRootMapper` isn't a merged mapper.
                    if is_tail_call {
                        (alias, distributed_over) = (None, MapperId::IDENTITY);
                    }
                    // A root other than the branch node itself is reached through a type reference.
                    // The other steps descend into the syntax.
                    if is_tail_call && (root.0, root.1) != (file, branch) {
                        // The loop is deterministic, so a root that recurs under the same mapper
                        // recurs until a limit is hit.
                        if !tail_roots.insert(root) {
                            return self.too_many_tail_calls();
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

    /// `result.checkType = c.instantiateType(root.checkType, mapper)` of a deferred conditional type. The
    /// pieces are instantiated lazily, when they're read. The exception is a check type narrowed by the true
    /// branch of an enclosing conditional type, or an indexed access of one. Instantiating that substitution
    /// type compares the base type with the constraint, and the timing of that comparison is observable.
    fn instantiate_narrowed_check_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) {
        if let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind {
            let declared = self.type_from_node(file, check);
            if self.actual_type_variable(declared) != declared {
                self.instantiate(declared, mapper);
            }
        }
    }

    /// `newConditionalType` with `alias`. Without one, the type has
    /// `instantiateTypeAlias(root.alias, mapper)`, which the node determines.
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

    /// Returns `Ok` with the conditional type that `getConditionalType`'s loop continues with instead of
    /// instantiating the branch at `branch` under `mapper`, plus a flag that's true if `getTailRecursionRoot`
    /// returns it. Returns `Err` with the branch's declared type if the branch has to be instantiated.
    /// `outer_check` is the declared check type of the conditional type that contains the branch.
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
        // A conditional type nested directly in the false branch is treated as part of the outer
        // one, unless it distributes over a different check type.
        if is_false_branch
            && (root_file, root) == (file, branch)
            && (!is_distributive || root_check == outer_check)
        {
            return Ok(((root_file, root, root_mapper), false));
        }
        // `getTailRecursionRoot`. A root without outer type parameters has the identity mapper, which
        // `map_mapper` returns unchanged. A mapper that changes no type argument yields `declared` again.
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
        // `conditionalConstraintDepth`. The second test fires before `enter` would reject a query for lack of stack.
        if self.conditional_constraint_depth >= 100 || self.is_most_of_stack_in_use() {
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
        // A remaining type variable isn't a constraint. A mapped type over one is an ordinary object type.
        let constraint = self.next_base_constraint(constraint)?;
        let is_deferred = tf::INSTANTIABLE_NON_PRIMITIVE | tf::INDEX;
        (!self.is_some_type_of_kind(constraint, is_deferred)).then_some(constraint)
    }

    // ───────────────────────────── mapped types ─────────────────────────────

    pub(super) fn mapped_decl(&self, file: FileId, node: TypeNodeId) -> &'p Mapped {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[node].kind else {
            unreachable!("not a mapped type node")
        };
        &hir[m]
    }

    /// `getNameTypeFromMappedType` for the mapped type as declared at `node`, which has an `as`
    /// clause. `m.nameType` is assigned when the first request returns, no matter what's in
    /// progress. A later request just reads it, so it doesn't push a resolution or close a cycle.
    pub(super) fn declared_name_type_of_mapped(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> TypeId {
        let name = self.mapped_decl(file, node).name_ty;
        if let Some(raw) = self.provisional_as_assigned(Query::TypeNode(file, name))
            && raw != u64::from(TypeId::UNRESOLVED.0)
            && (self.p.type_node_types.get(&self.task, &(file, name))).is_none()
        {
            return TypeId(raw as u32);
        }
        self.type_from_node(file, name)
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

    /// `getConstraintTypeFromMappedType`: the type that the mapped type's parameter ranges over. An
    /// `any` annotation there means every kind of key (`getConstraintFromTypeParameter`). A
    /// constraint that refers back to the parameter is an error.
    pub(super) fn mapped_constraint(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        // `getConstraintOfTypeParameter` is nil unless `hasNonCircularBaseConstraint`. When `pushTypeResolution`
        // fails, the cycle includes the first request and every resolution above it (the cycle start is inclusive).
        let key = (file, node, mapper);
        let mut in_progress = self.mapped_constraints_in_progress.iter();
        if let Some(start) = in_progress.position(|it| it.0 == key) {
            let height = self.mapped_constraints_in_progress[start].1;
            if self.mark_cycle_from(height) {
                for it in &mut self.mapped_constraints_in_progress[start..] {
                    it.2 = true;
                }
                self.note_cycle();
                self.task.closed_a_cycle = true;
            }
            (self.p.circular_mapped_constraints).insert(&self.task, key, (), Stored::new());
            self.links.note_circular_mapped_constraint();
            return TypeId::ERROR;
        }
        self.mapped_constraints_in_progress
            .push((key, self.stack.len(), false));
        let constraint = self.instantiated_constraint_of_mapped_param(file, node, mapper);
        // `!popTypeResolution()` in `getResolvedBaseConstraint`
        if (self.mapped_constraints_in_progress.pop()).is_some_and(|it| it.2) {
            (self.p.circular_mapped_constraints).insert(&self.task, key, (), Stored::new());
            self.links.note_circular_mapped_constraint();
            self.report_circular_mapped_key(file, node);
        }
        // Checked afterwards because the cycle may have been closed during this resolution.
        match (self.p.circular_mapped_constraints).get(&self.task, &key) {
            Some(()) => TypeId::ERROR,
            None => constraint,
        }
    }

    /// `instantiateType(getConstraintTypeFromMappedType(t), m)`, where `t` is the mapped type as
    /// declared. This doesn't mark the instantiation's key as being resolved.
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

    /// `getModifiersTypeFromMappedType`. Returns `T` as declared for `{ [P in keyof T]: X }`, and
    /// for `{ [P in K]: X }` where `K` is an alias of `keyof T` or is constrained by it. `T`'s
    /// properties determine what's optional and what's read-only. The flag is true if the
    /// constraint node is `keyof T` (`isMappedTypeWithKeyofConstraintDeclaration`).
    pub(super) fn mapped_modifiers_source(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<(TypeId, bool)> {
        let param = &self.hir(file)[self.mapped_decl(file, node).param];
        let constraint = param.constraint;
        // This goes by the syntax, because the type of `keyof` of a non-generic type is already a
        // plain union. A `ParenthesizedType` isn't a type operator.
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

    /// True if `mapped_modifiers_source` reads every type it requests from a table and those entries are final.
    pub(super) fn is_mapped_modifiers_source_settled(
        &self,
        file: FileId,
        node: TypeNodeId,
    ) -> bool {
        let param = &self.hir(file)[self.mapped_decl(file, node).param];
        let constraint = param.constraint;
        if let TypeNodeKind::Keyof(of) = self.hir(file)[constraint].kind
            && (self.parenthesized_types_around(file, constraint, param.pos))
                .next()
                .is_none()
        {
            return self.is_type_node_settled(file, of);
        }
        let declared = self.p.type_node_types.get(&self.task, &(file, constraint));
        self.is_type_node_settled(file, constraint)
            && declared.is_some_and(|declared| {
                !matches!(self.data(declared), TypeData::TypeParam(..))
                    || (self.p.type_param_constraints.get(&self.task, &declared)).is_some()
            })
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

    /// `getResolvedApparentTypeOfMappedType`: `{ [P in keyof T]: X }` is an array or tuple too if
    /// `T` can only be one. The flag is true if the modifiers type was requested.
    pub(super) fn derive_apparent_type_of_mapped(&mut self, ty: TypeId) -> (TypeId, bool) {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(ty)
        else {
            return (ty, false);
        };
        let Some(source) = self.homomorphic_type_variable(file, node, MapperId::IDENTITY) else {
            return (ty, false);
        };
        if self.mapped_decl(file, node).name_ty.is_some() {
            return (ty, false);
        }
        // `source` won't do here. In the true branch of `T extends X[] ? .. : ..`, the `T` of
        // `keyof T` is a substitution type whose base constraint is `X[]`.
        let Some((modifiers, _)) = self.mapped_modifiers_source(file, node) else {
            return (ty, true);
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
                (self.instantiate_mapped(file, node, applied), true)
            }
            _ => (ty, true),
        }
    }

    /// Returns the mapped type at `node` under `mapper`, the way `getObjectTypeInstantiation`
    /// creates it without an alias.
    pub fn instantiate_mapped(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        self.instantiate_mapped_type(file, node, mapper, NewAlias::OfNode)
    }

    /// `getObjectTypeInstantiation` of the mapped type at `node`, from the cache miss on its key up
    /// to `data.instantiations[key] = result`. The same key may be requested again in between.
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

    /// Returns how many `instantiate_mapped_type` calls with these arguments' key are in progress.
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
        // The target itself is stored under its type parameters' key from the start.
        if with_type_arguments.peek().is_none() || !self.is_instantiating(mapper) {
            return 0;
        }
        // `instantiateTypeAlias(t.alias, m)` is the same key whether or not it's passed in.
        let node_alias = self.alias_of_node_under(file, node, mapper);
        let node_alias =
            (node_alias.as_ref()).map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
        let new_alias = match alias {
            NewAlias::Given(alias, type_arguments) => Some((alias, type_arguments)),
            NewAlias::OfNode => node_alias,
        };
        let innermost = with_type_arguments.find(|it| match &it.alias {
            Some((alias, type_arguments)) => Some((*alias, &type_arguments[..])) == new_alias,
            None => node_alias == new_alias,
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
        let node_alias = self.alias_of_node_under(file, node, mapper);
        if node_alias.is_some_and(|it| it.0 == alias && it.1 == type_arguments) {
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
            // `instantiateMappedType` instantiates the constraint type eagerly (its wildcard test), so a cycle through
            // the keys starts here. `getTypeFromMappedTypeNode` has already resolved the declared type's constraint.
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
                        is_array_pattern: false,
                        has_other_instantiation: false,
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
        let node_alias = match alias {
            NewAlias::OfNode if self.is_union(value) => {
                self.alias_of_node_under(file, node, mapper)
            }
            _ => None,
        };
        let alias = match alias {
            NewAlias::Given(alias, type_arguments) => Some((alias, type_arguments)),
            NewAlias::OfNode => {
                (node_alias.as_ref()).map(|(alias, type_arguments)| (*alias, &type_arguments[..]))
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
                is_array_pattern: false,
                has_other_instantiation: false,
            },
        )
    }

    /// `core.Some(typeArguments, c.couldContainTypeVariables)` in `getObjectTypeInstantiation`
    fn could_type_arguments_contain_type_variables(&self, new_mapper: MapperId) -> bool {
        let mut type_arguments = self.types().mapping(new_mapper).iter();
        type_arguments.any(|pair| self.could_contain_type_variables(pair.1))
    }

    /// `hasArrayOrTypeTypeConstraint`, which `instantiateMappedType` calls unless
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

    /// `instantiateConstituent`: the mapped type over the keys of `source`, with `t` (not a union)
    /// substituted for `source`. `given` is `InstantiationKey::alias`.
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
            // It sets its result's flag from the type arguments. For a union member,
            // `couldContainTypeVariables` computes the flag instead, and it's true for every mapped type.
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
                    is_array_pattern: false,
                    has_other_instantiation: false,
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
            // `instantiateMappedTupleType`. Elements before the first rest or variadic element are
            // looked up by index. After that the indexes are unknown, so a variadic element is
            // mapped as a whole and any other element as the element of its own array.
            let fixed = Self::fixed_length(flags);
            let mut new_elems = Vec::with_capacity(elems.len());
            let mut new_flags = Vec::with_capacity(elems.len());
            for (i, &f) in flags.iter().enumerate() {
                let elem = if i < fixed {
                    let name = self.number_name(i as f64);
                    let key = self.string_literal(name, false);
                    template(self, one, key, f.contains(ElemFlags::OPTIONAL))
                } else if f.contains(ElemFlags::VARIADIC) {
                    let element_mapper = self.prepend_type_mapping(source, elems[i], mapper);
                    // If the tuple that `m` maps `T` to contains `...T`, the element is that tuple
                    // again, and the same instantiation restarts until `instantiationDepth == 100`.
                    if element_mapper == mapper {
                        return self.excessively_deep();
                    }
                    let declared = self.type_from_node(file, node);
                    self.instantiate(declared, element_mapper)
                } else {
                    let list = self.array_of(elems[i]);
                    let list_mapper = self.prepend_type_mapping(source, list, mapper);
                    // `getElementTypeOfArrayType` of `instantiateMappedArrayType`'s result. The
                    // error type isn't an array.
                    match template(self, list_mapper, TypeId::NUMBER, true) {
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
        // `isArrayOrTupleOrIntersection`: mapped member by member.
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

    /// `getLowerBoundOfKeyType`. For keys that are still generic, returns the keys that exist in every instantiation.
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
            // `Exclude<keyof T, "a">` is evaluated over the lower bound of `keyof T`.
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
            // `mapTypeEx(.., noReductions)`: `string` from `keyof S` doesn't absorb the names next to it.
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
                // The intersection is rebuilt even if no member changes. `` `a${string}` & {} ``,
                // which a type node keeps as written, becomes `` `a${string}` ``.
                let bounds: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.lower_bound_of_key_type(p))
                    .collect();
                self.intersection(&bounds)
            }
            _ => ty,
        }
    }

    /// For `{ [P in K]: E }[X]` where `K` is known and `X` is generic, returns `E` with `X` substituted
    /// for `P`. That preserves the per-key correlation in `E` that the union over all keys would lose.
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
        // `couldAccessOptionalProperty`: the access may hit one of the optional properties.
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

    /// Returns an object type with the properties available on a value of the union `ty` without knowing which
    /// member it is (`getPropertiesOfUnionOrIntersectionType`), plus the index signatures common to all members.
    pub fn union_as_object(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.union_objects.get(&self.task, &ty) {
            return known;
        }
        let scope = self.begin_scope();
        let parts = self.parts(ty);
        let mut shape = Shape::new_in(self.arena);
        let mut checked = crate::util::FxHashSet::default();
        let was_listing = self.union_members.set_listing(true);
        for &part in parts {
            // `getPropertiesOfType`. The apparent type of an intersection with a conditional type
            // is a union if the conditional type's constraint is one.
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
            // A property common to all members is declared by name in the first member that has no index signature.
            if self.structured(members).index_infos().is_empty() {
                break;
            }
        }
        self.union_members.set_listing(was_listing);
        // `getIndexInfosOfType` returns what `resolveUnionTypeMembers` set, once it has run. This object
        // is also built when only the properties are needed, which doesn't resolve the union's members.
        let index = match self.resolved_union_type_members(ty) {
            Some(resolved) => SmallVec::from_slice(resolved.index_infos()),
            None => self.union_index_infos(parts),
        };
        shape.index.extend(index);
        let object = self.synth(shape);
        match self.end_scope_by_counters(scope) {
            Ok(stored) => (self.p.union_objects).insert(&self.task, ty, object, stored),
            Err(_) => object,
        }
    }

    /// Returns the key types that `resolveMappedTypeMembers` and `getIndexTypeForMappedType`
    /// iterate over, for the mapped type at `node` under `mapper`, whose constraint is
    /// `constraint`. Also returns the `T` of `keyof T` (`getModifiersTypeFromMappedType`).
    fn mapped_key_types(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        constraint: TypeId,
    ) -> (List<'p, TypeId>, Option<Modifiers<'p>>) {
        let source = self.mapped_modifiers_source(file, node);
        let over_keyof = matches!(source, Some((_, true)));
        // `getReducedApparentType` replaces a type parameter with its constraint and removes an
        // intersection that reduces to `never`.
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
        let modifiers = match modifiers_ty {
            Some(ty) if self.is_union(ty) && !over_keyof => Some(Modifiers::Union(ty)),
            Some(ty) => {
                let owner = match self.is_union(ty) {
                    true => self.union_as_object(ty),
                    false => ty,
                };
                (self.members(owner)).map(|members| Modifiers::Object(owner, members))
            }
            None => None,
        };
        let keys = match modifiers {
            // `forEachMappedTypePropertyKeyTypeAndIndexSignatureKeyType`. Over `keyof T`, it visits `T`'s properties
            // and index signatures one by one, because in the union `keyof T`, `string` has absorbed the names.
            Some(Modifiers::Object(owner, m)) if over_keyof => {
                let renames = self.mapped_decl(file, node).name_ty.is_some();
                let mut keys = Vec::with_capacity(
                    m.shape().props.len() + self.structured(m).index_infos().len(),
                );
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
                keys.extend(self.structured(m).index_infos().iter().map(|i| i.key));
                List::Own(keys)
            }
            // A type that can be anything is iterated as if every string were a property name.
            _ if over_keyof && modifiers_ty.is_some_and(|ty| self.has_any_flag(ty)) => {
                List::One(TypeId::STRING)
            }
            // Only `T` is inspected. `never`, `unknown` and the like have nothing to iterate over,
            // no matter what `keyof` yields for them.
            _ if over_keyof => List::Permanent(&[]),
            // For any other constraint, `lower_bound_of_key_type` returns the type itself.
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

    /// Returns what `forEachType` visits: a union's members, or the type itself for anything else, including `never`.
    fn each_type(&self, ty: TypeId) -> List<'p, TypeId> {
        match self.is_union(ty) {
            true => List::Permanent(self.parts(ty)),
            false => List::One(ty),
        }
    }

    /// `getTypeOfMappedSymbol`: the type of a property of a mapped type, where `ty` is the instantiated template
    /// for it. `strips` means `-?` turns an optional property into a required one (`CheckFlagsStripOptional`).
    fn mapped_property_type(
        &mut self,
        ty: TypeId,
        modifier: MappedModifier,
        optional: bool,
        strips: bool,
    ) -> TypeId {
        if modifier == MappedModifier::Add {
            // `getTemplateTypeFromMappedType` adds the optionality to the declared template type,
            // no matter what it instantiates to.
            self.optional_property(ty)
        } else if optional {
            if self.maybe_type_of_kind(ty, tf::UNDEFINED | tf::VOID) {
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

    /// `links.containingType` of the symbol that `prop` represents. `build_mapped_shape` created `prop` for the
    /// mapped type `of`, so `prop.mapper` is `of`'s mapper plus the key type for the type parameter. In a copy
    /// of the property, that mapper is composed with another one. `resolveObjectTypeMembers` instantiates the
    /// base type, and a mapped type instantiated with different type arguments has its own symbols.
    pub(super) fn containing_type_of_mapped_prop(&self, of: TypeId, prop: &Prop) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(of) else {
            return of;
        };
        // The key is stored separately.
        if prop.mapper == mapper {
            return of;
        }
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

    /// `links.syntheticOrigin` of the symbol that `prop` represents: `modifiersProp` of
    /// `addMemberForKeyTypeWorker`. `build_mapped_shape` created `prop` for the mapped type `of`.
    pub(super) fn synthetic_origin(&mut self, of: TypeId, prop: &Prop) -> Option<&'p Prop<'p>> {
        let of = self.containing_type_of_mapped_prop(of, prop);
        let (file, node, mapper) = self.mapped_origin(of)?;
        let param = self.type_param(file, self.mapped_decl(file, node).param);
        let key_type = match self.types().separate_key(prop) {
            Some(key_type) => key_type,
            None => self.types().map(prop.mapper, param)?,
        };
        // `keyType` is the union of the keys that map to the name. The first of them created the symbol.
        let key = if self.is_union(key_type) {
            let constraint = self.mapped_constraint(file, node, mapper);
            let (keys, _) = self.mapped_key_types(file, node, mapper, constraint);
            let keys_with_same_name = self.parts(key_type);
            keys.iter()
                .copied()
                .find(|key| keys_with_same_name.contains(key))?
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
        // FOR SPEED: nearly every call is for a stored type, and finding its entry is slower than reading it.
        let key = (of, prop.mapper, prop.name);
        if let Some(&known) = self.known_mapped_prop_types.get(&key) {
            return known;
        }
        let known = (self.p.mapped_prop_types).get(&self.task, &(of, prop.name));
        // `TypeFlagsAny`: no type variables, so it's the same under every mapper.
        if let Some(known) = known
            && self.has_any_flag(known)
        {
            self.known_mapped_prop_types.insert(key, known);
            return known;
        }
        let Some((file, node, _)) = self.mapped_origin(of) else {
            return TypeId::UNRESOLVED;
        };
        let created_for = of;
        let of = self.containing_type_of_mapped_prop(created_for, prop);
        // The `created_for` entry is read first and wins if its type is `any`. While that entry is missing, a later
        // call may find one, so the result isn't cached here.
        let always_reads_this_entry = of == created_for || known.is_some();
        let known = if of == created_for {
            known
        } else {
            (self.p.mapped_prop_types).get(&self.task, &(of, prop.name))
        };
        if let Some(known) = known {
            if always_reads_this_entry {
                self.known_mapped_prop_types.insert(key, known);
            }
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
            // `resolveMappedTypeMembers` resolves the constraint type of `of` and the members of a
            // reverse mapped modifiers type before the symbol exists. See `circular_mapped_property`.
            if let Some(at) = self.stack.iter().rposition(|in_progress| *in_progress == q) {
                let own = self.mapped_origin(of);
                let mut constraints = self.mapped_constraints_in_progress.iter();
                let is_through_members = constraints.any(|it| it.1 > at && Some(it.0) == own)
                    || self.stack[at + 1..].iter().any(|&between| {
                        matches!(between, Query::Shape(t) | Query::Properties(t)
                            if matches!(self.data(t), TypeData::ReverseMapped { .. }))
                    });
                if is_through_members {
                    self.mapped_props_reentered_through_members.push(at);
                }
            }
            return TypeId::ERROR;
        }
        let mapped = self.mapped_decl(file, node);
        let template = if mapped.ty.is_some() {
            self.type_from_node(file, mapped.ty)
        } else {
            TypeId::ERROR
        };
        let with_key = self.mapper_of_prop(prop);
        let ty = self.instantiate(template, with_key);
        let ty = self.mapped_property_type(
            ty,
            mapped.optional,
            prop.flags.contains(PropFlags::OPTIONAL),
            strips,
        );
        let left = self.leave(q);
        let at = self.stack.len();
        let reentered_through_members = self.mapped_props_reentered_through_members.contains(&at);
        (self.mapped_props_reentered_through_members).retain(|&below| below < at);
        if self.left_a_cycle {
            // Behind a barrier that isn't the value assigned in a loop, tsgo resolves the property
            // later or never, with another `currentNode`.
            if self.is_behind_barrier(0) {
                self.mark_tainted_from(0);
                return TypeId::ERROR;
            }
            let stored = self.cycle_result();
            let cached_entry = (self.p.mapped_prop_types).insert(
                &self.task,
                (of, prop.name),
                TypeId::ERROR,
                stored,
            );
            // Reported after `links.resolvedType = c.errorType`, because the message prints `of`,
            // which has this property.
            self.circular_mapped_property(of, prop.name, reentered_through_members);
            return cached_entry;
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
            Some(self.declared_name_type_of_mapped(file, node))
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
        // See `Types::separate_key`. An `as` clause is instantiated for every key, using the mapper that includes the
        // key.
        let stores_keys_separately =
            name_declared.is_none() && self.types().map(mapper, param).is_none();
        // Maps each name to its index in `shape.props`. Only filled once there are 16 properties.
        let mut prop_indexes: FxHashMap<Atom, usize> = FxHashMap::default();
        for key in keys {
            let created =
                (!stores_keys_separately).then(|| self.mapper_with_pair(mapper, param, key));
            let with_key =
                |c: &Self| created.unwrap_or_else(|| c.mapper_with_pair(mapper, param, key));
            let names = match name_declared {
                Some(declared) => {
                    let with_key = with_key(self);
                    self.instantiate(declared, with_key)
                }
                None => key,
            };
            let key_name = self.property_name_of_type(key);
            // `modifiersProp`: `getPropertyOfType(modifiersType, ..)`
            let source_prop = match (&modifiers, key_name) {
                (Some(Modifiers::Object(modifiers_type, m)), Some(name)) => self
                    .property_in_type(*modifiers_type, m, name)
                    .map(|(prop, _)| prop),
                (Some(Modifiers::Union(union)), Some(name)) => self
                    .get_property_of_type(*union, name)
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
                let existing_index = match name {
                    Some(name) if shape.props.len() < 16 => {
                        shape.props.iter().position(|p| p.name == name)
                    }
                    Some(name) => {
                        if prop_indexes.is_empty() {
                            prop_indexes
                                .extend(shape.props.iter().enumerate().map(|(i, p)| (p.name, i)));
                        }
                        prop_indexes.get(&name).copied()
                    }
                    None => None,
                };
                match name {
                    Some(name) => match existing_index {
                        // One property for all the keys that map to its name. Its `keyType` is
                        // their union. The first key determines the modifiers.
                        Some(i) => {
                            let types = self.types();
                            let so_far = (types.separate_key(&shape.props[i]))
                                .or_else(|| types.map(shape.props[i].mapper, param))
                                .unwrap_or(key);
                            let all = self.union(&[so_far, key]);
                            if all != so_far {
                                shape.props[i].mapper = self.mapper_with_pair(mapper, param, all);
                                shape.props[i].name_type = TypeId::UNRESOLVED;
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
                            // `nameType`: a name created from a string type is a string name, even if it looks numeric.
                            if self.is_string_like(name_ty) && self.is_numeric_name(name) {
                                flags |= PropFlags::STRING_NAME;
                            }
                            if !prop_indexes.is_empty() {
                                prop_indexes.insert(name, shape.props.len());
                            }
                            // `prop.Declarations = modifiersProp.Declarations`
                            let declared = match source_prop {
                                Some(modifiers_prop) if links_declarations => {
                                    Self::declared_properties(&[modifiers_prop], self.arena)
                                }
                                _ => SmallVec::new(),
                            };
                            let declared = (!declared.is_empty()).then(|| self.list_of(declared));
                            let is_separate_key = stores_keys_separately
                                && name_ty == key
                                && key != TypeId::UNRESOLVED;
                            let (own_mapper, name_type) = match is_separate_key {
                                true => (mapper, key),
                                false => (with_key(self), TypeId::UNRESOLVED),
                            };
                            // The type, which is the template under `with_key`, is resolved on
                            // demand (`type_of_mapped_prop`).
                            let prop = Prop {
                                name,
                                flags,
                                source: PropSource::Mapped(of, strips, declared),
                                mapper: own_mapper,
                                name_type,
                            };
                            shape.props.push(prop);
                        }
                    },
                    None => {
                        // `isValidIndexKeyType`, `any` and enums. A name of type `any` can be any
                        // string, and a name of an enum type can be any number. Anything else, like
                        // a type parameter or a template containing one, adds nothing.
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
                            // `string & {}` is a distinct key type that no number matches.
                            name_ty
                        } else {
                            continue;
                        };
                        let with_key = with_key(self);
                        let ty = self.instantiate(template_declared, with_key);
                        let ty = if mapped.optional == MappedModifier::Add {
                            self.optional_property(ty)
                        } else {
                            ty
                        };
                        // `getApplicableIndexInfo(modifiersType, propNameType)` runs before the `templateModifiers`
                        // test, so it resolves a union's members even under `readonly` and `-readonly`.
                        let is_source_index_readonly =
                            modifiers.as_ref().is_some_and(|modifiers| {
                                let members = match *modifiers {
                                    Modifiers::Object(_, members) => Some(members),
                                    // `resolveUnionTypeMembers` doesn't create properties.
                                    Modifiers::Union(union) => self.members_for_index_infos(union),
                                };
                                members.is_some_and(|m| {
                                    let m = self.structured(m);
                                    self.applicable_index_info(&m, name_ty)
                                        .is_some_and(|info| info.readonly)
                                })
                            });
                        let readonly = match mapped.readonly {
                            MappedModifier::Add => true,
                            MappedModifier::None => is_source_index_readonly,
                            MappedModifier::Remove => false,
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
        // `mapType` returns a type with `TypeFlagsNever` unchanged. After a union there's one
        // result per member, and their union is `never`.
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
                        // With anything else in it, like a symbol or an object, the result is just `string`.
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
        // A lone surrogate (three bytes that aren't valid UTF-8) has no case.
        for (i, chunk) in self.atoms().bytes(value).utf8_chunks().enumerate() {
            let text = chunk.valid();
            let mut chars = text.chars();
            let mut push =
                |c: char| mapped.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            // The tail of `text` that's copied unchanged.
            let rest = match (kind, chars.next()) {
                (StringMappingKind::Uppercase, _) => {
                    text.chars()
                        .flat_map(to_uppercase_unicode_15)
                        .for_each(&mut push);
                    ""
                }
                // Lowercased a word at a time rather than a character at a time, because a sigma at
                // the end of a word has its own form. An unassigned character ends a word.
                (StringMappingKind::Lowercase, _) => {
                    let mut word = 0;
                    for (at, unmapped) in text.char_indices() {
                        if is_cased_since_unicode_16(unmapped) {
                            let lower = text[word..at].to_lowercase();
                            lower.chars().chain([unmapped]).for_each(&mut push);
                            word = at + unmapped.len_utf8();
                        }
                    }
                    text[word..].to_lowercase().chars().for_each(&mut push);
                    ""
                }
                (StringMappingKind::Capitalize, Some(first)) if i == 0 => {
                    to_uppercase_unicode_15(first).for_each(&mut push);
                    chars.as_str()
                }
                (StringMappingKind::Uncapitalize, Some(first)) if i == 0 => {
                    to_lowercase_unicode_15(first).for_each(&mut push);
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
            // `TypeFlagsStringLiteral`, which a string enum member has too. The result is a plain string literal.
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let mapped = self.map_text(kind, *value);
                self.string_literal(mapped, false)
            }
            // `applyTemplateStringMapping`: a mapping of all letters applies to every part, and a
            // mapping of the first letter only to the first part.
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

/// `getModifiersTypeFromMappedType`, as `Checker::mapped_key_types` returns it.
#[derive(Clone, Copy)]
enum Modifiers<'p> {
    /// As an object, with its members.
    Object(TypeId, Members<'p>),
    /// A union whose properties aren't what the mapped type iterates over, as in `Pick<A | B, "id">`.
    /// Creating a union property resolves the types of the properties it combines, so only the properties
    /// requested by name may be created. Example: `interface B { id: string; shape?: keyof typeof shapes }`,
    /// with a `Pick<A | B, "id">` in the initializer of `shapes`.
    Union(TypeId),
}
