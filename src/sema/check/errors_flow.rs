//! Where control gets to and where it does not: 7027 7028 7029, 2355 2366 2534 7030, 1104 1105 1107 1114 1115 1116.
//! Whether a generator is what a generator function says it returns.
//!
//! Follows `checkSourceElementUnreachable`, `checkLabeledStatement`, `checkSwitchStatement`,
//! `checkAllCodePathsInNonVoidFunctionReturnOrThrow`, `checkReturnStatement`, `checkGeneratorInstantiationAssignabilityToReturnType`,
//! `isPostSuperFlowNode` and
//! `checkGrammarBreakOrContinueStatement` of TypeScript 7.0.2's checker.go, flow.go and grammarchecks.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Flow, FlowId, FnOwner, MemberOwner, Parent, UNREACHABLE};

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
            StmtKind::Class(_) => flow == UNREACHABLE,
            StmtKind::Enum(e) => {
                flow == UNREACHABLE
                    && (!hir[e].flags.contains(Flags::CONST) || preserves_const_enums)
            }
            StmtKind::Module(m) => {
                flow == UNREACHABLE
                    && self
                        .bound(file)
                        .is_instantiated_module(m, preserves_const_enums)
            }
            _ => flow == UNREACHABLE || !self.is_reachable(file, flow),
        }
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
            (_, FnOwner::Member(m)) => hir[m].name_pos,
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
            .any(|s| bound.stmt_flow[s.idx()] != UNREACHABLE);
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
        if !self.is_known(returned) || returned.is_never() {
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
        let has_body = has_body(&f);
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
                found = self.iterator_types(declared, is_async, None, None);
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
    pub(super) fn is_post_super(
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
                Flow::Label { .. } => {
                    if seen.contains(&flow) {
                        return true;
                    }
                    seen.push(flow);
                    return super::flow::branch_label_antecedents(bound, flow, reduced)
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
