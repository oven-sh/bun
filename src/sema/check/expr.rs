//! The types of expressions.

use super::errors_order::Named;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId};
use smallvec::SmallVec;

impl Slots {
    /// What a slot that holds `raw` says: the type, and whether it is uncertain.
    #[inline]
    fn unpack(raw: u32) -> Option<(TypeId, bool)> {
        match raw & !Self::UNCERTAIN {
            0 => None,
            n => Some((TypeId(n - 1), raw & Self::UNCERTAIN != 0)),
        }
    }
}

/// `getAssignmentTargetKind`
#[derive(Copy, Clone)]
struct TargetKind {
    /// `is_assignment_target`
    assigned: bool,
    /// `AssignmentKindDefinite`: given a value by `=` or in a pattern there, or by `&&=`, `||=` or `??=`. It is what it is declared
    /// as, whatever has been found out about it on the way.
    definite: bool,
    /// `is_written`
    written: bool,
}

impl<'p> Checker<'p> {
    /// The type of `e` where it stands, after narrowing. The entry point for questions from outside.
    pub fn type_at(&mut self, file: FileId, e: ExprId) -> TypeId {
        self.prepare_enclosing(file, e);
        let ty = self.type_of_expr(file, e);
        // `getTypeOfExpression`: the quick type comes first. It says something else only of a `new` that is refused.
        if ty == TypeId::ANY {
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

    /// `checkExpressionEx`
    pub fn type_of_expr(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.trace_cycles {
            self.looked_at.insert((file, e));
        }
        let ty = self.type_of_expr_as_written(file, e);
        // `instantiateTypeWithSingleGenericCallSignature`: a generic function met while type arguments are inferred from it is what
        // it is when called the way that is expected there. That holds for the inference, not for `e`: it is not kept.
        if self.resolving.is_empty() {
            return ty;
        }
        if let Some(ty) = self.type_with_nested_generic_functions(file, e) {
            return ty;
        }
        if !self.may_have_generic_signature(ty) || self.is_accessed_or_called(file, e) {
            return ty;
        }
        self.instantiated_where_it_stands(file, e, ty)
    }

    #[inline(never)]
    fn instantiated_where_it_stands(&mut self, file: FileId, e: ExprId, ty: TypeId) -> TypeId {
        // What is expected of `e` may go by what `e` is.
        if !self.enter(Query::Expr(file, e)) {
            return ty;
        }
        let ty = self.instantiate_generic_function_in_context(file, e, ty);
        self.leave();
        ty
    }

    /// Whether `ty` can have a signature with type parameters, as far as can be told without asking for its members.
    fn may_have_generic_signature(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Fns { decls, .. } => decls
                .iter()
                .any(|&(file, func)| !self.hir(file)[func].type_params.is_empty()),
            TypeData::Anon { origin, .. } => !matches!(
                origin,
                Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..)
            ),
            TypeData::Ref { .. } | TypeData::Synth(_) => true,
            _ => false,
        }
    }

    /// Whether `e` is the `a` of `a.b`, `a[b]`, `a()` or `new a()`, which is looked at without regard to what is around.
    fn is_accessed_or_called(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == e,
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                hir[c].callee == e
            }
            _ => false,
        }
    }

    /// The type that is kept for `e`, and whether it rests on something that could not be found out.
    #[inline]
    pub(super) fn kept_type_of_expr(&self, file: FileId, e: ExprId) -> Option<(TypeId, bool)> {
        if file == self.file_at_hand
            && let Some(slot) = self.exprs_at_hand.get(e.idx())
        {
            return Slots::unpack(slot.load(std::sync::atomic::Ordering::Relaxed));
        }
        Slots::unpack(self.p.expr_types.0.raw((file, e.0)))
    }

    #[inline]
    fn keep_type_of_expr(&self, file: FileId, e: ExprId, ty: TypeId, uncertain: bool) {
        if file == self.file_at_hand
            && let Some(slot) = self.exprs_at_hand.get(e.idx())
        {
            let mark = if uncertain { Slots::UNCERTAIN } else { 0 };
            slot.store((ty.0 + 1) | mark, std::sync::atomic::Ordering::Relaxed);
        } else if uncertain {
            self.p.expr_types.set_uncertain(file, e.idx(), ty);
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
            && let Some((known, uncertain)) = self.kept_type_of_expr(file, e)
        {
            self.uncertain |= uncertain;
            return known;
        }
        self.type_of_expr_not_kept(file, e)
    }

    /// The same, of an `e` that is there and whose type is not kept, or may be looked at afresh.
    fn type_of_expr_not_kept(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `getTypeFromBindingElement`: the defaults in a pattern are looked at afresh every time it is worked out what the pattern
        // implies its initializer to be. The names of the pattern are anything meanwhile.
        let mut afresh = false;
        let mut visible_from = self.resolution_start;
        if !self.contextual_binding_patterns.is_empty() {
            if let Some(floor) = self.contextual_pattern_floor(file, e) {
                afresh = true;
                visible_from = visible_from.max(floor.min(self.stack.len()));
            }
            if !afresh && let Some((known, uncertain)) = self.kept_type_of_expr(file, e) {
                self.uncertain |= uncertain;
                return known;
            }
        }
        // Resolving the calls around it may well have settled it.
        if self.prepare_question_about_expr(file, e)
            && !afresh
            && let Some((known, uncertain)) = self.kept_type_of_expr(file, e)
        {
            self.uncertain |= uncertain;
            return known;
        }
        if !self.reporting_nonexistent.is_empty()
            && let Some(ty) = self.type_of_access_being_reported(file, e)
        {
            return ty;
        }
        if !self.flow_loops.is_empty()
            && let Some(ty) = self.recheck_loop_reference(file, e)
        {
            return ty;
        }
        if matches!(
            self.hir(file)[e].kind,
            ExprKind::Binary { .. } | ExprKind::Call(_)
        ) {
            self.resolve_chain_from_the_inside(file, e);
        }
        let (ty, uncertain, holds) = match self.type_of_plain_literal(file, e) {
            Some(ty) => (ty, false, true),
            None => {
                // `checkExpressionWithContextualType` has no guard against re-entry. A visit begun before the pattern was looked at
                // this way took its names for what they are declared as: this one does not go the same way.
                let resolution_start = std::mem::replace(&mut self.resolution_start, visible_from);
                let entered = self.enter(Query::Expr(file, e));
                self.resolution_start = resolution_start;
                if !entered {
                    return TypeId::UNRESOLVED;
                }
                let around = std::mem::replace(&mut self.uncertain, false);
                let ty = self.type_of_expr_uncached(file, e);
                let ty = self.force(ty);
                let uncertain = self.uncertain;
                self.uncertain |= around;
                (ty, uncertain, self.leave())
            }
        };
        if holds && !afresh {
            self.keep_type_of_expr(file, e, ty, uncertain);
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
        ) || self.timed_out
            || self.stack.len() >= MAX_DEPTH
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
            ExprKind::String(s) if hir.text.get(hir[e].pos as usize) != Some(&b'#') => {
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
                self.p.circular_returns.insert((f, func), ());
            }
        }
        Some(TypeId::ANY)
    }

    /// `getTypeOfExpression` has no guard against re-entry. A reference that a back edge of its own loop evaluates again is checked
    /// again, and its flow analysis ends at the loop with the types collected so far (`flowLoopStack`, `getTypeAtFlowLoopLabel`).
    /// `None` if `e` is not such a reference.
    fn recheck_loop_reference(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let first = self
            .stack
            .iter()
            .rposition(|&q| q == Query::Expr(file, e))?;
        if !self.is_reference_of_loop_under_way(file, e, first) {
            return None;
        }
        // Hide the first visit from `enter`, which still refuses when time, native stack or query depth run out.
        let resolution_start = std::mem::replace(&mut self.resolution_start, self.stack.len());
        let entered = self.enter(Query::Expr(file, e));
        self.resolution_start = resolution_start;
        if !entered {
            return Some(TypeId::UNRESOLVED);
        }
        // The loop type is incomplete: cache neither this result nor anything computed since the first visit.
        self.taint_from(first + 1);
        let ty = self.type_of_expr_uncached(file, e);
        let ty = self.force(ty);
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

    /// Whether the type of `e`, which has been asked for, rests on something that could not be found out.
    #[inline]
    pub(super) fn is_uncertain(&self, file: FileId, e: ExprId) -> bool {
        self.kept_type_of_expr(file, e)
            .is_some_and(|(_, uncertain)| uncertain)
    }

    /// Looks at an operand nothing is made of, as `checkExpression` does: what leads back to something that is being worked out
    /// is a circle. What the operand is, and how sure that is, says nothing about the expression it is part of.
    fn look_at(&mut self, file: FileId, e: ExprId) {
        let uncertain = self.uncertain;
        self.type_of_expr(file, e);
        self.uncertain = uncertain;
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
                        ExprKind::Binary { left, .. }
                            if c.kept_type_of_expr(file, at).is_none() =>
                        {
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
                        if is_link && c.kept_type_of_expr(file, at).is_some() {
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
        // What a link is, and how sure that is, is read again by whoever goes by it.
        let uncertain = self.uncertain;
        for link in chain.into_iter().rev() {
            self.type_of_expr_as_written(file, link);
            // What is not kept would be worked out again by every link after it.
            if self.kept_type_of_expr(file, link).is_none() {
                break;
            }
        }
        self.uncertain = uncertain;
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

    /// `isConstContext`: whether `e` is under `as const`, or where a `const` type parameter is expected, with nothing in between
    /// that starts afresh.
    pub fn in_const_context(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let mut at = e;
        // The way from what encloses `e` down to it: a property, or `None` for an element.
        let mut path: SmallVec<[Option<Atom>; 8]> = SmallVec::new();
        // Under a key that is worked out and cannot be told: no matter below `as const`, which asks for no way down.
        let mut lost = false;
        // What a function on the way returns.
        let mut returned = ExprId::NONE;
        // How long the way was when it first went past what `isConstContext` does not go up through, though what is expected
        // comes down through it (`getContextualType`): a conditional, a spread into an object literal.
        let mut broken: Option<usize> = None;
        // How long the way is from `e` to the first on it of which it counts what is expected of it. Of `e` itself that takes a
        // literal (`isValidConstAssertionArgument`).
        let mut nearest = usize::from(!self.is_valid_const_assertion_argument(file, e));
        loop {
            match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    // Which does not reach into functions.
                    ExprKind::AsConst(_) => return returned.is_none() && broken.is_none(),
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != at => {
                        if lost
                            || !self.is_const_argument(
                                file,
                                parent,
                                at,
                                &path,
                                nearest,
                                broken.unwrap_or(path.len()),
                            )
                        {
                            return false;
                        }
                        // By the time the function is looked at the type parameter may have been settled.
                        return returned.is_none() || self.is_const_by_contextual_type(file, e);
                    }
                    // What a generator written where one is expected yields: on from the generator.
                    ExprKind::Yield { star: false, .. } => {
                        let Some(func) = self.enclosing_fn_of_expr(file, parent) else {
                            return false;
                        };
                        let FnOwner::Expr(function) = bound.fns[func.idx()].owner else {
                            return false;
                        };
                        if hir[func].ret.is_some() {
                            return false;
                        }
                        path.push(Some(known::returned));
                        if returned.is_none() {
                            returned = at;
                        }
                        at = function;
                    }
                    ExprKind::Array(_) => {
                        path.push(None);
                        at = parent;
                    }
                    // `getContextualType`: nothing is expected of what is spread into an array or a call. `...x` is no literal.
                    ExprKind::Spread(_) => {
                        nearest = path.len() + 1;
                        at = parent;
                    }
                    // Nor of what is substituted in a template. Of the template there is.
                    ExprKind::Template { .. } => {
                        nearest = path.len();
                        at = parent;
                    }
                    ExprKind::Cond { test, .. } if test != at => {
                        broken.get_or_insert(path.len());
                        at = parent;
                    }
                    // `getContextualTypeForBinaryOperand`, `getContextualTypeForAwaitOperand`
                    ExprKind::NonNull(_)
                    | ExprKind::Await(_)
                    | ExprKind::Binary {
                        op: BinOp::Or | BinOp::Nullish,
                        ..
                    } => {
                        broken.get_or_insert(path.len());
                        at = parent;
                    }
                    ExprKind::Binary {
                        op: BinOp::And | BinOp::Comma,
                        right,
                        ..
                    } if right == at => {
                        broken.get_or_insert(path.len());
                        at = parent;
                    }
                    _ => return false,
                },
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return false;
                    }
                    // The key itself is not part of what is made.
                    if matches!(hir[p].key, PropKey::Computed(k) if k == at) {
                        return false;
                    }
                    if hir[p].kind == PropKind::Spread {
                        // What is spread is expected to be what the literal is.
                        broken.get_or_insert(path.len());
                    } else {
                        match self.member_name(file, hir[p].key) {
                            Some(name) => path.push(Some(name)),
                            None => lost = true,
                        }
                    }
                    at = owner;
                }
                // What a function written where one is expected returns: on from the function.
                parent @ (Parent::FnBody(_) | Parent::Stmt(_)) => {
                    if let Parent::Stmt(s) = parent
                        && (s.is_none() || !matches!(hir[s].kind, StmtKind::Return(_)))
                    {
                        return false;
                    }
                    let Some(func) = self.enclosing_fn(file, parent) else {
                        return false;
                    };
                    let FnOwner::Expr(function) = bound.fns[func.idx()].owner else {
                        return false;
                    };
                    if hir[func].ret.is_some() {
                        return false;
                    }
                    path.push(Some(known::returned));
                    if returned.is_none() {
                        returned = at;
                    }
                    at = function;
                }
                _ => return false,
            }
        }
    }

    /// `isConstContext` of `e`, going by `getContextualType` alone: `e`, or a literal it is part of, is expected to be a `const` type
    /// variable.
    fn is_const_by_contextual_type(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            if self.is_valid_const_assertion_argument(file, at)
                && self
                    .contextual_type(file, at)
                    .is_some_and(|c| self.is_const_type_variable(c, 0))
            {
                return true;
            }
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent)
                    if matches!(
                        hir[parent].kind,
                        ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::Template { .. }
                    ) =>
                {
                    parent
                }
                Parent::Prop(p) if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) => {
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
            &TypeData::NoInfer(base) => self.is_const_type_variable(base, depth),
            // `getHomomorphicTypeVariable`: `{ [K in keyof T]: .. }` is as `T` is.
            &TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => {
                let keys = self.mapped_constraint(file, node, mapper);
                let keys = self.force(keys);
                match *self.data(keys) {
                    TypeData::Keyof(of) if matches!(self.data(of), TypeData::TypeParam(..)) => {
                        self.is_const_type_variable(of, depth)
                    }
                    _ => false,
                }
            }
            TypeData::Tuple { elems, flags, .. } => {
                elems.iter().zip(flags.iter()).any(|(&e, f)| {
                    f.contains(ElemFlags::VARIADIC) && self.is_const_type_variable(e, depth)
                })
            }
            _ => false,
        }
    }

    /// `isValidConstAssertionArgument`
    fn is_valid_const_assertion_argument(&self, file: FileId, e: ExprId) -> bool {
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
                hir.parens
                    .binary_search_by_key(&operand.0, |p| p.0.0)
                    .is_err()
                    && matches!(
                        (op, hir[operand].kind),
                        (UnOp::Minus, ExprKind::Number(_) | ExprKind::BigInt(_))
                            | (UnOp::Plus, ExprKind::Number(_))
                    )
            }
            // A member of an enum.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => self
                .value_named_by(file, obj)
                .is_some_and(|sym| self.files().flags(sym).contains(SymFlags::ENUM)),
            _ => false,
        }
    }

    /// `resolveEntityName`: the value that `e`, which is `a` or `a.b.c`, is the name of.
    fn value_named_by(&self, file: FileId, e: ExprId) -> Option<Sym> {
        let found = match self.hir(file)[e].kind {
            ExprKind::Ident(name) => self.symbol_of_identifier(file, e, name)?,
            ExprKind::Dot { obj, name, .. } => {
                let container = self.value_named_by(file, obj)?;
                self.files().namespace_member(container, name)?
            }
            _ => return None,
        };
        self.files().resolve_alias_if_needed(found)
    }

    /// Whether the part of the argument `arg` of `call` that `path` leads to is declared as a `const` type parameter,
    /// or is inside a part that is, no fewer than `nearest` and no more than `farthest` steps up the way.
    fn is_const_argument(
        &mut self,
        file: FileId,
        call: ExprId,
        arg: ExprId,
        path: &[Option<Atom>],
        nearest: usize,
        farthest: usize,
    ) -> bool {
        if nearest > farthest {
            return false;
        }
        let hir = self.hir(file);
        let (ExprKind::Call(c) | ExprKind::New(c)) = hir[call].kind else {
            return false;
        };
        let Some(index) = hir.ids(hir[c].args).position(|a| a == arg) else {
            return false;
        };
        if self.outside_const_context.contains(&(file, call)) {
            self.note_provisional_read();
            return false;
        }
        let callee = self.type_of_expr(file, hir[c].callee);
        let callee = self.non_nullable(callee);
        if self.is_any(callee) {
            return false;
        }
        let sigs = self.signatures(callee, matches!(hir[call].kind, ExprKind::New(_)));
        let mut has_arity: SmallVec<[bool; 8]> = SmallVec::new();
        // Which overload the call resolves to decides.
        if sigs.len() > 1 && sigs.iter().any(|&sig| self.has_const_type_parameter(sig)) {
            if self.p.calls.get(&(file, call)).is_none()
                && !self.stack.contains(&Query::Call(file, call))
            {
                self.resolve_call(file, call);
            }
            if self
                .p
                .calls_outside_const_context
                .get(&(file, call))
                .is_some()
            {
                return false;
            }
            has_arity = self.overloads_with_correct_arity(file, call, c, &sigs);
        }
        for (k, sig) in sigs.into_iter().enumerate() {
            // `chooseOverload` skips it before it checks any argument.
            if has_arity.get(k) == Some(&false) {
                continue;
            }
            let type_params = self.sig_type_params(sig);
            if !type_params
                .iter()
                .any(|&p| self.is_const_type_variable(p, 0))
            {
                continue;
            }
            let params = self.sig_params(sig);
            let Some(mut ty) = self.param_type_at(&params, index) else {
                continue;
            };
            let mut steps = path.iter().rev();
            loop {
                if (nearest..=farthest).contains(&steps.len()) && self.is_const_type_variable(ty, 0)
                {
                    return true;
                }
                let next = match steps.next() {
                    None => break,
                    // Not the name of a property: what is returned or yielded. What is expected of that is asked where it is written.
                    Some(Some(known::returned)) => {
                        let function = self.non_nullable(ty);
                        if let Some(s) = self.single_call_signature(function, false) {
                            let returns = self.sig_return(s);
                            if self.has_type_variables(returns) {
                                return true;
                            }
                        }
                        break;
                    }
                    // `getTypeOfPropertyOfContextualType`
                    Some(Some(name)) => self.contextual_property(ty, *name),
                    Some(None) => Some(self.indexed_access(ty, TypeId::NUMBER)),
                };
                match next {
                    Some(t) if self.has_type_variables(t) => ty = t,
                    _ => break,
                }
            }
        }
        false
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

    /// `checkNonNullType`: what can be looked into of `receiver`. That it may be null or undefined is an error, and does not stand
    /// in the way. Where it can be nothing else, or is `unknown`, nothing is left: what is in error can be anything.
    pub(super) fn receiver_that_is_there(&mut self, receiver: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return if receiver.is_null() || receiver.is_undefined() {
                TypeId::ANY
            } else {
                receiver
            };
        }
        if receiver == TypeId::UNKNOWN {
            return TypeId::ANY;
        }
        if !self.some_type(receiver, |_, m| m.is_null() || m.is_undefined()) {
            return receiver;
        }
        match self.non_nullable(receiver) {
            TypeId::NEVER => TypeId::ANY,
            rest => rest,
        }
    }

    /// Whether it is the program that is in error where nothing was found in `receiver`, the type of `obj`: all of it is known,
    /// and no question has gone unanswered since `cycles_before`.
    fn is_certainly_missing(
        &mut self,
        file: FileId,
        obj: ExprId,
        receiver: TypeId,
        cycles_before: u64,
    ) -> bool {
        let apparent = self.apparent_type(receiver);
        self.cycles == cycles_before
            && self.is_known(receiver)
            && !self.is_uncertain(file, obj)
            && self.is_known(apparent)
            && !self.some_type(apparent, |c, m| {
                matches!(c.data(m), TypeData::LazyAlias { .. })
            })
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of `a.b` when it is got to, and whether the chain may stop before.
    fn type_of_property_access(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj, name, chain, ..
        } = hir[e].kind
        else {
            return (TypeId::UNRESOLVED, false);
        };
        let (receiver, stops) = self.chain_receiver(file, obj, chain);
        // `x.a` out of `any` is `any`, tests or no tests. (Not so `x["a"]`.)
        if self.is_any(receiver) {
            return (receiver, false);
        }
        let left = self.receiver_that_is_there(receiver);
        if self.is_any(left) {
            return (left, stops);
        }
        let target = self.target_kind(file, e);
        // `getWidenedType(leftType)`: what is written to or called is looked up in what a variable holding the object would be.
        let receiver = if target.written || self.is_called(file, e) {
            self.regular_object(left)
        } else {
            left
        };
        let cycles_before = self.cycles;
        let is_private = self.files().atoms.bytes(name).first() == Some(&b'#');
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
        let found = if is_private && !self.is_private_name_in_reach(file, e, left, name) {
            None
        } else if self.p.files.options.strict_null_checks
            && self.is_deferred(receiver)
            && self.base_constraint(receiver) == TypeId::UNKNOWN
        {
            // `getApparentType`: what may be anything at all has nothing that can be counted on, not even what every object has.
            None
        } else if matches!(hir[obj].kind, ExprKind::Super) {
            self.type_of_super_property(file, obj, receiver, name)
        } else if target.written {
            // `getWriteTypeOfSymbol`, for what is not read first. Read or not, nothing is written through an index signature of
            // what a type parameter extends.
            match self.write_type_of_property(receiver, name) {
                Some(_) if !target.assigned => self.type_of_property(receiver, name),
                to_write => to_write,
            }
        } else {
            self.type_of_property(receiver, name)
        };
        let found = match found {
            // `getPropertyOfTypeEx` with `includeTypeOnlyMembers`: what a qualified name in `typeof a.b` asks for.
            None if self.bound(file).is_in_type_query(e) => {
                self.type_only_member_of_module(receiver, name)
            }
            found => found,
        };
        let Some(declared) = found else {
            if !self.is_certainly_missing(file, obj, receiver, cycles_before) {
                return (TypeId::UNRESOLVED, stops);
            }
            // `isJSLiteralType`: a property missing from the type of a JavaScript object literal is `any`. No error is reported, so
            // the type is not printed. `isUncheckedJSSuggestion` is tested first, here without its test of the declaring file.
            let is_unchecked_js =
                self.is_plain_js(file) && !matches!(hir[obj].kind, ExprKind::This);
            if !is_unchecked_js && self.is_js_literal_type(left) {
                return (TypeId::ANY, stops);
            }
            // `reportNonexistentProperty` records the access before it prints the containing type, and prints once.
            if !self.files().atoms.bytes(name).is_empty()
                && !self
                    .reporting_nonexistent
                    .iter()
                    .any(|r| r.0 == file && r.1 == e)
            {
                // How sure what is printed is says nothing about what is in error.
                let uncertain = self.uncertain;
                self.reporting_nonexistent.push((file, e, self.stack.len()));
                self.resolve_as_printed(left, 0, &mut Vec::new());
                self.reporting_nonexistent.pop();
                self.uncertain = uncertain;
            }
            // What is not there is an error, and what is in error can be anything. It is not narrowed.
            return (TypeId::ANY, stops);
        };
        (self.flow_type_of_access(file, e, declared, target), stops)
    }

    /// `getFlowTypeOfAccessExpression`: what `=`, `&&=`, `||=` or `??=` gives a value to is what it is declared as, and that it may
    /// not be there so far does not count (`removeMissingType`; nor is `missingType` added to what an index signature gives).
    /// `target`: the `target_kind` of `e`.
    fn flow_type_of_access(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
        target: TargetKind,
    ) -> TypeId {
        if !target.definite {
            let narrowed = self.narrow_access(file, e, declared);
            // `getBaseTypeOfLiteralType(flowType)` for the target of a compound assignment, `++` or `--`.
            return if target.written {
                self.base_of_literal(narrowed)
            } else {
                narrowed
            };
        }
        self.filter(declared, |_, m| m != TypeId::MISSING)
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
        // A definite assignment target keeps `autoType`, which accepts every value.
        if target.definite {
            TypeId::ANY
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
        // `GetThisContainer(e, includeArrowFunctions = true)`
        let Ok(Ok(container)) =
            self.this_container_or_end(file, self.bound(file).expr_parent[e.idx()], e, true, false)
        else {
            return None;
        };
        if hir[container].kind != FnKind::Constructor {
            return None;
        }
        let apparent = self.apparent_type(receiver);
        let (prop, _) = self.prop_of(apparent, name)?;
        let PropSource::Assigned(declared_in, assignments) = &prop.source else {
            return None;
        };
        let is_this_property = |&a: &ExprId| {
            crate::bind::assignment_declaration_kind(hir, a)
                == crate::bind::JsDeclarationKind::ThisProperty
        };
        // `thisAssignmentDeclarationTyped`
        let is_annotated = |&a: &ExprId| hir.jsdoc_type(JsDocTypeOwner::Assign(a)).is_some();
        if *declared_in != file
            || !assignments.iter().all(is_this_property)
            || assignments.iter().any(is_annotated)
        {
            return None;
        }
        // `getDeclaringConstructor`
        let declaring = assignments
            .iter()
            .find_map(|&a| match self.this_container(file, a) {
                Some(Ok(f)) if hir[f].kind == FnKind::Constructor => Some(f),
                _ => None,
            })?;
        if declaring != container {
            return None;
        }
        // `getTypeOfPropertyInBaseClass`
        let (class, _) = self.class_of_member_fn(file, container)?;
        if let Some(&base) = self.base_types(self.class_sym(file, class)).first()
            && let Some(base_members) = self.members(base)
            && let Some((inherited, mapper)) = self.property_of_type(&base_members, name)
        {
            return Some(self.type_of_prop(&inherited, mapper));
        }
        Some(self.undefined_as_declared())
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
            origin: Origin::Module(module),
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
    fn resolve_as_printed(&mut self, ty: TypeId, depth: u32, visited: &mut Vec<(TypeId, u32)>) {
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
        let uncertain = self.uncertain;
        let target = self.type_from_node(file, ty);
        if self.is_known(source) && self.is_known(target) && !self.is_assignable(source, target) {
            let mut visited = Vec::new();
            self.resolve_as_printed(source, 0, &mut visited);
            self.resolve_as_printed(target, 0, &mut visited);
        }
        self.uncertain = uncertain;
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
        let receiver = self.receiver_that_is_there(object);
        let is_in_error = self.is_any(receiver) && !self.is_any(object);
        let target = self.target_kind(file, e);
        // `getWidenedType(exprType)`: what is written to or called is looked up in what a variable holding the object would be.
        let receiver = if target.written || self.is_called(file, e) {
            self.regular_object(receiver)
        } else {
            receiver
        };
        let key = self.type_of_expr(file, index);
        // What is in error is not looked into, nor narrowed.
        if is_in_error {
            return (receiver, stops);
        }
        // A `const` enum is only looked into by a name that is written out (2476).
        let is_string_literal_like = hir
            .parens
            .binary_search_by_key(&index.0, |p| p.0.0)
            .is_err()
            && match hir[index].kind {
                ExprKind::String(_) => true,
                ExprKind::Template { exprs, .. } => exprs.is_empty(),
                _ => false,
            };
        if !is_string_literal_like && self.is_const_enum_object(receiver) {
            return (TypeId::ANY, stops);
        }
        // `isForInVariableForNumericPropertyNames`: the variable of a `for..in` over what has numbers for names is a number here.
        let key = if self.is_for_in_variable_for_numeric_names(file, index) {
            TypeId::NUMBER
        } else {
            key
        };
        let cycles_before = self.cycles;
        // `getIndexedAccessTypeOrUndefined`: in an expression only the key can put the answer off. `t[0]` of a `T` is what
        // is at `0` in what `T` extends; it is the type `T[0]` that waits for `T`.
        let receiver = if self.has_type_variables(receiver) && !self.is_generic(key) {
            let strict_null_checks = self.p.files.options.strict_null_checks;
            self.map_type(receiver, |c, m| {
                if !c.is_generic(m) || c.is_tuple(m) {
                    return m;
                }
                // Of `T & { a: 1 }`, what `T` extends and `{ a: 1 }`.
                if let TypeData::Intersection(parts) = c.data(m) {
                    let parts: Vec<TypeId> = parts
                        .iter()
                        .map(|&p| {
                            if c.is_deferred(p) {
                                c.base_constraint(p)
                            } else {
                                p
                            }
                        })
                        .collect();
                    let whole = c.intersection(&parts);
                    return c.apparent_type(whole);
                }
                // `getApparentType`: what extends nothing extends `unknown`, which has nothing.
                if strict_null_checks && c.is_deferred(m) && c.base_constraint(m) == TypeId::UNKNOWN
                {
                    return TypeId::UNKNOWN;
                }
                c.apparent_type(m)
            })
        } else {
            receiver
        };
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
        // `AccessFlagsExpressionPosition`
        let is_read = !target.definite;
        let of_super = if matches!(hir[obj].kind, ExprKind::Super) {
            self.property_name_of_type(key)
        } else {
            None
        };
        let found = match of_super {
            Some(name) => self.type_of_super_property(file, obj, receiver, name),
            None => self.indexed_access_if_any(receiver, key, is_read),
        };
        let declared = match found {
            Some(found) => found,
            // An object literal that is read on the spot answers for what it lacks.
            None if is_read && self.is_object_literal_type(receiver) => {
                self.indexed_access_for_read(receiver, key)
            }
            // `getIndexedAccessTypeOrUndefined` gives nil: an error, and what is in error can be anything.
            None if self.is_known(key)
                && !self.is_uncertain(file, index)
                && self.is_certainly_missing(file, obj, receiver, cycles_before) =>
            {
                TypeId::ANY
            }
            None => TypeId::UNRESOLVED,
        };
        (self.flow_type_of_access(file, e, declared, target), stops)
    }

    /// `checkIndexedAccessIndexType`, of the type `ty` of `e`: `T[K]` where `K` cannot be used to look into `T` is an error (2536,
    /// 4105), and what is in error can be anything.
    fn checked_indexed_access_index_type(&mut self, file: FileId, e: ExprId, ty: TypeId) -> TypeId {
        let TypeData::IndexedAccess { obj, index, .. } = *self.data(ty) else {
            return ty;
        };
        let cycles_before = self.cycles;
        // Where a type parameter has got to a place none is in scope, it has not been got to the bottom of.
        let is_refused = self.is_generic(index)
            && self.is_in_generic_context(file, e)
            && self.why_not_a_key_of(obj, index).is_some();
        if is_refused && self.cycles == cycles_before {
            TypeId::ANY
        } else {
            ty
        }
    }

    /// The type of `a.b`, `a[b]` or `a()` when it is got to, and whether an optional chain it is part of may stop before.
    fn type_of_link(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { .. } => self.type_of_property_access(file, e),
            ExprKind::Index { .. } => {
                let (ty, stops) = self.type_of_element_access_unchecked(file, e);
                (self.checked_indexed_access_index_type(file, e, ty), stops)
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
                let resolved = self.resolve_call(file, e);
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
                _ => TypeId::ANY,
            },
            ExprKind::Ident(name) => self.type_of_identifier(file, e, name),
            ExprKind::This => self.type_of_this(file, e),
            ExprKind::Super => self.type_of_super(file, e),
            ExprKind::Null => TypeId::NULL,
            ExprKind::True => TypeId::FRESH_TRUE,
            ExprKind::False => TypeId::FRESH_FALSE,
            ExprKind::Number(n) => self.number_literal(hir.numbers[n as usize], true),
            ExprKind::String(s) => {
                // `checkPrivateIdentifierExpression`: `#a` is `any`. Directly left of `in` it keeps its name, which narrowing uses.
                if hir.text.get(hir[e].pos as usize) == Some(&b'#') {
                    let is_left_of_in = hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_err()
                        && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent)
                            if matches!(hir[parent].kind, ExprKind::Binary { op: BinOp::In, left, .. } if left == e));
                    if !is_left_of_in {
                        return TypeId::ANY;
                    }
                }
                self.string_literal(s, true)
            }
            ExprKind::BigInt(text) => self.intern(TypeData::BigIntLit {
                text,
                negative: false,
                fresh: true,
            }),
            ExprKind::Regex => self.global_ref(known::RegExp, &[]),
            // `checkTemplateExpression`
            ExprKind::Template { exprs, texts } => {
                for x in hir.ids(exprs) {
                    self.look_at(file, x);
                }
                // What it comes to, if that can be told from the text alone.
                if let Some(EnumValue::String(text)) = self.constant_value(file, e) {
                    return self.string_literal(text, true);
                }
                let wants_literal = self.in_const_context(file, e)
                    // `isTemplateLiteralContext`: as a key it is looked at for what it can be.
                    || matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Index { index, .. } if index == e))
                    || self.contextual_type(file, e).is_some_and(|c| self.parts(c).iter().any(|&m| self.is_template_literal_contextual_type(m)));
                if !wants_literal {
                    return TypeId::STRING;
                }
                let mut types: Vec<TypeId> =
                    hir.ids(exprs).map(|x| self.type_of_expr(file, x)).collect();
                let texts: Vec<Atom> = hir.ids(texts).collect();
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
            ExprKind::TaggedTemplate(_) => self.resolve_call(file, e).ret,
            ExprKind::Array(items) => self.type_of_array_literal(file, e, items),
            ExprKind::Object(props) => self.type_of_object_literal(file, e, props),
            ExprKind::Fn(func) => {
                let scope = self.bound(file).fns[func.idx()].scope;
                let parent = self.bound(file).scopes[scope.idx()].parent;
                let mapper = self.identity_mapper(file, parent);
                self.intern(TypeData::Fns {
                    decls: Box::new([(file, func)]),
                    mapper,
                })
            }
            // `checkClassExpression`: what the symbol of the class is, as for a class that is declared.
            ExprKind::Class(class) => {
                let sym = self.class_sym(file, class);
                self.type_of_symbol(sym)
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                let (ty, stops) = self.type_of_link(file, e);
                if stops { self.optional(ty) } else { ty }
            }
            ExprKind::New(_) => self.resolve_call(file, e).ret,
            ExprKind::Unary { op, operand } => self.type_of_unary(file, op, operand),
            ExprKind::Binary { op, left, right } => self.type_of_binary(file, op, left, right),
            ExprKind::Assign { op, target, value } => match op {
                None => {
                    // `checkBinaryLikeExpression`: the left first. A pattern is taken apart, not looked at.
                    if target.is_none()
                        || !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                    {
                        self.look_at(file, target);
                    }
                    self.type_of_expr(file, value)
                }
                Some(op) => self.type_of_binary(file, op, target, value),
            },
            // `checkConditionalExpression`
            ExprKind::Cond { test, yes, no } => {
                self.look_at(file, test);
                let (yes, no) = (self.type_of_expr(file, yes), self.type_of_expr(file, no));
                self.union_reduced(&[yes, no])
            }
            ExprKind::Spread(x) => self.type_of_expr(file, x),
            ExprKind::Satisfies { expr: x, ty } => {
                let source = self.type_of_expr(file, x);
                self.print_unsatisfied_types(file, source, ty);
                source
            }
            ExprKind::AsConst(x) => {
                let ty = self.type_of_expr(file, x);
                self.regular(ty)
            }
            ExprKind::Await(x) => {
                let ty = self.type_of_expr(file, x);
                self.awaited(ty)
            }
            ExprKind::Yield { value, star } => {
                let ty = self.type_of_yield(file, e, value, star);
                // `checkYieldExpression` looks at what is yielded whatever comes of it.
                if value.is_some() {
                    self.look_at(file, value);
                }
                ty
            }
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
                self.with_type_arguments(ty, &args)
            }
            ExprKind::Jsx(_) => self.jsx_element_type(file),
            ExprKind::ImportCall(spec) => self.type_of_import_call(file, spec),
            ExprKind::ImportMeta => self.global_ref(known::ImportMeta, &[]),
            ExprKind::NewTarget => self.type_of_new_target(file, e),
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

    /// `checkImportCallExpression`, for `import(spec)`.
    fn type_of_import_call(&mut self, file: FileId, spec: ExprId) -> TypeId {
        // `createPromiseReturnType`: without a `Promise` to give it is an error, and what is in error can be anything.
        if self.global_type_symbol(known::Promise).is_none() {
            return TypeId::ANY;
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
            } else if files.synthetic_default(usage, module).is_some() {
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

    /// `isErrorType`, of the expression `e`: a name that is nowhere to be found, or what the parser made up where nothing is written.
    pub(super) fn is_in_error(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Missing => true,
            ExprKind::Ident(name) => {
                !matches!(
                    name,
                    known::undefined | known::arguments | known::globalThis
                ) && self.symbol_of_identifier(file, e, name).is_none()
            }
            _ => false,
        }
    }

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

    /// The symbol an identifier means as a value.
    pub fn symbol_of_identifier(&self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
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
                return Some(outer);
            }
            return Some(sym);
        }
        // `NameResolver.Resolve`: the arguments of a function around hide whatever goes by the name further out.
        if name == known::arguments && bound.is_arguments_object(e) {
            return None;
        }
        // What another declaration of a module, a namespace or an enum around exports, in whichever file, is in scope too, and comes
        // before the globals.
        match bound.free_idents.binary_search_by_key(&e, |free| free.0) {
            Ok(i) => files.resolve_name(file, bound.free_idents[i].1, name, SymFlags::VALUE),
            Err(_) => files.global(name, SymFlags::VALUE),
        }
    }

    /// `checkIdentifier`
    fn type_of_identifier(&mut self, file: FileId, e: ExprId, name: Atom) -> TypeId {
        let Some(sym) = self.symbol_of_identifier(file, e, name) else {
            return match name {
                known::undefined => TypeId::UNDEFINED,
                // In a property initializer or a static block the arguments object is an error (2815).
                known::arguments
                    if self.bound(file).is_arguments_object(e)
                        && !self.is_in_property_initializer_or_static_block(file, e) =>
                {
                    self.global_ref(known::IArguments, &[])
                }
                known::globalThis => self.intern(TypeData::Anon {
                    origin: Origin::GlobalThis,
                    mapper: MapperId::IDENTITY,
                }),
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
                // A name nothing goes by is an error, and what is in error can be anything.
                _ => TypeId::ANY,
            };
        };
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
        // Only a variable that is no constant is given a value (2588, 2628 to 2632, 2539). What is in error can be anything.
        if (!flags.intersects(SymFlags::VARIABLE) || flags.contains(SymFlags::CONST))
            && target.written
        {
            return TypeId::ANY;
        }
        // What is imported is narrowed like a variable.
        if !flags.intersects(SymFlags::VARIABLE | SymFlags::ALIAS) || target.definite {
            return declared;
        }
        let is_variable_here = sym.file == file && flags.intersects(SymFlags::VARIABLE);
        let declared = if is_variable_here {
            self.narrow_binding(file, e, sym.id, declared)
        } else {
            declared
        };
        let narrowed = self.narrow_reference(file, e, declared);
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
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                other => self.outward(file, other),
            };
        }
    }

    /// Whether `e` is written to and not read: the left of `=`, or part of a pattern there.
    #[inline]
    pub fn is_assignment_target(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let mut at = e;
        loop {
            match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    // `[a = 1] = x`: the inner assignment is a default. In a pattern or not, it gives `a` a value.
                    ExprKind::Assign {
                        op: None, target, ..
                    } => return target == at,
                    ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::NonNull(_) => at = parent,
                    _ => return false,
                },
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return false;
                    }
                    at = owner;
                }
                Parent::Stmt(s) => {
                    // `for (x of xs)`
                    return matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l)
                        if matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
                }
                _ => return false,
            }
        }
    }

    /// `getAssignmentTargetKind`
    fn target_kind(&self, file: FileId, e: ExprId) -> TargetKind {
        if self.is_assignment_target(file, e) {
            return TargetKind {
                assigned: true,
                definite: true,
                written: true,
            };
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut definite, mut written) = (false, false);
        let mut at = e;
        while let Parent::Expr(parent) = bound.expr_parent[at.idx()] {
            match hir[parent].kind {
                ExprKind::Assign {
                    op: Some(op),
                    target,
                    ..
                } => {
                    written = target == at;
                    definite = written && matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
                    break;
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                } => {
                    written = true;
                    break;
                }
                // `x!` is seen through.
                ExprKind::NonNull(_) => at = parent,
                _ => break,
            }
        }
        TargetKind {
            assigned: false,
            definite,
            written,
        }
    }

    /// `getAssignmentTargetKind(e) != AssignmentKindNone`: `e` is given a value, by `=` or in a pattern there, by an operator that
    /// reads it first, or by `++` and `--`.
    pub(super) fn is_written(&self, file: FileId, e: ExprId) -> bool {
        self.target_kind(file, e).written
    }

    /// `isMethodAccessForCall`. A call does not see through `x!`.
    fn is_called(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent)
            if matches!(hir[parent].kind, ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee == e))
    }

    /// `getAssignmentTargetKind(e) != AssignmentKindNone || isMethodAccessForCall(e)`
    pub(super) fn is_written_or_called(&self, file: FileId, e: ExprId) -> bool {
        self.is_called(file, e) || self.is_written(file, e)
    }

    /// `isInPropertyInitializerOrClassStaticBlock(e, ignoreArrowFunctions = true)`
    pub(super) fn is_in_property_initializer_or_static_block(
        &self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.is_in_type_query(e) {
            return false;
        }
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::MemberInit(_) => return true,
                Parent::FnBody(f) if hir[f].kind == FnKind::StaticBlock => return true,
                // The block of a function that is no arrow function. The default of a parameter is not in it.
                Parent::FnBody(f) if hir[f].kind != FnKind::Arrow => return false,
                Parent::None | Parent::File | Parent::Module(_) => return false,
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                other => self.outward(file, other),
            };
        }
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
    /// is initialized.
    pub(super) fn this_container(
        &self,
        file: FileId,
        e: ExprId,
    ) -> Option<Result<FnId, (ClassId, bool)>> {
        self.this_container_or_end(file, self.bound(file).expr_parent[e.idx()], e, false, false)
            .ok()
    }

    /// The same, of what is directly in `parent`.
    pub(super) fn this_container_from(
        &self,
        file: FileId,
        parent: Parent,
    ) -> Option<Result<FnId, (ClassId, bool)>> {
        self.this_container_or_end(file, parent, ExprId::NONE, false, false)
            .ok()
    }

    /// `GetThisContainer`, of what is directly in `parent`. `below`: the expression `parent` is the parent of, if it is one.
    /// `include_arrows`: an arrow function is a container (`includeArrowFunctions`). `names_count`: the computed name of a member of
    /// a class belongs to the member, which is what `checkThisExpression` makes of it; to everybody else it belongs to what is around
    /// the class. `Err`: neither a function nor a class decides, and where the way out ended.
    fn this_container_or_end(
        &self,
        file: FileId,
        mut parent: Parent,
        mut below: ExprId,
        include_arrows: bool,
        names_count: bool,
    ) -> Result<Result<FnId, (ClassId, bool)>, Parent> {
        let hir = self.hir(file);
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    if include_arrows || hir[f].kind != FnKind::Arrow {
                        return Ok(Ok(f));
                    }
                    match bound.fns[f.idx()].owner {
                        FnOwner::Expr(owner) => Parent::Expr(owner),
                        _ => return Err(parent),
                    }
                }
                Parent::MemberInit(m) => {
                    return match bound.member_owner[m.idx()] {
                        MemberOwner::Class(c) => Ok(Err((c, hir[m].flags.contains(Flags::STATIC)))),
                        _ => Err(parent),
                    };
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    // A name in an object literal or in a pattern is worked out where the literal or the pattern is.
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) => match bound.member_owner[m.idx()] {
                        MemberOwner::Class(_) if names_count && hir[m].func.is_some() => {
                            return Ok(Ok(hir[m].func));
                        }
                        MemberOwner::Class(c) if names_count => {
                            return Ok(Err((c, hir[m].flags.contains(Flags::STATIC))));
                        }
                        MemberOwner::Class(c) => self.outward(file, Parent::ClassExtends(c)),
                        // What is around an interface or a type literal is not kept track of.
                        _ => return Err(Parent::None),
                    },
                    Named::Unknown => return Err(Parent::None),
                },
                // A default in a pattern, what a class extends and a decorator belong to what is around.
                Parent::PatPropDefault(_)
                | Parent::PatElemDefault(_)
                | Parent::ClassExtends(_)
                | Parent::Decorator(..) => self.outward(file, parent),
                _ => return Err(parent),
            };
        }
    }

    /// `isInParameterInitializerBeforeContainingFunction`: of whichever function is nearest, an arrow function too.
    fn is_in_parameter_initializer(&self, file: FileId, e: ExprId) -> bool {
        // A statement, which no expression stands for, is in none.
        if e.is_none() {
            return false;
        }
        let mut parent = self.bound(file).expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::ParamDefault(_) => return true,
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                Parent::FnBody(_)
                | Parent::MemberInit(_)
                | Parent::EnumInit(_)
                | Parent::Key(_)
                | Parent::MemberKey
                | Parent::Module(_)
                | Parent::File
                | Parent::None => return false,
                other => self.outward(file, other),
            };
        }
    }

    #[inline]
    pub(super) fn class_sym(&self, file: FileId, c: ClassId) -> Sym {
        self.files()
            .sym(file, self.bound(file).class_symbol[c.idx()])
    }

    /// `checkThisExpression`
    fn type_of_this(&mut self, file: FileId, e: ExprId) -> TypeId {
        use super::errors_misc::QueriedThisContainer;
        let written_in = self.bound(file).expr_parent[e.idx()];
        // The `this` of `typeof this.x` (`checkIdentifier`) goes by where the type is written, which is not where the binder puts
        // the operand.
        let container = if self.bound(file).is_in_type_query(e) {
            match self.this_container_of_type_query(file, e) {
                Some(QueriedThisContainer::Fn(func)) => Ok(Ok(func)),
                Some(QueriedThisContainer::File) => Err(Parent::File),
                Some(
                    QueriedThisContainer::PropertySignature
                    | QueriedThisContainer::Module
                    | QueriedThisContainer::Enum,
                ) => return TypeId::ANY,
                // A property of a class. From inside its initializer the way out leads to it. From its annotation it leads past the
                // class, and `type_of_entity` goes by the scope the type is written in.
                Some(QueriedThisContainer::Property) => {
                    match self.this_container_or_end(file, written_in, e, false, true) {
                        Ok(Err(of_class)) => Ok(Err(of_class)),
                        _ => return TypeId::UNRESOLVED,
                    }
                }
                None => return TypeId::UNRESOLVED,
            }
        } else {
            self.this_container_or_end(file, written_in, e, false, true)
        };
        match container {
            Ok(container) => match self.declared_type_of_this(file, e, container) {
                // `getFlowTypeOfReference(node, thisType)`
                Some(declared) => self.narrow_this(file, e, declared),
                None => TypeId::ANY,
            },
            // `tryGetThisTypeAtEx`: at the top of a module it is `undefinedType`, at the top of a script `globalThis`, tests or no tests.
            Err(Parent::File) if !self.files().module(file).is_module() => {
                self.intern(TypeData::Anon {
                    origin: Origin::GlobalThis,
                    mapper: MapperId::IDENTITY,
                })
            }
            Err(Parent::File) if self.p.files.options.strict_null_checks => TypeId::UNDEFINED,
            Err(Parent::File) => TypeId::UNDEFINED_DECLARED,
            // In a namespace or an enum nothing says what it is.
            Err(Parent::Module(_) | Parent::EnumInit(_)) => TypeId::ANY,
            Err(_) => TypeId::UNRESOLVED,
        }
    }

    /// `tryGetThisTypeAtEx`, before the flow of control has its say: what `container`, which decides `this` at `e`, says it is.
    /// `None`: nothing.
    fn declared_type_of_this(
        &mut self,
        file: FileId,
        e: ExprId,
        container: Result<FnId, (ClassId, bool)>,
    ) -> Option<TypeId> {
        let (class, is_static) = match container {
            Err(of_class) => of_class,
            Ok(func) => {
                let f = &self.hir(file)[func];
                if f.this_ty.is_some() {
                    return Some(self.type_from_node(file, f.this_ty));
                }
                // To the default of a parameter only a `this` parameter that is written counts.
                if !self.is_in_parameter_initializer(file, e) {
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
                        if other.this_ty.is_some()
                            && other.params.len() == usize::from(wanted == FnKind::Setter)
                        {
                            return Some(self.type_from_node(file, other.this_ty));
                        }
                    }
                    if let FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner
                        && let Some(this) = self.contextual_this_parameter_type(file, func, owner)
                    {
                        return Some(this);
                    }
                }
                self.class_of_member_fn(file, func)?
            }
        };
        let sym = self.class_sym(file, class);
        Some(if is_static {
            self.type_of_symbol(sym)
        } else {
            self.intern(TypeData::ThisParam(sym))
        })
    }

    /// `checkNewTargetMetaProperty`
    fn type_of_new_target(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `GetNewTargetContainer`. Anywhere else it is an error, and what is in error can be anything.
        let Some(Ok(func)) = self.this_container(file, e) else {
            return TypeId::ANY;
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
            _ => TypeId::ANY,
        }
    }

    /// Whether nothing says what `this` is at `e`, in a function of its own.
    pub(super) fn is_this_implicitly_any(&mut self, file: FileId, e: ExprId) -> bool {
        let Ok(Ok(func)) =
            self.this_container_or_end(file, self.bound(file).expr_parent[e.idx()], e, false, true)
        else {
            return false;
        };
        if self.declared_type_of_this(file, e, Ok(func)).is_some() {
            return false;
        }
        match self.bound(file).fns[func.idx()].owner {
            // What is expected of it has no say in the default of a parameter.
            FnOwner::Expr(owner) => {
                self.is_in_parameter_initializer(file, e) || self.is_context_known(file, owner)
            }
            FnOwner::Stmt(_) => true,
            _ => false,
        }
    }

    /// `tryGetThisTypeAt(container)`, as `checkThisExpression` asks it about the container of a `this` nothing is said of: whether
    /// around what is directly in `parent` something says what `this` is, and it is not `globalThis`. `below`: the expression
    /// `parent` is the parent of, if it is one.
    pub(super) fn is_this_said_around(
        &mut self,
        file: FileId,
        parent: Parent,
        below: ExprId,
    ) -> bool {
        match self.this_container_or_end(file, parent, below, false, false) {
            Ok(Err(_)) => true,
            Ok(Ok(func)) => match self.declared_type_of_this(file, below, Ok(func)) {
                Some(this) => !matches!(
                    self.data(this),
                    TypeData::Anon {
                        origin: Origin::GlobalThis,
                        ..
                    }
                ),
                None => false,
            },
            // At the top of a module it is `undefined`.
            Err(Parent::File) => self.hir(file).has_module_syntax,
            Err(_) => false,
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
            && let Some(sig) = self.contextual_signature(file, func)
            && let Some(this) = self.sig_this_type(sig)
        {
            return Some(this);
        }
        if !self.p.files.options.no_implicit_this && !self.hir(file).is_js {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_in_parentheses =
            |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
        if let Parent::Prop(p) = bound.expr_parent[owner.idx()] {
            let containing = bound.prop_owner[p.idx()];
            // `getContainingObjectLiteral`: of a method, an accessor, or a function that is all there is to the value of a property.
            let is_member = match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => true,
                PropKind::Init => !is_in_parentheses(owner),
                PropKind::Shorthand | PropKind::Spread => false,
            };
            if is_member
                && containing.is_some()
                && matches!(hir[containing].kind, ExprKind::Object(_))
            {
                // `getThisTypeOfObjectLiteralFromContextualType`: `ThisType<T>` in what the literal, or a literal it is directly the
                // value of a property of, is expected to be says so.
                let context = match self.context_of_accessor_in_argument(file, p, containing) {
                    Some(context) => context,
                    None => self.settled_context_of_literal(file, containing),
                };
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
                        return Some(self.union(&marked));
                    }
                    let Parent::Prop(outer) = bound.expr_parent[literal.idx()] else {
                        break;
                    };
                    if hir[outer].kind != PropKind::Init || is_in_parentheses(literal) {
                        break;
                    }
                    literal = bound.prop_owner[outer.idx()];
                    if literal.is_none() || !matches!(hir[literal].kind, ExprKind::Object(_)) {
                        break;
                    }
                    expected = self.settled_context_of_literal(file, literal);
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

    /// `getContextualTypeForArgumentAtIndex`: while a call is being resolved its arguments are expected to be `any` (`resolvingSignature`).
    /// `checkObjectLiteral` puts an accessor off, so its type is first resolved when the call reads the property, after the contextual
    /// type of the argument is popped. `Some`: what `literal` is then expected to be, if `p` is an accessor of it and it is an argument
    /// or the value of a property of an object literal that is.
    fn context_of_accessor_in_argument(
        &self,
        file: FileId,
        p: PropId,
        literal: ExprId,
    ) -> Option<Option<TypeId>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !matches!(hir[p].kind, PropKind::Getter | PropKind::Setter) {
            return None;
        }
        let mut at = literal;
        loop {
            match bound.expr_parent[at.idx()] {
                Parent::Prop(outer) if hir[outer].kind == PropKind::Init => {
                    at = bound.prop_owner[outer.idx()];
                    if at.is_none() || !matches!(hir[at].kind, ExprKind::Object(_)) {
                        return None;
                    }
                }
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != at => break,
                    _ => return None,
                },
                _ => return None,
            }
        }
        // `getTypeOfPropertyOfContextualType`: `any` says nothing of its properties.
        Some((at == literal).then_some(TypeId::ANY))
    }

    /// `isContextSensitiveFunctionOrObjectLiteralMethod`, which an accessor is not.
    fn is_context_sensitive_function_or_method(
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
                && f.this_ty.is_none()
                && self.bound(file).fns[func.idx()].contains_this
    }

    /// `getApparentTypeOfContextualType`, of the object literal `literal`, with nothing left open that the call around settles.
    fn settled_context_of_literal(&mut self, file: FileId, literal: ExprId) -> Option<TypeId> {
        let expected = self.contextual_type(file, literal)?;
        let settled = self.settled_by_enclosing_call(file, literal, expected);
        let settled = self.force(settled);
        self.contextual.push((file, literal, settled));
        let apparent = self.contextual_type_for_object_literal(file, literal);
        self.contextual.pop();
        apparent
    }

    /// `ty`, what the object literal `literal` is expected to be, with the type parameters of the call that `literal` is (part of)
    /// an argument of filled in. What an argument is expected to be is settled before anything is inferred from it, and stays so.
    /// `getMapperFromContext(getInferenceContext(literal))` while the call is resolved, afterwards the signature it is resolved to
    /// (`getContextualTypeForArgument`).
    fn settled_by_enclosing_call(&mut self, file: FileId, literal: ExprId, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = literal;
        for _ in 0..64 {
            at = match bound.expr_parent[at.idx()] {
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return ty;
                    }
                    owner
                }
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != at => {
                        if let Some(resolved) = self.p.calls.get(&(file, parent)) {
                            // `getContextualTypeForArgumentAtIndex`: a failed call resolves to the signature of
                            // `getCandidateForOverloadFailure`.
                            let sig = self.p.failure_sigs.get(&(file, parent)).or(resolved.sig);
                            let Some((_, _, mapper)) = sig.and_then(|sig| self.sig_decl(sig))
                            else {
                                return ty;
                            };
                            return self.instantiate(ty, mapper);
                        }
                        let so_far = self
                            .resolving
                            .iter()
                            .rev()
                            .find(|r| r.file == file && r.call == parent)
                            .map(|r| r.so_far);
                        let Some(so_far) = so_far else { return ty };
                        // Once the call is resolved more is known than this: what goes by it is not kept.
                        if let Some(i) = self
                            .stack
                            .iter()
                            .rposition(|q| *q == Query::Call(file, parent))
                        {
                            self.mark_tainted_from(i + 1);
                        }
                        return self.instantiate(ty, so_far);
                    }
                    ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { .. } => parent,
                    _ => return ty,
                },
                // What a function written where one is expected returns: on from the function.
                parent @ (Parent::FnBody(_) | Parent::Stmt(_)) => {
                    if let Parent::Stmt(s) = parent
                        && (s.is_none() || !matches!(hir[s].kind, StmtKind::Return(_)))
                    {
                        return ty;
                    }
                    let Some(func) = self.enclosing_fn(file, parent) else {
                        return ty;
                    };
                    let FnOwner::Expr(function) = bound.fns[func.idx()].owner else {
                        return ty;
                    };
                    function
                }
                _ => return ty,
            };
        }
        ty
    }

    /// `getSuperContainer`, arrow functions seen through unless `super` is called: the member of a class, an interface or a type
    /// literal that the `super` at `e` is written in, and its function, if it is in one. The name of a member, and what decorates
    /// it, are worked out outside of what the member is a member of. With them: whether `e` is in a parameter of that function and
    /// in no other function on the way there (`isInConstructorArgumentInitializer`). `Err`: there is no such member, and what
    /// `super` is then.
    fn super_container_or_end(
        &self,
        file: FileId,
        e: ExprId,
        is_call: bool,
    ) -> Result<(MemberId, FnId, bool), TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut parent, mut below) = (bound.expr_parent[e.idx()], e);
        // Whether a function has been left on the way out, be it by its name or by a decorator.
        let mut through_function = false;
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) => Parent::Expr(literal),
                    Named::Function(literal) => {
                        through_function = true;
                        Parent::Expr(literal)
                    }
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) => match bound.member_owner[m.idx()] {
                        MemberOwner::Class(c) => {
                            through_function |= hir[m].func.is_some();
                            self.outward(file, Parent::ClassExtends(c))
                        }
                        // What is around an interface or a type literal is not kept track of.
                        _ => return Err(TypeId::UNRESOLVED),
                    },
                    Named::Unknown => return Err(TypeId::UNRESOLVED),
                },
                Parent::Decorator(_, of) => {
                    through_function |= match of {
                        DecoratorOwner::Class(_) => false,
                        DecoratorOwner::Member(m) => hir[m].func.is_some(),
                        DecoratorOwner::Param(_) => true,
                    };
                    self.outward(file, parent)
                }
                Parent::MemberInit(m) => return Ok((m, FnId::NONE, false)),
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    if hir[f].kind != FnKind::Arrow || is_call {
                        return match bound.fns[f.idx()].owner {
                            FnOwner::Member(m) => Ok((
                                m,
                                f,
                                matches!(parent, Parent::ParamDefault(_)) && !through_function,
                            )),
                            // In a method or an accessor of an object literal it is `any`. In any other function it is an error, and
                            // what is in error can be anything.
                            _ => Err(TypeId::ANY),
                        };
                    }
                    through_function = true;
                    self.outward(file, Parent::FnBody(f))
                }
                Parent::EnumInit(member) => {
                    let owner = bound.enum_member_owner[member.idx()];
                    match hir
                        .stmts
                        .iter()
                        .position(|s| matches!(s.kind, StmtKind::Enum(x) if x == owner))
                    {
                        Some(s) => bound.stmt_parent[s],
                        None => return Err(TypeId::UNRESOLVED),
                    }
                }
                // So it is outside of everything.
                Parent::File | Parent::Module(_) => return Err(TypeId::ANY),
                Parent::None | Parent::Expr(_) => return Err(TypeId::UNRESOLVED),
                Parent::Stmt(s) if s.is_none() => return Err(TypeId::UNRESOLVED),
                other => self.outward(file, other),
            };
        }
    }

    /// The class whose member the `super` at `e` is written in, and whether that member is static.
    fn super_container(&self, file: FileId, e: ExprId, is_call: bool) -> Option<(ClassId, bool)> {
        let (member, ..) = self.super_container_or_end(file, e, is_call).ok()?;
        match self.bound(file).member_owner[member.idx()] {
            MemberOwner::Class(c) => {
                Some((c, self.hir(file)[member].flags.contains(Flags::STATIC)))
            }
            _ => None,
        }
    }

    /// `checkSuperExpression`. Where it is an error, what is in error can be anything.
    fn type_of_super(&mut self, file: FileId, e: ExprId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_call = matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(c) if hir[c].callee == e));
        let (member, func, is_in_parameter) = match self.super_container_or_end(file, e, is_call) {
            Ok(found) => found,
            Err(answer) => return answer,
        };
        let is_in_constructor = func.is_some() && hir[func].kind == FnKind::Constructor;
        // Only a constructor calls it.
        if is_call && !is_in_constructor {
            return TypeId::ANY;
        }
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return TypeId::ANY;
        };
        let extends = hir[class].extends;
        if extends.is_none() {
            return TypeId::ANY;
        }
        // `classDeclarationExtendsNull`
        let constructor = self.type_of_expr(file, extends);
        if constructor == TypeId::NULL {
            return if is_call { TypeId::ANY } else { TypeId::NULL };
        }
        let is_static = hir[member].flags.contains(Flags::STATIC);
        let sym = self.class_sym(file, class);
        let base = match self.base_types(sym).first().copied() {
            Some(base) => base,
            None => {
                // `base_types` leaves out what has no members of its own to inherit, which `getBaseTypes` has (`isValidBaseType`).
                let sigs = self.super_constructor_sigs(sym);
                let instance = match sigs.first() {
                    Some(&sig) => self.sig_return(sig),
                    None => TypeId::NEVER,
                };
                let is_left_out = instance == TypeId::ANY
                    || instance == TypeId::OBJECT
                    || matches!(self.data(instance), TypeData::TypeParam(..));
                if is_left_out && self.is_valid_base_type(instance) {
                    instance
                } else if self.is_known(constructor) && self.is_known(instance) {
                    // Nothing to inherit from is an error.
                    return TypeId::ANY;
                } else {
                    return if is_static || is_call {
                        constructor
                    } else {
                        TypeId::UNRESOLVED
                    };
                }
            }
        };
        if is_in_constructor && is_in_parameter {
            return TypeId::ANY;
        }
        if is_static || is_call {
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
    ) -> Option<TypeId> {
        let container = self.super_container(file, sup, false);
        if let TypeData::Ref { target, .. } = *self.data(base)
            && let Some((class, false)) = container
            && let Some((prop, mapper)) = self.prop_of(base, name)
        {
            let base_this = self.intern(TypeData::ThisParam(target));
            let this = self.intern(TypeData::ThisParam(self.class_sym(file, class)));
            let mut pairs = self.p.types.mapping(mapper).to_vec();
            for pair in &mut pairs {
                if pair.0 == base_this {
                    pair.1 = this;
                }
            }
            let mapper = self.p.types.mapper(pairs);
            return Some(self.type_of_prop(&prop, mapper));
        }
        self.type_of_property(base, name)
    }

    // ───────────────────────────── literals ─────────────────────────────

    /// `checkArrayLiteral`
    fn type_of_array_literal(&mut self, file: FileId, e: ExprId, items: IdList<ExprId>) -> TypeId {
        let hir = self.hir(file);
        let is_const = self.in_const_context(file, e);
        let in_pattern = self.is_assignment_target(file, e);
        let context = self.contextual_type(file, e);
        let wants_tuple = is_const || in_pattern || self.is_in_tuple_context(file, e, context);
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
                            && self.in_const_context(file, item)
                    {
                        self.regular(ty)
                    } else if matches!(hir[item].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                        ty
                    } else {
                        let expected = self.contextual_type(file, item);
                        self.widen_literal_for_context(ty, expected)
                    };
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
                    // `getApparentTypeOfContextualType`: a type variable maps to its constraint, and `someType` tests each member of that.
                    self.parts(c).iter().any(|&member| {
                        let apparent = if self.is_deferred(member) {
                            self.base_constraint(member)
                        } else {
                            member
                        };
                        self.parts(apparent).iter().any(|&m| {
                            !self.is_any(m) && !self.is_nullish(m) && self.is_assignable(m, list)
                        })
                    })
                });
            let made_before = self.p.types.len();
            let ty = self.normalized_tuple(&types, &flags, is_readonly);
            // `createArrayLiteralType`, which what is assigned to does not get to.
            if !in_pattern {
                self.p.types.mark_manifest(ty, made_before);
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
            TypeId::NEVER
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
        ty
    }

    /// Whether `checkArrayLiteral` makes a tuple of the array literal `e`.
    pub(super) fn array_literal_wants_tuple(&mut self, file: FileId, e: ExprId) -> bool {
        if self.in_const_context(file, e) || self.is_assignment_target(file, e) {
            return true;
        }
        let context = self.contextual_type(file, e);
        self.is_in_tuple_context(file, e, context)
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
            && matches!(hir[call].kind, ExprKind::Call(_) | ExprKind::New(_))
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
            && matches!(self.mapped_modifiers_source(file, node), Some((source, true)) if matches!(self.data(source), TypeData::TypeParam(..)))
    }

    /// What `...c` in the target of a destructuring assignment stands for, where `c` is a `target`, which is not like an array
    /// (`checkArrayLiteral`): what it has under a number, else what it yields, else `unknown`. That it is neither is no error here.
    fn rest_element_of_target(&mut self, target: TypeId) -> TypeId {
        // `getIndexTypeOfType(spreadType, numberType)`
        let apparent = self.apparent_type(target);
        if let Some(members) = self.members(apparent)
            && let Some(info) = members
                .shape()
                .index
                .iter()
                .find(|info| info.key == TypeId::NUMBER)
        {
            return self.instantiate(info.value, members.mapper);
        }
        match self.iterated_type(target, false) {
            TypeId::UNRESOLVED => TypeId::UNKNOWN,
            element => element,
        }
    }

    /// `checkObjectLiteral`
    fn type_of_object_literal(&mut self, file: FileId, e: ExprId, props: Span<PropId>) -> TypeId {
        let hir = self.hir(file);
        self.look_at_members(file, props);
        if !props.iter().any(|p| hir[p].kind == PropKind::Spread) {
            let scope = self.scope_of_expr(file, e);
            let mapper = self.identity_mapper(file, scope);
            return self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e),
                mapper,
            });
        }
        // With spreads, what is in it depends on what is spread: work it out now.
        let scope = self.scope_of_expr(file, e);
        let literal_mapper = self.identity_mapper(file, scope);
        let is_const = self.in_const_context(file, e);
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
                // `checkObjectLiteral`: what cannot be spread is an error, and the whole literal can then be anything.
                if self.is_known(spread)
                    && !self.is_uncertain(file, prop.value)
                    && !self.is_valid_spread_type(spread)
                {
                    return TypeId::ANY;
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
                    match self.accessor_of_literal(file, props, name, PropKind::Getter) {
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
            pending.props.push(Prop {
                name,
                flags,
                source: PropSource::Literal(file, source),
                mapper: literal_mapper,
            });
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
        result
    }

    /// `checkObjectLiteral` looks at every name and then at every value there and then: what leads back to something that is being
    /// worked out is a circle. Accessors wait (`checkNodeDeferred`), and what is spread is looked at where it is spread. The members
    /// are asked for one by one when they are read: what they are, and how sure that is, says nothing about the literal.
    fn look_at_members(&mut self, file: FileId, props: Span<PropId>) {
        let hir = self.hir(file);
        let uncertain = self.uncertain;
        for p in props.iter() {
            if let PropKey::Computed(key) = hir[p].key {
                self.type_of_expr(file, key);
            }
        }
        for p in props.iter() {
            let prop = &hir[p];
            if prop.value.is_none()
                || matches!(
                    prop.kind,
                    PropKind::Spread | PropKind::Getter | PropKind::Setter
                )
            {
                continue;
            }
            match hir[prop.value].kind {
                ExprKind::Fn(func) => self.look_at_signature(file, func),
                _ => {
                    self.type_of_literal_prop(file, p);
                }
            }
        }
        self.uncertain = uncertain;
    }

    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: what is written on a function is looked at with the function
    /// (`assignNonContextualParameterTypes`, `checkSignatureDeclaration`), what is in it later. The parameters themselves are not
    /// being worked out meanwhile: a circle through what is written on one is not about it.
    fn look_at_signature(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        let f = &hir[func];
        for tp in f.type_params.iter() {
            self.type_from_node(file, hir[tp].constraint);
            self.type_from_node(file, hir[tp].default);
        }
        self.type_from_node(file, f.this_ty);
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
        name: Atom,
        kind: PropKind,
    ) -> Option<PropId> {
        let hir = self.hir(file);
        props
            .iter()
            .find(|&q| hir[q].kind == kind && self.member_name(file, hir[q].key) == Some(name))
    }

    /// `getOptionalSymbolFlagForNode`: whether `p` is a method of an object literal written `name?() {}` (1162).
    fn is_optional_method(&self, file: FileId, p: PropId) -> bool {
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
        // What each member holds, `isSymbolWithSymbolName`, `isSymbolWithNumericName`.
        let mut held: Vec<(TypeId, bool, bool)> = Vec::with_capacity(run.len());
        for p in run.iter() {
            let prop = &hir[p];
            let mut source = p;
            let (is_symbol, is_numeric) = match self.member_name(file, prop.key) {
                Some(name) => {
                    // A getter and a setter are one property, and the getter says what it is.
                    if prop.kind == PropKind::Setter
                        && let Some(getter) =
                            self.accessor_of_literal(file, props, name, PropKind::Getter)
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
            held.push((
                self.type_of_literal_prop(file, source),
                is_symbol,
                is_numeric,
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
            let values: Vec<TypeId> = held
                .iter()
                .filter(|h| match i {
                    0 => !h.1,
                    1 => h.2,
                    _ => h.1,
                })
                .map(|h| h.0)
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
            });
        }
        infos
    }

    pub(super) fn build_object_literal_shape(&mut self, file: FileId, e: ExprId) -> Shape {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[e].kind else {
            return Shape::default();
        };
        let is_const = self.in_const_context(file, e);
        let in_pattern = self.is_assignment_target(file, e);
        // `patternForType`: what a pattern without computed names implies the literal to be.
        let implied = if self.may_be_expected_by_pattern(file, e) {
            self.contextual_type_for_object_literal(file, e)
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
                        .accessor_of_literal(file, props, name, PropKind::Setter)
                        .is_none()
                    {
                        flags |= PropFlags::READONLY;
                    }
                }
                PropKind::Setter => {
                    flags |= PropFlags::ACCESSOR;
                    // `getSpreadSymbol`: one nothing gets, of which a copy holds `undefined`.
                    if self
                        .accessor_of_literal(file, props, name, PropKind::Getter)
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
                        && hir
                            .parens
                            .binary_search_by_key(&prop.value.0, |p| p.0.0)
                            .is_err();
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
                        self.accessor_of_literal(file, props, name, PropKind::Getter)
                    {
                        source = getter;
                    }
                }
                shape.props.remove(existing);
            }
            shape.props.push(Prop {
                name,
                flags,
                source: PropSource::Literal(file, source),
                mapper: MapperId::IDENTITY,
            });
        }
        shape.index = self.index_infos_of_object_literal(file, props, props, is_const);
        // `bindDeferredExpandoAssignment`: in JavaScript, `x.a = v`, `x["a"] = v` and `x[0] = v` declare properties of the `{}` that
        // initializes `x`. A literal key declares the property it names.
        let bound = self.bound(file);
        let named = crate::bind::Bound::expandos_of(&bound.object_expandos, e);
        let keyed = crate::bind::Bound::expandos_of(&bound.object_keyed_expandos, e);
        let mut merged = Vec::new();
        let added: &[(ExprId, Atom, ExprId)] = if keyed.is_empty() {
            named
        } else {
            merged.extend_from_slice(named);
            for &(literal, key, assignment) in keyed {
                if let Some(name) = self.member_name(file, PropKey::Computed(key)) {
                    merged.push((literal, name, assignment));
                }
            }
            merged.sort_unstable_by_key(|x| (x.1, x.2));
            &merged
        };
        let mut i = 0;
        while i < added.len() {
            let name = added[i].1;
            let end = i + added[i..].iter().take_while(|x| x.1 == name).count();
            let assignments: Box<[ExprId]> = added[i..end].iter().map(|x| x.2).collect();
            shape.props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Assigned(file, assignments),
                mapper: MapperId::IDENTITY,
            });
            i = end;
        }
        shape
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
            // `<a b />` is `<a b={true} />`.
            let owner = self.bound(file).prop_owner[p.idx()];
            return if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                TypeId::TRUE
            } else {
                TypeId::UNRESOLVED
            };
        }
        // `checkJsxAttribute`: an attribute without an initializer is `true` whatever is expected of it. The parser puts a `true`
        // where its name ends.
        if matches!(hir[prop.value].kind, ExprKind::True) {
            let owner = self.bound(file).prop_owner[p.idx()];
            if owner.is_some()
                && matches!(hir[owner].kind, ExprKind::Jsx(_))
                && self.end_of_jsx_attr(file, p) == self.end_of_jsx_attr_name(file, p)
            {
                return TypeId::FRESH_TRUE;
            }
        }
        match prop.kind {
            PropKind::Getter => {
                let ExprKind::Fn(f) = hir[prop.value].kind else {
                    return TypeId::UNRESOLVED;
                };
                // `getTypeOfAccessors`: `getReturnTypeFromBody` of whatever body there is. A block whose `{` is missing returns nothing.
                if hir[f].flags.contains(Flags::MISSING_BODY)
                    && hir[f].ret.is_none()
                    && self.setter_annotation_next_to(file, f).is_none()
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
                let ty = self.type_of_expr(file, prop.value);
                // `checkPropertyAssignment`, `checkShorthandPropertyAssignment`: `node.Type()`
                let annotation = hir.jsdoc_type(JsDocTypeOwner::Prop(p));
                if annotation.is_some() {
                    return self.type_from_node(file, annotation);
                }
                if self.in_const_context(file, prop.value) {
                    return self.regular(ty);
                }
                // What is asserted is what it is said to be.
                if matches!(
                    hir[prop.value].kind,
                    ExprKind::As { .. } | ExprKind::AsConst(_)
                ) {
                    return ty;
                }
                let expected = self.contextual_type(file, prop.value);
                self.widen_literal_for_context(ty, expected)
            }
        }
    }

    // ───────────────────────────── operators ─────────────────────────────

    fn type_of_unary(&mut self, file: FileId, op: UnOp, operand: ExprId) -> TypeId {
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
            UnOp::Void => TypeId::UNDEFINED,
            UnOp::Delete => {
                self.look_at(file, operand);
                TypeId::BOOLEAN
            }
            UnOp::Not => {
                let ty = self.type_of_expr(file, operand);
                // `getTypeFacts(operandType, TypeFactsTruthy | TypeFactsFalsy)`
                match (self.can_be_truthy(ty), self.can_be_falsy(ty)) {
                    (true, false) => TypeId::FRESH_FALSE,
                    (false, true) => TypeId::FRESH_TRUE,
                    _ => TypeId::BOOLEAN,
                }
            }
            UnOp::Minus | UnOp::Plus | UnOp::BitNot => {
                let ty = self.type_of_expr(file, operand);
                let hir = self.hir(file);
                // `checkPrefixUnaryExpression`: it takes a literal written right after the sign to make a literal type.
                let is_bare = hir
                    .parens
                    .binary_search_by_key(&operand.0, |p| p.0.0)
                    .is_err();
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
                        self.intern(TypeData::BigIntLit {
                            text,
                            negative,
                            fresh: true,
                        })
                    }
                    _ if op == UnOp::Plus => TypeId::NUMBER,
                    _ => self.unary_result_type(ty),
                }
            }
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                let ty = self.type_of_expr(file, operand);
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

    /// `checkBinaryLikeExpression`, which looks at the left and then at the right, whatever the operator makes of them.
    fn type_of_binary(&mut self, file: FileId, op: BinOp, left: ExprId, right: ExprId) -> TypeId {
        match op {
            BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::In
            | BinOp::Instanceof => {
                self.look_at(file, left);
                self.look_at(file, right);
                TypeId::BOOLEAN
            }
            BinOp::Comma => {
                self.look_at(file, left);
                self.type_of_expr(file, right)
            }
            BinOp::And => {
                let l = self.type_of_expr(file, left);
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
                if !self.can_be_falsy(l) {
                    self.look_at(file, right);
                    return l;
                }
                let r = self.type_of_expr(file, right);
                let truthy = self.remove_definitely_falsy(l);
                let truthy = self.non_nullable_operand(truthy);
                self.union_reduced(&[truthy, r])
            }
            BinOp::Nullish => {
                let l = self.type_of_expr(file, left);
                if !self.can_be_nullish(l) {
                    self.look_at(file, right);
                    return l;
                }
                let r = self.type_of_expr(file, right);
                let present = self.non_nullable_operand(l);
                self.union_reduced(&[present, r])
            }
            BinOp::Add => {
                let (mut l, mut r) = (
                    self.type_of_expr(file, left),
                    self.type_of_expr(file, right),
                );
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
                        && by != TypeId::NEVER
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
                    l = self.operand_without_nullish(l);
                    r = self.operand_without_nullish(r);
                }
                if self.is_assignable_to_kind(l, Self::is_number_like, TypeId::NUMBER, true)
                    && self.is_assignable_to_kind(r, Self::is_number_like, TypeId::NUMBER, true)
                {
                    TypeId::NUMBER
                } else if self.is_assignable_to_kind(l, Self::is_bigint_like, TypeId::BIGINT, true)
                    && self.is_assignable_to_kind(r, Self::is_bigint_like, TypeId::BIGINT, true)
                {
                    TypeId::BIGINT
                } else if self.is_assignable_to_kind(l, Self::is_string_like, TypeId::STRING, true)
                    || self.is_assignable_to_kind(r, Self::is_string_like, TypeId::STRING, true)
                {
                    TypeId::STRING
                } else {
                    // Either it can be anything, or the two cannot be added, which is an error.
                    TypeId::ANY
                }
            }
            _ => {
                let (l, r) = (
                    self.type_of_expr(file, left),
                    self.type_of_expr(file, right),
                );
                let (l, r) = (
                    self.operand_without_nullish(l),
                    self.operand_without_nullish(r),
                );
                let any_or_unknown = |c: &Self, t: TypeId| c.is_any(t) || t == TypeId::UNKNOWN;
                if any_or_unknown(self, l) && any_or_unknown(self, r)
                    || !self.maybe_type_of_kind(l, Self::is_bigint_like)
                        && !self.maybe_type_of_kind(r, Self::is_bigint_like)
                {
                    TypeId::NUMBER
                } else if self.is_assignable(l, TypeId::BIGINT)
                    && self.is_assignable(r, TypeId::BIGINT)
                {
                    // `bothAreBigIntLike`
                    TypeId::BIGINT
                } else {
                    // A bigint and something else do not go together, which is an error.
                    TypeId::ANY
                }
            }
        }
    }

    /// `checkNonNullType`: what is left of an operand that must not be `null` or `undefined`. Nothing at all is an error: anything.
    fn operand_without_nullish(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        if ty == TypeId::UNKNOWN {
            return TypeId::ANY;
        }
        // `getTypeFacts(t, TypeFactsIsUndefinedOrNull)`: what waits for type parameters goes by what it extends.
        let by = self.base_constraint(ty);
        if !self.some_type(by, |_, m| m.is_null() || m.is_undefined()) {
            return ty;
        }
        match self.non_nullable(ty) {
            TypeId::NEVER => TypeId::ANY,
            rest => rest,
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
    pub(super) fn jsx_namespace(&mut self, file: FileId) -> Option<Sym> {
        let files = self.files();
        // `getJsxNamespaceContainerForImplicitImport`: the module elements are made with, if it can be found.
        let member = match files
            .jsx_runtime(file)
            .and_then(|spec| files.module_of_specifier(file, spec))
        {
            Some(module) => files.module_export(module, known::JSX),
            // `getJsxNamespace`: `h.JSX` for `@jsx h`, then what `jsxFactory` or `reactNamespace` say, `React.JSX` otherwise.
            None => {
                let options = &files.options;
                let first_name = |text: &[u8]| {
                    files.atoms.intern(
                        text.split(|&c| c == b'.')
                            .next()
                            .unwrap_or(text)
                            .trim_ascii(),
                    )
                };
                // `parseIsolatedEntityName`: a factory that is not an entity name is ignored.
                let parses = |text: &[u8]| {
                    std::str::from_utf8(text).is_ok_and(crate::verify::is_entity_name)
                };
                let factory = self.hir(file).jsx_pragmas.factory;
                let name = if factory.is_some() && parses(files.atoms.bytes(factory)) {
                    first_name(files.atoms.bytes(factory))
                } else if !options.jsx_factory.is_empty() {
                    // `_jsxNamespace` stays `React` if `jsxFactory` does not parse. `reactNamespace` is not consulted.
                    if parses(options.jsx_factory.as_bytes()) {
                        first_name(options.jsx_factory.as_bytes())
                    } else {
                        known::React
                    }
                } else if !options.react_namespace.is_empty() {
                    files.atoms.intern(options.react_namespace.as_bytes())
                } else {
                    known::React
                };
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
    fn jsx_element_type(&mut self, file: FileId) -> TypeId {
        self.jsx_type(file, known::Element).unwrap_or(TypeId::ANY)
    }

    /// What the attributes of the JSX element `e` are expected to be, together.
    pub(super) fn jsx_props_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        // While the type arguments of a signature are being worked out: what it takes, with the type parameters still in it. While
        // a signature is tried: what that one takes.
        if let Some(&(_, _, ty)) = self
            .jsx_resolving
            .iter()
            .rev()
            .find(|r| r.0 == file && r.1 == e)
        {
            // Once the component is resolved something else may be expected: what goes by this is not kept.
            if let Some(i) = self.stack.iter().rposition(|q| *q == Query::Call(file, e)) {
                self.mark_tainted_from(i + 1);
            }
            return Some(ty);
        }
        if let Some(known) = self.p.calls.get(&(file, e)) {
            return (known.ret != TypeId::UNRESOLVED).then_some(known.ret);
        }
        if !self.enter(Query::Call(file, e)) {
            return None;
        }
        // An element that is resolved settles what its own attributes are expected to be, whatever is gone over again around it.
        let keeps = std::mem::replace(&mut self.keeps_arg_contexts, false);
        let props = self.jsx_props_type_uncached(file, e);
        self.keeps_arg_contexts = keeps;
        if self.leave() {
            self.p.calls.insert(
                (file, e),
                ResolvedCall {
                    sig: None,
                    ret: props.unwrap_or(TypeId::UNRESOLVED),
                },
            );
        }
        props
    }

    /// What each of `sigs` takes. Asked as part of the question what the element takes, so that what is found out about the
    /// attributes on the way, with type parameters still open, is not kept.
    pub(super) fn jsx_props_of_each(
        &mut self,
        file: FileId,
        e: ExprId,
        sigs: &[SigId],
        construct: bool,
    ) -> Option<Vec<TypeId>> {
        // Which of them it is comes first, with none of the attributes under way: they are read with that one in mind.
        self.jsx_props_type(file, e);
        if !self.enter(Query::Call(file, e)) {
            return None;
        }
        let props: Option<Vec<TypeId>> = sigs
            .iter()
            .map(|&sig| self.jsx_props_of_sig(file, e, sig, construct))
            .collect();
        self.leave();
        props
    }

    /// What `sig`, a signature of the component of the JSX element `e`, takes for properties.
    fn jsx_props_of_sig(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
        construct: bool,
    ) -> Option<TypeId> {
        let sig = self.jsx_instantiated_sig(file, e, sig, construct)?;
        Some(self.jsx_effective_first_argument(file, e, sig, construct))
    }

    /// `sig`, a signature of the component of the JSX element `e`, with what the element says or lets infer for its type parameters.
    /// Part of the question what the element takes: whoever asks has opened `Query::Call(file, e)`, as `jsx_props_of_each` does, so
    /// that what is found out about the attributes with type parameters still open is not kept.
    pub(super) fn jsx_instantiated_sig(
        &mut self,
        file: FileId,
        e: ExprId,
        sig: SigId,
        construct: bool,
    ) -> Option<SigId> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        let jsx = &hir[j];
        let type_params = self.sig_type_params(sig);
        if type_params.is_empty() {
            return Some(sig);
        }
        if !jsx.type_args.is_empty() {
            let type_args = self.types_from_nodes(file, jsx.type_args);
            let filled = self.fill_sig_type_args(sig, &type_params, &type_args);
            let mapper = self.mapper_from(&type_params, &filled);
            return Some(self.instantiate_sig(sig, mapper));
        }
        // `inferJsxTypeArguments`: the attributes and the children are one argument, an object.
        let param = self.jsx_effective_first_argument(file, e, sig, construct);
        let mut inference = super::infer::Inference::new(type_params.into_vec(), Some(sig));
        // `chooseOverload`: `InferenceFlagsAnyDefault`
        inference.any_default = hir.is_js;
        let children: Vec<ExprId> = hir.ids(jsx.children).collect();
        let children_param = match self.jsx_children_property_name(file) {
            super::jsx::JsxName::Name(name) => self
                .contextual_property(param, name)
                .filter(|&c| self.has_type_variables(c)),
            _ => None,
        };
        // `isContextSensitive`, of the attributes, which the children are among. What is spread counts here as well.
        let waits = jsx
            .attrs
            .iter()
            .any(|p| hir[p].value.is_some() && self.is_context_sensitive(file, hir[p].value))
            || children
                .iter()
                .any(|&child| self.is_context_sensitive(file, child));
        self.jsx_resolving.push((file, e, param));
        for sensitive in [false, true] {
            // `chooseOverload`: a signature that what does not wait does not fit is rejected as it is instantiated by then. The
            // attributes are read with that expected of them, not `param` (`checkApplicableSignatureForJsxCallLikeElement`).
            if sensitive && waits {
                let early = self.inference_mapper(&inference);
                let props = self.instantiate(param, early);
                if !self.jsx_fits(file, e, props, false, true) {
                    self.jsx_resolving.pop();
                    return Some(self.instantiate_sig(sig, early));
                }
            }
            self.infer_from_members(
                file,
                jsx.attrs,
                param,
                &mut inference,
                MapperId::IDENTITY,
                sensitive,
            );
            let Some(children_param) = children_param else {
                continue;
            };
            if let [only] = children[..] {
                if self.is_context_sensitive(file, only) == sensitive {
                    self.infer_from_member(
                        file,
                        only,
                        children_param,
                        &mut inference,
                        MapperId::IDENTITY,
                        sensitive,
                    );
                }
            } else if !sensitive && !children.is_empty() {
                let mut types = Vec::with_capacity(children.len());
                for &child in &children {
                    if !self.is_context_sensitive(file, child) {
                        types.push(self.type_of_expr(file, child));
                    }
                }
                let element = self.union(&types);
                let list = self.array_of(element);
                self.infer(&mut inference, list, children_param, 0);
            }
        }
        // And from all of it as one object: a type parameter that stands for the whole is inferred from the whole.
        if !waits {
            let given = self.jsx_attributes_type(file, e);
            if self.is_known(given) {
                self.infer(&mut inference, given, param, 0);
            }
        } else if !children
            .iter()
            .any(|&child| self.is_context_sensitive(file, child))
        {
            // What waits would find itself in the signature as it comes out. So it is said first what it is expected to be, as things
            // stand (`nonFixingMapper`), and that stays: what is inferred from it cannot be what is expected of it.
            let told = self.instantiate_instantiable_for_signature(&inference, param);
            let mut waiting: Vec<(ExprId, TypeId)> = Vec::new();
            let mut are_all_told = true;
            for p in jsx.attrs.iter() {
                let value = hir[p].value;
                if value.is_none() || !self.is_context_sensitive(file, value) {
                    continue;
                }
                let expected = match self.member_name(file, hir[p].key) {
                    Some(name) if hir[p].kind != PropKind::Spread => {
                        self.contextual_property(told, name)
                    }
                    _ => None,
                };
                match expected {
                    Some(expected) => waiting.push((value, expected)),
                    None => are_all_told = false,
                }
            }
            if are_all_told {
                for (value, expected) in waiting {
                    // The others have been told attribute by attribute.
                    if !self.has_type_variables(expected) {
                        self.infer_from_member(
                            file,
                            value,
                            expected,
                            &mut inference,
                            MapperId::IDENTITY,
                            true,
                        );
                    }
                }
                let given = self.jsx_attributes_type(file, e);
                if self.is_known(given) {
                    self.infer(&mut inference, given, param, 0);
                }
            }
        }
        self.jsx_resolving.pop();
        let mapper = self.inference_mapper(&inference);
        Some(self.instantiate_sig(sig, mapper))
    }

    /// `isSignatureApplicable` under `CheckModeSkipContextSensitive`: whether the attributes of the JSX element `e` fit `props`, as
    /// subtypes if `by_subtype`, with those that wait for what is expected of them, and the children, taken to fit. In doubt they do.
    fn jsx_fits_without_sensitive(
        &mut self,
        file: FileId,
        e: ExprId,
        props: TypeId,
        by_subtype: bool,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return true;
        };
        if !self.is_known(props) {
            return true;
        }
        // `anyFunctionType` fits every function type whichever way it is compared, and `any` is a subtype of nothing.
        let left_out = if by_subtype {
            TypeId::UNRESOLVED
        } else {
            TypeId::ANY
        };
        let mut shape = Shape::default();
        for p in hir[j].attrs.iter() {
            let prop = &hir[p];
            // What is spread is not gone into.
            if prop.kind == PropKind::Spread {
                return true;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let waits = prop.value.is_some() && self.is_context_sensitive(file, prop.value);
            let source = if waits {
                PropSource::Type(left_out)
            } else {
                PropSource::Literal(file, p)
            };
            shape.props.retain(|x| x.name != name);
            shape.props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source,
                mapper: MapperId::IDENTITY,
            });
        }
        if hir
            .ids(hir[j].children)
            .any(|child| !matches!(hir[child].kind, ExprKind::Missing))
            && let super::jsx::JsxName::Name(name) = self.jsx_children_property_name(file)
        {
            shape.props.retain(|x| x.name != name);
            shape.props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Type(left_out),
                mapper: MapperId::IDENTITY,
            });
        }
        // `getRegularTypeOfObjectLiteral`: that there is too much of it does not count yet.
        let given = self.synth(shape);
        let (cycles_before, gave_up_before) = (
            self.cycles,
            std::mem::replace(&mut self.relation_gave_up, false),
        );
        let fits = if by_subtype {
            self.is_subtype(given, props)
        } else {
            self.is_assignable(given, props)
        };
        let is_sure = self.cycles == cycles_before && !self.relation_gave_up;
        self.relation_gave_up |= gave_up_before;
        fits || !is_sure
    }

    fn jsx_props_type_uncached(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        let tag = hir[j].tag;
        if tag.is_none() {
            return None;
        }
        if let ExprKind::String(name) = hir[tag].kind {
            return self.jsx_intrinsic_attributes(file, name);
        }
        let component = self.type_of_expr(file, tag);
        if self.is_any(component) {
            return None;
        }
        let (sigs, construct) = self.jsx_signatures_of_tag(file, component)?;
        match sigs[..] {
            [] => None,
            [sig] => self.jsx_props_of_sig(file, e, sig, construct),
            _ => self.jsx_props_of_overloads(file, e, &sigs, construct),
        }
    }

    /// `resolveCall` for a component with the signatures `sigs`, more than one: what the one it comes to takes for properties.
    /// Part of the question what the element takes: whoever asks has opened `Query::Call(file, e)`, so that what is found out about
    /// the attributes with one candidate in mind is not kept. `checkTypeArguments` is left out, and the type arguments of a
    /// candidate are inferred once for both rounds.
    fn jsx_props_of_overloads(
        &mut self,
        file: FileId,
        e: ExprId,
        sigs: &[SigId],
        construct: bool,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        let candidates = self.reorder_candidates(sigs);
        // Whichever is chosen, the same is expected. So of the constructors of a class, which all take what its instances say.
        let declared = self.jsx_effective_first_argument(file, e, candidates[0], construct);
        if candidates[1..]
            .iter()
            .all(|&sig| self.jsx_effective_first_argument(file, e, sig, construct) == declared)
        {
            return self.jsx_props_of_sig(file, e, candidates[0], construct);
        }
        let given_type_args = hir[j].type_args.len();
        let waiting = self.jsx_parts_that_wait(file, e);
        // `argCheckMode`: what waits is left out until a candidate fits without it.
        let mut leaves_out = !waiting.is_empty();
        let mut wanted: Vec<Option<TypeId>> = vec![None; candidates.len()];
        // The last of `candidatesForArgumentError`.
        let mut last_failed = None;
        // `chooseOverload`: the first that the attributes are subtypes of what it takes, or else the first they can be assigned to.
        for by_subtype in [true, false] {
            for (i, &sig) in candidates.iter().enumerate() {
                let type_params = self.sig_type_params(sig);
                if !self.has_correct_type_argument_arity(&type_params, given_type_args) {
                    continue;
                }
                let props = match wanted[i] {
                    Some(props) => props,
                    None => self.jsx_props_of_sig(file, e, sig, construct)?,
                };
                wanted[i] = Some(props);
                last_failed = Some(props);
                if leaves_out {
                    if !self.jsx_fits(file, e, props, by_subtype, true) {
                        continue;
                    }
                    leaves_out = false;
                    self.settle_what_waits(file, e, props, &waiting);
                }
                if self.jsx_fits(file, e, props, by_subtype, false) {
                    return Some(props);
                }
            }
        }
        // `reportCallResolutionErrors` holds the attributes against the last candidate they do not fit, with nothing left out.
        if leaves_out && let Some(last) = last_failed {
            self.settle_what_waits(file, e, last, &waiting);
        }
        // `getCandidateForOverloadFailure`
        if candidates
            .iter()
            .any(|&sig| !self.sig_type_params(sig).is_empty())
        {
            // `getLongestCandidateIndex`: the attributes and the children are one argument, if there are any.
            let count = usize::from(!hir[j].attrs.is_empty() || !hir[j].children.is_empty());
            let (mut best, mut most): (usize, Option<usize>) = (0, None);
            for (i, &sig) in candidates.iter().enumerate() {
                let params = self.sig_params(sig);
                let length = self.parameter_count(&params);
                if self.has_effective_rest_parameter(&params) || length >= count {
                    best = i;
                    break;
                }
                if most.is_none_or(|most| length > most) {
                    (best, most) = (i, Some(length));
                }
            }
            return match wanted[best] {
                Some(props) => Some(props),
                None => self.jsx_props_of_sig(file, e, candidates[best], construct),
            };
        }
        // `createUnionOfSignaturesForOverloadFailure`: it takes what any of them takes, and makes what all of them make.
        let (mut taken, mut made) = (
            Vec::with_capacity(candidates.len()),
            Vec::with_capacity(candidates.len()),
        );
        for &sig in &candidates {
            let params = self.sig_params(sig);
            // `tryGetTypeAtPosition`
            taken.extend(self.param_type_at(&params, 0));
            made.push(self.sig_return(sig));
        }
        let mut params = Vec::new();
        if !taken.is_empty() {
            params.push(SigParam {
                name: known::props,
                ty: self.union_reduced(&taken),
                optional: false,
                rest: false,
            });
        }
        let ret = if made.iter().all(|&ty| self.is_known(ty)) {
            self.intersection(&made)
        } else {
            TypeId::UNRESOLVED
        };
        let combined = self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this: None,
            of: Box::new([]),
        });
        Some(self.jsx_effective_first_argument(file, e, combined, construct))
    }

    /// `isContextSensitive`: the values of the attributes of the JSX element `e`, what is spread among them, and the children that
    /// wait for what is expected of them.
    fn jsx_parts_that_wait(&self, file: FileId, e: ExprId) -> Vec<ExprId> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return Vec::new();
        };
        let values = hir[j]
            .attrs
            .iter()
            .map(|p| hir[p].value)
            .filter(|value| value.is_some());
        values
            .chain(hir.ids(hir[j].children))
            .filter(|&part| self.is_context_sensitive(file, part))
            .collect()
    }

    /// `isSignatureApplicable`: whether the attributes of the JSX element `e`, read with `props` in mind, which is what a candidate
    /// takes, fit it: as subtypes if `by_subtype`, with what waits left out if `leaves_out`.
    fn jsx_fits(
        &mut self,
        file: FileId,
        e: ExprId,
        props: TypeId,
        by_subtype: bool,
        leaves_out: bool,
    ) -> bool {
        self.jsx_resolving.push((file, e, props));
        let fits = if leaves_out {
            self.jsx_fits_without_sensitive(file, e, props, by_subtype)
        } else {
            let given = self.jsx_attributes_type(file, e);
            if by_subtype {
                self.is_subtype(given, props)
            } else {
                self.is_assignable(given, props)
            }
        };
        self.jsx_resolving.pop();
        fits
    }

    /// The attributes of the JSX element `e` are about to be held against `props` with nothing left out, for the first time: the
    /// functions in `waiting` are looked at with that in mind.
    fn settle_what_waits(&mut self, file: FileId, e: ExprId, props: TypeId, waiting: &[ExprId]) {
        self.jsx_resolving.push((file, e, props));
        for &part in waiting {
            self.settle_functions_in(file, part);
        }
        self.jsx_resolving.pop();
    }

    /// `assignContextualParameterTypes`: the functions in `part`, which waits for what is expected of it, take the types of their
    /// parameters from what is expected of them now, and keep them whatever is expected later (`NodeCheckFlagsContextChecked`).
    /// The literals around them are read anew every time.
    fn settle_functions_in(&mut self, file: FileId, part: ExprId) {
        let hir = self.hir(file);
        match hir[part].kind {
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let value = hir[p].value;
                    if value.is_some() && self.is_context_sensitive(file, value) {
                        self.settle_functions_in(file, value);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    if self.is_context_sensitive(file, item) {
                        self.settle_functions_in(file, item);
                    }
                }
            }
            _ => {
                let Some(context) = self.contextual_type(file, part) else {
                    return;
                };
                let context = self.without_no_infer(context);
                if self.is_provisional_here() {
                    self.provisional_arg_contexts.insert((file, part), context);
                } else if !self.is_innermost_tainted() {
                    // Not where the choice rests on something that went unanswered: it is made again, and settles this then.
                    self.p.arg_contexts.insert((file, part), context);
                }
            }
        }
    }

    pub fn class_owner_expr(&self, file: FileId, c: ClassId) -> Option<ExprId> {
        match self.bound(file).class_owner[c.idx()] {
            ClassOwner::Expr(e) => Some(e),
            ClassOwner::Stmt(_) => None,
        }
    }
}

/// `text` without its trailing white space and `/* */` comments.
fn trim_trivia_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = text.trim_ascii_end();
        let Some(rest) = text.strip_suffix(b"*/") else {
            return text;
        };
        let Some(open) = rest.windows(2).rposition(|w| w == b"/*") else {
            return text;
        };
        text = &text[..open];
    }
}
