//! Calls: which signature is meant, what its type parameters are, what comes back.

use super::errors_call::Applicable;
use super::infer::{Inference, PRIORITY_PARTIAL_HOMOMORPHIC, PRIORITY_RETURN};
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent, UNREACHABLE};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCall {
    /// The signature that was picked, with its type parameters filled in.
    pub sig: Option<SigId>,
    pub ret: TypeId,
}

#[derive(Copy, Clone)]
pub(super) enum Arg {
    Expr(ExprId),
    /// An element of a tuple that was spread.
    Type(TypeId),
    /// `...list`: any number of the first. The second is the list that is spread.
    Spread(TypeId, TypeId),
}

/// A call whose signature is being picked, and the one under consideration.
pub(super) struct Resolving {
    pub file: FileId,
    /// `NONE`: the attributes of a JSX element, which nothing is looked up in this for.
    pub call: ExprId,
    /// The signature under consideration, as it is before its type parameters are filled in.
    pub sig: Option<SigId>,
    pub params: Vec<SigParam>,
    /// Its type parameters, as far as the arguments looked at so far say; `Unresolved` for those nothing is known of yet.
    pub so_far: MapperId,
    /// `returnMapper`: what is expected of its result says about its type parameters.
    pub return_mapper: MapperId,
    /// `outerReturnMapper`: every one of its type parameters, going by `return_mapper`, or else by what the arguments looked at
    /// so far come to.
    pub outer_return_mapper: MapperId,
    /// A call among the arguments has gone by `outer_return_mapper`: it is made once, and stays as it was then.
    pub is_outer_return_mapper_taken: bool,
    /// The signature is only tried. It may be dropped, so what goes by what it expects of an argument is not kept.
    pub is_trial: bool,
    /// An argument, or a part of one, is being looked at to infer from (`CheckModeInferential`).
    pub is_inferential: bool,
    /// The type parameters that the generic functions inside that argument went by when they were instantiated, and what they were
    /// taken to be. They are settled by that (`context.mapper`).
    pub settles: Vec<(TypeId, TypeId)>,
    /// The generic functions inside the array and object literal arguments that `instantiateTypeWithSingleGenericCallSignature`
    /// applies to, in source order.
    pub nested_generic_functions: Vec<NestedGenericFunction>,
    /// `inferredTypeParameters`, while the second round of `inferTypeArguments` checks an argument with such a function in it.
    pub inferred_type_params: Vec<TypeId>,
}

/// A generic function inside an array or object literal argument whose contextual type has a single signature of the same kind
/// without type parameters.
#[derive(Copy, Clone)]
pub(super) struct NestedGenericFunction {
    arg_index: usize,
    expr: ExprId,
    sig: SigId,
    is_construct: bool,
    /// The contextual type of `expr`.
    contextual: TypeId,
    /// `None`: the function is skipped (`CheckModeSkipGenericFunctions`, `anyFunctionType`). `Some`: its type in the second round.
    instantiated: Option<TypeId>,
}

impl Resolving {
    fn new(
        file: FileId,
        call: ExprId,
        sig: Option<SigId>,
        params: Vec<SigParam>,
        return_mapper: MapperId,
    ) -> Resolving {
        Resolving {
            file,
            call,
            sig,
            params,
            so_far: MapperId::IDENTITY,
            return_mapper,
            outer_return_mapper: MapperId::IDENTITY,
            is_outer_return_mapper_taken: false,
            is_trial: false,
            is_inferential: false,
            settles: Vec::new(),
            nested_generic_functions: Vec::new(),
            inferred_type_params: Vec::new(),
        }
    }

    /// For `candidate`, which is held against the arguments to see whether it will do. `params`: what it takes as far as is known.
    fn trial(file: FileId, call: ExprId, candidate: SigId, params: Vec<SigParam>) -> Resolving {
        Resolving {
            is_trial: true,
            ..Resolving::new(file, call, Some(candidate), params, MapperId::IDENTITY)
        }
    }
}

/// The state of `NodeCheckFlagsContextChecked` for a function expression in an argument of an overloaded call, as stored in
/// `Checker::context_checked_for`.
#[derive(Copy, Clone)]
enum ContextChecked {
    /// No attempt has checked the function (no entry).
    No,
    /// The attempt on this candidate was the first to check the function. The attempt is in progress or was accepted.
    By(SigId),
    /// The attempt that checked the function has ended. Every later attempt has a new inference context (`None`).
    ByEndedAttempt,
}

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
                            && func.this_ty.is_none()
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

    /// Whether what is expected of `e` can change its type at all.
    fn depends_on_context(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Jsx(_) => true,
            ExprKind::Cond { yes, no, .. } => {
                self.depends_on_context(file, yes) || self.depends_on_context(file, no)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma,
                left,
                right,
            } => self.depends_on_context(file, left) || self.depends_on_context(file, right),
            ExprKind::Spread(x)
            | ExprKind::NonNull(x)
            | ExprKind::Await(x)
            | ExprKind::Satisfies { expr: x, .. } => self.depends_on_context(file, x),
            _ => false,
        }
    }

    pub fn resolve_call(&mut self, file: FileId, call: ExprId) -> ResolvedCall {
        if let Some(known) = self.p.calls.get(&(file, call)) {
            return known;
        }
        // `resolvingSignature`
        let is_under_way = self.stack.contains(&Query::Call(file, call));
        if is_under_way && self.asking_for_context {
            self.enter(Query::Call(file, call));
            return ResolvedCall {
                sig: None,
                ret: TypeId::UNRESOLVED,
            };
        }
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
        let asking = std::mem::replace(&mut self.asking_for_context, false);
        // A call that is resolved settles what its own arguments are expected to be, whatever is gone over again around it.
        let keeps = std::mem::replace(&mut self.keeps_arg_contexts, false);
        let resolved = self.resolve_call_uncached(file, call);
        let failure = self.pending_failure_sig.take();
        self.keeps_arg_contexts = keeps;
        self.asking_for_context = asking;
        self.resolution_start = resolution_start;
        if self.leave() && !is_under_way {
            self.p.calls.insert((file, call), resolved);
            // `ShardedMap::insert` keeps the first value, so the entry is only stored together with a resolution that is kept.
            if let Some(failure) = failure {
                self.p.failure_sigs.insert((file, call), failure);
            }
        }
        resolved
    }

    fn effective_args(&mut self, file: FileId, args: IdList<ExprId>) -> Vec<Arg> {
        let mut out = Vec::with_capacity(args.len());
        for a in self.hir(file).ids(args) {
            self.push_effective_arg(file, a, &mut out);
        }
        out
    }

    /// What the argument `a` comes to: itself, or what it spreads.
    pub(super) fn push_effective_arg(&mut self, file: FileId, a: ExprId, out: &mut Vec<Arg>) {
        let ExprKind::Spread(inner) = self.hir(file)[a].kind else {
            out.push(Arg::Expr(a));
            return;
        };
        let ty = self.type_of_expr(file, inner);
        match self.data(ty) {
            // `getEffectiveCallArguments`: a `...T` in it is a spread of `T`, a `...X[]` one of `X[]`.
            TypeData::Tuple { elems, flags, .. } => {
                for (&e, f) in elems.iter().zip(flags.iter()) {
                    if f.contains(ElemFlags::VARIADIC) {
                        let element = self.indexed_access(e, TypeId::NUMBER);
                        out.push(Arg::Spread(element, e));
                    } else if f.contains(ElemFlags::REST) {
                        let list = self.array_of(e);
                        out.push(Arg::Spread(e, list));
                    } else {
                        out.push(Arg::Type(e));
                    }
                }
            }
            _ => {
                // `checkIteratedTypeOrElementType`: what cannot be gone through is an error, and gives `any`. That is not said of what
                // the operand is only taken to be.
                let element = match self.iterated_type_if_any(ty, false) {
                    Some(element) => element,
                    None if self.is_known(ty) && !self.is_uncertain(file, inner) => TypeId::ANY,
                    None => TypeId::UNRESOLVED,
                };
                out.push(Arg::Spread(element, ty));
            }
        }
    }

    /// `ty` if it is an array, or the array it extends: `Array<string>` for `RegExpMatchArray`.
    fn array_it_extends(&mut self, ty: TypeId, depth: u32) -> Option<TypeId> {
        if self.is_array(ty) {
            return Some(ty);
        }
        let TypeData::Ref { target, args } = self.data(ty).clone() else {
            return None;
        };
        if depth > 8 {
            return None;
        }
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
                &[],
                MapperId::IDENTITY,
            ));
        }
        match args.get(index) {
            Some(&Arg::Expr(a)) => {
                let ty = self.type_of_expr(file, a);
                Some(self.widen_literal(ty))
            }
            Some(&(Arg::Type(ty) | Arg::Spread(ty, _))) => Some(ty),
            None if own.default.is_some() => None,
            // `undefinedWideningType`
            None => Some(TypeId::UNDEFINED),
        }
    }

    /// `hasCorrectArity`, of a call that is complete.
    pub(super) fn has_correct_arity(&mut self, params: &[SigParam], args: &[Arg]) -> bool {
        self.has_correct_arity_of_call(params, args, false)
    }

    /// `callIsIncomplete`: the tagged template is unterminated, or the `)` of the call is missing. `close_pos` is where the parser
    /// expected the `)`. The default library has no text.
    fn is_call_incomplete(&self, file: FileId, call: ExprId, id: CallId) -> bool {
        let hir = self.hir(file);
        let close_pos = hir[id].close_pos;
        if matches!(hir[call].kind, ExprKind::TaggedTemplate(_)) {
            return close_pos == INCOMPLETE_TEMPLATE;
        }
        close_pos != u32::MAX
            && !hir.text.is_empty()
            && hir.text.get(close_pos as usize) != Some(&b')')
    }

    /// `hasCorrectArity`. The lower bound is not checked if `is_incomplete`.
    fn has_correct_arity_of_call(
        &mut self,
        params: &[SigParam],
        args: &[Arg],
        is_incomplete: bool,
    ) -> bool {
        let count = self.parameter_count(params);
        let least = self.min_argument_count(params);
        let has_rest = self.has_effective_rest_parameter(params);
        // What is spread comes after all that is required, and goes to a rest parameter or at least starts among the parameters.
        if let Some(spread) = args.iter().position(|a| matches!(a, Arg::Spread(..))) {
            return spread >= least && (has_rest || spread < count);
        }
        if args.len() > count && !has_rest {
            return false;
        }
        if is_incomplete {
            return true;
        }
        // `acceptsVoid`: only a parameter that takes `void` may be left out. Of one that is not known it cannot be told.
        for i in args.len()..least {
            let Some(ty) = self.param_type_at(params, i) else {
                return false;
            };
            if !self.some_type(ty, |_, m| m == TypeId::VOID || m == TypeId::UNRESOLVED) {
                return false;
            }
        }
        true
    }

    fn resolve_call_uncached(&mut self, file: FileId, call: ExprId) -> ResolvedCall {
        let hir = self.hir(file);
        // `resolveTaggedTemplateExpression`: a call with the pieces of text for a first argument.
        if let ExprKind::TaggedTemplate(c) = hir[call].kind {
            let Call {
                callee: tag,
                args: exprs,
                type_args,
                ..
            } = hir[c];
            let callee = self.type_of_expr(file, tag);
            if self.is_any(callee) {
                return ResolvedCall {
                    sig: None,
                    ret: callee,
                };
            }
            let sigs = self.signatures(callee, false);
            if sigs.is_empty() {
                // Nothing to call: an error, or an untyped call. Either way anything comes of it.
                return ResolvedCall {
                    sig: None,
                    ret: if self.is_known(callee) {
                        TypeId::ANY
                    } else {
                        TypeId::UNRESOLVED
                    },
                };
            }
            let type_args = self.types_from_nodes(file, type_args);
            let mut args = vec![Arg::Type(self.global_ref(known::TemplateStringsArray, &[]))];
            args.extend(hir.ids(exprs).map(Arg::Expr));
            let this_arg = self.this_argument_of_call(file, tag).map(|(obj, _)| obj);
            let is_sure = !self.is_uncertain(file, tag);
            return self.resolve_among(
                file, call, c, &sigs, &type_args, &args, this_arg, false, is_sure, true,
            );
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

    /// `resolveCallExpression`, of `super(..)`: what is called is one of the constructors of what the class extends, with the type
    /// arguments given there.
    fn resolve_super_call(&mut self, file: FileId, call: ExprId, id: CallId) -> ResolvedCall {
        let nothing = ResolvedCall {
            sig: None,
            ret: TypeId::VOID,
        };
        let Some(&class) = self
            .classes_around(file, self.bound(file).expr_parent[call.idx()])
            .first()
        else {
            return nothing;
        };
        let class = self
            .files()
            .sym(file, self.bound(file).class_symbol[class.idx()]);
        let sigs = self.super_constructor_sigs(class);
        if sigs.is_empty() {
            return nothing;
        }
        let args = self.effective_args(file, self.hir(file)[id].args);
        self.resolve_among(file, call, id, &sigs, &[], &args, None, false, true, true)
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
        callee = self.receiver_that_is_there(callee);
        if self.is_any(callee) {
            return ResolvedCall {
                sig: None,
                ret: callee,
            };
        }
        let mut sigs = self.signatures(callee, is_new);
        // What may not be constructed from here is in error, and anything comes of it.
        if is_new
            && !sigs.is_empty()
            && (self
                .why_constructor_not_accessible(file, call, sigs[0])
                .is_some()
                || self.has_abstract_construct_signature(callee))
        {
            return ResolvedCall {
                sig: None,
                ret: TypeId::ANY,
            };
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
            let all_arrays = self.is_union(receiver)
                && self.parts(receiver).to_vec().into_iter().all(|part| {
                    match self.data(part).clone() {
                        TypeData::Tuple {
                            elems,
                            flags,
                            readonly: r,
                        } => {
                            readonly |= r;
                            elements.push(self.tuple_element_union(&elems, &flags));
                            true
                        }
                        _ => match self.array_it_extends(part, 0) {
                            Some(array) => {
                                readonly |=
                                    self.is_global_ref(array, known::ReadonlyArray).is_some();
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
            // Nothing to call or construct: an error, or an untyped call. Either way anything comes of it.
            return ResolvedCall {
                sig: None,
                ret: if self.is_known(callee) {
                    TypeId::ANY
                } else {
                    TypeId::UNRESOLVED
                },
            };
        }
        let type_args = self.types_from_nodes(file, data.type_args);
        let args = self.effective_args(file, data.args);
        let this_arg = if is_new {
            None
        } else {
            self.this_argument_of_call(file, data.callee)
                .map(|(obj, _)| obj)
        };
        let is_sure = !self.is_uncertain(file, data.callee);
        // `resolveNewExpression` reads the return type of a call signature invoked with `new` only without `noImplicitAny` (2350).
        let wants_return = !(is_call_by_new && self.p.files.options.no_implicit_any);
        let resolved = self.resolve_among(
            file,
            call,
            id,
            &sigs,
            &type_args,
            &args,
            this_arg,
            is_new,
            is_sure,
            wants_return,
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
        let callee = self.type_of_expr(file, self.hir(file)[c].callee);
        let callee = self.receiver_that_is_there(callee);
        let only = self.single_signature(callee, true, true)?;
        if !self.sig_type_params(only).is_empty() {
            return None;
        }
        Some(self.sig_return(only))
    }

    /// The end of `resolveCall`: which of `declared`, the signatures of what is called, the call, `new` or tagged template `call`
    /// is a call of. `is_sure`: what is called was found out for sure, so that it can be told when none of them will do.
    /// `wants_return`: the caller reads `ret`. Otherwise `ret` is `any` and the return type of the signature is not resolved:
    /// `checkCallExpression` returns `anyType` for `new` of a call signature before it calls `getReturnTypeOfSignature`.
    fn resolve_among(
        &mut self,
        file: FileId,
        call: ExprId,
        id: CallId,
        declared: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        is_new: bool,
        is_sure: bool,
        wants_return: bool,
    ) -> ResolvedCall {
        let return_of = |c: &mut Self, sig: SigId| {
            if wants_return {
                c.sig_return(sig)
            } else {
                TypeId::ANY
            }
        };
        let sigs = self.reorder_candidates(declared);
        // No attempt of this resolution has checked an argument yet. Only overloaded calls record which attempt did.
        if sigs.len() > 1 {
            for &arg in args {
                if let Arg::Expr(e) = arg {
                    self.set_context_checked(file, e, ContextChecked::No);
                }
            }
        }
        let is_incomplete = self.is_call_incomplete(file, call, id);
        let mut candidates: Vec<SigId> = Vec::new();
        for &sig in &sigs {
            let type_params = self.sig_type_params(sig);
            if !self.has_correct_type_argument_arity(&type_params, type_args.len()) {
                continue;
            }
            let params = self.sig_params(sig);
            if self.has_correct_arity_of_call(&params, args, is_incomplete) {
                candidates.push(sig);
            }
        }
        if candidates.is_empty() {
            let sig = self.candidate_for_overload_failure(
                file, call, &sigs, type_args, args, this_arg, false,
            );
            let ret = return_of(self, sig);
            return ResolvedCall {
                sig: Some(sig),
                ret,
            };
        }
        // Where one is left there is nothing to choose, and nothing has been held against it.
        let chosen = match candidates[..] {
            [only] => Some(only),
            _ => self.choose_overload(file, call, &candidates, type_args, args, this_arg),
        };
        // Where what does not wait rules them all out, `chooseOverload` never gets to look at the functions among the arguments.
        if chosen.is_none() && is_sure && !self.is_provisional_here() {
            let (ruled_out, is_certain) = self.with_certainty(|c| {
                c.ruled_out_by_plain_arguments(file, call, &candidates, type_args, args, this_arg)
            });
            if let Some(last) = ruled_out
                && is_certain
            {
                if let Some(last) = last
                    && self.look_at_arguments_as_of(file, call, args, last) < args.len()
                {
                    // No candidate passed the first round, so `argCheckMode` is still `CheckModeSkipContextSensitive`.
                    self.add_implementation_success_elaboration(
                        file, call, last, type_args, args, this_arg, true,
                    );
                }
                let sig = self.candidate_for_overload_failure(
                    file, call, &sigs, type_args, args, this_arg, false,
                );
                let ret = return_of(self, sig);
                return ResolvedCall {
                    sig: Some(sig),
                    ret,
                };
            }
        }
        if let [only] = candidates[..]
            && is_sure
            && !self.is_provisional_here()
        {
            self.check_sole_candidate_in_order(
                file,
                call,
                only,
                sigs.len() == 1,
                type_args,
                args,
                this_arg,
            );
        }
        let is_tested = candidates.len() > 1 && chosen.is_some();
        let first = chosen.unwrap_or(candidates[0]);
        let sig = self.instantiate_for_call(file, call, first, type_args, args, this_arg, false);
        let ret = return_of(self, sig);
        let resolved = ResolvedCall {
            sig: Some(sig),
            ret,
        };
        // For a single signature, `getCandidateForOverloadFailure` returns a different signature only if the type arguments are
        // inferred. The return type and the contextual types of the arguments can both depend on them.
        let is_inferred = type_args.is_empty() && !self.sig_type_params(first).is_empty();
        let can_differ = sigs.len() > 1 || is_inferred;
        if !can_differ || !is_sure || self.is_provisional_here() {
            return resolved;
        }
        // What is left is the round of `chooseOverload` in which no argument is left out.
        let has_sensitive = args
            .iter()
            .any(|a| matches!(a, Arg::Expr(e) if self.is_context_sensitive(file, *e)));
        let waits = has_sensitive || is_inferred && self.has_generic_function_argument(file, args);
        if !waits && (sigs.len() == 1 || is_tested) {
            return resolved;
        }
        // While the call is under way its arguments go by what it has been taken for.
        let params = self.sig_params(sig);
        self.resolving.push(Resolving::new(
            file,
            call,
            Some(first),
            params,
            MapperId::IDENTITY,
        ));
        let has_later_attempts =
            sigs.len() > 1 && type_args.is_empty() && has_sensitive && chosen.is_some();
        let ((accepted, fails), is_certain) = self.with_certainty(|c| {
            let accepted = if has_later_attempts {
                c.later_attempts(file, call, &candidates, first, sig, args, this_arg)
            } else {
                None
            };
            let fails = accepted.is_none() && {
                // `chooseOverload` repeats the arity check after instantiating a candidate with a generic rest parameter, and rejects the
                // candidate before `isSignatureApplicable`.
                let (declared_params, instantiated_params) =
                    (c.sig_params(first), c.sig_params(sig));
                let has_wrong_arity = c.non_array_rest_type(&declared_params).is_some()
                    && !c.has_correct_arity(&instantiated_params, args);
                let with_nodes = c.args_with_nodes(file, call, id);
                (has_wrong_arity
                    || c.is_signature_applicable(
                        file,
                        call,
                        id,
                        &with_nodes,
                        sig,
                        this_arg,
                        is_new,
                        None,
                    ) == Applicable::No)
                    && c.no_candidate_applies(file, call, id, declared, is_new, resolved)
            };
            (accepted, fails)
        });
        self.resolving.pop();
        if !is_certain {
            return resolved;
        }
        if let Some(sig) = accepted {
            let ret = return_of(self, sig);
            return ResolvedCall {
                sig: Some(sig),
                ret,
            };
        }
        if !fails {
            return resolved;
        }
        let failure =
            self.candidate_for_overload_failure(file, call, &sigs, type_args, args, this_arg, true);
        let ret = return_of(self, failure);
        // The errors of a call of the only signature there is are told against `sig`: that stays what all the arguments come to.
        // `resolve_call` stores `failure` in `failure_sigs` if it keeps the resolution.
        if sigs.len() == 1 {
            self.pending_failure_sig = Some(failure);
        }
        ResolvedCall {
            sig: Some(if sigs.len() == 1 { sig } else { failure }),
            ret,
        }
    }

    /// What `ask` answers, and whether that rests on nothing that went unanswered. Nothing is made of an answer that does.
    fn with_certainty<T>(&mut self, ask: impl FnOnce(&mut Self) -> T) -> (T, bool) {
        let cycles_before = self.cycles;
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let answer = ask(self);
        let is_certain =
            self.cycles == cycles_before && !self.relation_gave_up && !self.timed_out();
        self.relation_gave_up |= gave_up_before;
        (answer, is_certain)
    }

    /// `chooseOverload` for as long as the arguments that wait are left out (`CheckModeSkipContextSensitive`): whether the others
    /// rule out every one of `candidates`, and then the last of `candidatesForArgumentError`, if there is any. `None`: they
    /// do not, or it cannot be told.
    fn ruled_out_by_plain_arguments(
        &mut self,
        file: FileId,
        call: ExprId,
        candidates: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
    ) -> Option<Option<SigId>> {
        // A generic function may be left out as well.
        if args.iter().any(|a| matches!(a, Arg::Spread(..)))
            || type_args.is_empty() && self.has_generic_function_argument(file, args)
        {
            return None;
        }
        let mut last = None;
        for &candidate in candidates {
            if !type_args.is_empty() && !self.do_type_arguments_fit(candidate, type_args) {
                continue;
            }
            let sig =
                self.instantiate_for_call(file, call, candidate, type_args, args, this_arg, true);
            let params = self.sig_params(sig);
            let declared = self.sig_params(candidate);
            if self.non_array_rest_type(&declared).is_some() {
                // With `...args: T`, how many it takes is only known now.
                if !self.has_correct_arity(&params, args) {
                    continue;
                }
                // What goes into it is held against it all together, which is left to `is_signature_applicable`.
                return None;
            }
            self.resolving
                .push(Resolving::trial(file, call, candidate, params.clone()));
            let fits = self.are_arguments_related(file, args, &params, false, true);
            self.resolving.pop();
            if fits != Some(false) {
                return None;
            }
            last = Some(sig);
        }
        Some(last)
    }

    /// `reportCallResolutionErrors` holds the arguments against `last`, the last candidate they do not fit, one by one until it
    /// comes to one that does not fit. The functions it gets to on the way take the types of their parameters from it.
    /// Returns the number of arguments that were checked. Returns `args.len()` if `last` has a `this` type or the mismatch rests on an
    /// unknown type: the caller then treats every argument as checked.
    fn look_at_arguments_as_of(
        &mut self,
        file: FileId,
        call: ExprId,
        args: &[Arg],
        last: SigId,
    ) -> usize {
        // What it is called on comes first. Whether that fits is left open, and nothing is looked at.
        if self.sig_this_type(last).is_some() {
            return args.len();
        }
        let params = self.sig_params(last);
        let arg_count = if self.non_array_rest_type(&params).is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        self.resolving.push(Resolving::new(
            file,
            call,
            None,
            params.clone(),
            MapperId::IDENTITY,
        ));
        let mut checked = args.len();
        for (i, &arg) in args.iter().enumerate() {
            if matches!(arg, Arg::Expr(e) if matches!(self.hir(file)[e].kind, ExprKind::Missing)) {
                continue;
            }
            let Some(param) = self.context_of_arg_at(&params, i, Some(args.len())) else {
                break;
            };
            if let Arg::Expr(e) = arg
                && self.is_context_sensitive(file, e)
            {
                self.set_context(file, e, param);
            }
            let ty = self.arg_type(file, arg);
            // `getSpreadArgumentType`: what a rest parameter that is no plain array collects is all looked at before any of it is
            // held against anything.
            if i < arg_count && !self.is_assignable(ty, param) {
                // A mismatch that rests on an unknown type says nothing about the arguments after it.
                let is_reliable = self.is_known(ty)
                    && self.is_known(param)
                    && !matches!(arg, Arg::Expr(e) if self.is_uncertain(file, e));
                if is_reliable {
                    checked = i + 1;
                }
                break;
            }
        }
        self.resolving.pop();
        checked
    }

    /// `chooseOverload` and `reportCallResolutionErrors` for `candidate`, the only signature with the right arity, when its symbol also
    /// declares an implementation. A context sensitive argument takes its parameter types from the first signature it is checked
    /// against (`NodeCheckFlagsContextChecked`). `isSignatureApplicable` checks the arguments from left to right and stops at the
    /// first mismatch, so `addImplementationSuccessElaboration` is the first to check the arguments after the mismatch.
    /// `is_only_signature`: the callee has no other signature. Does nothing unless the order of the checks can be determined before
    /// any contextual type is assigned: no argument is spread, and every argument is either context sensitive or independent of
    /// its contextual type.
    fn check_sole_candidate_in_order(
        &mut self,
        file: FileId,
        call: ExprId,
        candidate: SigId,
        is_only_signature: bool,
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
    ) {
        let declared = self.sig_params(candidate);
        let is_generic = !self.sig_type_params(candidate).is_empty();
        let is_inferred = is_generic && type_args.is_empty();
        let mut last_sensitive = None;
        // `inferTypeArguments` checks an argument only if `couldContainTypeVariables(paramType)`.
        let mut is_checked_by_inference = false;
        for (i, &arg) in args.iter().enumerate() {
            let e = match arg {
                Arg::Expr(e) => e,
                Arg::Type(_) => continue,
                Arg::Spread(..) => return,
            };
            if !self.is_context_sensitive(file, e) {
                if self.depends_on_context(file, e) {
                    return;
                }
                continue;
            }
            let Some(param) = self.context_of_arg_at(&declared, i, Some(args.len())) else {
                return;
            };
            is_checked_by_inference |=
                is_inferred && self.could_contain_type_variables_at(candidate, i, param);
            last_sensitive = Some(i);
        }
        // The first argument is always checked against `candidate`.
        if last_sensitive.is_none_or(|i| i == 0)
            || self.non_array_rest_type(&declared).is_some()
            || self.implementation_signature(candidate).is_none()
            || !type_args.is_empty() && !self.do_type_arguments_fit(candidate, type_args)
            || is_inferred && self.has_generic_function_argument(file, args)
        {
            return;
        }
        let first_round =
            self.instantiate_for_call(file, call, candidate, type_args, args, this_arg, true);
        // `isSingleNonGenericCandidate`: `argCheckMode` is `CheckModeNormal` from the start, and there is no first round.
        let mut is_rejected_in_first_round = false;
        if is_generic || !is_only_signature {
            let params = self.sig_params(first_round);
            self.resolving
                .push(Resolving::trial(file, call, candidate, params.clone()));
            let is_applicable = self.are_arguments_related(file, args, &params, false, true);
            self.resolving.pop();
            let Some(is_applicable) = is_applicable else {
                return;
            };
            is_rejected_in_first_round = !is_applicable;
        }
        // The second round of inference assigns contextual types out of order.
        if is_checked_by_inference && !is_rejected_in_first_round {
            return;
        }
        // No context sensitive argument contributes to the inference, so the second round yields `first_round` again.
        let (checked, is_certain) =
            self.with_certainty(|c| c.look_at_arguments_as_of(file, call, args, first_round));
        if is_certain && checked < args.len() {
            self.add_implementation_success_elaboration(
                file,
                call,
                first_round,
                type_args,
                args,
                this_arg,
                is_rejected_in_first_round,
            );
        }
    }

    /// `couldContainTypeVariables(getTypeAtPosition(candidate, index))`, where `param` is that type. The test is coarser than
    /// `has_type_variables`: a function type or type literal written in place counts, a reference to a named type without type
    /// arguments does not (`isNonGenericTopLevelType`, classes, interfaces). Types do not record their alias, so the type node of the
    /// parameter decides. Returns true when in doubt.
    fn could_contain_type_variables_at(
        &mut self,
        candidate: SigId,
        index: usize,
        param: TypeId,
    ) -> bool {
        if self.has_type_variables(param) {
            return true;
        }
        if self.is_any(param)
            || param == TypeId::UNKNOWN
            || self.every_type(param, |c, t| c.is_primitive(t))
        {
            return false;
        }
        let Some((file, func, _)) = self.sig_decl(self.p.types.sig_origin(candidate)) else {
            return true;
        };
        let hir = self.hir(file);
        let Some(p) = hir[func]
            .params
            .iter()
            .filter(|&p| !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this)))
            .nth(index)
        else {
            return true;
        };
        hir[p].flags.contains(Flags::REST)
            || hir[p].ty.is_none()
            || !is_plain_type_reference(hir, hir[p].ty)
    }

    /// The signature of the first declaration with a body of the symbol that declares the overload `failed`, if the symbol has more
    /// than one declaration (`addImplementationSuccessElaboration`). Constructors are not supported: `sig_of_fn` does not give them
    /// the type parameters of the class.
    fn implementation_signature(&mut self, failed: SigId) -> Option<SigId> {
        let (file, func, _) = self.sig_decl(self.p.types.sig_origin(failed))?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_body =
            |f: &Func| !matches!(f.body, FnBody::None) || f.flags.contains(Flags::BODY_DROPPED);
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

    /// `addImplementationSuccessElaboration`: runs `chooseOverload` with the implementation behind the overload `failed` as the only
    /// candidate. The related information it adds is not modelled. The attempt matters because it is the first to check the context
    /// sensitive arguments that no earlier attempt reached, which then take their parameter types from the implementation.
    /// `skips_sensitive`: `argCheckMode` is still `CheckModeSkipContextSensitive`.
    fn add_implementation_success_elaboration(
        &mut self,
        file: FileId,
        call: ExprId,
        failed: SigId,
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        skips_sensitive: bool,
    ) {
        let has_unchecked_argument =
            args.iter().any(|&arg| matches!(arg, Arg::Expr(e) if self.is_context_sensitive(file, e) && self.explicit_context(file, e).is_none()));
        if !has_unchecked_argument {
            return;
        }
        let Some(implementation) = self.implementation_signature(failed) else {
            return;
        };
        let (type_params, declared) = (
            self.sig_type_params(implementation),
            self.sig_params(implementation),
        );
        if !self.has_correct_type_argument_arity(&type_params, type_args.len())
            || !self.has_correct_arity(&declared, args)
        {
            return;
        }
        // `isSingleNonGenericCandidate`: a single `isSignatureApplicable` under `CheckModeNormal`.
        if type_params.is_empty() {
            self.look_at_arguments_as_of(file, call, args, implementation);
            return;
        }
        // A generic rest parameter needs a second arity check and a check of the collected arguments, which are not modelled here.
        if self.non_array_rest_type(&declared).is_some()
            || !type_args.is_empty() && !self.do_type_arguments_fit(implementation, type_args)
        {
            return;
        }
        if skips_sensitive {
            let first_round = self.instantiate_for_call(
                file,
                call,
                implementation,
                type_args,
                args,
                this_arg,
                true,
            );
            let params = self.sig_params(first_round);
            self.resolving
                .push(Resolving::trial(file, call, implementation, params.clone()));
            let is_applicable = self.are_arguments_related(file, args, &params, false, true);
            self.resolving.pop();
            if is_applicable != Some(true) {
                return;
            }
        }
        if type_args.is_empty() {
            // The second round of `inferTypeArguments`. It assigns a contextual type to every remaining context sensitive argument,
            // also to those `isSignatureApplicable` would not reach.
            self.instantiate_for_call(file, call, implementation, type_args, args, this_arg, false);
        } else {
            let instantiated = self.instantiate_for_call(
                file,
                call,
                implementation,
                type_args,
                args,
                this_arg,
                true,
            );
            self.look_at_arguments_as_of(file, call, args, instantiated);
        }
    }

    /// The arguments of `call` the way `is_signature_applicable` takes them: each with the argument it is written as (part of),
    /// after the pieces of text if it is a tagged template.
    fn args_with_nodes(&mut self, file: FileId, call: ExprId, id: CallId) -> Vec<(Arg, ExprId)> {
        let hir = self.hir(file);
        let mut args = Vec::new();
        if matches!(hir[call].kind, ExprKind::TaggedTemplate(_)) {
            let strings = self.global_ref(known::TemplateStringsArray, &[]);
            args.push((Arg::Type(strings), call));
        }
        args.extend(self.effective_args_with_nodes(file, hir[id].args));
        args
    }

    /// Whether one of `args`, whatever it is written as, is a generic function, or something generic to construct: given where one
    /// that is not generic is expected, it waits for the other arguments (`CheckModeSkipGenericFunctions`). What is expected of
    /// the arguments has been said.
    fn has_generic_function_argument(&mut self, file: FileId, args: &[Arg]) -> bool {
        args.iter().any(
            |&arg| matches!(arg, Arg::Expr(e) if self.contains_generic_function(file, e, true)),
        )
    }

    /// Whether `e` has a single generic call or construct signature, or is an array or object literal with such an element or member.
    /// `checkExpressionEx` and `checkObjectLiteralMethod` call `instantiateTypeWithSingleGenericCallSignature` for every expression,
    /// not only for arguments. `is_argument`: `e` is an argument, so its contextual type is already assigned.
    fn contains_generic_function(&mut self, file: FileId, e: ExprId, is_argument: bool) -> bool {
        // A context sensitive expression may not have a contextual type yet, so its type is not requested.
        if e.is_none() || self.is_context_sensitive(file, e) {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Array(items) => hir
                .ids(items)
                .any(|item| self.contains_generic_function(file, item, false)),
            ExprKind::Object(props) => props.iter().any(|p| {
                matches!(
                    hir[p].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && self.contains_generic_function(file, hir[p].value, false)
            }),
            kind => {
                // Inside a literal, only expressions whose type does not depend on the contextual type are checked, and function
                // expressions that declare type parameters. Resolving a nested call here would repeat work at every level.
                let declares_type_params =
                    matches!(kind, ExprKind::Fn(f) if !hir[f].type_params.is_empty());
                if !is_argument && !declares_type_params && self.depends_on_context(file, e) {
                    return false;
                }
                let ty = self.type_of_expr(file, e);
                let found = match self.single_signature(ty, false, true) {
                    Some(sig) => Some(sig),
                    None => self.single_signature(ty, true, true),
                };
                found.is_some_and(|sig| !self.sig_type_params(sig).is_empty())
            }
        }
    }

    /// Whether each of `args` is a subtype of the one of `params` it is given for, or else can be assigned to it. `plain_only`:
    /// with those that wait for the others left out. `None`: it cannot be told.
    fn are_arguments_related(
        &mut self,
        file: FileId,
        args: &[Arg],
        params: &[SigParam],
        by_subtype: bool,
        plain_only: bool,
    ) -> Option<bool> {
        for (i, &arg) in args.iter().enumerate() {
            if let Arg::Expr(e) = arg
                && (matches!(self.hir(file)[e].kind, ExprKind::Missing)
                    || plain_only && self.is_context_sensitive(file, e))
            {
                continue;
            }
            let Some(param) = self.param_type_at(params, i) else {
                break;
            };
            let ty = self.arg_type(file, arg);
            if !self.is_known(ty)
                || !self.is_known(param)
                || matches!(arg, Arg::Expr(e) if self.is_uncertain(file, e))
            {
                return None;
            }
            // `getRegularTypeOfObjectLiteral`: properties there are too many of do not count before everything is looked at.
            let ty = if plain_only {
                self.regular_object(ty)
            } else {
                ty
            };
            if !(if by_subtype {
                self.is_subtype(ty, param)
            } else {
                self.is_assignable(ty, param)
            }) {
                return Some(false);
            }
        }
        Some(true)
    }

    /// `chooseOverload`, from the attempt on that gave the functions among the arguments their parameter types: `first`, which
    /// is what `chosen` was inferred to be then. They keep those types (`NodeCheckFlagsContextChecked`) and `argCheckMode` stays
    /// `CheckModeNormal`, so to the attempts that follow they are arguments like any other, and nothing is settled early on
    /// their account. `None`: no attempt is accepted, or it cannot be told.
    fn later_attempts(
        &mut self,
        file: FileId,
        call: ExprId,
        candidates: &[SigId],
        chosen: SigId,
        first: SigId,
        args: &[Arg],
        this_arg: Option<ExprId>,
    ) -> Option<SigId> {
        if args.iter().any(|a| matches!(a, Arg::Spread(..))) {
            return None;
        }
        // What it is called on, and what goes into `...args: T` all together, are left to `is_signature_applicable`.
        let params = self.sig_params(first);
        if self.sig_this_type(first).is_some() || self.non_array_rest_type(&params).is_some() {
            return None;
        }
        let at = candidates.iter().position(|&c| c == chosen)?;
        // That attempt was made in the round that goes by subtypes if what does not wait passed there.
        let by_subtype = self.are_arguments_related(file, args, &params, true, true)?;
        if self.are_arguments_related(file, args, &params, by_subtype, false)? {
            return Some(first);
        }
        // The first round of that attempt was applicable, so every argument has been checked. The attempts that follow have new
        // inference contexts, which get nothing from the annotations of a function that has been checked.
        for &arg in args {
            if let Arg::Expr(e) = arg {
                self.set_context_checked(file, e, ContextChecked::ByEndedAttempt);
            }
        }
        let mut attempts: Vec<(bool, SigId)> = candidates[at + 1..]
            .iter()
            .map(|&c| (by_subtype, c))
            .collect();
        if by_subtype {
            attempts.extend(candidates.iter().map(|&c| (false, c)));
        }
        for (by_subtype, candidate) in attempts {
            let outer = std::mem::replace(&mut self.keeps_arg_contexts, true);
            let sig = self.instantiate_for_call_as(
                file,
                call,
                candidate,
                &[],
                args,
                this_arg,
                false,
                true,
            );
            self.keeps_arg_contexts = outer;
            let params = self.sig_params(sig);
            if self.sig_this_type(sig).is_some() || self.non_array_rest_type(&params).is_some() {
                return None;
            }
            if self.are_arguments_related(file, args, &params, by_subtype, false)? {
                return Some(sig);
            }
        }
        None
    }

    /// `getCandidateForOverloadFailure`: what a call that none of `sigs` takes is taken for a call of. `sigs`: all the signatures,
    /// in the order they are tried in. `settled`: the arguments have been looked at, and what is expected of them stays.
    fn candidate_for_overload_failure(
        &mut self,
        file: FileId,
        call: ExprId,
        sigs: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        settled: bool,
    ) -> SigId {
        if sigs.len() == 1
            || sigs
                .iter()
                .any(|&sig| !self.sig_type_params(sig).is_empty())
        {
            self.pick_longest_candidate_signature(
                file, call, sigs, type_args, args, this_arg, settled,
            )
        } else {
            self.union_of_signatures_for_overload_failure(sigs)
        }
    }

    /// `pickLongestCandidateSignature`
    fn pick_longest_candidate_signature(
        &mut self,
        file: FileId,
        call: ExprId,
        sigs: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        settled: bool,
    ) -> SigId {
        // `getLongestCandidateIndex`: the first that takes as many arguments as there are, or else the one that takes most.
        let (mut best, mut most): (usize, Option<usize>) = (0, None);
        for (i, &sig) in sigs.iter().enumerate() {
            let params = self.sig_params(sig);
            let count = self.parameter_count(&params);
            if self.has_effective_rest_parameter(&params) || count >= args.len() {
                best = i;
                break;
            }
            if most.is_none_or(|most| count > most) {
                (best, most) = (i, Some(count));
            }
        }
        let candidate = sigs[best];
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
        // `inferSignatureInstantiationForOverloadFailure`: inferred anew, from the arguments that do not wait for the others.
        let keeps = settled || self.keeps_arg_contexts;
        let outer = std::mem::replace(&mut self.keeps_arg_contexts, keeps);
        let sig = self.instantiate_for_call(file, call, candidate, &[], args, this_arg, true);
        self.keeps_arg_contexts = outer;
        sig
    }

    /// `createUnionOfSignaturesForOverloadFailure`: it takes what any of `sigs` takes, and returns what all of them return.
    fn union_of_signatures_for_overload_failure(&mut self, sigs: &[SigId]) -> SigId {
        let lists: Vec<Vec<SigParam>> = sigs.iter().map(|&sig| self.sig_params(sig)).collect();
        // `getNonRestParameterCount`
        let plain =
            |list: &[SigParam]| list.len() - usize::from(list.last().is_some_and(|p| p.rest));
        let least = lists.iter().map(|list| plain(list)).min().unwrap_or(0);
        let most = lists.iter().map(|list| plain(list)).max().unwrap_or(0);
        let mut params = Vec::with_capacity(most + 1);
        for i in 0..most {
            let mut name = None;
            let mut types = Vec::new();
            for list in &lists {
                // The parameter at that place, or the rest parameter that stands for it.
                let named = if i < plain(list) {
                    list.get(i)
                } else {
                    list.last().filter(|p| p.rest)
                };
                name = name.or(named.map(|p| p.name));
                // `tryGetTypeAtPosition`
                if (i < self.parameter_count(list) || self.has_effective_rest_parameter(list))
                    && let Some(ty) = self.param_type_at(list, i)
                {
                    types.push(ty);
                }
            }
            let ty = self.union_reduced(&types);
            params.push(SigParam {
                name: name.unwrap_or(Atom::NONE),
                ty,
                optional: i >= least,
                rest: false,
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
        let ret = if returns.iter().all(|&ty| self.is_known(ty)) {
            self.intersection(&returns)
        } else {
            TypeId::UNRESOLVED
        };
        // It is declared where the first of them is.
        self.p.types.intern_sig(SigData::Synth {
            type_params: Box::new([]),
            params: params.into(),
            ret,
            this,
            of: Box::new([sigs[0]]),
        })
    }

    /// `f<Args>` without a call: `ty` with the signatures that take that many type arguments, given them.
    pub fn with_type_arguments(&mut self, ty: TypeId, args: &[TypeId]) -> TypeId {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return ty;
        }
        match self.data(ty).clone() {
            TypeData::Union(_) => return self.map_type(ty, |c, m| c.with_type_arguments(m, args)),
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.with_type_arguments(p, args))
                    .collect();
                return self.intersection(&parts);
            }
            _ => {}
        }
        if self.is_deferred(ty) {
            let constraint = self.base_constraint(ty);
            let given = self.with_type_arguments(constraint, args);
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
                let filled = c.fill_sig_type_args(sig, &params, args);
                let mapper = c.mapper_from(&params, &filled);
                out.push(c.instantiate_sig(sig, mapper));
            }
            out
        };
        let call = given(self, &members.shape().call);
        let construct = given(self, &members.shape().construct);
        let mut props = Vec::with_capacity(members.shape().props.len());
        for prop in &members.shape().props {
            let mut prop = prop.clone();
            match prop.source {
                PropSource::Type(t) => {
                    prop.source = PropSource::Type(self.instantiate(t, members.mapper))
                }
                _ => prop.mapper = self.compose(prop.mapper, members.mapper),
            }
            props.push(prop);
        }
        let index = members
            .shape()
            .index
            .iter()
            .map(|i| IndexInfo {
                key: i.key,
                value: self.instantiate(i.value, members.mapper),
                readonly: i.readonly,
            })
            .collect();
        self.synth(Shape {
            props,
            call,
            construct,
            index,
            ..Shape::default()
        })
    }

    /// What a signature declares and the block or type its declaration is written in.
    fn sig_home(&self, sig: SigId) -> Option<(SigSymbol, SigParent)> {
        // A clone is declared where what it is a clone of is (`Signature.declaration`).
        let sig = self.p.types.sig_origin(sig);
        let (file, func) = match *self.p.types.sig(sig) {
            SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } => {
                (file, func)
            }
            _ => return None,
        };
        let bound = self.bound(file);
        Some(match bound.fns[func.idx()].owner {
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
                let of = match owner {
                    MemberOwner::Interface(i) => Some(self.files().canonical(Sym {
                        file,
                        id: bound.interface_symbol[i.idx()],
                    })),
                    MemberOwner::Class(c) => Some(self.files().canonical(Sym {
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
        })
    }

    fn sig_has_literal_types(&self, sig: SigId) -> bool {
        let sig = self.p.types.sig_origin(sig);
        let (file, func) = match *self.p.types.sig(sig) {
            SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } => {
                (file, func)
            }
            _ => return false,
        };
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
            let SigData::DefaultConstruct { class, base, .. } = *self.p.types.sig(sig) else {
                break;
            };
            // One that extends itself, by whatever way round, has no base signatures, and so no declaration.
            if self.base_types(class).is_empty() {
                break;
            }
            let Some(&of) = self.base_constructor_sigs(class).get(base as usize) else {
                break;
            };
            sig = self.p.types.sig_origin(of);
        }
        sig
    }

    /// `reorderCandidates`: the order overloads are tried in. Of one thing declared in several places, what a later place declares
    /// goes first; signatures that ask for a literal go before all others.
    pub(super) fn reorder_candidates(&mut self, sigs: &[SigId]) -> Vec<SigId> {
        if sigs.len() < 2 {
            return sigs.to_vec();
        }
        let mut result: Vec<SigId> = Vec::with_capacity(sigs.len());
        let mut last: Option<(Option<SigSymbol>, Option<SigParent>)> = None;
        let (mut cutoff, mut index, mut specialized) = (0usize, 0usize, 0usize);
        for &sig in sigs {
            let declared = self.declared_sig(sig);
            let (symbol, parent) = match self.sig_home(declared) {
                Some((s, p)) => (Some(s), Some(p)),
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
            let at = if self.sig_has_literal_types(declared) {
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

    pub(super) fn arg_type(&mut self, file: FileId, arg: Arg) -> TypeId {
        match arg {
            Arg::Expr(e) => self.type_of_expr(file, e),
            Arg::Type(t) | Arg::Spread(t, _) => t,
        }
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
        if let TypeData::Tuple { elems, flags, .. } = self.data(t) {
            return self.tuple(elems, flags, false);
        }
        self.normalized_tuple(&[t], &[ElemFlags::VARIADIC], false)
    }

    /// `getSpreadArgumentType`: the arguments from `index` on, as the list a rest parameter of type `rest` collects them in.
    /// `taken_for[i]`: what argument `i` counts as, if not as what it is where it stands. `from_result`: what is expected of the
    /// result of the call says of its type parameters, while they are inferred.
    pub(super) fn spread_argument_type(
        &mut self,
        file: FileId,
        args: &[Arg],
        index: usize,
        rest: TypeId,
        taken_for: &[Option<TypeId>],
        from_result: MapperId,
    ) -> TypeId {
        let is_const = self.is_const_type_variable(rest, 0);
        // `...x` for `...rest`
        if let Some(&Arg::Spread(element, list)) = args.last()
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
        let (mut elems, mut flags) = (Vec::with_capacity(length), Vec::with_capacity(length));
        for i in index..args.len() {
            let (ty, flag) = match args[i] {
                Arg::Spread(element, list) => {
                    if self.is_array_like(list) {
                        (list, ElemFlags::VARIADIC)
                    } else {
                        (element, ElemFlags::REST)
                    }
                }
                arg => match taken_for.get(i).copied().flatten() {
                    Some(ty) => (ty, ElemFlags::REQUIRED),
                    None => {
                        let contextual = self.rest_argument_context(rest, i - index, Some(length));
                        let ty = self.arg_type(file, arg);
                        // `hasPrimitiveContextualType`. A literal there is room for stays one as well: `checkExpressionWithContextualType`
                        // makes it regular, and only a fresh one is widened.
                        let stays = is_const
                            || may_be_primitive_or_key(self, contextual)
                            || self.some_type(ty, |c, m| c.is_literal(m)) && {
                                let room =
                                    self.instantiate_with_expected_result(contextual, from_result);
                                self.is_literal_context(ty, room)
                            };
                        (
                            if stays {
                                self.regular(ty)
                            } else {
                                self.widen_literal(ty)
                            },
                            ElemFlags::REQUIRED,
                        )
                    }
                },
            };
            elems.push(ty);
            flags.push(flag);
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

    /// The first candidate the arguments fit, going by those whose types do not depend on the choice.
    fn choose_overload(
        &mut self,
        file: FileId,
        call: ExprId,
        candidates: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
    ) -> Option<SigId> {
        // What the arguments are expected to be mentions the type parameters of all the candidates. To a call among the
        // arguments those say nothing.
        let mut pairs = Vec::new();
        for &candidate in candidates {
            pairs.extend(
                self.sig_type_params(candidate)
                    .into_iter()
                    .map(|p| (p, TypeId::UNRESOLVED)),
            );
        }
        pairs.sort_unstable();
        pairs.dedup();
        let holes = self.p.types.mapper(pairs);
        self.candidate_holes.push(holes);
        let chosen = self.choose_overload_among(file, call, candidates, type_args, args, this_arg);
        self.candidate_holes.pop();
        chosen
    }

    /// Whether the arguments that are what they are whatever is expected of them fit `candidate` at all, and what they say about its
    /// type parameters: first at the priority of an argument, then at a lesser one.
    fn plain_arguments_say(
        &mut self,
        file: FileId,
        candidate: SigId,
        params: &[SigParam],
        args: &[Arg],
    ) -> (bool, MapperId, MapperId) {
        let type_params = self.sig_type_params(candidate);
        let plain: Vec<(usize, TypeId)> = args
            .iter()
            .enumerate()
            .filter(|&(_, &a)| match a {
                Arg::Expr(e) => {
                    !self.is_context_sensitive(file, e) && !self.depends_on_context(file, e)
                }
                Arg::Type(_) => true,
                Arg::Spread(..) => false,
            })
            .map(|(i, &a)| (i, a))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|(i, a)| (i, self.arg_type(file, a)))
            .collect();
        let mut inference = Inference::new(type_params.clone(), Some(candidate));
        inference.any_default = self.hir(file).is_js;
        for &(i, ty) in &plain {
            if let Some(param) = self.param_type_at(params, i)
                && self.has_type_variables(param)
            {
                self.infer(&mut inference, ty, param, 0);
            }
        }
        let (mut pairs, mut lesser_pairs) = (Vec::new(), Vec::new());
        for k in 0..type_params.len() {
            let c = &inference.candidates[k];
            if c.covariant.is_empty() && c.contravariant.is_empty() {
                continue;
            }
            let said = if c.priority == 0 {
                &mut pairs
            } else {
                &mut lesser_pairs
            };
            said.push((type_params[k], self.inferred_type(&inference, k)));
        }
        let (known, lesser) = (
            self.p.types.mapper(pairs),
            self.p.types.mapper(lesser_pairs),
        );
        let all = self.inference_mapper(&inference);
        let fits = plain
            .iter()
            .all(|&(i, ty)| match self.param_type_at(params, i) {
                Some(param) => {
                    let param = self.instantiate(param, all);
                    !self.is_known(ty) || !self.is_known(param) || self.is_assignable(ty, param)
                }
                None => true,
            });
        (fits, known, lesser)
    }

    /// What `plain_arguments_say` to an object or array literal that is given for `param`. What they say at a lesser priority is thrown
    /// away as soon as the literal has its own say (`inferFromTypes`), and the literal is inferred from as it is without it.
    fn plain_arguments_say_to_literal(
        &mut self,
        param: TypeId,
        known: MapperId,
        lesser: MapperId,
    ) -> MapperId {
        if lesser == MapperId::IDENTITY {
            return known;
        }
        let mut pairs = self.p.types.mapping(known).to_vec();
        for &(type_param, said) in self.p.types.mapping(lesser) {
            if !self.is_inferred_from_literal(param, type_param, 0) {
                pairs.push((type_param, said));
            }
        }
        self.p.types.mapper(pairs)
    }

    /// Whether an object or array literal that is given for `target` is a candidate, or has one in it, for `type_param`: that is
    /// `target`, or a member of it, or what a property, an element or an index signature of it holds (`inferFromProperties`,
    /// `inferFromIndexTypes`). Nothing is inferred to the `T` of `T[K]` or of `keyof T`, and to that of `{ [P in keyof T]: X }` only at
    /// a lesser priority (`inferToMappedType`). Signatures, and what a mapped type that does not know its keys yet holds, are not
    /// gone into.
    fn is_inferred_from_literal(&mut self, target: TypeId, type_param: TypeId, depth: u32) -> bool {
        let target = self.force(target);
        if target == type_param {
            return true;
        }
        if depth > 4 || !self.mentions(target, type_param, 0) {
            return false;
        }
        if let TypeData::Union(parts)
        | TypeData::Intersection(parts)
        | TypeData::Tuple { elems: parts, .. } = self.data(target)
        {
            return parts
                .iter()
                .any(|&part| self.is_inferred_from_literal(part, type_param, depth + 1));
        }
        if let Some(element) = self.array_element(target) {
            return self.is_inferred_from_literal(element, type_param, depth + 1);
        }
        if !self.is_object_type(target)
            || self.mapped_origin(target).is_some() && self.is_generic(target)
        {
            return false;
        }
        let Some(members) = self.members(target) else {
            return false;
        };
        for prop in &members.shape().props {
            let held = self.type_of_prop(prop, members.mapper);
            if self.is_inferred_from_literal(held, type_param, depth + 1) {
                return true;
            }
        }
        for info in &members.shape().index {
            let held = self.instantiate(info.value, members.mapper);
            if self.is_inferred_from_literal(held, type_param, depth + 1) {
                return true;
            }
        }
        false
    }

    fn choose_overload_among(
        &mut self,
        file: FileId,
        call: ExprId,
        candidates: &[SigId],
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
    ) -> Option<SigId> {
        // An argument is looked at once, whichever candidate is tried: it is expected to be what any of them wants.
        let lists: Vec<Vec<SigParam>> = candidates.iter().map(|&c| self.sig_params(c)).collect();
        // What is expected of the result says what a candidate's type parameters are, for a start.
        let mut from_result: Vec<Option<MapperId>> = vec![None; candidates.len()];
        let mut plain: Vec<Option<(bool, MapperId, MapperId)>> = vec![None; candidates.len()];
        for (i, &arg) in args.iter().enumerate() {
            let Arg::Expr(e) = arg else { continue };
            if self.is_context_sensitive(file, e) || !self.depends_on_context(file, e) {
                continue;
            }
            let mut wanted = Vec::new();
            // A literal is in the end held against the candidate that is chosen, which is none that the plain arguments rule out.
            let is_literal = self.is_literal_that_depends_on_context(file, e);
            if is_literal && type_args.is_empty() {
                for (k, list) in lists.iter().enumerate() {
                    if plain[k].is_none() {
                        plain[k] = Some(self.plain_arguments_say(file, candidates[k], list, args));
                    }
                }
            }
            let any_fits = plain.iter().any(|p| p.is_some_and(|p| p.0));
            // A call, and a function that does not wait for the types of its parameters, are worked out once and stay what they came
            // to (`resolvedSignature`, `NodeCheckFlagsContextChecked`): for the first candidate that gets as far as them.
            // `isSignatureApplicable` goes from left to right, so that is none that an argument before them rules out.
            let is_settled_once = matches!(
                self.hir(file)[e].kind,
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Fn(_)
            );
            let mut reaches = vec![true; lists.len()];
            if is_settled_once && type_args.is_empty() && i > 0 {
                for (k, list) in lists.iter().enumerate() {
                    reaches[k] = self
                        .plain_arguments_say(file, candidates[k], list, &args[..i])
                        .0;
                }
                if !reaches.contains(&true) {
                    reaches.fill(true);
                }
            }
            for (k, list) in lists.iter().enumerate() {
                if !reaches[k] || !is_settled_once && any_fits && plain[k].is_some_and(|p| !p.0) {
                    continue;
                }
                if let Some(t) = self.context_of_arg_at(list, i, Some(args.len())) {
                    let t = match plain[k] {
                        Some((_, known, lesser))
                            if !is_settled_once && self.has_type_variables(t) =>
                        {
                            let said = self.plain_arguments_say_to_literal(t, known, lesser);
                            self.instantiate(t, said)
                        }
                        _ => t,
                    };
                    if type_args.is_empty() && self.has_type_variables(t) {
                        let mapper = match from_result[k] {
                            Some(known) => known,
                            None => {
                                let mapper =
                                    self.mapper_from_expected_result(file, call, candidates[k]);
                                from_result[k] = Some(mapper);
                                mapper
                            }
                        };
                        wanted.push(self.instantiate_with_expected_result(t, mapper));
                    } else if self.has_type_variables(t) {
                        // The type arguments are given.
                        let mapper = match from_result[k] {
                            Some(known) => known,
                            None => {
                                let type_params = self.sig_type_params(candidates[k]);
                                let filled =
                                    self.fill_sig_type_args(candidates[k], &type_params, type_args);
                                let mapper = self.mapper_from(&type_params, &filled);
                                from_result[k] = Some(mapper);
                                mapper
                            }
                        };
                        wanted.push(self.instantiate(t, mapper));
                    } else {
                        wanted.push(t);
                    }
                }
            }
            // A candidate that takes anything says nothing of the argument, and must not drown out those that do.
            let telling: Vec<TypeId> = wanted
                .iter()
                .copied()
                .filter(|&t| {
                    let base = if self.is_deferred(t) {
                        self.base_constraint(t)
                    } else {
                        t
                    };
                    base != TypeId::UNKNOWN && !self.is_any(base)
                })
                .collect();
            let context = if is_settled_once && !wanted.is_empty() {
                wanted[0]
            } else {
                self.union(if telling.is_empty() {
                    &wanted
                } else {
                    &telling
                })
            };
            self.set_context(file, e, context);
        }
        // `isSignatureApplicable`: what it is called on counts, but for `new` and for a call of `super.m`.
        let hir = self.hir(file);
        let checks_this = match hir[call].kind {
            ExprKind::New(_) => false,
            ExprKind::Call(c) => {
                !matches!(hir[hir[c].callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if matches!(hir[obj].kind, ExprKind::Super))
            }
            _ => true,
        };
        // The first whose parameters the arguments are subtypes of, if there is one; whether the call is an error is up to
        // whether they can be assigned.
        let mut instantiated: Vec<Option<(Vec<SigParam>, Option<TypeId>)>> =
            vec![None; candidates.len()];
        let passes: &[bool] = if candidates.len() > 1 {
            &[true, false]
        } else {
            &[false]
        };
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` infers from the annotations of a function only the first time the
        // function is checked. `is_arg_checked[i]`: an attempt has checked argument `i`. `is_first_to_check[k]`: the inference for
        // candidate `k` was the first to check a function, so `instantiated[k]` may depend on the annotations of that function.
        let mut is_arg_checked = vec![false; args.len()];
        let mut is_first_to_check = vec![false; candidates.len()];
        let mut was_by_subtype = passes[0];
        for (&by_subtype, k) in passes
            .iter()
            .flat_map(|pass| (0..candidates.len()).map(move |k| (pass, k)))
        {
            // The assignable pass starts. Each of its attempts has a new inference context, which gets nothing from the functions
            // that the subtype pass checked.
            if was_by_subtype && !by_subtype {
                was_by_subtype = false;
                for (i, &arg) in args.iter().enumerate() {
                    if is_arg_checked[i]
                        && let Arg::Expr(e) = arg
                    {
                        self.set_context_checked(file, e, ContextChecked::ByEndedAttempt);
                    }
                }
                for (j, &was_first) in is_first_to_check.iter().enumerate() {
                    if was_first {
                        instantiated[j] = None;
                    }
                }
            }
            let candidate = candidates[k];
            // One whose type parameters do not take the type arguments that are given is passed over.
            if !type_args.is_empty() && !self.do_type_arguments_fit(candidate, type_args) {
                continue;
            }
            let (params, this) = match &instantiated[k] {
                Some(known) => known.clone(),
                None => {
                    // `inferTypeArguments` checks the arguments whose parameter type could contain type variables.
                    if type_args.is_empty() && !self.sig_type_params(candidate).is_empty() {
                        for (i, &arg) in args.iter().enumerate() {
                            if let Arg::Expr(e) = arg
                                && !is_arg_checked[i]
                                && let Some(param) =
                                    self.context_of_arg_at(&lists[k], i, Some(args.len()))
                                && self.could_contain_type_variables_at(candidate, i, param)
                            {
                                is_arg_checked[i] = true;
                                is_first_to_check[k] |= self.set_context_checked(
                                    file,
                                    e,
                                    ContextChecked::By(candidate),
                                );
                            }
                        }
                    }
                    let sig = self.instantiate_for_call(
                        file, call, candidate, type_args, args, this_arg, true,
                    );
                    let known = (self.sig_params(sig), self.sig_this_type(sig));
                    instantiated[k] = Some(known.clone());
                    known
                }
            };
            // With `...args: T`, how many it takes is only known now.
            if self.non_array_rest_type(&lists[k]).is_some()
                && !self.has_correct_arity(&params, args)
            {
                continue;
            }
            // What it is called on comes first. To `this: void` anything will do.
            if checks_this
                && let Some(wanted) = this
                && wanted != TypeId::VOID
            {
                let given = self.this_argument_type(file, this_arg);
                let is_known = self.is_known(given)
                    && self.is_known(wanted)
                    && !this_arg.is_some_and(|obj| self.is_uncertain(file, obj));
                let fits = if by_subtype {
                    is_known && self.is_subtype(given, wanted)
                } else {
                    !is_known || self.is_assignable(given, wanted)
                };
                if !fits {
                    continue;
                }
            }
            self.resolving
                .push(Resolving::trial(file, call, candidate, params.clone()));
            let rest = self.non_array_rest_type(&params);
            let arg_count = if rest.is_some() {
                (self.parameter_count(&params) - 1).min(args.len())
            } else {
                args.len()
            };
            let mut applicable = true;
            for (i, &arg) in args.iter().enumerate() {
                // `isSignatureApplicable` checks the arguments from left to right, without an inference context.
                if let Arg::Expr(e) = arg
                    && !std::mem::replace(&mut is_arg_checked[i], true)
                {
                    self.set_context_checked(file, e, ContextChecked::By(candidate));
                }
                if let Arg::Expr(e) = arg
                    && self.is_context_sensitive(file, e)
                {
                    // Where a type guard is asked for, only a type guard will do.
                    if let Some(param) = self.context_of_arg_at(&params, i, Some(args.len()))
                        && (!self.has_room_for_literal(file, e, param)
                            || !self.is_guard_if_expected(file, e, param)
                            || !self.do_annotated_parameters_fit(file, e, param, by_subtype)
                            || !self.do_plain_members_fit(file, e, param, by_subtype))
                    {
                        applicable = false;
                        break;
                    }
                    continue;
                }
                // What `rest` collects is held against it all together, below.
                if i >= arg_count {
                    continue;
                }
                let Some(param) = self.param_type_at(&params, i) else {
                    break;
                };
                let ty = self.arg_type(file, arg);
                if by_subtype {
                    // What is not known is a subtype of nothing in particular: the choice is left to the second round.
                    if !self.is_known(ty) || !self.is_known(param) || !self.is_subtype(ty, param) {
                        if self.trace_relations {
                            self.trace_relations = false;
                            let (from, to) = (
                                crate::describe::Describer::new(self).describe(ty),
                                crate::describe::Describer::new(self).describe(param),
                            );
                            self.trace_relations = true;
                            eprintln!(
                                "candidate rejected at argument {i}: {from} is no subtype of {to}"
                            );
                        }
                        applicable = false;
                        break;
                    }
                    continue;
                }
                if !self.is_assignable(ty, param) {
                    if self.trace_relations {
                        // Describing asks questions of its own.
                        self.trace_relations = false;
                        let (from, to) = (
                            crate::describe::Describer::new(self).describe(ty),
                            crate::describe::Describer::new(self).describe(param),
                        );
                        self.trace_relations = true;
                        eprintln!("candidate rejected at argument {i}: {from} to {to}");
                    }
                    applicable = false;
                    break;
                }
            }
            if applicable && let Some(rest) = rest {
                // What waits is not looked at, and fits anything.
                let taken_for: Vec<Option<TypeId>> = args
                    .iter()
                    .map(|a| {
                        matches!(a, Arg::Expr(e) if self.is_context_sensitive(file, *e))
                            .then_some(TypeId::UNRESOLVED)
                    })
                    .collect();
                let given = self.spread_argument_type(
                    file,
                    args,
                    arg_count,
                    rest,
                    &taken_for,
                    MapperId::IDENTITY,
                );
                applicable = if by_subtype {
                    self.is_known(given) && self.is_known(rest) && self.is_subtype(given, rest)
                } else {
                    self.is_assignable(given, rest)
                };
            }
            self.resolving.pop();
            if applicable {
                return Some(candidate);
            }
        }
        None
    }

    /// `ty`, which the type parameter `param` extends or defaults to, with what has been filled in around the signature `param`
    /// belongs to (`outer`) filled in. A clone (`cloneTypeParameter`) comes with that done.
    fn filled_in_around(&mut self, param: TypeId, ty: TypeId, outer: MapperId) -> TypeId {
        match *self.data(param) {
            TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY => ty,
            _ => self.instantiate(ty, outer),
        }
    }

    /// `checkTypeArguments`, without its errors: whether each of `type_args` is what the type parameter of `sig` it is given for
    /// extends. In doubt it is.
    fn do_type_arguments_fit(&mut self, sig: SigId, type_args: &[TypeId]) -> bool {
        let type_params = self.sig_type_params(sig);
        let filled = self.fill_sig_type_args(sig, &type_params, type_args);
        let mapper = self.mapper_from(&type_params, &filled);
        let outer = self
            .sig_decl(sig)
            .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
        for i in 0..type_args.len().min(type_params.len()) {
            let Some(constraint) = self.constraint_of_type_param(type_params[i]) else {
                continue;
            };
            let constraint = self.filled_in_around(type_params[i], constraint, outer);
            let constraint = self.instantiate(constraint, mapper);
            if self.is_known(filled[i])
                && self.is_known(constraint)
                && !self.is_assignable(filled[i], constraint)
            {
                return false;
            }
        }
        true
    }

    /// Of a function whose type is not known yet, the parameters it types itself are: whether they take what `param` would give them.
    fn do_annotated_parameters_fit(
        &mut self,
        file: FileId,
        arg: ExprId,
        param: TypeId,
        by_subtype: bool,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Fn(func) = hir[arg].kind else {
            return true;
        };
        if !self.p.files.options.strict_function_types
            || !hir[func].params.iter().any(|p| hir[p].ty.is_some())
        {
            return true;
        }
        let non_null = self.non_nullable(param);
        let Some(expected) = self.single_call_signature(non_null, false) else {
            return true;
        };
        if !self.sig_type_params(expected).is_empty() {
            return true;
        }
        let given = self.sig_params(expected);
        for (i, p) in hir[func]
            .params
            .iter()
            .filter(|&p| !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this)))
            .enumerate()
        {
            if hir[p].ty.is_none() || hir[p].flags.contains(Flags::REST) {
                continue;
            }
            let Some(from) = self.param_type_at(&given, i) else {
                break;
            };
            let to = self.type_of_param(file, p);
            if !self.is_known(from) || !self.is_known(to) || self.has_type_variables(from) {
                continue;
            }
            if !(if by_subtype {
                self.is_subtype(from, to)
            } else {
                self.is_assignable(from, to)
            }) {
                return false;
            }
        }
        true
    }

    /// The first round of `chooseOverload` (`CheckModeSkipContextSensitive`): what of the object literal `arg` does not wait for its
    /// context has to fit `param`, properties there are too many of aside (`getRegularTypeOfObjectLiteral`). In doubt it does.
    fn do_plain_members_fit(
        &mut self,
        file: FileId,
        arg: ExprId,
        param: TypeId,
        by_subtype: bool,
    ) -> bool {
        self.check_literal_skipping_sensitive(file, arg, param, by_subtype)
            .is_some()
    }

    /// The type of the object literal `arg` under `CheckModeSkipContextSensitive`, or `None` if that type is not related to `param`.
    /// `UNRESOLVED` stands for a member that is not checked, and for the whole literal when its type cannot be determined.
    fn check_literal_skipping_sensitive(
        &mut self,
        file: FileId,
        arg: ExprId,
        param: TypeId,
        by_subtype: bool,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[arg].kind else {
            return Some(TypeId::UNRESOLVED);
        };
        if props.iter().any(|p| hir[p].kind == PropKind::Spread)
            || self.has_type_variables(param)
            || !self.is_known(param)
        {
            return Some(TypeId::UNRESOLVED);
        }
        let mut shape = Shape {
            literal: Literalness::Partial,
            ..Shape::default()
        };
        for p in props.iter() {
            let prop = &hir[p];
            let Some(name) = self.member_name(file, prop.key) else {
                return Some(TypeId::UNRESOLVED);
            };
            let wanted = self.contextual_property(param, name);
            // What is not looked at fits anything, whichever way it is compared, as `anyFunctionType` fits every function type.
            let mut ty = TypeId::UNRESOLVED;
            if prop.value.is_some()
                && matches!(prop.kind, PropKind::Init | PropKind::Method)
                && (matches!(hir[prop.value].kind, ExprKind::Object(_))
                    || self.is_context_sensitive(file, prop.value))
            {
                if let Some(wanted) = wanted {
                    if !self.has_room_for_literal(file, prop.value, wanted) {
                        return None;
                    }
                    // The type of a nested literal becomes part of the type of `arg`: `wanted` leaves out an index signature of `param`
                    // once a member of an intersection declares the property, but the relation below checks the property against both.
                    ty = self
                        .check_literal_skipping_sensitive(file, prop.value, wanted, by_subtype)?;
                }
            } else if prop.value.is_some()
                && matches!(prop.kind, PropKind::Init | PropKind::Shorthand)
                && !self.depends_on_context(file, prop.value)
                && !matches!(
                    hir[prop.value].kind,
                    ExprKind::Template { .. } | ExprKind::TaggedTemplate(_)
                )
                && self.nested_generic_function(file, prop.value).is_none()
            {
                let given = self.type_of_expr(file, prop.value);
                if self.is_known(given) && !self.is_uncertain(file, prop.value) {
                    ty = self.widen_literal_for_context(given, wanted);
                }
            }
            shape.props.retain(|x| x.name != name);
            shape.props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        // A `Partial` shape without members is `anyFunctionType`, which `{}` is not.
        let literal_type = if shape.props.is_empty() {
            TypeId::EMPTY_OBJECT
        } else {
            self.synth(shape)
        };
        let is_related = if by_subtype {
            self.is_subtype(literal_type, param)
        } else {
            self.is_assignable(literal_type, param)
        };
        is_related.then_some(literal_type)
    }

    /// Whether a function, object or array literal whose type is not known yet could be a `param` at all:
    /// a function is no `string`, whatever its parameters turn out to be.
    fn has_room_for_literal(&mut self, file: FileId, arg: ExprId, param: TypeId) -> bool {
        let is_function = matches!(self.hir(file)[arg].kind, ExprKind::Fn(_));
        let param = self.force(param);
        self.parts(param).to_vec().into_iter().any(|part| {
            if self.is_any(part)
                || part == TypeId::UNKNOWN
                || part == TypeId::OBJECT
                || part == TypeId::EMPTY_OBJECT
                || self.is_deferred(part)
            {
                return true;
            }
            if self.is_primitive(part) || part == TypeId::NEVER {
                return false;
            }
            if !is_function {
                return true;
            }
            // Something to call, or nothing that every function does not have: `{ name: string }` will do.
            if self
                .members(part)
                .is_none_or(|m| !m.shape().call.is_empty())
            {
                return true;
            }
            let function = self.global_ref(known::Function, &[]);
            self.is_assignable(function, part)
        })
    }

    fn is_guard_if_expected(&mut self, file: FileId, arg: ExprId, param: TypeId) -> bool {
        let ExprKind::Fn(func) = self.hir(file)[arg].kind else {
            return true;
        };
        let non_null = self.non_nullable(param);
        let sigs = self.signatures(non_null, false);
        let [expected] = sigs[..] else { return true };
        if self.sig_predicate(expected).is_none() {
            return true;
        }
        // The parameters get their types for good once a candidate is picked.
        if self.provisional == 0 {
            self.provisional_floor = self.stack.len();
        }
        self.provisional += 1;
        self.contextual.push((file, arg, param));
        let own = self.sig_of_fn(file, func);
        let is_guard = self.sig_predicate(own).is_some();
        self.contextual.pop();
        self.provisional -= 1;
        if self.provisional == 0 {
            self.provisional_arg_contexts.clear();
        }
        is_guard
    }

    /// Whether a type parameter of `sig` is in scope where `call` is written: in the function that declares it, or, for a construct
    /// signature, in the class. What is written there may really mean it, and `inferFromTypes` takes it for a candidate like any other.
    fn is_inside_declaration_of(&mut self, file: FileId, call: ExprId, sig: SigId) -> bool {
        let own = self.sig_type_params(sig);
        if own.is_empty() {
            return false;
        }
        let scope = self.scope_of_expr(file, call);
        let in_scope = self.outer_type_params(file, scope);
        own.iter().any(|p| in_scope.contains(p))
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
    fn this_argument_type(&mut self, file: FileId, this_arg: Option<ExprId>) -> TypeId {
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

    /// The head of `inferTypeArguments`: what is expected of the result of `call`, whose signature has `type_params`, and
    /// whether that is no more than what a binding pattern implies (`isFromBindingPattern`).
    fn expected_result(
        &mut self,
        file: FileId,
        call: ExprId,
        type_params: &[TypeId],
    ) -> Option<(TypeId, bool)> {
        self.skip_binding_patterns += 1;
        let without_patterns = self.contextual_type(file, call);
        self.skip_binding_patterns -= 1;
        // `skipBindingPatterns`: to type parameters that all have defaults a pattern says nothing.
        let mut skips_patterns = true;
        for &param in type_params {
            skips_patterns = skips_patterns && self.default_of_type_param(param).is_some();
        }
        if skips_patterns {
            return without_patterns.map(|expected| (expected, false));
        }
        let expected = self.contextual_type(file, call)?;
        Some((expected, without_patterns != Some(expected)))
    }

    /// `createOuterReturnMapper`, applied to what is expected of a call among the arguments of the calls being resolved: none of
    /// their type parameters is left in it.
    fn instantiate_with_outer_return_mappers(&mut self, mut ty: TypeId) -> TypeId {
        for i in (0..self.resolving.len()).rev() {
            if !self.has_type_variables(ty) {
                break;
            }
            let mapped = self.instantiate(ty, self.resolving[i].outer_return_mapper);
            if mapped != ty {
                self.resolving[i].is_outer_return_mapper_taken = true;
                ty = mapped;
            }
        }
        ty
    }

    /// The type parameters of the candidates of the overloaded calls around say nothing.
    fn instantiate_with_candidate_holes(&mut self, mut ty: TypeId) -> TypeId {
        for i in (0..self.candidate_holes.len()).rev() {
            if !self.has_type_variables(ty) {
                break;
            }
            ty = self.instantiate(ty, self.candidate_holes[i]);
        }
        ty
    }

    /// `createOuterReturnMapper`: every type parameter of a call being resolved, by what is expected of its result
    /// (`return_mapper`), or else by what the arguments looked at so far come to: failing them its default, what it extends,
    /// or `unknown`.
    fn outer_return_mapper(&mut self, inference: &Inference, return_mapper: MapperId) -> MapperId {
        // `cloneInferenceContext(context).mapper`: it is the clone that is settled.
        let mut settled = inference.clone();
        let mut pairs = Vec::with_capacity(settled.params.len());
        for k in 0..settled.params.len() {
            let param = settled.params[k];
            let ty = match self.p.types.map(return_mapper, param) {
                Some(ty) => ty,
                None => {
                    self.fix_params_in(&mut settled, param);
                    settled.candidates[k].fixed.unwrap_or(TypeId::UNKNOWN)
                }
            };
            pairs.push((param, ty));
        }
        self.p.types.mapper(pairs)
    }

    /// Before an argument, or a part of one, that what is expected of it matters to is looked at: tells the calls inside it what
    /// is known of the type parameters by now. Those nothing is known of yet say nothing.
    fn note_so_far(&mut self, inference: &Inference) {
        let Some(at) = self.resolving.len().checked_sub(1) else {
            return;
        };
        let pairs: Vec<(TypeId, TypeId)> = (0..inference.params.len())
            .map(|k| {
                let c = &inference.candidates[k];
                let known =
                    c.fixed.is_some() || !c.covariant.is_empty() || !c.contravariant.is_empty();
                (
                    inference.params[k],
                    if known {
                        self.inferred_type(inference, k)
                    } else {
                        TypeId::UNRESOLVED
                    },
                )
            })
            .collect();
        self.resolving[at].so_far = self.p.types.mapper(pairs);
        // What is made of a generic function for a signature that may be dropped would stay.
        self.resolving[at].is_inferential = !self.resolving[at].is_trial;
        if !self.resolving[at].is_outer_return_mapper_taken {
            let return_mapper = self.resolving[at].return_mapper;
            let mapper = self.outer_return_mapper(inference, return_mapper);
            self.resolving[at].outer_return_mapper = mapper;
        }
    }

    /// After what `note_so_far` was called for has been looked at: the type parameters that the generic functions inside it went
    /// by are settled (`instantiateSignatureInContextOf`, `context.mapper`), on what they were taken to be.
    fn settle_after_look(&mut self, inference: &mut Inference) {
        let Some(resolving) = self.resolving.last_mut() else {
            return;
        };
        resolving.is_inferential = false;
        for (param, ty) in resolving.settles.drain(..) {
            if let Some(i) = inference.params.iter().position(|&p| p == param)
                && inference.candidates[i].fixed.is_none()
            {
                inference.candidates[i].fixed = Some(ty);
            }
        }
    }

    /// `returnContext`: what `contextual`, which is expected of the result, says about the type parameters of `sig` when taken
    /// on its own. `target`: what `sig` returns.
    fn return_mapper(
        &mut self,
        sig: SigId,
        type_params: &[TypeId],
        contextual: TypeId,
        target: TypeId,
        is_from_pattern: bool,
        calls_itself: bool,
    ) -> MapperId {
        let expected = self.instantiate_with_outer_return_mappers(contextual);
        let expected = self.instantiate_with_candidate_holes(expected);
        let mut from_result = Inference::new(type_params.to_vec(), Some(sig));
        from_result.calls_itself = calls_itself;
        from_result.from_pattern = is_from_pattern;
        self.infer(&mut from_result, expected, target, PRIORITY_RETURN);
        // The names in a pattern can be anything, and nothing is inferred from that: only from the shape of it.
        if is_from_pattern {
            for c in &mut from_result.candidates {
                c.covariant.retain(|&t| t != TypeId::ANY);
                c.contravariant.retain(|&t| t != TypeId::ANY);
            }
        }
        self.mapper_of_result_inference(type_params, &from_result)
    }

    /// The type parameters of `sig` that what is expected of the result of `call` says something about, and what it says of
    /// what the arguments are expected to be.
    fn mapper_from_expected_result(&mut self, file: FileId, call: ExprId, sig: SigId) -> MapperId {
        let type_params = self.sig_type_params(sig);
        let ret = self.return_type_in_chain(file, call, sig);
        if type_params.is_empty() || !self.has_type_variables(ret) {
            return MapperId::IDENTITY;
        }
        let Some((contextual, is_from_pattern)) = self.expected_result(file, call, &type_params)
        else {
            return MapperId::IDENTITY;
        };
        let calls_itself = self.is_inside_declaration_of(file, call, sig);
        let return_mapper = self.return_mapper(
            sig,
            &type_params,
            contextual,
            ret,
            is_from_pattern,
            calls_itself,
        );
        self.return_mapper_for_contexts(return_mapper)
    }

    /// From the type parameters something was inferred for to what was inferred, or to what they extend if that does not fit.
    fn mapper_of_result_inference(
        &mut self,
        type_params: &[TypeId],
        from_result: &Inference,
    ) -> MapperId {
        let mut pairs: Vec<(TypeId, TypeId)> = (0..type_params.len())
            .filter(|&i| {
                !from_result.candidates[i].covariant.is_empty()
                    || !from_result.candidates[i].contravariant.is_empty()
            })
            .map(|i| {
                let candidate = &from_result.candidates[i];
                // Found where something is taken rather than given, for lack of better.
                let ty = if candidate.covariant.is_empty() {
                    self.inferred_type(from_result, i)
                } else {
                    self.union(&candidate.covariant)
                };
                (type_params[i], ty)
            })
            .collect();
        let inferred = self.p.types.mapper(pairs.clone());
        let mut changed = false;
        for pair in &mut pairs {
            if let Some(constraint) = self.constraint_of_type_param(pair.0) {
                let constraint = self.instantiate(constraint, inferred);
                if !self.is_assignable(pair.1, constraint) {
                    pair.1 = constraint;
                    changed = true;
                }
            }
        }
        if changed {
            self.p.types.mapper(pairs)
        } else {
            inferred
        }
    }

    /// `ty` without `true` and `false`, if both are in it.
    fn without_boolean(&mut self, ty: TypeId) -> TypeId {
        if let TypeData::Union(parts) = self.data(ty)
            && parts.contains(&TypeId::TRUE)
            && parts.contains(&TypeId::FALSE)
        {
            return self.filter(ty, |_, m| m != TypeId::TRUE && m != TypeId::FALSE);
        }
        ty
    }

    /// `instantiateContextualType` puts what `returnMapper` says for a type parameter wherever one is come to on the way down
    /// into what is expected, unless that is `any` or `unknown`, and without `boolean`. The mapper that does the same all
    /// the way down at once.
    fn return_mapper_for_contexts(&mut self, return_mapper: MapperId) -> MapperId {
        let mapping = self.p.types.mapping(return_mapper);
        let mut pairs = Vec::with_capacity(mapping.len());
        for &(param, ty) in mapping {
            if !self.is_any(ty) && ty != TypeId::UNKNOWN {
                pairs.push((param, self.without_boolean(ty)));
            }
        }
        self.p.types.mapper(pairs)
    }

    /// What `param` is expected to be going by what is expected of the result. Not `boolean`: `f(true)` is to give a
    /// `boolean` where one is expected, not a `true`.
    fn instantiate_with_expected_result(&mut self, param: TypeId, from_result: MapperId) -> TypeId {
        let ty = self.instantiate(param, from_result);
        // `instantiateContextualType`: `any` and `unknown` say nothing.
        if self.is_any(ty) || ty == TypeId::UNKNOWN {
            return param;
        }
        if ty != param {
            self.without_boolean(ty)
        } else {
            ty
        }
    }

    /// `sig` with its type parameters given or inferred. `skip_sensitive`: leave out the arguments that wait for the others.
    pub(super) fn instantiate_for_call(
        &mut self,
        file: FileId,
        call: ExprId,
        sig: SigId,
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        skip_sensitive: bool,
    ) -> SigId {
        self.instantiate_for_call_as(
            file,
            call,
            sig,
            type_args,
            args,
            this_arg,
            skip_sensitive,
            false,
        )
    }

    /// `settled`: the functions among the arguments have their parameter types for good (`NodeCheckFlagsContextChecked`). They
    /// wait for nothing, and are inferred from in their turn like any other argument.
    pub(super) fn instantiate_for_call_as(
        &mut self,
        file: FileId,
        call: ExprId,
        sig: SigId,
        type_args: &[TypeId],
        args: &[Arg],
        this_arg: Option<ExprId>,
        skip_sensitive: bool,
        settled: bool,
    ) -> SigId {
        let type_params = self.sig_type_params(sig);
        let params = self.sig_params(sig);
        if type_params.is_empty() {
            if !skip_sensitive {
                self.set_arg_contexts(file, args, &params);
            }
            return sig;
        }
        if !type_args.is_empty() {
            let filled = self.fill_sig_type_args(sig, &type_params, type_args);
            let mapper = self.mapper_from(&type_params, &filled);
            let sig = self.instantiate_sig(sig, mapper);
            if !skip_sensitive {
                let params = self.sig_params(sig);
                self.set_arg_contexts(file, args, &params);
            }
            return sig;
        }

        let mut inference = Inference::new(type_params.clone(), Some(sig));
        // `chooseOverload`, `inferSignatureInstantiationForOverloadFailure`: `InferenceFlagsAnyDefault` depends on the file that contains
        // the call, not on the file that declares `sig`.
        inference.any_default = self.hir(file).is_js;
        inference.calls_itself = self.is_inside_declaration_of(file, call, sig);
        // `returnMapper`: the inferences from the contextual type of the call alone.
        let mut from_result = MapperId::IDENTITY;
        // `inferTypeArguments`: nothing is expected of what a decorator gives back when it is applied. It is applied to what is made
        // up for it, where `@f(x)` itself, a call like any other, has expressions.
        let is_decorator_applied = matches!(
            self.bound(file).expr_parent[call.idx()],
            Parent::Decorator(..)
        ) && !args.is_empty()
            && args.iter().all(|a| matches!(a, Arg::Type(_)));
        // `inferTypeArguments` reads the contextual type of the call first, and the return type of `sig` only if there is one. The order
        // is observable only while that return type is being resolved, when reading it is a circularity. `None`: not read yet.
        let has_no_contextual_type = self.is_resolving_return_type(sig)
            && (is_decorator_applied || self.expected_result(file, call, &type_params).is_none());
        let mut ret = if has_no_contextual_type {
            None
        } else {
            Some(self.return_type_in_chain(file, call, sig))
        };
        // The contextual type of the call contributes inferences, at a lower priority than the arguments.
        if let Some(ret) = ret
            && self.has_type_variables(ret)
            && !is_decorator_applied
            && let Some((contextual, is_from_pattern)) =
                self.expected_result(file, call, &type_params)
        {
            // `const [a, b] = f()` expects a pair of anything. That helps the arguments along, but is no answer.
            if !is_from_pattern {
                // Type parameters of the calls around, which are still being worked out, are what is known of them by now.
                let mut expected = contextual;
                for i in (0..self.resolving.len()).rev() {
                    if !self.has_type_variables(expected) {
                        break;
                    }
                    expected = self.instantiate(expected, self.resolving[i].so_far);
                }
                let expected = self.instantiate_with_candidate_holes(expected);
                // A generic function type that is expected stands with its own type parameters for type arguments, so that they
                // are not erased.
                let source = match self.single_call_signature(expected, false) {
                    Some(generic) if !self.sig_type_params(generic).is_empty() => {
                        let (params, ret, this) = (
                            self.sig_params(generic),
                            self.sig_return(generic),
                            self.sig_this_type(generic),
                        );
                        let plain = self.p.types.intern_sig(SigData::Synth {
                            type_params: Box::new([]),
                            params: params.into(),
                            ret,
                            this,
                            of: Box::new([]),
                        });
                        self.synth(Shape {
                            call: vec![plain],
                            ..Shape::default()
                        })
                    }
                    _ => expected,
                };
                // What is expected is written where the call is: a type parameter of `sig` met in it is the caller's. What has a
                // hole in it, where a call around knows nothing yet, is no candidate (`InferenceFlagsNoDefault`, `silentNeverType`).
                let calls_itself = std::mem::replace(&mut inference.calls_itself, true);
                inference.leaves_out_unknown = true;
                self.infer(&mut inference, source, ret, PRIORITY_RETURN);
                inference.leaves_out_unknown = false;
                inference.calls_itself = calls_itself;
            }
            from_result = self.return_mapper(
                sig,
                &type_params,
                contextual,
                ret,
                is_from_pattern,
                inference.calls_itself,
            );
        }
        // `getNonArrayRestType`: what a rest parameter that is no plain array collects is inferred from all together.
        let rest_ty = self.non_array_rest_type(&params);
        let arg_count = if rest_ty.is_some() {
            (self.parameter_count(&params) - 1).min(args.len())
        } else {
            args.len()
        };
        // `...args: T`: as many as there are, if none of them is spread.
        if let Some(rest) = rest_ty
            && let Some(k) = type_params.iter().position(|&p| p == rest)
            && !args[arg_count..]
                .iter()
                .any(|a| matches!(a, Arg::Spread(..)))
        {
            inference.candidates[k].implied_arity = Some(args.len() - arg_count);
        }
        if let Some(this_ty) = self.sig_this_type(sig)
            && self.has_type_variables(this_ty)
        {
            let ty = self.this_argument_type(file, this_arg);
            self.infer(&mut inference, ty, this_ty, 0);
        }
        // What the expected result says about the type parameters is what the arguments are first expected to fit.
        let return_mapper = self.return_mapper_for_contexts(from_result);
        self.resolving.push(Resolving {
            is_trial: skip_sensitive,
            ..Resolving::new(file, call, Some(sig), params.clone(), from_result)
        });
        let mut is_sensitive: Vec<bool> = args
            .iter()
            .map(|a| !settled && matches!(a, Arg::Expr(e) if self.is_context_sensitive(file, *e)))
            .collect();
        // `instantiateTypeWithSingleGenericCallSignature`: a generic function given where a function that is not generic is
        // expected waits as well: its own type parameters are worked out from what it will be called with. The same for
        // something generic to construct (`true`) where something to construct is expected.
        let mut generic_functions: Vec<Option<(SigId, bool)>> = vec![None; args.len()];
        for (i, &arg) in args.iter().enumerate() {
            if let Arg::Expr(e) = arg
                && !is_sensitive[i]
                && (!self.depends_on_context(file, e)
                    || matches!(self.hir(file)[e].kind, ExprKind::Fn(f) if !self.hir(file)[f].type_params.is_empty()))
                && let Some(param) = self.context_of_arg_at(&params, i, Some(args.len()))
                && self.has_type_variables(param)
                && let Some(wants_construct) = self.wants_plain_signature(param, from_result)
            {
                let ty = self.type_of_expr(file, e);
                if let Some(generic) = self.single_generic_signature(ty, wants_construct) {
                    generic_functions[i] = Some(generic);
                    is_sensitive[i] = true;
                }
            }
        }
        // `checkExpressionEx` calls `instantiateTypeWithSingleGenericCallSignature` for every expression, so a generic function inside
        // a literal argument is `anyFunctionType` in the first round as well (`CheckModeSkipGenericFunctions`), and the argument is
        // checked again in the second round. Arguments that a generic rest parameter collects are not covered.
        let mut nested_generic_functions: Vec<NestedGenericFunction> = Vec::new();
        for (i, &arg) in args.iter().enumerate().take(arg_count) {
            if let Arg::Expr(e) = arg
                && matches!(
                    self.hir(file)[e].kind,
                    ExprKind::Array(_) | ExprKind::Object(_)
                )
                && let Some(param) = self.param_type_at(&params, i)
            {
                self.collect_nested_generic_functions(
                    file,
                    e,
                    param,
                    from_result,
                    i,
                    &mut nested_generic_functions,
                );
            }
        }
        for nested in &nested_generic_functions {
            is_sensitive[nested.arg_index] = true;
        }
        if let Some(resolving) = self.resolving.last_mut() {
            resolving.nested_generic_functions = nested_generic_functions;
        }
        // `resolveCallExpression` under `CheckModeSkipGenericFunctions`: a call, without type arguments, of a generic function
        // that returns a function waits too, so that what stands to its left has had its say. It is a plain argument for all
        // that: nothing is settled for its sake. While candidates are tried it is held against each of them, and does not wait.
        let mut put_off = vec![false; args.len()];
        if !skip_sensitive {
            for (i, &arg) in args.iter().enumerate() {
                if let Arg::Expr(e) = arg
                    && !is_sensitive[i]
                    && let Some(param) = self.context_of_arg_at(&params, i, Some(args.len()))
                    && self.has_type_variables(param)
                    && self.is_call_of_generic_function_returning_function(file, e)
                {
                    is_sensitive[i] = true;
                    put_off[i] = true;
                }
            }
        }
        let mut from_plain: Option<(MapperId, MapperId)> = None;
        let mut inferred_type_params: Vec<TypeId> = Vec::new();
        for pass in 0..2 {
            if pass == 1 && skip_sensitive {
                break;
            }
            // `chooseOverload`: a candidate that what does not wait does not fit is rejected before anything else is looked at, and
            // stays as the first round left it. That is what the rest is then expected to fit.
            if pass == 1 && is_sensitive.contains(&true) {
                let early = self.inference_mapper(&inference);
                // The instantiation of a generic rest parameter can change the arity, which is checked again before the arguments.
                let has_wrong_arity = rest_ty.is_some() && {
                    let instantiated: Vec<SigParam> = params
                        .iter()
                        .map(|p| SigParam {
                            ty: self.instantiate(p.ty, early),
                            ..p.clone()
                        })
                        .collect();
                    !self.has_correct_arity(&instantiated, args)
                };
                if has_wrong_arity
                    || !self.fits_without_sensitive(file, args, &params, &is_sensitive, early)
                {
                    let rejected: Vec<SigParam> = params
                        .iter()
                        .map(|p| SigParam {
                            ty: self.instantiate(p.ty, early),
                            ..p.clone()
                        })
                        .collect();
                    for (i, &arg) in args.iter().enumerate() {
                        if let Arg::Expr(e) = arg
                            && is_sensitive[i]
                            && let Some(context) =
                                self.context_of_arg_at(&rejected, i, Some(args.len()))
                        {
                            self.set_context(file, e, context);
                        }
                    }
                    break;
                }
            }
            for (i, &arg) in args.iter().enumerate().take(arg_count) {
                // The second round instantiates the generic functions inside argument `i` as it reaches them, which can add to
                // `inferredTypeParameters`.
                let instantiates_generic_functions = pass == 1
                    && self.resolving.last().is_some_and(|r| {
                        r.nested_generic_functions
                            .iter()
                            .any(|nested| nested.arg_index == i)
                    });
                if instantiates_generic_functions && let Some(resolving) = self.resolving.last_mut()
                {
                    resolving.inferred_type_params = std::mem::take(&mut inferred_type_params);
                }
                // Of a literal with functions in it, the rest has its say along with the plain arguments, and the functions
                // theirs before the whole.
                if is_sensitive[i]
                    && generic_functions[i].is_none()
                    && !put_off[i]
                    && let Arg::Expr(e) = arg
                    && let Some(param) = self.param_type_at(&params, i)
                    && self.has_type_variables(param)
                {
                    self.infer_from_literal(
                        file,
                        e,
                        param,
                        &mut inference,
                        return_mapper,
                        pass == 1,
                    );
                }
                if instantiates_generic_functions {
                    // Those that `infer_from_literal` did not reach.
                    if let Arg::Expr(e) = arg {
                        self.instantiate_nested_generic_functions(file, e, &mut inference);
                    }
                    if let Some(resolving) = self.resolving.last_mut() {
                        inferred_type_params = std::mem::take(&mut resolving.inferred_type_params);
                    }
                }
                if is_sensitive[i] != (pass == 1) {
                    continue;
                }
                let Some(param) = self.param_type_at(&params, i) else {
                    break;
                };
                if let Some((generic, construct)) = generic_functions[i] {
                    let ret =
                        *ret.get_or_insert_with(|| self.return_type_in_chain(file, call, sig));
                    self.infer_from_generic_function(
                        &mut inference,
                        generic,
                        construct,
                        param,
                        ret,
                        from_result,
                        &mut inferred_type_params,
                    );
                    continue;
                }
                // What the argument is expected to be is settled before it is looked at, and stays: what is inferred
                // from the argument cannot be what is expected of it.
                if let Arg::Expr(e) = arg
                    && (pass == 1 || self.depends_on_context(file, e))
                {
                    let context = if pass == 1 && !put_off[i] && self.is_context_sensitive(file, e)
                    {
                        // What it is to return is, for lack of anything better, what the expected result implies.
                        let context =
                            self.context_for_sensitive_arg(&mut inference, param, Some((file, e)));
                        self.set_async_return_contexts(file, e, context, return_mapper);
                        self.instantiate_with_expected_result(context, return_mapper)
                    } else {
                        self.set_async_return_contexts(file, e, param, return_mapper);
                        let context = self.instantiate_with_expected_result(param, return_mapper);
                        // In the end a literal is held against what the type parameters come to. It is looked at once, so that
                        // is anticipated as far as the plain arguments go.
                        if self.has_type_variables(context)
                            && self.is_literal_that_depends_on_context(file, e)
                        {
                            let (known, lesser) = match from_plain {
                                Some(said) => said,
                                None => {
                                    let (_, known, lesser) =
                                        self.plain_arguments_say(file, sig, &params, args);
                                    (known, lesser)
                                }
                            };
                            from_plain = Some((known, lesser));
                            let known = self.plain_arguments_say_to_literal(param, known, lesser);
                            // And the arguments before it, whatever they are.
                            let mut pairs = self.p.types.mapping(known).to_vec();
                            for k in 0..type_params.len() {
                                let c = &inference.candidates[k];
                                if c.priority == 0
                                    && (c.fixed.is_some()
                                        || !c.covariant.is_empty()
                                        || !c.contravariant.is_empty())
                                    && !pairs.iter().any(|p| p.0 == type_params[k])
                                {
                                    pairs.push((type_params[k], self.inferred_type(&inference, k)));
                                }
                            }
                            let so_far = self.p.types.mapper(pairs);
                            let context = self.instantiate(context, so_far);
                            // `getInferredType`: a type parameter that is still open comes to no more than what it extends, which
                            // may be known by now.
                            let mut bounds = Vec::new();
                            if self.has_type_variables(context) {
                                let outer = self
                                    .sig_decl(sig)
                                    .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
                                for &p in &type_params {
                                    if self.p.types.map(so_far, p).is_none()
                                        && let Some(constraint) = self.constraint_of_type_param(p)
                                        && self.has_type_variables(constraint)
                                    {
                                        let constraint =
                                            self.filled_in_around(p, constraint, outer);
                                        let bound = self.instantiate(constraint, so_far);
                                        // `isLiteralOfContextualType` reads the base constraint of a type parameter, so a primitive
                                        // bound adds nothing, and substituting it would widen the literals in the argument.
                                        if !type_params.iter().any(|&q| self.mentions(bound, q, 0))
                                            && !self.every_type(bound, |c, t| c.is_primitive(t))
                                        {
                                            bounds.push((p, bound));
                                        }
                                    }
                                }
                            }
                            if bounds.is_empty() {
                                context
                            } else {
                                let bounds = self.p.types.mapper(bounds);
                                self.instantiate(context, bounds)
                            }
                        } else {
                            context
                        }
                    };
                    self.set_context(file, e, context);
                }
                if !self.has_type_variables(param) {
                    continue;
                }
                if let Arg::Expr(e) = arg
                    && self.depends_on_context(file, e)
                {
                    self.note_so_far(&inference);
                }
                // The functions in it that wait for nothing are looked at along with it.
                if pass == 0
                    && let Arg::Expr(e) = arg
                {
                    self.infer_from_annotated_functions(file, e, param, &mut inference);
                }
                let mut ty = match arg {
                    Arg::Expr(e) => self.type_of_expr_for_inference(file, e),
                    _ => self.arg_type(file, arg),
                };
                self.settle_after_look(&mut inference);
                if let Arg::Expr(e) = arg {
                    if let Some(kept) = self.type_of_reference_to_infer_from(file, e) {
                        ty = kept;
                    }
                    // `instantiateTypeWithSingleGenericCallSignature` goes for whatever the argument is written as: a call that gives a
                    // generic function waits like a generic function that is named (`CheckModeSkipGenericFunctions`).
                    if self.depends_on_context(file, e)
                        && let Some(wants_construct) =
                            self.wants_plain_signature(param, from_result)
                        && let Some((generic, construct)) =
                            self.single_generic_signature(ty, wants_construct)
                    {
                        if pass == 0 {
                            generic_functions[i] = Some((generic, construct));
                            is_sensitive[i] = true;
                        } else {
                            let ret = *ret
                                .get_or_insert_with(|| self.return_type_in_chain(file, call, sig));
                            self.infer_from_generic_function(
                                &mut inference,
                                generic,
                                construct,
                                param,
                                ret,
                                from_result,
                                &mut inferred_type_params,
                            );
                        }
                        continue;
                    }
                    self.note_array_literals(file, e, &mut inference.array_literals);
                }
                // A literal given where there is room for one is meant as itself, and is not widened later on.
                if self.some_type(ty, |c, m| c.is_literal(m)) {
                    // Room for one can also come from what is expected of the result.
                    let room = self.instantiate_with_expected_result(param, return_mapper);
                    if self.is_literal_context(ty, room) {
                        ty = self.regular(ty);
                    }
                }
                self.infer(&mut inference, ty, param, 0);
            }
            // What the rest parameter collects (`getSpreadArgumentType`): in both rounds, if something waits for the second. A list
            // with something left out of it is no candidate for `...args: T`, so there the first is not made.
            let Some(rest) = rest_ty else { continue };
            let waits = is_sensitive[arg_count..].contains(&true);
            let infers = self.has_type_variables(rest)
                && if pass == 1 {
                    waits
                } else {
                    !waits || !type_params.contains(&rest)
                };
            let mut taken_for: Vec<Option<TypeId>> = vec![None; args.len()];
            for (i, &arg) in args.iter().enumerate().skip(arg_count) {
                let Arg::Expr(e) = arg else { continue };
                if !is_sensitive[i] {
                    continue;
                }
                if pass == 0 {
                    // `anyFunctionType`, `silentNeverType`: what waits says nothing, and neither does a list that holds it
                    // (`ObjectFlagsNonInferrableType`).
                    if infers {
                        taken_for[i] = Some(if generic_functions[i].is_some() || put_off[i] {
                            self.synth(Shape {
                                literal: Literalness::Partial,
                                ..Shape::default()
                            })
                        } else {
                            self.with_so_far(file, &mut inference, |c| c.partial_type(file, e))
                        });
                    }
                    continue;
                }
                let element =
                    self.rest_argument_context(rest, i - arg_count, Some(args.len() - arg_count));
                if let Some((generic, construct)) = generic_functions[i] {
                    let ret =
                        *ret.get_or_insert_with(|| self.return_type_in_chain(file, call, sig));
                    taken_for[i] = self.generic_function_in_context(
                        &mut inference,
                        generic,
                        construct,
                        element,
                        ret,
                        from_result,
                        &mut inferred_type_params,
                    );
                    continue;
                }
                let context = if put_off[i] {
                    element
                } else {
                    self.context_for_sensitive_arg(&mut inference, element, Some((file, e)))
                };
                self.set_async_return_contexts(file, e, context, return_mapper);
                let context = self.instantiate_with_expected_result(context, return_mapper);
                self.set_context(file, e, context);
            }
            if !infers {
                continue;
            }
            if args[arg_count..]
                .iter()
                .any(|a| matches!(a, Arg::Expr(e) if self.depends_on_context(file, *e)))
            {
                self.note_so_far(&inference);
            }
            let spread =
                self.spread_argument_type(file, args, arg_count, rest, &taken_for, return_mapper);
            self.settle_after_look(&mut inference);
            for (i, &arg) in args.iter().enumerate().skip(arg_count) {
                if let Arg::Expr(e) = arg
                    && taken_for[i].is_none()
                {
                    self.note_array_literals(file, e, &mut inference.array_literals);
                }
            }
            self.infer(&mut inference, spread, rest, 0);
        }
        // Only the call under way says what is expected of a literal that a generic rest parameter collects
        // (`getSpreadArgumentType`), and the members of an object literal are not looked at before `getInferredType`.
        let early = if rest_ty.is_some_and(|rest| self.has_type_variables(rest))
            && args.iter().enumerate().skip(arg_count).any(|(i, a)| {
                !is_sensitive[i]
                    && matches!(a, Arg::Expr(e) if self.is_literal_that_depends_on_context(file, *e))
            }) {
            Some(self.inference_mapper(&inference))
        } else {
            None
        };
        self.resolving.pop();
        let mapper = match early {
            Some(mapper) => mapper,
            None => self.inference_mapper(&inference),
        };
        let sig = self.instantiate_sig(sig, mapper);
        // `getSignatureInstantiation`, with `inferredTypeParameters`
        if !inferred_type_params.is_empty() {
            let ret = self.sig_return(sig);
            if let Some((returned, construct)) = self.single_call_or_construct_signature(ret) {
                let (params, ret, this) = (
                    self.sig_params(returned),
                    self.sig_return(returned),
                    self.sig_this_type(returned),
                );
                let generalized = self.p.types.intern_sig(SigData::Synth {
                    type_params: inferred_type_params.into(),
                    params: params.into(),
                    ret,
                    this,
                    of: Box::new([]),
                });
                let ret = self.type_of_signature(generalized, construct);
                let (params, this) = (self.sig_params(sig), self.sig_this_type(sig));
                return self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: params.into(),
                    ret,
                    this,
                    of: Box::new([]),
                });
            }
        }
        sig
    }

    /// `isSignatureApplicable` in the first round of `chooseOverload`, as far as it can be told without asking anything of what
    /// waits: whether the arguments fit `params` with `early`, what has been inferred by then, filled in. In doubt they do.
    fn fits_without_sensitive(
        &mut self,
        file: FileId,
        args: &[Arg],
        params: &[SigParam],
        is_sensitive: &[bool],
        early: MapperId,
    ) -> bool {
        let hir = self.hir(file);
        // What goes into `...args: T` is held against it all together.
        let count = if self.non_array_rest_type(params).is_some() {
            (self.parameter_count(params) - 1).min(args.len())
        } else {
            args.len()
        };
        for (i, &arg) in args.iter().enumerate().take(count) {
            let Some(param) = self.param_type_at(params, i) else {
                continue;
            };
            let param = self.instantiate(param, early);
            if !self.is_known(param) {
                continue;
            }
            if !is_sensitive[i] {
                let given = self.arg_type(file, arg);
                if matches!(arg, Arg::Expr(e) if matches!(hir[e].kind, ExprKind::Missing) || self.is_uncertain(file, e))
                {
                    continue;
                }
                // `getRegularTypeOfObjectLiteral`: properties there are too many of do not count while the parameters may not be
                // all they come to.
                let given = self.regular_object(given);
                if self.is_known(given) && !self.is_assignable(given, param) {
                    return false;
                }
                continue;
            }
            // Of an object literal with functions in it: what is required is written, and what does not wait fits.
            let Arg::Expr(e) = arg else { continue };
            let ExprKind::Object(props) = hir[e].kind else {
                continue;
            };
            // The relation also covers index signatures and the members of an intersection, which the loop below does not reach.
            if !self.do_plain_members_fit(file, e, param, false) {
                return false;
            }
            let target = self.apparent_type(param);
            if !self.is_object_type(target) {
                continue;
            }
            let Some(members) = self.members(target) else {
                continue;
            };
            // With something spread into it, or a name that is only known when it runs, what it has cannot be told.
            let mut written: Vec<(Atom, PropId)> = Vec::with_capacity(props.len());
            let mut is_open = false;
            for p in props.iter() {
                match self.member_name(file, hir[p].key) {
                    Some(name) if hir[p].kind != PropKind::Spread => written.push((name, p)),
                    _ => is_open = true,
                }
            }
            if is_open {
                continue;
            }
            for wanted in &members.shape().props {
                let Some(&(_, p)) = written.iter().rev().find(|w| w.0 == wanted.name) else {
                    // What every object has need not be written.
                    let object = self.global_ref(known::Object, &[]);
                    if !wanted.flags.contains(PropFlags::OPTIONAL)
                        && self.prop_of(object, wanted.name).is_none()
                    {
                        return false;
                    }
                    continue;
                };
                let prop = &hir[p];
                if matches!(prop.kind, PropKind::Getter | PropKind::Setter) || prop.value.is_none()
                {
                    continue;
                }
                let wanted = self.type_of_prop(wanted, members.mapper);
                // Further in, the same.
                if self.is_context_sensitive(file, prop.value) {
                    if !self.do_plain_members_fit(file, prop.value, wanted, false) {
                        return false;
                    }
                    continue;
                }
                // `anyFunctionType` is related to every function type.
                if self.contains_nested_generic_function(file, prop.value) {
                    continue;
                }
                let given = self.type_of_literal_prop(file, p);
                let given = self.regular_object(given);
                if self.is_known(given)
                    && self.is_known(wanted)
                    && !self.is_assignable(given, wanted)
                {
                    return false;
                }
            }
        }
        true
    }

    /// `isGenericFunctionReturningFunction`, of some signature of what the call `e` calls, if `e` is a call without type arguments.
    fn is_call_of_generic_function_returning_function(&mut self, file: FileId, e: ExprId) -> bool {
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
        let callee = self.receiver_that_is_there(callee);
        if self.is_any(callee) {
            return false;
        }
        for sig in self.signatures(callee, false) {
            if self.sig_type_params(sig).is_empty() {
                continue;
            }
            // `isFunctionType`: an object type with something to call, whatever else it has.
            let ret = self.sig_return(sig);
            let ret = self.force(ret);
            if self.is_object_type(ret) && !self.signatures(ret, false).is_empty() {
                return true;
            }
        }
        false
    }

    /// The types of the array literals `e` is made of: what `ObjectFlagsArrayLiteral` marks.
    fn note_array_literals(&mut self, file: FileId, e: ExprId, out: &mut Vec<TypeId>) {
        if e.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Array(items) => {
                let ty = self.type_of_expr(file, e);
                if !out.contains(&ty) {
                    out.push(ty);
                }
                for item in hir.ids(items) {
                    self.note_array_literals(file, item, out);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    self.note_array_literals(file, hir[p].value, out);
                }
            }
            ExprKind::Spread(x) | ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.note_array_literals(file, x, out)
            }
            ExprKind::Cond { yes, no, .. } => {
                self.note_array_literals(file, yes, out);
                self.note_array_literals(file, no, out);
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma,
                left,
                right,
            } => {
                self.note_array_literals(file, left, out);
                self.note_array_literals(file, right, out);
            }
            _ => {}
        }
    }

    /// An object or array literal, or a choice between such.
    fn is_literal_that_depends_on_context(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(_) | ExprKind::Array(_) => true,
            ExprKind::Cond { yes, no, .. } => {
                self.is_literal_that_depends_on_context(file, yes)
                    || self.is_literal_that_depends_on_context(file, no)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma,
                left,
                right,
            } => {
                self.is_literal_that_depends_on_context(file, left)
                    || self.is_literal_that_depends_on_context(file, right)
            }
            ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.is_literal_that_depends_on_context(file, x)
            }
            _ => false,
        }
    }

    /// `getSingleSignature`: the one call (or construct) signature of `ty`, if there is none of the other kind.
    /// Without `allow_members`, if that is all there is to it.
    pub(super) fn single_signature(
        &mut self,
        ty: TypeId,
        construct: bool,
        allow_members: bool,
    ) -> Option<SigId> {
        let ty = self.force(ty);
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
        Some(self.instantiate_sig(own[0], members.mapper))
    }

    pub(super) fn single_call_signature(
        &mut self,
        ty: TypeId,
        allow_members: bool,
    ) -> Option<SigId> {
        self.single_signature(ty, false, allow_members)
    }

    /// `getSingleCallOrConstructSignature`, and whether it is one to construct with.
    fn single_call_or_construct_signature(&mut self, ty: TypeId) -> Option<(SigId, bool)> {
        match self.single_signature(ty, false, false) {
            Some(sig) => Some((sig, false)),
            None => self
                .single_signature(ty, true, false)
                .map(|sig| (sig, true)),
        }
    }

    /// `getOrCreateTypeFromSignature`
    fn type_of_signature(&self, sig: SigId, construct: bool) -> TypeId {
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

    /// The generic `sig` with its type parameters as they are when it is called the way `expected` is.
    fn instantiate_sig_in_context_of(&mut self, sig: SigId, expected: SigId) -> SigId {
        self.instantiate_sig_in_context(sig, expected, false)
    }

    /// `instantiateSignatureInContextOf`. `with_result`: what `expected` returns says something too, though less than what it takes.
    pub(super) fn instantiate_sig_in_context(
        &mut self,
        sig: SigId,
        expected: SigId,
        with_result: bool,
    ) -> SigId {
        let mut inference = Inference::new(self.sig_type_params(sig), Some(sig));
        // What `expected` takes may really be a type parameter of `sig`, adopted by the call around or in scope there:
        // `inferFromTypes` takes it for a candidate like any other.
        inference.calls_itself = true;
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
            let rest = self.params_as_tuple(&sp, param_count);
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
                let target = self.sig_return_for_inference(sig);
                if self.has_type_variables(target) {
                    let source = self.sig_return(expected);
                    self.infer(&mut inference, source, target, PRIORITY_RETURN);
                }
            }
        }
        let mapper = self.inference_mapper(&inference);
        self.instantiate_sig(sig, mapper)
    }

    /// `instantiateContextualType`, where no signature is looked for in `ty`: what waits for type parameters is what is expected of
    /// the result makes of it (`from_result`, the `returnMapper`), without `boolean`, unless that says nothing or has a hole in it.
    fn instantiate_contextual_type_from_result(
        &mut self,
        ty: TypeId,
        from_result: MapperId,
    ) -> TypeId {
        let ty = self.force(ty);
        if from_result == MapperId::IDENTITY || !self.may_be_deferred(ty) {
            return ty;
        }
        let instantiated = self.instantiate_instantiable_types(ty, from_result);
        if self.is_any(instantiated)
            || instantiated == TypeId::UNKNOWN
            || !self.is_known(instantiated)
        {
            return ty;
        }
        self.without_boolean(instantiated)
    }

    /// Whether what is given for `param` is expected to be a function that is not generic (`Some(false)`), or something that is not
    /// generic to construct (`Some(true)`), and nothing else.
    fn wants_plain_signature(&mut self, param: TypeId, from_result: MapperId) -> Option<bool> {
        let contextual = self.instantiate_contextual_type_from_result(param, from_result);
        let non_null = self.non_nullable(contextual);
        for construct in [false, true] {
            if self
                .single_signature(non_null, construct, false)
                .is_some_and(|s| self.sig_type_params(s).is_empty())
            {
                return Some(construct);
            }
        }
        None
    }

    /// The one call signature of `ty`, or else its one construct signature (`true`), if it is generic and of the kind that is wanted.
    fn single_generic_signature(
        &mut self,
        ty: TypeId,
        wants_construct: bool,
    ) -> Option<(SigId, bool)> {
        let (generic, construct) = match self.single_signature(ty, false, true) {
            Some(generic) => (generic, false),
            None => (self.single_signature(ty, true, true)?, true),
        };
        (construct == wants_construct && !self.sig_type_params(generic).is_empty())
            .then_some((generic, construct))
    }

    /// Collects the expressions in `e`, an array or object literal or an element or member of one, that
    /// `instantiateTypeWithSingleGenericCallSignature` applies to: the type has a single generic signature, and the contextual type
    /// has a single signature of the same kind without type parameters. `contextual`: the contextual type of `e`. Pushes them in
    /// source order. Does not visit operands of `?:`, `||` and `??`, spread elements and members, or computed members.
    fn collect_nested_generic_functions(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual: TypeId,
        from_result: MapperId,
        arg_index: usize,
        out: &mut Vec<NestedGenericFunction>,
    ) {
        // Nothing is inferred to a contextual type without type variables.
        if !self.has_type_variables(contextual) {
            return;
        }
        let hir = self.hir(file);
        // `getApparentTypeOfContextualType` with `ContextFlagsNoConstraints`, which `getContextualType` passes up to the enclosing
        // literals: a literal whose contextual type is a type variable gives its elements and members no contextual type.
        let contextual = if matches!(hir[e].kind, ExprKind::Array(_) | ExprKind::Object(_)) {
            let instantiated =
                self.instantiate_contextual_type_from_result(contextual, from_result);
            if matches!(
                self.data(instantiated),
                TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::IndexedAccess { .. }
            ) {
                return;
            }
            instantiated
        } else {
            contextual
        };
        match hir[e].kind {
            ExprKind::Array(items) => {
                // `getSpreadIndices`
                let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
                let (first_spread, last_spread) = (
                    hir.ids(items).position(is_spread),
                    hir.ids(items).rposition(is_spread),
                );
                for (i, item) in hir.ids(items).enumerate() {
                    if !is_spread(item)
                        && let Some(element) = self.contextual_element_at(
                            contextual,
                            i,
                            Some(items.len()),
                            first_spread,
                            last_spread,
                        )
                    {
                        self.collect_nested_generic_functions(
                            file,
                            item,
                            element,
                            from_result,
                            arg_index,
                            out,
                        );
                    }
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.value.is_some()
                        && matches!(
                            prop.kind,
                            PropKind::Init | PropKind::Shorthand | PropKind::Method
                        )
                        && let Some(name) = self.member_name(file, prop.key)
                        && let Some(member) = self.contextual_property(contextual, name)
                    {
                        self.collect_nested_generic_functions(
                            file,
                            prop.value,
                            member,
                            from_result,
                            arg_index,
                            out,
                        );
                    }
                }
            }
            kind => {
                // Only expressions whose type does not depend on the contextual type are checked here, and function expressions that
                // declare type parameters.
                let declares_type_params =
                    matches!(kind, ExprKind::Fn(f) if !hir[f].type_params.is_empty());
                if self.is_context_sensitive(file, e)
                    || !declares_type_params && self.depends_on_context(file, e)
                {
                    return;
                }
                let Some(wants_construct) = self.wants_plain_signature(contextual, from_result)
                else {
                    return;
                };
                let ty = self.type_of_expr(file, e);
                if let Some((sig, is_construct)) =
                    self.single_generic_signature(ty, wants_construct)
                {
                    out.push(NestedGenericFunction {
                        arg_index,
                        expr: e,
                        sig,
                        is_construct,
                        contextual,
                        instantiated: None,
                    });
                }
            }
        }
    }

    /// `NestedGenericFunction::instantiated` of the entry for `e` in `Resolving::nested_generic_functions` of a call being resolved.
    fn nested_generic_function(&self, file: FileId, e: ExprId) -> Option<Option<TypeId>> {
        self.resolving
            .iter()
            .rev()
            .filter(|resolving| resolving.file == file)
            .find_map(|resolving| {
                resolving
                    .nested_generic_functions
                    .iter()
                    .find(|nested| nested.expr == e)
            })
            .map(|nested| nested.instantiated)
    }

    /// The second round of `inferTypeArguments` for the generic functions in `e`, a literal argument or a part of one: instantiates
    /// those that are still skipped, in source order. Visits the same expressions as `collect_nested_generic_functions`.
    fn instantiate_nested_generic_functions(
        &mut self,
        file: FileId,
        e: ExprId,
        inference: &mut Inference,
    ) {
        if !self.contains_nested_generic_function(file, e) {
            return;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.instantiate_nested_generic_functions(file, item, inference);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    self.instantiate_nested_generic_functions(file, hir[p].value, inference);
                }
            }
            _ => {
                let Some(resolving) = self
                    .resolving
                    .last_mut()
                    .filter(|resolving| resolving.file == file && resolving.sig == inference.sig)
                else {
                    return;
                };
                let Some(outer) = resolving.sig else { return };
                let Some(&nested) = resolving
                    .nested_generic_functions
                    .iter()
                    .find(|nested| nested.expr == e && nested.instantiated.is_none())
                else {
                    return;
                };
                let (call, from_result) = (resolving.call, resolving.return_mapper);
                let mut inferred_type_params = std::mem::take(&mut resolving.inferred_type_params);
                let ret = self.return_type_in_chain(file, call, outer);
                let instantiated = self.generic_function_in_context(
                    inference,
                    nested.sig,
                    nested.is_construct,
                    nested.contextual,
                    ret,
                    from_result,
                    &mut inferred_type_params,
                );
                let Some(resolving) = self.resolving.last_mut() else {
                    return;
                };
                resolving.inferred_type_params = inferred_type_params;
                for entry in resolving
                    .nested_generic_functions
                    .iter_mut()
                    .filter(|entry| entry.expr == e)
                {
                    entry.instantiated = instantiated;
                }
                // Without a contextual signature the function keeps its generic type.
                if instantiated.is_none() {
                    resolving
                        .nested_generic_functions
                        .retain(|entry| entry.expr != e);
                }
            }
        }
    }

    /// Whether `e` has an entry in `Resolving::nested_generic_functions`, or is a literal with such an element or member. Visits the
    /// same expressions as `collect_nested_generic_functions`.
    fn contains_nested_generic_function(&self, file: FileId, e: ExprId) -> bool {
        if e.is_none()
            || self
                .resolving
                .iter()
                .all(|resolving| resolving.nested_generic_functions.is_empty())
        {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Array(items) => hir
                .ids(items)
                .any(|item| self.contains_nested_generic_function(file, item)),
            ExprKind::Object(props) => props.iter().any(|p| {
                matches!(
                    hir[p].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && self.contains_nested_generic_function(file, hir[p].value)
            }),
            _ => self.nested_generic_function(file, e).is_some(),
        }
    }

    /// Whether the first round of `inferTypeArguments` leaves out `e` or a part of it (`CheckModeSkipContextSensitive`,
    /// `CheckModeSkipGenericFunctions`).
    fn is_skipped_in_first_round(&self, file: FileId, e: ExprId) -> bool {
        self.is_context_sensitive(file, e) || self.contains_nested_generic_function(file, e)
    }

    /// Infers from `generic`, which is given for `param`, as what `generic_function_in_context` makes of it.
    fn infer_from_generic_function(
        &mut self,
        inference: &mut Inference,
        generic: SigId,
        construct: bool,
        param: TypeId,
        ret: TypeId,
        from_result: MapperId,
        inferred_type_params: &mut Vec<TypeId>,
    ) {
        if let Some(ty) = self.generic_function_in_context(
            inference,
            generic,
            construct,
            param,
            ret,
            from_result,
            inferred_type_params,
        ) {
            self.infer(inference, ty, param, 0);
        }
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

    /// `getUniqueTypeParameters`: `own`, with a renamed clone for each type parameter whose name occurs in `inferred` or earlier in
    /// `own`. The mapper of a renamed clone (`cloneTypeParameter`) maps the fresh string literal type of the declared name to the string
    /// literal type of the new name. Instantiation only looks up type parameters, so that entry never reaches a type.
    /// `clone_mapper` resolves the siblings of a clone with the mapper of the clone, so if one of `own` is renamed, all of them are
    /// cloned with the same mapper, and those that keep their name only change identity.
    /// `None`: the renamed clones cannot be represented.
    fn unique_type_params(&self, inferred: &[TypeId], own: &[TypeId]) -> Option<Vec<TypeId>> {
        let mut names: Vec<Atom> = inferred
            .iter()
            .filter_map(|&param| self.type_param_name(param))
            .collect();
        let mut renames: Vec<(TypeId, TypeId)> = Vec::new();
        for &param in own {
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
                augmented.extend_from_slice(index.to_string().as_bytes());
                let augmented = self.files().atoms.intern(&augmented);
                if !names.contains(&augmented) {
                    break augmented;
                }
                index += 1;
            };
            names.push(unique);
            let (_, declaration) = self.type_param_decl(param)?;
            renames.push((
                self.string_literal(declaration.name, true),
                self.string_literal(unique, false),
            ));
        }
        if renames.is_empty() {
            return Some(own.to_vec());
        }
        let mut unique = Vec::with_capacity(own.len());
        for (i, &param) in own.iter().enumerate() {
            let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
                return None;
            };
            // The entries are keyed by declared name, so two clones of one declaration would collapse into one type parameter. Only
            // the type parameters of a function know their siblings (`clone_mapper`).
            let is_declared_twice = own[..i].iter().any(|&other| matches!(*self.data(other), TypeData::TypeParam(f, t, _) if (f, t) == (file, tp)));
            let scope = self.bound(file).type_param_scope[tp.idx()];
            if is_declared_twice
                || scope.is_none()
                || !matches!(
                    self.bound(file).scopes[scope.idx()].kind,
                    crate::bind::ScopeKind::Fn(_)
                )
            {
                return None;
            }
            let mut pairs = self.p.types.mapping(around).to_vec();
            pairs.retain(|pair| !renames.iter().any(|rename| rename.0 == pair.0));
            pairs.extend(renames.iter().copied());
            unique.push(self.cloned_type_param(file, tp, self.p.types.mapper(pairs)));
        }
        Some(unique)
    }

    /// `instantiateTypeWithSingleGenericCallSignature`, once nothing is put off any more: what `generic`, the signature of a
    /// generic function, or of something generic to construct (`construct`), that is given for `param`, is inferred from as.
    /// `ret`: what the signature that is inferred for returns.
    fn generic_function_in_context(
        &mut self,
        inference: &mut Inference,
        generic: SigId,
        construct: bool,
        param: TypeId,
        ret: TypeId,
        from_result: MapperId,
        inferred_type_params: &mut Vec<TypeId>,
    ) -> Option<TypeId> {
        let own = self.sig_type_params(generic);
        let contextual_type = self.instantiate_contextual_type_from_result(param, from_result);
        let non_null = self.non_nullable(contextual_type);
        // Its type parameters can become those of the function that is returned, renamed where their names are taken.
        if self
            .single_call_or_construct_signature(ret)
            .is_some_and(|(s, _)| self.sig_type_params(s).is_empty())
            && let Some(contextual) = self.single_signature(non_null, construct, false)
            && let Some(unique) = self.unique_type_params(inferred_type_params, &own)
        {
            let renamed = if unique == own {
                generic
            } else {
                self.with_own_type_params(generic, &own, &unique)
            };
            if self.adopt_generic_argument(inference, renamed, contextual) {
                inferred_type_params.extend(unique);
                // With them standing for themselves it is then inferred from like any argument.
                let (params, ret, this) = (
                    self.sig_params(renamed),
                    self.sig_return(renamed),
                    self.sig_this_type(renamed),
                );
                let plain = self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: params.into(),
                    ret,
                    this,
                    of: Box::new([]),
                });
                return Some(self.type_of_signature(plain, construct));
            }
        }
        // `applyToParameterTypes`: of what is expected to be taken, as much is looked at as the function takes.
        let taken = self.sig_params(generic);
        let takes_rest = self.effective_rest_type(&taken).is_some();
        let count = self.parameter_count(&taken) - usize::from(takes_rest);
        // A type parameter that is all that is expected is not settled by what the expected result makes of it.
        let context = self.context_for_sensitive_arg_taking(
            inference,
            contextual_type,
            None,
            Some((vec![true; count], takes_rest)),
        );
        let context = self.non_nullable(context);
        let expected = self.single_signature(context, construct, false)?;
        let sig = self.instantiate_sig_in_context_of(generic, expected);
        Some(self.type_of_signature(sig, construct))
    }

    /// `instantiateTypeWithSingleGenericCallSignature`, of `e`, which is a `ty` as it is written and stands inside an argument that is
    /// looked at to infer from: a generic function, or something generic to construct, where one that is not generic is expected
    /// is what it is when called the way that is expected. That holds for the inference, not for `e`.
    pub(super) fn instantiate_generic_function_in_context(
        &mut self,
        file: FileId,
        e: ExprId,
        ty: TypeId,
    ) -> TypeId {
        // The second round has instantiated a generic function inside a literal argument. The members of an object literal are
        // typed on demand, so this does not depend on `is_inferential`.
        if let Some(Some(instantiated)) = self.nested_generic_function(file, e) {
            return instantiated;
        }
        let Some((at, is_returned)) = self.inference_around(file, e) else {
            return ty;
        };
        let (outer, so_far, from_result) = (
            self.resolving[at].sig,
            self.resolving[at].so_far,
            self.resolving[at].return_mapper,
        );
        let (generic, construct) = match self.single_signature(ty, false, true) {
            Some(generic) => (generic, false),
            None => match self.single_signature(ty, true, true) {
                Some(generic) => (generic, true),
                None => return ty,
            },
        };
        if self.sig_type_params(generic).is_empty() {
            return ty;
        }
        let Some(context) = self.contextual_type(file, e) else {
            return ty;
        };
        let contextual = self.instantiate_contextual_type_from_result(context, from_result);
        let non_null = self.non_nullable(contextual);
        let Some(expected) = self.single_signature(non_null, construct, false) else {
            return ty;
        };
        if !self.sig_type_params(expected).is_empty() {
            return ty;
        }
        let wanted = self.sig_params(expected);
        // Where its type parameters would become those of a function that is returned it stays as it is: only
        // `generic_function_in_context` adopts type parameters, for an argument and for what `collect_nested_generic_functions` finds.
        // They would where it says something of type parameters nothing is known of yet, and nothing of any other
        // (`hasOverlappingInferences`).
        if let Some(outer) = outer
            && self
                .p
                .types
                .mapping(so_far)
                .iter()
                .any(|pair| pair.1 == TypeId::UNRESOLVED)
        {
            let ret = self.sig_return(outer);
            if self
                .single_call_or_construct_signature(ret)
                .is_some_and(|(s, _)| self.sig_type_params(s).is_empty())
            {
                let returned = self.sig_return(expected);
                let (mut says_something, mut overlaps) = (false, false);
                for &(param, known) in self.p.types.mapping(so_far) {
                    let is_taken = wanted.iter().any(|p| self.mentions(p.ty, param, 0));
                    says_something |= is_taken;
                    overlaps |= known != TypeId::UNRESOLVED
                        && (is_taken || self.mentions(returned, param, 0));
                }
                if says_something && !overlaps {
                    return ty;
                }
            }
        }
        // `applyToParameterTypes`: of what is expected to be taken, as much is looked at as the function takes.
        let taken = self.sig_params(generic);
        let takes_rest = self.effective_rest_type(&taken).is_some();
        let count = self.parameter_count(&taken) - usize::from(takes_rest);
        let mut looked_at: Vec<TypeId> = wanted
            .iter()
            .enumerate()
            .filter(|&(i, _)| takes_rest || i < count)
            .map(|(_, p)| p.ty)
            .collect();
        looked_at.extend(self.sig_this_type(expected));
        // `context.mapper`: the type parameters in that are settled on what they come to as things stand.
        let failing_that = self.resolving[at].outer_return_mapper;
        let mut settled: Vec<(TypeId, TypeId)> = Vec::new();
        for &(param, known) in self.p.types.mapping(so_far) {
            if !looked_at.iter().any(|&part| self.mentions(part, param, 0)) {
                continue;
            }
            let known = if known != TypeId::UNRESOLVED {
                known
            } else if is_returned {
                // Nothing is known of it: what it defaults to or extends, or `unknown`.
                self.p
                    .types
                    .map(failing_that, param)
                    .unwrap_or(TypeId::UNKNOWN)
            } else {
                // What stands in a literal waits for the other arguments (`CheckModeSkipGenericFunctions`), which may be yet to come.
                return ty;
            };
            if !self.is_known(known) {
                return ty;
            }
            settled.push((param, known));
        }
        // `instantiateSignatureInContextOf`: with `...args: T` nothing is settled (`nonFixingMapper`).
        let is_open = self
            .effective_rest_type(&wanted)
            .is_some_and(|rest| matches!(self.data(rest), TypeData::TypeParam(..)));
        if !is_open {
            self.resolving[at].settles.extend(settled.iter().copied());
        }
        let mapper = self.p.types.mapper(settled);
        let expected = self.instantiate_sig(expected, mapper);
        let sig = self.instantiate_sig_in_context_of(generic, expected);
        self.type_of_signature(sig, construct)
    }

    /// `getInferenceContext`, where the check mode is `CheckModeInferential`: which of the calls being resolved `e` is looked at to infer
    /// the type arguments of, and whether it is (in) what a function returns, which `getReturnTypeFromBody` looks at without
    /// `CheckModeSkipGenericFunctions`. `e` stands in a literal, or is returned by a function, that is (part of) an argument of
    /// the call. An argument itself, or one of the alternatives it is, waits for the others instead.
    fn inference_around(&self, file: FileId, e: ExprId) -> Option<(usize, bool)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut at, mut is_inside, mut is_returned) = (e, false, false);
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    let is_member = matches!(
                        hir[p].kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Method
                    );
                    if !is_member || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return None;
                    }
                    is_inside = true;
                    owner
                }
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != at => {
                        if !is_inside {
                            return None;
                        }
                        let found = self
                            .resolving
                            .iter()
                            .rposition(|r| r.file == file && r.call == parent)?;
                        return self.resolving[found]
                            .is_inferential
                            .then_some((found, is_returned));
                    }
                    ExprKind::Array(_) => {
                        is_inside = true;
                        parent
                    }
                    ExprKind::Cond { test, .. } if test != at => parent,
                    ExprKind::Binary {
                        op: BinOp::Or | BinOp::Nullish,
                        ..
                    } => parent,
                    ExprKind::Binary {
                        op: BinOp::And | BinOp::Comma,
                        right,
                        ..
                    } if right == at => parent,
                    _ => return None,
                },
                // `getReturnTypeFromBody`: what a function that does not say what it returns returns.
                parent @ (Parent::FnBody(_) | Parent::Stmt(_)) => {
                    if let Parent::Stmt(s) = parent
                        && (s.is_none() || !matches!(hir[s].kind, StmtKind::Return(_)))
                    {
                        return None;
                    }
                    let func = self.enclosing_fn(file, parent)?;
                    let FnOwner::Expr(function) = bound.fns[func.idx()].owner else {
                        return None;
                    };
                    if hir[func].ret.is_some() {
                        return None;
                    }
                    (is_inside, is_returned) = (true, true);
                    function
                }
                _ => return None,
            };
        }
    }

    /// `getNarrowableTypeForReference` under `CheckModeInferential`: the type of the reference `e`, which has been looked at, with its
    /// type variables kept where otherwise what they extend stands in for them. `None`: it is no reference, or none is in
    /// scope where it stands.
    fn type_of_reference_to_infer_from(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) {
            return None;
        }
        let scope = self.scope_of_expr(file, e);
        if !self
            .outer_type_params(file, scope)
            .iter()
            .any(|&p| matches!(self.data(p), TypeData::TypeParam(..)))
        {
            return None;
        }
        let around = self.inferential.replace((file, e));
        let ty = self.type_of_expr_uncached(file, e);
        self.inferential = around;
        let ty = self.force(ty);
        self.is_known(ty).then_some(ty)
    }

    /// The second branch of `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`, for the functions in `e`, which is expected
    /// to be `expected`: one that waits for nothing, and has fewer parameters than are expected of it, says by the types it
    /// writes what is expected.
    fn infer_from_annotated_functions(
        &mut self,
        file: FileId,
        e: ExprId,
        expected: TypeId,
        inference: &mut Inference,
    ) {
        if !self.has_type_variables(expected) {
            return;
        }
        let hir = self.hir(file);
        let may_hold_one = |x: ExprId| {
            matches!(
                hir[x].kind,
                ExprKind::Fn(_)
                    | ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { .. }
            )
        };
        match hir[e].kind {
            ExprKind::Fn(func) => {
                if !hir[func].type_params.is_empty() || self.is_context_sensitive(file, e) {
                    return;
                }
                // `NodeCheckFlagsContextChecked`: only the attempt that checks the function first infers from its annotations.
                if let Some(&first) = self.context_checked_for.get(&(file, e))
                    && first != inference.sig
                {
                    return;
                }
                // `getContextualSignature`: `instantiateContextualType` with `ContextFlagsSignature`, then the apparent type. The
                // constraint of a type parameter can mention the type parameters being inferred.
                let expected = self.instantiate_instantiable_for_signature(inference, expected);
                let non_null = self.non_nullable(expected);
                let contextual = self.contextual_signature_in(file, func, non_null);
                // `len(node.Parameters())` counts a `this` that is written.
                let own = hir[func].params.len() + usize::from(hir[func].this_ty.is_some());
                if let Some(contextual) = contextual
                    && self.sig_params(contextual).len() > own
                {
                    self.infer_from_annotated_parameters_and_return(
                        file, func, contextual, inference,
                    );
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.value.is_none() || !may_hold_one(prop.value) {
                        continue;
                    }
                    match prop.kind {
                        // What is spread is expected to be what the literal is.
                        PropKind::Spread => self
                            .infer_from_annotated_functions(file, prop.value, expected, inference),
                        PropKind::Init | PropKind::Method => {
                            if let Some(name) = self.member_name(file, prop.key)
                                && let Some(member) = self.contextual_property(expected, name)
                            {
                                self.infer_from_annotated_functions(
                                    file, prop.value, member, inference,
                                );
                            }
                        }
                        _ => {}
                    }
                }
            }
            ExprKind::Array(items) => {
                // `getSpreadIndices`
                let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
                let (first_spread, last_spread) = (
                    hir.ids(items).position(is_spread),
                    hir.ids(items).rposition(is_spread),
                );
                for (i, item) in hir.ids(items).enumerate() {
                    if may_hold_one(item)
                        && let Some(element) = self.contextual_element_at(
                            expected,
                            i,
                            Some(items.len()),
                            first_spread,
                            last_spread,
                        )
                    {
                        self.infer_from_annotated_functions(file, item, element, inference);
                    }
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.infer_from_annotated_functions(file, yes, expected, inference);
                self.infer_from_annotated_functions(file, no, expected, inference);
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.infer_from_annotated_functions(file, left, expected, inference);
                self.infer_from_annotated_functions(file, right, expected, inference);
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Comma,
                right,
                ..
            } => self.infer_from_annotated_functions(file, right, expected, inference),
            _ => {}
        }
    }

    /// `checkExpressionWithContextualType` for `e`, an argument or a part of one that type arguments are inferred from.
    fn type_of_expr_for_inference(&mut self, file: FileId, e: ExprId) -> TypeId {
        let ty = self.type_of_expr(file, e);
        if self.resolving.last().is_some_and(|r| r.is_inferential) {
            self.resolve_return_types_in(file, e);
        }
        ty
    }

    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` resolves the return type of a function expression that has a
    /// contextual signature and no return type annotation when the function is first checked, in the check mode of that check
    /// (`getReturnTypeFromBody(node, checkMode)`), and caches it. The type of a function expression is lazy here, so this resolves
    /// the return types of the function expressions in `e` while the check mode is still `CheckModeInferential`.
    fn resolve_return_types_in(&mut self, file: FileId, e: ExprId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Fn(func) => {
                // `NodeCheckFlagsContextChecked` is set before the body is looked at.
                if hir[func].ret.is_some()
                    || self.stack.contains(&Query::Return(file, func))
                    || self.contextual_signature(file, func).is_none()
                {
                    return;
                }
                self.return_type_of_fn(file, func);
                // `getReturnTypeFromBody` checks the returned expressions in the same check mode.
                match hir[func].body {
                    FnBody::Expr(body) => self.resolve_return_types_in(file, body),
                    FnBody::Block(_) => {
                        for s in bound.ids(bound.fns[func.idx()].returns) {
                            if let StmtKind::Return(value) = hir[s].kind
                                && value.is_some()
                            {
                                self.resolve_return_types_in(file, value);
                            }
                        }
                    }
                    FnBody::None => {}
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.value.is_some()
                        && !matches!(prop.kind, PropKind::Getter | PropKind::Setter)
                    {
                        self.resolve_return_types_in(file, prop.value);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.resolve_return_types_in(file, item);
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.resolve_return_types_in(file, yes);
                self.resolve_return_types_in(file, no);
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma,
                left,
                right,
            } => {
                self.resolve_return_types_in(file, left);
                self.resolve_return_types_in(file, right);
            }
            ExprKind::Spread(x) | ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.resolve_return_types_in(file, x)
            }
            _ => {}
        }
    }

    /// Sets the state of `NodeCheckFlagsContextChecked` for the function expressions in the argument `e`. Visits the same expressions
    /// as `infer_from_annotated_functions`. Returns whether `e` contains a function expression.
    fn set_context_checked(&mut self, file: FileId, e: ExprId, state: ContextChecked) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Fn(_) => {
                match state {
                    ContextChecked::No => self.context_checked_for.remove(&(file, e)),
                    ContextChecked::By(candidate) => {
                        self.context_checked_for.insert((file, e), Some(candidate))
                    }
                    ContextChecked::ByEndedAttempt => {
                        self.context_checked_for.insert((file, e), None)
                    }
                };
                true
            }
            ExprKind::Object(props) => {
                let mut found = false;
                for p in props.iter() {
                    if hir[p].value.is_some() {
                        found |= self.set_context_checked(file, hir[p].value, state);
                    }
                }
                found
            }
            ExprKind::Array(items) => {
                let mut found = false;
                for item in hir.ids(items) {
                    found |= self.set_context_checked(file, item, state);
                }
                found
            }
            ExprKind::Cond { yes, no, .. } => {
                self.set_context_checked(file, yes, state)
                    | self.set_context_checked(file, no, state)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.set_context_checked(file, left, state)
                    | self.set_context_checked(file, right, state)
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Comma,
                right,
                ..
            } => self.set_context_checked(file, right, state),
            _ => false,
        }
    }

    /// `getContextualTypeForReturnExpression` for the async function `e`, whose contextual type `context` still mentions the type
    /// parameters being inferred. tsgo filters and awaits the uninstantiated return type of the contextual signature, and applies
    /// `returnMapper` last (`instantiateContextualType`). The contextual type recorded for `e` has `return_mapper` applied already,
    /// so the contextual type of each returned expression is recorded separately.
    fn set_async_return_contexts(
        &mut self,
        file: FileId,
        e: ExprId,
        context: TypeId,
        return_mapper: MapperId,
    ) {
        // A recorded context is permanent, so a candidate that can still be rejected records nothing.
        if return_mapper == MapperId::IDENTITY || self.resolving.last().is_some_and(|r| r.is_trial)
        {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Fn(func) = hir[e].kind else {
            return;
        };
        let f = &hir[func];
        if !f.flags.contains(Flags::ASYNC) || f.flags.contains(Flags::GENERATOR) || f.ret.is_some()
        {
            return;
        }
        let Some(contextual) = self.contextual_signature_in(file, func, context) else {
            return;
        };
        let declared = self.sig_return(contextual);
        let declared = self.force(declared);
        if !self.has_type_variables(declared) {
            return;
        }
        // `getContextualReturnType`
        let promise_like = self.filter(declared, |c, t| {
            c.is_any(t)
                || t == TypeId::UNKNOWN
                || t == TypeId::VOID
                || c.is_instantiable_non_primitive(t)
                || c.thenable_value(t)
                    .is_some_and(|promised| c.awaited_or_none(promised).is_some())
        });
        let Some(awaited) = self.awaited_no_alias(promise_like) else {
            return;
        };
        if awaited == TypeId::UNRESOLVED {
            return;
        }
        let promise = self.global_ref(known::PromiseLike, &[awaited]);
        let uninstantiated = self.union(&[awaited, promise]);
        let expected = self.instantiate_with_expected_result(uninstantiated, return_mapper);
        // If `return_mapper` maps none of these type parameters, the order of the steps makes no difference.
        if expected == uninstantiated {
            return;
        }
        match f.body {
            FnBody::Expr(body) => self.set_context_if_unset(file, body, expected),
            FnBody::Block(_) => {
                for s in bound.ids(bound.fns[func.idx()].returns) {
                    if let StmtKind::Return(value) = hir[s].kind
                        && value.is_some()
                    {
                        self.set_context_if_unset(file, value, expected);
                    }
                }
            }
            FnBody::None => {}
        }
    }

    /// `set_context`, unless a context is recorded for `e`. The table for provisional contexts replaces an entry, the permanent one does not.
    fn set_context_if_unset(&mut self, file: FileId, e: ExprId, context: TypeId) {
        if self.explicit_context(file, e).is_none() {
            self.set_context(file, e, context);
        }
    }

    /// Records the contextual type of `e`, which takes precedence over the one derived from the parent of `e`. The first context
    /// recorded for `e` stays (`NodeCheckFlagsContextChecked`): a later call changes nothing, except while the result is provisional.
    fn set_context(&mut self, file: FileId, e: ExprId, context: TypeId) {
        if self.keeps_arg_contexts {
            return;
        }
        let context = self.without_no_infer(context);
        if !self.is_provisional_here() {
            self.p.arg_contexts.insert((file, e), context);
        } else {
            self.provisional_arg_contexts.insert((file, e), context);
        }
    }

    /// What `e` was settled to be expected to be.
    pub(super) fn explicit_context(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if self.provisional > 0
            && let Some(&known) = self.provisional_arg_contexts.get(&(file, e))
        {
            self.note_provisional_read();
            return Some(known);
        }
        self.p.arg_contexts.get(&(file, e))
    }

    /// Infers from the properties of an object literal, or the attributes of a JSX element, given for `param`: from those
    /// with parameters waiting for their types (`sensitive`), or from the others. The former go one by one in the order
    /// written: each is told what is known by then, and adds to what the next is told.
    pub(super) fn infer_from_members(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        param: TypeId,
        inference: &mut Inference,
        return_mapper: MapperId,
        sensitive: bool,
    ) {
        let hir = self.hir(file);
        // `getApparentTypeOfContextualType`, on the way from a function to its signature: the literal around it is expected to be
        // what `param` comes to as things stand.
        let param = if sensitive {
            self.instantiate_instantiable_for_signature(inference, param)
        } else {
            param
        };
        // `getApparentTypeOfContextualType` discriminates a union by the members of the literal, also during inference. Only the
        // context sensitive members read `param` as a contextual type. For the others it is the inference target, which stays the
        // whole union (`inferToMultipleTypes`).
        let param = match props
            .iter()
            .next()
            .map(|first| self.bound(file).prop_owner[first.idx()])
        {
            Some(owner) if sensitive && owner.is_some() && self.is_union(param) => {
                match hir[owner].kind {
                    ExprKind::Object(_) => self.discriminate_by_object_members(file, owner, param),
                    ExprKind::Jsx(_) => self.discriminate_by_jsx_attributes(file, owner, param),
                    _ => param,
                }
            }
            _ => param,
        };
        // `checkObjectLiteral`: what is spread is not put off (`checkMode & CheckModeInferential`). The functions in it are told now
        // what is known now, before anything else in the literal has had its say.
        if !sensitive {
            for p in props.iter() {
                let prop = &hir[p];
                if prop.kind == PropKind::Spread
                    && let ExprKind::Object(inner) = hir[prop.value].kind
                    && self.is_context_sensitive(file, prop.value)
                {
                    self.infer_from_members(file, inner, param, inference, return_mapper, true);
                }
            }
        }
        for p in props.iter() {
            let prop = &hir[p];
            if matches!(prop.kind, PropKind::Getter | PropKind::Setter) {
                // `checkObjectLiteral`: an accessor makes a property like any other, which waits for nothing.
                if !sensitive
                    && !self.is_setter_beside_getter(file, props, p)
                    && let Some(name) = self.member_name(file, prop.key)
                    && let Some(member_param) = self.contextual_property(param, name)
                    && self.has_type_variables(member_param)
                {
                    let ty = self.type_of_literal_prop(file, p);
                    self.infer(inference, ty, member_param, 0);
                }
                continue;
            }
            let is_sensitive = prop.value.is_some() && self.is_context_sensitive(file, prop.value);
            if prop.kind == PropKind::Spread {
                if is_sensitive {
                    // The rest of it, along with the rest of the literal.
                    if !sensitive && let ExprKind::Object(inner) = hir[prop.value].kind {
                        self.infer_from_members(
                            file,
                            inner,
                            param,
                            inference,
                            return_mapper,
                            false,
                        );
                    }
                    continue;
                }
                // Property by property, like what is written out: a part of the object is no candidate for the whole.
                if !sensitive {
                    let ty = self.type_of_expr(file, prop.value);
                    for part in self.parts(ty).to_vec() {
                        if self.is_primitive(part) || self.is_any(part) {
                            continue;
                        }
                        let Some(members) = self.members(part) else {
                            continue;
                        };
                        for spread in members.shape().props.clone() {
                            if let Some(member_param) = self.contextual_property(param, spread.name)
                                && self.has_type_variables(member_param)
                            {
                                let ty = self.type_of_prop(&spread, members.mapper);
                                self.infer(inference, ty, member_param, 0);
                            }
                        }
                    }
                }
                continue;
            }
            // The second round instantiates a generic function when it reaches the member, and infers from it when the literal
            // argument is checked as a whole.
            let holds_generic_function =
                !is_sensitive && self.contains_nested_generic_function(file, prop.value);
            if holds_generic_function && sensitive {
                self.instantiate_nested_generic_functions(file, prop.value, inference);
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let Some(member_param) = self.contextual_property(param, name) else {
                continue;
            };
            if !self.has_type_variables(member_param) {
                continue;
            }
            // `CheckModeSkipGenericFunctions`: the first round infers nothing from a generic function.
            if holds_generic_function {
                self.infer_from_literal(
                    file,
                    prop.value,
                    member_param,
                    inference,
                    return_mapper,
                    false,
                );
                continue;
            }
            if is_sensitive
                && self.infer_from_literal(
                    file,
                    prop.value,
                    member_param,
                    inference,
                    return_mapper,
                    sensitive,
                )
            {
                if sensitive {
                    self.infer_from_whole_literal(
                        file,
                        prop.value,
                        member_param,
                        inference,
                        return_mapper,
                    );
                }
                continue;
            }
            if is_sensitive != sensitive {
                continue;
            }
            // What may be left out may be `undefined`, which then says nothing about the type parameters.
            let is_optional = self.parts(param).to_vec().into_iter().any(|part| {
                let part = self.apparent_type(part);
                self.prop_of(part, name)
                    .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
            });
            self.optional_member = is_optional;
            self.infer_from_member(
                file,
                prop.value,
                member_param,
                inference,
                return_mapper,
                sensitive,
            );
            self.optional_member = false;
        }
    }

    /// Whether `p`, a member of the object literal `props`, is a setter that goes with a getter: the two are one property, and the
    /// getter says what it is.
    fn is_setter_beside_getter(&mut self, file: FileId, props: Span<PropId>, p: PropId) -> bool {
        let hir = self.hir(file);
        if hir[p].kind != PropKind::Setter {
            return false;
        }
        let name = self.member_name(file, hir[p].key);
        name.is_some()
            && props.iter().any(|q| {
                hir[q].kind == PropKind::Getter && self.member_name(file, hir[q].key) == name
            })
    }

    /// `value` is `NONE` for `<a b />`.
    pub(super) fn infer_from_member(
        &mut self,
        file: FileId,
        value: ExprId,
        member_param: TypeId,
        inference: &mut Inference,
        return_mapper: MapperId,
        sensitive: bool,
    ) {
        if value.is_none() {
            self.infer(inference, TypeId::TRUE, member_param, 0);
            return;
        }
        if sensitive {
            let context =
                self.context_for_sensitive_arg(inference, member_param, Some((file, value)));
            self.set_async_return_contexts(file, value, context, return_mapper);
            let context = self.instantiate_with_expected_result(context, return_mapper);
            self.set_context(file, value, context);
        } else if self.depends_on_context(file, value)
            && !self
                .resolving
                .last()
                .is_some_and(|r| r.sig == inference.sig && r.is_trial)
        {
            // `instantiateContextualType`: only a function is told what has been inferred so far. What is given for a type parameter
            // goes by what is expected of the result, or else by what the type parameter extends. That is said before it is looked
            // at, and stays: what is inferred from it cannot be what is expected of it. What the type parameter extends may be
            // yet to be inferred itself: then it is left to what the literal around is expected to be in the end.
            let (mut is_open, mut is_bounded) = (false, false);
            for &part in self.parts(member_param) {
                if inference.params.contains(&part) {
                    is_open = true;
                    is_bounded |= self
                        .constraint_of_type_param(part)
                        .is_some_and(|constraint| !self.has_type_variables(constraint));
                }
            }
            if is_open {
                let context = self.instantiate_with_expected_result(member_param, return_mapper);
                if is_bounded || context != member_param {
                    self.set_context(file, value, context);
                }
            }
        }
        let is_optional = std::mem::take(&mut self.optional_member);
        // The functions in it that wait for nothing are looked at along with it.
        if !sensitive {
            self.infer_from_annotated_functions(file, value, member_param, inference);
        }
        let ty = if self.depends_on_context(file, value) {
            self.with_so_far(file, inference, |c| {
                c.type_of_expr_for_inference(file, value)
            })
        } else {
            self.type_of_expr(file, value)
        };
        // `CheckModeSkipGenericFunctions`: in the first round a generic function where one that is not generic is expected says
        // nothing (`anyFunctionType`). It has its say when the literal around it is looked at as a whole.
        if !sensitive
            && self.is_object_type(ty)
            && self
                .resolving
                .last()
                .is_some_and(|r| r.sig == inference.sig && r.call.is_some())
            && let Some(wants_construct) = self.wants_plain_signature(member_param, return_mapper)
            && self.single_generic_signature(ty, wants_construct).is_some()
        {
            return;
        }
        self.note_array_literals(file, value, &mut inference.array_literals);
        let target = if is_optional {
            self.optional(member_param)
        } else {
            member_param
        };
        self.infer(inference, ty, target, 0);
    }

    /// `addIntraExpressionInferenceSite`, of `value`, a literal whose parts have been gone through: as a whole it has its say as well
    /// before what is written after it is looked at. What it is expected to be is said first, as things stand, and stays: what
    /// is inferred from it cannot be what is expected of it. Nothing is settled on its account.
    fn infer_from_whole_literal(
        &mut self,
        file: FileId,
        value: ExprId,
        param: TypeId,
        inference: &mut Inference,
        return_mapper: MapperId,
    ) {
        let mut as_things_stand = inference.clone();
        let context =
            self.context_for_sensitive_arg(&mut as_things_stand, param, Some((file, value)));
        let context = self.instantiate_with_expected_result(context, return_mapper);
        self.set_context(file, value, context);
        let ty = self.with_so_far(file, inference, |c| {
            c.type_of_expr_for_inference(file, value)
        });
        self.note_array_literals(file, value, &mut inference.array_literals);
        self.infer(inference, ty, param, 0);
    }

    /// Looks at a part of an argument that what is expected of it matters to, with the calls inside it told what is known of the
    /// type parameters by now.
    fn with_so_far(
        &mut self,
        file: FileId,
        inference: &mut Inference,
        look: impl FnOnce(&mut Self) -> TypeId,
    ) -> TypeId {
        // The attributes of a JSX element are gone through without anything having been said of its component.
        let is_noted = self
            .resolving
            .last()
            .is_some_and(|r| r.sig == inference.sig);
        if !is_noted {
            self.resolving.push(Resolving::new(
                file,
                ExprId::NONE,
                inference.sig,
                Vec::new(),
                MapperId::IDENTITY,
            ));
        }
        self.note_so_far(inference);
        let ty = look(self);
        self.settle_after_look(inference);
        if !is_noted {
            self.resolving.pop();
        }
        ty
    }

    /// `node.Type() == nil && !HasContextSensitiveParameters(node)`, the condition for `returnOnlyType` in
    /// `checkFunctionExpressionOrObjectLiteralMethod`. Async functions and generators are not supported and return false.
    fn is_return_only_function(&self, file: FileId, f: FnId) -> bool {
        let hir = self.hir(file);
        let func = &hir[f];
        func.ret.is_none()
            && func.type_params.is_empty()
            && !func.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && !func.params.iter().any(|p| hir[p].ty.is_none())
            // A function that is not an arrow function has an implicit `this` parameter if it uses `this`.
            && (func.kind == FnKind::Arrow || func.this_ty.is_some() || !self.bound(file).fns[f.idx()].contains_this)
    }

    /// The expression body of `f`, if `is_return_only_function`.
    fn body_of_return_only_function(&self, file: FileId, f: FnId) -> Option<ExprId> {
        let FnBody::Expr(body) = self.hir(file)[f].body else {
            return None;
        };
        self.is_return_only_function(file, f).then_some(body)
    }

    /// The literal `e` is, or that `e`, a function that takes nothing from where it stands itself, returns; and what that literal
    /// is expected to be, given that `e` is expected to be a `param`.
    /// (`checkFunctionExpressionOrObjectLiteralMethod` under `CheckModeSkipContextSensitive`: `returnOnlyType`.)
    fn literal_that_waits(
        &mut self,
        file: FileId,
        e: ExprId,
        param: TypeId,
    ) -> Option<(ExprId, TypeId)> {
        match self.hir(file)[e].kind {
            ExprKind::Object(_) | ExprKind::Array(_) => Some((e, param)),
            ExprKind::Fn(f) => {
                let body = self.body_of_return_only_function(file, f)?;
                let non_null = self.non_nullable(param);
                let expected = self.single_call_signature(non_null, true)?;
                if !self.sig_type_params(expected).is_empty() {
                    return None;
                }
                let ret = self.sig_return(expected);
                if !self.has_type_variables(ret) {
                    return None;
                }
                self.literal_that_waits(file, body, ret)
            }
            _ => None,
        }
    }

    /// Whether what is in `ty`, or in a member of it, cannot be told before its type parameters are known: a mapped type whose
    /// keys are not known yet, a conditional type that is not decided.
    fn is_inferred_to_as_a_whole(&mut self, ty: TypeId) -> bool {
        let ty = self.force(ty);
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.is_inferred_to_as_a_whole(p))
            }
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => self.is_generic(ty),
            TypeData::Cond { .. } => true,
            _ => false,
        }
    }

    /// Infers from what is inside `e`, a literal with functions in it that wait for their context, or a function that returns
    /// one, given for `param`: from those functions one by one (`sensitive`), or from everything else.
    /// `false`: it is left to the whole.
    fn infer_from_literal(
        &mut self,
        file: FileId,
        e: ExprId,
        param: TypeId,
        inference: &mut Inference,
        return_mapper: MapperId,
        sensitive: bool,
    ) -> bool {
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` calls `inferFromAnnotatedParametersAndReturn` before
        // `getReturnTypeFromBody`: infer from the parameter annotations of each return-only function around the literal before a
        // function inside the literal fixes a type parameter. The loop takes the same steps as `literal_that_waits`.
        if sensitive {
            let (mut outer, mut expected) = (e, param);
            while let ExprKind::Fn(f) = self.hir(file)[outer].kind
                && let Some(body) = self.body_of_return_only_function(file, f)
            {
                let non_null = self.non_nullable(expected);
                let Some(contextual) = self.single_call_signature(non_null, true) else {
                    break;
                };
                if !self.sig_type_params(contextual).is_empty() {
                    break;
                }
                self.infer_from_annotated_parameters_and_return(file, f, contextual, inference);
                (outer, expected) = (body, self.sig_return(contextual));
            }
        }
        let Some((e, param)) = self.literal_that_waits(file, e, param) else {
            // The first round of `inferTypeArguments` infers from the type of `e` under `CheckModeSkipContextSensitive`, whatever kind of
            // expression `e` is. A function with context sensitive parameters is `anyFunctionType`, which contributes nothing.
            let is_any_function = matches!(self.hir(file)[e].kind, ExprKind::Fn(f) if !self.is_return_only_function(file, f));
            if sensitive || is_any_function {
                return false;
            }
            self.infer_from_annotated_functions(file, e, param, inference);
            let partial = self.with_so_far(file, inference, |c| c.partial_type(file, e));
            self.infer(inference, partial, param, 0);
            return true;
        };
        match self.hir(file)[e].kind {
            ExprKind::Array(items) if sensitive => {
                return self.infer_from_elements(file, e, items, param, inference, return_mapper);
            }
            ExprKind::Object(props) => {
                if sensitive || !self.is_inferred_to_as_a_whole(param) {
                    self.infer_from_members(
                        file,
                        props,
                        param,
                        inference,
                        return_mapper,
                        sensitive,
                    );
                    return true;
                }
            }
            _ => {}
        }
        // The first round of `inferTypeArguments`: from the whole, with blanks for the functions. Those that wait for nothing are
        // looked at along with it.
        self.infer_from_annotated_functions(file, e, param, inference);
        let partial = self.with_so_far(file, inference, |c| c.partial_type(file, e));
        self.infer(inference, partial, param, 0);
        true
    }

    /// The same for the functions among the elements of the array literal `e`, given for `param`. `checkArrayLiteral`: an element
    /// is looked at on its own, in its turn, in a tuple context only (`addIntraExpressionInferenceSite`). The members of an
    /// object literal among the elements are, whatever is around it. `false`: the elements are left to the whole.
    fn infer_from_elements(
        &mut self,
        file: FileId,
        e: ExprId,
        items: IdList<ExprId>,
        param: TypeId,
        inference: &mut Inference,
        return_mapper: MapperId,
    ) -> bool {
        let hir = self.hir(file);
        // `getContextualSignature` passes `ContextFlagsSignature` up to the array literal, where `getApparentTypeOfContextualType`
        // instantiates an instantiable contextual type with `nonFixingMapper` (`instantiateContextualType`).
        let param = self.instantiate_instantiable_for_signature(inference, param);
        let in_tuple = self.array_literal_wants_tuple(file, e);
        // `getSpreadIndices`
        let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
        let (first_spread, last_spread) = (
            hir.ids(items).position(is_spread),
            hir.ids(items).rposition(is_spread),
        );
        for (i, item) in hir.ids(items).enumerate() {
            if is_spread(item) {
                continue;
            }
            if !self.is_context_sensitive(file, item) {
                // The second round instantiates a generic function when it reaches the element.
                self.instantiate_nested_generic_functions(file, item, inference);
                continue;
            }
            let Some(element_param) =
                self.contextual_element_at(param, i, Some(items.len()), first_spread, last_spread)
            else {
                continue;
            };
            if !self.has_type_variables(element_param) {
                continue;
            }
            let is_gone_through =
                self.infer_from_literal(file, item, element_param, inference, return_mapper, true);
            if !in_tuple {
                continue;
            }
            if is_gone_through {
                self.infer_from_whole_literal(file, item, element_param, inference, return_mapper);
            } else {
                self.infer_from_member(file, item, element_param, inference, return_mapper, true);
            }
        }
        in_tuple
    }

    /// `e` as `CheckModeSkipContextSensitive` sees it. A function that waits for the types of its parameters is a blank
    /// (`anyFunctionType`), one that only returns something that waits is kept for what it returns (`returnOnlyType`), and what
    /// holds either is marked (`ObjectFlagsNonInferrableType`). Nothing is asked of such a function.
    /// A generic function in `Resolving::nested_generic_functions` is `anyFunctionType` too (`CheckModeSkipGenericFunctions`).
    fn partial_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        if !self.is_skipped_in_first_round(file, e) {
            return self.type_of_expr(file, e);
        }
        let hir = self.hir(file);
        let blank = self.synth(Shape {
            literal: Literalness::Partial,
            ..Shape::default()
        });
        if let Some(instantiated) = self.nested_generic_function(file, e) {
            return instantiated.unwrap_or(blank);
        }
        match hir[e].kind {
            ExprKind::Object(props) => {
                let mut shape = Shape {
                    literal: Literalness::Partial,
                    ..Shape::default()
                };
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.kind == PropKind::Spread
                        || prop.value.is_none()
                        || self.is_setter_beside_getter(file, props, p)
                    {
                        continue;
                    }
                    let Some(name) = self.member_name(file, prop.key) else {
                        continue;
                    };
                    let ty = if self.is_skipped_in_first_round(file, prop.value) {
                        self.partial_type(file, prop.value)
                    } else {
                        self.type_of_literal_prop(file, p)
                    };
                    shape.props.retain(|x| x.name != name);
                    shape.props.push(Prop {
                        name,
                        flags: PropFlags::empty(),
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                    });
                }
                self.synth(shape)
            }
            ExprKind::Array(items) => {
                let mut types = Vec::with_capacity(items.len());
                for item in hir.ids(items) {
                    // What is spread is who knows how many.
                    if matches!(hir[item].kind, ExprKind::Spread(_)) {
                        return blank;
                    }
                    types.push(if self.is_skipped_in_first_round(file, item) {
                        self.partial_type(file, item)
                    } else {
                        let ty = self.type_of_expr(file, item);
                        let expected = self.contextual_type(file, item);
                        self.widen_literal_for_context(ty, expected)
                    });
                }
                if self.array_literal_wants_tuple(file, e) {
                    let flags = vec![ElemFlags::REQUIRED; types.len()];
                    return self.tuple(&types, &flags, false);
                }
                // `checkArrayLiteral` uses `UnionReductionSubtype` in every check mode. `anyFunctionType` is a subtype of every function
                // type (`signaturesRelatedTo`), so it is removed next to one.
                let element = self.union_reduced(&types);
                self.array_of(element)
            }
            // `checkConditionalExpression`: `UnionReductionSubtype`.
            ExprKind::Cond { yes, no, .. } => {
                let (yes, no) = (self.partial_type(file, yes), self.partial_type(file, no));
                self.union_reduced(&[yes, no])
            }
            // `checkBinaryLikeExpression`
            ExprKind::Binary {
                op: op @ (BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => {
                let is_or = matches!(op, BinOp::Or);
                let left = self.partial_type(file, left);
                let may_be_right = if is_or {
                    self.can_be_falsy(left)
                } else {
                    self.can_be_nullish(left)
                };
                if !may_be_right {
                    return left;
                }
                let right = self.partial_type(file, right);
                let left = if is_or {
                    self.remove_definitely_falsy(left)
                } else {
                    left
                };
                let left = self.non_nullable(left);
                self.union_reduced(&[left, right])
            }
            ExprKind::Fn(f) => {
                if !self.is_return_only_function(file, f) {
                    return blank;
                }
                let Some(expected) = self.contextual_signature(file, f) else {
                    return blank;
                };
                let wanted = self.sig_return(expected);
                if !self.has_type_variables(wanted) {
                    return blank;
                }
                // `getReturnTypeFromBody(node, checkMode)`, without the widening at its end.
                let ret = match hir[f].body {
                    FnBody::Expr(body) => self.partial_type(file, body),
                    // `checkAndAggregateReturnExpressionTypes`. A return expression is context sensitive, so there is at least one type.
                    FnBody::Block(_) => {
                        let bound = self.bound(file);
                        let info = &bound.fns[f.idx()];
                        // `functionHasImplicitReturn`
                        let mut has_return_without_expression =
                            info.end != UNREACHABLE && self.is_reachable(file, info.end);
                        let mut types: Vec<TypeId> = Vec::new();
                        for s in bound.ids(info.returns) {
                            let StmtKind::Return(value) = hir[s].kind else {
                                continue;
                            };
                            if value.is_none() {
                                has_return_without_expression = true;
                                continue;
                            }
                            let ty = self.partial_type(file, value);
                            if !types.contains(&ty) {
                                types.push(ty);
                            }
                        }
                        if has_return_without_expression && self.p.files.options.strict_null_checks
                        {
                            types.push(TypeId::UNDEFINED);
                        }
                        self.union_reduced(&types)
                    }
                    FnBody::None => return blank,
                };
                let returns = self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: Box::new([]),
                    ret,
                    this: None,
                    of: Box::new([]),
                });
                self.synth(Shape {
                    call: vec![returns],
                    literal: Literalness::Partial,
                    ..Shape::default()
                })
            }
            _ => blank,
        }
    }

    /// Records the contextual type of each context sensitive argument of a call to a signature with the parameters `params`.
    fn set_arg_contexts(&mut self, file: FileId, args: &[Arg], params: &[SigParam]) {
        if self.is_provisional_here() || self.keeps_arg_contexts {
            return;
        }
        for (i, &arg) in args.iter().enumerate() {
            if let Arg::Expr(e) = arg
                && self.is_context_sensitive(file, e)
                && let Some(param) = self.context_of_arg_at(params, i, Some(args.len()))
            {
                let param = self.without_no_infer(param);
                self.p.arg_contexts.insert((file, e), param);
            }
        }
    }

    /// `maybeTypeOfKind(ty, TypeFlagsInstantiable)`
    fn may_be_deferred(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&part| self.may_be_deferred(part))
            }
            _ => self.is_deferred(ty),
        }
    }

    /// `instantiateInstantiableTypes`: what waits for type parameters, be it in a union or an intersection. Object types stay.
    fn instantiate_instantiable_types(&mut self, ty: TypeId, mapper: MapperId) -> TypeId {
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

    /// `instantiateContextualType`, where a signature is looked for in `ty`: what waits for type parameters is what they come to
    /// as things stand (`nonFixingMapper`), once something has been inferred or one of them has a default, unless that says
    /// nothing. Nothing is settled by it.
    pub(super) fn instantiate_instantiable_for_signature(
        &mut self,
        inference: &Inference,
        ty: TypeId,
    ) -> TypeId {
        let ty = self.force(ty);
        if !self.may_be_deferred(ty) {
            return ty;
        }
        // `hasInferenceCandidatesOrDefault`
        let has_something = (0..inference.params.len()).any(|i| {
            let c = &inference.candidates[i];
            !c.covariant.is_empty()
                || !c.contravariant.is_empty()
                || self.default_of_type_param(inference.params[i]).is_some()
        });
        if !has_something {
            return ty;
        }
        let so_far = self.inference_mapper(inference);
        let instantiated = self.instantiate_instantiable_types(ty, so_far);
        if self.is_any(instantiated) || instantiated == TypeId::UNKNOWN {
            ty
        } else {
            instantiated
        }
    }

    /// `inferFromAnnotatedParametersAndReturn`: what the types `func` writes for its parameters, as far as a rest parameter, and
    /// for what it returns say about the type parameters in `contextual`, the signature expected of it.
    fn infer_from_annotated_parameters_and_return(
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

    /// `getInferenceContext`: however deep in an argument a function whose parameters wait for their types is written, it settles
    /// the type parameters they are typed with. `e`: the argument, or a part of it. What the argument is expected to be has been
    /// pushed.
    fn fix_for_functions_inside(&mut self, inference: &mut Inference, file: FileId, e: ExprId) {
        self.fix_for_nested_functions(inference, file, e, false);
    }

    /// `records_contexts`: the contextual type of a literal around `e` was instantiated with the current inferences. It can only be
    /// computed while the inference is in progress, so the contextual type of each function inside the literal is recorded now.
    fn fix_for_nested_functions(
        &mut self,
        inference: &mut Inference,
        file: FileId,
        e: ExprId,
        mut records_contexts: bool,
    ) {
        if !self.is_context_sensitive(file, e) {
            return;
        }
        let hir = self.hir(file);
        // `getContextualSignature` passes `ContextFlagsSignature` up through every enclosing literal, and at each level
        // `instantiateContextualType` instantiates an instantiable contextual type with `nonFixingMapper`.
        let mut is_pushed = false;
        if matches!(hir[e].kind, ExprKind::Array(_) | ExprKind::Object(_))
            && let Some(expected) = self.contextual_type(file, e)
        {
            let expected = self.force(expected);
            let instantiated = self.instantiate_instantiable_for_signature(inference, expected);
            if instantiated != expected {
                self.contextual.push((file, e, instantiated));
                (is_pushed, records_contexts) = (true, true);
            }
        }
        match hir[e].kind {
            ExprKind::Fn(_) => {
                if let Some(param) = self.contextual_type(file, e) {
                    // `instantiateContextualType` with `ContextFlagsSignature` prefers `nonFixingMapper` to `returnMapper` for an
                    // instantiable contextual type. The contextual type of the argument around `e` has `returnMapper` applied, so
                    // the result is recorded for `e` itself.
                    let param = self.force(param);
                    let is_instantiated =
                        self.instantiate_instantiable_for_signature(inference, param) != param;
                    let context = self.context_for_sensitive_arg(inference, param, Some((file, e)));
                    if records_contexts || is_instantiated {
                        // As for an argument, `returnMapper` applies to the type parameters that are left.
                        let from_result = self
                            .resolving
                            .last()
                            .filter(|r| r.sig == inference.sig)
                            .map(|r| r.return_mapper);
                        let context = match from_result {
                            Some(from_result) => {
                                let return_mapper = self.return_mapper_for_contexts(from_result);
                                self.set_async_return_contexts(file, e, context, return_mapper);
                                self.instantiate_with_expected_result(context, return_mapper)
                            }
                            None => context,
                        };
                        self.set_context(file, e, context);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.fix_for_nested_functions(inference, file, item, records_contexts);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.value.is_some()
                        && !matches!(
                            prop.kind,
                            PropKind::Spread | PropKind::Getter | PropKind::Setter
                        )
                    {
                        self.fix_for_nested_functions(
                            inference,
                            file,
                            prop.value,
                            records_contexts,
                        );
                    }
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.fix_for_nested_functions(inference, file, yes, records_contexts);
                self.fix_for_nested_functions(inference, file, no, records_contexts);
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.fix_for_nested_functions(inference, file, left, records_contexts);
                self.fix_for_nested_functions(inference, file, right, records_contexts);
            }
            ExprKind::NonNull(x)
            | ExprKind::Satisfies { expr: x, .. }
            | ExprKind::Yield { value: x, .. } => {
                self.fix_for_nested_functions(inference, file, x, records_contexts)
            }
            _ => {}
        }
        if is_pushed {
            self.contextual.pop();
        }
    }

    /// `getReturnTypeFromBody`: the same for what the function `func` returns, and then for what it yields. What `func` is expected
    /// to be has been pushed: that says what it is expected to return and to yield.
    fn fix_for_functions_returned(&mut self, inference: &mut Inference, file: FileId, func: FnId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let info = &bound.fns[func.idx()];
        match hir[func].body {
            FnBody::Expr(body) => self.fix_for_functions_inside(inference, file, body),
            FnBody::Block(_) => {
                for s in bound.ids(info.returns) {
                    if let StmtKind::Return(value) = hir[s].kind
                        && value.is_some()
                    {
                        self.fix_for_functions_inside(inference, file, value);
                    }
                }
                for y in bound.ids(info.yields) {
                    self.fix_for_functions_inside(inference, file, y);
                }
            }
            FnBody::None => {}
        }
    }

    /// Whether the constraint of type parameter `i` mentions another type parameter of `inference` that is not fixed and has no
    /// candidates, as in `K extends keyof T` before anything is inferred for `T`. `getInferredType` checks the inferred type against
    /// the instantiated constraint and falls back to the constraint, here `keyof unknown`. tsgo only caches that result and
    /// drops it at the next candidate (`clearCachedInferences`), so it must not be fixed.
    fn has_open_constraint(&mut self, inference: &Inference, i: usize) -> bool {
        let Some(constraint) = self.constraint_of_type_param(inference.params[i]) else {
            return false;
        };
        (0..inference.params.len()).any(|j| {
            let other = &inference.candidates[j];
            j != i
                && other.fixed.is_none()
                && other.covariant.is_empty()
                && other.contravariant.is_empty()
                && self.mentions(constraint, inference.params[j], 0)
        })
    }

    /// What an argument with parameters of its own is expected to be: `param`, with the type parameters that its
    /// parameters need settled on what the other arguments say.
    /// `arg`: the argument, if it is written out.
    pub(super) fn context_for_sensitive_arg(
        &mut self,
        inference: &mut Inference,
        param: TypeId,
        arg: Option<(FileId, ExprId)>,
    ) -> TypeId {
        self.context_for_sensitive_arg_taking(inference, param, arg, None)
    }

    /// `taken`: of a function that is not written out, which of its parameters before a rest parameter take their types from what
    /// is expected, and whether a rest parameter takes what is left.
    fn context_for_sensitive_arg_taking(
        &mut self,
        inference: &mut Inference,
        param: TypeId,
        arg: Option<(FileId, ExprId)>,
        taken: Option<(Vec<bool>, bool)>,
    ) -> TypeId {
        if !self.has_type_variables(param) {
            return param;
        }
        // The function the argument is, if it is one.
        let function = arg.and_then(|(file, e)| match self.hir(file)[e].kind {
            ExprKind::Fn(func) => Some((file, func)),
            _ => None,
        });
        // `assignContextualParameterTypes`: a function takes from what is expected the types of the parameters it has and
        // does not type itself, and nothing else is looked at. A rest parameter it does not type takes all there is from its
        // place on.
        let needed: Option<(Vec<bool>, bool)> = taken.or_else(|| {
            let (file, func) = function?;
            let hir = self.hir(file);
            let (mut plain, mut takes_rest) = (Vec::new(), false);
            for p in hir[func]
                .params
                .iter()
                .filter(|&p| !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this)))
            {
                if hir[p].flags.contains(Flags::REST) {
                    takes_rest = hir[p].ty.is_none();
                    break;
                }
                plain.push(hir[p].ty.is_none());
            }
            Some((plain, takes_rest))
        });
        let param = self.without_no_infer(param);
        let param = if arg.is_some() {
            self.instantiate_instantiable_for_signature(inference, param)
        } else {
            param
        };
        if !self.has_type_variables(param) {
            return param;
        }
        // `<F extends (x: This) => void>(f: F)`: what `F` extends is what a function given for it goes by, and what that
        // is depends on what the signature was found in, which only a clone of `F` knows. So it is where what has been inferred
        // for `F` says nothing (`instantiateContextualType`).
        let outer = inference
            .sig
            .and_then(|sig| self.sig_decl(sig))
            .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
        let as_it_stands: &Inference = inference;
        let param = self.map_type(param, |c, m| {
            let Some(i) = as_it_stands.params.iter().position(|&p| p == m) else {
                return m;
            };
            let candidate = &as_it_stands.candidates[i];
            if candidate.fixed.is_some() {
                return m;
            }
            if !candidate.covariant.is_empty() || !candidate.contravariant.is_empty() {
                let inferred = c.inferred_type(as_it_stands, i);
                if !c.is_any(inferred) && inferred != TypeId::UNKNOWN {
                    return m;
                }
            }
            match c.constraint_of_type_param(m) {
                Some(constraint) if !c.every_type(constraint, |k, t| k.is_primitive(t)) => {
                    c.filled_in_around(m, constraint, outer)
                }
                _ => m,
            }
        });
        let non_null = self.non_nullable(param);
        // What is yet to be worked out has signatures only by way of what it extends, which is not what is looked for.
        let mut sigs = if self.some_type(non_null, |c, m| c.is_deferred(m)) {
            Vec::new()
        } else if function.is_some() {
            // `getContextualSignature`: of a union, the members that can be called.
            let callable = self.filter(non_null, |c, m| !c.signatures(m, false).is_empty());
            self.signatures(callable, false)
        } else {
            let sigs = self.signatures(non_null, false);
            // Something to construct, given where something to construct is expected.
            if sigs.is_empty() && arg.is_none() {
                self.signatures(non_null, true)
            } else {
                sigs
            }
        };
        // `isAritySmaller`: a signature that takes less than the function asks for is not what it goes by.
        if let Some((file, func)) = function {
            let hir = self.hir(file);
            let is_asked_for = |p: &ParamId| {
                hir[*p].default.is_none()
                    && !hir[*p].flags.intersects(Flags::OPTIONAL | Flags::REST)
            };
            let asked = hir[func].params.iter().take_while(is_asked_for).count();
            sigs.retain(|&sig| {
                let params = self.sig_params(sig);
                self.has_effective_rest_parameter(&params) || self.parameter_count(&params) >= asked
            });
        }
        // What the signatures nothing is settled for take.
        let mut open: Vec<TypeId> = Vec::new();
        if sigs.is_empty() {
            // `instantiateContextualType`, for a signature: what waits for type parameters is what they come to as things stand
            // (`nonFixingMapper`), unless that says nothing. A function is given no signature that mentions them, so nothing is
            // settled for it.
            if function.is_some() {
                let so_far = self.inference_mapper(inference);
                let instantiated = self.instantiate(param, so_far);
                return if self.is_any(instantiated) || instantiated == TypeId::UNKNOWN {
                    param
                } else {
                    instantiated
                };
            }
            // An object or an array with functions somewhere inside. They settle what their parameters are typed with, be there
            // something to go by or not (`isFixed`, which widens literals).
            if let Some((file, e)) = arg {
                self.contextual.push((file, e, param));
                self.fix_for_functions_inside(inference, file, e);
                self.contextual.pop();
            }
            // In the end the literal is held against what the type parameters come to. It is looked at once, so that is anticipated
            // wherever there is something to go by. What was made out from the literal with its functions left out is only
            // settled by a function that needs it. A type parameter that is itself what is expected, or one of the alternatives,
            // is yet to be inferred from the literal (`instantiateContextualType` settles nothing).
            for i in 0..inference.params.len() {
                let c = &inference.candidates[i];
                if c.fixed.is_none()
                    && (!c.covariant.is_empty() || !c.contravariant.is_empty())
                    && c.priority & PRIORITY_PARTIAL_HOMOMORPHIC == 0
                    && !self.parts(param).contains(&inference.params[i])
                    && self.mentions(param, inference.params[i], 0)
                    && !self.has_open_constraint(inference, i)
                {
                    let fixed = self.inferred_type(inference, i);
                    inference.candidates[i].fixed = Some(fixed);
                }
            }
        } else {
            // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: the types the function writes have their say first.
            if let (Some((file, func)), &[sig]) = (function, &sigs[..]) {
                self.infer_from_annotated_parameters_and_return(file, func, sig, inference);
            }
            // `assignContextualParameterTypes`, `applyToParameterTypes`: `this` comes first, unless the function says itself what it is.
            let own_this_is_typed =
                function.is_some_and(|(file, func)| self.hir(file)[func].this_ty.is_some());
            for sig in sigs {
                let params = self.sig_params(sig);
                let this = if own_this_is_typed {
                    None
                } else {
                    self.sig_this_type(sig)
                };
                // With `...args: T` nothing is settled: what is given is yet to say what `T` is.
                if let Some(rest) = self.effective_rest_type(&params)
                    && matches!(self.data(rest), TypeData::TypeParam(..))
                {
                    open.extend(params.iter().map(|p| p.ty));
                    open.extend(this);
                    continue;
                }
                if let Some(this) = this {
                    self.fix_params_in(inference, this);
                }
                for (i, p) in params.into_iter().enumerate() {
                    let is_needed = match &needed {
                        None => true,
                        // A rest parameter stands for every position from its own on.
                        Some((plain, takes_rest)) if p.rest => {
                            *takes_rest || plain.iter().skip(i).any(|&n| n)
                        }
                        Some((plain, takes_rest)) => plain.get(i).copied().unwrap_or(*takes_rest),
                    };
                    if is_needed {
                        self.fix_params_in(inference, p.ty);
                    }
                }
            }
            // What it returns or yields is looked at next, unless it says itself what that is. The functions in that go by what it is
            // expected to return or yield.
            if let (Some((file, func)), Some((_, e))) = (function, arg)
                && self.hir(file)[func].ret.is_none()
            {
                self.contextual.push((file, e, param));
                self.fix_for_functions_returned(inference, file, func);
                self.contextual.pop();
            }
        }
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for i in 0..inference.params.len() {
            let p = inference.params[i];
            if let Some(fixed) = inference.candidates[i].fixed {
                pairs.push((p, fixed));
            } else if open.iter().any(|&ty| self.mentions(ty, p, 0)) {
                // `nonFixingMapper`, for what is taken. What only the result mentions stays as it is.
                pairs.push((p, self.inferred_type(inference, i)));
            }
        }
        let mapper = self.p.types.mapper(pairs);
        self.instantiate(param, mapper)
    }

    /// What argument `arg` of `call` is expected to be.
    pub(super) fn contextual_type_of_arg(
        &mut self,
        file: FileId,
        call: ExprId,
        arg: ExprId,
    ) -> Option<TypeId> {
        if self.iife_resolving.contains(&(file, call)) {
            // `anySignature`: anything is expected.
            return Some(TypeId::ANY);
        }
        // A function called where it is written expects nothing where it does not say: it takes what it is given.
        let hir = self.hir(file);
        if let ExprKind::Call(c) = hir[call].kind
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
        if self.provisional > 0
            && let Some(&known) = self.provisional_arg_contexts.get(&(file, arg))
        {
            self.note_provisional_read();
            return Some(known);
        }
        if let Some(known) = self.p.arg_contexts.get(&(file, arg)) {
            return Some(known);
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
        if let Some(resolving) = self
            .resolving
            .iter()
            .rev()
            .find(|r| r.file == file && r.call == call)
        {
            let (params, is_trial) = (resolving.params.clone(), resolving.is_trial);
            let param = self.context_of_arg_at(&params, index, Some(count))?;
            // Once the call is resolved more is expected than this, or something else: what goes by it is not kept.
            if (is_trial || self.has_type_variables(param))
                && let Some(i) = self
                    .stack
                    .iter()
                    .rposition(|q| *q == Query::Call(file, call))
            {
                for tainted in &mut self.tainted[i + 1..] {
                    *tainted = true;
                }
            }
            return Some(self.without_no_infer(param));
        }
        // `getContextualTypeForArgumentAtIndex`: "If we're already in the process of resolving the given signature, don't resolve again".
        let asking = std::mem::replace(&mut self.asking_for_context, true);
        let resolved = self.resolve_call(file, call);
        self.asking_for_context = asking;
        if self.provisional > 0
            && let Some(&known) = self.provisional_arg_contexts.get(&(file, arg))
        {
            self.note_provisional_read();
            return Some(known);
        }
        if let Some(known) = self.p.arg_contexts.get(&(file, arg)) {
            return Some(known);
        }
        // `resolveUntypedCall`, `resolveErrorCall`: what anything comes of has no parameters.
        let Some(sig) = resolved.sig else {
            return (resolved.ret == TypeId::ANY).then_some(TypeId::ANY);
        };
        let params = self.sig_params(sig);
        // `getTypeAtPosition`: where there is no parameter anything is expected.
        Some(
            self.context_of_arg_at(&params, index, Some(count))
                .unwrap_or(TypeId::ANY),
        )
    }
}

/// Whether the type node `node` is a keyword, a literal type, a reference without type arguments, or a union or intersection of those.
fn is_plain_type_reference(hir: &File, node: TypeNodeId) -> bool {
    match hir[node].kind {
        TypeNodeKind::Keyword(_)
        | TypeNodeKind::StringLit(_)
        | TypeNodeKind::NumberLit(_)
        | TypeNodeKind::BigIntLit { .. }
        | TypeNodeKind::BoolLit(_) => true,
        TypeNodeKind::Ref { args, .. } => args.is_empty(),
        TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
            hir.ids(types).all(|t| is_plain_type_reference(hir, t))
        }
        _ => false,
    }
}

/// `maybeTypeOfKind(ty, Primitive | Index | TemplateLiteral | StringMapping)`
fn may_be_primitive_or_key(c: &Checker<'_>, ty: TypeId) -> bool {
    match c.data(ty) {
        TypeData::Union(parts) | TypeData::Intersection(parts) => {
            parts.iter().any(|&part| may_be_primitive_or_key(c, part))
        }
        TypeData::Keyof(_) => true,
        _ => c.is_primitive(ty),
    }
}
