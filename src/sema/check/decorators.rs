//! Decorators: the arguments a decorator is called with, and whether that call is valid: 1497,
//! 1329, 1238 1239 1240 1241, 1270 1271.
//!
//! Follows `getLegacyDecoratorCallSignature`, `getESDecoratorCallSignature`, `resolveDecorator`,
//! `checkDecorator` and `checkGrammarDecorator`, of TypeScript 7.0.2's checker.go and
//! grammarchecks.go.

use super::call::{CallLike, ExpectsReturn};
use super::errors_statements::is_binder_diagnostic;
use super::*;
use crate::bind::MemberOwner;

/// The source span of a decorator.
#[derive(Copy, Clone)]
pub(super) struct Written {
    /// Its `@`.
    pub(super) at_sign: u32,
    /// Start of its expression, including the opening parenthesis if it is parenthesized.
    pub(super) start: u32,
    /// End of the expression, which is also the end of the decorator.
    pub(super) end: u32,
    is_parenthesized: bool,
}

impl<'p, 's> Checker<'p, 's> {
    fn class_of_decorated(
        &self,
        file: FileId,
        owner: DecoratorOwner,
    ) -> Option<(ClassId, Option<MemberId>)> {
        let bound = self.bound(file);
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Some((c, Some(m))),
            _ => None,
        };
        match owner {
            DecoratorOwner::Class(c) => Some((c, None)),
            DecoratorOwner::Member(m) => of_member(m),
            DecoratorOwner::Param(p) => match bound.fns[bound.param_fn[p.idx()].idx()].owner {
                crate::bind::FnOwner::Member(m) => of_member(m),
                _ => None,
            },
        }
    }

    /// `newCallSignature`
    fn synthetic_signature(
        &mut self,
        this: Option<TypeId>,
        params: &[(&[u8], TypeId)],
        ret: TypeId,
    ) -> SigId {
        let params = params.iter().map(|&(name, ty)| SigParam {
            name: self.atoms().intern(name),
            ty,
            optional: false,
            is_required_rest: false,
            rest: false,
            declaration: None,
        });
        self.types().intern_sig(SigData::Synth {
            type_params: ArenaBox::empty(),
            params: self.list_of(params),
            ret,
            this,
            of: ArenaBox::empty(),
            is_union: true,
        })
    }

    /// `newFunctionType`
    fn new_function_type(
        &mut self,
        this: Option<TypeId>,
        params: &[(&[u8], TypeId)],
        ret: TypeId,
    ) -> TypeId {
        let signature = self.synthetic_signature(this, params, ret);
        self.type_of_signature(signature, false)
    }

    /// `tryCreateTypeReference` for the global type `name`, whose resolver has `reportErrors`.
    fn try_create_type_reference(&mut self, name: &[u8], type_arguments: &[TypeId]) -> TypeId {
        let name = self.atoms().intern(name);
        match self.get_global_type(name, type_arguments.len(), true) {
            Some(target) => self.intern_key(TypeKey::Ref {
                target,
                args: type_arguments,
            }),
            None => TypeId::UNKNOWN,
        }
    }

    /// `newTypedPropertyDescriptorType`
    fn new_typed_property_descriptor_type(&mut self, property_type: TypeId) -> TypeId {
        let name = self.atoms().intern(b"TypedPropertyDescriptor");
        self.global_ref_checked(name, &[property_type])
    }

    /// `getParentTypeOfClassElement`
    fn get_parent_type_of_class_element(
        &mut self,
        file: FileId,
        class: ClassId,
        node: MemberId,
    ) -> TypeId {
        let class_symbol = self.class_sym(file, class);
        if self.hir(file)[node].flags.contains(Flags::STATIC) {
            self.type_of_symbol(class_symbol)
        } else {
            self.declared_type(class_symbol)
        }
    }

    /// `getTypeOfNode(node)`, which is `getTypeOfSymbol(getSymbolOfDeclaration(node))`: the function
    /// type of a method, the value type of a property or an accessor. Nothing substitutes for
    /// `this`.
    fn type_of_decorated_member(&mut self, file: FileId, class: ClassId, m: MemberId) -> TypeId {
        let holder = self.get_parent_type_of_class_element(file, class, m);
        // `declareSymbolEx`: a declaration that the symbol of its name refused has its own symbol.
        let name = if self.bound(file).is_member_in_no_table(m) {
            None
        } else {
            let key = self.hir(file)[m].key;
            self.declared_member_name(file, key)
        };
        match name.and_then(|name| self.prop_ref(holder, name)) {
            Some((prop, _)) => self.type_of_prop(prop, MapperId::IDENTITY),
            None => self.type_of_member_declaration(file, m),
        }
    }

    /// The function type of this single declaration of a method, ignoring its other declarations:
    /// `getOrCreateTypeFromSignature(getSignatureFromDeclaration(node))`.
    fn type_of_method_declaration(&mut self, file: FileId, m: MemberId) -> TypeId {
        let bound = self.bound(file);
        let func = self.hir(file)[m].func;
        let around = bound.scopes[bound.fns[func.idx()].scope.idx()].parent;
        let mapper = self.identity_mapper_for_fns(file, around, &[(file, func)]);
        self.intern_key(TypeKey::Fns {
            decls: &[(file, func)],
            mapper,
        })
    }

    /// `getDecoratorCallSignature`. `None`: the target cannot be decorated.
    pub(super) fn decorator_call_signature(
        &mut self,
        file: FileId,
        owner: DecoratorOwner,
    ) -> Option<SigId> {
        if self.hir(file).legacy_decorators {
            self.get_legacy_decorator_call_signature(file, owner)
        } else {
            self.get_es_decorator_call_signature(file, owner)
        }
    }

    /// `getLegacyDecoratorCallSignature`
    fn get_legacy_decorator_call_signature(
        &mut self,
        file: FileId,
        owner: DecoratorOwner,
    ) -> Option<SigId> {
        let (class, member) = self.class_of_decorated(file, owner)?;
        let hir = self.hir(file);
        match (owner, member) {
            (DecoratorOwner::Class(_), _) => {
                let class_symbol = self.class_sym(file, class);
                let target_type = self.type_of_symbol(class_symbol);
                let return_type = self.union(&[target_type, TypeId::VOID]);
                Some(self.synthetic_signature(None, &[(b"target", target_type)], return_type))
            }
            (DecoratorOwner::Param(p), Some(parent))
                if matches!(
                    hir[parent].kind,
                    MemberKind::Constructor | MemberKind::Method | MemberKind::Setter
                ) =>
            {
                // A `this` parameter is not among `params`.
                let index = p.0 - hir[hir[parent].func].params.start;
                let (target_type, key_type) = if hir[parent].kind == MemberKind::Constructor {
                    let class_symbol = self.class_sym(file, class);
                    (self.type_of_symbol(class_symbol), TypeId::UNDEFINED)
                } else {
                    (
                        self.get_parent_type_of_class_element(file, class, parent),
                        self.get_class_element_property_key_type(file, parent),
                    )
                };
                let index_type = self.number_literal(f64::from(index), false);
                Some(self.synthetic_signature(
                    None,
                    &[
                        (b"target", target_type),
                        (b"propertyKey", key_type),
                        (b"parameterIndex", index_type),
                    ],
                    TypeId::VOID,
                ))
            }
            (DecoratorOwner::Member(_), Some(node))
                if matches!(
                    hir[node].kind,
                    MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                        | MemberKind::Property
                ) =>
            {
                let target_type = self.get_parent_type_of_class_element(file, class, node);
                let key_type = self.get_class_element_property_key_type(file, node);
                let is_property_declaration = hir[node].kind == MemberKind::Property;
                if is_property_declaration && !hir[node].flags.contains(Flags::ACCESSOR) {
                    return Some(self.synthetic_signature(
                        None,
                        &[(b"target", target_type), (b"propertyKey", key_type)],
                        TypeId::VOID,
                    ));
                }
                let property_type = self.type_of_decorated_member(file, class, node);
                let descriptor_type = self.new_typed_property_descriptor_type(property_type);
                let return_type = if is_property_declaration {
                    TypeId::VOID
                } else {
                    self.union(&[descriptor_type, TypeId::VOID])
                };
                Some(self.synthetic_signature(
                    None,
                    &[
                        (b"target", target_type),
                        (b"propertyKey", key_type),
                        (b"descriptor", descriptor_type),
                    ],
                    return_type,
                ))
            }
            _ => None,
        }
    }

    /// `getClassElementPropertyKeyType`
    fn get_class_element_property_key_type(&mut self, file: FileId, element: MemberId) -> TypeId {
        let hir = self.hir(file);
        let name = hir.name(hir.node(element));
        match hir.kind(name) {
            Kind::Identifier | Kind::NumericLiteral | Kind::StringLiteral => {
                self.string_literal(hir.text(name), false)
            }
            Kind::ComputedPropertyName => match hir[element].key {
                PropKey::Computed(expression) => {
                    let name_type = self.check_computed_property_name(file, expression);
                    let is_symbol = self.is_assignable_to_kind(
                        name_type,
                        Self::is_symbol_like,
                        TypeId::SYMBOL,
                        false,
                    );
                    if is_symbol { name_type } else { TypeId::STRING }
                }
                // `["a"]`, `[0]`
                _ => TypeId::STRING,
            },
            _ => TypeId::ERROR,
        }
    }

    /// `getESDecoratorCallSignature`
    fn get_es_decorator_call_signature(
        &mut self,
        file: FileId,
        owner: DecoratorOwner,
    ) -> Option<SigId> {
        let (class, member) = self.class_of_decorated(file, owner)?;
        let hir = self.hir(file);
        match (owner, member) {
            (DecoratorOwner::Class(_), _) => {
                let class_symbol = self.class_sym(file, class);
                let target_type = self.type_of_symbol(class_symbol);
                // `newClassDecoratorContextType`
                let context_type =
                    self.try_create_type_reference(b"ClassDecoratorContext", &[target_type]);
                Some(self.new_es_decorator_call_signature(target_type, context_type, target_type))
            }
            (DecoratorOwner::Member(_), Some(node))
                if matches!(
                    hir[node].kind,
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter
                ) =>
            {
                let value_type = if hir[node].kind == MemberKind::Method {
                    self.type_of_method_declaration(file, node)
                } else {
                    self.type_of_decorated_member(file, class, node)
                };
                let this_type = self.get_parent_type_of_class_element(file, class, node);
                let target_type = match hir[node].kind {
                    // `newGetterFunctionType`
                    MemberKind::Getter => self.new_function_type(None, &[], value_type),
                    // `newSetterFunctionType`
                    MemberKind::Setter => {
                        self.new_function_type(None, &[(b"value", value_type)], TypeId::VOID)
                    }
                    _ => value_type,
                };
                let context_type = self.new_class_member_decorator_context_type_for_node(
                    file, node, this_type, value_type,
                );
                Some(self.new_es_decorator_call_signature(target_type, context_type, target_type))
            }
            (DecoratorOwner::Member(_), Some(node)) if hir[node].kind == MemberKind::Property => {
                let value_type = self.type_of_decorated_member(file, class, node);
                let this_type = self.get_parent_type_of_class_element(file, class, node);
                let type_arguments = [this_type, value_type];
                let (target_type, return_type) = if hir[node].flags.contains(Flags::ACCESSOR) {
                    (
                        self.try_create_type_reference(
                            b"ClassAccessorDecoratorTarget",
                            &type_arguments,
                        ),
                        self.try_create_type_reference(
                            b"ClassAccessorDecoratorResult",
                            &type_arguments,
                        ),
                    )
                } else {
                    // `newClassFieldDecoratorInitializerMutatorType`
                    let value = [(&b"value"[..], value_type)];
                    (
                        TypeId::UNDEFINED,
                        self.new_function_type(Some(this_type), &value, value_type),
                    )
                };
                let context_type = self.new_class_member_decorator_context_type_for_node(
                    file, node, this_type, value_type,
                );
                Some(self.new_es_decorator_call_signature(target_type, context_type, return_type))
            }
            _ => None,
        }
    }

    /// `getClassMemberDecoratorContextOverrideType`
    fn get_class_member_decorator_context_override_type(
        &self,
        name_type: TypeId,
        is_private: bool,
        is_static: bool,
    ) -> TypeId {
        let boolean = |b: bool| if b { TypeId::TRUE } else { TypeId::FALSE };
        let members = [
            (&b"name"[..], name_type),
            (b"private", boolean(is_private)),
            (b"static", boolean(is_static)),
        ]
        .into_iter()
        .map(|(name, ty)| Prop {
            name: self.atoms().intern(name),
            flags: PropFlags::empty(),
            source: PropSource::Type(ty),
            mapper: MapperId::IDENTITY,
        });
        self.synth(Shape {
            props: vec_from_iter_in(members, self.arena),
            ..Shape::new_in(self.arena)
        })
    }

    /// `newClassMemberDecoratorContextTypeForNode`
    fn new_class_member_decorator_context_type_for_node(
        &mut self,
        file: FileId,
        node: MemberId,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let hir = self.hir(file);
        let member = hir[node];
        let is_static = member.flags.contains(Flags::STATIC);
        let (key, name_kind) = hir.key_of(hir.node(node));
        let is_private = matches!(key, PropKey::Private(_));
        let name_type = match key {
            // `#x` as in the source, without the part that distinguishes it from the `#x` of other
            // classes.
            PropKey::Private(name) => {
                let text = self.atoms().intern(self.written_name(name));
                self.string_literal(text, false)
            }
            _ => self
                .literal_type_from_property_name(file, key, name_kind, member.name_pos)
                .unwrap_or(TypeId::NEVER),
        };
        let context: &[u8] = match member.kind {
            MemberKind::Method => b"ClassMethodDecoratorContext",
            MemberKind::Getter => b"ClassGetterDecoratorContext",
            MemberKind::Setter => b"ClassSetterDecoratorContext",
            _ if member.flags.contains(Flags::ACCESSOR) => b"ClassAccessorDecoratorContext",
            _ => b"ClassFieldDecoratorContext",
        };
        let context_type = self.try_create_type_reference(context, &[this_type, value_type]);
        let override_type =
            self.get_class_member_decorator_context_override_type(name_type, is_private, is_static);
        self.intersection(&[context_type, override_type])
    }

    /// `newESDecoratorCallSignature`
    fn new_es_decorator_call_signature(
        &mut self,
        target: TypeId,
        context: TypeId,
        non_optional_return_type: TypeId,
    ) -> SigId {
        let return_type = self.union(&[non_optional_return_type, TypeId::VOID]);
        self.synthetic_signature(
            None,
            &[(b"target", target), (b"context", context)],
            return_type,
        )
    }

    /// `getDecoratorArgumentCount`
    pub(super) fn decorator_argument_count(
        &self,
        file: FileId,
        owner: DecoratorOwner,
        params: &[SigParam],
    ) -> usize {
        let hir = self.hir(file);
        if !hir.legacy_decorators {
            return self.parameter_count(params).clamp(1, 2);
        }
        match owner {
            DecoratorOwner::Class(_) => 1,
            DecoratorOwner::Param(_) => 3,
            DecoratorOwner::Member(m) if hir[m].kind == MemberKind::Property => {
                if hir[m].flags.contains(Flags::ACCESSOR) {
                    3
                } else {
                    2
                }
            }
            DecoratorOwner::Member(_) => {
                if params.len() <= 2 {
                    2
                } else {
                    3
                }
            }
        }
    }

    /// The span of the decorator with the expression `e`.
    pub(super) fn decorator_position(&self, file: FileId, e: ExprId) -> Written {
        let start = self.start_of(file, e);
        let at_sign = start_of_token_before(&self.hir(file).text, start, b"@");
        Written {
            at_sign: at_sign.unwrap_or(start),
            start,
            end: self.end_of_expr(file, e),
            is_parenthesized: start != self.start_inside_parentheses(file, e),
        }
    }

    pub(super) fn report_decorators(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Decorators of a missing declaration or of a `this` parameter: `checkDecorators` never
        // visits them.
        for &(start, end) in &hir.stray_decorators {
            self.never_checked.borrow_mut().push((start, end));
            self.reported.retain(|d| {
                d.start < start || d.start >= end || d.by_emit || is_binder_diagnostic(d.code)
            });
        }
        for i in 0..hir.decorators.len() {
            let (owner, e) = hir.decorators[i];
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let written = self.decorator_position(file, e);
            let at_sign = written.at_sign;
            // A decorator in an invalid position, which `checkGrammarModifiers` reports: no other
            // diagnostic is reported between it and the declaration.
            if bound.refused_decorators.contains(&e) {
                let end = match owner {
                    DecoratorOwner::Class(c) => hir[c].name_pos,
                    DecoratorOwner::Member(m) => hir[m].name_pos,
                    DecoratorOwner::Param(p) => hir[hir[p].pat].pos,
                };
                self.never_checked.borrow_mut().push((at_sign + 1, end));
                self.reported.retain(|d| {
                    d.start <= at_sign
                        || d.start >= end
                        || d.by_emit
                        || is_binder_diagnostic(d.code)
                });
                continue;
            }
            // `checkClassDeclaration`, on the first decorator of the class.
            if hir.legacy_decorators
                && !hir.has_parse_diagnostics
                && let DecoratorOwner::Class(class) = owner
                && hir
                    .decorators
                    .iter()
                    .find(|d| d.0 == owner)
                    .is_some_and(|d| d.1 == e)
                && hir[class].members.iter().any(|m| {
                    hir[m].flags.contains(Flags::STATIC)
                        && matches!(hir[m].key, PropKey::Private(_))
                })
            {
                self.error_at((file, at_sign, written.end), 18036, &[]);
            }
            if !hir.has_parse_diagnostics
                && !written.is_parenthesized
                && let Some((from, to)) = self.invalid_syntax_in_decorator(file, e)
            {
                self.error_at((file, written.start, written.end), 1497, &[])
                    .add_related_info(Reported::bare((file, from, to), 1498));
            }
            self.check_decorator(file, owner, e, written);
        }
    }

    /// `checkGrammarDecorator`: the span of its `errorNode`. The first part of `e` that is not a
    /// name, `a.b.c`, or a call of either, and a `?.` token rather than the node that contains it.
    fn invalid_syntax_in_decorator(&self, file: FileId, e: ExprId) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        let question_dot_after = |before: ExprId| {
            let at = self.skip_trivia_from(file, self.end_of_expr(file, before));
            (at, at + 2)
        };
        // Computed only for the reported node: it reads the source text.
        let whole = |node: ExprId| (self.start_of(file, node), self.end_of_expr(file, node));
        let (mut node, mut can_have_call, mut found) = (e, true, None);
        loop {
            if node != e && is_parenthesized(hir, node) {
                return Some(whole(node));
            }
            match hir[node].kind {
                ExprKind::Instantiation { expr: inner, .. } | ExprKind::NonNull(inner) => {
                    node = inner
                }
                ExprKind::Call(c) => {
                    if !can_have_call {
                        found = Some(whole(node));
                    }
                    if hir[c].chain == Chain::Start {
                        found = Some(question_dot_after(hir[c].callee));
                    }
                    (node, can_have_call) = (hir[c].callee, false);
                }
                ExprKind::Dot { obj, chain, .. } => {
                    if chain == Chain::Start {
                        found = Some(question_dot_after(obj));
                    }
                    (node, can_have_call) = (obj, false);
                }
                ExprKind::Ident(_) => return found,
                _ => return Some(whole(node)),
            }
        }
    }

    /// `resolveDecorator`, `checkDecorator`
    fn check_decorator(
        &mut self,
        file: FileId,
        owner: DecoratorOwner,
        e: ExprId,
        written: Written,
    ) {
        let hir = self.hir(file);
        let Written {
            at_sign,
            start,
            end,
            is_parenthesized,
        } = written;
        let function = self.type_of_expr(file, e);
        let apparent = self.apparent_type(function);
        // `resolveErrorCall`
        if self.is_error_type(apparent) {
            return;
        }
        let sigs = self.signatures(apparent, false);
        let constructs = self.signatures(apparent, true).len();
        if self.is_untyped_function_call(function, apparent, sigs.len(), constructs) {
            return;
        }
        let head = match owner {
            DecoratorOwner::Class(_) => 1238,
            DecoratorOwner::Param(_) => 1239,
            DecoratorOwner::Member(m) if hir[m].kind == MemberKind::Property => 1240,
            DecoratorOwner::Member(_) => 1241,
        };
        let lists: Vec<List<'p, SigParam>> = sigs.iter().map(|&s| self.sig_params(s)).collect();
        // `isPotentiallyUncalledDecorator`, which uses the declared parameters: a parameter of type
        // `void` counts as required.
        if !sigs.is_empty()
            && !is_parenthesized
            && lists.iter().all(|params| {
                Self::min_args(params) == 0
                    && !params.last().is_some_and(|p| p.rest)
                    && params.len() < self.decorator_argument_count(file, owner, params)
            })
        {
            self.error_at(
                (file, at_sign, end),
                1329,
                &[Arg::Bytes(&self.source_text(file, start, end))],
            );
            return;
        }
        if sigs.is_empty() {
            self.invocation_error(
                (file, start, end),
                2349,
                e,
                apparent,
                (false, false),
                Some(head),
            );
            return;
        }
        let Some(expected) = self.decorator_call_signature(file, owner) else {
            return;
        };
        let node = CallLike::Decorator(owner);
        let args = self.effective_call_arguments(file, e, node);
        let this_arg = self.this_argument_of_call(file, e, node);
        let resolved = self.resolve_call(
            file,
            e,
            node,
            &sigs,
            &[],
            &args,
            this_arg,
            ExpectsReturn::Yes,
            Some(head),
        );
        // A decorator has no entry in `calls`.
        if let Some(reported) = self.call_resolution_errors.take() {
            self.reported.extend(reported);
        }
        let returned = self.with_return_type(resolved).ret;
        let expected_type = self.sig_return(expected);
        if self.is_any(returned) {
            return;
        }
        let code = match owner {
            DecoratorOwner::Param(_) => 1271,
            DecoratorOwner::Member(m)
                if hir[m].kind == MemberKind::Property && hir.legacy_decorators =>
            {
                1271
            }
            _ => 1270,
        };
        self.check_type_assignable_to(
            returned,
            expected_type,
            Some((file, start, end)),
            Some(code),
        );
    }
}
