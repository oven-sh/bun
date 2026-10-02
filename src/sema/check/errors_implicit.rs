//! What is `any` for want of anything that says what it is, under `noImplicitAny`: 7005 7006 7019 7051 7031 7008 7010 7011 7013 7020
//! 7032 7033 7039.
//!
//! Follows `reportImplicitAny` of TypeScript 7.0.2's checker.go and those who call it: `widenTypeForVariableLikeDeclaration`,
//! `getTypeFromBindingElement`, `checkFunctionOrMethodDeclaration`, `checkSignatureDeclaration`, `checkMappedType`,
//! `getWidenedTypeForAssignmentDeclaration`, `getAssignmentDeclarationInitializerType`; and `getTypeOfAccessors`.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent};

/// `isEmptyArrayLiteralType`, decided by syntax because there is no `implicitNeverType`: `e` is written `[]`.
fn is_empty_array_literal(hir: &hir::File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Array(items) if items.is_empty())
}

impl Checker<'_> {
    pub(super) fn check_implicit_any(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if !self.p.files.options.no_implicit_any {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for f in 0..hir.fns.len() {
            let func = FnId(f as u32);
            // `checkSignatureDeclaration` checks the parameters of an index signature like any others.
            if matches!(bound.fns[f].owner, FnOwner::None) || hir.fns[f].kind == FnKind::StaticBlock
            {
                continue;
            }
            let is_private_ambient = self.is_private_within_ambient(file, func);
            if !is_private_ambient {
                self.check_parameters_implicitly_any(file, func, out);
            }
            let decl = &hir.fns[f];
            // `getTypeOfAccessors`: what is written decides, a type on either or a body of the getter. What that comes to plays no part.
            if matches!(decl.kind, FnKind::Getter | FnKind::Setter) {
                if !is_private_ambient
                    && self.accessor_says_nothing(file, func)
                    && let Some(start) = self.start_of_accessor_name(file, func)
                {
                    if decl.kind == FnKind::Setter {
                        let getter = self.sibling_accessor(file, func, FnKind::Getter);
                        if getter.is_none_or(|g| self.accessor_says_nothing(file, g)) {
                            out.push(Diagnostic { start, code: 7032 });
                            let end = self.end_of_name_at(file, start);
                            self.explain_to(start, end, 7032, |c| {
                                vec![c.source_text(file, start, end)]
                            });
                        }
                    } else {
                        // The setter is the one to be told, if it can be.
                        let setter = self.sibling_accessor(file, func, FnKind::Setter);
                        if setter.is_none_or(|s| {
                            self.accessor_says_nothing(file, s)
                                && self.is_private_within_ambient(file, s)
                        }) {
                            out.push(Diagnostic { start, code: 7033 });
                            let end = self.end_of_name_at(file, start);
                            self.explain_to(start, end, 7033, |c| {
                                vec![c.source_text(file, start, end)]
                            });
                        }
                    }
                }
                continue;
            }
            if decl.ret.is_some() || has_body(&decl) {
                continue;
            }
            // Nothing to go by: no body, and nothing said.
            match decl.kind {
                FnKind::ConstructSignature | FnKind::CallSignature => {
                    let code = if decl.kind == FnKind::ConstructSignature {
                        7013
                    } else {
                        7020
                    };
                    let start = self.start_of_signature(file, func);
                    out.push(Diagnostic { start, code });
                    let end = self.end_of_fn(file, func);
                    self.explain_to(start, end, code, |_| vec![]);
                }
                // `checkObjectLiteralMethod`, unlike `checkFunctionOrMethodDeclaration`, says nothing of a missing body.
                FnKind::Method if matches!(bound.fns[f].owner, FnOwner::Expr(_)) => {}
                FnKind::Decl | FnKind::Method if !is_private_ambient => {
                    // `reportImplicitAny`: one without a name is spoken of as a function expression is.
                    let code = if decl.kind == FnKind::Decl && decl.name.is_none() {
                        7011
                    } else if decl.flags.contains(Flags::REPARSED) {
                        7012
                    } else {
                        7010
                    };
                    let start = self.start_of_signature(file, func);
                    out.push(Diagnostic { start, code });
                    let is_missing = match bound.fns[f].owner {
                        FnOwner::Member(m) => {
                            matches!(hir[m].key, PropKey::None | PropKey::Name(known::empty))
                        }
                        _ => decl.name == known::empty,
                    };
                    // `GetErrorRangeForNode` has no case for a method signature: the error is on the whole of it. A name that is
                    // missing takes no room.
                    let (name_end, end) = match bound.fns[f].owner {
                        FnOwner::Member(m) => {
                            let name_end = self.end_of_member_name(file, m);
                            match bound.member_owner[m.idx()] {
                                MemberOwner::Class(_) if is_missing => {
                                    (name_end, super::explain::NO_LENGTH)
                                }
                                MemberOwner::Class(_) => (name_end, name_end),
                                _ => (name_end, hir[m].loc.end),
                            }
                        }
                        _ if is_missing => (start, super::explain::NO_LENGTH),
                        _ => (self.end_of_name_at(file, start), 0),
                    };
                    self.explain_to(start, end, code, |c| {
                        if matches!(code, 7011 | 7012) {
                            vec!["any".to_owned()]
                        } else if is_missing {
                            vec!["(Missing)".to_owned(), "any".to_owned()]
                        } else {
                            vec![c.source_text(file, start, name_end), "any".to_owned()]
                        }
                    });
                }
                _ => {}
            }
        }
        let is_checked_js = hir.is_js && self.is_check_js(file);
        if is_checked_js {
            self.check_binding_element_defaults_implicit_any(file, out);
        }
        // The patterns of variable declarations that say nothing.
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            let stmt = bound.var_stmt[d];
            if decl.ty.is_some()
                || !matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_))
                || stmt.is_none()
                // What is caught is `unknown` or `any`.
                || !matches!(hir[stmt].kind, StmtKind::Var(_))
            {
                continue;
            }
            match bound.stmt_parent[stmt.idx()] {
                Parent::None => continue,
                // What is gone through says what the variable of a `for`-`in` or a `for`-`of` is.
                Parent::Stmt(l)
                    if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt) =>
                {
                    continue;
                }
                _ => {}
            }
            if decl.init.is_none() {
                // `getTypeForVariableLikeDeclaration`: a pattern that is given nothing is what it implies.
                self.check_pattern_implicitly_any(file, decl.pat, out);
            }
        }
        if hir.mapped.iter().all(|m| m.ty.is_some()) {
            return;
        }
        for (t, node) in hir.types.iter().enumerate() {
            if let TypeNodeKind::Mapped(m) = node.kind
                && hir[m].ty.is_none()
                && !bound.is_unchecked_type(t)
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 7039,
                });
                let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                self.explain_to(node.pos, end, 7039, |_| vec![]);
            }
        }
    }

    /// `widenTypeInferredFromInitializer`, as `getBindingElementTypeFromParentType` calls it: in a JavaScript file a binding element with
    /// the default `[]` and nothing else to go by is an implicit `any[]`. 7031.
    fn check_binding_element_defaults_implicit_any(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        use crate::bind::PatParent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.pats.len() {
            let pat = PatId(i as u32);
            let PatKind::Ident(name) = hir.pats[i].kind else {
                continue;
            };
            let (pattern, default) = match bound.pat_parent[i] {
                PatParent::Prop(pattern, p) if !hir[p].is_rest => (pattern, hir[p].default),
                PatParent::Elem(pattern, e) if !hir[e].is_rest => (pattern, hir[e].default),
                _ => continue,
            };
            if default.is_none() || !is_empty_array_literal(hir, default) {
                continue;
            }
            // `WalkUpBindingElementsAndPatterns`
            let root = root_pattern(bound, pattern);
            let is_annotated = match bound.pat_parent[root.idx()] {
                PatParent::Var(d) => hir[d].ty.is_some(),
                PatParent::Param(p) => hir[p].ty.is_some(),
                _ => true,
            };
            if is_annotated {
                continue;
            }
            let any_array = self.array_of(TypeId::ANY);
            if self.type_of_pat(file, pat) != any_array {
                continue;
            }
            // An `any[]` that was found for it is not implicit.
            let taken_apart = self.type_for_binding_element_parent(file, pat, pattern);
            if self.is_any(taken_apart) {
                continue;
            }
            let taken_apart = self.type_pattern_takes_apart(file, pattern, taken_apart);
            let found = match bound.pat_parent[i] {
                PatParent::Prop(_, p) => {
                    let Some(key) = self.member_name(file, hir[p].key) else {
                        continue;
                    };
                    self.type_of_property(taken_apart, key)
                }
                PatParent::Elem(_, e) => {
                    let PatKind::Array(elems) = hir[pattern].kind else {
                        continue;
                    };
                    let index = (e.0 - elems.start) as usize;
                    Some(self.element_of_destructured(taken_apart, index, false))
                }
                _ => continue,
            };
            let empty = self.type_of_expr(file, default);
            let whole = match found {
                Some(found) => {
                    let found = self.narrow_destructured(file, pat, found);
                    let present = self.non_undefined_type(found);
                    self.union_reduced(&[present, empty])
                }
                None => empty,
            };
            if whole != empty {
                continue;
            }
            let start = hir.pats[i].pos;
            out.push(Diagnostic { start, code: 7031 });
            let end = self.end_of_pat(file, pat);
            self.explain_to(start, end, 7031, |c| {
                vec![c.atom_text(name), "any[]".to_owned()]
            });
        }
    }

    /// `isPrivateWithinAmbient`, of the member `func` is.
    fn is_private_within_ambient(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
            return false;
        };
        // `parseClassElement`: a member that says `declare` is ambient by itself.
        (hir[c].flags.contains(Flags::AMBIENT)
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration)
            && (hir[m].flags.contains(Flags::PRIVATE) || matches!(hir[m].key, PropKey::Private(_)))
    }

    /// Whether the accessor `func` gives `getTypeOfAccessors` nothing to go by: a getter neither a type nor a body, a setter no type
    /// for what it takes.
    fn accessor_says_nothing(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        match f.kind {
            FnKind::Getter => {
                f.ret.is_none()
                    && matches!(f.body, FnBody::None)
                    && !f.flags.contains(Flags::BODY_DROPPED)
            }
            _ => f.params.iter().next().is_none_or(|p| hir[p].ty.is_none()),
        }
    }

    /// Where the name of the accessor `func` starts. `None`: which property it is cannot be told.
    fn start_of_accessor_name(&mut self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (key, pos) = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => (hir[m].key, hir[m].name_pos),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => (hir[p].key, hir[p].pos),
                _ => return None,
            },
            _ => return None,
        };
        match key {
            PropKey::None => return None,
            // `hasBindableName`: a name that is worked out and is no literal or unique symbol makes a property of its own.
            PropKey::Computed(k) if self.member_name(file, key).is_none() => {
                let ty = self.type_of_expr(file, k);
                if !self.is_known(ty) || self.is_uncertain(file, k) {
                    return None;
                }
            }
            _ => {}
        }
        Some(pos)
    }

    /// Where an error about `func` as a whole goes: its name if it has one.
    fn start_of_signature(&self, file: FileId, func: FnId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => hir[m].name_pos,
            _ if hir[func].name.is_some() => hir[func].name_pos,
            _ => hir[func].pos,
        }
    }

    fn check_parameters_implicitly_any(
        &mut self,
        file: FileId,
        func: FnId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = &hir[func];
        // `getParameterTypeOfFullSignature` gives every parameter a type, if only `any`.
        if self.full_signature(file, func).is_some() {
            return;
        }
        let mut context_is_known = None;
        // A leading `this` parameter is not among `params`. The type of a `@this` tag is not its own: the tag is dropped if `this`
        // is written. In a function type that is itself written in a comment, what follows `this:` is.
        if !matches!(decl.kind, FnKind::Getter | FnKind::Setter)
            && let Some(start) = super::errors_x_signatures::this_parameter(hir, func)
            && (decl.this_ty(hir).is_none()
                || hir.is_in_jsdoc(hir[decl.this_ty(hir)].pos) && !hir.is_in_jsdoc(start))
        {
            // `getContextualThisParameterType`
            let is_told = match bound.fns[func.idx()].owner {
                FnOwner::Expr(e) => {
                    self.contextual_signature(file, func)
                        .is_some_and(|sig| self.sig_this_type(sig).is_some())
                        || !*context_is_known.get_or_insert_with(|| self.is_context_known(file, e))
                }
                _ => false,
            };
            if !is_told {
                out.push(Diagnostic { start, code: 7006 });
                self.explain_to(start, start + 4, 7006, |_| {
                    vec!["this".to_owned(), "any".to_owned()]
                });
            }
        }
        for (index, p) in decl.params.iter().enumerate() {
            let param = &hir[p];
            // Whether something is expected of it, once that has been asked.
            let mut is_expected = None;
            if matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
                let is_told = if param.ty.is_some() {
                    // `getBindingElementTypeFromParentType`: below an annotation the defaults are only looked at to see whether they
                    // can be `undefined`.
                    self.p.files.options.strict_null_checks
                } else if let FnOwner::Expr(e) = bound.fns[func.idx()].owner {
                    // What a default is depends on what is expected of it.
                    *is_expected.insert(self.contextual_param_type(file, func, index).is_some())
                        || *context_is_known.get_or_insert_with(|| self.is_context_known(file, e))
                } else {
                    true
                };
                if is_told {
                    // What is written out says what the parameter is, whatever its own default.
                    let own = if param.ty.is_none() {
                        param.default
                    } else {
                        ExprId::NONE
                    };
                    self.check_padded_defaults(file, param.pat, own, out);
                }
            }
            // `widenTypeInferredFromInitializer`: in a JavaScript file a parameter that defaults to `[]` is an implicit `any[]`.
            if hir.is_js
                && decl.kind != FnKind::Setter
                && param.ty.is_none()
                && param.default.is_some()
                && !param.flags.contains(Flags::REST)
                && is_empty_array_literal(hir, param.default)
                && let PatKind::Ident(name) = hir[param.pat].kind
                && hir.jsdoc_type(JsDocTypeOwner::Fn(func)).is_none()
                && self.is_check_js(file)
                && match bound.fns[func.idx()].owner {
                    FnOwner::Expr(e) => {
                        self.contextual_param_type(file, func, index).is_none()
                            && *context_is_known
                                .get_or_insert_with(|| self.is_context_known(file, e))
                    }
                    _ => true,
                }
            {
                out.push(Diagnostic {
                    start: param.pos,
                    code: 7006,
                });
                let end = self.end_of_param(file, p);
                self.explain_to(param.pos, end, 7006, |c| {
                    vec![c.atom_text(name), "any[]".to_owned()]
                });
            }
            if param.ty.is_some() || param.default.is_some() {
                continue;
            }
            if decl.kind == FnKind::Setter {
                // `getTypeForVariableLikeDeclaration`: the getter says what its setter takes, whatever that comes to, and nothing else
                // is ever expected of it (`isContextSensitiveFunctionOrObjectLiteralMethod`).
                if self.sibling_accessor(file, func, FnKind::Getter).is_some()
                    || self.start_of_accessor_name(file, func).is_none()
                {
                    continue;
                }
            } else {
                // What it was found to be when the function was looked at, with all that was known then.
                let resolved = self.type_of_param(file, p);
                let is_any = match hir[param.pat].kind {
                    PatKind::Ident(_) if param.flags.contains(Flags::REST) => {
                        // `assignParameterType` adds the `?` after `widenTypeForVariableLikeDeclaration` has reported.
                        let widened = if param.flags.contains(Flags::OPTIONAL) {
                            self.without_undefined(resolved)
                        } else {
                            resolved
                        };
                        self.array_element(widened)
                            .is_some_and(|ty| self.has_any_flag(ty))
                    }
                    PatKind::Ident(_) => self.has_any_flag(resolved),
                    _ => true,
                };
                if !is_any {
                    continue;
                }
                if let FnOwner::Expr(e) = bound.fns[func.idx()].owner {
                    let is_expected = match is_expected {
                        Some(is_expected) => is_expected,
                        None => self.contextual_param_type(file, func, index).is_some(),
                    };
                    if is_expected {
                        continue;
                    }
                    // Nothing is expected of it, as far as can be told.
                    if !*context_is_known.get_or_insert_with(|| self.is_context_known(file, e)) {
                        return;
                    }
                }
            }
            match hir[param.pat].kind {
                PatKind::Ident(name) => {
                    let is_signature = matches!(
                        decl.kind,
                        FnKind::CallSignature | FnKind::FunctionType
                    ) || decl.kind == FnKind::Method
                        && matches!(bound.fns[func.idx()].owner, FnOwner::Member(m) if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)));
                    let code = if is_signature && self.is_name_of_a_type(file, func, name) {
                        7051
                    } else if param.flags.contains(Flags::REST) {
                        7019
                    } else {
                        7006
                    };
                    out.push(Diagnostic {
                        start: param.pos,
                        code,
                    });
                    let is_rest = param.flags.contains(Flags::REST);
                    // A leading `this` parameter is counted, and is not among `params`.
                    let position = index + usize::from(decl.this_ty(hir).is_some());
                    // A parameter of which nothing is written takes no room.
                    let end = match self.end_of_param(file, p) {
                        end if name == known::empty && end <= param.pos => {
                            super::explain::NO_LENGTH
                        }
                        end => end,
                    };
                    self.explain_to(param.pos, end, code, |c| {
                        let name = if name == known::empty {
                            "(Missing)".to_owned()
                        } else {
                            c.atom_text(name)
                        };
                        match code {
                            7051 if is_rest => vec![format!("arg{position}"), name + "[]"],
                            7051 => vec![format!("arg{position}"), name],
                            7019 => vec![name, "any[]".to_owned()],
                            _ => vec![name, "any".to_owned()],
                        }
                    });
                }
                PatKind::Object(_) | PatKind::Array(_) => {
                    self.check_pattern_implicitly_any(file, param.pat, out)
                }
                _ => {}
            }
        }
    }

    /// `(string) => void` was meant to be `(arg0: string) => void`. `IsTypeNodeKind`
    fn is_name_of_a_type(&self, file: FileId, func: FnId, name: Atom) -> bool {
        const KEYWORDS: [&[u8]; 12] = [
            b"any",
            b"unknown",
            b"number",
            b"bigint",
            b"object",
            b"boolean",
            b"string",
            b"symbol",
            b"void",
            b"undefined",
            b"never",
            b"intrinsic",
        ];
        if KEYWORDS.contains(&self.files().atoms.bytes(name)) {
            return true;
        }
        let scope = self.bound(file).fns[func.idx()].scope;
        scope.is_some()
            && self
                .files()
                .resolve_name(file, scope, name, SymFlags::TYPE)
                .is_some()
    }

    /// `getTypeFromBindingPattern` with `reportErrors`: each name in a pattern that nothing gives a type.
    fn check_pattern_implicitly_any(
        &mut self,
        file: FileId,
        pat: PatId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut elements: Vec<(PatId, ExprId)> = Vec::new();
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    // What is left over is an object, whatever there is. A name that has to be worked out and could be anything
                    // leaves nothing in the implied type.
                    if !hir[p].is_rest && self.member_name(file, hir[p].key).is_some() {
                        elements.push((hir[p].value, hir[p].default));
                    }
                }
            }
            PatKind::Array(elems) => {
                // `[...rest]` is an array of anything, and no more is asked.
                if elems.len() == 1 && hir[elems.at(0)].is_rest {
                    return;
                }
                elements.extend(elems.iter().map(|e| (hir[e].pat, hir[e].default)));
            }
            _ => return,
        }
        for (element, default) in elements {
            if default.is_some() {
                continue;
            }
            match hir[element].kind {
                // `getTypeFromBindingElement`: what it comes to be plays no part.
                PatKind::Ident(name) => {
                    let start = hir[element].pos;
                    out.push(Diagnostic { start, code: 7031 });
                    if name == known::empty {
                        self.explain_to(start, super::explain::NO_LENGTH, 7031, |_| {
                            vec!["(Missing)".to_owned(), "any".to_owned()]
                        });
                    }
                }
                PatKind::Object(_) | PatKind::Array(_) => {
                    self.check_pattern_implicitly_any(file, element, out)
                }
                _ => {}
            }
        }
    }

    /// `padTupleType`: where the default of an array pattern in a parameter is a tuple too short for the pattern, what is past its end
    /// is `any`, and nothing says so. `default`: that of `pat`, if it is looked at.
    fn check_padded_defaults(
        &mut self,
        file: FileId,
        pat: PatId,
        default: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        if !matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
            return;
        }
        if default.is_some()
            && let PatKind::Array(elems) = hir[pat].kind
        {
            let ty = self.type_of_expr(file, default);
            let arity = match self.data(ty) {
                TypeData::Tuple { flags, .. }
                    if !flags
                        .iter()
                        .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)) =>
                {
                    Some(flags.len())
                }
                _ => None,
            };
            if let Some(arity) = arity
                && !self.is_uncertain(file, default)
            {
                for (i, e) in elems.iter().enumerate().skip(arity) {
                    let elem = &hir[e];
                    if i + 1 == elems.len() && elem.is_rest {
                        break;
                    }
                    // A hole is an element without a name, and is told off like the rest.
                    if elem.default.is_none() {
                        let start = hir[elem.pat].pos;
                        out.push(Diagnostic { start, code: 7031 });
                        let end = self.end_of_pat(file, elem.pat);
                        let is_missing = matches!(
                            hir[elem.pat].kind,
                            PatKind::Missing | PatKind::Ident(known::empty)
                        );
                        self.explain_to(start, end, 7031, |c| {
                            if is_missing {
                                vec!["(Missing)".to_owned(), "any".to_owned()]
                            } else {
                                vec![c.source_text(file, start, end), "any".to_owned()]
                            }
                        });
                    }
                }
            }
        }
        // `getBindingElementTypeFromParentType`: what comes out of `any` is `any`, and its defaults are not looked at.
        let taken_apart = self.type_of_pat(file, pat);
        if self.is_any(taken_apart) || !self.is_known(taken_apart) {
            return;
        }
        match hir[pat].kind {
            PatKind::Object(props) => props
                .iter()
                .for_each(|p| self.check_padded_defaults(file, hir[p].value, hir[p].default, out)),
            PatKind::Array(elems) => elems
                .iter()
                .for_each(|e| self.check_padded_defaults(file, hir[e].pat, hir[e].default, out)),
            _ => {}
        }
    }

    /// Whether it can be told what is expected of `e`, so that nothing being expected means just that.
    pub(super) fn is_context_known(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => e = bound.prop_owner[p.idx()],
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != e => {
                        let callee = self.type_of_expr(file, hir[c].callee);
                        return self.is_known(callee) && !self.is_uncertain(file, hir[c].callee);
                    }
                    ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::Binary {
                        op: BinOp::Or | BinOp::And | BinOp::Nullish | BinOp::Comma,
                        ..
                    } => e = parent,
                    ExprKind::Assign { target, .. } => {
                        let ty = self.type_of_expr(file, target);
                        return self.is_known(ty);
                    }
                    ExprKind::Jsx(j) => {
                        // `getContextualTypeForChildJsxExpression`: nothing is expected of a child of a fragment, nor where children go
                        // by no name.
                        let tag = hir[j].tag;
                        if tag.is_none()
                            || !matches!(
                                self.jsx_children_property_name(file),
                                super::jsx::JsxName::Name(_)
                            )
                        {
                            return true;
                        }
                        // Otherwise it is the `children` of what the tag takes, which is looked up by name for `<div>`.
                        if self.jsx_intrinsic_tag_name(file, tag).is_none() {
                            let component = self.type_of_expr(file, tag);
                            if !self.is_known(component) || self.is_uncertain(file, tag) {
                                return false;
                            }
                        }
                        return self
                            .jsx_props_type(file, parent)
                            .is_none_or(|props| self.is_known(props));
                    }
                    _ => return true,
                },
                Parent::VarInit(d) => {
                    return hir[d].ty.is_none() || {
                        let ty = self.type_from_node(file, hir[d].ty);
                        self.is_known(ty)
                    };
                }
                Parent::Stmt(_) | Parent::FnBody(_) => {
                    // What is returned is expected to be what the function around returns.
                    return match self.contextual_type(file, e) {
                        Some(ty) => self.is_known(ty),
                        None => true,
                    };
                }
                _ => return true,
            }
        }
    }
}
