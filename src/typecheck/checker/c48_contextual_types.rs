// checker.go:29449-30162 (layers E-CTX, E-DECOR): the contextual type of an expression by the kind of its parent: the initializer of a declaration, a parameter of a contextually typed function, the operands of return, yield, await, binary and conditional expressions, an argument with the type of a spread argument, a decorator, an object literal element, an array element, a template substitution and an import attribute.
use crate::ast::{
    FunctionFlags, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId, get_containing_function,
    get_function_flags, get_immediately_invoked_function_expression, get_leftmost_expression,
    get_name_of_declaration, get_this_parameter, has_dynamic_name, index_of_node,
    is_access_expression, is_array_binding_pattern, is_binding_element, is_binding_pattern,
    is_computed_non_literal_name, is_computed_property_name, is_const_assertion, is_expression,
    is_function_expression_or_arrow_function, is_identifier, is_import_call,
    is_jsx_opening_like_element, is_object_literal_method, is_private_identifier,
    is_property_access_expression, is_property_declaration, is_property_signature_declaration,
    is_spread_element, is_static, is_synthetic_expression, is_tagged_template_expression,
    is_variable_declaration,
};
use crate::binder::get_symbol_name_for_private_identifier;
use crate::checker::{
    AccessFlags, CheckMode, Checker, ContextFlags, ElementFlags, InferenceContextId,
    IterationTypeKind, IterationUse, SignatureId, TupleElementInfo, TypeAliasId, TypeFlags, TypeId,
    get_end_element_count, get_property_name_from_type, has_dot_dot_dot_token, is_spread_argument,
    is_tuple_type, is_type_usable_as_property_name, signature_has_rest_parameter, some_type,
};
use crate::core::{List, find_index, if_else, last_or_nil, or_else};
use crate::diagnostics::MessageId;
use crate::jsnum::Number;

impl<'a> Checker<'a> {
    // Whoa! Do you really want to use this function? Unless you're trying to get the *non-apparent* type for a value-literal type or you're authoring relevant portions of this algorithm, you probably meant to use 'getApparentTypeOfContextualType'. Use 'getContextualType' when you are simply going to propagate the result to the expression, and 'getApparentTypeOfContextualType' when you're going to need the members of the type.
    pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::IN_WITH_STATEMENT) {
            // We cannot answer semantic questions within a with block, do not proceed any further
            return TypeId::NIL;
        }
        // Cached contextual types are obtained with no ContextFlags, so we can only consult them for requests with no ContextFlags.
        let index = self.find_contextual_node(node, context_flags == ContextFlags::NONE);
        if index >= 0 {
            return self
                .contextual_infos
                .get(index as usize)
                .map_or(TypeId::NIL, |info| info.t);
        }
        let parent = a.parent(node);
        match a.kind(parent) {
            Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::BindingElement => {
                self.get_contextual_type_for_initializer_expression(node, context_flags)
            }
            Kind::ArrowFunction | Kind::ReturnStatement => {
                self.get_contextual_type_for_return_expression(node, context_flags)
            }
            Kind::YieldExpression => {
                self.get_contextual_type_for_yield_operand(parent, context_flags)
            }
            Kind::AwaitExpression => {
                self.get_contextual_type_for_await_operand(parent, context_flags)
            }
            Kind::CallExpression | Kind::NewExpression => {
                self.get_contextual_type_for_argument(parent, node)
            }
            Kind::Decorator => self.get_contextual_type_for_decorator(parent),
            Kind::TypeAssertionExpression | Kind::AsExpression => {
                if is_const_assertion(a, parent) {
                    return self.get_contextual_type(parent, context_flags);
                }
                self.get_type_from_type_node(a.type_node(parent))
            }
            Kind::BinaryExpression => {
                self.get_contextual_type_for_binary_operand(node, context_flags)
            }
            Kind::PropertyAssignment | Kind::ShorthandPropertyAssignment => {
                self.get_contextual_type_for_object_literal_element(parent, context_flags)
            }
            Kind::SpreadAssignment => self.get_contextual_type(a.parent(parent), context_flags),
            Kind::ArrayLiteralExpression => {
                let t = self.get_apparent_type_of_contextual_type(parent, context_flags);
                let elements = a.elements(parent);
                let element_index = index_of_node(a, elements.as_slice(), node);
                if element_index < 0 {
                    return TypeId::NIL;
                }
                let (first_spread_index, last_spread_index) = self.get_spread_indices(parent);
                self.get_contextual_type_for_element_expression(
                    t,
                    element_index,
                    elements.len(),
                    first_spread_index,
                    last_spread_index,
                )
            }
            Kind::ConditionalExpression => {
                self.get_contextual_type_for_conditional_operand(node, context_flags)
            }
            Kind::TemplateSpan => {
                self.get_contextual_type_for_substitution_expression(a.parent(parent), node)
            }
            Kind::ParenthesizedExpression => self.get_contextual_type(parent, context_flags),
            Kind::NonNullExpression => self.get_contextual_type(parent, context_flags),
            Kind::SatisfiesExpression => self.get_type_from_type_node(a.type_node(parent)),
            Kind::ExportAssignment => self.try_get_type_from_type_node(parent),
            Kind::JsxExpression => {
                self.get_contextual_type_for_jsx_expression(parent, context_flags)
            }
            Kind::JsxAttribute | Kind::JsxSpreadAttribute => {
                self.get_contextual_type_for_jsx_attribute(parent, context_flags)
            }
            Kind::JsxOpeningElement | Kind::JsxSelfClosingElement => {
                self.get_contextual_jsx_element_attributes_type(parent, context_flags)
            }
            Kind::ImportAttribute => self.get_contextual_import_attribute_type(parent),
            _ => TypeId::NIL,
        }
    }

    // In a variable, parameter or property declaration with a type annotation, the contextual type of an initializer expression is the type of the variable, parameter or property. Otherwise, in a parameter declaration of a contextually typed function expression, the contextual type of an initializer expression is the contextual type of the parameter. Otherwise, in a variable or parameter declaration with a binding pattern name, the contextual type of an initializer expression is the type implied by the binding pattern. Otherwise, in a binding pattern inside a variable or parameter declaration, the contextual type of an initializer expression is the type annotation of the containing declaration, if present.
    pub fn get_contextual_type_for_initializer_expression(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let declaration = a.parent(node);
        let initializer = a.initializer(declaration);
        if node == initializer {
            let result =
                self.get_contextual_type_for_variable_like_declaration(declaration, context_flags);
            if !result.is_nil() {
                return result;
            }
            if !context_flags.intersects(ContextFlags::SKIP_BINDING_PATTERNS)
                && is_binding_pattern(a, a.name(declaration))
                && a.elements(a.name(declaration)).len() > 0
            {
                return self.get_type_from_binding_pattern(a.name(declaration), true, false);
            }
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_variable_like_declaration(
        &mut self,
        declaration: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let type_node = a.type_node(declaration);
        if !type_node.is_nil() {
            return self.get_type_from_type_node(type_node);
        }
        match a.kind(declaration) {
            Kind::Parameter => {
                return self.get_contextually_typed_parameter_type(declaration);
            }
            Kind::BindingElement => {
                return self.get_contextual_type_for_binding_element(declaration, context_flags);
            }
            Kind::PropertyDeclaration => {
                if is_static(a, declaration) {
                    return self.get_contextual_type_for_static_property_declaration(
                        declaration,
                        context_flags,
                    );
                }
            }
            _ => {}
        }
        // By default, do nothing and return nil - only the above cases have context implied by a parent
        TypeId::NIL
    }

    // Return contextual type of parameter or undefined if no contextual type is available
    pub fn get_contextually_typed_parameter_type(&mut self, parameter: NodeId) -> TypeId {
        let a = self.ast;
        let func = a.parent(parameter);
        if !self.is_context_sensitive_function_or_object_literal_method(func) {
            return TypeId::NIL;
        }
        let iife = get_immediately_invoked_function_expression(a, func);
        if !iife.is_nil() {
            let args = self.get_effective_call_arguments(iife);
            let args = List::from_slice(&args);
            let index_of_parameter = find_index(a.parameters(func).as_slice(), |p| p == parameter);
            if has_dot_dot_dot_token(a, parameter) {
                return self.get_spread_argument_type(
                    args,
                    index_of_parameter,
                    args.len(),
                    self.any_type,
                    InferenceContextId::NIL,
                    CheckMode::NORMAL,
                );
            }
            let links = self.signature_links.get(iife);
            let cached = self.signature_links[links].resolved_signature;
            self.signature_links[links].resolved_signature = self.any_signature;
            let t = if index_of_parameter < args.len() {
                let arg_type = self.check_expression(args.at(index_of_parameter));
                self.get_widened_literal_type(arg_type)
            } else if !a.initializer(parameter).is_nil() {
                TypeId::NIL
            } else {
                self.undefined_widening_type
            };
            self.signature_links[links].resolved_signature = cached;
            return t;
        }
        let contextual_signature = self.get_contextual_signature(func);
        if !contextual_signature.is_nil() {
            let index = find_index(a.parameters(func).as_slice(), |p| p == parameter)
                - if_else(!get_this_parameter(a, func).is_nil(), 1, 0);
            if has_dot_dot_dot_token(a, parameter)
                && last_or_nil(a.parameters(func).as_slice()) == parameter
            {
                return self.get_rest_type_at_position(contextual_signature, index, false);
            }
            return self.try_get_type_at_position(contextual_signature, index);
        }
        TypeId::NIL
    }

    pub fn is_context_sensitive_function_or_object_literal_method(&self, func: NodeId) -> bool {
        let a = self.ast;
        (is_function_expression_or_arrow_function(a, func) || is_object_literal_method(a, func))
            && self.is_context_sensitive_function_like_declaration(func)
    }

    pub fn get_spread_argument_type(
        &mut self,
        args: List<'_, NodeId>,
        index: isize,
        arg_count: isize,
        rest_type: TypeId,
        context: InferenceContextId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let in_const_context = self.is_const_type_variable(rest_type, 0);
        if arg_count > 0 && index >= arg_count - 1 {
            let mut arg = args.at(arg_count - 1);
            if is_spread_argument(a, arg) {
                // We are inferring from a spread expression in the last argument position, i.e. both the parameter and the argument are ...x forms.
                let spread_type = if is_synthetic_expression(a, arg) {
                    let synthetic_type = TypeId(a.as_synthetic_expression(arg).type_node);
                    if synthetic_type.is_nil() {
                        return self
                            .fail("nil Type of a synthetic expression in getSpreadArgumentType");
                    }
                    synthetic_type
                } else {
                    self.check_expression_with_contextual_type(
                        a.expression(arg),
                        rest_type,
                        context,
                        check_mode,
                    )
                };
                if self.is_array_like_type(spread_type) {
                    return self.get_mutable_array_or_tuple_type(spread_type);
                }
                if is_spread_element(a, arg) {
                    arg = a.expression(arg);
                }
                let element_type = self.check_iterated_type_or_element_type(
                    IterationUse::SPREAD,
                    spread_type,
                    self.undefined_type,
                    arg,
                );
                return self.create_array_type_ex(element_type, in_const_context);
            }
        }
        let mut types: Vec<TypeId> = Vec::new();
        let mut infos: Vec<TupleElementInfo> = Vec::new();
        for i in index..arg_count {
            let arg = args.at(i);
            let (t, flags) = if is_spread_argument(a, arg) {
                let spread_type = if is_synthetic_expression(a, arg) {
                    let synthetic_type = TypeId(a.as_synthetic_expression(arg).type_node);
                    if synthetic_type.is_nil() {
                        return self
                            .fail("nil Type of a synthetic expression in getSpreadArgumentType");
                    }
                    synthetic_type
                } else {
                    self.check_expression(a.expression(arg))
                };
                if self.is_array_like_type(spread_type) {
                    (spread_type, ElementFlags::VARIADIC)
                } else {
                    let element_type = if is_spread_element(a, arg) {
                        self.check_iterated_type_or_element_type(
                            IterationUse::SPREAD,
                            spread_type,
                            self.undefined_type,
                            a.expression(arg),
                        )
                    } else {
                        self.check_iterated_type_or_element_type(
                            IterationUse::SPREAD,
                            spread_type,
                            self.undefined_type,
                            arg,
                        )
                    };
                    (element_type, ElementFlags::REST)
                }
            } else {
                let contextual_type = if is_tuple_type(self, rest_type) {
                    let element_type = self.get_contextual_type_for_element_expression(
                        rest_type,
                        i - index,
                        arg_count - index,
                        -1,
                        -1,
                    );
                    or_else(element_type, self.unknown_type)
                } else {
                    let index_type = self.get_number_literal_type(Number((i - index) as f64));
                    self.get_indexed_access_type_ex(
                        rest_type,
                        index_type,
                        AccessFlags::CONTEXTUAL,
                        NodeId::NIL,
                        TypeAliasId::NIL,
                    )
                };
                let arg_type = self.check_expression_with_contextual_type(
                    arg,
                    contextual_type,
                    context,
                    check_mode,
                );
                let has_primitive_contextual_type = in_const_context
                    || self.maybe_type_of_kind(
                        contextual_type,
                        TypeFlags::PRIMITIVE
                            | TypeFlags::INDEX
                            | TypeFlags::TEMPLATE_LITERAL
                            | TypeFlags::STRING_MAPPING,
                    );
                let element_type = if has_primitive_contextual_type {
                    self.get_regular_type_of_literal_type(arg_type)
                } else {
                    self.get_widened_literal_type(arg_type)
                };
                (element_type, ElementFlags::REQUIRED)
            };
            let mut labeled_declaration = NodeId::NIL;
            if is_synthetic_expression(a, arg)
                && !a.as_synthetic_expression(arg).tuple_name_source.is_nil()
            {
                labeled_declaration = a.as_synthetic_expression(arg).tuple_name_source;
            }
            types.push(t);
            infos.push(TupleElementInfo {
                flags,
                labeled_declaration,
            });
        }
        let readonly = in_const_context
            && !some_type(self, rest_type, &mut |c, t| c.is_mutable_array_like_type(t));
        let types = self.list(&types);
        self.create_tuple_type_ex(types, List::from_slice(&infos), readonly)
    }

    pub fn get_mutable_array_or_tuple_type(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.map_type(t, &mut |c, t| c.get_mutable_array_or_tuple_type(t));
        }
        if self.types[t].flags.intersects(TypeFlags::ANY) || {
            let constraint = self.get_base_constraint_or_type(t);
            self.is_mutable_array_or_tuple(constraint)
        } {
            return t;
        }
        if is_tuple_type(self, t) {
            let element_types = self.get_element_types(t);
            let element_infos = self.type_target_tuple_type(t).element_infos;
            return self.create_tuple_type_ex(element_types, element_infos, false);
        }
        let element_types = self.list_of(&[t]);
        self.create_tuple_type_ex(
            element_types,
            List::from_slice(&[TupleElementInfo {
                flags: ElementFlags::VARIADIC,
                labeled_declaration: NodeId::NIL,
            }]),
            false,
        )
    }

    pub fn get_contextual_type_for_binding_element(
        &mut self,
        declaration: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let name = a.property_name_or_name(declaration);
        if is_binding_pattern(a, name) || is_computed_non_literal_name(a, name) {
            return TypeId::NIL;
        }
        let parent = a.parent(a.parent(declaration));
        let mut parent_type =
            self.get_contextual_type_for_variable_like_declaration(parent, context_flags);
        if parent_type.is_nil() {
            if !is_binding_element(a, parent) && !a.initializer(parent).is_nil() {
                parent_type = self.check_declaration_initializer(
                    parent,
                    if_else(
                        has_dot_dot_dot_token(a, declaration),
                        CheckMode::REST_BINDING_ELEMENT,
                        CheckMode::NORMAL,
                    ),
                    TypeId::NIL,
                );
            }
        }
        if parent_type.is_nil() {
            return TypeId::NIL;
        }
        if is_array_binding_pattern(a, a.name(parent)) {
            let index = find_index(a.elements(a.parent(declaration)).as_slice(), |element| {
                element == declaration
            });
            if index < 0 {
                return TypeId::NIL;
            }
            return self.get_contextual_type_for_element_expression(parent_type, index, -1, -1, -1);
        }
        let name_type = self.get_literal_type_from_property_name(name);
        if is_type_usable_as_property_name(self, name_type) {
            let property_name = get_property_name_from_type(self, name_type);
            return self.get_type_of_property_of_type(parent_type, &property_name);
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_static_property_declaration(
        &mut self,
        declaration: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let parent = a.parent(declaration);
        if is_expression(a, parent) {
            let parent_type = self.get_contextual_type(parent, context_flags);
            if !parent_type.is_nil() {
                let symbol = self.get_symbol_of_declaration(declaration);
                return self
                    .get_type_of_property_of_contextual_type(parent_type, a.sym(symbol).name);
            }
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_return_expression(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let func = get_containing_function(a, node);
        if !func.is_nil() {
            let mut contextual_return_type = self.get_contextual_return_type(func, context_flags);
            if !contextual_return_type.is_nil() {
                let function_flags = get_function_flags(a, func);
                if function_flags.intersects(FunctionFlags::GENERATOR) {
                    let is_async_generator = function_flags.intersects(FunctionFlags::ASYNC);
                    if self.types[contextual_return_type]
                        .flags
                        .intersects(TypeFlags::UNION)
                    {
                        contextual_return_type =
                            self.filter_type(contextual_return_type, &mut |c, t| {
                                !c.get_iteration_type_of_generator_function_return_type(
                                    IterationTypeKind::RETURN,
                                    t,
                                    is_async_generator,
                                )
                                .is_nil()
                            });
                    }
                    let iteration_return_type = self
                        .get_iteration_type_of_generator_function_return_type(
                            IterationTypeKind::RETURN,
                            contextual_return_type,
                            function_flags.intersects(FunctionFlags::ASYNC),
                        );
                    if iteration_return_type.is_nil() {
                        return TypeId::NIL;
                    }
                    contextual_return_type = iteration_return_type;
                    // falls through to unwrap Promise for AsyncGenerators
                }
                if function_flags.intersects(FunctionFlags::ASYNC) {
                    // Get the awaited type without the `Awaited<T>` alias
                    let contextual_awaited_type = self
                        .map_type(contextual_return_type, &mut |c, t| {
                            c.get_awaited_type_no_alias(t)
                        });
                    if contextual_awaited_type.is_nil() {
                        return TypeId::NIL;
                    }
                    let promise_like_type = self.create_promise_like_type(contextual_awaited_type);
                    return self.get_union_type(List::from_slice(&[
                        contextual_awaited_type,
                        promise_like_type,
                    ]));
                }
                // Regular function or Generator function
                return contextual_return_type;
            }
        }
        TypeId::NIL
    }

    pub fn get_contextual_iteration_type(
        &mut self,
        kind: IterationTypeKind,
        function_decl: NodeId,
    ) -> TypeId {
        let is_async = get_function_flags(self.ast, function_decl).intersects(FunctionFlags::ASYNC);
        let contextual_return_type =
            self.get_contextual_return_type(function_decl, ContextFlags::NONE);
        if !contextual_return_type.is_nil() {
            return self.get_iteration_type_of_generator_function_return_type(
                kind,
                contextual_return_type,
                is_async,
            );
        }
        TypeId::NIL
    }

    pub fn get_contextual_return_type(
        &mut self,
        function_decl: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        // If the containing function has a return type annotation, is a constructor, or is a get accessor whose corresponding set accessor has a type annotation, return statements in the function are contextually typed
        let return_type = self.get_return_type_from_annotation(function_decl);
        if !return_type.is_nil() {
            return return_type;
        }
        // Otherwise, if the containing function is contextually typed by a function type with exactly one call signature and that call signature is non-generic, return statements are contextually typed by the return type of the signature
        let signature = self.get_contextual_signature_for_function_like_declaration(function_decl);
        if !signature.is_nil() && !self.is_resolving_return_type_of_signature(signature) {
            let return_type = self.get_return_type_of_signature(signature);
            let function_flags = get_function_flags(a, function_decl);
            if function_flags.intersects(FunctionFlags::GENERATOR) {
                return self.filter_type(return_type, &mut |c, t| {
                    c.types[t].flags.intersects(
                        TypeFlags::ANY_OR_UNKNOWN
                            | TypeFlags::VOID
                            | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
                    ) || c.check_generator_instantiation_assignability_to_return_type(
                        t,
                        function_flags,
                        NodeId::NIL,
                    )
                });
            }
            if function_flags.intersects(FunctionFlags::ASYNC) {
                return self.filter_type(return_type, &mut |c, t| {
                    c.types[t].flags.intersects(
                        TypeFlags::ANY_OR_UNKNOWN
                            | TypeFlags::VOID
                            | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
                    ) || !c.get_awaited_type_of_promise(t).is_nil()
                });
            }
            return return_type;
        }
        let iife = get_immediately_invoked_function_expression(a, function_decl);
        if !iife.is_nil() {
            return self.get_contextual_type(iife, context_flags);
        }
        TypeId::NIL
    }

    pub fn check_generator_instantiation_assignability_to_return_type(
        &mut self,
        return_type: TypeId,
        function_flags: FunctionFlags,
        error_node: NodeId,
    ) -> bool {
        // Naively, one could check that Generator<any, any, any> is assignable to the return type annotation. However, that would not catch the error in the case of `interface BadGenerator extends Iterable<number>, Iterator<string> { }` and `function* g(): BadGenerator { }`, where Iterable and Iterator have different types!
        let yield_type = self.get_iteration_type_of_generator_function_return_type(
            IterationTypeKind::YIELD,
            return_type,
            function_flags.intersects(FunctionFlags::ASYNC),
        );
        let generator_yield_type = or_else(yield_type, self.any_type);
        let iteration_return_type = self.get_iteration_type_of_generator_function_return_type(
            IterationTypeKind::RETURN,
            return_type,
            function_flags.intersects(FunctionFlags::ASYNC),
        );
        let generator_return_type = or_else(iteration_return_type, generator_yield_type);
        let next_type = self.get_iteration_type_of_generator_function_return_type(
            IterationTypeKind::NEXT,
            return_type,
            function_flags.intersects(FunctionFlags::ASYNC),
        );
        let generator_next_type = or_else(next_type, self.unknown_type);
        let generator_instantiation = self.create_generator_type(
            generator_yield_type,
            generator_return_type,
            generator_next_type,
            function_flags.intersects(FunctionFlags::ASYNC),
        );
        self.check_type_assignable_to(
            generator_instantiation,
            return_type,
            error_node,
            MessageId::NIL,
        )
    }

    pub fn get_contextual_signature_for_function_like_declaration(
        &mut self,
        node: NodeId,
    ) -> SignatureId {
        let a = self.ast;
        // Only function expressions, arrow functions, and object literal methods are contextually typed.
        if is_function_expression_or_arrow_function(a, node) || is_object_literal_method(a, node) {
            return self.get_contextual_signature(node);
        }
        SignatureId::NIL
    }

    pub fn get_contextual_type_for_yield_operand(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let func = get_containing_function(a, node);
        if !func.is_nil() {
            let function_flags = get_function_flags(a, func);
            let mut contextual_return_type = self.get_contextual_return_type(func, context_flags);
            if !contextual_return_type.is_nil() {
                let is_async_generator = function_flags.intersects(FunctionFlags::ASYNC);
                let is_yield_star = !a.as_yield_expression(node).asterisk_token.is_nil();
                if !is_yield_star
                    && self.types[contextual_return_type]
                        .flags
                        .intersects(TypeFlags::UNION)
                {
                    contextual_return_type =
                        self.filter_type(contextual_return_type, &mut |c, t| {
                            !c.get_iteration_type_of_generator_function_return_type(
                                IterationTypeKind::RETURN,
                                t,
                                is_async_generator,
                            )
                            .is_nil()
                        });
                }
                if is_yield_star {
                    let iteration_types = self
                        .get_iteration_types_of_generator_function_return_type(
                            contextual_return_type,
                            is_async_generator,
                        );
                    let yield_type = or_else(iteration_types.yield_type, self.silent_never_type);
                    let contextual_type = self.get_contextual_type(node, context_flags);
                    let return_type = or_else(contextual_type, self.silent_never_type);
                    let next_type = or_else(iteration_types.next_type, self.unknown_type);
                    let generator_type =
                        self.create_generator_type(yield_type, return_type, next_type, false);
                    if is_async_generator {
                        let async_generator_type =
                            self.create_generator_type(yield_type, return_type, next_type, true);
                        return self.get_union_type(List::from_slice(&[
                            generator_type,
                            async_generator_type,
                        ]));
                    }
                    return generator_type;
                }
                return self.get_iteration_type_of_generator_function_return_type(
                    IterationTypeKind::YIELD,
                    contextual_return_type,
                    is_async_generator,
                );
            }
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_await_operand(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let contextual_type = self.get_contextual_type(node, context_flags);
        if !contextual_type.is_nil() {
            let contextual_awaited_type = self.get_awaited_type_no_alias(contextual_type);
            if !contextual_awaited_type.is_nil() {
                let promise_like_type = self.create_promise_like_type(contextual_awaited_type);
                return self.get_union_type(List::from_slice(&[
                    contextual_awaited_type,
                    promise_like_type,
                ]));
            }
        }
        TypeId::NIL
    }

    // In a typed function call, an argument or substitution expression is contextually typed by the type of the corresponding parameter.
    pub fn get_contextual_type_for_argument(&mut self, call_target: NodeId, arg: NodeId) -> TypeId {
        let args = self.get_effective_call_arguments(call_target);
        let arg_index = find_index(args.as_slice(), |candidate| candidate == arg);
        // -1 for e.g. the expression of a CallExpression, or the tag of a TaggedTemplateExpression
        if arg_index == -1 {
            return TypeId::NIL;
        }
        self.get_contextual_type_for_argument_at_index(call_target, arg_index)
    }

    pub fn get_contextual_type_for_argument_at_index(
        &mut self,
        call_target: NodeId,
        arg_index: isize,
    ) -> TypeId {
        let a = self.ast;
        if is_import_call(a, call_target) {
            if arg_index == 0 {
                return self.string_type;
            }
            if arg_index == 1 {
                return self.get_global_import_call_options_type();
            }
            return self.any_type;
        }
        // If we're already in the process of resolving the given signature, don't resolve again as that could cause infinite recursion. Instead, return anySignature.
        let links = self.signature_links.get(call_target);
        let signature =
            if self.signature_links[links].resolved_signature == self.resolving_signature {
                self.resolving_signature
            } else {
                self.get_resolved_signature(call_target, None, CheckMode::NORMAL)
            };
        if is_jsx_opening_like_element(a, call_target) && arg_index == 0 {
            return self.get_effective_first_argument_for_jsx_signature(signature, call_target);
        }
        let parameters = self.signatures[signature].parameters;
        let rest_index = parameters.len() - 1;
        if signature_has_rest_parameter(self, signature) && arg_index >= rest_index {
            let rest_type = self.get_type_of_symbol(parameters.at(rest_index));
            let index_type = self.get_number_literal_type(Number((arg_index - rest_index) as f64));
            return self.get_indexed_access_type_ex(
                rest_type,
                index_type,
                AccessFlags::CONTEXTUAL,
                NodeId::NIL,
                TypeAliasId::NIL,
            );
        }
        self.get_type_at_position(signature, arg_index)
    }

    pub fn get_contextual_type_for_decorator(&mut self, decorator: NodeId) -> TypeId {
        let signature = self.get_decorator_call_signature(decorator);
        if !signature.is_nil() {
            return self.get_or_create_type_from_signature(signature);
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_binary_operand(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let parent = a.parent(node);
        let binary = a.as_binary_expression(parent);
        if !binary.type_node.is_nil() {
            return self.get_type_from_type_node(binary.type_node);
        }
        match a.kind(binary.operator_token) {
            Kind::EqualsToken
            | Kind::AmpersandAmpersandEqualsToken
            | Kind::BarBarEqualsToken
            | Kind::QuestionQuestionEqualsToken => {
                // In an assignment expression, the right operand is contextually typed by the type of the left operand unless it's an assignment declaration.
                if node == binary.right {
                    let target = get_leftmost_expression(a, binary.left, false);
                    if !(is_identifier(a, target) && {
                        let symbol = self.get_resolved_symbol(target);
                        a.sym(symbol).flags.intersects(SymbolFlags::MODULE_EXPORTS)
                    }) {
                        return self.get_contextual_type_for_assignment_expression(parent);
                    }
                }
            }
            Kind::BarBarToken | Kind::QuestionQuestionToken => {
                // When an || expression has a contextual type, the operands are contextually typed by that type, except when that type originates in a binding pattern, the right operand is contextually typed by the type of the left operand. When an || expression has no contextual type, the right operand is contextually typed by the type of the left operand, except for the special case of Javascript declarations of the form `namespace.prop = namespace.prop || {}`.
                let t = self.get_contextual_type(parent, context_flags);
                if node == binary.right && (t.is_nil() || !self.pattern_for_type.get(&t).is_nil()) {
                    return self.get_type_of_expression(binary.left);
                }
                return t;
            }
            Kind::AmpersandAmpersandToken | Kind::CommaToken => {
                if node == binary.right {
                    return self.get_contextual_type(parent, context_flags);
                }
            }
            _ => {}
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_assignment_expression(&mut self, binary: NodeId) -> TypeId {
        let a = self.ast;
        let left = a.as_binary_expression(binary).left;
        if is_access_expression(a, left) {
            let expr = a.expression(left);
            match a.kind(expr) {
                Kind::Identifier => {
                    let resolved_symbol = self.get_resolved_symbol(expr);
                    let symbol =
                        self.get_export_symbol_of_value_symbol_if_exported(resolved_symbol);
                    if a.sym(symbol).flags.intersects(SymbolFlags::MODULE_EXPORTS) {
                        // No contextual type for an expression of the form 'module.exports = expr'.
                        return TypeId::NIL;
                    }
                    if !a.symbol(binary).is_nil() {
                        // We have an assignment declaration (a binary expression with a symbol assigned by the binder) of the form 'F.id = expr' or 'F[xxx] = expr'. If 'F' is declared as a variable with a type annotation, we can obtain a contextual type from the annotated type without triggering a circularity. Otherwise, the assignment declaration has no contextual type.
                        let value_declaration = a.sym(symbol).value_declaration;
                        if !value_declaration.is_nil()
                            && is_variable_declaration(a, value_declaration)
                        {
                            let type_node = a.type_node(value_declaration);
                            if !type_node.is_nil() {
                                if is_property_access_expression(a, left) {
                                    let declared_type = self.get_type_from_type_node(type_node);
                                    return self.get_type_of_property_of_contextual_type(
                                        declared_type,
                                        a.text(a.name(left)),
                                    );
                                }
                                let name_type = self.check_expression_cached(
                                    a.as_element_access_expression(left).argument_expression,
                                );
                                if is_type_usable_as_property_name(self, name_type) {
                                    let declared_type = self.get_type_from_type_node(type_node);
                                    let property_name =
                                        get_property_name_from_type(self, name_type);
                                    return self.get_type_of_property_of_contextual_type_ex(
                                        declared_type,
                                        &property_name,
                                        name_type,
                                    );
                                }
                                return self.get_type_of_expression(left);
                            }
                        }
                        return TypeId::NIL;
                    }
                }
                Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                    if !a.symbol(binary).is_nil() {
                        return TypeId::NIL;
                    }
                }
                Kind::ThisKeyword => {
                    let mut symbol = SymbolId::NIL;
                    let this_type = self.get_type_of_expression(expr);
                    if is_property_access_expression(a, left) {
                        let name = a.name(left);
                        if is_private_identifier(a, name) {
                            let this_type_symbol = self.types[this_type].symbol;
                            if !this_type_symbol.is_nil() {
                                symbol = self.get_property_of_type(
                                    this_type,
                                    get_symbol_name_for_private_identifier(
                                        a,
                                        this_type_symbol,
                                        a.text(name),
                                    ),
                                );
                            }
                        } else {
                            symbol = self.get_property_of_type(this_type, a.text(name));
                        }
                    } else {
                        let prop_type = self.check_expression_cached(
                            a.as_element_access_expression(left).argument_expression,
                        );
                        if is_type_usable_as_property_name(self, prop_type) {
                            let property_name = get_property_name_from_type(self, prop_type);
                            symbol = self.get_property_of_type(this_type, &property_name);
                        }
                    }
                    if !symbol.is_nil() {
                        let d = a.sym(symbol).value_declaration;
                        if !d.is_nil()
                            && (is_property_declaration(a, d)
                                || is_property_signature_declaration(a, d))
                            && a.type_node(d).is_nil()
                            && a.initializer(d).is_nil()
                        {
                            // No contextual type for 'this.xxx = expr', where xxx is declared as a property with no type annotation or initializer.
                            return TypeId::NIL;
                        }
                    }
                    let binary_symbol = a.symbol(binary);
                    if !binary_symbol.is_nil()
                        && !a.sym(binary_symbol).value_declaration.is_nil()
                        && a.type_node(a.sym(binary_symbol).value_declaration).is_nil()
                    {
                        // We have an assignment declaration 'this.xxx = expr' with no (synthetic) type annotation
                        let container = self.get_this_container(expr, false, false);
                        if !is_object_literal_method(a, container) {
                            return TypeId::NIL;
                        }
                        // The one case of object literal methods: `this` in object literals has no contextual typing upstream, which answers nil with and without a name of the access.
                        return TypeId::NIL;
                    }
                }
                _ => {}
            }
        }
        self.get_type_of_expression(left)
    }

    pub fn get_contextual_type_for_object_literal_element(
        &mut self,
        element: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let type_node = a.type_node(element);
        if !type_node.is_nil() && !is_object_literal_method(a, element) {
            return self.get_type_from_type_node(type_node);
        }
        let object_literal = a.parent(element);
        let t = self.get_apparent_type_of_contextual_type(object_literal, context_flags);
        if !t.is_nil() {
            if self.has_bindable_name(element) {
                // For a (non-symbol) computed property, there is no reason to look up the name in the type. It will just be "__computed", which does not appear in any SymbolTable.
                let symbol = self.get_symbol_of_declaration(element);
                let links = self.value_symbol_links_get(symbol);
                let name_type = self.value_symbol_links[links].name_type;
                return self.get_type_of_property_of_contextual_type_ex(
                    t,
                    a.sym(symbol).name,
                    name_type,
                );
            }
            if has_dynamic_name(a, element) {
                let name = get_name_of_declaration(a, element);
                if !name.is_nil() && is_computed_property_name(a, name) {
                    let expr_type = self.check_expression(a.expression(name));
                    if is_type_usable_as_property_name(self, expr_type) {
                        let property_name = get_property_name_from_type(self, expr_type);
                        let prop_type =
                            self.get_type_of_property_of_contextual_type(t, &property_name);
                        if !prop_type.is_nil() {
                            return prop_type;
                        }
                    }
                }
            }
            if !a.name(element).is_nil() {
                let name_type = self.get_literal_type_from_property_name(a.name(element));
                // We avoid calling getApplicableIndexInfo here because it performs potentially expensive intersection reduction.
                return self.map_type_ex(
                    t,
                    &mut |c, t| {
                        let index_infos = c.get_index_infos_of_structured_type(t);
                        let index_info = c.find_applicable_index_info(index_infos, name_type);
                        if index_info.is_nil() {
                            return TypeId::NIL;
                        }
                        c.index_infos[index_info].value_type
                    },
                    true,
                );
            }
        }
        TypeId::NIL
    }

    // In an object literal contextually typed by a type T, the contextual type of a property assignment is the type of the matching property in T, if one exists. Otherwise, it is the type of the numeric index signature in T, if one exists. Otherwise, it is the type of the string index signature in T, if one exists.
    pub fn get_contextual_type_for_object_literal_method(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        if self
            .ast
            .flags(node)
            .intersects(NodeFlags::IN_WITH_STATEMENT)
        {
            // We cannot answer semantic questions within a with block, do not proceed any further
            return TypeId::NIL;
        }
        self.get_contextual_type_for_object_literal_element(node, context_flags)
    }

    pub fn get_contextual_type_for_element_expression(
        &mut self,
        t: TypeId,
        index: isize,
        length: isize,
        first_spread_index: isize,
        last_spread_index: isize,
    ) -> TypeId {
        if t.is_nil() {
            return TypeId::NIL;
        }
        self.map_type_ex(
            t,
            &mut |c, t| {
                if is_tuple_type(c, t) {
                    // If index is before any spread element and within the fixed part of the contextual tuple type, return the type of the contextual tuple element.
                    if (first_spread_index < 0 || index < first_spread_index)
                        && index < c.type_target_tuple_type(t).fixed_length
                    {
                        let element_type = c.get_type_arguments(t).at(index);
                        let is_optional = c
                            .type_target_tuple_type(t)
                            .element_infos
                            .at(index)
                            .flags
                            .intersects(ElementFlags::OPTIONAL);
                        return c.remove_missing_type(element_type, is_optional);
                    }
                    // When the length is known and the index is after all spread elements we compute the offset from the element to the end and the number of ending fixed elements in the contextual tuple type.
                    let mut offset: isize = 0;
                    if length >= 0 && (last_spread_index < 0 || index > last_spread_index) {
                        offset = length - index;
                    }
                    let mut fixed_end_length: isize = 0;
                    if offset > 0
                        && c.type_target_tuple_type(t)
                            .combined_flags
                            .intersects(ElementFlags::VARIABLE)
                    {
                        fixed_end_length =
                            get_end_element_count(c.type_target_tuple_type(t), ElementFlags::FIXED);
                    }
                    // If the offset is within the ending fixed part of the contextual tuple type, return the type of the contextual tuple element.
                    if offset > 0 && offset <= fixed_end_length {
                        return c
                            .get_type_arguments(t)
                            .at(c.get_type_reference_arity(t) - offset);
                    }
                    // Return a union of the possible contextual element types with no subtype reduction.
                    let mut tuple_index = c.type_target_tuple_type(t).fixed_length;
                    if first_spread_index >= 0 {
                        tuple_index = tuple_index.min(first_spread_index);
                    }
                    let mut end_skip_count = fixed_end_length;
                    if length >= 0 && last_spread_index >= 0 {
                        end_skip_count = fixed_end_length.min(length - last_spread_index);
                    }
                    return c.get_element_type_of_slice_of_tuple_type(
                        t,
                        tuple_index,
                        end_skip_count,
                        false,
                        true,
                    );
                }
                // If element index is known and a contextual property with that name exists, return it. Otherwise return the iterated or element type of the contextual type.
                if first_spread_index < 0 || index < first_spread_index {
                    let prop_type =
                        c.get_type_of_property_of_contextual_type(t, index.to_string().as_bytes());
                    if !prop_type.is_nil() {
                        return prop_type;
                    }
                }
                c.get_iterated_type_or_element_type(
                    IterationUse::ELEMENT,
                    t,
                    c.undefined_type,
                    NodeId::NIL,
                    false,
                )
            },
            true,
        )
    }

    // In a contextually typed conditional expression, the true/false expressions are contextually typed by the same type.
    pub fn get_contextual_type_for_conditional_operand(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let parent = a.parent(node);
        let conditional = a.as_conditional_expression(parent);
        if node == conditional.when_true || node == conditional.when_false {
            return self.get_contextual_type(parent, context_flags);
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_substitution_expression(
        &mut self,
        template: NodeId,
        substitution_expression: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let parent = a.parent(template);
        if is_tagged_template_expression(a, parent) {
            return self.get_contextual_type_for_argument(parent, substitution_expression);
        }
        TypeId::NIL
    }

    pub fn get_contextual_import_attribute_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let import_attributes_type = self.get_global_import_attributes_type();
        self.get_type_of_property_of_contextual_type(import_attributes_type, a.text(a.name(node)))
    }
}
