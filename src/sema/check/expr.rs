//! The types of expressions.

use super::errors::{both_are_bigint_like, can_be_equal, can_be_ordered, may_be_added};
use super::errors_x_operators::{is_literal_expression_of_object, language_version};
use super::infer::Inference;
use super::shape::{Access, Found};
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId};
use smallvec::SmallVec;
use std::ops::ControlFlow;

impl Slots {
    /// What a slot that holds `raw` says.
    #[inline]
    fn unpack(raw: u32) -> Option<TypeId> {
        match raw {
            0 => None,
            n => Some(TypeId(n - 1)),
        }
    }
}

/// `getAssignmentTargetKind`
#[derive(Copy, Clone)]
pub(super) struct TargetKind {
    /// `is_assignment_target`
    assigned: bool,
    /// `AssignmentKindDefinite`: given a value by `=` or in a pattern there, or by `&&=`, `||=` or `??=`. It is what it is declared
    /// as, whatever has been found out about it on the way.
    pub(super) definite: bool,
    /// `is_written`
    pub(super) written: bool,
}

impl<'p> Checker<'p> {
    /// The type of `e` where it stands, after narrowing. The entry point for questions from outside.
    pub fn type_at(&mut self, file: FileId, e: ExprId) -> TypeId {
        self.prepare_enclosing(file, e);
        let ty = self.type_of_expr(file, e);
        // `getTypeOfExpression`: the quick type comes first. It says something else only of a `new` that is refused.
        if self.has_any_flag(ty) {
            self.quick_type_of_expr(file, e).unwrap_or(ty)
        } else {
            ty
        }
    }

    /// `getQuickTypeOfExpression`, of `new` and of `await new`.
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
            _ => None,
        }
    }

    /// `checkExpression`. `checkExpressionEx`, where the parent of `e` is checked under a mode that it hands on.
    pub fn type_of_expr(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.trace_cycles {
            self.looked_at.insert((file, e));
        }
        let check_mode = self.check_mode();
        if check_mode.is_empty() || e.is_none() {
            return self.type_of_expr_as_written(file, e);
        }
        let check_mode = self.check_mode_handed_on_to(file, e, check_mode);
        self.check_expression_ex(file, e, check_mode)
    }

    /// `checkExpressionWorker`: the `checkMode` that what it calls for the parent of `e`, which is checked under `check_mode`, hands on
    /// to `e`.
    fn check_mode_handed_on_to(&self, file: FileId, e: ExprId, check_mode: CheckMode) -> CheckMode {
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

    /// `checkExpressionEx`, where expressions are checked again.
    pub(super) fn check_expression_ex(
        &mut self,
        file: FileId,
        e: ExprId,
        check_mode: CheckMode,
    ) -> TypeId {
        let mode_outside = std::mem::replace(&mut self.mode_of_recheck, check_mode);
        let ty = self.type_of_expr_as_written(file, e);
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
        let call_signature = self.single_signature(ty, false, true);
        let construct = call_signature.is_none();
        let Some(signature) = call_signature.or_else(|| self.single_signature(ty, true, true))
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
        let Some(contextual_signature) = self.single_signature(non_null, construct, false) else {
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
                    return c.p.types.intern_sig(SigData::Synth {
                        type_params: Box::new([]),
                        params: params.into(),
                        ret,
                        this,
                        of: Box::new([]),
                    });
                }
            }
            // `instantiateSignatureInContextOf`. `applyToParameterTypes` reads as much of what is expected as `signature` takes.
            let (wanted, taken) = (c.sig_params(contextual_signature), c.sig_params(signature));
            let takes_rest = c.effective_rest_type(&taken).is_some();
            let count = c.parameter_count(&taken) - usize::from(takes_rest);
            let mut read: SmallVec<[TypeId; 8]> = SmallVec::new();
            if c.sig_this_type(signature).is_some() {
                read.extend(c.sig_this_type(contextual_signature));
            }
            let wanted = wanted.iter().enumerate();
            read.extend(
                wanted
                    .filter(|&(i, _)| takes_rest || i < count)
                    .map(|(_, p)| p.ty),
            );
            let source =
                c.instantiate_signature_in_inference_context(n, contextual_signature, &read, true);
            c.instantiate_sig_in_context(signature, source, false)
        });
        match instantiated {
            Some(instantiated) => self.type_of_signature(instantiated, construct),
            None => ty,
        }
    }

    /// The type that is kept for `e`.
    #[inline]
    pub(super) fn kept_type_of_expr(&self, file: FileId, e: ExprId) -> Option<TypeId> {
        if file == self.file_at_hand
            && let Some(slot) = self.exprs_at_hand.get(e.idx())
        {
            return Slots::unpack(slot.load(std::sync::atomic::Ordering::Relaxed));
        }
        Slots::unpack(self.p.expr_types.0.raw((file, e.0)))
    }

    #[inline]
    fn keep_type_of_expr(&self, file: FileId, e: ExprId, ty: TypeId) {
        if file == self.file_at_hand
            && let Some(slot) = self.exprs_at_hand.get(e.idx())
        {
            slot.store(ty.0 + 1, std::sync::atomic::Ordering::Relaxed);
        } else {
            self.p.expr_types.set(file, e.idx(), ty);
        }
    }

    /// `checkExpressionWorker`
    #[inline]
    fn type_of_expr_as_written(&mut self, file: FileId, e: ExprId) -> TypeId {
        // Where something had to be written and nothing is.
        if e.is_none() {
            return TypeId::UNRESOLVED;
        }
        if self.contextual_binding_patterns.is_empty()
            && !self.is_rechecked(file, e)
            && let Some(known) = self.kept_type_of_expr(file, e)
        {
            return known;
        }
        self.type_of_expr_not_kept(file, e)
    }

    /// Whether `e` is checked again, with nothing kept. tsgo checks everything in an argument again for every contextual type that
    /// is pushed. A name, `this` and an access are where the flow analysis is, and nothing is expected of what is accessed or of a
    /// key. They are the same under every contextual type, and are checked once, unless a type parameter is in scope:
    /// `getNarrowableTypeForReference` puts what a type parameter extends in its place or not, going by the check mode and by
    /// `hasContextualTypeWithNoGenericTypes`.
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
            let scope = self.scope_of_expr(file, e);
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

    /// The same, of an `e` that is there and whose type is not kept, or may be looked at afresh.
    fn type_of_expr_not_kept(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `getTypeFromBindingElement`: the defaults in a pattern are looked at afresh every time it is worked out what the pattern
        // implies its initializer to be. The names of the pattern are anything meanwhile.
        let is_rechecked = self.is_rechecked(file, e);
        // While it is worked out what a pattern implies its names are anything: that is nobody else's answer.
        let is_memoised = is_rechecked && self.contextual_binding_patterns.is_empty();
        if is_memoised && let Some(&known) = self.rechecked_exprs.get(&(file, e)) {
            return known;
        }
        let mut afresh = is_rechecked;
        let mut visible_from = self.resolution_start;
        if !self.contextual_binding_patterns.is_empty() {
            if let Some(floor) = self.contextual_pattern_floor(file, e) {
                afresh = true;
                visible_from = visible_from.max(floor.min(self.stack.len()));
            }
            if !afresh && let Some(known) = self.kept_type_of_expr(file, e) {
                return known;
            }
        }
        // Resolving the calls around it may well have settled it.
        if !is_rechecked
            && self.prepare_question_about_expr(file, e)
            && !afresh
            && let Some(known) = self.kept_type_of_expr(file, e)
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
        let (ty, holds) = match self.type_of_plain_literal(file, e) {
            Some(ty) => (ty, true),
            None => {
                // `checkExpressionWithContextualType` has no guard against re-entry. A visit begun before the pattern was looked at
                // this way took its names for what they are declared as: this one does not go the same way.
                let resolution_start = std::mem::replace(&mut self.resolution_start, visible_from);
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
                if afresh && self.inference_contexts.len() != self.context_free_level {
                    self.drop_reported();
                }
                (ty, self.leave())
            }
        };
        if holds && !afresh {
            self.keep_type_of_expr(file, e, ty);
        }
        if holds && is_memoised {
            self.rechecked_exprs.insert((file, e), ty);
        }
        ty
    }

    /// The type of `e` if it is a literal that nothing has to be asked about, so that nothing can come back to it or be found out to
    /// hold only for now meanwhile. It leaves what `enter` and `leave` would. `None` also where `enter` would refuse.
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
            ExprKind::Null => TypeId::NULL,
            ExprKind::True => TypeId::FRESH_TRUE,
            ExprKind::False => TypeId::FRESH_FALSE,
            ExprKind::Number(n) => self.number_literal(hir.numbers[n as usize], true),
            // Not a private name.
            ExprKind::String(s) if !is_private_name_at(hir, hir[e].pos) => {
                self.string_literal(s, true)
            }
            _ => return None,
        };
        self.came_full_circle = false;
        self.last_enter = EnterOutcome::Entered;
        self.left_a_circle = false;
        Some(ty)
    }

    /// `reportNonexistentProperty` returns at once for a property access whose error is already being reported, and the access is
    /// the error type. `None` if `e` is not such an access, or if `enter` has to mark the circularity that the second visit closes.
    fn type_of_access_being_reported(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let &(_, _, depth) = self
            .reporting_nonexistent
            .iter()
            .rev()
            .find(|r| r.0 == file && r.1 == e)?;
        // `getResolvedSignature`: a call hides the resolutions below it (`resolutionStart`).
        let after_call = self.stack[depth..]
            .iter()
            .rposition(|q| matches!(q, Query::Call(..)))
            .map_or(depth, |i| depth + i + 1);
        let visible = after_call.max(self.resolution_start).min(self.stack.len());
        // tsgo resolves the type of a variable, a parameter or a member before it checks the initializer. That resolution is always
        // under way when the access is first checked, and printing runs into it. `enter` marks that circularity.
        if !self.stack[visible..]
            .iter()
            .all(|&q| matches!(q, Query::Return(..)) || !self.is_resolution(q))
        {
            return None;
        }
        // `checkFunctionExpressionOrObjectLiteralMethodDeferred` resolves the return type of a function before it checks the body. In
        // a full check these return types are under way when the access is first checked, and printing runs into them: 7023.
        // Queried first, as here, the access closes no circularity, and the functions keep their inferred return types.
        for i in visible..self.stack.len() {
            if let Query::Return(f, func) = self.stack[i]
                && self.hir(f)[func].ret.is_none()
                && !self.stack[..depth].contains(&self.stack[i])
            {
                self.report_circular_return_type(f, func);
            }
        }
        Some(TypeId::ERROR)
    }

    /// `getTypeOfExpression` has no guard against re-entry. An expression that is being checked and that a back edge of a loop
    /// evaluates again is checked again. It goes the same way, and the flow analysis that led to the loop ends there this time, with
    /// the types collected so far (`flowLoopStack`, `getTypeAtFlowLoopLabel`). `None` if no loop was pushed since `e` was entered.
    fn recheck_in_flow_loop(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let first = self
            .stack
            .iter()
            .rposition(|&q| q == Query::Expr(file, e))?;
        let pushed_at = self.flow_loop_pushed_since(first)?;
        // Hide the first visit from `enter`, which still refuses when time, native stack or query depth run out.
        let resolution_start = std::mem::replace(&mut self.resolution_start, self.stack.len());
        let entered = self.enter(Query::Expr(file, e));
        self.resolution_start = resolution_start;
        if !entered {
            return Some(TypeId::UNRESOLVED);
        }
        // The loop type is incomplete: nothing computed since the loop was pushed is cached.
        self.taint_from(pushed_at);
        let ty = self.type_of_expr_uncached(file, e);
        self.leave();
        Some(ty)
    }

    /// If `e` is written in a default inside a pattern of which it is being worked out what it implies its initializer to be: how
    /// deep `stack` was when that began.
    fn contextual_pattern_floor(&self, file: FileId, e: ExprId) -> Option<usize> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = bound.expr_parent[e.idx()];
        loop {
            let mut inner = match at {
                Parent::None | Parent::File => return None,
                Parent::PatPropDefault(p) => hir[p].value,
                Parent::PatElemDefault(p) => hir[p].pat,
                _ => {
                    at = self.parent_of(file, at);
                    continue;
                }
            };
            loop {
                match bound.pat_parent[inner.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                        if let Some(pattern) = self
                            .contextual_binding_patterns
                            .iter()
                            .find(|p| p.0 == file && p.1 == outer)
                        {
                            return Some(pattern.2);
                        }
                        inner = outer;
                    }
                    PatParent::Var(d) => {
                        at = Parent::VarInit(d);
                        break;
                    }
                    PatParent::Param(p) => {
                        at = Parent::ParamDefault(p);
                        break;
                    }
                    PatParent::None => return None,
                }
            }
            at = self.parent_of(file, at);
        }
    }

    /// Looks at an operand nothing is made of, as `checkExpression` does: what leads back to something that is being worked out
    /// is a circle. What the operand is, and how sure that is, says nothing about the expression it is part of.
    fn look_at(&mut self, file: FileId, e: ExprId) {
        self.type_of_expr(file, e);
    }

    /// `a.b().c().d()` with hundreds of links, `a + b + c + ..` with hundreds of operands: one by one from the innermost, so that
    /// none has to go all the way down.
    fn resolve_chain_from_the_inside(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let mut chain: Vec<ExprId> = Vec::new();
        match hir[e].kind {
            // `checkBinaryLikeExpression` goes down the left however deep that is.
            ExprKind::Binary { left, .. } => {
                // The left of `at`, if `at` is an operator nothing is known of yet.
                let further = |c: &Self, at: ExprId| {
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
                // What `at` is got from, and whether `at` is a call before `e`. `None` where the chain begins, or at a call that
                // is known.
                let further = |c: &Self, at: ExprId| match hir[at].kind {
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
            self.type_of_expr_as_written(file, link);
            // What is not kept would be worked out again by every link after it.
            if !self.has_type_of_expr(file, link) {
                break;
            }
        }
    }

    /// The innermost scope with type parameters that `e` can see.
    pub fn scope_of_expr(&self, file: FileId, e: ExprId) -> ScopeId {
        let bound = self.bound(file);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(x) => bound.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                Parent::FnBody(f) => return bound.fns[f.idx()].scope,
                Parent::ParamDefault(p) => return bound.fns[bound.param_fn[p.idx()].idx()].scope,
                Parent::MemberInit(m) => {
                    return match bound.member_owner[m.idx()] {
                        MemberOwner::Class(c) => bound.class_scope[c.idx()],
                        _ => ScopeId::NONE,
                    };
                }
                Parent::ClassExtends(c) => return bound.class_scope[c.idx()],
                _ => return ScopeId::NONE,
            };
        }
    }

    /// `isConstContext`
    pub fn is_const_context(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // FOR SPEED. What is expected of a part of a literal is made of what is expected of the literal. Without type variables
        // there, or in what is pushed for a part on the way, no `const` type variable is expected further in.
        let (mut top, mut highest, mut may_be_expected) = (e, ExprId::NONE, false);
        loop {
            // `isValidConstAssertionArgument`: of nothing else is it asked what is expected of it.
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
                // `IsPropertyAssignment(parent)`: the parent of what is in the brackets of a name is the name, and a JSX attribute is
                // no property assignment.
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

    /// Whether literals given for a `ty` keep their exact types: `<const T>`, or something made of one.
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
            // A substitution type is as its base type is.
            &TypeData::Substitution { base, .. } => self.is_const_type_variable(base, depth),
            // `getHomomorphicTypeVariable`: `{ [K in keyof T]: .. }` is as `T` is.
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

    /// The type of the object of a member access or a call in a chain, and whether the chain may have stopped before.
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
                // A link before this one may have stopped as well, which shows as `undefined` in its type.
                (non_null, stops)
            }
            // What the link before is when the chain got that far, `undefined` included if it can be that by itself.
            Chain::Continue if self.is_in_optional_chain(file, obj) => self.type_of_link(file, obj),
            Chain::Continue => (ty, false),
        }
    }

    /// `tryReparseOptionalChain`: whether the `!` of `e` is a link of an optional chain that goes on after it, as in `a?.b!.c`.
    /// Followed by nothing, by `?.` or by a parenthesis it is not.
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

    /// Whether it is the program that is in error where nothing was found in `receiver`: all of it is known,
    /// and no question has gone unanswered since `cycles_before`.
    fn is_certainly_missing(&mut self, receiver: TypeId, cycles_before: u64) -> bool {
        let apparent = self.apparent_type(receiver);
        self.cycles == cycles_before && self.is_known(receiver) && self.is_known(apparent)
    }

    /// `leftType` of `checkPropertyAccessExpressionOrQualifiedName`: what the property of `obj.name` is looked up in, and whether the
    /// chain may stop before. `Err`: `isAnyLike`, and the type of the access.
    pub(super) fn left_type_of_property_access(
        &mut self,
        file: FileId,
        obj: ExprId,
        chain: Chain,
    ) -> (Result<TypeId, TypeId>, bool) {
        let (receiver, stops) = self.chain_receiver(file, obj, chain);
        // `x.a` out of `any` is `any`, tests or no tests. (Not so `x["a"]`.)
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

    /// `core.IfElse(assignmentKind != AssignmentKindNone || c.isMethodAccessForCall(node), c.getWidenedType(leftType), leftType)`: what
    /// is written to or called is looked up in what a variable holding the object would be.
    pub(super) fn widened_left_type_of_property_access(
        &mut self,
        file: FileId,
        e: ExprId,
        left: TypeId,
    ) -> TypeId {
        if self.target_kind(file, e).written || self.is_called(file, e) {
            self.regular_object(left)
        } else {
            left
        }
    }

    /// `getApparentType`: what may be anything at all has nothing that can be counted on, not even what every object has.
    pub(super) fn is_apparently_unknown(&mut self, ty: TypeId) -> bool {
        self.p.files.options.strict_null_checks
            && self.is_deferred(ty)
            && self.base_constraint(ty) == TypeId::UNKNOWN
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of `a.b` when it is got to, and whether the chain may stop before.
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
            self.grammar_error_at(right, 2803, &[Arg::Text(&written)]);
        }
        let left = match left {
            Ok(left) => left,
            // `isAnyLike`. A `#b` that no class around declares is looked for all the same.
            Err(any) => {
                if !is_private || lexical.is_some() || !self.is_known(any) {
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
        let cycles_before = self.cycles;
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
        let found = if is_private && !self.is_private_name_in_reach(file, e, left, name) {
            None
        } else if self.is_apparently_unknown(receiver) {
            None
        } else if is_super {
            self.type_of_super_property(file, obj, receiver, name)
        } else if target.written {
            // `getWriteTypeOfSymbol`, for what is not read first. Read or not, nothing is written through an index signature of
            // what a type parameter extends.
            match self.property_type(receiver, name, Access::Written) {
                Some(_) if !target.assigned => self.property_type(receiver, name, Access::Read),
                to_write => to_write,
            }
        } else {
            self.property_type(receiver, name, Access::Read)
        };
        let found = match found {
            // `getPropertyOfTypeEx` with `includeTypeOnlyMembers`: what a qualified name in `typeof a.b` asks for.
            None if bound.is_in_type_query(e) => self
                .type_only_member_of_module(receiver, name)
                .map(|ty| (ty, Found::Property)),
            found => found,
        };
        let apparent = self.reduced_apparent_type(receiver);
        let Some((declared, how)) = found else {
            if !self.is_certainly_missing(receiver, cycles_before) {
                return (TypeId::UNRESOLVED, stops);
            }
            if is_private {
                // `#x in o` is narrowed like `"#x" in o`, not to the class: a `#x` that no class declares comes of that, and what
                // `o` is by rights is not known.
                if self
                    .prop_ref(apparent, name)
                    .is_some_and(|(prop, _)| !matches!(prop.source, PropSource::Members(_)))
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
                    self.grammar_error_at(right, 1111, &[Arg::Text(&written)]);
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
            if !self.files().atoms.bytes(name).is_empty()
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
            self.check_property_accessibility(file, e, is_super, apparent, name, name_pos);
        }
        if target.written
            && self
                .readonly_entity_assigned_to(file, e, obj, name)
                .is_some()
        {
            let right = self.place_of_token(file, name_pos);
            let text = self.source_text(file, right.1, right.2);
            self.error_at(right, 2540, &[Arg::Text(&text)]);
            return (TypeId::ERROR, stops);
        }
        let prop = match how {
            Found::ByIndex => None,
            _ => self.prop_ref(apparent, name).map(|found| found.0),
        };
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
        let (prop, _) = self.prop_of(apparent, name)?;
        let PropSource::Assigned(declared_in, assignments) = &prop.source else {
            return None;
        };
        if *declared_in != file
            || !matches!(
                self.is_constructor_declared_this_property(file, assignments),
                super::shape::ThisAssignmentDeclaration::Constructor(declaring) if declaring == container
            )
        {
            return None;
        }
        // `getFlowTypeOfProperty`
        let (class, _) = self.class_of_member_fn(file, container)?;
        let inherited = self.type_of_property_in_base_class(file, class, name);
        Some(inherited.unwrap_or(self.undefined_as_declared()))
    }

    /// `lookupSymbolForPrivateIdentifierDeclaration`, `getPrivateIdentifierPropertyOfType`: the `#name` of `e` is that of the
    /// innermost class around that declares one, and it is that one `receiver` has to have.
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
            self.prop_of(part, name)
                .is_some_and(|(prop, _)| match &prop.source {
                    PropSource::Intersected(_, props) => props
                        .iter()
                        .any(|p| self.declaring_class(p) == Some(lexical)),
                    _ => self.declaring_class(&prop) == Some(lexical),
                })
        })
    }

    /// An export of the module `ty` is the type of that is a value in the end, though exported or imported as a type only.
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

    /// Resolves the types that printing `ty` resolves, which `reportNonexistentProperty` does for its message: for an anonymous
    /// object type, the parameter and return types of its signatures and the types of its properties, recursively. That can close
    /// a circularity. tsgo truncates the text after about 160 characters, which the limit on `depth` approximates. `visited` holds
    /// the object types expanded so far, each with the depth it was expanded at.
    pub(super) fn resolve_as_printed(
        &mut self,
        ty: TypeId,
        depth: u32,
        visited: &mut Vec<(TypeId, u32)>,
    ) {
        if depth > 3 {
            return;
        }
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                for &part in parts.iter() {
                    self.resolve_as_printed(part, depth + 1, visited);
                }
            }
            // What an alias stands for is printed by the name of the alias.
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node),
                ..
            } if self
                .hir(*file)
                .aliases
                .iter()
                .any(|alias| alias.ty == *node) => {}
            // `shouldEmitTypeOfSymbol`: a function merged with a namespace, a class or an enum is printed as `typeof f`.
            TypeData::Anon {
                origin: Origin::Function(sym),
                ..
            } if self
                .files()
                .flags(*sym)
                .intersects(SymFlags::VALUE_MODULE | SymFlags::ENUM | SymFlags::CLASS) => {}
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(..)
                    | Origin::WidenedLiteral(..)
                    | Origin::TypeLiteral(..)
                    | Origin::Function(..),
                ..
            }
            | TypeData::Synth(_)
            | TypeData::Fns { .. } => {
                // Expanding a type again resolves nothing new, unless the first expansion was cut off earlier.
                if visited.iter().any(|&(seen, at)| seen == ty && at <= depth) {
                    return;
                }
                visited.push((ty, depth));
                for construct in [false, true] {
                    for sig in self.signatures(ty, construct) {
                        // `signatureToSignatureDeclarationHelper` prints the parameters before the return type.
                        if let Some((declared_in, func, mapper)) = self.sig_decl(sig) {
                            for p in self.hir(declared_in)[func].params.iter() {
                                let param = self.type_of_param(declared_in, p);
                                let param = self.instantiate(param, mapper);
                                self.resolve_as_printed(param, depth + 1, visited);
                            }
                        }
                        let returned = self.sig_return(sig);
                        self.resolve_as_printed(returned, depth + 1, visited);
                    }
                }
                let Some(members) = self.members(ty) else {
                    return;
                };
                for prop in &members.shape().props {
                    let ty = self.type_of_prop(prop, members.mapper);
                    self.resolve_as_printed(ty, depth + 1, visited);
                }
            }
            _ => {}
        }
    }

    /// `checkSatisfiesExpression` reports 1360 as soon as the expression is checked, and the message prints both types. Inside a
    /// function whose return type is being inferred that can close a circularity.
    fn print_unsatisfied_types(&mut self, file: FileId, source: TypeId, ty: TypeNodeId) {
        if !self
            .stack
            .iter()
            .any(|q| matches!(q, Query::Return(..) | Query::ReturnAtFirstLook(..)))
        {
            return;
        }
        let target = self.type_from_node(file, ty);
        if self.is_known(source) && self.is_known(target) && !self.is_assignable(source, target) {
            let mut visited = Vec::new();
            self.resolve_as_printed(source, 0, &mut visited);
            self.resolve_as_printed(target, 0, &mut visited);
        }
    }

    /// `checkElementAccessExpression`: the type of `a[b]` when it is got to, as `getFlowTypeOfAccessExpression` leaves it, and
    /// whether the chain may stop before. `checkIndexedAccessIndexType` has not had its say: 2536, 4105 and 2542 go by this.
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
        // `getWidenedType(exprType)`: what is written to or called is looked up in what a variable holding the object would be.
        let receiver = if target.written || self.is_called(file, e) {
            self.regular_object(receiver)
        } else {
            receiver
        };
        let key = self.type_of_expr(file, index);
        // `isErrorType(objectType) || objectType == silentNeverType`: it is the result, not looked into nor narrowed.
        if self.is_error_type(receiver) || receiver == TypeId::SILENT_NEVER {
            return (receiver, stops);
        }
        // A `const` enum is only looked into by a name that is written out.
        if !is_string_literal_like(hir, index) && self.is_const_enum_object(receiver) {
            if !hir.has_errors {
                self.error_at(self.place_of_written_expr(file, index), 2476, &[]);
            }
            return (TypeId::ERROR, stops);
        }
        // `isForInVariableForNumericPropertyNames`: the variable of a `for..in` over what has numbers for names is a number here.
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
                    && let Some(prop) = self.readonly_entity_assigned_to(file, e, obj, name)
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
        let found = match of_super {
            Some(name) => self
                .type_of_super_property(file, obj, receiver, name)
                .map(|(ty, _)| ty),
            None => self.indexed_access_of_element_access(receiver, key, access_flags, (file, e)),
        };
        let declared = match found {
            Some(found) => found,
            // `core.OrElse(c.getIndexedAccessTypeOrUndefined(..), c.errorType)`
            None if self.is_known(key) && self.is_certainly_missing(receiver, cycles_before) => {
                TypeId::ERROR
            }
            None => TypeId::UNRESOLVED,
        };
        // `getResolvedSymbolOrNil(node)`: what `getPropertyTypeForIndexType` found for a key that is a name.
        let prop = match self.property_name_of_type(key) {
            Some(name) => {
                let apparent = self.apparent_type(receiver);
                self.prop_ref(apparent, name).map(|found| found.0)
            }
            None => None,
        };
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
                if e.is_some_and(|e| self.is_written(access_node.0, e))
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

    /// The type of `a.b`, `a[b]` or `a()` when it is got to, and whether an optional chain it is part of may stop before.
    fn type_of_link(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { .. } => self.type_of_property_access(file, e),
            ExprKind::Index { .. } => {
                let (ty, stops) = self.type_of_element_access_unchecked(file, e);
                // Where it is written is only looked for where there is something to check.
                if !matches!(self.data(ty), TypeData::IndexedAccess { .. }) {
                    return (ty, stops);
                }
                let access_node = self.place_inside_parentheses(file, e);
                (
                    self.check_indexed_access_index_type(ty, access_node, Some(e)),
                    stops,
                )
            }
            // `checkCallExpression`: what is required is the module. `resolveExternalModuleTypeByLiteral`
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
                // `resolveCallExpression` under `CheckModeSkipGenericFunctions` defers a call of a generic function that returns a
                // function: `resolvingSignature`, of which `checkCallExpression` makes `silentNeverType`. `getResolvedSignature`
                // returns a signature that is cached first.
                if self
                    .check_mode()
                    .contains(CheckMode::SKIP_GENERIC_FUNCTIONS)
                    && self.p.calls.get(&(file, e)).is_none()
                    && self.is_call_of_generic_function_returning_function(file, e)
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
                let resolved = self.with_return_type(resolved);
                let call = &hir[c];
                let stops = match call.chain {
                    Chain::No => false,
                    Chain::Start => {
                        let callee = self.type_of_expr(file, call.callee);
                        self.some_type(callee, |k, m| k.is_nullish(m))
                    }
                    // `getOptionalExpressionType`: not that what is called may be `undefined` by itself.
                    Chain::Continue => self.chain_receiver(file, call.callee, Chain::Continue).1,
                };
                // `checkCallExpression`
                if self.is_symbol_like(resolved.ret) && self.is_symbol_or_symbol_for_call(file, e) {
                    return (self.get_es_symbol_like_type_for_node(file, e), stops);
                }
                (resolved.ret, stops)
            }
            // `checkNonNullChain`: what the link before can be by itself goes, that the chain may have stopped stays.
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
            // `checkIdentifier`: what the parser made up where an expression is missing is in error, and can be anything. A hole in an
            // array literal is another matter.
            ExprKind::Missing => match self.bound(file).expr_parent[e.idx()] {
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                    TypeId::UNDEFINED
                }
                _ => TypeId::ERROR,
            },
            ExprKind::Ident(name) => self.type_of_identifier(file, e, name),
            ExprKind::This => self.check_this_expression(file, e),
            ExprKind::Super => self.check_super_expression(file, e),
            ExprKind::Null => TypeId::NULL,
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
                for x in hir.ids(exprs) {
                    self.look_at(file, x);
                }
                // What it comes to, if that can be told from the text alone. `IsTaggedTemplateExpression(node.Parent)`: neither the tag
                // nor the template of a tagged template is evaluated.
                let is_tag = matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p)
                    if matches!(hir[p].kind, ExprKind::TaggedTemplate(c) if hir[c].callee == e || hir[c].template == e))
                    && !is_parenthesized(hir, e);
                if !is_tag && let Some(EnumValue::String(text)) = self.constant_value(file, e) {
                    return self.string_literal(text, true);
                }
                let wants_literal = self.is_const_context(file, e)
                    // `isTemplateLiteralContext`: as a key it is looked at for what it can be.
                    || matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Index { index, .. } if index == e))
                    || self.contextual_type(file, e, ContextFlags::empty()).is_some_and(|c| self.parts(c).iter().any(|&m| self.is_template_literal_contextual_type(m)));
                if !wants_literal {
                    return TypeId::STRING;
                }
                let mut types: Vec<TypeId> =
                    hir.ids(exprs).map(|x| self.type_of_expr(file, x)).collect();
                let texts: Vec<Atom> = hir.ids(hir.template_texts(exprs)).collect();
                // `templateConstraintType`: what is none of these comes out as some string or other.
                let constraint = self.union(&[
                    TypeId::STRING,
                    TypeId::NUMBER,
                    TypeId::BOOLEAN,
                    TypeId::BIGINT,
                    TypeId::NULL,
                    TypeId::UNDEFINED,
                ]);
                for t in &mut types {
                    if *t != TypeId::UNRESOLVED && !self.is_assignable(*t, constraint) {
                        *t = TypeId::STRING;
                    }
                }
                self.template_type(&texts, &types)
            }
            ExprKind::TaggedTemplate(_) | ExprKind::New(_) => {
                let resolved = self.resolved_signature(file, e);
                self.with_return_type(resolved).ret
            }
            ExprKind::Array(items) => self.type_of_array_literal(file, e, items),
            ExprKind::Object(props) => self.type_of_object_literal(file, e, props),
            ExprKind::Fn(func) => {
                self.check_node_deferred_where_it_is_worked_out(file, e);
                self.check_function_expression_or_object_literal_method(file, e, func)
            }
            // `checkClassExpression`: what the symbol of the class is, as for a class that is declared.
            ExprKind::Class(class) => {
                self.check_node_deferred_where_it_is_worked_out(file, e);
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
                    // `checkBinaryLikeExpression`: the left first. A pattern is taken apart, not looked at.
                    if target.is_none()
                        || !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                    {
                        self.look_at(file, target);
                    }
                    let source = self.type_of_expr(file, value);
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
                // `checkAssertion` looks at the operand first. `getQuickTypeOfExpression`: not where the assertion is all there is
                // to an initializer, or to what is assigned, which the flow of control asks the type of.
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
                let ty = self.type_of_expr(file, expr);
                let args = self.types_from_nodes(file, type_args);
                self.with_type_arguments(ty, &args, InstantiationExpression::Expr(file, e))
            }
            ExprKind::Jsx(j) => {
                let is_fragment = hir[j].tag.is_none();
                if !is_fragment {
                    self.check_node_deferred_where_it_is_worked_out(file, e);
                }
                if self.checking == Some(file) {
                    self.first_jsx.0 = self.first_jsx.0.or(Some(e));
                    if is_fragment {
                        self.first_jsx.1 = self.first_jsx.1.or(Some(e));
                    }
                }
                match self.jsx_element_type(file) {
                    // `checkJsxFragment`: `any` where `getJsxElementTypeAt` is the error type.
                    ty if is_fragment && self.is_error_type(ty) => TypeId::ANY,
                    ty => ty,
                }
            }
            ExprKind::ImportCall { args, .. } => {
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
            // Of what waits for type parameters, `keyof T` is a primitive.
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

    /// `getFreshTypeOfLiteralType(getBigIntLiteralType(..))`. The regular type is made first: `CompareTypes` orders bigint literal
    /// types by when they were made.
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
        // `createPromiseReturnType`: 2711 without a `Promise` to give.
        if self.global_type_symbol(known::Promise).is_none() {
            return TypeId::ERROR;
        }
        let ExprKind::String(spec) = self.hir(file)[spec].kind else {
            return self.promise_of(TypeId::ANY);
        };
        let files = self.files();
        // `getEmitSyntaxForUsageLocationWorker`: how an `import()` is emitted, which is also how what it names is looked for,
        // does not go by the file alone.
        let usage = files.mode_of_import_call(file);
        // A module that cannot be found is an error, and what is in error can be anything.
        let Some(module) = files.module_of_specifier_as(file, spec, usage) else {
            return self.promise_of(TypeId::ANY);
        };
        // What `export =` gives, if it says that.
        let mut ty = self.type_of_symbol(files.module_value(module));
        if self.is_known(ty) && !self.is_any(ty) {
            // `createDefaultPropertyWrapperForModule`
            let default = Prop {
                name: known::default,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            };
            let wrapper = self.synth(Shape {
                props: vec![default],
                default_of: Some(module),
                ..Shape::default()
            });
            // `isOnlyImportableAsDefault`: to Node a JSON module has a default and nothing else.
            let is_default_only = files.options.module.is_node()
                && usage == ResolutionMode::Import
                && files
                    .symbol(module)
                    .decls
                    .iter()
                    .any(|d| matches!(d, Decl::File))
                && (files.hir(module.file).kind == FileKind::Json
                    || files.module(module.file).path.ends_with(".d.json.ts"));
            if is_default_only {
                // `getTypeWithSyntheticDefaultOnly`
                ty = wrapper;
            } else if self.can_have_synthetic_default(usage, module) {
                // `getTypeWithSyntheticDefaultImportType`: a module that may turn out to be its own default has one, over its own.
                let with_default = if self.is_valid_spread_type(ty) {
                    self.spread(ty, wrapper)
                } else {
                    wrapper
                };
                // The symbol made up for it is a type literal without members: `IsEmptyAnonymousObjectType` takes it for `{}`.
                ty = self.map_type(with_default, |c, m| match c.data(m) {
                    TypeData::Synth(shape) => c.synth(Shape {
                        literal: Literalness::SyntheticDefault,
                        default_of: Some(module),
                        ..(**shape).clone()
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

    /// `isCommonJSRequire`: `require("m")` in JavaScript, where `require` is nothing the program defines itself.
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

    /// `getResolvedSymbol`: the symbol an identifier means as a value.
    pub fn symbol_of_identifier(&self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        self.resolve_identifier(file, e, name, false)
            .unwrap_or(None)
    }

    /// `resolveEntityName` with `SymbolFlagsValue`, of an identifier that is an expression. `Err`: the code `Files::resolve` ends with.
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
            // `getSymbol`: an alias that stands for no value is not there where a value is wanted, and the search goes on further
            // out. Where that finds nothing it is an error, and the alias is all there is to go by.
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
        // `NameResolver.Resolve`: the arguments of a function around hide whatever goes by the name further out.
        if name == known::arguments && bound.is_arguments_object(e) {
            return Ok(None);
        }
        // What another declaration of a module, a namespace or an enum around exports, in whichever file, is in scope too, and comes
        // before the globals.
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
                // Not reached by the binder: nothing is said of it.
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
        // `getSymbol`: an alias that stands for no value is not there where a value is wanted. It is all `resolve_identifier` has to go by.
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
            return TypeId::ANY;
        }
        let cycles_before = self.cycles;
        let declared = self.type_of_symbol(sym);
        // `getTypeOfVariableOrParameterOrProperty` returns the type it computed to the first caller and `links.resolvedType` to every
        // later caller. The two differ after a circularity that goes through a call. A reference in the variable's own initializer
        // is never the first caller: the declaration is.
        let declared = if self.cycles != cycles_before
            && let Some(cached) = self.p.symbol_types.get(&sym)
            && cached != declared
            && self.is_in_own_initializer(file, e, sym)
        {
            cached
        } else {
            declared
        };
        let flags = self.files().flags(sym);
        let target = self.target_kind(file, e);
        // Only a variable that is no constant is given a value.
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
        // What is imported is narrowed like a variable.
        if !flags.intersects(SymFlags::VARIABLE | SymFlags::ALIAS) || target.definite {
            if target.definite
                && flags.intersects(SymFlags::VARIABLE)
                && self.is_in_compound_like_assignment(file, e)
            {
                return self.base_type_of_literal_type(declared);
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
        // `getBaseTypeOfLiteralType(flowType)`, of what an operator reads first and then gives a value to, `++` and `--` too.
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
        let mut at = bound.expr_parent[e.idx()];
        loop {
            at = match at {
                Parent::VarInit(d) if bound.pat_symbol[hir[d].pat.idx()] == sym.id => return true,
                Parent::None | Parent::File => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::PropKey(literal, _) if literal.is_some() => Parent::Expr(literal),
                other => self.outward(file, other),
            };
        }
    }

    /// Whether `e` is written to and not read: the left of `=`, or part of a pattern there.
    #[inline]
    pub fn is_assignment_target(&self, file: FileId, e: ExprId) -> bool {
        matches!(
            self.bound(file).get_assignment_target(self.hir(file), e),
            Some(AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf)
        )
    }

    /// `getAssignmentTargetKind`
    fn target_kind(&self, file: FileId, e: ExprId) -> TargetKind {
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

    /// `getAssignmentTargetKind(e) != AssignmentKindNone`: `e` is given a value, by `=` or in a pattern there, by an operator that
    /// reads it first, or by `++` and `--`.
    pub(super) fn is_written(&self, file: FileId, e: ExprId) -> bool {
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

    /// `GetThisContainer(e, false, false)`: the nearest function around `e` that is not an arrow function, or the class whose field
    /// is initialized and whether that is static. `None`: any other container.
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

    /// The same, of what is directly in `parent`. `Parent::Expr(e)` stands for `e` itself.
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
    fn check_this_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
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
            // What is expected of it has no say in the default of a parameter.
            if let Some(function) = hir.function_of(container).some()
                && let FnOwner::Expr(owner) = self.bound(file).fns[function.idx()].owner
                && !hir.is_in_parameter_initializer_before_containing_function(this)
                && !self.is_context_known(file, owner)
            {
                return TypeId::ANY;
            }
            // `tryGetThisTypeAt(container)`
            let outside = hir.get_this_container(container, false, false);
            let is_shadowed = self
                .try_get_this_type_at_ex(file, container, outside)
                .is_some_and(|t| self.is_known(t) && !is_global_this(self, t));
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

    /// `tryGetThisTypeAtEx`, before the flow of control has its say.
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
            // To the default of a parameter only a `this` parameter that is written counts.
            if !hir.is_in_parameter_initializer_before_containing_function(node) {
                // `getSignatureOfFullSignatureType` comes before `getSignatureFromDeclaration`.
                if let Some(sig) = self.full_signature(file, func)
                    && let Some(this) = self.sig_this_type(sig)
                {
                    return Some(this);
                }
                // `getSignatureFromDeclaration`: if only one accessor of a pair says what `this` is, that goes for both.
                let wanted = match f.kind {
                    FnKind::Getter => Some(FnKind::Setter),
                    FnKind::Setter => Some(FnKind::Getter),
                    _ => None,
                };
                if let Some(wanted) = wanted
                    && let Some(other) = self.sibling_accessor(file, func, wanted)
                {
                    let other = &self.hir(file)[other];
                    // `getAccessorThisParameter`: only of an accessor that takes what one of its kind takes.
                    if other.this_ty(self.hir(file)).is_some()
                        && other.params.len() == usize::from(wanted == FnKind::Setter)
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
        } else if self.p.files.options.strict_null_checks {
            TypeId::UNDEFINED
        } else {
            TypeId::UNDEFINED_DECLARED
        })
    }

    /// `getTypeOfSymbol(signature.thisParameter)`, which is `getTypeForVariableLikeDeclaration`: the type it has; without one, for a
    /// setter that of the `this` parameter of the getter, then `getContextualThisParameterType`, then `any`.
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
            return self.type_from_node(file, declared);
        }
        if let FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner
            && let Some(this) = self.contextual_this_parameter_type(file, func, owner)
        {
            return this;
        }
        // `reportImplicitAny`. The binder does not bind the name, so it is not `report_implicit_any_of_name`'s.
        let hir = self.hir(file);
        let this = &hir[f.this_param];
        if self.p.files.options.no_implicit_any
            && !this.flags.contains(Flags::REPARSED)
            && !matches!(f.kind, FnKind::Getter | FnKind::Setter)
            && !(hir.is_js && !self.is_check_js(file))
            && !self.is_private_within_ambient(file, func)
            && self.full_signature(file, func).is_none()
            && match self.bound(file).fns[func.idx()].owner {
                FnOwner::Expr(owner) => self.is_context_known(file, owner),
                _ => true,
            }
        {
            let start = hir[this.pat].pos;
            let args = [Arg::Text("this"), Arg::Type(TypeId::ANY)];
            self.error_at((file, start, start + 4), 7006, &args);
        }
        TypeId::ANY
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
        if self.is_context_sensitive_function_or_method(file, func, owner)
            && let Some(sig) = self.assigned_contextual_signature(file, func)
            && let Some(this) = self.sig_this_type(sig)
        {
            return Some(this);
        }
        if !self.p.files.options.no_implicit_this && !self.hir(file).is_js {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let Parent::Prop(p) = bound.expr_parent[owner.idx()] {
            let containing = bound.prop_owner[p.idx()];
            // `getContainingObjectLiteral`: of a method, an accessor, or a function that is all there is to the value of a property.
            let is_member = match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => true,
                PropKind::Init => !is_parenthesized(hir, owner),
                PropKind::Shorthand | PropKind::Spread => false,
            };
            if is_member
                && containing.is_some()
                && matches!(hir[containing].kind, ExprKind::Object(_))
            {
                // `getThisTypeOfObjectLiteralFromContextualType`: `ThisType<T>` in what the literal, or a literal it is directly the
                // value of a property of, is expected to be says so.
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
                // Otherwise it is what the literal is expected to be, or the literal.
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
        // `HasContextSensitiveParameters`: one that mentions `this` and does not say what it is takes that from where it stands.
        self.is_context_sensitive(file, owner)
            || f.kind != FnKind::Arrow
                && f.type_params.is_empty()
                && f.this_ty(self.hir(file)).is_none()
                && self.bound(file).fns[func.idx()].contains_this
    }

    /// `getTypeOfExpression`, asked once `file` is checked. `checkExpression` is not memoised: `e` and all it is made of are checked
    /// again, in the normal check mode and with nothing pushed. What is read is what tsgo keeps: resolved signatures, the types of
    /// symbols, the parameter and return types of functions. So what is expected of an argument is what the resolved signature
    /// takes, which decides anew which literal types stay (`isLiteralOfContextualType`) and what is a const context
    /// (`isConstContext`), and a generic function is as it is declared (`instantiateTypeWithSingleGenericCallSignature`). The kept
    /// type of an argument is the one the type arguments of its call were inferred from.
    pub(super) fn get_type_of_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        // The first check, in which the calls around `e` are resolved.
        self.type_of_expr(file, e);
        let outer = self.begin_recheck();
        let ty = match self.quick_type_of_expr(file, e) {
            Some(quick) => quick,
            None => self.check_expression_ex(file, e, CheckMode::empty()),
        };
        self.end_recheck(outer);
        ty
    }

    /// `getTypeOfSymbol` of a member of an object literal or a JSX attribute, of which `p` is `symbol.ValueDeclaration`:
    /// `checkPropertyAssignment`, `checkJsxAttribute` and the like, the first time it is asked. `checkObjectLiteral` does not ask.
    pub(super) fn get_type_of_literal_member(&mut self, file: FileId, p: PropId) -> TypeId {
        // `checkShorthandPropertyAssignment(declaration, true)`: of `{ a = 1 }` it is the name that is checked.
        let hir = self.hir(file);
        if hir[p].kind == PropKind::Shorthand
            && let ExprKind::Assign { target, .. } = hir[hir[p].value].kind
        {
            return self.type_of_expr(file, target);
        }
        self.type_of_literal_prop(file, p);
        let mode_outside = std::mem::replace(&mut self.mode_of_recheck, CheckMode::empty());
        let outer = self.begin_recheck();
        let ty = self.check_literal_member(file, p);
        self.end_recheck(outer);
        self.mode_of_recheck = mode_outside;
        ty
    }

    /// Whether `type_of_expr` has the type of `e` at hand.
    fn has_type_of_expr(&self, file: FileId, e: ExprId) -> bool {
        if self.is_rechecking() {
            self.rechecked_exprs.contains_key(&(file, e))
        } else {
            self.kept_type_of_expr(file, e).is_some()
        }
    }

    /// `checkPropertyAssignment`, `checkObjectLiteralMethod` and the like of the member `p`, as `checkObjectLiteral` asks them.
    fn check_literal_member(&mut self, file: FileId, p: PropId) -> TypeId {
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
        if self.leave() && is_memoised {
            self.rechecked_members.insert((file, p), ty);
        }
        let prop = &self.hir(file)[p];
        if matches!(prop.kind, PropKind::Init | PropKind::Method) {
            let literal = self.bound(file).prop_owner[p.idx()];
            self.add_intra_expression_inference_site(file, literal, prop.value, ty);
        }
        ty
    }

    /// `addIntraExpressionInferenceSite`, under what its three callers ask first. `node`, which is a `ty`, is a member or an element
    /// of `literal`. That something is expected of `literal` is not asked: `inferFromIntraExpressionSites` finds nothing otherwise.
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

    /// `checkObjectLiteral` gives the property it makes for the member `p` the declarations of `p` and the type it has just found
    /// (`links.resolvedType`). `PropSource::Literal` reads the kept type of `p`, so it stands for that only if the two are the same.
    /// The kept type is that of the check with nothing pushed, and is not asked for while something is.
    /// With it: `PropFlags::WRITTEN`, if it does not. An accessor is not looked at (`checkNodeDeferred`): it is what it is declared
    /// as whatever is expected, and what it returns may well lead back to what the literal is given to.
    pub(super) fn source_of_literal_member(
        &mut self,
        file: FileId,
        p: PropId,
        name: Atom,
    ) -> (PropSource, PropFlags) {
        if self.is_rechecking()
            && !matches!(self.hir(file)[p].kind, PropKind::Getter | PropKind::Setter)
        {
            let ty = self.check_literal_member(file, p);
            if !self.inference_contexts.is_empty() || ty != self.type_of_literal_prop(file, p) {
                let source = Self::literal_member_of_type(file, p, name, ty).source;
                return (source, PropFlags::WRITTEN);
            }
        }
        (PropSource::Literal(file, p), PropFlags::empty())
    }

    /// `checkObjectLiteral` makes a new type of the symbol of the literal every time. `kept`, whose members are those of the first
    /// check, stands for it if the members are the same.
    fn recheck_object_literal(&mut self, file: FileId, e: ExprId, kept: TypeId) -> TypeId {
        let mut shape = self.build_object_literal_shape(file, e);
        let has_nothing = shape.props.is_empty() && shape.index.is_empty();
        if has_nothing
            || self.inference_contexts.is_empty()
                && self
                    .members(kept)
                    .is_some_and(|members| *members.shape() == shape)
        {
            return kept;
        }
        shape.literal = Literalness::Literal;
        shape.symbol_declared_at = self.symbol_declaration_of_object_type(kept);
        shape.is_js_literal = self.has_js_literal_flag(kept);
        shape.contains_widening_type = self.has_member_with_widening_type(file, e, 0);
        let ty = self.synth(shape);
        self.with_propagated_non_inferrable_flag(ty)
    }

    /// `getSpreadType(left, right, symbol, objectFlags, readonly)`: `ty`, what the literal `e` with something spread in it has come
    /// to, has the symbol of the literal, and `ObjectFlagsContainsWideningType` if a member that is written has.
    fn with_propagated_widening_flag(&mut self, file: FileId, e: ExprId, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(_) => {
                self.map_type(ty, |c, m| c.with_propagated_widening_flag(file, e, m))
            }
            // What is yet to be known is not spread: `getIntersectionType([left, right])`.
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.with_propagated_widening_flag(file, e, part))
                    .collect();
                self.intersection(&parts)
            }
            TypeData::Synth(shape) if shape.literal.is_of_expression() => self.synth(Shape {
                contains_widening_type: true,
                symbol_declared_at: Some((file, self.hir(file)[e].pos)),
                ..(**shape).clone()
            }),
            _ => ty,
        }
    }

    /// `ObjectFlagsNonInferrableType` is one of `ObjectFlagsPropagatingFlags`: `ty`, what `checkObjectLiteral` has made, has it if the
    /// type of a property has.
    fn with_propagated_non_inferrable_flag(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| {
            let TypeData::Synth(shape) = c.data(m) else {
                return m;
            };
            let is_non_inferrable = |prop: &Prop| matches!(prop.source, PropSource::Copy(ty, ..) if c.is_non_inferrable(ty, 0));
            if !shape.props.iter().any(is_non_inferrable) {
                return m;
            }
            c.synth(Shape {
                literal: Literalness::Partial,
                ..(**shape).clone()
            })
        })
    }

    /// The class whose member the `super` at `e` is written in, going through arrow functions, and whether that member is static.
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
        if constructor == TypeId::NULL {
            return if is_call_expression {
                TypeId::ERROR
            } else {
                TypeId::NULL
            };
        }
        let is_static = hir.is_static(container);
        let Some(base) = self.base_types(sym).first().copied() else {
            let sigs = self.super_constructor_sigs(sym);
            let instance = match sigs.first() {
                Some(&sig) => self.sig_return(sig),
                None => TypeId::NEVER,
            };
            if self.is_known(constructor) && self.is_known(instance) {
                return TypeId::ERROR;
            }
            return if is_static || is_call_expression {
                constructor
            } else {
                TypeId::UNRESOLVED
            };
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

    /// `getTypeWithThisArgument(baseClassType, classType.thisType)`: in a member of `base` got through the `super` at `sup`, `this`
    /// is that of the class it is written in.
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
        let in_pattern = self.is_written(file, e);
        let context = self.apparent_type_of_contextual_type(file, e, ContextFlags::empty());
        let in_tuple_context = self.is_in_tuple_context(file, e, context);
        let wants_tuple = is_const || in_pattern || in_tuple_context;
        let exact = self.p.files.options.exact_optional_property_types;
        // `hasOmittedExpression`
        let mut has_hole = false;
        let mut types: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(items.len());
        let mut flags: SmallVec<[ElemFlags; 8]> = SmallVec::with_capacity(items.len());
        for item in hir.ids(items) {
            match hir[item].kind {
                ExprKind::Spread(inner) => {
                    let spread = self.type_of_expr(file, inner);
                    // What is like an array stands for its elements, which are spelled out once it is known what is made of them.
                    if self.is_array_or_tuple(spread)
                        || self.is_known(spread) && self.is_array_like(spread)
                    {
                        types.push(spread);
                        flags.push(ElemFlags::VARIADIC);
                    } else {
                        types.push(if in_pattern && self.is_known(spread) {
                            self.rest_element_of_target(spread)
                        } else {
                            self.checked_iterated_type(spread, false)
                        });
                        flags.push(ElemFlags::REST);
                    }
                }
                // Only under exactOptionalPropertyTypes may a hole be left out, and then so may all that follows it.
                ExprKind::Missing => {
                    has_hole |= exact;
                    types.push(self.undefined_or_missing());
                    flags.push(if exact {
                        ElemFlags::OPTIONAL
                    } else {
                        ElemFlags::REQUIRED
                    });
                }
                _ => {
                    let ty = self.type_of_expr(file, item);
                    // `checkExpressionForMutableLocation`: what is asserted is what it is said to be. `isConstContext`: beyond what goes
                    // for the array, it is what is expected of the element itself, which only counts for a literal.
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
        if wants_tuple {
            // Not to be written to, unless what is expected is.
            let list = self.array_of(TypeId::ANY);
            let is_readonly = is_const
                // `someType` asks `never` itself, which is assignable to any list.
                && context != Some(TypeId::NEVER)
                && !context.is_some_and(|c| {
                    self.parts(c).iter().any(|&m| {
                        !self.is_any(m) && !self.is_nullish(m) && self.is_assignable(m, list)
                    })
                });
            let made_before = self.p.types.len();
            let ty = self.normalized_tuple(&types, &flags, is_readonly);
            // `createArrayLiteralType`, which what is assigned to does not get to.
            if !in_pattern {
                self.p.types.mark_manifest(ty, made_before);
                self.note_array_literal_type(file, e, ty);
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
            TypeId::UNDEFINED
        };
        let element = if types.is_empty() {
            nothing
        } else {
            self.union_reduced(&types)
        };
        let made_before = self.p.types.len();
        let ty = self.array_of(element);
        self.p.types.mark_manifest(ty, made_before);
        self.note_array_literal_type(file, e, ty);
        ty
    }

    /// `createArrayLiteralType` sets `ObjectFlagsArrayLiteral`, which a type does not hold here: the inference that `e` is checked for
    /// is told (`Inference::array_literals`).
    fn note_array_literal_type(&mut self, file: FileId, e: ExprId, ty: TypeId) {
        if let Some(at) = self.get_inference_context(file, e)
            && let Some(inference) = &mut self.inference_contexts[at].context
            && !inference.array_literals.contains(&ty)
        {
            inference.array_literals.push(ty);
        }
    }

    /// `inTupleContext`, of the array literal `e`, which is expected to be a `context`.
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

    /// `isGenericMappedType(t) && t.nameType == nil && getHomomorphicTypeVariable(t.target ?? t) != nil`: `{ [P in keyof T]: X }`
    /// that waits for `T` and renames nothing, which makes a tuple of a tuple.
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

    /// What `...c` in the target of a destructuring assignment stands for, where `c` is a `target`, which is not like an array
    /// (`checkArrayLiteral`): what it has under a number, else what it yields, else `unknown`. That it is neither is no error here.
    fn rest_element_of_target(&mut self, target: TypeId) -> TypeId {
        if let Some(element) = self.index_type_of_type(target, TypeId::NUMBER) {
            return element;
        }
        self.iterated_type_if_any(target, false)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// `isJSLiteralType`
    pub(super) fn is_js_literal_type(&mut self, ty: TypeId) -> bool {
        // The flag means nothing under noImplicitAny.
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
                    | Origin::WidenedLiteral(_, _, is_js_literal, _),
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
        self.look_at_members(file, props);
        self.check_spread_overrides(file, props);
        if !props.iter().any(|p| hir[p].kind == PropKind::Spread) {
            let scope = self.scope_of_expr(file, e);
            let mapper = self.identity_mapper_with_adopted(file, scope);
            let is_js_literal = self.is_js_literal(file, e);
            let kept = self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, is_js_literal, false, true),
                mapper,
            });
            return if self.is_rechecking() {
                self.recheck_object_literal(file, e, kept)
            } else {
                kept
            };
        }
        // With spreads, what is in it depends on what is spread: work it out now.
        let scope = self.scope_of_expr(file, e);
        let literal_mapper = self.identity_mapper_with_adopted(file, scope);
        let is_const = self.is_const_context(file, e);
        let mut result = TypeId::EMPTY_OBJECT;
        let mut pending = Shape::default();
        // Where the members written since the last spread begin.
        let mut run = props.start;
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                if let Some(segment) = self.written_segment(
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
                // 2698 and `spread = c.errorType`
                if self.is_known(spread) && !self.is_valid_spread_type(spread) {
                    result = TypeId::ERROR;
                    continue;
                }
                if self.is_error_type(result) {
                    continue;
                }
                let spread = self.merge_object_or_nothing(spread);
                result = self.spread_in_literal(result, spread, is_const);
                if result == TypeId::UNRESOLVED {
                    return result;
                }
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            // A getter and a setter are one property, wherever in the literal they are, and the getter says what it is.
            // `getSpreadSymbol`: whether an accessor can be written to is not copied, that it cannot be read is.
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
            let (source, written) = self.source_of_literal_member(file, source, name);
            pending.props.push(Prop {
                name,
                flags: flags | written,
                source,
                mapper: literal_mapper,
            });
        }
        // What is written after the last spread is not added to an error type.
        if self.is_error_type(result) {
            return TypeId::ERROR;
        }
        if let Some(segment) = self.written_segment(
            file,
            props,
            Span::new(run, props.start + props.len - run),
            &mut pending,
            is_const,
        ) {
            result = self.spread_in_literal(result, segment, is_const);
        }
        if self.has_member_with_widening_type(file, e, 0) {
            result = self.with_propagated_widening_flag(file, e, result);
        }
        self.with_propagated_non_inferrable_flag(result)
    }

    /// `checkObjectLiteral` looks at every name and then at every value there and then: what leads back to something that is being
    /// worked out is a circle. Accessors wait (`checkNodeDeferred`), and what is spread is looked at where it is spread. The members
    /// are asked for one by one when they are read: what they are, and how sure that is, says nothing about the literal.
    fn look_at_members(&mut self, file: FileId, props: Span<PropId>) {
        let hir = self.hir(file);
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
                self.check_node_deferred_where_it_is_worked_out(file, prop.value);
            }
            if matches!(prop.kind, PropKind::Getter | PropKind::Setter) {
                continue;
            }
            self.check_literal_member(file, p);
        }
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
                if let Some(cached) = self.p.context_free_types.get(&(file, func)) {
                    return cached;
                }
                let ret = self.return_type_of_fn_uncached(file, func, check_mode);
                let return_only_signature = self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: Box::new([]),
                    ret,
                    this: None,
                    of: Box::new([]),
                });
                let return_only_type = self.synth(Shape {
                    call: vec![return_only_signature],
                    literal: Literalness::Partial,
                    ..Shape::default()
                });
                // What rests on a question that came back to itself holds only for now.
                if self.is_innermost_tainted() {
                    return return_only_type;
                }
                return self
                    .p
                    .context_free_types
                    .insert((file, func), return_only_type);
            }
            return self.any_function_type();
        }
        self.contextually_check_function_expression_or_object_literal_method(
            file, e, func, check_mode,
        );
        let scope = self.bound(file).fns[func.idx()].scope;
        let parent = self.bound(file).scopes[scope.idx()].parent;
        let mapper = self.identity_mapper_with_adopted(file, parent);
        self.intern(TypeData::Fns {
            decls: Box::new([(file, func)]),
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
        if self.context_checked(file, func).is_some() {
            return;
        }
        let contextual_signature = self.contextual_signature(file, func);
        // Obtaining the contextual type may have got back to here, during overload resolution of the call around.
        if self.context_checked(file, func).is_some() {
            return;
        }
        let hir = self.hir(file);
        let f = &hir[func];
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
                // `len(node.Parameters())` counts a `this` that is written.
                && self.sig_params(contextual).len()
                    > f.params.len() + usize::from(f.this_ty(hir).is_some())
                && let Some(level) = level
            {
                self.with_inference_context(level, |c, n| {
                    c.infer_from_annotated_parameters_and_return(file, func, contextual, n);
                });
            }
        }
        let holds = !self.is_innermost_tainted();
        self.context_checking.push(((file, func), assigned));
        // `assignContextualParameterTypes`, `assignNonContextualParameterTypes`
        if is_context_sensitive {
            for p in f.params.iter() {
                self.type_of_param(file, p);
            }
        }
        if contextual_signature.is_some()
            && f.ret.is_none()
            && self.p.fn_return_types.get(file, func.idx()).is_none()
            && self.enter(Query::ReturnAtFirstLook(file, func))
        {
            let ty = self.return_type_of_fn_uncached(file, func, check_mode);
            // `if signature.resolvedReturnType == nil`
            if self.leave() && self.p.fn_return_types.get(file, func.idx()).is_none() {
                self.p.fn_return_types.set(file, func.idx(), ty);
            }
        }
        // `checkSignatureDeclaration` has no check mode.
        let outer = self.suspend_recheck();
        self.look_at_signature(file, func);
        self.end_recheck(outer);
        self.context_checking.pop();
        if holds {
            self.p.context_checked.insert((file, func), assigned);
        }
    }

    /// `NodeCheckFlagsContextChecked`, with what `assignContextualParameterTypes` was given.
    pub(super) fn context_checked(&self, file: FileId, func: FnId) -> Option<Option<SigId>> {
        match self
            .context_checking
            .iter()
            .rev()
            .find(|c| c.0 == (file, func))
        {
            Some(under_way) => Some(under_way.1),
            None => self.p.context_checked.get(&(file, func)),
        }
    }

    /// What `assignContextualParameterTypes` reads of `context` for `func`, in its order.
    fn types_assigned_from_contextual_signature(
        &mut self,
        file: FileId,
        func: FnId,
        context: SigId,
    ) -> SmallVec<[TypeId; 8]> {
        let hir = self.hir(file);
        let mut read: SmallVec<[TypeId; 8]> = SmallVec::new();
        // `sig.typeParameters = context.typeParameters`: what they extend goes through the mapper as well.
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

    /// `instantiateSignature(sig, n.mapper)`. `n.nonFixingMapper`, if that `may_not_fix` and `sig` ends in `...args: T`. The mapper is
    /// made for what will be `read` of the instantiation.
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
            for &pair in self.p.types.mapping(mapper) {
                if !pairs.contains(&pair) {
                    pairs.push(pair);
                }
            }
        }
        if pairs.is_empty() {
            return sig;
        }
        let mapper = self.p.types.mapper(pairs);
        self.instantiate_sig(sig, mapper)
    }

    /// `checkExpressionCachedEx`
    pub(super) fn check_expression_cached_ex(
        &mut self,
        file: FileId,
        e: ExprId,
        check_mode: CheckMode,
    ) -> TypeId {
        // FOR SPEED: these make nothing of the mode but hand it to `getResolvedSignature`, which keeps what it finds the first time.
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
        // What is found under one mode is not what is found under another.
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

    /// `checkSignatureDeclaration`: what is written on a function is looked at with the function, what is in it later. The parameters
    /// themselves are not being worked out meanwhile: a circle through what is written on one is not about it.
    fn look_at_signature(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        let f = &hir[func];
        for tp in f.type_params.iter() {
            self.type_from_node(file, hir[tp].constraint);
            self.type_from_node(file, hir[tp].default);
        }
        self.type_from_node(file, f.this_ty(hir));
        for p in f.params.iter() {
            let param = &hir[p];
            if param.ty.is_some() {
                self.type_from_node(file, param.ty);
            } else if !matches!(hir[param.pat].kind, PatKind::Ident(_)) {
                // `getTypeFromBindingPattern`: what a pattern implies goes by the defaults in it.
                self.type_of_param(file, p);
            }
            if param.default.is_some() {
                self.look_at(file, param.default);
            }
        }
        self.type_from_node(file, f.ret);
    }

    /// `createObjectLiteralType` for the members `run` of the object literal `props`, written one after the other between two
    /// spreads. `named` has those with a name that can be told, and is left empty. `None`: nothing is written there.
    fn written_segment(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        run: Span<PropId>,
        named: &mut Shape,
        readonly: bool,
    ) -> Option<TypeId> {
        if run.is_empty() {
            return None;
        }
        named.index = self.index_infos_of_object_literal(file, props, run, readonly);
        named.literal = Literalness::Written;
        Some(self.synth(std::mem::take(named)))
    }

    /// `getSpreadType`, which in a const context (`readonly`) makes something that cannot be written to.
    fn spread_in_literal(&mut self, left: TypeId, right: TypeId, readonly: bool) -> TypeId {
        let spread = self.spread(left, right);
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
            let mut shape = (**shape).clone();
            for prop in &mut shape.props {
                // A property of the left that the right may or may not replace is made anew, and nothing is said of writing to it.
                let is_of_both = c.parts(right).iter().any(|&r| {
                    c.prop_of(r, prop.name)
                        .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
                }) && c
                    .parts(left)
                    .iter()
                    .any(|&l| c.prop_of(l, prop.name).is_some());
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

    /// The accessor of kind `kind` that goes by `name` among `props`.
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

    /// `getOptionalSymbolFlagForNode`: whether `p` is a method of an object literal written `name?() {}` (1162).
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

    /// `getObjectLiteralIndexInfo`, for each of string, number and symbol that a name worked out among the members `run` of the
    /// object literal `props` can be any of (`checkObjectLiteral`): under such a key is whatever a member of `run` that goes by
    /// such a name holds.
    fn index_infos_of_object_literal(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        run: Span<PropId>,
        readonly: bool,
    ) -> Vec<IndexInfo> {
        let hir = self.hir(file);
        // Strings, numbers, symbols.
        let mut wanted = [false; 3];
        for p in run.iter() {
            let PropKey::Computed(k) = hir[p].key else {
                continue;
            };
            if self.member_name(file, hir[p].key).is_some() {
                continue;
            }
            let key = self.type_of_expr(file, k);
            if !self.is_known(key) {
                // Nothing is known of the key: with any string for one, nothing will be found missing.
                wanted[0] = true;
            } else if self.is_assignable(key, TypeId::NUMBER) {
                wanted[1] = true;
            } else if self.is_assignable(key, TypeId::SYMBOL) {
                wanted[2] = true;
            } else {
                // Of any other type it is an error, and says nothing.
                let any_key = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                wanted[0] |= self.is_assignable(key, any_key);
            }
        }
        if !wanted.contains(&true) {
            return Vec::new();
        }
        // What each member holds, `isSymbolWithSymbolName`, `isSymbolWithNumericName`, and `prop.Declarations[0]` if
        // `isSymbolWithComputedName`.
        let mut held: Vec<(TypeId, bool, bool, Option<PropId>)> = Vec::with_capacity(run.len());
        for p in run.iter() {
            let prop = &hir[p];
            let mut source = p;
            let (is_symbol, is_numeric) = match self.member_name(file, prop.key) {
                Some(name) => {
                    // A getter and a setter are one property, and the getter says what it is.
                    if prop.kind == PropKind::Setter
                        && let Some(getter) =
                            self.accessor_of_literal(file, props, p, name, PropKind::Getter)
                    {
                        source = getter;
                    }
                    (
                        self.files().atoms.is_symbol_name(name),
                        self.is_numeric_name(name),
                    )
                }
                None => {
                    let PropKey::Computed(k) = prop.key else {
                        continue;
                    };
                    let key = self.type_of_expr(file, k);
                    if self.is_known(key) {
                        (
                            self.is_assignable(key, TypeId::SYMBOL),
                            self.is_assignable(key, TypeId::NUMBER),
                        )
                    } else {
                        (false, false)
                    }
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
        let mut infos = Vec::new();
        for (i, key) in [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]
            .into_iter()
            .enumerate()
        {
            if !wanted[i] {
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
                components: self.p.types.intern_components(&components),
            });
        }
        infos
    }

    pub(super) fn build_object_literal_shape(&mut self, file: FileId, e: ExprId) -> Shape {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[e].kind else {
            return Shape::default();
        };
        let is_const = self.is_const_context(file, e);
        let in_pattern = self.is_assignment_target(file, e);
        // `patternForType`: what a pattern without computed names implies the literal to be.
        let implied = if self.may_be_expected_by_pattern(file, e) {
            self.apparent_type_of_contextual_type(file, e, ContextFlags::empty())
                .filter(|&context| self.pattern_of_type(context) == Some(false))
        } else {
            None
        };
        let mut shape = Shape::default();
        shape.props.reserve_exact(props.len());
        // The names of `shape.props`, of a literal with many members.
        let has_many = props.len() > 16;
        let mut names = crate::util::FxHashSet::<Atom>::default();
        if has_many {
            names.reserve(props.len());
        }
        for p in props.iter() {
            let prop = &hir[p];
            // A name that is only known when it runs makes no property.
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let mut flags = PropFlags::empty();
            match prop.kind {
                PropKind::Getter => {
                    flags |= PropFlags::ACCESSOR;
                    // `isReadonlySymbol`: an accessor nothing sets.
                    if self
                        .accessor_of_literal(file, props, p, name, PropKind::Setter)
                        .is_none()
                    {
                        flags |= PropFlags::READONLY;
                    }
                }
                PropKind::Setter => {
                    flags |= PropFlags::ACCESSOR;
                    // `getSpreadSymbol`: one nothing gets, of which a copy holds `undefined`.
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
                    // `checkObjectLiteral`: accessors are what they are declared as, whatever the context.
                    if is_const {
                        flags |= PropFlags::READONLY;
                    }
                    // `hasDefaultValue`: what has a default in a pattern that is assigned to may be left out. So may what the
                    // pattern the literal is given to has a default for.
                    let has_default = in_pattern
                        && prop.value.is_some()
                        && matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
                        && !is_parenthesized(hir, prop.value);
                    if has_default
                        || implied.is_some_and(|implied| {
                            self.prop_of(implied, name)
                                .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
                        })
                    {
                        flags |= PropFlags::OPTIONAL;
                    }
                }
            }
            let mut source = p;
            let may_be_there = !has_many || !names.insert(name);
            if may_be_there && let Some(existing) = shape.props.iter().position(|x| x.name == name)
            {
                if prop.kind == PropKind::Setter {
                    // A getter and a setter: the getter says what it is.
                    if !shape.props[existing].flags.contains(PropFlags::METHOD) {
                        continue;
                    }
                    // `declareSymbolEx` refuses a method next to an accessor: the last member of the name is the property.
                    if let Some(getter) =
                        self.accessor_of_literal(file, props, p, name, PropKind::Getter)
                    {
                        source = getter;
                    }
                }
                shape.props.remove(existing);
            }
            let (source, written) = self.source_of_literal_member(file, source, name);
            shape.props.push(Prop {
                name,
                flags: flags | written,
                source,
                mapper: MapperId::IDENTITY,
            });
        }
        shape.index = self.index_infos_of_object_literal(file, props, props, is_const);
        // "Expando object literals have empty properties but filled exports"
        let owner = self.bound(file).expr_symbol[e.idx()];
        self.with_expandos(shape, file, owner)
    }

    /// Whether what the object literal `e` is expected to be can be what a pattern implies: `e` is what a pattern without a type of
    /// its own is given, or a default in one, or part of such. Nobody else has to be asked what is expected.
    fn may_be_expected_by_pattern(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_pattern =
            |pat: PatId| matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::VarInit(d) => return hir[d].ty.is_none() && is_pattern(hir[d].pat),
                Parent::ParamDefault(p) => return hir[p].ty.is_none() && is_pattern(hir[p].pat),
                Parent::PatPropDefault(p) => return is_pattern(hir[p].value),
                Parent::PatElemDefault(p) => return is_pattern(hir[p].pat),
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return false;
                    }
                    owner
                }
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    } if value == at => {
                        return target.is_some()
                            && matches!(
                                hir[target].kind,
                                ExprKind::Object(_) | ExprKind::Array(_)
                            );
                    }
                    ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { .. } => parent,
                    _ => return false,
                },
                _ => return false,
            };
        }
    }

    /// The type of a property of an object literal, as something that can be assigned to later.
    pub(super) fn type_of_literal_prop(&mut self, file: FileId, p: PropId) -> TypeId {
        if let Some(known) = self.p.literal_prop_types.get(file, p.idx()) {
            return known;
        }
        if let Some(held) = self.held_for_now(file, p) {
            return held;
        }
        if !self.enter(Query::LiteralProp(file, p)) {
            return TypeId::UNRESOLVED;
        }
        let cycles_before = self.cycles;
        let ty = self.type_of_literal_prop_uncached(file, p);
        let came_back = self.cycles != cycles_before;
        if self.leave() {
            self.p.literal_prop_types.set(file, p.idx(), ty);
        } else {
            self.hold_for_now(file, p, ty, came_back);
        }
        ty
    }

    fn type_of_literal_prop_uncached(&mut self, file: FileId, p: PropId) -> TypeId {
        let hir = self.hir(file);
        let prop = &hir[p];
        if prop.value.is_none() {
            // `checkJsxAttribute`: `trueType` for an attribute without an initializer, whatever is expected of it.
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
                        && self.is_assignment_target(file, prop.value) =>
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
                // What is asserted is what it is said to be.
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
            // `checkVoidExpression`: the operand waits.
            UnOp::Void => {
                self.check_node_deferred_where_it_is_worked_out(file, e);
                TypeId::UNDEFINED
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
                // `checkPrefixUnaryExpression`: it takes a literal written right after the sign to make a literal type.
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
                        let digits = self.files().atoms.bytes(text);
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
                            let at = self.place_of_written_expr(file, operand);
                            self.error_at(at, 2469, &[Arg::Text(operator)]);
                        }
                        if op != UnOp::Plus {
                            return self.unary_result_type(ty);
                        }
                        if self.maybe_type_of_kind_considering_base_constraint(ty, is_bigint) {
                            let base = self.base_of_literal(ty);
                            let at = self.place_of_written_expr(file, operand);
                            self.error_at(at, 2736, &[Arg::Text("+"), Arg::Type(base)]);
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

    /// `checkBinaryLikeExpression`, which looks at the left and then at the right, whatever the operator makes of them. `e`:
    /// `errorNode`, which is `left op right` or `left op= right`.
    fn type_of_binary(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> TypeId {
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        // `&&=`, `||=`, `??=`: whatever comes of the two, what is on the right is put where the left is.
        if is_assignment && matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            let (l, r, is_sure) = self.check_operands(file, left, right);
            if is_sure {
                self.check_assignment_operator(file, op, left, right, l, r);
            }
        }
        match op {
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let (l, r, is_sure) = self.check_operands(file, left, right);
                if is_sure
                    && self.check_for_disallowed_es_symbol_operand(file, e, op, left, right, l, r)
                {
                    let l = self.check_non_null_type(file, left, l);
                    let r = self.check_non_null_type(file, right, r);
                    let (l, r) = (self.base_for_comparison(l), self.base_for_comparison(r));
                    self.report_operator_error_unless(file, e, op, l, r, can_be_ordered);
                }
                TypeId::BOOLEAN
            }
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                // `CheckModeTypeOnly`: while a loop is under way the operands may be narrower than they are.
                let (l, r, is_sure) = self.check_operands(file, left, right);
                if is_sure && self.flow_loops.is_empty() {
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
                let (l, r, is_sure) = self.check_operands(file, left, right);
                if l == TypeId::SILENT_NEVER || r == TypeId::SILENT_NEVER {
                    return TypeId::SILENT_NEVER;
                }
                if is_sure && op == BinOp::In {
                    self.check_in_expression(file, left, right, l, r);
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
                // What a type parameter extends is only looked at to see whether it is known.
                let (lb, rb) = (
                    self.constraint_for_operator(l),
                    self.constraint_for_operator(r),
                );
                if lb == TypeId::UNRESOLVED || rb == TypeId::UNRESOLVED {
                    // A string and anything at all make a string. `never` goes for a number as well.
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
                // Symbols are only looked for once the two can be added.
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

    /// `isTypeAssignableToKindEx`, for one of number, bigint and string: `like` says whether a type is of the kind as it stands,
    /// `target` is what all of the kind can be assigned to.
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
            // `string & { brand: 1 }` is a string, to an operator.
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

    /// `getJsxNamespaceAt`. A `JSX` that stands for nothing that can be found is as good as none: on to the global one.
    pub(super) fn jsx_namespace_at(
        &mut self,
        file: FileId,
        is_opening_fragment: bool,
    ) -> Option<Sym> {
        let files = self.files();
        // `getJsxNamespaceContainerForImplicitImport`: the module elements are made with, if it can be found.
        let member = match files
            .jsx_runtime(file)
            .and_then(|spec| files.module_of_specifier(file, spec))
        {
            Some(module) => files.module_export(module, known::JSX),
            None => {
                let name =
                    super::errors_jsx::jsx_namespace(files, self.hir(file), is_opening_fragment);
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

    /// `getJsxElementTypeAt`: without a `JSX.Element` it is the error type, which can be anything.
    pub(super) fn jsx_element_type(&mut self, file: FileId) -> TypeId {
        self.jsx_type(file, known::Element).unwrap_or(TypeId::ERROR)
    }
}
