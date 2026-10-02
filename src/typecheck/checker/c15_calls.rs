// checker.go:8407-10131 (layers E-CALL, E-DECOR, T-SIGSHAPE): the check of a call, new and tagged template expression, the resolution of the signature of a call-like node over its candidates, the arity and the applicability of a candidate, the inference of type arguments from the arguments, the signature and the diagnostics of a resolution that fails, and untyped and erroneous calls.
use crate::ast::{
    Arg, Ast, DiagnosticId, Kind, ModifierFlags, NodeId, OuterExpressionKinds, SymbolFlags,
    SymbolId, can_have_decorators, get_class_extends_heritage_element,
    get_class_like_declaration_of_symbol, get_containing_class, get_invoked_expression,
    get_source_file_of_node, has_accessor_modifier, has_modifier, is_access_expression,
    is_array_literal_expression, is_binary_expression, is_binding_pattern, is_call_expression,
    is_construct_signature_declaration, is_constructor_declaration, is_constructor_type_node,
    is_decorator, is_dotted_name, is_expression_statement,
    is_function_expression_or_arrow_function, is_function_like_declaration, is_identifier,
    is_import_call, is_in_js_file, is_jsx_call_like, is_jsx_opening_fragment,
    is_jsx_opening_like_element, is_new_expression, is_omitted_expression, is_optional_chain,
    is_optional_chain_root, is_outermost_optional_chain, is_parameter_declaration,
    is_parenthesized_expression, is_property_access_expression, is_super_property,
    is_tagged_template_expression, is_template_expression, is_unterminated_literal,
    node_is_missing, node_is_present, skip_outer_expressions, walk_up_parenthesized_expressions,
};
use crate::checker::{
    CachedSignatureKey, CheckMode, Checker, ContextFlags, InferenceContextId, InferenceFlags,
    InferencePriority, ObjectFlags, RelationKind, SignatureFlags, SignatureId, SignatureKind,
    TypeAliasId, TypeComparer, TypeFacts, TypeFlags, TypeId, TypeMapperId, TypePredicateId,
    UnionReduction, get_non_rest_parameter_count, get_selected_modifier_flags,
    has_inference_candidates, is_call_chain, is_rest_parameter, is_spread_argument, is_super_call,
    is_tuple_type, is_type_any, min_and_max, new_type_mapper, signature_has_rest_parameter,
    signature_key_inner, signature_key_outer, try_get_property_access_or_identifier_to_string,
};
use crate::core::{
    List, element_or_nil, filter, find, find_index, first_or_nil, if_else, last_or_nil, map,
    map_non_nil, new_text_range, or_else,
};
use crate::diagnostics::{self, MessageId};
use crate::scanner::{SkipTriviaOptions, get_text_of_node, skip_trivia, skip_trivia_ex};
use crate::stringutil::is_line_break;

// strconv.Itoa
fn itoa(value: isize) -> Vec<u8> {
    value.to_string().into_bytes()
}

impl<'a> Checker<'a> {
    // Syntactically and semantically checks a call or new expression. @param node The call/new expression to be checked. @returns On success, the expression's signature's return type. On failure, anyType.
    pub fn check_call_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        self.check_grammar_type_arguments(node, a.type_argument_list(node));
        let signature = self.get_resolved_signature(node, None, check_mode);
        if signature == self.resolving_signature {
            // CheckMode.SkipGenericFunctions is enabled and this is a call to a generic function that returns a function type. We defer checking and return silentNeverType.
            return self.silent_never_type;
        }
        self.check_deprecated_signature(signature, node);
        if a.kind(a.expression(node)) == Kind::SuperKeyword {
            return self.void_type;
        }
        if is_new_expression(a, node) {
            let declaration = self.signatures[signature].declaration;
            if !declaration.is_nil()
                && !is_constructor_declaration(a, declaration)
                && !is_construct_signature_declaration(a, declaration)
                && !is_constructor_type_node(a, declaration)
            {
                // When resolved signature is a call signature (and not a construct signature) the result type is any
                if self.no_implicit_any {
                    self.error(
                        node,
                        diagnostics::X_NEW_EXPRESSION_WHOSE_TARGET_LACKS_A_CONSTRUCT_SIGNATURE_IMPLICITLY_HAS_AN_ANY_TYPE,
                        &[],
                    );
                }
                return self.any_type;
            }
        }
        if is_in_js_file(a, node) && self.is_common_js_require(node) {
            return self.resolve_external_module_type_by_literal(a.arguments(node).at(0usize));
        }
        let return_type = self.get_return_type_of_signature(signature);
        // Treat any call to the global 'Symbol' function that is part of a const variable or readonly property as a fresh unique symbol literal type.
        if self.types[return_type]
            .flags
            .intersects(TypeFlags::ES_SYMBOL_LIKE)
            && self.is_symbol_or_symbol_for_call(node)
        {
            return self.get_es_symbol_like_type_for_node(walk_up_parenthesized_expressions(
                a,
                a.parent(node),
            ));
        }
        if is_call_expression(a, node)
            && a.question_dot_token(node).is_nil()
            && is_expression_statement(a, a.parent(node))
            && self.types[return_type].flags.intersects(TypeFlags::VOID)
            && !self.get_type_predicate_of_signature(signature).is_nil()
        {
            if !is_dotted_name(a, a.expression(node)) {
                self.error(
                    a.expression(node),
                    diagnostics::ASSERTIONS_REQUIRE_THE_CALL_TARGET_TO_BE_AN_IDENTIFIER_OR_QUALIFIED_NAME,
                    &[],
                );
            } else if self.get_effects_signature(node).is_nil() {
                let diagnostic = self.error(
                    a.expression(node),
                    diagnostics::ASSERTIONS_REQUIRE_EVERY_NAME_IN_THE_CALL_TARGET_TO_BE_DECLARED_WITH_AN_EXPLICIT_TYPE_ANNOTATION,
                    &[],
                );
                self.get_type_of_dotted_name(a.expression(node), diagnostic);
            }
        }
        return_type
    }

    pub fn check_deprecated_signature(&mut self, sig: SignatureId, node: NodeId) {
        let a = self.ast;
        if self.signatures[sig]
            .flags
            .intersects(SignatureFlags::IS_SIGNATURE_CANDIDATE_FOR_OVERLOAD_FAILURE)
        {
            return;
        }
        let declaration = self.signatures[sig].declaration;
        if !declaration.is_nil() && self.is_deprecated_declaration(declaration) {
            let suggestion_node = self.get_deprecated_suggestion_node(node);
            let name =
                try_get_property_access_or_identifier_to_string(a, get_invoked_expression(a, node));
            let signature_string = self.signature_to_string(sig);
            self.add_deprecated_suggestion_with_signature(
                suggestion_node,
                declaration,
                &name,
                &signature_string,
            );
        }
    }

    pub fn add_deprecated_suggestion_with_signature(
        &mut self,
        location: NodeId,
        declaration: NodeId,
        deprecated_entity: &[u8],
        signature_string: &[u8],
    ) -> DiagnosticId {
        let message = if_else(
            !deprecated_entity.is_empty(),
            diagnostics::THE_SIGNATURE_0_OF_1_IS_DEPRECATED,
            diagnostics::X_0_IS_DEPRECATED,
        );
        let diagnostic = self.new_diagnostic_for_node(
            location,
            message,
            &[Arg::Str(signature_string), Arg::Str(deprecated_entity)],
        );
        self.add_deprecated_suggestion_worker(List::from_slice(&[declaration]), diagnostic)
    }

    pub fn is_symbol_or_symbol_for_call(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_call_expression(a, node) {
            return false;
        }
        let mut left = a.expression(node);
        if is_property_access_expression(a, left) && a.text(a.name(left)) == b"for" {
            left = a.expression(left);
        }
        if !is_identifier(a, left) || a.text(left) != b"Symbol" {
            return false;
        }
        // make sure `Symbol` is the global symbol
        let global_es_symbol = self.get_global_es_symbol_constructor_symbol_or_nil();
        if global_es_symbol.is_nil() {
            return false;
        }
        global_es_symbol
            == self.resolve_name(
                left,
                b"Symbol",
                SymbolFlags::VALUE,
                MessageId::NIL,
                false,
                false,
            )
    }

    // Resolve a signature of a given call-like expression. @param node a call-like expression to try resolve a signature for @param candidatesOutArray an array of signature to be filled in by the function. It is passed by signature help in the language service; the function will fill it up with appropriate candidate signatures @return a signature of the call-like expression or undefined if one can't be found
    pub fn get_resolved_signature(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let links = self.signature_links.get(node);
        // If getResolvedSignature has already been called, we will have cached the resolvedSignature. However, it is possible that either candidatesOutArray was not passed in the first time, or that a different candidatesOutArray was passed in. Therefore, we need to redo the work to correctly fill the candidatesOutArray.
        let cached = self.signature_links[links].resolved_signature;
        if !cached.is_nil() && cached != self.resolving_signature && candidates_out_array.is_none()
        {
            return cached;
        }
        let save_resolution_start = self.resolution_start;
        if cached.is_nil() {
            // If we haven't already done so, temporarily reset the resolution stack. This allows us to handle "inverted" situations where, for example, an API client asks for the type of a symbol containined in a function call argument whose contextual type depends on the symbol itself through resolution of the containing function call. By resetting the resolution stack we'll retry the symbol type resolution with the resolvingSignature marker in place to suppress the contextual type circularity.
            self.resolution_start = self.type_resolutions.len() as isize;
        }
        self.signature_links[links].resolved_signature = self.resolving_signature;
        let mut result = self.resolve_signature(node, candidates_out_array, check_mode);
        self.resolution_start = save_resolution_start;
        // When CheckMode.SkipGenericFunctions is set we use resolvingSignature to indicate that call resolution should be deferred.
        if result != self.resolving_signature {
            // if the signature resolution originated on a node that itself depends on the contextual type then it's possible that the resolved signature might not be the same as the one that would be computed in source order since resolving such signature leads to resolving the potential outer signature, its arguments and thus the very same signature it's possible that this inner resolution sets the resolvedSignature first. In such a case we ignore the local result and reuse the correct one that was cached.
            if self.signature_links[links].resolved_signature != self.resolving_signature {
                result = self.signature_links[links].resolved_signature;
            }
            // If signature resolution originated in control flow type analysis (for example to compute the assigned type in a flow assignment) we don't cache the result as it may be based on temporary types from the control flow analysis.
            if self.flow_loop_stack.is_empty() {
                self.signature_links[links].resolved_signature = result;
            } else {
                self.signature_links[links].resolved_signature = cached;
            }
        }
        result
    }

    pub fn resolve_signature(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        match a.kind(node) {
            Kind::CallExpression => {
                self.resolve_call_expression(node, candidates_out_array, check_mode)
            }
            Kind::NewExpression => {
                self.resolve_new_expression(node, candidates_out_array, check_mode)
            }
            Kind::TaggedTemplateExpression => {
                self.resolve_tagged_template_expression(node, candidates_out_array, check_mode)
            }
            Kind::Decorator => self.resolve_decorator(node, candidates_out_array, check_mode),
            Kind::JsxOpeningFragment | Kind::JsxOpeningElement | Kind::JsxSelfClosingElement => {
                self.resolve_jsx_opening_like_element(node, candidates_out_array, check_mode)
            }
            Kind::BinaryExpression => {
                self.resolve_instanceof_expression(node, candidates_out_array, check_mode)
            }
            kind => self.fail_detail("Unhandled case in resolveSignature", kind as u32),
        }
    }

    pub fn resolve_call_expression(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        if a.kind(a.expression(node)) == Kind::SuperKeyword {
            let super_type = self.check_super_expression(a.expression(node));
            if is_type_any(self, super_type) {
                for &arg in a.arguments(node).as_slice() {
                    // Still visit arguments so they get marked for visibility, etc
                    self.check_expression(arg);
                }
                return self.any_signature;
            }
            if !self.is_error_type(super_type) {
                // In super call, the candidate signatures are the matching arity signatures of the base constructor function instantiated with the type arguments specified in the extends clause.
                let base_type_node =
                    get_class_extends_heritage_element(a, get_containing_class(a, node));
                if !base_type_node.is_nil() {
                    let base_constructors = self.get_instantiated_constructors_for_type_arguments(
                        super_type,
                        a.type_arguments(base_type_node),
                        base_type_node,
                    );
                    return self.resolve_call(
                        node,
                        base_constructors,
                        candidates_out_array,
                        check_mode,
                        SignatureFlags::NONE,
                        MessageId::NIL,
                    );
                }
            }
            return self.resolve_untyped_call(node);
        }
        if is_import_call(a, node) {
            return self.resolve_untyped_call(node);
        }
        let mut func_type = self.check_expression(a.expression(node));
        let call_chain_flags = if is_call_chain(a, node) {
            let non_optional_type =
                self.get_optional_expression_type(func_type, a.expression(node));
            let flags = if non_optional_type == func_type {
                SignatureFlags::NONE
            } else if is_outermost_optional_chain(a, node) {
                SignatureFlags::IS_OUTER_CALL_CHAIN
            } else {
                SignatureFlags::IS_INNER_CALL_CHAIN
            };
            func_type = non_optional_type;
            flags
        } else {
            SignatureFlags::NONE
        };
        func_type = self.check_non_null_type_with_reporter(
            func_type,
            a.expression(node),
            Self::report_cannot_invoke_possibly_null_or_undefined_error,
        );
        if func_type == self.silent_never_type {
            return self.silent_never_signature;
        }
        let apparent_type = self.get_apparent_type(func_type);
        if self.is_error_type(apparent_type) {
            // Another error has already been reported
            return self.resolve_error_call(node);
        }
        // Technically, this signatures list may be incomplete. We are taking the apparent type, but we are not including call signatures that may have been added to the Object or Function interface, since they have none by default. This is a bit of a leap of faith that the user will not add any.
        let call_signatures = self.get_signatures_of_type(apparent_type, SignatureKind::CALL);
        let num_construct_signatures = self
            .get_signatures_of_type(apparent_type, SignatureKind::CONSTRUCT)
            .len();
        // TS 1.0 Spec: 4.12 In an untyped function call no TypeArgs are permitted, Args can be any argument list, no contextual types are provided for the argument expressions, and the result is always of type Any.
        if self.is_untyped_function_call(
            func_type,
            apparent_type,
            call_signatures.len(),
            num_construct_signatures,
        ) {
            // The unknownType indicates that an error already occurred (and was reported). No need to report another error in this case.
            if !self.is_error_type(func_type) && !a.type_arguments(node).is_nil() {
                self.error(
                    node,
                    diagnostics::UNTYPED_FUNCTION_CALLS_MAY_NOT_ACCEPT_TYPE_ARGUMENTS,
                    &[],
                );
            }
            return self.resolve_untyped_call(node);
        }
        // If FuncExpr's apparent type(section 3.8.1) is a function type, the call is a typed function call. TypeScript employs overload resolution in typed function calls in order to support functions with multiple call signatures.
        if call_signatures.len() == 0 {
            if num_construct_signatures != 0 {
                let type_text = self.type_to_string_exported(func_type);
                self.error(
                    node,
                    diagnostics::VALUE_OF_TYPE_0_IS_NOT_CALLABLE_DID_YOU_MEAN_TO_INCLUDE_NEW,
                    &[Arg::Str(&type_text)],
                );
            } else {
                let mut related_information = DiagnosticId::NIL;
                if a.arguments(node).len() == 1 {
                    let text = a.as_source_file(get_source_file_of_node(a, node)).text();
                    let options = SkipTriviaOptions {
                        stop_after_line_break: true,
                        ..SkipTriviaOptions::default()
                    };
                    let index = skip_trivia_ex(text, a.end(a.expression(node)), Some(&options)) - 1;
                    // A position outside the text is no line break, where upstream's index panics.
                    let at_line_break = usize::try_from(index)
                        .ok()
                        .and_then(|i| text.get(i))
                        .is_some_and(|&ch| is_line_break(u32::from(ch)));
                    if at_line_break {
                        related_information = self.create_diagnostic_for_node(
                            a.expression(node),
                            diagnostics::ARE_YOU_MISSING_A_SEMICOLON,
                            &[],
                        );
                    }
                }
                self.invocation_error(
                    a.expression(node),
                    apparent_type,
                    SignatureKind::CALL,
                    related_information,
                );
            }
            return self.resolve_error_call(node);
        }
        // When a call to a generic function is an argument to an outer call to a generic function for which inference is in process, we have a choice to make. If the inner call relies on inferences made from its contextual type to its return type, deferring the inner call processing allows the best possible contextual type to accumulate. But if the outer call relies on inferences made from the return type of the inner call, the inner call should be processed early. There's no sure way to know which choice is right (only a full unification algorithm can determine that), so we resort to the following heuristic: If no type arguments are specified in the inner call and at least one call signature is generic and returns a function type, we choose to defer processing. This narrowly permits function composition operators to flow inferences through return types, but otherwise processes calls right away. We use the resolvingSignature singleton to indicate that we deferred processing. This result will be propagated out and eventually turned into silentNeverType (a type that is assignable to anything and from which we never make inferences).
        if check_mode.intersects(CheckMode::SKIP_GENERIC_FUNCTIONS)
            && a.type_arguments(node).len() == 0
            && call_signatures
                .iter()
                .any(|sig| self.is_generic_function_returning_function(sig))
        {
            self.skipped_generic_function(node, check_mode);
            return self.resolving_signature;
        }
        self.resolve_call(
            node,
            call_signatures,
            candidates_out_array,
            check_mode,
            call_chain_flags,
            MessageId::NIL,
        )
    }

    pub fn resolve_new_expression(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        let mut expression_type = self.check_non_null_expression(a.expression(node));
        if expression_type == self.silent_never_type {
            return self.silent_never_signature;
        }
        // If expressionType's apparent type(section 3.8.1) is an object type with one or more construct signatures, the expression is processed in the same manner as a function call, but using the construct signatures as the initial set of candidate signatures for overload resolution. The result type of the function call becomes the result type of the operation.
        expression_type = self.get_apparent_type(expression_type);
        if self.is_error_type(expression_type) {
            // Another error has already been reported
            return self.resolve_error_call(node);
        }
        // TS 1.0 spec: 4.11 If expressionType is of type Any, Args can be any argument list and the result of the operation is of type Any.
        if is_type_any(self, expression_type) {
            if a.type_arguments(node).len() != 0 {
                self.error(
                    node,
                    diagnostics::UNTYPED_FUNCTION_CALLS_MAY_NOT_ACCEPT_TYPE_ARGUMENTS,
                    &[],
                );
            }
            return self.resolve_untyped_call(node);
        }
        // Technically, this signatures list may be incomplete. We are taking the apparent type, but we are not including construct signatures that may have been added to the Object or Function interface, since they have none by default. This is a bit of a leap of faith that the user will not add any.
        let construct_signatures =
            self.get_signatures_of_type(expression_type, SignatureKind::CONSTRUCT);
        if construct_signatures.len() != 0 {
            if !self.is_constructor_accessible(node, construct_signatures.at(0usize)) {
                return self.resolve_error_call(node);
            }
            // If the expression is a class of abstract type, or an abstract construct signature, then it cannot be instantiated. In the case of a merged class-module or class-interface declaration, only the class declaration node will have the Abstract flag set.
            if some_signature(self, construct_signatures, &mut |c, sig| {
                c.signatures[sig].flags.intersects(SignatureFlags::ABSTRACT)
            }) {
                self.error(
                    node,
                    diagnostics::CANNOT_CREATE_AN_INSTANCE_OF_AN_ABSTRACT_CLASS,
                    &[],
                );
                return self.resolve_error_call(node);
            }
            let symbol = self.types[expression_type].symbol;
            if !symbol.is_nil() {
                let value_decl = get_class_like_declaration_of_symbol(a, symbol);
                if !value_decl.is_nil() && has_modifier(a, value_decl, ModifierFlags::ABSTRACT) {
                    self.error(
                        node,
                        diagnostics::CANNOT_CREATE_AN_INSTANCE_OF_AN_ABSTRACT_CLASS,
                        &[],
                    );
                    return self.resolve_error_call(node);
                }
            }
            return self.resolve_call(
                node,
                construct_signatures,
                candidates_out_array,
                check_mode,
                SignatureFlags::NONE,
                MessageId::NIL,
            );
        }
        // If expressionType's apparent type is an object type with no construct signatures but one or more call signatures, the expression is processed as a function call. A compile-time error occurs if the result of the function call is not Void. The type of the result of the operation is Any. It is an error to have a Void this type.
        let call_signatures = self.get_signatures_of_type(expression_type, SignatureKind::CALL);
        if call_signatures.len() != 0 {
            let signature = self.resolve_call(
                node,
                call_signatures,
                candidates_out_array,
                check_mode,
                SignatureFlags::NONE,
                MessageId::NIL,
            );
            if !self.no_implicit_any {
                if !self.signatures[signature].declaration.is_nil()
                    && self.get_return_type_of_signature(signature) != self.void_type
                {
                    self.error(
                        node,
                        diagnostics::ONLY_A_VOID_FUNCTION_CAN_BE_CALLED_WITH_THE_NEW_KEYWORD,
                        &[],
                    );
                }
                if self.get_this_type_of_signature(signature) == self.void_type {
                    self.error(
                        node,
                        diagnostics::A_FUNCTION_THAT_IS_CALLED_WITH_THE_NEW_KEYWORD_CANNOT_HAVE_A_THIS_TYPE_THAT_IS_VOID,
                        &[],
                    );
                }
            }
            return signature;
        }
        self.invocation_error(
            a.expression(node),
            expression_type,
            SignatureKind::CONSTRUCT,
            DiagnosticId::NIL,
        );
        self.resolve_error_call(node)
    }

    pub fn is_constructor_accessible(&mut self, node: NodeId, signature: SignatureId) -> bool {
        let a = self.ast;
        if signature.is_nil() || self.signatures[signature].declaration.is_nil() {
            return true;
        }
        let declaration = self.signatures[signature].declaration;
        let modifiers = get_selected_modifier_flags(
            a,
            declaration,
            ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER,
        );
        // (1) Public constructors and (2) constructor functions are always accessible.
        if modifiers == ModifierFlags::NONE || !is_constructor_declaration(a, declaration) {
            return true;
        }
        let declaring_class_declaration =
            get_class_like_declaration_of_symbol(a, a.symbol(a.parent(declaration)));
        let declaring_class = self.get_declared_type_of_symbol(a.symbol(a.parent(declaration)));
        // A private or protected constructor can only be instantiated within its own class (or a subclass, for protected)
        if !self.is_node_within_class(node, declaring_class_declaration) {
            let containing_class = get_containing_class(a, node);
            if !containing_class.is_nil() && modifiers.intersects(ModifierFlags::PROTECTED) {
                let containing_type = self.get_declared_type_of_symbol(a.symbol(containing_class));
                if self.type_has_protected_accessible_base(
                    a.symbol(a.parent(declaration)),
                    containing_type,
                ) {
                    return true;
                }
            }
            if modifiers.intersects(ModifierFlags::PRIVATE) {
                let class_text = self.type_to_string_exported(declaring_class);
                self.error(
                    node,
                    diagnostics::CONSTRUCTOR_OF_CLASS_0_IS_PRIVATE_AND_ONLY_ACCESSIBLE_WITHIN_THE_CLASS_DECLARATION,
                    &[Arg::Str(&class_text)],
                );
            }
            if modifiers.intersects(ModifierFlags::PROTECTED) {
                let class_text = self.type_to_string_exported(declaring_class);
                self.error(
                    node,
                    diagnostics::CONSTRUCTOR_OF_CLASS_0_IS_PROTECTED_AND_ONLY_ACCESSIBLE_WITHIN_THE_CLASS_DECLARATION,
                    &[Arg::Str(&class_text)],
                );
            }
            return false;
        }
        true
    }

    pub fn type_has_protected_accessible_base(&mut self, target: SymbolId, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            // A walk that is cut proves nothing, and false would report a constructor that is not accessible.
            let _: () = self.stack_limit();
            return true;
        }
        let target_type = self.get_target_type(t);
        let base_types = self.get_base_types(target_type);
        if base_types.len() == 0 {
            return false;
        }
        let first_base = base_types.at(0usize);
        if self.types[first_base]
            .flags
            .intersects(TypeFlags::INTERSECTION)
        {
            let types = self.as_intersection_type(first_base).types;
            let (mixin_flags, _) = self.find_mixins(types);
            for (i, &intersection_member) in
                self.type_types(first_base).as_slice().iter().enumerate()
            {
                // We want to ignore mixin ctors
                if !mixin_flags.get(i).copied().unwrap_or(false) {
                    if self.types[intersection_member]
                        .object_flags
                        .intersects(ObjectFlags::CLASS | ObjectFlags::INTERFACE)
                    {
                        if self.types[intersection_member].symbol == target {
                            return true;
                        }
                        if self.type_has_protected_accessible_base(target, intersection_member) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        if self.types[first_base].symbol == target {
            return true;
        }
        self.type_has_protected_accessible_base(target, first_base)
    }
}

// A signature is an id: the callback gets the checker, as the callback of some_type does.
pub fn some_signature<'a>(
    c: &mut Checker<'a>,
    signatures: List<'_, SignatureId>,
    f: &mut dyn FnMut(&mut Checker<'a>, SignatureId) -> bool,
) -> bool {
    for &sig in signatures.as_slice() {
        let composite = c.signatures[sig].composite;
        if !composite.is_nil() {
            if c.composite_signatures[composite].is_union {
                let members = c.composite_signatures[composite].signatures;
                for &member in members.as_slice() {
                    if f(c, member) {
                        return true;
                    }
                }
            }
        } else if f(c, sig) {
            return true;
        }
    }
    false
}

impl<'a> Checker<'a> {
    pub fn resolve_tagged_template_expression(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        let tag = a.as_tagged_template_expression(node).tag;
        let tag_type = self.check_expression(tag);
        let apparent_type = self.get_apparent_type(tag_type);
        if self.is_error_type(apparent_type) {
            // Another error has already been reported
            return self.resolve_error_call(node);
        }
        let call_signatures = self.get_signatures_of_type(apparent_type, SignatureKind::CALL);
        let num_construct_signatures = self
            .get_signatures_of_type(apparent_type, SignatureKind::CONSTRUCT)
            .len();
        if self.is_untyped_function_call(
            tag_type,
            apparent_type,
            call_signatures.len(),
            num_construct_signatures,
        ) {
            return self.resolve_untyped_call(node);
        }
        if call_signatures.len() == 0 {
            if is_array_literal_expression(a, a.parent(node)) {
                self.error(
                    tag,
                    diagnostics::IT_IS_LIKELY_THAT_YOU_ARE_MISSING_A_COMMA_TO_SEPARATE_THESE_TWO_TEMPLATE_EXPRESSIONS_THEY_FORM_A_TAGGED_TEMPLATE_EXPRESSION_WHICH_CANNOT_BE_INVOKED,
                    &[],
                );
                return self.resolve_error_call(node);
            }
            self.invocation_error(tag, apparent_type, SignatureKind::CALL, DiagnosticId::NIL);
            return self.resolve_error_call(node);
        }
        self.resolve_call(
            node,
            call_signatures,
            candidates_out_array,
            check_mode,
            SignatureFlags::NONE,
            MessageId::NIL,
        )
    }

    pub fn resolve_decorator(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        if !can_have_decorators(a, a.parent(node)) {
            return self.resolve_error_call(node);
        }
        let func_type = self.check_expression(a.expression(node));
        let apparent_type = self.get_apparent_type(func_type);
        if self.is_error_type(apparent_type) {
            return self.resolve_error_call(node);
        }
        let call_signatures = self.get_signatures_of_type(apparent_type, SignatureKind::CALL);
        let num_construct_signatures = self
            .get_signatures_of_type(apparent_type, SignatureKind::CONSTRUCT)
            .len();
        if self.is_untyped_function_call(
            func_type,
            apparent_type,
            call_signatures.len(),
            num_construct_signatures,
        ) {
            return self.resolve_untyped_call(node);
        }
        if self.is_potentially_uncalled_decorator(node, call_signatures)
            && !is_parenthesized_expression(a, a.expression(node))
        {
            let node_str = get_text_of_node(a, a.expression(node));
            self.error(
                node,
                diagnostics::X_0_ACCEPTS_TOO_FEW_ARGUMENTS_TO_BE_USED_AS_A_DECORATOR_HERE_DID_YOU_MEAN_TO_CALL_IT_FIRST_AND_WRITE_0,
                &[Arg::Str(&node_str)],
            );
            return self.resolve_error_call(node);
        }
        let head_message = self.get_diagnostic_head_message_for_decorator_resolution(node);
        if call_signatures.len() == 0 {
            let details = self.invocation_error_details(
                a.expression(node),
                apparent_type,
                SignatureKind::CALL,
            );
            let diag = self
                .diagnostic_store
                .new_diagnostic_chain(details, head_message, &[]);
            let diag = self.add_diagnostic(diag);
            self.invocation_error_recovery(apparent_type, SignatureKind::CALL, diag);
            return self.resolve_error_call(node);
        }
        let decorator_signature = self.get_decorator_call_signature(node);
        if decorator_signature.is_nil() {
            return self.resolve_error_call(node);
        }
        self.resolve_call(
            node,
            call_signatures,
            candidates_out_array,
            check_mode,
            SignatureFlags::NONE,
            head_message,
        )
    }

    // Sometimes, we have a decorator that could accept zero arguments, but is receiving too many arguments as part of the decorator invocation. In those cases, a user may have meant to *call* the expression before using it as a decorator.
    pub fn is_potentially_uncalled_decorator(
        &mut self,
        decorator: NodeId,
        signatures: List<'_, SignatureId>,
    ) -> bool {
        if signatures.len() == 0 {
            return false;
        }
        for &sig in signatures.as_slice() {
            if self.signatures[sig].min_argument_count != 0
                || signature_has_rest_parameter(self, sig)
            {
                return false;
            }
            let parameter_count = self.signatures[sig].parameters.len();
            if parameter_count >= self.get_decorator_argument_count(decorator, sig) {
                return false;
            }
        }
        true
    }

    // Gets the localized diagnostic head message to use for errors when resolving a decorator as a call expression.
    pub fn get_diagnostic_head_message_for_decorator_resolution(&self, node: NodeId) -> MessageId {
        match self.ast.kind(self.ast.parent(node)) {
            Kind::ClassDeclaration | Kind::ClassExpression => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_CLASS_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::Parameter => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_PARAMETER_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::PropertyDeclaration => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_PROPERTY_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_METHOD_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            _ => {
                let _: () = self
                    .fail("Unhandled case in getDiagnosticHeadMessageForDecoratorResolution");
                MessageId::NIL
            }
        }
    }

    pub fn resolve_instanceof_expression(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        // if rightType is an object type with a custom `[Symbol.hasInstance]` method, then it is potentially valid on the right-hand side of the `instanceof` operator. This allows normal `object` types to participate in `instanceof`, as per Step 2 of https://tc39.es/ecma262/#sec-instanceofoperator.
        let right = a.as_binary_expression(node).right;
        let right_type = self.check_expression(right);
        if !is_type_any(self, right_type) {
            let has_instance_method_type =
                self.get_symbol_has_instance_method_of_object_type(right_type);
            if !has_instance_method_type.is_nil() {
                let apparent_type = self.get_apparent_type(has_instance_method_type);
                if self.is_error_type(apparent_type) {
                    return self.resolve_error_call(node);
                }
                let call_signatures =
                    self.get_signatures_of_type(apparent_type, SignatureKind::CALL);
                let construct_signatures =
                    self.get_signatures_of_type(apparent_type, SignatureKind::CONSTRUCT);
                if self.is_untyped_function_call(
                    has_instance_method_type,
                    apparent_type,
                    call_signatures.len(),
                    construct_signatures.len(),
                ) {
                    return self.resolve_untyped_call(node);
                }
                if call_signatures.len() != 0 {
                    return self.resolve_call(
                        node,
                        call_signatures,
                        candidates_out_array,
                        check_mode,
                        SignatureFlags::NONE,
                        MessageId::NIL,
                    );
                }
            } else if !(self.type_has_call_or_construct_signatures(right_type)
                || self.is_type_subtype_of(right_type, self.global_function_type))
            {
                self.error(
                    right,
                    diagnostics::THE_RIGHT_HAND_SIDE_OF_AN_INSTANCEOF_EXPRESSION_MUST_BE_EITHER_OF_TYPE_ANY_A_CLASS_FUNCTION_OR_OTHER_TYPE_ASSIGNABLE_TO_THE_FUNCTION_INTERFACE_TYPE_OR_AN_OBJECT_TYPE_WITH_A_SYMBOL_HASINSTANCE_METHOD,
                    &[],
                );
                return self.resolve_error_call(node);
            }
        }
        // fall back to a default signature
        self.any_signature
    }
}

// The state of one call resolution: chooseOverload reads it and writes the candidates, the check mode of the arguments and the three candidates for an error.
#[derive(Default)]
pub struct CallState<'a> {
    pub node: NodeId,
    pub type_arguments: List<'a, NodeId>,
    pub args: Vec<NodeId>,
    pub candidates: Vec<SignatureId>,
    pub arg_check_mode: CheckMode,
    pub is_single_non_generic_candidate: bool,
    pub signature_help_trailing_comma: bool,
    pub candidates_for_argument_error: Vec<SignatureId>,
    pub candidate_for_argument_arity_error: SignatureId,
    pub candidate_for_type_argument_error: SignatureId,
}

impl<'a> Checker<'a> {
    pub fn resolve_call(
        &mut self,
        node: NodeId,
        signatures: List<'_, SignatureId>,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
        call_chain_flags: SignatureFlags,
        head_message: MessageId,
    ) -> SignatureId {
        let a = self.ast;
        let is_tagged_template = a.kind(node) == Kind::TaggedTemplateExpression;
        let is_decorator = a.kind(node) == Kind::Decorator;
        let is_jsx_opening_or_self_closing_element = is_jsx_opening_like_element(a, node);
        let is_instanceof = a.kind(node) == Kind::BinaryExpression;
        let has_candidates_out_array = candidates_out_array.is_some();
        let report_errors = !self.is_inference_partially_blocked && !has_candidates_out_array;
        let mut s = CallState {
            node,
            ..CallState::default()
        };
        if !is_decorator
            && !is_instanceof
            && !is_super_call(a, node)
            && !is_jsx_opening_fragment(a, node)
        {
            s.type_arguments = a.type_arguments(node);
            // We already perform checking on the type arguments on the class declaration itself.
            if is_tagged_template
                || is_jsx_opening_or_self_closing_element
                || a.kind(a.expression(node)) != Kind::SuperKeyword
            {
                self.check_source_elements(s.type_arguments);
            }
        }
        s.candidates = self.reorder_candidates(signatures, call_chain_flags);
        let result = 'resolved: {
            if s.candidates.is_empty() {
                // In Strada we would error here, but no known repro doesn't have at least one other error in this codepath. Just return instead.
                break 'resolved self.unknown_signature;
            }
            let args = self.get_effective_call_arguments(node);
            s.args = args.as_slice().to_vec();
            // The excludeArgument array contains true for each context sensitive argument (an argument is context sensitive it is susceptible to a one-time permanent contextual typing). The idea is that we will perform type argument inference & assignability checking once without using the susceptible parameters that are functions, and once more for those parameters, contextually typing each as we go along. For a tagged template, then the first argument be 'undefined' if necessary because it represents a TemplateStringsArray. For a decorator, no arguments are susceptible to contextual typing due to the fact decorators are applied to a declaration by the emitter, and not to an expression.
            s.is_single_non_generic_candidate = s.candidates.len() == 1
                && self.signatures[first_or_nil(&s.candidates)]
                    .type_parameters
                    .len()
                    == 0;
            s.arg_check_mode = if !is_decorator
                && !s.is_single_non_generic_candidate
                && s.args.iter().any(|&arg| self.is_context_sensitive(arg))
            {
                CheckMode::SKIP_CONTEXT_SENSITIVE
            } else {
                CheckMode::NORMAL
            };
            // The following variables are captured and modified by calls to chooseOverload. If overload resolution or type argument inference fails, we want to report the best error possible. The best error is one which says that an argument was not assignable to a parameter. This implies that everything else about the overload was fine. So if there is any overload that is only incorrect because of an argument, we will report an error on that one: for `function foo(s: string): void; function foo(n: number): void; function foo(): void; foo(true);` the argument error is reported on the second overload. If none of the overloads even made it that far, there are two possibilities. There was a problem with type arguments for some overload, in which case report an error on that. Or none of the overloads even had correct arity, in which case give an arity error: for `function foo<T extends string>(x: T): void; function foo(): void; foo<number>(0);` the type argument error is reported. If we are in signature help, a trailing comma indicates that we intend to provide another argument, so we will only accept overloads with arity at least 1 higher than the current number of provided arguments.
            s.signature_help_trailing_comma = check_mode
                .intersects(CheckMode::IS_FOR_SIGNATURE_HELP)
                && is_call_expression(a, node)
                && a.has_trailing_comma(a.argument_list(node));
            // Section 4.12.1: if the candidate list contains one or more signatures for which the type of each argument expression is a subtype of each corresponding parameter type, the return type of the first of those signatures becomes the return type of the function call. Otherwise, the return type of the first signature in the candidate list becomes the return type of the function call. Whether the call is an error is determined by assignability of the arguments. The subtype pass is just important for choosing the best signature. So in the case where there is only one signature, the subtype pass is useless. So skipping it is an optimization.
            let mut result = SignatureId::NIL;
            if s.candidates.len() > 1 {
                result = self.choose_overload(&mut s, RelationKind::Subtype);
            }
            if result.is_nil() {
                result = self.choose_overload(&mut s, RelationKind::Assignable);
            }
            if !result.is_nil() {
                break 'resolved result;
            }
            result = self.get_candidate_for_overload_failure(
                s.node,
                &mut s.candidates,
                List::from_slice(&s.args),
                has_candidates_out_array,
                check_mode,
            );
            // Preemptively cache the result; getResolvedSignature will do this after we return, but we need to ensure that the result is present for the error checks below so that if this signature is encountered again, we handle the circularity (rather than producing a different result which may produce no errors and assert). Callers of getResolvedSignature don't hit this issue because they only observe this result after it's had a chance to be cached, but the error reporting code below executes before getResolvedSignature sets resolvedSignature.
            let links = self.signature_links.get(node);
            self.signature_links[links].resolved_signature = result;
            // No signatures were applicable. Now report errors based on the last applicable signature with no arguments excluded from assignability checks. If candidate is undefined, it means that no candidates had a suitable arity. In that case, skip the checkApplicableSignature check.
            if report_errors {
                // If the call expression is a synthetic call to a `[Symbol.hasInstance]` method then we will produce a head message when reporting diagnostics that explains how we got to `right[Symbol.hasInstance](left)` from `left instanceof right`, as it pertains to "Argument" related messages reported for the call.
                let mut head_message = head_message;
                if head_message.is_nil() && is_instanceof {
                    head_message = diagnostics::THE_LEFT_HAND_SIDE_OF_AN_INSTANCEOF_EXPRESSION_MUST_BE_ASSIGNABLE_TO_THE_FIRST_ARGUMENT_OF_THE_RIGHT_HAND_SIDE_S_SYMBOL_HASINSTANCE_METHOD;
                }
                self.report_call_resolution_errors(node, &s, signatures, head_message);
            }
            result
        };
        // `*candidatesOutArray = s.candidates` of upstream shares the list with the caller: the caller gets the candidates as the resolution left them.
        if let Some(candidates_out_array) = candidates_out_array {
            *candidates_out_array = s.candidates;
        }
        result
    }

    pub fn reorder_candidates(
        &mut self,
        signatures: List<'_, SignatureId>,
        call_chain_flags: SignatureFlags,
    ) -> Vec<SignatureId> {
        let a = self.ast;
        let mut last_parent = NodeId::NIL;
        let mut last_symbol = SymbolId::NIL;
        let mut index: isize = 0;
        let mut cutoff_index: isize = 0;
        let mut specialized_index: isize = -1;
        let mut result: Vec<SignatureId> = Vec::with_capacity(signatures.as_slice().len());
        for &signature in signatures.as_slice() {
            let mut signature = signature;
            let mut symbol = SymbolId::NIL;
            let mut parent = NodeId::NIL;
            let declaration = self.signatures[signature].declaration;
            if !declaration.is_nil() {
                symbol = self.get_symbol_of_declaration(declaration);
                parent = a.parent(declaration);
            }
            if last_symbol.is_nil() || symbol == last_symbol {
                if !last_parent.is_nil() && parent == last_parent {
                    index += 1;
                } else {
                    last_parent = parent;
                    index = cutoff_index;
                }
            } else {
                // current declaration belongs to a different symbol set cutoffIndex so re-orderings in the future won't change result set from 0 to cutoffIndex
                index = result.len() as isize;
                cutoff_index = result.len() as isize;
                last_parent = parent;
            }
            last_symbol = symbol;
            // specialized signatures always need to be placed before non-specialized signatures regardless of the cutoff position
            let splice_index = if signature_has_literal_types(self, signature) {
                specialized_index += 1;
                // The cutoff index always needs to be greater than or equal to the specialized signature index in order to prevent non-specialized signatures from being added before a specialized signature.
                cutoff_index += 1;
                specialized_index
            } else {
                index
            };
            if call_chain_flags != SignatureFlags::NONE {
                signature = self.get_optional_call_signature(signature, call_chain_flags);
            }
            match usize::try_from(splice_index) {
                Ok(at) if at <= result.len() => result.insert(at, signature),
                _ => {
                    // slices.Insert panics for an index outside the list.
                    let _: () = self.fail("index out of range in reorderCandidates");
                    result.push(signature);
                }
            }
        }
        result
    }
}

pub fn signature_has_literal_types(c: &Checker<'_>, s: SignatureId) -> bool {
    c.signatures[s]
        .flags
        .intersects(SignatureFlags::HAS_LITERAL_TYPES)
}

impl<'a> Checker<'a> {
    pub fn get_optional_call_signature(
        &mut self,
        signature: SignatureId,
        call_chain_flags: SignatureFlags,
    ) -> SignatureId {
        if (self.signatures[signature].flags & SignatureFlags::CALL_CHAIN_FLAGS) == call_chain_flags
        {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: if_else(
                call_chain_flags == SignatureFlags::IS_INNER_CALL_CHAIN,
                signature_key_inner(),
                signature_key_outer(),
            ),
        };
        let cached = self.cached_signatures.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let result = self.clone_signature(signature);
        self.signatures[result].flags |= call_chain_flags;
        let ok = self.cached_signatures.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn choose_overload(
        &mut self,
        s: &mut CallState<'a>,
        relation: RelationKind,
    ) -> SignatureId {
        let a = self.ast;
        s.candidates_for_argument_error = Vec::new();
        s.candidate_for_argument_arity_error = SignatureId::NIL;
        s.candidate_for_type_argument_error = SignatureId::NIL;
        if s.is_single_non_generic_candidate {
            let candidate = first_or_nil(&s.candidates);
            if s.type_arguments.len() != 0
                || !self.has_correct_arity(
                    s.node,
                    List::from_slice(&s.args),
                    candidate,
                    s.signature_help_trailing_comma,
                )
            {
                return SignatureId::NIL;
            }
            if !self.is_signature_applicable(
                s.node,
                List::from_slice(&s.args),
                candidate,
                relation,
                CheckMode::NORMAL,
                false,
                None,
            ) {
                s.candidates_for_argument_error = vec![candidate];
                return SignatureId::NIL;
            }
            return candidate;
        }
        let candidate_count = s.candidates.len();
        for candidate_index in 0..candidate_count {
            let Some(&candidate) = s.candidates.get(candidate_index) else {
                break;
            };
            if !self.has_correct_type_argument_arity(candidate, s.type_arguments)
                || !self.has_correct_arity(
                    s.node,
                    List::from_slice(&s.args),
                    candidate,
                    s.signature_help_trailing_comma,
                )
            {
                continue;
            }
            let mut check_candidate;
            let mut inference_context = InferenceContextId::NIL;
            let type_parameters = self.signatures[candidate].type_parameters;
            if type_parameters.len() != 0 {
                let type_argument_types;
                if s.type_arguments.len() != 0 {
                    type_argument_types = self.check_type_arguments(
                        candidate,
                        s.type_arguments,
                        false,
                        MessageId::NIL,
                    );
                    if type_argument_types.is_nil() {
                        s.candidate_for_type_argument_error = candidate;
                        continue;
                    }
                } else {
                    inference_context = self.new_inference_context(
                        type_parameters,
                        candidate,
                        if_else(
                            is_in_js_file(a, s.node),
                            InferenceFlags::ANY_DEFAULT,
                            InferenceFlags::NONE,
                        ),
                        TypeComparer::Nil,
                    );
                    type_argument_types = self.infer_type_arguments(
                        s.node,
                        candidate,
                        List::from_slice(&s.args),
                        s.arg_check_mode | CheckMode::SKIP_GENERIC_FUNCTIONS,
                        inference_context,
                    );
                    if self.inference_contexts[inference_context]
                        .flags
                        .intersects(InferenceFlags::SKIPPED_GENERIC_FUNCTION)
                    {
                        s.arg_check_mode |= CheckMode::SKIP_GENERIC_FUNCTIONS;
                    }
                }
                let mut inferred_type_parameters = List::NIL;
                if !inference_context.is_nil() {
                    inferred_type_parameters =
                        self.inference_contexts[inference_context].inferred_type_parameters;
                }
                let is_java_script = is_in_js_file(a, self.signatures[candidate].declaration);
                check_candidate = self.get_signature_instantiation(
                    candidate,
                    type_argument_types,
                    is_java_script,
                    inferred_type_parameters,
                );
                // If the original signature has a generic rest type, instantiation may produce a signature with different arity and we need to perform another arity check.
                if !self.get_non_array_rest_type(candidate).is_nil()
                    && !self.has_correct_arity(
                        s.node,
                        List::from_slice(&s.args),
                        check_candidate,
                        s.signature_help_trailing_comma,
                    )
                {
                    s.candidate_for_argument_arity_error = check_candidate;
                    continue;
                }
            } else {
                check_candidate = candidate;
            }
            if !self.is_signature_applicable(
                s.node,
                List::from_slice(&s.args),
                check_candidate,
                relation,
                s.arg_check_mode,
                false,
                None,
            ) {
                // Give preference to error candidates that have no rest parameters (as they are more specific)
                s.candidates_for_argument_error.push(check_candidate);
                continue;
            }
            if s.arg_check_mode != CheckMode::NONE {
                // If one or more context sensitive arguments were excluded, we start including them now (and keeping do so for any subsequent candidates) and perform a second round of type inference and applicability checking for this particular candidate.
                s.arg_check_mode = CheckMode::NORMAL;
                if !inference_context.is_nil() {
                    let type_argument_types = self.infer_type_arguments(
                        s.node,
                        candidate,
                        List::from_slice(&s.args),
                        s.arg_check_mode,
                        inference_context,
                    );
                    let is_java_script = is_in_js_file(a, self.signatures[candidate].declaration);
                    let inferred_type_parameters =
                        self.inference_contexts[inference_context].inferred_type_parameters;
                    check_candidate = self.get_signature_instantiation(
                        candidate,
                        type_argument_types,
                        is_java_script,
                        inferred_type_parameters,
                    );
                    // If the original signature has a generic rest type, instantiation may produce a signature with different arity and we need to perform another arity check.
                    if !self.get_non_array_rest_type(candidate).is_nil()
                        && !self.has_correct_arity(
                            s.node,
                            List::from_slice(&s.args),
                            check_candidate,
                            s.signature_help_trailing_comma,
                        )
                    {
                        s.candidate_for_argument_arity_error = check_candidate;
                        continue;
                    }
                }
                if !self.is_signature_applicable(
                    s.node,
                    List::from_slice(&s.args),
                    check_candidate,
                    relation,
                    s.arg_check_mode,
                    false,
                    None,
                ) {
                    // Give preference to error candidates that have no rest parameters (as they are more specific)
                    s.candidates_for_argument_error.push(check_candidate);
                    continue;
                }
            }
            if let Some(slot) = s.candidates.get_mut(candidate_index) {
                *slot = check_candidate;
            }
            return check_candidate;
        }
        SignatureId::NIL
    }

    pub fn has_correct_arity(
        &mut self,
        node: NodeId,
        args: List<'_, NodeId>,
        signature: SignatureId,
        signature_help_trailing_comma: bool,
    ) -> bool {
        let a = self.ast;
        if is_jsx_opening_fragment(a, node) {
            return true;
        }
        let arg_count: isize;
        let mut call_is_incomplete = false;
        // In incomplete call we want to be lenient when we have too few arguments
        let mut effective_parameter_count = self.get_parameter_count(signature);
        let mut effective_minimum_arguments = self.get_min_argument_count(signature);
        if is_tagged_template_expression(a, node) {
            arg_count = args.len();
            let template = a.as_tagged_template_expression(node).template;
            if is_template_expression(a, template) {
                // If a tagged template expression lacks a tail literal, the call is incomplete. Specifically, a template only can end in a TemplateTail or a Missing literal.
                let last_span = last_or_nil(
                    a.nodes(a.as_template_expression(template).template_spans)
                        .as_slice(),
                );
                // we should always have at least one span.
                call_is_incomplete = node_is_missing(a, a.as_template_span(last_span).literal)
                    || is_unterminated_literal(a, a.as_template_span(last_span).literal);
            } else {
                // If the template didn't end in a backtick, or its beginning occurred right prior to EOF, then this might actually turn out to be a TemplateHead in the future; so we consider the call to be incomplete.
                call_is_incomplete = is_unterminated_literal(a, template);
            }
        } else if is_decorator(a, node) {
            arg_count = self.get_decorator_argument_count(node, signature);
        } else if is_binary_expression(a, node) {
            arg_count = 1;
        } else if is_jsx_opening_like_element(a, node) {
            call_is_incomplete = a.end(a.attributes(node)) == a.end(node);
            if call_is_incomplete {
                return true;
            }
            arg_count = if_else(effective_minimum_arguments == 0, args.len(), 1);
            // class may have argumentless ctor functions - still resolve ctor and compare vs props member type
            effective_parameter_count = if_else(args.len() == 0, effective_parameter_count, 1);
            // sfc may specify context argument - handled by framework and not typechecked
            effective_minimum_arguments = effective_minimum_arguments.min(1);
        } else if is_new_expression(a, node) && a.argument_list(node).is_nil() {
            // This only happens when we have something of the form: 'new C'
            return self.get_min_argument_count(signature) == 0;
        } else {
            arg_count = if signature_help_trailing_comma {
                args.len() + 1
            } else {
                args.len()
            };
            // If we are missing the close parenthesis, the call is incomplete.
            call_is_incomplete = a.list_end(a.argument_list(node)) == a.end(node);
            // If a spread argument is present, check that it corresponds to a rest parameter or at least that it's in the valid range.
            let spread_arg_index = self.get_spread_argument_index(args);
            if spread_arg_index >= 0 {
                return spread_arg_index >= self.get_min_argument_count(signature)
                    && (self.has_effective_rest_parameter(signature)
                        || spread_arg_index < self.get_parameter_count(signature));
            }
        }
        // Too many arguments implies incorrect arity.
        if !self.has_effective_rest_parameter(signature) && arg_count > effective_parameter_count {
            return false;
        }
        // If the call is incomplete, we should skip the lower bound check. JSX signatures can have extra parameters provided by the library which we don't check
        if call_is_incomplete || arg_count >= effective_minimum_arguments {
            return true;
        }
        for i in arg_count..effective_minimum_arguments {
            let t = self.get_type_at_position(signature, i);
            let filtered = self.filter_type(t, &mut |c, t| accepts_void(c, t));
            if self.types[filtered].flags.intersects(TypeFlags::NEVER) {
                return false;
            }
        }
        true
    }
}

pub fn accepts_void(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::VOID)
}

impl<'a> Checker<'a> {
    pub fn get_decorator_argument_count(&mut self, node: NodeId, signature: SignatureId) -> isize {
        if self.compiler_options.experimental_decorators.is_true() {
            return self.get_legacy_decorator_argument_count(node, signature);
        }
        self.get_parameter_count(signature).clamp(1, 2)
    }

    // Returns the argument count for a decorator node that works like a function invocation.
    pub fn get_legacy_decorator_argument_count(
        &self,
        node: NodeId,
        signature: SignatureId,
    ) -> isize {
        let a = self.ast;
        match a.kind(a.parent(node)) {
            Kind::ClassDeclaration | Kind::ClassExpression => 1,
            Kind::PropertyDeclaration => {
                if has_accessor_modifier(a, a.parent(node)) {
                    return 3;
                }
                2
            }
            Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                // For decorators with only two parameters we supply only two arguments
                if self.signatures[signature].parameters.len() <= 2 {
                    return 2;
                }
                3
            }
            Kind::Parameter => 3,
            _ => self.fail("Unhandled case in getLegacyDecoratorArgumentCount"),
        }
    }

    pub fn has_correct_type_argument_arity(
        &mut self,
        signature: SignatureId,
        type_arguments: List<'_, NodeId>,
    ) -> bool {
        // If the user supplied type arguments, but the number of type arguments does not match the declared number of type parameters, the call has an incorrect arity.
        let type_parameters = self.signatures[signature].type_parameters;
        let num_type_parameters = type_parameters.len();
        let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
        type_arguments.len() == 0
            || type_arguments.len() >= min_type_argument_count
                && type_arguments.len() <= num_type_parameters
    }

    pub fn check_type_arguments(
        &mut self,
        signature: SignatureId,
        type_argument_nodes: List<'_, NodeId>,
        report_errors: bool,
        head_message: MessageId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let is_java_script = is_in_js_file(a, self.signatures[signature].declaration);
        let type_parameters = self.signatures[signature].type_parameters;
        let type_argument_types = self.map_list(type_argument_nodes, |c, node| {
            c.get_type_from_type_node(node)
        });
        let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
        let type_argument_types = self.fill_missing_type_arguments(
            type_argument_types,
            type_parameters,
            min_type_argument_count,
            is_java_script,
        );
        let mut mapper = TypeMapperId::NIL;
        for (i, &type_argument_node) in type_argument_nodes.as_slice().iter().enumerate() {
            let type_parameter = type_parameters.at(i);
            if type_parameter.is_nil() {
                // Upstream asserts, and indexes the type parameters with the place of a type argument that has none.
                self.assert(
                    false,
                    "Should not call checkTypeArguments with too many type arguments",
                );
                break;
            }
            let constraint = self.get_constraint_of_type_parameter(type_parameter);
            if !constraint.is_nil() {
                let type_argument_head_message = or_else(
                    head_message,
                    diagnostics::TYPE_0_DOES_NOT_SATISFY_THE_CONSTRAINT_1,
                );
                if mapper.is_nil() {
                    mapper = new_type_mapper(self, type_parameters, type_argument_types);
                }
                let type_argument = type_argument_types.at(i);
                let error_node = if_else(report_errors, type_argument_node, NodeId::NIL);
                let mut diags: Vec<DiagnosticId> = Vec::new();
                let instantiated_constraint = self.instantiate_type(constraint, mapper);
                let target =
                    self.get_type_with_this_argument(instantiated_constraint, type_argument, false);
                if !self.check_type_assignable_to_ex(
                    type_argument,
                    target,
                    error_node,
                    type_argument_head_message,
                    Some(&mut diags),
                ) {
                    if let Some(&first) = diags.first() {
                        let mut diagnostic = first;
                        if !head_message.is_nil() {
                            diagnostic = self.diagnostic_store.new_diagnostic_chain(
                                diagnostic,
                                diagnostics::TYPE_0_DOES_NOT_SATISFY_THE_CONSTRAINT_1,
                                &[],
                            );
                        }
                        self.add_diagnostic(diagnostic);
                    }
                    return List::NIL;
                }
            }
        }
        type_argument_types
    }

    pub fn is_signature_applicable(
        &mut self,
        node: NodeId,
        args: List<'_, NodeId>,
        signature: SignatureId,
        relation: RelationKind,
        check_mode: CheckMode,
        report_errors: bool,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let a = self.ast;
        if is_jsx_call_like(a, node) {
            return self.check_applicable_signature_for_jsx_call_like_element(
                node,
                signature,
                relation,
                check_mode,
                report_errors,
                diagnostic_output,
            );
        }
        let this_type = self.get_this_type_of_signature(signature);
        if !this_type.is_nil()
            && this_type != self.void_type
            && !(is_new_expression(a, node)
                || is_call_expression(a, node) && is_super_property(a, a.expression(node)))
        {
            // If the called expression is not of the form `x.f` or `x["f"]`, then sourceType = voidType. If the signature's 'this' type is voidType, then the check is skipped -- anything is compatible. If the expression is a new expression or super call expression, then the check is skipped.
            let this_argument_node = self.get_this_argument_of_call(node);
            let this_argument_type = self.get_this_argument_type(this_argument_node);
            let mut error_node = NodeId::NIL;
            if report_errors {
                error_node = this_argument_node;
                if error_node.is_nil() {
                    error_node = node;
                }
            }
            let head_message =
                diagnostics::THE_THIS_CONTEXT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_METHOD_S_THIS_OF_TYPE_1;
            if !self.check_type_related_to_ex(
                this_argument_type,
                this_type,
                relation,
                error_node,
                head_message,
                diagnostic_output.as_deref_mut(),
            ) {
                return false;
            }
        }
        let head_message = diagnostics::ARGUMENT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_PARAMETER_OF_TYPE_1;
        let rest_type = self.get_non_array_rest_type(signature);
        let arg_count = if !rest_type.is_nil() {
            (self.get_parameter_count(signature) - 1).min(args.len())
        } else {
            args.len()
        };
        for i in 0..arg_count {
            let arg = args.at(i);
            if !is_omitted_expression(a, arg) {
                let param_type = self.get_type_at_position(signature, i);
                let arg_type = self.check_expression_with_contextual_type(
                    arg,
                    param_type,
                    InferenceContextId::NIL,
                    check_mode,
                );
                // If one or more arguments are still excluded (as indicated by CheckMode.SkipContextSensitive), we obtain the regular type of any object literal arguments because we may not have inferred complete parameter types yet and therefore excess property checks may yield false positives.
                let check_arg_type = if check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE) {
                    self.get_regular_type_of_object_literal(arg_type)
                } else {
                    arg_type
                };
                let effective_check_argument_node = self.get_effective_check_node(arg);
                if !self.check_type_related_to_and_optionally_elaborate(
                    check_arg_type,
                    param_type,
                    relation,
                    if_else(report_errors, effective_check_argument_node, NodeId::NIL),
                    effective_check_argument_node,
                    head_message,
                    diagnostic_output.as_deref_mut(),
                ) {
                    self.maybe_add_missing_await_info(
                        arg,
                        check_arg_type,
                        param_type,
                        relation,
                        report_errors,
                        diagnostic_output.as_deref_mut(),
                    );
                    return false;
                }
            }
        }
        if !rest_type.is_nil() {
            let spread_type = self.get_spread_argument_type(
                args,
                arg_count,
                args.len(),
                rest_type,
                InferenceContextId::NIL,
                check_mode,
            );
            let rest_arg_count = args.len() - arg_count;
            let mut error_node = NodeId::NIL;
            if report_errors {
                match rest_arg_count {
                    0 => error_node = node,
                    1 => error_node = self.get_effective_check_node(args.at(arg_count)),
                    _ => {
                        error_node =
                            self.create_synthetic_expression(node, spread_type, false, NodeId::NIL);
                        a.set_loc(
                            error_node,
                            new_text_range(
                                a.pos(args.at(arg_count)),
                                a.end(args.at(args.len() - 1)),
                            ),
                        );
                    }
                }
            }
            if !self.check_type_related_to_ex(
                spread_type,
                rest_type,
                relation,
                error_node,
                head_message,
                diagnostic_output.as_deref_mut(),
            ) {
                self.maybe_add_missing_await_info(
                    error_node,
                    spread_type,
                    rest_type,
                    relation,
                    report_errors,
                    diagnostic_output,
                );
                return false;
            }
        }
        true
    }

    pub fn maybe_add_missing_await_info(
        &mut self,
        error_node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        report_errors: bool,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) {
        if !error_node.is_nil() && report_errors {
            if let Some(first) = diagnostic_output.and_then(|output| output.first().copied()) {
                // Bail if target is Promise-like---something else is wrong
                if !self.get_awaited_type_of_promise(target).is_nil() {
                    return;
                }
                let awaited_type_of_source = self.get_awaited_type_of_promise(source);
                if !awaited_type_of_source.is_nil()
                    && self.is_type_related_to(awaited_type_of_source, target, relation)
                {
                    let related = self.new_diagnostic_for_node(
                        error_node,
                        diagnostics::DID_YOU_FORGET_TO_USE_AWAIT,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(first, related);
                }
            }
        }
    }

    // Returns the `this` argument node in calls like `x.f(...)` and `x[f](...)`. `nil` otherwise.
    pub fn get_this_argument_of_call(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        if is_binary_expression(a, node) {
            return a.as_binary_expression(node).right;
        }
        let expression = if is_call_expression(a, node) {
            a.expression(node)
        } else if is_tagged_template_expression(a, node) {
            a.as_tagged_template_expression(node).tag
        } else if is_decorator(a, node) && !self.legacy_decorators {
            a.expression(node)
        } else {
            NodeId::NIL
        };
        if !expression.is_nil() {
            let callee = skip_outer_expressions(a, expression, OuterExpressionKinds::ALL);
            if is_access_expression(a, callee) {
                return a.expression(callee);
            }
        }
        NodeId::NIL
    }

    pub fn get_this_argument_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if node.is_nil() {
            return self.void_type;
        }
        let this_argument_type = self.check_expression(node);
        if is_optional_chain_root(a, a.parent(node)) {
            return self.get_non_nullable_type(this_argument_type);
        }
        if is_optional_chain(a, a.parent(node)) {
            return self.remove_optional_type_marker(this_argument_type);
        }
        this_argument_type
    }

    pub fn get_effective_check_node(&self, argument: NodeId) -> NodeId {
        let a = self.ast;
        let flags = if_else(
            is_in_js_file(a, argument),
            OuterExpressionKinds::PARENTHESES
                | OuterExpressionKinds::SATISFIES
                | OuterExpressionKinds::EXCLUDE_JSDOC_TYPE_ASSERTION,
            OuterExpressionKinds::PARENTHESES | OuterExpressionKinds::SATISFIES,
        );
        skip_outer_expressions(a, argument, flags)
    }

    pub fn infer_type_arguments(
        &mut self,
        node: NodeId,
        signature: SignatureId,
        args: List<'_, NodeId>,
        check_mode: CheckMode,
        context: InferenceContextId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        if is_jsx_opening_like_element(a, node) {
            return self.infer_jsx_type_arguments(node, signature, check_mode, context);
        }
        // If a contextual type is available, infer from that type to the return type of the call expression. For example, given a 'function wrap<T, U>(cb: (x: T) => U): (x: T) => U' and a call expression 'let f: (x: string) => number = wrap(s => s.length)', we infer from the declared type of 'f' to the return type of 'wrap'.
        if !is_decorator(a, node) && !is_binary_expression(a, node) {
            let type_parameters = self.signatures[signature].type_parameters;
            let skip_binding_patterns = type_parameters
                .iter()
                .all(|p| !self.get_default_from_type_parameter(p).is_nil());
            let contextual_type = self.get_contextual_type(
                node,
                if_else(
                    skip_binding_patterns,
                    ContextFlags::SKIP_BINDING_PATTERNS,
                    ContextFlags::NONE,
                ),
            );
            if !contextual_type.is_nil() {
                let inference_target_type = self.get_return_type_of_signature(signature);
                if self.could_contain_type_variables(inference_target_type) {
                    let outer_context = self.get_inference_context(node);
                    let is_from_binding_pattern = !skip_binding_patterns
                        && self.get_contextual_type(node, ContextFlags::SKIP_BINDING_PATTERNS)
                            != contextual_type;
                    // A return type inference from a binding pattern can be used in instantiating the contextual type of an argument later in inference, but cannot stand on its own as the final return type. It is incorporated into `context.returnMapper` which is used in `instantiateContextualType`, but doesn't need to go into `context.inferences`. This allows a an array binding pattern to produce a tuple for `T` in `declare function f<T>(cb: () => T): T; const [e1, e2, e3] = f(() => [1, "hi", true]);` but does not produce any inference for `T` in `declare function f<T>(): T; const [e1, e2, e3] = f();`
                    if !is_from_binding_pattern {
                        // We clone the inference context to avoid disturbing a resolution in progress for an outer call expression. Effectively we just want a snapshot of whatever has been inferred for any outer call expression so far.
                        let cloned_context =
                            self.clone_inference_context(outer_context, InferenceFlags::NO_DEFAULT);
                        let outer_mapper = self.get_mapper_from_context(cloned_context);
                        let instantiated_type =
                            self.instantiate_type(contextual_type, outer_mapper);
                        // If the contextual type is a generic function type with a single call signature, we instantiate the type with its own type parameters and type arguments. This ensures that the type parameters are not erased to type any during type inference such that they can be inferred as actual types from the contextual type. For example: `declare function arrayMap<T, U>(f: (x: T) => U): (a: T[]) => U[]; const boxElements: <A>(a: A[]) => { value: A }[] = arrayMap(value => ({ value }));` Above, the type of the 'value' parameter is inferred to be 'A'.
                        let contextual_signature =
                            self.get_single_call_signature(instantiated_type);
                        let inference_source_type = if !contextual_signature.is_nil()
                            && self.signatures[contextual_signature].type_parameters.len() != 0
                        {
                            let contextual_type_parameters =
                                self.signatures[contextual_signature].type_parameters;
                            let instantiation = self
                                .get_signature_instantiation_without_filling_in_type_arguments(
                                    contextual_signature,
                                    contextual_type_parameters,
                                );
                            self.get_or_create_type_from_signature(instantiation)
                        } else {
                            instantiated_type
                        };
                        // Inferences made from return types have lower priority than all other inferences.
                        let inferences = self.inference_contexts[context].inferences;
                        self.infer_types(
                            inferences,
                            inference_source_type,
                            inference_target_type,
                            InferencePriority::RETURN_TYPE,
                            false,
                        );
                    }
                    // Create a type mapper for instantiating generic contextual types using the inferences made from the return type. We need a separate inference pass here because (a) instantiation of the source type uses the outer context's return mapper (which excludes inferences made from outer arguments), and (b) we don't want any further inferences going into this context. We use `createOuterReturnMapper` to ensure that all occurrences of outer type parameters are replaced with inferences produced from the outer return type or preceding outer arguments. This protects against circular inferences, i.e. avoiding situations where inferences reference type parameters for which the inferences are being made.
                    let context_flags = self.inference_contexts[context].flags;
                    let return_context = self.new_inference_context(
                        type_parameters,
                        signature,
                        context_flags,
                        TypeComparer::Nil,
                    );
                    let mut outer_return_mapper = TypeMapperId::NIL;
                    if !outer_context.is_nil() {
                        outer_return_mapper = self.create_outer_return_mapper(outer_context);
                    }
                    let return_source_type =
                        self.instantiate_type(contextual_type, outer_return_mapper);
                    let return_inferences = self.inference_contexts[return_context].inferences;
                    self.infer_types(
                        return_inferences,
                        return_source_type,
                        inference_target_type,
                        InferencePriority::NONE,
                        false,
                    );
                    if self.inference_contexts[return_context]
                        .inferences
                        .iter()
                        .any(|info| has_inference_candidates(self, info))
                    {
                        let inferred_part = self.clone_inferred_part_of_context(return_context);
                        let return_mapper = self.get_mapper_from_context(inferred_part);
                        self.inference_contexts[context].return_mapper = return_mapper;
                    } else {
                        self.inference_contexts[context].return_mapper = TypeMapperId::NIL;
                    }
                }
            }
        }
        let rest_type = self.get_non_array_rest_type(signature);
        let mut arg_count = args.len();
        if !rest_type.is_nil() {
            arg_count = (self.get_parameter_count(signature) - 1).min(arg_count);
        }
        if !rest_type.is_nil()
            && self.types[rest_type]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER)
        {
            let inferences = self.inference_contexts[context].inferences;
            let info = inferences
                .iter()
                .find(|&info| self.inference_infos[info].type_parameter == rest_type);
            if let Some(info) = info {
                if find_index(args.sub(arg_count, args.len()).as_slice(), |arg| {
                    is_spread_argument(a, arg)
                }) < 0
                {
                    self.inference_infos[info].implied_arity = args.len() - arg_count;
                }
            }
        }
        let this_type = self.get_this_type_of_signature(signature);
        if !this_type.is_nil() && self.could_contain_type_variables(this_type) {
            let this_argument_node = self.get_this_argument_of_call(node);
            let inferences = self.inference_contexts[context].inferences;
            let this_argument_type = self.get_this_argument_type(this_argument_node);
            self.infer_types(
                inferences,
                this_argument_type,
                this_type,
                InferencePriority::NONE,
                false,
            );
        }
        for i in 0..arg_count {
            let arg = args.at(i);
            if a.kind(arg) != Kind::OmittedExpression {
                let param_type = self.get_type_at_position(signature, i);
                if self.could_contain_type_variables(param_type) {
                    let arg_type = self.check_expression_with_contextual_type(
                        arg, param_type, context, check_mode,
                    );
                    let inferences = self.inference_contexts[context].inferences;
                    self.infer_types(
                        inferences,
                        arg_type,
                        param_type,
                        InferencePriority::NONE,
                        false,
                    );
                }
            }
        }
        if !rest_type.is_nil() && self.could_contain_type_variables(rest_type) {
            let spread_type = self.get_spread_argument_type(
                args,
                arg_count,
                args.len(),
                rest_type,
                context,
                check_mode,
            );
            let inferences = self.inference_contexts[context].inferences;
            self.infer_types(
                inferences,
                spread_type,
                rest_type,
                InferencePriority::NONE,
                false,
            );
        }
        self.get_inferred_types(context)
    }

    // No signature was applicable. We have already reported the errors for the invalid signature.
    pub fn get_candidate_for_overload_failure(
        &mut self,
        node: NodeId,
        candidates: &mut [SignatureId],
        args: List<'_, NodeId>,
        has_candidates_out_array: bool,
        check_mode: CheckMode,
    ) -> SignatureId {
        // Else should not have called this.
        self.check_node_deferred(node);
        // Normally we will combine overloads. Skip this if they have type parameters since that's hard to combine. Don't do this if there is a `candidatesOutArray`, because then we want the chosen best candidate to be one of the overloads, not a combination.
        if has_candidates_out_array
            || candidates.len() == 1
            || candidates
                .iter()
                .any(|&s| self.signatures[s].type_parameters.len() != 0)
        {
            return self.pick_longest_candidate_signature(node, candidates, args, check_mode);
        }
        self.create_union_of_signatures_for_overload_failure(List::from_slice(candidates))
    }

    pub fn pick_longest_candidate_signature(
        &mut self,
        node: NodeId,
        candidates: &mut [SignatureId],
        args: List<'_, NodeId>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        // Pick the longest signature. This way we can get a contextual type for cases like: `declare function f(a: { xa: number; xb: number; }, b: number); f({ |`. Also, use explicitly-supplied type arguments if they are provided, so we can get a contextual signature in cases like: `declare function f<T>(k: keyof T); f<Foo>("`.
        let mut arg_count = args.len();
        if let Some(apparent_argument_count) = self.apparent_argument_count {
            arg_count = apparent_argument_count;
        }
        let best_index = self.get_longest_candidate_index(List::from_slice(candidates), arg_count);
        let Some(&candidate) = usize::try_from(best_index)
            .ok()
            .and_then(|i| candidates.get(i))
        else {
            // Upstream indexes the candidates with -1 when there is none.
            return self.fail("index out of range [-1]");
        };
        let type_parameters = self.signatures[candidate].type_parameters;
        if type_parameters.len() == 0 {
            return candidate;
        }
        let mut type_argument_nodes = List::NIL;
        if self.call_like_expression_may_have_type_arguments(node) {
            type_argument_nodes = a.type_arguments(node);
        }
        let instantiated = if type_argument_nodes.len() != 0 {
            let type_arguments =
                self.get_type_arguments_from_nodes(type_argument_nodes, type_parameters);
            self.create_signature_instantiation(candidate, type_arguments)
        } else {
            self.infer_signature_instantiation_for_overload_failure(
                node,
                type_parameters,
                candidate,
                args,
                check_mode,
            )
        };
        if let Some(slot) = usize::try_from(best_index)
            .ok()
            .and_then(|i| candidates.get_mut(i))
        {
            *slot = instantiated;
        }
        instantiated
    }

    pub fn get_longest_candidate_index(
        &mut self,
        candidates: List<'_, SignatureId>,
        args_count: isize,
    ) -> isize {
        let mut max_params_index: isize = -1;
        let mut max_params: isize = -1;
        for (i, &candidate) in candidates.as_slice().iter().enumerate() {
            let param_count = self.get_parameter_count(candidate);
            if self.has_effective_rest_parameter(candidate) || param_count >= args_count {
                return i as isize;
            }
            if param_count > max_params {
                max_params = param_count;
                max_params_index = i as isize;
            }
        }
        max_params_index
    }

    pub fn get_type_arguments_from_nodes(
        &mut self,
        type_argument_nodes: List<'_, NodeId>,
        type_parameters: List<'_, TypeId>,
    ) -> List<'a, TypeId> {
        let mut type_argument_nodes = type_argument_nodes;
        if type_argument_nodes.len() > type_parameters.len() {
            type_argument_nodes = type_argument_nodes.sub(0usize, type_parameters.len());
        }
        let mut type_arguments: Vec<TypeId> = Vec::with_capacity(type_parameters.as_slice().len());
        for &node in type_argument_nodes.as_slice() {
            let t = self.get_type_from_type_node(node);
            type_arguments.push(t);
        }
        while (type_arguments.len() as isize) < type_parameters.len() {
            let type_parameter = type_parameters.at(type_arguments.len());
            let mut t = self.get_default_from_type_parameter(type_parameter);
            if t.is_nil() {
                t = self.get_constraint_of_type_parameter(type_parameter);
                if t.is_nil() {
                    t = self.unknown_type;
                }
            }
            type_arguments.push(t);
        }
        // core.Map gives nil for nil, and an append makes the list.
        if type_argument_nodes.is_nil() {
            return self.list(&type_arguments);
        }
        self.list_of(&type_arguments)
    }

    pub fn infer_signature_instantiation_for_overload_failure(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
        candidate: SignatureId,
        args: List<'_, NodeId>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let inference_context = self.new_inference_context(
            type_parameters,
            candidate,
            if_else(
                is_in_js_file(self.ast, node),
                InferenceFlags::ANY_DEFAULT,
                InferenceFlags::NONE,
            ),
            TypeComparer::Nil,
        );
        let type_argument_types = self.infer_type_arguments(
            node,
            candidate,
            args,
            check_mode | CheckMode::SKIP_CONTEXT_SENSITIVE | CheckMode::SKIP_GENERIC_FUNCTIONS,
            inference_context,
        );
        self.create_signature_instantiation(candidate, type_argument_types)
    }

    pub fn create_union_of_signatures_for_overload_failure(
        &mut self,
        candidates: List<'_, SignatureId>,
    ) -> SignatureId {
        let this_parameters =
            map_non_nil(candidates.as_slice(), |s| self.signatures[s].this_parameter);
        let mut this_parameter = SymbolId::NIL;
        if !this_parameters.is_empty() {
            let this_parameter_types = map(&this_parameters, |p| self.get_type_of_parameter(p));
            this_parameter = self.create_combined_symbol_from_types(
                List::from_slice(&this_parameters),
                List::from_slice(&this_parameter_types),
            );
        }
        let (min_argument_count, max_non_rest_param) = min_and_max(candidates.as_slice(), |s| {
            get_non_rest_parameter_count(self, s)
        });
        let mut parameters: Vec<SymbolId> =
            Vec::with_capacity(usize::try_from(max_non_rest_param).unwrap_or(0));
        for i in 0..max_non_rest_param {
            let symbols = map_non_nil(candidates.as_slice(), |s| {
                let signature_parameters = self.signatures[s].parameters;
                if signature_has_rest_parameter(self, s) {
                    if i < signature_parameters.len() - 1 {
                        return signature_parameters.at(i);
                    }
                    return last_or_nil(signature_parameters.as_slice());
                }
                if i < signature_parameters.len() {
                    return signature_parameters.at(i);
                }
                SymbolId::NIL
            });
            let types = map_non_nil(candidates.as_slice(), |s| {
                self.try_get_type_at_position(s, i)
            });
            let parameter = self.create_combined_symbol_from_types(
                List::from_slice(&symbols),
                List::from_slice(&types),
            );
            parameters.push(parameter);
        }
        let rest_parameter_symbols = map_non_nil(candidates.as_slice(), |s| {
            if signature_has_rest_parameter(self, s) {
                return last_or_nil(self.signatures[s].parameters.as_slice());
            }
            SymbolId::NIL
        });
        let mut flags = SignatureFlags::IS_SIGNATURE_CANDIDATE_FOR_OVERLOAD_FAILURE;
        if !rest_parameter_symbols.is_empty() {
            let rest_types = map_non_nil(candidates.as_slice(), |s| {
                self.try_get_rest_type_of_signature(s)
            });
            let union_type = self.get_union_type_ex(
                List::from_slice(&rest_types),
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
            let t = self.create_array_type(union_type);
            let rest_parameter = self.create_combined_symbol_for_overload_failure(
                List::from_slice(&rest_parameter_symbols),
                t,
            );
            parameters.push(rest_parameter);
            flags |= SignatureFlags::HAS_REST_PARAMETER;
        }
        if candidates
            .iter()
            .any(|s| signature_has_literal_types(self, s))
        {
            flags |= SignatureFlags::HAS_LITERAL_TYPES;
        }
        let declaration = self.signatures[candidates.at(0usize)].declaration;
        let return_types = map(candidates.as_slice(), |s| {
            self.get_return_type_of_signature(s)
        });
        let return_type = self.get_intersection_type(List::from_slice(&return_types));
        let parameters = self.list_of(&parameters);
        self.new_signature(
            flags,
            declaration,
            List::NIL,
            this_parameter,
            parameters,
            return_type,
            TypePredicateId::NIL,
            min_argument_count,
        )
    }

    pub fn create_combined_symbol_from_types(
        &mut self,
        sources: List<'_, SymbolId>,
        types: List<'_, TypeId>,
    ) -> SymbolId {
        let t = self.get_union_type_ex(
            types,
            UnionReduction::SUBTYPE,
            TypeAliasId::NIL,
            TypeId::NIL,
        );
        self.create_combined_symbol_for_overload_failure(sources, t)
    }

    pub fn create_combined_symbol_for_overload_failure(
        &mut self,
        sources: List<'_, SymbolId>,
        t: TypeId,
    ) -> SymbolId {
        // This function is currently only used for erroneous overloads, so it's good enough to just use the first source.
        self.create_symbol_with_type(first_or_nil(sources.as_slice()), t)
    }

    pub fn get_rest_type_of_signature(&mut self, signature: SignatureId) -> TypeId {
        let rest_type = self.try_get_rest_type_of_signature(signature);
        if !rest_type.is_nil() {
            return rest_type;
        }
        self.any_type
    }

    pub fn try_get_rest_type_of_signature(&mut self, signature: SignatureId) -> TypeId {
        if !signature_has_rest_parameter(self, signature) {
            return TypeId::NIL;
        }
        let parameters = self.signatures[signature].parameters;
        let mut rest_type = self.get_type_of_symbol(parameters.at(parameters.len() - 1));
        if is_tuple_type(self, rest_type) {
            rest_type = self.get_rest_type_of_tuple_type(rest_type);
            if rest_type.is_nil() {
                return TypeId::NIL;
            }
        }
        let number_type = self.number_type;
        self.get_index_type_of_type(rest_type, number_type)
    }

    pub fn report_call_resolution_errors(
        &mut self,
        node: NodeId,
        s: &CallState<'a>,
        signatures: List<'_, SignatureId>,
        head_message: MessageId,
    ) {
        let a = self.ast;
        if let Some(&last) = s.candidates_for_argument_error.last() {
            let mut diags: Vec<DiagnosticId> = Vec::new();
            self.is_signature_applicable(
                s.node,
                List::from_slice(&s.args),
                last,
                RelationKind::Assignable,
                CheckMode::NORMAL,
                true,
                Some(&mut diags),
            );
            for &diagnostic in &diags {
                let mut diagnostic = diagnostic;
                if s.candidates_for_argument_error.len() > 1 {
                    diagnostic = self.diagnostic_store.new_diagnostic_chain(
                        diagnostic,
                        diagnostics::THE_LAST_OVERLOAD_GAVE_THE_FOLLOWING_ERROR,
                        &[],
                    );
                    diagnostic = self.diagnostic_store.new_diagnostic_chain(
                        diagnostic,
                        diagnostics::NO_OVERLOAD_MATCHES_THIS_CALL,
                        &[],
                    );
                }
                if !head_message.is_nil() {
                    diagnostic =
                        self.diagnostic_store
                            .new_diagnostic_chain(diagnostic, head_message, &[]);
                }
                let declaration = self.signatures[last].declaration;
                if !declaration.is_nil() && s.candidates_for_argument_error.len() > 1 {
                    let related = self.new_diagnostic_for_node(
                        declaration,
                        diagnostics::THE_LAST_OVERLOAD_IS_DECLARED_HERE,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
                self.add_implementation_success_elaboration(s, last, diagnostic);
                self.add_diagnostic(diagnostic);
            }
        } else if !s.candidate_for_argument_arity_error.is_nil() {
            let diagnostic = self.get_argument_arity_error(
                s.node,
                List::from_slice(&[s.candidate_for_argument_arity_error]),
                List::from_slice(&s.args),
                head_message,
            );
            self.add_diagnostic(diagnostic);
        } else if !s.candidate_for_type_argument_error.is_nil() {
            self.check_type_arguments(
                s.candidate_for_type_argument_error,
                a.type_arguments(s.node),
                true,
                head_message,
            );
        } else if !is_jsx_opening_fragment(a, node) {
            let signatures_with_correct_type_argument_arity =
                filter(signatures.as_slice(), |sig| {
                    self.has_correct_type_argument_arity(sig, s.type_arguments)
                });
            if signatures_with_correct_type_argument_arity.is_empty() {
                let diagnostic = self.get_type_argument_arity_error(
                    s.node,
                    signatures,
                    s.type_arguments,
                    head_message,
                );
                self.add_diagnostic(diagnostic);
            } else {
                let diagnostic = self.get_argument_arity_error(
                    s.node,
                    List::from_slice(&signatures_with_correct_type_argument_arity),
                    List::from_slice(&s.args),
                    head_message,
                );
                self.add_diagnostic(diagnostic);
            }
        }
    }

    pub fn add_implementation_success_elaboration(
        &mut self,
        s: &CallState<'a>,
        failed: SignatureId,
        diagnostic: DiagnosticId,
    ) {
        let a = self.ast;
        let declaration = self.signatures[failed].declaration;
        if !declaration.is_nil() && !a.symbol(declaration).is_nil() {
            let declarations = a.sym(a.symbol(declaration)).declarations;
            if declarations.len() > 1 {
                let implementation = find(declarations.as_slice(), |d| {
                    is_function_like_declaration(a, d) && node_is_present(a, a.body(d))
                });
                if !implementation.is_nil() {
                    let candidate = self.get_signature_from_declaration(implementation);
                    // `localState := *s` with the candidates and the flag of the implementation. chooseOverload resets the three candidates for an error before it reads them.
                    let mut local_state = CallState {
                        node: s.node,
                        type_arguments: s.type_arguments,
                        args: s.args.clone(),
                        candidates: vec![candidate],
                        arg_check_mode: s.arg_check_mode,
                        is_single_non_generic_candidate: self.signatures[candidate]
                            .type_parameters
                            .len()
                            == 0,
                        signature_help_trailing_comma: s.signature_help_trailing_comma,
                        candidates_for_argument_error: Vec::new(),
                        candidate_for_argument_arity_error: s.candidate_for_argument_arity_error,
                        candidate_for_type_argument_error: s.candidate_for_type_argument_error,
                    };
                    if !self
                        .choose_overload(&mut local_state, RelationKind::Assignable)
                        .is_nil()
                    {
                        let related = self.new_diagnostic_for_node(
                            implementation,
                            diagnostics::THE_CALL_WOULD_HAVE_SUCCEEDED_AGAINST_THIS_IMPLEMENTATION_BUT_IMPLEMENTATION_SIGNATURES_OF_OVERLOADS_ARE_NOT_EXTERNALLY_VISIBLE,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(diagnostic, related);
                    }
                }
            }
        }
    }

    pub fn get_argument_arity_error(
        &mut self,
        node: NodeId,
        signatures: List<'_, SignatureId>,
        args: List<'_, NodeId>,
        head_message: MessageId,
    ) -> DiagnosticId {
        let a = self.ast;
        let spread_index = self.get_spread_argument_index(args);
        if spread_index > -1 {
            return self.new_diagnostic_for_node(
                args.at(spread_index),
                diagnostics::A_SPREAD_ARGUMENT_MUST_EITHER_HAVE_A_TUPLE_TYPE_OR_BE_PASSED_TO_A_REST_PARAMETER,
                &[],
            );
        }
        let mut min_count = isize::MAX; // smallest parameter count
        let mut max_count = isize::MIN; // largest parameter count
        let mut max_below = isize::MIN; // largest parameter count that is smaller than the number of arguments
        let mut min_above = isize::MAX; // smallest parameter count that is larger than the number of arguments
        let mut closest_signature = SignatureId::NIL;
        for &sig in signatures.as_slice() {
            let min_parameter = self.get_min_argument_count(sig);
            let max_parameter = self.get_parameter_count(sig);
            // smallest/largest parameter counts
            if min_parameter < min_count {
                min_count = min_parameter;
                closest_signature = sig;
            }
            max_count = max_count.max(max_parameter);
            // shortest parameter count *longer than the call*/longest parameter count *shorter than the call*
            if min_parameter < args.len() && min_parameter > max_below {
                max_below = min_parameter;
            }
            if args.len() < max_parameter && max_parameter < min_above {
                min_above = max_parameter;
            }
        }
        let has_rest_parameter = signatures
            .iter()
            .any(|sig| self.has_effective_rest_parameter(sig));
        let parameter_range = if has_rest_parameter {
            itoa(min_count)
        } else if min_count < max_count {
            [
                itoa(min_count).as_slice(),
                b"-".as_slice(),
                itoa(max_count).as_slice(),
            ]
            .concat()
        } else {
            itoa(min_count)
        };
        let is_void_promise_error = !has_rest_parameter
            && parameter_range == b"1"
            && args.len() == 0
            && self.is_promise_resolve_arity_error(node);
        let error_node = get_error_node_for_call_node(a, node);
        if is_void_promise_error && is_in_js_file(a, node) {
            return self.new_diagnostic_for_node(
                error_node,
                diagnostics::EXPECTED_1_ARGUMENT_BUT_GOT_0_NEW_PROMISE_NEEDS_A_JSDOC_HINT_TO_PRODUCE_A_RESOLVE_THAT_CAN_BE_CALLED_WITHOUT_ARGUMENTS,
                &[],
            );
        }
        let message = if is_decorator(a, node) {
            if has_rest_parameter {
                diagnostics::THE_RUNTIME_WILL_INVOKE_THE_DECORATOR_WITH_1_ARGUMENTS_BUT_THE_DECORATOR_EXPECTS_AT_LEAST_0
            } else {
                diagnostics::THE_RUNTIME_WILL_INVOKE_THE_DECORATOR_WITH_1_ARGUMENTS_BUT_THE_DECORATOR_EXPECTS_0
            }
        } else if has_rest_parameter {
            diagnostics::EXPECTED_AT_LEAST_0_ARGUMENTS_BUT_GOT_1
        } else if is_void_promise_error {
            diagnostics::EXPECTED_0_ARGUMENTS_BUT_GOT_1_DID_YOU_FORGET_TO_INCLUDE_VOID_IN_YOUR_TYPE_ARGUMENT_TO_PROMISE
        } else {
            diagnostics::EXPECTED_0_ARGUMENTS_BUT_GOT_1
        };
        if min_count < args.len() && args.len() < max_count {
            // between min and max, but with no matching overload
            let mut diagnostic = self.new_diagnostic_for_node(
                error_node,
                diagnostics::NO_OVERLOAD_EXPECTS_0_ARGUMENTS_BUT_OVERLOADS_DO_EXIST_THAT_EXPECT_EITHER_1_OR_2_ARGUMENTS,
                &[
                    Arg::Int(args.len() as i64),
                    Arg::Int(max_below as i64),
                    Arg::Int(min_above as i64),
                ],
            );
            if !head_message.is_nil() {
                diagnostic =
                    self.diagnostic_store
                        .new_diagnostic_chain(diagnostic, head_message, &[]);
            }
            return diagnostic;
        }
        if args.len() < min_count {
            // too short: put the error span on the call expression, not any of the args
            let mut diagnostic = self.new_diagnostic_for_node(
                error_node,
                message,
                &[Arg::Str(&parameter_range), Arg::Int(args.len() as i64)],
            );
            if !head_message.is_nil() {
                diagnostic =
                    self.diagnostic_store
                        .new_diagnostic_chain(diagnostic, head_message, &[]);
            }
            let mut parameter = NodeId::NIL;
            if !closest_signature.is_nil()
                && !self.signatures[closest_signature].declaration.is_nil()
            {
                let declaration = self.signatures[closest_signature].declaration;
                let has_this_parameter =
                    !self.signatures[closest_signature].this_parameter.is_nil();
                parameter = element_or_nil(
                    a.parameters(declaration).as_slice(),
                    args.len() + if_else(has_this_parameter, 1, 0),
                );
            }
            if !parameter.is_nil() {
                let related = if is_binding_pattern(a, a.name(parameter)) {
                    self.new_diagnostic_for_node(
                        parameter,
                        diagnostics::AN_ARGUMENT_MATCHING_THIS_BINDING_PATTERN_WAS_NOT_PROVIDED,
                        &[],
                    )
                } else if is_rest_parameter(a, parameter) {
                    self.new_diagnostic_for_node(
                        parameter,
                        diagnostics::ARGUMENTS_FOR_THE_REST_PARAMETER_0_WERE_NOT_PROVIDED,
                        &[Arg::Str(a.text(a.name(parameter)))],
                    )
                } else {
                    self.new_diagnostic_for_node(
                        parameter,
                        diagnostics::AN_ARGUMENT_FOR_0_WAS_NOT_PROVIDED,
                        &[Arg::Str(a.text(a.name(parameter)))],
                    )
                };
                self.diagnostic_store.add_related_info(diagnostic, related);
            }
            return diagnostic;
        }
        // Guard against out-of-bounds access when maxCount >= len(args). This can happen when we reach this fallback error path but the argument count actually matches the parameter count (e.g., due to trailing commas causing signature resolution to fail for other reasons).
        if max_count >= args.len() {
            let mut diagnostic = self.new_diagnostic_for_node(
                error_node,
                message,
                &[Arg::Str(&parameter_range), Arg::Int(args.len() as i64)],
            );
            if !head_message.is_nil() {
                diagnostic =
                    self.diagnostic_store
                        .new_diagnostic_chain(diagnostic, head_message, &[]);
            }
            return diagnostic;
        }
        let source_file = get_source_file_of_node(a, node);
        let Some(&first_excess_argument) = usize::try_from(max_count)
            .ok()
            .and_then(|i| args.as_slice().get(i))
        else {
            // Upstream indexes the arguments with the largest parameter count of no signature: the span is the one of the call.
            let _: () = self.fail("index out of range in getArgumentArityError");
            let mut diagnostic = self.new_diagnostic_for_node(
                error_node,
                message,
                &[Arg::Str(&parameter_range), Arg::Int(args.len() as i64)],
            );
            if !head_message.is_nil() {
                diagnostic =
                    self.diagnostic_store
                        .new_diagnostic_chain(diagnostic, head_message, &[]);
            }
            return diagnostic;
        };
        let mut pos = a.pos(first_excess_argument);
        let mut end = a.end(args.at(args.len() - 1));
        if end == pos {
            end += 1;
        }
        pos = skip_trivia(a.as_source_file(source_file).text(), pos);
        if end < pos {
            end = pos;
        }
        let mut diagnostic = self.diagnostic_store.new_diagnostic(
            source_file,
            new_text_range(pos, end),
            message,
            &[Arg::Str(&parameter_range), Arg::Int(args.len() as i64)],
        );
        if !head_message.is_nil() {
            diagnostic = self
                .diagnostic_store
                .new_diagnostic_chain(diagnostic, head_message, &[]);
        }
        diagnostic
    }

    pub fn is_promise_resolve_arity_error(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_call_expression(a, node) || !is_identifier(a, a.expression(node)) {
            return false;
        }
        let symbol = self.resolve_name(
            a.expression(node),
            a.text(a.expression(node)),
            SymbolFlags::VALUE,
            MessageId::NIL,
            false,
            false,
        );
        if symbol.is_nil() {
            return false;
        }
        let decl = a.sym(symbol).value_declaration;
        if decl.is_nil()
            || !is_parameter_declaration(a, decl)
            || !is_function_expression_or_arrow_function(a, a.parent(decl))
            || !is_new_expression(a, a.parent(a.parent(decl)))
            || !is_identifier(a, a.expression(a.parent(a.parent(decl))))
        {
            return false;
        }
        let global_promise_symbol = self.get_global_promise_constructor_symbol_or_nil();
        if global_promise_symbol.is_nil() {
            return false;
        }
        let constructor_symbol = self.get_resolved_symbol(a.expression(a.parent(a.parent(decl))));
        constructor_symbol == global_promise_symbol
    }
}

pub fn get_error_node_for_call_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    if is_call_expression(a, node) {
        node = a.expression(node);
        if is_property_access_expression(a, node) {
            node = a.name(node);
        }
    }
    node
}

impl<'a> Checker<'a> {
    pub fn get_type_argument_arity_error(
        &mut self,
        node: NodeId,
        signatures: List<'_, SignatureId>,
        type_arguments: List<'_, NodeId>,
        head_message: MessageId,
    ) -> DiagnosticId {
        let a = self.ast;
        let arg_count = type_arguments.len();
        let source_file = get_source_file_of_node(a, node);
        let type_argument_list = a.type_argument_list(node);
        let list_loc = a.list_loc(type_argument_list);
        let loc = new_text_range(
            skip_trivia(a.as_source_file(source_file).text(), list_loc.pos()),
            list_loc.end(),
        );
        let mut diagnostic = if signatures.len() == 1 {
            // No overloads exist
            let sig = signatures.at(0usize);
            let type_parameters = self.signatures[sig].type_parameters;
            let min_count = self.get_min_type_argument_count(type_parameters);
            let max_count = type_parameters.len();
            let mut expected = itoa(min_count);
            if min_count < max_count {
                expected.push(b'-');
                expected.extend_from_slice(&itoa(max_count));
            }
            self.diagnostic_store.new_diagnostic(
                source_file,
                loc,
                diagnostics::EXPECTED_0_TYPE_ARGUMENTS_BUT_GOT_1,
                &[Arg::Str(&expected), Arg::Int(arg_count as i64)],
            )
        } else {
            // Overloads exist
            let mut below_arg_count = isize::MIN;
            let mut above_arg_count = isize::MAX;
            for &sig in signatures.as_slice() {
                let type_parameters = self.signatures[sig].type_parameters;
                let min_count = self.get_min_type_argument_count(type_parameters);
                let max_count = type_parameters.len();
                if min_count > arg_count {
                    above_arg_count = above_arg_count.min(min_count);
                } else if max_count < arg_count {
                    below_arg_count = below_arg_count.max(max_count);
                }
            }
            if below_arg_count != isize::MIN && above_arg_count != isize::MAX {
                self.diagnostic_store.new_diagnostic(
                    source_file,
                    loc,
                    diagnostics::NO_OVERLOAD_EXPECTS_0_TYPE_ARGUMENTS_BUT_OVERLOADS_DO_EXIST_THAT_EXPECT_EITHER_1_OR_2_TYPE_ARGUMENTS,
                    &[
                        Arg::Int(arg_count as i64),
                        Arg::Int(below_arg_count as i64),
                        Arg::Int(above_arg_count as i64),
                    ],
                )
            } else {
                self.diagnostic_store.new_diagnostic(
                    source_file,
                    loc,
                    diagnostics::EXPECTED_0_TYPE_ARGUMENTS_BUT_GOT_1,
                    &[
                        Arg::Int(if_else(
                            below_arg_count == isize::MIN,
                            above_arg_count,
                            below_arg_count,
                        ) as i64),
                        Arg::Int(arg_count as i64),
                    ],
                )
            }
        };
        if !head_message.is_nil() {
            diagnostic = self
                .diagnostic_store
                .new_diagnostic_chain(diagnostic, head_message, &[]);
        }
        diagnostic
    }

    pub fn report_cannot_invoke_possibly_null_or_undefined_error(
        &mut self,
        node: NodeId,
        facts: TypeFacts,
    ) {
        self.error(
            node,
            if_else(
                facts.intersects(TypeFacts::IS_UNDEFINED),
                if_else(
                    facts.intersects(TypeFacts::IS_NULL),
                    diagnostics::CANNOT_INVOKE_AN_OBJECT_WHICH_IS_POSSIBLY_NULL_OR_UNDEFINED,
                    diagnostics::CANNOT_INVOKE_AN_OBJECT_WHICH_IS_POSSIBLY_UNDEFINED,
                ),
                diagnostics::CANNOT_INVOKE_AN_OBJECT_WHICH_IS_POSSIBLY_NULL,
            ),
            &[],
        );
    }

    pub fn resolve_untyped_call(&mut self, node: NodeId) -> SignatureId {
        let a = self.ast;
        if self.call_like_expression_may_have_type_arguments(node) {
            // Check type arguments even though we will give an error that untyped calls may not accept type arguments. This gets us diagnostics for the type arguments and marks them as referenced.
            self.check_source_elements(a.type_arguments(node));
        }
        match a.kind(node) {
            Kind::TaggedTemplateExpression => {
                self.check_expression(a.as_tagged_template_expression(node).template);
            }
            Kind::JsxOpeningElement | Kind::JsxSelfClosingElement => {
                self.check_expression(a.attributes(node));
            }
            Kind::BinaryExpression => {
                self.check_expression(a.as_binary_expression(node).left);
            }
            Kind::CallExpression | Kind::NewExpression => {
                for &argument in a.arguments(node).as_slice() {
                    self.check_expression(argument);
                }
            }
            _ => {}
        }
        self.any_signature
    }

    pub fn resolve_error_call(&mut self, node: NodeId) -> SignatureId {
        self.resolve_untyped_call(node);
        self.unknown_signature
    }

    // TS 1.0 spec: 4.12 If FuncExpr is of type Any, or of an object type that has no call or construct signatures but is a subtype of the Function interface, the call is an untyped function call.
    pub fn is_untyped_function_call(
        &mut self,
        func_type: TypeId,
        apparent_func_type: TypeId,
        num_call_signatures: isize,
        num_construct_signatures: isize,
    ) -> bool {
        // We exclude union types because we may have a union of function types that happen to have no common signatures.
        if is_type_any(self, func_type)
            || is_type_any(self, apparent_func_type)
                && self.types[func_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
        {
            return true;
        }
        if num_call_signatures == 0
            && num_construct_signatures == 0
            && !self.types[apparent_func_type]
                .flags
                .intersects(TypeFlags::UNION)
        {
            let reduced_type = self.get_reduced_type(apparent_func_type);
            if !self.types[reduced_type].flags.intersects(TypeFlags::NEVER) {
                return self.is_type_assignable_to(func_type, self.global_function_type);
            }
        }
        false
    }

    pub fn invocation_error_details(
        &mut self,
        error_target: NodeId,
        apparent_type: TypeId,
        kind: SignatureKind,
    ) -> DiagnosticId {
        let a = self.ast;
        let mut diagnostic = DiagnosticId::NIL;
        let is_call = kind == SignatureKind::CALL;
        let awaited_type = self.get_awaited_type(apparent_type);
        let maybe_missing_await =
            !awaited_type.is_nil() && self.get_signatures_of_type(awaited_type, kind).len() > 0;
        let mut target = error_target;
        if is_property_access_expression(a, error_target)
            && is_call_expression(a, a.parent(error_target))
        {
            target = a.name(error_target);
        }
        if self.types[apparent_type].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(apparent_type);
            let mut has_signatures = false;
            for &constituent in types.as_slice() {
                let signatures = self.get_signatures_of_type(constituent, kind);
                if signatures.len() != 0 {
                    has_signatures = true;
                    if !diagnostic.is_nil() {
                        // Bail early if we already have an error, no chance of "No constituent of type is callable"
                        break;
                    }
                } else {
                    // Error on the first non callable constituent only
                    if diagnostic.is_nil() {
                        let constituent_text = self.type_to_string_exported(constituent);
                        diagnostic = self.new_diagnostic_for_node(
                            target,
                            if_else(
                                is_call,
                                diagnostics::TYPE_0_HAS_NO_CALL_SIGNATURES,
                                diagnostics::TYPE_0_HAS_NO_CONSTRUCT_SIGNATURES,
                            ),
                            &[Arg::Str(&constituent_text)],
                        );
                        let apparent_text = self.type_to_string_exported(apparent_type);
                        diagnostic = self.new_diagnostic_chain_for_node(
                            diagnostic,
                            target,
                            if_else(
                                is_call,
                                diagnostics::NOT_ALL_CONSTITUENTS_OF_TYPE_0_ARE_CALLABLE,
                                diagnostics::NOT_ALL_CONSTITUENTS_OF_TYPE_0_ARE_CONSTRUCTABLE,
                            ),
                            &[Arg::Str(&apparent_text)],
                        );
                    }
                    if has_signatures {
                        // Bail early if we already found a signature, no chance of "No constituent of type is callable"
                        break;
                    }
                }
            }
            if !has_signatures {
                let apparent_text = self.type_to_string_exported(apparent_type);
                diagnostic = self.new_diagnostic_for_node(
                    target,
                    if_else(
                        is_call,
                        diagnostics::NO_CONSTITUENT_OF_TYPE_0_IS_CALLABLE,
                        diagnostics::NO_CONSTITUENT_OF_TYPE_0_IS_CONSTRUCTABLE,
                    ),
                    &[Arg::Str(&apparent_text)],
                );
            }
            if diagnostic.is_nil() {
                let apparent_text = self.type_to_string_exported(apparent_type);
                diagnostic = self.new_diagnostic_for_node(
                    target,
                    if_else(
                        is_call,
                        diagnostics::EACH_MEMBER_OF_THE_UNION_TYPE_0_HAS_SIGNATURES_BUT_NONE_OF_THOSE_SIGNATURES_ARE_COMPATIBLE_WITH_EACH_OTHER,
                        diagnostics::EACH_MEMBER_OF_THE_UNION_TYPE_0_HAS_CONSTRUCT_SIGNATURES_BUT_NONE_OF_THOSE_SIGNATURES_ARE_COMPATIBLE_WITH_EACH_OTHER,
                    ),
                    &[Arg::Str(&apparent_text)],
                );
            }
        } else {
            let apparent_text = self.type_to_string_exported(apparent_type);
            diagnostic = self.new_diagnostic_chain_for_node(
                diagnostic,
                target,
                if_else(
                    is_call,
                    diagnostics::TYPE_0_HAS_NO_CALL_SIGNATURES,
                    diagnostics::TYPE_0_HAS_NO_CONSTRUCT_SIGNATURES,
                ),
                &[Arg::Str(&apparent_text)],
            );
        }
        let mut head_message = if_else(
            is_call,
            diagnostics::THIS_EXPRESSION_IS_NOT_CALLABLE,
            diagnostics::THIS_EXPRESSION_IS_NOT_CONSTRUCTABLE,
        );
        // Diagnose get accessors incorrectly called as functions
        if is_call_expression(a, a.parent(error_target))
            && a.arguments(a.parent(error_target)).len() == 0
        {
            let resolved_symbol = self.get_resolved_symbol_or_nil(error_target);
            if !resolved_symbol.is_nil()
                && a.sym(resolved_symbol)
                    .flags
                    .intersects(SymbolFlags::GET_ACCESSOR)
            {
                head_message = diagnostics::THIS_EXPRESSION_IS_NOT_CALLABLE_BECAUSE_IT_IS_A_GET_ACCESSOR_DID_YOU_MEAN_TO_USE_IT_WITHOUT;
            }
        }
        diagnostic = self.new_diagnostic_chain_for_node(diagnostic, target, head_message, &[]);
        if maybe_missing_await {
            let related = self.new_diagnostic_for_node(
                error_target,
                diagnostics::DID_YOU_FORGET_TO_USE_AWAIT,
                &[],
            );
            self.diagnostic_store.add_related_info(diagnostic, related);
        }
        diagnostic
    }

    pub fn invocation_error(
        &mut self,
        error_target: NodeId,
        apparent_type: TypeId,
        kind: SignatureKind,
        related_information: DiagnosticId,
    ) {
        let mut diagnostic = self.invocation_error_details(error_target, apparent_type, kind);
        if !related_information.is_nil() {
            self.diagnostic_store
                .add_related_info(diagnostic, related_information);
        }
        diagnostic = self.add_diagnostic(diagnostic);
        self.invocation_error_recovery(apparent_type, kind, diagnostic);
    }

    pub fn invocation_error_recovery(
        &mut self,
        apparent_type: TypeId,
        kind: SignatureKind,
        diagnostic: DiagnosticId,
    ) {
        let a = self.ast;
        let symbol = self.types[apparent_type].symbol;
        if symbol.is_nil() {
            return;
        }
        let links = self.export_type_links.get(symbol);
        let import_node = self.export_type_links[links].originating_import;
        // Create a diagnostic on the originating import if possible onto which we can attach a quickfix. An import call expression cannot be rewritten into another form to correct the error - the only solution is to use `.default` at the use-site
        if !import_node.is_nil() && !is_import_call(a, import_node) {
            let links = self.export_type_links.get(symbol);
            let target = self.export_type_links[links].target;
            let target_type = self.get_type_of_symbol(target);
            let sigs = self.get_signatures_of_type(target_type, kind);
            if sigs.len() == 0 {
                return;
            }
            let related = self.new_diagnostic_for_node(
                import_node,
                diagnostics::TYPE_ORIGINATES_AT_THIS_IMPORT_A_NAMESPACE_STYLE_IMPORT_CANNOT_BE_CALLED_OR_CONSTRUCTED_AND_WILL_CAUSE_A_FAILURE_AT_RUNTIME_CONSIDER_USING_A_DEFAULT_IMPORT_OR_IMPORT_REQUIRE_HERE_INSTEAD,
                &[],
            );
            self.diagnostic_store.add_related_info(diagnostic, related);
        }
    }

    pub fn is_generic_function_returning_function(&mut self, signature: SignatureId) -> bool {
        self.signatures[signature].type_parameters.len() != 0 && {
            let return_type = self.get_return_type_of_signature(signature);
            self.is_function_type(return_type)
        }
    }

    pub fn skipped_generic_function(&mut self, node: NodeId, check_mode: CheckMode) {
        if check_mode.intersects(CheckMode::INFERENTIAL) {
            // We have skipped a generic function during inferential typing. Obtain the inference context and indicate this has occurred such that we know a second pass of inference is be needed.
            let context = self.get_inference_context(node);
            self.inference_contexts[context].flags |= InferenceFlags::SKIPPED_GENERIC_FUNCTION;
        }
    }

    pub fn check_tagged_template_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if !self.check_grammar_tagged_template_chain(node) {
            self.check_grammar_type_arguments(node, a.type_argument_list(node));
        }
        let signature = self.get_resolved_signature(node, None, CheckMode::NORMAL);
        self.check_deprecated_signature(signature, node);
        self.get_return_type_of_signature(signature)
    }
}
