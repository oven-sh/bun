//! Where control gets to and where it does not: 7027 7028 7029, 2355 2366 2534 7030.
//! Whether a generator is what a generator function says it returns.
//!
//! Follows `checkSourceElementUnreachable`, `checkLabeledStatement`, `checkSwitchStatement`,
//! `checkAllCodePathsInNonVoidFunctionReturnOrThrow`, `checkReturnStatement`, `checkGeneratorInstantiationAssignabilityToReturnType`,
//! `isPostSuperFlowNode` and
//! `checkGrammarBreakOrContinueStatement` of TypeScript 7.0.2's checker.go, flow.go and grammarchecks.go.

use super::*;
use crate::bind::{FnOwner, Parent, UNREACHABLE};

/// The start of the return type `node` in the source. Parentheses around a type and a leading `|` or `&` have no node, so this scans
/// back over them. A return type follows a `:`, which ends the scan.
fn start_of_return_type(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text = &hir.text[..];
    let mut at = (hir[node].pos as usize).min(text.len());
    loop {
        let before = text[..at].trim_ascii_end().len();
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&') {
            return at as u32;
        }
        at = before - 1;
    }
}

impl Checker<'_> {
    /// `IsPotentiallyExecutableNode`
    fn is_potentially_executable(&self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        match hir[s].kind {
            StmtKind::Var(decls) => decls
                .iter()
                .any(|d| hir[d].kind != VarKind::Var || hir[d].init.is_some()),
            // Neither a block nor `;` is. But `with (e) s` is kept as a block.
            StmtKind::Block(_) => super::errors_x_statements::is_with_statement(hir, s),
            StmtKind::Empty
            | StmtKind::Fn(_)
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

    /// `checkSourceElementUnreachable`
    pub(super) fn check_source_element_unreachable(&mut self, file: FileId, s: StmtId) -> bool {
        if !self.is_potentially_executable(file, s) {
            return false;
        }
        if self.reported_unreachable_nodes.contains(&s) {
            return true;
        }
        if !self.is_source_element_unreachable(file, s) {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `parent.Statements()`
        let statements = match bound.stmt_parent[s.idx()] {
            Parent::File => Some(hir.body),
            Parent::Module(m) => Some(hir[m].body),
            Parent::FnBody(f) => match hir[f].body {
                FnBody::Block(list) => Some(list),
                _ => None,
            },
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::Block(list) => Some(list),
                StmtKind::Switch { cases, .. } => {
                    let mut clauses = cases.iter().map(|c| hir[c].body);
                    clauses.find(|&clause| hir.ids(clause).any(|other| other == s))
                }
                _ => None,
            },
            _ => None,
        };
        let mut last = s;
        let after = statements.into_iter().flat_map(|list| hir.ids(list));
        for next in after.skip_while(|&next| next != s).skip(1) {
            if !self.is_potentially_executable(file, next)
                || !self.is_source_element_unreachable(file, next)
            {
                break;
            }
            last = next;
            self.reported_unreachable_nodes.push(next);
        }
        let end = self.end_of_stmt(file, last);
        let is_error = self.p.files.options.allow_unreachable_code == Some(false);
        let diagnostic = self.new_diagnostic((file, hir[s].start, end), 7027, &[]);
        self.add_error_or_suggestion(is_error, diagnostic);
        true
    }

    /// `maybeTypeOfKind(t, TypeFlagsVoid)`
    fn maybe_void(&self, t: TypeId) -> bool {
        self.maybe_type_of_kind(t, |_, t| t == TypeId::VOID)
    }

    /// `checkFunctionOrMethodDeclaration`, `checkFunctionExpressionOrObjectLiteralMethod`: 8030, of a `@type` tag on a function.
    pub(super) fn check_full_signature(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        let node = hir.jsdoc_type(JsDocTypeOwner::Fn(func));
        if node.is_none()
            || self.bound(file).is_unchecked_type(node.idx())
            || !matches!(
                hir[func].kind,
                FnKind::Decl | FnKind::Method | FnKind::Expr | FnKind::Arrow
            )
        {
            return;
        }
        let ty = self.type_from_node(file, node);
        if self.contextual_call_signature(file, func, ty).is_none() {
            let start = start_of_return_type(hir, node);
            let end = self.end_of_type_node_from(file, node, start);
            self.error_at((file, start, end), 8030, &[]);
        }
    }

    /// `isUnwrappedReturnTypeUndefinedVoidOrAny`
    pub(super) fn is_unwrapped_return_type_undefined_void_or_any(
        &mut self,
        file: FileId,
        func: FnId,
        returned: TypeId,
    ) -> bool {
        let t = self.unwrap_return_type(file, func, returned);
        self.maybe_void(t) || self.is_any(t) || t.is_undefined()
    }

    /// `checkAllCodePathsInNonVoidFunctionReturnOrThrow`
    pub(super) fn check_all_code_paths_in_non_void_function_return_or_throw(
        &mut self,
        file: FileId,
        func: FnId,
    ) {
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
            Some(self.unwrap_return_type(file, func, declared))
        } else if f.kind == FnKind::Getter {
            // `checkAccessorDeclaration` hands over `getTypeOfAccessors`: what the setter says it takes, or else what the body gives.
            Some(self.return_type_of_fn(file, func))
        } else if self.p.files.options.no_implicit_returns {
            None
        } else {
            return;
        };
        if let Some(t) = declared
            && (self.maybe_void(t) || self.is_any(t) || t.is_undefined())
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
            self.error_range_of_fn(file, func).0
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
                    let inferred = self.return_type_of_fn(file, func);
                    if self.is_unwrapped_return_type_undefined_void_or_any(file, func, inferred) {
                        return;
                    }
                }
                7030
            }
            _ => return,
        };
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
        self.error_at((file, start, end), code, &[]);
    }

    /// `checkSignatureDeclaration`, `checkGeneratorInstantiationAssignabilityToReturnType`: the generator type built from the iteration
    /// types of a generator function's return type annotation must be assignable to that annotation.
    pub(super) fn check_generator_return_annotation(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        let f = &hir[func];
        let has_body = has_body(f);
        if !f.flags.contains(Flags::GENERATOR) || f.ret.is_none() || !has_body {
            return;
        }
        let declared = self.type_from_node(file, f.ret);
        // A `void` annotation gets 2505 instead.
        if declared == TypeId::VOID {
            return;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        let start = start_of_return_type(hir, f.ret);
        let error_node = (file, start, self.end_of_type_node_from(file, f.ret, start));
        self.check_generator_instantiation_assignability_to_return_type(
            declared,
            is_async,
            Some(error_node),
        );
    }
}
