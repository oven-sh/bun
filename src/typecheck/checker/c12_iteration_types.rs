// checker.go:6185-6824 (layer D-ITER): iterated and element types, the iteration types of iterables, iterators and their methods, and the errors for a type that cannot be iterated.
use crate::ast::{Arg, DiagnosticId, NodeId, SymbolFlags, is_for_of_statement};
use crate::checker::{
    Checker, IterationTypeKind, IterationTypes, IterationTypesKey, IterationTypesResolverKind,
    IterationUse, ObjectFlags, SignatureId, SignatureKind, TypeAliasId, TypeFacts, TypeFlags,
    TypeId, UnionReduction, is_type_any,
};
use crate::core::{List, Tristate, same};
use crate::diagnostics::{self, MessageId};

// checker.go:521-535 and 1265-1300: the fields of the two IterationTypesResolver values of initializeIterationResolvers, as methods that switch on the kind of the resolver.
impl IterationTypesResolverKind {
    pub fn iterator_symbol_name(self) -> &'static [u8] {
        match self {
            IterationTypesResolverKind::Sync => b"iterator",
            IterationTypesResolverKind::Async => b"asyncIterator",
        }
    }

    pub fn get_global_iterator_type(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterator_type(),
            IterationTypesResolverKind::Async => c.get_global_async_iterator_type(),
        }
    }

    pub fn get_global_iterable_type(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterable_type(),
            IterationTypesResolverKind::Async => c.get_global_async_iterable_type(),
        }
    }

    pub fn get_global_iterable_type_checked(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterable_type_checked(),
            IterationTypesResolverKind::Async => c.get_global_async_iterable_type_checked(),
        }
    }

    pub fn get_global_iterable_iterator_type(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterable_iterator_type(),
            IterationTypesResolverKind::Async => c.get_global_async_iterable_iterator_type(),
        }
    }

    pub fn get_global_iterable_iterator_type_checked(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterable_iterator_type_checked(),
            IterationTypesResolverKind::Async => {
                c.get_global_async_iterable_iterator_type_checked()
            }
        }
    }

    pub fn get_global_iterator_object_type(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_iterator_object_type(),
            IterationTypesResolverKind::Async => c.get_global_async_iterator_object_type(),
        }
    }

    pub fn get_global_generator_type(self, c: &mut Checker<'_>) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => c.get_global_generator_type(),
            IterationTypesResolverKind::Async => c.get_global_async_generator_type(),
        }
    }

    // getGlobalTypesResolver(names, 1, false): the list is not memoized, since the lookup of a global type without error reporting answers the same on every call.
    pub fn get_global_builtin_iterator_types(self, c: &mut Checker<'_>) -> Vec<TypeId> {
        let names: &[&[u8]] = match self {
            IterationTypesResolverKind::Sync => &[
                b"ArrayIterator",
                b"MapIterator",
                b"SetIterator",
                b"StringIterator",
            ],
            IterationTypesResolverKind::Async => &[b"ReadableStreamAsyncIterator"],
        };
        let mut types: Vec<TypeId> = Vec::with_capacity(names.len());
        for &name in names {
            types.push(c.get_global_type(name, 1, false));
        }
        types
    }

    pub fn resolve_iteration_type(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
        error_node: NodeId,
    ) -> TypeId {
        match self {
            IterationTypesResolverKind::Sync => t,
            IterationTypesResolverKind::Async => c.get_awaited_type_ex(
                t,
                error_node,
                diagnostics::TYPE_OF_AWAIT_OPERAND_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
                &[],
            ),
        }
    }

    pub fn must_have_a_next_method_diagnostic(self) -> MessageId {
        match self {
            IterationTypesResolverKind::Sync => diagnostics::AN_ITERATOR_MUST_HAVE_A_NEXT_METHOD,
            IterationTypesResolverKind::Async => {
                diagnostics::AN_ASYNC_ITERATOR_MUST_HAVE_A_NEXT_METHOD
            }
        }
    }

    pub fn must_be_a_method_diagnostic(self) -> MessageId {
        match self {
            IterationTypesResolverKind::Sync => {
                diagnostics::THE_0_PROPERTY_OF_AN_ITERATOR_MUST_BE_A_METHOD
            }
            IterationTypesResolverKind::Async => {
                diagnostics::THE_0_PROPERTY_OF_AN_ASYNC_ITERATOR_MUST_BE_A_METHOD
            }
        }
    }

    pub fn must_have_a_value_diagnostic(self) -> MessageId {
        match self {
            IterationTypesResolverKind::Sync => {
                diagnostics::THE_TYPE_RETURNED_BY_THE_0_METHOD_OF_AN_ITERATOR_MUST_HAVE_A_VALUE_PROPERTY
            }
            IterationTypesResolverKind::Async => {
                diagnostics::THE_TYPE_RETURNED_BY_THE_0_METHOD_OF_AN_ASYNC_ITERATOR_MUST_BE_A_PROMISE_FOR_A_TYPE_WITH_A_VALUE_PROPERTY
            }
        }
    }
}

impl<'a> Checker<'a> {
    pub fn check_iterated_type_or_element_type(
        &mut self,
        use_: IterationUse,
        input_type: TypeId,
        sent_type: TypeId,
        error_node: NodeId,
    ) -> TypeId {
        if is_type_any(self, input_type) {
            return input_type;
        }
        let t =
            self.get_iterated_type_or_element_type(use_, input_type, sent_type, error_node, true);
        if !t.is_nil() {
            return t;
        }
        self.any_type
    }

    pub fn get_iterated_type_or_element_type(
        &mut self,
        use_: IterationUse,
        input_type: TypeId,
        sent_type: TypeId,
        error_node: NodeId,
        check_assignability: bool,
    ) -> TypeId {
        let allow_async_iterables = use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG);
        if input_type == self.never_type {
            if !error_node.is_nil() {
                self.report_type_not_iterable_error(error_node, input_type, allow_async_iterables);
            }
            return TypeId::NIL;
        }
        let iterable_exists = self.get_global_iterable_type() != self.empty_generic_type;
        let possible_out_of_bounds = self.compiler_options.no_unchecked_indexed_access
            == Tristate::TRUE
            && use_.intersects(IterationUse::POSSIBLY_OUT_OF_BOUNDS);
        if iterable_exists || allow_async_iterables {
            let iteration_types = self.get_iteration_types_of_iterable(
                input_type,
                use_,
                if iterable_exists {
                    error_node
                } else {
                    NodeId::NIL
                },
            );
            if check_assignability {
                if !iteration_types.next_type.is_nil() {
                    let diagnostic = if use_.intersects(IterationUse::FOR_OF_FLAG) {
                        diagnostics::CANNOT_ITERATE_VALUE_BECAUSE_THE_NEXT_METHOD_OF_ITS_ITERATOR_EXPECTS_TYPE_1_BUT_FOR_OF_WILL_ALWAYS_SEND_0
                    } else if use_.intersects(IterationUse::SPREAD_FLAG) {
                        diagnostics::CANNOT_ITERATE_VALUE_BECAUSE_THE_NEXT_METHOD_OF_ITS_ITERATOR_EXPECTS_TYPE_1_BUT_ARRAY_SPREAD_WILL_ALWAYS_SEND_0
                    } else if use_.intersects(IterationUse::DESTRUCTURING_FLAG) {
                        diagnostics::CANNOT_ITERATE_VALUE_BECAUSE_THE_NEXT_METHOD_OF_ITS_ITERATOR_EXPECTS_TYPE_1_BUT_ARRAY_DESTRUCTURING_WILL_ALWAYS_SEND_0
                    } else if use_.intersects(IterationUse::YIELD_STAR_FLAG) {
                        diagnostics::CANNOT_DELEGATE_ITERATION_TO_VALUE_BECAUSE_THE_NEXT_METHOD_OF_ITS_ITERATOR_EXPECTS_TYPE_1_BUT_THE_CONTAINING_GENERATOR_WILL_ALWAYS_SEND_0
                    } else {
                        MessageId::NIL
                    };
                    if !diagnostic.is_nil() {
                        self.check_type_assignable_to(
                            sent_type,
                            iteration_types.next_type,
                            error_node,
                            diagnostic,
                        );
                    }
                }
            }
            if !iteration_types.yield_type.is_nil() || iterable_exists {
                if iteration_types.yield_type.is_nil() {
                    return TypeId::NIL;
                }
                if possible_out_of_bounds {
                    return self.include_undefined_in_index_signature(iteration_types.yield_type);
                }
                return iteration_types.yield_type;
            }
        }
        let mut array_type = input_type;
        let mut has_string_constituent = false;
        // If strings are permitted, remove any string-like constituents from the array type. This allows us to find other non-string element types from an array unioned with a string.
        if use_.intersects(IterationUse::ALLOWS_STRING_INPUT_FLAG) {
            if self.types[array_type].flags.intersects(TypeFlags::UNION) {
                // After we remove all types that are StringLike, we will know if there was a string constituent based on whether the result of filter is a new array.
                let array_types = self.type_types(input_type);
                let filtered_types = self.filter(array_types, |c, t| {
                    !c.types[t].flags.intersects(TypeFlags::STRING_LIKE)
                });
                if !same(filtered_types.as_slice(), array_types.as_slice()) {
                    array_type = self.get_union_type_ex(
                        filtered_types,
                        UnionReduction::SUBTYPE,
                        TypeAliasId::NIL,
                        TypeId::NIL,
                    );
                }
            } else if self.types[array_type]
                .flags
                .intersects(TypeFlags::STRING_LIKE)
            {
                array_type = self.never_type;
            }
            has_string_constituent = array_type != input_type;
            if has_string_constituent {
                // Now that we've removed all the StringLike types, if no constituents remain, then the entire arrayOrStringType was a string.
                if self.types[array_type].flags.intersects(TypeFlags::NEVER) {
                    if possible_out_of_bounds {
                        return self.include_undefined_in_index_signature(self.string_type);
                    }
                    return self.string_type;
                }
            }
        }
        if !self.is_array_like_type(array_type) {
            if !error_node.is_nil() {
                // Which error we report depends on whether we allow strings or if there was a string constituent. For example, if the input type is number | string, we want to say that number is not an array type. But if the input was just number and string input is allowed, we want to say that number is not an array type or a string type.
                let allows_strings = use_.intersects(IterationUse::ALLOWS_STRING_INPUT_FLAG)
                    && !has_string_constituent;
                let (default_diagnostic, maybe_missing_await) =
                    self.get_iteration_diagnostic_details(use_, input_type, allows_strings);
                let suggest_await =
                    maybe_missing_await && !self.get_awaited_type_of_promise(array_type).is_nil();
                let type_name = self.type_to_string_exported(array_type);
                self.error_and_maybe_suggest_await(
                    error_node,
                    suggest_await,
                    default_diagnostic,
                    &[Arg::Str(&type_name)],
                );
            }
            if has_string_constituent {
                if possible_out_of_bounds {
                    return self.include_undefined_in_index_signature(self.string_type);
                }
                return self.string_type;
            }
            return TypeId::NIL;
        }
        let array_element_type = self.get_index_type_of_type(array_type, self.number_type);
        if has_string_constituent && !array_element_type.is_nil() {
            // This is just an optimization for the case where arrayOrStringType is string | string[]
            if self.types[array_element_type]
                .flags
                .intersects(TypeFlags::STRING_LIKE)
                && self.compiler_options.no_unchecked_indexed_access != Tristate::TRUE
            {
                return self.string_type;
            }
            if possible_out_of_bounds {
                return self.get_union_type_ex(
                    List::from_slice(&[array_element_type, self.string_type, self.undefined_type]),
                    UnionReduction::SUBTYPE,
                    TypeAliasId::NIL,
                    TypeId::NIL,
                );
            }
            return self.get_union_type_ex(
                List::from_slice(&[array_element_type, self.string_type]),
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        if use_.intersects(IterationUse::POSSIBLY_OUT_OF_BOUNDS) {
            return self.include_undefined_in_index_signature(array_element_type);
        }
        array_element_type
    }

    // Gets the requested "iteration type" from a type that is either `Iterable`-like, `Iterator`-like, `IterableIterator`-like, or `Generator`-like (for a non-async generator); or `AsyncIterable`-like, `AsyncIterator`-like, `AsyncIterableIterator`-like, or `AsyncGenerator`-like (for an async generator).
    pub fn get_iteration_type_of_generator_function_return_type(
        &mut self,
        type_kind: IterationTypeKind,
        return_type: TypeId,
        is_async_generator: bool,
    ) -> TypeId {
        if is_type_any(self, return_type) {
            return TypeId::NIL;
        }
        let iteration_types = self
            .get_iteration_types_of_generator_function_return_type(return_type, is_async_generator);
        iteration_types.get_type(self, type_kind)
    }

    pub fn get_iteration_types_of_generator_function_return_type(
        &mut self,
        t: TypeId,
        is_async_generator: bool,
    ) -> IterationTypes {
        if is_type_any(self, t) {
            return IterationTypes {
                yield_type: self.any_type,
                return_type: self.any_type,
                next_type: self.any_type,
            };
        }
        let use_ = if is_async_generator {
            IterationUse::ASYNC_GENERATOR_RETURN_TYPE
        } else {
            IterationUse::GENERATOR_RETURN_TYPE
        };
        let resolver = if is_async_generator {
            IterationTypesResolverKind::Async
        } else {
            IterationTypesResolverKind::Sync
        };
        let result = self.get_iteration_types_of_iterable(t, use_, NodeId::NIL);
        if result.has_types() {
            return result;
        }
        self.get_iteration_types_of_iterator(t, resolver, NodeId::NIL, None)
    }

    // Gets the requested "iteration type" from an `Iterable`-like or `AsyncIterable`-like type.
    pub fn get_iteration_type_of_iterable(
        &mut self,
        use_: IterationUse,
        type_kind: IterationTypeKind,
        input_type: TypeId,
        error_node: NodeId,
    ) -> TypeId {
        if is_type_any(self, input_type) {
            return TypeId::NIL;
        }
        let iteration_types = self.get_iteration_types_of_iterable(input_type, use_, error_node);
        iteration_types.get_type(self, type_kind)
    }

    // Gets the *yield*, *return*, and *next* types from an `Iterable`-like or `AsyncIterable`-like type. At every level that involves analyzing return types of signatures, we union the return types of all the signatures. Another thing to note is that at any step of this process, we could run into a dead end, meaning either the property is missing, or we run into the anyType. If either of these things happens, we return a default `IterationTypes{}` to signal that we could not find the iteration type. If a property is missing, and the previous step did not result in `any`, then we also give an error if the caller requested it. Then the caller can decide what to do in the case where there is no iterated type. For a **for-of** statement, `yield*` (in a normal generator), spread, array destructuring, or normal generator we will only ever look for a `[Symbol.iterator]()` method. For an async generator we will only ever look at the `[Symbol.asyncIterator]()` method. For a **for-await-of** statement or a `yield*` in an async generator we will look for the `[Symbol.asyncIterator]()` method first, and then the `[Symbol.iterator]()` method.
    pub fn get_iteration_types_of_iterable(
        &mut self,
        t: TypeId,
        use_: IterationUse,
        error_node: NodeId,
    ) -> IterationTypes {
        let t = self.get_reduced_type(t);
        if is_type_any(self, t) {
            return IterationTypes {
                yield_type: self.any_type,
                return_type: self.any_type,
                next_type: self.any_type,
            };
        }
        let key = IterationTypesKey {
            type_id: t,
            use_flags: use_ & IterationUse::CACHE_FLAGS,
        };
        // If we are reporting errors and encounter a cached `noIterationTypes`, we should ignore the cached value and continue as if nothing was cached. In addition, we should not cache any new results for this call.
        let mut no_cache = false;
        if let Some(cached) = self.iteration_types_cache.get_ok(&key) {
            if error_node.is_nil() || cached.has_types() {
                return cached;
            }
            no_cache = true;
        }
        let result = self.get_iteration_types_of_iterable_worker(t, use_, error_node, no_cache);
        if !no_cache {
            let ok = self.iteration_types_cache.set(key, result);
            self.map_set(ok);
        }
        result
    }

    pub fn get_iteration_types_of_iterable_worker(
        &mut self,
        t: TypeId,
        use_: IterationUse,
        error_node: NodeId,
        no_cache: bool,
    ) -> IterationTypes {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return IterationTypes::default();
        }
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            let constituents = self.type_types(t);
            let mut all_iteration_types: Vec<IterationTypes> =
                Vec::with_capacity(constituents.as_slice().len());
            for &constituent in constituents.as_slice() {
                let iteration_types = self.get_iteration_types_of_iterable_worker(
                    constituent,
                    use_,
                    NodeId::NIL,
                    no_cache,
                );
                if !iteration_types.has_types() {
                    if !error_node.is_nil() {
                        self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                            c.report_type_not_iterable_error(
                                error_node,
                                t,
                                use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG),
                            );
                        }));
                    }
                    return IterationTypes::default();
                }
                all_iteration_types.push(iteration_types);
            }
            return self.combine_iteration_types(&all_iteration_types);
        }
        let mut diags: Vec<DiagnosticId> = Vec::new();
        if use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG) {
            let mut iteration_types =
                self.get_iteration_types_of_iterable_fast(t, IterationTypesResolverKind::Async);
            if iteration_types.has_types() {
                if use_.intersects(IterationUse::FOR_OF_FLAG) {
                    return self.get_async_from_sync_iteration_types(iteration_types, error_node);
                }
                return iteration_types;
            }
            iteration_types = self.get_iteration_types_of_iterable_slow(
                t,
                IterationTypesResolverKind::Async,
                error_node,
                Some(&mut diags),
            );
            if iteration_types.has_types() {
                if !diags.is_empty() {
                    for &d in &diags {
                        self.add_diagnostic(d);
                    }
                }
                return iteration_types;
            }
        }
        if use_.intersects(IterationUse::ALLOWS_SYNC_ITERABLES_FLAG) {
            let mut iteration_types =
                self.get_iteration_types_of_iterable_fast(t, IterationTypesResolverKind::Sync);
            if iteration_types.has_types() {
                if use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG) {
                    return self.get_async_from_sync_iteration_types(iteration_types, error_node);
                }
                return iteration_types;
            }
            iteration_types = self.get_iteration_types_of_iterable_slow(
                t,
                IterationTypesResolverKind::Sync,
                error_node,
                Some(&mut diags),
            );
            if iteration_types.has_types() {
                if !diags.is_empty() {
                    for &d in &diags {
                        self.add_diagnostic(d);
                    }
                }
                if use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG) {
                    return self.get_async_from_sync_iteration_types(iteration_types, error_node);
                }
                return iteration_types;
            }
        }
        if !error_node.is_nil() {
            // We defer the diagnostic because TypeToString may attempt to resolve symbols that are already being resolved, possibly causing circularities.
            self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                let diagnostic = c.report_type_not_iterable_error(
                    error_node,
                    t,
                    use_.intersects(IterationUse::ALLOWS_ASYNC_ITERABLES_FLAG),
                );
                for &d in &diags {
                    c.diagnostic_store.add_related_info(diagnostic, d);
                }
            }));
        }
        IterationTypes::default()
    }

    pub fn get_iteration_types_of_iterable_fast(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
    ) -> IterationTypes {
        // As an optimization, if the type is an instantiation of the following global type, then just grab its related type arguments: `Iterable<T, TReturn, TNext>` or `AsyncIterable<T, TReturn, TNext>`, `IteratorObject<T, TReturn, TNext>` or `AsyncIteratorObject<T, TReturn, TNext>`, `IterableIterator<T, TReturn, TNext>` or `AsyncIterableIterator<T, TReturn, TNext>`, `Generator<T, TReturn, TNext>` or `AsyncGenerator<T, TReturn, TNext>`
        if {
            let iterable_type = r.get_global_iterable_type(self);
            self.is_reference_to_type(t, iterable_type)
        } || {
            let iterator_object_type = r.get_global_iterator_object_type(self);
            self.is_reference_to_type(t, iterator_object_type)
        } || {
            let iterable_iterator_type = r.get_global_iterable_iterator_type(self);
            self.is_reference_to_type(t, iterable_iterator_type)
        } || {
            let generator_type = r.get_global_generator_type(self);
            self.is_reference_to_type(t, generator_type)
        } {
            let type_arguments = self.get_type_arguments(t);
            return r.get_resolved_iteration_types(
                self,
                type_arguments.at(0usize),
                type_arguments.at(1usize),
                type_arguments.at(2usize),
            );
        }
        // As an optimization, if the type is an instantiation of one of the following global types, then just grab the related type argument: `ArrayIterator<T>`, `MapIterator<T>`, `SetIterator<T>`, `StringIterator<T>`, `ReadableStreamAsyncIterator<T>`
        let builtin_iterator_types = r.get_global_builtin_iterator_types(self);
        if self.is_reference_to_some_type(t, &builtin_iterator_types) {
            let yield_type = self.get_type_arguments(t).at(0usize);
            let return_type = self.get_builtin_iterator_return_type();
            let next_type = self.unknown_type;
            return r.get_resolved_iteration_types(self, yield_type, return_type, next_type);
        }
        IterationTypes::default()
    }
}

impl IterationTypesResolverKind {
    pub fn get_resolved_iteration_types(
        self,
        c: &mut Checker<'_>,
        yield_type: TypeId,
        return_type: TypeId,
        next_type: TypeId,
    ) -> IterationTypes {
        let mut resolved_yield_type = self.resolve_iteration_type(c, yield_type, NodeId::NIL);
        if resolved_yield_type.is_nil() {
            resolved_yield_type = yield_type;
        }
        let mut resolved_return_type = self.resolve_iteration_type(c, return_type, NodeId::NIL);
        if resolved_return_type.is_nil() {
            resolved_return_type = return_type;
        }
        IterationTypes {
            yield_type: resolved_yield_type,
            return_type: resolved_return_type,
            next_type,
        }
    }
}

impl<'a> Checker<'a> {
    pub fn is_reference_to_type(&self, t: TypeId, target: TypeId) -> bool {
        !t.is_nil()
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            && self.type_target(t) == target
    }

    pub fn is_reference_to_some_type(&self, t: TypeId, targets: &[TypeId]) -> bool {
        !t.is_nil()
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            && targets.contains(&self.type_target(t))
    }

    pub fn get_builtin_iterator_return_type(&self) -> TypeId {
        if self.strict_builtin_iterator_return {
            self.undefined_type
        } else {
            self.any_type
        }
    }
}

impl IterationTypes {
    pub fn has_types(self) -> bool {
        !self.yield_type.is_nil() || !self.return_type.is_nil() || !self.next_type.is_nil()
    }

    pub fn get_type(self, c: &Checker<'_>, type_kind: IterationTypeKind) -> TypeId {
        match type_kind {
            IterationTypeKind::YIELD => self.yield_type,
            IterationTypeKind::RETURN => self.return_type,
            IterationTypeKind::NEXT => self.next_type,
            _ => c.fail("Unhandled case in getType(IterationTypeKind)"),
        }
    }
}

impl<'a> Checker<'a> {
    pub fn combine_iteration_types(
        &mut self,
        iteration_types: &[IterationTypes],
    ) -> IterationTypes {
        let yield_type = self.get_iteration_type_union(iteration_types, |t| t.yield_type);
        let return_type = self.get_iteration_type_union(iteration_types, |t| t.return_type);
        let next_type = self.get_iteration_type_union(iteration_types, |t| t.next_type);
        IterationTypes {
            yield_type,
            return_type,
            next_type,
        }
    }

    pub fn get_iteration_type_union(
        &mut self,
        iteration_types: &[IterationTypes],
        f: impl Fn(IterationTypes) -> TypeId,
    ) -> TypeId {
        let mut types: Vec<TypeId> = Vec::with_capacity(iteration_types.len());
        for &iteration_type in iteration_types {
            let t = f(iteration_type);
            if !t.is_nil() {
                types.push(t);
            }
        }
        if types.is_empty() {
            return TypeId::NIL;
        }
        self.get_union_type(List::from_slice(&types))
    }

    pub fn get_async_from_sync_iteration_types(
        &mut self,
        iteration_types: IterationTypes,
        error_node: NodeId,
    ) -> IterationTypes {
        if !iteration_types.has_types()
            || iteration_types.yield_type == self.any_type
                && iteration_types.return_type == self.any_type
                && iteration_types.next_type == self.any_type
        {
            return iteration_types;
        }
        // if we're requesting diagnostics, report errors for a missing `Awaited<T>`.
        if !error_node.is_nil() {
            self.get_global_awaited_symbol();
        }
        let mut yield_type =
            self.get_awaited_type_ex(iteration_types.yield_type, error_node, MessageId::NIL, &[]);
        if yield_type.is_nil() {
            yield_type = self.any_type;
        }
        let mut return_type =
            self.get_awaited_type_ex(iteration_types.return_type, error_node, MessageId::NIL, &[]);
        if return_type.is_nil() {
            return_type = self.any_type;
        }
        IterationTypes {
            yield_type,
            return_type,
            next_type: iteration_types.next_type,
        }
    }

    // Gets the *yield*, *return*, and *next* types of an `Iterable`-like or `AsyncIterable`-like type from its members. If we successfully found the *yield*, *return*, and *next* types, an `IterationTypes` with non-nil members is returned. Otherwise, a default `IterationTypes{}` is returned. NOTE: You probably don't want to call this directly and should be calling `getIterationTypesOfIterable` instead.
    pub fn get_iteration_types_of_iterable_slow(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
        error_node: NodeId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> IterationTypes {
        let method_name = self.get_property_name_for_known_symbol_name(r.iterator_symbol_name());
        let method = self.get_property_of_type(t, &method_name);
        if !method.is_nil() && !self.ast.sym(method).flags.intersects(SymbolFlags::OPTIONAL) {
            let method_type = self.get_type_of_symbol(method);
            if is_type_any(self, method_type) {
                return IterationTypes {
                    yield_type: self.any_type,
                    return_type: self.any_type,
                    next_type: self.any_type,
                };
            }
            let all_signatures = self.get_signatures_of_type(method_type, SignatureKind::CALL);
            let valid_signatures =
                self.filter(all_signatures, |c, sig| c.get_min_argument_count(sig) == 0);
            if valid_signatures.len() != 0 {
                let return_types = self.map_list(valid_signatures, |c, sig| {
                    c.get_return_type_of_signature(sig)
                });
                let iterator_type = self.get_intersection_type(return_types);
                return self.get_iteration_types_of_iterator_worker(
                    iterator_type,
                    r,
                    error_node,
                    diagnostic_output,
                );
            }
            if !error_node.is_nil() && all_signatures.len() != 0 {
                let iterable_type = r.get_global_iterable_type_checked(self);
                self.check_type_assignable_to_ex(
                    t,
                    iterable_type,
                    error_node,
                    MessageId::NIL,
                    diagnostic_output,
                );
            }
        }
        IterationTypes::default()
    }

    // Gets the *yield*, *return*, and *next* types from an `Iterator`-like or `AsyncIterator`-like type. If we successfully found the *yield*, *return*, and *next* types, an `IterationTypes` with non-nil members is returned. Otherwise, a default `IterationTypes{}` is returned.
    pub fn get_iteration_types_of_iterator(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
        error_node: NodeId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> IterationTypes {
        self.get_iteration_types_of_iterator_worker(t, r, error_node, diagnostic_output)
    }

    // Gets the *yield*, *return*, and *next* types from an `Iterator`-like or `AsyncIterator`-like type. If we successfully found the *yield*, *return*, and *next* types, an `IterationTypes` with non-nil members is returned. Otherwise, a default `IterationTypes{}` is returned. NOTE: You probably don't want to call this directly and should be calling `getIterationTypesOfIterator` instead.
    pub fn get_iteration_types_of_iterator_worker(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
        error_node: NodeId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> IterationTypes {
        if is_type_any(self, t) {
            return IterationTypes {
                yield_type: self.any_type,
                return_type: self.any_type,
                next_type: self.any_type,
            };
        }
        let iteration_types = self.get_iteration_types_of_iterator_fast(t, r);
        if iteration_types.has_types() {
            return iteration_types;
        }
        self.get_iteration_types_of_iterator_slow(t, r, error_node, diagnostic_output)
    }

    pub fn get_iteration_types_of_iterator_fast(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
    ) -> IterationTypes {
        // As an optimization, if the type is an instantiation of the following global type, then just grab its related type arguments: `Iterable<T, TReturn, TNext>` or `AsyncIterable<T, TReturn, TNext>`, `IteratorObject<T, TReturn, TNext>` or `AsyncIteratorObject<T, TReturn, TNext>`, `IterableIterator<T, TReturn, TNext>` or `AsyncIterableIterator<T, TReturn, TNext>`, `Generator<T, TReturn, TNext>` or `AsyncGenerator<T, TReturn, TNext>`
        if {
            let iterator_type = r.get_global_iterator_type(self);
            self.is_reference_to_type(t, iterator_type)
        } || {
            let iterator_object_type = r.get_global_iterator_object_type(self);
            self.is_reference_to_type(t, iterator_object_type)
        } || {
            let iterable_iterator_type = r.get_global_iterable_iterator_type(self);
            self.is_reference_to_type(t, iterable_iterator_type)
        } || {
            let generator_type = r.get_global_generator_type(self);
            self.is_reference_to_type(t, generator_type)
        } {
            let type_arguments = self.get_type_arguments(t);
            return r.get_resolved_iteration_types(
                self,
                type_arguments.at(0usize),
                type_arguments.at(1usize),
                type_arguments.at(2usize),
            );
        }
        // As an optimization, if the type is an instantiation of one of the following global types, then just grab the related type argument: `ArrayIterator<T>`, `MapIterator<T>`, `SetIterator<T>`, `StringIterator<T>`, `ReadableStreamAsyncIterator<T>`
        let builtin_iterator_types = r.get_global_builtin_iterator_types(self);
        if self.is_reference_to_some_type(t, &builtin_iterator_types) {
            let yield_type = self.get_type_arguments(t).at(0usize);
            let return_type = self.get_builtin_iterator_return_type();
            let next_type = self.unknown_type;
            return r.get_resolved_iteration_types(self, yield_type, return_type, next_type);
        }
        IterationTypes::default()
    }

    pub fn get_iteration_types_of_iterator_slow(
        &mut self,
        t: TypeId,
        r: IterationTypesResolverKind,
        error_node: NodeId,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> IterationTypes {
        let next_types = self.get_iteration_types_of_method(
            t,
            r,
            b"next",
            error_node,
            diagnostic_output.as_deref_mut(),
        );
        let return_types = self.get_iteration_types_of_method(
            t,
            r,
            b"return",
            error_node,
            diagnostic_output.as_deref_mut(),
        );
        let throw_types =
            self.get_iteration_types_of_method(t, r, b"throw", error_node, diagnostic_output);
        self.combine_iteration_types(&[next_types, return_types, throw_types])
    }

    pub fn get_iteration_types_of_method(
        &mut self,
        t: TypeId,
        resolver: IterationTypesResolverKind,
        method_name: &'static [u8],
        error_node: NodeId,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> IterationTypes {
        let a = self.ast;
        let method = self.get_property_of_type(t, method_name);
        // Ignore 'return' or 'throw' if they are missing.
        if method.is_nil() && method_name != b"next" {
            return IterationTypes::default();
        }
        let mut method_type = TypeId::NIL;
        if !method.is_nil()
            && !(method_name == b"next" && a.sym(method).flags.intersects(SymbolFlags::OPTIONAL))
        {
            if method_name == b"next" {
                method_type = self.get_type_of_symbol(method);
            } else {
                let type_of_method = self.get_type_of_symbol(method);
                method_type =
                    self.get_type_with_facts(type_of_method, TypeFacts::NE_UNDEFINED_OR_NULL);
            }
        }
        if is_type_any(self, method_type) {
            return IterationTypes {
                yield_type: self.any_type,
                return_type: self.any_type,
                next_type: self.any_type,
            };
        }
        // Both async and non-async iterators *must* have a `next` method.
        let mut method_signatures: List<'a, SignatureId> = List::NIL;
        if !method_type.is_nil() {
            method_signatures = self.get_signatures_of_type(method_type, SignatureKind::CALL);
        }
        if method_signatures.len() == 0 {
            if !error_node.is_nil() {
                let diagnostic = if method_name == b"next" {
                    resolver.must_have_a_next_method_diagnostic()
                } else {
                    resolver.must_be_a_method_diagnostic()
                };
                let diagnostic =
                    self.new_diagnostic_for_node(error_node, diagnostic, &[Arg::Str(method_name)]);
                self.report_diagnostic(diagnostic, diagnostic_output);
            }
            return IterationTypes::default();
        }
        // If the method signature comes exclusively from the global iterator or generator type, create iteration types from its type arguments like `getIterationTypesOfIteratorFast` does (so as to remove `undefined` from the next and return types). We arrive here when a contextual type for a generator was not a direct reference to one of those global types, but looking up `methodType` referred to one of them (and nothing else). E.g., in `interface SpecialIterator extends Iterator<number> {}`, `SpecialIterator` is not a reference to `Iterator`, but its `next` member derives exclusively from `Iterator`.
        let method_type_symbol = self.types[method_type].symbol;
        if method_signatures.len() == 1 && !method_type_symbol.is_nil() {
            let global_generator_type = resolver.get_global_generator_type(self);
            let global_iterator_type = resolver.get_global_iterator_type(self);
            let global_generator_symbol = self.types[global_generator_type].symbol;
            let global_iterator_symbol = self.types[global_iterator_type].symbol;
            let is_generator_method = !global_generator_symbol.is_nil()
                && a.table_get(a.sym(global_generator_symbol).members, method_name)
                    == method_type_symbol;
            let is_iterator_method = !is_generator_method
                && !global_iterator_symbol.is_nil()
                && a.table_get(a.sym(global_iterator_symbol).members, method_name)
                    == method_type_symbol;
            if is_generator_method || is_iterator_method {
                let type_parameters = self
                    .as_interface_type(if is_generator_method {
                        global_generator_type
                    } else {
                        global_iterator_type
                    })
                    .type_parameters();
                let mapper = self.type_mapper(method_type);
                let mut next_type = TypeId::NIL;
                if method_name == b"next" {
                    next_type = self.map(mapper, type_parameters.at(2usize));
                }
                let yield_type = self.map(mapper, type_parameters.at(0usize));
                let return_type = self.map(mapper, type_parameters.at(1usize));
                return IterationTypes {
                    yield_type,
                    return_type,
                    next_type,
                };
            }
        }
        // Extract the first parameter and return type of each signature.
        let mut method_parameter_types: Vec<TypeId> = Vec::new();
        let mut method_return_types: Vec<TypeId> = Vec::new();
        for &signature in method_signatures.as_slice() {
            if method_name != b"throw" && self.signatures[signature].parameters.len() != 0 {
                method_parameter_types.push(self.get_type_at_position(signature, 0));
            }
            method_return_types.push(self.get_return_type_of_signature(signature));
        }
        // Resolve the *next* or *return* type from the first parameter of a `next()` or `return()` method, respectively.
        let mut return_types: Vec<TypeId> = Vec::new();
        let mut next_type = TypeId::NIL;
        if method_name != b"throw" {
            let method_parameter_type = if !method_parameter_types.is_empty() {
                self.get_union_type(List::from_slice(&method_parameter_types))
            } else {
                self.unknown_type
            };
            if method_name == b"next" {
                // The value of `next(value)` is *not* awaited by async generators
                next_type = method_parameter_type;
            } else if method_name == b"return" {
                // The value of `return(value)` *is* awaited by async generators
                let mut resolved_method_parameter_type =
                    resolver.resolve_iteration_type(self, method_parameter_type, error_node);
                if resolved_method_parameter_type.is_nil() {
                    resolved_method_parameter_type = self.any_type;
                }
                return_types.push(resolved_method_parameter_type);
            }
        }
        // Resolve the *yield* and *return* types from the return type of the method (i.e. `IteratorResult`)
        let yield_type;
        let method_return_type = if !method_return_types.is_empty() {
            self.get_intersection_type(List::from_slice(&method_return_types))
        } else {
            self.never_type
        };
        let mut resolved_method_return_type =
            resolver.resolve_iteration_type(self, method_return_type, error_node);
        if resolved_method_return_type.is_nil() {
            resolved_method_return_type = self.any_type;
        }
        let iteration_types =
            self.get_iteration_types_of_iterator_result(resolved_method_return_type);
        if !iteration_types.has_types() {
            if !error_node.is_nil() {
                let diagnostic = self.new_diagnostic_for_node(
                    error_node,
                    resolver.must_have_a_value_diagnostic(),
                    &[Arg::Str(method_name)],
                );
                self.report_diagnostic(diagnostic, diagnostic_output.as_deref_mut());
            }
            yield_type = self.any_type;
            return_types.push(self.any_type);
        } else {
            yield_type = iteration_types.yield_type;
            return_types.push(iteration_types.return_type);
        }
        let return_type = self.get_union_type(List::from_slice(&return_types));
        IterationTypes {
            yield_type,
            return_type,
            next_type,
        }
    }

    // Gets the *yield* and *return* types of an `IteratorResult`-like type. If we are unable to determine a *yield* or a *return* type, `noIterationTypes` is returned to indicate to the caller that it should handle the error. Otherwise, an `IterationTypes` record is returned.
    pub fn get_iteration_types_of_iterator_result(&mut self, t: TypeId) -> IterationTypes {
        if is_type_any(self, t) {
            return IterationTypes {
                yield_type: self.any_type,
                return_type: self.any_type,
                next_type: self.any_type,
            };
        }
        // As an optimization, if the type is an instantiation of one of the global `IteratorYieldResult<T>` or `IteratorReturnResult<TReturn>` types, then just grab its type argument.
        let iterator_yield_result_type = self.get_global_iterator_yield_result_type();
        if self.is_reference_to_type(t, iterator_yield_result_type) {
            return IterationTypes {
                yield_type: self.get_type_arguments(t).at(0usize),
                return_type: TypeId::NIL,
                next_type: TypeId::NIL,
            };
        }
        let iterator_return_result_type = self.get_global_iterator_return_result_type();
        if self.is_reference_to_type(t, iterator_return_result_type) {
            return IterationTypes {
                yield_type: TypeId::NIL,
                return_type: self.get_type_arguments(t).at(0usize),
                next_type: TypeId::NIL,
            };
        }
        // Choose any constituents that can produce the requested iteration type.
        let yield_iterator_result = self.filter_type(t, &mut |c, t| c.is_yield_iterator_result(t));
        let mut yield_type = TypeId::NIL;
        if yield_iterator_result != self.never_type {
            yield_type = self.get_type_of_property_of_type(yield_iterator_result, b"value");
        }
        let return_iterator_result =
            self.filter_type(t, &mut |c, t| c.is_return_iterator_result(t));
        let mut return_type = TypeId::NIL;
        if return_iterator_result != self.never_type {
            return_type = self.get_type_of_property_of_type(return_iterator_result, b"value");
        }
        if yield_type.is_nil() && return_type.is_nil() {
            return IterationTypes::default();
        }
        // From https://tc39.github.io/ecma262/#sec-iteratorresult-interface > ... If the iterator does not have a return value, `value` is `undefined`. In that case, the > `value` property may be absent from the conforming object if it does not inherit an explicit > `value` property.
        IterationTypes {
            yield_type,
            return_type: if return_type.is_nil() {
                self.void_type
            } else {
                return_type
            },
            next_type: TypeId::NIL,
        }
    }

    pub fn is_yield_iterator_result(&mut self, t: TypeId) -> bool {
        self.is_iterator_result(t, IterationTypeKind::YIELD)
    }

    pub fn is_return_iterator_result(&mut self, t: TypeId) -> bool {
        self.is_iterator_result(t, IterationTypeKind::RETURN)
    }

    pub fn is_iterator_result(&mut self, t: TypeId, kind: IterationTypeKind) -> bool {
        // From https://tc39.github.io/ecma262/#sec-iteratorresult-interface: > [done] is the result status of an iterator `next` method call. If the end of the iterator was reached `done` is `true`. > If the end was not reached `done` is `false` and a value is available. > If a `done` property (either own or inherited) does not exist, it is consider to have the value `false`.
        let mut done_type = self.get_type_of_property_of_type(t, b"done");
        if done_type.is_nil() {
            done_type = self.false_type;
        }
        let source = if kind == IterationTypeKind::YIELD {
            self.false_type
        } else {
            self.true_type
        };
        self.is_type_assignable_to(source, done_type)
    }

    pub fn report_type_not_iterable_error(
        &mut self,
        error_node: NodeId,
        t: TypeId,
        allow_async_iterables: bool,
    ) -> DiagnosticId {
        let a = self.ast;
        let message = if allow_async_iterables {
            diagnostics::TYPE_0_MUST_HAVE_A_SYMBOL_ASYNCITERATOR_METHOD_THAT_RETURNS_AN_ASYNC_ITERATOR
        } else {
            diagnostics::TYPE_0_MUST_HAVE_A_SYMBOL_ITERATOR_METHOD_THAT_RETURNS_AN_ITERATOR
        };
        let mut suggest_await = !self.get_awaited_type_of_promise(t).is_nil();
        if !suggest_await
            && !allow_async_iterables
            && is_for_of_statement(a, a.parent(error_node))
            && a.expression(a.parent(error_node)) == error_node
            && self.get_global_async_iterable_type() != self.empty_generic_type
        {
            let async_iterable_type = self.get_global_async_iterable_type();
            let type_arguments = self.list_of(&[self.any_type, self.any_type, self.any_type]);
            let target =
                self.create_type_from_generic_global_type(async_iterable_type, type_arguments);
            suggest_await = self.is_type_assignable_to(t, target);
        }
        let type_name = self.type_to_string_exported(t);
        self.error_and_maybe_suggest_await(
            error_node,
            suggest_await,
            message,
            &[Arg::Str(&type_name)],
        )
    }

    pub fn get_iteration_diagnostic_details(
        &mut self,
        use_: IterationUse,
        input_type: TypeId,
        allows_strings: bool,
    ) -> (MessageId, bool) {
        let yield_type = self.get_iteration_type_of_iterable(
            use_,
            IterationTypeKind::YIELD,
            input_type,
            NodeId::NIL,
        );
        if !yield_type.is_nil() {
            return (diagnostics::TYPE_0_CAN_ONLY_BE_ITERATED_THROUGH_WHEN_USING_THE_DOWNLEVELITERATION_FLAG_OR_WITH_A_TARGET_OF_ES2015_OR_HIGHER, false);
        }
        let symbol = self.types[input_type].symbol;
        if !symbol.is_nil() && is_es2015_or_later_iterable(self.ast.sym(symbol).name) {
            return (diagnostics::TYPE_0_CAN_ONLY_BE_ITERATED_THROUGH_WHEN_USING_THE_DOWNLEVELITERATION_FLAG_OR_WITH_A_TARGET_OF_ES2015_OR_HIGHER, true);
        }
        if allows_strings {
            return (
                diagnostics::TYPE_0_IS_NOT_AN_ARRAY_TYPE_OR_A_STRING_TYPE,
                true,
            );
        }
        (diagnostics::TYPE_0_IS_NOT_AN_ARRAY_TYPE, true)
    }
}

pub fn is_es2015_or_later_iterable(n: &[u8]) -> bool {
    matches!(
        n,
        b"Float32Array"
            | b"Float64Array"
            | b"Int16Array"
            | b"Int32Array"
            | b"Int8Array"
            | b"NodeList"
            | b"Uint16Array"
            | b"Uint32Array"
            | b"Uint8Array"
            | b"Uint8ClampedArray"
    )
}
