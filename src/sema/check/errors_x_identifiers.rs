//! 7025 7055 (and 7010 7011 where `null` and `undefined` widen), 2842.
//!
//! Follows `checkUnusedRenamedBindingElements`, `reportErrorsFromWidening` and `reportImplicitAny` of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{FnOwner, Parent, PatParent};

impl Checker<'_> {
    pub(super) fn check_x_identifiers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &self.p.files.options;
        let (strict, no_implicit_any) = (options.strict_null_checks, options.no_implicit_any);
        let mut pass = Pass {
            c: self,
            out,
            file,
            hir,
            bound,
            strict,
            no_implicit_any,
        };
        if hir.kind == FileKind::Declaration {
            return;
        }
        pass.check_widening();
        pass.check_renamed_binding_elements();
    }
}

/// One file being gone over.
struct Pass<'c, 'p> {
    c: &'c mut Checker<'p>,
    out: &'c mut Vec<Diagnostic>,
    file: FileId,
    hir: &'p hir::File,
    bound: &'p Bound,
    /// `strictNullChecks`
    strict: bool,
    no_implicit_any: bool,
}

impl Pass<'_, '_> {
    /// Nothing is said of the body of a `with` statement, which `checkWithStatement` does not look at.
    fn report(&mut self, start: u32, code: u32) {
        if !self.hir.is_in_with(start) {
            self.out.push(Diagnostic { start, code });
        }
    }

    /// `reportErrorsFromWidening`, of what the functions yield and return: 7018, or else 7010 7011, 7025 7055.
    fn check_widening(&mut self) {
        let bound = self.bound;
        if !self.no_implicit_any || self.strict {
            return;
        }
        for f in 0..self.hir.fns.len() {
            // What is expected of a function expression says whether it is reported.
            let is_context_known = match bound.fns[f].owner {
                FnOwner::None => false,
                FnOwner::Expr(e) => self.c.is_context_known(self.file, e),
                _ => true,
            };
            if is_context_known {
                self.check_widening_of_results(FnId(f as u32));
            }
        }
    }

    /// The call and its argument that what is expected of `e` is taken from: `e` itself, or a literal or the like that `e` is in.
    fn argument_around(&self, mut e: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, bound) = (self.hir, self.bound);
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                    e = bound.prop_owner[p.idx()]
                }
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) => {
                        return (hir[c].callee != e).then_some((parent, e));
                    }
                    ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_) => e = parent,
                    _ => return None,
                },
                _ => return None,
            }
        }
    }

    /// What the parameter that `arg` is given for in `call` is declared as, if what is called has type parameters that are left to be
    /// worked out from the arguments.
    fn declared_parameter_type(&mut self, call: ExprId, arg: ExprId) -> Option<TypeId> {
        let hir = self.hir;
        let (ExprKind::Call(c) | ExprKind::New(c)) = hir[call].kind else {
            return None;
        };
        if !hir[c].type_args.is_empty() {
            return None;
        }
        let index = hir.ids(hir[c].args).position(|a| a == arg)?;
        if hir
            .ids(hir[c].args)
            .take(index)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let (file, func, _) = self
            .c
            .resolve_call(self.file, call)
            .sig
            .and_then(|sig| self.c.sig_decl(sig))?;
        let callee = self.c.type_of_expr(self.file, hir[c].callee);
        let callee = self.c.non_nullable(callee);
        for sig in self
            .c
            .signatures(callee, matches!(hir[call].kind, ExprKind::New(_)))
        {
            if !self.c.sig_type_params(sig).is_empty()
                && self
                    .c
                    .sig_decl(sig)
                    .is_some_and(|d| (d.0, d.1) == (file, func))
            {
                let params = self.c.sig_params(sig);
                return self.c.param_type_at(&params, index);
            }
        }
        None
    }

    /// What the signature expected of `func` returns (`getContextualSignatureForFunctionLikeDeclaration`). In an argument it is what the
    /// parameter is declared as that counts: `instantiateContextualType` fills in what is a type parameter itself, not what mentions one.
    fn contextual_return_type(&mut self, func: FnId) -> Option<TypeId> {
        let declared = match self.bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => self
                .argument_around(e)
                .and_then(|(call, arg)| Some((arg, self.declared_parameter_type(call, arg)?))),
            _ => None,
        };
        if let Some((arg, ty)) = declared {
            self.c.contextual.push((self.file, arg, ty));
        }
        let sig = self.c.contextual_signature(self.file, func);
        if declared.is_some() {
            self.c.contextual.pop();
        }
        sig.map(|sig| self.c.sig_return(sig))
    }

    /// The part of `getReturnTypeFromBody` that reports what widens in what `func` yields and returns.
    fn check_widening_of_results(&mut self, func: FnId) {
        let (hir, bound) = (self.hir, self.bound);
        let f = &hir[func];
        let owner = bound.fns[func.idx()].owner;
        // `yieldType`, `returnType`, `nextType`
        let mut unwidened = [None; 3];
        self.c
            .return_type_from_body(self.file, func, &mut unwidened);
        if !unwidened
            .iter()
            .flatten()
            .any(|&ty| self.c.contains_widening_type(ty, 0))
        {
            return;
        }
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let is_async = f.flags.contains(Flags::ASYNC);
        // `reportImplicitAny`: at the name, of which a function expression may have none but that of what it is given to.
        let (start, is_named) = match (f.kind, owner) {
            (FnKind::Method | FnKind::Getter, FnOwner::Member(m)) => (hir[m].name_pos, true),
            (FnKind::Method | FnKind::Getter, _) => (f.name_pos, true),
            (FnKind::Decl | FnKind::Expr, _) if f.name.is_some() => (f.name_pos, true),
            (FnKind::Expr, FnOwner::Expr(e)) => (
                self.bound.get_assigned_name(self.hir, e).unwrap_or(f.pos),
                false,
            ),
            (FnKind::Arrow, _) => (f.pos, false),
            _ => return,
        };
        // `shouldReportErrorsFromWideningWithContextualSignature`
        let expected = self.contextual_return_type(func);
        let iteration = expected
            .filter(|_| is_generator)
            .and_then(|ty| self.c.iteration_types(ty, is_async));
        let reports_yield = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.yielded)),
        };
        let reports_next = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.next)),
        };
        let reports_return = match expected {
            None => true,
            Some(ty) => {
                let ty = if is_generator {
                    iteration.map_or(ty, |t| t.returned)
                } else if is_async {
                    self.c.awaited(ty)
                } else {
                    ty
                };
                self.c.is_generic(ty)
            }
        };
        let of_return = if is_named { 7010 } else { 7011 };
        for (reports, ty, code) in [
            (
                reports_yield,
                unwidened[0],
                if is_named { 7055 } else { 7025 },
            ),
            (reports_return, unwidened[1], of_return),
            (reports_next, unwidened[2], of_return),
        ] {
            let Some(ty) = ty else { continue };
            if !reports || !self.c.report_errors_from_widening(ty) {
                continue;
            }
            self.report(start, code);
            // `GetErrorRangeForNode`
            let file = self.file;
            let end = match (f.kind, owner) {
                (FnKind::Arrow, FnOwner::Expr(e)) => self.c.error_end_inside_parentheses(file, e),
                // The first token of a function expression that nothing names.
                (FnKind::Expr, _) if start == f.pos => 0,
                _ => self.c.end_of_name_at(file, start),
            };
            self.c.explain_to(start, end, code, |c| {
                let ty = c.regular_object(ty);
                let ty = c.type_to_string(ty);
                if is_named {
                    vec![c.source_text(file, start, end), ty]
                } else {
                    vec![ty]
                }
            });
        }
    }

    // ───────────────────────────── patterns ─────────────────────────────

    /// `checkUnusedRenamedBindingElements`: 2842. In `({ a: string }) => void`, `string` is a name nobody can use.
    fn check_renamed_binding_elements(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        // `{ a }` has no property name.
        let is_renamed = |prop: &PatProp| {
            !prop.is_rest
                && matches!(hir[prop.value].kind, PatKind::Ident(_))
                && hir[prop.value].pos != prop.pos
        };
        // `NodeIsMissing(body)`
        let is_body_missing = |func: &Func| {
            matches!(func.body, FnBody::None) && !func.flags.contains(Flags::BODY_DROPPED)
        };
        for prop in hir.pat_props.iter().filter(|prop| is_renamed(prop)) {
            // `WalkUpBindingElementsAndPatterns`
            let mut outermost = prop.value;
            while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
                bound.pat_parent[outermost.idx()]
            {
                outermost = outer;
            }
            let PatParent::Param(param) = bound.pat_parent[outermost.idx()] else {
                continue;
            };
            let f = bound.param_fn[param.idx()];
            if !is_body_missing(&hir[f]) || matches!(bound.fns[f.idx()].owner, FnOwner::None) {
                continue;
            }
            let symbol = bound.pat_symbol[prop.value.idx()];
            if symbol.is_some() && !bound.expr_symbol.contains(&symbol) {
                let (file, start, property) = (self.file, hir[prop.value].pos, prop.pos);
                self.report(start, 2842);
                let is_missing = matches!(hir[prop.value].kind, PatKind::Ident(name) if self.c.files().atoms.bytes(name).is_empty());
                let end = if is_missing {
                    super::explain::NO_LENGTH
                } else {
                    0
                };
                self.c.explain_to(start, end, 2842, |c| {
                    let name = if is_missing {
                        "(Missing)".to_owned()
                    } else {
                        c.declaration_name_at(file, start)
                    };
                    vec![name, c.declaration_name_at(file, property)]
                });
                if hir[param].ty.is_none() {
                    self.c.relate(start, 2842, |c| {
                        let end = c.end_of_param(file, param);
                        vec![super::explain::Related {
                            at: Some((file, end, end)),
                            code: 2843,
                            args: vec![c.declaration_name_at(file, property)],
                        }]
                    });
                }
            }
        }
        if !self.no_implicit_any {
            return;
        }
        // `checkVariableLikeDeclaration` returns before it asks for the type of a renamed element. 7031 comes from
        // `getTypeFromBindingPattern`, which only runs once the type of the parameter is asked for: by another element of the
        // pattern, by a call, or by a comparison with another signature.
        for (i, func) in hir.fns.iter().enumerate() {
            if func.kind != FnKind::Decl || !is_body_missing(func) {
                continue;
            }
            let mut cached = None;
            for p in func.params.iter() {
                let PatKind::Object(props) = hir[hir[p].pat].kind else {
                    continue;
                };
                if !props.iter().all(|q| is_renamed(&hir[q])) {
                    continue;
                }
                let symbol = bound.fn_symbol[i];
                let is_unused = *cached.get_or_insert_with(|| {
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && !bound.expr_symbol.contains(&symbol)
                });
                if is_unused {
                    self.out.retain(|d| {
                        d.code != 7031 || !props.iter().any(|q| hir[hir[q].value].pos == d.start)
                    });
                }
            }
        }
    }
}
