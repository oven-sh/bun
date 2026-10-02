//! Calls: which signature is meant, what its type parameters are, what comes back.

use super::infer::{Inference, PRIORITY_RETURN};
use super::relate::Relation;
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent};
use smallvec::{SmallVec, smallvec};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCall {
    /// The signature that was picked, with its type parameters filled in.
    pub sig: Option<SigId>,
    pub ret: TypeId,
}

impl crate::local::MaybeLocal for ResolvedCall {
    #[inline]
    fn is_local(&self) -> bool {
        self.sig.is_local() || self.ret.is_local()
    }
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
    /// `createSyntheticExpression`: a type, and its label (`tupleNameSource`) or `NONE`. The last is the node it is at: the
    /// argument whose tuple it is an element of, the template whose pieces of text it is, the expression of the decorator.
    Type(TypeId, Atom, ExprId),
    /// `...list`: any number of the first. The second is the list that is spread. The third is the label of the element of a
    /// spread tuple that it stands for (`tupleNameSource`), or `NONE`. The last is the argument that spreads it.
    Spread(TypeId, TypeId, Atom, ExprId),
}

impl Arg {
    /// The node an error about it is at.
    pub(super) fn node(self) -> ExprId {
        match self {
            Arg::Expr(e) | Arg::Type(_, _, e) | Arg::Spread(_, _, _, e) => e,
        }
    }
}

/// What `resolveCall` resolves (`IsCallLikeExpression`). The expression that goes with it stands for the node in the tables: the
/// call, `new` or tagged template, the binary expression, the expression of the decorator.
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

/// `CallState`
pub(super) struct CallState<'a> {
    pub(super) file: FileId,
    /// What stands for `node` in the tables.
    pub(super) call: ExprId,
    pub(super) node: CallLike,
    pub(super) type_args: &'a [TypeId],
    pub(super) args: &'a [Arg],
    /// `getThisArgumentOfCall`
    pub(super) this_arg: Option<ExprId>,
    pub(super) candidates: Sigs,
    pub(super) arg_check_mode: CheckMode,
    pub(super) is_single_non_generic_candidate: bool,
    /// FOR SPEED: there is one candidate, it is not generic, and the call is not resolved once more. What is pushed for an argument is
    /// what the resolved signature expects of it, so what tsgo checks by value and again in the deferred check is checked once.
    pub(super) checks_arguments_once: bool,
    pub(super) candidates_for_argument_error: Sigs,
    pub(super) candidate_for_argument_arity_error: Option<SigId>,
    pub(super) candidate_for_type_argument_error: Option<SigId>,
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

impl<'p> Checker<'p> {
    /// Whether the type of `e` depends on parameters that get their types from where `e` is used.
    pub fn is_context_sensitive(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Fn(f) => {
                let func = &hir[f];
                // `isContextSensitive` has no case for accessors: they take nothing from where the literal stands.
                if matches!(func.kind, FnKind::Getter | FnKind::Setter) {
                    return false;
                }
                let bound = self.bound(file);
                let info = &bound.fns[f.idx()];
                if func.type_params.is_empty() {
                    // `HasContextSensitiveParameters`: a parameter without a type. A `this` that is used and not typed is one.
                    if func.params.iter().any(|p| hir[p].ty.is_none())
                        || func.kind != FnKind::Arrow
                            && func.this_ty(hir).is_none()
                            && info.contains_this
                    {
                        return true;
                    }
                    // `hasContextSensitiveReturnExpression`: `() => x => x`
                    let returns_what_waits = func.ret.is_none()
                        && match func.body {
                            FnBody::Expr(body) => self.is_context_sensitive(file, body),
                            FnBody::Block(_) => bound
                                .ids(info.returns)
                                .any(|s| matches!(hir[s].kind, StmtKind::Return(value) if value.is_some() && self.is_context_sensitive(file, value))),
                            FnBody::None => false,
                        };
                    if returns_what_waits {
                        return true;
                    }
                }
                // `hasContextSensitiveYieldExpression`, whatever the function says of itself.
                func.flags.contains(Flags::GENERATOR)
                    && bound
                        .ids(info.yields)
                        .any(|y| self.is_context_sensitive(file, y))
            }
            ExprKind::Yield { value, .. } => {
                value.is_some() && self.is_context_sensitive(file, value)
            }
            ExprKind::Object(props) => props
                .iter()
                .any(|p| hir[p].value.is_some() && self.is_context_sensitive(file, hir[p].value)),
            ExprKind::Array(items) => hir.ids(items).any(|i| self.is_context_sensitive(file, i)),
            ExprKind::Cond { yes, no, .. } => {
                self.is_context_sensitive(file, yes) || self.is_context_sensitive(file, no)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => self.is_context_sensitive(file, left) || self.is_context_sensitive(file, right),
            ExprKind::Spread(x) | ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.is_context_sensitive(file, x)
            }
            // There is no case for a JSX element either: what its attributes are expected to be is up to its component.
            _ => false,
        }
    }

    pub fn resolved_signature(&mut self, file: FileId, call: ExprId) -> ResolvedCall {
        if let Some(known) = self.p.calls.get(&(file, call)) {
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
        if self.prepare_question_about_expr(file, call)
            && let Some(known) = self.p.calls.get(&(file, call))
        {
            return known;
        }
        // `resolvingSignature`
        let is_under_way = self
            .stack
            .iter()
            .any(|q| matches!(*q, Query::Call(f, c) if f == file && c == call));
        if !self.enter(Query::Call(file, call)) {
            return ResolvedCall {
                sig: None,
                ret: TypeId::UNRESOLVED,
            };
        }
        // `getResolvedSignature`: "temporarily reset the resolution stack", for whoever asks about something in an argument whose
        // type depends on the call it is an argument of. It is asked about once more, this time with the call under way. Should
        // that lead to the call as an expression, the call is resolved again, without another reset: what comes round then is a circle.
        let resolution_start = self.resolution_start;
        if !is_under_way {
            self.resolution_start = self.stack.len();
        }
        let around = self.call_resolution_errors.take();
        let resolved = self.resolve_signature(file, call);
        let said = std::mem::replace(&mut self.call_resolution_errors, around);
        self.resolution_start = resolution_start;
        self.resolved_meanwhile.push((file, call, resolved));
        let resolved = self.with_return_type(resolved);
        self.resolved_meanwhile.pop();
        let holds = self.leave();
        // A call that is asked for while it is being resolved is resolved once more, and `resolveCall` reports what is wrong with it
        // as things stand then. Only the first time is kept.
        if is_under_way {
            if let Some(said) = said
                && self
                    .p
                    .said_of_calls_resolved_again
                    .get_ref(&(file, call))
                    .is_none()
            {
                self.p
                    .said_of_calls_resolved_again
                    .insert_ref((file, call), said);
            }
        } else if holds {
            // First: another thread that finds the call resolved finds this too.
            if let Some(said) = said {
                self.p.said_of_calls.insert_ref((file, call), said);
            }
            self.p.calls.insert((file, call), resolved);
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

    /// What the argument `a` comes to: itself, or what it spreads.
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
                        push(Arg::Spread(element, e, f.label(), a));
                    } else if f.contains(ElemFlags::REST) {
                        let list = self.array_of(e);
                        push(Arg::Spread(e, list, f.label(), a));
                    } else {
                        push(Arg::Type(e, f.label(), a));
                    }
                }
            }
            _ => {
                // `checkIteratedTypeOrElementType`: what cannot be gone through is an error, and gives `any`. That is not said of what
                // the operand is only taken to be.
                let element = match self.iterated_type_if_any(ty, false) {
                    Some(element) => element,
                    None => TypeId::ANY,
                };
                push(Arg::Spread(element, ty, Atom::NONE, a));
            }
        }
    }

    /// `ty` if it is an array, or the array it extends: `Array<string>` for `RegExpMatchArray`.
    fn array_it_extends(&mut self, ty: TypeId, depth: u32) -> Option<TypeId> {
        if self.is_array(ty) {
            return Some(ty);
        }
        let &TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        if depth > 8 {
            return None;
        }
        let args = self.type_arguments(ty);
        let params = self.all_type_params_of_symbol(target);
        let mapper = self.mapper_from(&params, &args[..params.len().min(args.len())]);
        for base in self.base_types(target).to_vec() {
            let base = self.instantiate(base, mapper);
            if let Some(array) = self.array_it_extends(base, depth + 1) {
                return Some(array);
            }
        }
        None
    }

    /// A function expression that is called where it is written takes what it is given. `None`: it is not one;
    /// `Some(None)`: it is, and nothing is said about this parameter.
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
        // What is given is looked at as if anything were expected of it (`anySignature`): what is expected is what is being worked out.
        self.iife_resolving.push((file, parent));
        let given = self.iife_param_type_from_args(file, func, index, hir[c].args);
        self.iife_resolving.pop();
        // `widenTypeForVariableLikeDeclaration`: no signature is expected of the function, so the parameter is declared as what it is
        // given widens to.
        Some(given.map(|ty| {
            let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
                TypeId::SYMBOL
            } else {
                ty
            };
            self.regular_object(ty)
        }))
    }

    /// The part of `getContextuallyTypedParameterType` for a function that is called where it is written.
    fn iife_param_type_from_args(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
        args: IdList<ExprId>,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let args = self.effective_args(file, args);
        let own = &hir[hir[func].params.at(index)];
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
                let ty = self.type_of_expr(file, a);
                Some(self.widen_literal(ty))
            }
            Some(&(Arg::Type(ty, ..) | Arg::Spread(ty, ..))) => Some(ty),
            None if own.default.is_some() => None,
            // `undefinedWideningType`
            None => Some(TypeId::UNDEFINED),
        }
    }

    /// `callIsIncomplete`: the tagged template is unterminated, or the `)` of the call is missing. `close_pos` is where the parser
    /// expected the `)`. The default library has no text.
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
    pub(super) fn has_correct_arity(&mut self, s: &CallState<'_>, params: &[SigParam]) -> bool {
        let (file, call, node, args) = (s.file, s.call, s.node, s.args);
        // The attributes are one argument, whatever the component takes besides.
        if matches!(node, CallLike::Jsx(_)) {
            return true;
        }
        let given = match node {
            CallLike::Decorator(owner) => self.decorator_argument_count(file, owner, params),
            _ => args.len(),
        };
        let spread = args.iter().position(|a| matches!(a, Arg::Spread(..)));
        let is_incomplete = self.is_call_incomplete(file, call, node);
        self.has_correct_arity_for_count(params, given, spread, is_incomplete)
    }

    /// `hasCorrectArity`, of a call with `given` arguments. `spread`: the first of them that is spread.
    pub(super) fn has_correct_arity_for_count(
        &mut self,
        params: &[SigParam],
        given: usize,
        spread: Option<usize>,
        is_incomplete: bool,
    ) -> bool {
        // Which parameters take `void` only matters where one that is required is left out.
        let rest = params.last().filter(|p| p.rest);
        if spread.is_none() && !rest.is_some_and(|p| self.is_tuple(p.ty)) {
            if given > params.len() {
                return rest.is_some();
            }
            if is_incomplete || params[given..].iter().all(|p| p.optional || p.rest) {
                return true;
            }
        }
        let count = self.parameter_count(params);
        let least = self.min_argument_count(params);
        let has_rest = self.has_effective_rest_parameter(params);
        // What is spread comes after all that is required, and goes to a rest parameter or at least starts among the parameters.
        if let Some(spread) = spread {
            return spread >= least && (has_rest || spread < count);
        }
        if given > count && !has_rest {
            return false;
        }
        if is_incomplete {
            return true;
        }
        // `acceptsVoid`: only a parameter that takes `void` may be left out. Of one that is not known it cannot be told.
        for i in given..least {
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
        // `resolveTaggedTemplateExpression`: a call with the pieces of text for a first argument.
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
                    self.resolve_error_call(file, exprs)
                };
            }
            let type_args = self.types_from_nodes(file, type_args);
            let node = CallLike::Call(c);
            let args = self.effective_call_arguments(file, call, node);
            let this_arg = self.this_argument_of_call(file, call, node);
            return self.resolve_call(
                file, call, node, &sigs, &type_args, &args, this_arg, true, true, None,
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
        // `checkCallExpression`: with `super` for what is called the expression is `void`, whatever it resolves to. Only in a call
        // does `super` stand for the constructors of the base: that of `new super()` is that of `super.x`.
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

    /// `resolveUntypedCall`: nothing is expected of the arguments, and they are looked at all the same. What leads back from there to
    /// something that is being worked out is a circle. The result is `anySignature`.
    fn resolve_untyped_call(&mut self, file: FileId, args: IdList<ExprId>) -> ResolvedCall {
        // `getResolvedSignature` resets `resolutionStart` the first time only. Where the call is resolved once more the arguments are
        // being looked at: they are checked again, by value, which has no guard.
        let outer = (self.resolution_start != self.stack.len()).then(|| self.begin_recheck());
        for arg in self.hir(file).ids(args) {
            self.type_of_expr(file, arg);
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

    /// `resolveCallExpression`, of `super(..)`: what is called is one of the constructors of what the class extends, with the type
    /// arguments given there.
    fn resolve_super_call(&mut self, file: FileId, call: ExprId, id: CallId) -> ResolvedCall {
        let Some(&class) = self
            .classes_around(file, self.bound(file).expr_parent[call.idx()])
            .first()
        else {
            return self.resolve_untyped_call(file, self.hir(file)[id].args);
        };
        let class = self.class_sym(file, class);
        let sigs = self.super_constructor_sigs(class);
        if sigs.is_empty() {
            return self.resolve_untyped_call(file, self.hir(file)[id].args);
        }
        let args = self.effective_args(file, self.hir(file)[id].args);
        self.resolve_call(
            file,
            call,
            CallLike::Call(id),
            &sigs,
            &[],
            &args,
            None,
            true,
            true,
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
        let mut callee = self.type_of_expr(file, data.callee);
        if data.chain != Chain::No || self.is_in_optional_chain(file, data.callee) {
            callee = self.non_nullable(callee);
        }
        callee = self.non_null_type(callee);
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
            return ResolvedCall {
                ret: if callee == TypeId::UNRESOLVED {
                    callee
                } else {
                    TypeId::ANY
                },
                ..self.resolve_untyped_call(file, data.args)
            };
        }
        let mut sigs = self.signatures(callee, is_new);
        // What may not be constructed from here is in error.
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
        // A method of `A[] | B[]` whose signatures do not come together is called as that of `(A | B)[]`.
        if sigs.is_empty()
            && !is_new
            && self.is_union(callee)
            && let ExprKind::Dot { obj, name, .. } = hir[data.callee].kind
        {
            let receiver = self.type_of_expr(file, obj);
            let receiver = self.non_nullable(receiver);
            let receiver = self.apparent_type(receiver);
            let mut elements = Vec::new();
            let mut readonly = false;
            let all_arrays =
                self.is_union(receiver)
                    && self.parts(receiver).to_vec().into_iter().all(|part| {
                        match self.data(part) {
                            TypeData::Tuple {
                                flags, readonly: r, ..
                            } => {
                                readonly |= r;
                                let elems = self.type_arguments(part);
                                elements.push(self.tuple_element_union(elems, flags));
                                true
                            }
                            _ => match self.array_it_extends(part, 0) {
                                Some(array) => {
                                    readonly |=
                                        self.is_reference_to_global(array, known::ReadonlyArray);
                                    elements.extend(self.array_element(array));
                                    true
                                }
                                None => false,
                            },
                        }
                    });
            if all_arrays {
                let element = self.union(&elements);
                let merged = if readonly {
                    self.global_ref(known::ReadonlyArray, &[element])
                } else {
                    self.array_of(element)
                };
                if let Some(method) = self.type_of_property(merged, name) {
                    sigs = self.signatures(method, false);
                }
            }
        }
        // `new` of what can only be called is resolved as a call of it.
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
                self.resolve_error_call(file, data.args)
            };
        }
        let type_args = self.types_from_nodes(file, data.type_args);
        let args = self.effective_args(file, data.args);
        let node = CallLike::Call(id);
        let this_arg = self.this_argument_of_call(file, call, node);
        // `resolveNewExpression` reads the return type of a call signature invoked with `new` only without `noImplicitAny` (2350).
        let wants_return = !(is_call_by_new && self.p.files.options.no_implicit_any);
        let resolved = self.resolve_call(
            file,
            call,
            node,
            &sigs,
            &type_args,
            &args,
            this_arg,
            true,
            wants_return,
            None,
        );
        // `checkCallExpression`: what `new` makes of something that is no constructor is anything.
        if is_call_by_new {
            ResolvedCall {
                ret: TypeId::ANY,
                ..resolved
            }
        } else {
            resolved
        }
    }

    /// `resolveInstanceofExpression`. 2359 is said elsewhere.
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
        // `checkBinaryLikeExpression` has checked both operands, with nothing expected of them.
        self.type_of_expr(file, left);
        let right_type = self.type_of_expr(file, right);
        if self.is_any(right_type) {
            return any_signature;
        }
        let Some(method) = self.symbol_has_instance_method_of_object_type(right_type) else {
            return any_signature;
        };
        let apparent = self.apparent_type(method);
        if self.is_error_type(apparent) {
            return ResolvedCall {
                sig: None,
                ret: TypeId::ERROR,
            };
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
            true,
            true,
            Some(2860),
        )
    }

    /// `getSymbolHasInstanceMethodOfObjectType`
    pub(super) fn symbol_has_instance_method_of_object_type(
        &mut self,
        ty: TypeId,
    ) -> Option<TypeId> {
        // `getPropertyNameForKnownSymbolName`
        let name = self.files().atoms.symbol_name(b"hasInstance");
        // `getPropertyOfType`: an index signature is no property.
        let mut methods = Vec::new();
        for &part in self.parts(ty) {
            if !self.is_assignable(part, TypeId::OBJECT) {
                return None;
            }
            let apparent = self.apparent_type(part);
            for &member in self.parts(apparent) {
                let members = self.members(member)?;
                let (prop, mapper) = self.property_of_type(&members, name)?;
                methods.push(self.type_of_prop(&prop, mapper));
            }
        }
        let method = self.union(&methods);
        (!self.signatures(method, false).is_empty()).then_some(method)
    }

    /// `someSignature(constructSignatures, abstract)`: what is made for a union is abstract if what one of its members has is.
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

    /// `getQuickTypeOfExpression`, of `new`: what the only construct signature of what is constructed returns, if that is not
    /// generic, whatever is wrong with the call.
    pub(super) fn quick_type_of_new(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let ExprKind::New(c) = self.hir(file)[e].kind else {
            return None;
        };
        let called = self.type_of_expr(file, self.hir(file)[c].callee);
        let callee = self.check_non_null_type(file, self.hir(file)[c].callee, called);
        let only = self.single_signature(callee, true, true)?;
        if !self.sig_type_params(only).is_empty() {
            return None;
        }
        Some(self.sig_return(only))
    }

    /// `getQuickTypeOfExpression`, of a call: what the only call signature of what is called returns, if that is not generic. The
    /// arguments are not looked at.
    pub(super) fn quick_type_of_call(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[e].kind else {
            return None;
        };
        let callee = hir[c].callee;
        if matches!(
            hir[callee].kind,
            ExprKind::Super | ExprKind::Ident(known::require)
        ) || self.is_symbol_or_symbol_for_call(file, e)
            || hir[c].chain != Chain::No
            || self.is_in_optional_chain(file, callee)
        {
            return None;
        }
        let called = self.type_of_expr(file, callee);
        let callee = self.check_non_null_type(file, callee, called);
        let only = self.single_signature(callee, false, true)?;
        if !self.sig_type_params(only).is_empty() {
            return None;
        }
        Some(self.sig_return(only))
    }

    /// `resolveCall`. `report_errors`: `reportErrors`.
    /// `wants_return`: the caller reads `ret`. Otherwise `ret` is `any` and the return type of the signature is not resolved:
    /// `checkCallExpression` returns `anyType` for `new` of a call signature before it calls `getReturnTypeOfSignature`.
    pub(super) fn resolve_call(
        &mut self,
        file: FileId,
        call: ExprId,
        node: CallLike,
        signatures: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        report_errors: bool,
        wants_return: bool,
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
            // Not asked yet: see `with_return_type`.
            ret: if wants_return {
                TypeId::UNRESOLVED
            } else {
                TypeId::ANY
            },
        };
        if !is_chosen && report_errors {
            // `resolvedSignature = result`, before the errors are reported.
            self.resolved_meanwhile.push((file, call, resolved));
            let since = (self.reported.len(), self.noted_ahead.len());
            // Whoever asks first resolves the call, from whatever file. What is reported is in the file of the call.
            let checking = (self.checking, self.is_type_checked);
            if self.checking != Some(file) {
                (self.checking, self.is_type_checked) = (Some(file), false);
            }
            self.report_call_resolution_errors(&s, signatures, head_message);
            (self.checking, self.is_type_checked) = checking;
            self.resolved_meanwhile.pop();
            // Another checker may be the one to report it.
            self.settle_what_was_noted_ahead_since(since.0, since.1);
            let said = self.reported.split_off(since.0);
            if !said.is_empty() {
                self.call_resolution_errors = Some(said);
            }
        }
        resolved
    }

    /// `checkCallExpression`: `getReturnTypeOfSignature(signature)`. It asks once `getResolvedSignature` has put `resolutionStart` back,
    /// so what is being resolved around the call can be seen from there.
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
                    if !self.do_type_arguments_fit(candidate, s.type_args) {
                        s.candidate_for_type_argument_error = Some(candidate);
                        continue;
                    }
                    let filled = self.fill_sig_type_args(candidate, &type_params, s.type_args);
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
                if self.has_type_variables(inference_target_type) {
                    let outer_context = self.get_inference_context(file, call);
                    let is_from_binding_pattern = !skip_binding_patterns
                        && self.contextual_type(file, call, ContextFlags::SKIP_BINDING_PATTERNS)
                            != Some(contextual_type);
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
                            match self.single_call_signature(instantiated_type, false) {
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
                    return_context.from_pattern = is_from_binding_pattern;
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
                    // `nonInferrableAnyType`: the names in a pattern can be anything, and nothing is inferred from that.
                    if is_from_binding_pattern {
                        for c in &mut return_context.candidates {
                            c.covariant.retain(|t| !self.has_any_flag(*t));
                            c.contravariant.retain(|t| !self.has_any_flag(*t));
                        }
                    }
                    context.return_mapper = self.mapper_of_inferred_part(&return_context);
                }
            }
        }
        let params = self.sig_params(signature);
        let rest_type = self.non_array_rest_type(&params);
        let arg_count = if rest_type.is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        if let Some(rest) = rest_type
            && let Some(k) = context.params.iter().position(|&p| p == rest)
            && !args[arg_count..]
                .iter()
                .any(|a| matches!(a, Arg::Spread(..)))
        {
            context.candidates[k].implied_arity = Some(args.len() - arg_count);
        }
        if let Some(this_type) = self.sig_this_type(signature)
            && self.has_type_variables(this_type)
        {
            let this_argument_type = self.this_argument_type(file, s.this_arg);
            self.infer(context, this_argument_type, this_type, 0);
        }
        for (i, &arg) in args.iter().enumerate().take(arg_count) {
            if matches!(self.hir(file)[arg.node()].kind, ExprKind::Missing) {
                continue;
            }
            if let Some(param_type) = self.param_type_at(&params, i)
                && self.has_type_variables(param_type)
            {
                let arg_type =
                    self.check_argument(file, arg, param_type, Some(context), check_mode);
                self.infer(context, arg_type, param_type, 0);
            }
        }
        if let Some(rest) = rest_type
            && self.has_type_variables(rest)
        {
            let spread_type =
                self.spread_argument_type(file, args, arg_count, rest, Some(context), check_mode);
            self.infer(context, spread_type, rest, 0);
        }
        self.inference_mapper(context)
    }

    /// `checkExpressionWithContextualType`, of an argument. What `createSyntheticExpression` made is its type.
    pub(super) fn check_argument(
        &mut self,
        file: FileId,
        arg: Arg,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
    ) -> TypeId {
        match arg {
            Arg::Expr(e) => {
                let contextual_type = self.without_no_infer(contextual_type);
                self.check_expression_with_contextual_type(
                    file,
                    e,
                    contextual_type,
                    inference_context,
                    check_mode,
                )
            }
            Arg::Type(t, ..) | Arg::Spread(t, ..) => t,
        }
    }

    /// `getSignatureInstantiationWithoutFillingInTypeArguments(signature, signature.typeParameters)`
    fn without_filling_in_type_arguments(&mut self, generic: SigId) -> SigId {
        let (params, ret, this) = (
            self.sig_params(generic),
            self.sig_return(generic),
            self.sig_this_type(generic),
        );
        self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this,
            of: Box::new([]),
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

    /// `getMapperFromContext(cloneInferredPartOfContext(n))`. `IDENTITY`: nothing has candidates.
    fn mapper_of_inferred_part(&mut self, n: &Inference) -> MapperId {
        let (mut params, mut candidates) = (Vec::new(), Vec::new());
        for (&param, c) in n.params.iter().zip(&n.candidates) {
            if !c.covariant.is_empty() || !c.contravariant.is_empty() {
                params.push(param);
                candidates.push(c.clone());
            }
        }
        if params.is_empty() {
            return MapperId::IDENTITY;
        }
        let mut part = Inference::for_params(&params, n.sig);
        part.candidates = candidates.into_iter().collect();
        part.any_default = n.any_default;
        part.no_default = n.no_default;
        let mut pairs = Vec::with_capacity(params.len());
        for (i, &param) in params.iter().enumerate() {
            pairs.push((param, self.get_inferred_type(&part, i, true)));
        }
        self.p.types.mapper(pairs)
    }

    /// `createOuterReturnMapper(context)`, applied to `ty`. The clone is made once.
    fn instantiate_with_outer_return_mapper(&mut self, level: usize, ty: TypeId) -> TypeId {
        self.with_inference_context(level, |c, context| {
            let mut clone = match context.outer_return_context.take() {
                Some(clone) => clone,
                None => Box::new(Self::clone_inference_context(context, false)),
            };
            // `MergedTypeMapper.Map`: `m2.Map(m1.Map(t))`, of a type parameter.
            let mut pairs = Vec::new();
            let mentioned = c.params_mentioned_in(ty, &context.params);
            for (&param, _) in context.params.iter().zip(mentioned).filter(|m| m.1) {
                let first = c.p.types.map(context.return_mapper, param).unwrap_or(param);
                let second = if clone.params.contains(&first) {
                    let mapper = c.fixing_mapper(&mut clone, first);
                    c.instantiate(first, mapper)
                } else {
                    first
                };
                pairs.push((param, second));
            }
            context.outer_return_context = Some(clone);
            let mapper = c.p.types.mapper(pairs);
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
        // `cloneSignature`: it is declared where `returned` is.
        let generalized = self.p.types.intern_sig(SigData::Synth {
            type_params: inferred_type_params.into(),
            params: params.into(),
            ret,
            this,
            of: Box::new([returned]),
        });
        let ret = self.type_of_signature(generalized, construct);
        let returned_type = self.sig_return(sig);
        self.note_single_signature_type(ret, returned_type, mapper);
        let (params, this) = (self.sig_params(sig), self.sig_this_type(sig));
        self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this,
            of: Box::new([]),
        })
    }

    /// `addImplementationSuccessElaboration`: the implementation behind the overload `failed`, if `chooseOverload` takes it.
    pub(super) fn add_implementation_success_elaboration(
        &mut self,
        s: &CallState<'_>,
        failed: SigId,
    ) -> Option<SigId> {
        let candidate = self.implementation_of_overload(failed)?;
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

    /// The signature of the first declaration with a body of the symbol that declares the overload `failed`, if the symbol has more
    /// than one declaration (`addImplementationSuccessElaboration`). Constructors are not supported: `sig_of_fn` does not give them
    /// the type parameters of the class.
    pub(super) fn implementation_signature(&mut self, failed: SigId) -> Option<SigId> {
        let (file, func, _) = self.sig_decl(self.p.types.sig_origin(failed))?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_body = |f: &Func| has_body(f);
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => {
                let symbol = bound.fn_symbol[func.idx()];
                if symbol.is_none() {
                    return None;
                }
                let decls = self.files().decls(self.files().sym(file, symbol));
                if decls.len() < 2 {
                    return None;
                }
                let (file, implementation) = decls.iter().find_map(|&(file, decl)| match decl {
                    crate::bind::Decl::Fn(f) if has_body(&self.hir(file)[f]) => Some((file, f)),
                    _ => None,
                })?;
                Some(self.sig_of_fn(file, implementation))
            }
            FnOwner::Member(member) => {
                let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
                    return None;
                };
                let overload = &hir[member];
                if overload.kind != MemberKind::Method {
                    return None;
                }
                let name = self.member_name(file, overload.key)?;
                let is_static = overload.flags.contains(Flags::STATIC);
                let (mut count, mut implementation) = (0, None);
                for m in hir[class].members.iter() {
                    let other = &hir[m];
                    if other.kind == MemberKind::Method
                        && other.func.is_some()
                        && other.flags.contains(Flags::STATIC) == is_static
                        && self.member_name(file, other.key) == Some(name)
                    {
                        count += 1;
                        if implementation.is_none() && has_body(&hir[other.func]) {
                            implementation = Some(other.func);
                        }
                    }
                }
                if count < 2 {
                    return None;
                }
                Some(self.sig_of_fn(file, implementation?))
            }
            _ => None,
        }
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
                    let strings = self.global_ref(known::TemplateStringsArray, &[]);
                    args.insert(0, Arg::Type(strings, Atom::NONE, hir[id].template));
                }
                args
            }
            CallLike::InstanceOf { left, .. } => smallvec![Arg::Expr(left)],
            // `emptyFreshJsxObjectType`: "This attributes Type does not include a children property yet".
            CallLike::Jsx(j) if hir[j].tag.is_none() => {
                let empty = self.synth(Shape {
                    literal: Literalness::JsxAttributes,
                    ..Shape::default()
                });
                smallvec![Arg::Type(empty, Atom::NONE, call)]
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
                        args.push(Arg::Type(p.ty, Atom::NONE, call));
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
            // `getTypeArgumentsFromNodes`: those there are too many of are dropped. One that is missing is what its type parameter
            // defaults to, or extends, as that is written.
            let outer = self
                .sig_decl(candidate)
                .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
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

    /// `createUnionOfSignaturesForOverloadFailure`: it takes what any of `sigs` takes, and returns what all of them return.
    pub(super) fn union_of_signatures_for_overload_failure(&mut self, sigs: &[SigId]) -> SigId {
        let lists: Vec<List<'p, SigParam>> = sigs.iter().map(|&sig| self.sig_params(sig)).collect();
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
                // The parameter at that place, or the rest parameter that stands for it.
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
                has_declaration: source.is_some_and(|p| p.has_declaration),
            });
        }
        let rests: Vec<&SigParam> = lists
            .iter()
            .filter_map(|list| list.last().filter(|p| p.rest))
            .collect();
        if let Some(first) = rests.first() {
            // `tryGetRestTypeOfSignature`
            let elements: Vec<TypeId> = rests
                .iter()
                .filter_map(|p| self.array_element(p.ty))
                .collect();
            let element = self.union_reduced(&elements);
            params.push(SigParam {
                name: first.name,
                ty: self.array_of(element),
                optional: false,
                rest: true,
                has_declaration: first.has_declaration,
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
        // It is declared where the first of them is.
        self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this,
            of: Box::new([sigs[0]]),
        })
    }

    /// `getInstantiationExpressionType`, `f<Args>` without a call: `ty` with the signatures that take that many type arguments, given
    /// them. `node`: where it is written, which the object types that are made keep.
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
        let (file, nodes) = self.type_argument_nodes(node);
        if let Some(error_type) = error_type
            && let Some(first) = self.hir(file).ids(nodes).next()
        {
            let start = super::errors_x_typenodes::start_of_type(self.hir(file), first);
            let loc = (file, start, self.end_of_type_args(file, nodes));
            self.error_at(loc, 2635, &[super::sink::Arg::Type(error_type)]);
        }
        result
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
        match self.data(ty).clone() {
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
            let given = self.instantiated_type_part(constraint, args, node, own, found);
            return if given == constraint { ty } else { given };
        }
        let Some(members) = self.members(ty) else {
            return ty;
        };
        if members.shape().call.is_empty() && members.shape().construct.is_empty() {
            return ty;
        }
        let given = |c: &mut Self, sigs: &[SigId]| -> Vec<SigId> {
            let mut out = Vec::new();
            for &sig in sigs {
                let sig = c.instantiate_sig(sig, members.mapper);
                let params = c.sig_type_params(sig);
                // `getInstantiatedSignatures`: the empty list of `f<>` fits every generic signature.
                if params.is_empty() || !c.has_correct_type_argument_arity(&params, args.len()) {
                    continue;
                }
                // `checkTypeArguments`
                if let Ok(Some((index, argument, constraint))) =
                    c.failing_type_argument(sig, &params, args)
                {
                    let (file, nodes) = c.type_argument_nodes(node);
                    let at = c.hir(file).id_at(nodes, index);
                    let start = super::errors_x_typenodes::start_of_type(c.hir(file), at);
                    let error_node = (file, start, c.end_of_type_node_from(file, at, start));
                    c.check_type_assignable_to(argument, constraint, Some(error_node), Some(2344));
                    out.push(sig);
                    continue;
                }
                let filled = c.fill_sig_type_args(sig, &params, args);
                let mapper = c.mapper_from(&params, &filled);
                out.push(c.instantiate_sig(sig, mapper));
            }
            out
        };
        let call = given(self, &members.shape().call);
        let construct = given(self, &members.shape().construct);
        own.0 = true;
        own.1 |= !call.is_empty() || !construct.is_empty();
        let mut props = Vec::with_capacity(members.shape().props.len());
        for prop in &members.shape().props {
            let mut prop = prop.clone();
            self.instantiate_prop(&mut prop, members.mapper);
            props.push(prop);
        }
        let index = members
            .shape()
            .index
            .iter()
            .map(|i| IndexInfo {
                value: self.instantiate(i.value, members.mapper),
                ..*i
            })
            .collect();
        self.synth(Shape {
            props,
            call,
            construct,
            index,
            instantiation_expression: Some(node),
            ..Shape::default()
        })
    }

    /// What the signature `func` declares and the block or type `func` is written in. `before`: the same for another signature.
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

    fn has_literal_types(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        hir[func].params.iter().any(|p| {
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
        })
    }

    /// The signature whose declaration `sig` has (`Signature.declaration`). `getDefaultConstructSignatures` clones or instantiates
    /// the signatures of what the class extends: both keep the declaration, and whether literal types are asked for.
    pub(super) fn declared_sig(&mut self, sig: SigId) -> SigId {
        let mut sig = self.p.types.sig_origin(sig);
        for _ in 0..64 {
            let SigData::DefaultConstruct { base: Some(of), .. } = *self.p.types.sig(sig) else {
                break;
            };
            sig = self.p.types.sig_origin(of);
        }
        sig
    }

    /// `reorderCandidates`: the order overloads are tried in. Of one thing declared in several places, what a later place declares
    /// goes first; signatures that ask for a literal go before all others.
    pub(super) fn candidates_in_order(&mut self, sigs: &[SigId]) -> List<'p, SigId> {
        let first = match *sigs {
            [] => return List::default(),
            [only] => return List::One(only),
            [first, ..] => first,
        };
        let p = self.p;
        let kept = p.candidate_orders.get_ref(&first);
        if let Some(kept) = kept
            && let Some(ordered) = Self::order_kept_for(kept, sigs)
        {
            return List::Kept(ordered);
        }
        let before = self.what_only_holds_for_now();
        let ordered = self.candidates_in_order_uncached(sigs);
        // One list is kept for a signature. What is shared outlives what is local.
        if kept.is_none()
            && self.what_only_holds_for_now() == before
            && (first.is_local() || !sigs.iter().any(|sig| sig.is_local()))
        {
            let both: Box<[SigId]> = sigs.iter().chain(&ordered).copied().collect();
            let kept = p.candidate_orders.insert_ref(first, both).1;
            // Another thread may have put in another list that starts the same.
            if let Some(ordered) = Self::order_kept_for(kept, sigs) {
                return List::Kept(ordered);
            }
        }
        List::Own(ordered.into_vec())
    }

    /// The second half of an entry of `candidate_orders`, if the first half is `sigs`.
    fn order_kept_for<'a>(kept: &'a [SigId], sigs: &[SigId]) -> Option<&'a [SigId]> {
        let (of, ordered) = kept.split_at(kept.len() / 2);
        (of == sigs).then_some(ordered)
    }

    fn candidates_in_order_uncached(&mut self, sigs: &[SigId]) -> Sigs {
        let mut result = Sigs::with_capacity(sigs.len());
        let mut last: Option<(Option<SigSymbol>, Option<SigParent>)> = None;
        let (mut cutoff, mut index, mut specialized) = (0usize, 0usize, 0usize);
        for &sig in sigs {
            // A clone is declared where what it is a clone of is (`Signature.declaration`).
            let declared = self.declared_sig(sig);
            let declaration = match *self.p.types.sig(declared) {
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

    /// FOR SPEED, see `CallState::checks_arguments_once`: `checkExpressionCached(e)` with `param` pushed for it.
    pub(super) fn arg_type_kept_under(&mut self, file: FileId, e: ExprId, param: TypeId) -> TypeId {
        let param = self.without_no_infer(param);
        self.contextual.push((file, e, param));
        self.inference_contexts.push(InferenceContextInfo {
            file,
            node: e,
            context: None,
        });
        let outer = self.suspend_recheck();
        let ty = self.type_of_expr(file, e);
        self.end_recheck(outer);
        self.inference_contexts.pop();
        self.contextual.pop();
        ty
    }

    /// `checkExpressionWithContextualType(arg, paramType, nil, checkMode)`, as `isSignatureApplicable` asks for every candidate, round
    /// and relation. tsgo checks again every time. It depends on the argument, on `param` and on the mode alone, so a literal is
    /// checked once for each.
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
        ) {
            return self.check_expression_with_contextual_type(file, e, param, None, check_mode);
        }
        let key = (file, e, param, check_mode.bits());
        if let Some(&known) = self.literals_checked_under.get(&key) {
            return known;
        }
        let cycles = self.cycles;
        let ty = self.check_expression_with_contextual_type(file, e, param, None, check_mode);
        // What rests on a question that came back to itself holds only for now.
        if self.cycles == cycles {
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
        // `...x` for `...rest`
        if let Some(&Arg::Spread(element, list, ..)) = args.last()
            && index + 1 >= args.len()
        {
            if self.is_array_like(list) {
                return self.mutable_array_or_tuple(list);
            }
            return if is_const {
                self.readonly_array_of(element)
            } else {
                self.array_of(element)
            };
        }
        let length = args.len().saturating_sub(index);
        let mut elems: SmallVec<[TypeId; 8]> = SmallVec::with_capacity(length);
        let mut flags: SmallVec<[ElemFlags; 8]> = SmallVec::with_capacity(length);
        for i in index..args.len() {
            let (ty, flag) = match args[i] {
                Arg::Spread(element, list, ..) => {
                    if self.is_array_like(list) {
                        (list, ElemFlags::VARIADIC)
                    } else {
                        (element, ElemFlags::REST)
                    }
                }
                arg => {
                    let contextual = self.rest_argument_context(rest, i - index, Some(length));
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
        // For a `const` type variable it is not to be written to, unless `rest` may be a list that is (`isMutableArrayLikeType`).
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

    /// What argument `i` of the `length` (if that can be told) that a rest parameter of type `rest` collects is expected to be, as
    /// `getSpreadArgumentType` has it. `rest`: what `getNonArrayRestType` gives.
    pub(super) fn rest_argument_context(
        &mut self,
        rest: TypeId,
        i: usize,
        length: Option<usize>,
    ) -> TypeId {
        if self.is_tuple(rest) {
            return self
                .contextual_element_at(rest, i, length, None, None)
                .unwrap_or(TypeId::UNKNOWN);
        }
        // `getIndexedAccessTypeEx(rest, i, AccessFlagsContextual)`: put off while `rest` is generic (`shouldDeferIndexedAccessType`).
        // Otherwise it is what each member of `rest` has there, with nothing absorbed (`getTypeOfPropertyOfContextualType`).
        if self.is_generic_object_type(rest) {
            let at = self.number_literal(i as f64, false);
            return self.indexed_access(rest, at);
        }
        let name = self.number_name(i as f64);
        self.contextual_property(rest, name).unwrap_or(TypeId::ANY)
    }

    /// What argument `i` of `count` (if that can be told) is expected to be by a signature that takes `params`: what
    /// `getSpreadArgumentType` says for one that a rest parameter that is no plain array collects, `getTypeAtPosition` for any other.
    pub(super) fn context_of_arg_at(
        &mut self,
        params: &[SigParam],
        i: usize,
        count: Option<usize>,
    ) -> Option<TypeId> {
        if let Some(rest) = self.non_array_rest_type(params) {
            let first = self.parameter_count(params) - 1;
            if i >= first {
                return Some(self.rest_argument_context(
                    rest,
                    i - first,
                    count.map(|n| n.saturating_sub(first)),
                ));
            }
        }
        self.param_type_at(params, i)
    }

    /// `ty`, which the type parameter `param` extends or defaults to, with what has been filled in around the signature `param`
    /// belongs to (`outer`) filled in. A clone (`cloneTypeParameter`) comes with that done.
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

    /// `checkTypeArguments`, without its errors: whether each of `type_args` is what the type parameter of `sig` it is given for
    /// extends. In doubt it is.
    fn do_type_arguments_fit(&mut self, sig: SigId, type_args: &[TypeId]) -> bool {
        let type_params = self.sig_type_params(sig);
        !matches!(
            self.failing_type_argument(sig, &type_params, type_args),
            Ok(Some(_))
        )
    }

    /// `getOptionalCallSignature`: what `sig` gives back to `call`. In an optional chain that may have stopped before the call,
    /// that has `undefined` in it.
    fn return_type_in_chain(&mut self, file: FileId, call: ExprId, sig: SigId) -> TypeId {
        let ret = self.sig_return(sig);
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return ret;
        };
        let data = &hir[c];
        let stops = match data.chain {
            Chain::No => false,
            Chain::Start => {
                let callee = self.type_of_expr(file, data.callee);
                self.some_type(callee, |k, m| k.is_nullish(m))
            }
            Chain::Continue => {
                let callee = self.type_of_expr(file, data.callee);
                self.is_in_optional_chain(file, data.callee) && self.contains_undefined(callee)
            }
        };
        if stops { self.optional(ret) } else { ret }
    }

    /// `getThisArgumentType`: what the method is found in, once the chain has got that far. `void` if it is found in nothing.
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
            // A clone has one if the declared one does. Nothing is asked to fill in one that mentions no type parameter or is one.
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

    /// `isGenericFunctionReturningFunction`, of some signature of what the call `e` calls, if `e` is a call without type arguments.
    pub(super) fn is_call_of_generic_function_returning_function(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[e].kind else {
            return false;
        };
        let data = &hir[c];
        if !data.type_args.is_empty() || matches!(hir[data.callee].kind, ExprKind::Super) {
            return false;
        }
        let mut callee = self.type_of_expr(file, data.callee);
        if data.chain != Chain::No || self.is_in_optional_chain(file, data.callee) {
            callee = self.non_nullable(callee);
        }
        let callee = self.non_null_type(callee);
        if self.is_any(callee) {
            return false;
        }
        for sig in self.signatures(callee, false) {
            if self.sig_type_params(sig).is_empty() {
                continue;
            }
            // `isFunctionType`: an object type with something to call, whatever else it has.
            let ret = self.sig_return(sig);
            if self.is_object_type(ret) && !self.signatures(ret, false).is_empty() {
                return true;
            }
        }
        false
    }

    /// `checkExpressionWithContextualType`: `pushContextualType`, `pushInferenceContext`, `checkExpression`, which is not memoised, and
    /// the two pops. What tsgo keeps of what is in `e` is kept: `resolvedSignature`, `NodeCheckFlagsContextChecked`.
    /// `inference_context` is lent to `inference_contexts` for as long as the check lasts.
    pub(super) fn check_expression_with_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
    ) -> TypeId {
        self.contextual.push((file, e, contextual_type));
        let ty = self.check_with_inference_context(
            file,
            e,
            contextual_type,
            inference_context,
            check_mode,
            |c, check_mode| c.check_expression_ex(file, e, check_mode),
        );
        self.contextual.pop();
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
        let context = inference_context
            .as_deref_mut()
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
        let mode_outside = std::mem::replace(&mut self.mode_of_recheck, check_mode);
        // What is found under one pushed type is not what is found under another, or under none.
        let found_outside = (
            std::mem::take(&mut self.rechecked_exprs),
            std::mem::take(&mut self.rechecked_members),
        );
        let outer = self.begin_recheck();
        let ty = check(self, check_mode);
        self.end_recheck(outer);
        (self.rechecked_exprs, self.rechecked_members) = found_outside;
        self.mode_of_recheck = mode_outside;
        let instantiated =
            self.instantiate_contextual_type(contextual_type, file, e, ContextFlags::empty());
        let ty = if self.maybe_type_of_kind(ty, Self::is_literal)
            && self.is_literal_context(ty, instantiated)
        {
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

    /// `getSingleSignature`: the one call (or construct) signature of `ty`, if there is none of the other kind.
    /// Without `allow_members`, if that is all there is to it.
    pub(super) fn single_signature(
        &mut self,
        ty: TypeId,
        construct: bool,
        allow_members: bool,
    ) -> Option<SigId> {
        if !self.is_object_type(ty) {
            return None;
        }
        let members = self.members(ty)?;
        let shape = members.shape();
        let (own, other) = if construct {
            (&shape.construct, &shape.call)
        } else {
            (&shape.call, &shape.construct)
        };
        if own.len() != 1
            || !other.is_empty()
            || (!allow_members && !(shape.props.is_empty() && shape.index.is_empty()))
        {
            return None;
        }
        Some(self.instantiate_only_sig(ty, construct, own[0], members.mapper))
    }

    pub(super) fn single_call_signature(
        &mut self,
        ty: TypeId,
        allow_members: bool,
    ) -> Option<SigId> {
        self.single_signature(ty, false, allow_members)
    }

    /// `getSingleCallOrConstructSignature`, and whether it is one to construct with.
    pub(super) fn single_call_or_construct_signature(
        &mut self,
        ty: TypeId,
    ) -> Option<(SigId, bool)> {
        match self.single_signature(ty, false, false) {
            Some(sig) => Some((sig, false)),
            None => self
                .single_signature(ty, true, false)
                .map(|sig| (sig, true)),
        }
    }

    /// `getOrCreateTypeFromSignature`
    pub(super) fn type_of_signature(&self, sig: SigId, construct: bool) -> TypeId {
        self.synth(if construct {
            Shape {
                construct: vec![sig],
                ..Shape::default()
            }
        } else {
            Shape {
                call: vec![sig],
                ..Shape::default()
            }
        })
    }

    /// `instantiateSignatureInContextOf`. `with_result`: what `expected` returns says something too, though less than what it takes.
    pub(super) fn instantiate_sig_in_context(
        &mut self,
        sig: SigId,
        expected: SigId,
        with_result: bool,
    ) -> SigId {
        let mut inference = Inference::for_params(&self.sig_type_params(sig), Some(sig));
        inference.around_source = self
            .sig_decl(expected)
            .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
        // `applyToParameterTypes`
        let (sp, tp) = (self.sig_params(expected), self.sig_params(sig));
        let (source_count, target_count) = (self.parameter_count(&sp), self.parameter_count(&tp));
        let (source_rest, target_rest) =
            (self.effective_rest_type(&sp), self.effective_rest_type(&tp));
        let target_non_rest_count = if target_rest.is_some() {
            target_count - 1
        } else {
            target_count
        };
        let param_count = if source_rest.is_some() {
            target_non_rest_count
        } else {
            source_count.min(target_non_rest_count)
        };
        if let Some(source) = self.sig_this_type(expected)
            && let Some(target) = self.sig_this_type(sig)
        {
            self.infer(&mut inference, source, target, 0);
        }
        for i in 0..param_count {
            let (source, target) = (
                self.param_type_at(&sp, i).unwrap_or(TypeId::ANY),
                self.param_type_at(&tp, i).unwrap_or(TypeId::ANY),
            );
            self.infer(&mut inference, source, target, 0);
        }
        if let Some(target_rest) = target_rest {
            let rest = self.rest_type_at_position(&sp, param_count, false);
            self.infer(&mut inference, rest, target_rest, 0);
        }
        if with_result {
            // `applyToReturnTypes`: what a type guard tests for goes with what the other tests for.
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
        let mapper = self.inference_mapper(&inference);
        self.instantiate_sig(sig, mapper)
    }

    /// The name of the type parameter `param`: the name `unique_type_params` gave it, or else the declared name.
    pub fn type_param_name(&self, param: TypeId) -> Option<Atom> {
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        let declared = self.hir(file)[tp].name;
        if around == MapperId::IDENTITY {
            return Some(declared);
        }
        match self
            .p
            .types
            .map(around, self.string_literal(declared, true))
            .map(|renamed| self.data(renamed))
        {
            Some(&TypeData::StringLit { value, .. }) => Some(value),
            _ => Some(declared),
        }
    }

    /// `newTypeParameter(newSymbol(SymbolFlagsTypeParameter, name))`. There is no type parameter without a declaration: it is a clone
    /// of `param`, renamed as `unique_type_params` renames. `serial` tells it from the others that are made of `param`: an entry of
    /// the mapper like the one for the name.
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
        let mut pairs = self.p.types.mapping(around).to_vec();
        pairs.retain(|pair| pair.0 != declared);
        pairs.push((declared, self.string_literal(name, false)));
        let serial = self.number_literal(serial as f64, true);
        pairs.push((serial, serial));
        Some(self.cloned_type_param(file, tp, self.p.types.mapper(pairs)))
    }

    /// `getUniqueTypeParameters`: `own`, with a renamed clone for each type parameter whose name occurs in `inferred` or earlier in
    /// `own`. The mapper of a renamed clone (`cloneTypeParameter`) maps the fresh string literal type of the declared name to the string
    /// literal type of the new name. Instantiation only looks up type parameters, so that entry never reaches a type.
    /// `clone_mapper` resolves the siblings of a clone with the mapper of the clone, so if a type parameter is renamed, its siblings
    /// (those of the same function with the same mapper) are cloned with the same mapper, and those that keep their name only
    /// change identity.
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
            let text = self.files().atoms.bytes(name);
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
                let augmented = self.files().atoms.intern(&augmented);
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
        // The entries are keyed by declared name, so only siblings share them. Only the type parameters of a function know their
        // siblings (`clone_mapper`).
        let mut sibling_sets: Vec<(FileId, crate::bind::ScopeId, MapperId)> =
            Vec::with_capacity(own.len());
        for &param in own {
            let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
                return None;
            };
            let scope = self.bound(file).type_param_scope[tp.idx()];
            if scope.is_none()
                || !matches!(
                    self.bound(file).scopes[scope.idx()].kind,
                    crate::bind::ScopeKind::Fn(_)
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
            if renames_of_siblings.is_empty() {
                unique.push(param);
                continue;
            }
            let mut pairs = self.p.types.mapping(around).to_vec();
            pairs.retain(|pair| !renames_of_siblings.iter().any(|rename| rename.0 == pair.0));
            pairs.extend(renames_of_siblings.iter().copied());
            unique.push(self.cloned_type_param(file, tp, self.p.types.mapper(pairs)));
        }
        Some(unique)
    }

    /// `node.Type() == nil && !HasContextSensitiveParameters(node)`, the condition for `returnOnlyType` in
    /// `checkFunctionExpressionOrObjectLiteralMethod`.
    pub(super) fn is_return_only_function(&self, file: FileId, f: FnId) -> bool {
        let hir = self.hir(file);
        let func = &hir[f];
        func.ret.is_none()
            && func.type_params.is_empty()
            && !func.params.iter().any(|p| hir[p].ty.is_none())
            // A function that is not an arrow function has an implicit `this` parameter if it uses `this`.
            && (func.kind == FnKind::Arrow || func.this_ty(hir).is_some() || !self.bound(file).fns[f.idx()].contains_this)
    }

    /// `instantiateInstantiableTypes`: what waits for type parameters, be it in a union or an intersection. Object types stay.
    pub(super) fn instantiate_instantiable_types(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
    ) -> TypeId {
        if self.is_deferred(ty) {
            return self.instantiate(ty, mapper);
        }
        match self.data(ty) {
            TypeData::Union(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.instantiate_instantiable_types(part, mapper))
                    .collect();
                self.union_unreduced(&parts)
            }
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.instantiate_instantiable_types(part, mapper))
                    .collect();
                self.intersection(&parts)
            }
            _ => ty,
        }
    }

    /// `inferFromAnnotatedParametersAndReturn`: what the types `func` writes for its parameters, as far as a rest parameter, and
    /// for what it returns say about the type parameters in `contextual`, the signature expected of it.
    pub(super) fn infer_from_annotated_parameters_and_return(
        &mut self,
        file: FileId,
        func: FnId,
        contextual: SigId,
        inference: &mut Inference,
    ) {
        let hir = self.hir(file);
        let expected = self.sig_params(contextual);
        let own = hir[func]
            .params
            .iter()
            .filter(|&p| !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this)));
        for (i, p) in own.enumerate() {
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
            // `anySignature`: anything is expected.
            return Some(TypeId::ANY);
        }
        let pulls = self.pulls_contextual_types();
        // A function called where it is written expects nothing where it does not say: it takes what it is given
        // (`getContextuallyTypedParameterType` checks the argument under `anySignature`). Once the call is resolved the parameter has
        // that type, and it is expected like any other.
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
            ExprKind::TaggedTemplate(id) => (id, 1),
            _ => return None,
        };
        let mut index = hir.ids(hir[id].args).position(|a| a == arg)?;
        let mut count = hir[id].args.len();
        // `getEffectiveCallArguments`: a tuple that is spread counts for what is in it, anything else for one.
        if hir
            .ids(hir[id].args)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            let effective = self.effective_args(file, hir[id].args);
            count = effective.len();
            if hir
                .ids(hir[id].args)
                .take(index)
                .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
            {
                index = effective
                    .iter()
                    .position(|a| matches!(a, Arg::Expr(e) if *e == arg))?;
            }
        }
        let (index, count) = (index + offset, count + offset);
        // `resolvingSignature`, by this checker. FOR SPEED the stack is not gone through for a call that is kept and that this checker
        // has had resolved: it is not entered again.
        let is_cached = self.p.calls.get(&(file, call)).is_some()
            && self.resolved_signatures.contains(&(file, call));
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
        // `resolveUntypedCall`, `resolveErrorCall`: what anything comes of has no parameters.
        let Some(sig) = resolved.sig else {
            return (self.has_any_flag(resolved.ret)).then_some(TypeId::ANY);
        };
        let params = self.sig_params(sig);
        // `getTypeAtPosition`: where there is no parameter anything is expected.
        let param = self
            .context_of_arg_at(&params, index, Some(count))
            .unwrap_or(TypeId::ANY);
        Some(self.without_no_infer(param))
    }
}
