//! `emitDecoratorMetadata`, from TypeScript 7: metadata.go, typeserializer.go, `markDecoratorAliasReferenced`.

use bun_collections::VecExt as _;

use crate::p::P;
use crate::parser::{Ref, TypeNameDeclaration};
use bun_ast::g::PropertyKind;
use bun_ast::ts::{
    CheckedTypeReference, Metadata, TypeReference, TypeReferenceKind, TypeReferenceName,
};
use bun_ast::{self as js_ast, E, Expr, ExprNodeList, Flags, G, Loc, StoreRef, StoreSlice};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

unsafe extern "Rust" {
    /// In `bun_sema_driver`. As a dependency, each change to the type checker would rebuild this crate and its users.
    safe fn __bun_check_decorator_metadata(
        text: &[u8],
        is_tsx: bool,
        strict_null_checks: bool,
    ) -> Vec<CheckedTypeReference>;
}

/// `GetAllAccessorDeclarations`
#[derive(Clone, Copy, Default)]
pub(crate) struct AccessorPair {
    getter: Option<StoreRef<E::Function>>,
    pub(crate) setter: Option<StoreRef<E::Function>>,
    /// The accessor is `firstAccessorWithDecorators`.
    pub(crate) is_first_with_decorators: bool,
}

/// The expression that `serializeTypeNode` returns.
#[derive(Clone, Copy)]
enum Serialized {
    /// `void 0`
    Undefined,
    /// `Object`, `String`, ...
    Global(&'static [u8]),
    /// `A.B`
    Name(StoreSlice<TypeReferenceName>),
    /// `A.B` if it's a function when the code runs, or else `Object`. `A` may not exist.
    NameIfFunction(StoreSlice<TypeReferenceName>),
}

const OBJECT: Serialized = Serialized::Global(b"Object");

#[derive(Clone, Copy, PartialEq, Eq)]
enum Constituents {
    Union,
    Intersection,
}

fn same_names(a: StoreSlice<TypeReferenceName>, b: StoreSlice<TypeReferenceName>) -> bool {
    let texts =
        |names: StoreSlice<TypeReferenceName>| names.slice().iter().map(|it| it.text.slice());
    texts(a).eq(texts(b))
}

impl Serialized {
    /// The text, if this is an identifier.
    fn identifier(self) -> Option<&'static [u8]> {
        match self {
            Serialized::Global(name) => Some(name),
            Serialized::Name(names) if names.len() == 1 => Some(names.slice()[0].text.slice()),
            _ => None,
        }
    }

    /// `equateSerializedTypeNodes`
    fn equals(self, other: Serialized) -> bool {
        match (self, other) {
            (Serialized::Undefined, Serialized::Undefined) => true,
            (Serialized::NameIfFunction(a), Serialized::NameIfFunction(b)) => same_names(a, b),
            (Serialized::Name(a), Serialized::Name(b)) => same_names(a, b),
            (a, b) => a.identifier().is_some() && a.identifier() == b.identifier(),
        }
    }
}

/// `GetPropertyNameForPropertyNameNode(a) == GetPropertyNameForPropertyNameNode(b)`, for names that aren't dynamic.
fn same_property_name(a: &Expr, b: &Expr) -> bool {
    use js_ast::ExprData::{ENumber, EString};
    match (&a.data, &b.data) {
        (EString(a), EString(b)) => a.eql_string(b),
        (ENumber(a), ENumber(b)) => a.value() == b.value(),
        (EString(text), ENumber(number)) | (ENumber(number), EString(text)) => {
            let mut buffer = [0u8; 124];
            text.eql_bytes(bun_core::fmt::FormatDouble::dtoa(
                &mut buffer,
                number.value(),
            ))
        }
        _ => false,
    }
}

/// `GetAllAccessorDeclarations(properties, properties[index])`
pub(crate) fn accessor_pair(properties: &[G::Property], index: usize) -> AccessorPair {
    let function = |prop: &G::Property| prop.value.and_then(|value| value.data.e_function());
    let accessor = &properties[index];
    let other_kind = match accessor.kind {
        PropertyKind::Get => PropertyKind::Set,
        _ => PropertyKind::Get,
    };
    let is_static = |prop: &G::Property| prop.flags.contains(Flags::Property::IsStatic);
    let other = properties.iter().position(|prop| {
        prop.kind == other_kind
            && is_static(prop) == is_static(accessor)
            && matches!((&prop.key, &accessor.key), (Some(a), Some(b)) if same_property_name(a, b))
    });
    let other_function = other.and_then(|at| function(&properties[at]));
    let (getter, setter) = match accessor.kind {
        PropertyKind::Get => (function(accessor), other_function),
        _ => (other_function, function(accessor)),
    };
    let is_other_decorated_first =
        other.is_some_and(|at| at < index && properties[at].ts_decorators.len_u32() > 0);
    AccessorPair {
        getter,
        setter,
        is_first_with_decorators: accessor.ts_decorators.len_u32() > 0 && !is_other_decorated_first,
    }
}

/// `getAnnotatedAccessorTypeNode` of a setter: the type of `GetSetAccessorValueParameter`.
fn setter_type(setter: &G::Fn) -> Metadata {
    setter
        .args
        .slice()
        .first()
        .map_or(Metadata::MNone, |value| value.ts_metadata)
}

/// `getParameterTypeNodeForDecoratorCheck` of each parameter.
fn parameter_types(func: &G::Fn) -> impl Iterator<Item = Metadata> {
    let args = func.args.slice();
    let rest = if func.flags.contains(Flags::Function::HasRestArg) {
        args.len() - 1
    } else {
        args.len()
    };
    args.iter().enumerate().map(move |(i, arg)| {
        if i == rest {
            arg.ts_metadata.rest_parameter_element_type()
        } else {
            arg.ts_metadata
        }
    })
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `getOldTypeMetadata` and `markDecoratorAliasReferenced` of a class. `constructor` is the one with a body.
    pub(crate) fn push_class_metadata(
        &mut self,
        loc: Loc,
        constructor: &G::Fn,
        decorators: &mut Vec<Expr>,
    ) {
        for ty in parameter_types(constructor) {
            self.keep_import_of_type(ty);
        }
        let types = self.serialize_parameter_types(Some(constructor));
        decorators.push(self.metadata_decorator(loc, b"design:paramtypes", types));
    }

    pub(crate) fn push_property_metadata(
        &mut self,
        loc: Loc,
        ty: Metadata,
        decorators: &mut BumpVec<'a, Expr>,
    ) {
        self.keep_import_of_type(ty);
        let ty = self.serialize_type(ty);
        decorators.push(self.metadata_decorator(loc, b"design:type", ty));
    }

    pub(crate) fn push_method_metadata(
        &mut self,
        loc: Loc,
        method: &G::Fn,
        decorators: &mut BumpVec<'a, Expr>,
    ) {
        self.keep_imports_of_signature(method);
        let function = self.serialized_to_expr(Serialized::Global(b"Function"));
        decorators.push(self.metadata_decorator(loc, b"design:type", function));
        let types = self.serialize_parameter_types(Some(method));
        decorators.push(self.metadata_decorator(loc, b"design:paramtypes", types));
        let is_async = method.flags.contains(Flags::Function::IsAsync)
            && !method.flags.contains(Flags::Function::IsGenerator);
        let returns = match method.return_ts_metadata {
            Metadata::MNone if is_async => self.serialized_to_expr(Serialized::Global(b"Promise")),
            Metadata::MNone => self.serialized_to_expr(Serialized::Undefined),
            ty => self.serialize_type(ty),
        };
        decorators.push(self.metadata_decorator(loc, b"design:returntype", returns));
    }

    /// For the accessor of `pair` that is decorated, a `kind`.
    pub(crate) fn push_accessor_metadata(
        &mut self,
        loc: Loc,
        kind: PropertyKind,
        pair: AccessorPair,
        decorators: &mut BumpVec<'a, Expr>,
    ) {
        self.keep_imports_of_accessor(kind, pair);
        // `getAccessorTypeNode`
        let ty = match (pair.setter, pair.getter) {
            (Some(setter), _) => setter_type(&setter.func),
            (None, Some(getter)) => getter.func.return_ts_metadata,
            (None, None) => Metadata::MNone,
        };
        let ty = self.serialize_type(ty);
        decorators.push(self.metadata_decorator(loc, b"design:type", ty));
        let types = self.serialize_parameter_types(pair.setter.as_ref().map(|it| &it.func));
        decorators.push(self.metadata_decorator(loc, b"design:paramtypes", types));
    }

    /// What `markDecoratorAliasReferenced` does for an accessor that has decorators.
    fn keep_imports_of_accessor(&mut self, kind: PropertyKind, pair: AccessorPair) {
        let getter = pair.getter.map(|it| it.func.return_ts_metadata);
        let setter = pair.setter.map(|it| setter_type(&it.func));
        let (own, other) = match kind {
            PropertyKind::Get => (getter, setter),
            _ => (setter, getter),
        };
        let annotated = |ty: &Metadata| !matches!(ty, Metadata::MNone);
        if let Some(ty) = own.filter(annotated).or(other) {
            self.keep_import_of_type(ty);
        }
    }

    /// What `markDecoratorAliasReferenced` does for a method that has decorators, and for a parameter that has.
    pub(crate) fn keep_imports_of_signature(&mut self, func: &G::Fn) {
        for ty in parameter_types(func) {
            self.keep_import_of_type(ty);
        }
        self.keep_import_of_type(func.return_ts_metadata);
    }

    /// `markDecoratorMedataDataTypeNodeAsReferenced`
    fn keep_import_of_type(&mut self, ty: Metadata) {
        let Some(reference) = self.entity_name_for_decorator_metadata(ty) else {
            return;
        };
        if let (_, Some(import)) = self.check_type_reference(&reference) {
            self.record_usage(import);
        }
    }

    /// `getEntityNameForDecoratorMetadata`
    fn entity_name_for_decorator_metadata(&self, ty: Metadata) -> Option<StoreRef<TypeReference>> {
        let types = match ty {
            Metadata::MReference(reference) => return Some(reference),
            Metadata::MParenthesized(inner) => {
                return self.entity_name_for_decorator_metadata(*inner);
            }
            Metadata::MUnion(types)
            | Metadata::MIntersection(types)
            | Metadata::MConditional(types) => types,
            _ => return None,
        };
        // `getEntityNameForDecoratorMetadataFromTypeList`
        let mut common: Option<StoreRef<TypeReference>> = None;
        for &ty in types.slice() {
            match ty {
                Metadata::MNever => continue,
                Metadata::MNull | Metadata::MUndefined
                    if !self.options.features.strict_null_checks =>
                {
                    continue;
                }
                _ => {}
            }
            let individual = self.entity_name_for_decorator_metadata(ty)?;
            let Some(first) = common else {
                common = Some(individual);
                continue;
            };
            // Unless both are the same identifier, `Object` is emitted.
            if first.name.len() != 1 || !same_names(first.name, individual.name) {
                return None;
            }
        }
        common
    }

    /// `GetTypeReferenceSerializationKind`, and the import that the metadata keeps.
    fn check_type_reference(
        &mut self,
        reference: &TypeReference,
    ) -> (TypeReferenceKind, Option<Ref>) {
        let names = reference.name.slice();
        let first = names[0];
        let root = self
            .find_symbol_with_record_usage::<false>(first.loc, first.text.slice())
            .map_or(None, |found| found.r#ref.to_nullable());
        let value = root.map(|root| self.symbols[root.inner_index() as usize].kind);
        use js_ast::symbol::Kind;
        // A name that only one declaration can mean has an answer that needs no types.
        match (self.type_name_declarations.get(first.text.slice()), value) {
            (None, None | Some(Kind::Unbound)) => (TypeReferenceKind::Unknown, None),
            (None, Some(Kind::Import)) => (TypeReferenceKind::Unknown, root),
            (None, Some(Kind::Class)) if names.len() == 1 => {
                (TypeReferenceKind::TypeWithConstructSignatureAndValue, None)
            }
            (None, Some(Kind::Class)) => (TypeReferenceKind::Unknown, None),
            (Some(TypeNameDeclaration::TypeOnlyImport), None | Some(Kind::Unbound)) => {
                (TypeReferenceKind::Global(b"Object"), None)
            }
            _ => {
                let strict_null_checks = self.options.features.strict_null_checks;
                let (text, is_tsx) = (&self.source.contents, self.options.jsx.parse);
                let checked = self.checked_type_references.get_or_insert_with(|| {
                    __bun_check_decorator_metadata(text, is_tsx, strict_null_checks)
                });
                match checked.binary_search_by_key(&first.loc.start, |it| it.loc.start) {
                    Ok(at) => (checked[at].kind, root.filter(|_| checked[at].keeps_import)),
                    Err(_) => (TypeReferenceKind::Unknown, None),
                }
            }
        }
    }

    /// `SerializeParameterTypesOfNode`
    fn serialize_parameter_types(&mut self, func: Option<&G::Fn>) -> Expr {
        let mut types = BumpVec::<Expr>::new_in(self.arena);
        if let Some(func) = func {
            for ty in parameter_types(func) {
                types.push(self.serialize_type(ty));
            }
        }
        self.new_expr(
            E::Array {
                items: ExprNodeList::from_bump_vec(types),
                ..Default::default()
            },
            Loc::EMPTY,
        )
    }

    fn serialize_type(&mut self, ty: Metadata) -> Expr {
        let serialized = self.serialize_type_node(ty, false);
        self.serialized_to_expr(serialized)
    }

    /// `serializeTypeNode`. `in_conditional_type` is `serializingConditionalTypeBranch`.
    fn serialize_type_node(&mut self, ty: Metadata, in_conditional_type: bool) -> Serialized {
        match ty {
            Metadata::MNone | Metadata::MAny | Metadata::MUnknown | Metadata::MObject => OBJECT,
            Metadata::MVoid | Metadata::MUndefined | Metadata::MNull | Metadata::MNever => {
                Serialized::Undefined
            }
            Metadata::MFunction => Serialized::Global(b"Function"),
            Metadata::MArray(_) | Metadata::MTuple => Serialized::Global(b"Array"),
            Metadata::MBoolean => Serialized::Global(b"Boolean"),
            Metadata::MString => Serialized::Global(b"String"),
            Metadata::MNumber => Serialized::Global(b"Number"),
            Metadata::MBigint => Serialized::Global(b"BigInt"),
            Metadata::MSymbol => Serialized::Global(b"Symbol"),
            // `serializeTypeReferenceNode`
            Metadata::MReference(reference) => match self.check_type_reference(&reference).0 {
                TypeReferenceKind::Unknown if in_conditional_type => OBJECT,
                TypeReferenceKind::Unknown => Serialized::NameIfFunction(reference.name),
                TypeReferenceKind::TypeWithConstructSignatureAndValue => {
                    Serialized::Name(reference.name)
                }
                TypeReferenceKind::VoidNullableOrNeverType => Serialized::Undefined,
                TypeReferenceKind::Global(name) => Serialized::Global(name),
            },
            Metadata::MIntersection(types) => self.serialize_union_or_intersection(
                types,
                Constituents::Intersection,
                in_conditional_type,
            ),
            Metadata::MUnion(types) => self.serialize_union_or_intersection(
                types,
                Constituents::Union,
                in_conditional_type,
            ),
            Metadata::MConditional(branches) => {
                self.serialize_union_or_intersection(branches, Constituents::Union, true)
            }
            Metadata::MParenthesized(inner) | Metadata::MReadonly(inner) => {
                self.serialize_type_node(*inner, in_conditional_type)
            }
        }
    }

    /// `serializeUnionOrIntersectionConstituents`
    fn serialize_union_or_intersection(
        &mut self,
        types: StoreSlice<Metadata>,
        constituents: Constituents,
        in_conditional_type: bool,
    ) -> Serialized {
        let is_intersection = constituents == Constituents::Intersection;
        let mut serialized: Option<Serialized> = None;
        for ty in types.slice() {
            let ty = ty.skip_parentheses();
            match ty {
                Metadata::MNever if is_intersection => return Serialized::Undefined,
                Metadata::MNever => continue,
                Metadata::MUnknown if !is_intersection => return OBJECT,
                Metadata::MUnknown => continue,
                Metadata::MAny => return OBJECT,
                Metadata::MNull | Metadata::MUndefined
                    if !self.options.features.strict_null_checks =>
                {
                    continue;
                }
                _ => {}
            }
            let constituent = self.serialize_type_node(ty, in_conditional_type);
            if constituent.identifier() == Some(b"Object") {
                return constituent;
            }
            match serialized {
                Some(first) if !first.equals(constituent) => return OBJECT,
                _ => serialized = Some(constituent),
            }
        }
        serialized.unwrap_or(Serialized::Undefined)
    }

    fn serialized_to_expr(&mut self, serialized: Serialized) -> Expr {
        let names = match serialized {
            Serialized::Undefined => return self.new_expr(E::Undefined {}, Loc::EMPTY),
            Serialized::Global(name) => return self.entity_name_to_expr(name, &[]),
            Serialized::Name(names) => {
                let names = names.slice();
                return self.entity_name_to_expr(names[0].text.slice(), &names[1..]);
            }
            Serialized::NameIfFunction(names) => names.slice(),
        };
        let first = names[0].text.slice();
        // TypeScript has a temporary for `typeof A !== "undefined" && A`. Reading an identifier twice is the same.
        let (tested, value) = if names.len() == 1 {
            (
                self.entity_name_to_expr(first, &[]),
                self.entity_name_to_expr(first, &[]),
            )
        } else {
            // `serializeEntityNameAsExpressionFallback`: `typeof A !== "undefined" && (_a = A.B) !== void 0 && _a.C`
            let root = self.entity_name_to_expr(first, &[]);
            let mut test = self.typeof_compare(root, js_ast::OpCode::BinStrictNe, b"undefined");
            let mut value = self.entity_name_to_expr(first, &names[1..2]);
            for name in &names[2..] {
                let temp = self.declared_temp(b"_a");
                let is_defined = E::Binary {
                    op: js_ast::OpCode::BinStrictNe,
                    left: self.assign_to(temp, value, Loc::EMPTY),
                    right: self.new_expr(E::Undefined {}, Loc::EMPTY),
                };
                let right = self.new_expr(is_defined, Loc::EMPTY);
                test = self.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinLogicalAnd,
                        left: test,
                        right,
                    },
                    Loc::EMPTY,
                );
                let target = self.use_ref(temp, Loc::EMPTY);
                value = self.new_expr(
                    E::Dot {
                        target,
                        name: name.text,
                        name_loc: Loc::EMPTY,
                        ..Default::default()
                    },
                    Loc::EMPTY,
                );
            }
            let checked_value = self.new_expr(
                E::Binary {
                    op: js_ast::OpCode::BinLogicalAnd,
                    left: test,
                    right: value,
                },
                Loc::EMPTY,
            );
            let temp = self.declared_temp(b"_a");
            (
                self.assign_to(temp, checked_value, Loc::EMPTY),
                self.use_ref(temp, Loc::EMPTY),
            )
        };
        let test = self.typeof_compare(tested, js_ast::OpCode::BinStrictEq, b"function");
        let no = self.entity_name_to_expr(b"Object", &[]);
        self.new_expr(
            E::If {
                test,
                yes: value,
                no,
            },
            Loc::EMPTY,
        )
    }

    /// `typeof value === "type"`
    fn typeof_compare(&mut self, value: Expr, op: js_ast::OpCode, ty: &'static [u8]) -> Expr {
        let flags = if matches!(value.data, js_ast::ExprData::EIdentifier(_)) {
            E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER
        } else {
            E::UnaryFlags::empty()
        };
        let left = self.new_expr(
            E::Unary {
                op: js_ast::OpCode::UnTypeof,
                value,
                flags,
            },
            Loc::EMPTY,
        );
        let right = self.new_expr(E::EString::from_static(ty), Loc::EMPTY);
        self.new_expr(E::Binary { op, left, right }, Loc::EMPTY)
    }

    /// `serializeEntityNameAsExpression`: `first.rest`, as if the source had it next to the class.
    fn entity_name_to_expr(&mut self, first: &'a [u8], rest: &[TypeReferenceName]) -> Expr {
        let root = self
            .find_symbol_with_record_usage::<false>(Loc::EMPTY, first)
            .map_or(Ref::NONE, |found| found.r#ref);
        let index = root.inner_index() as usize;
        // Only `keep_import_of_type` keeps an import.
        let uses_of_import = (!root.is_empty()
            && self.symbols[index].kind == js_ast::symbol::Kind::Import)
            .then(|| {
                (
                    self.symbols[index].use_count_estimate,
                    self.ts_use_counts[index],
                )
            });

        let ref_ = self.store_name_in_ref(first);
        let mut expr = self.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            Loc::EMPTY,
        );
        for name in rest {
            expr = self.new_expr(
                E::Dot {
                    target: expr,
                    name: name.text,
                    name_loc: Loc::EMPTY,
                    ..Default::default()
                },
                Loc::EMPTY,
            );
        }
        self.visit_expr(&mut expr);

        if let Some((uses, ts_uses)) = uses_of_import {
            while self.symbols[index].use_count_estimate > uses {
                self.ignore_usage(root);
            }
            self.ts_use_counts[index] = ts_uses;
        }
        expr
    }

    /// `__legacyMetadataTS(key, value)`
    fn metadata_decorator(&mut self, loc: Loc, key: &'static [u8], value: Expr) -> Expr {
        let key = self.new_expr(E::EString::from_static(key), Loc::EMPTY);
        self.call_rt(loc, b"__legacyMetadataTS", &[key, value])
    }
}
