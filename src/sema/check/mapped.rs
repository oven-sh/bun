//! Types computed from other types: `keyof`, `T[K]`, conditional, mapped and template literal types.

use super::relate::Relation;
use super::*;
use smallvec::SmallVec;

impl<'p> Checker<'p> {
    /// The pairs of `mapper`, and after them `ty` for `param`.
    fn mapper_with_pair(&self, mapper: MapperId, param: TypeId, ty: TypeId) -> MapperId {
        let mapping = self.p.types.mapping(mapper);
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::with_capacity(mapping.len() + 1);
        pairs.extend_from_slice(mapping);
        pairs.push((param, ty));
        self.p.types.mapper_of(&pairs)
    }

    /// Whether what `ty` is depends on type parameters in a way that puts off `keyof`, `T[K]` and `extends`.
    pub fn is_generic(&mut self, ty: TypeId) -> bool {
        if !self.has_type_variables(ty) {
            return false;
        }
        self.guard("is_generic");
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.is_generic(p))
            }
            TypeData::Tuple { flags, .. } => flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)),
            // `isGenericMappedType`
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => {
                let (file, node, mapper) = (*file, *node, *mapper);
                let constraint = self.mapped_constraint(file, node, mapper);
                if self.is_generic(constraint) {
                    return true;
                }
                // So is one whose `as` clause mentions something generic other than the key: the name is generic even with the
                // keys, which are known, put for the key.
                let mapped = self.mapped_decl(file, node);
                if mapped.name_ty.is_none() {
                    return false;
                }
                let declared = self.type_from_node(file, mapped.name_ty);
                let param = self.type_param(file, mapped.param);
                let with_keys = self.mapper_with_pair(mapper, param, constraint);
                let name = self.instantiate(declared, with_keys);
                self.is_generic(name)
            }
            TypeData::Template { .. } | TypeData::StringMapping { .. } => true,
            TypeData::LazyAlias { .. } => false,
            // `getGenericObjectFlags`: a substitution type is as generic as what it stands for.
            TypeData::NoInfer(of) => self.is_generic(*of),
            _ => self.is_deferred(ty),
        }
    }

    // ───────────────────────────── keyof ─────────────────────────────

    /// `getIndexType`
    pub fn keyof(&mut self, ty: TypeId) -> TypeId {
        self.keyof_ex(ty, false)
    }

    /// `getIndexType`, where `keyof` is written or a `keyof T` that waited is instantiated. `getLiteralTypeFromProperties` gives the
    /// union of the keys of a class, an interface or what has an alias the origin `keyof T`, which it is written as. Unions are
    /// hash-consed, so that is noted on the side, and not of a union that may as well come from elsewhere.
    pub(super) fn keyof_with_origin(&mut self, ty: TypeId) -> TypeId {
        let keys = self.keyof(ty);
        if !self.is_union(keys)
            || self.keyof_origins.contains_key(&keys)
            || !self.every_type(keys, |c, key| c.is_unit(key))
        {
            return keys;
        }
        let of = self.force(ty);
        let of = self.reduced(of);
        let has_origin = match self.data(of) {
            TypeData::Ref { .. } => true,
            TypeData::Anon {
                origin: Origin::TypeLiteral(..),
                ..
            } => self.alias_for_display(of).is_some(),
            _ => false,
        };
        if has_origin {
            self.keyof_origins.insert(keys, of);
        }
        keys
    }

    /// `getIndexTypeEx`. `no_reducible_check` is `IndexFlagsNoReducibleCheck`.
    pub(super) fn keyof_ex(&mut self, ty: TypeId, no_reducible_check: bool) -> TypeId {
        self.guard("keyof");
        // The keys of `NoInfer<T>` are those of `T`, and nothing is inferred to them either.
        if let TypeData::NoInfer(of) = *self.data(ty) {
            let keys = self.keyof_ex(of, no_reducible_check);
            return self.no_infer(keys);
        }
        let ty = self.force(ty);
        if ty == TypeId::UNRESOLVED {
            return ty;
        }
        // `getReducedType`: an intersection nothing can be is not there.
        let ty = self.reduced(ty);
        if ty == TypeId::ANY || ty == TypeId::NEVER {
            return self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
        }
        if ty == TypeId::UNKNOWN {
            return TypeId::NEVER;
        }
        match self.data(ty) {
            TypeData::Union(parts) => {
                // `shouldDeferIndexType`: instantiation may reduce a member of the union to `never`.
                if !no_reducible_check && self.is_generic_reducible(ty) {
                    return self.intern(TypeData::Keyof(ty));
                }
                let keys: SmallVec<[TypeId; 8]> = parts
                    .iter()
                    .map(|&p| self.keyof_ex(p, no_reducible_check))
                    .collect();
                return self.intersection(&keys);
            }
            TypeData::Intersection(parts) => {
                // `shouldDeferIndexType`: `T & {}` keeps its keys to itself until `T` is known.
                if parts
                    .iter()
                    .any(|&p| self.some_type(p, |c, m| c.is_instantiable(m)))
                    && parts
                        .iter()
                        .any(|&p| self.is_empty_anonymous_object_type(p))
                {
                    return self.intern(TypeData::Keyof(ty));
                }
                let keys: SmallVec<[TypeId; 8]> = parts
                    .iter()
                    .map(|&p| self.keyof_ex(p, no_reducible_check))
                    .collect();
                return self.union(&keys);
            }
            _ => {}
        }
        let mapped = self.mapped_origin(ty);
        // `getIndexTypeForMappedType`: the keys of a mapped type that does not rename them are what it maps over, known or not,
        // whatever came of it.
        if let Some((file, node, mapper)) = mapped
            && self.mapped_decl(file, node).name_ty.is_none()
        {
            let constraint = self.mapped_constraint(file, node, mapper);
            let constraint = self.force(constraint);
            if self.is_known(constraint) {
                return constraint;
            }
        }
        // `shouldDeferIndexType`. `keyof T`, a template and the like are strings, numbers or symbols whatever `T` is
        // (`TypeFlagsInstantiablePrimitive`), and have the keys of those.
        let is_key_or_string = matches!(
            self.data(ty),
            TypeData::Keyof(_) | TypeData::Template { .. } | TypeData::StringMapping { .. }
        );
        if !is_key_or_string && self.is_generic(ty) {
            return self.intern(TypeData::Keyof(ty));
        }
        // `getIndexTypeForMappedType`: the keys of one that renames them are what it makes of each.
        if let Some((file, node, mapper)) = mapped
            && self.mapped_decl(file, node).name_ty.is_some()
        {
            let constraint = self.mapped_constraint(file, node, mapper);
            let constraint = self.force(constraint);
            if self.is_known(constraint) {
                let decl = self.mapped_decl(file, node);
                let param = self.type_param(file, decl.param);
                let name_declared = self.type_from_node(file, decl.name_ty);
                let (keys, _) = self.mapped_key_types(file, node, mapper, constraint);
                let mut names = Vec::with_capacity(keys.len());
                for key in keys {
                    let with_key = self.mapper_with_pair(mapper, param, key);
                    let name = self.instantiate(name_declared, with_key);
                    names.push(name);
                    // What is under any string is under any number.
                    if name == TypeId::STRING {
                        names.push(TypeId::NUMBER);
                    }
                }
                return self.union(&names);
            }
        }
        // `getLiteralTypeFromProperties`. `keyof T` can be a string, a number or a symbol: it has what all of them have.
        let apparent = self.apparent_type(ty);
        let apparent = if self.is_union(apparent) {
            self.union_as_object(apparent)
        } else {
            apparent
        };
        let Some(members) = self.members(apparent) else {
            return TypeId::NEVER;
        };
        let mut keys: SmallVec<[TypeId; 16]> = SmallVec::with_capacity(members.shape().props.len());
        for prop in &members.shape().props {
            if prop
                .flags
                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
            {
                continue;
            }
            if let Some(key) = self.key_type_of_prop(apparent, prop) {
                keys.push(key);
            }
        }
        // It leaves out `enumNumberIndexInfo`, the way back from a number to the name of a member.
        if !matches!(
            self.data(apparent),
            TypeData::Anon {
                origin: Origin::EnumObject(_),
                ..
            }
        ) {
            for info in &members.shape().index {
                keys.push(info.key);
                if info.key == TypeId::STRING {
                    keys.push(TypeId::NUMBER);
                }
            }
        }
        self.union(&keys)
    }

    /// The literal type that names the property `name`, as far as the name alone tells. `None` for private names.
    pub(super) fn key_type_of_name(&mut self, name: Atom) -> Option<TypeId> {
        let text = self.files().atoms.bytes(name);
        if text.starts_with(b"#") {
            return None;
        }
        if let Some(rest) = text.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            // `name@file.id` for a unique symbol, `name` for `Symbol.name`.
            let mut parts = rest.splitn(2, |&c| c == b'@');
            let symbol = self.files().atoms.intern(parts.next().unwrap());
            let number = |b: &[u8]| {
                std::str::from_utf8(b)
                    .ok()
                    .and_then(|s| s.parse::<u32>().ok())
            };
            let (file, id) = match parts
                .next()
                .map(|w| w.splitn(2, |&c| c == b'.').collect::<Vec<_>>())
            {
                Some(w) if w.len() == 2 => (FileId(number(w[0])?), number(w[1])?),
                _ => (FileId(u32::MAX), 0),
            };
            return Some(self.intern(TypeData::UniqueSymbol {
                file,
                id,
                name: symbol,
            }));
        }
        // `NaN`, `Infinity` and `-Infinity` read as numbers but are only ever written as identifiers or strings.
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        if digits.first().is_some_and(|c| c.is_ascii_digit()) && self.is_numeric_name(name) {
            let n: f64 = std::str::from_utf8(text).unwrap().parse().unwrap();
            return Some(self.number_literal(n, false));
        }
        Some(self.string_literal(name, false))
    }

    /// `getLiteralTypeFromProperty`: the literal type that names `prop`, a property of `owner`. `None` for private names. It goes
    /// by what the name was made from (`nameType`), then by how it is written where the property is declared: what reads as a
    /// number is the number only if it is written as one. What is declared nowhere, like the elements of a tuple, is named by
    /// a string.
    pub(super) fn key_type_of_prop(&mut self, owner: TypeId, prop: &Prop) -> Option<TypeId> {
        if prop.flags.contains(PropFlags::STRING_NAME) {
            return Some(self.string_literal(prop.name, false));
        }
        let text = self.files().atoms.bytes(prop.name);
        let (file, key, is_string) = match &prop.source {
            PropSource::Members(members) => {
                let (file, member) = members[0];
                let member = &self.hir(file)[member];
                (file, member.key, member.flags.contains(Flags::STRING_NAME))
            }
            PropSource::Literal(file, written) => {
                let written = &self.hir(*file)[*written];
                (
                    *file,
                    written.key,
                    self.is_name_written_as_string(*file, written.pos),
                )
            }
            PropSource::Type(_)
                if self.is_tuple(owner) && text.first().is_some_and(|c| c.is_ascii_digit()) =>
            {
                return Some(self.string_literal(prop.name, false));
            }
            PropSource::Intersected(_, parts) => return self.key_type_of_props(owner, parts),
            _ => return self.key_type_of_name(prop.name),
        };
        match key {
            // `getLiteralTypeFromPropertyName`: the type of the expression. Which symbol it is the name tells as well.
            PropKey::Computed(e) if !text.starts_with(crate::atom::SYMBOL_NAME_PREFIX) => {
                let ty = self.type_of_expr(file, e);
                let ty = self.regular(ty);
                if self.property_name_of_type(ty) == Some(prop.name) {
                    return Some(ty);
                }
            }
            // A numeric literal has no sign.
            PropKey::Name(_) if is_string || text.first() == Some(&b'-') => {
                return Some(self.string_literal(prop.name, false));
            }
            _ => {}
        }
        self.key_type_of_name(prop.name)
    }

    /// The same of the property that stands for `props`, those of one name that the members of a union or an intersection have;
    /// `owner` has the first. `createUnionOrIntersectionProperty`: it takes the `nameType` of the first. Where that has none it
    /// goes by the declaration, and has one only if all that are declared are declared in one place.
    fn key_type_of_props(&mut self, owner: TypeId, props: &[Prop]) -> Option<TypeId> {
        let first = &props[0];
        let key = self.key_type_of_prop(owner, first)?;
        let is_by_declaration = match &first.source {
            PropSource::Members(members) => {
                matches!(self.hir(members[0].0)[members[0].1].key, PropKey::Name(_))
            }
            PropSource::Literal(file, written) => {
                matches!(self.hir(*file)[*written].key, PropKey::Name(_))
            }
            _ => false,
        };
        let is_declared_elsewhere = |other: &Prop| match (&first.source, &other.source) {
            (PropSource::Members(a), PropSource::Members(b)) => a[0] != b[0],
            (PropSource::Literal(f, a), PropSource::Literal(g, b)) => (f, a) != (g, b),
            (_, PropSource::Members(_) | PropSource::Literal(..)) => true,
            _ => false,
        };
        if is_by_declaration
            && matches!(self.data(key), TypeData::NumberLit { .. })
            && props[1..].iter().any(is_declared_elsewhere)
        {
            return Some(self.string_literal(first.name, false));
        }
        Some(key)
    }

    /// Whether the name of a property of an object literal, which starts at `pos` of `file`, is a string: `"0"`, `["0"]`. Object
    /// literals are never in declaration files, so the text is there.
    fn is_name_written_as_string(&self, file: FileId, pos: u32) -> bool {
        let text = &self.hir(file).text;
        let at = pos as usize;
        let first = match text.get(at) {
            Some(b'[') => text[at + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace() && **b != b'('),
            first => first,
        };
        matches!(first, Some(b'"' | b'\'' | b'`'))
    }

    // ───────────────────────────── T[K] ─────────────────────────────

    /// `obj[index]` as a type. Where there is no such property it is `unknown`.
    pub fn indexed_access(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        self.indexed_access_if_any(obj, index, false)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// What comes of a type `obj[index]` that had to wait, now that more is known of `obj` or `index`. `undefined`: what it
    /// has kept of how it was made (`AccessFlagsPersistent`). No expression looks it up any more, so it waits as types do.
    pub(super) fn indexed_access_flagged(
        &mut self,
        obj: TypeId,
        index: TypeId,
        undefined: bool,
    ) -> Option<TypeId> {
        self.indexed_access_worker(obj, index, false, undefined, false)
    }

    /// The type of the expression `obj[index]` when it is read. Where there is no such property it is an error.
    pub fn indexed_access_for_read(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        if let Some(ty) = self.indexed_access_if_any(obj, index, true) {
            return ty;
        }
        self.read_of_object_literal(obj, index)
            .unwrap_or(TypeId::UNRESOLVED)
    }

    /// `getPropertyTypeForIndexType`, for `obj[index]` the expression: an object literal that is read on the spot has what is
    /// written and nothing else.
    fn read_of_object_literal(&mut self, obj: TypeId, index: TypeId) -> Option<TypeId> {
        let (obj, index) = (self.force(obj), self.force(index));
        if !self.is_object_literal_type(obj) {
            return None;
        }
        let members = self.members(obj)?;
        let mut types = Vec::new();
        for &key in self.parts(index) {
            if let Some(ty) = self.indexed_access_if_any(obj, key, true) {
                types.push(ty);
            } else if self.p.files.options.no_implicit_any
                && matches!(
                    self.data(key),
                    TypeData::StringLit { .. }
                        | TypeData::NumberLit { .. }
                        | TypeData::EnumLit { .. }
                )
            {
                types.push(self.undefined_as_declared());
            } else if key == TypeId::STRING || key == TypeId::NUMBER {
                for prop in &members.shape().props {
                    types.push(self.type_of_prop(prop, members.mapper));
                }
                types.push(self.undefined_as_declared());
            } else {
                return None;
            }
        }
        Some(self.union(&types))
    }

    /// `None`: `obj` has nothing under `index`, or under a member of the union that is.
    /// `is_expression`: it is an expression or a pattern that looks it up, not a type.
    pub(super) fn indexed_access_if_any(
        &mut self,
        obj: TypeId,
        index: TypeId,
        is_expression: bool,
    ) -> Option<TypeId> {
        let include_undefined = is_expression && self.p.files.options.no_unchecked_indexed_access;
        self.indexed_access_worker(obj, index, is_expression, include_undefined, true)
    }

    /// `getIndexedAccessTypeOrUndefined`. `include_undefined`: what an index signature gives may be missing. `has_access_node` is
    /// `accessNode != nil`: false for an access that instantiation or a constraint produces.
    fn indexed_access_worker(
        &mut self,
        obj: TypeId,
        index: TypeId,
        is_expression: bool,
        include_undefined: bool,
        has_access_node: bool,
    ) -> Option<TypeId> {
        let (obj, index) = (self.force(obj), self.force(index));
        if obj == TypeId::UNRESOLVED || index == TypeId::UNRESOLVED {
            return Some(TypeId::UNRESOLVED);
        }
        // `getReducedType`: an intersection nothing can be is not there.
        let obj = self.reduced(obj);
        let index = self.key_into_string_index_only(obj, index);
        if self.is_generic(index) || self.defers_access(obj, index, is_expression) {
            if obj == TypeId::ANY || obj == TypeId::UNKNOWN {
                return Some(obj);
            }
            return Some(self.intern(TypeData::IndexedAccess {
                obj,
                index,
                undefined: include_undefined,
            }));
        }
        if obj == TypeId::ANY || obj == TypeId::NEVER {
            return Some(obj);
        }
        if let TypeData::Union(keys) = self.data(index) {
            let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(keys.len());
            for &key in keys.iter() {
                types.push(self.property_type_for_index(
                    obj,
                    key,
                    include_undefined,
                    has_access_node,
                )?);
            }
            return Some(self.union(&types));
        }
        self.property_type_for_index(obj, index, include_undefined, has_access_node)
    }

    /// The start of `getIndexedAccessTypeOrUndefined`: where `obj`, reduced, has a string index signature and nothing else, it is
    /// the signature that answers, whatever the key, which is `string` from there on.
    pub(super) fn key_into_string_index_only(&mut self, obj: TypeId, index: TypeId) -> TypeId {
        if index != TypeId::STRING
            && !self.is_nullish(index)
            && self.is_string_index_signature_only(obj)
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
        // A tuple has a `length`.
        if !self.is_object_type(ty) || self.is_tuple(ty) || self.is_generic(ty) {
            return false;
        }
        // A mapped type over a name has a property of that name. What its properties are is not worked out to see that.
        if let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(ty)
            && self.mapped_decl(file, node).name_ty.is_none()
        {
            let keys = self.mapped_constraint(file, node, mapper);
            let keys = self.force(keys);
            for &key in self.parts(keys) {
                if self.property_name_of_type(key).is_some() {
                    return false;
                }
            }
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

    /// `shouldDeferIndexedAccessType`, as far as the object goes.
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
                        c.files().atoms.text(value).parse().unwrap_or(f64::NAN)
                    }
                    _ => return false,
                };
                at >= 0.0 && at < limit
            });
        }
        // An expression looks into what a type parameter extends. It is the type that waits for it.
        !is_expression
            && self.has_type_variables(obj)
            && (self.is_generic_object_type(obj) || self.is_generic_reducible(obj))
    }

    /// `getTotalFixedElementCount`: the elements before the first and after the last that stands for any number of them.
    fn total_fixed_element_count(flags: &[ElemFlags]) -> usize {
        let variable = ElemFlags::REST | ElemFlags::VARIADIC;
        flags.iter().take_while(|f| !f.intersects(variable)).count()
            + flags
                .iter()
                .rev()
                .take_while(|f| !f.intersects(variable))
                .count()
    }

    /// `isGenericReducibleType`: whether filling in type parameters could make nothing of the intersection `ty`, or of a member
    /// of the union `ty` (`isReducibleIntersection`).
    pub(super) fn is_generic_reducible(&mut self, ty: TypeId) -> bool {
        if !self.has_type_variables(ty) {
            return false;
        }
        match self.data(ty) {
            TypeData::Union(parts) => parts.iter().any(|&p| {
                matches!(self.data(p), TypeData::Intersection(_)) && self.is_generic_reducible(p)
            }),
            TypeData::Intersection(_) => {
                let Some(members) = self.members(ty) else {
                    return false;
                };
                for prop in &members.shape().props {
                    let PropSource::Intersected(_, parts) = &prop.source else {
                        continue;
                    };
                    if prop.flags.contains(PropFlags::OPTIONAL) {
                        continue;
                    }
                    let mut list = Vec::with_capacity(parts.len());
                    for part in parts.iter() {
                        list.push(self.type_of_prop(part, MapperId::IDENTITY));
                    }
                    // `uniqueLiteralMapper` replaces everything with `TypeFlagsTypeParameter` by `uniqueLiteralType`, a literal that
                    // no other literal equals. `CheckFlagsHasLiteralType` counts pattern literals as well.
                    if list.iter().any(|&t| {
                        matches!(
                            self.data(t),
                            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_)
                        )
                    }) && !list.contains(&TypeId::NEVER)
                        && list.iter().any(|&t| {
                            t == TypeId::BOOLEAN
                                || self.every_type(t, |c, m| c.is_unit(m))
                                || self.is_pattern_literal(t)
                        })
                    {
                        return true;
                    }
                }
                false
            }
            _ => false,
        }
    }

    /// `ty`, or nothing at all if `include_undefined` (`missingType`).
    fn or_missing(&mut self, ty: TypeId, include_undefined: bool) -> TypeId {
        if include_undefined {
            self.with_missing(ty)
        } else {
            ty
        }
    }

    /// What has the index signatures of `ty`. For a tuple whose members nobody has asked for it is the array the tuple is based on, with
    /// the tuple for `this` (`getTupleBaseType`, `resolveObjectTypeMembers`): the members of the tuple take all of that array's.
    fn holder_of_index_signatures(&mut self, ty: TypeId) -> TypeId {
        let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = self.data(ty)
        else {
            return ty;
        };
        if self.p.members.get(&ty).is_some() {
            return ty;
        }
        if let Some(known) = self.p.tuple_bases.get(&ty) {
            return known;
        }
        let before = self.what_only_holds_for_now();
        let element = self.tuple_element_union(elems, flags);
        let array = if *readonly {
            self.readonly_array_of(element)
        } else {
            self.array_of(element)
        };
        let base = self.type_with_this_argument(array, ty);
        if self.what_only_holds_for_now() == before {
            self.p.tuple_bases.insert(ty, base);
        }
        base
    }

    /// `getPropertyTypeForIndexType`: what `obj`, which waits for nothing, has under `index`, which is no union.
    fn property_type_for_index(
        &mut self,
        obj: TypeId,
        index: TypeId,
        include_undefined: bool,
        has_access_node: bool,
    ) -> Option<TypeId> {
        let name = self.property_name_of_type(index);
        if let TypeData::Union(parts) = self.data(obj) {
            return self.property_type_of_union_for_index(
                parts,
                index,
                name,
                include_undefined,
                has_access_node,
            );
        }
        // `getReducedApparentType`
        let apparent = self.apparent_type(obj);
        let apparent = self.reduced(apparent);
        if self.is_any(apparent) || apparent == TypeId::NEVER {
            return Some(apparent);
        }
        if let TypeData::Union(parts) = self.data(apparent) {
            return self.property_type_of_union_for_index(
                parts,
                index,
                name,
                include_undefined,
                has_access_node,
            );
        }
        if let Some(name) = name
            && let TypeData::Tuple { elems, flags, .. } = self.data(apparent)
            && self.is_numeric_name(name)
        {
            let at: f64 = self.files().atoms.text(name).parse().unwrap_or(f64::NAN);
            let variable = flags
                .iter()
                .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                .unwrap_or(flags.len());
            if at >= 0.0 && at < variable as f64 && at.fract() == 0.0 {
                let n = at as usize;
                return Some(if flags[n].contains(ElemFlags::OPTIONAL) {
                    self.optional_property(elems[n])
                } else {
                    elems[n]
                });
            }
            // Without a rest element, an index past the end gives `undefinedType`. So does a negative index that is written (2514).
            if variable == flags.len() && (at >= 0.0 || at < 0.0 && has_access_node) {
                return Some(self.undefined_as_declared());
            }
            // `getTupleElementTypeOutOfStartCount`: past the fixed start it is any of what follows. What is below zero goes by
            // the index signature.
            if at >= 0.0 {
                let rest = self.tuple_element_union(&elems[variable..], &flags[variable..]);
                return Some(self.or_missing(
                    rest,
                    include_undefined && at >= Self::total_fixed_element_count(flags) as f64,
                ));
            }
        }
        let holder = if name.is_none() {
            self.holder_of_index_signatures(apparent)
        } else {
            apparent
        };
        let Some(members) = self.members(holder) else {
            return (index == TypeId::NEVER).then_some(TypeId::NEVER);
        };
        // `getPropertyOfType`: what every function and every object has counts, and comes before any index signature.
        if let Some(name) = name
            && let Some((prop, mapper)) = self.property_of_type(&members, name)
        {
            return Some(self.type_of_prop(&prop, mapper));
        }
        self.index_signature_type(apparent, &members, index, name, include_undefined)
    }

    /// The same of a union. It has the properties that some member has and the others have something to stand in for
    /// (`createUnionOrIntersectionProperty`), and the index signatures that all members have (`getUnionIndexInfos`).
    fn property_type_of_union_for_index(
        &mut self,
        parts: &[TypeId],
        index: TypeId,
        name: Option<Atom>,
        include_undefined: bool,
        has_access_node: bool,
    ) -> Option<TypeId> {
        let mut is_property = false;
        if let Some(name) = name {
            let mut is_restricted = false;
            for &part in parts {
                let apparent = self.apparent_type(part);
                let Some(members) = self.members(apparent) else {
                    continue;
                };
                match members.resolved.prop(name) {
                    Some(prop) => {
                        is_property = true;
                        is_restricted |= match &prop.source {
                            PropSource::Intersected(_, props) => props.iter().any(|p| {
                                p.flags
                                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                            }),
                            _ => prop
                                .flags
                                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED),
                        };
                    }
                    None if !is_property => {
                        is_property = self.property_of_type(&members, name).is_some()
                    }
                    None => {}
                }
            }
            // Private or protected in one member, missing or declared elsewhere in another: not there.
            if is_restricted && self.is_hidden_in_union(parts, name) {
                is_property = false;
            }
        }
        // A number that is no property of tuples: of each, what follows its fixed start.
        let is_past_tuples = !is_property
            && name.is_some_and(|name| self.is_numeric_name(name))
            && parts.iter().all(|&part| self.is_tuple(part));
        if is_property || is_past_tuples {
            let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(parts.len());
            for &part in parts {
                // What stands in for a property is there.
                match self.property_type_for_index(
                    part,
                    index,
                    include_undefined && !is_property,
                    has_access_node,
                ) {
                    Some(ty) => types.push(ty),
                    // An object literal that does not mention what another has does not have it.
                    None if is_property && self.is_closed_object_literal_type(part) => {
                        types.push(self.undefined_as_declared())
                    }
                    None => break,
                }
            }
            if types.len() == parts.len() {
                return Some(self.union(&types));
            }
        }
        let index_infos = self.union_index_infos(parts);
        let whole = self.synth(Shape {
            index: index_infos,
            ..Shape::default()
        });
        let members = self.members(whole)?;
        self.index_signature_type(whole, &members, index, name, include_undefined)
    }

    /// `getUnionIndexInfos`: the index signatures of the first member that all the others have too, for the same keys. A tuple
    /// has that of an array of all its elements.
    pub(super) fn union_index_infos(&mut self, parts: &[TypeId]) -> Vec<IndexInfo> {
        let mut all = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            let Some(members) = self.members(apparent) else {
                return Vec::new();
            };
            all.push(members);
        }
        let mut infos = Vec::new();
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
            infos.push(IndexInfo {
                key: info.key,
                value: self.union(&values),
                readonly,
            });
        }
        infos
    }

    /// The end of `getPropertyTypeForIndexType`: `index` names no property of `obj`, whose `members` are given.
    fn index_signature_type(
        &mut self,
        obj: TypeId,
        members: &Members,
        index: TypeId,
        name: Option<Atom>,
        include_undefined: bool,
    ) -> Option<TypeId> {
        let mut value = self.applicable_index_info(members, index, name);
        // The string index signature stands in where none applies, which is to say for symbols.
        if value.is_none() && self.is_symbol_like(index) {
            value = self.applicable_index_info(members, TypeId::STRING, None);
        }
        if let Some(value) = value {
            let value = self.force(value);
            // An enum knows the names of its own members.
            let is_own_member = matches!(
                (self.data(obj), self.data(index)),
                (TypeData::Anon { origin: Origin::EnumObject(owner), .. }, TypeData::EnumLit { member, .. })
                    if self.files().sym(member.file, self.files().symbol(*member).parent) == *owner
            );
            return Some(self.or_missing(value, include_undefined && !is_own_member));
        }
        (index == TypeId::NEVER || index == TypeId::ANY).then_some(index)
    }

    // ───────────────────────────── conditional types ─────────────────────────────

    pub(super) fn collect_infer_params(
        &self,
        file: FileId,
        node: TypeNodeId,
        out: &mut Vec<TypeParamId>,
    ) {
        let hir = self.hir(file);
        let list = |c: &Self, l: IdList<TypeNodeId>, out: &mut Vec<TypeParamId>| {
            for n in hir.ids(l) {
                c.collect_infer_params(file, n, out);
            }
        };
        match hir[node].kind {
            TypeNodeKind::Infer(p) => {
                // `infer T` twice in one `extends` is one parameter.
                if !out.iter().any(|&o| hir[o].name == hir[p].name) {
                    out.push(p);
                }
            }
            TypeNodeKind::Ref { args, .. }
            | TypeNodeKind::Typeof { args, .. }
            | TypeNodeKind::Import { args, .. } => list(self, args, out),
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => list(self, types, out),
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.collect_infer_params(file, t, out)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.collect_infer_params(file, hir[e].ty, out);
                }
            }
            TypeNodeKind::Fn(f) => {
                for p in hir[f].params.iter() {
                    if hir[p].ty.is_some() {
                        self.collect_infer_params(file, hir[p].ty, out);
                    }
                }
                if hir[f].this_ty.is_some() {
                    self.collect_infer_params(file, hir[f].this_ty, out);
                }
                if hir[f].ret.is_some() {
                    self.collect_infer_params(file, hir[f].ret, out);
                }
            }
            TypeNodeKind::Object(members) => {
                for m in members.iter() {
                    if hir[m].ty.is_some() {
                        self.collect_infer_params(file, hir[m].ty, out);
                    }
                    if hir[m].func.is_some() {
                        let f = hir[m].func;
                        for p in hir[f].params.iter() {
                            if hir[p].ty.is_some() {
                                self.collect_infer_params(file, hir[p].ty, out);
                            }
                        }
                        if hir[f].ret.is_some() {
                            self.collect_infer_params(file, hir[f].ret, out);
                        }
                    }
                }
            }
            TypeNodeKind::Cond { check, yes, no, .. } => {
                self.collect_infer_params(file, check, out);
                self.collect_infer_params(file, yes, out);
                self.collect_infer_params(file, no, out);
            }
            TypeNodeKind::Mapped(m) => {
                if hir[m].ty.is_some() {
                    self.collect_infer_params(file, hir[m].ty, out);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.collect_infer_params(file, obj, out);
                self.collect_infer_params(file, index, out);
            }
            TypeNodeKind::Predicate { ty, .. } => {
                if ty.is_some() {
                    self.collect_infer_params(file, ty, out);
                }
            }
            _ => {}
        }
    }

    /// `getConditionalTypeInstantiation`: the conditional type at `node`, with `mapper` for the type parameters around it.
    pub fn conditional_type(&mut self, file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeId {
        let key = Deep::Conditional(file, node, mapper);
        let is_aliased = std::mem::take(&mut self.aliased_reference);
        if let Some(known) = self.p.conditionals.get(&(file, node, mapper)) {
            // `getConditionalTypeKey` includes the alias. Under a new alias tsgo resolves the type again and reports 2589 again.
            if is_aliased && self.p.excessive.get(&key).is_some() {
                self.excessively_deep();
            } else {
                self.note_depth(key, None);
            }
            return known;
        }
        if !self.enter(Query::Cond(file, node, mapper)) {
            return self.excessively_deep();
        }
        let events = self.deep_events;
        let ty = self.conditional_type_uncached(file, node, mapper, false);
        if self.leave() {
            self.note_depth(key, Some(events));
            self.p.conditionals.insert((file, node, mapper), ty);
        }
        ty
    }

    /// `ConditionalRoot.isDistributive`: the check type of the conditional type at `node` is a type parameter. Inside the true branch of
    /// a conditional type that implies a constraint for the parameter, the reference to it is a substitution type
    /// (`getConditionalFlowTypeOfType`), which does not distribute.
    pub(super) fn is_distributive_conditional(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
            return false;
        };
        let declared = self.type_from_node(file, check);
        if !matches!(self.data(declared), TypeData::TypeParam(..)) {
            return false;
        }
        let parents = self.type_parents(file);
        let narrowed = self.conditional_flow_type(file, declared, check, &parents);
        // `getSubstitutionType` returns the base type for a constraint that is `any`, `unknown` or the base type itself.
        narrowed == declared || narrowed == TypeId::ANY || narrowed == TypeId::UNRESOLVED
    }

    /// `for_constraint`: what is checked is not the type itself but what it extends, so that failing the test does not
    /// rule out that the type passes it.
    pub(super) fn conditional_type_uncached(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        for_constraint: bool,
    ) -> TypeId {
        let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
            return TypeId::UNRESOLVED;
        };
        let check_declared = self.type_from_node(file, check);
        // `T extends U ? X : Y` on a bare `T` is applied to each member of a union.
        if matches!(self.data(check_declared), TypeData::TypeParam(..))
            && let Some(value) = self.p.types.map(mapper, check_declared)
        {
            let value = self.force(value);
            // `getConditionalTypeInstantiation`: an intersection nothing can be is not there to be gone through.
            let value = self.reduced(value);
            let is_distributed = (value == TypeId::NEVER || self.is_union(value))
                && self.is_distributive_conditional(file, node);
            if is_distributed && value == TypeId::NEVER {
                return TypeId::NEVER;
            }
            if is_distributed && let TypeData::Union(parts) = self.data(value) {
                let mut results: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(parts.len());
                for &part in parts.iter() {
                    let mut pairs = self.p.types.mapping(mapper).to_vec();
                    for p in &mut pairs {
                        if p.0 == check_declared {
                            p.1 = part;
                        }
                    }
                    let one = self.p.types.mapper(pairs);
                    results.push(if for_constraint {
                        self.resolve_conditional(file, node, one, true)
                    } else {
                        self.conditional_type(file, node, one)
                    });
                }
                return self.union(&results);
            }
        }
        self.resolve_conditional(file, node, mapper, for_constraint)
    }

    /// How many elements the tuple written at `node` has, if none is optional or a rest.
    fn simple_tuple_len(&self, file: FileId, node: TypeNodeId) -> Option<usize> {
        let hir = self.hir(file);
        let TypeNodeKind::Tuple(elems) = hir[node].kind else {
            return None;
        };
        (!elems.is_empty() && elems.iter().all(|e| !hir[e].optional && !hir[e].rest))
            .then(|| elems.iter().count())
    }

    fn has_generic_element(&mut self, ty: TypeId) -> bool {
        let TypeData::Tuple { elems, .. } = self.data(ty) else {
            return false;
        };
        elems.iter().any(|&e| self.is_generic(e))
    }

    /// `getConditionalType`
    fn resolve_conditional(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        for_constraint: bool,
    ) -> TypeId {
        let (mut file, mut node, mut mapper) = (file, node, mapper);
        let mut extra_types: Vec<TypeId> = Vec::new();
        // The roots of the tail calls that the loop has followed. Its length is `tailCount`.
        let mut tail_roots: Vec<(FileId, TypeNodeId, MapperId)> = Vec::new();
        let result = loop {
            if tail_roots.len() == 1000 {
                return self.excessively_deep();
            }
            if !tail_roots.is_empty() && self.is_out_of_time() {
                self.gave_up();
                return TypeId::UNRESOLVED;
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
            let events = self.deep_events;
            let check_ty = self.instantiate(check_declared, mapper);
            let check_ty = self.force(check_ty);
            let extends_declared = self.type_from_node(file, extends);
            if check_ty == TypeId::UNRESOLVED {
                return TypeId::UNRESOLVED;
            }
            // `checkType == c.errorType`. There is no separate error type: `any` is one if computing it hit an instantiation limit.
            if check_ty == TypeId::ANY && self.deep_events != events {
                return TypeId::ANY;
            }
            // `[A] extends [B]` waits for its elements like `A extends B` would.
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
                    // The `infer` positions are found in the `extends` type with everything else filled in.
                    let target = self.instantiate(extends_declared, mapper);
                    let inferred = self.infer_from_types(&params, check_ty, target, mapper);
                    let mapping = self.p.types.mapping(mapper);
                    let mut pairs = Vec::with_capacity(mapping.len() + params.len());
                    pairs.extend_from_slice(mapping);
                    pairs.extend(params.iter().copied().zip(inferred));
                    combined = self.p.types.mapper(pairs);
                }
            }
            let events = self.deep_events;
            let extends_ty = self.instantiate(extends_declared, combined);
            let extends_ty = self.force(extends_ty);
            if extends_ty == TypeId::UNRESOLVED {
                return TypeId::UNRESOLVED;
            }
            // `extendsType == c.errorType`
            if extends_ty == TypeId::ANY && self.deep_events != events {
                return TypeId::ANY;
            }
            if check_is_generic
                || self.is_generic(extends_ty)
                || check_tuples && self.has_generic_element(extends_ty)
            {
                break self.intern(TypeData::Cond { file, node, mapper });
            }
            let extends_is_top = extends_ty == TypeId::ANY || extends_ty == TypeId::UNKNOWN;
            // `getPermissiveInstantiation` leaves a type without type variables as it is. `Relation::Permissive` would take the type
            // parameters of a generic signature in it for the wildcard.
            let permissive =
                if self.has_type_variables(check_ty) || self.has_type_variables(extends_ty) {
                    Relation::Permissive
                } else {
                    Relation::Assignable
                };
            let (branch, branch_mapper, is_false_branch) = if !extends_is_top
                && (check_ty == TypeId::ANY || !self.related(check_ty, extends_ty, permissive))
            {
                // `any` may pass. So may what extends `check_ty`, if something that passes is one of the things `check_ty` can be.
                let with_true = check_ty == TypeId::ANY
                    || for_constraint
                        && extends_ty != TypeId::NEVER
                        && self
                            .parts(extends_ty)
                            .iter()
                            .any(|&t| self.is_assignable_permissive(t, check_ty));
                if with_true {
                    // In the true branch the type parameter that is checked is a substitution type. What it stands for did not pass,
                    // so it comes to that and what it is checked against, both (`instantiateTypeWorker`). `any` passes all but
                    // `never`.
                    let in_true_branch = if (check_ty != TypeId::ANY || extends_ty == TypeId::NEVER)
                        && matches!(self.data(check_declared), TypeData::TypeParam(..))
                    {
                        let narrowed = self.intersection(&[extends_ty, check_ty]);
                        let mut pairs = self.p.types.mapping(combined).to_vec();
                        for pair in &mut pairs {
                            if pair.0 == check_declared {
                                pair.1 = narrowed;
                            }
                        }
                        self.p.types.mapper(pairs)
                    } else {
                        combined
                    };
                    let yes_declared = self.type_from_node(file, yes);
                    extra_types.push(self.instantiate(yes_declared, in_true_branch));
                }
                (no, mapper, true)
            } else {
                // `getRestrictiveInstantiation` of both: a type parameter in there passes for what it is, not for what it extends.
                let passes = extends_is_top
                    || if self.has_type_variables(check_ty) || self.has_type_variables(extends_ty) {
                        self.related(check_ty, extends_ty, Relation::Restrictive)
                    } else {
                        self.is_assignable(check_ty, extends_ty)
                    };
                if !passes {
                    break self.intern(TypeData::Cond { file, node, mapper });
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
                    if is_tail_call {
                        // The loop is deterministic: a root that comes back under the same mapper comes back until `tailCount == 1000`.
                        if tail_roots.contains(&root) {
                            return self.excessively_deep();
                        }
                        tail_roots.push(root);
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

    /// `Ok`: the conditional type that the loop of `getConditionalType` continues with instead of instantiating the branch at `branch`
    /// under `mapper`, and whether that step counts as a tail call. `Err`: the declared type of the branch, which is to be
    /// instantiated. `outer_check` is the declared check type of the conditional type that has the branch.
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
        // `getTailRecursionRoot`. A root without outer type parameters has the identity mapper, which `map_mapper` returns as it is.
        // A mapper that changes no type argument gives `declared` again.
        if root_mapper == own {
            return Err(declared);
        }
        // `instantiate` recognizes the error type among the new type arguments and answers with it (`checkType == c.errorType`).
        let (before, after) = (self.p.types.mapping(own), self.p.types.mapping(root_mapper));
        if before
            .iter()
            .zip(after)
            .any(|(b, a)| a.1 == TypeId::ANY && self.is_tuple(b.1))
        {
            return Err(declared);
        }
        if is_distributive && let Some(value) = self.p.types.map(root_mapper, root_check) {
            let value = self.force(value);
            if self.is_union(value) || value == TypeId::NEVER {
                return Err(declared);
            }
        }
        // tsgo counts a root that is the body of a type alias (`newRoot.alias != nil`). Every root that is not written in the branch
        // itself is reached through a type reference and counts here, which bounds the loop: the other steps descend in the syntax.
        Ok((
            (root_file, root, root_mapper),
            (root_file, root) != (file, branch),
        ))
    }

    /// `getConstraintFromConditionalType`, and the base constraint of what it gives (`computeBaseConstraint`).
    pub(super) fn constraint_of_conditional(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
            return TypeId::UNKNOWN;
        };
        let this = self.intern(TypeData::Cond { file, node, mapper });
        // `getConstraintOfTypeParameter`: a type parameter whose constraint comes back to it has none to put in its place.
        let check_declared = self.type_from_node(file, check);
        let checked = self.instantiate(check_declared, mapper);
        let is_circular = matches!(self.data(check_declared), TypeData::TypeParam(..))
            && matches!(
                self.data(checked),
                TypeData::TypeParam(..) | TypeData::ThisParam(_)
            )
            && {
                self.base_constraint(checked);
                self.p.circular_constraints.get(&checked).is_some()
            };
        let constraint = if is_circular {
            self.default_constraint_of_conditional(this)
        } else {
            self.constraint_of(this).unwrap_or(TypeId::UNKNOWN)
        };
        // What is left of a type variable is no constraint. A mapped type over one is an object type like another.
        let constraint = self.next_base_constraint(constraint);
        if self.some_type(constraint, |c, m| c.is_deferred(m)) {
            TypeId::UNKNOWN
        } else {
            constraint
        }
    }

    // ───────────────────────────── mapped types ─────────────────────────────

    pub(super) fn mapped_decl(&self, file: FileId, node: TypeNodeId) -> &'p Mapped {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[node].kind else {
            unreachable!("a mapped type")
        };
        &hir[m]
    }

    /// `getConstraintOfTypeParameter`, of the parameter of the mapped type at `node`.
    fn constraint_of_mapped_param(&mut self, file: FileId, node: TypeNodeId) -> Option<TypeId> {
        if let Some(known) = self.p.mapped_param_constraints.get(&(file, node)) {
            return known;
        }
        let before = self.what_only_holds_for_now();
        let param = self.type_param(file, self.mapped_decl(file, node).param);
        let constraint = self.constraint_of_type_param(param);
        if self.what_only_holds_for_now() == before {
            self.p
                .mapped_param_constraints
                .insert((file, node), constraint);
        }
        constraint
    }

    /// `getConstraintTypeFromMappedType`: what the parameter of the mapped type ranges over. `any` written there is every kind of
    /// key (`getConstraintFromTypeParameter`); one that comes back to the parameter is in error.
    pub(super) fn mapped_constraint(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        let declared = self
            .constraint_of_mapped_param(file, node)
            .unwrap_or(TypeId::ANY);
        self.instantiate(declared, mapper)
    }

    /// `getModifiersTypeFromMappedType`. For `{ [P in keyof T]: X }`, and for `{ [P in K]: X }` where `K` is `keyof T` by another
    /// name or extends it: `T` as declared. Its properties say what is optional and what is read-only. With it, whether
    /// `keyof T` is what is written (`isMappedTypeWithKeyofConstraintDeclaration`).
    pub(super) fn mapped_modifiers_source(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<(TypeId, bool)> {
        let mapped = self.mapped_decl(file, node);
        let constraint = self.hir(file)[mapped.param].constraint;
        // Going by how it is written: `keyof` of something that is not generic is a mere union by now.
        if let TypeNodeKind::Keyof(of) = self.hir(file)[constraint].kind {
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

    /// `getHomomorphicTypeVariable`: the `T` of a mapped type whose declared constraint type is `keyof T`, however that is written.
    pub(super) fn homomorphic_type_variable(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<TypeId> {
        let constraint = self.constraint_of_mapped_param(file, node)?;
        match *self.data(constraint) {
            TypeData::Keyof(target) if matches!(self.data(target), TypeData::TypeParam(..)) => {
                Some(target)
            }
            _ => None,
        }
    }

    /// `getResolvedApparentTypeOfMappedType`: `{ [P in keyof T]: X }` where all `T` can be is an array or a tuple is one too.
    pub(super) fn apparent_type_of_mapped(&mut self, ty: TypeId) -> TypeId {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        } = *self.data(ty)
        else {
            return ty;
        };
        let Some(source) = self.homomorphic_type_variable(file, node) else {
            return ty;
        };
        if self.mapped_decl(file, node).name_ty.is_some() {
            return ty;
        }
        let modifiers = self.instantiate(source, mapper);
        let base = if matches!(
            self.data(modifiers),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            }
        ) {
            self.apparent_type_of_mapped(modifiers)
        } else if self.is_deferred(modifiers) {
            self.base_constraint(modifiers)
        } else {
            return ty;
        };
        // `isArrayOrTupleType(t) || isArrayOrTupleOrIntersection(t)`
        let is_array_like = |c: &Self, t: TypeId| {
            c.is_array_or_tuple(t)
                || matches!(c.data(t), TypeData::Intersection(parts) if parts.iter().all(|&p| c.is_array_or_tuple(p)))
        };
        if base == modifiers || base == TypeId::NEVER || !self.every_type(base, is_array_like) {
            return ty;
        }
        let mut pairs = self.p.types.mapping(mapper).to_vec();
        pairs.retain(|p| p.0 != source);
        pairs.push((source, base));
        let applied = self.p.types.mapper(pairs);
        self.instantiate_mapped(file, node, applied)
    }

    /// The mapped type at `node` under `mapper`. One over the keys of an array is an array, and so on.
    pub fn instantiate_mapped(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> TypeId {
        let anon = |c: &mut Self| {
            // `instantiateMappedType` instantiates the constraint type at once (its wildcard test), so a cycle through the keys starts
            // here. `getTypeFromMappedTypeNode` has resolved the constraint of the declared type.
            if c.p
                .types
                .mapping(mapper)
                .iter()
                .any(|pair| pair.0 != pair.1)
            {
                c.mapped_constraint(file, node, mapper);
            }
            c.intern(TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            })
        };
        let Some(source) = self.homomorphic_type_variable(file, node) else {
            return anon(self);
        };
        let Some(value) = self.p.types.map(mapper, source) else {
            return anon(self);
        };
        let value = self.force(value);
        if value == source {
            return anon(self);
        }
        let value = self.reduced(value);
        self.map_type(value, |c, t| {
            c.instantiate_mapped_constituent(file, node, mapper, source, t)
        })
    }

    /// `instantiateConstituent`: the mapped type over the keys of `source`, with `t`, which is no union, for `source`.
    fn instantiate_mapped_constituent(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        source: TypeId,
        t: TypeId,
    ) -> TypeId {
        if self.is_primitive(t)
            || t == TypeId::UNRESOLVED
            || t == TypeId::OBJECT
            || matches!(
                self.data(t),
                TypeData::Keyof(_) | TypeData::Template { .. } | TypeData::StringMapping { .. }
            )
        {
            return t;
        }
        let with = |c: &mut Self, t: TypeId| {
            let mut pairs = c.p.types.mapping(mapper).to_vec();
            for p in &mut pairs {
                if p.0 == source {
                    p.1 = t;
                }
            }
            c.p.types.mapper(pairs)
        };
        let mapped = self.mapped_decl(file, node);
        let one = with(self, t);
        if mapped.name_ty.is_some() {
            return self.intern(TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper: one,
            });
        }
        let param = self.type_param(file, mapped.param);
        // `instantiateMappedTypeTemplate`
        let template = |c: &mut Self, of: MapperId, key: TypeId, is_optional: bool| {
            let declared = if mapped.ty.is_some() {
                c.type_from_node(file, mapped.ty)
            } else {
                TypeId::ANY
            };
            let with_key = c.mapper_with_pair(of, param, key);
            let ty = c.instantiate(declared, with_key);
            if !c.p.files.options.strict_null_checks {
                return ty;
            }
            match mapped.optional {
                // `getTemplateTypeFromMappedType` has it in the template as declared.
                MappedModifier::Add => c.optional_property(ty),
                MappedModifier::Remove if is_optional => {
                    c.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
                }
                _ => ty,
            }
        };
        // `hasArrayOrTypeTypeConstraint`: `any` for a `T` that can only be an array or a tuple is mapped as an array.
        let any_as_array = t == TypeId::ANY
            && !self.stack.contains(&Query::Constraint(source))
            && match self.constraint_of_type_param(source) {
                Some(constraint) => {
                    let constraint = self.force(constraint);
                    self.every_type(constraint, |c, m| c.is_array_or_tuple(m))
                }
                None => false,
            };
        // `instantiateMappedArrayType`
        if any_as_array || self.array_element(t).is_some() {
            // A template that is missing is in error, and so is an array of it.
            if mapped.ty.is_none() {
                return TypeId::ANY;
            }
            let events = self.deep_events;
            let element = template(self, one, TypeId::NUMBER, true);
            // `isErrorType(elementType)`: `any` is the error type if computing it hit an instantiation limit.
            if element == TypeId::ANY && self.deep_events != events {
                return TypeId::ANY;
            }
            let readonly = match mapped.readonly {
                MappedModifier::Add => true,
                MappedModifier::Remove => false,
                MappedModifier::None => self.is_global_ref(t, known::ReadonlyArray).is_some(),
            };
            return if readonly {
                self.readonly_array_of(element)
            } else {
                self.array_of(element)
            };
        }
        if let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = self.data(t)
        {
            // `instantiateMappedTupleType`: up to the first rest or variadic element each is looked up by its place. From there
            // on places are not known: what is spread is mapped as a whole, the others as the element of an array of their own.
            let fixed = flags
                .iter()
                .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                .unwrap_or(flags.len());
            // An element in error makes the whole an error.
            if mapped.ty.is_none() && fixed > 0 {
                return TypeId::ANY;
            }
            let mut new_elems = Vec::with_capacity(elems.len());
            let mut new_flags = Vec::with_capacity(elems.len());
            for (i, &f) in flags.iter().enumerate() {
                let events = self.deep_events;
                let elem = if i < fixed {
                    let name = self.number_name(i as f64);
                    let key = self.string_literal(name, false);
                    template(self, one, key, f.contains(ElemFlags::OPTIONAL))
                } else if f.contains(ElemFlags::VARIADIC) {
                    // `prependTypeMapping(typeVariable, e, m)` is a merged mapper: `e` goes through `m` as well. `...T` in the tuple
                    // that `m` has for `T` is that tuple again, and the same instantiation starts over until `instantiationDepth == 100`.
                    if elems[i] == source {
                        return self.excessively_deep();
                    }
                    let of_element = with(self, elems[i]);
                    self.instantiate_mapped(file, node, of_element)
                } else {
                    let list = self.array_of(elems[i]);
                    let of_list = with(self, list);
                    template(self, of_list, TypeId::NUMBER, true)
                };
                // `slices.Contains(newElementTypes, c.errorType)`
                if elem == TypeId::ANY && self.deep_events != events {
                    return TypeId::ANY;
                }
                let flag = match mapped.optional {
                    MappedModifier::Add if f.contains(ElemFlags::REQUIRED) => {
                        ElemFlags::OPTIONAL.with_label(f.label())
                    }
                    MappedModifier::Remove if f.contains(ElemFlags::OPTIONAL) => {
                        ElemFlags::REQUIRED.with_label(f.label())
                    }
                    _ => f,
                };
                // `TupleNormalizer.add`: what may be left out reads as `undefined` when it is.
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
                .map(|&p| self.instantiate_mapped_constituent(file, node, mapper, source, p))
                .collect();
            return self.intersection(&members);
        }
        self.intern(TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper: one,
        })
    }

    /// `getLowerBoundOfKeyType`: of keys that are not known yet, those that are there whatever they turn out to be.
    fn lower_bound_of_key_type(&mut self, ty: TypeId) -> TypeId {
        match *self.data(ty) {
            TypeData::Keyof(of) => {
                let apparent = self.apparent_type(of);
                // `getApparentTypeOfIntersectionType`: in an intersection each type variable gives way to what it extends.
                let apparent = if apparent == of && self.is_intersection(of) {
                    self.base_constraint(of)
                } else {
                    apparent
                };
                // `getKnownKeysOfTupleType`: the places before the first element that stands for any number of them, and what
                // every array has.
                if let TypeData::Tuple {
                    flags, readonly, ..
                } = self.data(apparent)
                    && flags.iter().any(|f| f.contains(ElemFlags::VARIADIC))
                {
                    let fixed = flags
                        .iter()
                        .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                        .unwrap_or(flags.len());
                    let mut keys: Vec<TypeId> = (0..fixed)
                        .map(|i| self.string_literal(self.number_name(i as f64), false))
                        .collect();
                    let array = if *readonly {
                        self.readonly_array_of(TypeId::ANY)
                    } else {
                        self.array_of(TypeId::ANY)
                    };
                    keys.push(self.keyof(array));
                    return self.union(&keys);
                }
                if apparent == of {
                    ty
                } else {
                    self.keyof(apparent)
                }
            }
            // `Exclude<keyof T, "a">`: over what `keyof T` is at least.
            TypeData::Cond { file, node, mapper } => {
                let TypeNodeKind::Cond { check, .. } = self.hir(file)[node].kind else {
                    return ty;
                };
                if !self.is_distributive_conditional(file, node) {
                    return ty;
                }
                let declared = self.type_from_node(file, check);
                let Some(checked) = self.p.types.map(mapper, declared) else {
                    return ty;
                };
                let bound = self.lower_bound_of_key_type(checked);
                if bound == checked {
                    return ty;
                }
                let mut pairs = self.p.types.mapping(mapper).to_vec();
                for pair in &mut pairs {
                    if pair.0 == declared {
                        pair.1 = bound;
                    }
                }
                let mapper = self.p.types.mapper(pairs);
                self.conditional_type(file, node, mapper)
            }
            // `mapTypeEx(.., noReductions)`: `string` from `keyof S` does not swallow the names next to it.
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
                // `string & {}` and the like are kept as they are.
                if let [first, TypeId::EMPTY_OBJECT] = parts[..]
                    && matches!(first, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
                {
                    return ty;
                }
                let bounds: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.lower_bound_of_key_type(p))
                    .collect();
                if bounds[..] == parts[..] {
                    ty
                } else {
                    self.intersection(&bounds)
                }
            }
            _ => ty,
        }
    }

    /// `{ [P in K]: E }[X]` where `K` is known and `X` is not: `E` with `X` for `P`, which keeps what `E` says of one key
    /// together where the union over all keys would not.
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
        // `couldAccessOptionalProperty`: it may be one of the properties that can be left out.
        let optional = mapped.optional == MappedModifier::Add || {
            let keys = self.base_constraint(index);
            let members = self.members(obj)?;
            let mut could = false;
            for prop in &members.shape().props {
                if prop.flags.contains(PropFlags::OPTIONAL)
                    && let Some(key) = self.key_type_of_prop(obj, prop)
                    && self.is_assignable(key, keys)
                {
                    could = true;
                    break;
                }
            }
            could
        };
        Some(if optional {
            self.optional_property(template)
        } else {
            template
        })
    }

    /// The base constraint of what `getSimplifiedIndexedAccessType` makes of an `obj[index]` that has to wait though `index` is
    /// known. `[A, ...T][1]` is `T[number]`. Where a mapped type does not know its keys yet, `(T & U)[K]` is `T[K] & U[K]`, and
    /// `{ [P in K]: E }[X]` is `E` with `X` for `P`, whether or not `X` turns out to be a key.
    pub(super) fn simplified_access_to_intersection(
        &mut self,
        obj: TypeId,
        index: TypeId,
    ) -> Option<TypeId> {
        if self.is_generic(index) {
            return None;
        }
        if let TypeData::Tuple { elems, flags, .. } = self.data(obj) {
            if !self.defers_access(obj, index, false) {
                return None;
            }
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
            // By `number` it is any element, by a number any from the first that stands for any number of them on.
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

    /// What can be said of a value of the union `ty` without knowing which member it is: the properties all of them have,
    /// by name or by index signature (`getPropertiesOfUnionOrIntersectionType`), and the index signatures all of them have.
    pub fn union_as_object(&mut self, ty: TypeId) -> TypeId {
        let parts = self.parts(ty);
        let mut shape = Shape::default();
        for &part in parts {
            let apparent = self.apparent_type(part);
            let Some(members) = self.members(apparent) else {
                break;
            };
            for prop in &members.shape().props {
                if shape.props.iter().any(|p| p.name == prop.name) {
                    continue;
                }
                let Some(value) = self.type_of_property(ty, prop.name) else {
                    continue;
                };
                // `createUnionOrIntersectionProperty`: it can be left out, can only be read or is not public if it is so in some member.
                let mut flags = PropFlags::empty();
                // Of a name that reads as a number: the properties that go by it, and who has the first.
                let is_numeric = self.is_numeric_name(prop.name);
                let mut all: Vec<Prop> = Vec::new();
                let mut first_owner = apparent;
                for &other in parts {
                    let other = self.apparent_type(other);
                    let Some(of_other) = self.members(other) else {
                        continue;
                    };
                    match self.property_of_type(&of_other, prop.name) {
                        Some((p, _)) => {
                            flags |= p.flags
                                & (PropFlags::OPTIONAL
                                    | PropFlags::READONLY
                                    | PropFlags::PRIVATE
                                    | PropFlags::PROTECTED);
                            if is_numeric {
                                if all.is_empty() {
                                    first_owner = other;
                                }
                                all.push(p);
                            }
                        }
                        // The index signature that stands in for it says whether it can be written to.
                        None => {
                            if self
                                .applicable_index(&of_other, TypeId::STRING, Some(prop.name))
                                .is_some_and(|found| found.1)
                            {
                                flags |= PropFlags::READONLY;
                            }
                        }
                    }
                }
                if !all.is_empty()
                    && self
                        .key_type_of_props(first_owner, &all)
                        .is_some_and(|key| self.is_string_like(key))
                {
                    flags |= PropFlags::STRING_NAME;
                }
                shape.props.push(Prop {
                    name: prop.name,
                    flags,
                    source: PropSource::Type(value),
                    mapper: MapperId::IDENTITY,
                });
            }
            // What all have, the first without an index signature to stand in for names has by name.
            if members.shape().index.is_empty() {
                break;
            }
        }
        shape.index = self.union_index_infos(parts);
        self.synth(shape)
    }

    /// What `resolveMappedTypeMembers` and `getIndexTypeForMappedType` go over, for the mapped type at `node` under `mapper`, whose
    /// keys are `constraint`. With it, what the `T` of `keyof T` has (`getModifiersTypeFromMappedType`).
    fn mapped_key_types(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        constraint: TypeId,
    ) -> (List<'p, TypeId>, Option<Members<'p>>) {
        let source = self.mapped_modifiers_source(file, node);
        let over_keyof = matches!(source, Some((_, true)));
        // `getReducedApparentType`: of a type parameter what it extends, and an intersection nothing can be is not there.
        let modifiers_ty = match source {
            Some((source, _)) => {
                let ty = self.instantiate(source, mapper);
                let ty = self.reduced(ty);
                let ty = self.apparent_type(ty);
                Some(self.reduced(ty))
            }
            None => None,
        };
        let owner = match modifiers_ty {
            Some(ty) if self.is_union(ty) => Some(self.union_as_object(ty)),
            other => other,
        };
        let modifiers = match owner {
            Some(ty) => self.members(ty),
            None => None,
        };
        let keys = match (&modifiers, owner) {
            // `forEachMappedTypePropertyKeyTypeAndIndexSignatureKeyType`. Over `keyof T`, the properties and index signatures of
            // `T` one by one: in the union that `keyof T` is, `string` has swallowed the names.
            (Some(m), Some(owner)) if over_keyof => {
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
                        // One that is not public goes by `never`, which only an `as` clause makes something of.
                        None if renames => keys.push(TypeId::NEVER),
                        None => {}
                    }
                }
                keys.extend(m.shape().index.iter().map(|i| i.key));
                List::Own(keys)
            }
            // What can be anything is gone over as if it had any string for a name.
            _ if over_keyof && modifiers_ty == Some(TypeId::ANY) => List::One(TypeId::STRING),
            // Only `T` is looked at: `never`, `unknown` and the like have nothing to go over, whatever `keyof` makes of them.
            _ if over_keyof => List::Kept(&[]),
            _ if self.is_generic(constraint) => {
                let bound = self.lower_bound_of_key_type(constraint);
                List::Kept(self.parts(bound))
            }
            _ => List::Kept(self.parts(constraint)),
        };
        (keys, modifiers)
    }

    /// `maybeTypeOfKind(ty, TypeFlagsUndefined | TypeFlagsVoid)`
    fn may_be_undefined_or_void(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.may_be_undefined_or_void(p))
            }
            _ => ty.is_undefined() || ty == TypeId::VOID,
        }
    }

    /// `getTypeOfMappedSymbol`: what a property of a mapped type holds, `ty` being what the template comes to for it.
    /// `strips`: `-?` makes it a property that cannot be left out of one that could (`CheckFlagsStripOptional`).
    fn mapped_property_type(
        &mut self,
        ty: TypeId,
        modifier: MappedModifier,
        optional: bool,
        strips: bool,
    ) -> TypeId {
        if modifier == MappedModifier::Add {
            // `getTemplateTypeFromMappedType` has it in the template as declared, whatever comes of that.
            self.optional_property(ty)
        } else if optional {
            if self.may_be_undefined_or_void(ty) {
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

    /// `getTypeOfMappedSymbol`: the type of `prop`, which `build_mapped_shape` made for the mapped type `of`. `prop.mapper` is the
    /// mapper of `of` with the key type for the type parameter, or that mapper composed with another in a copy of the property
    /// (`getTypeOfInstantiatedSymbol`). `strips` is `CheckFlagsStripOptional`.
    pub(super) fn type_of_mapped_prop(&mut self, of: TypeId, prop: &Prop, strips: bool) -> TypeId {
        let known = self.p.mapped_prop_types.get(&(of, prop.name));
        // The error type stays the error type under every mapper.
        if known == Some(TypeId::ANY) {
            return TypeId::ANY;
        }
        let Some((file, node, mapper)) = self.mapped_origin(of) else {
            return TypeId::UNRESOLVED;
        };
        // `resolvedType` belongs to the symbol of `of`. The type of a copy depends on the mapper of the copy, so it is not cached here.
        // Composing adds pairs or changes type arguments; the key type has no type variables.
        let (own, with_key) = (
            self.p.types.mapping(mapper),
            self.p.types.mapping(prop.mapper),
        );
        let is_copy =
            with_key.len() != own.len() + 1 || !own.iter().all(|pair| with_key.contains(pair));
        if !is_copy && let Some(known) = known {
            return known;
        }
        if !self.enter(Query::MappedProp(of, prop.name)) {
            return if self.came_full_circle {
                TypeId::ANY
            } else {
                TypeId::UNRESOLVED
            };
        }
        let mapped = self.mapped_decl(file, node);
        let template = if mapped.ty.is_some() {
            self.type_from_node(file, mapped.ty)
        } else {
            TypeId::ANY
        };
        let ty = self.instantiate(template, prop.mapper);
        // `instantiateType` resolves a reference to a type alias here, inside the resolution.
        let ty = if matches!(self.data(ty), TypeData::LazyAlias { .. }) && !self.is_no_infer(ty) {
            self.force(ty)
        } else {
            ty
        };
        let ty = self.mapped_property_type(
            ty,
            mapped.optional,
            prop.flags.contains(PropFlags::OPTIONAL),
            strips,
        );
        let is_cacheable = self.leave();
        if self.left_a_circle {
            self.circular_mapped_property(of, prop.name);
            let kept = self
                .p
                .mapped_prop_types
                .insert((of, prop.name), TypeId::ANY);
            return if is_copy { TypeId::ANY } else { kept };
        }
        if is_cacheable && !is_copy {
            self.p.mapped_prop_types.insert((of, prop.name), ty);
        }
        ty
    }

    /// `resolveMappedTypeMembers`
    pub(super) fn build_mapped_shape(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) -> Shape {
        let mapped = self.mapped_decl(file, node);
        let param = self.type_param(file, mapped.param);
        let constraint = self.mapped_constraint(file, node, mapper);
        let constraint = self.force(constraint);
        let mut shape = Shape::default();
        if constraint == TypeId::UNRESOLVED {
            return shape;
        }
        let (keys, modifiers) = self.mapped_key_types(file, node, mapper, constraint);
        let template_declared = if mapped.ty.is_some() {
            self.type_from_node(file, mapped.ty)
        } else {
            TypeId::ANY
        };
        let name_declared = if mapped.name_ty.is_some() {
            Some(self.type_from_node(file, mapped.name_ty))
        } else {
            None
        };
        let of = self.intern(TypeData::Anon {
            origin: Origin::Mapped(file, node),
            mapper,
        });
        if keys.len() > 4 {
            shape.props.reserve_exact(keys.len());
        }
        // Where in `shape.props` each name is, once there are many.
        let mut places: FxHashMap<Atom, usize> = FxHashMap::default();
        for key in keys {
            let with_key = self.mapper_with_pair(mapper, param, key);
            let names = match name_declared {
                Some(declared) => self.instantiate(declared, with_key),
                None => key,
            };
            let key_name = self.property_name_of_type(key);
            let source_prop = match (&modifiers, key_name) {
                (Some(m), Some(name)) => m.resolved.prop(name).map(|p| p.flags),
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
                        // One property for all the keys that come to its name. Its `keyType` is their union. The first key has
                        // settled the modifiers.
                        Some(i) => {
                            let so_far = self
                                .p
                                .types
                                .map(shape.props[i].mapper, param)
                                .unwrap_or(key);
                            let all = self.union(&[so_far, key]);
                            if all != so_far {
                                shape.props[i].mapper = self.mapper_with_pair(mapper, param, all);
                            }
                        }
                        None => {
                            let was_optional =
                                source_prop.is_some_and(|f| f.contains(PropFlags::OPTIONAL));
                            let optional = match mapped.optional {
                                MappedModifier::Add => true,
                                MappedModifier::Remove => false,
                                MappedModifier::None => was_optional,
                            };
                            let readonly = match mapped.readonly {
                                MappedModifier::Add => true,
                                MappedModifier::Remove => false,
                                MappedModifier::None => {
                                    source_prop.is_some_and(|f| f.contains(PropFlags::READONLY))
                                }
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
                            // `nameType`: made from a string, it is named by one.
                            if self.is_string_like(name_ty) && self.is_numeric_name(name) {
                                flags |= PropFlags::STRING_NAME;
                            }
                            if !places.is_empty() {
                                places.insert(name, shape.props.len());
                            }
                            // The type is resolved on demand (`type_of_mapped_prop`): the template under `with_key`.
                            shape.props.push(Prop {
                                name,
                                flags,
                                source: PropSource::Mapped(of, strips),
                                mapper: with_key,
                            });
                        }
                    },
                    None => {
                        // `isValidIndexKeyType`, `any` and enums: a name that can be anything is any string, one that is some member of
                        // an enum any number. Anything else, like a type parameter or a template with one in it, adds nothing.
                        let index_key = if name_ty == TypeId::ANY || name_ty == TypeId::STRING {
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
                            // `string & {}` is a key of its own kind: no number goes by it.
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
                            (MappedModifier::None, Some(m)) => self
                                .applicable_index(m, name_ty, None)
                                .is_some_and(|found| found.1),
                            _ => false,
                        };
                        // `appendIndexInfo`
                        match shape.index.iter_mut().find(|i| i.key == index_key) {
                            Some(existing) => {
                                existing.value = self.union(&[existing.value, ty]);
                                existing.readonly |= readonly;
                            }
                            None => shape.index.push(IndexInfo {
                                key: index_key,
                                value: ty,
                                readonly,
                            }),
                        }
                    }
                }
            }
        }
        shape
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// `getTemplateLiteralType`: `` `${A}text${B}` ``
    pub fn template_type(&mut self, texts: &[Atom], types: &[TypeId]) -> TypeId {
        self.guard("template_type");
        // An alias that was being worked out when it was mentioned is taken for what it stands for, if that is known by now.
        let forced: Vec<TypeId>;
        let types = if types
            .iter()
            .any(|&t| matches!(self.data(t), TypeData::LazyAlias { .. }))
        {
            forced = types
                .iter()
                .map(|&t| {
                    if matches!(self.data(t), TypeData::LazyAlias { .. }) {
                        self.force(t)
                    } else {
                        t
                    }
                })
                .collect();
            &forced[..]
        } else {
            types
        };
        if types.contains(&TypeId::NEVER) {
            return TypeId::NEVER;
        }
        if types.contains(&TypeId::UNRESOLVED) {
            return TypeId::UNRESOLVED;
        }
        if let Some(at) = types.iter().position(|&t| self.is_union(t)) {
            // `checkCrossProductUnion`: from 100,000 on it is too complex to represent (2590), the error type.
            let count = types
                .iter()
                .fold(1usize, |n, &t| n.saturating_mul(self.parts(t).len()));
            if count >= 100_000 {
                return TypeId::ANY;
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
        let mut new_texts: Vec<Vec<u8>> = vec![self.files().atoms.bytes(texts[0]).to_vec()];
        let mut new_types: Vec<TypeId> = Vec::new();
        for (i, &ty) in types.iter().enumerate() {
            let literal: Option<Vec<u8>> = match *self.data(ty.plain()) {
                TypeData::StringLit { value, .. }
                | TypeData::EnumLit {
                    value: EnumValue::String(value),
                    ..
                } => Some(self.files().atoms.bytes(value).to_vec()),
                TypeData::NumberLit { bits, .. }
                | TypeData::EnumLit {
                    value: EnumValue::Number(bits),
                    ..
                } => {
                    let name = self.number_name(f64::from_bits(bits));
                    Some(self.files().atoms.bytes(name).to_vec())
                }
                TypeData::BoolLit { value, .. } => Some(if value {
                    b"true".to_vec()
                } else {
                    b"false".to_vec()
                }),
                TypeData::BigIntLit { text, negative, .. } => {
                    let mut t = if negative { b"-".to_vec() } else { Vec::new() };
                    t.extend_from_slice(self.files().atoms.bytes(text));
                    Some(t)
                }
                TypeData::Intrinsic(Intrinsic::Null) => Some(b"null".to_vec()),
                TypeData::Intrinsic(Intrinsic::Undefined) => Some(b"undefined".to_vec()),
                _ => None,
            };
            let next = self.files().atoms.bytes(texts[i + 1]);
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
                            .extend_from_slice(self.files().atoms.bytes(inner_texts[0]));
                        for (j, &t) in inner_types.iter().enumerate() {
                            new_types.push(t);
                            new_texts.push(self.files().atoms.bytes(inner_texts[j + 1]).to_vec());
                        }
                        new_texts.last_mut().unwrap().extend_from_slice(next);
                    } else if self.is_generic(ty)
                        || self.is_pattern_literal_placeholder(ty)
                        || matches!(self.data(ty), TypeData::LazyAlias { .. })
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
            let value = self.files().atoms.intern(&new_texts[0]);
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
        let texts: Vec<Atom> = new_texts
            .iter()
            .map(|t| self.files().atoms.intern(t))
            .collect();
        self.intern(TypeData::Template {
            texts: texts.into(),
            types: new_types.into(),
        })
    }

    /// `applyStringMapping`
    fn map_text(&self, kind: StringMappingKind, value: Atom) -> Atom {
        let mut mapped: Vec<u8> = Vec::new();
        // A lone surrogate, three bytes that are no UTF-8, has no case.
        for (i, chunk) in self.files().atoms.bytes(value).utf8_chunks().enumerate() {
            let text = chunk.valid();
            let mut chars = text.chars();
            let text = match (kind, chars.next()) {
                (StringMappingKind::Uppercase, _) => text.to_uppercase(),
                (StringMappingKind::Lowercase, _) => text.to_lowercase(),
                (StringMappingKind::Capitalize, Some(first)) if i == 0 => {
                    first.to_uppercase().collect::<String>() + chars.as_str()
                }
                (StringMappingKind::Uncapitalize, Some(first)) if i == 0 => {
                    first.to_lowercase().collect::<String>() + chars.as_str()
                }
                _ => text.to_owned(),
            };
            mapped.extend_from_slice(text.as_bytes());
            mapped.extend_from_slice(chunk.invalid());
        }
        self.files().atoms.intern(&mapped)
    }

    /// `getStringMappingType`
    pub fn string_mapping(&mut self, kind: StringMappingKind, ty: TypeId) -> TypeId {
        let ty = self.force(ty);
        match self.data(ty) {
            TypeData::Union(_) => self.map_type(ty, |c, m| c.string_mapping(kind, m)),
            TypeData::Intrinsic(Intrinsic::Never | Intrinsic::Unresolved) => ty,
            // `TypeFlagsStringLiteral`, which a member of an enum that is a string has too: what comes of it is a plain string.
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let mapped = self.map_text(kind, *value);
                self.string_literal(mapped, false)
            }
            // `applyTemplateStringMapping`: the case of all letters goes for every part, that of the first for the first part.
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
            // Twice is once.
            TypeData::StringMapping { kind: same, .. } if *same == kind => ty,
            TypeData::Intrinsic(Intrinsic::Any | Intrinsic::String)
            | TypeData::StringMapping { .. } => self.intern(TypeData::StringMapping { kind, ty }),
            _ if self.is_generic(ty) => self.intern(TypeData::StringMapping { kind, ty }),
            // A number is mapped as the string it makes.
            _ if self.is_pattern_literal_placeholder(ty) => {
                let inner = self.template_type(&[known::empty, known::empty], &[ty]);
                self.intern(TypeData::StringMapping { kind, ty: inner })
            }
            _ => ty,
        }
    }
}

/// `CombineSurrogatePairs`: a lone high surrogate right before a lone low one makes one character with it. Each is three bytes
/// (`EncodeJSStringRune`).
fn combine_surrogate_pairs(text: &mut Vec<u8>) {
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
