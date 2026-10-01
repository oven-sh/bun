//! Errors about calls, `new` and tagged templates: what is called cannot be, or not with these arguments.
//!
//! The order of the checks, what is said and where follow `resolveCallExpression`, `resolveNewExpression`,
//! `resolveTaggedTemplateExpression`, `resolveCall`, `chooseOverload`, `isSignatureApplicable`, `reportCallResolutionErrors` and
//! `getArgumentArityError` of TypeScript 7.0.2's checker.go. One thing differs: an argument has one type here, the one it got
//! when the call was resolved, where they look at it again for each candidate. Whenever that leaves it open whether a candidate
//! fits, nothing is said.

use super::call::{Arg, ResolvedCall};
use super::errors::Diagnostic;
use super::explain::Line;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent};
use smallvec::SmallVec;

#[derive(PartialEq, Eq)]
pub(super) enum Applicable {
    Yes,
    /// Something is known not to fit.
    No,
    /// It depends on something that could not be found out.
    Unknown,
}

/// What `chooseOverload` leaves behind when no candidate will do, and what it held the candidates against.
struct Failed {
    args: SmallVec<[(Arg, ExprId); 4]>,
    type_args: Vec<TypeId>,
    this_arg: Option<ExprId>,
    /// `candidatesForArgumentError`
    for_argument_error: Vec<SigId>,
    /// `candidateForArgumentArityError`
    for_arity_error: Option<SigId>,
    /// `candidateForTypeArgumentError`
    for_type_argument_error: Option<SigId>,
}

/// How many arguments the candidates of a call take.
pub(super) struct ArgumentCounts {
    /// `minCount`
    pub(super) least: usize,
    /// `maxCount`
    pub(super) most: usize,
    /// `maxBelow`: the most that one requires that requires fewer than there are.
    pub(super) most_below: usize,
    /// `minAbove`: the fewest that one takes that takes more than there are.
    pub(super) least_above: usize,
    pub(super) has_rest: bool,
}

impl ArgumentCounts {
    /// `parameterRange`
    pub(super) fn expected(&self) -> String {
        if !self.has_rest && self.least < self.most {
            format!("{}-{}", self.least, self.most)
        } else {
            self.least.to_string()
        }
    }
}

impl Checker<'_> {
    pub(super) fn check_calls(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            if !matches!(
                hir.exprs[i].kind,
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_)
            ) || matches!(bound.expr_parent[i], Parent::None)
            {
                continue;
            }
            // `checkVariableLikeDeclaration` returns after `checkAliasSymbol` for `const x = require("m")`, so it never checks the call.
            if let Parent::VarInit(d) = bound.expr_parent[i]
                && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                && self.external_module_require_argument(file, d).is_some()
            {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Call(c) => self.check_call(file, e, c, false, out),
                ExprKind::New(c) => self.check_call(file, e, c, true, out),
                ExprKind::TaggedTemplate(c) => self.check_tagged_template(file, e, c, out),
                _ => {}
            }
        }
    }

    fn check_call(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        is_new: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let data = hir[c];
        // The `super` of `new super()` is that of `super.x`: an instance of the base.
        if !is_new && matches!(hir[data.callee].kind, ExprKind::Super) {
            self.check_super_call(file, e, c, out);
            return;
        }
        // Everything about the call is worked out for good before candidates are tried again.
        let resolved = self.resolve_call(file, e);
        if let Some((said, notes)) = self.p.said_of_calls_resolved_again.get_ref(&(file, e)) {
            out.extend_from_slice(said);
            self.notes.borrow_mut().extend_from_slice(notes);
        }
        let called = if is_new {
            self.type_of_expr(file, data.callee)
        } else {
            self.chain_receiver(file, data.callee, data.chain).0
        };
        if !self.is_known(called) || self.is_uncertain(file, data.callee) {
            return;
        }
        let mut said = Vec::new();
        let called = self.check_not_nullish(file, data.callee, called, &mut said);
        let stops = !said.is_empty() && self.is_any(called);
        for d in said {
            let code = match d.code {
                _ if is_new => d.code,
                18047 | 2531 => 2721,
                18048 | 2532 => 2722,
                18049 | 2533 => 2723,
                18050 if matches!(hir[data.callee].kind, ExprKind::Null) => 2721,
                18050 => 2722,
                other => other,
            };
            out.push(Diagnostic {
                start: d.start,
                code,
            });
            if code != d.code {
                let end = self.error_end_of(file, data.callee);
                self.note(d.start, end, code, Vec::new());
            }
        }
        if stops {
            return;
        }
        let apparent = self.apparent_type(called);
        if !self.is_known(apparent) {
            return;
        }
        // `resolveErrorCall`: of what is in error something has been said already. It is `any`.
        if self.is_any(called) && self.is_in_error(file, data.callee) {
            return;
        }
        let has_type_args = !data.type_args.is_empty();
        // `getSignaturesOfType` goes by `getReducedApparentType`: an intersection nothing can be has no signatures.
        let reduced = self.reduced(apparent);
        let call_sigs = self.signatures(reduced, false);
        // Nothing is made of these where what is called can be called.
        let construct_sigs = if is_new || call_sigs.is_empty() {
            self.signatures(reduced, true)
        } else {
            List::default()
        };
        if !is_new {
            if self.is_untyped_function_call(
                called,
                apparent,
                call_sigs.len(),
                construct_sigs.len(),
            ) {
                if has_type_args && !self.is_callee_in_error(file, data.callee) {
                    let node_start = self.start_inside_parentheses(file, e);
                    out.push(Diagnostic {
                        start: node_start,
                        code: 2347,
                    });
                    self.note(
                        node_start,
                        self.end_inside_parentheses(file, e),
                        2347,
                        Vec::new(),
                    );
                }
                return;
            }
            if call_sigs.is_empty() {
                // A method of `A[] | B[]` is called as that of `(A | B)[]`.
                if resolved.sig.is_some() && self.is_union(apparent) {
                    return;
                }
                if !construct_sigs.is_empty() {
                    let node_start = self.start_inside_parentheses(file, e);
                    out.push(Diagnostic {
                        start: node_start,
                        code: 2348,
                    });
                    let end = self.end_inside_parentheses(file, e);
                    self.explain_to(node_start, end, 2348, |c| vec![c.type_to_string(called)]);
                    return;
                }
                // `invocationErrorDetails`: an access in parentheses is not an access that is called.
                let is_bare = !is_parenthesized(hir, data.callee);
                let start = match hir[data.callee].kind {
                    ExprKind::Dot { name_pos, .. } if is_bare => name_pos,
                    _ => self.start_of(file, data.callee),
                };
                let code = if data.args.is_empty()
                    && is_bare
                    && self.is_get_accessor_access(file, data.callee)
                {
                    6234
                } else {
                    2349
                };
                out.push(Diagnostic { start, code });
                let end = match hir[data.callee].kind {
                    ExprKind::Dot { name_pos, .. } if is_bare => {
                        self.end_of_name_at(file, name_pos)
                    }
                    _ => self.error_end_of(file, data.callee),
                };
                self.note(start, end, code, Vec::new());
                self.explain_chain(start, code, |c| c.invocation_error_lines(apparent, false));
                self.relate(start, code, |c| {
                    let has_one_argument = data.args.len() == 1;
                    c.related_to_invocation_error(
                        file,
                        data.callee,
                        apparent,
                        false,
                        has_one_argument,
                    )
                });
                return;
            }
            self.report_call_resolution(file, e, c, &call_sigs, false, resolved, out);
            self.check_assertion_target(file, e, c, resolved.sig, out);
            return;
        }
        if self.is_any(apparent) {
            if has_type_args && !self.is_callee_in_error(file, data.callee) {
                let node_start = self.start_inside_parentheses(file, e);
                out.push(Diagnostic {
                    start: node_start,
                    code: 2347,
                });
                self.note(
                    node_start,
                    self.end_inside_parentheses(file, e),
                    2347,
                    Vec::new(),
                );
            }
            return;
        }
        if !construct_sigs.is_empty() {
            if let Some((code, class)) = self.inaccessible_constructor(file, e, construct_sigs[0]) {
                let node_start = self.start_inside_parentheses(file, e);
                out.push(Diagnostic {
                    start: node_start,
                    code,
                });
                let end = self.end_inside_parentheses(file, e);
                self.explain_to(node_start, end, code, |c| {
                    let declaring = c.declared_type(class);
                    vec![c.type_to_string(declaring)]
                });
                return;
            }
            if self.some_construct_signature_is_abstract(reduced) {
                let node_start = self.start_inside_parentheses(file, e);
                out.push(Diagnostic {
                    start: node_start,
                    code: 2511,
                });
                self.note(
                    node_start,
                    self.end_inside_parentheses(file, e),
                    2511,
                    Vec::new(),
                );
                return;
            }
            self.report_call_resolution(file, e, c, &construct_sigs, true, resolved, out);
            return;
        }
        if !call_sigs.is_empty() {
            self.report_call_resolution(file, e, c, &call_sigs, true, resolved, out);
            let node_start = self.start_inside_parentheses(file, e);
            let only = match call_sigs[..] {
                [only] => Some(only),
                _ => None,
            };
            // `resolveCall` returns a signature whether or not the arguments fit one.
            let sig = resolved.sig.or(only);
            // `signature.declaration != nil`
            let has_declaration =
                sig.map(|sig| self.sig_decl(self.p.types.sig_origin(sig)).is_some());
            if self.p.files.options.no_implicit_any {
                // `checkCallExpression`
                if has_declaration != Some(false) {
                    out.push(Diagnostic {
                        start: node_start,
                        code: 7009,
                    });
                    self.note(
                        node_start,
                        self.end_inside_parentheses(file, e),
                        7009,
                        Vec::new(),
                    );
                }
            } else if let Some(sig) = sig {
                let returned = self.sig_return(sig);
                if self.is_known(returned)
                    && returned != TypeId::VOID
                    && has_declaration == Some(true)
                {
                    out.push(Diagnostic {
                        start: node_start,
                        code: 2350,
                    });
                    self.note(
                        node_start,
                        self.end_inside_parentheses(file, e),
                        2350,
                        Vec::new(),
                    );
                }
                if self.sig_this_type(sig) == Some(TypeId::VOID) {
                    out.push(Diagnostic {
                        start: node_start,
                        code: 2679,
                    });
                    self.note(
                        node_start,
                        self.end_inside_parentheses(file, e),
                        2679,
                        Vec::new(),
                    );
                }
            }
            return;
        }
        let start = self.start_of(file, data.callee);
        out.push(Diagnostic { start, code: 2351 });
        self.note(
            start,
            self.error_end_of(file, data.callee),
            2351,
            Vec::new(),
        );
        self.explain_chain(start, 2351, |c| c.invocation_error_lines(apparent, true));
        self.relate(start, 2351, |c| {
            c.related_to_invocation_error(file, data.callee, apparent, true, false)
        });
    }

    /// What `invocationError` relates to 2349, 6234 or 2351, said of `target`, whose apparent type is `apparent`.
    /// `has_one_argument`: it is called, not made or used as a tag, and with one argument.
    fn related_to_invocation_error(
        &mut self,
        file: FileId,
        target: ExprId,
        apparent: TypeId,
        construct: bool,
        has_one_argument: bool,
    ) -> Vec<super::explain::Related> {
        let hir = self.hir(file);
        let (from, to) = self.error_range_of_expr(file, target);
        let here = |code: u32| super::explain::Related {
            at: Some((file, from, to)),
            code,
            args: Vec::new(),
        };
        let mut related = Vec::new();
        // `invocationErrorDetails`
        if let Some(awaited) = self.awaited_or_none(apparent) {
            let awaited = self.apparent_type(awaited);
            let awaited = self.reduced(awaited);
            if self.is_known(awaited) && !self.signatures(awaited, construct).is_empty() {
                related.push(here(2773));
            }
        }
        // `resolveCallExpression`
        if has_one_argument && line_breaks_after(&hir.text, self.end_of_expr(file, target) as usize)
        {
            related.push(here(2734));
        }
        // `invocationErrorRecovery`
        if let Some((module, import)) = self.originating_import(file, apparent) {
            let imported = self.type_of_symbol(module);
            if !self.signatures(imported, construct).is_empty() {
                related.push(import);
            }
        }
        related
    }

    /// `exportTypeLinks.Get(t.symbol)`, of a type `import * as ns` made: its `target`, which is what is imported, and 7038 at its
    /// `originatingImport`. The type does not say which import made it: the first in `file` that imports the same.
    fn originating_import(
        &self,
        file: FileId,
        ty: TypeId,
    ) -> Option<(Sym, super::explain::Related)> {
        let TypeData::Anon {
            origin: Origin::Namespace { module, .. },
            ..
        } = *self.data(ty)
        else {
            return None;
        };
        let (hir, files) = (self.hir(file), self.files());
        let index = hir.stmts.iter().position(|s| match s.kind {
            StmtKind::Import(i) if hir[i].namespace.is_some() => {
                let mode = files.mode_of_import(file, hir[i].mode);
                files
                    .module_of_specifier_as(file, hir[i].spec, mode)
                    .is_some_and(|of| files.module_value(of) == module)
            }
            _ => false,
        })?;
        let statement = StmtId(index as u32);
        let import = super::explain::Related {
            at: Some((file, hir[statement].pos, self.end_of_stmt(file, statement))),
            code: 7038,
            args: Vec::new(),
        };
        Some((module, import))
    }

    /// `invocationErrorDetails`: the lines under 2349, 6234 or 2351, of what has the apparent type `apparent`.
    pub(super) fn invocation_error_lines(
        &mut self,
        apparent: TypeId,
        construct: bool,
    ) -> Vec<Line> {
        let line = |code: u32, name: String, level: u32| Line {
            code,
            args: vec![name],
            level,
        };
        let (none_of_type, not_all, no_constituent, incompatible) = if construct {
            (2761, 2760, 2759, 2762)
        } else {
            (2757, 2756, 2755, 2758)
        };
        let whole = self.type_to_string(apparent);
        if !self.is_union(apparent) {
            return vec![line(none_of_type, whole, 1)];
        }
        let mut has_signatures = false;
        // The first constituent without signatures.
        let mut without = None;
        for part in self.parts_in_order(apparent) {
            let reduced = self.apparent_type(part);
            let reduced = self.reduced(reduced);
            if !self.signatures(reduced, construct).is_empty() {
                has_signatures = true;
                if without.is_some() {
                    break;
                }
            } else {
                without = without.or(Some(part));
                if has_signatures {
                    break;
                }
            }
        }
        match without {
            _ if !has_signatures => vec![line(no_constituent, whole, 1)],
            Some(part) => {
                let part = self.type_to_string(part);
                vec![line(not_all, whole, 1), line(none_of_type, part, 2)]
            }
            None => vec![line(incompatible, whole, 1)],
        }
    }

    /// `checkCallExpression`: 2776 and 2775, of a call that is a statement and asserts something.
    fn check_assertion_target(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        sig: Option<SigId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let data = hir[c];
        let Some(sig) = sig else { return };
        if data.chain == Chain::Start
            || !matches!(self.bound(file).expr_parent[e.idx()], Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::Expr(_)))
            || is_parenthesized(hir, e)
            || !self.sig_predicate(sig).is_some_and(|p| p.asserts)
        {
            return;
        }
        let code = if !is_dotted_name(hir, data.callee) {
            2776
        } else if !self.has_effects_signature(file, data.callee) {
            2775
        } else {
            return;
        };
        let start = self.start_of(file, data.callee);
        out.push(Diagnostic { start, code });
        self.note(start, self.end_of_expr(file, data.callee), code, Vec::new());
        if code == 2775 {
            self.relate(start, code, |checker| {
                checker
                    .name_in_need_of_a_type_annotation(file, data.callee)
                    .into_iter()
                    .collect()
            });
        }
    }

    /// `getTypeOfDottedName`, given the diagnostic: the first name of `e` that `getExplicitTypeOfSymbol` cannot tell the type of because
    /// it is a variable or a property whose declaration does not say it. 2782
    fn name_in_need_of_a_type_annotation(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<super::explain::Related> {
        if self.explicit_type(file, e).is_some() {
            return None;
        }
        let (at, name) = match self.hir(file)[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                self.variable_in_need_of_a_type_annotation(sym)?
            }
            ExprKind::Dot { obj, name, .. } => {
                let Some(object) = self.explicit_type(file, obj) else {
                    return self.name_in_need_of_a_type_annotation(file, obj);
                };
                let object = self.apparent_type(object);
                let (prop, _) = self.prop_ref(object, name)?;
                match &prop.source {
                    PropSource::Symbol(sym) => self.variable_in_need_of_a_type_annotation(*sym)?,
                    // Neither is `SymbolFlagsProperty`.
                    _ if prop
                        .flags
                        .intersects(PropFlags::ACCESSOR | PropFlags::METHOD) =>
                    {
                        return None;
                    }
                    _ => (self.place_of_prop(prop)?, self.prop_to_string(prop)),
                }
            }
            _ => return None,
        };
        Some(super::explain::Related {
            at: Some(at),
            code: 2782,
            args: vec![name],
        })
    }

    /// The same of what a name or an export of a namespace stands for: where it is declared, and `symbolToString`.
    fn variable_in_need_of_a_type_annotation(
        &mut self,
        sym: Sym,
    ) -> Option<((FileId, u32, u32), String)> {
        let sym = self.files().resolve_alias_if_needed(sym)?;
        if !self.files().flags(sym).intersects(SymFlags::VARIABLE) {
            return None;
        }
        Some((self.place_of_symbol(sym)?, self.symbol_to_string(sym)))
    }

    /// `getEffectsSignature`, of a call that is a statement and resolves to a signature that asserts: whether there is one.
    fn has_effects_signature(&mut self, file: FileId, callee: ExprId) -> bool {
        let Some(declared) = self.explicit_type(file, callee) else {
            return false;
        };
        let apparent = self.apparent_type(declared);
        let sigs = self.signatures(apparent, false);
        sigs.iter().any(|&sig| {
            // `hasTypePredicateOrNeverReturnType`
            self.sig_predicate(sig).is_some()
                || matches!(self.sig_decl(sig), Some((f, func, _)) if self.hir(f)[func].ret.is_some())
                    && self.sig_return(sig) == TypeId::NEVER
        })
    }

    /// `resolveCallExpression`, where what is called is `super`.
    fn check_super_call(&mut self, file: FileId, e: ExprId, c: CallId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkSuperExpression`: anywhere but right in the body of a constructor, with no function, arrow or not, in between,
        // `super` is in error, and nothing more is said.
        let mut parent = bound.expr_parent[e.idx()];
        let func = loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => bound.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(k) => Parent::Stmt(bound.case_stmt[k.idx()]),
                Parent::FnBody(f) => break f,
                _ => return,
            };
        };
        if hir[func].kind != FnKind::Constructor {
            return;
        }
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
            return;
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return;
        };
        if hir[class].extends.is_none() {
            return;
        }
        let resolved = self.resolve_call(file, e);
        // `base_types` omits `any`, `object` and type parameters, which `isValidBaseType` accepts. Whether the class has a base type
        // then depends on the return type of the first base constructor (`resolveBaseTypesOfClass`), which has to be known.
        let sym = self.class_sym(file, class);
        if self.base_types(sym).is_empty()
            && let Some(&first) = self.base_constructor_sigs(sym).first()
        {
            let instance = self.sig_return(first);
            if !self.is_known(instance) {
                return;
            }
        }
        // In a class without a base type `super` is in error too, and its type is `any`.
        let callee = hir[c].callee;
        let called = self.type_of_expr(file, callee);
        if !self.is_known(called) || self.is_any(called) || self.is_uncertain(file, callee) {
            return;
        }
        // `getInstantiatedConstructorsForTypeArguments`: the constructors of the base that take as many type arguments as the
        // `extends` clause gives, given them.
        let given = self.types_from_nodes(file, hir[class].extends_args);
        if given.iter().any(|&t| !self.is_known(t)) {
            return;
        }
        let mut sigs = Vec::new();
        for sig in self.signatures(called, true) {
            let type_params = self.sig_type_params(sig);
            if given.len() < self.min_type_argument_count(&type_params)
                || given.len() > type_params.len()
            {
                continue;
            }
            if type_params.is_empty() {
                sigs.push(sig);
                continue;
            }
            let filled = self.fill_sig_type_args(sig, &type_params, &given);
            let mapper = self.mapper_from(&type_params, &filled);
            sigs.push(self.instantiate_sig(sig, mapper));
        }
        if !sigs.is_empty() {
            self.report_call_resolution(file, e, c, &sigs, false, resolved, out);
        }
    }

    /// `resolveTaggedTemplateExpression`
    fn check_tagged_template(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let data = hir[c];
        let resolved = self.resolve_call(file, e);
        let tag = self.type_of_expr(file, data.callee);
        if !self.is_known(tag) || self.is_uncertain(file, data.callee) {
            return;
        }
        let apparent = self.apparent_type(tag);
        if !self.is_known(apparent) {
            return;
        }
        let reduced = self.reduced(apparent);
        let call_sigs = self.signatures(reduced, false);
        let constructs = self.signatures(reduced, true).len();
        if self.is_untyped_function_call(tag, apparent, call_sigs.len(), constructs) {
            return;
        }
        if call_sigs.is_empty() {
            // With parentheses around it, it is those that are the element of the array.
            let is_element = !is_parenthesized(hir, e)
                && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Array(_)));
            let start = self.start_of(file, data.callee);
            let code = if is_element { 2796 } else { 2349 };
            out.push(Diagnostic { start, code });
            self.note(
                start,
                self.error_end_of(file, data.callee),
                code,
                Vec::new(),
            );
            if !is_element {
                self.explain_chain(start, code, |c| c.invocation_error_lines(apparent, false));
                self.relate(start, code, |c| {
                    c.related_to_invocation_error(file, data.callee, apparent, false, false)
                });
            }
            return;
        }
        self.report_call_resolution(file, e, c, &call_sigs, false, resolved, out);
    }

    /// `isUntypedFunctionCall`
    pub(super) fn is_untyped_function_call(
        &mut self,
        called: TypeId,
        apparent: TypeId,
        calls: usize,
        constructs: usize,
    ) -> bool {
        self.is_any(called)
            || self.is_any(apparent) && matches!(self.data(called), TypeData::TypeParam(..))
            || calls == 0
                && constructs == 0
                && !self.is_union(apparent)
                && self.reduced(apparent) != TypeId::NEVER
                && {
                    let function = self.global_ref(known::Function, &[]);
                    self.is_assignable(called, function)
                }
    }

    /// `isErrorType`, for the type of the expression `callee`. The error type is not modelled: an expression in error has type `any`,
    /// so the syntax tells it from a declared `any`. The error type passes unchanged through `.`, `[]`, `!`, `<T>` and calls.
    pub(super) fn is_callee_in_error(&mut self, file: FileId, mut callee: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            callee = match hir[callee].kind {
                // `checkPropertyAccessExpressionOrQualifiedName`
                ExprKind::Dot {
                    obj, name, chain, ..
                } => {
                    let receiver = self.chain_receiver(file, obj, chain).0;
                    if !self.is_any(receiver) {
                        // `checkNonNullType` returns the error type for `unknown` and for a type that is only null or undefined.
                        let receiver = self.receiver_that_is_there(receiver);
                        if self.is_any(receiver) {
                            return true;
                        }
                        // A property missing from `globalThis` or from a JavaScript literal type is `anyType`.
                        return self.type_of_property(receiver, name).is_none()
                            && !matches!(
                                self.data(receiver),
                                TypeData::Anon {
                                    origin: Origin::GlobalThis,
                                    ..
                                }
                            )
                            && !self.is_js_literal_type(receiver);
                    }
                    obj
                }
                ExprKind::Index { obj, index, chain } => {
                    let receiver = self.chain_receiver(file, obj, chain).0;
                    if !self.is_any(receiver) {
                        let receiver = self.receiver_that_is_there(receiver);
                        return self.is_any(receiver)
                            || self.is_element_access_in_error(file, callee, receiver, index);
                    }
                    obj
                }
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                    let Call {
                        callee: inner,
                        chain,
                        ..
                    } = hir[call];
                    let is_new = matches!(hir[callee].kind, ExprKind::New(_));
                    let called = if is_new {
                        self.type_of_expr(file, inner)
                    } else {
                        self.chain_receiver(file, inner, chain).0
                    };
                    if !self.is_any(called) {
                        return self.is_error_call(file, callee, called, is_new);
                    }
                    inner
                }
                ExprKind::NonNull(inner) | ExprKind::Instantiation { expr: inner, .. } => inner,
                ExprKind::Ident(name) => {
                    if matches!(
                        name,
                        known::undefined | known::arguments | known::globalThis
                    ) {
                        return false;
                    }
                    let Some(sym) = self.symbol_of_identifier(file, callee, name) else {
                        return true;
                    };
                    if self.is_alias_in_error(sym)
                        || !self
                            .files()
                            .flags(sym)
                            .intersects(SymFlags::VALUE | SymFlags::ALIAS)
                    {
                        return true;
                    }
                    // The type annotation of the value declaration can resolve to the error type. An initializer is not followed: it
                    // can refer back to this expression.
                    let Some(&(decl_file, Decl::Var(pat) | Decl::Param(pat))) =
                        self.files().decls_of(sym).first()
                    else {
                        return false;
                    };
                    let is_annotated = match self.bound(decl_file).pat_parent[pat.idx()] {
                        PatParent::Param(p) => self.hir(decl_file)[p].ty.is_some(),
                        PatParent::Var(d) => self.hir(decl_file)[d].ty.is_some(),
                        _ => false,
                    };
                    return is_annotated && self.is_declared_in_error(decl_file, pat, TypeId::ANY);
                }
                // `checkSuperExpression`. The arms for `.` and `[]` only continue with a `super` of type `any`.
                ExprKind::Super => {
                    let class = match self.this_container(file, callee) {
                        Some(Ok(f)) => match bound.fns[f.idx()].owner {
                            FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                                MemberOwner::Class(_)
                                    if self.is_in_constructor_argument_initializer(
                                        file, callee, f,
                                    ) =>
                                {
                                    return true;
                                }
                                MemberOwner::Class(class) => class,
                                _ => return true,
                            },
                            // `anyType` in a method or an accessor of an object literal.
                            FnOwner::Expr(x)
                                if matches!(
                                    hir[f].kind,
                                    FnKind::Method | FnKind::Getter | FnKind::Setter
                                ) && matches!(bound.expr_parent[x.idx()], Parent::Prop(_)) =>
                            {
                                return false;
                            }
                            _ => return true,
                        },
                        Some(Err((class, _))) => class,
                        None => return true,
                    };
                    let extends = hir[class].extends;
                    if extends.is_none() {
                        return true;
                    }
                    let constructor = self.type_of_expr(file, extends);
                    if !self.is_any(constructor) {
                        // `resolveBaseTypesOfClass`: the base type is the return type of the first base constructor, which can be a
                        // declared `any`. Otherwise the class has no base type.
                        let sym = self.class_sym(file, class);
                        let instance = self
                            .base_constructor_sigs(sym)
                            .first()
                            .map(|&first| self.sig_return(first));
                        return instance != Some(TypeId::ANY);
                    }
                    // The base type is the base constructor type, which is the type of the `extends` expression.
                    extends
                }
                _ => return false,
            };
        }
    }

    /// Whether `checkElementAccessExpression` returns the error type for `e`, which is `receiver[index]`. `receiver` is not `any`.
    fn is_element_access_in_error(
        &mut self,
        file: FileId,
        e: ExprId,
        receiver: TypeId,
        index: ExprId,
    ) -> bool {
        let hir = self.hir(file);
        let is_string_literal_like = !is_parenthesized(hir, index)
            && match hir[index].kind {
                ExprKind::String(_) => true,
                ExprKind::Template { exprs, .. } => exprs.is_empty(),
                _ => false,
            };
        if !is_string_literal_like && self.is_const_enum_object(receiver) {
            return true;
        }
        // `getWidenedType(exprType)`, after which the type is no longer an object literal type.
        let receiver = if self.is_written_or_called(file, e) {
            self.regular_object(receiver)
        } else {
            receiver
        };
        let key = if self.is_for_in_variable_for_numeric_names(file, index) {
            TypeId::NUMBER
        } else {
            self.type_of_expr(file, index)
        };
        // `getIndexedAccessTypeOrUndefined` returns nil. A JavaScript literal type gives `anyType` instead.
        self.indexed_access_for_read(receiver, key) == TypeId::UNRESOLVED
            && !self.is_js_literal_type(receiver)
    }

    /// Whether the call, `new` or tagged template `e` resolves to `unknownSignature`, which returns the error type
    /// (`resolveErrorCall`). `called` is the type of the callee and is not `any`.
    fn is_error_call(&mut self, file: FileId, e: ExprId, called: TypeId, is_new: bool) -> bool {
        // A signature returns its declared type, also when the arguments do not fit it (`getCandidateForOverloadFailure`).
        if self.resolve_call(file, e).sig.is_some() {
            return false;
        }
        let called = self.receiver_that_is_there(called);
        if is_new || self.is_any(called) {
            return true;
        }
        // `resolveUntypedCall` returns `anySignature`.
        let apparent = self.apparent_type(called);
        let reduced = self.reduced(apparent);
        let (calls, constructs) = (
            self.signatures(reduced, false).len(),
            self.signatures(reduced, true).len(),
        );
        !self.is_untyped_function_call(called, apparent, calls, constructs)
    }

    /// `isInConstructorArgumentInitializer`: whether `func` is a constructor and `e` is in one of its parameters, with no other
    /// function in between.
    fn is_in_constructor_argument_initializer(&self, file: FileId, e: ExprId, func: FnId) -> bool {
        let bound = self.bound(file);
        if self.hir(file)[func].kind != FnKind::Constructor {
            return false;
        }
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::ParamDefault(p) => return bound.param_fn[p.idx()] == func,
                Parent::Expr(x) if x.is_some() => bound.expr_parent[x.idx()],
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                Parent::Prop(_)
                | Parent::PatPropDefault(_)
                | Parent::PatElemDefault(_)
                | Parent::ClassExtends(_) => self.outward(file, parent),
                _ => return false,
            };
        }
    }

    /// `someSignature(constructSignatures, abstract)`: what is made for a union is abstract if what one of the members has is.
    fn some_construct_signature_is_abstract(&mut self, ty: TypeId) -> bool {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            return parts
                .iter()
                .any(|&part| self.some_construct_signature_is_abstract(part));
        }
        self.signatures(ty, true)
            .iter()
            .any(|&sig| self.is_abstract_signature(sig))
    }

    /// Whether `e` is `a.b` or `a["b"]` where `b` is declared with `get` (`invocationErrorDetails`).
    fn is_get_accessor_access(&mut self, file: FileId, e: ExprId) -> bool {
        let (obj, name) = match self.hir(file)[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, name),
            // `getPropertyTypeForIndexType` records the property as the symbol of the element access (`AccessFlagsCacheSymbol`).
            ExprKind::Index { obj, index, .. } => {
                let key = self.type_of_expr(file, index);
                let Some(name) = self.property_name_of_type(key) else {
                    return false;
                };
                (obj, name)
            }
            _ => return false,
        };
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.apparent_type(receiver);
        let Some((prop, _)) = self.prop_ref(receiver, name) else {
            return false;
        };
        match &prop.source {
            PropSource::Members(members) => members
                .iter()
                .any(|&(f, m)| self.hir(f)[m].kind == MemberKind::Getter),
            PropSource::Literal(f, p) => self.hir(*f)[*p].kind == PropKind::Getter,
            _ => false,
        }
    }

    /// `isConstructorAccessible`: 2673, 2674
    pub(super) fn why_constructor_not_accessible(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
    ) -> Option<u32> {
        self.inaccessible_constructor(file, e, sig)
            .map(|(code, _)| code)
    }

    /// The same, and the class that declares the constructor.
    fn inaccessible_constructor(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
    ) -> Option<(u32, Sym)> {
        // The declaration of a signature is that of the one it is a clone of.
        let mut sig = sig;
        let mut steps = 0;
        let (class, of, func) = loop {
            match *self.p.types.sig(self.p.types.sig_origin(sig)) {
                SigData::Construct {
                    class, file, func, ..
                } => break (class, file, func),
                // `getDefaultConstructSignatures` clones the signatures of the base.
                SigData::DefaultConstruct { class, base, .. } => {
                    steps += 1;
                    if steps > 64 || self.base_types(class).is_empty() {
                        return None;
                    }
                    sig = *self.base_constructor_sigs(class).get(base as usize)?;
                }
                _ => return None,
            }
        };
        let modifiers = self.hir(of)[func].flags & (Flags::PRIVATE | Flags::PROTECTED);
        if modifiers.is_empty() {
            return None;
        }
        let enclosing: Vec<Sym> = self
            .enclosing_classes(file, e)
            .into_iter()
            .map(|c| {
                self.files()
                    .sym(file, self.bound(file).class_symbol[c.idx()])
            })
            .collect();
        if enclosing.contains(&class) {
            return None;
        }
        if modifiers.contains(Flags::PROTECTED)
            && let Some(&containing) = enclosing.first()
            && self.has_protected_accessible_base(class, containing, 0)
        {
            return None;
        }
        let code = if modifiers.contains(Flags::PRIVATE) {
            2673
        } else {
            2674
        };
        Some((code, class))
    }

    /// `typeHasProtectedAccessibleBase`: whether `class` comes from `target` by way of first bases. (What `findMixins` would
    /// leave out of an intersection is left in: it is after constructor types, and these are instances.)
    fn has_protected_accessible_base(&mut self, target: Sym, class: Sym, depth: u32) -> bool {
        let Some(&first) = self.base_types(class).first() else {
            return false;
        };
        if depth > 64 {
            return false;
        }
        match self.data(first) {
            // Of an intersection, the classes and interfaces in it that are not instantiations of generic ones.
            TypeData::Intersection(parts) => parts.iter().any(|&part| match self.data(part) {
                TypeData::Ref { target: base, args } if args.is_empty() => {
                    *base == target || self.has_protected_accessible_base(target, *base, depth + 1)
                }
                _ => false,
            }),
            TypeData::Ref { target: base, .. } => {
                *base == target || self.has_protected_accessible_base(target, *base, depth + 1)
            }
            _ => false,
        }
    }

    /// `hasCorrectTypeArgumentArity`
    pub(super) fn has_correct_type_argument_arity(
        &mut self,
        type_params: &[TypeId],
        given: usize,
    ) -> bool {
        given == 0
            || given >= self.min_type_argument_count(type_params) && given <= type_params.len()
    }

    /// `getMinTypeArgumentCount`
    pub(super) fn min_type_argument_count(&mut self, type_params: &[TypeId]) -> usize {
        (0..type_params.len())
            .rev()
            .find(|&i| self.default_of_type_param(type_params[i]).is_none())
            .map_or(0, |i| i + 1)
    }

    /// `hasCorrectArity`. `is_incomplete`: the `)` of the call is missing or the tagged template is unterminated, so the lower bound is
    /// not checked (`callIsIncomplete`).
    fn has_correct_arity_for(
        &mut self,
        params: &[SigParam],
        args: &[(Arg, ExprId)],
        is_incomplete: bool,
    ) -> bool {
        let spread = args.iter().position(|a| matches!(a.0, Arg::Spread(..)));
        self.has_correct_arity_for_count(params, args.len(), spread, is_incomplete)
    }

    /// `getThisArgumentOfCall`: the object of the access that is called, whatever assertions are around the access, and how that
    /// access is chained.
    pub(super) fn this_argument_of_call(
        &self,
        file: FileId,
        mut callee: ExprId,
    ) -> Option<(ExprId, Chain)> {
        let hir = self.hir(file);
        loop {
            callee = match hir[callee].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    return Some((obj, chain));
                }
                _ => return None,
            };
        }
    }

    /// The types of the arguments, if they were all found out.
    fn known_argument_types(
        &mut self,
        file: FileId,
        args: &[(Arg, ExprId)],
    ) -> Option<SmallVec<[TypeId; 8]>> {
        let mut types = SmallVec::new();
        for &(arg, _) in args {
            let ty = self.arg_type(file, arg);
            if !self.is_known(ty) || matches!(arg, Arg::Expr(x) if self.is_uncertain(file, x)) {
                return None;
            }
            types.push(ty);
        }
        Some(types)
    }

    /// Whether it is certain that none of `sigs` takes the arguments of the call, `new` or tagged template `e`, which may still be
    /// in the middle of being resolved. `resolved.sig`: where there is one signature and that is generic, it as inferred from
    /// all of the arguments (the `checkCandidate` of `chooseOverload`), never what `getCandidateForOverloadFailure` makes of it.
    pub(super) fn no_candidate_applies(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        sigs: &[SigId],
        is_new: bool,
        resolved: ResolvedCall,
    ) -> bool {
        self.failed_candidates(file, e, c, sigs, is_new, resolved)
            .is_some()
    }

    /// Whether `sig` is `candidate`, or `candidate` with something for its type parameters.
    fn is_declared_where(&self, sig: SigId, candidate: SigId) -> bool {
        sig == candidate
            || match (self.p.types.sig(sig), self.p.types.sig(candidate)) {
                (
                    SigData::Decl { file, func, .. },
                    SigData::Decl {
                        file: other_file,
                        func: other,
                        ..
                    },
                ) => (file, func) == (other_file, other),
                (
                    SigData::Construct { class, func, .. },
                    SigData::Construct {
                        class: other_class,
                        func: other,
                        ..
                    },
                ) => (class, func) == (other_class, other),
                _ => false,
            }
    }

    /// `chooseOverload`, by assignability. `None`: a candidate applies, or it cannot be told.
    fn failed_candidates(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        sigs: &[SigId],
        is_new: bool,
        resolved: ResolvedCall,
    ) -> Option<Failed> {
        let hir = self.hir(file);
        let data = hir[c];
        let candidates = self.candidates_in_order(sigs);
        // `getEffectiveCallArguments`: of a tagged template the pieces of text come first. There is no node for the template:
        // the whole stands in for it.
        let mut args: SmallVec<[(Arg, ExprId); 4]> = SmallVec::new();
        if matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
            let strings = self.global_ref(known::TemplateStringsArray, &[]);
            args.push((Arg::Type(strings), e));
        }
        for a in hir.ids(data.args) {
            self.each_effective_arg(file, a, |arg| args.push((arg, a)));
        }
        // A call that is being resolved cannot say what it expects of an argument. The candidate at hand does, in
        // `is_signature_applicable`. The arguments of any other call are what they are, whatever they are held against.
        let is_under_way = self.stack.contains(&Query::Call(file, e));
        let types = if is_under_way {
            None
        } else {
            Some(self.known_argument_types(file, &args)?)
        };
        // `resolveCall`: the type arguments of `super<T>()` are not looked at.
        let is_super_call = !is_new && matches!(hir[data.callee].kind, ExprKind::Super);
        let type_args = if is_super_call {
            Vec::new()
        } else {
            self.types_from_nodes(file, data.type_args)
        };
        if type_args.iter().any(|&t| !self.is_known(t)) {
            return None;
        }
        let this_arg = if is_new {
            None
        } else {
            self.this_argument_of_call(file, data.callee)
                .map(|(obj, _)| obj)
        };
        // What type arguments are inferred from, which they are not for the only candidate of a call that is resolved.
        let plain: SmallVec<[Arg; 4]> = if candidates.len() > 1 || resolved.sig.is_none() {
            args.iter().map(|a| a.0).collect()
        } else {
            SmallVec::new()
        };
        let applicability = |checker: &mut Self, sig: SigId| match &types {
            Some(types) => checker
                .signature_applicability(file, e, c, &args, types, sig, this_arg, is_new, None),
            None => checker.is_signature_applicable(file, e, c, &args, sig, this_arg, is_new, None),
        };
        // `callIsIncomplete`. For a call `close_pos` is where the parser expected the `)`. The default library has no text.
        let is_incomplete = if matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
            data.close_pos == INCOMPLETE_TEMPLATE
        } else {
            data.close_pos != u32::MAX
                && !hir.text.is_empty()
                && hir.text.get(data.close_pos as usize) != Some(&b')')
        };
        // All that is asked is whether any of them applies, and the call has been resolved to one that most likely does. The ones before it do
        // not, which takes inferring their type arguments to find out.
        if candidates.len() > 1
            && type_args.is_empty()
            && !is_under_way
            && let Some(sig) = resolved.sig
            // Not what is made up of all of them when none applies.
            && candidates
                .iter()
                .any(|&candidate| self.is_declared_where(sig, candidate))
            && {
                let params = self.sig_params(sig);
                self.has_correct_arity_for(&params, &args, is_incomplete)
            }
            && applicability(self, sig) == Applicable::Yes
        {
            return None;
        }
        let mut for_argument_error: Vec<SigId> = Vec::new();
        let mut for_arity_error = None;
        let mut for_type_argument_error = None;
        for &candidate in &candidates {
            let type_params = self.sig_type_params(candidate);
            let params = self.sig_params(candidate);
            if !self.has_correct_type_argument_arity(&type_params, type_args.len())
                || !self.has_correct_arity_for(&params, &args, is_incomplete)
            {
                continue;
            }
            let mut check = candidate;
            if !type_params.is_empty() {
                if !type_args.is_empty() {
                    match self.failing_type_argument(candidate, &type_params, &type_args) {
                        Ok(None) => {}
                        Ok(Some(_)) => {
                            for_type_argument_error = Some(candidate);
                            continue;
                        }
                        Err(()) => return None,
                    }
                }
                check = match resolved.sig {
                    Some(sig) if candidates.len() == 1 => sig,
                    _ => {
                        let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
                        let sig = self.instantiate_for_call(
                            file, e, candidate, &type_args, &plain, this_arg, false,
                        );
                        self.keeps_arg_contexts = outer;
                        sig
                    }
                };
                // With a rest parameter that is a type parameter, how many it takes is only known now.
                if self.non_array_rest_type(&params).is_some() {
                    let instantiated = self.sig_params(check);
                    if !self.has_correct_arity_for(&instantiated, &args, is_incomplete) {
                        for_arity_error = Some(check);
                        continue;
                    }
                }
            }
            match applicability(self, check) {
                Applicable::Yes | Applicable::Unknown => return None,
                Applicable::No => for_argument_error.push(check),
            }
        }
        // `chooseOverload`: the first candidate that is applicable without the context sensitive arguments sets `argCheckMode` to
        // `CheckModeNormal` for good and assigns the parameter types of those arguments (`NodeCheckFlagsContextChecked`). Every later
        // attempt infers from them as from any other argument. `resolve_among` made those attempts, so `resolved.sig` is accepted
        // if it is the result of such an attempt.
        if !is_under_way
            && candidates.len() > 1
            && type_args.is_empty()
            && !for_argument_error.is_empty()
            && let Some(accepted) = resolved.sig
            && !for_argument_error.contains(&accepted)
            && plain
                .iter()
                .any(|a| matches!(a, Arg::Expr(x) if self.is_context_sensitive(file, *x)))
        {
            for &candidate in &candidates {
                let params = self.sig_params(candidate);
                if self.sig_type_params(candidate).is_empty()
                    || !self.has_correct_arity_for(&params, &args, is_incomplete)
                {
                    continue;
                }
                let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
                let attempt = self.instantiate_for_call_as(
                    file,
                    e,
                    candidate,
                    &[],
                    &plain,
                    this_arg,
                    false,
                    true,
                );
                self.keeps_arg_contexts = outer;
                if attempt != accepted {
                    continue;
                }
                if applicability(self, accepted) != Applicable::No {
                    return None;
                }
                break;
            }
        }
        Some(Failed {
            args,
            type_args,
            this_arg,
            for_argument_error,
            for_arity_error,
            for_type_argument_error,
        })
    }

    /// `getResolvedSignature`: a call that is asked for while it is being resolved is resolved once more, and `resolveCall` reports what
    /// is wrong with it as things stand then. `resolved`: what it was resolved to that time. Only the first time is looked at.
    /// `check_call` says what is kept here.
    pub(super) fn report_call_resolved_again(
        &mut self,
        file: FileId,
        e: ExprId,
        resolved: ResolvedCall,
    ) {
        let p = self.p;
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[e].kind else {
            return;
        };
        let data = hir[c];
        if self.provisional > 0
            || matches!(hir[data.callee].kind, ExprKind::Super)
            || p.said_of_calls_resolved_again.get_ref(&(file, e)).is_some()
        {
            return;
        }
        let called = self.chain_receiver(file, data.callee, data.chain).0;
        if !self.is_known(called) || self.is_uncertain(file, data.callee) {
            return;
        }
        let apparent = self.apparent_type(called);
        let reduced = self.reduced(apparent);
        let sigs = self.signatures(reduced, false);
        if sigs.is_empty() {
            return;
        }
        let noted = self.notes.borrow().len();
        let mut said = Vec::new();
        self.report_call_resolution(file, e, c, &sigs, false, resolved, &mut said);
        let notes = self.notes.borrow_mut().split_off(noted);
        p.said_of_calls_resolved_again
            .insert_ref((file, e), (said, notes));
    }

    /// `resolveCall`, for what it reports.
    fn report_call_resolution(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        sigs: &[SigId],
        is_new: bool,
        resolved: ResolvedCall,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let data = hir[c];
        // `resolveCall`: with several candidates the errors come from the assignable pass. The subtype pass has checked every function
        // among the arguments (`NodeCheckFlagsContextChecked`), so no attempt of the assignable pass infers from their annotations.
        let mut previous = Vec::new();
        if sigs.len() > 1 && data.type_args.is_empty() {
            for arg in hir.ids(data.args) {
                self.mark_context_checked(file, arg, &mut previous);
            }
        }
        let failed = self.failed_candidates(file, e, c, sigs, is_new, resolved);
        for (function, entry) in previous {
            match entry {
                Some(entry) => self.context_checked_for.insert((file, function), entry),
                None => self.context_checked_for.remove(&(file, function)),
            };
        }
        let Some(failed) = failed else { return };
        let Failed {
            args,
            type_args,
            this_arg,
            for_argument_error,
            for_arity_error,
            for_type_argument_error,
        } = failed;
        // `reportCallResolutionErrors`
        if let Some(&last) = for_argument_error.last() {
            let mut said = Vec::new();
            self.is_signature_applicable(
                file,
                e,
                c,
                &args,
                last,
                this_arg,
                is_new,
                Some(&mut said),
            );
            let is_overloaded = for_argument_error.len() > 1;
            let related = if said.is_empty() {
                Vec::new()
            } else {
                self.related_to_failed_candidate(
                    file,
                    e,
                    c,
                    &args,
                    &type_args,
                    this_arg,
                    is_new,
                    last,
                    is_overloaded,
                )
            };
            for d in said {
                let d = if is_overloaded {
                    self.explain_under(d.start, d.code, 2770, Vec::new());
                    self.explain_under(d.start, 2770, 2769, Vec::new());
                    Diagnostic {
                        start: d.start,
                        code: 2769,
                    }
                } else {
                    d
                };
                if !related.is_empty() {
                    self.relate(d.start, d.code, |_| related.clone());
                }
                out.push(d);
            }
        } else if let Some(sig) = for_arity_error {
            self.report_argument_arity(file, e, c, is_new, &[sig], &args, out);
        } else if let Some(candidate) = for_type_argument_error {
            let type_params = self.sig_type_params(candidate);
            if let Ok(Some((index, given, constraint))) =
                self.failing_type_argument(candidate, &type_params, &type_args)
            {
                let node = hir.ids(data.type_args).nth(index).unwrap();
                let end = self.end_of_type_node(file, node);
                // 2344, or what says more.
                self.report_not_assignable_with_end(
                    given,
                    constraint,
                    hir[node].pos,
                    end,
                    2344,
                    out,
                );
            }
        } else {
            let mut fitting = Vec::new();
            for &sig in sigs {
                let type_params = self.sig_type_params(sig);
                if self.has_correct_type_argument_arity(&type_params, type_args.len()) {
                    fitting.push(sig);
                }
            }
            if fitting.is_empty() {
                self.report_type_argument_arity(file, c, sigs, type_args.len(), out);
            } else {
                self.report_argument_arity(file, e, c, is_new, &fitting, &args, out);
            }
        }
    }

    /// `GetErrorRangeForNode`, of the declaration `func` of a signature.
    pub(super) fn place_of_signature_declaration(
        &self,
        file: FileId,
        func: FnId,
    ) -> (FileId, u32, u32) {
        let hir = self.hir(file);
        // There is no text of the default library.
        if hir.text.is_empty() {
            return (file, hir[func].pos, hir[func].pos);
        }
        let (start, end) = match self.bound(file).fns[func.idx()].owner {
            FnOwner::Stmt(s) => self.error_range_of_stmt(file, s),
            FnOwner::Expr(e) if hir[func].kind == FnKind::Expr => (
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            _ => self.error_range_of_fn(file, func),
        };
        (file, start, end)
    }

    /// `The last overload is declared here.`, of the candidate `last`. Nothing if it has no declaration.
    pub(super) fn last_overload_declared_here(
        &mut self,
        last: SigId,
    ) -> Vec<super::explain::Related> {
        let declared = self.declared_sig(last);
        match self.sig_decl(declared) {
            Some((file, func, _)) => vec![super::explain::Related {
                at: Some(self.place_of_signature_declaration(file, func)),
                code: 2771,
                args: Vec::new(),
            }],
            None => Vec::new(),
        }
    }

    /// `addImplementationSuccessElaboration`: the first declaration with a body of what declares the overload `failed`, as
    /// `getSignatureFromDeclaration` has it. `None`: there is none, or nothing else declares what `failed` declares.
    fn implementation_of_overload(&mut self, failed: SigId) -> Option<SigId> {
        let declared = self.declared_sig(failed);
        let SigData::Construct {
            class, file, func, ..
        } = *self.p.types.sig(declared)
        else {
            return self.implementation_signature(failed);
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
            return None;
        };
        let MemberOwner::Class(written) = bound.member_owner[member.idx()] else {
            return None;
        };
        let constructors: SmallVec<[FnId; 4]> = hir[written]
            .members
            .iter()
            .filter(|&m| hir[m].kind == MemberKind::Constructor)
            .map(|m| hir[m].func)
            .collect();
        if constructors.len() < 2 {
            return None;
        }
        let implementation = constructors.iter().copied().find(|&f| {
            !matches!(hir[f].body, FnBody::None) || hir[f].flags.contains(Flags::BODY_DROPPED)
        })?;
        // The mapper the construct signatures of the class have as they are declared.
        let statics = self.type_of_symbol(class);
        let mapper = self.signatures(statics, true).iter().find_map(|&sig| {
            match *self.p.types.sig(sig) {
                SigData::Construct {
                    class: of,
                    file: at,
                    mapper,
                    ..
                } if of == class && at == file => Some(mapper),
                _ => None,
            }
        })?;
        Some(self.p.types.intern_sig(SigData::Construct {
            class,
            file,
            func: implementation,
            mapper,
        }))
    }

    /// `addImplementationSuccessElaboration`: whether `chooseOverload` takes `implementation`, as the only candidate, for the call,
    /// `new` or tagged template `e`. `false` where it cannot be told.
    fn does_implementation_apply(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        args: &[(Arg, ExprId)],
        type_args: &[TypeId],
        this_arg: Option<ExprId>,
        is_new: bool,
        implementation: SigId,
    ) -> bool {
        let hir = self.hir(file);
        let close_pos = hir[c].close_pos;
        // `callIsIncomplete`
        let is_incomplete = if matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
            close_pos == INCOMPLETE_TEMPLATE
        } else {
            close_pos != u32::MAX
                && !hir.text.is_empty()
                && hir.text.get(close_pos as usize) != Some(&b')')
        };
        let (type_params, params) = (
            self.sig_type_params(implementation),
            self.sig_params(implementation),
        );
        if !self.has_correct_type_argument_arity(&type_params, type_args.len())
            || !self.has_correct_arity_for(&params, args, is_incomplete)
        {
            return false;
        }
        let mut check = implementation;
        if !type_params.is_empty() {
            if !type_args.is_empty()
                && !matches!(
                    self.failing_type_argument(implementation, &type_params, type_args),
                    Ok(None)
                )
            {
                return false;
            }
            let plain: SmallVec<[Arg; 4]> = args.iter().map(|a| a.0).collect();
            let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
            check = self.instantiate_for_call(
                file,
                e,
                implementation,
                type_args,
                &plain,
                this_arg,
                false,
            );
            self.keeps_arg_contexts = outer;
            // With a rest parameter that is a type parameter, how many it takes is only known now.
            if self.non_array_rest_type(&params).is_some() {
                let instantiated = self.sig_params(check);
                if !self.has_correct_arity_for(&instantiated, args, is_incomplete) {
                    return false;
                }
            }
        }
        self.is_signature_applicable(file, e, c, args, check, this_arg, is_new, None)
            == Applicable::Yes
    }

    /// What `reportCallResolutionErrors` relates to each thing it says of `last`, the last of `candidatesForArgumentError`.
    /// `is_overloaded`: there are more of those.
    fn related_to_failed_candidate(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        args: &[(Arg, ExprId)],
        type_args: &[TypeId],
        this_arg: Option<ExprId>,
        is_new: bool,
        last: SigId,
        is_overloaded: bool,
    ) -> Vec<super::explain::Related> {
        if !self.explains {
            return Vec::new();
        }
        let mut related = if is_overloaded {
            self.last_overload_declared_here(last)
        } else {
            Vec::new()
        };
        if !self.stack.contains(&Query::Call(file, e))
            && let Some(implementation) = self.implementation_of_overload(last)
            && self.does_implementation_apply(
                file,
                e,
                c,
                args,
                type_args,
                this_arg,
                is_new,
                implementation,
            )
            && let Some((of, func, _)) = self.sig_decl(implementation)
        {
            related.push(super::explain::Related {
                at: Some(self.place_of_signature_declaration(of, func)),
                code: 2793,
                args: Vec::new(),
            });
        }
        related
    }

    /// Records in `context_checked_for` that an attempt that has ended checked the function expressions in the argument `e`.
    /// Descends into the same kinds of expression as `infer_from_annotated_functions`. Pushes each function and its previous entry
    /// to `previous`.
    fn mark_context_checked(
        &mut self,
        file: FileId,
        e: ExprId,
        previous: &mut Vec<(ExprId, Option<Option<SigId>>)>,
    ) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Fn(_) => previous.push((e, self.context_checked_for.insert((file, e), None))),
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if hir[p].value.is_some() {
                        self.mark_context_checked(file, hir[p].value, previous);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.mark_context_checked(file, item, previous);
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.mark_context_checked(file, yes, previous);
                self.mark_context_checked(file, no, previous);
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.mark_context_checked(file, left, previous);
                self.mark_context_checked(file, right, previous);
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Comma,
                right,
                ..
            } => self.mark_context_checked(file, right, previous),
            _ => {}
        }
    }

    /// `checkTypeArguments`: the first type argument that does not satisfy its constraint, and the two types. `Err`: it cannot be told.
    pub(super) fn failing_type_argument(
        &mut self,
        sig: SigId,
        type_params: &[TypeId],
        type_args: &[TypeId],
    ) -> Result<Option<(usize, TypeId, TypeId)>, ()> {
        let filled = self.fill_sig_type_args(sig, type_params, type_args);
        let mapper = self.mapper_from(type_params, &filled);
        let outer = self
            .sig_decl(sig)
            .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
        for i in 0..type_args.len().min(type_params.len()) {
            let Some(constraint) = self.constraint_of_type_param(type_params[i]) else {
                continue;
            };
            // The constraint of a cloned type parameter (`cloneTypeParameter`) is instantiated with the mapper of the signature already.
            let constraint = match *self.data(type_params[i]) {
                TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY => constraint,
                _ => self.instantiate(constraint, outer),
            };
            let constraint = self.instantiate(constraint, mapper);
            if !self.is_known(constraint) {
                return Err(());
            }
            if !self.is_assignable(filled[i], constraint) {
                return Ok(Some((i, filled[i], constraint)));
            }
        }
        Ok(None)
    }

    /// `isSignatureApplicable`, of the call, `new` or tagged template `e`, which may still be in the middle of being resolved.
    /// `args`: the arguments as `getEffectiveCallArguments` has them, each with the argument it is written as (part of), after the
    /// pieces of text if it is a tagged template.
    pub(super) fn is_signature_applicable(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        args: &[(Arg, ExprId)],
        sig: SigId,
        this_arg: Option<ExprId>,
        is_new: bool,
        report: Option<&mut Vec<Diagnostic>>,
    ) -> Applicable {
        // `checkExpressionWithContextualType`: a call that is being resolved cannot say what it expects of an argument, so `sig`
        // does, but for what is settled already.
        let settled = self.contextual.len();
        if self.stack.contains(&Query::Call(file, e)) {
            let expected = self.sig_params(sig);
            for (i, &(arg, _)) in args.iter().enumerate() {
                if let Arg::Expr(x) = arg
                    && self.explicit_context(file, x).is_none()
                    && let Some(param) = self.param_type_at(&expected, i)
                    && param != TypeId::UNRESOLVED
                {
                    let param = self.without_no_infer(param);
                    self.contextual.push((file, x, param));
                }
            }
        }
        // Nothing is decided on the strength of an argument that could not be found out.
        let applicable = match self.known_argument_types(file, args) {
            Some(types) => self
                .signature_applicability(file, e, c, args, &types, sig, this_arg, is_new, report),
            None => Applicable::Unknown,
        };
        self.contextual.truncate(settled);
        applicable
    }

    /// `isSignatureApplicable`, once the arguments are known and know what is expected of them. `types`: what each of them is.
    fn signature_applicability(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        args: &[(Arg, ExprId)],
        types: &[TypeId],
        sig: SigId,
        this_arg: Option<ExprId>,
        is_new: bool,
        mut report: Option<&mut Vec<Diagnostic>>,
    ) -> Applicable {
        let hir = self.hir(file);
        let params = self.sig_params(sig);
        let callee = hir[c].callee;
        // Only a call of `super.m` written just so goes without.
        let is_super_property = matches!(hir[e].kind, ExprKind::Call(_))
            && matches!(hir[callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if matches!(hir[obj].kind, ExprKind::Super))
            && !is_parenthesized(hir, callee);
        if let Some(wanted) = self.sig_this_type(sig)
            && wanted != TypeId::VOID
            && !is_new
            && !is_super_property
        {
            // `getThisArgumentType`
            let given = match this_arg {
                Some(obj) => {
                    let chain = self
                        .this_argument_of_call(file, callee)
                        .map_or(Chain::No, |(_, chain)| chain);
                    self.chain_receiver(file, obj, chain).0
                }
                None => TypeId::VOID,
            };
            if !self.is_known(given)
                || !self.is_known(wanted)
                || this_arg.is_some_and(|obj| self.is_uncertain(file, obj))
            {
                return Applicable::Unknown;
            }
            if !self.is_assignable(given, wanted) {
                if let Some(out) = report.as_deref_mut() {
                    let start = self.start_of(file, this_arg.unwrap_or(e));
                    let end = self.error_end_of(file, this_arg.unwrap_or(e));
                    // 2684, or what says more.
                    self.report_not_assignable_with_end(given, wanted, start, end, 2684, out);
                }
                return Applicable::No;
            }
        }
        let rest = self.non_array_rest_type(&params);
        let count = if rest.is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        for (i, &(arg, node)) in args.iter().enumerate().take(count) {
            if matches!(hir[node].kind, ExprKind::Missing) {
                continue;
            }
            let Some(wanted) = self.param_type_at(&params, i) else {
                continue;
            };
            if !self.is_known(wanted) {
                return Applicable::Unknown;
            }
            let given = types[i];
            if self.trace_relations {
                let (a, b) = (
                    crate::describe::Describer::new(self).describe(given),
                    crate::describe::Describer::new(self).describe(wanted),
                );
                eprintln!(
                    "ARGUMENT {i} at {}: {a} for {b}: {}",
                    hir[node].pos,
                    self.is_assignable(given, wanted)
                );
            }
            if self.is_assignable(given, wanted) {
                continue;
            }
            let check_node = self.effective_check_node(file, node);
            let inner = if matches!(arg, Arg::Expr(_)) {
                check_node
            } else {
                ExprId::NONE
            };
            // A type parameter where none is in scope was not got to the bottom of: `check_assignable` keeps quiet about it.
            if inner.is_some()
                && (self.has_type_variables(given) || self.has_type_variables(wanted))
                && !self.is_in_generic_context(file, inner)
            {
                return Applicable::Unknown;
            }
            // The pieces of text of a tagged template: where the template starts is not kept.
            if let Some(out) = report.as_deref_mut()
                && node != e
            {
                let (at, end) = match self.start_of_jsdoc_type_assertion(file, check_node) {
                    Some(open) => (open, self.end_of_bracket_at(file, open)),
                    None => (
                        self.start_inside_parentheses(file, check_node),
                        self.error_end_inside_parentheses(file, check_node),
                    ),
                };
                let said = out.len();
                self.check_assignable_with_end(file, given, wanted, at, end, inner, 2345, out);
                let (from, to) = self.error_range_of_expr(file, node);
                let first = out.get(said).copied();
                self.maybe_add_missing_await_info((file, from, to), given, wanted, first);
                // `checkTypeRelatedToEx`: what `import * as ns` imports would have done.
                if self.explains
                    && let Some((module, import)) = self.originating_import(file, given)
                {
                    let imported = self.type_of_symbol(module);
                    if self.is_assignable(imported, wanted) {
                        self.relate(at, 2345, |_| vec![import]);
                    }
                }
            }
            return Applicable::No;
        }
        if let Some(rest) = rest {
            if !self.is_known(rest) {
                return Applicable::Unknown;
            }
            let given = spread_argument_type(self, file, args, count, rest);
            if !self.is_known(given) {
                return Applicable::Unknown;
            }
            if !self.is_assignable(given, rest) {
                if let Some(out) = report
                    && args.get(count).is_none_or(|first| first.1 != e)
                {
                    let (at, end) = match args[count..] {
                        [] => (
                            self.start_inside_parentheses(file, e),
                            self.end_inside_parentheses(file, e),
                        ),
                        [(_, node)] => {
                            let check_node = self.effective_check_node(file, node);
                            match self.start_of_jsdoc_type_assertion(file, check_node) {
                                Some(open) => (open, self.end_of_bracket_at(file, open)),
                                None => (
                                    self.start_inside_parentheses(file, check_node),
                                    self.error_end_inside_parentheses(file, check_node),
                                ),
                            }
                        }
                        [(_, first), .., (_, last)] => {
                            (self.start_of(file, first), self.end_of_expr(file, last))
                        }
                    };
                    let said = out.len();
                    self.check_assignable_with_end(
                        file,
                        given,
                        rest,
                        at,
                        end,
                        ExprId::NONE,
                        2345,
                        out,
                    );
                    let first = out.get(said).copied();
                    self.maybe_add_missing_await_info((file, at, end), given, rest, first);
                }
                return Applicable::No;
            }
        }
        Applicable::Yes
    }

    /// `maybeAddMissingAwaitInfo`. `place`: the argument. `said`: the first thing that was said of it.
    fn maybe_add_missing_await_info(
        &mut self,
        place: (FileId, u32, u32),
        source: TypeId,
        target: TypeId,
        said: Option<Diagnostic>,
    ) {
        let Some(d) = said else { return };
        if !self.explains {
            return;
        }
        // `getAwaitedTypeOfPromise`
        let awaited_of_promise = |c: &mut Self, ty: TypeId| {
            let promised = c.thenable_value(ty)?;
            c.awaited_or_none(promised)
        };
        if awaited_of_promise(self, target).is_some() {
            return;
        }
        let Some(awaited) = awaited_of_promise(self, source) else {
            return;
        };
        if self.is_known(awaited) && self.is_assignable(awaited, target) {
            self.relate(d.start, d.code, |_| {
                vec![super::explain::Related {
                    at: Some(place),
                    code: 2773,
                    args: Vec::new(),
                }]
            });
        }
    }

    /// `getEffectiveCheckNode`: `e` without `satisfies` around it. (Parentheses are not kept.)
    fn effective_check_node(&self, file: FileId, mut e: ExprId) -> ExprId {
        while let ExprKind::Satisfies { expr, .. } = self.hir(file)[e].kind {
            e = expr;
        }
        e
    }

    /// `getErrorNodeForCallNode`
    fn start_of_call_error(&self, file: FileId, e: ExprId, c: CallId, is_new: bool) -> u32 {
        let hir = self.hir(file);
        if is_new || matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
            return self.start_inside_parentheses(file, e);
        }
        let callee = hir[c].callee;
        match hir[callee].kind {
            ExprKind::Dot { name_pos, .. } if !is_parenthesized(hir, callee) => name_pos,
            _ => self.start_of(file, callee),
        }
    }

    /// Where the node that starts at `start_of_call_error` ends.
    fn end_of_call_error(&self, file: FileId, e: ExprId, c: CallId, is_new: bool) -> u32 {
        let hir = self.hir(file);
        if is_new || matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
            return self.end_inside_parentheses(file, e);
        }
        let callee = hir[c].callee;
        match hir[callee].kind {
            ExprKind::Dot { name_pos, .. } if !is_parenthesized(hir, callee) => {
                self.end_of_name_at(file, name_pos)
            }
            _ => self.error_end_of(file, callee),
        }
    }

    /// What `getArgumentArityError` counts in `sigs`, for a call with `given` arguments.
    pub(super) fn argument_counts(&mut self, sigs: &[SigId], given: usize) -> ArgumentCounts {
        let mut counts = ArgumentCounts {
            least: usize::MAX,
            most: 0,
            most_below: 0,
            least_above: usize::MAX,
            has_rest: false,
        };
        for &sig in sigs {
            let params = self.sig_params(sig);
            let (from, to) = (
                self.min_argument_count(&params),
                self.parameter_count(&params),
            );
            counts.least = counts.least.min(from);
            counts.most = counts.most.max(to);
            if from < given {
                counts.most_below = counts.most_below.max(from);
            }
            if given < to {
                counts.least_above = counts.least_above.min(to);
            }
            counts.has_rest |= self.has_effective_rest_parameter(&params);
        }
        counts
    }

    /// `getArgumentArityError`: the parameter of `closestSignature` that the first argument that is left out is for. `given`: how
    /// many arguments there are.
    pub(super) fn parameter_without_argument(
        &mut self,
        sigs: &[SigId],
        given: usize,
    ) -> Vec<super::explain::Related> {
        let mut closest: Option<(usize, SigId)> = None;
        for &sig in sigs {
            let params = self.sig_params(sig);
            let least = self.min_argument_count(&params);
            if closest.is_none_or(|(fewest, _)| least < fewest) {
                closest = Some((least, sig));
            }
        }
        let Some((_, sig)) = closest else {
            return Vec::new();
        };
        let declared = self.declared_sig(sig);
        let Some((file, func, _)) = self.sig_decl(declared) else {
            return Vec::new();
        };
        let hir = self.hir(file);
        // A `this` parameter is not among `params`. What is made for a union may have one where its declaration has none.
        let declares_this = hir[func].this_ty.is_some();
        let has_this = match self.p.types.sig(sig) {
            SigData::Synth { this, .. } => this.is_some(),
            _ => declares_this,
        };
        let Some(param) = (given + usize::from(has_this))
            .checked_sub(usize::from(declares_this))
            .and_then(|index| hir[func].params.iter().nth(index))
        else {
            return Vec::new();
        };
        let (code, args) = match hir[hir[param].pat].kind {
            PatKind::Object(_) | PatKind::Array(_) => (6211, Vec::new()),
            PatKind::Ident(name) if hir[param].flags.contains(Flags::REST) => {
                (6236, vec![self.atom_text(name)])
            }
            PatKind::Ident(name) => (6210, vec![self.atom_text(name)]),
            PatKind::Missing => (6210, vec![String::new()]),
        };
        let start = hir[param].pos;
        // There is no text of the default library.
        let end = if hir.text.is_empty() {
            start
        } else {
            self.end_of_param(file, param)
        };
        vec![super::explain::Related {
            at: Some((file, start, end)),
            code,
            args,
        }]
    }

    /// `getArgumentArityError`: 2554 2555 2556 2575 2794 2810
    fn report_argument_arity(
        &mut self,
        file: FileId,
        e: ExprId,
        c: CallId,
        is_new: bool,
        sigs: &[SigId],
        args: &[(Arg, ExprId)],
        out: &mut Vec<Diagnostic>,
    ) {
        if let Some(&(_, node)) = args.iter().find(|a| matches!(a.0, Arg::Spread(..))) {
            let start = self.start_of(file, node);
            out.push(Diagnostic { start, code: 2556 });
            self.note(start, self.end_of_expr(file, node), 2556, Vec::new());
            return;
        }
        let counts = self.argument_counts(sigs, args.len());
        let expected = counts.expected();
        let ArgumentCounts {
            least,
            most,
            most_below,
            least_above,
            has_rest,
        } = counts;
        let error_start = self.start_of_call_error(file, e, c, is_new);
        let code = if has_rest {
            2555
        } else if least == 1
            && most == 1
            && args.is_empty()
            && self.is_promise_resolve_arity_error(file, c, is_new)
        {
            // In JavaScript there is no type argument to put `void` in.
            let path = self.files().module(file).path.as_str();
            if [".js", ".jsx", ".mjs", ".cjs"]
                .iter()
                .any(|extension| path.ends_with(extension))
            {
                2810
            } else {
                2794
            }
        } else {
            2554
        };
        let given = args.len().to_string();
        if least < args.len() && args.len() < most {
            out.push(Diagnostic {
                start: error_start,
                code: 2575,
            });
            let end = self.end_of_call_error(file, e, c, is_new);
            let either = vec![given, most_below.to_string(), least_above.to_string()];
            self.note(error_start, end, 2575, either);
        } else if args.len() < least || most >= args.len() {
            out.push(Diagnostic {
                start: error_start,
                code,
            });
            let end = self.end_of_call_error(file, e, c, is_new);
            self.note(error_start, end, code, vec![expected, given]);
            if args.len() < least && code != 2810 {
                self.relate(error_start, code, |c| {
                    c.parameter_without_argument(sigs, args.len())
                });
            }
        } else if args[most].1 != e {
            let start = self.start_of(file, args[most].1);
            out.push(Diagnostic { start, code });
            let end = self.end_of_expr(file, args[args.len() - 1].1);
            self.note(start, end, code, vec![expected, given]);
        }
        // Otherwise it is at the template of a tagged template, and where that starts is not kept.
    }

    /// `isPromiseResolveArityError`: what is called is the `resolve` of `new Promise((resolve) => ...)`. With parentheses around
    /// `resolve`, the function or `Promise` it is not: those are nodes.
    fn is_promise_resolve_arity_error(&mut self, file: FileId, c: CallId, is_new: bool) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let callee = hir[c].callee;
        if is_new
            || !matches!(hir[callee].kind, ExprKind::Ident(_))
            || is_parenthesized(hir, callee)
        {
            return false;
        }
        let symbol = bound.expr_symbol[callee.idx()];
        if symbol.is_none() {
            return false;
        }
        // `valueDeclaration`: the first, should a `var` in the body say the name again.
        let Some(&Decl::Param(pat)) = bound.symbols[symbol.idx()].decls.first() else {
            return false;
        };
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        let FnOwner::Expr(function) = bound.fns[bound.param_fn[p.idx()].idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = bound.expr_parent[function.idx()] else {
            return false;
        };
        let ExprKind::New(outer) = hir[parent].kind else {
            return false;
        };
        if is_parenthesized(hir, function) || is_parenthesized(hir, hir[outer].callee) {
            return false;
        }
        matches!(hir[hir[outer].callee].kind, ExprKind::Ident(known::Promise))
            && bound.expr_symbol[hir[outer].callee.idx()].is_none()
    }

    /// `typeArgumentList.Loc.End()`: a trailing comma is part of the list.
    pub(super) fn end_of_type_argument_list(
        &self,
        file: FileId,
        type_args: IdList<TypeNodeId>,
    ) -> u32 {
        let end = self.end_of_type_args(file, type_args);
        let next = self.skip_trivia_from(file, end);
        if self.hir(file).text.get(next as usize) == Some(&b',') {
            next + 1
        } else {
            end
        }
    }

    /// `getTypeArgumentArityError`: 2558 2743
    fn report_type_argument_arity(
        &mut self,
        file: FileId,
        c: CallId,
        sigs: &[SigId],
        given: usize,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let Some(first) = hir.ids(hir[c].type_args).next() else {
            return;
        };
        let mut code = 2558;
        let mut counts = Vec::new();
        if sigs.len() > 1 {
            let (mut below, mut above) = (false, false);
            // `belowArgCount`, `aboveArgCount`
            let (mut most_below, mut least_above) = (0usize, usize::MAX);
            for &sig in sigs {
                let type_params = self.sig_type_params(sig);
                let least = self.min_type_argument_count(&type_params);
                if least > given {
                    above = true;
                    least_above = least_above.min(least);
                } else if type_params.len() < given {
                    below = true;
                    most_below = most_below.max(type_params.len());
                }
            }
            if below && above {
                code = 2743;
                counts.push(given.to_string());
                counts.push(most_below.to_string());
                counts.push(least_above.to_string());
            } else {
                let expected = if below { most_below } else { least_above };
                counts.push(expected.to_string());
                counts.push(given.to_string());
            }
        } else if let [sig] = *sigs {
            let type_params = self.sig_type_params(sig);
            let (least, most) = (
                self.min_type_argument_count(&type_params),
                type_params.len(),
            );
            counts.push(if least < most {
                format!("{least}-{most}")
            } else {
                least.to_string()
            });
            counts.push(given.to_string());
        }
        out.push(Diagnostic {
            start: hir[first].pos,
            code,
        });
        let end = self.end_of_type_argument_list(file, hir[c].type_args);
        self.note(hir[first].pos, end, code, counts);
    }
}

/// `SkipTriviaEx` with `StopAfterLineBreak`: whether the line ends after `at`, with nothing but blanks and comments before that.
fn line_breaks_after(text: &[u8], mut at: usize) -> bool {
    loop {
        match text.get(at) {
            Some(b'\n' | b'\r') => return true,
            Some(b' ' | b'\t' | 0x0B | 0x0C) => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while text.get(at).is_some_and(|b| !matches!(b, b'\n' | b'\r')) {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                at += 2;
                while at < text.len() && !text[at..].starts_with(b"*/") {
                    at += 1;
                }
                at += 2;
            }
            _ => return false,
        }
    }
}

/// Whether `e` is written in parentheses of its own.
fn is_parenthesized(hir: &hir::File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
}

/// `IsDottedName`
fn is_dotted_name(hir: &hir::File, e: ExprId) -> bool {
    match hir[e].kind {
        ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::NewTarget
        | ExprKind::ImportMeta => true,
        ExprKind::Dot { obj, .. } => is_dotted_name(hir, obj),
        _ => false,
    }
}

// ───────────────────────────── what a rest parameter collects ─────────────────────────────

/// `getSpreadArgumentType`: the arguments from `index` on, as the list a rest parameter of type `rest` takes them for.
fn spread_argument_type(
    c: &mut Checker<'_>,
    file: FileId,
    args: &[(Arg, ExprId)],
    index: usize,
    rest: TypeId,
) -> TypeId {
    let is_const = c.is_const_type_variable(rest, 0);
    // `...x` for `...rest`
    if let Some(&(last @ Arg::Spread(..), _)) = args.last()
        && index + 1 >= args.len()
    {
        return match spread_list(c, file, args, args.len() - 1) {
            Some(list) => mutable_array_or_tuple(c, list),
            None => {
                let element = c.arg_type(file, last);
                if is_const {
                    c.readonly_array_of(element)
                } else {
                    c.array_of(element)
                }
            }
        };
    }
    let length = args.len() - index;
    let (mut elems, mut flags) = (Vec::with_capacity(length), Vec::with_capacity(length));
    for i in index..args.len() {
        let arg = args[i].0;
        let ty = c.arg_type(file, arg);
        if !matches!(arg, Arg::Spread(..)) {
            // A literal stays one where what is expected there, not of the list as a whole, may be primitive. So it does where
            // that has room for it: `checkExpressionWithContextualType` makes it regular, and only a fresh one is widened.
            let context = context_of_rest_argument(c, rest, i - index, length);
            let stays = is_const || may_be_primitive_or_key(c, context);
            elems.push(if stays {
                c.regular(ty)
            } else {
                c.widen_literal_for_context(ty, Some(context))
            });
            flags.push(ElemFlags::REQUIRED);
        } else if let Some(list) = spread_list(c, file, args, i) {
            elems.push(list);
            flags.push(ElemFlags::VARIADIC);
        } else {
            elems.push(ty);
            flags.push(ElemFlags::REST);
        }
    }
    // For a `const` type variable it is not to be written to, unless `rest` may be a list that is (`isMutableArrayLikeType`).
    let readonly = is_const && {
        let any_array = c.array_of(TypeId::ANY);
        !c.parts(rest).iter().any(|&m| {
            c.is_mutable_array_or_tuple(m)
                || !c.is_any(m) && !c.is_nullish(m) && c.is_assignable(m, any_array)
        })
    };
    c.normalized_tuple(&elems, &flags, readonly)
}

/// The list that argument `i`, which is spread, stands for. `None`: what is spread is no list (`isArrayLikeType`), only something
/// to go through.
fn spread_list(
    c: &mut Checker<'_>,
    file: FileId,
    args: &[(Arg, ExprId)],
    i: usize,
) -> Option<TypeId> {
    let node = args[i].1;
    let ExprKind::Spread(inner) = c.hir(file)[node].kind else {
        return None;
    };
    let spread = c.type_of_expr(file, inner);
    // `getEffectiveCallArguments` takes a tuple apart: `...T` in it is `T`, `...X[]` is `X[]`.
    if let TypeData::Tuple { elems, flags, .. } = c.data(spread) {
        let first = args.iter().position(|a| a.1 == node)?;
        let (&element, flag) = (elems.get(i - first)?, flags.get(i - first)?);
        return Some(if flag.contains(ElemFlags::VARIADIC) {
            element
        } else {
            c.array_of(element)
        });
    }
    let any_list = c.readonly_array_of(TypeId::ANY);
    (!c.is_nullish(spread) && c.is_assignable(spread, any_list)).then_some(spread)
}

/// `getMutableArrayOrTupleType`
fn mutable_array_or_tuple(c: &mut Checker<'_>, t: TypeId) -> TypeId {
    if c.is_union(t) {
        return c.map_type(t, |c, member| mutable_array_or_tuple(c, member));
    }
    let base = c.base_constraint_of(t).unwrap_or(t);
    if c.is_any(t) || c.is_mutable_array_or_tuple(base) {
        return t;
    }
    if let TypeData::Tuple { elems, flags, .. } = c.data(t) {
        return c.tuple(elems, flags, false);
    }
    c.normalized_tuple(&[t], &[ElemFlags::VARIADIC], false)
}

/// What argument `i` of the `length` that a rest parameter of type `rest` collects is expected to be.
fn context_of_rest_argument(c: &mut Checker<'_>, rest: TypeId, i: usize, length: usize) -> TypeId {
    let TypeData::Tuple { elems, flags, .. } = c.data(rest) else {
        let at = c.number_literal(i as f64, false);
        return c.indexed_access(rest, at);
    };
    // `getContextualTypeForElementExpression`: counted from the start up to what varies in length, from the end after it.
    let varies = |f: &ElemFlags| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC);
    let fixed = flags.iter().position(varies).unwrap_or(flags.len());
    if i < fixed {
        return elems[i];
    }
    let fixed_end = if fixed < flags.len() {
        flags.iter().rev().take_while(|f| !varies(*f)).count()
    } else {
        0
    };
    let offset = length - i;
    if offset <= fixed_end {
        return elems[elems.len() - offset];
    }
    // `getElementTypeOfSliceOfTupleType`
    let between: Vec<TypeId> = (fixed..elems.len() - fixed_end)
        .map(|k| {
            if flags[k].contains(ElemFlags::VARIADIC) {
                c.indexed_access(elems[k], TypeId::NUMBER)
            } else {
                elems[k]
            }
        })
        .collect();
    if between.is_empty() {
        TypeId::UNKNOWN
    } else {
        c.union(&between)
    }
}

/// `maybeTypeOfKind(ty, Primitive | Index | TemplateLiteral | StringMapping)`
fn may_be_primitive_or_key(c: &Checker<'_>, ty: TypeId) -> bool {
    match c.data(ty) {
        TypeData::Union(parts) | TypeData::Intersection(parts) => {
            parts.iter().any(|&part| may_be_primitive_or_key(c, part))
        }
        TypeData::Keyof(_) => true,
        _ => c.is_primitive(ty),
    }
}
