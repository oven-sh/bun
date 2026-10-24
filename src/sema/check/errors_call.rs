//! Errors about calls, `new` and tagged templates: the callee isn't callable, or not with these arguments. The errors
//! `resolveCall` reports for a decorator and for `instanceof` are reported here too.
//!
//! The order of the checks, the messages and their positions mirror `resolveCallExpression`, `resolveNewExpression`,
//! `resolveTaggedTemplateExpression`, `resolveCall`, `chooseOverload`, `isSignatureApplicable`,
//! `reportCallResolutionErrors` and `getArgumentArityError` in TypeScript 7.0.2's checker.go. One difference: an
//! argument that isn't a literal has a single type here, the one computed when the call was resolved, whereas tsgo
//! rechecks it for each candidate (`check_argument`). Whenever that leaves a candidate's applicability undecided,
//! nothing is reported.

use super::call::{Arg, CallLike, CallState};
use super::explain::{Line, NOWHERE};
use super::relate::Relation;
use super::sink::{held, number_text};
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent};

/// The argument counts that a call's candidates accept.
pub(super) struct ArgumentCounts {
    /// `minCount`
    pub(super) least: usize,
    /// `maxCount`
    pub(super) most: usize,
    /// `maxBelow`: the largest minimum argument count that's below the number of arguments.
    pub(super) most_below: usize,
    /// `minAbove`: the smallest parameter count that's above the number of arguments.
    pub(super) least_above: usize,
    pub(super) has_rest: bool,
}

impl ArgumentCounts {
    /// `parameterRange`
    pub(super) fn expected(&self) -> Vec<u8> {
        if !self.has_rest && self.least < self.most {
            cat!(number_text(self.least), b"-", number_text(self.most))
        } else {
            number_text(self.least)
        }
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_calls(&mut self, file: FileId) {
        let hir = self.hir(file);
        for (i, e) in hir.exprs.iter().enumerate() {
            if matches!(
                e.kind,
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_)
            ) {
                self.check_call_like(file, ExprId(i as u32));
            }
        }
    }

    /// `checkCallExpression`, `checkNewExpression` or `checkTaggedTemplateExpression`, if `e` is one of them.
    pub(super) fn check_call_like(&mut self, file: FileId, e: ExprId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let i = e.idx();
        if !matches!(
            hir.exprs[i].kind,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_)
        ) || bound.is_unchecked(i)
            // The ranges only cover the task's file.
            || self.task.file == Some(file) && self.is_never_checked(hir.exprs[i].pos)
        {
            return;
        }
        // `checkVariableLikeDeclaration` returns after `checkAliasSymbol` for `const x = require("m")`, so it never
        // checks the call.
        if let Parent::VarInit(d) = bound.parent_of_expr(ExprId(i as u32))
            && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
            && self.external_module_require_argument(file, d).is_some()
        {
            return;
        }
        match hir.exprs[i].kind {
            ExprKind::Call(c) => self.check_call(file, e, c, false),
            ExprKind::New(c) => self.check_call(file, e, c, true),
            ExprKind::TaggedTemplate(c) => self.check_tagged_template(file, e, c),
            _ => {}
        }
    }

    /// `checkNonNullTypeWithReporter` with `reportCannotInvokePossiblyNullOrUndefinedError`, and
    /// `checkNonNullExpression` for `new`.
    pub(super) fn check_non_null_callee(
        &mut self,
        file: FileId,
        callee: ExprId,
        called: TypeId,
        is_new: bool,
    ) -> TypeId {
        let from = self.reported.len();
        let called = self.check_non_null_type(file, callee, called);
        for i in from..self.reported.len() {
            let code = match self.reported[i].code {
                other if is_new => other,
                18047 | 2531 => 2721,
                18048 | 2532 => 2722,
                18049 | 2533 => 2723,
                18050 if matches!(self.hir(file)[callee].kind, ExprKind::Null) => 2721,
                18050 => 2722,
                other => other,
            };
            if code != self.reported[i].code {
                let end = self.error_end_of(file, callee);
                let d = &mut self.reported[i];
                (d.code, d.end, d.args) = (code, end, Default::default());
            }
        }
        called
    }

    fn check_call(&mut self, file: FileId, e: ExprId, c: CallId, is_new: bool) {
        let hir = self.hir(file);
        let data = hir[c];
        // The `super` of `new super()` is the same as in `super.x`: an instance of the base.
        if !is_new && matches!(hir[data.callee].kind, ExprKind::Super) {
            self.check_super_call(file, e, c);
            return;
        }
        // The call is fully resolved before candidates are retried.
        let resolved = self.resolved_signature(file, e);
        if let Some(reported) = self
            .p
            .diagnostics_of_re_resolved_calls
            .get_ref(&self.task, &(file, e))
        {
            self.reported.extend_from_slice(reported);
        }
        let called = if is_new {
            self.type_of_expr(file, data.callee)
        } else {
            self.chain_receiver(file, data.callee, data.chain).0
        };
        let called = self.check_non_null_callee(file, data.callee, called, is_new);
        // `silentNeverSignature`
        if called == TypeId::SILENT_NEVER {
            return;
        }
        let apparent = self.apparent_type(called);
        // `resolveErrorCall`
        if self.is_error_type(apparent) {
            return;
        }
        let has_type_args = !data.type_args.is_empty();
        // `getSignaturesOfType` uses `getReducedApparentType`: an intersection that reduces to never has no signatures.
        let reduced = self.reduced(apparent);
        // tsgo reports what the call found when it was resolved.
        let found_none = (self.p.calls_before_signatures)
            .get(&self.task, &(file, e))
            .is_some();
        // That resolution may have been nested in another resolution of the same call, which then continued with the
        // signatures. The errors of that one are reported too.
        if found_none {
            self.report_call_resolution(file, e);
        }
        let call_sigs = if found_none {
            List::default()
        } else {
            self.signatures(reduced, false)
        };
        // These are ignored if the callee can be called.
        let construct_sigs = if !found_none && (is_new || call_sigs.is_empty()) {
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
                if !construct_sigs.is_empty() {
                    let node_start = self.start_inside_parentheses(file, e);
                    let end = self.end_inside_parentheses(file, e);
                    self.error_at((file, node_start, end), 2348, &[sink::Arg::Type(called)]);
                    return;
                }
                // `invocationErrorDetails`: a parenthesized access doesn't count as a called access.
                let is_bare = !is_parenthesized(hir, data.callee);
                let start = match hir[data.callee].kind {
                    ExprKind::Dot { .. } if is_bare => hir.name_pos(data.callee),
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
                    ExprKind::Dot { .. } if is_bare => {
                        self.end_of_name_at(file, hir.name_pos(data.callee))
                    }
                    _ => self.error_end_of(file, data.callee),
                };
                let how = (false, data.args.len() == 1);
                self.invocation_error((file, start, end), code, data.callee, apparent, how, None);
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
            if let Some((modifiers, class)) =
                self.inaccessible_constructor(file, e, construct_sigs[0])
            {
                let node_start = self.start_inside_parentheses(file, e);
                let end = self.end_inside_parentheses(file, e);
                let declaring = self.declared_type(class);
                for (modifier, code) in [(Flags::PRIVATE, 2673), (Flags::PROTECTED, 2674)] {
                    if modifiers.contains(modifier) {
                        self.error_at((file, node_start, end), code, &[sink::Arg::Type(declaring)]);
                    }
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
            // `resolveCall` returns a signature whether or not one is applicable to the arguments.
            let sig = resolved.sig.or(only);
            // `signature.declaration != nil`
            let has_declaration =
                sig.map(|sig| self.sig_decl(self.types().sig_origin(sig)).is_some());
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
        let at = self.span_of_parenthesized_expr(file, data.callee);
        self.invocation_error(at, 2351, data.callee, apparent, (true, false), None);
    }

    /// `getResolvedSignature(node) == silentNeverSignature`, for the call or the `new` expression `e`:
    /// `resolveCallExpression` and `resolveNewExpression` returned before checking any argument.
    pub(super) fn is_silent_never_signature(&mut self, file: FileId, e: ExprId) -> bool {
        let resolved = self.resolved_signature(file, e);
        resolved.sig.is_none() && resolved.ret == TypeId::SILENT_NEVER
    }

    /// `invocationError`. `head` is the head message that `resolveDecorator` chains on top of `invocationErrorDetails`,
    /// before `invocationErrorRecovery`.
    pub(super) fn invocation_error(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        target: ExprId,
        apparent: TypeId,
        (construct, has_one_argument): (bool, bool),
        head: Option<u32>,
    ) {
        let mut diagnostic = Reported::bare(at, code);
        let lines = self.invocation_error_lines(apparent, construct);
        super::explain::add_lines(&mut diagnostic.message_chain, lines);
        diagnostic.related_information =
            self.related_to_invocation_error(at.0, target, apparent, construct, has_one_argument);
        if let Some(head) = head {
            diagnostic = self.new_diagnostic_chain(Some(diagnostic), at, head, &[]);
        }
        self.add_diagnostic(diagnostic);
    }

    /// The related information `invocationError` adds to 2349, 6234 or 2351, reported for `target`, whose apparent type
    /// is `apparent`. `has_one_argument` is true for a call with one argument, not for a `new` expression or a tagged
    /// template.
    fn related_to_invocation_error(
        &mut self,
        file: FileId,
        target: ExprId,
        apparent: TypeId,
        construct: bool,
        has_one_argument: bool,
    ) -> Vec<Reported> {
        let hir = self.hir(file);
        let at = self.span_of_parenthesized_expr(file, target);
        let here = |code: u32| Reported::bare(at, code);
        let mut related = Vec::new();
        // `invocationErrorDetails`
        if let Some(awaited) = self.awaited_or_none(apparent) {
            let awaited = self.reduced_apparent_type(awaited);
            // `apparent` had none when the call was resolved.
            if awaited != apparent && !self.signatures(awaited, construct).is_empty() {
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

    /// `exportTypeLinks.Get(t.symbol)` for a type created by `import * as ns`: its `target`, which is the imported
    /// symbol, and 7038 at its `originatingImport`.
    pub(super) fn originating_import(&self, ty: TypeId) -> Option<(Sym, Reported)> {
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
        let statement = hir[import].stmt.some()?;
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

    /// `invocationErrorDetails`: the messages chained under 2349, 6234 or 2351, for a callee whose apparent type is
    /// `apparent`.
    pub(super) fn invocation_error_lines(
        &mut self,
        apparent: TypeId,
        construct: bool,
    ) -> Vec<Line> {
        let line = |code: u32, name: Vec<u8>, level: u32| Line {
            code,
            args: held(vec![name]),
            level,
        };
        let (none_of_type, not_all, no_constituent, incompatible) = if construct {
            (2761, 2760, 2759, 2762)
        } else {
            (2757, 2756, 2755, 2758)
        };
        // `apparent_type` returns some intersections unchanged.
        let printed = self.apparent_type_of_intersection(apparent);
        let whole = self.type_to_string(printed);
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

    /// `checkCallExpression`: 2776 and 2775 for a call that's an expression statement and whose signature is an
    /// assertion.
    fn check_assertion_target(&mut self, file: FileId, e: ExprId, c: CallId, sig: Option<SigId>) {
        let hir = self.hir(file);
        let data = hir[c];
        let Some(sig) = sig else { return };
        if data.chain == Chain::Start
            || !matches!(self.bound(file).parent_of_expr(e), Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::Expr(_)))
            || is_parenthesized(hir, e)
        {
            return;
        }
        // `getOptionalCallSignature`: `void | undefined` after a `?.` that may short-circuit.
        let return_type = self.type_of_expr(file, e);
        if self.flags(return_type) & tf::VOID == 0
            || self.sig_predicate(sig).is_none()
            // The initializer of a `for` and the object of a `with` are stored as statements too.
            || hir.kind(hir.parent(hir.node(e))) != Kind::ExpressionStatement
        {
            return;
        }
        let start = self.start_of(file, data.callee);
        let at = (file, start, self.end_of_expr(file, data.callee));
        if !is_dotted_name(hir, data.callee) {
            self.error_at(at, 2776, &[]);
        } else if self.effects_signature(file, e).is_none() {
            let mut diagnostic = Reported::bare(at, 2775);
            self.explicit_type(file, data.callee, Some(&mut diagnostic));
            self.add_diagnostic(diagnostic);
        }
    }

    /// `resolveCallExpression`, where the callee is `super`.
    fn check_super_call(&mut self, file: FileId, e: ExprId, c: CallId) {
        let hir = self.hir(file);
        // `checkSuperExpression`: anywhere but directly in a constructor, with no function or arrow function in
        // between, `super` is an error, and nothing else is reported.
        let container = hir.get_super_container(hir.node(e));
        let Some(class) = hir.class_of(hir.parent(container)).some() else {
            return;
        };
        if hir.kind(container) != Kind::Constructor || hir[class].extends.is_none() {
            return;
        }
        self.resolved_signature(file, e);
        // In a class without a base type `super` is an error too, and its type is `any`.
        let callee = hir[c].callee;
        let called = self.type_of_expr(file, callee);
        if self.is_any(called) {
            return;
        }
        // `getInstantiatedConstructorsForTypeArguments`: the base constructors that accept the number of type arguments
        // in the `extends` clause, instantiated with them.
        let actual = self.types_from_nodes(file, hir[class].extends_args);
        let mut sigs = Vec::new();
        for sig in self.signatures(called, true) {
            let type_params = self.sig_type_params(sig);
            if actual.len() < self.min_type_argument_count(&type_params)
                || actual.len() > type_params.len()
            {
                continue;
            }
            if type_params.is_empty() {
                sigs.push(sig);
                continue;
            }
            let filled = self.fill_sig_type_args(sig, &type_params, &actual);
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
            // If it's parenthesized, the parenthesized expression is the array element.
            let is_element = !is_parenthesized(hir, e)
                && matches!(self.bound(file).parent_of_expr(e), Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Array(_)));
            let at = self.span_of_parenthesized_expr(file, data.callee);
            if is_element {
                self.error_at(at, 2796, &[]);
            } else {
                self.invocation_error(at, 2349, data.callee, apparent, (false, false), None);
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

    /// `invocationErrorDetails`: true if `e` is `a.b` or `a["b"]` where `b` has `SymbolFlagsGetAccessor`, i.e. it's
    /// declared with `get` or with `accessor`.
    fn is_get_accessor_access(&mut self, file: FileId, e: ExprId) -> bool {
        let (obj, name) = match self.hir(file)[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, name),
            // `getPropertyTypeForIndexType` records the property as the element access's symbol
            // (`AccessFlagsCacheSymbol`).
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
        let receiver = self.non_null_type(receiver);
        (self.get_property_of_type(receiver, name))
            .is_some_and(|(prop, _)| self.has_get_accessor(prop))
    }

    /// `prop.Flags&SymbolFlagsGetAccessor != 0`
    fn has_get_accessor(&mut self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Symbol(sym) => {
                (self.flags_of_property(*sym)).contains(SymFlags::GET_ACCESSOR)
            }
            // `SymbolFlagsProperty|member.Flags`
            PropSource::Literal(f, p) => {
                (self.flags_of_literal_member(*f, *p)).contains(SymFlags::GET_ACCESSOR)
            }
            // `propFlags` of `createUnionOrIntersectionProperty`
            PropSource::Intersected(..) => {
                prop.flags & (PropFlags::ACCESSOR | PropFlags::WRITE_ONLY) == PropFlags::ACCESSOR
            }
            // It has the first one's flags.
            PropSource::Copy(_, copied, true) => copied
                .first()
                .is_some_and(|first| self.has_get_accessor(first)),
            _ => false,
        }
    }

    /// `isConstructorAccessible`. Returns `None` if it is, otherwise the constructor's accessibility modifiers, each of
    /// which is an error, and the class that declares it.
    pub(super) fn inaccessible_constructor(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
    ) -> Option<(Flags, Sym)> {
        // A cloned signature has its original's declaration.
        let mut sig = sig;
        let mut steps = 0;
        let (declaring, of, func) = loop {
            match *self.types().sig(self.types().sig_origin(sig)) {
                SigData::Construct {
                    class, file, func, ..
                } => break (class, file, func),
                // `getDefaultConstructSignatures` clones the signatures of the base constructor type. The base types
                // aren't requested, so that `new a()` in the base expression of `a` doesn't get 2310.
                SigData::DefaultConstruct { base, .. } => {
                    steps += 1;
                    if steps > 64 {
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
        if enclosing.contains(&declaring) {
            return None;
        }
        if modifiers.contains(Flags::PROTECTED)
            && let Some(&containing) = enclosing.first()
            && self.has_protected_accessible_base(declaring, containing, 0)
        {
            return None;
        }
        Some((modifiers, declaring))
    }

    /// `typeHasProtectedAccessibleBase`: true if `class` derives from `target` through first base types. (Members that
    /// `findMixins` would drop from an intersection are kept: it looks for constructor types, and these are instance
    /// types.)
    fn has_protected_accessible_base(&mut self, target: Sym, class: Sym, depth: u32) -> bool {
        let Some(&first) = self.base_types(class).first() else {
            return false;
        };
        if depth > 64 {
            return false;
        }
        match self.data(first) {
            // For an intersection, its member classes and interfaces that aren't instantiations of generic ones.
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
        actual: usize,
    ) -> bool {
        actual == 0
            || actual >= self.min_type_argument_count(type_params) && actual <= type_params.len()
    }

    /// `getMinTypeArgumentCount`
    pub(super) fn min_type_argument_count(&self, type_params: &[TypeId]) -> usize {
        type_params
            .iter()
            .rposition(|&param| !self.has_type_parameter_default(param))
            .map_or(0, |last| last + 1)
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

    /// `isSignatureApplicable`: true if the call's receiver is checked against the signature's `this` type. It isn't
    /// for `new`, nor for a call of `super.m` in exactly that form.
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

    /// The errors `resolveCall` reported for the call `e` in its final resolution.
    pub(super) fn report_call_resolution(&mut self, file: FileId, e: ExprId) {
        if let Some(reported) = self.p.call_diagnostics.get_ref(&self.task, &(file, e)) {
            self.reported.extend_from_slice(reported);
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
            CallLike::Call(c) => Some(hir.list_at(hir[c].type_args)),
            CallLike::Jsx(j) if hir[j].tag.is_some() => Some(hir[j].type_args),
            _ => None,
        };
        if let Some(&last) = s.candidates_for_argument_error.last() {
            let from = self.reported.len();
            self.is_signature_applicable(s, last, Relation::Assignable, CheckMode::empty(), true);
            let reported = self.take_reported_from(from);
            let is_overloaded = s.candidates_for_argument_error.len() > 1;
            let related = if reported.is_empty() {
                Vec::new()
            } else {
                self.related_to_failed_candidate(s, last, is_overloaded)
            };
            let overloaded: &[u32] = if is_overloaded { &[2770, 2769] } else { &[] };
            for mut diagnostic in reported {
                for &on_top in overloaded.iter().chain(&head) {
                    diagnostic = self.new_diagnostic_chain(Some(diagnostic), NOWHERE, on_top, &[]);
                }
                diagnostic
                    .related_information
                    .extend(related.iter().cloned());
                self.add_diagnostic(diagnostic);
            }
        } else if let Some(sig) = s.candidate_for_argument_arity_error {
            self.report_argument_arity(s, &[sig], head);
        } else if let (Some(candidate), Some(list)) =
            (s.candidate_for_type_argument_error, type_argument_list)
        {
            let type_params = self.sig_type_params(candidate);
            self.check_type_arguments(candidate, &type_params, type_args, Some((file, list)));
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

    /// `GetErrorRangeForNode` for the declaration `func` of a signature.
    pub(super) fn span_of_signature_declaration(
        &self,
        file: FileId,
        func: FnId,
    ) -> (FileId, u32, u32) {
        let hir = self.hir(file);
        // The default library's source text isn't stored.
        if hir.text.is_empty() {
            return (file, hir[func].start, hir[func].start);
        }
        let (start, end) = self.error_range_of_fn(file, func);
        (file, start, end)
    }

    /// `The last overload is declared here.` for the candidate `last`. Empty if it has no declaration.
    pub(super) fn last_overload_declared_here(&mut self, last: SigId) -> Vec<Reported> {
        let declared = self.declared_sig(last);
        match self.sig_decl(declared) {
            Some((file, func, _)) => vec![Reported::bare(
                self.span_of_signature_declaration(file, func),
                2771,
            )],
            None => Vec::new(),
        }
    }

    /// The related information `reportCallResolutionErrors` adds to each diagnostic for `last`, the last of
    /// `candidatesForArgumentError`. `is_overloaded` is true if there's more than one candidate.
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
                self.span_of_signature_declaration(of, func),
                2793,
            ));
        }
        related
    }

    /// `checkTypeArguments`: returns `typeArgumentTypes`, or `None` if one of `type_args` doesn't satisfy its
    /// constraint. `error_nodes` is `typeArgumentNodes`, with `reportErrors`. A call that has a `headMessage` has no
    /// type arguments.
    pub(super) fn check_type_arguments(
        &mut self,
        sig: SigId,
        type_params: &[TypeId],
        type_args: &[TypeId],
        error_nodes: Option<(FileId, IdList<TypeNodeId>)>,
    ) -> Option<Vec<TypeId>> {
        let is_js = (self.sig_decl(sig)).is_some_and(|(file, ..)| self.hir(file).is_js);
        let filled = self.fill_sig_type_args_as(sig, type_params, type_args, is_js);
        let mapper = self.mapper_from(type_params, &filled);
        let outer = self.outer_mapper_of_sig(sig);
        for i in 0..type_args.len().min(type_params.len()) {
            let Some(constraint) = self.constraint_of_type_param(type_params[i]) else {
                continue;
            };
            let constraint = self.with_outer_type_arguments(type_params[i], constraint, outer);
            let constraint = self.instantiate(constraint, mapper);
            let constraint = self.type_with_this_argument(constraint, filled[i]);
            let error_node = error_nodes.map(|(file, nodes)| {
                let hir = self.hir(file);
                let node: TypeNodeId = hir.id_at(nodes, i);
                let start = super::errors_type_nodes::start_of_type(hir, node);
                (file, start, self.end_of_type_node_from(file, node, start))
            });
            if !self.check_type_assignable_to(filled[i], constraint, error_node, Some(2344)) {
                return None;
            }
        }
        Some(filled)
    }

    /// `isSignatureApplicable`. If something couldn't be determined the result is true, except in the subtype pass.
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
        // A decorator's arguments are synthetic (`createSyntheticExpression`), so an error about one is reported at the
        // decorator expression.
        let decorator = match node {
            CallLike::Decorator(_) if report => Some(self.decorator_position(file, e)),
            _ => None,
        };
        if let Some(expected) = self.sig_this_type(sig)
            && expected != TypeId::VOID
            && self.checks_this_argument(file, e, node)
        {
            let actual = self.this_argument_type(file, this_arg);
            if !self.related(actual, expected, relation) {
                if report {
                    let at = match (this_arg, decorator) {
                        (None, Some(decorator_span)) => {
                            (file, decorator_span.at_sign, decorator_span.end)
                        }
                        _ => self.span_of_parenthesized_expr(file, this_arg.unwrap_or(e)),
                    };
                    // 2684, or a more specific error.
                    self.report_this_not_assignable(actual, expected, at);
                }
                return false;
            }
        }
        let mut params = self.sig_params_with_first(sig, args.len().min(1));
        let is_open = matches!(params, List::Own(_));
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
            // `getTypeAtPosition(signature, i)`: a cycle through a parameter's type is found here, but not for a
            // parameter after the first argument that fails.
            if is_open {
                params = self.sig_params_up_to(sig, i + 1);
            }
            let Some(expected) = self.param_type_asked_at(sig, &params, i) else {
                continue;
            };
            let actual = match arg {
                Arg::Expr(x) if s.checks_arguments_once => {
                    self.cached_arg_type_for_param(file, x, expected)
                }
                _ => self.check_argument(file, arg, expected, None, check_mode),
            };
            // `getRegularTypeOfObjectLiteral`: excess properties aren't checked until all arguments are checked.
            let actual = if check_mode.contains(CheckMode::SKIP_CONTEXT_SENSITIVE) {
                self.regular_type_of_object_literal(actual)
            } else {
                actual
            };
            if self.related(actual, expected, relation) {
                continue;
            }
            self.note_parameter_types_resolved(sig, &params, i + 1);
            if report {
                let check_node = self.effective_check_node(file, node);
                let error_node = match decorator {
                    Some(decorator_span) => (file, decorator_span.start, decorator_span.end),
                    None => self.span_of_effective_check_node(file, check_node),
                };
                let expr = match arg {
                    Arg::Expr(_) => Some((file, check_node)),
                    _ => None,
                };
                let reported = self.reported.len();
                let mut diagnostics = Vec::new();
                // `elaborateError` has no case for a `SyntheticExpression` or a `SpreadElement`.
                let is_elaborated = expr.is_none()
                    && !self.is_or_has_generic_conditional(expected)
                    && self.elaborate_did_you_mean_to_call_or_construct(
                        error_node,
                        actual,
                        expected,
                        Some(2345),
                        Some(&mut diagnostics),
                    );
                if !is_elaborated {
                    self.check_type_assignable_to_and_optionally_elaborate(
                        actual,
                        expected,
                        Some(error_node),
                        expr,
                        true,
                        Some(2345),
                        Some(&mut diagnostics),
                    );
                }
                self.reported.extend(diagnostics);
                let error_span = self.span_of_parenthesized_expr(file, node);
                self.maybe_add_missing_await_info(error_span, actual, expected, reported);
            }
            return false;
        }
        self.note_parameter_types_resolved(sig, &params, args.len());
        if let Some(rest) = rest {
            let actual = self.spread_argument_type(file, args, count, rest, None, check_mode);
            if !self.related(actual, rest, relation) {
                if report {
                    let (at, end) = match decorator {
                        Some(decorator_span) if count == args.len() => {
                            (decorator_span.at_sign, decorator_span.end)
                        }
                        Some(decorator_span) => (decorator_span.start, decorator_span.end),
                        None => match args[count..] {
                            [] => (
                                self.start_inside_parentheses(file, e),
                                self.end_inside_parentheses(file, e),
                            ),
                            [only] => {
                                let check_node = self.effective_check_node(file, only.node());
                                let error_span =
                                    self.span_of_effective_check_node(file, check_node);
                                (error_span.1, error_span.2)
                            }
                            [first, .., last] => (
                                self.start_of(file, first.node()),
                                self.end_of_expr(file, last.node()),
                            ),
                        },
                    };
                    let reported = self.reported.len();
                    self.check_assignable_with_end(file, actual, rest, at, end, ExprId::NONE, 2345);
                    self.maybe_add_missing_await_info((file, at, end), actual, rest, reported);
                }
                return false;
            }
        }
        true
    }

    /// `maybeAddMissingAwaitInfo`. `argument_span` is the argument's span. `reported` is the index in `self.reported`
    /// of the first diagnostic for it.
    fn maybe_add_missing_await_info(
        &mut self,
        argument_span: (FileId, u32, u32),
        source: TypeId,
        target: TypeId,
        reported: usize,
    ) {
        if reported == self.reported.len() {
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
        if self.is_assignable(awaited, target) {
            self.reported[reported].add_related_info(Reported::bare(argument_span, 2773));
        }
    }

    /// `getEffectiveCheckNode`: `e` with enclosing `satisfies` stripped. (Parentheses aren't stored.)
    pub(super) fn effective_check_node(&self, file: FileId, mut e: ExprId) -> ExprId {
        while let ExprKind::Satisfies { expr, .. } = self.hir(file)[e].kind {
            e = expr;
        }
        e
    }

    /// The span of `getErrorNodeForCallNode`.
    fn error_range_of_call_node(&self, file: FileId, e: ExprId, node: CallLike) -> (u32, u32) {
        let hir = self.hir(file);
        match (node, hir[e].kind) {
            (CallLike::Decorator(_), _) => {
                let decorator_span = self.decorator_position(file, e);
                (decorator_span.at_sign, decorator_span.end)
            }
            (CallLike::Call(c), ExprKind::Call(_)) => {
                let callee = hir[c].callee;
                match hir[callee].kind {
                    ExprKind::Dot { .. } if !is_parenthesized(hir, callee) => (
                        hir.name_pos(callee),
                        self.end_of_name_at(file, hir.name_pos(callee)),
                    ),
                    _ => (
                        self.error_start_of(file, callee),
                        self.error_end_of(file, callee),
                    ),
                }
            }
            _ => (
                self.start_inside_parentheses(file, e),
                self.end_inside_parentheses(file, e),
            ),
        }
    }

    /// The counts `getArgumentArityError` computes over `sigs`, for a call with `actual` arguments.
    pub(super) fn argument_counts(&mut self, sigs: &[SigId], actual: usize) -> ArgumentCounts {
        let mut counts = ArgumentCounts {
            least: usize::MAX,
            most: 0,
            most_below: 0,
            least_above: usize::MAX,
            has_rest: false,
        };
        for &sig in sigs {
            let params = self.sig_params_with_first(sig, 0);
            let (from, to) = (
                self.min_argument_count_for(Some(sig), &params),
                self.parameter_count(&params),
            );
            counts.least = counts.least.min(from);
            counts.most = counts.most.max(to);
            if from < actual {
                counts.most_below = counts.most_below.max(from);
            }
            if actual < to {
                counts.least_above = counts.least_above.min(to);
            }
            counts.has_rest |= self.has_effective_rest_parameter(&params);
        }
        counts
    }

    /// `getArgumentArityError`: the parameter of `closestSignature` that corresponds to the first omitted argument.
    /// `actual` is the number of arguments.
    pub(super) fn parameter_without_argument(
        &mut self,
        sigs: &[SigId],
        actual: usize,
    ) -> Vec<Reported> {
        let mut closest: Option<(usize, SigId)> = None;
        for &sig in sigs {
            let params = self.sig_params_with_first(sig, 0);
            let least = self.min_argument_count_for(Some(sig), &params);
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
        // `params` doesn't include a `this` parameter. A signature synthesized for a union may have one even if its
        // declaration doesn't.
        let declares_this = hir[func].this_ty(hir).is_some();
        let has_this = match self.types().sig(sig) {
            SigData::Synth { this, .. } => this.is_some(),
            _ => declares_this,
        };
        let Some(param) = (actual + usize::from(has_this))
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
            PatKind::Missing => (6210, vec![Vec::new()]),
        };
        let start = hir[param].pos;
        // The default library's source text isn't stored.
        let end = if hir.text.is_empty() {
            start
        } else {
            self.end_of_param(file, param)
        };
        vec![Reported::new((file, start, end), code, held(args))]
    }

    /// `getArgumentArityError`: 2554 2555 2556 2575 2794 2810, and 1278 1279 for a decorator. `head` is `headMessage`.
    fn report_argument_arity(&mut self, s: &CallState<'_>, sigs: &[SigId], head: Option<u32>) {
        let (file, e, node, args) = (s.file, s.call, s.node, s.args);
        if let Some(spread) = args.iter().find(|a| a.is_spread()) {
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
            CallLike::Decorator(_) => Some(self.decorator_position(file, e)),
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
            // In JavaScript there's no type argument to put `void` in.
            if self.hir(file).is_js { 2810 } else { 2794 }
        } else {
            2554
        };
        let actual = number_text(args.len());
        let error_range = self.error_range_of_call_node(file, e, node);
        let ((start, end), code, counted) = if least < args.len() && args.len() < most {
            let either = vec![actual, number_text(most_below), number_text(least_above)];
            (error_range, 2575, either)
        } else if args.len() < least || most >= args.len() {
            (error_range, code, vec![expected, actual])
        } else if let Some(decorator_span) = decorator {
            (
                (decorator_span.start, decorator_span.end),
                code,
                vec![expected, actual],
            )
        } else {
            let start = self.start_of(file, args[most].node());
            let end = self.end_of_expr(file, args[args.len() - 1].node());
            ((start, end), code, vec![expected, actual])
        };
        let mut diagnostic = Reported::new((file, start, end), code, held(counted));
        if let Some(head) = head {
            diagnostic = self.new_diagnostic_chain(Some(diagnostic), NOWHERE, head, &[]);
        }
        if args.len() < least && code != 2810 {
            diagnostic.related_information = self.parameter_without_argument(sigs, args.len());
        }
        self.add_diagnostic(diagnostic);
    }

    /// `isPromiseResolveArityError`: the callee is the `resolve` of `new Promise((resolve) => ...)`. Not if `resolve`,
    /// the function or `Promise` is parenthesized, because parentheses are nodes.
    fn is_promise_resolve_arity_error(&mut self, file: FileId, e: ExprId, c: CallId) -> bool {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let callee = hir[c].callee;
        let ExprKind::Ident(name) = hir[callee].kind else {
            return false;
        };
        if !matches!(hir[e].kind, ExprKind::Call(_)) || is_parenthesized(hir, callee) {
            return false;
        }
        let Some(symbol) = self.symbol_of_identifier(file, callee, name) else {
            return false;
        };
        let Some((_, Decl::Param(pat))) = files.value_declaration(symbol) else {
            return false;
        };
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        let FnOwner::Expr(function) = bound.fns[bound.param_fn[p.idx()].idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = bound.parent_of_expr(function) else {
            return false;
        };
        let ExprKind::New(outer) = hir[parent].kind else {
            return false;
        };
        let constructor = hir[outer].callee;
        let ExprKind::Ident(constructor_name) = hir[constructor].kind else {
            return false;
        };
        if is_parenthesized(hir, function) || is_parenthesized(hir, constructor) {
            return false;
        }
        // `getGlobalPromiseConstructorSymbolOrNil`
        let global_promise_symbol = files.global(known::Promise, SymFlags::VALUE);
        global_promise_symbol.is_some()
            && self.symbol_of_identifier(file, constructor, constructor_name)
                == global_promise_symbol
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
        let actual = type_args.len();
        let mut code = 2558;
        let mut counts = Vec::new();
        if sigs.len() > 1 {
            let (mut below, mut above) = (false, false);
            // `belowArgCount`, `aboveArgCount`
            let (mut most_below, mut least_above) = (0usize, usize::MAX);
            for &sig in sigs {
                let type_params = self.sig_type_params(sig);
                let least = self.min_type_argument_count(&type_params);
                if least > actual {
                    above = true;
                    least_above = least_above.min(least);
                } else if type_params.len() < actual {
                    below = true;
                    most_below = most_below.max(type_params.len());
                }
            }
            if below && above {
                code = 2743;
                counts.push(number_text(actual));
                counts.push(number_text(most_below));
                counts.push(number_text(least_above));
            } else {
                let expected = if below { most_below } else { least_above };
                counts.push(number_text(expected));
                counts.push(number_text(actual));
            }
        } else if let [sig] = *sigs {
            let type_params = self.sig_type_params(sig);
            let (least, most) = (
                self.min_type_argument_count(&type_params),
                type_params.len(),
            );
            counts.push(if least < most {
                cat!(number_text(least), b"-", number_text(most))
            } else {
                number_text(least)
            });
            counts.push(number_text(actual));
        }
        let end = self.end_of_type_argument_list(file, type_args);
        self.add_diagnostic(Reported::new(
            (file, start_of_type(hir, first), end),
            code,
            held(counts),
        ));
    }
}

/// `IsLineBreak(rune(text[SkipTriviaEx(text, at, StopAfterLineBreak) - 1]))`: it looks at one byte, so U+2028 and
/// U+2029, which are skipped as white space, don't count.
fn line_breaks_after(text: &[u8], at: usize) -> bool {
    let end = super::spans::skip_trivia_ex(text, at, true);
    matches!(text[..end].last(), Some(b'\n' | b'\r'))
}
