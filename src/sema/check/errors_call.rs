//! Errors about calls, `new` and tagged templates: what is called cannot be, or not with these arguments. What `resolveCall`
//! reports of a decorator and of `instanceof` is said here too.
//!
//! The order of the checks, what is said and where follow `resolveCallExpression`, `resolveNewExpression`,
//! `resolveTaggedTemplateExpression`, `resolveCall`, `chooseOverload`, `isSignatureApplicable`, `reportCallResolutionErrors` and
//! `getArgumentArityError` of TypeScript 7.0.2's checker.go. One thing differs: an argument that is no literal has one type here,
//! the one it got when the call was resolved, where they look at it again for each candidate (`arg_type_under`). Whenever that
//! leaves it open whether a candidate fits, nothing is said.

use super::call::{Arg, CallLike, CallState};
use super::explain::Line;
use super::relate::Relation;
use super::sink::held;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent};
use smallvec::SmallVec;

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
    pub(super) fn check_calls(&mut self, file: FileId) {
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
                ExprKind::Call(c) => self.check_call(file, e, c, false),
                ExprKind::New(c) => self.check_call(file, e, c, true),
                ExprKind::TaggedTemplate(c) => self.check_tagged_template(file, e, c),
                _ => {}
            }
        }
    }

    fn check_call(&mut self, file: FileId, e: ExprId, c: CallId, is_new: bool) {
        let hir = self.hir(file);
        let data = hir[c];
        // The `super` of `new super()` is that of `super.x`: an instance of the base.
        if !is_new && matches!(hir[data.callee].kind, ExprKind::Super) {
            self.check_super_call(file, e, c);
            return;
        }
        // Everything about the call is worked out for good before candidates are tried again.
        let resolved = self.resolved_signature(file, e);
        if let Some(said) = self.p.said_of_calls_resolved_again.get_ref(&(file, e)) {
            self.reported.extend_from_slice(said);
        }
        let called = if is_new {
            self.type_of_expr(file, data.callee)
        } else {
            self.chain_receiver(file, data.callee, data.chain).0
        };
        let from = self.reported.len();
        let called = self.check_non_null_type(file, data.callee, called);
        for i in from..self.reported.len() {
            let code = match self.reported[i].code {
                other if is_new => other,
                18047 | 2531 => 2721,
                18048 | 2532 => 2722,
                18049 | 2533 => 2723,
                18050 if matches!(hir[data.callee].kind, ExprKind::Null) => 2721,
                18050 => 2722,
                other => other,
            };
            if code != self.reported[i].code {
                let end = self.error_end_of(file, data.callee);
                let d = &mut self.reported[i];
                (d.code, d.end, d.args) = (code, end, Default::default());
            }
        }
        let apparent = self.apparent_type(called);
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
                    self.error_at(
                        (file, node_start, self.end_inside_parentheses(file, e)),
                        2347,
                        &[],
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
                    let end = self.end_inside_parentheses(file, e);
                    self.error_at((file, node_start, end), 2348, &[sink::Arg::Type(called)]);
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
                let end = match hir[data.callee].kind {
                    ExprKind::Dot { name_pos, .. } if is_bare => {
                        self.end_of_name_at(file, name_pos)
                    }
                    _ => self.error_end_of(file, data.callee),
                };
                self.error_at((file, start, end), code, &[]);
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
            self.report_call_resolution(file, e);
            self.check_assertion_target(file, e, c, resolved.sig);
            return;
        }
        if self.is_any(apparent) {
            if has_type_args {
                let node_start = self.start_inside_parentheses(file, e);
                self.error_at(
                    (file, node_start, self.end_inside_parentheses(file, e)),
                    2347,
                    &[],
                );
            }
            return;
        }
        if !construct_sigs.is_empty() {
            if let Some((code, class)) = self.inaccessible_constructor(file, e, construct_sigs[0]) {
                let node_start = self.start_inside_parentheses(file, e);
                let end = self.end_inside_parentheses(file, e);
                {
                    let declaring = self.declared_type(class);
                    self.error_at((file, node_start, end), code, &[sink::Arg::Type(declaring)]);
                }
                return;
            }
            if self.has_abstract_construct_signature(reduced) {
                let node_start = self.start_inside_parentheses(file, e);
                self.error_at(
                    (file, node_start, self.end_inside_parentheses(file, e)),
                    2511,
                    &[],
                );
                return;
            }
            self.report_call_resolution(file, e);
            return;
        }
        if !call_sigs.is_empty() {
            self.report_call_resolution(file, e);
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
                    self.error_at(
                        (file, node_start, self.end_inside_parentheses(file, e)),
                        7009,
                        &[],
                    );
                }
            } else if let Some(sig) = sig {
                let returned = self.sig_return(sig);
                if returned != TypeId::VOID && has_declaration == Some(true) {
                    self.error_at(
                        (file, node_start, self.end_inside_parentheses(file, e)),
                        2350,
                        &[],
                    );
                }
                if self.sig_this_type(sig) == Some(TypeId::VOID) {
                    self.error_at(
                        (file, node_start, self.end_inside_parentheses(file, e)),
                        2679,
                        &[],
                    );
                }
            }
            return;
        }
        let start = self.start_of(file, data.callee);
        self.error_at(
            (file, start, self.error_end_of(file, data.callee)),
            2351,
            &[],
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
    ) -> Vec<Reported> {
        let hir = self.hir(file);
        let (from, to) = self.error_range_of_expr(file, target);
        let here = |code: u32| Reported::bare((file, from, to), code);
        let mut related = Vec::new();
        // `invocationErrorDetails`
        if let Some(awaited) = self.awaited_or_none(apparent) {
            let awaited = self.reduced_apparent_type(awaited);
            if !self.signatures(awaited, construct).is_empty() {
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
    fn originating_import(&self, ty: TypeId) -> Option<(Sym, Reported)> {
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
        let import = Reported::bare(
            (
                file,
                hir[statement].start,
                self.end_of_stmt(file, statement),
            ),
            7038,
        );
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
            args: held(vec![name]),
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
        for &part in self.parts(apparent) {
            let reduced = self.reduced_apparent_type(part);
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
    fn check_assertion_target(&mut self, file: FileId, e: ExprId, c: CallId, sig: Option<SigId>) {
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
        self.error_at(
            (file, start, self.end_of_expr(file, data.callee)),
            code,
            &[],
        );
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
    fn name_in_need_of_a_type_annotation(&mut self, file: FileId, e: ExprId) -> Option<Reported> {
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
        Some(self.new_diagnostic(at, 2782, &[sink::Arg::Text(&name)]))
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
    fn check_super_call(&mut self, file: FileId, e: ExprId, c: CallId) {
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
        self.resolved_signature(file, e);
        // In a class without a base type `super` is in error too, and its type is `any`.
        let callee = hir[c].callee;
        let called = self.type_of_expr(file, callee);
        if self.is_any(called) {
            return;
        }
        // `getInstantiatedConstructorsForTypeArguments`: the constructors of the base that take as many type arguments as the
        // `extends` clause gives, given them.
        let given = self.types_from_nodes(file, hir[class].extends_args);
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
            self.report_call_resolution(file, e);
        }
    }

    /// `resolveTaggedTemplateExpression`
    fn check_tagged_template(&mut self, file: FileId, e: ExprId, c: CallId) {
        let hir = self.hir(file);
        let data = hir[c];
        self.resolved_signature(file, e);
        let tag = self.type_of_expr(file, data.callee);
        let apparent = self.apparent_type(tag);
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
            self.error_at(
                (file, start, self.error_end_of(file, data.callee)),
                code,
                &[],
            );
            if !is_element {
                self.explain_chain(start, code, |c| c.invocation_error_lines(apparent, false));
                self.relate(start, code, |c| {
                    c.related_to_invocation_error(file, data.callee, apparent, false, false)
                });
            }
            return;
        }
        self.report_call_resolution(file, e);
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
                && !self.reduced(apparent).is_never()
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

    /// The same, and the class that declares the constructor.
    pub(super) fn inaccessible_constructor(
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
            .map(|c| self.class_sym(file, c))
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
                TypeData::Ref {
                    target: base,
                    args: TypeArguments::Given(args),
                } if args.is_empty() => {
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
            CallLike::Jsx(_) => return None,
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

    /// What `resolveCall` said of the call `e` when it was resolved for good.
    pub(super) fn report_call_resolution(&mut self, file: FileId, e: ExprId) {
        if let Some(said) = self.p.said_of_calls.get_ref(&(file, e)) {
            self.reported.extend_from_slice(said);
        }
    }

    /// `reportCallResolutionErrors`
    pub(super) fn report_call_resolution_errors(
        &mut self,
        s: &CallState<'_>,
        sigs: &[SigId],
        head: Option<u32>,
    ) {
        let (file, node, type_args) = (s.file, s.node, s.type_args);
        let hir = self.hir(file);
        let type_argument_list = match node {
            CallLike::Call(c) => Some(hir[c].type_args),
            CallLike::Jsx(j) if hir[j].tag.is_some() => Some(hir[j].type_args),
            _ => None,
        };
        if let Some(&last) = s.candidates_for_argument_error.last() {
            let from = self.reported.len();
            self.is_signature_applicable(s, last, Relation::Assignable, CheckMode::empty(), true);
            let said: Vec<(u32, u32)> = self.reported[from..]
                .iter()
                .map(|d| (d.start, d.code))
                .collect();
            let is_overloaded = s.candidates_for_argument_error.len() > 1;
            let related = if said.is_empty() {
                Vec::new()
            } else {
                self.related_to_failed_candidate(s, last, is_overloaded)
            };
            for (start, mut code) in said {
                if is_overloaded {
                    self.explain_under(start, code, 2770, &[]);
                    self.explain_under(start, 2770, 2769, &[]);
                    code = 2769;
                }
                if let Some(head) = head {
                    self.explain_under(start, code, head, &[]);
                    code = head;
                }
                if !related.is_empty() {
                    self.relate(start, code, |_| related.clone());
                }
            }
        } else if let Some(sig) = s.candidate_for_argument_arity_error {
            self.report_argument_arity(s, &[sig], head);
        } else if let (Some(candidate), Some(list)) =
            (s.candidate_for_type_argument_error, type_argument_list)
        {
            let type_params = self.sig_type_params(candidate);
            if let Ok(Some((index, given, constraint))) =
                self.failing_type_argument(candidate, &type_params, type_args)
            {
                let node = hir.ids(list).nth(index).unwrap();
                let end = self.end_of_type_node(file, node);
                // 2344, or what says more.
                self.report_not_assignable_with_end(given, constraint, hir[node].pos, end, 2344);
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
                self.report_argument_arity(s, &fitting, head);
            } else if let Some(list) = type_argument_list {
                self.report_type_argument_arity(file, list, sigs);
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
            return (file, hir[func].start, hir[func].start);
        }
        let (start, end) = self.error_range_of_fn(file, func);
        (file, start, end)
    }

    /// `The last overload is declared here.`, of the candidate `last`. Nothing if it has no declaration.
    pub(super) fn last_overload_declared_here(&mut self, last: SigId) -> Vec<Reported> {
        let declared = self.declared_sig(last);
        match self.sig_decl(declared) {
            Some((file, func, _)) => vec![Reported::bare(
                self.place_of_signature_declaration(file, func),
                2771,
            )],
            None => Vec::new(),
        }
    }

    /// `addImplementationSuccessElaboration`: the first declaration with a body of what declares the overload `failed`, as
    /// `getSignatureFromDeclaration` has it. `None`: there is none, or nothing else declares what `failed` declares.
    pub(super) fn implementation_of_overload(&mut self, failed: SigId) -> Option<SigId> {
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
            .filter(|&m| {
                hir[m].kind == MemberKind::Constructor && !hir[m].flags.contains(Flags::STATIC)
            })
            .map(|m| hir[m].func)
            .collect();
        if constructors.len() < 2 {
            return None;
        }
        let implementation = constructors.iter().copied().find(|&f| has_body(&hir[f]))?;
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

    /// What `reportCallResolutionErrors` relates to each thing it says of `last`, the last of `candidatesForArgumentError`.
    /// `is_overloaded`: there are more of those.
    fn related_to_failed_candidate(
        &mut self,
        s: &CallState<'_>,
        last: SigId,
        is_overloaded: bool,
    ) -> Vec<Reported> {
        let implementation = self.add_implementation_success_elaboration(s, last);
        let mut related = if is_overloaded {
            self.last_overload_declared_here(last)
        } else {
            Vec::new()
        };
        if let Some(implementation) = implementation
            && let Some((of, func, _)) = self.sig_decl(implementation)
        {
            related.push(Reported::bare(
                self.place_of_signature_declaration(of, func),
                2793,
            ));
        }
        related
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
            if !self.is_assignable(filled[i], constraint) {
                return Ok(Some((i, filled[i], constraint)));
            }
        }
        Ok(None)
    }

    /// `isSignatureApplicable`. Where something could not be found out it is, but for the subtype pass.
    pub(super) fn is_signature_applicable(
        &mut self,
        s: &CallState<'_>,
        sig: SigId,
        relation: Relation,
        check_mode: CheckMode,
        report: bool,
    ) -> bool {
        if let CallLike::Jsx(_) = s.node {
            return self.check_applicable_signature_for_jsx_call_like_element(
                s.file,
                s.call,
                sig,
                relation,
                check_mode,
                s.checks_arguments_once,
                report,
            );
        }
        let (file, e, node, args, this_arg) = (s.file, s.call, s.node, s.args, s.this_arg);
        let hir = self.hir(file);
        let params = self.sig_params(sig);
        // What a decorator is applied to is made up (`createSyntheticExpression`): an error about it is at the expression.
        let decorator = match node {
            CallLike::Decorator(_) if report => Some(self.where_decorator_is(file, e)),
            _ => None,
        };
        if let Some(wanted) = self.sig_this_type(sig)
            && wanted != TypeId::VOID
            && self.checks_this_argument(file, e, node)
        {
            let given = self.this_argument_type(file, this_arg);
            if !self.related(given, wanted, relation) {
                if report {
                    let (start, end) = match (this_arg, decorator) {
                        (None, Some(written)) => (written.at_sign, written.end),
                        _ => (
                            self.start_of(file, this_arg.unwrap_or(e)),
                            self.error_end_of(file, this_arg.unwrap_or(e)),
                        ),
                    };
                    // 2684, or what says more.
                    self.report_not_assignable_with_end(given, wanted, start, end, 2684);
                }
                return false;
            }
        }
        let rest = self.non_array_rest_type(&params);
        let count = if rest.is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        for (i, &arg) in args.iter().enumerate().take(count) {
            let node = arg.node();
            if matches!(hir[node].kind, ExprKind::Missing) {
                continue;
            }
            let Some(wanted) = self.param_type_at(&params, i) else {
                continue;
            };
            let given = match arg {
                Arg::Expr(x) if s.checks_arguments_once => {
                    self.arg_type_kept_under(file, x, wanted)
                }
                _ => self.arg_type_under(file, arg, wanted, check_mode),
            };
            // `getRegularTypeOfObjectLiteral`: properties there are too many of do not count before everything is looked at.
            let given = if check_mode.contains(CheckMode::SKIP_CONTEXT_SENSITIVE) {
                self.regular_type_of_object_literal(given)
            } else {
                given
            };
            if self.related(given, wanted, relation) {
                continue;
            }
            let check_node = self.effective_check_node(file, node);
            let inner = if matches!(arg, Arg::Expr(_)) {
                check_node
            } else {
                ExprId::NONE
            };
            if report {
                let jsdoc_type_assertion = self.range_of_jsdoc_type_assertion(file, check_node);
                let (at, end) = match (decorator, jsdoc_type_assertion) {
                    (Some(written), _) => (written.start, written.end),
                    (None, Some(range)) => range,
                    (None, None) => (
                        self.start_inside_parentheses(file, check_node),
                        self.error_end_inside_parentheses(file, check_node),
                    ),
                };
                let said = self.reported.len();
                self.check_assignable_with_end(file, given, wanted, at, end, inner, 2345);
                let (from, to) = self.error_range_of_expr(file, node);
                let first = self.reported.get(said).map(|d| (d.start, d.code));
                self.maybe_add_missing_await_info((file, from, to), given, wanted, first);
                // `checkTypeRelatedToEx`: what `import * as ns` imports would have done.
                if let Some((module, import)) = self.originating_import(given) {
                    let imported = self.type_of_symbol(module);
                    if self.is_assignable(imported, wanted) {
                        self.relate(at, 2345, |_| vec![import]);
                    }
                }
            }
            return false;
        }
        if let Some(rest) = rest {
            let given = self.spread_argument_type(file, args, count, rest, None, check_mode);
            if !self.related(given, rest, relation) {
                if report {
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
                                match self.range_of_jsdoc_type_assertion(file, check_node) {
                                    Some(range) => range,
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
                    let said = self.reported.len();
                    self.check_assignable_with_end(file, given, rest, at, end, ExprId::NONE, 2345);
                    let first = self.reported.get(said).map(|d| (d.start, d.code));
                    self.maybe_add_missing_await_info((file, at, end), given, rest, first);
                }
                return false;
            }
        }
        true
    }

    /// `maybeAddMissingAwaitInfo`. `place`: the argument. `said`: the first thing that was said of it.
    fn maybe_add_missing_await_info(
        &mut self,
        place: (FileId, u32, u32),
        source: TypeId,
        target: TypeId,
        said: Option<(u32, u32)>,
    ) {
        let Some(d) = said else { return };
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
        if self.is_assignable(awaited, target) {
            self.relate(d.0, d.1, |_| vec![Reported::bare(place, 2773)]);
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
    ) -> Vec<Reported> {
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
        let declares_this = hir[func].this_ty(hir).is_some();
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
        vec![Reported::new((file, start, end), code, held(args))]
    }

    /// `getArgumentArityError`: 2554 2555 2556 2575 2794 2810, and 1278 1279 of a decorator. `head`: `headMessage`.
    fn report_argument_arity(&mut self, s: &CallState<'_>, sigs: &[SigId], head: Option<u32>) {
        let (file, e, node, args) = (s.file, s.call, s.node, s.args);
        if let Some(spread) = args.iter().find(|a| matches!(a, Arg::Spread(..))) {
            let start = self.start_of(file, spread.node());
            self.error_at(
                (file, start, self.end_of_expr(file, spread.node())),
                2556,
                &[],
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
            if self.hir(file).is_js { 2810 } else { 2794 }
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
        } else {
            let start = self.start_of(file, args[most].node());
            let end = self.end_of_expr(file, args[args.len() - 1].node());
            ((start, end), code, vec![expected, given])
        };
        self.note_printed(start, end, code, held(counted));
        let top = head.unwrap_or(code);
        if let Some(head) = head {
            self.explain_under(start, code, head, &[]);
        }
        self.error_at((file, start, 0), top, &[]);
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
    pub(super) fn report_type_argument_arity(
        &mut self,
        file: FileId,
        type_args: IdList<TypeNodeId>,
        sigs: &[SigId],
    ) {
        let hir = self.hir(file);
        let Some(first) = hir.ids(type_args).next() else {
            return;
        };
        let given = type_args.len();
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
        let end = self.end_of_type_argument_list(file, type_args);
        self.add_diagnostic(Reported::new(
            (file, hir[first].pos, end),
            code,
            held(counts),
        ));
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
