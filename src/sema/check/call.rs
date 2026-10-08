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
    /// field is the node it is positioned at: the argument whose tuple it is an element of, the
    /// template whose pieces of text it represents, the expression of the decorator.
    Type(TypeId, LabeledDeclaration, ExprId),
    /// `createSyntheticExpression` with `isSpread`, for a variable element of a tuple: any number
    /// of values of the first type. The second is the type of the list that is spread. The third
    /// is the label of the element (`tupleNameSource`), or `NONE`. The last is the argument that
    /// spreads the tuple.
    Spread(TypeId, TypeId, LabeledDeclaration, ExprId),
    /// A `SpreadElement` that `getEffectiveCallArguments` leaves as it is, since its operand is not
    /// a tuple: the type it iterates, the type of its operand without a contextual type, the
    /// operand, and the element itself.
    SpreadElement(TypeId, TypeId, ExprId, ExprId),
}

impl Arg {
    /// The node at which an error about it is reported.
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
/// for the node in the tables: the call, `new` or tagged template, the binary expression, the
/// expression of the decorator.
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

/// Whether the caller of `resolve_call` reads `ret`. If not, `ret` is `any` and the return type of
/// the signature is not resolved: `checkCallExpression` returns `anyType` for `new` of a call
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

/// `allowMembers` of `getSingleSignature`. If not, a type that has a property or an index signature
/// has no single signature.
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
    /// FOR SPEED: there is one candidate, it is not generic, and the call is not being resolved
    /// again. The contextual type pushed for an argument is the parameter type of the resolved
    /// signature, so an argument that tsgo checks uncached (`checkExpression`) and again in the
    /// deferred check is checked once.
    pub(super) checks_arguments_once: bool,
    pub(super) candidates_for_argument_error: Sigs,
    pub(super) candidate_for_argument_arity_error: Option<SigId>,
    pub(super) candidate_for_type_argument_error: Option<SigId>,
}

/// What `push_inference_context` replaces in the checker, and `pop_inference_context` puts back.
struct OutsideInferenceContext {
    mode_of_recheck: CheckMode,
    rechecked_exprs: FxHashMap<(FileId, ExprId), TypeId>,
    rechecked_members: FxHashMap<(FileId, PropId), TypeId>,
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
    /// `isContextSensitive`. For `JsxAttributes`: `is_jsx_attributes_context_sensitive`.
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
            ExprKind::Cond { yes, no, .. } => {
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
        self.has_context_sensitive_parameters(file, f)
            || self.has_context_sensitive_return_expression(file, f)
            || self.has_context_sensitive_yield_expression(file, f)
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

    /// `links.resolvedSignature` of `call`, if it is cached, with the return type of the signature.
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
                self.signatures_resolved_discarding.push(call);
            } else {
                // A resolution around the one that was the first to assign has reported.
                self.signatures_resolved_discarding.retain(|&it| it != call);
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
        // There is no re-entrancy guard. A call that a back edge of a loop reaches while it is
        // being resolved is resolved again, any number of times: see `recheck_in_flow_loop`.
        if in_progress_at.is_some_and(|at| self.flow_loop_pushed_since(at).is_some()) {
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
        // queries something in an argument whose type depends on the call it is an argument of. It
        // is queried again, this time with the call in progress. If that reaches the call as an
        // expression, the call is resolved again, without another reset: anything that re-enters
        // then is a cycle.
        if !is_in_progress {
            self.resolution_start = self.stack.len();
        }
        let around = self.call_resolution_errors.take();
        let is_re_resolved = std::mem::replace(&mut self.is_call_re_resolved, is_in_progress);
        let resolved = self.resolve_signature(file, call);
        self.is_call_re_resolved = is_re_resolved;
        let reported = std::mem::replace(&mut self.call_resolution_errors, around);
        self.resolution_start = resolution_start;
        self.resolved_meanwhile.push((file, call, resolved));
        let resolved = self.with_return_type(resolved);
        self.resolved_meanwhile.pop();
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
        // `len(c.flowLoopStack) != 0`
        let is_in_flow_loop =
            |c: &Self| (c.flow_loops.last()).is_some_and(|pushed| c.is_flow_loop_visible(pushed.5));
        // A call that is requested while it is being resolved is resolved again, and `resolveCall`
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
            // The resolution around this one takes the result. Not one that depends on a frame in
            // progress.
            if let Ok(stored) = left
                && !is_in_flow_loop(self)
            {
                return self.cache_call(file, call, resolved, stored);
            }
        } else if let Some(stored) = stored {
            // A task that sees the call resolved also sees this: both are published at the same
            // barrier.
            if let Some(reported) = reported {
                (self.p.call_diagnostics).insert_ref(&self.task, (file, call), reported, stored);
            }
            return self.cache_call(file, call, resolved, stored);
        } else if let Some(reported) = reported
            && is_in_flow_loop(self)
        {
            // `len(c.flowLoopStack) != 0`: the signature is not stored, and what `resolveCall` has
            // reported from the temporary types stays.
            self.reported.extend(reported);
        }
        resolved
    }

    fn effective_args(&mut self, file: FileId, args: IdList<ExprId>) -> Args {
        let hir = self.hir(file);
        let mut out = Args::new();
        if !hir
            .ids(args)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            out.extend(hir.ids(args).map(Arg::Expr));
            return out;
        }
        for a in hir.ids(args) {
            self.each_effective_arg(file, a, |arg| out.push(arg));
        }
        out
    }

    /// What the argument `a` expands to: itself, or the elements it spreads.
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
                // `checkIteratedTypeOrElementType`: a type that is not iterable is an error, and
                // yields `any`. The error is not reported for a type the operand is only assumed to
                // have.
                let element = self.iterated_type_of_spread(ty);
                push(Arg::SpreadElement(element, ty, inner, a));
            }
        }
    }

    /// The part of `getContextuallyTypedParameterType` for an immediately invoked function
    /// expression, whose parameters are typed from its arguments.
    /// `None`: it is not one;
    /// `Some(None)`: it is, and the arguments determine nothing for this parameter.
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
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
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
        // `slices.Index(fn.Parameters(), parameter)`, of which `this` is the first. It is not
        // subtracted here.
        let index = index + usize::from(hir[func].this_param.is_some());
        // Not under `anySignature`: a request for the call resolves it again.
        if own.flags.contains(Flags::REST) {
            return Some(self.spread_argument_type(
                file,
                &args,
                index,
                TypeId::ANY,
                None,
                CheckMode::empty(),
            ));
        }
        match args.get(index) {
            Some(&Arg::Expr(a)) => {
                // `links.resolvedSignature = c.anySignature`: the contextual type of the argument is
                // what is being computed.
                self.iife_resolving.push((file, call));
                let ty = self.type_of_expr(file, a);
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
    /// `close_pos` is the position where the parser expected the `)`. The source text of the
    /// default library is not available.
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
        let is_incomplete = self.is_call_incomplete(file, call, node);
        let is_open = matches!(params, List::Own(_));
        self.has_correct_arity_for_count(params, is_open, actual, spread, is_incomplete)
    }

    /// `hasCorrectArity` for a call with `actual` arguments. `spread`: the first spread argument.
    /// `is_open`: `sig_params` could not store `params`, so a cycle through the type of a parameter
    /// is found where tsgo asks for that type.
    fn has_correct_arity_for_count(
        &mut self,
        params: &[SigParam],
        is_open: bool,
        actual: usize,
        spread: Option<usize>,
        is_incomplete: bool,
    ) -> bool {
        // Which parameters accept `void` only matters where a required one is omitted. That
        // `getMinArgumentCount` asks only matters for `get_type_of_parameter` of a pattern, and
        // where `is_open`.
        let rest = params.last().filter(|p| p.rest);
        if !is_open
            && spread.is_none()
            && !rest.is_some_and(|p| self.is_tuple(p.ty))
            && !params.iter().any(SigParam::is_named_by_pattern)
        {
            if actual > params.len() {
                return rest.is_some();
            }
            let may_be_omitted = |p: &SigParam| p.optional || p.rest && !p.is_required_rest;
            if is_incomplete || params[actual..].iter().all(may_be_omitted) {
                return true;
            }
        }
        let count = self.parameter_count(params);
        let least = self.min_argument_count(params);
        if is_open {
            // `getParameterCount`, then `getMinArgumentCount`: from the last required parameter
            // down to one that does not accept `void`.
            let required = &params[..Self::min_args(params)];
            let asked = required.iter().skip(least.saturating_sub(1)).rev();
            for param in rest.into_iter().chain(asked) {
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
        if is_incomplete {
            return true;
        }
        // `acceptsVoid`: only a parameter that accepts `void` may be omitted. For a parameter whose
        // type is not known this cannot be determined.
        for i in actual..least {
            if is_open && let Some(param) = params.get(i) {
                self.request_type_of_parameter(param);
            }
            let Some(ty) = self.param_type_at(params, i) else {
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
            self.look_at_type_nodes(file, type_args);
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
        // it resolves to. Only as a callee does `super` represent the constructors of the base
        // class: the `super` of `new super()` is that of `super.x`.
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
        // `getResolvedSignature` resets `resolutionStart` the first time only. When the call is
        // resolved again the arguments are already being checked: they are checked again, uncached
        // (`checkExpression`), which has no re-entrancy guard.
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

    /// `resolveErrorCall`: the same, and the result is `unknownSignature`, which returns the error type.
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
            self.look_at_type_nodes(file, data.type_args);
        }
        let type_args = self.types_from_nodes(file, data.type_args);
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
        // `checkCallExpression`: `new` on something that is not a constructor yields `any`.
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
        // `getPropertyNameForKnownSymbolName`
        self.resolve_known_symbol(b"hasInstance");
        let name = self.atoms().symbol_name(b"hasInstance");
        // `getPropertyOfType`: an index signature is not a property.
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
    /// abstract if that of any member is.
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

    /// `getQuickTypeOfExpression` for a call. The arguments are not checked.
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

    /// `getReturnTypeOfSingleNonGenericSignatureOfCallChain`. The signature is that of the type of
    /// the callee as it is: there is none where the chain may short-circuit before the call.
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
            // `getResolvedSignature` resets `resolutionStart` the first time only.
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
        let resolved = ResolvedCall {
            sig: Some(sig),
            // Not requested yet: see `with_return_type`.
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
            // Where `addDiagnostic` has discarded them, the entry says that
            // `getCandidateForOverloadFailure` has deferred the call.
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
            let params = self.sig_params(candidate);
            if !s.type_args.is_empty() || !self.has_correct_arity(s, &params) {
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
            let params = self.sig_params(candidate);
            if !self.has_correct_type_argument_arity(&type_params, s.type_args.len())
                || !self.has_correct_arity(s, &params)
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
                    let mut context = Inference::for_params(&type_params, Some(candidate));
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
                    let instantiated = self.sig_params(check_candidate);
                    if !self.has_correct_arity(s, &instantiated) {
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
                        let instantiated = self.sig_params(check_candidate);
                        if !self.has_correct_arity(s, &instantiated) {
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
        context: &mut Inference,
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
                            || self.is_contextual_type_created_anew(contextual_type)
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

    /// Whether the call of `getContextualType` that has just returned `contextual_type` created it,
    /// so that it is identical to the result of no other call. The contextual type of an assigned
    /// value is `getTypeOfExpression(left)`: `checkObjectLiteral` creates a type on every call, and
    /// `flowTypeCache` keeps it only if the check needed control flow analysis.
    fn is_contextual_type_created_anew(&mut self, contextual_type: TypeId) -> bool {
        let Some((file, left)) = self.requested_assignment_target.take() else {
            return false;
        };
        self.contains_type_of_literal_in(contextual_type, file, left)
            && self.is_checked_without_flow_analysis(file, left)
    }

    /// Whether `ty` is the type of an object literal inside `within`, or is composed of one.
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

    /// Whether `checkExpression(e)` leaves `flowInvocationCount` as it is, whatever has been
    /// resolved by then. `false`: that is not known.
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
            // `checkIdentifier` returns the declared type of a variable that is assigned. A
            // declaration that precedes has been checked, so that type is resolved.
            ExprKind::Ident(_) => {
                let symbol = bound.expr_symbol[e.idx()];
                symbol.is_some() && self.target_kind(file, e).definite && {
                    let declarations = &bound.symbols[symbol.idx()].decls;
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
        inference_context: Option<&mut Inference>,
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
            // `checkSyntheticExpression`. `checkConstEnumAccess`: its parent permits no `const`
            // enum, and `IsValidTypeOnlyAliasUseSite` holds for it.
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
        // FOR SPEED: `instantiateTypeWithSingleGenericCallSignature` returns `ty`, which is not a
        // fresh literal type.
        if inference_context.is_none() && !check_mode.contains(CheckMode::SKIP_GENERIC_FUNCTIONS) {
            return ty;
        }
        // A synthetic expression is no node here: what is pushed for it is pushed for the node it
        // is positioned at, in which nothing is checked meanwhile.
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

    /// `cloneInferenceContext`. `no_default`: `InferenceFlagsNoDefault` besides.
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

    /// `addImplementationSuccessElaboration`: the implementation of the overload `failed`, if
    /// `chooseOverload` accepts it.
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
        let declarations = &bound.symbols.get(symbol.idx())?.decls;
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
                    args.insert(0, Arg::Type(strings, no_label, hir[id].template));
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
            let params = self.sig_params(candidate);
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
            let outer = self.mapper_around_sig(candidate);
            let mut filled: Vec<TypeId> =
                type_args.iter().copied().take(type_params.len()).collect();
            for &param in &type_params[filled.len()..] {
                let ty = match self.default_of_type_param(param) {
                    Some(default) => default,
                    None => self
                        .constraint_of_type_param(param)
                        .unwrap_or(TypeId::UNKNOWN),
                };
                filled.push(self.filled_in_around(param, ty, outer));
            }
            let mapper = self.mapper_from(&type_params, &filled);
            return self.instantiate_sig(candidate, mapper);
        }
        // `inferSignatureInstantiationForOverloadFailure`
        let mut context = Inference::for_params(&type_params, Some(candidate));
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
        // It has the declaration of the first of them.
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
    /// signatures that accept that many type arguments, instantiated with them. `node`: its node,
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
    /// `node`, which then ends with `<>`: the position of the `<`. `TypeNodeKind::Import` is as
    /// large as a `TypeNodeKind` may be, so it has no `has_type_arguments` as `Typeof` has.
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
                ExprKind::Instantiation { type_args, .. } => (file, type_args),
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
        if members.shape().call.is_empty() && members.shape().construct.is_empty() {
            return ty;
        }
        // Also returns whether the result is `sigs` (`core.Same`).
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
        let (call, is_same_call) = actual(self, &members.shape().call);
        let (construct, is_same_construct) = actual(self, &members.shape().construct);
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
        let index = members.shape().index.iter().map(|i| IndexInfo {
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
            mapper,
            ..Shape::new_in(self.arena)
        })
    }

    /// The symbol that the signature `func` declares and the enclosing block or type of `func`.
    /// `before`: the same for another signature.
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
                    SigParent::Block(file, bound.stmt_parent[stmt.idx()]),
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

    /// `SignatureFlagsHasLiteralTypes`: the type node of a parameter, of which `this` is one, is a
    /// `LiteralType`. A `ParenthesizedType` around one is not.
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
    /// `getDefaultConstructSignatures` clones or instantiates the signatures of the base class:
    /// both preserve the declaration, and whether the signature has literal types.
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
    /// declaration sites, the signatures of a later site go first; signatures with literal types go
    /// before all others.
    pub(super) fn candidates_in_order(&mut self, sigs: &[SigId]) -> List<'p, SigId> {
        let first = match *sigs {
            [] => return List::default(),
            [only] => return List::One(only),
            [first, ..] => first,
        };
        let p = self.p;
        let kept = p.candidate_orders.get_ref(&self.task, &first);
        if let Some(kept) = kept
            && let Some(ordered) = Self::cached_candidate_order(kept, sigs)
        {
            return List::Kept(ordered);
        }
        let scope = self.begin_scope();
        let ordered = self.candidates_in_order_uncached(sigs);
        let ended = self.end_scope_by_counters(scope);
        // One list is cached per signature.
        if kept.is_none()
            && let Ok(stored) = ended
        {
            let both = self.list_of(sigs.iter().chain(&ordered).copied());
            let kept = (p.candidate_orders)
                .insert_ref(&self.task, first, both, stored)
                .1;
            // The entry that remains cached may be a different list with the same first signature.
            if let Some(ordered) = Self::cached_candidate_order(kept, sigs) {
                return List::Kept(ordered);
            }
        }
        List::Own(ordered.into_vec())
    }

    /// The second half of an entry of `candidate_orders`, if the first half is `sigs`.
    fn cached_candidate_order<'a>(kept: &'a [SigId], sigs: &[SigId]) -> Option<&'a [SigId]> {
        let (of, ordered) = kept.split_at(kept.len() / 2);
        (of == sigs).then_some(ordered)
    }

    fn candidates_in_order_uncached(&mut self, sigs: &[SigId]) -> Sigs {
        let mut result = Sigs::with_capacity(sigs.len());
        let mut last: Option<(Option<SigSymbol>, Option<SigParent>)> = None;
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
            let before = match last {
                Some((Some(symbol), Some(parent))) => Some((symbol, parent)),
                _ => None,
            };
            let (symbol, parent) = match declaration {
                Some((file, func)) => {
                    let (symbol, parent) = self.sig_home(file, func, before);
                    (Some(symbol), Some(parent))
                }
                None => (None, None),
            };
            match &last {
                Some((last_symbol, last_parent))
                    if last_symbol.is_some() && *last_symbol != symbol =>
                {
                    let _ = last_parent;
                    cutoff = result.len();
                    index = cutoff;
                }
                Some((_, last_parent)) if last_parent.is_some() && *last_parent == parent => {
                    index += 1
                }
                _ => index = cutoff,
            }
            last = Some((symbol, parent));
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

    /// `checkExpressionWithContextualType(arg, paramType, nil, checkMode)`, as
    /// `isSignatureApplicable` calls it for every candidate, pass and relation. tsgo rechecks every
    /// time. The result depends only on the argument, `param` and the mode, so a literal is checked
    /// once per combination. Not one that is being checked already: `findContextualNode` finds what
    /// was pushed for it then, not `param`.
    pub(super) fn arg_type_under(
        &mut self,
        file: FileId,
        arg: Arg,
        param: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let Arg::Expr(e) = arg else {
            return self.check_argument(file, arg, param, None, check_mode);
        };
        let param = self.without_no_infer(param);
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Object(_) | ExprKind::Array(_)
        ) || self.find_contextual_node(file, e, true).is_some()
        {
            return self.check_expression_with_contextual_type(file, e, param, None, check_mode);
        }
        let key = (file, e, param, check_mode.bits());
        if let Some(&known) = self.literals_checked_under.get(&key) {
            return known;
        }
        let cycles = self.cycles;
        let ty = self.check_expression_with_contextual_type(file, e, param, None, check_mode);
        // A result that depends on a circular query is only provisional. So is what the check
        // leaves behind after one: `context_checked_under`. The next check has to leave it again.
        if self.cycles == cycles && !self.is_innermost_tainted() {
            self.literals_checked_under.insert(key, ty);
        }
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
        mut context: Option<&mut Inference>,
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
        // For a `const` type parameter it is readonly, unless `rest` may be a mutable array type
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

    /// `ty`, the constraint or default of the type parameter `param`, instantiated with the outer
    /// type arguments of the signature `param` belongs to (`outer`). For a clone
    /// (`cloneTypeParameter`) that is already done.
    pub(super) fn filled_in_around(
        &mut self,
        param: TypeId,
        ty: TypeId,
        outer: MapperId,
    ) -> TypeId {
        match *self.data(param) {
            TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY => ty,
            _ => self.instantiate(ty, outer),
        }
    }

    /// `getOptionalCallSignature`: the return type of `sig` for `call`. In an optional chain that
    /// may have short-circuited before the call (`nonOptionalType != funcType`), it includes
    /// `undefined`.
    fn return_type_in_chain(&mut self, file: FileId, call: ExprId, sig: SigId) -> TypeId {
        let ret = self.sig_return(sig);
        let ExprKind::Call(c) = self.hir(file)[call].kind else {
            return ret;
        };
        let Call { callee, chain, .. } = self.hir(file)[c];
        if self.chain_receiver(file, callee, chain).1 {
            self.optional(ret)
        } else {
            ret
        }
    }

    /// `getThisArgumentType`: the type of the object the method is accessed on, given that the
    /// chain has reached it. `void` if there is no such object.
    pub(super) fn this_argument_type(&mut self, file: FileId, this_arg: Option<ExprId>) -> TypeId {
        let Some(this_arg) = this_arg else {
            return TypeId::VOID;
        };
        let chain = match self.bound(file).expr_parent[this_arg.idx()] {
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
        if let TypeData::TypeParam(file, tp, around) = *self.data(param)
            && around != MapperId::IDENTITY
        {
            // A clone has one if the declared type parameter does. No instantiation is requested
            // for one that references no type parameter or is itself a type parameter.
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

    /// `ty` without `true` and `false`, if both are in it.
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
    /// `getResolvedSignature` calls it: the callee is checked with `resolvingSignature` in place and
    /// the resolution stack reset. Returns whether the call is deferred.
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
    /// `checkExpression`, which is not memoised, and the two pops. What tsgo caches for the nodes
    /// inside `e` is cached: `resolvedSignature`, `NodeCheckFlagsContextChecked`.
    /// `inference_context` is moved into `inference_contexts` for the duration of the check.
    pub(super) fn check_expression_with_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
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

    /// `pushInferenceContext`, `checkExpressionEx`, which is not memoised, `popInferenceContext`.
    pub(super) fn check_with_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
        check: impl FnOnce(&mut Self, CheckMode) -> TypeId,
    ) -> TypeId {
        let mut inference_context = inference_context;
        let (check_mode, outside) =
            self.push_inference_context(file, e, inference_context.as_deref_mut(), check_mode);
        let ty = check(self, check_mode);
        self.pop_inference_context(file, e, contextual_type, inference_context, outside, ty)
    }

    /// `pushInferenceContext`: moves `inference_context` into `inference_contexts` and begins a
    /// check that is not memoised. Returns the mode of that check, and the argument for
    /// `pop_inference_context`.
    fn push_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
    ) -> (CheckMode, OutsideInferenceContext) {
        let context = inference_context
            .map(|inference| std::mem::replace(inference, Inference::for_params(&[], None)));
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
            // A result computed under one pushed contextual type is not valid under another, or
            // under none.
            rechecked_exprs: std::mem::take(&mut self.rechecked_exprs),
            rechecked_members: std::mem::take(&mut self.rechecked_members),
            recheck: self.begin_recheck(),
        };
        (check_mode, outside)
    }

    /// `popInferenceContext`: ends the check that `push_inference_context` began, which found `ty`,
    /// and moves the context back into `inference_context`. Returns `ty`, without its freshness if
    /// `contextual_type` is a context for literals.
    fn pop_inference_context(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        outside: OutsideInferenceContext,
        ty: TypeId,
    ) -> TypeId {
        self.end_recheck(outside.recheck);
        self.rechecked_exprs = outside.rechecked_exprs;
        self.rechecked_members = outside.rechecked_members;
        self.mode_of_recheck = outside.mode_of_recheck;
        let is_literal_of_contextual_type = self.maybe_type_of_kind(ty, Self::is_literal) && {
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
            *inference = lent;
        }
        ty
    }

    /// `getSingleSignature`: the single call (or construct) signature of `ty`, if there is none of
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
        let shape = members.shape();
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

    /// `getSingleCallOrConstructSignature`, and whether it is a construct signature.
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

    /// `instantiateSignatureInContextOf`. `with_result`: inferences are also made from the return
    /// type of `expected`, at a lower priority than from its parameters. `compare`: `compareTypes`.
    pub(super) fn instantiate_sig_in_context(
        &mut self,
        sig: SigId,
        expected: SigId,
        with_result: bool,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> SigId {
        let mut inference = Inference::for_params(&self.sig_type_params(sig), Some(sig));
        inference.around_source = self.mapper_around_sig(expected);
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
        self.instantiate_sig(sig, mapper)
    }

    /// The name of the type parameter `param`: the name `unique_type_params` gave it, or else the declared name.
    pub fn type_param_name(&self, param: TypeId) -> Option<Atom> {
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        let declared = self.hir(file)[tp].name;
        Some(
            self.new_type_param_name(declared, around)
                .unwrap_or(declared),
        )
    }

    /// The name that the mapper `around` of a clone gives the type parameter declared as
    /// `declared`: see `unique_type_params`.
    pub(super) fn new_type_param_name(&self, declared: Atom, around: MapperId) -> Option<Atom> {
        if around == MapperId::IDENTITY {
            return None;
        }
        let renamed = (self.types()).map(around, self.string_literal(declared, true))?;
        match *self.data(renamed) {
            TypeData::StringLit { value, .. } => Some(value),
            _ => None,
        }
    }

    /// Whether `param` has a symbol of its own, without declarations
    /// (`newSymbol(SymbolFlagsTypeParameter, name)`), and so none of the modifiers of the type
    /// parameter it is a clone of.
    pub(super) fn is_renamed_type_param(&self, param: TypeId) -> bool {
        matches!(*self.data(param), TypeData::TypeParam(file, tp, around)
            if self.new_type_param_name(self.hir(file)[tp].name, around).is_some())
    }

    /// `newTypeParameter(newSymbol(SymbolFlagsTypeParameter, name))`. Type parameters without a
    /// declaration cannot be represented: it is a clone of `param`, renamed the way
    /// `unique_type_params` renames. `serial` distinguishes it from the other clones of `param`: it
    /// is a mapper entry like the one for the name.
    pub(super) fn renamed_type_param(
        &self,
        param: TypeId,
        name: Atom,
        serial: usize,
    ) -> Option<TypeId> {
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        let declared = self.string_literal(self.hir(file)[tp].name, true);
        let mut pairs = self.types().mapping(around).to_vec();
        pairs.retain(|pair| pair.0 != declared);
        pairs.push((declared, self.string_literal(name, false)));
        let serial = self.number_literal(serial as f64, true);
        pairs.push((serial, serial));
        Some(self.cloned_type_param(file, tp, self.types().mapper(pairs)))
    }

    /// `getUniqueTypeParameters`: `own`, with a renamed clone for each type parameter whose name occurs in `inferred` or earlier in
    /// `own`. The mapper of a renamed clone (`cloneTypeParameter`) maps the fresh string literal type of the declared name to the string
    /// literal type of the new name. Instantiation only looks up type parameters, so that entry never reaches a type.
    /// A type parameter that keeps its declared name stays as it is: its constraint and its default name the old siblings.
    /// `clone_mapper` resolves the renamed siblings of a clone (those of the same function, class or interface with the same mapper)
    /// with the mapper of the clone, so one that an earlier call renamed is cloned again with the same mapper.
    /// `None`: the renamed clones cannot be represented.
    pub(super) fn unique_type_params(
        &self,
        inferred: &[TypeId],
        own: &[TypeId],
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
        // The entries are keyed by declared name, so only siblings share them. The type parameters of a signature are those of a
        // function, or of the class or interface that a construct signature belongs to: `clone_mapper` knows their siblings.
        let mut sibling_sets: Vec<(FileId, ScopeId, MapperId)> = Vec::with_capacity(own.len());
        for &param in own {
            let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
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
            sibling_sets.push((file, scope, around));
        }
        let mut unique = Vec::with_capacity(own.len());
        for (i, &param) in own.iter().enumerate() {
            let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
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
            let mut pairs = self.types().mapping(around).to_vec();
            pairs.retain(|pair| !renames_of_siblings.iter().any(|rename| rename.0 == pair.0));
            pairs.extend(renames_of_siblings.iter().copied());
            unique.push(self.cloned_type_param(file, tp, self.types().mapper(pairs)));
        }
        Some(unique)
    }

    /// `instantiateInstantiableTypes`: instantiates the instantiable types, including those inside
    /// a union or an intersection. Object types are left unchanged. `mapper_for`: the mapper, for
    /// what a type mentions.
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
    pub(super) fn infer_from_annotated_parameters_and_return(
        &mut self,
        file: FileId,
        func: FnId,
        contextual: SigId,
        inference: &mut Inference,
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
            // `isOptionalDeclaration`: with a `?`. A default does not count.
            if hir[p].flags.contains(Flags::OPTIONAL) {
                source = self.optional(source);
            }
            if let Some(target) = self.param_type_at(&expected, i) {
                self.infer(inference, source, target, 0);
            }
        }
        if hir[func].ret.is_some() {
            let source = self.type_from_node(file, hir[func].ret);
            let target = self.sig_return(contextual);
            self.infer(inference, source, target, 0);
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
            return Some(TypeId::ANY);
        }
        let pulls = self.pulls_contextual_types();
        // An immediately invoked function provides no contextual type for an unannotated parameter:
        // the parameter is typed from its argument (`getContextuallyTypedParameterType` checks the
        // argument under `anySignature`). Once the call is resolved the parameter has that type,
        // and it is the contextual type like any other.
        let hir = self.hir(file);
        if !pulls
            && let ExprKind::Call(c) = hir[call].kind
            && let ExprKind::Fn(func) = hir[hir[c].callee].kind
            && let Some(index) = hir.ids(hir[c].args).position(|a| a == arg)
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
                // `getEffectiveCallArguments` asks for their type, whatever the tag is.
                self.global_ref_checked(known::TemplateStringsArray, &[]);
                (id, 1)
            }
            _ => return None,
        };
        let mut index = hir.ids(hir[id].args).position(|a| a == arg)?;
        // `getEffectiveCallArguments`: a spread tuple counts as its elements, anything else as one
        // argument.
        if hir
            .ids(hir[id].args)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            let effective = self.effective_args(file, hir[id].args);
            index = effective.iter().position(
                |a| matches!(a, Arg::Expr(e) | Arg::SpreadElement(_, _, _, e) if *e == arg),
            )?;
        }
        let index = index + offset;
        // `resolvingSignature`. FOR SPEED the stack is not searched for a cached call: it is never
        // re-entered.
        let is_cached = self.p.calls.get(&self.task, &(file, call)).is_some();
        if !is_cached
            && !self
                .resolved_meanwhile
                .iter()
                .any(|r| r.0 == file && r.1 == call)
            && self.stack.contains(&Query::Call(file, call))
        {
            return Some(TypeId::ANY);
        }
        let resolved = self.resolved_signature(file, call);
        if !is_cached {
            self.resolved_signatures.insert((file, call));
        }
        // `resolveUntypedCall`, `resolveErrorCall`: a signature that yields `any` has no
        // parameters.
        let Some(sig) = resolved.sig else {
            return (self.has_any_flag(resolved.ret)).then_some(TypeId::ANY);
        };
        let params = self.sig_params(sig);
        let param = match params.last() {
            // What `getSpreadArgumentType` pushes for an element of a tuple is more precise.
            Some(last) if last.rest && index + 1 >= params.len() => {
                self.contextual_indexed_access(last.ty, index + 1 - params.len())
            }
            // `getTypeAtPosition`: where there is no parameter the contextual type is `any`.
            _ => self.param_type_at(&params, index).unwrap_or(TypeId::ANY),
        };
        Some(self.without_no_infer(param))
    }
}
