//! Clones the TypeScript syntax nodes of the parse pass (`bun_ast::ts_syntax`) into the type checker's tree (`bun_sema::hir`).
//!
//! Only nodes that are reachable from what is asked for get cloned, so whatever an abandoned speculative parse left behind is ignored.
//! Names are interned here, and the grammar checks that TypeScript makes on type syntax after parsing are made here.

use bun_ast::Expr;
use bun_ast::ts_syntax as ts;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{
    Alias, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, Func, IdList, Interface, Keyword,
    Mapped, MappedModifier, Member, MemberId, MemberKind, Param, ParamId, PatElem, PatElemId,
    PatId, PatKind, PatProp, PatPropId, PropKey, ResolutionMode, Span, SpecifierKind, SpecifierUse,
    StmtId, StmtKind, TextRange, TupleElem, TypeNodeId, TypeNodeKind, TypeParam, TypeParamId,
};

use super::builder::{Builder, Modified, modifier_error};

/// A part of a cloned node that is written as a JavaScript expression or function body. The lowering converts it and fills it in.
pub(crate) enum PendingPart {
    /// `[expression]: T`
    MemberKey(MemberId, Expr),
    /// `name: T = expression`
    MemberInitializer(MemberId, Expr),
    /// `get name() { .. }`
    FunctionBody(FnId, ts::FunctionBody),
    /// `({ [expression]: binding }) => T`
    PatternKey(PatPropId, Expr),
    /// `(name = expression) => T`
    ParamDefault(ParamId, Expr),
    /// `({ name = expression }) => T`
    PatternPropertyDefault(PatPropId, Expr),
    /// `([name = expression]) => T`
    PatternElementDefault(PatElemId, Expr),
    /// `interface I extends expression`
    HeritageExpression(TypeNodeId, Expr),
    /// `import("m", { with: expression })`
    ImportAttributes(ts::ImportAttributes),
}

macro_rules! assert_same_flags {
    ($($flag:ident),*) => {
        $(const _: () = assert!(ts::Flags::$flag.bits() == Flags::$flag.bits());)*
    };
}
assert_same_flags!(
    EXPORT,
    DEFAULT,
    AMBIENT,
    ABSTRACT,
    ASYNC,
    GENERATOR,
    STATIC,
    READONLY,
    OPTIONAL,
    PRIVATE,
    PROTECTED,
    PUBLIC,
    OVERRIDE,
    ACCESSOR,
    CONST,
    REST,
    DEFINITE,
    TYPE_ONLY,
    IN,
    OUT,
    STRING_NAME
);

#[inline]
fn flags(flags: ts::Flags) -> Flags {
    Flags::from_bits_retain(flags.bits())
}

#[inline]
fn pos(loc: bun_ast::Loc) -> u32 {
    // Nothing is noted of a node of `ts_syntax`.
    debug_assert!(!loc.is_index());
    loc.start.max(0) as u32
}

fn keyword(keyword: ts::Keyword) -> Keyword {
    match keyword {
        ts::Keyword::Any => Keyword::Any,
        ts::Keyword::Unknown => Keyword::Unknown,
        ts::Keyword::Never => Keyword::Never,
        ts::Keyword::Void => Keyword::Void,
        ts::Keyword::Undefined => Keyword::Undefined,
        ts::Keyword::Null => Keyword::Null,
        ts::Keyword::String => Keyword::String,
        ts::Keyword::Number => Keyword::Number,
        ts::Keyword::Boolean => Keyword::Boolean,
        ts::Keyword::BigInt => Keyword::BigInt,
        ts::Keyword::Symbol => Keyword::Symbol,
        ts::Keyword::Object => Keyword::Object,
        ts::Keyword::This => Keyword::This,
        ts::Keyword::Intrinsic => Keyword::Intrinsic,
    }
}

fn mapped_modifier(modifier: ts::MappedModifier) -> MappedModifier {
    match modifier {
        ts::MappedModifier::None => MappedModifier::None,
        ts::MappedModifier::Add => MappedModifier::Add,
        ts::MappedModifier::Remove => MappedModifier::Remove,
    }
}

impl Builder<'_> {
    pub(crate) fn clone_type(&mut self, id: ts::TypeId) -> TypeNodeId {
        if id.is_none() {
            return TypeNodeId::NONE;
        }
        let ts::Type { data, loc, end } = self.ts[id];
        let kind = match data {
            ts::TypeData::Keyword(k) => TypeNodeKind::Keyword(keyword(k)),
            ts::TypeData::Reference { name, args } => TypeNodeKind::Ref {
                name: self.clone_names(name),
                args: self.clone_type_list(args),
            },
            ts::TypeData::StringLiteral(text) => TypeNodeKind::StringLit(self.atom(&text)),
            ts::TypeData::NumberLiteral(number) => {
                TypeNodeKind::NumberLit(self.file.number(self.ts.numbers[number as usize]))
            }
            ts::TypeData::BigIntLiteral { text, negative } => TypeNodeKind::BigIntLit {
                text: self.atoms.intern(&text),
                negative,
            },
            ts::TypeData::BooleanLiteral(value) => TypeNodeKind::BoolLit(value),
            ts::TypeData::TemplateLiteral { types, texts } => {
                let types = self.clone_type_list(types);
                let texts: smallvec::SmallVec<[Atom; 4]> = self.ts[texts]
                    .iter()
                    .map(|text| self.atoms.intern(text))
                    .collect();
                TypeNodeKind::Template {
                    types,
                    texts: self.file.list(&texts),
                }
            }
            ts::TypeData::Array(element) => TypeNodeKind::Array(self.clone_type(element)),
            ts::TypeData::Tuple(elements) => {
                let elements: Vec<TupleElem> = elements
                    .iter()
                    .map(|element| {
                        let ts::TupleElement {
                            mut ty,
                            label,
                            is_optional,
                            mut is_rest,
                            loc,
                        } = self.ts[element];
                        let name = label.map_or(Atom::NONE, |label| self.atoms.intern(&label));
                        if is_rest && is_optional && label.is_some() {
                            // `checkNamedTupleMember`: A tuple member cannot be both optional and rest.
                            self.file.early_errors.push((pos(loc), 5085));
                            // `getTupleElementFlags`, `getTypeFromNamedTupleTypeNode`: it is optional.
                            is_rest = false;
                            ty = self.rest_element_type(ty);
                        }
                        TupleElem {
                            ty: self.clone_type(ty),
                            name,
                            optional: is_optional,
                            rest: is_rest,
                        }
                    })
                    .collect();
                TypeNodeKind::Tuple(self.file.add_tuple_elems(&elements))
            }
            ts::TypeData::Union(members) => TypeNodeKind::Union(self.clone_type_list(members)),
            ts::TypeData::Intersection(members) => {
                TypeNodeKind::Intersection(self.clone_type_list(members))
            }
            ts::TypeData::Function(signature) => {
                TypeNodeKind::Fn(self.clone_signature(signature, Atom::NONE, Some(pos(loc))))
            }
            ts::TypeData::Object(members) => TypeNodeKind::Object(self.clone_members(members)),
            ts::TypeData::Conditional {
                check,
                extends,
                when_true,
                when_false,
            } => TypeNodeKind::Cond {
                check: self.clone_type(check),
                extends: self.clone_type(extends),
                yes: self.clone_type(when_true),
                no: self.clone_type(when_false),
            },
            ts::TypeData::Infer(param) => {
                let param = self.clone_type_param(param);
                TypeNodeKind::Infer(self.file.add_type_param(param))
            }
            ts::TypeData::Mapped(mapped) => {
                let ts::MappedType {
                    param,
                    name_type,
                    ty,
                    readonly,
                    optional,
                    extra_member_loc,
                    members,
                } = self.ts[mapped];
                if let Some(loc) = extra_member_loc {
                    // `checkGrammarMappedType`: A mapped type may not declare properties or methods.
                    self.file.early_errors.push((pos(loc), 7061));
                }
                let param = self.clone_type_param(param);
                let mapped = Mapped {
                    param: self.file.add_type_param(param),
                    name_ty: self.clone_type(name_type),
                    ty: self.clone_type(ty),
                    readonly: mapped_modifier(readonly),
                    optional: mapped_modifier(optional),
                    members: self.clone_members(members),
                };
                TypeNodeKind::Mapped(self.file.add_mapped(mapped))
            }
            ts::TypeData::IndexedAccess { object, index } => TypeNodeKind::IndexedAccess {
                obj: self.clone_type(object),
                index: self.clone_type(index),
            },
            ts::TypeData::Keyof(operand) => TypeNodeKind::Keyof(self.clone_type(operand)),
            ts::TypeData::Readonly(operand) => TypeNodeKind::Readonly(self.clone_type(operand)),
            ts::TypeData::UniqueSymbol => TypeNodeKind::UniqueSymbol,
            // `getTypeFromTypeOperatorNode`: the error type. The parser has reported it (1005). The operand is not kept.
            ts::TypeData::UniqueOperator(_) => TypeNodeKind::Keyword(Keyword::Any),
            ts::TypeData::Typeof {
                name,
                args,
                has_type_arguments,
            } => {
                let expr = self.clone_entity_name_expression(name);
                TypeNodeKind::Typeof {
                    name: self.clone_names(name),
                    args: self.clone_type_list(args),
                    has_type_arguments,
                    expr,
                }
            }
            ts::TypeData::Import(import) => {
                let ts::ImportType {
                    specifier,
                    specifier_loc,
                    argument,
                    name,
                    args,
                    is_typeof,
                    mode,
                    assert_keyword_loc,
                    attributes,
                } = self.ts[import];
                if let Some(attributes) = attributes {
                    self.pending.push(PendingPart::ImportAttributes(attributes));
                }
                if argument.is_some() {
                    let node = self.clone_import_type_without_specifier(
                        argument,
                        name,
                        is_typeof,
                        pos(loc),
                    );
                    self.file[node].end = pos(end);
                    return node;
                }
                let spec = self.atoms.intern(&specifier);
                let mode = match mode {
                    ts::ResolutionMode::None => ResolutionMode::None,
                    ts::ResolutionMode::Import => ResolutionMode::Import,
                    ts::ResolutionMode::Require => ResolutionMode::Require,
                };
                self.file.specifier_uses.push(SpecifierUse {
                    spec,
                    pos: pos(specifier_loc),
                    kind: SpecifierKind::ImportType,
                    mode,
                });
                if let Some(loc) = assert_keyword_loc {
                    // Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'.
                    self.file.early_errors.push((pos(loc), 2880));
                }
                TypeNodeKind::Import {
                    spec,
                    name: self.clone_names(name),
                    args: self.clone_type_list(args),
                    is_typeof,
                    mode,
                }
            }
            ts::TypeData::Predicate { param, ty, asserts } => TypeNodeKind::Predicate {
                param: self.atoms.intern(&self.ts[param].text),
                ty: self.clone_type(ty),
                asserts,
            },
            ts::TypeData::JsDocNullable {
                operand,
                is_postfix,
            } => {
                let code = if is_postfix { 17019 } else { 17020 };
                self.check_jsdoc_type_is_in_js_file(pos(loc), code);
                self.clone_union_with_keyword(operand, Keyword::Null, pos(loc))
            }
            ts::TypeData::JsDocNonNullable {
                operand,
                is_postfix,
            } => {
                let code = if is_postfix { 17019 } else { 17020 };
                self.check_jsdoc_type_is_in_js_file(pos(loc), code);
                return self.clone_type(operand);
            }
            ts::TypeData::JsDocAll => {
                // JSDoc types can only be used inside documentation comments.
                self.check_jsdoc_type_is_in_js_file(pos(loc), 8020);
                TypeNodeKind::Keyword(Keyword::Any)
            }
            ts::TypeData::Optional(operand) => {
                // `checkNamedTupleMember`. The element is required (`getTupleElementFlags`), and `getTypeFromOptionalTypeNode` adds `undefined`.
                self.file.early_errors.push((pos(loc), 5086));
                self.clone_union_with_keyword(operand, Keyword::Undefined, pos(loc))
            }
            ts::TypeData::Rest(operand) => {
                // `checkNamedTupleMember`. The element is required (`getTupleElementFlags`).
                self.file.early_errors.push((pos(loc), 5087));
                let element = self.rest_element_type(operand);
                return self.clone_type(element);
            }
            // The end of `checkInterfaceDeclaration` reports 2499 for it.
            ts::TypeData::HeritageExpression(_) => TypeNodeKind::Error,
            ts::TypeData::Error {
                is_syntax_error: true,
            } => return self.error_type(pos(loc)),
            ts::TypeData::Error {
                is_syntax_error: false,
            } => TypeNodeKind::Error,
        };
        let node = self.file.ty(kind, pos(loc));
        self.file[node].end = pos(end);
        if let ts::TypeData::HeritageExpression(expression) = data {
            let expression = self.ts[expression];
            self.pending
                .push(PendingPart::HeritageExpression(node, expression));
        }
        node
    }

    /// `checkJSDocTypeIsInJsFile`
    fn check_jsdoc_type_is_in_js_file(&mut self, at: u32, code: u32) {
        if !self.is_js {
            self.file.early_errors.push((at, code));
        }
    }

    /// `operand | keyword`
    fn clone_union_with_keyword(
        &mut self,
        operand: ts::TypeId,
        keyword: Keyword,
        at: u32,
    ) -> TypeNodeKind {
        let operand = self.clone_type(operand);
        let keyword = self.file.ty(TypeNodeKind::Keyword(keyword), at);
        TypeNodeKind::Union(self.file.list(&[operand, keyword]))
    }

    /// `getTypeFromRestTypeNode`: the element type if `ty` is written as an array type, otherwise `ty`.
    fn rest_element_type(&self, ty: ts::TypeId) -> ts::TypeId {
        match self.ts[ty].data {
            ts::TypeData::Array(element) => element,
            _ => ty,
        }
    }

    /// `getTypeFromImportTypeNode`: 1141 for `import(T)`, whose type is the error type. `checkImportType` still checks `T`, which is kept
    /// in `args` of a node without a specifier. The type arguments are never looked at.
    #[cold]
    fn clone_import_type_without_specifier(
        &mut self,
        argument: ts::TypeId,
        name: ts::Span<ts::Name>,
        is_typeof: bool,
        at: u32,
    ) -> TypeNodeId {
        self.file
            .early_errors
            .push((pos(self.ts[argument].loc), 1141));
        let argument = self.clone_type(argument);
        let args = self.file.list(&[argument]);
        let name = self.clone_names(name);
        self.file.ty(
            TypeNodeKind::Import {
                spec: Atom::NONE,
                name,
                args,
                is_typeof,
                mode: ResolutionMode::None,
            },
            at,
        )
    }

    /// The keyword type that `name` spells. It must spell one.
    pub(crate) fn clone_keyword_type(&mut self, name: &[u8], loc: bun_ast::Loc) -> TypeNodeId {
        let keyword_type = super::keep::keyword_type(name).expect("the caller checked");
        self.file
            .ty(TypeNodeKind::Keyword(keyword(keyword_type)), pos(loc))
    }

    pub(crate) fn clone_type_list(&mut self, list: ts::IdList<ts::Type>) -> IdList<TypeNodeId> {
        if list.is_empty() {
            return IdList::EMPTY;
        }
        let ids: smallvec::SmallVec<[ts::TypeId; 8]> = self.ts.id_list(list).collect();
        let types: smallvec::SmallVec<[TypeNodeId; 8]> =
            ids.into_iter().map(|id| self.clone_type(id)).collect();
        self.file.list(&types)
    }

    fn clone_names(&mut self, names: ts::Span<ts::Name>) -> Span<bun_sema::hir::NameId> {
        let names: smallvec::SmallVec<[(Atom, u32); 4]> = self.ts[names]
            .iter()
            .map(|name| (self.atom(&name.text), pos(name.loc)))
            .collect();
        self.file.entity_name(names.into_iter())
    }

    /// `a.b.c` as an expression.
    fn clone_entity_name_expression(&mut self, names: ts::Span<ts::Name>) -> ExprId {
        let mut expr = ExprId::NONE;
        for name in names.iter() {
            let ts::Name { text, loc } = self.ts[name];
            let name = self.atoms.intern(&text);
            let kind = match expr.is_none() {
                true if name == known::this => ExprKind::This,
                true => ExprKind::Ident(name),
                false => ExprKind::Dot {
                    obj: expr,
                    name,
                    name_pos: pos(loc),
                    chain: Chain::No,
                },
            };
            expr = self.file.expr(kind, pos(loc));
        }
        expr
    }

    fn clone_type_param(&mut self, id: ts::TypeParamId) -> TypeParam {
        let ts::TypeParam {
            name,
            loc,
            start,
            end,
            constraint,
            default,
            flags: param_flags,
        } = self.ts[id];
        TypeParam {
            name: self.atom(&name),
            pos: pos(loc),
            start: pos(start),
            end: pos(end),
            constraint: self.clone_type(constraint),
            default: self.clone_type(default),
            flags: flags(param_flags),
        }
    }

    pub(crate) fn clone_type_params(
        &mut self,
        params: ts::Span<ts::TypeParam>,
    ) -> Span<TypeParamId> {
        if params.is_empty() {
            return Span::EMPTY;
        }
        let params: smallvec::SmallVec<[TypeParam; 4]> = params
            .iter()
            .map(|param| self.clone_type_param(param))
            .collect();
        self.file.add_type_params(&params)
    }

    /// The `this` parameter of a function that `bun_ast` has a node for (`keep_this_parameter`).
    pub(crate) fn clone_param(&mut self, param: ts::Id<ts::Param>) -> ParamId {
        let only = ts::Span::from_parts([param.index() as u32, 1]);
        self.clone_params(only).at(0)
    }

    pub(crate) fn clone_params(&mut self, params: ts::Span<ts::Param>) -> Span<ParamId> {
        if params.is_empty() {
            return Span::EMPTY;
        }
        let cloned: smallvec::SmallVec<[Param; 4]> = params
            .iter()
            .map(|param| {
                let ts::Param {
                    pattern,
                    ty,
                    flags: param_flags,
                    modifiers,
                    loc,
                    full_start,
                    end,
                    ..
                } = self.ts[param];
                let mut param_flags = flags(param_flags);
                // `checkGrammarModifiers`
                if modifiers.len() > 1
                    || param_flags.intersects(
                        Flags::STATIC
                            | Flags::AMBIENT
                            | Flags::ASYNC
                            | Flags::ABSTRACT
                            | Flags::ACCESSOR,
                    )
                {
                    let modifiers: smallvec::SmallVec<[(Flags, u32); 4]> = self.ts[modifiers]
                        .iter()
                        .map(|modifier| (flags(modifier.flag), pos(modifier.loc)))
                        .collect();
                    self.file.early_errors.extend(modifier_error(
                        &modifiers,
                        Modified::Parameter,
                        false,
                        false,
                        false,
                    ));
                }
                if param_flags.intersects(
                    Flags::PUBLIC
                        | Flags::PRIVATE
                        | Flags::PROTECTED
                        | Flags::READONLY
                        | Flags::OVERRIDE,
                ) {
                    param_flags |= Flags::PARAMETER_PROPERTY;
                }
                Param {
                    pat: self.clone_pattern(pattern),
                    ty: self.clone_type(ty),
                    default: ExprId::NONE,
                    flags: param_flags,
                    pos: pos(loc),
                    loc: TextRange {
                        pos: pos(full_start),
                        end: pos(end),
                    },
                }
            })
            .collect();
        let cloned = self.file.add_params(&cloned);
        for (param, id) in params.iter().zip(cloned.iter()) {
            if let Some(default) = self.ts[param].default {
                self.pending.push(PendingPart::ParamDefault(id, default));
            }
            let written = self.ts[param].modifiers;
            let modifiers: smallvec::SmallVec<[(Flags, u32); 4]> = self.ts[written]
                .iter()
                .map(|modifier| (flags(modifier.flag), pos(modifier.loc)))
                .collect();
            if !modifiers.is_empty() {
                let list = self.add_modifier_list(&modifiers);
                self.file.set_param_modifiers(id, list);
            }
        }
        cloned
    }

    fn clone_pattern(&mut self, id: ts::PatternId) -> PatId {
        if id.is_none() {
            return PatId::NONE;
        }
        let ts::Pattern { data, loc } = self.ts[id];
        let kind = match data {
            ts::PatternData::Missing => PatKind::Missing,
            ts::PatternData::Identifier(name) => PatKind::Ident(self.atom(&name)),
            ts::PatternData::Array(elements) => {
                let cloned: smallvec::SmallVec<[PatElem; 4]> = elements
                    .iter()
                    .map(|element| {
                        let ts::PatternElement {
                            pattern,
                            is_rest,
                            loc,
                            ..
                        } = self.ts[element];
                        PatElem {
                            pat: self.clone_pattern(pattern),
                            default: ExprId::NONE,
                            is_rest,
                            start: pos(loc),
                        }
                    })
                    .collect();
                let cloned = self.file.add_pat_elems(&cloned);
                for (element, id) in elements.iter().zip(cloned.iter()) {
                    if let Some(default) = self.ts[element].default {
                        self.pending
                            .push(PendingPart::PatternElementDefault(id, default));
                    }
                }
                PatKind::Array(cloned)
            }
            ts::PatternData::Object(properties) => {
                let cloned: smallvec::SmallVec<[PatProp; 4]> = properties
                    .iter()
                    .map(|property| {
                        let ts::PatternProperty {
                            key,
                            value,
                            is_rest,
                            loc,
                            ..
                        } = self.ts[property];
                        PatProp {
                            key: self.clone_key(key),
                            name_kind: match key {
                                ts::PropertyKey::Number(_) => {
                                    bun_sema::hir::NameKind::NumericLiteral
                                }
                                _ => bun_sema::hir::NameKind::Identifier,
                            },
                            value: self.clone_pattern(value),
                            default: ExprId::NONE,
                            is_rest,
                            pos: pos(loc),
                            key_pos: pos(loc),
                        }
                    })
                    .collect();
                let cloned = self.file.add_pat_props(&cloned);
                for (property, id) in properties.iter().zip(cloned.iter()) {
                    let ts::PatternProperty { key, default, .. } = self.ts[property];
                    if let ts::PropertyKey::Computed(expr) = key {
                        self.pending.push(PendingPart::PatternKey(id, expr));
                    }
                    if let Some(default) = default {
                        self.pending
                            .push(PendingPart::PatternPropertyDefault(id, default));
                    }
                }
                PatKind::Object(cloned)
            }
        };
        self.file.pat(kind, pos(loc))
    }

    /// A computed key is left empty. The caller adds a `PendingPart` for it.
    fn clone_key(&mut self, key: ts::PropertyKey) -> PropKey {
        match key {
            ts::PropertyKey::None | ts::PropertyKey::BigInt | ts::PropertyKey::Computed(_) => {
                PropKey::None
            }
            ts::PropertyKey::Name(name) => PropKey::Name(self.atom(&name)),
            ts::PropertyKey::Number(number) => {
                PropKey::Name(self.number_name(self.ts.numbers[number as usize]))
            }
            ts::PropertyKey::Private(name) => PropKey::Private(self.atoms.intern(&name)),
        }
    }

    /// `name` and `start` are those of the member the signature belongs to. A function type has neither.
    fn clone_signature(&mut self, id: ts::SignatureId, name: Atom, start: Option<u32>) -> FnId {
        let ts::Signature {
            kind,
            flags: signature_flags,
            type_params,
            params,
            return_type,
            body,
            open_paren_loc,
            loc,
        } = self.ts[id];
        let type_params = self.clone_type_params(type_params);
        let params = self.clone_params(params);
        let (this_param, params) = match kind {
            ts::SignatureKind::IndexSignature => (ParamId::NONE, params),
            _ => self.file.split_this_parameter(params),
        };
        let func = Func {
            kind: match kind {
                ts::SignatureKind::Method => FnKind::Method,
                ts::SignatureKind::Getter => FnKind::Getter,
                ts::SignatureKind::Setter => FnKind::Setter,
                ts::SignatureKind::CallSignature => FnKind::CallSignature,
                ts::SignatureKind::ConstructSignature => FnKind::ConstructSignature,
                ts::SignatureKind::FunctionType => FnKind::FunctionType,
                ts::SignatureKind::ConstructorType => FnKind::ConstructorType,
                ts::SignatureKind::IndexSignature => FnKind::IndexSignature,
            },
            flags: flags(signature_flags),
            name,
            name_pos: pos(loc),
            type_params,
            params,
            this_param,
            ret: self.clone_type(return_type),
            body: FnBody::None,
            anchor: pos(open_paren_loc),
            start: start.unwrap_or(pos(loc)),
        };
        let func = self.file.add_fn(func);
        if let Some(body) = body {
            // `checkGrammarAccessor`: An implementation cannot be declared in ambient contexts.
            self.file.early_errors.push((pos(body.loc), 1183));
            self.pending.push(PendingPart::FunctionBody(func, body));
        }
        func
    }

    /// The flags that `export`, `default` and `declare` stand for, and where `export` is.
    pub(crate) fn clone_statement_modifiers(
        &self,
        modifiers: ts::Span<ts::Modifier>,
    ) -> (Flags, Option<u32>) {
        let (mut all, mut export_pos) = (Flags::empty(), None);
        for modifier in modifiers.iter() {
            let ts::Modifier { flag, loc, .. } = self.ts[modifier];
            if flag == ts::Flags::EXPORT {
                export_pos.get_or_insert(pos(loc));
            }
            all |= flags(flag);
        }
        (all, export_pos)
    }

    /// Reports what `checkGrammarInterfaceDeclaration` reports, except 1176 for an `implements` clause, which the checker finds in the text.
    pub(crate) fn clone_interface(
        &mut self,
        id: ts::Id<ts::Interface>,
        flags: Flags,
        pos: u32,
    ) -> Option<StmtId> {
        let ts::Interface {
            name,
            type_params,
            extends,
            other_heritage,
            heritage_errors,
            members,
            ..
        } = self.ts[id];
        self.file.early_errors.extend(
            heritage_errors
                .into_iter()
                .flatten()
                .map(|(loc, code)| (self::pos(loc), code)),
        );
        let type_params = self.clone_type_params(type_params);
        let heritage: smallvec::SmallVec<[ts::TypeId; 4]> = self.ts.id_list(extends).collect();
        let heritage: smallvec::SmallVec<[TypeNodeId; 4]> = heritage
            .into_iter()
            .map(|ty| self.clone_heritage_type(ty))
            .collect();
        let others: smallvec::SmallVec<[ts::TypeId; 4]> = self.ts.id_list(other_heritage).collect();
        let others: smallvec::SmallVec<[TypeNodeId; 4]> = others
            .into_iter()
            .map(|ty| self.clone_heritage_type(ty))
            .collect();
        let interface = Interface {
            name: self.atoms.intern(&name.text),
            name_pos: self::pos(name.loc),
            flags,
            type_params,
            extends: self.file.list(&heritage),
            other_heritage: self.file.list(&others),
            members: self.clone_members(members),
            stmt: StmtId::NONE,
        };
        let interface = self.file.add_interface(interface);
        Some(self.file.stmt(StmtKind::Interface(interface), pos))
    }

    /// In a heritage clause `string` is an entity name, not the keyword type.
    pub(crate) fn clone_heritage_type(&mut self, id: ts::TypeId) -> TypeNodeId {
        let ts::Type { data, loc, end } = self.ts[id];
        let ts::TypeData::Keyword(keyword) = data else {
            return self.clone_type(id);
        };
        let name = self.atoms.intern(super::keep::keyword_text(keyword));
        let name = self.file.entity_name([(name, pos(loc))].into_iter());
        let node = self.file.ty(
            TypeNodeKind::Ref {
                name,
                args: IdList::EMPTY,
            },
            pos(loc),
        );
        self.file[node].end = pos(end);
        node
    }

    pub(crate) fn clone_type_alias(
        &mut self,
        id: ts::Id<ts::TypeAlias>,
        flags: Flags,
        pos: u32,
    ) -> StmtId {
        let ts::TypeAlias {
            name,
            type_params,
            ty,
        } = self.ts[id];
        let type_params = self.clone_type_params(type_params);
        let ty = self.clone_type(ty);
        let alias = Alias {
            name: self.atoms.intern(&name.text),
            name_pos: self::pos(name.loc),
            flags,
            type_params,
            ty,
            stmt: StmtId::NONE,
        };
        let alias = self.file.add_alias(alias);
        self.file.stmt(StmtKind::TypeAlias(alias), pos)
    }

    pub(crate) fn clone_members(&mut self, members: ts::Span<ts::Member>) -> Span<MemberId> {
        if members.is_empty() {
            return Span::EMPTY;
        }
        let cloned: Vec<Member> = members
            .iter()
            .map(|member| self.clone_member(member))
            .collect();
        let cloned = self.file.add_members(&cloned);
        for (member, id) in members.iter().zip(cloned.iter()) {
            let ts::Member {
                key, initializer, ..
            } = self.ts[member];
            if let ts::PropertyKey::Computed(expr) = key {
                self.pending.push(PendingPart::MemberKey(id, expr));
            }
            if let Some(initializer) = initializer {
                self.pending
                    .push(PendingPart::MemberInitializer(id, initializer));
            }
        }
        cloned
    }

    /// An index signature that is a member of a class. `is_ambient`: of an ambient one.
    pub(crate) fn clone_class_index_signature(
        &mut self,
        id: ts::MemberId,
        is_ambient: bool,
    ) -> Member {
        let mut member = self.clone_member_of(id, Some(is_ambient));
        if is_ambient {
            member.flags |= Flags::AMBIENT;
            self.file[member.func].flags |= Flags::AMBIENT;
        }
        member
    }

    fn clone_member(&mut self, id: ts::MemberId) -> Member {
        self.clone_member_of(id, None)
    }

    /// `in_class`: it is a member of a class, and whether that is ambient.
    fn clone_member_of(&mut self, id: ts::MemberId, in_class: Option<bool>) -> Member {
        let ts::Member {
            kind,
            key,
            flags: member_flags,
            modifiers,
            ty,
            signature,
            loc,
            start,
            full_start,
            end,
            ..
        } = self.ts[id];
        let errors_before = self.file.early_errors.len();
        let mut modifier_list = Span::EMPTY;
        if !modifiers.is_empty() {
            let modifiers: smallvec::SmallVec<[(Flags, u32); 4]> = self.ts[modifiers]
                .iter()
                .map(|modifier| (flags(modifier.flag), pos(modifier.loc)))
                .collect();
            modifier_list = self.add_modifier_list(&modifiers);
            let on = match kind {
                ts::MemberKind::IndexSignature if in_class.is_some() => {
                    Modified::ClassIndexSignature
                }
                ts::MemberKind::IndexSignature => Modified::IndexSignature,
                ts::MemberKind::Getter | ts::MemberKind::Setter => Modified::Accessor,
                ts::MemberKind::Property => Modified::PropertySignature,
                _ => Modified::MethodSignature,
            };
            // `checkGrammarModifiers`
            if let Some(error) = modifier_error(
                &modifiers,
                on,
                in_class.is_some() && self.in_abstract_class,
                in_class == Some(true),
                matches!(key, ts::PropertyKey::Private(_)),
            ) {
                self.file.early_errors.push(error);
            }
        }
        // `checkGrammarIndexSignature`: nothing more is said after an error in the modifiers.
        if kind == ts::MemberKind::IndexSignature && self.file.early_errors.len() == errors_before {
            self.check_kept_index_signature(id);
        }
        // `checkVariableLikeDeclaration`: said whatever else is wrong with the file.
        if kind == ts::MemberKind::Property && matches!(key, ts::PropertyKey::BigInt) {
            self.file.checker_errors.push((pos(loc), 1539));
        }
        let mut key = self.clone_key(key);
        // `getDeclarationName`: a private name with no class around it names nothing.
        if self.classes_around == 0 && matches!(key, PropKey::Private(_)) {
            key = PropKey::None;
        }
        let func = if signature.is_some() {
            self.clone_signature(
                signature,
                key.name().unwrap_or(Atom::NONE),
                Some(pos(start)),
            )
        } else {
            FnId::NONE
        };
        Member {
            kind: match kind {
                ts::MemberKind::Property => MemberKind::Property,
                ts::MemberKind::Method => MemberKind::Method,
                ts::MemberKind::Getter => MemberKind::Getter,
                ts::MemberKind::Setter => MemberKind::Setter,
                ts::MemberKind::CallSignature => MemberKind::CallSignature,
                ts::MemberKind::ConstructSignature => MemberKind::ConstructSignature,
                ts::MemberKind::IndexSignature => MemberKind::IndexSignature,
            },
            key,
            flags: flags(member_flags),
            modifiers: modifier_list,
            // The type of an index signature is the return type of its signature: one node, not two.
            ty: if kind == ts::MemberKind::IndexSignature {
                self.file[func].ret
            } else {
                self.clone_type(ty)
            },
            init: ExprId::NONE,
            func,
            name_pos: pos(loc),
            start: pos(start),
            loc: TextRange {
                pos: pos(full_start),
                end: pos(end),
            },
        }
    }

    /// `checkGrammarIndexSignatureParameters`, up to where the type of the parameter is looked at. The checker does the rest.
    fn check_kept_index_signature(&mut self, id: ts::MemberId) {
        let ts::Member {
            signature,
            trailing_comma_loc,
            loc,
            ..
        } = self.ts[id];
        let params = self.ts[signature].params;
        let Some(first) = params.get(0) else {
            self.file.early_errors.push((pos(loc), 1096));
            return;
        };
        let ts::Param {
            pattern,
            ty,
            default,
            flags: param_flags,
            modifiers,
            rest_loc,
            question_loc,
            ..
        } = self.ts[first];
        let name = pos(self.ts[pattern].loc);
        if params.len() != 1 {
            self.file.early_errors.push((name, 1096));
            return;
        }
        if let Some(comma) = trailing_comma_loc {
            self.file.early_errors.push((pos(comma), 1025));
        }
        let error = if param_flags.contains(ts::Flags::REST) {
            (pos(rest_loc), 1017)
        } else if !modifiers.is_empty() {
            (name, 1018)
        } else if param_flags.contains(ts::Flags::OPTIONAL) {
            (pos(question_loc), 1019)
        } else if default.is_some() {
            (name, 1020)
        } else if ty.is_none() {
            (name, 1022)
        } else {
            return;
        };
        self.file.early_errors.push(error);
    }
}
