//! Calls: overload resolution, type argument inference, and the return type.

use super::infer::{Inference, PRIORITY_RETURN};
use super::relate::Relation;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, ScopeId, ScopeKind};
use smallvec::{SmallVec, smallvec};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCall {
    /// The chosen signature, instantiated with its type arguments.
    pub sig: Option<SigId>,
    pub ret: TypeId,
}

impl crate::table::Packed for ResolvedCall {
    type Cell = std::sync::atomic::AtomicU64;
    #[inline]
    fn pack(self) -> u64 {
        self.sig.map_or(0, |sig| u64::from(sig.0) + 1) << 32 | (u64::from(self.ret.0) + 1)
    }
    #[inline]
    fn unpack(raw: u64) -> Self {
        ResolvedCall {
            sig: ((raw >> 32) != 0).then(|| SigId((raw >> 32) as u32 - 1)),
            ret: TypeId(raw as u32 - 1),
        }
    }
}

#[derive(Copy, Clone)]
pub(super) enum Arg {
    Expr(ExprId),
    /// `createSyntheticExpression`: a type, and its label (`tupleNameSource`) or `NONE`. The last
    /// field is the node it's positioned at: the argument whose tuple it's an element of, the
    /// template whose text pieces it represents, or the decorator's expression.
    Type(TypeId, LabeledDeclaration, ExprId),
    /// `createSyntheticExpression` with `isSpread`, for a variable element of a tuple: any number
    /// of values of the first type. The second is the type of the list that is spread. The third
    /// is the label of the element (`tupleNameSource`), or `NONE`. The last is the argument that
    /// spreads the tuple.
    Spread(TypeId, TypeId, LabeledDeclaration, ExprId),
    /// A `SpreadElement` that `getEffectiveCallArguments` leaves unchanged, since its operand isn't
    /// a tuple. The fields are the type it iterates, the type of its operand without a contextual
    /// type, the operand, and the element itself.
    SpreadElement(TypeId, TypeId, ExprId, ExprId),
}

impl Arg {
    /// The node where an error about it is reported.
    pub(super) fn node(self) -> ExprId {
        match self {
            Arg::Expr(e)
            | Arg::Type(_, _, e)
            | Arg::Spread(_, _, _, e)
            | Arg::SpreadElement(_, _, _, e) => e,
        }
    }

    /// `isSpreadArgument`
    pub(super) fn is_spread(self) -> bool {
        matches!(self, Arg::Spread(..) | Arg::SpreadElement(..))
    }
}

/// The node `resolveCall` resolves (`IsCallLikeExpression`). The accompanying expression is the key
/// for the node in the tables: the call, `new` or tagged template, the binary expression, or the
/// decorator's expression.
#[derive(Copy, Clone)]
pub(super) enum CallLike {
    Call(CallId),
    /// `left instanceof right`, resolved as `right[Symbol.hasInstance](left)`.
    InstanceOf {
        left: ExprId,
        right: ExprId,
    },
    Decorator(DecoratorOwner),
    /// `JsxOpeningLikeElement`, `JsxOpeningFragment`
    Jsx(JsxId),
}

/// `Yes` if the caller of `resolve_call` reads `ret`. Otherwise `ret` is `any` and the signature's
/// return type isn't resolved, because `checkCallExpression` returns `anyType` for `new` of a call
/// signature before it calls `getReturnTypeOfSignature`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ExpectsReturn {
    No,
    Yes,
}

/// `SignatureKind`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum SignatureKind {
    Call,
    Construct,
}

/// `allowMembers` of `getSingleSignature`. With `No`, a type that has a property or an index
/// signature has no single signature.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum AllowMembers {
    No,
    Yes,
}

/// `CallState`
pub(super) struct CallState<'a> {
    pub(super) file: FileId,
    /// The key for `node` in the tables.
    pub(super) call: ExprId,
    pub(super) node: CallLike,
    pub(super) type_args: &'a [TypeId],
    pub(super) args: &'a [Arg],
    /// `getThisArgumentOfCall`
    pub(super) this_arg: Option<ExprId>,
    pub(super) candidates: Sigs,
    pub(super) arg_check_mode: CheckMode,
    pub(super) is_single_non_generic_candidate: bool,
    /// FOR SPEED: there's one candidate, it isn't generic, and the call isn't being resolved again.
    /// The contextual type pushed for an argument is the parameter type of the resolved signature,
    /// so an argument that tsgo checks uncached (`checkExpression`) and again in the deferred check
    /// is checked once.
    pub(super) checks_arguments_once: bool,
    pub(super) candidates_for_argument_error: Sigs,
    pub(super) candidate_for_argument_arity_error: Option<SigId>,
    pub(super) candidate_for_type_argument_error: Option<SigId>,
}

/// The checker state that `push_inference_context` replaces and `pop_inference_context` restores.
struct OutsideInferenceContext {
    mode_of_recheck: CheckMode,
    rechecked: Rechecked,
    /// The argument for `end_recheck`.
    recheck: (usize, usize),
}

pub(super) type Args = SmallVec<[Arg; 8]>;
pub(super) type Sigs = SmallVec<[SigId; 8]>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum SigSymbol {
    Function(Sym),
    Member(Sym, MemberKind, Option<Atom>),
    Literal(FileId, MemberOwner, MemberKind, Option<Atom>),
    Lone(FileId, FnId),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SigParent {
    Block(FileId, Parent),
    Type(FileId, MemberOwner),
    Lone(FileId, FnId),
}

impl<'p, 's> Checker<'p, 's> {
    /// `isContextSensitive`. For `JsxAttributes`, see `is_jsx_attributes_context_sensitive`.
    pub fn is_context_sensitive(&self, file: FileId, e: ExprId) -> bool {
        if self.is_stack_low() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            // There is no case for an accessor.
            ExprKind::Fn(f) => {
                !matches!(hir[f].kind, FnKind::Getter | FnKind::Setter)
                    && self.is_context_sensitive_function_like_declaration(file, f)
            }
            ExprKind::Yield { value, .. } => {
                value.is_some() && self.is_context_sensitive(file, value)
            }
            // There is no case for a `SpreadAssignment` or a `ShorthandPropertyAssignment`.
            ExprKind::Object(props) => props.iter().any(|p| {
                matches!(hir[p].kind, PropKind::Init | PropKind::Method)
                    && hir[p].value.is_some()
                    && self.is_context_sensitive(file, hir[p].value)
            }),
            ExprKind::Array(items) => hir.ids(items).any(|i| self.is_context_sensitive(file, i)),
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                self.is_context_sensitive(file, yes) || self.is_context_sensitive(file, no)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => self.is_context_sensitive(file, left) || self.is_context_sensitive(file, right),
            _ => false,
        }
    }

    /// `isContextSensitiveFunctionLikeDeclaration`
    fn is_context_sensitive_function_like_declaration(&self, file: FileId, f: FnId) -> bool {
        /// Results aren't cached for fewer nested functions than this.
        const MANY: u64 = 8;
        // Every enclosing function asks this about each function nested in it, each time down to
        // the innermost one, so the answer for a deep nest is cached. It only depends on the syntax
        // tree. A function that only returns another function has that function's answer, unless
        // its own parameters decide, so this loops instead of recursing.
        let times_cut_short = self.times_cut_short.get();
        let asked_before = self.context_sensitivity_visits.get();
        let (mut at, mut passed) = (f, 0);
        let answer = loop {
            (self.context_sensitivity_visits).set(self.context_sensitivity_visits.get() + 1);
            if let Some(&known) = self.context_sensitive_functions.borrow().get(&(file, at)) {
                break known;
            }
            if self.has_context_sensitive_parameters(file, at) {
                break true;
            }
            let Some(returned) = self.sole_returned_function(file, at) else {
                break self.has_context_sensitive_return_expression(file, at)
                    || self.has_context_sensitive_yield_expression(file, at);
            };
            (at, passed) = (returned, passed + 1);
        };
        // An answer that was cut short by a low stack depends on the caller, so it isn't cached.
        if self.context_sensitivity_visits.get() - asked_before > MANY
            && self.times_cut_short.get() == times_cut_short
        {
            let mut known = self.context_sensitive_functions.borrow_mut();
            let mut at = Some(f);
            for _ in 0..=passed {
                let Some(it) = at else { break };
                known.insert((file, it), answer);
                at = self.sole_returned_function(file, it);
            }
        }
        answer
    }

    /// Returns the function expression that's the only thing `f` returns, if
    /// `hasContextSensitiveReturnExpression` and `hasContextSensitiveYieldExpression` look at
    /// nothing else.
    fn sole_returned_function(&self, file: FileId, f: FnId) -> Option<FnId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = &hir[f];
        if !func.type_params.is_empty()
            || func.ret.is_some()
            || func.flags.contains(Flags::GENERATOR)
        {
            return None;
        }
        let value = match func.body {
            FnBody::None => return None,
            FnBody::Expr(body) => body,
            FnBody::Block(_) => {
                let mut returns = bound.ids(bound.fns[f.idx()].returns);
                match (returns.next().map(|s| hir[s].kind), returns.next()) {
                    (Some(StmtKind::Return(value)), None) if value.is_some() => value,
                    _ => return None,
                }
            }
        };
        match hir[value].kind {
            ExprKind::Fn(returned)
                if !matches!(hir[returned].kind, FnKind::Getter | FnKind::Setter) =>
            {
                Some(returned)
            }
            _ => None,
        }
    }

    /// `HasContextSensitiveParameters`
    pub(super) fn has_context_sensitive_parameters(&self, file: FileId, f: FnId) -> bool {
        let hir = self.hir(file);
        let func = &hir[f];
        if !func.type_params.is_empty() {
            return false;
        }
        // `node.Parameters()`, of which the `this` parameter is the first.
        if func.this_param.is_some() && func.this_ty(hir).is_none()
            || func.params.iter().any(|p| hir[p].ty.is_none())
        {
            return true;
        }
        func.kind != FnKind::Arrow
            && func.this_param.is_none()
            && self.bound(file).fns[f.idx()].contains_this
    }

    /// `hasContextSensitiveReturnExpression`
    fn has_context_sensitive_return_expression(&self, file: FileId, f: FnId) -> bool {
        let hir = self.hir(file);
        let func = &hir[f];
        if !func.type_params.is_empty() || func.ret.is_some() {
            return false;
        }
        match func.body {
            FnBody::None => false,
            FnBody::Expr(body) => self.is_context_sensitive(file, body),
            FnBody::Block(_) => {
                let bound = self.bound(file);
                bound.ids(bound.fns[f.idx()].returns).any(|s| {
                    matches!(hir[s].kind, StmtKind::Return(value)
                        if value.is_some() && self.is_context_sensitive(file, value))
                })
            }
        }
    }

    /// `hasContextSensitiveYieldExpression`
    fn has_context_sensitive_yield_expression(&self, file: FileId, f: FnId) -> bool {
        let bound = self.bound(file);
        self.hir(file)[f].flags.contains(Flags::GENERATOR)
            && bound
                .ids(bound.fns[f.idx()].yields)
                .any(|y| self.is_context_sensitive(file, y))
    }

    /// `links.resolvedSignature` of `call`, if it's cached, with the signature's return type.
    #[inline]
    pub(super) fn cached_resolved_signature(
        &self,
        file: FileId,
        call: ExprId,
    ) -> Option<ResolvedCall> {
        let sig = self.p.calls.get(&self.task, &(file, call))?;
        let ret = self.p.call_return_types.get(&self.task, &(file, call))?;
        Some(ResolvedCall { sig, ret })
    }

    /// `links.resolvedSignature = result`. The first value wins, and is returned: "it's possible
    /// that this inner resolution sets the resolvedSignature first. In such a case we ignore the
    /// local result and reuse the correct one that was cached."
    fn cache_call(
        &mut self,
        file: FileId,
        call: ExprId,
        resolved: ResolvedCall,
        stored: Stored,
    ) -> ResolvedCall {
        let key = (file, call);
        if self.task.file == Some(file) {
            if self.serialization_level >= super::sink::MAX_SERIALIZATION_LEVEL {
                self.signatures_resolved_with_errors_discarded.push(call);
            } else {
                // An outer resolution, around the one that assigned first, has reported its errors.
                self.signatures_resolved_with_errors_discarded
                    .retain(|&it| it != call);
            }
        }
        ResolvedCall {
            ret: (self.p.call_return_types).insert(&self.task, key, resolved.ret, stored),
            sig: self.p.calls.insert(&self.task, key, resolved.sig, stored),
        }
    }

    /// `anySignature`, which `getContextuallyTypedParameterType` assigns to
    /// `links.resolvedSignature` of an immediately invoked function expression while it checks the
    /// arguments. A type resolution stores what it computes from it:
    /// `const a = { k: ((p) => p)(a) }` is `{ k: any }`. `checkExpression` of the call stores
    /// nothing, so the expressions above the innermost resolution are checked again later.
    #[cold]
    #[inline(never)]
    fn any_signature_while_arguments_are_checked(&mut self) -> ResolvedCall {
        let resolution = self.stack.iter().rposition(|&q| self.is_resolution(q));
        self.mark_tainted_from(resolution.map_or(0, |at| at + 1));
        self.note_any_signature();
        ResolvedCall {
            sig: None,
            ret: TypeId::ANY,
        }
    }

    pub fn resolved_signature(&mut self, file: FileId, call: ExprId) -> ResolvedCall {
        if !self.iife_resolving.is_empty() && self.iife_resolving.contains(&(file, call)) {
            return self.any_signature_while_arguments_are_checked();
        }
        if self.calls_to_resolve_afresh.is_some()
            && let Some(resolved) = self.re_resolve_signature(file, call)
        {
            return resolved;
        }
        if let Some(known) = self.cached_resolved_signature(file, call) {
            return known;
        }
        if let Some(&(.., resolved)) = self
            .resolved_meanwhile
            .iter()
            .rev()
            .find(|r| r.0 == file && r.1 == call)
        {
            return resolved;
        }
        if let Some(raw) = self.provisional(Query::Call(file, call)) {
            return crate::table::Packed::unpack(raw);
        }
        if self.prepare_query_for_expr(file, call)
            && let Some(known) = self.cached_resolved_signature(file, call)
        {
            return known;
        }
        // `resolvingSignature`
        let in_progress_at = self
            .stack
            .iter()
            .rposition(|&q| q == Query::Call(file, call));
        let is_in_progress = in_progress_at.is_some();
        let resolution_start = self.resolution_start;
        // There's no re-entrancy guard. A call that a back edge of a loop reaches while it's being
        // resolved is resolved again, any number of times. See `recheck_in_flow_loop`. A call
        // that's re-entered through a resolution is also resolved again, because that resolution is
        // the guard.
        if in_progress_at.is_some_and(|at| {
            self.flow_loop_pushed_since(at).is_some()
                || self.stack[at..].iter().any(|&q| self.is_resolution(q))
        }) {
            self.resolution_start = self.stack.len();
        }
        let entered = self.enter(Query::Call(file, call));
        self.resolution_start = resolution_start;
        if !entered {
            return ResolvedCall {
                sig: None,
                ret: TypeId::UNRESOLVED,
            };
        }
        // `getResolvedSignature`: "temporarily reset the resolution stack", for a caller that
        // queries something in an argument whose type depends on the call it's an argument of. It's
        // queried again, this time with the call in progress. If that reaches the call as an
        // expression, the call is resolved again, without another reset. Anything that re-enters
        // then is a cycle.
        if !is_in_progress {
            self.resolution_start = self.stack.len();
        }
        let serial = self.work;
        if !is_in_progress {
            // Drop what a resolution inside `re_resolve_signature` left behind.
            self.signatures_resolved_within
                .retain(|r| !(r.0 == file && r.1 == call));
        }
        let outer_errors = self.call_resolution_errors.take();
        let is_re_resolved = std::mem::replace(&mut self.is_call_re_resolved, is_in_progress);
        let resolved = self.resolve_signature(file, call);
        self.is_call_re_resolved = is_re_resolved;
        let reported = std::mem::replace(&mut self.call_resolution_errors, outer_errors);
        self.resolution_start = resolution_start;
        self.resolved_meanwhile.push((file, call, resolved));
        let resolved = self.with_return_type(resolved);
        self.resolved_meanwhile.pop();
        // `getResolvedSignature`: `links.resolvedSignature != c.resolvingSignature`, "this inner
        // resolution sets the resolvedSignature first", and `result = links.resolvedSignature`.
        let assigned_within = (self.signatures_resolved_within.iter())
            .find(|r| r.0 == file && r.1 == call)
            .map(|r| r.2);
        let resolved = assigned_within.unwrap_or(resolved);
        if !is_in_progress {
            self.signatures_resolved_within
                .retain(|r| !(r.0 == file && r.1 == call));
        }
        // tsgo stores `links.resolvedSignature` even while `contextualBindingPatterns` is
        // non-empty.
        let left = self.leave(Query::Call(file, call));
        if let Err(open) = left
            && !is_in_progress
        {
            let raw = crate::table::Packed::pack(resolved);
            self.cache_provisionally(Query::Call(file, call), raw, open);
        }
        let is_tainted_by_patterns_only = !self.contextual_binding_patterns.is_empty()
            && self.taints == self.taints_before_patterns;
        let stored = (left.ok()).or_else(|| is_tainted_by_patterns_only.then(Stored::new));
        // A call that's requested while it's being resolved is resolved again, and `resolveCall`
        // reports its errors in the state at that time. Only the first resolution is retained.
        if is_in_progress {
            if let Some(reported) = reported
                && (self.p.diagnostics_of_re_resolved_calls)
                    .get_ref(&self.task, &(file, call))
                    .is_none()
            {
                let (key, stored) = ((file, call), Stored::new());
                (self.p.diagnostics_of_re_resolved_calls)
                    .insert_ref(&self.task, key, reported, stored);
            }
            // The enclosing resolution takes the result from `Program::calls` or, if it depends on
            // a frame in progress, from `signatures_resolved_within`. It doesn't take a result that
            // was cut short by a rejected query.
            if let Ok(stored) = left
                && !self.is_in_flow_loop()
            {
                return self.cache_call(file, call, resolved, stored);
            }
            if left.is_err()
                && assigned_within.is_none()
                && self.rejected_at < serial
                && !self.is_in_flow_loop()
            {
                self.signatures_resolved_within.push((file, call, resolved));
            }
        } else if let Some(stored) = stored
            && !self.is_in_flow_loop()
        {
            // A task that sees the call resolved also sees this, because one commit publishes both.
            if let Some(reported) = reported {
                (self.p.call_diagnostics).insert_ref(&self.task, (file, call), reported, stored);
            }
            return self.cache_call(file, call, resolved, stored);
        } else if let Some(reported) = reported
            && self.is_in_flow_loop()
        {
            // `len(c.flowLoopStack) != 0`: the signature isn't stored, and the errors that
            // `resolveCall` reported from the temporary types stay.
            self.reported.extend(reported);
        }
        resolved
    }

    /// `resolved_signature` for one of `calls_to_resolve_afresh`, run once for each. What's stored and what was
    /// reported for the call stay unchanged. Returns `None` if `call` isn't one of them, or if it's requested while
    /// it's being resolved this way. Then the stored result is used.
    #[cold]
    fn re_resolve_signature(&mut self, file: FileId, call: ExprId) -> Option<ResolvedCall> {
        let (of, start, end) = self.calls_to_resolve_afresh?;
        if of != file || !(start..end).contains(&self.hir(file)[call].pos) {
            return None;
        }
        if let Some(&(_, known)) = self.calls_resolved_afresh.iter().find(|it| it.0 == call) {
            return known;
        }
        let resolution_start = self.resolution_start;
        if !self.enter(Query::Call(file, call)) {
            return None;
        }
        let at = self.calls_resolved_afresh.len();
        self.calls_resolved_afresh.push((call, None));
        self.resolution_start = self.stack.len();
        let outer_errors = self.call_resolution_errors.take();
        let resolved = self.resolve_signature(file, call);
        self.call_resolution_errors = outer_errors;
        self.resolution_start = resolution_start;
        self.resolved_meanwhile.push((file, call, resolved));
        let resolved = self.with_return_type(resolved);
        self.resolved_meanwhile.pop();
        let _ = self.leave(Query::Call(file, call));
        self.calls_resolved_afresh[at].1 = Some(resolved);
        Some(resolved)
    }

    fn effective_args(&mut self, file: FileId, args: IdList<ExprId>) -> Args {
        let hir = self.hir(file);
        let mut out = Args::new();
        if hir
            .ids(args)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            for a in hir.ids(args) {
                self.each_effective_arg(file, a, |arg| out.push(arg));
            }
        } else {
            out.extend(hir.ids(args).map(Arg::Expr));
        }
        out
    }

    /// Calls `push` with what the argument `a` expands to: itself, or the elements it spreads.
    #[inline]
    pub(super) fn each_effective_arg(
        &mut self,
        file: FileId,
        a: ExprId,
        mut push: impl FnMut(Arg),
    ) {
        match self.hir(file)[a].kind {
            ExprKind::Spread(inner) => self.each_spread_arg(file, a, inner, push),
            _ => push(Arg::Expr(a)),
        }
    }

    fn each_spread_arg(
        &mut self,
        file: FileId,
        a: ExprId,
        inner: ExprId,
        mut push: impl FnMut(Arg),
    ) {
        let ty = self.type_of_expr(file, inner);
        match self.data(ty) {
            // `getEffectiveCallArguments`: a `...T` in it is a spread of `T`, a `...X[]` one of `X[]`.
            TypeData::Tuple { flags, .. } => {
                for (&e, f) in self.type_arguments(ty).iter().zip(flags.iter()) {
                    if f.contains(ElemFlags::VARIADIC) {
                        let element = self.indexed_access(e, TypeId::NUMBER);
                        push(Arg::Spread(element, e, f.labeled_declaration(), a));
                    } else if f.contains(ElemFlags::REST) {
                        let list = self.array_of(e);
                        push(Arg::Spread(e, list, f.labeled_declaration(), a));
                    } else {
                        push(Arg::Type(e, f.labeled_declaration(), a));
                    }
                }
            }
            _ => {
                // `checkIteratedTypeOrElementType`: a type that isn't iterable is an error, and
                // yields `any`. The error isn't reported for a type the operand is only assumed to
                // have.
                let element = self.iterated_type_of_spread(ty);
                push(Arg::SpreadElement(element, ty, inner, a));
            }
        }
    }

    /// The part of `getContextuallyTypedParameterType` for an immediately invoked function
    /// expression, whose parameters are typed from its arguments. Returns `None` if `func` isn't
    /// one, and `Some(None)` if it is but the arguments determine nothing for this parameter.
    pub(super) fn iife_param_type(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
    ) -> Option<Option<TypeId>> {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
            return None;
        };
        let Parent::Expr(parent) = bound.parent_of_expr(e) else {
            return None;
        };
        let ExprKind::Call(c) = hir[parent].kind else {
            return None;
        };
        if hir[c].callee != e {
            return None;
        }
        Some(self.iife_param_type_from_args(file, func, index, parent, hir[c].args))
    }

    fn iife_param_type_from_args(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
        call: ExprId,
        args: IdList<ExprId>,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let args = self.effective_args(file, args);
        let own = &hir[hir[func].params.at(index)];
        // `slices.Index(fn.Parameters(), parameter)`, where `this` comes first. It isn't subtracted
        // here.
        let index = index + usize::from(hir[func].this_param.is_some());
        // This doesn't run under `anySignature`, so a request for the call resolves it again.
        // `assignParameterType` doesn't push a type resolution, and the arguments are checked with
        // `checkExpression`, so the parameter's resolutions don't hide any loop from them.
        if own.flags.contains(Flags::REST) {
            return Some(self.with_flow_loops_visible(|c| {
                c.spread_argument_type(file, &args, index, TypeId::ANY, None, CheckMode::empty())
            }));
        }
        match args.get(index) {
            Some(&Arg::Expr(a)) => {
                // `links.resolvedSignature = c.anySignature`: the contextual type of the argument is
                // what is being computed.
                self.iife_resolving.push((file, call));
                let ty = self.with_flow_loops_visible(|c| c.type_of_expr(file, a));
                self.iife_resolving.pop();
                Some(self.widen_literal(ty))
            }
            Some(&(Arg::Type(ty, ..) | Arg::Spread(ty, ..) | Arg::SpreadElement(ty, ..))) => {
                Some(ty)
            }
            None if own.default.is_some() => None,
            None => Some(self.undefined_widening()),
        }
    }

    /// `callIsIncomplete`: the tagged template is unterminated, or the `)` of the call is missing.
    /// `close_pos` is the position where the parser expected the `)`. The default library's source
    /// text isn't available.
    pub(super) fn is_call_incomplete(&self, file: FileId, call: ExprId, node: CallLike) -> bool {
        let CallLike::Call(id) = node else {
            return false;
        };
        let hir = self.hir(file);
        let close_pos = hir[id].close_pos;
        if matches!(hir[call].kind, ExprKind::TaggedTemplate(_)) {
            return close_pos == INCOMPLETE_TEMPLATE;
        }
        close_pos != u32::MAX
            && !hir.text.is_empty()
            && hir.text.get(close_pos as usize) != Some(&b')')
    }

    /// `hasCorrectArity`
    pub(super) fn has_correct_arity(
        &mut self,
        s: &CallState<'_>,
        sig: SigId,
        params: &List<'_, SigParam>,
    ) -> bool {
        let (file, call, node, args) = (s.file, s.call, s.node, s.args);
        // The attributes are a single argument, regardless of the component's other parameters.
        if matches!(node, CallLike::Jsx(_)) {
            return true;
        }
        let actual = match node {
            CallLike::Decorator(owner) => self.decorator_argument_count(file, owner, params),
            _ => args.len(),
        };
        let spread = args.iter().position(|a| a.is_spread());
        let is_incomplete = |c: &Self| c.is_call_incomplete(file, call, node);
        let is_open = matches!(params, List::Own(_));
        self.has_correct_arity_for_count(sig, params, is_open, actual, spread, &is_incomplete)
    }

    /// `hasCorrectArity` for a call with `actual` arguments. `spread` is the index of the first
    /// spread argument. `is_open` means `sig_params` couldn't store `params`, so a cycle through a
    /// parameter's type has to be found where tsgo requests that type. `is_incomplete` computes
    /// `callIsIncomplete`.
    fn has_correct_arity_for_count(
        &mut self,
        sig: SigId,
        params: &[SigParam],
        is_open: bool,
        actual: usize,
        spread: Option<usize>,
        is_incomplete: &dyn Fn(&Self) -> bool,
    ) -> bool {
        // Which parameters accept `void` only matters if a required one is omitted. That
        // `getMinArgumentCount` requests their types only matters for `get_type_of_parameter` of a
        // pattern, for a type that `params` lacks, and if `is_open`.
        let rest = params.last().filter(|p| p.rest);
        if !is_open
            && spread.is_none()
            && !rest.is_some_and(|p| self.is_tuple(p.ty))
            && !(params.iter()).any(|p| p.is_named_by_pattern() || p.ty == TypeId::UNRESOLVED)
        {
            if actual > params.len() {
                return rest.is_some();
            }
            let may_be_omitted = |p: &SigParam| p.optional || p.rest && !p.is_required_rest;
            if params[actual..].iter().all(may_be_omitted) || is_incomplete(self) {
                return true;
            }
        }
        let count = self.parameter_count(params);
        let least = self.min_argument_count_for(Some(sig), params);
        if is_open {
            // `getParameterCount`, then `getMinArgumentCount`: from the last required parameter
            // down to one that doesn't accept `void`.
            let required = &params[..Self::min_args(params)];
            let requested = required.iter().skip(least.saturating_sub(1)).rev();
            for param in rest.into_iter().chain(requested) {
                self.request_type_of_parameter(param);
            }
        }
        let has_rest = self.has_effective_rest_parameter(params);
        // The spread argument comes after all required parameters, and either reaches a rest
        // parameter or at least starts within the parameter list.
        if let Some(spread) = spread {
            return spread >= least && (has_rest || spread < count);
        }
        if actual > count && !has_rest {
            return false;
        }
        if is_incomplete(self) {
            return true;
        }
        // `acceptsVoid`: only a parameter that accepts `void` may be omitted. That can't be
        // determined for a parameter whose type isn't known.
        for i in actual..least {
            if is_open && let Some(param) = params.get(i) {
                self.request_type_of_parameter(param);
            }
            let Some(ty) = self.param_type_asked_at(sig, params, i) else {
                return false;
            };
            if !self.some_type(ty, |_, m| m == TypeId::VOID || m == TypeId::UNRESOLVED) {
                return false;
            }
        }
        true
    }

    fn resolve_signature(&mut self, file: FileId, call: ExprId) -> ResolvedCall {
        let hir = self.hir(file);
        if let ExprKind::Jsx(j) = hir[call].kind {
            return self.resolve_jsx_opening_like_element(file, call, j);
        }
        // `resolveTaggedTemplateExpression`: a call whose first argument is the pieces of text.
        if let ExprKind::TaggedTemplate(c) = hir[call].kind {
            let Call {
                callee: tag,
                args: exprs,
                type_args,
                ..
            } = hir[c];
            let callee = self.type_of_expr(file, tag);
            let apparent = self.apparent_type(callee);
            if self.is_error_type(apparent) {
                return self.resolve_error_call(file, exprs);
            }
            if callee == TypeId::UNRESOLVED {
                return ResolvedCall {
                    ret: callee,
                    ..self.resolve_untyped_call(file, exprs)
                };
            }
            let sigs = self.signatures(callee, false);
            if sigs.is_empty() {
                let constructs = self.signatures(callee, true).len();
                return if self.is_untyped_function_call(callee, apparent, 0, constructs) {
                    self.resolve_untyped_call(file, exprs)
                } else {
                    // `invocationError`
                    self.resolve_by_printing(apparent);
                    self.resolve_error_call(file, exprs)
                };
            }
            let type_args = hir.list_at(type_args);
            self.precheck_type_nodes(file, type_args);
            let type_args = self.types_from_nodes(file, type_args);
            let node = CallLike::Call(c);
            let args = self.effective_call_arguments(file, call, node);
            let this_arg = self.this_argument_of_call(file, call, node);
            return self.resolve_call(
                file,
                call,
                node,
                &sigs,
                &type_args,
                &args,
                this_arg,
                ExpectsReturn::Yes,
                None,
            );
        }
        if let ExprKind::Binary {
            op: BinOp::Instanceof,
            left,
            right,
        } = hir[call].kind
        {
            return self.resolve_instanceof_expression(file, call, left, right);
        }
        let (id, is_new) = match hir[call].kind {
            ExprKind::Call(c) => (c, false),
            ExprKind::New(c) => (c, true),
            _ => {
                return ResolvedCall {
                    sig: None,
                    ret: TypeId::UNRESOLVED,
                };
            }
        };
        // `checkCallExpression`: if the callee is `super` the expression has type `void`, whatever
        // it resolves to. `super` only represents the base class's constructors as a callee. The
        // `super` of `new super()` is the same as in `super.x`.
        if matches!(hir[hir[id].callee].kind, ExprKind::Super) {
            let resolved = if is_new {
                self.resolve_call_or_new(file, call, id, true)
            } else {
                self.resolve_super_call(file, call, id)
            };
            return ResolvedCall {
                ret: TypeId::VOID,
                ..resolved
            };
        }
        self.resolve_call_or_new(file, call, id, is_new)
    }

    /// `resolveUntypedCall`: the arguments have no contextual type, and they are checked anyway.
    /// Anything there that re-enters a resolution in progress is a cycle. The result is
    /// `anySignature`.
    fn resolve_untyped_call(&mut self, file: FileId, args: IdList<ExprId>) -> ResolvedCall {
        // `getResolvedSignature` resets `resolutionStart` only the first time. When the call is
        // resolved again, the arguments are already being checked, and they're checked again,
        // uncached (`checkExpression`), with no re-entrancy guard.
        let outer = (self.resolution_start != self.stack.len()).then(|| self.begin_recheck());
        for arg in self.hir(file).ids(args) {
            let ty = self.type_of_expr(file, arg);
            // `checkSpreadExpression`
            if let ExprKind::Spread(operand) = self.hir(file)[arg].kind {
                self.check_iterated_type_of_spread_element(file, ty, operand);
            }
        }
        if let Some(outer) = outer {
            self.end_recheck(outer);
        }
        ResolvedCall {
            sig: None,
            ret: TypeId::ANY,
        }
    }

    /// `resolveErrorCall`: same, but the result is `unknownSignature`, which returns the error
    /// type.
    fn resolve_error_call(&mut self, file: FileId, args: IdList<ExprId>) -> ResolvedCall {
        ResolvedCall {
            ret: TypeId::ERROR,
            ..self.resolve_untyped_call(file, args)
        }
    }

    /// `resolveCallExpression` for `super(..)`: the callee is one of the constructors of the base
    /// class, instantiated with the type arguments of the `extends` clause.
    fn resolve_super_call(&mut self, file: FileId, call: ExprId, id: CallId) -> ResolvedCall {
        let hir = self.hir(file);
        let Call { callee, args, .. } = hir[id];
        // `IsTypeAny`, which the error type of a misplaced `super` is too.
        let super_type = self.type_of_expr(file, callee);
        if self.is_any(super_type) {
            return self.resolve_untyped_call(file, args);
        }
        let class = hir.class_of(hir.get_containing_class(hir.node(call)));
        if class.is_none() || hir[class].extends.is_none() {
            return self.resolve_untyped_call(file, args);
        }
        let class = self.class_sym(file, class);
        let sigs = self.super_constructor_sigs(class);
        let args = self.effective_args(file, args);
        self.resolve_call(
            file,
            call,
            CallLike::Call(id),
            &sigs,
            &[],
            &args,
            None,
            ExpectsReturn::Yes,
            None,
        )
    }

    /// `resolveCallExpression`, `resolveNewExpression`
    fn resolve_call_or_new(
        &mut self,
        file: FileId,
        call: ExprId,
        id: CallId,
        is_new: bool,
    ) -> ResolvedCall {
        let hir = self.hir(file);
        let data = &hir[id];
        let is_re_resolved = self.is_call_re_resolved;
        // `getOptionalExpressionType`
        let callee = self.chain_receiver(file, data.callee, data.chain).0;
        // `check_call` reports it for the type that the callee has in the end.
        let callee = if is_re_resolved {
            let since = self.reported.len();
            let callee = self.check_non_null_callee(file, data.callee, callee, is_new);
            let reported = self.take_reported_from(since);
            if !reported.is_empty() {
                (self.call_resolution_errors.get_or_insert_default()).extend(reported);
            }
            callee
        } else {
            self.non_null_type(callee)
        };
        // `silentNeverSignature`
        if callee == TypeId::SILENT_NEVER {
            return ResolvedCall {
                sig: None,
                ret: callee,
            };
        }
        let apparent = self.apparent_type(callee);
        if self.is_error_type(apparent) {
            return self.resolve_error_call(file, data.args);
        }
        // `isUntypedFunctionCall`, and `IsTypeAny(expressionType)` in `resolveNewExpression`.
        if self.is_any(callee) || is_new && self.has_any_flag(apparent) {
            let again = (is_re_resolved && callee != TypeId::UNRESOLVED).then_some((file, call));
            let outer = std::mem::replace(&mut self.untyped_call_resolved_again, again);
            let resolved = self.resolve_untyped_call(file, data.args);
            self.untyped_call_resolved_again = outer;
            return ResolvedCall {
                ret: if callee == TypeId::UNRESOLVED {
                    callee
                } else {
                    TypeId::ANY
                },
                ..resolved
            };
        }
        let in_place = self.members_in_place_hits;
        let mut sigs = self.signatures(callee, is_new);
        // A class that may not be constructed from here is an error.
        if is_new
            && !sigs.is_empty()
            && (self
                .inaccessible_constructor(file, call, sigs[0])
                .map(|(code, _)| code)
                .is_some()
                || self.has_abstract_construct_signature(callee))
        {
            return self.resolve_error_call(file, data.args);
        }
        // `new` on a type that has only call signatures is resolved as a call.
        let is_call_by_new = is_new && sigs.is_empty();
        if is_call_by_new {
            sigs = self.signatures(callee, false);
        }
        if sigs.is_empty() {
            let is_untyped = !is_new && {
                let constructs = self.signatures(callee, true).len();
                self.is_untyped_function_call(callee, apparent, 0, constructs)
            };
            return if is_untyped {
                self.resolve_untyped_call(file, data.args)
            } else {
                if self.members_in_place_hits != in_place
                    || !self.declared_index_infos_in_progress.is_empty()
                {
                    let key = (file, call);
                    (self.p.calls_before_signatures).insert(&self.task, key, (), Stored::new());
                }
                // `invocationError`
                self.resolve_by_printing(apparent);
                self.resolve_error_call(file, data.args)
            };
        }
        if !matches!(hir[data.callee].kind, ExprKind::Super) {
            self.precheck_type_nodes(file, hir.list_at(data.type_args));
        }
        let type_args = self.types_from_nodes(file, hir.list_at(data.type_args));
        let args = self.effective_args(file, data.args);
        let node = CallLike::Call(id);
        let this_arg = self.this_argument_of_call(file, call, node);
        // `resolveNewExpression` reads the return type of a call signature invoked with `new` only without `noImplicitAny` (2350).
        let expects_return = if is_call_by_new && self.p.files.options.no_implicit_any {
            ExpectsReturn::No
        } else {
            ExpectsReturn::Yes
        };
        let resolved = self.resolve_call(
            file,
            call,
            node,
            &sigs,
            &type_args,
            &args,
            this_arg,
            expects_return,
            None,
        );
        // `checkCallExpression`: `new` on something that isn't a constructor yields `any`.
        if is_call_by_new {
            ResolvedCall {
                ret: TypeId::ANY,
                ..resolved
            }
        } else {
            resolved
        }
    }

    /// `resolveInstanceofExpression`
    fn resolve_instanceof_expression(
        &mut self,
        file: FileId,
        call: ExprId,
        left: ExprId,
        right: ExprId,
    ) -> ResolvedCall {
        let any_signature = ResolvedCall {
            sig: None,
            ret: TypeId::ANY,
        };
        // `checkBinaryLikeExpression` has checked both operands, without a contextual type.
        self.type_of_expr(file, left);
        let right_type = self.type_of_expr(file, right);
        if self.is_any(right_type) {
            return any_signature;
        }
        // `resolveErrorCall`
        let unknown_signature = ResolvedCall {
            sig: None,
            ret: TypeId::ERROR,
        };
        let Some(method) = self.symbol_has_instance_method_of_object_type(right_type) else {
            let function = self.global_ref(known::Function, &[]);
            if !self.signatures(right_type, false).is_empty()
                || !self.signatures(right_type, true).is_empty()
                || self.is_subtype(right_type, function)
            {
                return any_signature;
            }
            let since = self.reported.len();
            self.error(file, self.hir(file).child(right), 2359, &[]);
            let reported = self.take_reported_from(since);
            (self.call_resolution_errors.get_or_insert_default()).extend(reported);
            return unknown_signature;
        };
        let apparent = self.apparent_type(method);
        if self.is_error_type(apparent) {
            return unknown_signature;
        }
        let sigs = self.signatures(apparent, false);
        let constructs = self.signatures(apparent, true).len();
        if sigs.is_empty()
            || self.is_untyped_function_call(method, apparent, sigs.len(), constructs)
        {
            return any_signature;
        }
        let node = CallLike::InstanceOf { left, right };
        let args = self.effective_call_arguments(file, call, node);
        self.resolve_call(
            file,
            call,
            node,
            &sigs,
            &[],
            &args,
            Some(right),
            ExpectsReturn::Yes,
            Some(2860),
        )
    }

    /// `getSymbolHasInstanceMethodOfObjectType`
    pub(super) fn symbol_has_instance_method_of_object_type(
        &mut self,
        ty: TypeId,
    ) -> Option<TypeId> {
        let name = self.atoms().symbol_name(b"hasInstance");
        // `getPropertyOfType`: an index signature isn't a property.
        let mut methods = Vec::new();
        for &part in self.parts(ty) {
            if !self.is_assignable(part, TypeId::OBJECT) {
                return None;
            }
            let apparent = self.apparent_type(part);
            for &member in self.parts(apparent) {
                let members = self.members(member)?;
                let (prop, mapper) = self.property_in_type(member, &members, name)?;
                methods.push(self.type_of_prop(prop, mapper));
            }
        }
        let method = self.union(&methods);
        (!self.signatures(method, false).is_empty()).then_some(method)
    }

    /// `someSignature(constructSignatures, abstract)`: the signature synthesized for a union is
    /// abstract if any member's is.
    pub(super) fn has_abstract_construct_signature(&mut self, ty: TypeId) -> bool {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            return parts
                .iter()
                .any(|&part| self.has_abstract_construct_signature(part));
        }
        self.signatures(ty, true)
            .iter()
            .any(|&sig| self.is_abstract_signature(sig))
    }

    /// `getQuickTypeOfExpression` for `new`, regardless of errors in the call.
    pub(super) fn quick_type_of_new(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let ExprKind::New(c) = self.hir(file)[e].kind else {
            return None;
        };
        let callee = self.hir(file)[c].callee;
        let called = self.type_of_expr(file, callee);
        let func_type = self.check_non_null_type(file, callee, called);
        self.return_type_of_single_non_generic_signature(func_type, SignatureKind::Construct)
    }

    /// `getQuickTypeOfExpression` for a call. The arguments aren't checked.
    pub(super) fn quick_type_of_call(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[e].kind else {
            return None;
        };
        let callee = hir[c].callee;
        if matches!(hir[callee].kind, ExprKind::Super)
            || crate::bind::required_specifier(hir, e).is_some()
            || self.is_symbol_or_symbol_for_call(file, e)
        {
            return None;
        }
        if hir[c].chain != Chain::No {
            return self.return_type_of_single_non_generic_signature_of_call_chain(file, c);
        }
        let called = self.type_of_expr(file, callee);
        let func_type = self.check_non_null_type(file, callee, called);
        self.return_type_of_single_non_generic_signature(func_type, SignatureKind::Call)
    }

    /// `getReturnTypeOfSingleNonGenericSignature`
    fn return_type_of_single_non_generic_signature(
        &mut self,
        func_type: TypeId,
        kind: SignatureKind,
    ) -> Option<TypeId> {
        let signature = self.single_signature(func_type, kind, AllowMembers::Yes)?;
        if !self.sig_type_params(signature).is_empty() {
            return None;
        }
        Some(self.sig_return(signature))
    }

    /// `getReturnTypeOfSingleNonGenericSignatureOfCallChain`. The signature comes from the callee's
    /// type as is, so there's none if the chain may short-circuit before the call.
    fn return_type_of_single_non_generic_signature_of_call_chain(
        &mut self,
        file: FileId,
        c: CallId,
    ) -> Option<TypeId> {
        let Call { callee, chain, .. } = self.hir(file)[c];
        let func_type = self.type_of_expr(file, callee);
        let return_type =
            self.return_type_of_single_non_generic_signature(func_type, SignatureKind::Call)?;
        // `nonOptionalType != funcType`, `propagateOptionalTypeMarker`
        if self.chain_receiver(file, callee, chain).1 {
            Some(self.optional(return_type))
        } else {
            Some(return_type)
        }
    }

    /// `resolveCall`
    pub(super) fn resolve_call(
        &mut self,
        file: FileId,
        call: ExprId,
        node: CallLike,
        signatures: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        expects_return: ExpectsReturn,
        head_message: Option<u32>,
    ) -> ResolvedCall {
        let candidates = self.candidates_in_order(signatures);
        // `unknownSignature`
        if candidates.is_empty() {
            return ResolvedCall {
                sig: None,
                ret: TypeId::ERROR,
            };
        }
        let mut s = CallState {
            file,
            call,
            node,
            type_args,
            args,
            this_arg,
            candidates: SmallVec::from_slice(&candidates),
            arg_check_mode: CheckMode::empty(),
            is_single_non_generic_candidate: false,
            checks_arguments_once: false,
            candidates_for_argument_error: Sigs::new(),
            candidate_for_argument_arity_error: None,
            candidate_for_type_argument_error: None,
        };
        s.is_single_non_generic_candidate =
            s.candidates.len() == 1 && self.sig_type_params(s.candidates[0]).is_empty();
        s.checks_arguments_once = s.is_single_non_generic_candidate
            && matches!(node, CallLike::Call(_) | CallLike::Jsx(_))
            // `getResolvedSignature` resets `resolutionStart` only the first time.
            && self.resolution_start == self.stack.len()
            && self.stack.last() == Some(&Query::Call(file, call));
        let has_context_sensitive_argument = match node {
            CallLike::Decorator(_) => false,
            CallLike::Jsx(j) => self.is_jsx_attributes_context_sensitive(file, j),
            _ => args
                .iter()
                .any(|a| matches!(a, Arg::Expr(e) if self.is_context_sensitive(file, *e))),
        };
        if has_context_sensitive_argument && !s.is_single_non_generic_candidate {
            s.arg_check_mode = CheckMode::SKIP_CONTEXT_SENSITIVE;
        }
        let mut result = None;
        if s.candidates.len() > 1 {
            result = self.choose_overload(&mut s, Relation::Subtype);
        }
        if result.is_none() {
            result = self.choose_overload(&mut s, Relation::Assignable);
        }
        let is_chosen = result.is_some();
        let sig = match result {
            Some(sig) => sig,
            None => self.candidate_for_overload_failure(&s),
        };
        // `reorderCandidates`: with `callChainFlags` a candidate is its `getOptionalCallSignature`.
        // Only the return type of the clone differs, so the chosen signature is cloned.
        let sig = self.optional_call_signature_in_chain(file, call, sig);
        let resolved = ResolvedCall {
            sig: Some(sig),
            // Not requested yet. See `with_return_type`.
            ret: if expects_return == ExpectsReturn::Yes {
                TypeId::UNRESOLVED
            } else {
                TypeId::ANY
            },
        };
        if !is_chosen {
            // `resolvedSignature = result`, before the errors are reported.
            self.resolved_meanwhile.push((file, call, resolved));
            let since = self.reported.len();
            self.report_call_resolution_errors(&s, signatures, head_message);
            self.resolved_meanwhile.pop();
            // Another checker may be the one to report it.
            let reported = self.take_reported_from(since);
            // If `addDiagnostic` discarded them, the entry still records that
            // `getCandidateForOverloadFailure` deferred the call.
            if !reported.is_empty()
                || self.serialization_level >= super::sink::MAX_SERIALIZATION_LEVEL
            {
                (self.call_resolution_errors.get_or_insert_default()).extend(reported);
            }
        }
        resolved
    }

    /// `checkCallExpression`: `getReturnTypeOfSignature(signature)`. It runs after
    /// `getResolvedSignature` has restored `resolutionStart`, so the resolutions in progress around
    /// the call are visible to it.
    pub(super) fn with_return_type(&mut self, resolved: ResolvedCall) -> ResolvedCall {
        match resolved {
            ResolvedCall {
                sig: Some(sig),
                ret: TypeId::UNRESOLVED,
            } => ResolvedCall {
                ret: self.sig_return(sig),
                ..resolved
            },
            _ => resolved,
        }
    }

    /// `chooseOverload`
    fn choose_overload(&mut self, s: &mut CallState<'_>, relation: Relation) -> Option<SigId> {
        s.candidates_for_argument_error.clear();
        s.candidate_for_argument_arity_error = None;
        s.candidate_for_type_argument_error = None;
        if s.is_single_non_generic_candidate {
            let candidate = s.candidates[0];
            let params = self.sig_params_with_first(candidate, 0);
            if !s.type_args.is_empty() || !self.has_correct_arity(s, candidate, &params) {
                return None;
            }
            if !self.is_signature_applicable(s, candidate, relation, CheckMode::empty(), false) {
                s.candidates_for_argument_error.push(candidate);
                return None;
            }
            return Some(candidate);
        }
        for index in 0..s.candidates.len() {
            let candidate = s.candidates[index];
            let type_params = self.sig_type_params(candidate);
            let params = self.sig_params_with_first(candidate, 0);
            if !self.has_correct_type_argument_arity(&type_params, s.type_args.len())
                || !self.has_correct_arity(s, candidate, &params)
            {
                continue;
            }
            let has_generic_rest = self.non_array_rest_type(&params).is_some();
            let mut check_candidate = candidate;
            let mut inference_context = None;
            if !type_params.is_empty() {
                if !s.type_args.is_empty() {
                    let Some(filled) =
                        self.check_type_arguments(candidate, &type_params, s.type_args, None)
                    else {
                        s.candidate_for_type_argument_error = Some(candidate);
                        continue;
                    };
                    let mapper = self.mapper_from(&type_params, &filled);
                    check_candidate = self.instantiate_sig(candidate, mapper);
                } else {
                    let mut context =
                        Box::new(Inference::for_params(&type_params, Some(candidate)));
                    context.any_default = self.hir(s.file).is_js;
                    let check_mode = s.arg_check_mode | CheckMode::SKIP_GENERIC_FUNCTIONS;
                    let mapper = self.infer_type_arguments(s, candidate, check_mode, &mut context);
                    if context.skipped_generic_function {
                        s.arg_check_mode |= CheckMode::SKIP_GENERIC_FUNCTIONS;
                    }
                    check_candidate = self.signature_instantiation(
                        candidate,
                        mapper,
                        &context.inferred_type_params,
                    );
                    inference_context = Some(context);
                }
                // The instantiation of a generic rest type can change the arity.
                if has_generic_rest {
                    let instantiated = self.sig_params_with_first(check_candidate, 0);
                    if !self.has_correct_arity(s, check_candidate, &instantiated) {
                        s.candidate_for_argument_arity_error = Some(check_candidate);
                        continue;
                    }
                }
            }
            if !self.is_signature_applicable(s, check_candidate, relation, s.arg_check_mode, false)
            {
                s.candidates_for_argument_error.push(check_candidate);
                continue;
            }
            if !s.arg_check_mode.is_empty() {
                s.arg_check_mode = CheckMode::empty();
                if let Some(context) = &mut inference_context {
                    let mapper =
                        self.infer_type_arguments(s, candidate, CheckMode::empty(), context);
                    check_candidate = self.signature_instantiation(
                        candidate,
                        mapper,
                        &context.inferred_type_params,
                    );
                    if has_generic_rest {
                        let instantiated = self.sig_params_with_first(check_candidate, 0);
                        if !self.has_correct_arity(s, check_candidate, &instantiated) {
                            s.candidate_for_argument_arity_error = Some(check_candidate);
                            continue;
                        }
                    }
                }
                if !self.is_signature_applicable(
                    s,
                    check_candidate,
                    relation,
                    CheckMode::empty(),
                    false,
                ) {
                    s.candidates_for_argument_error.push(check_candidate);
                    continue;
                }
            }
            s.candidates[index] = check_candidate;
            return Some(check_candidate);
        }
        None
    }

    /// `inferTypeArguments`. The mapper is `getInferredTypes(context)`.
    pub(super) fn infer_type_arguments(
        &mut self,
        s: &CallState<'_>,
        signature: SigId,
        check_mode: CheckMode,
        context: &mut Box<Inference>,
    ) -> MapperId {
        let (file, call, args) = (s.file, s.call, s.args);
        if let CallLike::Jsx(j) = s.node
            && self.hir(file)[j].tag.is_some()
        {
            return self.infer_jsx_type_arguments(file, call, signature, check_mode, context);
        }
        if matches!(s.node, CallLike::Call(_)) {
            let mut skip_binding_patterns = true;
            for i in 0..context.params.len() {
                skip_binding_patterns =
                    skip_binding_patterns && self.has_default(context.params[i]);
            }
            let context_flags = if skip_binding_patterns {
                ContextFlags::SKIP_BINDING_PATTERNS
            } else {
                ContextFlags::empty()
            };
            if let Some(contextual_type) = self.contextual_type(file, call, context_flags) {
                let inference_target_type = self.return_type_in_chain(file, call, signature);
                if self.could_contain_type_variables(inference_target_type) {
                    let outer_context = self.get_inference_context(file, call);
                    let is_from_binding_pattern = !skip_binding_patterns && {
                        self.requested_assignment_target = None;
                        self.contextual_type(file, call, ContextFlags::SKIP_BINDING_PATTERNS)
                            != Some(contextual_type)
                            || self.is_contextual_type_newly_created(contextual_type)
                    };
                    if !is_from_binding_pattern {
                        // `getMapperFromContext(cloneInferenceContext(outerContext, InferenceFlagsNoDefault))`
                        let instantiated_type = outer_context
                            .and_then(|level| {
                                self.with_inference_context(level, |c, outer| {
                                    let mut clone = Self::clone_inference_context(outer, true);
                                    let outer_mapper = c.fixing_mapper(&mut clone, contextual_type);
                                    c.instantiate(contextual_type, outer_mapper)
                                })
                            })
                            .unwrap_or(contextual_type);
                        let inference_source_type =
                            match self.single_call_signature(instantiated_type) {
                                Some(generic) if !self.sig_type_params(generic).is_empty() => {
                                    let plain = self.without_filling_in_type_arguments(generic);
                                    self.type_of_signature(plain, false)
                                }
                                _ => instantiated_type,
                            };
                        self.infer(
                            context,
                            inference_source_type,
                            inference_target_type,
                            PRIORITY_RETURN,
                        );
                    }
                    let mut return_context =
                        Inference::for_params(&context.params, Some(signature));
                    return_context.any_default = context.any_default;
                    let return_source_type = match outer_context {
                        Some(level) => {
                            self.instantiate_with_outer_return_mapper(level, contextual_type)
                        }
                        None => contextual_type,
                    };
                    self.infer(
                        &mut return_context,
                        return_source_type,
                        inference_target_type,
                        0,
                    );
                    context.return_context = Self::clone_inferred_part_of_context(&return_context);
                }
            }
        }
        // `getTypeAtPosition(signature, i)` for every argument.
        let params = self.sig_params_up_to(signature, args.len());
        let rest_type = self.non_array_rest_type(&params);
        let arg_count = if rest_type.is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        if let Some(rest) = rest_type
            && let Some(k) = context.params.iter().position(|&p| p == rest)
            && !args[arg_count..].iter().any(|a| a.is_spread())
        {
            context.candidates[k].implied_arity = Some(args.len() - arg_count);
        }
        if let Some(this_type) = self.sig_this_type(signature)
            && self.could_contain_type_variables(this_type)
        {
            let this_argument_type = self.this_argument_type(file, s.this_arg);
            self.infer(context, this_argument_type, this_type, 0);
        }
        for (i, &arg) in args.iter().enumerate().take(arg_count) {
            if matches!(self.hir(file)[arg.node()].kind, ExprKind::Missing) {
                continue;
            }
            if let Some(param_type) = self.param_type_at(&params, i)
                && self.could_contain_type_variables(param_type)
            {
                let arg_type =
                    self.check_argument(file, arg, param_type, Some(context), check_mode);
                self.infer(context, arg_type, param_type, 0);
            }
        }
        if let Some(rest) = rest_type
            && self.could_contain_type_variables(rest)
        {
            let spread_type =
                self.spread_argument_type(file, args, arg_count, rest, Some(context), check_mode);
            self.infer(context, spread_type, rest, 0);
        }
        self.inference_mapper(context)
    }

    /// True if the `getContextualType` call that just returned `contextual_type` created it, so no
    /// other call returns an identical type. An assigned value's contextual type is
    /// `getTypeOfExpression(left)`. `checkObjectLiteral` creates a type on every call, and
    /// `flowTypeCache` only caches it if the check needed control flow analysis.
    fn is_contextual_type_newly_created(&mut self, contextual_type: TypeId) -> bool {
        let Some((file, left)) = self.requested_assignment_target.take() else {
            return false;
        };
        self.contains_type_of_literal_in(contextual_type, file, left)
            && self.is_checked_without_flow_analysis(file, left)
    }

    /// True if `ty` is the type of an object literal inside `within`, or is composed of one.
    fn contains_type_of_literal_in(&mut self, ty: TypeId, file: FileId, within: ExprId) -> bool {
        let object_flags = self.types().object_flags(ty);
        if !object_flags.contains(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL) {
            return false;
        }
        let (of, literal) = match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(of, literal, ..),
                ..
            } => (*of, *literal),
            TypeData::Synth(shape) => match shape.symbol_declared_at {
                Some((of, _, literal)) if literal.is_some() => (of, literal),
                _ => return false,
            },
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                return (parts.iter())
                    .any(|&part| self.contains_type_of_literal_in(part, file, within));
            }
            TypeData::Ref { .. } | TypeData::Tuple { .. } => {
                return (self.type_arguments(ty).iter())
                    .any(|&part| self.contains_type_of_literal_in(part, file, within));
            }
            _ => return false,
        };
        let hir = self.hir(file);
        of == file && hir[within].pos <= hir[literal].pos && hir[literal].end <= hir[within].end
    }

    /// True if `checkExpression(e)` leaves `flowInvocationCount` unchanged, whatever has been
    /// resolved by then. False if that isn't known.
    fn is_checked_without_flow_analysis(&self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Missing
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            // `checkIdentifier` returns the declared type of a variable that's being assigned. A
            // declaration that comes earlier has been checked, so that type is resolved.
            ExprKind::Ident(_) => {
                let symbol = bound.symbol_of_expr(e);
                symbol.is_some() && self.target_kind(file, e).definite && {
                    let declarations = bound.symbol(symbol).decls;
                    !declarations.is_empty()
                        && declarations.iter().all(|&declaration| {
                            matches!(declaration, Decl::Var(name) | Decl::Param(name)
                                if hir[name].pos < hir[e].pos)
                        })
                }
            }
            ExprKind::Spread(operand) | ExprKind::NonNull(operand) => {
                self.is_checked_without_flow_analysis(file, operand)
            }
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                self.is_checked_without_flow_analysis(file, target)
                    && self.is_checked_without_flow_analysis(file, value)
            }
            ExprKind::Array(elements) => (hir.ids(elements))
                .all(|element| self.is_checked_without_flow_analysis(file, element)),
            ExprKind::Object(props) => props.iter().all(|p| {
                let prop = &hir[p];
                if prop.value.is_none() {
                    return false;
                }
                if let PropKey::Computed(key) = prop.key
                    && !self.is_checked_without_flow_analysis(file, key)
                {
                    return false;
                }
                match (prop.kind, hir[prop.value].kind) {
                    // `checkObjectLiteral`: not the default, in a destructuring pattern.
                    (PropKind::Shorthand, ExprKind::Assign { target, .. }) => {
                        self.is_checked_without_flow_analysis(file, target)
                    }
                    (PropKind::Init | PropKind::Shorthand | PropKind::Spread, _) => {
                        self.is_checked_without_flow_analysis(file, prop.value)
                    }
                    _ => false,
                }
            }),
            _ => false,
        }
    }

    /// `checkExpressionWithContextualType` for an argument.
    pub(super) fn check_argument(
        &mut self,
        file: FileId,
        arg: Arg,
        contextual_type: TypeId,
        inference_context: Option<&mut Box<Inference>>,
        check_mode: CheckMode,
    ) -> TypeId {
        let (ty, node) = match arg {
            Arg::Expr(e) => {
                let contextual_type = self.without_no_infer(contextual_type);
                return self.check_expression_with_contextual_type(
                    file,
                    e,
                    contextual_type,
                    inference_context,
                    check_mode,
                );
            }
            // `checkSyntheticExpression`. `checkConstEnumAccess`: its parent doesn't permit a
            // `const` enum, and `IsValidTypeOnlyAliasUseSite` holds for it.
            Arg::Type(ty, _, node) | Arg::Spread(ty, _, _, node) => {
                if self.is_const_enum_object(ty) {
                    self.error(file, node, 2475, &[]);
                }
                (ty, node)
            }
            // `checkSpreadExpression`
            Arg::SpreadElement(_, list, operand, node) => (
                self.check_iterated_type_of_spread_element(file, list, operand),
                node,
            ),
        };
        // A synthetic expression isn't a node here. Whatever is pushed for it is pushed for the
        // node it's positioned at, in which nothing is checked meanwhile.
        let contextual_type = self.without_no_infer(contextual_type);
        self.push_contextual_type(file, node, Some(contextual_type), false);
        let ty = self.check_with_inference_context(
            file,
            node,
            contextual_type,
            inference_context,
            check_mode,
            |c, check_mode| {
                c.instantiate_type_with_single_generic_call_signature(file, node, ty, check_mode)
            },
        );
        self.pop_contextual_type();
        ty
    }

    /// `getSignatureInstantiationWithoutFillingInTypeArguments(signature, signature.typeParameters)`
    pub(super) fn without_filling_in_type_arguments(&mut self, generic: SigId) -> SigId {
        let (params, ret, this) = (
            self.sig_params(generic),
            self.sig_return(generic),
            self.sig_this_type(generic),
        );
        self.types().intern_sig(SigData::Synth {
            type_params: ArenaBox::empty(),
            params: self.list(&params),
            ret,
            this,
            of: self.list(&[generic]),
            is_union: true,
        })
    }

    /// `cloneInferenceContext`. `no_default` adds `InferenceFlagsNoDefault`.
    fn clone_inference_context(n: &Inference, no_default: bool) -> Inference {
        let mut clone = Inference::for_params(&n.params, n.sig);
        clone.candidates.clone_from(&n.candidates);
        clone.any_default = n.any_default;
        clone.no_default = n.no_default || no_default;
        clone
    }

    /// `cloneInferredPartOfContext`
    fn clone_inferred_part_of_context(n: &Inference) -> Option<Box<Inference>> {
        // `hasInferenceCandidates`
        let inferences = (n.params.iter().zip(&n.candidates))
            .filter(|(_, c)| !c.covariant.is_empty() || !c.contravariant.is_empty());
        let params: SmallVec<[TypeId; 4]> = inferences.clone().map(|(&param, _)| param).collect();
        if params.is_empty() {
            return None;
        }
        let mut part = Inference::for_params(&params, n.sig);
        part.candidates = inferences.map(|(_, c)| c.clone()).collect();
        part.any_default = n.any_default;
        part.no_default = n.no_default;
        Some(Box::new(part))
    }

    /// `createOuterReturnMapper(context)`, applied to `ty`. The clone is created once.
    fn instantiate_with_outer_return_mapper(&mut self, level: usize, ty: TypeId) -> TypeId {
        self.with_inference_context(level, |c, context| {
            let mut clone = match context.outer_return_context.take() {
                Some(clone) => clone,
                None => Box::new(Self::clone_inference_context(context, false)),
            };
            // `MergedTypeMapper.Map`: `m2.Map(m1.Map(t))` for a type parameter.
            let mut pairs = Vec::new();
            let mentioned = c.params_mentioned_in(ty, &context.params);
            for (&param, _) in context.params.iter().zip(mentioned).filter(|m| m.1) {
                let first = c.with_return_context(level, |c, returned| {
                    let mapper = c.fixing_mapper(returned, param);
                    c.instantiate(param, mapper)
                });
                let first = first.unwrap_or(param);
                let second = if clone.params.contains(&first) {
                    let mapper = c.fixing_mapper(&mut clone, first);
                    c.instantiate(first, mapper)
                } else {
                    first
                };
                pairs.push((param, second));
            }
            context.outer_return_context = Some(clone);
            let mapper = c.types().mapper(pairs);
            c.instantiate(ty, mapper)
        })
        .unwrap_or(ty)
    }

    /// `getSignatureInstantiation`, with `inferredTypeParameters`
    fn signature_instantiation(
        &mut self,
        signature: SigId,
        mapper: MapperId,
        inferred_type_params: &[TypeId],
    ) -> SigId {
        let sig = self.instantiate_sig(signature, mapper);
        if inferred_type_params.is_empty() {
            return sig;
        }
        let ret = self.sig_return(sig);
        let Some((returned, construct)) = self.single_call_or_construct_signature(ret) else {
            return sig;
        };
        let (params, ret, this) = (
            self.sig_params(returned),
            self.sig_return(returned),
            self.sig_this_type(returned),
        );
        // `cloneSignature`: it has the same declaration as `returned`.
        let generalized = self.types().intern_sig(SigData::Synth {
            type_params: self.list(inferred_type_params),
            params: self.list(&params),
            ret,
            this,
            of: self.list(&[returned]),
            is_union: true,
        });
        let returned_type = self.sig_return(sig);
        let ret = self.single_signature_type(generalized, construct, returned_type, mapper);
        self.types().intern_sig(SigData::WithReturn { sig, ret })
    }

    /// `addImplementationSuccessElaboration`: returns the implementation of the overload `failed`,
    /// if `chooseOverload` accepts it.
    pub(super) fn add_implementation_success_elaboration(
        &mut self,
        s: &CallState<'_>,
        failed: SigId,
    ) -> Option<SigId> {
        let declared = self.declared_sig(failed);
        let (file, func, _) = self.sig_decl(declared)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `failed.declaration.Symbol()`, as the binder left it: a declaration with a late-bound
        // name is the only one of its symbol.
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Member(member) => bound.member_symbol[member.idx()],
            _ => bound.fn_symbol[func.idx()],
        };
        let declarations = bound.symbols.get(symbol.idx())?.decls;
        if declarations.len() < 2 {
            return None;
        }
        let implementation = declarations.iter().find_map(|&declaration| {
            let function = match declaration {
                Decl::Fn(function) => function,
                Decl::Member(member) => hir[member].func,
                _ => FnId::NONE,
            };
            (function.is_some() && has_body(&hir[function])).then_some(function)
        })?;
        let candidate = self.sig_of_fn(file, implementation);
        let mut local_state = CallState {
            candidates: smallvec![candidate],
            is_single_non_generic_candidate: self.sig_type_params(candidate).is_empty(),
            checks_arguments_once: false,
            candidates_for_argument_error: s.candidates_for_argument_error.clone(),
            ..*s
        };
        self.choose_overload(&mut local_state, Relation::Assignable)
            .map(|_| candidate)
    }

    /// `getEffectiveCallArguments`
    pub(super) fn effective_call_arguments(
        &mut self,
        file: FileId,
        call: ExprId,
        node: CallLike,
    ) -> Args {
        let hir = self.hir(file);
        match node {
            CallLike::Call(id) => {
                let mut args = self.effective_args(file, hir[id].args);
                if matches!(hir[call].kind, ExprKind::TaggedTemplate(_)) {
                    let strings = self.global_ref_checked(known::TemplateStringsArray, &[]);
                    let no_label = LabeledDeclaration::NONE;
                    args.insert(0, Arg::Type(strings, no_label, hir.template_of(id)));
                }
                args
            }
            CallLike::InstanceOf { left, .. } => smallvec![Arg::Expr(left)],
            // `emptyFreshJsxObjectType`: "This attributes Type does not include a children property yet".
            CallLike::Jsx(j) if hir[j].tag.is_none() => {
                let empty = self.synth(Shape {
                    literal: Literalness::JsxAttributes,
                    ..Shape::new_in(self.arena)
                });
                smallvec![Arg::Type(empty, LabeledDeclaration::NONE, call)]
            }
            CallLike::Jsx(j) if hir[j].attrs.is_empty() && hir[j].children.is_empty() => {
                Args::new()
            }
            CallLike::Jsx(_) => smallvec![Arg::Expr(call)],
            // `getEffectiveDecoratorArguments`
            CallLike::Decorator(owner) => match self.decorator_call_signature(file, owner) {
                Some(expected) => {
                    let mut args = Args::new();
                    for p in self.sig_params(expected).iter() {
                        args.push(Arg::Type(p.ty, LabeledDeclaration::NONE, call));
                    }
                    args
                }
                None => Args::new(),
            },
        }
    }

    /// `getCandidateForOverloadFailure`
    fn candidate_for_overload_failure(&mut self, s: &CallState<'_>) -> SigId {
        let sigs = &s.candidates[..];
        if sigs.len() == 1
            || sigs
                .iter()
                .any(|&sig| !self.sig_type_params(sig).is_empty())
        {
            self.pick_longest_candidate_signature(s)
        } else {
            self.union_of_signatures_for_overload_failure(sigs)
        }
    }

    /// `getLongestCandidateIndex`
    pub(super) fn longest_candidate_index(
        &mut self,
        candidates: &[SigId],
        args_count: usize,
    ) -> usize {
        let (mut best, mut most): (usize, Option<usize>) = (0, None);
        for (i, &candidate) in candidates.iter().enumerate() {
            let params = self.sig_params_with_first(candidate, 0);
            let count = self.parameter_count(&params);
            if self.has_effective_rest_parameter(&params) || count >= args_count {
                return i;
            }
            if most.is_none_or(|most| count > most) {
                (best, most) = (i, Some(count));
            }
        }
        best
    }

    /// `pickLongestCandidateSignature`
    fn pick_longest_candidate_signature(&mut self, s: &CallState<'_>) -> SigId {
        let (sigs, type_args, args) = (&s.candidates[..], s.type_args, s.args);
        let candidate = sigs[self.longest_candidate_index(sigs, args.len())];
        let type_params = self.sig_type_params(candidate);
        if type_params.is_empty() {
            return candidate;
        }
        if !type_args.is_empty() {
            // `getTypeArgumentsFromNodes`: excess type arguments are dropped. A missing one is the
            // default of its type parameter, or its constraint, as declared.
            let outer = self.outer_mapper_of_sig(candidate);
            let mut filled: Vec<TypeId> =
                type_args.iter().copied().take(type_params.len()).collect();
            for &param in &type_params[filled.len()..] {
                let ty = match self.default_of_type_param(param) {
                    Some(default) => default,
                    None => self
                        .constraint_of_type_param(param)
                        .unwrap_or(TypeId::UNKNOWN),
                };
                filled.push(self.with_outer_type_arguments(param, ty, outer));
            }
            let mapper = self.mapper_from(&type_params, &filled);
            return self.instantiate_sig(candidate, mapper);
        }
        // `inferSignatureInstantiationForOverloadFailure`
        let mut context = Box::new(Inference::for_params(&type_params, Some(candidate)));
        context.any_default = self.hir(s.file).is_js;
        let check_mode = CheckMode::SKIP_CONTEXT_SENSITIVE | CheckMode::SKIP_GENERIC_FUNCTIONS;
        let mapper = self.infer_type_arguments(s, candidate, check_mode, &mut context);
        self.instantiate_sig(candidate, mapper)
    }

    /// `createUnionOfSignaturesForOverloadFailure`: it accepts what any of `sigs` accepts, and
    /// returns what all of them return.
    pub(super) fn union_of_signatures_for_overload_failure(&mut self, sigs: &[SigId]) -> SigId {
        // `tryGetTypeAtPosition` for every position, and `tryGetRestTypeOfSignature`.
        let lists: Vec<List<'p, SigParam>> = (sigs.iter())
            .map(|&sig| self.sig_params_up_to(sig, usize::MAX))
            .collect();
        // `getNonRestParameterCount`
        let plain =
            |list: &[SigParam]| list.len() - usize::from(list.last().is_some_and(|p| p.rest));
        let least = lists.iter().map(|list| plain(list)).min().unwrap_or(0);
        let most = lists.iter().map(|list| plain(list)).max().unwrap_or(0);
        let mut params = Vec::with_capacity(most + 1);
        for i in 0..most {
            // `createCombinedSymbolForOverloadFailure`: `createSymbolWithType` of the first source.
            let mut source: Option<SigParam> = None;
            let mut types = Vec::new();
            for list in &lists {
                // The parameter at that index, or the rest parameter that covers it.
                let named = if i < plain(list) {
                    list.get(i)
                } else {
                    list.last().filter(|p| p.rest)
                };
                source = source.or_else(|| named.copied());
                // `tryGetTypeAtPosition`
                if (i < self.parameter_count(list) || self.has_effective_rest_parameter(list))
                    && let Some(ty) = self.param_type_at(list, i)
                {
                    types.push(ty);
                }
            }
            let ty = self.union_reduced(&types);
            params.push(SigParam {
                name: source.map_or(Atom::NONE, |p| p.name),
                ty,
                optional: i >= least,
                rest: false,
                is_required_rest: false,
                declaration: source.and_then(|p| p.declaration),
            });
        }
        // `createCombinedSymbolForOverloadFailure(restParameterSymbols, ..)`
        let first_rest = lists.iter().find_map(|list| list.last().filter(|p| p.rest));
        if let Some(first) = first_rest {
            let elements: Vec<TypeId> = lists
                .iter()
                .filter_map(|list| self.try_get_rest_type_of_signature(list))
                .collect();
            let element = self.union_reduced(&elements);
            params.push(SigParam {
                name: first.name,
                ty: self.array_of(element),
                optional: false,
                rest: true,
                is_required_rest: false,
                declaration: first.declaration,
            });
        }
        let mut these = Vec::new();
        for &sig in sigs {
            these.extend(self.sig_this_type(sig));
        }
        let this = if these.is_empty() {
            None
        } else {
            Some(self.union_reduced(&these))
        };
        let returns: Vec<TypeId> = sigs.iter().map(|&sig| self.sig_return(sig)).collect();
        let ret = self.intersection(&returns);
        // It has the first signature's declaration.
        self.types().intern_sig(SigData::Synth {
            type_params: ArenaBox::empty(),
            params: self.list(&params),
            ret,
            this,
            of: self.list(&[sigs[0]]),
            is_union: true,
        })
    }

    /// `tryGetRestTypeOfSignature`, for a signature with the parameters `params`.
    fn try_get_rest_type_of_signature(&mut self, params: &[SigParam]) -> Option<TypeId> {
        let mut rest_type = params.last().filter(|p| p.rest)?.ty;
        if let TypeData::Tuple { flags, .. } = self.data(rest_type) {
            // `getRestTypeOfTupleType`
            let elems = self.type_arguments(rest_type);
            let fixed_length = Self::fixed_length(flags);
            rest_type = self.element_type_of_slice(elems, flags, fixed_length, 0, false)?;
        }
        self.index_type_of_type(rest_type, TypeId::NUMBER)
    }

    /// `getInstantiationExpressionType`, `f<Args>` without a call: `ty` restricted to the
    /// signatures that accept that many type arguments, instantiated with them. `node` is its node,
    /// which the created object types store.
    pub fn with_type_arguments(
        &mut self,
        ty: TypeId,
        args: &[TypeId],
        node: InstantiationExpression,
    ) -> TypeId {
        if ty == TypeId::SILENT_NEVER || self.is_error_type(ty) {
            return ty;
        }
        // `hasSomeApplicableSignature`, `nonApplicableType`
        let mut found = (false, None);
        let result = self.instantiated_type(ty, args, node, &mut found);
        let error_type = if found.0 { found.1 } else { Some(ty) };
        if let Some(error_type) = error_type
            && let Some(loc) = self.range_of_type_argument_list(node)
        {
            self.error_at(loc, 2635, &[super::sink::Arg::Type(error_type)]);
        }
        result
    }

    /// From `SkipTrivia(text, typeArguments.Pos())` to `typeArguments.End()`, for
    /// `node.TypeArgumentList()`.
    fn range_of_type_argument_list(
        &self,
        node: InstantiationExpression,
    ) -> Option<(FileId, u32, u32)> {
        let (file, nodes) = self.type_argument_nodes(node);
        let hir = self.hir(file);
        if let Some(first) = hir.ids(nodes).next() {
            let start = super::errors_type_nodes::start_of_type(hir, first);
            return Some((file, start, self.end_of_type_args(file, nodes)));
        }
        // An empty list begins and ends after the `<`, which follows the expression.
        let after =
            |expression| skip_trivia(&hir.text, self.end_of_expr(file, expression) as usize);
        let less_than = match node {
            InstantiationExpression::Expr(_, e) => match hir[e].kind {
                ExprKind::Instantiation { expr, .. } => after(expr),
                _ => return None,
            },
            InstantiationExpression::TypeNode(_, node) => match hir[node].kind {
                TypeNodeKind::Typeof { expr, .. } => after(expr),
                TypeNodeKind::Import { .. } => {
                    self.empty_type_argument_list_of_import_type(file, node)? as usize
                }
                _ => return None,
            },
        };
        let start = skip_trivia(&hir.text, less_than + 1) as u32;
        Some((file, start, super::explain::NO_LENGTH))
    }

    /// `node.TypeArgumentList() != nil && len(node.TypeArguments()) == 0` for the `ImportType`
    /// `node`, which then ends with `<>`. Returns the position of the `<`. `TypeNodeKind::Import`
    /// is already as large as a `TypeNodeKind` may be, so unlike `Typeof` it has no
    /// `has_type_arguments`.
    pub(super) fn empty_type_argument_list_of_import_type(
        &self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<u32> {
        let hir = self.hir(file);
        let greater_than = start_of_token_before(&hir.text, hir[node].end, b">")?;
        start_of_token_before(&hir.text, greater_than, b"<")
    }

    /// `node.TypeArgumentList()`
    fn type_argument_nodes(&self, node: InstantiationExpression) -> (FileId, IdList<TypeNodeId>) {
        match node {
            InstantiationExpression::Expr(file, e) => match self.hir(file)[e].kind {
                ExprKind::Instantiation { type_args, .. } => {
                    (file, self.hir(file).list_at(type_args))
                }
                _ => (file, IdList::default()),
            },
            InstantiationExpression::TypeNode(file, node) => match self.hir(file)[node].kind {
                TypeNodeKind::Typeof { args, .. } | TypeNodeKind::Import { args, .. } => {
                    (file, args)
                }
                _ => (file, IdList::default()),
            },
        }
    }

    /// `getInstantiatedType`
    fn instantiated_type(
        &mut self,
        ty: TypeId,
        args: &[TypeId],
        node: InstantiationExpression,
        found: &mut (bool, Option<TypeId>),
    ) -> TypeId {
        // `hasSignatures`, `hasApplicableSignature`
        let mut own = (false, false);
        let result = self.instantiated_type_part(ty, args, node, &mut own, found);
        found.0 |= own.1;
        if own.0 && !own.1 && found.1.is_none() {
            found.1 = Some(ty);
        }
        result
    }

    /// `getInstantiatedTypePart`
    fn instantiated_type_part(
        &mut self,
        ty: TypeId,
        args: &[TypeId],
        node: InstantiationExpression,
        own: &mut (bool, bool),
        found: &mut (bool, Option<TypeId>),
    ) -> TypeId {
        if self.is_any(ty) {
            return ty;
        }
        match self.data(ty) {
            TypeData::Union(_) => {
                return self.map_type(ty, |c, m| c.instantiated_type(m, args, node, found));
            }
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.instantiated_type_part(p, args, node, own, found))
                    .collect();
                return self.intersection(&parts);
            }
            _ => {}
        }
        if self.is_deferred(ty) {
            let constraint = self.base_constraint(ty);
            let actual = self.instantiated_type_part(constraint, args, node, own, found);
            return if actual == constraint { ty } else { actual };
        }
        let Some(members) = self.members(ty) else {
            return ty;
        };
        if !members.has_signatures() {
            return ty;
        }
        // Also returns true if the result equals `sigs` (`core.Same`).
        let actual = |c: &mut Self, sigs: &[SigId]| -> (ArenaVec<'s, SigId>, bool) {
            let mut out = ArenaVec::new_in(c.arena);
            let mut is_same = true;
            for &sig in sigs {
                let sig = c.instantiate_sig(sig, members.mapper);
                let params = c.sig_type_params(sig);
                // `getInstantiatedSignatures`: the empty list of `f<>` fits every generic signature.
                if params.is_empty() || !c.has_correct_type_argument_arity(&params, args.len()) {
                    is_same = false;
                    continue;
                }
                let error_nodes = Some(c.type_argument_nodes(node));
                let Some(filled) = c.check_type_arguments(sig, &params, args, error_nodes) else {
                    out.push(sig);
                    continue;
                };
                let mapper = c.mapper_from(&params, &filled);
                is_same = false;
                out.push(c.instantiate_sig(sig, mapper));
            }
            (out, is_same)
        };
        let (call, is_same_call) = actual(self, members.call_signatures());
        let (construct, is_same_construct) = actual(self, members.construct_signatures());
        own.0 = true;
        own.1 |= !call.is_empty() || !construct.is_empty();
        if is_same_call && is_same_construct {
            return ty;
        }
        let mut props = ArenaVec::with_capacity_in(members.shape().props.len(), self.arena);
        for prop in &members.shape().props {
            let mut prop = prop.clone_in(self.arena);
            self.instantiate_prop(&mut prop, members.mapper);
            props.push(prop);
        }
        let arena = self.arena;
        let index = members.index_infos().iter().map(|i| IndexInfo {
            value: self.instantiate(i.value, members.mapper),
            ..*i
        });
        let index = vec_from_iter_in(index, arena);
        let mapper = self.identity_mapper_for_instantiation_expression(node);
        self.synth(Shape {
            props,
            call,
            construct,
            index,
            instantiation_expression: Some(node),
            created_from: Some((ty, TypeId::NEVER)),
            mapper,
            ..Shape::new_in(self.arena)
        })
    }

    /// Returns the symbol that the signature `func` declares and `func`'s enclosing block or type.
    /// `before` is the same pair for another signature.
    fn sig_home(
        &self,
        file: FileId,
        func: FnId,
        before: Option<(SigSymbol, SigParent)>,
    ) -> (SigSymbol, SigParent) {
        let bound = self.bound(file);
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(stmt) => {
                let symbol = self.files().canonical(Sym {
                    file,
                    id: bound.fn_symbol[func.idx()],
                });
                (
                    SigSymbol::Function(symbol),
                    SigParent::Block(file, bound.parent_of_stmt(stmt)),
                )
            }
            FnOwner::Member(member) => {
                let owner = bound.member_owner[member.idx()];
                let of = match (owner, before) {
                    (_, Some((SigSymbol::Member(of, ..), parent)))
                        if parent == SigParent::Type(file, owner) =>
                    {
                        Some(of)
                    }
                    (MemberOwner::Interface(i), _) => Some(self.files().canonical(Sym {
                        file,
                        id: bound.interface_symbol[i.idx()],
                    })),
                    (MemberOwner::Class(c), _) => Some(self.files().canonical(Sym {
                        file,
                        id: bound.class_symbol[c.idx()],
                    })),
                    _ => None,
                };
                let m = &self.hir(file)[member];
                match of {
                    Some(of) => (
                        SigSymbol::Member(of, m.kind, m.key.name()),
                        SigParent::Type(file, owner),
                    ),
                    None => (
                        SigSymbol::Literal(file, owner, m.kind, m.key.name()),
                        SigParent::Type(file, owner),
                    ),
                }
            }
            _ => (SigSymbol::Lone(file, func), SigParent::Lone(file, func)),
        }
    }

    /// `SignatureFlagsHasLiteralTypes`: some parameter's type node is a `LiteralType`. `this`
    /// counts as a parameter. A `ParenthesizedType` around a `LiteralType` doesn't count.
    fn has_literal_types(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let this = hir[func].this_param.some();
        this.into_iter().chain(hir[func].params.iter()).any(|p| {
            let p = &hir[p];
            p.ty.is_some()
                && matches!(
                    hir[p.ty].kind,
                    TypeNodeKind::StringLit(_)
                        | TypeNodeKind::NumberLit(_)
                        | TypeNodeKind::BigIntLit { .. }
                        | TypeNodeKind::BoolLit(_)
                        | TypeNodeKind::Keyword(Keyword::Null)
                )
                && (self.parenthesized_types_around(file, p.ty, p.pos))
                    .next()
                    .is_none()
        })
    }

    /// The signature whose declaration `sig` has (`Signature.declaration`).
    /// `getDefaultConstructSignatures` clones or instantiates the base class's signatures. Both
    /// preserve the declaration and whether the signature has literal types.
    pub(super) fn declared_sig(&mut self, sig: SigId) -> SigId {
        let mut sig = self.types().sig_origin(sig);
        for _ in 0..64 {
            let SigData::DefaultConstruct { base: Some(of), .. } = *self.types().sig(sig) else {
                break;
            };
            sig = self.types().sig_origin(of);
        }
        sig
    }

    /// `reorderCandidates`: the order in which overloads are tried. For a symbol with several
    /// declaration sites, the signatures of a later site go first. Signatures with literal types go
    /// before all others.
    pub(super) fn candidates_in_order(&mut self, sigs: &[SigId]) -> List<'p, SigId> {
        let first = match *sigs {
            [] => return List::default(),
            [only] => return List::One(only),
            [first, ..] => first,
        };
        let p = self.p;
        let cached = p.candidate_orders.get_ref(&self.task, &first);
        if let Some(cached) = cached
            && let Some(ordered) = Self::cached_candidate_order(cached, sigs)
        {
            return List::Permanent(ordered);
        }
        let scope = self.begin_scope();
        let ordered = self.candidates_in_order_uncached(sigs);
        let ended = self.end_scope_by_counters(scope);
        // One list is cached per signature.
        if cached.is_none()
            && let Ok(stored) = ended
        {
            let both = self.list_of(sigs.iter().chain(&ordered).copied());
            let cached = (p.candidate_orders)
                .insert_ref(&self.task, first, both, stored)
                .1;
            // The entry that remains cached may be a different list with the same first signature.
            if let Some(ordered) = Self::cached_candidate_order(cached, sigs) {
                return List::Permanent(ordered);
            }
        }
        List::Own(ordered.into_vec())
    }

    /// Returns the second half of an entry of `candidate_orders`, if the first half is `sigs`.
    fn cached_candidate_order<'a>(cached: &'a [SigId], sigs: &[SigId]) -> Option<&'a [SigId]> {
        let (of, ordered) = cached.split_at(cached.len() / 2);
        (of == sigs).then_some(ordered)
    }

    fn candidates_in_order_uncached(&mut self, sigs: &[SigId]) -> Sigs {
        let mut result = Sigs::with_capacity(sigs.len());
        let mut last: Option<(SigSymbol, SigParent)> = None;
        let (mut cutoff, mut index, mut specialized) = (0usize, 0usize, 0usize);
        for &sig in sigs {
            // A clone has the declaration of its original (`Signature.declaration`).
            let declared = self.declared_sig(sig);
            let declaration = match *self.types().sig(declared) {
                SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } => {
                    Some((file, func))
                }
                _ => None,
            };
            let home = declaration.map(|(file, func)| self.sig_home(file, func, last));
            match last {
                Some((last_symbol, _)) if Some(last_symbol) != home.map(|it| it.0) => {
                    cutoff = result.len();
                    index = cutoff;
                }
                Some((_, last_parent)) if Some(last_parent) == home.map(|it| it.1) => index += 1,
                _ => index = cutoff,
            }
            last = home;
            let at = if declaration.is_some_and(|(file, func)| self.has_literal_types(file, func)) {
                specialized += 1;
                cutoff += 1;
                specialized - 1
            } else {
                index
            };
            result.insert(at, sig);
        }
        result
    }

    /// FOR SPEED, see `CallState::checks_arguments_once`: `checkExpressionCached(e)` with `param`
    /// pushed as its contextual type.
    pub(super) fn cached_arg_type_for_param(
        &mut self,
        file: FileId,
        e: ExprId,
        param: TypeId,
    ) -> TypeId {
        let param = self.without_no_infer(param);
        self.push_contextual_type(file, e, Some(param), false);
        self.inference_contexts.push(InferenceContextInfo {
            file,
            node: e,
            context: None,
        });
        let outer = self.suspend_recheck();
        let ty = self.type_of_expr(file, e);
        self.end_recheck(outer);
        self.inference_contexts.pop();
        self.pop_contextual_type();
        ty
    }

    /// `getMutableArrayOrTupleType`
    pub(super) fn mutable_array_or_tuple(&mut self, t: TypeId) -> TypeId {
        if self.is_union(t) {
            return self.map_type(t, |c, member| c.mutable_array_or_tuple(member));
        }
        let base = self.base_constraint_of(t).unwrap_or(t);
        if self.is_any(t) || self.is_mutable_array_or_tuple(base) {
            return t;
        }
        if let TypeData::Tuple { flags, .. } = self.data(t) {
            let elems = self.type_arguments(t);
            return self.tuple(elems, flags, false);
        }
        self.normalized_tuple(&[t], &[ElemFlags::VARIADIC], false)
    }

    /// `checkIteratedTypeOrElementType(IterationUseSpread, spreadType, c.undefinedType,
    /// arg.Expression())` for a `SpreadElement` with that operand.
    fn check_iterated_type_of_spread_element(
        &mut self,
        file: FileId,
        spread_type: TypeId,
        operand: ExprId,
    ) -> TypeId {
        let error_node = self.span_of_parenthesized_expr(file, operand);
        self.check_iterated_type_of_spread(spread_type, error_node)
    }

    /// `getSpreadArgumentType`
    pub(super) fn spread_argument_type(
        &mut self,
        file: FileId,
        args: &[Arg],
        index: usize,
        rest: TypeId,
        mut context: Option<&mut Box<Inference>>,
        check_mode: CheckMode,
    ) -> TypeId {
        let is_const = self.is_const_type_variable(rest, 0);
        // "both the parameter and the argument are ...x forms"
        if index + 1 >= args.len() {
            let spread_type = match args.last() {
                Some(&Arg::Spread(_, list, ..)) => Some(list),
                Some(&Arg::SpreadElement(_, _, operand, _)) => {
                    let contextual_type = self.without_no_infer(rest);
                    Some(self.check_expression_with_contextual_type(
                        file,
                        operand,
                        contextual_type,
                        context.as_deref_mut(),
                        check_mode,
                    ))
                }
                _ => None,
            };
            if let Some(spread_type) = spread_type {
                if self.is_array_like(spread_type) {
                    return self.mutable_array_or_tuple(spread_type);
                }
                let element = match args.last() {
                    Some(&Arg::SpreadElement(_, _, operand, _)) => {
                        self.check_iterated_type_of_spread_element(file, spread_type, operand)
                    }
                    _ => self.iterated_type_of_spread(spread_type),
                };
                return if is_const {
                    self.readonly_array_of(element)
                } else {
                    self.array_of(element)
                };
            }
        }
        let length = args.len().saturating_sub(index);
        let mut elems: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(length);
        let mut flags: SmallVec<[ElemFlags; 8]> = SmallVec::with_capacity(length);
        for i in index..args.len() {
            let (ty, flag) = match args[i] {
                Arg::Spread(_, list, ..) | Arg::SpreadElement(_, list, ..)
                    if self.is_array_like(list) =>
                {
                    (list, ElemFlags::VARIADIC)
                }
                Arg::Spread(element, ..) => (element, ElemFlags::REST),
                Arg::SpreadElement(_, list, operand, _) => (
                    self.check_iterated_type_of_spread_element(file, list, operand),
                    ElemFlags::REST,
                ),
                arg => {
                    let contextual = if self.is_tuple(rest) {
                        self.contextual_element_at(rest, i - index, Some(length), None, None)
                            .unwrap_or(TypeId::UNKNOWN)
                    } else {
                        self.contextual_indexed_access(rest, i - index)
                    };
                    let ty = self.check_argument(
                        file,
                        arg,
                        contextual,
                        context.as_deref_mut(),
                        check_mode,
                    );
                    let has_primitive_contextual_type =
                        is_const || self.may_be_primitive_or_key(contextual);
                    (
                        if has_primitive_contextual_type {
                            self.regular(ty)
                        } else {
                            self.widen_literal(ty)
                        },
                        ElemFlags::REQUIRED,
                    )
                }
            };
            elems.push(ty);
            // `tupleNameSource`
            flags.push(match args[i] {
                Arg::Type(_, label, _) | Arg::Spread(_, _, label, _) => flag.with_label(label),
                _ => flag,
            });
        }
        // For a `const` type parameter it's readonly, unless `rest` may be a mutable array type
        // (`isMutableArrayLikeType`).
        let mut readonly = is_const;
        if is_const {
            let any_array = self.array_of(TypeId::ANY);
            for &m in self.parts(rest) {
                if self.is_mutable_array_or_tuple(m)
                    || !self.is_any(m) && !self.is_nullish(m) && self.is_assignable(m, any_array)
                {
                    readonly = false;
                }
            }
        }
        self.normalized_tuple(&elems, &flags, readonly)
    }

    /// `getIndexedAccessTypeEx(rest, getNumberLiteralType(i), AccessFlagsContextual, nil, nil)`
    fn contextual_indexed_access(&mut self, rest: TypeId, i: usize) -> TypeId {
        let at = self.number_literal(i as f64, false);
        self.indexed_access_with_flags(rest, at, AccessFlags::CONTEXTUAL)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// Returns `ty`, the constraint or default of the type parameter `param`, instantiated with the
    /// outer type arguments of the signature `param` belongs to (`outer`). For a clone
    /// (`cloneTypeParameter`) that's already done.
    pub(super) fn with_outer_type_arguments(
        &mut self,
        param: TypeId,
        ty: TypeId,
        outer: MapperId,
    ) -> TypeId {
        match *self.data(param) {
            TypeData::TypeParam(_, _, enclosing_mapper)
                if enclosing_mapper != MapperId::IDENTITY =>
            {
                ty
            }
            _ => self.instantiate(ty, outer),
        }
    }

    /// `getOptionalCallSignature`: the return type of `sig` for `call`. In an optional chain that
    /// may have short-circuited before the call (`nonOptionalType != funcType`), it includes
    /// `undefined`.
    fn return_type_in_chain(&mut self, file: FileId, call: ExprId, sig: SigId) -> TypeId {
        let ExprKind::Call(c) = self.hir(file)[call].kind else {
            return self.sig_return(sig);
        };
        let Call { callee, chain, .. } = self.hir(file)[c];
        if !self.chain_receiver(file, callee, chain).1 {
            return self.sig_return(sig);
        }
        let sig = self.optional_call_signature(sig);
        let ret = self.sig_return(sig);
        self.optional(ret)
    }

    /// `getOptionalCallSignature(sig, callChainFlags)` for the call `call`. Returns `sig` itself if
    /// `callChainFlags` is `SignatureFlagsNone`.
    fn optional_call_signature_in_chain(
        &mut self,
        file: FileId,
        call: ExprId,
        sig: SigId,
    ) -> SigId {
        let ExprKind::Call(c) = self.hir(file)[call].kind else {
            return sig;
        };
        let Call { callee, chain, .. } = self.hir(file)[c];
        if chain == Chain::No {
            return sig;
        }
        let clone = self.optional_call_signature(sig);
        // `nonOptionalType != funcType`
        if clone != sig && self.chain_receiver(file, callee, chain).1 {
            clone
        } else {
            sig
        }
    }

    /// `getThisArgumentType`: the type of the object the method is accessed on, given that the
    /// chain has reached it. `void` if there's no such object.
    pub(super) fn this_argument_type(&mut self, file: FileId, this_arg: Option<ExprId>) -> TypeId {
        let Some(this_arg) = this_arg else {
            return TypeId::VOID;
        };
        let chain = match self.bound(file).parent_of_expr(this_arg) {
            Parent::Expr(access) => match self.hir(file)[access].kind {
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
                _ => Chain::No,
            },
            _ => Chain::No,
        };
        self.chain_receiver(file, this_arg, chain).0
    }

    /// `getDefaultFromTypeParameter(param) != nil`
    pub(super) fn has_default(&mut self, param: TypeId) -> bool {
        if let TypeData::TypeParam(file, tp, enclosing_mapper) = *self.data(param)
            && enclosing_mapper != MapperId::IDENTITY
        {
            // A clone has one if the declared type parameter does. No instantiation is requested
            // for a default that doesn't reference a type parameter or is itself a type parameter.
            let declared = self.type_param(file, tp);
            match self.default_of_type_param(declared) {
                None => return false,
                Some(default)
                    if !self.has_type_variables(default)
                        || matches!(
                            self.data(default),
                            TypeData::TypeParam(..) | TypeData::ThisParam(_)
                        ) =>
                {
                    return true;
                }
                Some(_) => {}
            }
        }
        self.default_of_type_param(param).is_some()
    }

    /// Returns `ty` without `true` and `false`, if both are in it.
    pub(super) fn without_boolean(&mut self, ty: TypeId) -> TypeId {
        if let TypeData::Union(parts) = self.data(ty)
            && parts.contains(&TypeId::TRUE)
            && parts.contains(&TypeId::FALSE)
        {
            return self.filter(ty, |_, m| m != TypeId::TRUE && m != TypeId::FALSE);
        }
        ty
    }

    /// `resolveCallExpression` up to the test under `CheckModeSkipGenericFunctions`, as
    /// `getResolvedSignature` calls it: the callee is checked with `resolvingSignature` in place
    /// and the resolution stack reset. Returns true if the call is deferred.
    pub(super) fn defers_call_of_generic_function(&mut self, file: FileId, e: ExprId) -> bool {
        let is_in_progress = self
            .stack
            .iter()
            .any(|q| matches!(*q, Query::Call(f, c) if f == file && c == e));
        if !self.enter(Query::Call(file, e)) {
            return false;
        }
        let resolution_start = self.resolution_start;
        if !is_in_progress {
            self.resolution_start = self.stack.len();
        }
        let defers = self.is_call_of_generic_function_returning_function(file, e);
        self.resolution_start = resolution_start;
        self.settle_reported_without_entry();
        let _ = self.leave(Query::Call(file, e));
        defers
    }

    /// `isGenericFunctionReturningFunction` for some signature of the callee of `e`, if `e` is a
    /// call without type arguments.
    fn is_call_of_generic_function_returning_function(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[e].kind else {
            return false;
        };
        let data = &hir[c];
        if !data.type_args.is_empty() || matches!(hir[data.callee].kind, ExprKind::Super) {
            return false;
        }
        let callee = self.chain_receiver(file, data.callee, data.chain).0;
        let callee = self.non_null_type(callee);
        if self.is_any(callee) {
            return false;
        }
        for sig in self.signatures(callee, false) {
            if self.sig_type_params(sig).is_empty() {
                continue;
            }
            // `isFunctionType`: an object type with a call signature, whatever else it has.
            let ret = self.sig_return(sig);
            if self.is_object_type(ret) && !self.signatures(ret, false).is_empty() {
                return true;
            }
        }
        false
    }

    /// `checkExpressionWithContextualType`: `pushContextualType`, `pushInferenceContext`,
    /// `checkExpression` (which isn't memoized), and the two pops. Whatever tsgo caches for the
    /// nodes inside `e` is cached here too: `resolvedSignature`, `NodeCheckFlagsContextChecked`.
    /// `inference_context` is moved into `inference_contexts` for the duration of the check.
    pub(super) fn check_expression_with_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Box<Inference>>,
        check_mode: CheckMode,
    ) -> TypeId {
        self.push_contextual_type(file, e, Some(contextual_type), false);
        let ty = self.check_with_inference_context(
            file,
            e,
            contextual_type,
            inference_context,
            check_mode,
            |c, check_mode| c.check_expression_ex(file, e, check_mode),
        );
        self.pop_contextual_type();
        ty
    }

    /// `pushInferenceContext`, `checkExpressionEx` (which isn't memoized), `popInferenceContext`.
    pub(super) fn check_with_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Box<Inference>>,
        check_mode: CheckMode,
        check: impl FnOnce(&mut Self, CheckMode) -> TypeId,
    ) -> TypeId {
        let mut inference_context = inference_context;
        let (check_mode, outside) =
            self.push_inference_context(file, e, inference_context.as_deref_mut(), check_mode);
        let ty = check(self, check_mode);
        self.pop_inference_context(file, e, contextual_type, inference_context, outside, ty)
    }

    /// `pushInferenceContext`: moves `inference_context` into `inference_contexts` and starts a
    /// check that isn't memoized. Returns the mode of that check, and the argument for
    /// `pop_inference_context`.
    fn push_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        inference_context: Option<&mut Box<Inference>>,
        check_mode: CheckMode,
    ) -> (CheckMode, OutsideInferenceContext) {
        let context =
            inference_context.map(|inference| std::mem::replace(inference, self.spare_inference()));
        let mut check_mode = check_mode | CheckMode::CONTEXTUAL;
        if context.is_some() {
            check_mode |= CheckMode::INFERENTIAL;
        }
        self.inference_contexts.push(InferenceContextInfo {
            file,
            node: e,
            context,
        });
        let outside = OutsideInferenceContext {
            mode_of_recheck: std::mem::replace(&mut self.mode_of_recheck, check_mode),
            // A result computed under one pushed contextual type isn't valid under another, or
            // under none.
            rechecked: self.set_rechecked_aside(),
            recheck: self.begin_recheck(),
        };
        (check_mode, outside)
    }

    /// `popInferenceContext`: ends the check that `push_inference_context` started, whose result is
    /// `ty`, and moves the context back into `inference_context`. Returns `ty`, without its
    /// freshness if `contextual_type` is a context for literals.
    fn pop_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Box<Inference>>,
        outside: OutsideInferenceContext,
        ty: TypeId,
    ) -> TypeId {
        self.end_recheck(outside.recheck);
        self.restore_rechecked(outside.rechecked);
        self.mode_of_recheck = outside.mode_of_recheck;
        let is_literal_of_contextual_type = self.maybe_type_of_kind(ty, tf::LITERAL) && {
            let instantiated =
                self.instantiate_contextual_type(contextual_type, file, e, ContextFlags::empty());
            self.is_literal_context(ty, instantiated)
        };
        let ty = if is_literal_of_contextual_type {
            self.regular(ty)
        } else {
            ty
        };
        let lent = self.inference_contexts.pop().and_then(|info| info.context);
        if let (Some(inference), Some(mut lent)) = (inference_context, lent) {
            lent.intra_expression_inference_sites.clear();
            // The placeholder was never used, so it's still empty and can be reused.
            self.spare_inferences
                .push(std::mem::replace(inference, lent));
        }
        ty
    }

    /// `getSingleSignature`: the single call (or construct) signature of `ty`, if it has none of
    /// the other kind.
    pub(super) fn single_signature(
        &mut self,
        ty: TypeId,
        kind: SignatureKind,
        allow_members: AllowMembers,
    ) -> Option<SigId> {
        if !self.is_object_type(ty) {
            return None;
        }
        let members = self.members(ty)?;
        let shape = members.whole_shape();
        let construct = kind == SignatureKind::Construct;
        let (own, other) = if construct {
            (&shape.construct, &shape.call)
        } else {
            (&shape.call, &shape.construct)
        };
        if own.len() != 1
            || !other.is_empty()
            || (allow_members == AllowMembers::No
                && !(shape.props.is_empty() && shape.index.is_empty()))
        {
            return None;
        }
        Some(self.instantiate_only_sig(ty, construct, own[0], members.mapper))
    }

    /// `getSingleCallSignature`
    pub(super) fn single_call_signature(&mut self, ty: TypeId) -> Option<SigId> {
        self.single_signature(ty, SignatureKind::Call, AllowMembers::No)
    }

    /// `getSingleCallOrConstructSignature`. Also returns true if it's a construct signature.
    pub(super) fn single_call_or_construct_signature(
        &mut self,
        ty: TypeId,
    ) -> Option<(SigId, bool)> {
        match self.single_signature(ty, SignatureKind::Call, AllowMembers::No) {
            Some(sig) => Some((sig, false)),
            None => self
                .single_signature(ty, SignatureKind::Construct, AllowMembers::No)
                .map(|sig| (sig, true)),
        }
    }

    /// `getOrCreateTypeFromSignature`
    pub(super) fn type_of_signature(&self, sig: SigId, construct: bool) -> TypeId {
        // It has the symbol of `sig.declaration`.
        let has_no_instantiable_symbol = !self.has_instantiable_symbol(sig);
        self.synth(if construct {
            Shape {
                construct: vec_from_iter_in([sig], self.arena),
                has_no_instantiable_symbol,
                ..Shape::new_in(self.arena)
            }
        } else {
            Shape {
                call: vec_from_iter_in([sig], self.arena),
                has_no_instantiable_symbol,
                ..Shape::new_in(self.arena)
            }
        })
    }

    /// `instantiateSignatureInContextOf`. With `with_result`, inferences are also made from
    /// `expected`'s return type, at a lower priority than from its parameters. `compare` is
    /// `compareTypes`.
    pub(super) fn instantiate_sig_in_context(
        &mut self,
        sig: SigId,
        expected: SigId,
        with_result: bool,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> SigId {
        let mut inference = Inference::for_params(&self.sig_type_params(sig), Some(sig));
        inference.source_outer_mapper = self.outer_mapper_of_sig(expected);
        for (source, target) in self.parameter_type_pairs(expected, sig) {
            self.infer(&mut inference, source, target, 0);
        }
        if with_result {
            // `applyToReturnTypes`: the type of one type predicate is paired with the type of the
            // other.
            if let Some(t) = self.sig_predicate(sig)
                && let Some(s) = self.sig_predicate(expected)
                && (t.asserts, t.param) == (s.asserts, s.param)
                && let (Some(source), Some(target)) = (s.ty, t.ty)
            {
                self.infer(&mut inference, source, target, PRIORITY_RETURN);
            } else {
                let target = self.sig_return(sig);
                if self.has_type_variables(target) {
                    let source = self.sig_return(expected);
                    self.infer(&mut inference, source, target, PRIORITY_RETURN);
                }
            }
        }
        let mapper = self.inference_mapper_comparing(&inference, compare);
        let instantiated = self.instantiate_sig(sig, mapper);
        // `getSignatureInstantiation` erases the type parameters. One that's a clone and is inferred to be itself
        // (`wrap(id)` where `Id<string>` is both the type of `id` and what is expected) leaves the mapper unchanged.
        if self.sig_type_params(instantiated).is_empty() {
            instantiated
        } else {
            self.without_filling_in_type_arguments(instantiated)
        }
    }

    /// The name of the type parameter `param`: the name `unique_type_params` gave it, or else the declared name.
    pub fn type_param_name(&self, param: TypeId) -> Option<Atom> {
        let TypeData::TypeParam(file, tp, enclosing_mapper) = *self.data(param) else {
            return None;
        };
        let declared = self.hir(file)[tp].name;
        Some(
            self.new_type_param_name(declared, enclosing_mapper)
                .unwrap_or(declared),
        )
    }

    /// The name that a clone's `enclosing_mapper` gives the type parameter declared as `declared`.
    /// See `unique_type_params`.
    pub(super) fn new_type_param_name(
        &self,
        declared: Atom,
        enclosing_mapper: MapperId,
    ) -> Option<Atom> {
        if enclosing_mapper == MapperId::IDENTITY {
            return None;
        }
        let renamed = (self.types()).map(enclosing_mapper, self.string_literal(declared, true))?;
        match *self.data(renamed) {
            TypeData::StringLit { value, .. } => Some(value),
            _ => None,
        }
    }

    /// True if `param` has its own symbol, without declarations
    /// (`newSymbol(SymbolFlagsTypeParameter, name)`), and therefore none of the modifiers of the
    /// type parameter it was cloned from.
    pub(super) fn is_renamed_type_param(&self, param: TypeId) -> bool {
        matches!(*self.data(param), TypeData::TypeParam(file, tp, enclosing_mapper)
            if self.new_type_param_name(self.hir(file)[tp].name, enclosing_mapper).is_some())
    }

    /// `newTypeParameter(newSymbol(SymbolFlagsTypeParameter, name))`. Type parameters without a
    /// declaration can't be represented, so this is a clone of `param`, renamed the way
    /// `unique_type_params` renames. `serial` distinguishes it from `param`'s other clones. It's
    /// stored as a mapper entry, like the name.
    pub(super) fn renamed_type_param(
        &self,
        param: TypeId,
        name: Atom,
        serial: usize,
    ) -> Option<TypeId> {
        let TypeData::TypeParam(file, tp, enclosing_mapper) = *self.data(param) else {
            return None;
        };
        let declared = self.string_literal(self.hir(file)[tp].name, true);
        let mut pairs = self.types().mapping(enclosing_mapper).to_vec();
        pairs.retain(|pair| pair.0 != declared);
        pairs.push((declared, self.string_literal(name, false)));
        let serial = self.number_literal(serial as f64, true);
        pairs.push((serial, serial));
        Some(self.cloned_type_param(file, tp, self.types().mapper(pairs)))
    }

    /// `getUniqueTypeParameters`: returns `own`, with a renamed clone for each type parameter whose
    /// name occurs in `inferred` or earlier in `own`. A renamed clone's mapper
    /// (`cloneTypeParameter`) maps the fresh string literal type of the declared name to the string
    /// literal type of the new name. Instantiation only looks up type parameters, so that entry
    /// never reaches a type.
    /// A type parameter that keeps its declared name stays unchanged. Its constraint and its
    /// default refer to the old siblings.
    /// `clone_mapper` resolves a clone's renamed siblings (those of the same function, class or
    /// interface with the same mapper) with the clone's mapper, so one that an earlier call renamed
    /// is cloned again with the same mapper.
    /// Returns `None` if the renamed clones can't be represented.
    /// `serial` identifies the argument. Each `getUniqueTypeParameters` call creates its own type
    /// parameters, with nothing resolved yet, so one argument's clones are distinct from every
    /// other argument's (`renamed_type_param`).
    pub(super) fn unique_type_params(
        &self,
        inferred: &[TypeId],
        own: &[TypeId],
        serial: usize,
    ) -> Option<Vec<TypeId>> {
        let mut names: Vec<Atom> = inferred
            .iter()
            .filter_map(|&param| self.type_param_name(param))
            .collect();
        // The position in `own`, the declared name, the new name.
        let mut renames: Vec<(usize, TypeId, TypeId)> = Vec::new();
        for (position, &param) in own.iter().enumerate() {
            let name = self.type_param_name(param)?;
            if !names.contains(&name) {
                names.push(name);
                continue;
            }
            // `getUniqueTypeParameterName`
            let text = self.atoms().bytes(name);
            let mut base_len = text.len();
            while base_len > 1 && text[base_len - 1].is_ascii_digit() {
                base_len -= 1;
            }
            let mut index = 1u32;
            let unique = loop {
                let mut augmented = text[..base_len].to_vec();
                augmented.extend_from_slice(bun_core::fmt::itoa(
                    &mut bun_core::fmt::ItoaBuf::new(),
                    index,
                ));
                let augmented = self.atoms().intern(&augmented);
                if !names.contains(&augmented) {
                    break augmented;
                }
                index += 1;
            };
            names.push(unique);
            let (_, declaration) = self.type_param_decl(param)?;
            renames.push((
                position,
                self.string_literal(declaration.name, true),
                self.string_literal(unique, false),
            ));
        }
        if renames.is_empty() {
            return Some(own.to_vec());
        }
        // The entries are keyed by declared name, so only siblings share them. The type parameters of a signature are
        // those of a function, or of the class or interface that a construct signature belongs to. `clone_mapper` knows
        // their siblings.
        let mut sibling_sets: Vec<(FileId, ScopeId, MapperId)> = Vec::with_capacity(own.len());
        for &param in own {
            let TypeData::TypeParam(file, tp, enclosing_mapper) = *self.data(param) else {
                return None;
            };
            let scope = self.bound(file).type_param_scope[tp.idx()];
            if scope.is_none()
                || !matches!(
                    self.bound(file).scopes[scope.idx()].kind,
                    ScopeKind::Fn(_) | ScopeKind::Class(_) | ScopeKind::Interface(_)
                )
            {
                return None;
            }
            sibling_sets.push((file, scope, enclosing_mapper));
        }
        let mut unique = Vec::with_capacity(own.len());
        for (i, &param) in own.iter().enumerate() {
            let TypeData::TypeParam(file, tp, enclosing_mapper) = *self.data(param) else {
                return None;
            };
            let renames_of_siblings: SmallVec<[(TypeId, TypeId); 4]> = renames
                .iter()
                .filter(|rename| sibling_sets[rename.0] == sibling_sets[i])
                .map(|rename| (rename.1, rename.2))
                .collect();
            let has_new_name =
                renames.iter().any(|rename| rename.0 == i) || self.is_renamed_type_param(param);
            if renames_of_siblings.is_empty() || !has_new_name {
                unique.push(param);
                continue;
            }
            let mut pairs = self.types().mapping(enclosing_mapper).to_vec();
            pairs.retain(|pair| !renames_of_siblings.iter().any(|rename| rename.0 == pair.0));
            pairs.extend(renames_of_siblings.iter().copied());
            let serial = self.number_literal(serial as f64, true);
            if !pairs.iter().any(|pair| pair.0 == serial) {
                pairs.push((serial, serial));
            }
            unique.push(self.cloned_type_param(file, tp, self.types().mapper(pairs)));
        }
        Some(unique)
    }

    /// `instantiateInstantiableTypes`: instantiates the instantiable types, including those inside
    /// a union or an intersection. Object types are left unchanged. `mapper_for` returns the mapper
    /// for what a type mentions.
    pub(super) fn instantiate_instantiable_types(
        &mut self,
        ty: TypeId,
        mapper_for: &mut dyn FnMut(&mut Self, TypeId) -> MapperId,
    ) -> TypeId {
        if self.is_instantiable(ty) {
            let mapper = mapper_for(self, ty);
            return self.instantiate(ty, mapper);
        }
        match self.data(ty) {
            TypeData::Union(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.instantiate_instantiable_types(part, mapper_for))
                    .collect();
                self.union_unreduced(&parts)
            }
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.instantiate_instantiable_types(part, mapper_for))
                    .collect();
                self.intersection(&parts)
            }
            _ => ty,
        }
    }

    /// `inferFromAnnotatedParametersAndReturn`: infers to the type parameters in `contextual`, the
    /// contextual signature of `func`, from the parameter annotations of `func`, up to a rest
    /// parameter, and from its return type annotation.
    /// `level` is the inference context's index. The context stays in `inference_contexts` while an
    /// annotation is resolved, which can call `getContextualSignature` for `func` again.
    pub(super) fn infer_from_annotated_parameters_and_return(
        &mut self,
        file: FileId,
        func: FnId,
        contextual: SigId,
        level: usize,
    ) {
        let hir = self.hir(file);
        let expected = self.sig_params(contextual);
        for (i, p) in hir[func].params.iter().enumerate() {
            if hir[p].flags.contains(Flags::REST) {
                break;
            }
            if hir[p].ty.is_none() {
                continue;
            }
            let mut source = self.type_from_node(file, hir[p].ty);
            // `isOptionalDeclaration`: with a `?`. A default doesn't count.
            if hir[p].flags.contains(Flags::OPTIONAL) {
                source = self.optional(source);
            }
            if let Some(target) = self.param_type_at(&expected, i) {
                self.with_inference_context(level, |c, n| c.infer(n, source, target, 0));
            }
        }
        if hir[func].ret.is_some() {
            let source = self.type_from_node(file, hir[func].ret);
            let target = self.sig_return(contextual);
            self.with_inference_context(level, |c, n| c.infer(n, source, target, 0));
        }
    }

    /// `getContextualTypeForArgument`, `getContextualTypeForArgumentAtIndex`
    pub(super) fn contextual_type_for_argument(
        &mut self,
        file: FileId,
        call: ExprId,
        arg: ExprId,
    ) -> Option<TypeId> {
        if self.iife_resolving.contains(&(file, call)) {
            // `anySignature`: the contextual type is `any`.
            self.note_state_was_read();
            return Some(TypeId::ANY);
        }
        let pulls = self.pulls_contextual_types();
        // An immediately invoked function provides no contextual type for an unannotated parameter,
        // because the parameter is typed from its argument (`getContextuallyTypedParameterType`
        // checks the argument under `anySignature`). Once the call is resolved the parameter has
        // that type, and it's the contextual type like any other.
        let hir = self.hir(file);
        if !pulls
            && let ExprKind::Call(c) = hir[call].kind
            && let ExprKind::Fn(func) = hir[hir[c].callee].kind
            && let Some(index) = super::context::index_of_node(hir, hir[c].args, arg)
        {
            let params = hir[func].params;
            let param = if index < params.len() {
                Some(params.at(index))
            } else {
                params
                    .iter()
                    .last()
                    .filter(|&p| hir[p].flags.contains(Flags::REST))
            };
            if param.is_some_and(|p| hir[p].ty.is_none()) {
                return None;
            }
        }
        let hir = self.hir(file);
        // The pieces of text come first.
        let (id, offset) = match hir[call].kind {
            ExprKind::Call(id) | ExprKind::New(id) => (id, 0),
            ExprKind::TaggedTemplate(id) => {
                // `getEffectiveCallArguments` requests their type, whatever the tag is.
                self.global_ref_checked(known::TemplateStringsArray, &[]);
                (id, 1)
            }
            _ => return None,
        };
        let mut index = super::context::index_of_node(hir, hir[id].args, arg)?;
        // `getEffectiveCallArguments`: a spread tuple counts as its elements, anything else as one
        // argument.
        if self.spread_indices(file, call, hir[id].args).is_some() {
            let effective = self.effective_args(file, hir[id].args);
            index = effective.iter().position(
                |a| matches!(a, Arg::Expr(e) | Arg::SpreadElement(_, _, _, e) if *e == arg),
            )?;
        }
        let index = index + offset;
        // `resolvingSignature`. FOR SPEED the stack isn't searched for a cached call, which is
        // never re-entered.
        let is_cached = self.p.calls.get(&self.task, &(file, call)).is_some();
        if !is_cached
            && !self
                .resolved_meanwhile
                .iter()
                .any(|r| r.0 == file && r.1 == call)
            && self.stack.contains(&Query::Call(file, call))
        {
            self.note_state_was_read();
            return Some(TypeId::ANY);
        }
        let resolved = self.resolved_signature(file, call);
        // `resolveUntypedCall`, `resolveErrorCall`: a signature that yields `any` has no
        // parameters.
        let Some(sig) = resolved.sig else {
            return (self.has_any_flag(resolved.ret)).then_some(TypeId::ANY);
        };
        let params = self.sig_params_with_first(sig, 0);
        let param = match params.last() {
            // What `getSpreadArgumentType` pushes for an element of a tuple is more precise.
            Some(last) if last.rest && index + 1 >= params.len() => {
                self.contextual_indexed_access(last.ty, index + 1 - params.len())
            }
            // `getTypeAtPosition`: where there's no parameter the contextual type is `any`.
            _ => self
                .param_type_asked_at(sig, &params, index)
                .unwrap_or(TypeId::ANY),
        };
        Some(self.without_no_infer(param))
    }
}
