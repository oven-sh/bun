//! What is gone through or taken apart: 2488 2504 2493, 2405 2407, 2339 2537 2538 and 2341 2445 2446 of what an assignment takes out of
//! an object, 2531 2532 2533 2571 where nothing is taken out, and 2322 where what comes out is assigned.
//!
//! Follows `checkForOfStatement`, `checkForInStatement`, `getIteratedTypeOrElementType`, `checkDestructuringAssignment` with what it
//! calls, `checkVariableLikeDeclaration` as far as patterns go, `checkYieldExpression`, and `checkSignatureDeclaration` for what a
//! generator says it returns, of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent, PatParent, ScopeKind};
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_iteration(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let strict = self.p.files.options.strict_null_checks;
        // Without `Iterable` other things are said of what is gone through, in other words.
        let has_iterable = self.global_type_of_arity(known::Iterable, 3).is_some();
        for s in 0..hir.stmts.len() {
            let kind = hir.stmts[s].kind;
            if !matches!(kind, StmtKind::ForOf { .. } | StmtKind::ForIn { .. })
                || matches!(bound.stmt_parent[s], Parent::None)
            {
                continue;
            }
            match kind {
                StmtKind::ForOf {
                    left,
                    expr,
                    is_await,
                    ..
                } => {
                    let given = self.type_of_expr(file, expr);
                    let mut iterated = None;
                    if self.is_known(given) && !self.is_uncertain(file, expr) {
                        // `checkRightHandSideOfForOf`: `checkNonNullExpression` comes first.
                        let given = self.check_not_nullish(file, expr, given, out);
                        // Where `null` and `undefined` are not told apart nothing has been said of them, or taken out.
                        if !self.is_nothing_but_nullish(given) {
                            let at = self.error_start_of(file, expr);
                            iterated = self.check_iterated(
                                given,
                                is_await,
                                at,
                                |c| c.error_end_of(file, expr),
                                out,
                            );
                        }
                    }
                    let StmtKind::Expr(target) = hir[left].kind else {
                        continue;
                    };
                    if self.is_assignment_pattern(file, target) {
                        // What is on the left is looked at whatever is gone through: on with the error type.
                        self.check_destructuring_assignment(
                            file,
                            target,
                            iterated.unwrap_or(TypeId::UNRESOLVED),
                            out,
                        );
                    } else if let Some(iterated) = iterated
                        // What a literal in parentheses comes to is not looked into.
                        && !matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_))
                    {
                        // Whatever else is written there is held against what comes out, whatever is wrong with it: 2487, 2781.
                        let wanted = self.type_of_assignment_target(file, target);
                        let at = self.error_start_of(file, target);
                        let end = self.error_end_of(file, target);
                        self.check_assignable_with_end(
                            file, iterated, wanted, at, end, expr, 2322, out,
                        );
                    }
                }
                StmtKind::ForIn { left, expr, .. } => {
                    let given = self.type_of_expr(file, expr);
                    if !self.is_known(given) || self.is_uncertain(file, expr) {
                        continue;
                    }
                    // `getNonNullableTypeIfNeeded`
                    let given = self.non_nullable_type_if_needed(given);
                    // A literal as it stands is a pattern, which is another matter: 2491.
                    if let StmtKind::Expr(target) = hir[left].kind
                        && !self.is_assignment_pattern(file, target)
                    {
                        let wanted = self.type_of_assignment_target(file, target);
                        let keys = self.index_type_or_string(given);
                        if self.is_known(wanted)
                            && self.is_known(keys)
                            && !self.is_assignable(keys, wanted)
                        {
                            let start = self.error_start_of(file, target);
                            out.push(Diagnostic { start, code: 2405 });
                            let end = self.error_end_of(file, target);
                            self.explain_to(start, end, 2405, |_| vec![]);
                        }
                    }
                    // `isTypeAssignableToKind(rightType, NonPrimitive | InstantiableNonPrimitive)`. `keyof T` is an instantiable
                    // primitive. Without strictNullChecks `null` and `undefined` are assignable to `object`.
                    let is_object = given == TypeId::OBJECT
                        || !strict && self.is_nothing_but_nullish(given)
                        || self.is_deferred(given)
                            && !matches!(self.data(given), TypeData::Keyof(_))
                        || self.is_assignable(given, TypeId::OBJECT);
                    if given == TypeId::NEVER || !is_object {
                        let start = self.error_start_of(file, expr);
                        out.push(Diagnostic { start, code: 2407 });
                        let end = self.error_end_of(file, expr);
                        self.explain_to(start, end, 2407, |c| vec![c.type_to_string(given)]);
                    }
                }
                _ => {}
            }
        }
        let index = self.exprs_by_kind(file);
        let mut looked_at: SmallVec<[ExprId; 8]> = SmallVec::new();
        // `[...x]`, `f(...x)`
        for &e in index.of(ExprTag::Spread) {
            if matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Array(_) | ExprKind::Call(_) | ExprKind::New(_)))
                && !self.is_assignment_target(file, e)
            {
                looked_at.push(e);
            }
        }
        // One that is a default in a pattern is looked at with the pattern.
        for &e in index.of(ExprTag::Assign) {
            if let ExprKind::Assign {
                op: None, target, ..
            } = hir[e].kind
                && !matches!(bound.expr_parent[e.idx()], Parent::None)
                && self.is_assignment_pattern(file, target)
                && !self.is_assignment_target(file, e)
            {
                looked_at.push(e);
            }
        }
        if has_iterable {
            for &e in index.of(ExprTag::Yield) {
                if !matches!(bound.expr_parent[e.idx()], Parent::None) {
                    looked_at.push(e);
                }
            }
        }
        // In the order they have in the file, whatever their kind.
        looked_at.sort_unstable();
        for e in looked_at {
            match hir[e].kind {
                ExprKind::Spread(inner) => {
                    let given = self.type_of_expr(file, inner);
                    if !self.is_uncertain(file, inner)
                        && !self.is_nothing_but_nullish(given)
                        && !self.is_spread_taken_whole(file, e, given, &out[..])
                    {
                        let at = self.error_start_of(file, inner);
                        self.check_iterated(given, false, at, |c| c.error_end_of(file, inner), out);
                    }
                }
                ExprKind::Assign { target, value, .. } => {
                    let given = self.type_of_expr(file, value);
                    let given = if self.is_uncertain(file, value) {
                        TypeId::UNRESOLVED
                    } else {
                        given
                    };
                    self.check_destructuring_assignment(file, target, given, out);
                }
                ExprKind::Yield { value, star } => self.check_yield(file, e, value, star, out),
                _ => {}
            }
        }
        // `createGeneratorType`, which a generator that does not say what it returns is always asked for: that there is neither a `Generator`
        // nor an `IterableIterator` is said, of no file.
        for i in 0..hir.fns.len() {
            let f = &hir.fns[i];
            if !f.flags.contains(Flags::GENERATOR)
                || f.ret.is_some()
                || matches!(f.body, FnBody::None)
                || matches!(bound.fns[i].owner, FnOwner::None)
            {
                continue;
            }
            let (generator, iterator) = if f.flags.contains(Flags::ASYNC) {
                (known::AsyncGenerator, known::AsyncIterableIterator)
            } else {
                (known::Generator, known::IterableIterator)
            };
            if self.global_type_of_arity(generator, 3).is_none()
                && self.global_type_symbol(iterator).is_none()
            {
                self.report_global_error(2318, vec![self.atom_text(iterator)]);
            }
        }
        // `checkSignatureDeclaration`: a generator gives a `Generator`, which what it says it returns has to have room for.
        for i in 0..hir.fns.len() {
            let f = &hir.fns[i];
            if !has_iterable
                || !f.flags.contains(Flags::GENERATOR)
                || f.ret.is_none()
                || matches!(f.body, FnBody::None)
                || matches!(bound.fns[i].owner, FnOwner::None)
            {
                continue;
            }
            let declared = self.type_from_node(file, f.ret);
            // `void` has words of its own: 2505.
            if declared == TypeId::VOID || !self.is_known(declared) {
                continue;
            }
            let generator = self.generator_instantiation(declared, f.flags.contains(Flags::ASYNC));
            let end = self.end_of_type_node(file, f.ret);
            self.check_assignable_with_end(
                file,
                generator,
                declared,
                hir[f.ret].pos,
                end,
                ExprId::NONE,
                2322,
                out,
            );
        }
        let mut type_parents = None;
        for p in 0..hir.pats.len() {
            let pat = PatId(p as u32);
            if matches!(hir.pats[p].kind, PatKind::Ident(_) | PatKind::Missing)
                || matches!(bound.pat_parent[p], PatParent::None)
            {
                continue;
            }
            if self.binds_no_name(file, pat) {
                self.check_pattern_without_names(file, pat, &mut type_parents, out);
                continue;
            }
            let PatKind::Array(elems) = hir.pats[p].kind else {
                continue;
            };
            let mut given = self.type_of_pat(file, pat);
            let initializer = match bound.pat_parent[p] {
                PatParent::None => continue,
                PatParent::Var(d) => hir[d].init,
                PatParent::Prop(_, prop) => hir[prop].default,
                PatParent::Elem(_, elem) => hir[elem].default,
                PatParent::Param(param) => {
                    let decl = &hir[param];
                    if decl.ty.is_some() {
                        // `getTypeForBindingElementParent`: without the `undefined` that `?` stands for.
                        if decl.flags.contains(Flags::OPTIONAL) {
                            given = self.type_from_node(file, decl.ty);
                        }
                    } else {
                        let func = bound.param_fn[param.idx()];
                        match self.contextual_param_type(
                            file,
                            func,
                            (param.0 - hir[func].params.start) as usize,
                        ) {
                            // `assignParameterType`: where nothing but `unknown` is expected the pattern says what it is.
                            Some(TypeId::UNKNOWN) => continue,
                            // `assignContextualParameterTypes` weighs what is expected against the default: not looked into.
                            Some(_) if decl.default.is_some() => continue,
                            // What is expected is what is taken apart. In terms of type parameters it is not looked into.
                            Some(expected) if !self.has_type_variables(expected) => {
                                given = expected
                            }
                            Some(_) => continue,
                            // What nothing types is what the pattern makes of it.
                            None if decl.default.is_none() => continue,
                            None => {
                                if self.is_uncertain(file, decl.default) {
                                    continue;
                                }
                                // `getTypeForBindingElementParent`: a default is taken apart as it is, `null` and `undefined` not yet
                                // being `any`. `assignParameterType` widens it first for a function that is an expression.
                                if !matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_)) {
                                    let raw = self.type_of_expr(file, decl.default);
                                    if self.is_nothing_but_nullish(raw) {
                                        given = raw;
                                    }
                                }
                            }
                        }
                    }
                    decl.default
                }
            };
            let given = self.force(given);
            // What has an initializer that cannot be `undefined` is not `undefined`: whether it can has to be known.
            if strict && initializer.is_some() && self.some_type(given, |_, m| m.is_undefined()) {
                let ty = self.type_of_expr(file, initializer);
                if !self.is_known(ty) || self.is_uncertain(file, initializer) {
                    continue;
                }
            }
            let given = self.type_pattern_takes_apart(file, pat, given);
            if !self.is_known(given) || self.is_any(given) {
                continue;
            }
            // `getIteratedTypeOrElementType`: without `Iterable` a list is taken apart as it is. `getBindingElementTypeFromParentType`
            // asks for the sake of an element: of `[]` nothing is asked.
            if has_iterable
                && elems
                    .iter()
                    .any(|elem| !matches!(hir[hir[elem].pat].kind, PatKind::Missing))
                && self
                    .check_iterated(given, false, hir[pat].pos, |c| c.end_of_pat(file, pat), out)
                    .is_none()
            {
                continue;
            }
            // `getBindingElementTypeFromParentType`: the elements of a list are looked up by number, 2339 where it has none.
            if !self.every_type(given, |c, m| c.is_tuple(m)) {
                if self.is_array_like(given) {
                    for (index, elem) in elems.iter().enumerate() {
                        let elem = &hir[elem];
                        if !elem.is_rest && !matches!(hir[elem.pat].kind, PatKind::Missing) {
                            let key = self.number_literal(index as f64, false);
                            // `AccessFlagsAllowMissing`
                            let allows_missing =
                                elem.default.is_some() && self.is_object_literal_type(given);
                            let name = elem.pat;
                            self.destructured_property(
                                file,
                                given,
                                key,
                                allows_missing,
                                hir[name].pos,
                                |c| c.end_of_pat(file, name),
                                out,
                            );
                        }
                    }
                }
                continue;
            }
            // `getPropertyTypeForIndexType`: past the end of a tuple there is nothing.
            for (index, elem) in elems.iter().enumerate() {
                let elem = &hir[elem];
                if !elem.is_rest
                    && elem.default.is_none()
                    && !matches!(hir[elem.pat].kind, PatKind::Missing)
                    && let Some(code) =
                        self.past_the_end_of_tuples(given, self.number_name(index as f64))
                {
                    let start = hir[elem.pat].pos;
                    out.push(Diagnostic { start, code });
                    let end = self.end_of_pat(file, elem.pat);
                    let name = self.number_name(index as f64);
                    self.explain_to(start, end, code, |c| {
                        past_the_end_arguments(c, code, given, name)
                    });
                }
            }
        }
    }

    fn is_nothing_but_nullish(&self, ty: TypeId) -> bool {
        ty != TypeId::NEVER && self.every_type(ty, |_, m| m.is_null() || m.is_undefined())
    }

    /// `getIndexTypeOrString`: the string keys of `ty`, or `string` if it has none.
    pub(super) fn index_type_or_string(&mut self, ty: TypeId) -> TypeId {
        let keys = self.keyof(ty);
        if !self.is_known(keys) {
            return keys;
        }
        // `getExtractStringType`: `Extract<keys, string>`. Only generic keys need the conditional type.
        let strings = if self.is_generic(keys)
            && let Some(name) = self.files().atoms.lookup(b"Extract")
            && let Some(extract) = self.files().global(name, SymFlags::TYPE_ALIAS)
        {
            self.type_reference(extract, &[keys, TypeId::STRING])
        } else {
            self.filter(keys, |c, m| c.is_string_like(m))
        };
        if strings == TypeId::NEVER {
            TypeId::STRING
        } else {
            strings
        }
    }

    /// Whether `e`, which is assigned to, is a pattern: an array or object literal as it stands. In parentheses it is an expression
    /// like any other.
    fn is_assignment_pattern(&self, file: FileId, e: ExprId) -> bool {
        matches!(
            self.hir(file)[e].kind,
            ExprKind::Array(_) | ExprKind::Object(_)
        ) && !is_parenthesized(self.hir(file), e)
    }

    /// Whether `getIterationTypesOfIterable` finds any types for `ty`, going by `[Symbol.iterator]()`, and by
    /// `[Symbol.asyncIterator]()` first where that will do. What cannot be found out counts as found.
    fn is_iterable(&mut self, ty: TypeId, allows_async: bool) -> bool {
        let ty = self.force(ty);
        // An intersection nothing can be is not there.
        let ty = self.reduced(ty);
        if self.is_any(ty) {
            return true;
        }
        if self.is_union(ty) {
            return self
                .parts(ty)
                .iter()
                .all(|&part| self.is_iterable(part, allows_async));
        }
        // What the library that has `Iterable` says of arrays and tuples, as in `iterable_types`.
        if self.is_array_or_tuple(ty) {
            return true;
        }
        // `getIterationTypesOfIterableFast`
        let is_ref_to = |c: &Self, names: [Atom; 4]| {
            names
                .iter()
                .any(|&name| c.is_global_ref(ty, name).is_some())
        };
        if is_ref_to(
            self,
            [
                known::Iterable,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ],
        ) || allows_async
            && is_ref_to(
                self,
                [
                    known::AsyncIterable,
                    known::AsyncIteratorObject,
                    known::AsyncIterableIterator,
                    known::AsyncGenerator,
                ],
            )
        {
            return true;
        }
        // `getPropertyOfType` looks in the reduced apparent type.
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        if !self.is_known(apparent) {
            return true;
        }
        // What a type parameter extends: each of the alternatives.
        if self.is_union(apparent) {
            return self.is_iterable(apparent, allows_async);
        }
        allows_async && self.gives_an_iterator(apparent, known::sym_async_iterator)
            || self.gives_an_iterator(apparent, known::sym_iterator)
    }

    /// `getIterationTypesOfIterableSlow`: the method `name` of `ty` is there for sure, can be called with nothing, and what it gives
    /// is an iterator: it has a `next`, a `return` or a `throw` that can be called (`getIterationTypesOfIteratorSlow`).
    fn gives_an_iterator(&mut self, ty: TypeId, name: Atom) -> bool {
        let Some((method, mapper)) = self.prop_ref(ty, name) else {
            return false;
        };
        if method.flags.contains(PropFlags::OPTIONAL) {
            return false;
        }
        let method = self.type_of_prop(method, mapper);
        if !self.is_known(method) || self.is_any(method) {
            return true;
        }
        let mut iterators: SmallVec<[TypeId; 2]> = SmallVec::new();
        for sig in self.signatures(method, false) {
            let params = self.sig_params(sig);
            if self.min_argument_count(&params) == 0 {
                iterators.push(self.sig_return(sig));
            }
        }
        if iterators.is_empty() {
            return false;
        }
        let iterator = self.intersection(&iterators);
        let iterator = self.force(iterator);
        let iterator = self.apparent_type(iterator);
        // What the members of a union have in common is not looked into.
        if !self.is_known(iterator) || self.is_any(iterator) || self.is_union(iterator) {
            return true;
        }
        // `getIterationTypesOfMethod`. Only `next` has to be there for sure.
        (0..3).any(|method| {
            let name = match method {
                0 => known::next,
                1 => self.files().atoms.intern(b"return"),
                _ => self.files().atoms.intern(b"throw"),
            };
            let Some((method, mapper)) = self.prop_ref(iterator, name) else {
                return false;
            };
            if name == known::next && method.flags.contains(PropFlags::OPTIONAL) {
                return false;
            }
            let method = self.type_of_prop(method, mapper);
            let method = if name == known::next {
                method
            } else {
                self.non_nullable(method)
            };
            !self.is_known(method)
                || self.is_any(method)
                || !self.signatures(method, false).is_empty()
        })
    }

    /// `checkGeneratorInstantiationAssignabilityToReturnType`: the generator that yields, returns and takes what `declared`, which a
    /// generator function says it returns, does.
    fn generator_instantiation(&mut self, declared: TypeId, is_async: bool) -> TypeId {
        let types = self.iteration_types(declared, is_async);
        let yielded = types.map_or(TypeId::ANY, |t| t.yielded);
        let returned = types.map_or(yielded, |t| t.returned);
        let next = types.map_or(TypeId::UNKNOWN, |t| t.next);
        self.generator_of(yielded, returned, next, is_async)
    }

    /// Whether `isArrayLikeType` keeps `spread`, which spreads a `given`, from `checkIteratedTypeOrElementType`: what is like an array
    /// is taken as it is. `never` is like one, and cannot be gone through.
    /// `said`: the errors of the file so far.
    fn is_spread_taken_whole(
        &mut self,
        file: FileId,
        spread: ExprId,
        given: TypeId,
        said: &[Diagnostic],
    ) -> bool {
        let Parent::Expr(parent) = self.bound(file).expr_parent[spread.idx()] else {
            return false;
        };
        // `checkArrayLiteral`, `getSpreadArgumentType`
        let asks = matches!(self.hir(file)[parent].kind, ExprKind::Array(_))
            || !self.is_array_or_tuple(given)
                && self.is_spread_left_to_rest_parameter(file, parent, spread, said);
        asks && self.is_known(given) && self.is_array_like(given)
    }

    /// `getSignatureApplicabilityError`, `inferTypeArguments`: whether the argument `spread` of `call` is one of those that are not
    /// looked at by themselves, since a rest parameter that is no plain array collects them.
    fn is_spread_left_to_rest_parameter(
        &mut self,
        file: FileId,
        call: ExprId,
        spread: ExprId,
        said: &[Diagnostic],
    ) -> bool {
        let hir = self.hir(file);
        let (ExprKind::Call(id) | ExprKind::New(id)) = hir[call].kind else {
            return false;
        };
        let Some(sig) = self.resolve_call(file, call).sig else {
            return false;
        };
        let params = self.sig_params(sig);
        if self.non_array_rest_type(&params).is_none() {
            return false;
        }
        // `getEffectiveCallArguments`: a tuple that is spread counts for what is in it.
        let mut before = Vec::new();
        for a in hir.ids(hir[id].args) {
            if a == spread {
                break;
            }
            self.push_effective_arg(file, a, &mut before);
        }
        if before.len() + 1 < self.parameter_count(&params) {
            return false;
        }
        // `getCandidateForOverloadFailure`, `resolveUntypedCall`: in a call that does not go through every argument is looked at by
        // itself after all. What is wrong with the call has been said.
        let (start, end) = (self.start_of(file, call), self.end_of_expr(file, call));
        !said.iter().any(|d| (start..end).contains(&d.start))
    }

    /// `checkIteratedTypeOrElementType`. `None`: it cannot be gone through, or it cannot be told. `at`, `end`: the range of `errorNode`.
    fn check_iterated(
        &mut self,
        given: TypeId,
        allows_async: bool,
        at: u32,
        end: impl FnOnce(&Self) -> u32,
        out: &mut Vec<Diagnostic>,
    ) -> Option<TypeId> {
        if !self.is_known(given) {
            return None;
        }
        if self.is_any(given) {
            return Some(given);
        }
        // Without `Iterable` other things are said, in other words.
        if self.global_type_of_arity(known::Iterable, 3).is_none() {
            return None;
        }
        // `getIterationTypesOfIterable`
        let given = self.force(given);
        let given = self.reduced(given);
        if !self.is_iterable(given, allows_async) {
            let code = if allows_async { 2504 } else { 2488 };
            out.push(Diagnostic { start: at, code });
            let end = end(&*self);
            self.explain_to(at, end, code, |c| vec![c.type_to_string(given)]);
            self.relate(at, code, |c| {
                c.hint_to_await_what_is_gone_through(given, allows_async, at, end)
            });
            return None;
        }
        let iterated = self.iterated_type(given, allows_async);
        self.is_known(iterated).then_some(iterated)
    }

    /// The end of `reportTypeNotIterableError`: 2773 at the node from `at` to `end` of the file that is checked, whose type `given`
    /// cannot be gone through, if an `await` may be what is missing.
    pub(super) fn hint_to_await_what_is_gone_through(
        &mut self,
        given: TypeId,
        allows_async: bool,
        at: u32,
        end: u32,
    ) -> Vec<super::explain::Related> {
        let Some(file) = self.checking else {
            return Vec::new();
        };
        // `getAwaitedTypeOfPromise`
        let mut suggests_await = self
            .thenable_value(given)
            .and_then(|promised| self.awaited_or_none(promised))
            .is_some_and(|awaited| self.is_known(awaited));
        if !suggests_await && !allows_async {
            // `errorNode.Parent.Expression() == errorNode`
            let is_what_a_loop_goes_through = self.hir(file).stmts.iter().any(|s| {
                matches!(s.kind, StmtKind::ForOf { expr, .. } if self.error_start_of(file, expr) == at)
            });
            if is_what_a_loop_goes_through
                && self.global_type_of_arity(known::AsyncIterable, 3).is_some()
            {
                let any_async_iterable = self.global_ref(known::AsyncIterable, &[TypeId::ANY; 3]);
                suggests_await = self.is_assignable(given, any_async_iterable);
            }
        }
        if !suggests_await {
            return Vec::new();
        }
        vec![super::explain::Related {
            at: Some((file, at, end)),
            code: 2773,
            args: Vec::new(),
        }]
    }

    /// `checkDestructuringAssignment`: `source` is taken apart into `target`, or assigned to it.
    fn check_destructuring_assignment(
        &mut self,
        file: FileId,
        mut target: ExprId,
        source: TypeId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let strict = self.p.files.options.strict_null_checks;
        let mut source = self.force(source);
        // A default, which is an assignment like any other, sees to it that it is not missing. In parentheses it is no default.
        if let ExprKind::Assign {
            op: None,
            target: inner,
            value,
        } = hir[target].kind
            && !is_parenthesized(self.hir(file), target)
        {
            let default = self.type_of_expr(file, value);
            if self.is_assignment_pattern(file, inner) {
                let default = if self.is_uncertain(file, value) {
                    TypeId::UNRESOLVED
                } else {
                    default
                };
                self.check_destructuring_assignment(file, inner, default, out);
            } else {
                self.check_reference_assignment(file, inner, default, value, out);
            }
            // That of `{ a = d }` sees to it only if it cannot be `undefined` itself.
            let is_shorthand = matches!(self.bound(file).expr_parent[target.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand);
            target = inner;
            if strict
                && !(is_shorthand
                    && !self.is_uncertain(file, value)
                    && self.has_undefined_in_it(default))
            {
                source = self.type_with_ne_undefined(source);
            }
        }
        // On with the error type: the defaults in a pattern are assignments whatever is taken apart.
        if !self.is_known(source) {
            source = TypeId::UNRESOLVED;
        }
        if !self.is_assignment_pattern(file, target) {
            let said = out.len();
            self.check_reference_assignment(file, target, source, ExprId::NONE, out);
            // What is said of a default is said at the same name, and both stand.
            if let Some(&said) = out.get(said) {
                self.explain_apart(said.start, said.code);
            }
            return;
        }
        match hir[target].kind {
            ExprKind::Object(props) => {
                // `checkObjectLiteralAssignment`: one that takes nothing out still needs something to be there.
                if props.is_empty() {
                    if strict {
                        self.check_not_nullish(file, target, source, out);
                    }
                    return;
                }
                let object = self.apparent_type(source);
                // Of what is `any`, or not known, nothing is said: what comes out of it is that again.
                let is_told = !self.is_any(source) && self.is_known(object);
                // `isObjectLiteralType`. Once the type of an object literal, always one, as far as leaving things out goes.
                let is_literal = source == TypeId::EMPTY_OBJECT
                    || self.is_object_literal_type(source)
                    || matches!(
                        self.data(source),
                        TypeData::Anon {
                            origin: Origin::WidenedLiteral(..),
                            ..
                        }
                    );
                let (mut named, mut keys) = (Vec::new(), Vec::new());
                for (i, p) in props.iter().enumerate() {
                    let prop = &hir[p];
                    if prop.kind == PropKind::Spread {
                        // One that is not the last is refused as a whole: 2462.
                        if i + 1 == props.len() && prop.value.is_some() {
                            // `getRestType`
                            let omitted = self.union(&keys);
                            let rest = self.rest_of_object(source, &named, omitted);
                            self.check_destructuring_assignment(file, prop.value, rest, out);
                        }
                        continue;
                    }
                    // `getLiteralTypeFromPropertyName`
                    let name = self.member_name(file, prop.key);
                    let key = match (name, prop.key) {
                        (Some(name), _) => {
                            named.push(name);
                            self.string_literal(name, false)
                        }
                        (None, PropKey::Computed(k)) => {
                            let key = self.type_of_expr(file, k);
                            let key = self.regular(key);
                            keys.push(key);
                            key
                        }
                        _ => continue,
                    };
                    // What is no property assignment is refused: 1136.
                    if !matches!(prop.kind, PropKind::Init | PropKind::Shorthand)
                        || prop.value.is_none()
                    {
                        continue;
                    }
                    let is_sure = is_told
                        && self.is_known(key)
                        && !matches!(prop.key, PropKey::Computed(k) if self.is_uncertain(file, k));
                    let ty = if !is_sure {
                        if self.is_any(source) {
                            source
                        } else {
                            TypeId::UNRESOLVED
                        }
                    } else {
                        // `AccessFlagsAllowMissing`
                        let has_default =
                            matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
                                && !is_parenthesized(self.hir(file), prop.value);
                        // A number is looked up in a tuple as an element is.
                        let past_the_end =
                            name.and_then(|name| self.past_the_end_of_tuples(object, name));
                        let found = match name {
                            Some(name) if past_the_end.is_none() => {
                                self.type_of_property(object, name)
                            }
                            _ => None,
                        };
                        let ty = match (found, name) {
                            _ if past_the_end.is_some() => {
                                if !has_default && let Some(code) = past_the_end {
                                    let start = self.start_of_index_node(file, prop.key, prop.pos);
                                    out.push(Diagnostic { start, code });
                                    if let Some(name) = name {
                                        let end = self.end_of_index_node(file, prop.key);
                                        self.explain_to(start, end, code, |c| {
                                            past_the_end_arguments(c, code, object, name)
                                        });
                                    }
                                }
                                TypeId::UNDEFINED
                            }
                            (Some(ty), Some(name)) => {
                                // `checkPropertyAccessibility`, of what is written to. Said at the name as it is written.
                                if let Some(code) = self.why_not_accessible(
                                    file,
                                    Parent::Expr(target),
                                    false,
                                    true,
                                    object,
                                    name,
                                ) {
                                    out.push(Diagnostic {
                                        start: prop.pos,
                                        code,
                                    });
                                    let end = self.end_of_prop_name(file, p);
                                    self.explain_to(prop.pos, end, code, |c| {
                                        accessibility_arguments(c, file, target, code, object, name)
                                    });
                                }
                                ty
                            }
                            // Symbols are not looked into.
                            (_, Some(name)) if self.files().atoms.is_symbol_name(name) => {
                                TypeId::UNRESOLVED
                            }
                            _ => {
                                let at = self.start_of_index_node(file, prop.key, prop.pos);
                                self.destructured_property(
                                    file,
                                    source,
                                    key,
                                    has_default && is_literal,
                                    at,
                                    |c| c.end_of_index_node(file, prop.key),
                                    out,
                                )
                            }
                        };
                        // `getFlowTypeOfDestructuring`
                        if self.is_known(ty) {
                            self.narrow_destructured_assignment(file, prop.value, ty)
                        } else {
                            ty
                        }
                    };
                    self.check_destructuring_assignment(file, prop.value, ty, out);
                }
            }
            ExprKind::Array(items) => {
                // `checkArrayLiteralAssignment`. `None`: it cannot be gone through (2488), or is not known: on with the error type.
                let iterated = self.check_iterated(
                    source,
                    false,
                    hir[target].pos,
                    |c| c.end_of_expr(file, target),
                    out,
                );
                let is_tuples = iterated.is_some() && self.every_type(source, |c, m| c.is_tuple(m));
                let has_default = |c: &Self, e: ExprId| {
                    matches!(hir[e].kind, ExprKind::Assign { op: None, .. })
                        && !is_parenthesized(c.hir(file), e)
                };
                for (index, item) in hir.ids(items).enumerate() {
                    match hir[item].kind {
                        ExprKind::Missing => {}
                        ExprKind::Spread(rest) => {
                            // One that is not the last (2462), or that has a default (1186), is refused as a whole.
                            if index + 1 < items.len() || has_default(self, rest) {
                                continue;
                            }
                            let ty = match iterated {
                                None => TypeId::UNRESOLVED,
                                // `sliceTupleType`
                                Some(_) if is_tuples => {
                                    self.element_of_destructured(source, index, true)
                                }
                                Some(iterated) => self.array_of(iterated),
                            };
                            self.check_destructuring_assignment(file, rest, ty, out);
                        }
                        // `checkArrayLiteralDestructuringElementAssignment`
                        _ => {
                            let ty = if iterated.is_none() {
                                TypeId::UNRESOLVED
                            } else {
                                let has_default = has_default(self, item);
                                if !has_default
                                    && is_tuples
                                    && let Some(code) = self.past_the_end_of_tuples(
                                        source,
                                        self.number_name(index as f64),
                                    )
                                {
                                    let start = self.start_of(file, item);
                                    out.push(Diagnostic { start, code });
                                    let end = self.end_of_expr(file, item);
                                    let name = self.number_name(index as f64);
                                    self.explain_to(start, end, code, |c| {
                                        past_the_end_arguments(c, code, source, name)
                                    });
                                }
                                let ty = self.element_of_destructured(source, index, false);
                                let ty = if has_default {
                                    self.type_with_ne_undefined(ty)
                                } else {
                                    ty
                                };
                                // `getFlowTypeOfDestructuring`
                                if self.is_known(ty) {
                                    self.narrow_destructured_assignment(file, item, ty)
                                } else {
                                    ty
                                }
                            };
                            self.check_destructuring_assignment(file, item, ty, out);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// `getTypeFactsWorker`: an instantiable type or an intersection has the facts of its base constraint, or of `unknown` if it has
    /// none. Returns the type whose members decide the facts of `member`, which is not a union.
    fn type_deciding_facts(&mut self, member: TypeId) -> TypeId {
        if !self.is_deferred(member) && !self.is_intersection(member) {
            return member;
        }
        let constraint = self.base_constraint_of(member).unwrap_or(TypeId::UNKNOWN);
        self.force(constraint)
    }

    /// `hasTypeFacts(ty, TypeFactsIsUndefined)`: `undefined` is in `ty`, or in what it extends. `any`, `unknown` and `void` have it not.
    fn has_undefined_in_it(&mut self, ty: TypeId) -> bool {
        for &m in self.parts(ty) {
            let m = self.type_deciding_facts(m);
            if self.some_type(m, |_, p| p.is_undefined()) {
                return true;
            }
        }
        false
    }

    /// `getTypeWithFacts(ty, TypeFactsNEUndefined)`: `ty` without the members that can only be `undefined`. `VoidFacts` lacks
    /// `NEUndefined` as well, and `never` has no facts.
    fn type_with_ne_undefined(&mut self, ty: TypeId) -> TypeId {
        self.filter(ty, |c, member| {
            let deciding = c.type_deciding_facts(member);
            c.some_type(deciding, |_, part| {
                !part.is_undefined() && part != TypeId::VOID && part != TypeId::NEVER
            })
        })
    }

    /// `checkReferenceAssignment`, and what `checkAssignmentOperator` does for a default: `source` is assigned to `target`, which is
    /// no pattern. `value`: what is assigned, if it is written.
    fn check_reference_assignment(
        &mut self,
        file: FileId,
        target: ExprId,
        source: TypeId,
        value: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        // What cannot be assigned to is told off for that with the operators (2364 2701 2778 2779), and no more is said.
        if !self.is_reference(file, target) {
            return;
        }
        let wanted = self.type_of_assignment_target(file, target);
        let at = self.error_start_of(file, target);
        let end = self.error_end_of(file, target);
        self.check_assignable_with_end(file, source, wanted, at, end, value, 2322, out);
    }

    /// `checkReferenceExpression`: a name or a property access, whatever is asserted of it, that is no optional chain.
    fn is_reference(&self, file: FileId, mut e: ExprId) -> bool {
        let hir = self.hir(file);
        loop {
            e = match hir[e].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                // What is not there is a name without letters.
                ExprKind::Ident(_) | ExprKind::Missing => return true,
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                    return chain == Chain::No;
                }
                _ => return false,
            };
        }
    }

    /// `checkExpression`, of what is written where something is assigned to.
    fn type_of_assignment_target(&mut self, file: FileId, target: ExprId) -> TypeId {
        let ty = self.type_of_expr(file, target);
        // What cannot be written to (2588, 2540, 2476 ..) has the error type, which takes anything.
        if self.is_error_type(ty) {
            return ty;
        }
        match self.hir(file)[target].kind {
            // `checkIdentifier`: `IArguments`
            ExprKind::Ident(_) if self.bound(file).is_arguments_object(target) => ty,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.declared_type_of_reference(file, target)
            }
            // Whatever else is written there is what it is.
            _ if self.is_uncertain(file, target) => TypeId::UNRESOLVED,
            _ => ty,
        }
    }

    /// `getIndexNodeForAccessExpression`: where an error about looking up the name `key`, written at `pos`, goes: of `[k]`, at what is
    /// in the brackets.
    fn start_of_index_node(&self, file: FileId, key: PropKey, pos: u32) -> u32 {
        if let PropKey::Computed(k) = key {
            return self.start_of(file, k);
        }
        // `["a"]` is kept as the name `a`.
        let text = &self.hir(file).text;
        if text.get(pos as usize) != Some(&b'[') {
            return pos;
        }
        let mut at = pos as usize + 1;
        while text.get(at).is_some_and(|b| b.is_ascii_whitespace()) {
            at += 1;
        }
        at as u32
    }

    /// Where that node ends. 0: it is one token.
    fn end_of_index_node(&self, file: FileId, key: PropKey) -> u32 {
        match key {
            PropKey::Computed(k) => self.end_of_expr(file, k),
            _ => 0,
        }
    }

    /// `getIndexedAccessTypeOrUndefined`, asked by a name in a pattern for which `source` has no property: what `source` has under
    /// `key`. For each member of `key` that finds nothing, from `at` to `end`: 2339 if it is a literal, 2537 if it is `string` or
    /// `number`, else 2538; what comes out is then the error type. Both types are known, and `source` is not `any`.
    #[allow(clippy::too_many_arguments)]
    fn destructured_property(
        &mut self,
        file: FileId,
        source: TypeId,
        key: TypeId,
        allows_missing: bool,
        at: u32,
        end: impl Fn(&Self) -> u32,
        out: &mut Vec<Diagnostic>,
    ) -> TypeId {
        // `getReducedApparentType`: what is generic is looked into as what it extends. What is generic even so is put off.
        let object = self.apparent_type(source);
        if self.is_generic(object) || self.is_generic(key) {
            return TypeId::UNRESOLVED;
        }
        let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut is_missing = false;
        for &part in self.parts(key) {
            // `getPropertyTypeForIndexType`. Any index signature takes `any`; without one it is no index type.
            let found = if self.has_any_flag(part)
                && !self.is_union(object)
                && self
                    .members(object)
                    .is_some_and(|m| m.shape().index.is_empty())
            {
                None
            } else {
                self.indexed_access_if_any(object, part, true)
            };
            match found {
                Some(ty) => types.push(ty),
                None if allows_missing => types.push(TypeId::UNDEFINED),
                None => {
                    let code = if matches!(
                        self.data(part),
                        TypeData::StringLit { .. }
                            | TypeData::NumberLit { .. }
                            | TypeData::EnumLit { .. }
                    ) {
                        2339
                    } else if part == TypeId::STRING || part == TypeId::NUMBER {
                        2537
                    } else {
                        2538
                    };
                    out.push(Diagnostic { start: at, code });
                    let until = end(&*self);
                    self.explain_to(at, until, code, |c| {
                        let object = c.reduced(object);
                        match code {
                            2339 => vec![literal_value_text(c, part), c.type_to_string(object)],
                            2537 => vec![c.type_to_string(object), c.type_to_string(part)],
                            // `indexNode.Kind == KindBigIntLiteral`
                            _ if matches!(c.data(part), TypeData::BigIntLit { .. })
                                && c.hir(file)
                                    .text
                                    .get(at as usize)
                                    .is_some_and(|b| b.is_ascii_digit()) =>
                            {
                                vec!["bigint".to_owned()]
                            }
                            _ => vec![c.type_to_string(part)],
                        }
                    });
                    is_missing = true;
                }
            }
        }
        if is_missing {
            TypeId::UNRESOLVED
        } else {
            self.union(&types)
        }
    }

    /// Whether `pat` is a pattern in which nothing has a name: it is empty, or all holes.
    fn binds_no_name(&self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Object(props) => props.is_empty(),
            PatKind::Array(elems) => elems
                .iter()
                .all(|e| matches!(hir[hir[e].pat].kind, PatKind::Missing)),
            _ => false,
        }
    }

    /// `checkVariableLikeDeclaration`, of a declaration whose name is a pattern in which nothing has a name: no element asks what is
    /// taken apart, so it is asked here. 2531 2532 2533 2571, 2488.
    fn check_pattern_without_names(
        &mut self,
        file: FileId,
        pat: PatId,
        type_parents: &mut Option<Vec<TypeNodeId>>,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let initializer = match bound.pat_parent[pat.idx()] {
            PatParent::None => return,
            PatParent::Var(d) => {
                // The initializer of the variable of a `for`-`in` is an error already.
                let s = bound.var_stmt[d.idx()];
                let is_of_for_in = s.is_some()
                    && matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l) if matches!(hir[l].kind, StmtKind::ForIn { left, .. } if left == s));
                if is_of_for_in {
                    ExprId::NONE
                } else {
                    hir[d].init
                }
            }
            PatParent::Param(q) => hir[q].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
        };
        let mut root = pat;
        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
            bound.pat_parent[root.idx()]
        {
            root = outer;
        }
        let mut at = hir[pat].pos;
        // The parameter, if the error is about the whole of it. A variable or a binding element is pointed at by its name.
        let mut parameter = ParamId::NONE;
        let mut is_put_off = false;
        let is_annotated = match bound.pat_parent[root.idx()] {
            PatParent::Var(d) => {
                if hir[d].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration {
                    return;
                }
                hir[d].ty.is_some()
            }
            PatParent::Param(q) => {
                let func = bound.param_fn[q.idx()];
                // An initializer where there is no body is 2371, and no more is said.
                if initializer.is_some() && matches!(hir[func].body, FnBody::None) {
                    return;
                }
                // `isInAmbientOrTypeNode`
                if self.where_parameters_are(file, func, type_parents) != (false, false) {
                    return;
                }
                if root == pat {
                    // An error about a parameter starts where the parameter does.
                    at = hir[q].pos;
                    parameter = q;
                    // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` looks at the parameters of an argument while the call
                    // is being resolved, when what is expected is still in terms of the type parameters of what is called.
                    let index = (q.0 - hir[func].params.start) as usize;
                    is_put_off = hir[q].ty.is_none()
                        && self.iife_param_type(file, func, index).is_none()
                        && self.contextual_param_type(file, func, index).is_some();
                }
                hir[q].ty.is_some()
            }
            _ => return,
        };
        let end = move |c: &Self| {
            if parameter.is_some() {
                c.end_of_param(file, parameter)
            } else {
                c.end_of_pat(file, pat)
            }
        };
        let strict = self.p.files.options.strict_null_checks;
        if strict && initializer.is_some() {
            let ty = self.type_of_expr(file, initializer);
            if !self.is_uncertain(file, initializer) {
                self.check_not_null_nor_void(ty, at, end, out);
            }
        }
        if is_put_off {
            return;
        }
        // `getWidenedTypeForVariableLikeDeclaration`. What is written out is not widened.
        let mut widened = self.type_of_pat(file, pat);
        if !is_annotated {
            widened = self.regular_object(widened);
        }
        match hir[pat].kind {
            PatKind::Array(_) => {
                self.check_iterated(widened, false, at, end, out);
            }
            _ if strict => self.check_not_null_nor_void(widened, at, end, out),
            _ => {}
        }
    }

    /// `checkNonNullNonVoidType`, said of a declaration, which is no entity name, where `null` and `undefined` are told apart:
    /// 2571, 2531 to 2533.
    fn check_not_null_nor_void(
        &mut self,
        ty: TypeId,
        at: u32,
        end: impl FnOnce(&Self) -> u32,
        out: &mut Vec<Diagnostic>,
    ) {
        if !self.is_known(ty) || self.is_any(ty) {
            return;
        }
        let (mut undefined, mut null) = (false, false);
        for &m in self.parts(ty) {
            // `getTypeFacts`: what is generic can be what it extends can be.
            let m = if self.is_deferred(m) {
                self.base_constraint(m)
            } else {
                m
            };
            undefined |= self.some_type(m, |_, p| p.is_undefined());
            null |= self.some_type(m, |_, p| p.is_null());
        }
        let code = match (undefined, null) {
            _ if ty == TypeId::UNKNOWN => 2571,
            (true, true) => 2533,
            (true, false) => 2532,
            (false, true) => 2531,
            // Only `void` itself: in a union it goes unnoticed, or goes with the `null`.
            _ if ty == TypeId::VOID => 2532,
            _ => return,
        };
        out.push(Diagnostic { start: at, code });
        let end = end(&*self);
        self.explain_to(at, end, code, |_| vec![]);
    }

    /// The two halves of `isInAmbientOrTypeNode`, of the parameters of `func`: whether they are only declared (`NodeFlagsAmbient`),
    /// and whether they are in an interface, a type alias or a type literal.
    fn where_parameters_are(
        &self,
        file: FileId,
        func: FnId,
        type_parents: &mut Option<Vec<TypeNodeId>>,
    ) -> (bool, bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut is_ambient, mut is_in_type) = (hir.kind == FileKind::Declaration, false);
        // A type literal has no scope of its own, nor has the variable a type is written for.
        let mut node = match bound.fns[func.idx()].owner {
            FnOwner::Type(node) => node,
            FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::TypeLiteral(node) => node,
                _ => TypeNodeId::NONE,
            },
            _ => TypeNodeId::NONE,
        };
        if node.is_some() {
            let parents = type_parents.get_or_insert_with(|| Self::type_node_parents(hir, bound));
            loop {
                is_in_type |= matches!(hir[node].kind, TypeNodeKind::Object(_));
                let parent = parents[node.idx()];
                if parent.is_none() {
                    break;
                }
                node = parent;
            }
            is_ambient |= hir
                .var_decls
                .iter()
                .any(|d| d.ty == node && d.flags.contains(Flags::AMBIENT));
        }
        let mut scope = bound.fns[func.idx()].scope;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Module(m) => is_ambient |= hir[m].flags.contains(Flags::AMBIENT),
                ScopeKind::Fn(f) => is_ambient |= hir[f].flags.contains(Flags::AMBIENT),
                ScopeKind::Class(c) => is_ambient |= hir[c].flags.contains(Flags::AMBIENT),
                ScopeKind::Interface(_) => is_in_type = true,
                ScopeKind::TypeParams => is_in_type |= bound.alias_scope.contains(&scope),
                _ => {}
            }
            scope = s.parent;
        }
        (is_ambient, is_in_type)
    }

    /// `GetContainingFunction`: the function the `yield` `e` is written in, be it in a default of a pattern, after `extends` or in a
    /// decorator of a class. `None`: there is none, or it is not looked into. In a static block or the initializer of a property,
    /// where there is no yielding, whether `yield` is the keyword at all depends on what follows it.
    fn containing_function(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let bound = self.bound(file);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            match parent {
                Parent::FnBody(f) => return Some(f),
                Parent::ParamDefault(p) => return Some(bound.param_fn[p.idx()]),
                // The computed name of a property of an object literal is where the literal is.
                Parent::Key(literal) if literal.is_some() => parent = Parent::Expr(literal),
                // The decorators and the computed name of a method are part of the method.
                Parent::None
                | Parent::File
                | Parent::Module(_)
                | Parent::MemberInit(_)
                | Parent::EnumInit(_)
                | Parent::Key(_)
                | Parent::MemberKey
                | Parent::Decorator(_, DecoratorOwner::Member(_) | DecoratorOwner::Param(_)) => {
                    return None;
                }
                _ => parent = self.outward(file, parent),
            }
        }
    }

    /// `checkYieldExpression`: what is yielded against what the generator says it yields.
    fn check_yield(
        &mut self,
        file: FileId,
        e: ExprId,
        value: ExprId,
        star: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let Some(func) = self.containing_function(file, e) else {
            return;
        };
        let f = &hir[func];
        if !f.flags.contains(Flags::GENERATOR) {
            return;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        let mut yielded = if value.is_some() {
            self.type_of_expr(file, value)
        } else {
            TypeId::UNDEFINED
        };
        if value.is_some() && self.is_uncertain(file, value) {
            return;
        }
        let at = if value.is_some() {
            self.error_start_of(file, value)
        } else {
            hir[e].pos
        };
        // An error about a `yield` as a whole is put on the keyword.
        let end = move |c: &Self| {
            if value.is_some() {
                c.error_end_of(file, value)
            } else {
                0
            }
        };
        if star {
            match self.check_iterated(yielded, is_async, at, end, out) {
                Some(iterated) => yielded = iterated,
                None => return,
            }
        }
        if f.ret.is_none() {
            return;
        }
        let mut declared = self.type_from_node(file, f.ret);
        if !self.is_known(declared) || self.is_any(declared) {
            return;
        }
        // Of the alternatives, those that a generator can be.
        if self.is_union(declared) {
            declared = self.filter(declared, |c, m| {
                let generator = c.generator_instantiation(m, is_async);
                c.is_assignable(generator, m)
            });
        }
        let Some(wanted) = self.iteration_types(declared, is_async).map(|t| t.yielded) else {
            return;
        };
        if is_async {
            yielded = self.awaited(yielded);
        }
        let end = end(&*self);
        self.check_assignable_with_end(
            file,
            yielded,
            wanted,
            at,
            end,
            if star { ExprId::NONE } else { value },
            2322,
            out,
        );
    }
}

/// The arguments of what `past_the_end_of_tuples` says of the element `name` of `object`: 2493, or 2339 of a union.
fn past_the_end_arguments(
    c: &mut Checker<'_>,
    code: u32,
    object: TypeId,
    name: Atom,
) -> Vec<String> {
    let printed = c.type_to_string(object);
    if code != 2493 {
        return vec![c.atom_text(name), printed];
    }
    // `getTypeReferenceArity`
    let length = match c.data(object) {
        TypeData::Tuple { elems, .. } => elems.len(),
        _ => 0,
    };
    vec![printed, length.to_string(), c.atom_text(name)]
}

/// `LiteralType.value` of a string or number literal type or of a member of an enum, as it is put in a message.
fn literal_value_text(c: &Checker<'_>, ty: TypeId) -> String {
    match *c.data(ty) {
        TypeData::StringLit { value, .. }
        | TypeData::EnumLit {
            value: EnumValue::String(value),
            ..
        } => c.atom_text(value),
        TypeData::NumberLit { bits, .. }
        | TypeData::EnumLit {
            value: EnumValue::Number(bits),
            ..
        } => crate::atom::number_to_string(f64::from_bits(bits)),
        _ => String::new(),
    }
}

/// The arguments of what `checkPropertyAccessibilityAtLocation` says of the property `name` of `containing`, asked for by `e`:
/// 2341 2445 2446.
fn accessibility_arguments(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    code: u32,
    containing: TypeId,
    name: Atom,
) -> Vec<String> {
    let first = c.parts(containing).first().copied().unwrap_or(containing);
    let first = c.apparent_type(first);
    // `getDeclaringClass`
    let declaring = match c.prop_of(first, name) {
        Some((prop, _)) => c.declaring_class(&prop),
        None => None,
    };
    let property = c.atom_text(name);
    if code != 2446 {
        let class = match declaring {
            Some(class) => c.declared_type(class),
            None => containing,
        };
        return vec![property, c.type_to_string(class)];
    }
    // The innermost class around that is, or derives from, the one that declares it.
    let mut enclosing = None;
    for class in c.enclosing_classes(file, e) {
        let class = c.class_sym(file, class);
        let declared = c.declared_type(class);
        if let Some(declaring) = declaring
            && c.has_base(declared, declaring, 0)
        {
            enclosing = Some(declared);
            break;
        }
    }
    let through = if c.is_deferred(containing) {
        c.base_constraint(containing)
    } else {
        containing
    };
    let enclosing = match enclosing {
        Some(class) => c.type_to_string(class),
        None => String::new(),
    };
    vec![property, enclosing, c.type_to_string(through)]
}
