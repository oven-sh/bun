// checker.go:20115-20727 (layers T-SIGDECL, T-RETINFER, T-WIDEN, T-SIGINST): return types of signatures, full signature types, annotated accessor types, the return type that a function body gives with its promise and generator types, errors from widening, the type predicate that a function body gives, and the optional type marker.
use crate::ast::{
    Arg, Ast, FlowFlags, FlowNodeId, FunctionFlags, Kind, NodeId, for_each_return_statement,
    get_declaration_of_kind, get_function_flags, get_name_of_declaration, is_await_expression,
    is_block, is_call_expression, is_constructor_declaration, is_function_declaration,
    is_function_expression_or_arrow_function, is_function_like_declaration,
    is_get_accessor_declaration, is_identifier, is_import_call, is_in_js_file,
    is_method_declaration, is_object_literal_expression, is_return_statement, node_is_missing,
    skip_parentheses,
};
use crate::checker::{
    CheckMode, Checker, ContextFlags, IterationTypeKind, IterationTypesResolverKind, IterationUse,
    ObjectFlags, SignatureFlags, SignatureId, TypeAliasId, TypeFlags, TypeId, TypePredicateId,
    TypePredicateKind, TypeSystemEntity, TypeSystemPropertyName, UnionReduction, WideningKind,
    for_each_yield_expression, get_flow_node_of_node, get_set_accessor_value_parameter,
    is_object_literal_type, is_rest_parameter, is_unit_type, some_type,
};
use crate::core::{List, append_if_unique, find, if_else, or_else};
use crate::diagnostics;
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn get_return_type_of_signature(&mut self, sig: SignatureId) -> TypeId {
        let a = self.ast;
        if !self.signatures[sig].resolved_return_type.is_nil() {
            return self.signatures[sig].resolved_return_type;
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if !self.push_type_resolution(
            TypeSystemEntity::Signature(sig),
            TypeSystemPropertyName::ResolvedReturnType,
        ) {
            return self.error_type;
        }
        let target = self.signatures[sig].target;
        let composite = self.signatures[sig].composite;
        let mut t;
        if !target.is_nil() {
            let target_return_type = self.get_return_type_of_signature(target);
            let mapper = self.signatures[sig].mapper;
            t = self.instantiate_type(target_return_type, mapper);
        } else if !composite.is_nil() {
            let signatures = self.composite_signatures[composite].signatures;
            let mut return_types: Vec<TypeId> = Vec::with_capacity(signatures.as_slice().len());
            for &signature in signatures.as_slice() {
                let return_type = self.get_return_type_of_signature(signature);
                return_types.push(return_type);
            }
            let is_union = self.composite_signatures[composite].is_union;
            let composite_type = self.get_union_or_intersection_type(
                List::from_slice(&return_types),
                is_union,
                UnionReduction::SUBTYPE,
            );
            let mapper = self.signatures[sig].mapper;
            t = self.instantiate_type(composite_type, mapper);
        } else {
            let declaration = self.signatures[sig].declaration;
            t = self.get_return_type_from_annotation(declaration);
            if t.is_nil() {
                if !node_is_missing(a, a.body(declaration)) {
                    t = self.get_return_type_from_body(declaration, CheckMode::NORMAL);
                } else {
                    t = self.any_type;
                }
            }
        }
        let flags = self.signatures[sig].flags;
        if flags.intersects(SignatureFlags::IS_INNER_CALL_CHAIN) {
            t = self.add_optional_type_marker(t);
        } else if flags.intersects(SignatureFlags::IS_OUTER_CALL_CHAIN) {
            t = self.get_optional_type(t, false);
        }
        if !self.pop_type_resolution() {
            let declaration = self.signatures[sig].declaration;
            if !declaration.is_nil() {
                let type_node = a.type_node(declaration);
                if !type_node.is_nil() {
                    self.error(
                        type_node,
                        diagnostics::RETURN_TYPE_ANNOTATION_CIRCULARLY_REFERENCES_ITSELF,
                        &[],
                    );
                } else if self.no_implicit_any {
                    let name = get_name_of_declaration(a, declaration);
                    if !name.is_nil() {
                        let name_text = declaration_name_to_string(a, name);
                        self.error(
                            name,
                            diagnostics::X_0_IMPLICITLY_HAS_RETURN_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_RETURN_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ONE_OF_ITS_RETURN_EXPRESSIONS,
                            &[Arg::Str(&name_text)],
                        );
                    } else {
                        self.error(
                            declaration,
                            diagnostics::FUNCTION_IMPLICITLY_HAS_RETURN_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_RETURN_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ONE_OF_ITS_RETURN_EXPRESSIONS,
                            &[],
                        );
                    }
                }
            }
            t = self.any_type;
        }
        if self.signatures[sig].resolved_return_type.is_nil() {
            self.signatures[sig].resolved_return_type = t;
        }
        self.signatures[sig].resolved_return_type
    }

    pub fn get_non_circular_return_type_of_signature(&mut self, sig: SignatureId) -> TypeId {
        if self.is_resolving_return_type_of_signature(sig) {
            return self.any_type;
        }
        self.get_return_type_of_signature(sig)
    }

    pub fn get_return_type_from_annotation(&mut self, declaration: NodeId) -> TypeId {
        let a = self.ast;
        if is_constructor_declaration(a, declaration) {
            let class_symbol = self.get_merged_symbol(a.symbol(a.parent(declaration)));
            return self.get_declared_type_of_class_or_interface(class_symbol);
        }
        let return_type = a.type_node(declaration);
        if !return_type.is_nil() {
            return self.get_type_from_type_node(return_type);
        }
        if is_get_accessor_declaration(a, declaration) && self.has_bindable_name(declaration) {
            let symbol = self.get_symbol_of_declaration(declaration);
            let setter = get_declaration_of_kind(a, symbol, Kind::SetAccessor);
            return self.get_annotated_accessor_type(setter);
        }
        self.get_return_type_of_full_signature(declaration)
    }

    pub fn get_signature_of_full_signature_type(&mut self, node: NodeId) -> SignatureId {
        let a = self.ast;
        if is_in_js_file(a, node)
            && (is_function_declaration(a, node)
                || is_method_declaration(a, node)
                || is_function_expression_or_arrow_function(a, node))
        {
            let full_signature = a
                .function_like_data(node)
                .map_or(NodeId::NIL, |data| data.full_signature);
            if !full_signature.is_nil() {
                let full_signature_type = self.get_type_from_type_node(full_signature);
                return self.get_single_call_signature(full_signature_type);
            }
        }
        SignatureId::NIL
    }

    pub fn get_parameter_type_of_full_signature(
        &mut self,
        node: NodeId,
        parameter: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let signature = self.get_signature_of_full_signature_type(node);
        if !signature.is_nil() {
            let pos = a
                .parameters(node)
                .as_slice()
                .iter()
                .position(|&p| p == parameter)
                .map_or(-1, |pos| pos as isize);
            if !a
                .as_parameter_declaration(parameter)
                .dot_dot_dot_token
                .is_nil()
            {
                return self.get_rest_type_at_position(signature, pos, false);
            } else {
                return self.get_type_at_position(signature, pos);
            }
        }
        TypeId::NIL
    }

    pub fn get_return_type_of_full_signature(&mut self, node: NodeId) -> TypeId {
        let signature = self.get_signature_of_full_signature_type(node);
        if !signature.is_nil() {
            return self.get_return_type_of_signature(signature);
        }
        TypeId::NIL
    }

    pub fn get_annotated_accessor_type(&mut self, accessor: NodeId) -> TypeId {
        let node = self.get_annotated_accessor_type_node(accessor);
        if !node.is_nil() {
            return self.get_type_from_type_node(node);
        }
        TypeId::NIL
    }

    pub fn get_annotated_accessor_type_node(&self, accessor: NodeId) -> NodeId {
        let a = self.ast;
        if !accessor.is_nil() {
            match a.kind(accessor) {
                Kind::GetAccessor | Kind::PropertyDeclaration => return a.type_node(accessor),
                Kind::SetAccessor => {
                    return get_effective_set_accessor_type_annotation_node(a, accessor);
                }
                _ => {}
            }
        }
        NodeId::NIL
    }
}

pub fn get_effective_set_accessor_type_annotation_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let param = get_set_accessor_value_parameter(a, node);
    if !param.is_nil() {
        return a.type_node(param);
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_return_type_from_body(&mut self, func: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let body = a.body(func);
        if body.is_nil() {
            return self.error_type;
        }
        let function_flags = get_function_flags(a, func);
        let is_async = function_flags.intersects(FunctionFlags::ASYNC);
        let is_generator = function_flags.intersects(FunctionFlags::GENERATOR);
        let mut return_type = TypeId::NIL;
        let mut yield_type = TypeId::NIL;
        let mut next_type = TypeId::NIL;
        let mut fallback_return_type = self.void_type;
        if !is_block(a, body) {
            return_type = self.check_expression_cached_ex(
                body,
                check_mode.without(CheckMode::SKIP_GENERIC_FUNCTIONS),
            );
            if self.is_const_context(body) {
                return_type = self.get_regular_type_of_literal_type(return_type);
            }
            if is_async {
                // From within an async function you can return either a non-promise value or a promise. Any Promise/A+ compatible implementation will always assimilate any foreign promise, so the return type of the body should be unwrapped to its awaited type, which we will wrap in the native Promise<T> type later in this function.
                let awaited_type = self.check_awaited_type(
                    return_type,
                    false,
                    func,
                    diagnostics::THE_RETURN_TYPE_OF_AN_ASYNC_FUNCTION_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
                );
                return_type = self.unwrap_awaited_type(awaited_type);
            }
        } else if is_generator {
            let (return_types, is_never_returning) =
                self.check_and_aggregate_return_expression_types(func, check_mode);
            if is_never_returning {
                fallback_return_type = self.never_type;
            } else if !return_types.is_empty() {
                return_type = self.get_union_type_ex(
                    List::from_slice(&return_types),
                    UnionReduction::SUBTYPE,
                    TypeAliasId::NIL,
                    TypeId::NIL,
                );
            }
            let (yield_types, next_types) =
                self.check_and_aggregate_yield_operand_types(func, check_mode);
            if !yield_types.is_empty() {
                yield_type = self.get_union_type_ex(
                    List::from_slice(&yield_types),
                    UnionReduction::SUBTYPE,
                    TypeAliasId::NIL,
                    TypeId::NIL,
                );
            }
            if !next_types.is_empty() {
                next_type = self.get_intersection_type(List::from_slice(&next_types));
            }
        } else {
            let (types, is_never_returning) =
                self.check_and_aggregate_return_expression_types(func, check_mode);
            if is_never_returning {
                // For an async function, the return type will not be never, but rather a Promise for never.
                if function_flags.intersects(FunctionFlags::ASYNC) {
                    let never_type = self.never_type;
                    return self.create_promise_return_type(func, never_type);
                }
                // Normal function
                return self.never_type;
            }
            if types.is_empty() {
                // For an async function, the return type will not be void/undefined, but rather a Promise for void/undefined.
                let contextual_return_type =
                    self.get_contextual_return_type(func, ContextFlags::NONE);
                let return_type = if !contextual_return_type.is_nil() && {
                    let unwrapped_return_type =
                        self.unwrap_return_type(contextual_return_type, function_flags);
                    let unwrapped_return_type = or_else(unwrapped_return_type, self.void_type);
                    some_type(self, unwrapped_return_type, &mut |c, t| {
                        c.types[t].flags.intersects(TypeFlags::UNDEFINED)
                    })
                } {
                    self.undefined_type
                } else {
                    self.void_type
                };
                if function_flags.intersects(FunctionFlags::ASYNC) {
                    return self.create_promise_return_type(func, return_type);
                }
                // Normal function
                return return_type;
            }
            // Return a union of the return expression types.
            return_type = self.get_union_type_ex(
                List::from_slice(&types),
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        if !return_type.is_nil() || !yield_type.is_nil() || !next_type.is_nil() {
            if !yield_type.is_nil() {
                self.report_errors_from_widening(func, yield_type, WideningKind::GENERATOR_YIELD);
            }
            if !return_type.is_nil() {
                self.report_errors_from_widening(func, return_type, WideningKind::FUNCTION_RETURN);
            }
            if !next_type.is_nil() {
                self.report_errors_from_widening(func, next_type, WideningKind::GENERATOR_NEXT);
            }
            if !return_type.is_nil() && is_unit_type(self, return_type)
                || !yield_type.is_nil() && is_unit_type(self, yield_type)
                || !next_type.is_nil() && is_unit_type(self, next_type)
            {
                let contextual_signature =
                    self.get_contextual_signature_for_function_like_declaration(func);
                let mut contextual_type = TypeId::NIL;
                if contextual_signature.is_nil() {
                    // No contextual type
                } else if contextual_signature == self.get_signature_from_declaration(func) {
                    if !is_generator {
                        contextual_type = return_type;
                    }
                } else {
                    let contextual_return_type =
                        self.get_return_type_of_signature(contextual_signature);
                    contextual_type = self.instantiate_contextual_type(
                        contextual_return_type,
                        func,
                        ContextFlags::NONE,
                    );
                }
                if is_generator {
                    yield_type = self
                        .get_widened_literal_like_type_for_contextual_iteration_type_if_needed(
                            yield_type,
                            contextual_type,
                            IterationTypeKind::YIELD,
                            is_async,
                        );
                    return_type = self
                        .get_widened_literal_like_type_for_contextual_iteration_type_if_needed(
                            return_type,
                            contextual_type,
                            IterationTypeKind::RETURN,
                            is_async,
                        );
                    next_type = self
                        .get_widened_literal_like_type_for_contextual_iteration_type_if_needed(
                            next_type,
                            contextual_type,
                            IterationTypeKind::NEXT,
                            is_async,
                        );
                } else {
                    return_type = self
                        .get_widened_literal_like_type_for_contextual_return_type_if_needed(
                            return_type,
                            contextual_type,
                            is_async,
                        );
                }
            }
            if !yield_type.is_nil() {
                yield_type = self.get_widened_type(yield_type);
            }
            if !return_type.is_nil() {
                return_type = self.get_widened_type(return_type);
            }
            if !next_type.is_nil() {
                next_type = self.get_widened_type(next_type);
            }
        }
        if return_type.is_nil() {
            return_type = fallback_return_type;
        }
        if is_generator {
            if yield_type.is_nil() {
                yield_type = self.never_type;
            }
            if next_type.is_nil() {
                next_type = self.get_contextual_iteration_type(IterationTypeKind::NEXT, func);
                if next_type.is_nil() {
                    next_type = self.unknown_type;
                }
            }
            return self.create_generator_type(yield_type, return_type, next_type, is_async);
        }
        // From within an async function you can return either a non-promise value or a promise. Any Promise/A+ compatible implementation will always assimilate any foreign promise, so the return type of the body is awaited type of the body, wrapped in a native Promise<T> type.
        if is_async {
            return self.create_promise_type(return_type);
        }
        return_type
    }

    // Returns the aggregated list of return types, plus a bool indicating a never-returning function.
    pub fn check_and_aggregate_return_expression_types(
        &mut self,
        func: NodeId,
        check_mode: CheckMode,
    ) -> (Vec<TypeId>, bool) {
        let a = self.ast;
        let function_flags = get_function_flags(a, func);
        let mut aggregated_types: Vec<TypeId> = Vec::new();
        let mut has_return_with_no_expression = self.function_has_implicit_return(func);
        let mut has_return_of_type_never = false;
        for_each_return_statement(a, a.body(func), |return_statement| {
            let mut expr = a.expression(return_statement);
            if expr.is_nil() {
                has_return_with_no_expression = true;
                return false;
            }
            expr = skip_parentheses(a, expr);
            // Bare calls to this same function don't contribute to inference and `return await` is also safe to unwrap here
            if function_flags.intersects(FunctionFlags::ASYNC) && is_await_expression(a, expr) {
                expr = skip_parentheses(a, a.expression(expr));
            }
            if is_call_expression(a, expr)
                && is_identifier(a, a.expression(expr))
                && {
                    let callee_type = self.check_expression_cached(a.expression(expr));
                    self.types[callee_type].symbol == self.get_merged_symbol(a.symbol(func))
                }
                && (!is_function_expression_or_arrow_function(
                    a,
                    a.sym(a.symbol(func)).value_declaration,
                ) || self.is_constant_reference(a.expression(expr)))
            {
                has_return_of_type_never = true;
                return false;
            }
            let mut t = self.check_expression_cached_ex(
                expr,
                check_mode.without(CheckMode::SKIP_GENERIC_FUNCTIONS),
            );
            if function_flags.intersects(FunctionFlags::ASYNC) {
                // From within an async function you can return either a non-promise value or a promise. Any Promise/A+ compatible implementation will always assimilate any foreign promise, so the return type of the body should be unwrapped to its awaited type, which should be wrapped in the native Promise<T> type by the caller.
                let awaited_type = self.check_awaited_type(
                    t,
                    false,
                    func,
                    diagnostics::THE_RETURN_TYPE_OF_AN_ASYNC_FUNCTION_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
                );
                t = self.unwrap_awaited_type(awaited_type);
            }
            if self.types[t].flags.intersects(TypeFlags::NEVER) {
                has_return_of_type_never = true;
            }
            if self.is_const_context(expr) {
                t = self.get_regular_type_of_literal_type(t);
            }
            aggregated_types = append_if_unique(std::mem::take(&mut aggregated_types), t);
            false
        });
        if aggregated_types.is_empty()
            && !has_return_with_no_expression
            && (has_return_of_type_never || may_return_never(a, func))
        {
            return (Vec::new(), true);
        }
        if self.strict_null_checks && !aggregated_types.is_empty() && has_return_with_no_expression
        {
            aggregated_types = append_if_unique(aggregated_types, self.undefined_type);
        }
        (aggregated_types, false)
    }

    pub fn function_has_implicit_return(&mut self, func: NodeId) -> bool {
        let end_flow_node = self.ast.end_flow_node(func);
        !end_flow_node.is_nil() && self.is_reachable_flow_node(end_flow_node)
    }
}

pub fn may_return_never(a: Ast<'_>, func: NodeId) -> bool {
    match a.kind(func) {
        Kind::FunctionExpression | Kind::ArrowFunction => true,
        Kind::MethodDeclaration => is_object_literal_expression(a, a.parent(func)),
        _ => false,
    }
}

impl<'a> Checker<'a> {
    pub fn check_and_aggregate_yield_operand_types(
        &mut self,
        func: NodeId,
        check_mode: CheckMode,
    ) -> (Vec<TypeId>, Vec<TypeId>) {
        let a = self.ast;
        let mut yield_types: Vec<TypeId> = Vec::new();
        let mut next_types: Vec<TypeId> = Vec::new();
        let is_async = get_function_flags(a, func).intersects(FunctionFlags::ASYNC);
        for_each_yield_expression(a, a.body(func), |yield_expr| {
            let expression = a.expression(yield_expr);
            let mut yield_expr_type = self.undefined_widening_type;
            if !expression.is_nil() {
                yield_expr_type = self.check_expression_ex(
                    expression,
                    check_mode.without(CheckMode::SKIP_GENERIC_FUNCTIONS),
                );
            }
            if !expression.is_nil() && self.is_const_context(expression) {
                yield_expr_type = self.get_regular_type_of_literal_type(yield_expr_type);
            }
            let any_type = self.any_type;
            let yielded_type = self.get_yielded_type_of_yield_expression(
                yield_expr,
                yield_expr_type,
                any_type,
                is_async,
            );
            yield_types = append_if_unique(std::mem::take(&mut yield_types), yielded_type);
            let next_type = if !a.as_yield_expression(yield_expr).asterisk_token.is_nil() {
                let iteration_types = self.get_iteration_types_of_iterable(
                    yield_expr_type,
                    if_else(
                        is_async,
                        IterationUse::ASYNC_YIELD_STAR,
                        IterationUse::YIELD_STAR,
                    ),
                    expression,
                );
                iteration_types.next_type
            } else {
                self.get_contextual_type(yield_expr, ContextFlags::NONE)
            };
            if !next_type.is_nil() {
                next_types = append_if_unique(std::mem::take(&mut next_types), next_type);
            }
            false
        });
        (yield_types, next_types)
    }

    pub fn create_promise_type(&mut self, promised_type: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        // creates a `Promise<T>` type where `T` is the promisedType argument
        let global_promise_type = self.get_global_promise_type_checked();
        if global_promise_type != self.empty_generic_type {
            // if the promised type is itself a promise, get the underlying type; otherwise, fallback to the promised type. Unwrap an `Awaited<T>` to `T` to improve inference.
            let unwrapped_type = self.unwrap_awaited_type(promised_type);
            let awaited_type = self.get_awaited_type_no_alias(unwrapped_type);
            let promised_type = or_else(awaited_type, self.unknown_type);
            let type_arguments = self.list_of(&[promised_type]);
            return self.create_type_reference(global_promise_type, type_arguments);
        }
        self.unknown_type
    }

    pub fn create_promise_like_type(&mut self, promised_type: TypeId) -> TypeId {
        // creates a `PromiseLike<T>` type where `T` is the promisedType argument
        let global_promise_like_type = self.get_global_promise_like_type();
        if global_promise_like_type != self.empty_generic_type {
            // if the promised type is itself a promise, get the underlying type; otherwise, fallback to the promised type. Unwrap an `Awaited<T>` to `T` to improve inference.
            let unwrapped_type = self.unwrap_awaited_type(promised_type);
            let awaited_type = self.get_awaited_type_no_alias(unwrapped_type);
            let promised_type = or_else(awaited_type, self.unknown_type);
            let type_arguments = self.list_of(&[promised_type]);
            return self.create_type_reference(global_promise_like_type, type_arguments);
        }
        self.unknown_type
    }

    pub fn create_promise_return_type(&mut self, func: NodeId, promised_type: TypeId) -> TypeId {
        let a = self.ast;
        let promise_type = self.create_promise_type(promised_type);
        if promise_type == self.unknown_type {
            let message = if_else(
                is_import_call(a, func),
                diagnostics::A_DYNAMIC_IMPORT_CALL_RETURNS_A_PROMISE_MAKE_SURE_YOU_HAVE_A_DECLARATION_FOR_PROMISE_OR_INCLUDE_ES2015_IN_YOUR_LIB_OPTION,
                diagnostics::AN_ASYNC_FUNCTION_OR_METHOD_MUST_RETURN_A_PROMISE_MAKE_SURE_YOU_HAVE_A_DECLARATION_FOR_PROMISE_OR_INCLUDE_ES2015_IN_YOUR_LIB_OPTION,
            );
            self.error(func, message, &[]);
            return self.error_type;
        }
        if self.get_global_promise_constructor_symbol().is_nil() {
            let message = if_else(
                is_import_call(a, func),
                diagnostics::A_DYNAMIC_IMPORT_CALL_IN_ES5_REQUIRES_THE_PROMISE_CONSTRUCTOR_MAKE_SURE_YOU_HAVE_A_DECLARATION_FOR_THE_PROMISE_CONSTRUCTOR_OR_INCLUDE_ES2015_IN_YOUR_LIB_OPTION,
                diagnostics::AN_ASYNC_FUNCTION_OR_METHOD_IN_ES5_REQUIRES_THE_PROMISE_CONSTRUCTOR_MAKE_SURE_YOU_HAVE_A_DECLARATION_FOR_THE_PROMISE_CONSTRUCTOR_OR_INCLUDE_ES2015_IN_YOUR_LIB_OPTION,
            );
            self.error(func, message, &[]);
        }
        promise_type
    }

    pub fn unwrap_return_type(
        &mut self,
        return_type: TypeId,
        function_flags: FunctionFlags,
    ) -> TypeId {
        let is_generator = function_flags.intersects(FunctionFlags::GENERATOR);
        let is_async = function_flags.intersects(FunctionFlags::ASYNC);
        if is_generator {
            let return_iteration_type = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::RETURN,
                return_type,
                is_async,
            );
            if return_iteration_type.is_nil() {
                return self.error_type;
            }
            if is_async {
                let unwrapped_type = self.unwrap_awaited_type(return_iteration_type);
                return self.get_awaited_type_no_alias(unwrapped_type);
            }
            return return_iteration_type;
        }
        if is_async {
            let awaited_type = self.get_awaited_type_no_alias(return_type);
            return or_else(awaited_type, self.error_type);
        }
        return_type
    }

    pub fn get_widened_literal_like_type_for_contextual_return_type_if_needed(
        &mut self,
        t: TypeId,
        contextual_signature_return_type: TypeId,
        is_async: bool,
    ) -> TypeId {
        let mut t = t;
        if !t.is_nil() && is_unit_type(self, t) {
            let mut contextual_type = TypeId::NIL;
            if contextual_signature_return_type.is_nil() {
                // No contextual type
            } else if is_async {
                contextual_type =
                    self.get_promised_type_of_promise(contextual_signature_return_type);
            } else {
                contextual_type = contextual_signature_return_type;
            }
            t = self.get_widened_literal_like_type_for_contextual_type(t, contextual_type);
        }
        t
    }

    pub fn get_widened_literal_like_type_for_contextual_iteration_type_if_needed(
        &mut self,
        t: TypeId,
        contextual_signature_return_type: TypeId,
        kind: IterationTypeKind,
        is_async_generator: bool,
    ) -> TypeId {
        let mut t = t;
        if !t.is_nil() && is_unit_type(self, t) {
            let mut contextual_type = TypeId::NIL;
            if !contextual_signature_return_type.is_nil() {
                contextual_type = self.get_iteration_type_of_generator_function_return_type(
                    kind,
                    contextual_signature_return_type,
                    is_async_generator,
                );
            }
            t = self.get_widened_literal_like_type_for_contextual_type(t, contextual_type);
        }
        t
    }

    pub fn create_generator_type(
        &mut self,
        yield_type: TypeId,
        return_type: TypeId,
        next_type: TypeId,
        is_async_generator: bool,
    ) -> TypeId {
        let resolver = if_else(
            is_async_generator,
            IterationTypesResolverKind::Async,
            IterationTypesResolverKind::Sync,
        );
        let global_generator_type = resolver.get_global_generator_type(self);
        let resolved_yield_type = resolver.resolve_iteration_type(self, yield_type, NodeId::NIL);
        let yield_type = or_else(resolved_yield_type, self.unknown_type);
        let resolved_return_type = resolver.resolve_iteration_type(self, return_type, NodeId::NIL);
        let return_type = or_else(resolved_return_type, self.unknown_type);
        if global_generator_type == self.empty_generic_type {
            // Fall back to the global IterableIterator type.
            let global_iterable_iterator_type = resolver.get_global_iterable_iterator_type(self);
            if global_iterable_iterator_type != self.empty_generic_type {
                let type_arguments = self.list_of(&[yield_type, return_type, next_type]);
                return self.create_type_from_generic_global_type(
                    global_iterable_iterator_type,
                    type_arguments,
                );
            }
            // The global Generator type doesn't exist, so report an error
            resolver.get_global_iterable_iterator_type_checked(self);
            return self.empty_object_type;
        }
        let type_arguments = self.list_of(&[yield_type, return_type, next_type]);
        self.create_type_from_generic_global_type(global_generator_type, type_arguments)
    }

    pub fn report_errors_from_widening(
        &mut self,
        declaration: NodeId,
        t: TypeId,
        widening_kind: WideningKind,
    ) {
        if self.no_implicit_any
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
        {
            if widening_kind == WideningKind::NORMAL
                || is_function_like_declaration(self.ast, declaration)
                    && self.should_report_errors_from_widening_with_contextual_signature(
                        declaration,
                        widening_kind,
                    )
            {
                // Report implicit any error within type if possible, otherwise report error on declaration
                if !self.report_widening_errors_in_type(t) {
                    self.report_implicit_any(declaration, t, widening_kind);
                }
            }
        }
    }

    pub fn should_report_errors_from_widening_with_contextual_signature(
        &mut self,
        declaration: NodeId,
        widening_kind: WideningKind,
    ) -> bool {
        let signature = self.get_contextual_signature_for_function_like_declaration(declaration);
        if signature.is_nil() {
            return true;
        }
        let mut return_type = self.get_return_type_of_signature(signature);
        let flags = get_function_flags(self.ast, declaration);
        if widening_kind == WideningKind::FUNCTION_RETURN {
            if flags.intersects(FunctionFlags::GENERATOR) {
                let iteration_type = self.get_iteration_type_of_generator_function_return_type(
                    IterationTypeKind::RETURN,
                    return_type,
                    flags.intersects(FunctionFlags::ASYNC),
                );
                if !iteration_type.is_nil() {
                    return_type = iteration_type;
                }
            } else if flags.intersects(FunctionFlags::ASYNC) {
                let awaited_type = self.get_awaited_type_no_alias(return_type);
                if !awaited_type.is_nil() {
                    return_type = awaited_type;
                }
            }
            return self.is_generic_type(return_type);
        }
        if widening_kind == WideningKind::GENERATOR_YIELD {
            let yield_type = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::YIELD,
                return_type,
                flags.intersects(FunctionFlags::ASYNC),
            );
            return !yield_type.is_nil() && self.is_generic_type(yield_type);
        }
        if widening_kind == WideningKind::GENERATOR_NEXT {
            let next_type = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::NEXT,
                return_type,
                flags.intersects(FunctionFlags::ASYNC),
            );
            return !next_type.is_nil() && self.is_generic_type(next_type);
        }
        false
    }

    // Reports implicit any errors that occur as a result of widening 'null' and 'undefined' to 'any'. A call to reportWideningErrorsInType is normally accompanied by a call to getWidenedType. But in some cases getWidenedType is called without reporting errors (type argument inference is an example). The return value indicates whether an error was in fact reported. The particular circumstances are on a best effort basis. Currently, if the null or undefined that causes widening is inside an object literal property (arbitrarily deeply), this function reports an error. If no error is reported, reportImplicitAnyError is a suitable fallback to report a general error.
    pub fn report_widening_errors_in_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let mut error_reported = false;
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
        {
            if self.types[t].flags.intersects(TypeFlags::UNION) {
                let types = self.type_types(t);
                if types
                    .as_slice()
                    .iter()
                    .any(|&s| self.is_empty_object_type(s))
                {
                    error_reported = true;
                } else {
                    for &s in types.as_slice() {
                        error_reported = error_reported || self.report_widening_errors_in_type(s);
                    }
                }
            } else if self.is_array_or_tuple_type(t) {
                let type_arguments = self.get_type_arguments(t);
                for &s in type_arguments.as_slice() {
                    error_reported = error_reported || self.report_widening_errors_in_type(s);
                }
            } else if is_object_literal_type(self, t) {
                let properties = self.get_properties_of_object_type(t);
                for &p in properties.as_slice() {
                    let s = self.get_type_of_symbol(p);
                    if self.types[s]
                        .object_flags
                        .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
                    {
                        error_reported = self.report_widening_errors_in_type(s);
                        if !error_reported {
                            // we need to account for property types coming from object literal type normalization in unions
                            let type_declaration = a.sym(self.types[t].symbol).value_declaration;
                            let value_declaration = find(a.sym(p).declarations.as_slice(), |d| {
                                let value_declaration = a.sym(a.symbol(d)).value_declaration;
                                !value_declaration.is_nil()
                                    && a.parent(value_declaration) == type_declaration
                            });
                            if !value_declaration.is_nil() {
                                let name = self.symbol_to_string(p);
                                let widened_type = self.get_widened_type(s);
                                let type_text = self.type_to_string_exported(widened_type);
                                self.error(
                                    value_declaration,
                                    diagnostics::OBJECT_LITERAL_S_PROPERTY_0_IMPLICITLY_HAS_AN_1_TYPE,
                                    &[Arg::Str(&name), Arg::Str(&type_text)],
                                );
                                error_reported = true;
                            }
                        }
                    }
                }
            }
        }
        error_reported
    }

    pub fn get_type_predicate_from_body(&mut self, func: NodeId) -> TypePredicateId {
        let a = self.ast;
        match a.kind(func) {
            Kind::Constructor | Kind::GetAccessor | Kind::SetAccessor => {
                return TypePredicateId::NIL;
            }
            _ => {}
        }
        let function_flags = get_function_flags(a, func);
        if function_flags != FunctionFlags::NORMAL {
            return TypePredicateId::NIL;
        }
        // Only attempt to infer a type predicate if there's exactly one return.
        let mut single_return = NodeId::NIL;
        let body = a.body(func);
        if !body.is_nil() && !is_block(a, body) {
            // arrow function
            single_return = body;
        } else {
            let bailed_early = for_each_return_statement(a, body, |return_statement| {
                if !single_return.is_nil() || a.expression(return_statement).is_nil() {
                    return true;
                }
                single_return = a.expression(return_statement);
                false
            });
            if bailed_early || single_return.is_nil() || self.function_has_implicit_return(func) {
                return TypePredicateId::NIL;
            }
        }
        self.check_if_expression_refines_any_parameter(func, single_return)
    }

    pub fn check_if_expression_refines_any_parameter(
        &mut self,
        func: NodeId,
        expr: NodeId,
    ) -> TypePredicateId {
        let a = self.ast;
        let expr = skip_parentheses(a, expr);
        let return_type = self.check_expression_cached(expr);
        if !self.types[return_type].flags.intersects(TypeFlags::BOOLEAN) {
            return TypePredicateId::NIL;
        }
        for (i, &param) in a.parameters(func).as_slice().iter().enumerate() {
            let init_type = self.get_type_of_symbol(a.symbol(param));
            if init_type.is_nil()
                || self.types[init_type].flags.intersects(TypeFlags::BOOLEAN)
                || !is_identifier(a, a.name(param))
                || self.is_symbol_assigned(a.symbol(param))
                || is_rest_parameter(a, param)
            {
                // Refining "x: boolean" to "x is true" or "x is false" isn't useful.
                continue;
            }
            let true_type =
                self.check_if_expression_refines_parameter(func, expr, param, init_type);
            if !true_type.is_nil() {
                return self.new_type_predicate(
                    TypePredicateKind::IDENTIFIER,
                    a.text(a.name(param)),
                    i as i32,
                    true_type,
                );
            }
        }
        TypePredicateId::NIL
    }

    pub fn check_if_expression_refines_parameter(
        &mut self,
        func: NodeId,
        expr: NodeId,
        param: NodeId,
        init_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let mut antecedent = get_flow_node_of_node(a, expr);
        if antecedent.is_nil() && is_return_statement(a, a.parent(expr)) {
            antecedent = get_flow_node_of_node(a, a.parent(expr));
        }
        if antecedent.is_nil() {
            antecedent = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
        }
        let true_condition = a.new_flow_node(FlowFlags::TRUE_CONDITION, expr, antecedent);
        let true_type = self.get_flow_type_of_reference_ex(
            a.name(param),
            init_type,
            init_type,
            func,
            true_condition,
        );
        if true_type == init_type {
            return TypeId::NIL;
        }
        // "x is T" means that x is T if and only if it returns true. If it returns false then x is not T. This means that if the function is called with an argument of type trueType, there can't be anything left in the `else` branch. It must reduce to `never`.
        let false_condition = a.new_flow_node(FlowFlags::FALSE_CONDITION, expr, antecedent);
        let false_flow_type = self.get_flow_type_of_reference_ex(
            a.name(param),
            init_type,
            true_type,
            func,
            false_condition,
        );
        let false_subtype = self.get_reduced_type(false_flow_type);
        if self.types[false_subtype].flags.intersects(TypeFlags::NEVER) {
            return true_type;
        }
        TypeId::NIL
    }

    pub fn add_optional_type_marker(&mut self, t: TypeId) -> TypeId {
        if self.strict_null_checks {
            return self.get_union_type(List::from_slice(&[t, self.optional_type]));
        }
        t
    }
}
