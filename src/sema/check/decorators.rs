//! Decorators: the arguments a decorator is called with, and whether that call is valid: 1206 1207
//! 1249 1497, 1329, 1238 1239 1240 1241, 1270 1271.
//!
//! Follows `getLegacyDecoratorCallSignature`, `getESDecoratorCallSignature`, `resolveDecorator`,
//! `checkDecorator` and the decorator checks of `checkGrammarModifiers`, of TypeScript 7.0.2's
//! checker.go and grammarchecks.go.

use super::call::{CallLike, ExpectsReturn};
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
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Some((c, Some(m))),
            _ => None,
        };
        match owner {
            DecoratorOwner::Class(c) => Some((c, None)),
            DecoratorOwner::Member(m) => of_member(m),
            DecoratorOwner::Param(p) => match bound.fns[bound.param_fn[p.idx()].idx()].owner {
                crate::bind::FnOwner::Member(m) => of_member(m),
                _ => {
                    let _ = hir;
                    None
                }
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
            has_declaration: false,
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

    /// `getGlobalType` with `reportErrors`: a missing global type is reported, without a file.
    fn global_type(&mut self, name: &[u8], args: &[TypeId]) -> Option<TypeId> {
        let found = self
            .atoms()
            .lookup(name)
            .and_then(|name| self.files().global(name, SymFlags::TYPE));
        let Some(sym) = found else {
            self.report_global_error(2318, vec![name.to_vec()]);
            return None;
        };
        Some(self.type_reference(sym, args))
    }

    /// `getTypeOfNode(node)`, which is `getTypeOfSymbol(getSymbolOfDeclaration(node))`: the function
    /// type of a method, the value type of a property or an accessor. Nothing substitutes for
    /// `this`.
    fn type_of_decorated_member(&mut self, file: FileId, class: ClassId, m: MemberId) -> TypeId {
        let member = self.hir(file)[m];
        let sym = self.class_sym(file, class);
        let holder = if member.flags.contains(Flags::STATIC) {
            self.type_of_symbol(sym)
        } else {
            self.declared_type(sym)
        };
        match self
            .member_name(file, member.key)
            .and_then(|name| self.prop_ref(holder, name))
        {
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
        let (class, member) = self.class_of_decorated(file, owner)?;
        let hir = self.hir(file);
        let sym = self.class_sym(file, class);
        let statics = self.type_of_symbol(sym);
        let holder = |c: &mut Self, m: MemberId| {
            if hir[m].flags.contains(Flags::STATIC) {
                statics
            } else {
                c.declared_type(sym)
            }
        };
        if hir.legacy_decorators {
            // `getClassElementPropertyKeyType`
            let key_of = |c: &mut Self, m: MemberId| match hir[m].key {
                // `["a"]` and `[0]`
                PropKey::Name(_) if hir[m].flags.contains(Flags::COMPUTED_NAME) => TypeId::STRING,
                PropKey::Name(name) => c.string_literal(name, false),
                // A type assignable to symbol is used unchanged (`isTypeAssignableToKind`).
                PropKey::Computed(e) => {
                    let ty = c.type_of_expr(file, e);
                    if c.is_symbol_like(ty) || c.is_assignable(ty, TypeId::SYMBOL) {
                        ty
                    } else {
                        TypeId::STRING
                    }
                }
                // `#x` is not a property key: the error type.
                PropKey::Private(_) => TypeId::ERROR,
                PropKey::None => TypeId::STRING,
            };
            return Some(match (owner, member) {
                (DecoratorOwner::Class(_), _) => {
                    let ret = self.union(&[statics, TypeId::VOID]);
                    self.synthetic_signature(None, &[(b"target", statics)], ret)
                }
                (DecoratorOwner::Param(p), Some(m))
                    if matches!(
                        hir[m].kind,
                        MemberKind::Constructor | MemberKind::Method | MemberKind::Setter
                    ) =>
                {
                    // A `this` parameter does not count, and is not among the parameters here.
                    let index =
                        self.number_literal((p.0 - hir[hir[m].func].params.start) as f64, false);
                    let (target, key) = if hir[m].kind == MemberKind::Constructor {
                        (statics, TypeId::UNDEFINED)
                    } else {
                        (holder(self, m), key_of(self, m))
                    };
                    self.synthetic_signature(
                        None,
                        &[
                            (b"target", target),
                            (b"propertyKey", key),
                            (b"parameterIndex", index),
                        ],
                        TypeId::VOID,
                    )
                }
                (DecoratorOwner::Member(_), Some(m))
                    if matches!(
                        hir[m].kind,
                        MemberKind::Method
                            | MemberKind::Getter
                            | MemberKind::Setter
                            | MemberKind::Property
                    ) =>
                {
                    let (target, key) = (holder(self, m), key_of(self, m));
                    if hir[m].kind == MemberKind::Property
                        && !hir[m].flags.contains(Flags::ACCESSOR)
                    {
                        self.synthetic_signature(
                            None,
                            &[(b"target", target), (b"propertyKey", key)],
                            TypeId::VOID,
                        )
                    } else {
                        let value = self.type_of_decorated_member(file, class, m);
                        let descriptor = self.global_type(b"TypedPropertyDescriptor", &[value])?;
                        let ret = if hir[m].kind == MemberKind::Property {
                            TypeId::VOID
                        } else {
                            self.union(&[descriptor, TypeId::VOID])
                        };
                        self.synthetic_signature(
                            None,
                            &[
                                (b"target", target),
                                (b"propertyKey", key),
                                (b"descriptor", descriptor),
                            ],
                            ret,
                        )
                    }
                }
                _ => return None,
            });
        }
        let (target, context, result) = match (owner, member) {
            (DecoratorOwner::Class(_), _) => (
                statics,
                self.global_type(b"ClassDecoratorContext", &[statics])?,
                statics,
            ),
            (DecoratorOwner::Member(_), Some(m)) => {
                let this = holder(self, m);
                let value = if hir[m].kind == MemberKind::Method {
                    self.type_of_method_declaration(file, m)
                } else {
                    self.type_of_decorated_member(file, class, m)
                };
                let is_accessor_field =
                    hir[m].kind == MemberKind::Property && hir[m].flags.contains(Flags::ACCESSOR);
                let (target, result, context) = match hir[m].kind {
                    MemberKind::Method => (value, value, &b"ClassMethodDecoratorContext"[..]),
                    MemberKind::Getter => {
                        let getter = {
                            let sig = self.synthetic_signature(None, &[], value);
                            self.type_of_signature(sig, false)
                        };
                        (getter, getter, &b"ClassGetterDecoratorContext"[..])
                    }
                    MemberKind::Setter => {
                        let setter = {
                            let sig =
                                self.synthetic_signature(None, &[(b"value", value)], TypeId::VOID);
                            self.type_of_signature(sig, false)
                        };
                        (setter, setter, &b"ClassSetterDecoratorContext"[..])
                    }
                    MemberKind::Property if is_accessor_field => (
                        self.global_type(b"ClassAccessorDecoratorTarget", &[this, value])?,
                        self.global_type(b"ClassAccessorDecoratorResult", &[this, value])?,
                        &b"ClassAccessorDecoratorContext"[..],
                    ),
                    // `newClassFieldDecoratorInitializerMutatorType`
                    MemberKind::Property => (
                        TypeId::UNDEFINED,
                        {
                            let sig =
                                self.synthetic_signature(Some(this), &[(b"value", value)], value);
                            self.type_of_signature(sig, false)
                        },
                        &b"ClassFieldDecoratorContext"[..],
                    ),
                    _ => return None,
                };
                let context = self.global_type(context, &[this, value])?;
                // `newClassMemberDecoratorContextTypeForNode`, `getClassMemberDecoratorContextOverrideType`
                let is_private = matches!(hir[m].key, PropKey::Private(_));
                let name = match hir[m].key {
                    // `#x` as in the source, without the part that distinguishes it from the `#x`
                    // of other classes.
                    PropKey::Private(name) => {
                        let written = self.atoms().intern(self.written_name(name));
                        self.string_literal(written, false)
                    }
                    // `getLiteralTypeFromPropertyName`: a number literal type only where the source
                    // has a numeric literal.
                    PropKey::Name(name)
                        if matches!(
                            hir.text.get(hir[m].name_pos as usize),
                            Some(b'0'..=b'9' | b'.')
                        ) =>
                    {
                        let n = crate::atom::parse_number(self.atoms().bytes(name)).unwrap_or(0.0);
                        self.number_literal(n, false)
                    }
                    PropKey::Name(name) => self.string_literal(name, false),
                    PropKey::Computed(e) => {
                        let ty = self.type_of_expr(file, e);
                        self.regular(ty)
                    }
                    PropKey::None => TypeId::STRING,
                };
                let boolean = |b: bool| if b { TypeId::TRUE } else { TypeId::FALSE };
                let props = [
                    (&b"name"[..], name),
                    (b"private", boolean(is_private)),
                    (b"static", boolean(hir[m].flags.contains(Flags::STATIC))),
                ]
                .into_iter()
                .map(|(name, ty)| Prop {
                    name: self.atoms().intern(name),
                    flags: PropFlags::empty(),
                    source: PropSource::Type(ty),
                    mapper: MapperId::IDENTITY,
                });
                let overrides = self.synth(Shape {
                    props: vec_from_iter_in(props, self.arena),
                    ..Shape::new_in(self.arena)
                });
                (target, self.intersection(&[context, overrides]), result)
            }
            _ => return None,
        };
        let ret = self.union(&[result, TypeId::VOID]);
        Some(self.synthetic_signature(None, &[(b"target", target), (b"context", context)], ret))
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
        Written {
            at_sign: start.saturating_sub(1),
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
            self.reported
                .retain(|d| d.start < start || d.start >= end || d.by_emit);
        }
        let mut refused: Vec<DecoratorOwner> = Vec::new();
        for i in 0..hir.decorators.len() {
            let (owner, e) = hir.decorators[i];
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let written = self.decorator_position(file, e);
            let at_sign = written.at_sign;
            // A decorator in an invalid position: reported once per decorated declaration, and no
            // other diagnostic is reported between it and the declaration.
            if bound.refused_decorators.contains(&e) {
                let end = match owner {
                    DecoratorOwner::Class(c) => hir[c].name_pos,
                    DecoratorOwner::Member(m) => hir[m].name_pos,
                    DecoratorOwner::Param(p) => hir[hir[p].pat].pos,
                };
                self.never_checked.borrow_mut().push((at_sign + 1, end));
                self.reported
                    .retain(|d| d.start <= at_sign || d.start >= end || d.by_emit);
                if !refused.contains(&owner) {
                    refused.push(owner);
                    let is_overload = matches!(owner, DecoratorOwner::Member(m) if hir[m].kind == MemberKind::Method && matches!(hir[hir[m].func].body, FnBody::None));
                    // `grammarErrorOnFirstToken`
                    if !hir.has_parse_diagnostics {
                        let code = if is_overload { 1249 } else { 1206 };
                        self.error_at((file, at_sign, 0), code, &[]);
                    }
                }
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
            // The two accessors of a property count as one decoration target.
            if hir.legacy_decorators
                && let DecoratorOwner::Member(m) = owner
                && matches!(hir[m].kind, MemberKind::Getter | MemberKind::Setter)
                && let Some((class, _)) = self.class_of_decorated(file, owner)
                && let Some(name) = self.member_name(file, hir[m].key)
                && !refused.contains(&owner)
            {
                let is_static = hir[m].flags.contains(Flags::STATIC);
                let first = hir[class].members.iter().find(|&o| {
                    matches!(hir[o].kind, MemberKind::Getter | MemberKind::Setter)
                        && hir[o].flags.contains(Flags::STATIC) == is_static
                        && self.member_name(file, hir[o].key) == Some(name)
                });
                if let Some(first) = first
                    && first != m
                    && hir
                        .decorators
                        .iter()
                        .any(|d| d.0 == DecoratorOwner::Member(first))
                {
                    refused.push(owner);
                    if !hir.has_parse_diagnostics {
                        self.error_at((file, at_sign, 0), 1207, &[]);
                    }
                }
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
