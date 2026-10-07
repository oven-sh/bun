//! The attributes a JSX element passes to its component, and the props the component accepts.
//!
//! Follows `getEffectiveFirstArgumentForJsxSignature`, `getJsxPropsTypeFromCallSignature`,
//! `getJsxPropsTypeFromClassType`, `getJsxManagedAttributesFromLocatedAttributes`,
//! `instantiateAliasOrInterfaceWithDefaults`, `getStaticTypeOfReferencedJsxConstructor`,
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
    /// `getDeclaredTypeOfSymbol` for a member of the `JSX` namespace, which may be an alias
    /// (`getDeclaredTypeOfAlias`).
    fn declared_type_of_jsx_symbol(&mut self, symbol: Sym) -> TypeId {
        match self.files().resolve_alias_if_needed(symbol) {
            Some(target) => self.declared_type(target),
            None => TypeId::ERROR,
        }
    }

    /// The `JsxOpeningElement`, `JsxSelfClosingElement` or `JsxOpeningFragment` of the element or
    /// fragment `e`.
    pub(super) fn jsx_opening_like(&self, file: FileId, e: ExprId) -> Node {
        let hir = self.hir(file);
        let node = hir.node(e);
        match hir.kind(node) {
            Kind::JsxSelfClosingElement => node,
            _ => node.with(Part::Opening),
        }
    }

    /// `getJsxType`. `None`: the error type.
    pub(super) fn jsx_type(&mut self, file: FileId, location: Node, name: Atom) -> Option<TypeId> {
        let namespace = self.jsx_namespace_at(file, location)?;
        let type_symbol = self.files().namespace_member(namespace, name)?;
        if !self.files().means(type_symbol, SymFlags::TYPE) {
            return None;
        }
        let ty = self.declared_type_of_jsx_symbol(type_symbol);
        (!self.is_error_type(ty)).then_some(ty)
    }

    /// `getSymbol(jsxNamespace.Exports, name, SymbolFlagsType)`: `getJsxLibraryManagedAttributes`,
    /// `getJsxElementTypeSymbol` and the start of `getNameFromJsxElementAttributesContainer`. That
    /// table lacks what arrives through `export *`, and an alias found in it stays an alias.
    fn jsx_symbol(&mut self, file: FileId, location: Node, name: Atom) -> Option<Sym> {
        let jsx_namespace = self.jsx_namespace_at(file, location)?;
        let symbol = self.files().export(jsx_namespace, name)?;
        let is_type = self.files().means(symbol, SymFlags::TYPE);
        is_type.then_some(symbol)
    }

    /// `instantiateAliasOrInterfaceWithDefaults`
    fn instantiate_alias_or_interface_with_defaults(
        &mut self,
        managed_sym: Sym,
        type_arguments: &[TypeId],
        in_javascript: bool,
    ) -> Option<TypeId> {
        if self
            .files()
            .flags(managed_sym)
            .contains(SymFlags::TYPE_ALIAS)
        {
            let params = self.local_type_params_of_symbol(managed_sym);
            if params.len() >= type_arguments.len() {
                let args = self.fill_type_args_as(&params, type_arguments, in_javascript);
                return Some(self.type_reference(managed_sym, &args));
            }
        }
        // `ObjectFlagsClassOrInterface`: the declared type of a class or an interface, and no other
        // reference to it.
        let declared_managed_type = self.declared_type_of_jsx_symbol(managed_sym);
        let TypeData::Ref { target, .. } = *self.data(declared_managed_type) else {
            return None;
        };
        if self.declared_type(target) != declared_managed_type {
            return None;
        }
        let params = self.local_type_params_of_symbol(target);
        if params.len() < type_arguments.len() {
            return None;
        }
        let args = self.fill_type_args_as(&params, type_arguments, in_javascript);
        Some(self.type_reference(target, &args))
    }

    /// `getJsxElementTypeTypeAt`: `JSX.ElementType`, with its type parameters instantiated to their
    /// defaults.
    pub(super) fn jsx_element_type_constraint(
        &mut self,
        file: FileId,
        location: Node,
    ) -> Option<TypeId> {
        let sym = self.jsx_symbol(file, location, known::ElementType)?;
        let in_javascript = self.hir(file).is_js;
        let t = self.instantiate_alias_or_interface_with_defaults(sym, &[], in_javascript)?;
        (!self.is_error_type(t)).then_some(t)
    }

    /// `getNameFromJsxElementAttributesContainer`
    fn jsx_name_from_container(
        &mut self,
        file: FileId,
        location: Node,
        container: Atom,
    ) -> JsxName {
        let Some(symbol) = self.jsx_symbol(file, location, container) else {
            return JsxName::Missing;
        };
        let ty = self.declared_type_of_jsx_symbol(symbol);
        match self.properties_of_type(ty) {
            [] => JsxName::Empty,
            [only] => JsxName::Name(only.name),
            _ => {
                if let Some(at) = self.place_of_symbol(symbol) {
                    self.error_at(at, 2608, &[Arg::Atom(container)]);
                }
                JsxName::Missing
            }
        }
    }

    /// `getJsxElementChildrenPropertyName`
    pub(super) fn jsx_children_property_name(&mut self, file: FileId, location: Node) -> JsxName {
        if matches!(
            self.p.files.options.jsx,
            JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) {
            return JsxName::Name(known::children);
        }
        self.jsx_name_from_container(file, location, known::ElementChildrenAttribute)
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
        if element_type == TypeId::STRING {
            return Some(vec![self.any_signature()]);
        }
        if let Some(name) = self.string_literal_value(element_type) {
            let location = self.jsx_opening_like(file, caller);
            let Some(intrinsic_type) = self.jsx_attributes_of_literal_tag(file, location, name)
            else {
                let hir = self.hir(file);
                let ExprKind::Jsx(j) = hir[caller].kind else {
                    return None;
                };
                let at = (file, hir[caller].pos, hir[j].opening_end);
                let container = Arg::Bytes(b"JSX.IntrinsicElements");
                self.error_at(at, 2339, &[Arg::Atom(name), container]);
                return Some(Vec::new());
            };
            return Some(vec![self.jsx_intrinsic_signature(
                file,
                location,
                intrinsic_type,
            )]);
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

    /// `anySignature`
    pub(super) fn any_signature(&self) -> SigId {
        self.types().intern_sig(SigData::Synth {
            type_params: ArenaBox::empty(),
            params: ArenaBox::empty(),
            ret: TypeId::ANY,
            this: None,
            of: ArenaBox::empty(),
            is_union: true,
        })
    }

    /// `createSignatureForJSXIntrinsic`: `(props: attributes) => JSX.Element`, the signature that a
    /// tag that is not a component resolves to.
    pub(super) fn jsx_intrinsic_signature(
        &mut self,
        file: FileId,
        location: Node,
        attributes: TypeId,
    ) -> SigId {
        let ret = self.jsx_element_type(file, location);
        let params = [SigParam {
            name: known::props,
            ty: attributes,
            optional: false,
            is_required_rest: false,
            rest: false,
            declaration: None,
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

    /// `getOrCreateTypeFromSignature` of that. It has no declaration, which makes `isConstructor`
    /// true.
    fn jsx_intrinsic_function_type(
        &mut self,
        file: FileId,
        location: Node,
        attributes: TypeId,
    ) -> TypeId {
        let sig = self.jsx_intrinsic_signature(file, location, attributes);
        self.type_of_signature(sig, true)
    }

    /// `getIntrinsicAttributesTypeFromJsxOpeningLikeElement`: the type `JSX.IntrinsicElements`
    /// declares for the tag `name`.
    pub(super) fn jsx_intrinsic_attributes(
        &mut self,
        file: FileId,
        location: Node,
        name: Atom,
    ) -> Option<TypeId> {
        let intrinsic_elements_type = self.jsx_type(file, location, known::IntrinsicElements)?;
        self.type_of_intrinsic_tag_symbol(intrinsic_elements_type, name)
    }

    /// `getIntrinsicTagSymbol`, and the type that
    /// `getIntrinsicAttributesTypeFromJsxOpeningLikeElement` takes from what it finds.
    /// `None`: `unknownSymbol`.
    pub(super) fn type_of_intrinsic_tag_symbol(
        &mut self,
        intrinsic_elements_type: TypeId,
        prop_name: Atom,
    ) -> Option<TypeId> {
        // `JsxFlagsIntrinsicNamedElement`
        if let Some((intrinsic_prop, mapper)) =
            self.get_property_of_type(intrinsic_elements_type, prop_name)
        {
            return Some(self.type_of_prop(intrinsic_prop, mapper));
        }
        // `JsxFlagsIntrinsicIndexedElement`
        let members = self.members_for_index_infos(intrinsic_elements_type)?;
        let index_info = self.applicable_index_info_for_name(&members, prop_name)?;
        Some(index_info.value)
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
    /// `None`: `JSX.IntrinsicElements` has no entry for it.
    fn jsx_attributes_of_literal_tag(
        &mut self,
        file: FileId,
        location: Node,
        name: Atom,
    ) -> Option<TypeId> {
        let Some(intrinsic_elements_type) = self.jsx_type(file, location, known::IntrinsicElements)
        else {
            return Some(TypeId::ANY);
        };
        if let Some((intrinsic_prop, mapper)) =
            self.get_property_of_type(intrinsic_elements_type, name)
        {
            return Some(self.type_of_prop(intrinsic_prop, mapper));
        }
        self.index_type_of_type(intrinsic_elements_type, TypeId::STRING)
    }

    /// `getJSXFragmentType`: the type of the component that the fragments of `file` are created
    /// with. The names are resolved from `e`, the fragment that asks first.
    pub(super) fn jsx_fragment_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        if let Some(known) = (self.p.jsx_fragment_types).get(&self.task, &file) {
            return known;
        }
        let resolved = self.resolve_jsx_fragment_type(file, e);
        let ty = resolved.unwrap_or(TypeId::ERROR);
        (self.p.jsx_fragment_types).rewrite(&self.task, file, ty, Stored::new());
        ty
    }

    /// `None`: `errorType`.
    fn resolve_jsx_fragment_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, files) = (self.hir(file), self.files());
        let (options, atoms) = (&files.options, self.atoms());
        let name = super::errors_jsx::jsx_namespace(files, atoms, hir, true);
        if options.jsx != JsxEmit::React && options.jsx_fragment_factory.is_empty()
            || atoms.bytes(name) == b"null"
        {
            return Some(TypeId::ANY);
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
        let context = self.jsx_opening_like(file, e);
        let Some(managed_sym) = self.jsx_symbol(file, context, known::LibraryManagedAttributes)
        else {
            return attributes;
        };
        let ctor_type = self.static_type_of_referenced_jsx_constructor(file, e);
        let (type_arguments, in_javascript) = ([ctor_type, attributes], self.hir(file).is_js);
        self.instantiate_alias_or_interface_with_defaults(
            managed_sym,
            &type_arguments,
            in_javascript,
        )
        .unwrap_or(attributes)
    }

    /// `getStaticTypeOfReferencedJsxConstructor`
    fn static_type_of_referenced_jsx_constructor(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        let tag = match hir[e].kind {
            ExprKind::Jsx(j) => hir[j].tag,
            _ => ExprId::NONE,
        };
        if tag.is_none() {
            return self.jsx_fragment_type(file, e);
        }
        let context = self.jsx_opening_like(file, e);
        if let Some(name) = self.jsx_intrinsic_tag_name(file, tag) {
            let result = self.jsx_intrinsic_attributes(file, context, name);
            let result = result.unwrap_or(TypeId::ERROR);
            return self.jsx_intrinsic_function_type(file, context, result);
        }
        let tag_type = self.type_of_expr(file, tag);
        let Some(name) = self.string_literal_value(tag_type) else {
            return tag_type;
        };
        match self.jsx_attributes_of_literal_tag(file, context, name) {
            Some(result) => self.jsx_intrinsic_function_type(file, context, result),
            None => TypeId::ERROR,
        }
    }

    /// `getJsxPropsTypeFromCallSignature` for a signature whose first parameter is `props`.
    pub(super) fn jsx_props_from_first_parameter(
        &mut self,
        file: FileId,
        e: ExprId,
        props: TypeId,
    ) -> TypeId {
        let props = self.jsx_managed_attributes(file, e, props);
        let context = self.jsx_opening_like(file, e);
        match self.jsx_type(file, context, known::IntrinsicAttributes) {
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
        let tag = match self.hir(file)[e].kind {
            ExprKind::Jsx(j) => self.hir(file)[j].tag,
            _ => ExprId::NONE,
        };
        if tag.is_none() || self.jsx_reference_kind(file, tag) != JsxReferenceKind::Component {
            let props = self.type_of_first_parameter_with_fallback(sig, TypeId::UNKNOWN);
            return self.jsx_props_from_first_parameter(file, e, props);
        }
        // `getJsxPropsTypeFromClassType`
        let context = self.jsx_opening_like(file, e);
        let forced_lookup_location =
            self.jsx_name_from_container(file, context, known::ElementAttributesProperty);
        let attributes = match forced_lookup_location {
            JsxName::Missing => self.type_of_first_parameter_with_fallback(sig, TypeId::UNKNOWN),
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
        parts.extend(self.jsx_type(file, context, known::IntrinsicAttributes));
        if let Some(declared) = self.jsx_type(file, context, known::IntrinsicClassAttributes) {
            // The type parameters are those of the symbol of the type: those of the aliased type,
            // and an alias's own stay uninstantiated.
            let of_instance = match *self.data(declared) {
                TypeData::Ref { target, .. } => {
                    let params = self.type_params_of_symbol(target);
                    if params.is_empty() {
                        declared
                    } else {
                        let instance = self.sig_return(sig);
                        let in_javascript = self.hir(file).is_js;
                        let args = self.fill_type_args_as(&params, &[instance], in_javascript);
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
                .type_of_property_of_type(ty, known::length)
                .is_some_and(|length_type| {
                    self.every_type(length_type, |c, t| c.flags(t) & tf::NUMBER_LITERAL != 0)
                })
    }

    /// `createJsxAttributesTypeFromAttributesProperty`: the attributes and the children of `e` as one object.
    pub(super) fn jsx_attributes_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return TypeId::UNRESOLVED;
        };
        let jsx = &hir[j];
        let opening_like_element = self.jsx_opening_like(file, e);
        let children_property_name = self.jsx_children_property_name(file, opening_like_element);
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
        let mut has_spread_any_type = false;
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
                    has_spread_any_type = true;
                    continue;
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
        if has_spread_any_type {
            return TypeId::ANY;
        }
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
