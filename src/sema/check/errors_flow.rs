//! Where control gets to and where it does not: 7027 7028 7029, 2355 2366 2534 7030, 17009 17011, 1104 1105 1107 1114 1115 1116.
//! Where `this` and `super` can be written, and whether a generator is what a generator function says it returns.
//!
//! Follows `checkSourceElementUnreachable`, `checkLabeledStatement`, `checkSwitchStatement`,
//! `checkAllCodePathsInNonVoidFunctionReturnOrThrow`, `checkReturnStatement`, `checkGeneratorInstantiationAssignabilityToReturnType`,
//! `checkThisExpression`, `checkSuperExpression`, `checkThisBeforeSuper` with `isPostSuperFlowNode`, and
//! `checkGrammarBreakOrContinueStatement` of TypeScript 7.0.2's checker.go, flow.go and grammarchecks.go.

use super::errors::Diagnostic;
use super::errors_small::in_file_order;
use super::*;
use crate::bind::{ClassOwner, Flow, FlowId, FnOwner, MemberOwner, Parent, ScopeKind, UNREACHABLE};

/// Whether the statement `s` starts with `word`.
fn starts_with_word(hir: &hir::File, s: StmtId, word: &[u8]) -> bool {
    hir.text
        .get(hir[s].pos as usize..)
        .is_some_and(|text| text.starts_with(word))
}

/// Where the return type `node` starts as it is written. Neither the parentheses around a type are kept nor a `|` or a `&` before
/// its only member, nor the `!` of a JSDocNonNullableType; what comes before a return type is a `:`, which none of these can be
/// mistaken for.
fn start_of_return_type(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text = &hir.text[..];
    let mut at = (hir[node].pos as usize).min(text.len());
    loop {
        let before = text[..at].trim_ascii_end().len();
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&' | b'!') {
            return at as u32;
        }
        at = before - 1;
    }
}

impl Checker<'_> {
    pub(super) fn check_control_flow(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkSignatureDeclaration` runs in declaration files too.
        for f in 0..hir.fns.len() {
            if hir.fns[f].flags.contains(Flags::GENERATOR)
                && !matches!(bound.fns[f].owner, FnOwner::None)
            {
                self.check_generator_return_annotation(file, FnId(f as u32), out);
            }
        }
        if hir.kind == FileKind::Declaration {
            // `checkBreakOrContinueStatement`, `checkLabeledStatement`: a statement is checked wherever it is written.
            if !hir.has_errors {
                self.check_jumps_and_labels(file, out);
            }
            return;
        }
        let options = &self.p.files.options;
        if options.reports_unreachable_code {
            self.check_unreachable_in(file, hir.body, out);
            // `checkDeferredNodes`: function expressions, arrow functions, the methods and accessors of object literals and the
            // members of class expressions are gone through after the statements, whatever they are written in.
            for f in 0..hir.fns.len() {
                let FnBody::Block(list) = hir.fns[f].body else {
                    continue;
                };
                let is_deferred = match bound.fns[f].owner {
                    FnOwner::Expr(_) => true,
                    FnOwner::Member(m) => {
                        matches!(bound.member_owner[m.idx()], MemberOwner::Class(c) if matches!(bound.class_owner[c.idx()], ClassOwner::Expr(_)))
                    }
                    _ => false,
                };
                // `checkWithStatement` does not look at the statement.
                if is_deferred && !hir.is_in_with(hir.fns[f].pos) {
                    self.prepare_fn(file, FnId(f as u32));
                    self.check_unreachable_in(file, list, out);
                }
            }
        }
        if options.reports_unused_labels {
            let looked_at = bound
                .unused_labels
                .iter()
                .filter(|&&s| !hir.is_in_with(hir[s].pos));
            out.extend(looked_at.map(|&s| Diagnostic {
                start: hir[s].pos,
                code: 7028,
            }));
        }
        if options.no_fallthrough_cases_in_switch {
            for c in 0..hir.cases.len() {
                let flow = bound.case_fallthrough[c];
                if flow.is_some() && self.is_reachable(file, flow) {
                    out.push(Diagnostic {
                        start: hir.cases[c].pos,
                        code: 7029,
                    });
                    let end = self.error_range_of_case(file, CaseId(c as u32)).1;
                    self.explain_to(hir.cases[c].pos, end, 7029, |_| vec![]);
                }
            }
        }
        for f in 0..hir.fns.len() {
            if !matches!(bound.fns[f].owner, FnOwner::None) {
                let func = FnId(f as u32);
                self.check_all_code_paths_return(file, func, out);
                self.check_bare_returns(file, func, out);
            }
        }
        self.check_full_signatures(file, out);
        self.check_this_before_super(file, out);
        self.check_super(file, out);
        self.check_this_location(file, out);
        if !hir.has_errors {
            self.check_jumps_and_labels(file, out);
        }
    }

    /// `IsPotentiallyExecutableNode`
    fn is_potentially_executable(&self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        match hir[s].kind {
            StmtKind::Var(decls) => decls
                .iter()
                .any(|d| hir[d].kind != VarKind::Var || hir[d].init.is_some()),
            // Neither a block nor `;` is. But `with (e) s` is kept as a block and `debugger` as `;`, each put where its keyword is.
            StmtKind::Block(_) => starts_with_word(hir, s, b"with"),
            StmtKind::Empty => starts_with_word(hir, s, b"debugger"),
            StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => false,
            _ => true,
        }
    }

    /// `isSourceElementUnreachable`, of what is potentially executable.
    fn is_source_element_unreachable(&mut self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        let flow = self.bound(file).stmt_flow[s.idx()];
        // `ShouldPreserveConstEnums`
        let preserves_const_enums =
            self.p.files.options.preserve_const_enums || self.p.files.options.isolated_modules;
        match hir[s].kind {
            // The binder gives a class, an enum or a namespace no flow node: only what it finds out by itself counts for them.
            StmtKind::Class(_) => self.is_flagged_unreachable(file, flow),
            StmtKind::Enum(e) => {
                self.is_flagged_unreachable(file, flow)
                    && (!hir[e].flags.contains(Flags::CONST) || preserves_const_enums)
            }
            StmtKind::Module(m) => {
                self.is_flagged_unreachable(file, flow)
                    && match self.module_instance_state(file, m) {
                        0 => false,
                        1 => preserves_const_enums,
                        _ => true,
                    }
            }
            _ => flow == UNREACHABLE || !self.is_reachable(file, flow),
        }
    }

    /// `NodeFlagsUnreachable`, of what is bound at `flow`: the binder knows that control does not get there, whatever the types say.
    fn is_flagged_unreachable(&self, file: FileId, flow: FlowId) -> bool {
        flow == UNREACHABLE
            || !self.is_reachable_for_binder(file, flow, &mut Vec::new(), &mut Vec::new())
    }

    /// Whether there is a way to `flow` from where a function, a namespace or the file starts. What is called where it is written
    /// starts nothing (`bindContainer`).
    fn is_reachable_for_binder(
        &self,
        file: FileId,
        mut flow: FlowId,
        seen: &mut Vec<FlowId>,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let bound = self.bound(file);
        loop {
            match bound.flow[flow.idx()] {
                Flow::Unreachable => return false,
                Flow::StartInvoked {
                    outer, plain: true, ..
                } => flow = outer,
                Flow::Start { .. } | Flow::StartInvoked { .. } => return true,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Call { before, .. }
                | Flow::Switch { before, .. } => flow = before,
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    reduced.push((label, instead));
                    let reachable =
                        self.is_reachable_for_binder(file, before, &mut Vec::new(), reduced);
                    reduced.pop();
                    return reachable;
                }
                Flow::Label { start, len } => {
                    if seen.contains(&flow) {
                        return false;
                    }
                    seen.push(flow);
                    let (start, len) = match reduced.iter().rev().find(|r| r.0 == flow) {
                        Some(&(_, instead)) => match bound.flow[instead.idx()] {
                            Flow::Label { start, len } => (start, len),
                            _ => (start, len),
                        },
                        None => (start, len),
                    };
                    return bound
                        .edges(start, len)
                        .iter()
                        .any(|&edge| self.is_reachable_for_binder(file, edge, seen, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) if !seen.contains(&flow) => {
                        seen.push(flow);
                        flow = entry;
                    }
                    _ => return false,
                },
            }
        }
    }

    /// `getModuleInstanceState`: 0 nothing of it is there at run time, 1 `const enum`s only, 2 something is.
    fn module_instance_state(&self, file: FileId, m: ModuleId) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Whether it all comes to nothing the binder has found out, what `export { a }` names included.
        if !bound.module_instantiated[m.idx()] {
            return 0;
        }
        if !hir[m].has_body {
            return 2;
        }
        let mut state = 0u8;
        for s in hir.ids(hir[m].body) {
            state = state.max(match hir[s].kind {
                StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Import(_) => 0,
                StmtKind::ImportEquals(i) if !hir[i].flags.contains(Flags::EXPORT) => 0,
                StmtKind::Enum(e) if hir[e].flags.contains(Flags::CONST) => 1,
                StmtKind::Module(inner) => self.module_instance_state(file, inner),
                // `getModuleInstanceStateForAliasTarget` is not followed: a name that is exported counts as something.
                StmtKind::ExportNamed(x) if hir[x].spec.is_none() && hir[x].items.is_empty() => 0,
                _ => 2,
            });
            if state == 2 {
                break;
            }
        }
        state
    }

    /// `checkSourceElementUnreachable`: the first of each run of statements that control does not get to, and nothing inside them.
    fn check_unreachable_in(
        &mut self,
        file: FileId,
        list: IdList<StmtId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut in_run = false;
        // The error goes from the first statement of a run to the last.
        let (mut run_start, mut run_last) = (0, StmtId::NONE);
        for s in hir.ids(list) {
            if self.is_potentially_executable(file, s)
                && self.is_source_element_unreachable(file, s)
            {
                if !std::mem::replace(&mut in_run, true) {
                    run_start = hir[s].start;
                    out.push(Diagnostic {
                        start: run_start,
                        code: 7027,
                    });
                }
                run_last = s;
                continue;
            }
            if in_run {
                let end = self.end_of_stmt(file, run_last);
                self.explain_to(run_start, end, 7027, |_| vec![]);
            }
            in_run = false;
            self.check_unreachable_within(file, s, out);
        }
        if in_run {
            let end = self.end_of_stmt(file, run_last);
            self.explain_to(run_start, end, 7027, |_| vec![]);
        }
    }

    fn check_unreachable_within(&mut self, file: FileId, s: StmtId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let one = |c: &mut Self, inner: StmtId, out: &mut Vec<Diagnostic>| {
            if inner.is_none() {
                return;
            }
            if c.is_potentially_executable(file, inner)
                && c.is_source_element_unreachable(file, inner)
            {
                let start = c.hir(file)[inner].start;
                out.push(Diagnostic { start, code: 7027 });
                let end = c.end_of_stmt(file, inner);
                c.explain_to(start, end, 7027, |_| vec![]);
            } else {
                c.check_unreachable_within(file, inner, out);
            }
        };
        match hir[s].kind {
            // `checkWithStatement` does not look at the statement.
            StmtKind::Block(_) if starts_with_word(hir, s, b"with") => {}
            StmtKind::Block(list) => self.check_unreachable_in(file, list, out),
            StmtKind::If { yes, no, .. } => {
                one(self, yes, out);
                one(self, no, out);
            }
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::Labeled { body, .. } => one(self, body, out),
            StmtKind::Switch { cases, .. } => {
                for c in cases.iter() {
                    self.check_unreachable_in(file, hir[c].body, out);
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                one(self, block, out);
                one(self, handler, out);
                one(self, finalizer, out);
            }
            StmtKind::Fn(f) => {
                if let FnBody::Block(list) = hir[f].body {
                    self.check_unreachable_in(file, list, out);
                }
            }
            // The members of a class declaration are gone through with it.
            StmtKind::Class(c) => {
                for m in hir[c].members.iter() {
                    let func = hir[m].func;
                    if func.is_some()
                        && let FnBody::Block(list) = hir[func].body
                    {
                        self.check_unreachable_in(file, list, out);
                    }
                }
            }
            StmtKind::Module(m) => self.check_unreachable_in(file, hir[m].body, out),
            _ => {}
        }
    }

    /// `unwrapReturnType`. `None` where it gives the error type, of which nothing is said.
    fn unwrapped_return_type(&mut self, flags: Flags, ty: TypeId) -> Option<TypeId> {
        let is_async = flags.contains(Flags::ASYNC);
        if !flags.contains(Flags::GENERATOR) {
            return Some(if is_async { self.awaited(ty) } else { ty });
        }
        let types = self.iteration_types(ty, is_async)?;
        // `getIterationTypesOfMethod`: where what `next` gives has no `value`, all of them are `any`.
        if !self.is_known(types.yielded) {
            return None;
        }
        Some(if is_async {
            self.awaited(types.returned)
        } else {
            types.returned
        })
    }

    /// `maybeTypeOfKind(t, TypeFlagsVoid)`
    fn maybe_void(&self, t: TypeId) -> bool {
        self.maybe_type_of_kind(t, |_, t| t == TypeId::VOID)
    }

    /// Where an error about the function `func` as a whole goes: at its name, or else at the name of what it is given to.
    /// `GetErrorRangeForNode`, `GetNameOfDeclaration`
    fn start_of_function_node(&self, file: FileId, func: FnId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        match (f.kind, bound.fns[func.idx()].owner) {
            (_, FnOwner::Member(m)) => hir[m].pos,
            (FnKind::Method | FnKind::Getter | FnKind::Setter, _) => f.name_pos,
            _ if f.name.is_some() => f.name_pos,
            (FnKind::Expr, FnOwner::Expr(e)) => bound.get_assigned_name(hir, e).unwrap_or(f.pos),
            _ => f.pos,
        }
    }

    /// `checkFunctionOrMethodDeclaration`, `checkFunctionExpressionOrObjectLiteralMethod`: 8030, of a `@type` tag on a function.
    fn check_full_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &(owner, node) in &hir.jsdoc_types {
            let JsDocTypeOwner::Fn(func) = owner else {
                continue;
            };
            if bound.is_unchecked_type(node.idx())
                || !matches!(
                    hir[func].kind,
                    FnKind::Decl | FnKind::Method | FnKind::Expr | FnKind::Arrow
                )
            {
                continue;
            }
            let ty = self.type_from_node(file, node);
            let ty = self.force(ty);
            if !self.is_known(ty) || self.contextual_call_signature(file, func, ty).is_some() {
                continue;
            }
            let start = start_of_return_type(hir, node);
            out.push(Diagnostic { start, code: 8030 });
            let end = self.end_of_type_node_from(file, node, start);
            self.explain_to(start, end, 8030, |_| vec![]);
        }
    }

    /// `checkAllCodePathsInNonVoidFunctionReturnOrThrow`
    fn check_all_code_paths_return(&mut self, file: FileId, func: FnId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if !matches!(f.body, FnBody::Block(_))
            || matches!(
                f.kind,
                FnKind::Constructor | FnKind::Setter | FnKind::StaticBlock
            )
        {
            return;
        }
        // `errorNode`: the return type, or else the type of a `@type` tag on the function.
        let error_node = if f.ret.is_some() {
            f.ret
        } else {
            hir.jsdoc_type(JsDocTypeOwner::Fn(func))
        };
        // `getReturnTypeFromAnnotation`
        let annotated = if f.ret.is_some() {
            Some(self.type_from_node(file, f.ret))
        } else {
            self.return_type_of_full_signature(file, func)
        };
        let declared = if let Some(declared) = annotated {
            if !self.is_known(declared) {
                return;
            }
            let Some(unwrapped) = self.unwrapped_return_type(f.flags, declared) else {
                return;
            };
            Some(unwrapped)
        } else if f.kind == FnKind::Getter {
            // `checkAccessorDeclaration` hands over `getTypeOfAccessors`: what the setter says it takes, or else what the body gives.
            Some(self.return_type_of_fn(file, func))
        } else if self.p.files.options.no_implicit_returns {
            None
        } else {
            return;
        };
        if let Some(t) = declared
            && (!self.is_known(t) || self.maybe_void(t) || self.is_any(t) || t.is_undefined())
        {
            return;
        }
        let end = bound.fns[func.idx()].end;
        if end.is_none() || end == UNREACHABLE || !self.is_reachable(file, end) {
            return;
        }
        // `NodeFlagsHasExplicitReturn`: the binder passes over a `return` that it knows control does not get to.
        let has_explicit_return = bound
            .ids(bound.fns[func.idx()].returns)
            .any(|s| !self.is_flagged_unreachable(file, bound.stmt_flow[s.idx()]));
        let start = if error_node.is_some() {
            start_of_return_type(hir, error_node)
        } else {
            self.start_of_function_node(file, func)
        };
        let code = match declared {
            Some(TypeId::NEVER) => 2534,
            Some(_) if !has_explicit_return => 2355,
            Some(t)
                if self.p.files.options.strict_null_checks
                    && !self.is_assignable(TypeId::UNDEFINED, t) =>
            {
                2366
            }
            _ if self.p.files.options.no_implicit_returns => {
                if declared.is_none() {
                    if !has_explicit_return {
                        return;
                    }
                    // `isUnwrappedReturnTypeUndefinedVoidOrAny`
                    let inferred = self.return_type_of_fn(file, func);
                    let Some(inferred) = self.unwrapped_return_type(f.flags, inferred) else {
                        return;
                    };
                    if !self.is_known(inferred)
                        || self.maybe_void(inferred)
                        || self.is_any(inferred)
                        || inferred.is_undefined()
                    {
                        return;
                    }
                }
                7030
            }
            _ => return,
        };
        out.push(Diagnostic { start, code });
        let end = if error_node.is_some() {
            self.end_of_type_node_from(file, error_node, start)
        } else {
            match bound.fns[func.idx()].owner {
                FnOwner::Expr(e) if matches!(f.kind, FnKind::Arrow | FnKind::Expr) => {
                    self.error_end_inside_parentheses(file, e)
                }
                _ => self.end_of_name_at(file, start),
            }
        };
        self.explain_to(start, end, code, |_| vec![]);
    }

    /// `checkReturnStatement`, where `undefined` is not told apart: `return;` where something is to be returned.
    fn check_bare_returns(&mut self, file: FileId, func: FnId, out: &mut Vec<Diagnostic>) {
        let options = &self.p.files.options;
        if options.strict_null_checks || !options.no_implicit_returns {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if matches!(f.kind, FnKind::Constructor | FnKind::StaticBlock) {
            return;
        }
        // `checkWithStatement` does not look at the statement.
        let is_bare = |s: &StmtId| {
            matches!(hir[*s].kind, StmtKind::Return(e) if e.is_none())
                && !hir.is_in_with(hir[*s].pos)
        };
        let returns = bound.ids(bound.fns[func.idx()].returns);
        if !returns.clone().any(|s| is_bare(&s)) {
            return;
        }
        let returned = self.return_type_of_fn(file, func);
        // What returns `never` is told that `undefined` is not that.
        if !self.is_known(returned) || returned == TypeId::NEVER {
            return;
        }
        // `isUnwrappedReturnTypeUndefinedVoidOrAny`
        let Some(t) = self.unwrapped_return_type(f.flags, returned) else {
            return;
        };
        if !self.is_known(t) || self.maybe_void(t) || self.is_any(t) || t.is_undefined() {
            return;
        }
        out.extend(returns.filter(is_bare).map(|s| Diagnostic {
            start: hir[s].pos,
            code: 7030,
        }));
    }

    /// `checkSignatureDeclaration`, `checkGeneratorInstantiationAssignabilityToReturnType`: the generator type built from the iteration
    /// types of a generator function's return type annotation must be assignable to that annotation.
    fn check_generator_return_annotation(
        &mut self,
        file: FileId,
        func: FnId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let f = &hir[func];
        let has_body = !matches!(f.body, FnBody::None) || f.flags.contains(Flags::BODY_DROPPED);
        if !f.flags.contains(Flags::GENERATOR) || f.ret.is_none() || !has_body {
            return;
        }
        let declared = self.type_from_node(file, f.ret);
        // A `void` annotation gets 2505 instead.
        if !self.is_known(declared) || declared == TypeId::VOID {
            return;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        // `getIterationTypeOfGeneratorFunctionReturnType`: `any` has no iteration types.
        let mut types = [None; 3];
        if !self.is_any(declared) {
            // `getIterationTypesOfGeneratorFunctionReturnType`
            let mut found = self.iterable_types(declared, !is_async, is_async, false, None);
            if !found.has_types() {
                found = self.iterator_types(declared, is_async, None);
            }
            types = [found.y, found.r, found.n];
        }
        // An unresolved iteration type must not cause an error. The defaults give a generator that fits every generator type.
        if types.iter().flatten().any(|&t| !self.is_known(t)) {
            types = [None; 3];
        }
        let [yielded, returned, next] = types;
        // A missing return type defaults to the yield type.
        let yielded = yielded.unwrap_or(TypeId::ANY);
        let generator = self.generator_of(
            yielded,
            returned.unwrap_or(yielded),
            next.unwrap_or(TypeId::UNKNOWN),
            is_async,
        );
        let start = start_of_return_type(hir, f.ret);
        let end = self.end_of_type_node_from(file, f.ret, start);
        self.check_assignable_with_end(
            file,
            generator,
            declared,
            start,
            end,
            ExprId::NONE,
            2322,
            out,
        );
    }

    /// `isPostSuperFlowNode`
    fn is_post_super(
        &self,
        file: FileId,
        mut flow: FlowId,
        seen: &mut Vec<FlowId>,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            match bound.flow[flow.idx()] {
                // What cannot be reached is let be.
                Flow::Unreachable => return true,
                // `bindContainer` starts nothing where a function is called where it is written: it is part of the flow around it.
                Flow::StartInvoked {
                    outer, plain: true, ..
                } => flow = outer,
                Flow::Start { .. } | Flow::StartInvoked { .. } => return false,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Switch { before, .. } => {
                    flow = before;
                }
                Flow::Call { before, call } => {
                    if matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Super))
                    {
                        return true;
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    reduced.push((label, instead));
                    let is_post_super = self.is_post_super(file, before, &mut Vec::new(), reduced);
                    reduced.pop();
                    return is_post_super;
                }
                Flow::Label { start, len } => {
                    if seen.contains(&flow) {
                        return true;
                    }
                    seen.push(flow);
                    let (start, len) = match reduced.iter().rev().find(|r| r.0 == flow) {
                        Some(&(_, instead)) => match bound.flow[instead.idx()] {
                            Flow::Label { start, len } => (start, len),
                            _ => (start, len),
                        },
                        None => (start, len),
                    };
                    return bound
                        .edges(start, len)
                        .iter()
                        .all(|&edge| self.is_post_super(file, edge, seen, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) if !seen.contains(&flow) => {
                        seen.push(flow);
                        flow = entry;
                    }
                    _ => return true,
                },
            }
        }
    }

    /// The function the `this` at `e` is directly in (`GetThisContainer`, arrow functions and the computed names of class members
    /// included), or the `super` at `e` (`getSuperContainer`). And whether TypeScript's binder starts the flow of control anew on the
    /// way, at a method, an accessor or an initialized property that `e` is in the name or in a decorator of: no `super()` comes
    /// before `e` then.
    fn function_directly_around(
        &self,
        file: FileId,
        e: ExprId,
        is_this: bool,
    ) -> Option<(FnId, bool)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut parent, mut top, mut starts_anew) = (bound.expr_parent[e.idx()], e, false);
        loop {
            parent = match parent {
                Parent::FnBody(f) => return Some((f, starts_anew)),
                Parent::ParamDefault(p) => return Some((bound.param_fn[p.idx()], starts_anew)),
                Parent::Expr(x) => {
                    top = x;
                    bound.expr_parent[x.idx()]
                }
                // The name of a property belongs to what is around the object literal or the pattern.
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                Parent::Key(_) => {
                    let p = hir
                        .pat_props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(top))?;
                    self.outward(file, Parent::PatPropDefault(PatPropId(p as u32)))
                }
                Parent::MemberKey => {
                    if let Some(p) = hir
                        .props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(top))
                    {
                        starts_anew = true;
                        Parent::Expr(bound.prop_owner[p])
                    } else if is_this {
                        // For `this`, the name of a member of a class is a place of its own.
                        return None;
                    } else {
                        let m = hir
                            .members
                            .iter()
                            .position(|m| m.key == PropKey::Computed(top))?;
                        let MemberOwner::Class(c) = bound.member_owner[m] else {
                            return None;
                        };
                        starts_anew |=
                            hir.members[m].func.is_some() || hir.members[m].init.is_some();
                        self.outward(file, Parent::ClassExtends(c))
                    }
                }
                Parent::Decorator(_, of) => {
                    // `checkDecorators` does not look at those of what cannot be decorated.
                    if bound.refused_decorators.contains(&top) {
                        return None;
                    }
                    starts_anew |= match of {
                        DecoratorOwner::Class(_) => false,
                        DecoratorOwner::Member(m) => hir[m].func.is_some() || hir[m].init.is_some(),
                        DecoratorOwner::Param(_) => true,
                    };
                    self.outward(file, parent)
                }
                Parent::None
                | Parent::File
                | Parent::Module(_)
                | Parent::MemberInit(_)
                | Parent::EnumInit(_) => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Stmt(s) => bound.stmt_parent[s.idx()],
                other => self.outward(file, other),
            };
        }
    }

    /// `checkThisBeforeSuper`
    fn check_this_before_super(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Only what is in the constructor of a class is looked at.
        if hir.classes.is_empty() {
            return;
        }
        let index = self.exprs_by_kind(file);
        for e in in_file_order([index.of(ExprTag::This), index.of(ExprTag::Super)]) {
            let i = e.idx();
            let is_this = matches!(hir.exprs[i].kind, ExprKind::This);
            if bound.is_unchecked(i) {
                continue;
            }
            // `checkIdentifier` hands the `this` of `typeof this.x` to `checkThisExpression`.
            if bound.is_in_type_query(e) && (!is_this || self.is_this_query_within_member(file, e))
            {
                continue;
            }
            // `super(...)` itself is what is waited for.
            if !is_this
                && matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(c) if hir[c].callee == e))
            {
                continue;
            }
            // Directly in the constructor, not in a function in it.
            let Some((func, starts_anew)) = self.function_directly_around(file, e, is_this) else {
                continue;
            };
            if hir[func].kind != FnKind::Constructor {
                continue;
            }
            let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
                continue;
            };
            let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                continue;
            };
            if hir[c].extends.is_none()
                || self.class_declaration_extends_null(self.class_sym(file, c))
            {
                continue;
            }
            if starts_anew
                || !self.is_post_super(file, bound.expr_flow[i], &mut Vec::new(), &mut Vec::new())
            {
                out.push(Diagnostic {
                    start: hir[e].pos,
                    code: if is_this { 17009 } else { 17011 },
                });
            }
        }
    }

    /// Whether the `this` at `e`, which a type query starts with, is written in the type of a member of a class, an interface or a
    /// type literal, in no function there. That member is its container then (`GetThisContainer`), though the binder puts the operand
    /// in the function, namespace or file around.
    pub(super) fn is_this_query_within_member(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let starts_with_it = |at: ExprId| first_identifier(hir, at) == e;
        let query = hir.types.iter().position(|t| matches!(t.kind, TypeNodeKind::Typeof { expr, .. } if expr.is_some() && starts_with_it(expr)));
        let Some(query) = query else { return true };
        let mut scope = bound.type_scope[query];
        while scope.is_some() {
            match bound.scopes[scope.idx()].kind {
                ScopeKind::Class(_) | ScopeKind::Interface(_) => return true,
                ScopeKind::Fn(_) | ScopeKind::Module(_) | ScopeKind::File => break,
                _ => scope = bound.scopes[scope.idx()].parent,
            }
        }
        let parents = Self::type_node_parents(hir, bound);
        let mut at = parents[query];
        while at.is_some() {
            if matches!(hir[at].kind, TypeNodeKind::Object(_)) {
                return true;
            }
            at = parents[at.idx()];
        }
        false
    }

    /// Where `this` cannot be written: 2331 2332 2465. `checkThisExpression`
    fn check_this_location(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        for &this in index.of(ExprTag::This) {
            let i = this.idx();
            if bound.is_unchecked(i) {
                continue;
            }
            let mut parent = bound.expr_parent[i];
            let mut top = this;
            let code = loop {
                match parent {
                    // Arrow functions have the `this` of what is around them.
                    Parent::FnBody(f) if hir[f].kind == FnKind::Arrow => {
                        parent = self.outward(file, parent)
                    }
                    Parent::ParamDefault(p)
                        if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow =>
                    {
                        parent = self.outward(file, Parent::FnBody(bound.param_fn[p.idx()]));
                    }
                    Parent::FnBody(_)
                    | Parent::ParamDefault(_)
                    | Parent::MemberInit(_)
                    | Parent::File
                    | Parent::None => break 0,
                    Parent::Module(_) => break 2331,
                    Parent::EnumInit(_) => break 2332,
                    // In the name of a member of a class there is none. Any other name is part of what is around what it is a name in.
                    Parent::Key(_) | Parent::MemberKey => {
                        if let Some(m) = hir
                            .members
                            .iter()
                            .position(|m| m.key == PropKey::Computed(top))
                        {
                            match bound.member_owner[m] {
                                MemberOwner::Class(_) => break 2465,
                                MemberOwner::Interface(owner) => match hir.stmts.iter().position(
                                    |s| matches!(s.kind, StmtKind::Interface(x) if x == owner),
                                ) {
                                    Some(s) => parent = bound.stmt_parent[s],
                                    None => break 0,
                                },
                                // What is around a type literal is not kept track of.
                                _ => break 0,
                            }
                        } else if let Some(p) = hir
                            .props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(top))
                        {
                            parent = Parent::Expr(bound.prop_owner[p]);
                        } else if let Some(p) = hir
                            .pat_props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(top))
                        {
                            parent =
                                self.outward(file, Parent::PatPropDefault(PatPropId(p as u32)));
                        } else {
                            break 0;
                        }
                    }
                    Parent::Stmt(s) if s.is_none() => break 0,
                    Parent::Stmt(s) => parent = bound.stmt_parent[s.idx()],
                    Parent::Expr(x) => {
                        top = x;
                        parent = bound.expr_parent[x.idx()];
                    }
                    other => parent = self.outward(file, other),
                }
            };
            // `checkIdentifier` hands the `this` of `typeof this.x` to `checkThisExpression`.
            if code != 0
                && bound.is_in_type_query(ExprId(i as u32))
                && self.is_this_query_within_member(file, ExprId(i as u32))
            {
                continue;
            }
            if code != 0 {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code,
                });
                // Nor is there anything it could be there.
                if code != 2465 && self.p.files.options.no_implicit_this {
                    out.push(Diagnostic {
                        start: hir.exprs[i].pos,
                        code: 2683,
                    });
                    self.relate(hir.exprs[i].pos, 2683, |c| {
                        c.declaration_shadowing_this(file, parent)
                    });
                }
            }
        }
    }

    /// Where `super` can be written: 2335 2336 2337 2338 2466 2660, and that a constructor calls it: 2377 17005.
    /// `checkSuperExpression`, `checkConstructorDeclaration`.
    fn check_super(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The constructors that call it, not from a function inside, where, and the call.
        let mut calling: Vec<(FnId, u32, ExprId)> = Vec::new();
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Super) {
            let i = e.idx();
            if bound.is_unchecked(i) {
                continue;
            }
            let start = hir[e].pos;
            let is_call = matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(c) if hir[c].callee == e));
            // `getSuperContainer`: the function or the member it is written in. Arrow functions are seen through, but not by a call.
            let mut parent = bound.expr_parent[i];
            let mut in_parameters = false;
            // Whether a function has been left on the way out, be it by its name or by a decorator.
            let mut through_function = false;
            // The outermost expression so far, and whether it was a computed name.
            let (mut top, mut in_computed_name) = (e, false);
            let container: Result<(Option<FnId>, Option<MemberId>), u32> = loop {
                match parent {
                    // The name of a member is worked out outside of it: on from what the member is a member of.
                    Parent::Key(_) | Parent::MemberKey => {
                        in_computed_name = true;
                        if let Some(p) = hir
                            .props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(top))
                        {
                            through_function |= matches!(parent, Parent::MemberKey);
                            parent = Parent::Expr(bound.prop_owner[p]);
                        } else if let Some(m) = hir
                            .members
                            .iter()
                            .position(|m| m.key == PropKey::Computed(top))
                            && let MemberOwner::Class(c) = bound.member_owner[m]
                        {
                            through_function |= hir.members[m].func.is_some();
                            parent = self.outward(file, Parent::ClassExtends(c));
                        } else if let Some(p) = hir
                            .pat_props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(top))
                        {
                            parent =
                                self.outward(file, Parent::PatPropDefault(PatPropId(p as u32)));
                        } else {
                            break Err(2466);
                        }
                    }
                    Parent::Decorator(_, of) => {
                        through_function |= match of {
                            DecoratorOwner::Class(_) => false,
                            DecoratorOwner::Member(m) => hir[m].func.is_some(),
                            DecoratorOwner::Param(_) => true,
                        };
                        parent = self.outward(file, parent);
                    }
                    Parent::MemberInit(m) => break Ok((None, Some(m))),
                    Parent::FnBody(_) | Parent::ParamDefault(_) => {
                        let f = match parent {
                            Parent::FnBody(f) => f,
                            Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                            _ => unreachable!(),
                        };
                        if hir[f].kind == FnKind::Arrow && !is_call {
                            through_function = true;
                            parent = self.outward(file, Parent::FnBody(f));
                            continue;
                        }
                        // `isInConstructorArgumentInitializer` gives up at the first function on the way out.
                        in_parameters =
                            matches!(parent, Parent::ParamDefault(_)) && !through_function;
                        break Ok((Some(f), None));
                    }
                    Parent::None | Parent::File | Parent::Module(_) => break Ok((None, None)),
                    Parent::Stmt(s) if s.is_none() => break Ok((None, None)),
                    Parent::Expr(x) => {
                        top = x;
                        parent = bound.expr_parent[x.idx()];
                    }
                    other => parent = self.outward(file, other),
                }
            };
            // What the container is a member of: a class, or an object literal.
            let (class, is_legal) = match container {
                Err(code) => {
                    out.push(Diagnostic { start, code });
                    continue;
                }
                Ok((None, Some(m))) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => (Some(Some(c)), !is_call),
                    _ => (None, false),
                },
                Ok((Some(f), _)) => {
                    let is_member_like = matches!(
                        hir[f].kind,
                        FnKind::Method
                            | FnKind::Getter
                            | FnKind::Setter
                            | FnKind::Constructor
                            | FnKind::StaticBlock
                    );
                    let of = match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                            MemberOwner::Class(c) => Some(Some(c)),
                            _ => None,
                        },
                        // A method of an object literal.
                        FnOwner::Expr(x)
                            if is_member_like
                                && matches!(bound.expr_parent[x.idx()], Parent::Prop(_)) =>
                        {
                            Some(None)
                        }
                        _ => None,
                    };
                    let is_legal = of.is_some()
                        && is_member_like
                        && (!is_call || hir[f].kind == FnKind::Constructor);
                    // `findFirstSuperCall` looks in the body, and not into the functions in it.
                    if is_legal
                        && is_call
                        && matches!(parent, Parent::FnBody(_))
                        && !through_function
                    {
                        let call = match bound.expr_parent[i] {
                            Parent::Expr(call) => call,
                            _ => ExprId::NONE,
                        };
                        calling.push((f, start, call));
                    }
                    (of, is_legal)
                }
                Ok((None, None)) => (None, false),
            };
            if !is_legal {
                let code = if in_computed_name {
                    2466
                } else if is_call {
                    2337
                } else if class.is_none() {
                    2660
                } else {
                    2338
                };
                out.push(Diagnostic { start, code });
                continue;
            }
            let Some(Some(class)) = class else { continue };
            if hir[class].extends.is_none() {
                out.push(Diagnostic { start, code: 2335 });
            } else if in_parameters
                && matches!(container, Ok((Some(f), _)) if hir[f].kind == FnKind::Constructor)
                // `checkSuperExpression` returns first: `classDeclarationExtendsNull`, `baseClassType == nil`.
                && !self.class_declaration_extends_null(self.class_sym(file, class))
                && !self.base_types(self.class_sym(file, class)).is_empty()
            {
                out.push(Diagnostic { start, code: 2336 });
            }
        }
        for f in 0..hir.fns.len() {
            if hir.fns[f].kind != FnKind::Constructor || matches!(hir.fns[f].body, FnBody::None) {
                continue;
            }
            let FnOwner::Member(m) = bound.fns[f].owner else {
                continue;
            };
            let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                continue;
            };
            if hir[c].extends.is_none() {
                continue;
            }
            let extends_null = self.class_declaration_extends_null(self.class_sym(file, c));
            match calling.iter().filter(|x| x.0.idx() == f).map(|x| x.1).min() {
                Some(first) if extends_null => {
                    out.push(Diagnostic {
                        start: first,
                        code: 17005,
                    });
                    if let Some(&(_, _, call)) = calling.iter().find(|x| x.1 == first)
                        && call.is_some()
                    {
                        let end = self.end_inside_parentheses(file, call);
                        self.explain_to(first, end, 17005, |_| vec![]);
                    }
                }
                None if !extends_null => {
                    let start = hir[m].start;
                    out.push(Diagnostic { start, code: 2377 });
                    // Up to the end of the keyword.
                    let end = self.end_of_name_at(file, hir[m].pos);
                    self.explain_to(start, end, 2377, |_| vec![]);
                }
                _ => {}
            }
        }
    }

    /// `checkGrammarBreakOrContinueStatement`, and one label inside another of the same name.
    fn check_jumps_and_labels(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_iteration = |mut s: StmtId, through_labels: bool| loop {
            match hir[s].kind {
                StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. } => return true,
                StmtKind::Labeled { body, .. } if through_labels => s = body,
                _ => return false,
            }
        };
        for i in 0..hir.stmts.len() {
            if !matches!(
                hir.stmts[i].kind,
                StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Labeled { .. }
            ) || matches!(bound.stmt_parent[i], Parent::None)
            {
                continue;
            }
            let start = hir.stmts[i].pos;
            let (label, is_break) = match hir.stmts[i].kind {
                StmtKind::Break(label) => (label, true),
                StmtKind::Continue(label) => (label, false),
                StmtKind::Labeled { label, .. } => {
                    let mut parent = bound.stmt_parent[i];
                    loop {
                        match parent {
                            Parent::Stmt(s) if s.is_some() => {
                                if matches!(hir[s].kind, StmtKind::Labeled { label: outer, .. } if outer == label)
                                {
                                    out.push(Diagnostic { start, code: 1114 });
                                    self.explain(start, 1114, |c| vec![c.atom_text(label)]);
                                    break;
                                }
                                parent = bound.stmt_parent[s.idx()];
                            }
                            Parent::Case(c) => parent = Parent::Stmt(bound.case_stmt[c.idx()]),
                            _ => break,
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            let mut parent = bound.stmt_parent[i];
            let code = loop {
                match parent {
                    Parent::FnBody(_) => break Some(1107),
                    Parent::Stmt(s) if s.is_some() => {
                        match hir[s].kind {
                            StmtKind::Labeled { label: outer, body }
                                if label.is_some() && outer == label =>
                            {
                                break (!is_break && !is_iteration(body, true)).then_some(1115);
                            }
                            StmtKind::Switch { .. } if is_break && label.is_none() => break None,
                            _ if label.is_none() && is_iteration(s, false) => break None,
                            _ => {}
                        }
                        parent = bound.stmt_parent[s.idx()];
                    }
                    Parent::Case(c) => parent = Parent::Stmt(bound.case_stmt[c.idx()]),
                    _ => {
                        break Some(match (label.is_some(), is_break) {
                            (true, true) => 1116,
                            (true, false) => 1115,
                            (false, true) => 1105,
                            (false, false) => 1104,
                        });
                    }
                }
            };
            if let Some(code) = code {
                out.push(Diagnostic { start, code });
                let end = self.end_of_stmt(file, StmtId(i as u32));
                self.explain_to(start, end, code, |_| vec![]);
            }
        }
    }
}
