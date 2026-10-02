//! Decorators: what one is called with, and whether it can be: 1206 1207 1249 1497, 1329, 1238 1239 1240 1241, 1270 1271.
//!
//! Follows `getLegacyDecoratorCallSignature`, `getESDecoratorCallSignature`, `resolveDecorator`, `checkDecorator` and what
//! `checkGrammarModifiers` says of decorators, of TypeScript 7.0.2's checker.go and grammarchecks.go.

use super::call::CallLike;
use super::errors::Diagnostic;
use super::*;
use crate::bind::{MemberOwner, Parent};

/// Where a decorator is written.
#[derive(Copy, Clone)]
pub(super) struct Written {
    /// Its `@`.
    pub(super) at_sign: u32,
    /// Its expression, from the parenthesis on if it is in parentheses.
    pub(super) start: u32,
    /// Where the expression ends, and the decorator with it.
    pub(super) end: u32,
    is_parenthesized: bool,
}

impl<'p> Checker<'p> {
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
        let params: Vec<SigParam> = params
            .iter()
            .map(|&(name, ty)| SigParam {
                name: self.files().atoms.intern(name),
                ty,
                optional: false,
                rest: false,
                has_declaration: false,
            })
            .collect();
        self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this,
            of: Box::new([]),
        })
    }

    /// `newFunctionType`
    fn function_type(
        &mut self,
        this: Option<TypeId>,
        params: &[(&[u8], TypeId)],
        ret: TypeId,
    ) -> TypeId {
        let sig = self.synthetic_signature(this, params, ret);
        self.synth(Shape {
            call: vec![sig],
            ..Shape::default()
        })
    }

    /// `getGlobalType` with `reportErrors`: that there is none is said, of no file.
    fn global_type(&mut self, name: &[u8], args: &[TypeId]) -> Option<TypeId> {
        let found = self
            .files()
            .atoms
            .lookup(name)
            .and_then(|name| self.files().global(name, SymFlags::TYPE));
        let Some(sym) = found else {
            self.report_global_error(2318, vec![String::from_utf8_lossy(name).into_owned()]);
            return None;
        };
        Some(self.type_reference(sym, args))
    }

    /// What the member is, as a value: the function a method is, what a property or an accessor holds.
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
            .and_then(|name| self.type_of_property(holder, name))
        {
            Some(ty) => ty,
            None => self.type_of_member_declaration(file, m),
        }
    }

    /// The function this one declaration of a method is, whatever others there are of it:
    /// `getOrCreateTypeFromSignature(getSignatureFromDeclaration(node))`.
    fn type_of_method_declaration(&mut self, file: FileId, m: MemberId) -> TypeId {
        let bound = self.bound(file);
        let func = self.hir(file)[m].func;
        let around = bound.scopes[bound.fns[func.idx()].scope.idx()].parent;
        let mapper = self.identity_mapper_for_fns(file, around, &[(file, func)]);
        self.intern(TypeData::Fns {
            decls: Box::new([(file, func)]),
            mapper,
        })
    }

    /// `getDecoratorCallSignature`. `None`: what is decorated cannot be.
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
                PropKey::Name(name) => c.string_literal(name, false),
                // What can be taken for a symbol stays what it is (`isTypeAssignableToKind`).
                PropKey::Computed(e) => {
                    let ty = c.type_of_expr(file, e);
                    if c.is_symbol_like(ty) || c.is_assignable(ty, TypeId::SYMBOL) {
                        ty
                    } else {
                        TypeId::STRING
                    }
                }
                // `#x` is no key: the error type.
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
                        let getter = self.function_type(None, &[], value);
                        (getter, getter, &b"ClassGetterDecoratorContext"[..])
                    }
                    MemberKind::Setter => {
                        let setter = self.function_type(None, &[(b"value", value)], TypeId::VOID);
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
                        self.function_type(Some(this), &[(b"value", value)], value),
                        &b"ClassFieldDecoratorContext"[..],
                    ),
                    _ => return None,
                };
                let context = self.global_type(context, &[this, value])?;
                // `newClassMemberDecoratorContextTypeForNode`, `getClassMemberDecoratorContextOverrideType`
                let is_private = matches!(hir[m].key, PropKey::Private(_));
                let name = match hir[m].key {
                    // `#x` as it is written, without what tells it from the `#x` of other classes.
                    PropKey::Private(name) => {
                        let written = self.files().atoms.intern(self.written_name(name));
                        self.string_literal(written, false)
                    }
                    // `getLiteralTypeFromPropertyName`: a number only where a number is written.
                    PropKey::Name(name)
                        if matches!(
                            hir.text.get(hir[m].pos as usize),
                            Some(b'0'..=b'9' | b'.')
                        ) =>
                    {
                        let n: f64 = self.files().atoms.text(name).parse().unwrap_or(0.0);
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
                    name: self.files().atoms.intern(name),
                    flags: PropFlags::empty(),
                    source: PropSource::Type(ty),
                    mapper: MapperId::IDENTITY,
                })
                .collect();
                let overrides = self.synth(Shape {
                    props,
                    ..Shape::default()
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

    /// Where the decorator with the expression `e` is written. The parentheses of a standard `@(x)` are only in the text.
    pub(super) fn where_decorator_is(&self, file: FileId, e: ExprId) -> Written {
        let start = self.start_of(file, e);
        let before = self
            .hir(file)
            .text
            .get(..start as usize)
            .unwrap_or_default()
            .trim_ascii_end();
        if let Some(rest) = before.strip_suffix(b"(").map(<[u8]>::trim_ascii_end)
            && rest.ends_with(b"@")
        {
            let start = before.len() as u32 - 1;
            return Written {
                at_sign: rest.len() as u32 - 1,
                start,
                end: self.end_of_bracket_at(file, start),
                is_parenthesized: true,
            };
        }
        Written {
            at_sign: start.saturating_sub(1),
            start,
            end: self.end_of_expr(file, e),
            is_parenthesized: start != self.start_inside_parentheses(file, e),
        }
    }

    pub(super) fn check_decorators(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Those of a missing declaration or of a `this` parameter: `checkDecorators` never looks at them.
        for &(start, end) in &hir.stray_decorators {
            out.retain(|d| d.start < start || d.start >= end);
        }
        let mut refused: Vec<DecoratorOwner> = Vec::new();
        for i in 0..hir.decorators.len() {
            let (owner, e) = hir.decorators[i];
            if matches!(bound.expr_parent[e.idx()], Parent::None) {
                continue;
            }
            let written = self.where_decorator_is(file, e);
            let at_sign = written.at_sign;
            // Where it cannot be: said once for what is decorated, and nothing else is said from there to what is decorated.
            if bound.refused_decorators.contains(&e) {
                let end = match owner {
                    DecoratorOwner::Class(c) => hir[c].pos.max(hir[c].name_pos),
                    DecoratorOwner::Member(m) => hir[m].pos,
                    DecoratorOwner::Param(p) => hir[hir[p].pat].pos,
                };
                out.retain(|d| d.start <= at_sign || d.start >= end);
                if !refused.contains(&owner) {
                    refused.push(owner);
                    let is_overload = matches!(owner, DecoratorOwner::Member(m) if hir[m].kind == MemberKind::Method && matches!(hir[hir[m].func].body, FnBody::None));
                    // `grammarErrorOnFirstToken`
                    if !hir.has_parse_diagnostics {
                        let code = if is_overload { 1249 } else { 1206 };
                        out.push(Diagnostic {
                            start: at_sign,
                            code,
                        });
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
                out.push(Diagnostic {
                    start: at_sign,
                    code: 18036,
                });
                self.note(at_sign, written.end, 18036, Vec::new());
            }
            // The two accessors of a property are one thing to decorate.
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
                        out.push(Diagnostic {
                            start: at_sign,
                            code: 1207,
                        });
                    }
                }
            }
            if !hir.has_parse_diagnostics
                && !written.is_parenthesized
                && !self.is_decorator_member_or_call(file, e)
            {
                out.push(Diagnostic {
                    start: written.start,
                    code: 1497,
                });
                self.note(written.start, written.end, 1497, Vec::new());
                self.relate(written.start, 1497, |c| {
                    c.invalid_syntax_in_decorator(file, e)
                        .map(|(from, to)| super::explain::Related {
                            at: Some((file, from, to)),
                            code: 1498,
                            args: Vec::new(),
                        })
                        .into_iter()
                        .collect()
                });
            }
            self.check_decorator(file, owner, e, written, out);
        }
    }

    /// `checkGrammarDecorator`: its `errorNode`, from where to where. Of all in `e` that is more than a name, `a.b.c`, or a call of either,
    /// what comes first, and a `?.` rather than what it is in.
    fn invalid_syntax_in_decorator(&self, file: FileId, e: ExprId) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        let question_dot_after = |before: ExprId| {
            let at = self.skip_trivia_from(file, self.end_of_expr(file, before));
            (at, at + 2)
        };
        let (mut node, mut can_have_call, mut found) = (e, true, None);
        loop {
            let whole = (self.start_of(file, node), self.end_of_expr(file, node));
            if node != e && is_parenthesized(hir, node) {
                return Some(whole);
            }
            match hir[node].kind {
                ExprKind::Instantiation { expr: inner, .. } | ExprKind::NonNull(inner) => {
                    node = inner
                }
                ExprKind::Call(c) => {
                    if !can_have_call {
                        found = Some(whole);
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
                _ => return Some(whole),
            }
        }
    }

    /// `checkGrammarDecorator`: whether `e`, which is not in parentheses, is a name, `a.b.c`, or a call of either.
    fn is_decorator_member_or_call(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let (mut node, mut can_have_call) = (e, true);
        loop {
            // A parenthesized expression further in is not an identifier.
            if node != e && is_parenthesized(hir, node) {
                return false;
            }
            match hir[node].kind {
                ExprKind::Instantiation { expr: inner, .. } | ExprKind::NonNull(inner) => {
                    node = inner
                }
                ExprKind::Call(c) => {
                    if !can_have_call || hir[c].chain == Chain::Start {
                        return false;
                    }
                    (node, can_have_call) = (hir[c].callee, false);
                }
                ExprKind::Dot { obj, chain, .. } => {
                    if chain == Chain::Start {
                        return false;
                    }
                    (node, can_have_call) = (obj, false);
                }
                ExprKind::Ident(_) => return true,
                _ => return false,
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
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let Written {
            at_sign,
            start,
            end,
            is_parenthesized,
        } = written;
        let function = self.type_of_expr(file, e);
        if !self.is_known(function) || self.is_uncertain(file, e) {
            return;
        }
        let apparent = self.apparent_type(function);
        if !self.is_known(apparent) {
            return;
        }
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
        // `isPotentiallyUncalledDecorator`, which goes by the parameters as declared: one that takes `void` is required.
        if !sigs.is_empty()
            && !is_parenthesized
            && lists.iter().all(|params| {
                Self::min_args(params) == 0
                    && !params.last().is_some_and(|p| p.rest)
                    && params.len() < self.decorator_argument_count(file, owner, params)
            })
        {
            out.push(Diagnostic {
                start: at_sign,
                code: 1329,
            });
            self.note(at_sign, end, 1329, vec![self.source_text(file, start, end)]);
            return;
        }
        if sigs.is_empty() {
            out.push(Diagnostic { start, code: head });
            self.note(start, end, 2349, Vec::new());
            self.explain_chain(start, 2349, |c| c.invocation_error_lines(apparent, false));
            self.explain_under(start, 2349, head, Vec::new());
            return;
        }
        let Some(expected) = self.decorator_call_signature(file, owner) else {
            return;
        };
        let given = self.sig_params(expected);
        if given.iter().any(|p| !self.is_known(p.ty)) {
            return;
        }
        let node = CallLike::Decorator(owner);
        let args = self.effective_call_arguments(file, e, node);
        let this_arg = self.this_argument_of_call(file, e, node);
        let resolved = self.resolve_among(file, e, node, &sigs, &[], &args, this_arg, true, true);
        // Only `resolve_call` keeps it.
        self.pending_failure_sig = None;
        self.report_call_resolution(file, e, node, &sigs, resolved, Some(head), out);
        let returned = resolved.ret;
        let wanted = self.sig_return(expected);
        if !self.is_known(returned)
            || self.is_any(returned)
            || !self.is_known(wanted)
            || self.is_assignable(returned, wanted)
        {
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
        out.push(Diagnostic { start, code });
        if self.explains {
            // `checkTypeAssignableTo`, for what it says.
            let mut said = Vec::new();
            self.report_not_assignable_with_end(returned, wanted, start, end, code, &mut said);
            if !said.iter().any(|d| d.start == start && d.code == code) {
                self.explain_to(start, end, code, |c| {
                    let (returned, wanted) = c.type_names_for_error_display(returned, wanted);
                    vec![returned, wanted]
                });
                self.explain_chain(start, code, |c| c.assignability_chain(returned, wanted));
                self.relate(start, code, |c| c.assignability_related(returned, wanted));
            }
        }
    }
}
