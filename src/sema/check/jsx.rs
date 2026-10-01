//! What a JSX element passes to its component, and what the component takes.
//!
//! Follows `getEffectiveFirstArgumentForJsxSignature`, `getJsxPropsTypeFromCallSignature`, `getJsxPropsTypeFromClassType`,
//! `getJsxManagedAttributesFromLocatedAttributes`, `getNameFromJsxElementAttributesContainer`,
//! `getUninstantiatedJsxSignaturesOfType`, `getIntrinsicAttributesTypeFromStringLiteralType` and
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

impl<'p> Checker<'p> {
    fn jsx_symbol(&mut self, file: FileId, name: Atom) -> Option<Sym> {
        let ns = self.jsx_namespace(file)?;
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

    /// `getJsxElementTypeTypeAt`: `JSX.ElementType`, its type parameters standing for their defaults.
    pub(super) fn jsx_element_type_constraint(&mut self, file: FileId) -> Option<TypeId> {
        let symbol = self.jsx_symbol(file, known::ElementType)?;
        // `instantiateAliasOrInterfaceWithDefaults`: it takes an alias, a class or an interface.
        let can_be_instantiated = self
            .files()
            .flags(symbol)
            .intersects(SymFlags::TYPE_ALIAS | SymFlags::CLASS | SymFlags::INTERFACE);
        can_be_instantiated.then(|| self.type_reference(symbol, &[]))
    }

    /// `getNameFromJsxElementAttributesContainer`
    fn jsx_name_from_container(&mut self, file: FileId, container: Atom) -> JsxName {
        let Some(ty) = self.jsx_type(file, container) else {
            return JsxName::Missing;
        };
        match self.members(ty) {
            Some(members) => match &members.shape().props[..] {
                [] => JsxName::Empty,
                [only] => JsxName::Name(only.name),
                _ => JsxName::Missing,
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

    /// `getUninstantiatedJsxSignaturesOfType`, and whether they are for `new`.
    pub(super) fn jsx_signatures(&mut self, component: TypeId) -> (List<'p, SigId>, bool) {
        let apparent = self.apparent_type(component);
        let construct = self.signatures(apparent, true);
        if !construct.is_empty() {
            return (construct, true);
        }
        (self.signatures(apparent, false), false)
    }

    /// `createSignatureForJSXIntrinsic`: `(props: attributes) => JSX.Element`, which is what a tag that is not a component comes to.
    fn jsx_intrinsic_function_type(&mut self, file: FileId, attributes: TypeId) -> TypeId {
        let ret = self.jsx_type(file, known::Element).unwrap_or(TypeId::ANY);
        let params = vec![SigParam {
            name: known::props,
            ty: attributes,
            optional: false,
            rest: false,
        }];
        let sig = self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this: None,
            of: Box::new([]),
        });
        self.synth(Shape {
            call: vec![sig],
            ..Shape::default()
        })
    }

    /// `getIntrinsicAttributesTypeFromJsxOpeningLikeElement`: what `JSX.IntrinsicElements` says of the tag `name`.
    pub(super) fn jsx_intrinsic_attributes(&mut self, file: FileId, name: Atom) -> Option<TypeId> {
        let elements = self.jsx_type(file, known::IntrinsicElements)?;
        // What an index signature gives is taken as it is, whatever noUncheckedIndexedAccess says.
        if self.prop_of(elements, name).is_none()
            && let Some(members) = self.members(elements)
            && let Some(value) = self.applicable_index_info(&members, TypeId::STRING, Some(name))
        {
            return Some(self.force(value));
        }
        self.type_of_property(elements, name)
    }

    /// `TypeFlagsStringLiteral`: what a string literal type says, that of a member of an enum too.
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

    /// `getIntrinsicAttributesTypeFromStringLiteralType`: what a tag takes that is a value whose type is the string literal `name`.
    /// `Ok(None)`: `JSX.IntrinsicElements` has nothing for it. `Err`: there is no such interface, or it is not known: anything goes.
    pub(super) fn jsx_attributes_of_literal_tag(
        &mut self,
        file: FileId,
        name: Atom,
    ) -> Result<Option<TypeId>, ()> {
        let Some(elements) = self.jsx_type(file, known::IntrinsicElements) else {
            return Err(());
        };
        if !self.is_known(elements) {
            return Err(());
        }
        // `getPropertyOfType`: what every object has counts.
        let object = self.global_ref(known::Object, &[]);
        for holder in [elements, object] {
            if let Some((prop, mapper)) = self.prop_of(holder, name) {
                return Ok(Some(self.type_of_prop(&prop, mapper)));
            }
        }
        // Failing that, the index signature for strings and no other.
        let Some(members) = self.members(elements) else {
            return Err(());
        };
        Ok(self.applicable_index_info(&members, TypeId::STRING, None))
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
        let constructor = match hir[tag].kind {
            ExprKind::String(name) => match self.jsx_intrinsic_attributes(file, name) {
                Some(intrinsic) => self.jsx_intrinsic_function_type(file, intrinsic),
                None => return attributes,
            },
            _ => {
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

    /// `getJsxPropsTypeFromCallSignature`, of a signature whose first parameter is `props`.
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

    /// `getJsxPropsTypeForSignatureFromMember`: the property `name` of what `sig` makes. `None`: it has none.
    fn jsx_props_from_member(&mut self, sig: SigId, name: Atom) -> Option<TypeId> {
        // Of a signature that stands for those of the members of a union, what each of them makes has to be given its due.
        let alone = [sig];
        let parts: &[SigId] = match self.p.types.sig(sig) {
            SigData::Synth { of, .. } if !of.is_empty() => &of[..],
            _ => &alone[..],
        };
        let mut results = Vec::with_capacity(parts.len());
        for &part in parts {
            let instance = self.sig_return(part);
            if self.is_any(instance) {
                return Some(instance);
            }
            // `getTypeOfPropertyOfType`: an index signature is no property.
            let apparent = self.apparent_type(instance);
            if !self.is_union(apparent) && self.prop_of(apparent, name).is_none() {
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
        construct: bool,
    ) -> TypeId {
        // `getTypeOfFirstParameterOfSignatureWithFallback`: of a rest parameter, what it holds first.
        let first_parameter = |c: &mut Self| {
            let params = c.sig_params(sig);
            c.param_type_at(&params, 0).unwrap_or(TypeId::UNKNOWN)
        };
        if !construct {
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
                None => return TypeId::UNKNOWN,
            },
        };
        let attributes = self.jsx_managed_attributes(file, e, attributes);
        if self.is_any(attributes) {
            return attributes;
        }
        let mut parts = Vec::with_capacity(3);
        parts.extend(self.jsx_type(file, known::IntrinsicAttributes));
        if let Some(of_class) = self.jsx_symbol(file, known::IntrinsicClassAttributes) {
            // The type parameters are those of the symbol of the type: of what an alias stands for, and an alias's own stay open.
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
        self.intersection(&parts)
    }

    /// `checkJsxChildren`: the children that count, and what each is.
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
        let (zero, apparent) = (self.number_name(0.0), self.apparent_type(ty));
        if self.prop_of(apparent, zero).is_some() {
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
        // `emptyJsxObjectType`, which is what everything is spread onto.
        let empty = self.synth(Shape {
            literal: Literalness::JsxAttributes,
            ..Shape::default()
        });
        let has_spread = jsx.attrs.iter().any(|p| hir[p].kind == PropKind::Spread);
        // Next to a spread, what is written goes on being what is written here (`shouldCheckAsExcessProperty`), as in an object literal.
        let run = if has_spread {
            Literalness::Written
        } else {
            Literalness::JsxAttributes
        };
        let mut spread: Option<TypeId> = None;
        // `typeToIntersect`: what cannot be spread.
        let mut not_spread: Vec<TypeId> = Vec::new();
        let mut pending = Shape {
            literal: run,
            ..Shape::default()
        };
        let flush = |c: &mut Self, spread: &mut Option<TypeId>, pending: &mut Shape| {
            if pending.props.is_empty() {
                return;
            }
            let segment = c.synth(std::mem::replace(
                pending,
                Shape {
                    literal: run,
                    ..Shape::default()
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
                } else {
                    not_spread.push(ty);
                }
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            pending.props.retain(|x| x.name != name);
            pending.props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Literal(file, p),
                mapper: MapperId::IDENTITY,
            });
        }
        let children = self.jsx_child_types(file, e);
        if !children.is_empty()
            && let JsxName::Name(name) = self.jsx_children_property_name(file)
        {
            let ty = if let [(_, only)] = children[..] {
                only
            } else {
                let types: Vec<TypeId> = children.iter().map(|c| c.1).collect();
                // `getApparentTypeOfContextualType`: the attributes narrow a union of props types first.
                let expected = self
                    .jsx_props_type(file, e)
                    .map(|props| self.discriminate_by_jsx_attributes(file, e, props))
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
            // The synthesized declaration of the children has the attributes as its parent, so `shouldCheckAsExcessProperty` accepts
            // it. The check only runs on a fresh type, and only `createJsxAttributesType` sets `ObjectFlagsFreshLiteral`: it needs a
            // written attribute.
            let has_written_attribute = jsx.attrs.iter().any(|p| hir[p].kind != PropKind::Spread);
            let flags = if has_written_attribute {
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
        // `getSpreadType(.., objectFlags, ..)`: what comes of spreading is still the attributes of an element.
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

    /// `ty`, which came of spreading into the attributes of an element, marked as the attributes of one.
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
                    ..(**shape).clone()
                })
            }
            // What is generic is not spread but stands next to the rest.
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
