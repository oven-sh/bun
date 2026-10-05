//! The types of expressions.

use super::call::{AllowMembers, SignatureKind};
use super::errors::{both_are_bigint_like, can_be_equal, can_be_ordered, may_be_added};
use super::errors_operators::{
    check_instance_of_expression, is_literal_expression_of_object, language_version,
};
use super::infer::Inference;
use super::shape::{Access, Found};
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId};
use smallvec::SmallVec;
use std::ops::ControlFlow;

/// `getAssignmentTargetKind`
/// See `Checker::pattern_that_may_expect`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum PatternKind {
    Binding,
    Assignment,
}

#[derive(Copy, Clone)]
pub(super) struct TargetKind {
    /// `is_definite_assignment_target`
    assigned: bool,
    /// `AssignmentKindDefinite`: assigned by `=` or in a pattern on its left, or by `&&=`, `||=` or
    /// `??=`. Its type is the declared type, regardless of narrowing.
    pub(super) definite: bool,
    /// `is_written`
    pub(super) written: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// The type of `e` at its location, after narrowing. The entry point for external queries.
    pub fn type_at(&mut self, file: FileId, e: ExprId) -> TypeId {
        self.prepare_enclosing(file, e);
        let ty = self.type_of_expr(file, e);
        // `getTypeOfExpression`: the quick type is tried first. It differs only for a `new`
        // expression that is rejected.
        if self.has_any_flag(ty) {
            self.quick_type_of_expr(file, e).unwrap_or(ty)
        } else {
            ty
        }
    }

    /// `getQuickTypeOfExpression`. Not for a literal, whose type `checkExpression` has as quickly.
    pub(super) fn quick_type_of_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if e.is_none() {
            return None;
        }
        match self.hir(file)[e].kind {
            ExprKind::Await(x) => {
                let ty = self.quick_type_of_expr(file, x)?;
                Some(self.awaited(ty))
            }
            ExprKind::New(_) => self.quick_type_of_new(file, e),
            ExprKind::Call(_) => self.quick_type_of_call(file, e),
            // The operand is not checked. `x as const` is `ExprKind::AsConst`.
            ExprKind::As { ty, .. } => Some(self.type_from_node(file, ty)),
            _ => None,
        }
    }

    /// `checkExpression`, or `checkExpressionEx` where the parent of `e` is checked under a mode
    /// that it passes down.
    pub fn type_of_expr(&mut self, file: FileId, e: ExprId) -> TypeId {
        let check_mode = self.check_mode();
        if check_mode.is_empty() || e.is_none() {
            return self.check_expression_worker(file, e);
        }
        let check_mode = self.check_mode_passed_to(file, e, check_mode);
        self.check_expression_ex(file, e, check_mode)
    }

    /// `checkExpressionWorker`: the `checkMode` that the function it calls for the parent of `e`,
    /// which is checked under `check_mode`, passes to `e`.
    fn check_mode_passed_to(&self, file: FileId, e: ExprId, check_mode: CheckMode) -> CheckMode {
        let hir = self.hir(file);
        match self.bound(file).expr_parent[e.idx()] {
            Parent::Prop(p) if hir[p].kind == PropKind::Spread => {
                check_mode & CheckMode::INFERENTIAL
            }
            Parent::Prop(_) => check_mode,
            Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                ExprKind::Array(_)
                | ExprKind::Spread(_)
                | ExprKind::Cond { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Assign { .. }
                | ExprKind::As { .. }
                | ExprKind::AsConst(_) => check_mode,
                ExprKind::Jsx(j) if hir.ids(hir[j].children).any(|child| child == e) => check_mode,
                _ => CheckMode::empty(),
            },
            _ => CheckMode::empty(),
        }
    }

    /// `checkExpressionEx`, for contexts where expressions are rechecked.
    pub(super) fn check_expression_ex(
        &mut self,
        file: FileId,
        e: ExprId,
        check_mode: CheckMode,
    ) -> TypeId {
        let mode_outside = std::mem::replace(&mut self.mode_of_recheck, check_mode);
        let ty = self.check_expression_worker(file, e);
        self.mode_of_recheck = mode_outside;
        if check_mode.intersects(CheckMode::INFERENTIAL | CheckMode::SKIP_GENERIC_FUNCTIONS) {
            self.instantiate_type_with_single_generic_call_signature(file, e, ty, check_mode)
        } else {
            ty
        }
    }

    /// `instantiateTypeWithSingleGenericCallSignature`, after its first rule.
    #[inline(never)]
    fn instantiate_type_with_single_generic_call_signature(
        &mut self,
        file: FileId,
        e: ExprId,
        ty: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let call_signature = self.single_signature(ty, SignatureKind::Call, AllowMembers::Yes);
        let construct = call_signature.is_none();
        let Some(signature) = call_signature
            .or_else(|| self.single_signature(ty, SignatureKind::Construct, AllowMembers::Yes))
        else {
            return ty;
        };
        let type_params = self.sig_type_params(signature);
        if type_params.is_empty() {
            return ty;
        }
        let Some(contextual_type) =
            self.apparent_type_of_contextual_type(file, e, ContextFlags::NO_CONSTRAINTS)
        else {
            return ty;
        };
        let non_null = self.non_nullable(contextual_type);
        let kind = if construct {
            SignatureKind::Construct
        } else {
            SignatureKind::Call
        };
        let Some(contextual_signature) = self.single_signature(non_null, kind, AllowMembers::No)
        else {
            return ty;
        };
        if !self.sig_type_params(contextual_signature).is_empty() {
            return ty;
        }
        let level = self.get_inference_context(file, e);
        if check_mode.contains(CheckMode::SKIP_GENERIC_FUNCTIONS) {
            // `skippedGenericFunction`
            if check_mode.contains(CheckMode::INFERENTIAL)
                && let Some(level) = level
                && let Some(n) = &mut self.inference_contexts[level].context
            {
                n.skipped_generic_function = true;
            }
            return self.any_function_type();
        }
        let Some(level) = level else {
            return ty;
        };
        let instantiated = self.with_inference_context(level, |c, n| {
            let returns_plain_function = n.sig.is_some_and(|sig| {
                let returned = c.sig_return(sig);
                c.single_call_or_construct_signature(returned)
                    .is_some_and(|(s, _)| c.sig_type_params(s).is_empty())
            });
            if returns_plain_function
                && let Some(unique) = c.unique_type_params(&n.inferred_type_params, &type_params)
            {
                let instantiated = if unique[..] == type_params[..] {
                    signature
                } else {
                    c.with_own_type_params(signature, &type_params, &unique)
                };
                if c.adopt_generic_argument(n, instantiated, contextual_signature) {
                    n.inferred_type_params.extend(unique);
                    // `getSignatureInstantiationWithoutFillingInTypeArguments`
                    let (params, ret, this) = (
                        c.sig_params(instantiated),
                        c.sig_return(instantiated),
                        c.sig_this_type(instantiated),
                    );
                    return c.types().intern_sig(SigData::Synth {
                        type_params: ArenaBox::empty(),
                        params: c.list(&params),
                        ret,
                        this,
                        of: ArenaBox::empty(),
                        is_union: true,
                    });
                }
            }
            // `instantiateSignatureInContextOf`. `applyToParameterTypes` reads as many parameters
            // of the contextual signature as `signature` has.
            let (expected, taken) = (c.sig_params(contextual_signature), c.sig_params(signature));
            let takes_rest = c.effective_rest_type(&taken).is_some();
            let count = c.parameter_count(&taken) - usize::from(takes_rest);
            let mut read: SmallVec<[TypeId; 8]> = SmallVec::new();
            if c.sig_this_type(signature).is_some() {
                read.extend(c.sig_this_type(contextual_signature));
            }
            let expected = expected.iter().enumerate();
            read.extend(
                expected
                    .filter(|&(i, _)| takes_rest || i < count)
                    .map(|(_, p)| p.ty),
            );
            let source =
                c.instantiate_signature_in_inference_context(n, contextual_signature, &read, true);
            c.instantiate_sig_in_context(signature, source, false, &mut |c, s, t| {
                c.is_assignable(s, t)
            })
        });
        match instantiated {
            Some(instantiated) => self.type_of_signature(instantiated, construct),
            None => ty,
        }
    }

    /// The cached type of `e`.
    #[inline]
    pub(super) fn cached_type_of_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.p.expr_types.get(&self.task, &(file, e))
    }

    /// `links.resolvedType = c.checkExpressionEx(..)`: of two nested visits of `e` the outer one assigns last.
    #[inline]
    fn cache_type_of_expr(&mut self, file: FileId, e: ExprId, ty: TypeId, stored: Stored) {
        self.p.expr_types.rewrite(&self.task, (file, e), ty, stored);
    }

    /// Whether evaluating `e` has a side effect on the checker that a pass of `check_file` of
    /// `file` reads later: `first_jsx`, `unresolved_identifiers`. A cache hit has no side effect.
    /// So only the task that is checking `file` stores the entry, and every other task evaluates
    /// `e` again. A class expression checks its decorators and heritage clauses, and nothing else
    /// visits them.
    #[cold]
    fn is_noted_for_check_file(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Jsx(_) | ExprKind::Class(_) => true,
            ExprKind::Ident(_) => {
                let mut noted = self.unresolved_identifiers.iter();
                noted.any(|it| it.0 == file && it.1 == e)
            }
            _ => false,
        }
    }

    /// `checkExpressionWorker`
    #[inline]
    fn check_expression_worker(&mut self, file: FileId, e: ExprId) -> TypeId {
        // A required expression is missing from the source.
        if e.is_none() {
            return TypeId::UNRESOLVED;
        }
        if self.contextual_binding_patterns.is_empty()
            && !self.is_rechecked(file, e)
            && let Some(known) = self.cached_type_of_expr(file, e)
        {
            return known;
        }
        self.type_of_expr_on_cache_miss(file, e)
    }

    /// Whether `e` is rechecked without caching. tsgo rechecks everything in an argument for every
    /// contextual type that is pushed. Identifiers, `this` and access expressions are where the
    /// flow analysis runs, and the object and the key of an access have no contextual type. They
    /// have the same type under every contextual type, and are checked once, unless a type
    /// parameter is in scope: `getNarrowableTypeForReference` substitutes the constraint for a type
    /// parameter or not, depending on the check mode and on `hasContextualTypeWithNoGenericTypes`.
    #[inline]
    fn is_rechecked(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_rechecking() && (self.contextual.is_empty() || self.depends_on_pushed_type(file, e))
    }

    fn depends_on_pushed_type(&mut self, file: FileId, e: ExprId) -> bool {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) {
            return true;
        }
        if !self.hir(file).type_params.is_empty() {
            let scope = self.enclosing_scope_of_expr(file, e);
            if self
                .type_params_in_scope(file, scope)
                .iter()
                .any(|&p| matches!(self.data(p), TypeData::TypeParam(..)))
            {
                return true;
            }
        }
        // `sig.typeParameters = context.typeParameters`
        let mut func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
        while func.is_some() {
            if let Some(Some(sig)) = self.context_checked(file, func)
                && !self.sig_type_params(sig).is_empty()
            {
                return true;
            }
            func = self.bound(file).fns[func.idx()].enclosing;
        }
        false
    }

    /// The same for an `e` that exists and whose type is not cached, or may be rechecked.
    fn type_of_expr_on_cache_miss(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `getTypeFromBindingElement`: the defaults in a pattern are rechecked every time the type
        // the pattern implies for its initializer is computed. The names of the pattern are typed
        // as any in the meantime.
        let is_rechecked = self.is_rechecked(file, e);
        // While the implied type of a pattern is being computed its names are typed as any, so the
        // result is not valid for other callers.
        let is_memoised = is_rechecked && self.contextual_binding_patterns.is_empty();
        if is_memoised && let Some(&known) = self.rechecked_exprs.get(&(file, e)) {
            return known;
        }
        let mut afresh = is_rechecked;
        let mut visible_from = self.resolution_start;
        // `checkExpression` has no re-entrancy guard. An expression that was being checked when the
        // members of a class were requested is checked again if their index signatures re-enter it,
        // and then finds the members resolved (`resolveDeclaredMembers`).
        if let Some(&(floor, ..)) = self.declared_index_infos_in_progress.last() {
            visible_from = visible_from.max(floor);
        }
        if !self.contextual_binding_patterns.is_empty() {
            if let Some(floor) = self.contextual_pattern_floor(file, e) {
                afresh = true;
                visible_from = visible_from.max(floor.min(self.stack.len()));
            }
            if !afresh && let Some(known) = self.cached_type_of_expr(file, e) {
                return known;
            }
        }
        if !afresh && let Some(raw) = self.provisional(Query::Expr(file, e)) {
            return TypeId(raw as u32);
        }
        // Resolving the enclosing calls may already have computed it.
        if !is_rechecked
            && self.prepare_query_for_expr(file, e)
            && !afresh
            && let Some(known) = self.cached_type_of_expr(file, e)
        {
            return known;
        }
        if !self.reporting_nonexistent.is_empty()
            && let Some(ty) = self.type_of_access_being_reported(file, e)
        {
            return ty;
        }
        if !self.flow_loops.is_empty()
            && let Some(ty) = self.recheck_in_flow_loop(file, e)
        {
            return ty;
        }
        if matches!(
            self.hir(file)[e].kind,
            ExprKind::Binary { .. } | ExprKind::Call(_)
        ) {
            self.resolve_chain_from_the_inside(file, e);
        }
        let (ty, stored) = match self.type_of_plain_literal(file, e) {
            Some(ty) => (ty, Some(Stored::new())),
            None => {
                // `checkExpressionWithContextualType` has no re-entrancy guard. A visit that began
                // before the implied type of the pattern was requested used the declared types of
                // its names, so this visit does not take the same path.
                let resolution_start = std::mem::replace(&mut self.resolution_start, visible_from);
                // `checkExpressionEx`
                self.instantiation_count = 0;
                let entered = self.enter(Query::Expr(file, e));
                self.resolution_start = resolution_start;
                if !entered {
                    return TypeId::UNRESOLVED;
                }
                let ty = if is_rechecked {
                    let outer = self.begin_recheck();
                    let ty = self.type_of_expr_uncached(file, e);
                    self.end_recheck(outer);
                    ty
                } else {
                    self.type_of_expr_uncached(file, e)
                };
                if afresh
                    && self.inference_contexts.len() != self.context_free_level
                    && !(self.frames.last()).is_some_and(|it| it.is_stored_by_nested_visit)
                {
                    self.drop_reported();
                }
                let left = self.leave(Query::Expr(file, e));
                if let Err(open) = left
                    && !afresh
                {
                    self.cache_provisionally(Query::Expr(file, e), u64::from(ty.0), open);
                }
                (ty, left.ok())
            }
        };
        if let Some(stored) = stored
            && !afresh
            && (self.task.file == Some(file) || !self.is_noted_for_check_file(file, e))
        {
            self.cache_type_of_expr(file, e, ty, stored);
            self.note_stored_by_nested_visit(Query::Expr(file, e));
        }
        if stored.is_some() && is_memoised {
            self.rechecked_exprs.insert((file, e), ty);
        }
        ty
    }

    /// The type of `e` if it is a literal that needs no query, so that no cycle can re-enter it and
    /// no result can turn out provisional in the meantime. It leaves the same state as `enter` and
    /// `leave` would. `None` also where `enter` would fail.
    #[inline]
    fn type_of_plain_literal(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let kind = hir[e].kind;
        if !matches!(
            kind,
            ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
        ) || self.stack.len() >= MAX_DEPTH
            || self.is_stack_low()
        {
            return None;
        }
        let ty = match kind {
            ExprKind::Null => self.null_widening(),
            ExprKind::True => TypeId::FRESH_TRUE,
            ExprKind::False => TypeId::FRESH_FALSE,
            ExprKind::Number(n) => self.number_literal(hir.numbers[n as usize], true),
            // Not a private name.
            ExprKind::String(s) if !is_private_name_at(hir, hir[e].pos) => {
                self.string_literal(s, true)
            }
            _ => return None,
        };
        self.found_cycle = false;
        self.last_enter = EnterOutcome::Entered;
        self.left_a_cycle = false;
        Some(ty)
    }

    /// `reportNonexistentProperty` returns immediately for a property access whose error is already
    /// being reported, and the access has the error type. `None` if `e` is not such an access, or
    /// if `enter` has to mark the circularity that the second visit closes.
    fn type_of_access_being_reported(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let &(_, _, depth) = self
            .reporting_nonexistent
            .iter()
            .rev()
            .find(|r| r.0 == file && r.1 == e)?;
        // `GetConstantValue` does check the access before what encloses it: the resolutions since
        // then began with the message, and the second visit closes none of them.
        if self.is_emitting {
            return Some(TypeId::ERROR);
        }
        // `getResolvedSignature`: a call hides the resolutions below it (`resolutionStart`).
        let after_call = self.stack[depth..]
            .iter()
            .rposition(|q| matches!(q, Query::Call(..)))
            .map_or(depth, |i| depth + i + 1);
        let visible = after_call.max(self.resolution_start).min(self.stack.len());
        // tsgo resolves the type of a variable, a parameter or a member before it checks the
        // initializer. That resolution is always in progress when the access is first checked, and
        // printing re-enters it. `enter` marks that circularity.
        if !self.stack[visible..].iter().all(|&q| {
            matches!(q, Query::Return(..) | Query::ReturnOfSignature(_)) || !self.is_resolution(q)
        }) {
            return None;
        }
        // `checkFunctionExpressionOrObjectLiteralMethodDeferred` resolves the return type of a
        // function before it checks the body. In a full check these return types are in progress
        // when the access is first checked, and printing re-enters them: 7023. Queried first, as
        // here, the access closes no circularity, and the functions keep their inferred return
        // types.
        for i in visible..self.stack.len() {
            if let Query::Return(f, func) = self.stack[i]
                && self.hir(f)[func].ret.is_none()
                && !self.stack[..depth].contains(&self.stack[i])
            {
                (self.p.circular_returns).insert(&self.task, (f, func), (), Stored::new());
                self.report_circular_return_type(Some(Query::Return(f, func)), f, func);
            }
        }
        Some(TypeId::ERROR)
    }

    /// `getTypeOfExpression` has no re-entrancy guard. An expression that is being checked and that
    /// a back edge of a loop evaluates again is checked again. It takes the same path, and this
    /// time the flow analysis that led to the loop stops there, with the types collected so far
    /// (`flowLoopStack`, `getTypeAtFlowLoopLabel`). `None` if no loop was pushed since `e` was
    /// entered.
    fn recheck_in_flow_loop(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let first = self
            .stack
            .iter()
            .rposition(|&q| q == Query::Expr(file, e))?;
        let pushed_at = self.flow_loop_pushed_since(first)?;
        // Hides the first visit from `enter`, which still fails when time, native stack or query
        // depth run out.
        let resolution_start = std::mem::replace(&mut self.resolution_start, self.stack.len());
        self.instantiation_count = 0;
        let entered = self.enter(Query::Expr(file, e));
        self.resolution_start = resolution_start;
        if !entered {
            return Some(TypeId::UNRESOLVED);
        }
        // The loop type is incomplete: nothing computed since the loop was pushed is cached.
        self.taint_from(pushed_at);
        let ty = self.type_of_expr_uncached(file, e);
        let _ = self.leave(Query::Expr(file, e));
        Some(ty)
    }

    /// If `e` is in a default inside a pattern whose implied initializer type is being computed:
    /// the depth of `stack` when that computation began.
    fn contextual_pattern_floor(&self, file: FileId, e: ExprId) -> Option<usize> {
        let hir = self.hir(file);
        let mut floor = None;
        hir.find_ancestor(hir.node(e), |n| {
            if let NodeData::Pat(outer) = hir.data(n) {
                floor = (self.contextual_binding_patterns.iter())
                    .find(|p| p.0 == file && p.1 == outer)
                    .map(|p| p.2);
            }
            floor.is_some()
        });
        floor
    }

    /// Checks an operand whose type is discarded, as `checkExpression` does: re-entering a
    /// resolution in progress is a cycle. The type of the operand, and whether it is final, does
    /// not affect the enclosing expression.
    fn look_at(&mut self, file: FileId, e: ExprId) {
        self.type_of_expr(file, e);
    }

    /// `a.b().c().d()` with hundreds of links, `a + b + c + ..` with hundreds of operands: resolved
    /// one by one from the innermost, so that no resolution recurses all the way down.
    fn resolve_chain_from_the_inside(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let mut chain: Vec<ExprId> = Vec::new();
        match hir[e].kind {
            // `checkBinaryLikeExpression` descends the left operands to any depth.
            ExprKind::Binary { left, .. } => {
                // The left operand of `at`, if `at` is a binary expression whose type is not cached
                // yet.
                let further = |c: &mut Self, at: ExprId| {
                    if at.is_none() {
                        return None;
                    }
                    match hir[at].kind {
                        ExprKind::Binary { left, .. } if !c.has_type_of_expr(file, at) => {
                            Some(left)
                        }
                        _ => None,
                    }
                };
                let (mut at, mut len) = (left, 0usize);
                while let Some(next) = further(self, at) {
                    len += 1;
                    at = next;
                }
                if len < 16 {
                    return;
                }
                chain.reserve_exact(len);
                at = left;
                while let Some(next) = further(self, at) {
                    chain.push(at);
                    at = next;
                }
            }
            ExprKind::Call(_) => {
                // The receiver of `at`, and whether `at` is a call before `e`. `None` at the start
                // of the chain, or at a call that is already resolved.
                let further = |c: &mut Self, at: ExprId| match hir[at].kind {
                    ExprKind::Call(call) => {
                        let is_link = at != e;
                        if is_link && c.has_type_of_expr(file, at) {
                            return None;
                        }
                        Some((hir[call].callee, is_link))
                    }
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some((obj, false)),
                    ExprKind::NonNull(x) => Some((x, false)),
                    _ => None,
                };
                let (mut at, mut len) = (e, 0usize);
                while let Some((next, is_link)) = further(self, at) {
                    len += usize::from(is_link);
                    at = next;
                }
                if len < 16 {
                    return;
                }
                chain.reserve_exact(len);
                at = e;
                while let Some((next, is_link)) = further(self, at) {
                    if is_link {
                        chain.push(at);
                    }
                    at = next;
                }
            }
            _ => return,
        }
        for link in chain.into_iter().rev() {
            self.check_expression_worker(file, link);
            // A type that is not cached would be recomputed by every later link.
            if !self.has_type_of_expr(file, link) {
                break;
            }
        }
    }

    /// `isConstContext`
    pub fn is_const_context(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // FOR SPEED. The contextual type of a part of a literal is derived from the contextual type
        // of the literal. Without type variables there, or in a contextual type pushed for a part
        // along the way, no `const` type variable can be the contextual type further in.
        let (mut top, mut highest, mut may_be_expected) = (e, ExprId::NONE, false);
        loop {
            // `isValidConstAssertionArgument`: the contextual type is requested for nothing else.
            if self.is_valid_const_assertion_argument(file, top) {
                highest = top;
                may_be_expected |= self
                    .contextual
                    .iter()
                    .any(|c| c.0 == file && c.1 == top && self.has_type_variables(c.2));
            }
            top = match bound.expr_parent[top.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::AsConst(_) => return true,
                    ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::Template { .. } => parent,
                    _ => break,
                },
                Parent::Prop(p)
                    if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand)
                        && !matches!(hir[p].key, PropKey::Computed(k) if k == top)
                        && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
                {
                    bound.prop_owner[p.idx()]
                }
                _ => break,
            };
        }
        if highest.is_none()
            || !may_be_expected
                && !self
                    .contextual_type(file, highest, ContextFlags::empty())
                    .is_some_and(|c| self.has_type_variables(c))
        {
            return false;
        }
        let mut at = e;
        loop {
            if self.is_valid_const_assertion_argument(file, at) {
                let expected = self.contextual_type(file, at, ContextFlags::empty());
                if expected.is_some_and(|c| self.is_const_type_variable(c, 0)) {
                    return true;
                }
            }
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::AsConst(_)) => {
                    return true;
                }
                Parent::Expr(parent)
                    if matches!(
                        hir[parent].kind,
                        ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::Template { .. }
                    ) =>
                {
                    parent
                }
                // `IsPropertyAssignment(parent)`: the parent of the expression in a computed name
                // is the name, and a JSX attribute is not a property assignment.
                Parent::Prop(p)
                    if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand)
                        && !matches!(hir[p].key, PropKey::Computed(k) if k == at)
                        && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
                {
                    bound.prop_owner[p.idx()]
                }
                _ => return false,
            };
        }
    }

    /// Whether literals passed for `ty` preserve their exact types: `<const T>`, or a type built
    /// from one.
    pub(super) fn is_const_type_variable(&mut self, ty: TypeId, depth: u32) -> bool {
        if depth >= 5 || !self.has_type_variables(ty) {
            return false;
        }
        match self.data(ty) {
            &TypeData::TypeParam(f, tp, ..) => self.hir(f)[tp].flags.contains(Flags::CONST),
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.is_const_type_variable(p, depth))
            }
            &TypeData::IndexedAccess { obj, .. } => self.is_const_type_variable(obj, depth + 1),
            // `getConstraintOfConditionalType`
            TypeData::Cond { .. } => match self.constraint_of(ty) {
                Some(constraint) => self.is_const_type_variable(constraint, depth + 1),
                None => false,
            },
            // A substitution type follows its base type.
            &TypeData::Substitution { base, .. } => self.is_const_type_variable(base, depth),
            // `getHomomorphicTypeVariable`: `{ [K in keyof T]: .. }` follows `T`.
            &TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => {
                let keys = self.mapped_constraint(file, node, mapper);
                match *self.data(keys) {
                    TypeData::Keyof(of) if matches!(self.data(of), TypeData::TypeParam(..)) => {
                        self.is_const_type_variable(of, depth)
                    }
                    _ => false,
                }
            }
            TypeData::Tuple { flags, .. } => {
                let elems = self.type_arguments(ty);
                elems.iter().zip(flags.iter()).any(|(&e, f)| {
                    f.contains(ElemFlags::VARIADIC) && self.is_const_type_variable(e, depth)
                })
            }
            _ => false,
        }
    }

    /// `isValidConstAssertionArgument`
    pub(super) fn is_valid_const_assertion_argument(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::String(_)
            | ExprKind::Template { .. }
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Array(_)
            | ExprKind::Object(_) => true,
            ExprKind::Unary { op, operand } => {
                !is_parenthesized(hir, operand)
                    && matches!(
                        (op, hir[operand].kind),
                        (UnOp::Minus, ExprKind::Number(_) | ExprKind::BigInt(_))
                            | (UnOp::Plus, ExprKind::Number(_))
                    )
            }
            // A member of an enum.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => self
                .resolve_entity_name_expression(file, obj, SymFlags::VALUE)
                .is_some_and(|sym| self.files().flags(sym).intersects(SymFlags::ENUM)),
            _ => false,
        }
    }

    pub fn is_in_optional_chain(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
            ExprKind::Call(c) => hir[c].chain != Chain::No,
            ExprKind::NonNull(x) => self.is_in_optional_chain(file, x),
            _ => false,
        }
    }

    /// The type of the object of a member access or a call in a chain, and whether the chain may
    /// have short-circuited earlier.
    pub(super) fn chain_receiver(
        &mut self,
        file: FileId,
        obj: ExprId,
        chain: Chain,
    ) -> (TypeId, bool) {
        let ty = self.type_of_expr(file, obj);
        match chain {
            Chain::No => (ty, false),
            Chain::Start => {
                let non_null = self.non_nullable(ty);
                let stops = non_null != ty && !self.is_any(ty);
                // An earlier link may have short-circuited as well, which appears as `undefined` in
                // its type.
                (non_null, stops)
            }
            // The type of the previous link when the chain reaches it, including `undefined` if the
            // link itself can be `undefined`.
            Chain::Continue if self.is_in_optional_chain(file, obj) => self.type_of_link(file, obj),
            Chain::Continue => (ty, false),
        }
    }

    /// `tryReparseOptionalChain`: whether the `!` of `e` is a link of an optional chain that
    /// continues after it, as in `a?.b!.c`. Followed by nothing, by `?.` or by a parenthesis it is
    /// not.
    fn is_non_null_chain(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            let Parent::Expr(parent) = bound.expr_parent[at.idx()] else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::NonNull(_) => at = parent,
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    return obj == at && chain == Chain::Continue;
                }
                ExprKind::Call(c) => return hir[c].callee == at && hir[c].chain == Chain::Continue,
                _ => return false,
            }
        }
    }

    /// `leftType` of `checkPropertyAccessExpressionOrQualifiedName`: the type the property of
    /// `obj.name` is looked up in, and whether the chain may short-circuit before it. `Err`:
    /// `isAnyLike`, and the type of the access.
    pub(super) fn left_type_of_property_access(
        &mut self,
        file: FileId,
        obj: ExprId,
        chain: Chain,
    ) -> (Result<TypeId, TypeId>, bool) {
        let (receiver, stops) = self.chain_receiver(file, obj, chain);
        // `x.a` on `any` is `any`, regardless of narrowing. (Not so `x["a"]`.)
        // `if c.isErrorType(apparentType) { return c.errorType }`
        if self.is_error_type(receiver) {
            return (Err(TypeId::ERROR), false);
        }
        if self.is_any(receiver) || receiver == TypeId::SILENT_NEVER {
            return (Err(receiver), false);
        }
        let left = self.check_non_null_type(file, obj, receiver);
        if self.is_error_type(left) {
            return (Err(TypeId::ERROR), stops);
        }
        if self.is_any(left) {
            return (Err(left), stops);
        }
        (Ok(left), stops)
    }

    /// `core.IfElse(assignmentKind != AssignmentKindNone || c.isMethodAccessForCall(node),
    /// c.getWidenedType(leftType), leftType)`: the target of an assignment or a call is looked up
    /// in the widened type of the object.
    pub(super) fn widened_left_type_of_property_access(
        &mut self,
        file: FileId,
        e: ExprId,
        left: TypeId,
    ) -> TypeId {
        if self.target_kind(file, e).written || self.is_called(file, e) {
            self.get_widened_type(left)
        } else {
            left
        }
    }

    /// `getApparentType`: a type that may be anything has no guaranteed members, not even those of
    /// every object.
    pub(super) fn is_apparently_unknown(&mut self, ty: TypeId) -> bool {
        self.p.files.options.strict_null_checks
            && self.is_deferred(ty)
            && self.base_constraint(ty) == TypeId::UNKNOWN
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of `a.b` when it is reached, and
    /// whether the chain may short-circuit before it.
    fn type_of_property_access(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Dot {
            obj,
            name,
            name_pos,
            chain,
        } = hir[e].kind
        else {
            return (TypeId::UNRESOLVED, false);
        };
        let (left, stops) = self.left_type_of_property_access(file, obj, chain);
        let target = self.target_kind(file, e);
        let is_private = self.is_private_name(name);
        // `parseRightSideOfDot`: in `typeof a.#b` the name is missing.
        if is_private && bound.is_in_type_query(e) {
            return (left.map_or_else(|any| any, |_| TypeId::ERROR), stops);
        }
        let lexical = if is_private {
            self.lookup_symbol_for_private_identifier_declaration(file, e, name)
        } else {
            None
        };
        if target.written && lexical.is_some_and(|(_, m)| hir[m].kind == MemberKind::Method) {
            let written = self.declaration_name_at(file, name_pos);
            let right = self.place_of_token(file, name_pos);
            self.grammar_error_at(right, 2803, &[Arg::Bytes(&written)]);
        }
        let left = match left {
            Ok(left) => left,
            // `isAnyLike`. A `#b` that no enclosing class declares is still looked up.
            Err(any) => {
                if !is_private || lexical.is_some() {
                    return (any, stops);
                }
                if self.classes_around_private_name(file, e).is_empty() {
                    self.grammar_error_at(self.place_of_token(file, name_pos), 18016, &[]);
                    return (TypeId::ANY, stops);
                }
                any
            }
        };
        let receiver = self.widened_left_type_of_property_access(file, e, left);
        let (cycles_before, work_before) = (self.cycles, self.work);
        // `isThisPropertyAccessInConstructor`: the property is `autoType`, and `getTypeOfSymbol` is not called.
        if hir.is_js
            && !is_private
            && let Some(initial) = self.auto_this_property(file, e, receiver, name)
        {
            return (
                self.flow_type_of_auto_access(file, e, initial, target),
                stops,
            );
        }
        let is_super = matches!(hir[obj].kind, ExprKind::Super);
        let found = if is_private && !self.is_private_name_in_reach(file, e, left, name)
            || self.is_apparently_unknown(receiver)
        {
            None
        } else if is_super {
            self.type_of_super_property(file, obj, receiver, name)
        } else if target.written {
            // `getWriteTypeOfSymbol`, for a target that is not read first. Whether read or not,
            // nothing is assigned through an index signature of a type parameter's constraint.
            match self.property_type(receiver, name, Access::Written) {
                Some(_) if !target.assigned => self.property_type(receiver, name, Access::Read),
                to_write => to_write,
            }
        } else {
            self.property_type(receiver, name, Access::Read)
        };
        let found = match found {
            // `getPropertyOfTypeEx` with `includeTypeOnlyMembers`: used for a qualified name in
            // `typeof a.b`.
            None if bound.is_in_type_query(e) => self
                .type_only_member_of_module(receiver, name)
                .map(|ty| (ty, Found::Property)),
            found => found,
        };
        let apparent = self.reduced_apparent_type(receiver);
        let Some((declared, how)) = found else {
            // A cycle whose head is this expression or a caller: the members are not all known. One
            // that began and ended in the lookup, as two interfaces that extend each other, is
            // final.
            if self.cycles != cycles_before
                && self.lowest_taint_since(work_before + 1) <= self.frames.len()
            {
                return (TypeId::UNRESOLVED, stops);
            }
            if is_private {
                // `#x in o` is narrowed like `"#x" in o`, not to the class: that produces a `#x`
                // that no class declares, and the correct type of `o` is not known.
                if self
                    .prop_ref(apparent, name)
                    .is_some_and(|(prop, _)| !matches!(prop.source, PropSource::Symbol(_)))
                {
                    return (TypeId::UNRESOLVED, stops);
                }
                if self.check_private_identifier_property_access(
                    file, e, left, name, name_pos, lexical,
                ) {
                    return (TypeId::ERROR, stops);
                }
                if self.is_plain_js(file) && !self.classes_around_private_name(file, e).is_empty() {
                    let written = self.declaration_name_at(file, name_pos);
                    let right = self.place_of_token(file, name_pos);
                    self.grammar_error_at(right, 1111, &[Arg::Bytes(&written)]);
                }
            }
            // `isJSLiteralType`: a property missing from the type of a JavaScript object literal is `any`. `isUncheckedJSSuggestion`
            // is tested first, here without its test of the declaring file.
            let is_unchecked_js =
                self.is_plain_js(file) && !matches!(hir[obj].kind, ExprKind::This);
            if !is_unchecked_js && self.is_js_literal_type(left) {
                return (TypeId::ANY, stops);
            }
            // `leftType.symbol == c.globalThisSymbol`
            if matches!(
                self.data(left),
                TypeData::Anon {
                    origin: Origin::GlobalThis,
                    ..
                }
            ) {
                let right = self.place_of_token(file, name_pos);
                if self.is_block_scoped_global(name) {
                    self.error_at(right, 2339, &[Arg::Atom(name), Arg::Type(left)]);
                } else if self.p.files.options.no_implicit_any {
                    self.error_at(right, 7017, &[Arg::Type(left)]);
                }
                return (TypeId::ANY, stops);
            }
            if !self.atoms().bytes(name).is_empty()
                && !self.check_and_report_error_for_extending_interface(file, e)
            {
                let containing = if matches!(self.data(left), TypeData::ThisParam(_)) {
                    apparent
                } else {
                    left
                };
                self.report_nonexistent_property(
                    file,
                    e,
                    name,
                    name_pos,
                    containing,
                    is_unchecked_js,
                );
            }
            // It is not narrowed.
            return (TypeId::ERROR, stops);
        };
        let prop = match how {
            Found::ByIndex => None,
            _ => match self.prop_ref(apparent, name) {
                Some((prop, _)) => Some(prop),
                // A property of a union, or of `Object` or `Function`.
                None => self
                    .get_property_of_type(apparent, name)
                    .map(|found| found.0),
            },
        };
        if how == Found::ByIndex {
            // `indexInfo.isReadonly && (IsAssignmentTarget(node) || isDeleteTarget(node))`
            let is_deleted = matches!(bound.expr_parent[e.idx()], Parent::Expr(p)
                if matches!(hir[p].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
            if (target.written || is_deleted)
                && self.is_index_info_for_name_readonly(apparent, name)
            {
                let start = self.start_inside_parentheses(file, e);
                let node = (file, start, self.end_inside_parentheses(file, e));
                self.error_at(node, 2542, &[Arg::Type(apparent)]);
            }
            if self.p.files.options.no_property_access_from_index_signature
                && !bound.is_in_type_query(e)
            {
                let right = self.place_of_token(file, name_pos);
                self.error_at(right, 4111, &[Arg::Atom(name)]);
            }
        } else {
            if let Some((class, declaration)) = lexical
                && !target.definite
                && hir[declaration].kind == MemberKind::Setter
                && !hir[class].members.iter().any(|m| {
                    hir[m].kind == MemberKind::Getter
                        && hir[m].key == hir[declaration].key
                        && hir[m].flags.contains(Flags::STATIC)
                            == hir[declaration].flags.contains(Flags::STATIC)
                })
            {
                let start = self.start_inside_parentheses(file, e);
                let node = (file, start, self.end_inside_parentheses(file, e));
                self.error_at(node, 2806, &[]);
            }
            // Every `a.b` reaches this point. `check_property_accessibility_at_location` looks the
            // property up again and then starts with this test: for an object type, which is its
            // own apparent type, it finds the same property.
            let is_within_reach = !is_super
                && self.is_object_type(apparent)
                && prop.is_some_and(|prop| {
                    !prop.flags.intersects(PropFlags::MAY_BE_OUT_OF_REACH)
                        && !matches!(prop.source, PropSource::Intersected(..))
                });
            if !is_within_reach {
                self.check_property_accessibility(file, e, is_super, apparent, name, name_pos);
            }
        }
        if target.written
            && self
                .readonly_entity_assigned_to(file, e, obj, receiver, name)
                .is_some()
        {
            let right = self.place_of_token(file, name_pos);
            let text = self.source_text(file, right.1, right.2);
            self.error_at(right, 2540, &[Arg::Bytes(&text)]);
            return (TypeId::ERROR, stops);
        }
        // The access ends with its name.
        let right = (file, name_pos, hir[e].end);
        (
            self.get_flow_type_of_access_expression(file, e, prop, declared, right, target),
            stops,
        )
    }

    /// `getFlowTypeOfAccessExpression` for a property whose type is `autoType`. `initial` is the result of `auto_this_property`,
    /// `target` the `target_kind` of `e`.
    fn flow_type_of_auto_access(
        &mut self,
        file: FileId,
        e: ExprId,
        initial: TypeId,
        target: TargetKind,
    ) -> TypeId {
        if target.definite {
            TypeId::AUTO
        } else {
            self.flow_type_of_property(file, e, initial)
        }
    }

    /// `isThisPropertyAccessInConstructor` for a property that only `this.name = value` assignments in a JavaScript class declare
    /// (`isConstructorDeclaredThisProperty`). `e` is an access to the property `name` of `receiver`. Returns the initial type of
    /// `getFlowTypeOfProperty` if `e` is directly in the constructor that declares the property.
    pub(super) fn auto_this_property(
        &mut self,
        file: FileId,
        e: ExprId,
        receiver: TypeId,
        name: Atom,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        if !hir.is_js {
            return None;
        }
        let container = hir.get_this_container(hir.node(e), true, false);
        if hir.kind(container) != Kind::Constructor {
            return None;
        }
        let container = hir.function_of(container);
        let apparent = self.apparent_type(receiver);
        let (prop, _) = self.prop_ref(apparent, name)?;
        let PropSource::Symbol(sym) = prop.source else {
            return None;
        };
        let assignments = self.assignments_of_symbol(sym);
        if sym.file != file
            || !self.is_declared_by_assignment(sym)
            || !matches!(
                self.is_constructor_declared_this_property(file, &assignments),
                super::shape::ThisAssignmentDeclaration::Constructor(declaring) if declaring == container
            )
        {
            return None;
        }
        // `getFlowTypeOfProperty`
        let (class, _) = self.class_of_member_fn(file, container)?;
        let inherited = self.type_of_property_in_base_class(file, class, name);
        Some(inherited.unwrap_or(TypeId::UNDEFINED))
    }

    /// `lookupSymbolForPrivateIdentifierDeclaration`, `getPrivateIdentifierPropertyOfType`: the
    /// `#name` of `e` is the one declared by the innermost enclosing class that declares one, and
    /// `receiver` must have that one.
    fn is_private_name_in_reach(
        &mut self,
        file: FileId,
        e: ExprId,
        receiver: TypeId,
        name: Atom,
    ) -> bool {
        let Some(&class) = self.bound(file).private_class.get(&e) else {
            return false;
        };
        let lexical = self.class_sym(file, class);
        let apparent = self.apparent_type(receiver);
        self.parts(apparent).iter().all(|&part| {
            let part = self.apparent_type(part);
            self.prop_ref(part, name)
                .is_some_and(|(prop, _)| match &prop.source {
                    PropSource::Intersected(_, props) => props
                        .iter()
                        .any(|p| self.declaring_class(p) == Some(lexical)),
                    _ => self.declaring_class(prop) == Some(lexical),
                })
        })
    }

    /// An export of the module whose type is `ty` that resolves to a value, although it is exported
    /// or imported as type-only.
    pub(super) fn type_only_member_of_module(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        let TypeData::Anon {
            origin: Origin::Module(module) | Origin::Namespace { module, .. },
            ..
        } = *self.data(ty)
        else {
            return None;
        };
        let export = self.files().module_export(module, name)?;
        let target = self.files().resolve_alias_if_needed(export)?;
        self.files()
            .flags(target)
            .intersects(SymFlags::VALUE)
            .then(|| self.type_of_symbol(export))
    }

    /// `checkSatisfiesExpression` compares the types and reports 1360 as soon as the expression is checked, and the message prints
    /// both types. The comparison can close a circularity, and so can the printing.
    fn print_unsatisfied_types(&mut self, file: FileId, source: TypeId, ty: TypeNodeId) {
        let target = self.type_from_node(file, ty);
        if !self.is_assignable(source, target) {
            self.resolve_by_printing(source);
            self.resolve_by_printing(target);
        }
    }

    /// `templateConstraintType`
    pub(super) fn template_constraint_type(&mut self) -> TypeId {
        self.union(&[
            TypeId::STRING,
            TypeId::NUMBER,
            TypeId::BOOLEAN,
            TypeId::BIGINT,
            TypeId::NULL,
            TypeId::UNDEFINED,
        ])
    }

    /// `isTypeAssignableTo(t, c.templateConstraintType)`
    fn is_assignable_to_template_constraint_type(&mut self, t: TypeId) -> bool {
        // FOR SPEED: most spans are strings and numbers. Such a type is a member of the union, or
        // its base primitive type is, and the comparison asks for nothing else.
        const MEMBERS: u32 =
            tf::STRING_LIKE | tf::NUMBER_LIKE | tf::BIGINT_LIKE | tf::BOOLEAN_LIKE | tf::NULLABLE;
        let flags = self.flags(t);
        if flags & MEMBERS != 0 && flags & tf::UNION == 0 || t == TypeId::BOOLEAN {
            return true;
        }
        let constraint = self.template_constraint_type();
        self.is_assignable(t, constraint)
    }

    /// `checkElementAccessExpression`: the type of `a[b]` when it is reached, as
    /// `getFlowTypeOfAccessExpression` returns it, and whether the chain may short-circuit before
    /// it. `checkIndexedAccessIndexType` has not run yet: 2536, 4105 and 2542 use this type.
    pub(super) fn type_of_element_access_unchecked(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> (TypeId, bool) {
        let hir = self.hir(file);
        let ExprKind::Index { obj, index, chain } = hir[e].kind else {
            return (TypeId::UNRESOLVED, false);
        };
        let (object, stops) = self.chain_receiver(file, obj, chain);
        let receiver = self.check_non_null_type(file, obj, object);
        let target = self.target_kind(file, e);
        // `getWidenedType(exprType)`: the target of an assignment or a call is looked up in the
        // widened type of the object.
        let receiver = if target.written || self.is_called(file, e) {
            self.get_widened_type(receiver)
        } else {
            receiver
        };
        let key = self.type_of_expr(file, index);
        // `isErrorType(objectType) || objectType == silentNeverType`: it is the result, neither
        // indexed nor narrowed.
        if self.is_error_type(receiver) || receiver == TypeId::SILENT_NEVER {
            return (receiver, stops);
        }
        // A `const` enum can only be indexed by a string literal.
        if !is_string_literal_like(hir, index) && self.is_const_enum_object(receiver) {
            if !hir.has_errors {
                self.error_at(self.span_of_parenthesized_expr(file, index), 2476, &[]);
            }
            return (TypeId::ERROR, stops);
        }
        // `isForInVariableForNumericPropertyNames`: the variable of a `for..in` over an object with
        // numeric property names is treated as a number here.
        let key = if self.is_for_in_variable_for_numeric_names(file, index) {
            TypeId::NUMBER
        } else {
            key
        };
        // `AccessFlagsNoIndexSignatures`
        let no_index_signatures = target.definite
            && self.is_generic_object_type(receiver)
            && !matches!(self.data(receiver), TypeData::ThisParam(_));
        let cycles_before = self.cycles;
        // `getPropertyTypeForIndexType`: `isThisPropertyAccessInConstructor` makes the property `autoType`.
        if hir.is_js
            && let Some(name) = self.property_name_of_type(key)
            && let Some(initial) = self.auto_this_property(file, e, receiver, name)
        {
            return (
                self.flow_type_of_auto_access(file, e, initial, target),
                stops,
            );
        }
        // `getPropertyTypeForIndexType`: 2540 and nil for a key that names a read-only property.
        if target.written {
            let mut was_missing_prop = false;
            for &k in self.parts(key) {
                if let Some(name) = self.property_name_of_type(k)
                    && let Some(prop) =
                        self.readonly_entity_assigned_to(file, e, obj, receiver, name)
                {
                    let at = (
                        file,
                        self.error_start_of(file, index),
                        self.error_end_of(file, index),
                    );
                    self.error_at(at, 2540, &[Arg::Prop(prop)]);
                    was_missing_prop = true;
                }
            }
            if was_missing_prop {
                return (TypeId::ERROR, stops);
            }
        }
        let mut access_flags = AccessFlags::empty();
        access_flags.set(AccessFlags::WRITING, target.written);
        access_flags.set(AccessFlags::EXPRESSION_POSITION, !target.definite);
        access_flags.set(AccessFlags::NO_INDEX_SIGNATURES, no_index_signatures);
        let of_super = if matches!(hir[obj].kind, ExprKind::Super) {
            self.property_name_of_type(key)
        } else {
            None
        };
        let found = match of_super
            .and_then(|name| self.type_of_super_property(file, obj, receiver, name))
        {
            Some((ty, _)) => Some(ty),
            // Also for a name that the base class lacks, which is reported there.
            None => self.indexed_access_of_element_access(receiver, key, access_flags, (file, e)),
        };
        let declared = match found {
            Some(found) => found,
            // `core.OrElse(c.getIndexedAccessTypeOrUndefined(..), c.errorType)`
            None if self.cycles == cycles_before => TypeId::ERROR,
            None => TypeId::UNRESOLVED,
        };
        // `getResolvedSymbolOrNil(node)`: the property `getPropertyTypeForIndexType` found for a
        // key that is a property name.
        let prop = match self.property_name_of_type(key) {
            Some(name) => {
                let apparent = self.apparent_type(receiver);
                match self.prop_ref(apparent, name) {
                    Some((prop, _)) => Some(prop),
                    // A property of a union, or of `Object` or `Function`.
                    None => self
                        .get_property_of_type(apparent, name)
                        .map(|found| found.0),
                }
            }
            None => None,
        };
        // `getPropertyTypeForIndexType` has narrowed the type of whatever it found, of a method
        // too, which `getFlowTypeOfAccessExpression` then leaves as it is.
        let prop =
            prop.filter(|prop| target.definite || self.is_variable_property_or_accessor(prop));
        let index_expression = (
            file,
            self.start_of(file, index),
            self.end_of_expr(file, index),
        );
        (
            self.get_flow_type_of_access_expression(
                file,
                e,
                prop,
                declared,
                index_expression,
                target,
            ),
            stops,
        )
    }

    /// `checkIndexedAccessIndexType`
    pub(super) fn check_indexed_access_index_type(
        &mut self,
        ty: TypeId,
        access_node: (FileId, u32, u32),
        e: Option<ExprId>,
    ) -> TypeId {
        let TypeData::IndexedAccess { obj, index, .. } = *self.data(ty) else {
            return ty;
        };
        match self.why_not_a_key_of(obj, index) {
            Some(4105) => {
                let name = self.property_name_of_type(index).unwrap_or(Atom::NONE);
                self.error_at(access_node, 4105, &[Arg::Atom(name)]);
            }
            Some(code) => {
                self.error_at(access_node, code, &[Arg::Type(index), Arg::Type(obj)]);
            }
            None => {
                if e.is_some_and(|e| self.is_assignment_target(access_node.0, e))
                    && let Some((of, node, _)) = self.mapped_origin(obj)
                    && self.mapped_decl(of, node).readonly == MappedModifier::Add
                {
                    self.error_at(access_node, 2542, &[Arg::Type(obj)]);
                }
                return ty;
            }
        }
        TypeId::ERROR
    }

    /// The type of `a.b`, `a[b]` or `a()` when it is reached, and whether its optional chain may
    /// short-circuit before it.
    fn type_of_link(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { .. } => self.type_of_property_access(file, e),
            ExprKind::Index { .. } => {
                let (ty, stops) = self.type_of_element_access_unchecked(file, e);
                // Its source position is only computed when there is something to check.
                if !matches!(self.data(ty), TypeData::IndexedAccess { .. }) {
                    return (ty, stops);
                }
                let access_node = self.place_inside_parentheses(file, e);
                (
                    self.check_indexed_access_index_type(ty, access_node, Some(e)),
                    stops,
                )
            }
            // `checkCallExpression`: the type of a `require` call is the module.
            // `resolveExternalModuleTypeByLiteral`
            ExprKind::Call(_) if self.is_commonjs_require(file, e) => {
                // `getEmitSyntaxForUsageLocationWorker`: the argument of `require` resolves as CommonJS in every file.
                let module = crate::bind::required_specifier(hir, e).and_then(|spec| {
                    self.files()
                        .module_of_specifier_as(file, spec, ResolutionMode::Require)
                });
                match module {
                    Some(module) => {
                        let value = self.files().module_value(module);
                        (self.type_of_symbol(value), false)
                    }
                    None => (TypeId::ANY, false),
                }
            }
            ExprKind::Call(c) => {
                // `resolveCallExpression` under `CheckModeSkipGenericFunctions` defers a call of a
                // generic function that returns a function: `resolvingSignature`, which
                // `checkCallExpression` turns into `silentNeverType`. `getResolvedSignature`
                // returns a cached signature first.
                if self
                    .check_mode()
                    .contains(CheckMode::SKIP_GENERIC_FUNCTIONS)
                    && !self.resolved_signatures.contains(&(file, e))
                    && self.p.calls.get(&self.task, &(file, e)).is_none()
                    && self.defers_call_of_generic_function(file, e)
                {
                    // `skippedGenericFunction`
                    if self.check_mode().contains(CheckMode::INFERENTIAL)
                        && let Some(level) = self.get_inference_context(file, e)
                        && let Some(n) = &mut self.inference_contexts[level].context
                    {
                        n.skipped_generic_function = true;
                    }
                    return (TypeId::SILENT_NEVER, false);
                }
                let resolved = self.resolved_signature(file, e);
                self.resolved_signatures.insert((file, e));
                let resolved = self.with_return_type(resolved);
                let call = &hir[c];
                let stops = match call.chain {
                    Chain::No => false,
                    Chain::Start => {
                        let callee = self.type_of_expr(file, call.callee);
                        self.some_type(callee, |k, m| k.is_nullish(m))
                    }
                    // `getOptionalExpressionType`: not whether the callee itself may be
                    // `undefined`.
                    Chain::Continue => self.chain_receiver(file, call.callee, Chain::Continue).1,
                };
                // `checkCallExpression`
                if self.is_symbol_like(resolved.ret) && self.is_symbol_or_symbol_for_call(file, e) {
                    return (self.get_es_symbol_like_type_for_node(file, e), stops);
                }
                (resolved.ret, stops)
            }
            // `checkNonNullChain`: the nullability of the previous link itself is removed, but the
            // possibility that the chain short-circuited is preserved.
            ExprKind::NonNull(x) if self.is_in_optional_chain(file, x) => {
                let (ty, stops) = self.type_of_link(file, x);
                (self.non_nullable(ty), stops)
            }
            _ => (self.type_of_expr(file, e), false),
        }
    }

    pub(super) fn type_of_expr_uncached(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        match hir[e].kind {
            // `checkIdentifier`: the placeholder the parser synthesizes for a missing expression is
            // an error, so it is compatible with anything. A hole in an array literal is handled
            // differently.
            ExprKind::Missing => match self.bound(file).expr_parent[e.idx()] {
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                    self.undefined_widening()
                }
                _ => TypeId::ERROR,
            },
            ExprKind::Ident(name) => self.type_of_identifier(file, e, name),
            ExprKind::This => self.check_this_expression(file, e),
            ExprKind::Super => self.check_super_expression(file, e),
            ExprKind::Null => self.null_widening(),
            ExprKind::True => TypeId::FRESH_TRUE,
            ExprKind::False => TypeId::FRESH_FALSE,
            ExprKind::Number(n) => self.number_literal(hir.numbers[n as usize], true),
            ExprKind::String(s) => {
                // `checkPrivateIdentifierExpression`: `#a` is `any`. Directly left of `in` it keeps its name, which narrowing uses.
                if is_private_name_at(hir, hir[e].pos) {
                    let is_left_of_in = !is_parenthesized(hir, e)
                        && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent)
                            if matches!(hir[parent].kind, ExprKind::Binary { op: BinOp::In, left, .. } if left == e));
                    if !is_left_of_in {
                        return TypeId::ANY;
                    }
                }
                self.string_literal(s, true)
            }
            ExprKind::BigInt(text) => self.fresh_bigint_literal(text, false),
            ExprKind::Regex => self.global_ref(known::RegExp, &[]),
            // `checkTemplateExpression`
            ExprKind::Template { exprs } => {
                // The comparison runs for every span, whether or not the types are used: that of
                // `this` with a union asks for the type of every property of the class.
                let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                for x in hir.ids(exprs) {
                    let t = self.type_of_expr(file, x);
                    types.push(
                        if t == TypeId::UNRESOLVED
                            || self.is_assignable_to_template_constraint_type(t)
                        {
                            t
                        } else {
                            TypeId::STRING
                        },
                    );
                }
                // The value it evaluates to, if that can be determined from the source text alone.
                // `IsTaggedTemplateExpression(node.Parent)`: neither the tag nor the template of a
                // tagged template is evaluated.
                let is_tag = matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p)
                    if matches!(hir[p].kind, ExprKind::TaggedTemplate(c) if hir[c].callee == e || hir[c].template == e))
                    && !is_parenthesized(hir, e);
                if !is_tag && let Some(EnumValue::String(text)) = self.constant_value(file, e) {
                    return self.string_literal(text, true);
                }
                let expects_literal = self.is_const_context(file, e)
                    // `isTemplateLiteralContext`: as an element access key it is typed by its
                    // possible values.
                    || matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Index { index, .. } if index == e))
                    || self.contextual_type(file, e, ContextFlags::empty()).is_some_and(|c| self.parts(c).iter().any(|&m| self.is_template_literal_contextual_type(m)));
                if !expects_literal {
                    return TypeId::STRING;
                }
                let texts: Vec<Atom> = hir.ids(hir.template_texts(exprs)).collect();
                self.template_type(&texts, &types)
            }
            ExprKind::TaggedTemplate(_) | ExprKind::New(_) => {
                let resolved = self.resolved_signature(file, e);
                self.with_return_type(resolved).ret
            }
            ExprKind::Array(items) => self.type_of_array_literal(file, e, items),
            ExprKind::Object(props) => self.type_of_object_literal(file, e, props),
            ExprKind::Fn(func) => {
                self.check_node_deferred(file, e);
                self.check_function_expression_or_object_literal_method(file, e, func)
            }
            // `checkClassExpression`
            ExprKind::Class(class) => {
                // `checkClassLikeDeclaration` has no check mode.
                let outer = self.suspend_recheck();
                self.check_class_like_declaration(file, class);
                self.end_recheck(outer);
                self.check_node_deferred(file, e);
                let sym = self.class_sym(file, class);
                self.type_of_symbol(sym)
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                let (ty, stops) = self.type_of_link(file, e);
                if stops { self.optional(ty) } else { ty }
            }
            ExprKind::Unary { op, operand } => self.type_of_unary(file, e, op, operand),
            ExprKind::Binary { op, left, right } => self.type_of_binary(file, e, op, left, right),
            ExprKind::Assign { op, target, value } => match op {
                None => {
                    // `checkBinaryLikeExpression`: the left operand first. A pattern is
                    // destructured, not checked as an expression.
                    if target.is_none()
                        || !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                    {
                        self.look_at(file, target);
                    }
                    let source = self.type_of_expr(file, value);
                    self.look_at_assignment(file, e, target, source);
                    // `checkObjectLiteralAssignment`
                    if self.p.files.options.strict_null_checks
                        && target.is_some()
                        && matches!(hir[target].kind, ExprKind::Object(props) if props.is_empty())
                    {
                        self.non_null_type(source)
                    } else {
                        source
                    }
                }
                Some(op) => self.type_of_binary(file, e, op, target, value),
            },
            // `checkConditionalExpression`
            ExprKind::Cond { test, yes, no } => {
                let tested = self.type_of_expr(file, test);
                self.check_truthiness_of_type(file, test, tested);
                let (yes, no) = (self.type_of_expr(file, yes), self.type_of_expr(file, no));
                self.union_reduced(&[yes, no])
            }
            ExprKind::Spread(x) => self.type_of_expr(file, x),
            // `checkSatisfiesExpression`
            ExprKind::Satisfies { expr: x, ty } => {
                self.look_at_type_node(file, ty);
                let source = self.type_of_expr(file, x);
                let target = self.type_from_node(file, ty);
                if self.is_error_type(target) {
                    return target;
                }
                self.print_unsatisfied_types(file, source, ty);
                source
            }
            ExprKind::AsConst(x) => {
                let ty = self.type_of_expr(file, x);
                self.regular(ty)
            }
            // `checkAwaitExpression`
            ExprKind::Await(x) => {
                let ty = self.type_of_expr(file, x);
                self.check_awaited_type(ty, true, self.place_of_expr(file, e), 1320)
            }
            ExprKind::Yield { value, star } => self.type_of_yield(file, e, value, star),
            ExprKind::As { expr, ty } => {
                // `checkAssertion` checks the operand first. `getQuickTypeOfExpression`: not where
                // the assertion is the whole initializer or the whole assigned value, whose type
                // control flow analysis requests.
                let is_quick = match self.bound(file).expr_parent[e.idx()] {
                    Parent::VarInit(_)
                    | Parent::ParamDefault(_)
                    | Parent::MemberInit(_)
                    | Parent::PatPropDefault(_)
                    | Parent::PatElemDefault(_) => true,
                    Parent::Expr(p) => {
                        matches!(hir[p].kind, ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), value, .. } if value == e)
                    }
                    _ => false,
                };
                if !is_quick {
                    self.look_at(file, expr);
                    self.look_at_type_node(file, ty);
                }
                self.type_from_node(file, ty)
            }
            // `checkNonNullAssertion`
            ExprKind::NonNull(x) => {
                if self.is_in_optional_chain(file, x) && self.is_non_null_chain(file, e) {
                    let (ty, stops) = self.type_of_link(file, e);
                    return if stops { self.optional(ty) } else { ty };
                }
                let ty = self.type_of_expr(file, x);
                self.non_nullable(ty)
            }
            // `checkExpressionWithTypeArguments`
            ExprKind::Instantiation { expr, type_args } => {
                self.look_at_type_nodes(file, type_args);
                let ty = self.type_of_expr(file, expr);
                let args = self.types_from_nodes(file, type_args);
                self.with_type_arguments(ty, &args, InstantiationExpression::Expr(file, e))
            }
            ExprKind::Jsx(j) => {
                let is_fragment = hir[j].tag.is_none();
                if !is_fragment {
                    self.check_node_deferred(file, e);
                }
                if self.task.file == Some(file) {
                    if self.first_jsx.0 != file {
                        self.first_jsx = (file, None, None);
                    }
                    self.first_jsx.1 = self.first_jsx.1.or(Some(e));
                    if is_fragment {
                        self.first_jsx.2 = self.first_jsx.2.or(Some(e));
                    }
                }
                match self.jsx_element_type(file) {
                    // `checkJsxFragment`: `any` where `getJsxElementTypeAt` is the error type.
                    ty if is_fragment && self.is_error_type(ty) => TypeId::ANY,
                    ty => ty,
                }
            }
            ExprKind::ImportCall { args, .. } => {
                self.look_at_with(|c| c.aliases_import_call_or_meta_property(file, e));
                self.type_of_import_call(file, self.hir(file).id_at(args, 0))
            }
            ExprKind::ImportMeta => self.global_ref(known::ImportMeta, &[]),
            ExprKind::NewTarget(_) => self.type_of_new_target(file, e),
        }
    }

    /// `isTemplateLiteralContextualType`
    fn is_template_literal_contextual_type(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => true,
            // Among generic types, `keyof T` is a primitive.
            TypeData::Keyof(_) => false,
            _ => {
                self.is_deferred(ty) && {
                    let constraint = self.base_constraint(ty);
                    self.maybe_type_of_kind(constraint, Self::is_string_like)
                }
            }
        }
    }

    /// `maybeTypeOfKind`: whether `ty` is of the kind, or a member of it if it is a union or an intersection.
    pub(super) fn maybe_type_of_kind(&self, ty: TypeId, kind: fn(&Self, TypeId) -> bool) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.maybe_type_of_kind(p, kind))
            }
            _ => kind(self, ty),
        }
    }

    /// `maybeTypeOfKindConsideringBaseConstraint`
    pub(super) fn maybe_type_of_kind_considering_base_constraint(
        &mut self,
        ty: TypeId,
        kind: fn(&Self, TypeId) -> bool,
    ) -> bool {
        self.maybe_type_of_kind(ty, kind)
            || self
                .base_constraint_of(ty)
                .is_some_and(|base| self.maybe_type_of_kind(base, kind))
    }

    /// `getFreshTypeOfLiteralType(getBigIntLiteralType(..))`. The regular type is created first:
    /// `CompareTypes` orders bigint literal types by creation order.
    fn fresh_bigint_literal(&mut self, text: Atom, negative: bool) -> TypeId {
        self.intern(TypeData::BigIntLit {
            text,
            negative,
            fresh: false,
        });
        self.intern(TypeData::BigIntLit {
            text,
            negative,
            fresh: true,
        })
    }

    /// `checkImportCallExpression`, for `import(spec)`.
    fn type_of_import_call(&mut self, file: FileId, spec: ExprId) -> TypeId {
        // `createPromiseReturnType`: 2711 when there is no global `Promise` type.
        if self.global_type_symbol(known::Promise).is_none() {
            return TypeId::ERROR;
        }
        let ExprKind::String(spec) = self.hir(file)[spec].kind else {
            return self.promise_of(TypeId::ANY);
        };
        let files = self.files();
        // `getEmitSyntaxForUsageLocationWorker`: the emit format of an `import()`, which is also
        // the resolution mode of its specifier, does not depend on the file alone.
        let usage = files.mode_of_import_call(file);
        // An unresolved module is an error, so the result is compatible with anything.
        let Some(module) = files.module_of_specifier_as(file, spec, usage) else {
            return self.promise_of(TypeId::ANY);
        };
        // The value of `export =`, if the module has one.
        let mut ty = self.type_of_symbol(files.module_value(module));
        if !self.is_any(ty) {
            // `createDefaultPropertyWrapperForModule`
            let default = Prop {
                name: known::default,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            };
            let wrapper = self.synth(Shape {
                props: vec_from_iter_in([default], self.arena),
                default_of: Some(module),
                ..Shape::new_in(self.arena)
            });
            // `isOnlyImportableAsDefault`: under Node a JSON module has only a default export.
            let is_default_only = files.options.module.is_node()
                && usage == ResolutionMode::Import
                && files
                    .symbol(module)
                    .decls
                    .iter()
                    .any(|d| matches!(d, Decl::File))
                && (files.hir(module.file).kind == FileKind::Json
                    || files.module(module.file).path.ends_with(b".d.json.ts"));
            if is_default_only {
                // `getTypeWithSyntheticDefaultOnly`
                ty = wrapper;
            } else if self.can_have_synthetic_default(usage, module) {
                // `getTypeWithSyntheticDefaultImportType`: a module that may be its own default
                // export gets a synthetic default, which overrides its own.
                let with_default = if self.is_valid_spread_type(ty) {
                    self.spread(ty, wrapper)
                } else {
                    wrapper
                };
                // The symbol synthesized for it is a type literal without members:
                // `IsEmptyAnonymousObjectType` treats it as `{}`.
                ty = self.map_type(with_default, |c, m| match c.data(m) {
                    TypeData::Synth(shape) => c.synth(Shape {
                        literal: Literalness::SyntheticDefault,
                        default_of: Some(module),
                        ..(**shape).clone_in(self.arena)
                    }),
                    _ => m,
                });
            }
        }
        // `createPromiseType`
        let ty = self.awaited(ty);
        self.promise_of(ty)
    }

    // ───────────────────────────── names ─────────────────────────────

    /// `isCommonJSRequire`: `require("m")` in JavaScript, where `require` is not defined by the
    /// program itself.
    pub(super) fn is_commonjs_require(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if !hir.is_js || crate::bind::required_specifier(hir, e).is_none() {
            return false;
        }
        let ExprKind::Call(c) = hir[e].kind else {
            return false;
        };
        let Some(sym) = self.symbol_of_identifier(file, hir[c].callee, known::require) else {
            return true;
        };
        let flags = self.files().flags(sym);
        if flags.contains(SymFlags::ALIAS) {
            return false;
        }
        // `GetDeclarationOfKind`: the first function declaration of a function, else the first variable declaration, has to be ambient.
        let is_first_ambient = self.files().decls(sym).iter().find_map(|&(f, decl)| {
            let of = self.hir(f);
            let is_ambient =
                |flags: Flags| flags.contains(Flags::AMBIENT) || of.kind == FileKind::Declaration;
            match decl {
                Decl::Fn(func) if flags.contains(SymFlags::FUNCTION) => {
                    Some(is_ambient(of[func].flags))
                }
                Decl::Var(pat) if !flags.contains(SymFlags::FUNCTION) => {
                    match self.bound(f).pat_parent[pat.idx()] {
                        PatParent::Var(d) => Some(is_ambient(of[d].flags)),
                        // A binding element is not a variable declaration.
                        _ => None,
                    }
                }
                _ => None,
            }
        });
        is_first_ambient == Some(true)
    }

    /// `getResolvedSymbol`: the symbol an identifier resolves to as a value.
    pub fn symbol_of_identifier(&self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        self.resolve_identifier(file, e, name, false)
            .unwrap_or(None)
    }

    /// `resolveEntityName` with `SymbolFlagsValue`, for an identifier that is an expression. `Err`:
    /// the error code `Files::resolve` returns.
    pub fn resolve_identifier(
        &self,
        file: FileId,
        e: ExprId,
        name: Atom,
        ignore_errors: bool,
    ) -> Result<Option<Sym>, u32> {
        let (files, bound) = (self.files(), self.bound(file));
        let local = bound.expr_symbol[e.idx()];
        if local.is_some() {
            let sym = files.sym(file, local);
            // `getSymbol`: an alias that does not resolve to a value does not match the value
            // meaning, and the search continues in outer scopes. If that finds nothing it is an
            // error, and the alias is the only symbol available.
            if !files.flags(sym).intersects(SymFlags::VALUE)
                && let Ok(i) = bound.alias_idents.binary_search_by_key(&e, |alias| alias.0)
                && !files.means(sym, SymFlags::VALUE)
                && let Some(outer) =
                    files.resolve_name(file, bound.alias_idents[i].1, name, SymFlags::VALUE)
            {
                return Ok(Some(outer));
            }
            return Ok(Some(sym));
        }
        // `NameResolver.Resolve`: the arguments object of an enclosing function shadows any outer
        // declaration of that name.
        if name == known::arguments && bound.is_arguments_object(e) {
            return Ok(None);
        }
        // The exports of other declarations of an enclosing module, namespace or enum, in any file,
        // are in scope too, and take precedence over the globals.
        match bound.free_idents.binary_search_by_key(&e, |free| free.0) {
            Ok(i) => files
                .resolve(
                    file,
                    bound.free_idents[i].1,
                    name,
                    SymFlags::VALUE,
                    !ignore_errors,
                )
                .map_err(|error| error.0),
            Err(_) => Ok(files.global(name, SymFlags::VALUE)),
        }
    }

    /// `checkIdentifier`
    fn type_of_identifier(&mut self, file: FileId, e: ExprId, name: Atom) -> TypeId {
        // `Err`: `Resolve` has returned nil, `getResolvedSymbol` is `unknownSymbol`.
        let Ok(found) = self.resolve_identifier(file, e, name, false) else {
            self.unresolved_identifiers.push((file, e, name));
            return TypeId::ERROR;
        };
        let Some(sym) = found else {
            return match name {
                known::arguments if self.bound(file).is_arguments_object(e) => {
                    let hir = self.hir(file);
                    if hir.is_in_property_initializer_or_class_static_block(hir.node(e), true) {
                        let node = self.place_of_token(file, self.hir(file)[e].pos);
                        self.error_at(node, 2815, &[]);
                        return TypeId::ERROR;
                    }
                    self.global_ref(known::IArguments, &[])
                }
                // `RequireSymbol`
                known::require
                    if self.hir(file).is_js
                        && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(call) if crate::bind::require_argument(self.hir(file), call).is_some()) =>
                {
                    TypeId::ANY
                }
                // Not reached by the binder: nothing is reported for it.
                _ if matches!(self.bound(file).expr_parent[e.idx()], Parent::None) => {
                    TypeId::UNRESOLVED
                }
                // `getResolvedSymbol` gives `unknownSymbol`.
                _ => {
                    self.unresolved_identifiers.push((file, e, name));
                    TypeId::ERROR
                }
            };
        };
        // `getSymbol`: an alias that does not resolve to a value does not match the value meaning.
        // It is the only symbol `resolve_identifier` has.
        let own = self.files().flags(sym);
        if own.contains(SymFlags::ALIAS)
            && !own.intersects(SymFlags::VALUE)
            && !self.files().means(sym, SymFlags::VALUE)
        {
            self.unresolved_identifiers.push((file, e, name));
        }
        if !self.contextual_binding_patterns.is_empty()
            && self.is_reference_within_contextual_pattern(file, e, sym)
        {
            return TypeId::NON_INFERRABLE_ANY;
        }
        let cycles_before = self.cycles;
        let declared = self.type_of_symbol(sym);
        // `getTypeOfVariableOrParameterOrProperty` returns the type it computed to the first caller and `links.resolvedType` to every
        // later caller. The two differ after a circularity that goes through a call. A reference in the variable's own initializer
        // is never the first caller: the declaration is.
        let declared = if self.cycles != cycles_before
            && let Some(cached) = self.p.symbol_types.get(&self.task, &sym)
            && cached != declared
            && self.is_in_own_initializer(file, e, sym)
        {
            cached
        } else {
            declared
        };
        let flags = self.files().flags(sym);
        let target = self.target_kind(file, e);
        // Only a non-constant variable can be assigned.
        if (!flags.intersects(SymFlags::VARIABLE) || flags.contains(SymFlags::CONST))
            && target.written
        {
            let assignment_error = if flags.intersects(SymFlags::VARIABLE) {
                2588
            } else if flags.intersects(SymFlags::ENUM) {
                2628
            } else if flags.contains(SymFlags::CLASS) {
                2629
            } else if flags.intersects(SymFlags::MODULE) {
                2631
            } else if flags.contains(SymFlags::FUNCTION) {
                2630
            } else if flags.contains(SymFlags::ALIAS) {
                2632
            } else {
                2539
            };
            let node = self.place_of_token(file, self.hir(file)[e].pos);
            self.error_at(node, assignment_error, &[Arg::Atom(name)]);
            return TypeId::ERROR;
        }
        // An import is narrowed like a variable.
        if !flags.intersects(SymFlags::VARIABLE | SymFlags::ALIAS) || target.definite {
            if target.definite
                && flags.intersects(SymFlags::VARIABLE)
                && self.is_in_compound_like_assignment(file, e)
            {
                return self.base_of_literal(declared);
            }
            return declared;
        }
        let is_variable_here = sym.file == file && flags.intersects(SymFlags::VARIABLE);
        let declared = if is_variable_here {
            self.narrow_binding(file, e, sym.id, declared)
        } else {
            declared
        };
        let narrowed = self.narrow_reference(file, e, sym, declared);
        // `getBaseTypeOfLiteralType(flowType)`, for the target of an operator that reads it and
        // then assigns it, including `++` and `--`.
        if target.written {
            self.base_of_literal(narrowed)
        } else {
            narrowed
        }
    }

    /// Whether `e` is inside the initializer of the declaration `var sym = ..`.
    fn is_in_own_initializer(&self, file: FileId, e: ExprId, sym: Sym) -> bool {
        if sym.file != file {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        hir.find_ancestor(hir.node(e), |n| {
            matches!(hir.data(n), NodeData::VarDecl(d) if bound.pat_symbol[hir[d].pat.idx()] == sym.id)
        })
        .is_some()
    }

    /// Whether `e` is assigned and not read: the left side of `=`, or part of a pattern there.
    #[inline]
    pub fn is_definite_assignment_target(&self, file: FileId, e: ExprId) -> bool {
        matches!(
            self.bound(file).get_assignment_target(self.hir(file), e),
            Some(AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf)
        )
    }

    /// `getAssignmentTargetKind`
    pub(super) fn target_kind(&self, file: FileId, e: ExprId) -> TargetKind {
        let target = self.bound(file).get_assignment_target(self.hir(file), e);
        let assigned = matches!(
            target,
            Some(AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf)
        );
        TargetKind {
            assigned,
            definite: assigned
                || matches!(
                    target,
                    Some(AssignmentTarget::Assign(Some(
                        BinOp::And | BinOp::Or | BinOp::Nullish
                    )))
                ),
            written: target.is_some(),
        }
    }

    /// `getAssignmentTargetKind(e) != AssignmentKindNone`: `e` is assigned, by `=` or in a pattern
    /// on its left, by an operator that reads it first, or by `++` and `--`.
    pub(super) fn is_assignment_target(&self, file: FileId, e: ExprId) -> bool {
        self.bound(file)
            .get_assignment_target(self.hir(file), e)
            .is_some()
    }

    /// `isMethodAccessForCall`. A call does not see through `x!`.
    fn is_called(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent)
            if matches!(hir[parent].kind, ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee == e))
    }

    /// The class whose member `func` is, and whether the member is static.
    fn class_of_member_fn(&self, file: FileId, func: FnId) -> Option<(ClassId, bool)> {
        let FnOwner::Member(m) = self.bound(file).fns[func.idx()].owner else {
            return None;
        };
        let MemberOwner::Class(c) = self.bound(file).member_owner[m.idx()] else {
            return None;
        };
        Some((c, self.hir(file)[m].flags.contains(Flags::STATIC)))
    }

    /// `GetThisContainer(e, false, false)`: the nearest enclosing function of `e` that is not an
    /// arrow function, or the class whose field is initialized and whether that is static. `None`:
    /// any other container.
    pub(super) fn this_container(
        &self,
        file: FileId,
        e: ExprId,
    ) -> Option<Result<FnId, (ClassId, bool)>> {
        let hir = self.hir(file);
        Self::function_or_class_of(hir, hir.get_this_container(hir.node(e), false, false))
    }

    fn function_or_class_of(hir: &File, container: Node) -> Option<Result<FnId, (ClassId, bool)>> {
        match hir.function_of(container).some() {
            Some(function) => Some(Ok(function)),
            None if hir.kind(container) == Kind::PropertyDeclaration => Some(Err((
                hir.class_of(hir.parent(container)),
                hir.is_static(container),
            ))),
            None => None,
        }
    }

    /// The same for a node directly in `parent`. `Parent::Expr(e)` represents `e` itself.
    pub(super) fn this_container_from(
        &self,
        file: FileId,
        parent: Parent,
    ) -> Option<Result<FnId, (ClassId, bool)>> {
        let hir = self.hir(file);
        let container = match parent {
            Parent::Expr(e) => hir.get_this_container(hir.node(e), false, false),
            Parent::Decorator(class, _) => hir.get_this_container(hir.node(class), false, false),
            _ => hir.this_container_from(hir.node(parent), false, false),
        };
        Self::function_or_class_of(hir, container)
    }

    #[inline]
    pub(super) fn class_sym(&self, file: FileId, c: ClassId) -> Sym {
        self.files()
            .sym(file, self.bound(file).class_symbol[c.idx()])
    }

    /// `checkThisBeforeSuper`
    fn check_this_before_super(&mut self, file: FileId, e: ExprId, container: FnId, code: u32) {
        let (hir, flow) = (self.hir(file), self.bound(file).expr_flow[e.idx()]);
        if let Some((class, _)) = self.class_of_member_fn(file, container)
            && hir[class].extends.is_some()
            && !self.class_declaration_extends_null(self.class_sym(file, class))
            && flow.is_some()
            && !self.is_post_super(file, flow, false, &mut Vec::new())
        {
            self.error_at(self.place_of_token(file, hir[e].pos), code, &[]);
        }
    }

    /// `checkThisExpression`
    pub(super) fn check_this_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        let (this, node) = (hir.node(e), self.place_of_expr(file, e));
        let mut container = hir.get_this_container(this, true, true);
        let (mut captured_by_arrow_function, mut this_in_computed_property_name) = (false, false);
        if hir.kind(container) == Kind::Constructor {
            self.check_this_before_super(file, e, hir.function_of(container), 17009);
        }
        loop {
            if hir.kind(container) == Kind::ArrowFunction {
                container =
                    hir.get_this_container(container, false, !this_in_computed_property_name);
                captured_by_arrow_function = true;
            }
            if hir.kind(container) != Kind::ComputedPropertyName {
                break;
            }
            container = hir.get_this_container(container, !captured_by_arrow_function, false);
            this_in_computed_property_name = true;
        }
        // `checkThisInStaticClassFieldInitializerInDecoratedClass`
        if hir.kind(container) == Kind::PropertyDeclaration
            && hir.is_static(container)
            && self.p.files.options.experimental_decorators
            && hir
                .find_ancestor(this, |n| n == hir.initializer(container))
                .is_some()
            && hir
                .decorators
                .iter()
                .any(|d| d.0 == DecoratorOwner::Class(hir.class_of(hir.parent(container))))
        {
            self.error_at(node, 2816, &[]);
        }
        match hir.kind(container) {
            _ if this_in_computed_property_name => {
                self.error_at(node, 2465, &[]);
            }
            Kind::ModuleDeclaration => {
                self.error_at(node, 2331, &[]);
            }
            Kind::EnumDeclaration => {
                self.error_at(node, 2332, &[]);
            }
            _ => {}
        }
        let is_global_this = |c: &Self, t: TypeId| {
            matches!(
                c.data(t),
                TypeData::Anon {
                    origin: Origin::GlobalThis,
                    ..
                }
            )
        };
        let Some(t) = self.try_get_this_type_at_ex(file, this, container) else {
            if !self.p.files.options.no_implicit_this {
                return TypeId::ANY;
            }
            let is_shadowed = self
                .try_get_this_type_at(file, container)
                .is_some_and(|t| !is_global_this(self, t));
            let (from, to) = self.get_error_range_for_node(file, container);
            let shadowed = is_shadowed.then(|| self.new_diagnostic((file, from, to), 2738, &[]));
            let diagnostic = self.error_at(node, 2683, &[]);
            if let Some(shadowed) = shadowed {
                diagnostic.add_related_info(shadowed);
            }
            return TypeId::ANY;
        };
        if captured_by_arrow_function
            && self.p.files.options.no_implicit_this
            && is_global_this(self, t)
        {
            self.error_at(node, 7041, &[]);
        }
        // `getFlowTypeOfReference(node, thisType)`
        if container != Node::FILE {
            self.narrow_this(file, e, t)
        } else {
            t
        }
    }

    /// `tryGetThisTypeAt`
    fn try_get_this_type_at(&mut self, file: FileId, node: Node) -> Option<TypeId> {
        let container = self.hir(file).get_this_container(node, false, false);
        self.try_get_this_type_at_ex(file, node, container)
    }

    /// `tryGetThisTypeAtEx`, before control flow narrowing.
    fn try_get_this_type_at_ex(
        &mut self,
        file: FileId,
        node: Node,
        container: Node,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        if hir.kind(container).is_function_like() {
            let func = hir.function_of(container);
            let f = &hir[func];
            if f.this_param.is_some() {
                return Some(self.type_of_this_parameter(file, func));
            }
            // In a parameter default only a declared `this` parameter counts.
            if !hir.is_in_parameter_initializer_before_containing_function(node) {
                // `getSignatureOfFullSignatureType` comes before `getSignatureFromDeclaration`.
                if let Some(sig) = self.full_signature(file, func)
                    && let Some(this) = self.sig_this_type(sig)
                {
                    return Some(this);
                }
                // `getSignatureFromDeclaration`: if only one accessor of a pair declares the type
                // of `this`, it applies to both.
                let expected = match f.kind {
                    FnKind::Getter => Some(FnKind::Setter),
                    FnKind::Setter => Some(FnKind::Getter),
                    _ => None,
                };
                if let Some(expected) = expected
                    && let Some(other) = self.sibling_accessor(file, func, expected)
                {
                    let other = &self.hir(file)[other];
                    // `getAccessorThisParameter`: only for an accessor whose parameters are those
                    // expected of its kind.
                    if other.this_ty(self.hir(file)).is_some()
                        && other.params.len() == usize::from(expected == FnKind::Setter)
                    {
                        return Some(self.type_from_node(file, other.this_ty(self.hir(file))));
                    }
                }
                if let FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner
                    && let Some(this) = self.contextual_this_parameter_type(file, func, owner)
                {
                    return Some(this);
                }
            }
        }
        let class = hir.class_of(hir.parent(container));
        if class.is_some() {
            let sym = self.class_sym(file, class);
            return Some(if hir.is_static(container) {
                self.type_of_symbol(sym)
            } else {
                self.intern(TypeData::ThisParam(sym))
            });
        }
        if container != Node::FILE {
            return None;
        }
        // `undefinedType` in a file with an `ExternalModuleIndicator`, `globalThis` in any other, a CommonJS module too.
        Some(if !hir.has_module_syntax {
            self.intern(TypeData::Anon {
                origin: Origin::GlobalThis,
                mapper: MapperId::IDENTITY,
            })
        } else {
            TypeId::UNDEFINED
        })
    }

    /// `getTypeOfSymbol(signature.thisParameter)`, which is `getTypeForVariableLikeDeclaration`:
    /// its declared type; without one, for a setter that of the `this` parameter of the getter,
    /// then `getContextualThisParameterType`, then `any`.
    pub(super) fn type_of_this_parameter(&mut self, file: FileId, func: FnId) -> TypeId {
        let f = self.hir(file)[func];
        let mut declared = f.this_ty(self.hir(file));
        if declared.is_none()
            && f.kind == FnKind::Setter
            && let Some(getter) = self.sibling_accessor(file, func, FnKind::Getter)
        {
            declared = self.hir(file)[getter].this_ty(self.hir(file));
        }
        if declared.is_some() {
            return self.declared_type_of_this_parameter(file, f.this_param, declared);
        }
        if let FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner
            && let Some(this) = self.contextual_this_parameter_type(file, func, owner)
        {
            return this;
        }
        // `reportImplicitAny`. The binder does not bind the name, so `report_implicit_any_of_name`
        // does not handle it.
        let hir = self.hir(file);
        let this = &hir[f.this_param];
        if self.p.files.options.no_implicit_any
            && !this.flags.contains(Flags::REPARSED)
            && !matches!(f.kind, FnKind::Getter | FnKind::Setter)
            && !(hir.is_js && !self.is_check_js(file))
            && !self.is_private_within_ambient(file, func)
            && self.full_signature(file, func).is_none()
        {
            let start = hir[this.pat].pos;
            let args = [Arg::Bytes(b"this"), Arg::Type(TypeId::ANY)];
            self.error_at((file, start, start + 4), 7006, &args);
        }
        TypeId::ANY
    }

    /// `getTypeOfVariableOrParameterOrProperty` for the `this` parameter `p`, whose type annotation
    /// is `declared`: `typeof this` in the annotation requests the type of the parameter.
    fn declared_type_of_this_parameter(
        &mut self,
        file: FileId,
        p: ParamId,
        declared: TypeNodeId,
    ) -> TypeId {
        if let Some(known) = self.p.type_node_types.get(&self.task, &(file, declared)) {
            return known;
        }
        let pat = self.hir(file)[p].pat;
        if let Some((known, _)) = self.p.pat_types.get(&self.task, &(file, pat)) {
            return known;
        }
        if !self.enter(Query::Pat(file, pat)) {
            return if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.type_from_node(file, declared);
        let _ = self.leave(Query::Pat(file, pat));
        if !self.left_a_cycle {
            return ty;
        }
        let (error, stored) = (TypeId::ERROR, self.cycle_result());
        self.p
            .pat_types
            .rewrite(&self.task, (file, pat), (error, true), stored);
        let (start, end) = self.get_error_range_for_node(file, self.hir(file).node(p));
        // The parameter of a `@this` tag has no name.
        let name: &[u8] = match self.hir(file)[pat].kind {
            PatKind::Missing => b"(Missing)",
            _ => b"this",
        };
        let (at, name) = ((file, start, end), Arg::Bytes(name));
        self.report_circularity_error(Query::Pat(file, pat), at, name, error, false);
        error
    }

    /// `checkNewTargetMetaProperty`
    fn type_of_new_target(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `GetNewTargetContainer` is nil anywhere else: 17013.
        let Some(Ok(func)) = self.this_container(file, e) else {
            return TypeId::ERROR;
        };
        match self.hir(file)[func].kind {
            FnKind::Constructor => match self.class_of_member_fn(file, func) {
                Some((class, _)) => {
                    let sym = self.class_sym(file, class);
                    self.type_of_symbol(sym)
                }
                None => TypeId::ANY,
            },
            FnKind::Decl => {
                let symbol = self.bound(file).fn_symbol[func.idx()];
                if symbol.is_none() {
                    return TypeId::ANY;
                }
                let sym = self.files().sym(file, symbol);
                self.type_of_symbol(sym)
            }
            FnKind::Expr => match self.bound(file).fns[func.idx()].owner {
                FnOwner::Expr(owner) => self.type_of_expr(file, owner),
                _ => TypeId::ANY,
            },
            _ => TypeId::ERROR,
        }
    }

    /// `getContextualThisParameterType`, for the function expression or the method of an object literal `owner`.
    pub(super) fn contextual_this_parameter_type(
        &mut self,
        file: FileId,
        func: FnId,
        owner: ExprId,
    ) -> Option<TypeId> {
        if self.is_context_sensitive_function_or_method(file, func, owner) {
            // `getThisTypeOfDeclaration`: the `this` type assigned by `assignContextualParameterTypes`.
            if let Some(sig) = self.assigned_contextual_signature(file, func)
                && let Some(this) = self.sig_this_type(sig)
            {
                return Some(this);
            }
            // `getContextualSignature` is not cached: the enclosing call may have been resolved since the signature was assigned.
            if let Some(sig) = self.contextual_signature(file, func)
                && let Some(this) = self.sig_this_type(sig)
            {
                return Some(this);
            }
        }
        if !self.p.files.options.no_implicit_this && !self.hir(file).is_js {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let Parent::Prop(p) = bound.expr_parent[owner.idx()] {
            let containing = bound.prop_owner[p.idx()];
            // `getContainingObjectLiteral`: for a method, an accessor, or a function that is the
            // whole value of a property.
            let is_member = match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => true,
                PropKind::Init => !is_parenthesized(hir, owner),
                PropKind::Shorthand | PropKind::Spread => false,
            };
            if is_member
                && containing.is_some()
                && matches!(hir[containing].kind, ExprKind::Object(_))
            {
                // `getThisTypeOfObjectLiteralFromContextualType`: a `ThisType<T>` in the contextual
                // type of the literal, or of a literal that directly contains it as a property
                // value, determines it.
                let context =
                    self.apparent_type_of_contextual_type(file, containing, ContextFlags::empty());
                let (mut literal, mut expected) = (containing, context);
                while let Some(ty) = expected {
                    let mut marked = Vec::new();
                    for &part in self.parts(ty) {
                        let pieces: &[TypeId] = match self.data(part) {
                            TypeData::Intersection(pieces) => pieces,
                            _ => std::slice::from_ref(&part),
                        };
                        if let Some(&[this]) = pieces
                            .iter()
                            .find_map(|&piece| self.is_global_ref(piece, known::ThisType))
                        {
                            marked.push(this);
                        }
                    }
                    if !marked.is_empty() {
                        let this = self.union(&marked);
                        let mapper =
                            self.get_inference_context(file, containing)
                                .and_then(|level| {
                                    self.with_inference_context(level, |c, n| {
                                        c.fixing_mapper(n, this)
                                    })
                                });
                        return Some(self.instantiate(this, mapper.unwrap_or(MapperId::IDENTITY)));
                    }
                    let Parent::Prop(outer) = bound.expr_parent[literal.idx()] else {
                        break;
                    };
                    if hir[outer].kind != PropKind::Init || is_parenthesized(hir, literal) {
                        break;
                    }
                    literal = bound.prop_owner[outer.idx()];
                    if literal.is_none() || !matches!(hir[literal].kind, ExprKind::Object(_)) {
                        break;
                    }
                    expected =
                        self.apparent_type_of_contextual_type(file, literal, ContextFlags::empty());
                }
                // Otherwise it is the contextual type of the literal, or else the type of the
                // literal.
                let this = match context {
                    Some(context) => self.non_nullable(context),
                    None => self.type_of_expr(file, containing),
                };
                return Some(self.widened(this));
            }
        }
        // `obj.xxx = function () {}`, whatever the operator: `obj`.
        if let Parent::Expr(parent) = bound.expr_parent[owner.idx()]
            && let ExprKind::Assign { target, value, .. } = hir[parent].kind
            && value == owner
            && target.is_some()
            && let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[target].kind
        {
            // Not in `exports.Point = function (x) { this.x = x }`.
            if let ExprKind::Ident(name) = hir[obj].kind
                && self
                    .symbol_of_identifier(file, obj, name)
                    .is_some_and(|s| self.files().flags(s).contains(SymFlags::MODULE_EXPORTS))
            {
                return None;
            }
            let this = self.type_of_expr(file, obj);
            return Some(self.widened(this));
        }
        None
    }

    /// `isContextSensitiveFunctionOrObjectLiteralMethod`, which an accessor is not.
    pub(super) fn is_context_sensitive_function_or_method(
        &self,
        file: FileId,
        func: FnId,
        owner: ExprId,
    ) -> bool {
        let f = &self.hir(file)[func];
        if matches!(f.kind, FnKind::Getter | FnKind::Setter) {
            return false;
        }
        // `HasContextSensitiveParameters`: a function that references `this` without declaring its
        // type takes it from its context.
        self.is_context_sensitive(file, owner)
            || f.kind != FnKind::Arrow
                && f.type_params.is_empty()
                && f.this_ty(self.hir(file)).is_none()
                && self.bound(file).fns[func.idx()].contains_this
    }

    /// Whether `type_of_expr` has the type of `e` cached.
    fn has_type_of_expr(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_rechecking() {
            self.rechecked_exprs.contains_key(&(file, e))
        } else {
            self.cached_type_of_expr(file, e).is_some()
        }
    }

    /// `checkPropertyAssignment`, `checkObjectLiteralMethod` and similar functions for the member
    /// `p`, as `checkObjectLiteral` calls them.
    pub(super) fn check_literal_member(&mut self, file: FileId, p: PropId) -> TypeId {
        if !self.is_rechecking() {
            return self.type_of_literal_prop(file, p);
        }
        let is_memoised = self.contextual_binding_patterns.is_empty();
        if is_memoised && let Some(&known) = self.rechecked_members.get(&(file, p)) {
            return known;
        }
        if !self.enter(Query::LiteralProp(file, p)) {
            return TypeId::UNRESOLVED;
        }
        let outer = self.begin_recheck();
        let ty = self.type_of_literal_prop_uncached(file, p);
        self.end_recheck(outer);
        // An uncached check (`checkExpression`) stores nothing in `literal_prop_types`.
        self.settle_reported_without_entry();
        if self.leave(Query::LiteralProp(file, p)).is_ok() && is_memoised {
            self.rechecked_members.insert((file, p), ty);
        }
        let prop = &self.hir(file)[p];
        if matches!(prop.kind, PropKind::Init | PropKind::Method) {
            let literal = self.bound(file).prop_owner[p.idx()];
            self.add_intra_expression_inference_site(file, literal, prop.value, ty);
        }
        ty
    }

    /// `addIntraExpressionInferenceSite`, guarded by the conditions its three callers test first.
    /// `node`, whose type is `ty`, is a member or an element of `literal`. Whether `literal` has a
    /// contextual type is not tested: without one `inferFromIntraExpressionSites` finds nothing.
    fn add_intra_expression_inference_site(
        &mut self,
        file: FileId,
        literal: ExprId,
        node: ExprId,
        ty: TypeId,
    ) {
        let check_mode = self.check_mode();
        if check_mode.contains(CheckMode::INFERENTIAL)
            && !check_mode.contains(CheckMode::SKIP_CONTEXT_SENSITIVE)
            && node.is_some()
            && self.is_context_sensitive(file, node)
            && let Some(level) = self.get_inference_context(file, literal)
            && let Some(n) = &mut self.inference_contexts[level].context
        {
            n.intra_expression_inference_sites.push((file, node, ty));
        }
    }

    /// `checkObjectLiteral` gives the property it creates for the member `p` the declarations of
    /// `p` and the type it has just computed (`links.resolvedType`). `PropSource::Literal` reads
    /// the cached type of `p`, so it represents that property only if the two types are the same.
    /// The cached type is that of the check with nothing pushed, and is not requested while
    /// something is pushed.
    /// Returned with it: `PropFlags::WRITTEN`, if it does not. An accessor is not checked
    /// (`checkNodeDeferred`): it has its declared type under any contextual type, and its return
    /// type may be circular through whatever the literal is assigned to.
    pub(super) fn source_of_literal_member(
        &mut self,
        file: FileId,
        p: PropId,
        name: Atom,
    ) -> (PropSource<'s>, PropFlags) {
        if self.is_rechecking()
            && !matches!(self.hir(file)[p].kind, PropKind::Getter | PropKind::Setter)
        {
            let ty = self.check_literal_member(file, p);
            if !self.inference_contexts.is_empty() || ty != self.type_of_literal_prop(file, p) {
                let source = Self::literal_member_of_type(file, p, name, ty, self.arena).source;
                return (source, PropFlags::WRITTEN);
            }
        }
        (PropSource::Literal(file, p), PropFlags::empty())
    }

    /// `source_of_literal_member`. `is_written`: the cached type of `p` will not be the type it has
    /// in this check, see `object_literal_in_flow_loop`.
    fn source_of_literal_member_in(
        &mut self,
        file: FileId,
        p: PropId,
        name: Atom,
        is_written: bool,
    ) -> (PropSource<'s>, PropFlags) {
        if is_written && !matches!(self.hir(file)[p].kind, PropKind::Getter | PropKind::Setter) {
            let ty = self.check_literal_member(file, p);
            let source = Self::literal_member_of_type(file, p, name, ty, self.arena).source;
            return (source, PropFlags::WRITTEN);
        }
        self.source_of_literal_member(file, p, name)
    }

    /// `checkObjectLiteral` creates a new type for the symbol of the literal every time. `kept`,
    /// whose members are those of the first check, represents it if the members are the same.
    fn recheck_object_literal(&mut self, file: FileId, e: ExprId, kept: TypeId) -> TypeId {
        let shape = self.build_object_literal_shape(file, e, false);
        let is_empty_resolved_type = shape.props.is_empty() && shape.index.is_empty();
        if is_empty_resolved_type
            || self.inference_contexts.is_empty()
                && self
                    .members(kept)
                    .is_some_and(|members| *members.shape() == shape)
        {
            return kept;
        }
        self.object_literal_with_shape(kept, shape)
    }

    /// `checkObjectLiteral` where a member has read the incomplete type of a loop
    /// (`getTypeAtFlowLoopLabel`) or `anySignature`: the properties have the types just computed.
    /// The members of `kept` are resolved when they are read, from the complete type of the loop or
    /// the resolved signature.
    fn object_literal_in_flow_loop(&mut self, file: FileId, e: ExprId, kept: TypeId) -> TypeId {
        let shape = self.build_object_literal_shape(file, e, true);
        if shape.props.is_empty() && shape.index.is_empty() {
            return kept;
        }
        self.object_literal_with_shape(kept, shape)
    }

    /// The type of another check of the literal that `kept` is the type of, with the members
    /// `shape`.
    fn object_literal_with_shape(&mut self, kept: TypeId, mut shape: Shape<'s>) -> TypeId {
        shape.literal = Literalness::Literal;
        shape.symbol_declared_at = self.symbol_declaration_of_object_type(kept);
        shape.is_js_literal = self.has_js_literal_flag(kept);
        shape.contains_widening_type = self.contains_widening_type(kept, 0);
        let ty = self.synth(shape);
        self.with_propagated_non_inferrable_flag(ty)
    }

    /// `getSpreadType(left, right, symbol, objectFlags, readonly)`: `ty`, the resulting type of the
    /// literal `e` that contains a spread, has the symbol of the literal, and
    /// `ObjectFlagsContainsWideningType` if a member in the source has it (`contains_widening_type`).
    fn with_symbol_of_literal(
        &mut self,
        file: FileId,
        e: ExprId,
        ty: TypeId,
        contains_widening_type: bool,
    ) -> TypeId {
        match self.data(ty) {
            TypeData::Union(_) => self.map_type(ty, |c, m| {
                c.with_symbol_of_literal(file, e, m, contains_widening_type)
            }),
            // A generic type is not spread: `getIntersectionType([left, right])`.
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.with_symbol_of_literal(file, e, part, contains_widening_type))
                    .collect();
                self.intersection(&parts)
            }
            TypeData::Synth(shape) if shape.literal.is_of_expression() => self.synth(Shape {
                contains_widening_type: contains_widening_type || shape.contains_widening_type,
                symbol_declared_at: Some((file, self.hir(file)[e].pos, e)),
                ..(**shape).clone_in(self.arena)
            }),
            _ => ty,
        }
    }

    /// `ObjectFlagsNonInferrableType` is one of `ObjectFlagsPropagatingFlags`: `ty`, the result of
    /// `checkObjectLiteral`, has it if the type of a property has it.
    fn with_propagated_non_inferrable_flag(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| {
            // `getSpreadType` of a generic type returns `getIntersectionType`, which propagates the flag.
            if let TypeData::Intersection(parts) = c.data(m) {
                let parts: SmallVec<[TypeId; 4]> = parts
                    .iter()
                    .map(|&part| c.with_propagated_non_inferrable_flag(part))
                    .collect();
                return c.intersection(&parts);
            }
            let TypeData::Synth(shape) = c.data(m) else {
                return m;
            };
            let is_non_inferrable = |prop: &Prop| matches!(prop.source, PropSource::Copy(ty, ..) if c.is_non_inferrable(ty, 0));
            if !shape.props.iter().any(is_non_inferrable) {
                return m;
            }
            c.synth(Shape {
                literal: Literalness::Partial,
                ..(**shape).clone_in(self.arena)
            })
        })
    }

    /// The class whose member contains the `super` at `e`, looking through arrow functions, and
    /// whether that member is static.
    fn super_container(&self, file: FileId, e: ExprId) -> Option<(ClassId, bool)> {
        let hir = self.hir(file);
        let mut container = hir.get_super_container(hir.node(e), true);
        while hir.kind(container) == Kind::ArrowFunction {
            container = hir.get_super_container(container, true);
        }
        let class = hir.class_of(hir.parent(container)).some()?;
        Some((class, hir.is_static(container)))
    }

    /// `checkSuperExpression`
    fn check_super_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        let hir = self.hir(file);
        let (sup, node) = (hir.node(e), self.place_of_expr(file, e));
        let is_call_expression = hir.kind(hir.parent(sup)) == Kind::CallExpression
            && hir.expression(hir.parent(sup)) == sup;
        let immediate_container = hir.get_super_container(sup, true);
        let mut container = immediate_container;
        while !is_call_expression && hir.kind(container) == Kind::ArrowFunction {
            container = hir.get_super_container(container, true);
        }
        let is_constructor = hir.kind(container) == Kind::Constructor;
        let class = hir.class_of(hir.parent(container)).some();
        let is_in_object_literal = hir.kind(hir.parent(container)) == Kind::ObjectLiteralExpression;
        // `isLegalUsageOfSuperExpression`
        let is_legal = if is_call_expression {
            is_constructor
        } else {
            class.is_some() || is_in_object_literal
        };
        if !is_legal {
            let is_computed_property_name = |n: Node| match n == container {
                true => ControlFlow::Break(false),
                false if hir.kind(n) == Kind::ComputedPropertyName => ControlFlow::Break(true),
                false => ControlFlow::Continue(()),
            };
            let code = if hir
                .find_ancestor_or_quit(sup, is_computed_property_name)
                .is_some()
            {
                2466
            } else if is_call_expression {
                2337
            } else {
                2660
            };
            self.error_at(node, code, &[]);
            return TypeId::ERROR;
        }
        if !is_call_expression && hir.kind(immediate_container) == Kind::Constructor {
            self.check_this_before_super(file, e, hir.function_of(container), 17011);
        }
        // "for object literal assume that type of 'super' is 'any'"
        let Some(class) = class else {
            return TypeId::ANY;
        };
        if hir[class].extends.is_none() {
            self.error_at(node, 2335, &[]);
            return TypeId::ERROR;
        }
        let sym = self.class_sym(file, class);
        let constructor = self.base_constructor_type_of_class(sym);
        // `classDeclarationExtendsNull`
        if constructor == self.null_widening() {
            return if is_call_expression {
                TypeId::ERROR
            } else {
                constructor
            };
        }
        let is_static = hir.is_static(container);
        let Some(base) = self.base_types(sym).first().copied() else {
            return TypeId::ERROR;
        };
        // `isInConstructorArgumentInitializer`
        let is_argument = |n: Node| match hir.kind(n) {
            kind if kind.is_function_like_declaration() => ControlFlow::Break(false),
            Kind::Parameter if hir.parent(n) == container => ControlFlow::Break(true),
            _ => ControlFlow::Continue(()),
        };
        if is_constructor && hir.find_ancestor_or_quit(sup, is_argument).is_some() {
            self.error_at(node, 2336, &[]);
            return TypeId::ERROR;
        }
        if is_static || is_call_expression {
            constructor
        } else {
            base
        }
    }

    /// `getTypeWithThisArgument(baseClassType, classType.thisType)`: in a member of `base` accessed
    /// through the `super` at `sup`, `this` is that of the class that contains the `super`.
    fn type_of_super_property(
        &mut self,
        file: FileId,
        sup: ExprId,
        base: TypeId,
        name: Atom,
    ) -> Option<(TypeId, Found)> {
        let base = match self.super_container(file, sup) {
            Some((class, false)) => {
                let this = self.intern(TypeData::ThisParam(self.class_sym(file, class)));
                self.type_with_this_argument(base, this)
            }
            _ => base,
        };
        self.property_type(base, name, Access::Read)
    }

    // ───────────────────────────── literals ─────────────────────────────

    /// `checkArrayLiteral`
    fn type_of_array_literal(&mut self, file: FileId, e: ExprId, items: IdList<ExprId>) -> TypeId {
        let hir = self.hir(file);
        let is_const = self.is_const_context(file, e);
        // `IsAssignmentTarget`
        let in_pattern = self.is_assignment_target(file, e);
        let context = self.apparent_type_of_contextual_type(file, e, ContextFlags::empty());
        let in_tuple_context = self.is_in_tuple_context(file, e, context);
        let is_forced = self.check_mode().contains(CheckMode::FORCE_TUPLE);
        let expects_tuple = is_const || in_pattern || in_tuple_context || is_forced;
        let exact = self.p.files.options.exact_optional_property_types;
        // `hasOmittedExpression`
        let mut has_hole = false;
        let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(items.len());
        let mut flags: SmallVec<[ElemFlags; 8]> = SmallVec::with_capacity(items.len());
        for item in hir.ids(items) {
            match hir[item].kind {
                ExprKind::Spread(inner) => {
                    let spread = self.type_of_expr(file, inner);
                    // An array-like type represents its elements, which are expanded once it is
                    // known what is built from them.
                    if self.is_array_or_tuple(spread) || self.is_array_like(spread) {
                        types.push(spread);
                        flags.push(ElemFlags::VARIADIC);
                    } else {
                        types.push(if in_pattern {
                            self.rest_element_of_target(spread)
                        } else {
                            self.iterated_type_of_spread(spread)
                        });
                        flags.push(ElemFlags::REST);
                    }
                }
                // Only under exactOptionalPropertyTypes may a hole be omitted, and then so may
                // everything that follows it.
                ExprKind::Missing if exact => {
                    has_hole = true;
                    types.push(TypeId::MISSING);
                    flags.push(ElemFlags::OPTIONAL);
                }
                ExprKind::Missing => {
                    types.push(self.undefined_widening());
                    flags.push(ElemFlags::REQUIRED);
                }
                _ => {
                    let ty = self.type_of_expr(file, item);
                    // `checkExpressionForMutableLocation`: an assertion has the asserted type.
                    // `isConstContext`: besides the const context of the array, the contextual type
                    // of the element itself decides, which only matters for a literal.
                    let ty = if is_const
                        || self.is_valid_const_assertion_argument(file, item)
                            && self.is_const_context(file, item)
                    {
                        self.regular(ty)
                    } else if matches!(hir[item].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                        ty
                    } else {
                        let expected = self.instantiated_contextual_type(file, item);
                        self.widen_literal_for_context(ty, expected)
                    };
                    if in_tuple_context {
                        self.add_intra_expression_inference_site(file, e, item, ty);
                    }
                    types.push(if has_hole {
                        self.optional_property(ty)
                    } else {
                        ty
                    });
                    flags.push(if has_hole {
                        ElemFlags::OPTIONAL
                    } else {
                        ElemFlags::REQUIRED
                    });
                }
            }
        }
        if expects_tuple {
            // Readonly, unless the contextual type is mutable.
            let list = self.array_of(TypeId::ANY);
            let is_readonly = is_const
                // `someType` tests `never` itself, which is assignable to any array type.
                && context != Some(TypeId::NEVER)
                && !context.is_some_and(|c| {
                    self.parts(c).iter().any(|&m| {
                        !self.is_any(m) && !self.is_nullish(m) && self.is_assignable(m, list)
                    })
                });
            let first_new_type_id = self.types().first_new_type_id();
            let ty = self.normalized_tuple(&types, &flags, is_readonly);
            // `createArrayLiteralType`, which an assignment target does not reach.
            if !in_pattern {
                self.types().mark_from_type_node(ty, first_new_type_id);
            }
            return ty;
        }
        // `getIndexedAccessTypeOrUndefined(e, numberType) ?? anyType`
        for (ty, flag) in types.iter_mut().zip(&flags) {
            if flag.contains(ElemFlags::VARIADIC) {
                *ty = self
                    .indexed_access_if_any(*ty, TypeId::NUMBER, false)
                    .unwrap_or(TypeId::ANY);
            }
        }
        let nothing = if self.p.files.options.strict_null_checks {
            TypeId::IMPLICIT_NEVER
        } else {
            TypeId::UNDEFINED_WIDENING
        };
        let element = if types.is_empty() {
            nothing
        } else {
            self.union_reduced(&types)
        };
        let first_new_type_id = self.types().first_new_type_id();
        let ty = self.array_of(element);
        self.types().mark_from_type_node(ty, first_new_type_id);
        ty
    }

    /// `createArrayLiteralType` sets `ObjectFlagsArrayLiteral` on a clone of the array type. Here
    /// `number[]` and the type of `[1]` are one type, so the flag is found through the expression:
    /// adds `array_literal_types_in` of `e`, which has just been checked and has the type `ty`, to
    /// the inference context that was pushed for it.
    pub(super) fn note_array_literal_types(&mut self, file: FileId, e: ExprId, ty: TypeId) {
        if !matches!(self.hir(file)[e].kind, ExprKind::Jsx(_))
            && !self.may_have_array_literal_type(file, e)
        {
            return;
        }
        let Some(InferenceContextInfo {
            context: Some(inference),
            ..
        }) = self.inference_contexts.last_mut()
        else {
            return;
        };
        let mut found = std::mem::take(&mut inference.array_literals);
        let hir = self.hir(file);
        match hir[e].kind {
            // `createJsxAttributesTypeFromAttributesProperty`
            ExprKind::Jsx(j) => {
                for p in hir[j].attrs.iter() {
                    self.array_literal_types_in(file, hir[p].value, &mut found);
                }
            }
            ExprKind::Array(items) => {
                self.array_literal_types_in_array(file, items, ty, &mut found);
            }
            _ => {
                self.array_literal_types_in(file, e, &mut found);
            }
        }
        if let Some(InferenceContextInfo {
            context: Some(inference),
            ..
        }) = self.inference_contexts.last_mut()
        {
            inference.array_literals = found;
        }
    }

    /// FOR SPEED: `false` if `array_literal_types_in` finds nothing in `e`, judging by its kind.
    #[inline]
    fn may_have_array_literal_type(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::NonNull(_)
            | ExprKind::AsConst(_)
            | ExprKind::Await(_)
            | ExprKind::Spread(_)
            | ExprKind::Satisfies { .. } => true,
            // Only a variable of `autoType`, whose values all come from assignments.
            ExprKind::Ident(_) => {
                let bound = self.bound(file);
                let symbol = bound.expr_symbol[e.idx()];
                symbol.is_some()
                    && bound.symbols[symbol.idx()]
                        .flags
                        .contains(SymFlags::ASSIGNED)
            }
            _ => false,
        }
    }

    /// The type that the check in progress has found for `e`. Nothing is checked for it.
    fn type_of_checked_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        match self.rechecked_exprs.get(&(file, e)) {
            Some(&ty) => Some(ty),
            None => self.cached_type_of_expr(file, e),
        }
    }

    /// `left || right`, `left ?? right`: unless `left` may be falsy or nullish, the type is that of
    /// `left`.
    fn may_have_type_of_right_operand(&mut self, file: FileId, op: BinOp, left: ExprId) -> bool {
        match self.type_of_checked_expr(file, left) {
            Some(left) if op == BinOp::Or => self.can_be_falsy(left),
            Some(left) => self.can_be_nullish(left),
            None => true,
        }
    }

    /// Adds to `all` the types with `ObjectFlagsArrayLiteral` that occur in the type of `e`, and
    /// returns those that the type of `e` is or has as members of a union. `e` has been checked.
    /// The flag stays with a type until `getWidenedType` creates the array type again, as for the
    /// return type of a function and an inferred type argument, so it is followed through the
    /// expressions whose type is, or is built from, the type of an operand.
    /// Not exact: where the type of `e` has an array type both with and without the flag, in
    /// different places, both count as having it.
    pub(super) fn array_literal_types_in(
        &mut self,
        file: FileId,
        e: ExprId,
        all: &mut Vec<TypeId>,
    ) -> SmallVec<[TypeId; 2]> {
        if e.is_none() {
            return SmallVec::new();
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::NonNull(operand)
            | ExprKind::AsConst(operand)
            | ExprKind::Await(operand)
            | ExprKind::Spread(operand)
            | ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::Assign {
                op: None | Some(BinOp::And),
                value: operand,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::Comma | BinOp::And,
                right: operand,
                ..
            } => self.array_literal_types_in(file, operand, all),
            ExprKind::Cond { yes, no, .. } => {
                self.array_literal_types_in_union(file, [yes, no].into_iter(), all)
            }
            ExprKind::Assign {
                op: Some(op @ (BinOp::Or | BinOp::Nullish)),
                target,
                value,
            } => {
                if !self.may_have_type_of_right_operand(file, op, target) {
                    return SmallVec::new();
                }
                self.array_literal_types_in_union(file, [target, value].into_iter(), all)
            }
            // A loop, since a chain of them nests on the left.
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                ..
            } => {
                let mut operands: SmallVec<[ExprId; 4]> = SmallVec::new();
                let mut rest = e;
                while let ExprKind::Binary {
                    op: op @ (BinOp::Or | BinOp::Nullish),
                    left,
                    right,
                } = hir[rest].kind
                {
                    if self.may_have_type_of_right_operand(file, op, left) {
                        operands.push(right);
                    }
                    rest = left;
                }
                operands.push(rest);
                self.array_literal_types_in_union(file, operands.iter().copied(), all)
            }
            // What is read is a part of the type of the object.
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                if let ExprKind::Dot { obj, name, .. } = hir[e].kind
                    && let ExprKind::Object(props) = hir[obj].kind
                    && (props.iter()).all(|p| matches!(hir[p].key, PropKey::Name(_)))
                {
                    let member = (props.iter().rev()).find(|&p| hir[p].key == PropKey::Name(name));
                    return match member {
                        Some(p) if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) => {
                            self.array_literal_types_in(file, hir[p].value, all)
                        }
                        _ => SmallVec::new(),
                    };
                }
                let mut object = e;
                while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[object].kind
                {
                    object = obj;
                }
                let from = all.len();
                self.array_literal_types_in(file, object, all);
                SmallVec::from_slice(&all[from..])
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let value = hir[p].value;
                    if matches!(
                        hir[p].kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread
                    ) && value.is_some()
                        && self.may_have_array_literal_type(file, value)
                    {
                        self.array_literal_types_in(file, value, all);
                    }
                }
                SmallVec::new()
            }
            ExprKind::Array(items) => match self.type_of_checked_expr(file, e) {
                Some(ty) => self.array_literal_types_in_array(file, items, ty, all),
                None => SmallVec::new(),
            },
            ExprKind::Ident(_) if self.may_have_array_literal_type(file, e) => {
                self.array_literal_types_in_automatic_variable(file, e, all)
            }
            _ => SmallVec::new(),
        }
    }

    /// `array_literal_types_in` for the array literal with the elements `items` and the type `ty`.
    fn array_literal_types_in_array(
        &mut self,
        file: FileId,
        items: IdList<ExprId>,
        ty: TypeId,
        all: &mut Vec<TypeId>,
    ) -> SmallVec<[TypeId; 2]> {
        let hir = self.hir(file);
        if self.is_tuple(ty) {
            for item in hir.ids(items) {
                if self.may_have_array_literal_type(file, item) {
                    self.array_literal_types_in(file, item, all);
                }
            }
        } else if self.is_array(ty) {
            self.array_literal_types_in_union(file, hir.ids(items), all);
        } else {
            // `createArrayLiteralType` returns anything but a type reference unchanged.
            return SmallVec::new();
        }
        all.push(ty);
        SmallVec::from_slice(&[ty])
    }

    /// `array_literal_types_in` for `getUnionType(.., UnionReductionSubtype)` of the types of
    /// `operands`. `...x` contributes the elements of `x`.
    fn array_literal_types_in_union(
        &mut self,
        file: FileId,
        operands: impl Iterator<Item = ExprId> + Clone,
        all: &mut Vec<TypeId>,
    ) -> SmallVec<[TypeId; 2]> {
        let hir = self.hir(file);
        let from = all.len();
        // The operands that contribute such a type, in order, and what each contributes.
        let mut contributions: SmallVec<[(ExprId, SmallVec<[TypeId; 2]>); 2]> = SmallVec::new();
        for operand in operands.clone() {
            if !self.may_have_array_literal_type(file, operand) {
                continue;
            }
            let before = all.len();
            let mut found = self.array_literal_types_in(file, operand, all);
            if matches!(hir[operand].kind, ExprKind::Spread(_)) {
                let whole = std::mem::take(&mut found);
                found.extend(
                    all[before..]
                        .iter()
                        .copied()
                        .filter(|ty| !whole.contains(ty)),
                );
            }
            if !found.is_empty() {
                contributions.push((operand, found));
            }
        }
        let mut united = distinct_contributions(&contributions);
        if united.is_empty() {
            return united;
        }
        // `removeSubtypes`: of two types that are subtypes of each other the one with the higher id
        // is removed, which is the clone. So the flag is lost if another operand has the array type
        // without it.
        let found = united.clone();
        let mut next = 0;
        for operand in operands {
            let own = match contributions.get(next) {
                Some(it) if it.0 == operand => {
                    next += 1;
                    &it.1[..]
                }
                _ => &[][..],
            };
            let members: SmallVec<[TypeId; 4]> = match hir[operand].kind {
                ExprKind::Spread(spread) => match self.type_of_checked_expr(file, spread) {
                    Some(list) if self.is_array_or_tuple(list) => {
                        (self.type_arguments(list).iter())
                            .flat_map(|&element| self.parts(element).iter().copied())
                            .collect()
                    }
                    _ => SmallVec::new(),
                },
                _ => match self.type_of_checked_expr(file, operand) {
                    Some(ty) => SmallVec::from_slice(self.parts(ty)),
                    None => SmallVec::new(),
                },
            };
            united.retain(|ty| own.contains(ty) || !members.contains(ty));
        }
        if united.len() != found.len() {
            let mut index = 0;
            all.retain(|ty| {
                index += 1;
                index <= from || united.contains(ty) || !found.contains(ty)
            });
        }
        united
    }

    /// `inTupleContext` for the array literal `e`, whose contextual type is `context`.
    pub(super) fn is_in_tuple_context(
        &mut self,
        file: FileId,
        e: ExprId,
        context: Option<TypeId>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `isSpreadIntoCallOrNew`
        if let Parent::Expr(spread) = bound.expr_parent[e.idx()]
            && matches!(hir[spread].kind, ExprKind::Spread(_))
            && let Parent::Expr(call) = bound.expr_parent[spread.idx()]
            && matches!(
                hir[call].kind,
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::ImportCall { .. }
            )
        {
            return true;
        }
        let Some(context) = context else { return false };
        // `getApparentTypeOfContextualType` maps the members without union reduction, so `unknown` or `any` does not absorb a tuple
        // next to it, and `someType` tests every mapped member. A type parameter maps to its constraint, a mapped type to itself.
        self.parts(context).iter().any(|&member| {
            let apparent = if self.is_deferred(member) {
                self.base_constraint(member)
            } else {
                member
            };
            self.parts(apparent)
                .iter()
                .any(|&m| self.is_homomorphic_generic_mapped(m) || self.is_tuple_like(m))
        })
    }

    /// `isGenericMappedType(t) && t.nameType == nil && getHomomorphicTypeVariable(t.target ?? t) !=
    /// nil`: `{ [P in keyof T]: X }` that is generic in `T` and has no name type, which maps a
    /// tuple to a tuple.
    fn is_homomorphic_generic_mapped(&mut self, ty: TypeId) -> bool {
        let TypeData::Anon {
            origin: Origin::Mapped(file, node),
            ..
        } = *self.data(ty)
        else {
            return false;
        };
        self.mapped_decl(file, node).name_ty.is_none()
            && self.is_generic(ty)
            && self
                .homomorphic_type_variable(file, node, MapperId::IDENTITY)
                .is_some()
    }

    /// The element type of `...c` in the target of a destructuring assignment, where `c` has type
    /// `target`, which is not array-like (`checkArrayLiteral`): its number index type, else its
    /// iterated type, else `unknown`. Having neither is not an error here.
    fn rest_element_of_target(&mut self, target: TypeId) -> TypeId {
        if let Some(element) = self.index_type_of_type(target, TypeId::NUMBER) {
            return element;
        }
        self.iterated_type_if_any(target, false)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// `isJSLiteralType`
    pub(super) fn is_js_literal_type(&mut self, ty: TypeId) -> bool {
        // The flag has no effect under noImplicitAny.
        if self.p.files.options.no_implicit_any {
            return false;
        }
        match self.data(ty) {
            TypeData::Union(members) => members
                .iter()
                .all(|&member| self.is_js_literal_type(member)),
            TypeData::Intersection(members) => members
                .iter()
                .any(|&member| self.is_js_literal_type(member)),
            _ if self.is_deferred(ty) => {
                let constraint = self.base_constraint(ty);
                constraint != ty && self.is_js_literal_type(constraint)
            }
            _ => self.has_js_literal_flag(ty),
        }
    }

    /// `t.objectFlags&ObjectFlagsJSLiteral != 0`
    pub(super) fn has_js_literal_flag(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(_, _, is_js_literal, ..)
                    | Origin::WidenedLiteral(_, _, is_js_literal, ..),
                ..
            } => is_js_literal,
            TypeData::Synth(ref shape) => shape.is_js_literal,
            _ => false,
        }
    }

    /// `checkObjectLiteral`: whether the type of `literal` gets `ObjectFlagsJSLiteral`. It is in a JavaScript file and has no contextual
    /// type, or is empty and has expando members. A literal with a spread never has it.
    pub(super) fn is_js_literal(&mut self, file: FileId, literal: ExprId) -> bool {
        // `isJSLiteralType`, `hasExcessProperties`: nothing reads the flag under noImplicitAny.
        if self.p.files.options.no_implicit_any {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js {
            return false;
        }
        let symbol = bound.expr_symbol[literal.idx()];
        if symbol.is_some() && !bound.table(bound.symbols[symbol.idx()].exports).is_empty() {
            return true;
        }
        let Some((call, argument)) = self.enclosing_call_argument(file, literal) else {
            return self
                .contextual_type(file, literal, ContextFlags::empty())
                .is_none();
        };
        // `getContextualTypeForArgumentAtIndex`: an argument always has a contextual type, `any` if the signature has no parameter for it.
        if argument == literal {
            return false;
        }
        // `getContextuallyTypedParameterType`: a parameter of an immediately invoked function expression gets the type of its
        // argument as checked under `anySignature`, so the contextual type of that argument is `any`.
        let is_iife = matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Fn(_)));
        if is_iife {
            self.iife_resolving.push((file, call));
        }
        let context = self.contextual_type(file, literal, ContextFlags::empty());
        if is_iife {
            self.iife_resolving.pop();
        }
        context.is_none()
    }

    /// The nearest call, `new` or tagged template that has `e` inside one of its arguments with only expressions in between, and
    /// that argument.
    fn enclosing_call_argument(&self, file: FileId, e: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut child = e;
        loop {
            let parent = match bound.expr_parent[child.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Prop(prop) => bound.prop_owner[prop.idx()],
                _ => return None,
            };
            if let ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) =
                hir[parent].kind
            {
                return (hir[call].callee != child).then_some((parent, child));
            }
            child = parent;
        }
    }

    /// `checkObjectLiteral`
    fn type_of_object_literal(&mut self, file: FileId, e: ExprId, props: Span<PropId>) -> TypeId {
        let hir = self.hir(file);
        if !self.is_rechecking() {
            self.check_grammar_object_literal_expression(file, e, props);
        }
        // `checkObjectLiteral` begins with `getApparentTypeOfContextualType`. Here the shape asks for
        // it when it is built, which is too late for what the target of the assignment reports.
        if self.pattern_that_may_expect(file, e) == Some(PatternKind::Assignment) {
            self.apparent_type_of_contextual_type(file, e, ContextFlags::empty());
        }
        let (taints, any_signature_reads) = (self.taints, self.any_signature_reads);
        let object_flags = self.look_at_members(file, e, props);
        // `recheck_in_flow_loop` taints the frame before anything is read.
        let is_in_flow_loop = self.taints != taints
            && (self.frames.last()).is_some_and(|frame| frame.incomplete_flow);
        // Or a member is `any` under `anySignature`. A type resolution stores this type.
        let is_written = is_in_flow_loop || self.any_signature_reads != any_signature_reads;
        self.check_spread_overrides(file, props);
        if !props.iter().any(|p| hir[p].kind == PropKind::Spread) {
            let scope = self.enclosing_scope_of_expr(file, e);
            let mapper = self.identity_mapper_with_adopted(file, scope);
            let is_js_literal = self.is_js_literal(file, e);
            let kept = self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, is_js_literal, false, object_flags, true),
                mapper,
            });
            return if self.is_rechecking() {
                self.recheck_object_literal(file, e, kept)
            } else if is_written {
                self.object_literal_in_flow_loop(file, e, kept)
            } else {
                kept
            };
        }
        // With spreads, its members depend on the spread types, so they are resolved eagerly.
        let scope = self.enclosing_scope_of_expr(file, e);
        let literal_mapper = self.identity_mapper_with_adopted(file, scope);
        let is_const = self.is_const_context(file, e);
        let mut result = TypeId::EMPTY_OBJECT;
        let mut pending = Shape::new_in(self.arena);
        // Start of the members that follow the last spread.
        let mut run = props.start;
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                if let Some(segment) = self.create_object_literal_segment(
                    file,
                    props,
                    Span::new(run, p.0 - run),
                    &mut pending,
                    is_const,
                ) {
                    result = self.spread_in_literal(result, segment, is_const);
                }
                run = p.0 + 1;
                let spread = self.type_of_expr(file, prop.value);
                let spread = self.reduced(spread);
                // 2698 and `spread = c.errorType`. `check_spread` reports it, but not for a target.
                if !self.is_valid_spread_type(spread) {
                    if self.is_definite_assignment_target(file, e)
                        && self.is_target_of_assignment_in_progress(file, e)
                    {
                        self.error(file, p, 2698, &[]);
                    }
                    result = TypeId::ERROR;
                    continue;
                }
                let spread = self.try_merge_union_of_object_type_and_empty_object(spread);
                // `checkSpreadPropOverrides`: `getPropertiesOfType` creates the properties of a union,
                // which resolves the type that each member has for them. `check_spread_overrides`
                // reports 2783.
                if self.p.files.options.strict_null_checks {
                    self.reduced_apparent_type_as_object(spread);
                }
                if self.is_error_type(result) {
                    continue;
                }
                result = self.spread_in_literal(result, spread, is_const);
                if result == TypeId::UNRESOLVED {
                    return result;
                }
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            // A getter and a setter form one property, wherever they are in the literal, and the
            // getter determines its type.
            // `getSpreadSymbol`: whether an accessor is writable is not copied, that it is
            // write-only is.
            let (source, flags) = match prop.kind {
                PropKind::Getter => (p, PropFlags::empty()),
                PropKind::Setter => {
                    match self.accessor_of_literal(file, props, p, name, PropKind::Getter) {
                        Some(getter) => (getter, PropFlags::empty()),
                        None => (p, PropFlags::WRITE_ONLY),
                    }
                }
                _ if is_const => (p, PropFlags::READONLY),
                _ => (p, PropFlags::empty()),
            };
            let flags = if self.is_optional_method(file, p) {
                flags | PropFlags::OPTIONAL
            } else {
                flags
            };
            let flags = if prop.kind == PropKind::Method {
                flags | PropFlags::METHOD
            } else {
                flags
            };
            pending.props.retain(|x| x.name != name);
            let (source, written) =
                self.source_of_literal_member_in(file, source, name, is_written);
            pending.props.push(Prop {
                name,
                flags: flags | written,
                source,
                mapper: literal_mapper,
            });
        }
        // The members after the last spread are not added to an error type.
        if self.is_error_type(result) {
            return TypeId::ERROR;
        }
        if let Some(segment) = self.create_object_literal_segment(
            file,
            props,
            Span::new(run, props.start + props.len - run),
            &mut pending,
            is_const,
        ) {
            result = self.spread_in_literal(result, segment, is_const);
        }
        let contains_widening_type = object_flags.contains(ObjectFlags::CONTAINS_WIDENING_TYPE);
        result = self.with_symbol_of_literal(file, e, result, contains_widening_type);
        self.with_propagated_non_inferrable_flag(result)
    }

    /// The member loop of `checkObjectLiteral`: checks every computed name, then every value, so that a cycle through a member is
    /// found while the literal is checked. Accessors are deferred (`checkNodeDeferred`). A spread expression is checked where it
    /// is spread. The members of the literal's type are resolved lazily, by `type_of_literal_prop`, so the type is cacheable even
    /// if a member type is not. Returns `objectFlags`: `t.objectFlags & ObjectFlagsPropagatingFlags` of the member types.
    fn look_at_members(
        &mut self,
        file: FileId,
        literal: ExprId,
        props: Span<PropId>,
    ) -> ObjectFlags {
        let hir = self.hir(file);
        // Outside a re-check `autoType` is the only non-inferrable type of a member: the declared type of an assignment target.
        let in_destructuring_pattern = self.is_definite_assignment_target(file, literal);
        let mut object_flags = ObjectFlags::empty();
        for p in props.iter() {
            if let PropKey::Computed(key) = hir[p].key {
                self.type_of_expr(file, key);
            }
        }
        for p in props.iter() {
            let prop = &hir[p];
            if prop.value.is_none() || prop.kind == PropKind::Spread {
                continue;
            }
            if matches!(hir[prop.value].kind, ExprKind::Fn(_)) {
                self.check_node_deferred(file, prop.value);
            }
            if matches!(prop.kind, PropKind::Getter | PropKind::Setter) {
                continue;
            }
            let ty = self.check_literal_member(file, p);
            if self.contains_widening_type(ty, 0) {
                object_flags |= ObjectFlags::CONTAINS_WIDENING_TYPE;
            }
            if in_destructuring_pattern && self.is_non_inferrable(ty, 0) {
                object_flags |= ObjectFlags::NON_INFERRABLE_TYPE;
            }
        }
        object_flags
    }

    /// `checkFunctionExpressionOrObjectLiteralMethod`
    fn check_function_expression_or_object_literal_method(
        &mut self,
        file: FileId,
        e: ExprId,
        func: FnId,
    ) -> TypeId {
        let check_mode = self.check_mode();
        if check_mode.contains(CheckMode::SKIP_CONTEXT_SENSITIVE)
            && self.is_context_sensitive(file, e)
        {
            if self.is_return_only_function(file, func)
                && let Some(contextual_signature) = self.contextual_signature(file, func)
                && let returned = self.sig_return(contextual_signature)
                && self.has_type_variables(returned)
            {
                if let Some(cached) = (self.p.context_free_types).get(&self.task, &(file, func)) {
                    return cached;
                }
                let ret = self.return_type_of_fn_uncached(file, func, check_mode);
                let return_only_signature = self.types().intern_sig(SigData::Synth {
                    type_params: ArenaBox::empty(),
                    params: ArenaBox::empty(),
                    ret,
                    this: None,
                    of: ArenaBox::empty(),
                    is_union: true,
                });
                let return_only_type = self.synth(Shape {
                    call: vec_from_iter_in([return_only_signature], self.arena),
                    literal: Literalness::Partial,
                    ..Shape::new_in(self.arena)
                });
                // A result that depends on a circular query is provisional.
                if self.is_innermost_tainted() {
                    return return_only_type;
                }
                let stored = Stored::new();
                (self.p.context_free_types).insert(
                    &self.task,
                    (file, func),
                    return_only_type,
                    stored,
                );
                return return_only_type;
            }
            return self.any_function_type();
        }
        self.contextually_check_function_expression_or_object_literal_method(
            file, e, func, check_mode,
        );
        let scope = self.bound(file).fns[func.idx()].scope;
        let parent = self.bound(file).scopes[scope.idx()].parent;
        let mapper = self.identity_mapper_with_adopted(file, parent);
        self.intern_key(TypeKey::Fns {
            decls: &[(file, func)],
            mapper,
        })
    }

    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`
    pub(super) fn contextually_check_function_expression_or_object_literal_method(
        &mut self,
        file: FileId,
        e: ExprId,
        func: FnId,
        check_mode: CheckMode,
    ) {
        if self.is_context_checked(file, e, func) {
            return;
        }
        let contextual_signature = self.contextual_signature(file, func);
        // Computing the contextual type can re-enter this function during overload resolution of the enclosing call.
        if self.is_context_checked(file, e, func) {
            return;
        }
        let hir = self.hir(file);
        let f = &hir[func];
        // `getSignaturesOfType(getTypeOfSymbol(..))` creates the signature.
        if hir.is_js {
            self.is_untyped_signature_in_js_file(file, func);
        }
        let is_inferential = check_mode.contains(CheckMode::INFERENTIAL);
        let is_context_sensitive = self.is_context_sensitive(file, e);
        let mut assigned = None;
        if let Some(contextual) = contextual_signature {
            let level = self.get_inference_context(file, e);
            if is_context_sensitive {
                let read = self.types_assigned_from_contextual_signature(file, func, contextual);
                let instantiated = level.and_then(|level| {
                    self.with_inference_context(level, |c, n| {
                        if is_inferential {
                            c.infer_from_annotated_parameters_and_return(file, func, contextual, n);
                        }
                        c.instantiate_signature_in_inference_context(
                            n,
                            contextual,
                            &read,
                            is_inferential,
                        )
                    })
                });
                assigned = Some(instantiated.unwrap_or(contextual));
            } else if is_inferential
                && f.type_params.is_empty()
                // `len(node.Parameters())` counts a declared `this` parameter.
                && self.sig_params(contextual).len()
                    > f.params.len() + usize::from(f.this_ty(hir).is_some())
                && let Some(level) = level
            {
                self.with_inference_context(level, |c, n| {
                    c.infer_from_annotated_parameters_and_return(file, func, contextual, n);
                });
            }
        }
        // tsgo sets `NodeCheckFlagsContextChecked` whatever is in progress. A call that is resolved
        // again has the callee `any` if the callee is in a cycle, while the resolution that it
        // interrupts goes on with the type it computes itself:
        // `getTypeOfVariableOrParameterOrProperty` returns `t`, not `links.resolvedType`. That one
        // finds a signature, and the parameters as `assignNonContextualParameterTypes` left them.
        let is_argument_of_untyped_call = contextual_signature.is_none()
            && self.untyped_call_resolved_again.is_some_and(|(of, call)| {
                of == file && self.bound(file).expr_parent[e.idx()] == Parent::Expr(call)
            });
        let holds = is_argument_of_untyped_call || !self.is_innermost_tainted();
        self.context_checking.push(((file, func), assigned));
        // `assignContextualParameterTypes`, `assignNonContextualParameterTypes`
        if is_context_sensitive {
            for p in f.params.iter() {
                self.assigned_parameters.push(self.stack.len());
                self.type_of_param(file, p);
                self.assigned_parameters.pop();
                // `assignContextualParameterTypes` leaves out a parameter with an annotation.
                if contextual_signature.is_none() || hir[p].ty.is_none() {
                    self.assign_binding_element_types(file, hir[p].pat);
                }
            }
        }
        if contextual_signature.is_some()
            && f.ret.is_none()
            && (self.p.fn_return_types.get(&self.task, &(file, func))).is_none()
            && self.enter(Query::ReturnAtFirstLook(file, func))
        {
            let ty = self.return_type_of_fn_uncached(file, func, check_mode);
            // `if signature.resolvedReturnType == nil`: the first value stays.
            if let Ok(stored) = self.leave(Query::ReturnAtFirstLook(file, func)) {
                (self.p.fn_return_types).insert(&self.task, (file, func), (ty, false), stored);
                self.note_result(Query::Return(file, func));
            }
        }
        // `checkSignatureDeclaration` has no check mode.
        let outer = self.suspend_recheck();
        self.look_at_signature(file, func);
        self.end_recheck(outer);
        self.context_checking.pop();
        if holds {
            (self.p.context_checked).insert(&self.task, (file, func), assigned, Stored::new());
            self.context_checked_here.insert((file, func));
        } else if let Some(at) = self.frames.iter().position(|frame| frame.tainted) {
            let under = (at, self.frames[at].serial, (file, func), assigned);
            self.context_checked_under.push(under);
        }
    }

    /// `assignBindingElementTypes`
    fn assign_binding_element_types(&mut self, file: FileId, pattern: PatId) {
        let hir = self.hir(file);
        match hir[pattern].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    self.assign_binding_element_type(file, hir[p].value);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.assign_binding_element_type(file, hir[e].pat);
                }
            }
            _ => {}
        }
    }

    fn assign_binding_element_type(&mut self, file: FileId, element: PatId) {
        // A hole in an array pattern.
        if element.is_none() || matches!(self.hir(file)[element].kind, PatKind::Missing) {
            return;
        }
        self.assigned_parameters.push(self.stack.len());
        self.type_of_pat(file, element);
        self.assigned_parameters.pop();
        self.assign_binding_element_types(file, element);
    }

    /// The entry of `context_checked_under` for `func`.
    fn context_checked_under_taint(&mut self, file: FileId, func: FnId) -> Option<Option<SigId>> {
        if self.context_checked_under.is_empty() {
            return None;
        }
        let frames = &self.frames;
        self.context_checked_under
            .retain(|&(at, serial, ..)| frames.get(at).is_some_and(|frame| frame.serial == serial));
        let mut under = self.context_checked_under.iter();
        under.find(|c| c.2 == (file, func)).map(|c| c.3)
    }

    /// `links.flags&NodeCheckFlagsContextChecked != 0`. The first contextual check of a function also updates the inference context of the
    /// enclosing call. Another thread's check updated that thread's context, so its entry in `Program::context_checked` counts only if no
    /// inference context of this checker covers `e`.
    fn is_context_checked(&mut self, file: FileId, e: ExprId, func: FnId) -> bool {
        // `context_checked_here` is a subset of `Program::context_checked`.
        self.context_checking.iter().any(|c| c.0 == (file, func))
            || self.context_checked_under_taint(file, func).is_some()
            || (self.p.context_checked.get(&self.task, &(file, func))).is_some()
                && (self.inference_contexts.is_empty()
                    || self.context_checked_here.contains(&(file, func))
                    || !self
                        .get_inference_context(file, e)
                        .is_some_and(|level| self.inference_contexts[level].context.is_some()))
    }

    /// `NodeCheckFlagsContextChecked`, with the signature passed to
    /// `assignContextualParameterTypes`.
    pub(super) fn context_checked(&mut self, file: FileId, func: FnId) -> Option<Option<SigId>> {
        match self
            .context_checking
            .iter()
            .rev()
            .find(|c| c.0 == (file, func))
        {
            Some(in_progress) => Some(in_progress.1),
            None => match self.context_checked_under_taint(file, func) {
                Some(assigned) => Some(assigned),
                None => self.p.context_checked.get(&self.task, &(file, func)),
            },
        }
    }

    /// The types `assignContextualParameterTypes` reads from `context` for `func`, in the same
    /// order.
    fn types_assigned_from_contextual_signature(
        &mut self,
        file: FileId,
        func: FnId,
        context: SigId,
    ) -> SmallVec<[TypeId; 8]> {
        let hir = self.hir(file);
        let mut read: SmallVec<[TypeId; 8]> = SmallVec::new();
        // `sig.typeParameters = context.typeParameters`: their constraints are instantiated with
        // the mapper as well.
        for &own in self.sig_type_params(context).iter() {
            read.extend(self.constraint_of_type_param(own));
        }
        if hir[func].this_ty(hir).is_none() {
            read.extend(self.sig_this_type(context));
        }
        let params = self.sig_params(context);
        let rest = params.last().filter(|p| p.rest);
        for (i, p) in hir[func].params.iter().enumerate() {
            if hir[p].ty.is_some() {
                continue;
            }
            if hir[p].flags.contains(Flags::REST) {
                // `getRestTypeAtPosition`
                read.extend(params.iter().skip(i).map(|p| p.ty));
            }
            // `tryGetTypeAtPosition`
            read.extend(params.get(i).or(rest).map(|p| p.ty));
        }
        read
    }

    /// `instantiateSignature(sig, n.mapper)`, or with `n.nonFixingMapper` if `may_not_fix` and
    /// `sig` ends in `...args: T`. The mapper is built for the parts of the instantiation that will
    /// be `read`.
    fn instantiate_signature_in_inference_context(
        &mut self,
        n: &mut Inference,
        sig: SigId,
        read: &[TypeId],
        may_not_fix: bool,
    ) -> SigId {
        let params = self.sig_params(sig);
        let is_fixing = !may_not_fix
            || !self
                .effective_rest_type(&params)
                .is_some_and(|rest| matches!(self.data(rest), TypeData::TypeParam(..)));
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for &ty in read {
            let mapper = if is_fixing {
                self.fixing_mapper(n, ty)
            } else {
                self.non_fixing_mapper(n, ty)
            };
            for &pair in self.types().mapping(mapper) {
                if !pairs.contains(&pair) {
                    pairs.push(pair);
                }
            }
        }
        if pairs.is_empty() {
            return sig;
        }
        let mapper = self.types().mapper(pairs);
        self.instantiate_sig(sig, mapper)
    }

    /// `checkExpressionCachedEx`
    pub(super) fn check_expression_cached_ex(
        &mut self,
        file: FileId,
        e: ExprId,
        check_mode: CheckMode,
    ) -> TypeId {
        // FOR SPEED: these only pass the mode to `getResolvedSignature`, which caches its first
        // result.
        let mut inner = e;
        while let ExprKind::Await(x) | ExprKind::NonNull(x) = self.hir(file)[inner].kind {
            inner = x;
        }
        let is_the_same_under_every_mode = matches!(
            self.hir(file)[inner].kind,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::Jsx(_)
        ) && !check_mode
            .contains(CheckMode::SKIP_GENERIC_FUNCTIONS);
        if check_mode.is_empty() || is_the_same_under_every_mode {
            let outer = self.suspend_recheck();
            let ty = self.type_of_expr(file, e);
            self.end_recheck(outer);
            return if check_mode.contains(CheckMode::INFERENTIAL) {
                self.instantiate_type_with_single_generic_call_signature(file, e, ty, check_mode)
            } else {
                ty
            };
        }
        // Results computed under one mode are not valid under another.
        let found_outside = (
            std::mem::take(&mut self.rechecked_exprs),
            std::mem::take(&mut self.rechecked_members),
        );
        let outer = self.begin_recheck();
        let ty = self.check_expression_ex(file, e, check_mode);
        self.end_recheck(outer);
        (self.rechecked_exprs, self.rechecked_members) = found_outside;
        ty
    }

    /// `checkSourceElement` of a type node in an expression, at the point where `checkExpression`
    /// gets to it: `checkAssertion`, `checkSatisfiesExpression`, `resolveCall`,
    /// `checkExpressionWithTypeArguments`, `checkSignatureDeclaration`. It asks for more than
    /// `getTypeFromTypeNode`, and what it asks for may be in resolution:
    /// `class C { x = { a: null! as { p: C["x"] } } }`. `check_expression` gets to the node again
    /// and reports.
    pub(super) fn look_at_type_node(&mut self, file: FileId, node: TypeNodeId) {
        if node.is_none() {
            return;
        }
        // FOR SPEED: `checkSourceElementWorker` has no case for these, and `checkTypeReferenceNode`
        // without type arguments asks for the type alone.
        match self.hir(file)[node].kind {
            TypeNodeKind::Ref { args, .. } if args.is_empty() => {
                self.type_from_node(file, node);
                return;
            }
            TypeNodeKind::Error
            | TypeNodeKind::Heritage(_)
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_) => return,
            _ => {}
        }
        // FOR SPEED: with nothing in resolution the walk asks for the same.
        if !self.stack.iter().any(|&q| self.is_resolution(q)) {
            return;
        }
        let reported = self.reported.len();
        self.check_type_node(file, node);
        self.reported.truncate(reported);
    }

    /// `checkSourceElements` for the type arguments of an expression. See `look_at_type_node`.
    pub(super) fn look_at_type_nodes(&mut self, file: FileId, nodes: IdList<TypeNodeId>) {
        for node in self.hir(file).ids(nodes) {
            self.look_at_type_node(file, node);
        }
    }

    /// A part of `checkExpression` that the walk or a pass over the file has here, at the point
    /// where tsgo gets to it: what `check` asks for may be in resolution. What it reports directly
    /// is dropped. The walk or the pass gets there again and reports.
    fn look_at_with(&mut self, check: impl FnOnce(&mut Self)) {
        // FOR SPEED: with nothing in resolution they ask for the same.
        if self.stack.iter().any(|&q| self.is_resolution(q)) {
            let reported = self.reported.len();
            check(self);
            self.reported.truncate(reported);
        }
    }

    /// `checkBinaryLikeExpression` for `e`, `target = ..`: `checkDestructuringAssignment` or
    /// `checkAssignmentOperator`. The comparison asks for the types of properties:
    /// `declare let t: { p: typeof a }; const a = (t = { p: 1 });`.
    fn look_at_assignment(&mut self, file: FileId, e: ExprId, target: ExprId, source: TypeId) {
        let hir = self.hir(file);
        if target.is_none() {
            return;
        }
        self.look_at_with(|c| {
            if !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                || is_parenthesized(hir, target)
            {
                c.check_assignments_among(file, &[e], Some(source));
            } else if !c.is_definite_assignment_target(file, e) {
                c.check_destructuring_assignment(file, target, source);
            }
        });
    }

    /// `checkSignatureDeclaration`: the declared signature of a function expression is checked with
    /// the function, its body later. See `check_signature_declaration`, which reports.
    fn look_at_signature(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        let f = &hir[func];
        // `checkTypeParameter`
        for tp in f.type_params.iter() {
            self.look_at_type_node(file, hir[tp].constraint);
            self.look_at_type_node(file, hir[tp].default);
            let ty = self.type_param(file, tp);
            self.base_constraint(ty);
            self.type_from_node(file, hir[tp].default);
        }
        self.look_at_type_node(file, f.this_ty(hir));
        self.type_from_node(file, f.this_ty(hir));
        // `checkParameter`, `checkVariableLikeDeclaration`. The annotation is checked before the
        // parameter is in resolution.
        for p in f.params.iter() {
            let param = &hir[p];
            self.look_at_type_node(file, param.ty);
            let is_name = matches!(hir[param.pat].kind, PatKind::Ident(_));
            if is_name {
                // `assignParameterType` has given one without an annotation its type.
                if param.ty.is_some() {
                    self.type_of_param(file, p);
                }
            } else {
                self.look_at_binding_name(file, param.pat);
                self.type_of_param(file, p);
            }
            if param.default.is_some() {
                self.look_at_initializer(file, param.default);
                self.look_at_with(|c| c.check_parameter_initializer(file, p));
            }
            if is_name && param.flags.contains(Flags::REST) {
                self.look_at_with(|c| c.check_rest_parameter_type(file, func, p));
            }
        }
        // `checkSourceElement(returnTypeNode)` does not ask for the type of every kind of node:
        // `(): keyof T => ..`.
        self.look_at_type_node(file, f.ret);
        self.look_at_with(|c| {
            c.check_generator_return_type(file, func);
            c.check_async_function_return_type(file, func);
            c.check_generator_return_annotation(file, func);
        });
    }

    /// `checkVariableLikeDeclaration`, the part for `node.Name()`. See `check_binding_name`, which
    /// reports.
    fn look_at_binding_name(&mut self, file: FileId, pat: PatId) {
        if pat.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                self.type_of_pat(file, pat);
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.look_at(file, key);
                    }
                    self.look_at_binding_element(file, pat, hir[p].value, hir[p].default);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.look_at_binding_element(file, pat, hir[e].pat, hir[e].default);
                }
            }
        }
    }

    /// `checkBindingElement` for the element `name` of `pattern`.
    fn look_at_binding_element(
        &mut self,
        file: FileId,
        pattern: PatId,
        name: PatId,
        initializer: ExprId,
    ) {
        // A hole in an array pattern.
        if name.is_none() {
            return;
        }
        self.look_at_with(|c| c.check_binding_element_accessibility(file, pattern, name));
        self.look_at_binding_name(file, name);
        if initializer.is_some() {
            self.look_at_initializer(file, initializer);
            self.look_at_with(|c| c.check_binding_element_initializer(file, name, initializer));
        }
    }

    /// `checkExpressionCached(initializer)` in `checkVariableLikeDeclaration`, which has no
    /// `getQuickTypeOfExpression`.
    fn look_at_initializer(&mut self, file: FileId, initializer: ExprId) {
        if let ExprKind::As { expr, ty } = self.hir(file)[initializer].kind {
            self.look_at(file, expr);
            self.look_at_type_node(file, ty);
        }
        self.look_at(file, initializer);
    }

    /// `createObjectLiteralType` for the members `run` of the object literal `props`, which are
    /// consecutive between two spreads. `named` holds those with a statically known name, and is
    /// left empty. `None`: there are no members there.
    fn create_object_literal_segment(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        run: Span<PropId>,
        named: &mut Shape<'s>,
        readonly: bool,
    ) -> Option<TypeId> {
        if run.is_empty() {
            return None;
        }
        named.index = self.index_infos_of_object_literal(file, props, run, readonly);
        named.literal = Literalness::Written;
        Some(self.synth(std::mem::replace(named, Shape::new_in(self.arena))))
    }

    /// `getSpreadType`, which in a const context (`readonly`) produces a readonly result.
    fn spread_in_literal(&mut self, left: TypeId, right: TypeId, readonly: bool) -> TypeId {
        let spread = self.get_spread_type(left, right, readonly);
        if !readonly {
            return spread;
        }
        self.map_type(spread, |c, m| {
            let TypeData::Synth(shape) = c.data(m) else {
                return m;
            };
            if shape.literal != Literalness::WithSpread {
                return m;
            }
            let mut shape = (**shape).clone_in(self.arena);
            for prop in &mut shape.props {
                // A property of the left that the right may or may not override is recreated
                // without readonly information.
                let is_of_both = c.parts(right).iter().any(|&r| {
                    c.prop_ref(r, prop.name)
                        .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
                }) && c
                    .parts(left)
                    .iter()
                    .any(|&l| c.prop_ref(l, prop.name).is_some());
                if !is_of_both {
                    prop.flags |= PropFlags::READONLY;
                }
            }
            for info in &mut shape.index {
                info.readonly = true;
            }
            c.synth(shape)
        })
    }

    /// The accessor of kind `kind` named `name` among `props`.
    fn accessor_of_literal(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        p: PropId,
        name: Atom,
        kind: PropKind,
    ) -> Option<PropId> {
        let hir = self.hir(file);
        if matches!(hir[p].key, PropKey::Name(_)) {
            return self
                .bound(file)
                .declarations_of_literal_member(p)
                .into_iter()
                .find(|&q| hir[q].kind == kind);
        }
        props
            .iter()
            .find(|&q| hir[q].kind == kind && self.member_name(file, hir[q].key) == Some(name))
    }

    /// `getOptionalSymbolFlagForNode`: whether `p` is a method of an object literal declared as
    /// `name?() {}` (1162).
    pub(super) fn is_optional_method(&self, file: FileId, p: PropId) -> bool {
        let hir = self.hir(file);
        let prop = &hir[p];
        if prop.kind != PropKind::Method || prop.value.is_none() {
            return false;
        }
        let ExprKind::Fn(func) = hir[prop.value].kind else {
            return false;
        };
        let func = &hir[func];
        // The `?` is the token before the `<` of the type parameters, or before the `(` of the parameters.
        let before_signature = match func.type_params.iter().next() {
            Some(first) => {
                let Some(before_name) = hir.text.get(..hir[first].pos as usize) else {
                    return false;
                };
                let mut before = trim_trivia_end(before_name);
                // The modifiers of the first type parameter.
                while !before.ends_with(b"<") {
                    let word = before
                        .iter()
                        .rev()
                        .take_while(|c| c.is_ascii_alphabetic())
                        .count();
                    if word == 0 {
                        return false;
                    }
                    before = trim_trivia_end(&before[..before.len() - word]);
                }
                &before[..before.len() - 1]
            }
            None => match hir.text.get(..func.anchor as usize) {
                Some(before) => before,
                None => return false,
            },
        };
        trim_trivia_end(before_signature).ends_with(b"?")
    }

    /// `getObjectLiteralIndexInfo`, for each of string, number and symbol that is the type of a
    /// computed name among the members `run` of the object literal `props` (`checkObjectLiteral`):
    /// the value type covers every member of `run` with a name of that kind.
    fn index_infos_of_object_literal(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        run: Span<PropId>,
        readonly: bool,
    ) -> ArenaVec<'s, IndexInfo> {
        let hir = self.hir(file);
        // Strings, numbers, symbols.
        let mut expected = [false; 3];
        for p in run.iter() {
            let PropKey::Computed(k) = hir[p].key else {
                continue;
            };
            if self.member_name(file, hir[p].key).is_some() {
                continue;
            }
            let key = self.type_of_expr(file, k);
            if self.is_assignable(key, TypeId::NUMBER) {
                expected[1] = true;
            } else if self.is_assignable(key, TypeId::SYMBOL) {
                expected[2] = true;
            } else {
                // A key of any other type is an error and contributes nothing.
                let any_key = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                expected[0] |= self.is_assignable(key, any_key);
            }
        }
        if !expected.contains(&true) {
            return ArenaVec::new_in(self.arena);
        }
        // The type of each member, `isSymbolWithSymbolName`, `isSymbolWithNumericName`, and
        // `prop.Declarations[0]` if `isSymbolWithComputedName`.
        let mut held: Vec<(TypeId, bool, bool, Option<PropId>)> = Vec::with_capacity(run.len());
        for p in run.iter() {
            let prop = &hir[p];
            let mut source = p;
            let (is_symbol, is_numeric) = match self.member_name(file, prop.key) {
                Some(name) => {
                    // A getter and a setter form one property, and the getter determines its type.
                    if prop.kind == PropKind::Setter
                        && let Some(getter) =
                            self.accessor_of_literal(file, props, p, name, PropKind::Getter)
                    {
                        source = getter;
                    }
                    (
                        self.atoms().is_symbol_name(name),
                        self.is_numeric_name(name),
                    )
                }
                None => {
                    let PropKey::Computed(k) = prop.key else {
                        continue;
                    };
                    let key = self.type_of_expr(file, k);
                    (
                        self.is_assignable(key, TypeId::SYMBOL),
                        self.is_assignable(key, TypeId::NUMBER),
                    )
                }
            };
            let first = self.bound(file).declarations_of_literal_member(p)[0];
            let has_computed_name = matches!(hir[first].key, PropKey::Computed(_))
                || hir.text.get(hir[first].pos as usize) == Some(&b'[');
            held.push((
                self.check_literal_member(file, source),
                is_symbol,
                is_numeric,
                has_computed_name.then_some(first),
            ));
        }
        let mut infos = ArenaVec::new_in(self.arena);
        for (i, key) in [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]
            .into_iter()
            .enumerate()
        {
            if !expected[i] {
                continue;
            }
            let counts = |h: &&(TypeId, bool, bool, Option<PropId>)| match i {
                0 => !h.1,
                1 => h.2,
                _ => h.1,
            };
            let values: Vec<TypeId> = held.iter().filter(counts).map(|h| h.0).collect();
            let components: Vec<IndexComponent> = held
                .iter()
                .filter(counts)
                .filter_map(|h| h.3)
                .map(|p| IndexComponent::Property(file, p))
                .collect();
            let value = if values.is_empty() {
                TypeId::UNDEFINED
            } else {
                self.union_reduced(&values)
            };
            infos.push(IndexInfo {
                key,
                value,
                readonly,
                declaration: None,
                components: self.types().intern_components(&components),
            });
        }
        infos
    }

    /// `is_written`: see `source_of_literal_member_in`.
    pub(super) fn build_object_literal_shape(
        &mut self,
        file: FileId,
        e: ExprId,
        is_written: bool,
    ) -> Shape<'s> {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[e].kind else {
            return Shape::new_in(self.arena);
        };
        let is_const = self.is_const_context(file, e);
        let in_pattern = self.is_definite_assignment_target(file, e);
        // `patternForType`: the type a pattern without computed names implies for the literal.
        let implied = if self.pattern_that_may_expect(file, e).is_some() {
            self.apparent_type_of_contextual_type(file, e, ContextFlags::empty())
                .filter(|&context| self.pattern_of_type(context) == Some(false))
        } else {
            None
        };
        let mut shape = Shape::new_in(self.arena);
        shape.props.reserve_exact(props.len());
        // The names of `shape.props`, of a literal with many members.
        let has_many = props.len() > 16;
        let mut names = crate::util::FxHashSet::<Atom>::default();
        if has_many {
            names.reserve(props.len());
        }
        let mut has_repeated_name = false;
        for p in props.iter() {
            let prop = &hir[p];
            // A name that is only known at run time creates no property.
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let mut flags = PropFlags::empty();
            match prop.kind {
                PropKind::Getter => {
                    flags |= PropFlags::ACCESSOR;
                    // `isReadonlySymbol`: an accessor without a setter.
                    if self
                        .accessor_of_literal(file, props, p, name, PropKind::Setter)
                        .is_none()
                    {
                        flags |= PropFlags::READONLY;
                    }
                }
                PropKind::Setter => {
                    flags |= PropFlags::ACCESSOR;
                    // `getSpreadSymbol`: an accessor without a getter, whose copy has type
                    // `undefined`.
                    if self
                        .accessor_of_literal(file, props, p, name, PropKind::Getter)
                        .is_none()
                    {
                        flags |= PropFlags::WRITE_ONLY;
                    }
                }
                kind => {
                    if kind == PropKind::Method {
                        flags |= PropFlags::METHOD;
                        if self.is_optional_method(file, p) {
                            flags |= PropFlags::OPTIONAL;
                        }
                    }
                    // `checkObjectLiteral`: accessors have their declared type in any context.
                    if is_const {
                        flags |= PropFlags::READONLY;
                    }
                    // `hasDefaultValue`: a property with a default in an assignment pattern is
                    // optional. So is a property for which the pattern the literal is assigned to
                    // has a default.
                    let has_default = in_pattern
                        && prop.value.is_some()
                        && matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
                        && !is_parenthesized(hir, prop.value);
                    if has_default
                        || implied.is_some_and(|implied| {
                            self.prop_ref(implied, name)
                                .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
                        })
                    {
                        flags |= PropFlags::OPTIONAL;
                    }
                }
            }
            let mut source = p;
            let may_exist = !has_many || !names.insert(name);
            if may_exist && let Some(existing) = shape.props.iter().position(|x| x.name == name) {
                if prop.kind == PropKind::Setter {
                    // A getter and a setter: the getter determines the type.
                    if !shape.props[existing].flags.contains(PropFlags::METHOD) {
                        continue;
                    }
                    // `declareSymbolEx` rejects a method next to an accessor: the last member with
                    // the name is the property.
                    if let Some(getter) =
                        self.accessor_of_literal(file, props, p, name, PropKind::Getter)
                    {
                        source = getter;
                    }
                }
                shape.props.remove(existing);
                has_repeated_name = true;
            }
            let (source, written) =
                self.source_of_literal_member_in(file, source, name, is_written);
            shape.props.push(Prop {
                name,
                flags: flags | written,
                source,
                mapper: MapperId::IDENTITY,
            });
        }
        // The binder adds a declaration to the symbol of that name where it can.
        if has_repeated_name {
            self.get_named_members(&mut shape.props, |_| true, &[]);
        }
        shape.index = self.index_infos_of_object_literal(file, props, props, is_const);
        // "Expando object literals have empty properties but filled exports"
        let owner = self.bound(file).expr_symbol[e.idx()];
        self.with_expandos(shape, file, owner)
    }

    /// The kind of pattern whose implied type can be the contextual type of the object literal
    /// `e`: `e` is the initializer of a pattern without a type annotation, or a default in one, or
    /// part of such an expression. In no other case does the contextual type have to be requested.
    fn pattern_that_may_expect(&self, file: FileId, e: ExprId) -> Option<PatternKind> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let binding = |pat: PatId| {
            matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_))
                .then_some(PatternKind::Binding)
        };
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::VarInit(d) if hir[d].ty.is_none() => return binding(hir[d].pat),
                Parent::ParamDefault(p) if hir[p].ty.is_none() => return binding(hir[p].pat),
                Parent::PatPropDefault(p) => return binding(hir[p].value),
                Parent::PatElemDefault(p) => return binding(hir[p].pat),
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return None;
                    }
                    owner
                }
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    } if value == at => {
                        return (target.is_some()
                            && matches!(
                                hir[target].kind,
                                ExprKind::Object(_) | ExprKind::Array(_)
                            ))
                        .then_some(PatternKind::Assignment);
                    }
                    ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { .. } => parent,
                    _ => return None,
                },
                _ => return None,
            };
        }
    }

    /// Whether `e`, which is part of an assignment target, belongs to an assignment that is being
    /// checked. tsgo checks a target pattern as an expression only in
    /// `getContextualTypeForAssignmentExpression`, so only if the assigned value asks for its
    /// contextual type. `check_expression` does it for every target, after the assignment.
    fn is_target_of_assignment_in_progress(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        while at.is_some() {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign { .. } => {
                        return self.stack.contains(&Query::Expr(file, parent));
                    }
                    _ => parent,
                },
                Parent::Prop(p) => bound.prop_owner[p.idx()],
                _ => return false,
            };
        }
        false
    }

    /// The type of a property of an object literal, as a mutable location.
    pub(super) fn type_of_literal_prop(&mut self, file: FileId, p: PropId) -> TypeId {
        if let Some(known) = self.p.literal_prop_types.get(&self.task, &(file, p)) {
            return known;
        }
        if let Some(raw) = self.provisional(Query::LiteralProp(file, p)) {
            return TypeId(raw as u32);
        }
        if !self.flow_loops.is_empty()
            && let Some(ty) = self.recheck_literal_prop_in_flow_loop(file, p)
        {
            return ty;
        }
        if !self.enter(Query::LiteralProp(file, p)) {
            return TypeId::UNRESOLVED;
        }
        let ty = self.type_of_literal_prop_uncached(file, p);
        match self.leave(Query::LiteralProp(file, p)) {
            // Of two nested visits of `p` the outer one assigns last, as for an expression.
            Ok(stored) => (self.p.literal_prop_types).rewrite(&self.task, (file, p), ty, stored),
            Err(open) => {
                self.cache_provisionally(Query::LiteralProp(file, p), u64::from(ty.0), open);
                ty
            }
        }
    }

    /// `checkPropertyAssignment`, `checkShorthandPropertyAssignment` and `checkObjectLiteralMethod`
    /// have no re-entrancy guard either: `recheck_in_flow_loop` for the member `p`. An accessor has
    /// one (`getTypeOfAccessors`).
    fn recheck_literal_prop_in_flow_loop(&mut self, file: FileId, p: PropId) -> Option<TypeId> {
        if matches!(self.hir(file)[p].kind, PropKind::Getter | PropKind::Setter) {
            return None;
        }
        let first = self
            .stack
            .iter()
            .rposition(|&q| q == Query::LiteralProp(file, p))?;
        let pushed_at = self.flow_loop_pushed_since(first)?;
        let resolution_start = std::mem::replace(&mut self.resolution_start, self.stack.len());
        let entered = self.enter(Query::LiteralProp(file, p));
        self.resolution_start = resolution_start;
        if !entered {
            return Some(TypeId::UNRESOLVED);
        }
        self.taint_from(pushed_at);
        let ty = self.type_of_literal_prop_uncached(file, p);
        // `object_literal_in_flow_loop` reads it again.
        if let Err(open) = self.leave(Query::LiteralProp(file, p)) {
            self.cache_provisionally(Query::LiteralProp(file, p), u64::from(ty.0), open);
        }
        Some(ty)
    }

    fn type_of_literal_prop_uncached(&mut self, file: FileId, p: PropId) -> TypeId {
        let hir = self.hir(file);
        let prop = &hir[p];
        if prop.value.is_none() {
            // `checkJsxAttribute`: `trueType` for an attribute without an initializer, regardless
            // of its contextual type.
            let owner = self.bound(file).prop_owner[p.idx()];
            return if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                TypeId::FRESH_TRUE
            } else {
                TypeId::UNRESOLVED
            };
        }
        match prop.kind {
            PropKind::Getter => {
                let ExprKind::Fn(f) = hir[prop.value].kind else {
                    return TypeId::UNRESOLVED;
                };
                // `getTypeOfAccessors`: `getReturnTypeFromBody` of whatever body there is. A block whose `{` is missing returns nothing.
                if hir[f].flags.contains(Flags::MISSING_BODY)
                    && hir[f].ret.is_none()
                    && self.annotated_setter_type(file, f).is_none()
                {
                    return TypeId::VOID;
                }
                self.return_type_of_fn(file, f)
            }
            PropKind::Setter => {
                let ExprKind::Fn(f) = hir[prop.value].kind else {
                    return TypeId::UNRESOLVED;
                };
                match hir[f].params.iter().next() {
                    Some(param) => self.type_of_param(file, param),
                    None => TypeId::ANY,
                }
            }
            // `getTypeOfFuncClassEnumModuleWorker`: `getOptionalType` of a method that is optional.
            PropKind::Method if self.is_optional_method(file, p) => {
                let ty = self.type_of_expr(file, prop.value);
                self.optional_property(ty)
            }
            // `checkExpressionForMutableLocation`
            _ => {
                // `checkObjectLiteral`: `{ a = d }` in an assignment pattern has the type of `a`.
                let checked = match hir[prop.value].kind {
                    ExprKind::Assign {
                        op: None, target, ..
                    } if prop.kind == PropKind::Shorthand
                        && self.is_definite_assignment_target(file, prop.value) =>
                    {
                        target
                    }
                    _ => prop.value,
                };
                let ty = self.type_of_expr(file, checked);
                // `checkPropertyAssignment`, `checkShorthandPropertyAssignment`: `node.Type()`
                let annotation = hir.jsdoc_type(JsDocTypeOwner::Prop(p));
                if annotation.is_some() {
                    return self.type_from_node(file, annotation);
                }
                if self.is_const_context(file, prop.value) {
                    return self.regular(ty);
                }
                // An assertion has the asserted type.
                if matches!(
                    hir[prop.value].kind,
                    ExprKind::As { .. } | ExprKind::AsConst(_)
                ) {
                    return ty;
                }
                let expected = self.instantiated_contextual_type(file, prop.value);
                self.widen_literal_for_context(ty, expected)
            }
        }
    }

    // ───────────────────────────── operators ─────────────────────────────

    fn type_of_unary(&mut self, file: FileId, e: ExprId, op: UnOp, operand: ExprId) -> TypeId {
        match op {
            UnOp::Typeof => {
                self.look_at(file, operand);
                let literals = [
                    known::string,
                    known::number,
                    known::bigint,
                    known::boolean,
                    known::symbol,
                    known::undefined,
                    known::object,
                    known::function,
                ]
                .map(|name| self.string_literal(name, false));
                self.union(&literals)
            }
            // `checkVoidExpression`: the operand is deferred.
            UnOp::Void => {
                self.check_node_deferred(file, e);
                self.undefined_widening()
            }
            UnOp::Delete => {
                self.look_at(file, operand);
                self.check_delete_expression(file, e, operand);
                TypeId::BOOLEAN
            }
            UnOp::Not => {
                let ty = self.type_of_expr(file, operand);
                if ty == TypeId::SILENT_NEVER {
                    return ty;
                }
                self.check_truthiness_of_type(file, operand, ty);
                // `getTypeFacts(operandType, TypeFactsTruthy | TypeFactsFalsy)`
                match (self.can_be_truthy(ty), self.can_be_falsy(ty)) {
                    (true, false) => TypeId::FRESH_FALSE,
                    (false, true) => TypeId::FRESH_TRUE,
                    _ => TypeId::BOOLEAN,
                }
            }
            UnOp::Minus | UnOp::Plus | UnOp::BitNot => {
                let ty = self.type_of_expr(file, operand);
                if ty == TypeId::SILENT_NEVER {
                    return ty;
                }
                let hir = self.hir(file);
                // `checkPrefixUnaryExpression`: only a literal directly after the sign produces a
                // literal type.
                let is_bare = !is_parenthesized(hir, operand);
                match hir[operand].kind {
                    ExprKind::Number(n) if is_bare && op == UnOp::Minus => {
                        self.number_literal(-hir.numbers[n as usize], true)
                    }
                    ExprKind::Number(n) if is_bare && op == UnOp::Plus => {
                        self.number_literal(hir.numbers[n as usize], true)
                    }
                    ExprKind::BigInt(text) if is_bare && op == UnOp::Minus => {
                        // `NewPseudoBigInt`: zero has no sign.
                        let digits = self.atoms().bytes(text);
                        let negative = !digits.iter().all(|&c| c == b'0' || c == b'n');
                        self.fresh_bigint_literal(text, negative)
                    }
                    _ => {
                        self.check_non_null_type(file, operand, ty);
                        let (is_symbol, is_bigint) = (Self::is_symbol_like, Self::is_bigint_like);
                        if self.maybe_type_of_kind_considering_base_constraint(ty, is_symbol) {
                            let operator = match op {
                                UnOp::Plus => "+",
                                UnOp::Minus => "-",
                                _ => "~",
                            };
                            let at = self.span_of_parenthesized_expr(file, operand);
                            self.error_at(at, 2469, &[Arg::Text(operator)]);
                        }
                        if op != UnOp::Plus {
                            return self.unary_result_type(ty);
                        }
                        if self.maybe_type_of_kind_considering_base_constraint(ty, is_bigint) {
                            let base = self.base_of_literal(ty);
                            let at = self.span_of_parenthesized_expr(file, operand);
                            self.error_at(at, 2736, &[Arg::Bytes(b"+"), Arg::Type(base)]);
                        }
                        TypeId::NUMBER
                    }
                }
            }
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                let ty = self.type_of_expr(file, operand);
                if ty == TypeId::SILENT_NEVER {
                    return ty;
                }
                let there = self.check_non_null_type(file, operand, ty);
                if self.check_arithmetic_operand_type(file, operand, there, 2356, false) {
                    self.check_reference_expression(file, operand, 2357, 2777);
                }
                self.unary_result_type(ty)
            }
        }
    }

    /// `getUnaryResultType`
    fn unary_result_type(&mut self, operand: TypeId) -> TypeId {
        if !self.maybe_type_of_kind(operand, Self::is_bigint_like) {
            return TypeId::NUMBER;
        }
        if self.maybe_type_of_kind(operand, Self::is_number_like) {
            self.union(&[TypeId::NUMBER, TypeId::BIGINT])
        } else {
            TypeId::BIGINT
        }
    }

    /// `checkBinaryLikeExpression`, which checks the left operand and then the right, regardless of
    /// the operator. `e`: `errorNode`, which is `left op right` or `left op= right`.
    fn type_of_binary(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> TypeId {
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        // `&&=`, `||=`, `??=`: whatever the result type, the right operand is assigned to the left.
        if is_assignment && matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            let (l, r) = self.check_operands(file, left, right);
            self.check_assignment_operator(file, op, left, right, l, r);
        }
        match op {
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let (l, r) = self.check_operands(file, left, right);
                if self.check_for_disallowed_es_symbol_operand(file, e, op, left, right, l, r) {
                    let l = self.check_non_null_type(file, left, l);
                    let r = self.check_non_null_type(file, right, r);
                    let (l, r) = (self.base_for_comparison(l), self.base_for_comparison(r));
                    self.report_operator_error_unless(file, e, op, l, r, can_be_ordered);
                }
                TypeId::BOOLEAN
            }
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                // `CheckModeTypeOnly`: while a loop analysis is in progress the operand types may
                // be narrower than the final ones.
                let (l, r) = self.check_operands(file, left, right);
                if self.flow_loops.is_empty() {
                    let hir = self.hir(file);
                    let is_equality = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
                    // A JavaScript file reports only `===` and `!==`.
                    if (is_literal_expression_of_object(hir, left)
                        || is_literal_expression_of_object(hir, right))
                        && (!hir.is_js || matches!(op, BinOp::EqEqEq | BinOp::NotEqEq))
                    {
                        let always = if is_equality { "false" } else { "true" };
                        self.error_at(self.place_of_expr(file, e), 2839, &[Arg::Text(always)]);
                    }
                    self.check_nan_equality(file, e, is_equality, left, right);
                    self.report_operator_error_unless(file, e, op, l, r, can_be_equal);
                }
                TypeId::BOOLEAN
            }
            // `checkInExpression`, `checkInstanceOfExpression`
            BinOp::In | BinOp::Instanceof => {
                let (l, r) = self.check_operands(file, left, right);
                if l == TypeId::SILENT_NEVER || r == TypeId::SILENT_NEVER {
                    return TypeId::SILENT_NEVER;
                }
                if op == BinOp::In {
                    self.check_in_expression(file, left, right, l, r);
                } else {
                    check_instance_of_expression(self, file, e, left, right);
                }
                TypeId::BOOLEAN
            }
            BinOp::Comma => {
                self.look_at(file, left);
                self.type_of_expr(file, right)
            }
            BinOp::And => {
                let l = self.type_of_expr(file, left);
                if !is_assignment {
                    self.check_truthiness_of_type(file, left, l);
                }
                if !self.can_be_truthy(l) {
                    self.look_at(file, right);
                    return l;
                }
                let r = self.type_of_expr(file, right);
                // Without strictNullChecks the falsy values are those of the kind of thing the right side is. Of a left side that
                // nothing is known of nothing is said.
                let of = if self.p.files.options.strict_null_checks || l == TypeId::UNRESOLVED {
                    l
                } else {
                    self.base_of_literal(r)
                };
                let falsy = self.definitely_falsy_part(of);
                self.union(&[falsy, r])
            }
            BinOp::Or => {
                let l = self.type_of_expr(file, left);
                if !is_assignment {
                    self.check_truthiness_of_type(file, left, l);
                }
                if !self.can_be_falsy(l) {
                    self.look_at(file, right);
                    return l;
                }
                let r = self.type_of_expr(file, right);
                let truthy = self.remove_definitely_falsy(l);
                let truthy = self.non_nullable(truthy);
                self.union_reduced(&[truthy, r])
            }
            BinOp::Nullish => {
                if !is_assignment {
                    self.check_nullish_coalesce_operands(file, e, left, right);
                }
                let l = self.type_of_expr(file, left);
                if !self.can_be_nullish(l) {
                    self.look_at(file, right);
                    return l;
                }
                let r = self.type_of_expr(file, right);
                let present = self.non_nullable(l);
                self.union_reduced(&[present, r])
            }
            BinOp::Add => {
                let (mut l, mut r) = (
                    self.type_of_expr(file, left),
                    self.type_of_expr(file, right),
                );
                if l == TypeId::SILENT_NEVER || r == TypeId::SILENT_NEVER {
                    return TypeId::SILENT_NEVER;
                }
                // The constraint of a type parameter is only inspected to see whether it is
                // resolved.
                let (lb, rb) = (
                    self.constraint_for_operator(l),
                    self.constraint_for_operator(r),
                );
                if lb == TypeId::UNRESOLVED || rb == TypeId::UNRESOLVED {
                    // A string plus anything yields a string. `never` also counts as a number.
                    let (known, by) = if lb == TypeId::UNRESOLVED {
                        (r, rb)
                    } else {
                        (l, lb)
                    };
                    let is_string = by != TypeId::UNRESOLVED
                        && !by.is_never()
                        && self.is_assignable_to_kind(
                            known,
                            Self::is_string_like,
                            TypeId::STRING,
                            true,
                        );
                    return if is_string {
                        TypeId::STRING
                    } else {
                        TypeId::UNRESOLVED
                    };
                }
                if !self.is_assignable_to_kind(l, Self::is_string_like, TypeId::STRING, false)
                    && !self.is_assignable_to_kind(r, Self::is_string_like, TypeId::STRING, false)
                {
                    l = self.check_non_null_type(file, left, l);
                    r = self.check_non_null_type(file, right, r);
                }
                let result =
                    if self.is_assignable_to_kind(l, Self::is_number_like, TypeId::NUMBER, true)
                        && self.is_assignable_to_kind(r, Self::is_number_like, TypeId::NUMBER, true)
                    {
                        TypeId::NUMBER
                    } else if self.is_assignable_to_kind(
                        l,
                        Self::is_bigint_like,
                        TypeId::BIGINT,
                        true,
                    ) && self.is_assignable_to_kind(
                        r,
                        Self::is_bigint_like,
                        TypeId::BIGINT,
                        true,
                    ) {
                        TypeId::BIGINT
                    } else if self.is_assignable_to_kind(
                        l,
                        Self::is_string_like,
                        TypeId::STRING,
                        true,
                    ) || self.is_assignable_to_kind(
                        r,
                        Self::is_string_like,
                        TypeId::STRING,
                        true,
                    ) {
                        TypeId::STRING
                    } else if self.is_error_type(l) || self.is_error_type(r) {
                        TypeId::ERROR
                    } else if self.is_any(l) || self.is_any(r) {
                        TypeId::ANY
                    } else {
                        self.report_operator_error(file, e, op, l, r, Some(may_be_added));
                        return TypeId::ANY;
                    };
                // Symbol operands are only checked once the two operands can be added.
                if self.check_for_disallowed_es_symbol_operand(file, e, op, left, right, l, r)
                    && is_assignment
                {
                    self.check_assignment_operator(file, op, left, right, l, result);
                }
                result
            }
            _ => {
                let (l, r) = (
                    self.type_of_expr(file, left),
                    self.type_of_expr(file, right),
                );
                if l == TypeId::SILENT_NEVER || r == TypeId::SILENT_NEVER {
                    return TypeId::SILENT_NEVER;
                }
                let l = self.check_non_null_type(file, left, l);
                let r = self.check_non_null_type(file, right, r);
                if matches!(op, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor)
                    && self.every_type(l, Self::is_boolean_like)
                    && self.every_type(r, Self::is_boolean_like)
                    && !l.is_never()
                    && !r.is_never()
                {
                    self.report_boolean_operands(file, e, op, right);
                    return TypeId::NUMBER;
                }
                let left_ok = self.check_arithmetic_operand_type(file, left, l, 2362, true);
                let right_ok = self.check_arithmetic_operand_type(file, right, r, 2363, true);
                let any_or_unknown = |c: &Self, t: TypeId| c.is_any(t) || t == TypeId::UNKNOWN;
                let result = if any_or_unknown(self, l) && any_or_unknown(self, r)
                    || !self.maybe_type_of_kind(l, Self::is_bigint_like)
                        && !self.maybe_type_of_kind(r, Self::is_bigint_like)
                {
                    TypeId::NUMBER
                } else if both_are_bigint_like(self, l, r) {
                    if op == BinOp::UShr {
                        self.report_operator_error(file, e, op, l, r, None);
                    } else if op == BinOp::Pow
                        && language_version(self) < crate::resolve::ScriptTarget::ES2016
                    {
                        self.error_at(self.place_of_expr(file, e), 2791, &[]);
                    }
                    TypeId::BIGINT
                } else {
                    self.report_operator_error(file, e, op, l, r, Some(both_are_bigint_like));
                    TypeId::ERROR
                };
                if left_ok && right_ok {
                    if is_assignment {
                        self.check_assignment_operator(file, op, left, right, l, result);
                    }
                    if matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr) {
                        self.check_shift_count(file, e, op, left, right);
                    }
                }
                result
            }
        }
    }

    /// `isTypeAssignableToKindEx`, for one of number, bigint and string: `like` tests whether a
    /// type is directly of the kind, `target` is the type every type of the kind is assignable to.
    pub(super) fn is_assignable_to_kind(
        &mut self,
        source: TypeId,
        like: fn(&Self, TypeId) -> bool,
        target: TypeId,
        strict: bool,
    ) -> bool {
        if like(self, source) {
            return true;
        }
        if strict && (self.is_any(source) || source == TypeId::UNKNOWN || self.is_nullish(source)) {
            return false;
        }
        self.is_assignable(source, target)
    }

    pub(super) fn constraint_for_operator(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| {
            let m = if c.is_deferred(m) {
                c.base_constraint(m)
            } else {
                m
            };
            // An operator treats `string & { brand: 1 }` as a string.
            match c.data(m) {
                TypeData::Intersection(parts) => parts
                    .iter()
                    .copied()
                    .find(|&p| c.is_primitive(p))
                    .unwrap_or(m),
                _ => m,
            }
        })
    }

    // ───────────────────────────── JSX ─────────────────────────────

    /// `getJsxNamespaceAt`. A `JSX` alias that does not resolve counts as absent: falls back to the
    /// global one.
    pub(super) fn jsx_namespace_at(
        &mut self,
        file: FileId,
        is_opening_fragment: bool,
    ) -> Option<Sym> {
        let files = self.files();
        // `getJsxNamespaceContainerForImplicitImport`: the module that creates elements, if it
        // resolves.
        let member = match files
            .jsx_runtime(file)
            .and_then(|spec| files.module_of_specifier(file, spec))
        {
            Some(module) => files.module_export(module, known::JSX),
            None => {
                let name = super::errors_jsx::jsx_namespace(
                    files,
                    self.atoms(),
                    self.hir(file),
                    is_opening_fragment,
                );
                files
                    .resolve_name(file, ScopeId(0), name, SymFlags::NAMESPACE)
                    .and_then(|container| files.resolve_alias_if_needed(container))
                    .and_then(|container| files.namespace_member(container, known::JSX))
            }
        };
        if let Some(member) = member
            && files.means(member, SymFlags::NAMESPACE)
            && let Some(found) = files.resolve_alias_if_needed(member)
        {
            return Some(found);
        }
        files
            .global(known::JSX, SymFlags::NAMESPACE)
            .and_then(|global| files.resolve_alias_if_needed(global))
    }

    /// `getJsxElementTypeAt`: without a `JSX.Element` it is the error type, which is compatible
    /// with anything.
    pub(super) fn jsx_element_type(&mut self, file: FileId) -> TypeId {
        self.jsx_type(file, known::Element).unwrap_or(TypeId::ERROR)
    }
}

/// The types that the operands in `contributions` contribute, each once, in order.
fn distinct_contributions(
    contributions: &[(ExprId, SmallVec<[TypeId; 2]>)],
) -> SmallVec<[TypeId; 2]> {
    let mut united: SmallVec<[TypeId; 2]> = SmallVec::new();
    for ty in contributions.iter().flat_map(|it| it.1.iter().copied()) {
        if !united.contains(&ty) {
            united.push(ty);
        }
    }
    united
}
