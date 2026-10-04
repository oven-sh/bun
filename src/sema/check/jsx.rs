//! The attributes a JSX element passes to its component, and the props the component accepts.
//!
//! Follows `getEffectiveFirstArgumentForJsxSignature`, `getJsxPropsTypeFromCallSignature`,
//! `getJsxPropsTypeFromClassType`, `getJsxManagedAttributesFromLocatedAttributes`,
//! `getNameFromJsxElementAttributesContainer`, `getUninstantiatedJsxSignaturesOfType`,
//! `getIntrinsicAttributesTypeFromStringLiteralType` and
//! `createJsxAttributesTypeFromAttributesProperty` of TypeScript 7.0.2's jsx.go.

use super::*;
use crate::resolve::JsxEmit;

/// The one property of `JSX.ElementAttributesProperty` or `JSX.ElementChildrenAttribute`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum JsxName {
    /// There is no such interface.
    Missing,
    /// It has no property.
    Empty,
    Name(Atom),
}

/// `JsxReferenceKind`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum JsxReferenceKind {
    Component,
    Function,
    Mixed,
}

impl<'p, 's> Checker<'p, 's> {
    fn jsx_symbol(&mut self, file: FileId, name: Atom) -> Option<Sym> {
        let ns = self.jsx_namespace_at(file, false)?;
        let member = self.files().namespace_member(ns, name)?;
        let member = self.files().resolve_alias_if_needed(member)?;
        self.files()
            .flags(member)
            .intersects(SymFlags::TYPE)
            .then_some(member)
    }

    /// `getJsxType`
    pub(super) fn jsx_type(&mut self, file: FileId, name: Atom) -> Option<TypeId> {
        let symbol = self.jsx_symbol(file, name)?;
        Some(self.declared_type(symbol))
    }

    /// `getJsxElementTypeTypeAt`: `JSX.ElementType`, with its type parameters instantiated to their
    /// defaults.
    pub(super) fn jsx_element_type_constraint(&mut self, file: FileId) -> Option<TypeId> {
        let symbol = self.jsx_symbol(file, known::ElementType)?;
        // `instantiateAliasOrInterfaceWithDefaults`: it accepts an alias, a class or an interface.
        let can_be_instantiated = self
            .files()
            .flags(symbol)
            .intersects(SymFlags::TYPE_ALIAS | SymFlags::CLASS | SymFlags::INTERFACE);
        can_be_instantiated.then(|| self.type_reference(symbol, &[]))
    }

    /// `getNameFromJsxElementAttributesContainer`
    fn jsx_name_from_container(&mut self, file: FileId, container: Atom) -> JsxName {
        let Some(symbol) = self.jsx_symbol(file, container) else {
            return JsxName::Missing;
        };
        let ty = self.declared_type(symbol);
        match self.members(ty) {
            Some(members) => match &members.shape().props[..] {
                [] => JsxName::Empty,
                [only] => JsxName::Name(only.name),
                _ => {
                    if let Some(at) = self.place_of_symbol(symbol) {
                        self.error_at(at, 2608, &[Arg::Atom(container)]);
                    }
                    JsxName::Missing
                }
            },
            None => JsxName::Missing,
        }
    }

    /// `getJsxElementChildrenPropertyName`
    pub(super) fn jsx_children_property_name(&mut self, file: FileId) -> JsxName {
        if matches!(
            self.p.files.options.jsx,
            JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) {
            return JsxName::Name(known::children);
        }
        self.jsx_name_from_container(file, known::ElementChildrenAttribute)
    }

    /// `isJsxIntrinsicTagName`, and the name used to look up the element.
    pub(super) fn jsx_intrinsic_tag_name(&self, file: FileId, tag: ExprId) -> Option<Atom> {
        match self.hir(file)[tag].kind {
            ExprKind::String(name) => Some(name),
            ExprKind::Ident(name)
                if crate::hir::is_intrinsic_jsx_name(self.atoms().bytes(name)) =>
            {
                Some(name)
            }
            _ => None,
        }
    }

    /// `getJsxReferenceKind`
    pub(super) fn jsx_reference_kind(&mut self, file: FileId, tag: ExprId) -> JsxReferenceKind {
        if self.jsx_intrinsic_tag_name(file, tag).is_some() {
            return JsxReferenceKind::Mixed;
        }
        let tag_type = self.type_of_expr(file, tag);
        let tag_type = self.apparent_type(tag_type);
        if !self.signatures(tag_type, true).is_empty() {
            JsxReferenceKind::Component
        } else if !self.signatures(tag_type, false).is_empty() {
            JsxReferenceKind::Function
        } else {
            JsxReferenceKind::Mixed
        }
    }

    /// `getUninstantiatedJsxSignaturesOfType`. `None`: unresolved.
    pub(super) fn uninstantiated_jsx_signatures_of_type(
        &mut self,
        file: FileId,
        element_type: TypeId,
        caller: ExprId,
    ) -> Option<Vec<SigId>> {
        // `anySignature`
        if element_type == TypeId::STRING {
            let has_no_parameters = self.types().intern_sig(SigData::Synth {
                type_params: ArenaBox::empty(),
                params: ArenaBox::empty(),
                ret: TypeId::ANY,
                this: None,
                of: ArenaBox::empty(),
                is_union: true,
            });
            return Some(vec![has_no_parameters]);
        }
        if let Some(name) = self.string_literal_value(element_type) {
            let attributes = match self.jsx_attributes_of_literal_tag(file, name) {
                Ok(Some(attributes)) => attributes,
                Ok(None) => {
                    let hir = self.hir(file);
                    let ExprKind::Jsx(j) = hir[caller].kind else {
                        return None;
                    };
                    let at = (file, hir[caller].pos, hir[j].opening_end);
                    let container = Arg::Bytes(b"JSX.IntrinsicElements");
                    self.error_at(at, 2339, &[Arg::Atom(name), container]);
                    return Some(Vec::new());
                }
                Err(()) => TypeId::ANY,
            };
            return Some(vec![self.jsx_intrinsic_signature(file, attributes)]);
        }
        let apparent = self.apparent_type(element_type);
        // "Resolve the signatures, preferring constructor"
        let mut signatures = self.signatures(apparent, true);
        if signatures.is_empty() {
            signatures = self.signatures(apparent, false);
        }
        if !signatures.is_empty() || !self.is_union(apparent) {
            return Some(signatures.into_vec());
        }
        let parts = self.parts(apparent);
        let mut lists = Vec::with_capacity(parts.len());
        for &part in parts {
            lists.push(self.uninstantiated_jsx_signatures_of_type(file, part, caller)?);
        }
        // `getUnionSignatures`: none if any member has none.
        if lists.iter().any(Vec::is_empty) {
            return Some(Vec::new());
        }
        Some(self.union_signatures(&lists))
    }

    /// `createSignatureForJSXIntrinsic`: `(props: attributes) => JSX.Element`, the signature that a
    /// tag that is not a component resolves to.
    pub(super) fn jsx_intrinsic_signature(&mut self, file: FileId, attributes: TypeId) -> SigId {
        let ret = self.jsx_element_type(file);
        let params = [SigParam {
            name: known::props,
            ty: attributes,
            optional: false,
            is_required_rest: false,
            rest: false,
            has_declaration: false,
        }];
        self.types().intern_sig(SigData::Synth {
            type_params: ArenaBox::empty(),
            params: self.list(&params),
            ret,
            this: None,
            of: ArenaBox::empty(),
            is_union: true,
        })
    }

    /// `getOrCreateTypeFromSignature` of that.
    fn jsx_intrinsic_function_type(&mut self, file: FileId, attributes: TypeId) -> TypeId {
        let sig = self.jsx_intrinsic_signature(file, attributes);
        self.type_of_signature(sig, false)
    }

    /// `getIntrinsicAttributesTypeFromJsxOpeningLikeElement`: the type `JSX.IntrinsicElements`
    /// declares for the tag `name`.
    pub(super) fn jsx_intrinsic_attributes(&mut self, file: FileId, name: Atom) -> Option<TypeId> {
        let elements = self.jsx_type(file, known::IntrinsicElements)?;
        // The type from an index signature is used as is, regardless of noUncheckedIndexedAccess.
        if self.prop_ref(elements, name).is_none()
            && let Some(members) = self.members(elements)
            && let Some(value) = self
                .applicable_index_info_for_name(&members, name)
                .map(|info| info.value)
        {
            return Some(value);
        }
        self.type_of_property(elements, name)
    }

    /// `TypeFlagsStringLiteral`: the value of a string literal type, including that of an enum
    /// member.
    pub(super) fn string_literal_value(&self, ty: TypeId) -> Option<Atom> {
        match *self.data(ty) {
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => Some(value),
            _ => None,
        }
    }

    /// `getIntrinsicAttributesTypeFromStringLiteralType`: the attributes accepted by a tag that is
    /// a value whose type is the string literal `name`.
    /// `Ok(None)`: `JSX.IntrinsicElements` has no entry for it. `Err`: that interface does not
    /// exist, or is unresolved: anything is accepted.
    pub(super) fn jsx_attributes_of_literal_tag(
        &mut self,
        file: FileId,
        name: Atom,
    ) -> Result<Option<TypeId>, ()> {
        let Some(elements) = self.jsx_type(file, known::IntrinsicElements) else {
            return Err(());
        };
        // `getPropertyOfType`: properties that every object has count.
        let object = self.global_ref(known::Object, &[]);
        for holder in [elements, object] {
            if let Some((prop, mapper)) = self.prop_ref(holder, name) {
                return Ok(Some(self.type_of_prop(prop, mapper)));
            }
        }
        // Otherwise, the string index signature and no other.
        let Some(members) = self.members(elements) else {
            return Err(());
        };
        Ok(self
            .applicable_index_info(&members, TypeId::STRING)
            .map(|info| info.value))
    }

    /// `getJSXFragmentType`: the type of the component that the fragment `e` is created with.
    /// `None`: any type, or it is not found.
    pub(super) fn jsx_fragment_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, files) = (self.hir(file), self.files());
        let (options, atoms) = (&files.options, self.atoms());
        let name = super::errors_jsx::jsx_namespace(files, atoms, hir, true);
        if options.jsx != JsxEmit::React && options.jsx_fragment_factory.is_empty()
            || atoms.bytes(name) == b"null"
        {
            return None;
        }
        let fragment = atoms.intern(b"Fragment");
        // `getJsxNamespaceContainerForImplicitImport`, or else the name as it is in scope.
        let runtime = files
            .jsx_runtime(file)
            .and_then(|spec| files.module_of_specifier(file, spec));
        let member = match runtime {
            Some(module) => files.module_export(module, fragment)?,
            None => {
                let meaning = if matches!(options.jsx, JsxEmit::Preserve | JsxEmit::ReactNative) {
                    SymFlags::VALUE.difference(SymFlags::ENUM)
                } else {
                    SymFlags::VALUE
                };
                let scope = self.bound(file).expr_scope.get(&e).copied();
                let scope = scope.unwrap_or(crate::bind::ScopeId(0));
                let found = files.resolve_name(file, scope, name, meaning)?;
                if name == fragment {
                    let found = files.resolve_alias_if_needed(found)?;
                    return Some(self.type_of_symbol(found));
                }
                let container = files.resolve_alias_if_needed(found)?;
                files.namespace_member(container, fragment)?
            }
        };
        if !files.means(member, SymFlags::BLOCK_SCOPED_VARIABLE) {
            return None;
        }
        let member = files.resolve_alias_if_needed(member)?;
        Some(self.type_of_symbol(member))
    }

    /// `getJsxManagedAttributesFromLocatedAttributes`: `JSX.LibraryManagedAttributes<typeof Component, Props>`
    fn jsx_managed_attributes(&mut self, file: FileId, e: ExprId, attributes: TypeId) -> TypeId {
        let Some(managed) = self.jsx_symbol(file, known::LibraryManagedAttributes) else {
            return attributes;
        };
        if self.type_params_of_symbol(managed).len() < 2 {
            return attributes;
        }
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return attributes;
        };
        let tag = hir[j].tag;
        // `getStaticTypeOfReferencedJsxConstructor`
        if tag.is_none() {
            return match self.jsx_fragment_type(file, e) {
                Some(fragment) => self.type_reference(managed, &[fragment, attributes]),
                None => attributes,
            };
        }
        let constructor = match self.jsx_intrinsic_tag_name(file, tag) {
            Some(name) => match self.jsx_intrinsic_attributes(file, name) {
                Some(intrinsic) => self.jsx_intrinsic_function_type(file, intrinsic),
                None => return attributes,
            },
            None => {
                let tag_type = self.type_of_expr(file, tag);
                match self.string_literal_value(tag_type) {
                    Some(name) => match self.jsx_attributes_of_literal_tag(file, name) {
                        Ok(Some(intrinsic)) => self.jsx_intrinsic_function_type(file, intrinsic),
                        Ok(None) => TypeId::UNRESOLVED,
                        Err(()) => self.jsx_intrinsic_function_type(file, TypeId::ANY),
                    },
                    None => tag_type,
                }
            }
        };
        self.type_reference(managed, &[constructor, attributes])
    }

    /// `getJsxPropsTypeFromCallSignature` for a signature whose first parameter is `props`.
    pub(super) fn jsx_props_from_first_parameter(
        &mut self,
        file: FileId,
        e: ExprId,
        props: TypeId,
    ) -> TypeId {
        let props = self.jsx_managed_attributes(file, e, props);
        match self.jsx_type(file, known::IntrinsicAttributes) {
            Some(intrinsic) => self.intersection(&[intrinsic, props]),
            None => props,
        }
    }

    /// `getJsxPropsTypeForSignatureFromMember`: the property `name` of the instance type of `sig`.
    /// `None`: it has none.
    fn jsx_props_from_member(&mut self, sig: SigId, name: Atom) -> Option<TypeId> {
        // For a signature that represents those of the members of a union, the instance type of
        // each of them is considered.
        let alone = [sig];
        let parts: &[SigId] = match self.types().sig(sig) {
            SigData::Synth { of, .. } if !of.is_empty() => &of[..],
            _ => &alone[..],
        };
        let mut results = Vec::with_capacity(parts.len());
        for &part in parts {
            let instance = self.sig_return(part);
            if self.is_any(instance) {
                return Some(instance);
            }
            // `getTypeOfPropertyOfType`: an index signature is not a property.
            let apparent = self.apparent_type(instance);
            if !self.is_union(apparent) && self.prop_ref(apparent, name).is_none() {
                return None;
            }
            results.push(self.type_of_property(instance, name)?);
        }
        match results[..] {
            [only] => Some(only),
            _ => Some(self.intersection(&results)),
        }
    }

    /// `getEffectiveFirstArgumentForJsxSignature`
    pub(super) fn jsx_effective_first_argument(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
    ) -> TypeId {
        // `getTypeOfFirstParameterOfSignatureWithFallback`: for a rest parameter, its first element
        // type.
        let first_parameter = |c: &mut Self| {
            let params = c.sig_params(sig);
            c.param_type_at(&params, 0).unwrap_or(TypeId::UNKNOWN)
        };
        let tag = match self.hir(file)[e].kind {
            ExprKind::Jsx(j) => self.hir(file)[j].tag,
            _ => ExprId::NONE,
        };
        if tag.is_none() || self.jsx_reference_kind(file, tag) != JsxReferenceKind::Component {
            let props = first_parameter(self);
            return self.jsx_props_from_first_parameter(file, e, props);
        }
        // `getJsxPropsTypeFromClassType`
        let attributes = match self.jsx_name_from_container(file, known::ElementAttributesProperty)
        {
            JsxName::Missing => first_parameter(self),
            JsxName::Empty => self.sig_return(sig),
            JsxName::Name(name) => match self.jsx_props_from_member(sig, name) {
                Some(props) => props,
                None => {
                    let hir = self.hir(file);
                    if let ExprKind::Jsx(j) = hir[e].kind
                        && !hir[j].attrs.is_empty()
                    {
                        let at = (file, hir[e].pos, hir[j].opening_end);
                        self.error_at(at, 2607, &[Arg::Atom(name)]);
                    }
                    return TypeId::UNKNOWN;
                }
            },
        };
        let attributes = self.jsx_managed_attributes(file, e, attributes);
        if self.is_any(attributes) {
            return attributes;
        }
        let mut parts = Vec::with_capacity(3);
        parts.extend(self.jsx_type(file, known::IntrinsicAttributes));
        if let Some(of_class) = self.jsx_symbol(file, known::IntrinsicClassAttributes) {
            // The type parameters are those of the symbol of the type: those of the aliased type,
            // and an alias's own stay uninstantiated.
            let declared = self.declared_type(of_class);
            let of_instance = match *self.data(declared) {
                TypeData::Ref { target, .. } => {
                    let params = self.type_params_of_symbol(target);
                    if params.is_empty() {
                        declared
                    } else {
                        let instance = self.sig_return(sig);
                        let args = self.fill_type_args(&params, &[instance]);
                        let mapper = self.mapper_from(&params, &args);
                        self.instantiate(declared, mapper)
                    }
                }
                _ => declared,
            };
            parts.push(of_instance);
        }
        parts.push(attributes);
        // `intersectTypes`
        match parts[..] {
            [only] => only,
            _ => self.intersection(&parts),
        }
    }

    /// `checkJsxChildren`: the children that count, and the type of each.
    pub(super) fn jsx_child_types(&mut self, file: FileId, e: ExprId) -> Vec<(ExprId, TypeId)> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return Vec::new();
        };
        let mut types = Vec::new();
        for child in hir.ids(hir[j].children) {
            match hir[child].kind {
                // `{}` is nothing.
                ExprKind::Missing => {}
                // Text is `string`, and so is a string literal in braces once it is widened.
                ExprKind::String(_) => types.push((child, TypeId::STRING)),
                _ => {
                    // `checkExpressionForMutableLocation` gets the `JsxExpression`, and `getContextualType` has no case for a child of
                    // an element. A fresh literal type is widened even if the children property expects a literal.
                    let ty = self.type_of_expr(file, child);
                    types.push((child, self.widen_literal_for_context(ty, None)));
                }
            }
        }
        types
    }

    /// `isTupleLikeType`
    pub(super) fn is_tuple_like(&mut self, ty: TypeId) -> bool {
        if self.is_tuple(ty) {
            return true;
        }
        let zero = self.atoms().intern(b"0");
        if self.get_property_of_type(ty, zero).is_some() {
            return true;
        }
        self.is_array_like(ty)
            && self
                .type_of_property(ty, known::length)
                .is_some_and(|length| {
                    self.every_type(length, |c, m| {
                        matches!(c.data(m), TypeData::NumberLit { .. })
                    })
                })
    }

    /// `createJsxAttributesTypeFromAttributesProperty`: the attributes and the children of `e` as one object.
    pub(super) fn jsx_attributes_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return TypeId::UNRESOLVED;
        };
        let jsx = &hir[j];
        let children_property_name = self.jsx_children_property_name(file);
        // `emptyJsxObjectType`, onto which everything is spread.
        let empty = self.synth(Shape {
            literal: Literalness::JsxAttributes,
            ..Shape::new_in(self.arena)
        });
        let has_spread = jsx.attrs.iter().any(|p| hir[p].kind == PropKind::Spread);
        // Next to a spread, the explicit attributes still count as declared here
        // (`shouldCheckAsExcessProperty`), as in an object literal.
        let run = if has_spread {
            Literalness::Written
        } else {
            Literalness::JsxAttributes
        };
        let mut spread: Option<TypeId> = None;
        // `typeToIntersect`: the types that cannot be spread.
        let mut not_spread: Vec<TypeId> = Vec::new();
        let mut pending = Shape {
            literal: run,
            ..Shape::new_in(self.arena)
        };
        let flush = |c: &mut Self, spread: &mut Option<TypeId>, pending: &mut Shape<'s>| {
            if pending.props.is_empty() {
                return;
            }
            let segment = c.synth(std::mem::replace(
                pending,
                Shape {
                    literal: run,
                    ..Shape::new_in(c.arena)
                },
            ));
            *spread = Some(if has_spread {
                c.spread((*spread).unwrap_or(empty), segment)
            } else {
                segment
            });
        };
        for p in jsx.attrs.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                flush(self, &mut spread, &mut pending);
                let ty = self.type_of_expr(file, prop.value);
                let ty = self.reduced(ty);
                if self.is_any(ty) {
                    return ty;
                }
                if self.is_valid_spread_type(ty) {
                    spread = Some(self.spread(spread.unwrap_or(empty), ty));
                    // `checkSpreadPropOverrides`: `getPropertiesOfType` creates the properties of a
                    // union, which resolves the type that each member has for them.
                    if self.p.files.options.strict_null_checks {
                        self.reduced_apparent_type_as_object(ty);
                    }
                } else {
                    not_spread.push(ty);
                }
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let (source, flags) = self.source_of_literal_member(file, p, name);
            let attribute = Prop {
                name,
                flags,
                source,
                mapper: MapperId::IDENTITY,
            };
            // Attributes of one name are declarations of one symbol, and `compareSymbols` orders
            // by the first declaration.
            match pending.props.iter_mut().find(|x| x.name == name) {
                Some(earlier) => *earlier = attribute,
                None => pending.props.push(attribute),
            }
        }
        let children = self.jsx_child_types(file, e);
        if !children.is_empty()
            && let JsxName::Name(name) = children_property_name
        {
            let ty = if let [(_, only)] = children[..] {
                only
            } else {
                let types: Vec<TypeId> = children.iter().map(|c| c.1).collect();
                // `getApparentTypeOfContextualType`: the attributes narrow a union of props types first.
                let expected = self
                    .apparent_type_of_contextual_type_of_jsx_attributes(
                        file,
                        e,
                        ContextFlags::empty(),
                    )
                    .and_then(|props| self.contextual_property(props, name));
                let mut is_tuple_expected = false;
                if let Some(expected) = expected {
                    for &m in self.parts(expected) {
                        is_tuple_expected = is_tuple_expected || self.is_tuple_like(m);
                    }
                }
                if is_tuple_expected {
                    let flags = vec![ElemFlags::REQUIRED; types.len()];
                    self.tuple(&types, &flags, false)
                } else {
                    let element = self.union(&types);
                    self.array_of(element)
                }
            };
            // The synthesized declaration of the children has the attributes as its parent, so
            // `shouldCheckAsExcessProperty` accepts it. The check only runs on a fresh type, and
            // only `createJsxAttributesType` sets `ObjectFlagsFreshLiteral`: it needs an explicit
            // attribute.
            let has_source_attribute = jsx.attrs.iter().any(|p| hir[p].kind != PropKind::Spread);
            let flags = if has_source_attribute {
                PropFlags::JSX_CHILDREN
            } else {
                PropFlags::empty()
            };
            pending.props.retain(|x| x.name != name);
            pending.props.push(Prop {
                name,
                flags,
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        flush(self, &mut spread, &mut pending);
        // `getSpreadType(.., objectFlags, ..)`: the result of a spread is still the attributes type
        // of an element.
        let attributes = match spread {
            Some(ty) if has_spread => self.map_type(ty, |c, m| c.as_jsx_attributes(m)),
            Some(ty) => ty,
            None => empty,
        };
        if not_spread.is_empty() {
            return attributes;
        }
        if attributes != empty {
            not_spread.push(attributes);
        }
        self.intersection(&not_spread)
    }

    /// `ty`, the result of a spread into the attributes of an element, marked as JSX attributes.
    fn as_jsx_attributes(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Synth(shape)
                if matches!(
                    shape.literal,
                    Literalness::WithSpread | Literalness::Written
                ) =>
            {
                self.synth(Shape {
                    literal: Literalness::JsxAttributes,
                    ..(**shape).clone_in(self.arena)
                })
            }
            // A generic type is not spread but intersected with the rest.
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.as_jsx_attributes(part))
                    .collect();
                self.intersection(&parts)
            }
            _ => ty,
        }
    }
}
