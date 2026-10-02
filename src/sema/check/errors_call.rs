//! Errors about calls, `new` and tagged templates: what is called cannot be, or not with these arguments. What `resolveCall`
//! reports of a decorator and of `instanceof` is said here too.
//!
//! The order of the checks, what is said and where follow `resolveCallExpression`, `resolveNewExpression`,
//! `resolveTaggedTemplateExpression`, `resolveCall`, `chooseOverload`, `isSignatureApplicable`, `reportCallResolutionErrors` and
//! `getArgumentArityError` of TypeScript 7.0.2's checker.go. One thing differs: an argument has one type here, the one it got
//! when the call was resolved, where they look at it again for each candidate. Whenever that leaves it open whether a candidate
//! fits, nothing is said.

use super::call::{Arg, Args, CallLike, CallState, ResolvedCall};
use super::errors::Diagnostic;
use super::explain::Line;
use super::relate::Relation;
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

impl Applicable {
    /// `None`: it cannot be told.
    pub(super) fn known(self) -> Option<bool> {
        match self {
            Applicable::Yes => Some(true),
            Applicable::No => Some(false),
            Applicable::Unknown => None,
        }
    }
}

/// What `chooseOverload` leaves behind when no candidate will do, and what it held the candidates against.
struct Failed {
    args: Args,
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
            ) || bound.is_unchecked(i)
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
        let node = CallLike::Call(c);
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
        let apparent = self.apparent_type(called);
        if !self.is_known(apparent) {
            return;
        }
        // `resolveErrorCall`
        if self.is_error_type(apparent) {
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
                if has_type_args && !self.is_error_type(called) {
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
            self.report_call_resolution(file, e, node, &call_sigs, resolved, None, out);
            self.check_assertion_target(file, e, c, resolved.sig, out);
            return;
        }
        if self.is_any(apparent) {
            if has_type_args {
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
            if self.has_abstract_construct_signature(reduced) {
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
            self.report_call_resolution(file, e, node, &construct_sigs, resolved, None, out);
            return;
        }
        if !call_sigs.is_empty() {
            self.report_call_resolution(file, e, node, &call_sigs, resolved, None, out);
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
        if let Some((module, import)) = self.originating_import(apparent) {
            let imported = self.type_of_symbol(module);
            if !self.signatures(imported, construct).is_empty() {
                related.push(import);
            }
        }
        related
    }

    /// `exportTypeLinks.Get(t.symbol)`, of a type `import * as ns` made: its `target`, which is what is imported, and 7038 at its
    /// `originatingImport`.
    fn originating_import(&self, ty: TypeId) -> Option<(Sym, super::explain::Related)> {
        let TypeData::Anon {
            origin:
                Origin::Namespace {
                    module,
                    originating_import,
                    ..
                },
            ..
        } = *self.data(ty)
        else {
            return None;
        };
        let file = originating_import.file;
        let hir = self.hir(file);
        let import = self
            .files()
            .symbol(originating_import)
            .decls
            .iter()
            .find_map(|d| match *d {
                Decl::ImportNamespace(i) => Some(i),
                _ => None,
            })?;
        let index = hir
            .stmts
            .iter()
            .position(|s| matches!(s.kind, StmtKind::Import(i) if i == import))?;
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
        } else if self.effects_signature(file, e).is_none() {
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
        // Whether the class has a base type depends on the return type of the first base constructor (`resolveBaseTypesOfClass`),
        // which has to be known.
        let sym = self.class_sym(file, class);
        if self.base_types(sym).is_empty()
            && let Some(&first) = self.super_constructor_sigs(sym).first()
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
            self.report_call_resolution(file, e, CallLike::Call(c), &sigs, resolved, None, out);
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
        // `resolveErrorCall`
        if self.is_error_type(apparent) {
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
        self.report_call_resolution(file, e, CallLike::Call(c), &call_sigs, resolved, None, out);
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
            || self.is_any(apparent)
                && matches!(
                    self.data(called),
                    TypeData::TypeParam(..) | TypeData::ThisParam(_)
                )
            || calls == 0
                && constructs == 0
                && !self.is_union(apparent)
                && self.reduced(apparent) != TypeId::NEVER
                && {
                    let function = self.global_ref(known::Function, &[]);
                    self.is_assignable(called, function)
                }
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
                    sig = base?;
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

    /// `getThisArgumentOfCall`
    pub(super) fn this_argument_of_call(
        &self,
        file: FileId,
        e: ExprId,
        node: CallLike,
    ) -> Option<ExprId> {
        let hir = self.hir(file);
        let mut callee = match node {
            CallLike::InstanceOf { right, .. } => return Some(right),
            CallLike::Call(_) if matches!(hir[e].kind, ExprKind::New(_)) => return None,
            CallLike::Call(c) => hir[c].callee,
            CallLike::Decorator(_) if hir.legacy_decorators => return None,
            CallLike::Decorator(_) => e,
        };
        // `SkipOuterExpressions(expression, OEKAll)`
        loop {
            callee = match hir[callee].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => return Some(obj),
                _ => return None,
            };
        }
    }

    /// `isSignatureApplicable`: whether what the signature is called on is held against its `this` type. Not for `new`, nor for
    /// a call of `super.m` written just so.
    pub(super) fn checks_this_argument(&self, file: FileId, e: ExprId, node: CallLike) -> bool {
        let hir = self.hir(file);
        match (node, hir[e].kind) {
            (CallLike::Call(_), ExprKind::New(_)) => false,
            (CallLike::Call(c), ExprKind::Call(_)) => {
                let callee = hir[c].callee;
                is_parenthesized(hir, callee)
                    || !matches!(hir[callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if matches!(hir[obj].kind, ExprKind::Super))
            }
            _ => true,
        }
    }

    /// Whether the types of the arguments were all found out.
    fn are_argument_types_known(&mut self, file: FileId, args: &[Arg]) -> bool {
        args.iter().all(|&arg| {
            let ty = self.arg_type(file, arg);
            self.is_known(ty) && !matches!(arg, Arg::Expr(x) if self.is_uncertain(file, x))
        })
    }

    /// Whether it is certain that none of `sigs` takes the arguments of `node`, which `e` stands for and which may still be in
    /// the middle of being resolved. `resolved.sig`: where there is one signature and that is generic, it as inferred from
    /// all of the arguments (the `checkCandidate` of `chooseOverload`), never what `getCandidateForOverloadFailure` makes of it.
    pub(super) fn no_candidate_applies(
        &mut self,
        file: FileId,
        e: ExprId,
        node: CallLike,
        sigs: &[SigId],
        resolved: ResolvedCall,
    ) -> bool {
        self.failed_candidates(file, e, node, sigs, resolved)
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
        node: CallLike,
        sigs: &[SigId],
        resolved: ResolvedCall,
    ) -> Option<Failed> {
        let hir = self.hir(file);
        let candidates = self.candidates_in_order(sigs);
        let args = self.effective_call_arguments(file, e, node);
        // A call that is being resolved cannot say what it expects of an argument. The candidate at hand does, in
        // `is_signature_applicable`. The arguments of any other call are what they are, whatever they are held against.
        let is_under_way = self.stack.contains(&Query::Call(file, e));
        if !is_under_way && !self.are_argument_types_known(file, &args) {
            return None;
        }
        let type_args = match node {
            CallLike::Call(_) => {
                let nodes = self.type_arguments_of_call(file, e);
                self.types_from_nodes(file, nodes)
            }
            _ => Vec::new(),
        };
        if type_args.iter().any(|&t| !self.is_known(t)) {
            return None;
        }
        let this_arg = self.this_argument_of_call(file, e, node);
        let s = CallState {
            file,
            call: e,
            node,
            type_args: &type_args,
            args: &args,
            this_arg,
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
                self.has_correct_arity(s, &params)
            }
            && self.is_signature_applicable(s, sig, None) == Applicable::Yes
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
                || !self.has_correct_arity(s, &params)
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
                        let sig = self.instantiate_for_call(s, candidate, false);
                        self.keeps_arg_contexts = outer;
                        sig
                    }
                };
                // With a rest parameter that is a type parameter, how many it takes is only known now.
                if self.non_array_rest_type(&params).is_some() {
                    let instantiated = self.sig_params(check);
                    if !self.has_correct_arity(s, &instantiated) {
                        for_arity_error = Some(check);
                        continue;
                    }
                }
            }
            match self.is_signature_applicable(s, check, None) {
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
            && args
                .iter()
                .any(|a| matches!(a, Arg::Expr(x) if self.is_context_sensitive(file, *x)))
        {
            for &candidate in &candidates {
                let params = self.sig_params(candidate);
                if self.sig_type_params(candidate).is_empty() || !self.has_correct_arity(s, &params)
                {
                    continue;
                }
                let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
                let attempt = self.instantiate_for_call_as(s, candidate, false, true);
                self.keeps_arg_contexts = outer;
                if attempt != accepted {
                    continue;
                }
                if self.is_signature_applicable(s, accepted, None) != Applicable::No {
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
    /// is wrong with it as things stand then. `check`, `ret`: its entry of `failed_calls` that time, and what it returned. Only the
    /// first time is looked at. `check_call` says what is kept here.
    pub(super) fn report_call_resolved_again(
        &mut self,
        file: FileId,
        e: ExprId,
        check: SigId,
        ret: TypeId,
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
        let (node, sig) = (CallLike::Call(c), Some(check));
        let check = ResolvedCall { sig, ret };
        self.report_call_resolution_errors(file, e, node, &sigs, check, None, &mut said);
        let notes = self.notes.borrow_mut().split_off(noted);
        p.said_of_calls_resolved_again
            .insert_ref((file, e), (said, notes));
    }

    /// `resolveCall`, for what it reports of a call that `resolve_call` resolved to `resolved`. `head`: `headMessage`.
    pub(super) fn report_call_resolution(
        &mut self,
        file: FileId,
        e: ExprId,
        node: CallLike,
        sigs: &[SigId],
        resolved: ResolvedCall,
        head: Option<u32>,
        out: &mut Vec<Diagnostic>,
    ) {
        // A resolution that is not kept left nothing behind.
        let sig = if self.p.calls.get(&(file, e)).is_some() {
            // `chooseOverload` found a candidate.
            let Some(check) = self.p.failed_calls.get(&(file, e)) else {
                return;
            };
            Some(check)
        } else {
            None
        };
        let check = ResolvedCall { sig, ..resolved };
        self.report_call_resolution_errors(file, e, node, sigs, check, head, out);
    }

    /// `reportCallResolutionErrors`, and before that `chooseOverload` once more for what it left in `CallState`. `check.sig`: the
    /// entry of `failed_calls`.
    pub(super) fn report_call_resolution_errors(
        &mut self,
        file: FileId,
        e: ExprId,
        node: CallLike,
        sigs: &[SigId],
        check: ResolvedCall,
        head: Option<u32>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // `resolveCall`: with several candidates the errors come from the assignable pass. The subtype pass has checked every function
        // among the arguments (`NodeCheckFlagsContextChecked`), so no attempt of the assignable pass infers from their annotations.
        let mut previous = Vec::new();
        if sigs.len() > 1
            && let CallLike::Call(c) = node
            && self.type_arguments_of_call(file, e).is_empty()
        {
            for arg in hir.ids(hir[c].args) {
                self.mark_context_checked(file, arg, &mut previous);
            }
        }
        let failed = self.failed_candidates(file, e, node, sigs, check);
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
        let s = CallState {
            file,
            call: e,
            node,
            type_args: &type_args,
            args: &args,
            this_arg,
        };
        // `reportCallResolutionErrors`
        if let Some(&last) = for_argument_error.last() {
            let mut said = Vec::new();
            self.is_signature_applicable(s, last, Some(&mut said));
            let is_overloaded = for_argument_error.len() > 1;
            let related = if said.is_empty() {
                Vec::new()
            } else {
                self.related_to_failed_candidate(s, last, is_overloaded)
            };
            for d in said {
                let mut code = d.code;
                if is_overloaded {
                    self.explain_under(d.start, code, 2770, Vec::new());
                    self.explain_under(d.start, 2770, 2769, Vec::new());
                    code = 2769;
                }
                if let Some(head) = head {
                    self.explain_under(d.start, code, head, Vec::new());
                    code = head;
                }
                if !related.is_empty() {
                    self.relate(d.start, code, |_| related.clone());
                }
                out.push(Diagnostic {
                    start: d.start,
                    code,
                });
            }
        } else if let Some(sig) = for_arity_error {
            self.report_argument_arity(s, &[sig], head, out);
        } else if let (Some(candidate), CallLike::Call(c)) = (for_type_argument_error, node) {
            let type_params = self.sig_type_params(candidate);
            if let Ok(Some((index, given, constraint))) =
                self.failing_type_argument(candidate, &type_params, &type_args)
            {
                let node = hir.ids(hir[c].type_args).nth(index).unwrap();
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
            if !fitting.is_empty() {
                self.report_argument_arity(s, &fitting, head, out);
            } else if let CallLike::Call(c) = node {
                self.report_type_argument_arity(file, c, sigs, type_args.len(), out);
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

    /// `addImplementationSuccessElaboration`: whether `chooseOverload` takes `implementation` as the only candidate. `false`
    /// where it cannot be told.
    fn does_implementation_apply(&mut self, s: CallState<'_>, implementation: SigId) -> bool {
        let type_args = s.type_args;
        let (type_params, params) = (
            self.sig_type_params(implementation),
            self.sig_params(implementation),
        );
        if !self.has_correct_type_argument_arity(&type_params, type_args.len())
            || !self.has_correct_arity(s, &params)
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
            let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
            check = self.instantiate_for_call(s, implementation, false);
            self.keeps_arg_contexts = outer;
            // With a rest parameter that is a type parameter, how many it takes is only known now.
            if self.non_array_rest_type(&params).is_some() {
                let instantiated = self.sig_params(check);
                if !self.has_correct_arity(s, &instantiated) {
                    return false;
                }
            }
        }
        self.is_signature_applicable(s, check, None) == Applicable::Yes
    }

    /// What `reportCallResolutionErrors` relates to each thing it says of `last`, the last of `candidatesForArgumentError`.
    /// `is_overloaded`: there are more of those.
    fn related_to_failed_candidate(
        &mut self,
        s: CallState<'_>,
        last: SigId,
        is_overloaded: bool,
    ) -> Vec<super::explain::Related> {
        let (file, e) = (s.file, s.call);
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
            && self.does_implementation_apply(s, implementation)
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
            let constraint = self.filled_in_around(type_params[i], constraint, outer);
            let constraint = self.instantiate(constraint, mapper);
            if !self.is_known(constraint) || !self.is_known(filled[i]) {
                return Err(());
            }
            if !self.is_assignable(filled[i], constraint) {
                return Ok(Some((i, filled[i], constraint)));
            }
        }
        Ok(None)
    }

    /// `isSignatureApplicable`, of a call that may still be in the middle of being resolved.
    pub(super) fn is_signature_applicable(
        &mut self,
        s: CallState<'_>,
        sig: SigId,
        report: Option<&mut Vec<Diagnostic>>,
    ) -> Applicable {
        let (file, e, args) = (s.file, s.call, s.args);
        // `checkExpressionWithContextualType`: a call that is being resolved cannot say what it expects of an argument, so `sig`
        // does, but for what is settled already.
        let settled = self.contextual.len();
        if self.stack.contains(&Query::Call(file, e)) {
            let expected = self.sig_params(sig);
            for (i, &arg) in args.iter().enumerate() {
                if let Arg::Expr(x) = arg
                    && self.explicit_context(file, x).is_none()
                    && let Some(param) = self.context_of_arg_at(&expected, i, Some(args.len()))
                    && param != TypeId::UNRESOLVED
                {
                    let param = self.without_no_infer(param);
                    self.contextual.push((file, x, param));
                }
            }
        }
        // Nothing is decided on the strength of an argument that could not be found out.
        let applicable = if self.are_argument_types_known(file, args) {
            self.signature_applicability(s, sig, Relation::Assignable, false, report)
        } else {
            Applicable::Unknown
        };
        self.contextual.truncate(settled);
        applicable
    }

    /// `isSignatureApplicable`, once the arguments know what is expected of them. `skips_context_sensitive`:
    /// `CheckModeSkipContextSensitive`.
    pub(super) fn signature_applicability(
        &mut self,
        s: CallState<'_>,
        sig: SigId,
        relation: Relation,
        skips_context_sensitive: bool,
        mut report: Option<&mut Vec<Diagnostic>>,
    ) -> Applicable {
        let (file, e, node, args, this_arg) = (s.file, s.call, s.node, s.args, s.this_arg);
        let hir = self.hir(file);
        let params = self.sig_params(sig);
        // What a decorator is applied to is made up (`createSyntheticExpression`): an error about it is at the expression.
        let decorator = match node {
            CallLike::Decorator(_) if report.is_some() => Some(self.where_decorator_is(file, e)),
            _ => None,
        };
        if let Some(wanted) = self.sig_this_type(sig)
            && wanted != TypeId::VOID
            && self.checks_this_argument(file, e, node)
        {
            let given = self.this_argument_type(file, this_arg);
            if !self.is_known(given)
                || !self.is_known(wanted)
                || this_arg.is_some_and(|obj| self.is_uncertain(file, obj))
            {
                return Applicable::Unknown;
            }
            if !self.related(given, wanted, relation) {
                if let Some(out) = report.as_deref_mut() {
                    let (start, end) = match (this_arg, decorator) {
                        (None, Some(written)) => (written.at_sign, written.end),
                        _ => (
                            self.start_of(file, this_arg.unwrap_or(e)),
                            self.error_end_of(file, this_arg.unwrap_or(e)),
                        ),
                    };
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
        // The mode is set by a context sensitive argument, and applies to the functions in all of them.
        let skips_operand_functions = skips_context_sensitive
            && args
                .iter()
                .any(|a| matches!(a, Arg::Expr(x) if self.is_context_sensitive(file, *x)));
        for (i, &arg) in args.iter().enumerate().take(count) {
            let node = arg.node();
            if matches!(hir[node].kind, ExprKind::Missing) {
                continue;
            }
            if skips_context_sensitive && let Arg::Expr(x) = arg {
                if self.is_context_sensitive(file, x) {
                    if let Some(param) = self.context_of_arg_at(&params, i, Some(args.len()))
                        && !self.is_context_sensitive_argument_related(file, x, param, relation)
                    {
                        return Applicable::No;
                    }
                    continue;
                }
                if skips_operand_functions && self.has_context_sensitive_right_operand(file, x) {
                    continue;
                }
            }
            let Some(wanted) = self.param_type_at(&params, i) else {
                continue;
            };
            let given = self.arg_type(file, arg);
            if !self.is_known(given)
                || !self.is_known(wanted)
                || matches!(arg, Arg::Expr(x) if self.is_uncertain(file, x))
            {
                return Applicable::Unknown;
            }
            // `getRegularTypeOfObjectLiteral`: properties there are too many of do not count before everything is looked at.
            let given = if skips_context_sensitive {
                self.regular_type_of_object_literal(given)
            } else {
                given
            };
            if self.trace_relations {
                let (a, b) = (
                    crate::describe::Describer::new(self).describe(given),
                    crate::describe::Describer::new(self).describe(wanted),
                );
                eprintln!(
                    "ARGUMENT {i} at {}: {a} for {b}: {}",
                    hir[node].pos,
                    self.related(given, wanted, relation)
                );
            }
            if self.related(given, wanted, relation) {
                continue;
            }
            let check_node = self.effective_check_node(file, node);
            let inner = if matches!(arg, Arg::Expr(_)) {
                check_node
            } else {
                ExprId::NONE
            };
            // The pieces of text of a tagged template: where the template starts is not kept.
            if let Some(out) = report.as_deref_mut()
                && (node != e || decorator.is_some())
            {
                let jsdoc_type_assertion = self.start_of_jsdoc_type_assertion(file, check_node);
                let (at, end) = match (decorator, jsdoc_type_assertion) {
                    (Some(written), _) => (written.start, written.end),
                    (None, Some(open)) => (open, self.end_of_bracket_at(file, open)),
                    (None, None) => (
                        self.start_inside_parentheses(file, check_node),
                        self.error_end_inside_parentheses(file, check_node),
                    ),
                };
                let said = out.len();
                let is_no_infer = self.is_written_as_no_infer(sig, i);
                let outer =
                    std::mem::replace(&mut self.no_infer_parameter, is_no_infer.then_some(wanted));
                self.check_assignable_with_end(file, given, wanted, at, end, inner, 2345, out);
                self.no_infer_parameter = outer;
                let (from, to) = self.error_range_of_expr(file, node);
                let first = out.get(said).copied();
                self.maybe_add_missing_await_info((file, from, to), given, wanted, first);
                // `checkTypeRelatedToEx`: what `import * as ns` imports would have done.
                if self.explains
                    && let Some((module, import)) = self.originating_import(given)
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
            // What is left out is not looked at.
            let taken_for: SmallVec<[Option<TypeId>; 8]> = args
                .iter()
                .map(|a| {
                    (skips_operand_functions
                        && matches!(a, Arg::Expr(x) if self.is_context_sensitive(file, *x)
                            || self.has_context_sensitive_right_operand(file, *x)))
                    .then_some(TypeId::UNRESOLVED)
                })
                .collect();
            let given =
                self.spread_argument_type(file, args, count, rest, &taken_for, MapperId::IDENTITY);
            if !self.is_known(given) {
                return Applicable::Unknown;
            }
            if !self.related(given, rest, relation) {
                if let Some(out) = report
                    && (decorator.is_some()
                        || args.get(count).is_none_or(|first| first.node() != e))
                {
                    let (at, end) = match decorator {
                        Some(written) if count == args.len() => (written.at_sign, written.end),
                        Some(written) => (written.start, written.end),
                        None => match args[count..] {
                            [] => (
                                self.start_inside_parentheses(file, e),
                                self.end_inside_parentheses(file, e),
                            ),
                            [only] => {
                                let check_node = self.effective_check_node(file, only.node());
                                match self.start_of_jsdoc_type_assertion(file, check_node) {
                                    Some(open) => (open, self.end_of_bracket_at(file, open)),
                                    None => (
                                        self.start_inside_parentheses(file, check_node),
                                        self.error_end_inside_parentheses(file, check_node),
                                    ),
                                }
                            }
                            [first, .., last] => (
                                self.start_of(file, first.node()),
                                self.end_of_expr(file, last.node()),
                            ),
                        },
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

    /// Whether the parameter of `sig` at `index`, no rest parameter, is written as `NoInfer<..>`.
    fn is_written_as_no_infer(&mut self, sig: SigId, index: usize) -> bool {
        let declared = self.declared_sig(sig);
        let Some((file, func, _)) = self.sig_decl(declared) else {
            return false;
        };
        let hir = self.hir(file);
        let Some(param) = hir[func].params.iter().nth(index) else {
            return false;
        };
        let node = hir[param].ty;
        if node.is_none() || hir[param].flags.contains(Flags::REST) {
            return false;
        }
        let written = self.type_from_node(file, node);
        self.is_no_infer(written)
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

    /// `getErrorNodeForCallNode`: from where to where it goes.
    fn error_range_of_call_node(&self, file: FileId, e: ExprId, node: CallLike) -> (u32, u32) {
        let hir = self.hir(file);
        match (node, hir[e].kind) {
            (CallLike::Decorator(_), _) => {
                let written = self.where_decorator_is(file, e);
                (written.at_sign, written.end)
            }
            (CallLike::Call(c), ExprKind::Call(_)) => {
                let callee = hir[c].callee;
                match hir[callee].kind {
                    ExprKind::Dot { name_pos, .. } if !is_parenthesized(hir, callee) => {
                        (name_pos, self.end_of_name_at(file, name_pos))
                    }
                    _ => (self.start_of(file, callee), self.error_end_of(file, callee)),
                }
            }
            _ => (
                self.start_inside_parentheses(file, e),
                self.end_inside_parentheses(file, e),
            ),
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

    /// `getArgumentArityError`: 2554 2555 2556 2575 2794 2810, and 1278 1279 of a decorator. `head`: `headMessage`.
    fn report_argument_arity(
        &mut self,
        s: CallState<'_>,
        sigs: &[SigId],
        head: Option<u32>,
        out: &mut Vec<Diagnostic>,
    ) {
        let (file, e, node, args) = (s.file, s.call, s.node, s.args);
        if let Some(spread) = args.iter().find(|a| matches!(a, Arg::Spread(..))) {
            let start = self.start_of(file, spread.node());
            out.push(Diagnostic { start, code: 2556 });
            self.note(
                start,
                self.end_of_expr(file, spread.node()),
                2556,
                Vec::new(),
            );
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
        let decorator = match node {
            CallLike::Decorator(_) => Some(self.where_decorator_is(file, e)),
            _ => None,
        };
        let code = if decorator.is_some() {
            if has_rest { 1279 } else { 1278 }
        } else if has_rest {
            2555
        } else if least == 1
            && most == 1
            && args.is_empty()
            && matches!(node, CallLike::Call(c) if self.is_promise_resolve_arity_error(file, e, c))
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
        let error_range = self.error_range_of_call_node(file, e, node);
        let ((start, end), code, counted) = if least < args.len() && args.len() < most {
            let either = vec![given, most_below.to_string(), least_above.to_string()];
            (error_range, 2575, either)
        } else if args.len() < least || most >= args.len() {
            (error_range, code, vec![expected, given])
        } else if let Some(written) = decorator {
            ((written.start, written.end), code, vec![expected, given])
        } else if args[most].node() != e {
            let start = self.start_of(file, args[most].node());
            let end = self.end_of_expr(file, args[args.len() - 1].node());
            ((start, end), code, vec![expected, given])
        } else {
            // It is at the template of a tagged template, and where that starts is not kept.
            return;
        };
        self.note(start, end, code, counted);
        let top = head.unwrap_or(code);
        if let Some(head) = head {
            self.explain_under(start, code, head, Vec::new());
        }
        out.push(Diagnostic { start, code: top });
        if args.len() < least && code != 2810 {
            self.relate(start, top, |c| {
                c.parameter_without_argument(sigs, args.len())
            });
        }
    }

    /// `isPromiseResolveArityError`: what is called is the `resolve` of `new Promise((resolve) => ...)`. With parentheses around
    /// `resolve`, the function or `Promise` it is not: those are nodes.
    fn is_promise_resolve_arity_error(&mut self, file: FileId, e: ExprId, c: CallId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let callee = hir[c].callee;
        if !matches!(hir[e].kind, ExprKind::Call(_))
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
