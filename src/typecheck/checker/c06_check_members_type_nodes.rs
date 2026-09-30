// checker.go:2662-3410 (layers D-FUNC, D-TYPENODE): parameters, properties, signatures, constructors, accessors and the checks of type nodes.
use crate::ast::{
    Arg, Ast, DiagnosticId, FunctionFlags, Kind, ModifierFlags, NodeFlags, NodeId,
    OuterExpressionKinds, SymbolId, find_ancestor, get_class_extends_heritage_element,
    get_containing_class, get_containing_function, get_declaration_of_kind, get_function_flags,
    get_source_file_of_node, has_accessor_modifier, has_static_modifier, has_syntactic_modifier,
    is_accessor, is_array_binding_pattern, is_arrow_function, is_binding_pattern, is_class_like,
    is_computed_property_name, is_construct_signature_declaration, is_constructor_declaration,
    is_constructor_type_node, is_expression_statement, is_function_like,
    is_get_accessor_declaration, is_identifier, is_index_signature_declaration,
    is_method_declaration, is_object_binding_pattern, is_parameter_property_declaration,
    is_private_identifier, is_private_identifier_class_element_declaration,
    is_property_declaration, is_property_signature_declaration, is_qualified_name, is_static,
    is_string_literal_like, is_type_declaration, is_type_reference_node, node_is_missing,
    node_is_present, skip_outer_expressions, skip_parentheses, walk_up_parenthesized_expressions,
};
use crate::checker::{
    Checker, ElementFlags, ExternalEmitHelpers, LANGUAGE_FEATURE_MINIMUM_TARGET, NodeCheckFlags,
    TypeId, TypeMapperId, TypePredicateKind, WideningKind, get_declarations_of_kind,
    has_dot_dot_dot_token, is_optional_declaration, is_super_call, is_tuple_type, new_type_mapper,
    signature_has_rest_parameter,
};
use crate::core::{
    List, Map, RESOLUTION_MODE_COMMON_JS, RESOLUTION_MODE_ESM, RESOLUTION_MODE_NONE,
    ResolutionMode, Text,
};
use crate::diagnostics::{self, MessageId};
use crate::internal::FaultKind;
use crate::scanner::{declaration_name_to_string, scan_token_at_position, skip_trivia};

impl<'a> Checker<'a> {
    pub fn check_parameter(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking: it is a SyntaxError if the Identifier "eval" or the Identifier "arguments" occurs as the Identifier in a PropertySetParameterList of a PropertyAssignment that is contained in strict code or if its FunctionBody is strict code(11.1.5).
        self.check_grammar_modifiers(node);
        self.check_variable_like_declaration(node);
        let func = get_containing_function(a, node);
        let mut param_name: &[u8] = b"";
        if !a.name(node).is_nil() && is_identifier(a, a.name(node)) {
            param_name = a.text(a.name(node));
        }
        if has_syntactic_modifier(a, node, ModifierFlags::PARAMETER_PROPERTY_MODIFIER) {
            if self.should_check_erasable_syntax(node) {
                self.error(
                    node,
                    diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                    &[],
                );
            }
            if !(is_constructor_declaration(a, func) && node_is_present(a, a.body(func))) {
                self.error(
                    node,
                    diagnostics::A_PARAMETER_PROPERTY_IS_ONLY_ALLOWED_IN_A_CONSTRUCTOR_IMPLEMENTATION,
                    &[],
                );
            }
            if is_constructor_declaration(a, func) && param_name == b"constructor" {
                self.error(
                    a.name(node),
                    diagnostics::X_CONSTRUCTOR_CANNOT_BE_USED_AS_A_PARAMETER_PROPERTY_NAME,
                    &[],
                );
            }
        }
        if a.initializer(node).is_nil()
            && is_optional_declaration(a, node)
            && is_binding_pattern(a, a.name(node))
            && !a.body(func).is_nil()
        {
            self.error(
                node,
                diagnostics::A_BINDING_PATTERN_PARAMETER_CANNOT_BE_OPTIONAL_IN_AN_IMPLEMENTATION_SIGNATURE,
                &[],
            );
        }
        if param_name == b"this" || param_name == b"new" {
            let index = a
                .parameters(func)
                .as_slice()
                .iter()
                .position(|&parameter| parameter == node);
            if index != Some(0) {
                self.error(
                    node,
                    diagnostics::A_0_PARAMETER_MUST_BE_THE_FIRST_PARAMETER,
                    &[Arg::Str(param_name)],
                );
            }
            if is_constructor_declaration(a, func)
                || is_construct_signature_declaration(a, func)
                || is_constructor_type_node(a, func)
            {
                self.error(
                    node,
                    diagnostics::A_CONSTRUCTOR_CANNOT_HAVE_A_THIS_PARAMETER,
                    &[],
                );
            }
            if is_arrow_function(a, func) {
                self.error(
                    node,
                    diagnostics::AN_ARROW_FUNCTION_CANNOT_HAVE_A_THIS_PARAMETER,
                    &[],
                );
            }
            if is_accessor(a, func) {
                self.error(
                    node,
                    diagnostics::X_GET_AND_SET_ACCESSORS_CANNOT_DECLARE_THIS_PARAMETERS,
                    &[],
                );
            }
        }
        // Only check rest parameter type if it's not a binding pattern. Since binding patterns are not allowed in a rest parameter, we already have an error from checkGrammarParameterList.
        if has_dot_dot_dot_token(a, node) && !is_binding_pattern(a, a.name(node)) {
            let parameter_type = self.get_type_of_symbol(a.symbol(node));
            let reduced_type = self.get_reduced_type(parameter_type);
            if !self.is_type_assignable_to(reduced_type, self.any_readonly_array_type) {
                self.error(
                    node,
                    diagnostics::A_REST_PARAMETER_MUST_BE_OF_AN_ARRAY_TYPE,
                    &[],
                );
            }
        }
    }

    pub fn check_property_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        if !self.check_grammar_modifiers(node) && !self.check_grammar_property(node) {
            self.check_grammar_computed_property_name(a.name(node));
        }
        self.check_variable_like_declaration(node);
        self.set_node_links_for_private_identifier_scope(node);
        // property signatures already report "initializer not allowed in ambient context" elsewhere
        if has_syntactic_modifier(a, node, ModifierFlags::ABSTRACT)
            && is_property_declaration(a, node)
        {
            if !a.initializer(node).is_nil() {
                let name = declaration_name_to_string(a, a.name(node));
                self.error(
                    node,
                    diagnostics::PROPERTY_0_CANNOT_HAVE_AN_INITIALIZER_BECAUSE_IT_IS_MARKED_ABSTRACT,
                    &[Arg::Str(&name)],
                );
            }
        }
    }

    pub fn check_property_signature(&mut self, node: NodeId) {
        let a = self.ast;
        if is_private_identifier(a, a.as_property_signature_declaration(node).name) {
            self.error(
                node,
                diagnostics::PRIVATE_IDENTIFIERS_ARE_NOT_ALLOWED_OUTSIDE_CLASS_BODIES,
                &[],
            );
        }
        self.check_property_declaration(node);
    }

    pub fn check_signature_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        match a.kind(node) {
            Kind::IndexSignature => {
                self.check_grammar_index_signature(node);
            }
            Kind::FunctionType
            | Kind::FunctionDeclaration
            | Kind::ConstructorType
            | Kind::CallSignature
            | Kind::Constructor
            | Kind::ConstructSignature => {
                self.check_grammar_function_like_declaration(node);
            }
            _ => {}
        }
        let function_flags = get_function_flags(a, node);
        if !function_flags.intersects(FunctionFlags::INVALID) {
            // Async generators prior to ES2018 require the __await and __asyncGenerator helpers
            if function_flags & FunctionFlags::ASYNC_GENERATOR == FunctionFlags::ASYNC_GENERATOR
                && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.async_generators
            {
                self.check_external_emit_helpers(
                    node,
                    ExternalEmitHelpers::ASYNC_GENERATOR_INCLUDES,
                );
            }
            if function_flags & FunctionFlags::ASYNC_GENERATOR == FunctionFlags::ASYNC
                && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.async_functions
            {
                self.check_external_emit_helpers(node, ExternalEmitHelpers::AWAITER);
            }
        }
        self.check_type_parameters(a.type_parameters(node));
        self.check_unmatched_jsdoc_parameters(node);
        self.check_source_elements(a.parameters(node));
        let return_type_node = a.type_node(node);
        if !return_type_node.is_nil() {
            self.check_source_element(return_type_node);
        }
        if self.no_implicit_any && return_type_node.is_nil() {
            match a.kind(node) {
                Kind::ConstructSignature => {
                    self.error(node, diagnostics::CONSTRUCT_SIGNATURE_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_ANY_RETURN_TYPE, &[]);
                }
                Kind::CallSignature => {
                    self.error(node, diagnostics::CALL_SIGNATURE_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_ANY_RETURN_TYPE, &[]);
                }
                _ => {}
            }
        }
        if !return_type_node.is_nil() {
            if function_flags & (FunctionFlags::INVALID | FunctionFlags::GENERATOR)
                == FunctionFlags::GENERATOR
            {
                let return_type = self.get_type_from_type_node(return_type_node);
                if return_type == self.void_type {
                    self.error(
                        return_type_node,
                        diagnostics::A_GENERATOR_CANNOT_HAVE_A_VOID_TYPE_ANNOTATION,
                        &[],
                    );
                } else {
                    self.check_generator_instantiation_assignability_to_return_type(
                        return_type,
                        function_flags,
                        return_type_node,
                    );
                }
            } else if function_flags & FunctionFlags::ASYNC_GENERATOR == FunctionFlags::ASYNC {
                self.check_async_function_return_type(node, return_type_node);
            }
        }
        if !is_index_signature_declaration(a, node) {
            self.register_for_unused_identifiers_check(node);
        }
    }

    // Checks the return type of an async function to ensure it is a compatible Promise implementation: the resolved value of the return type must have a construct signature that takes in an `initializer` function that in turn supplies a `resolve` function as one of its arguments and results in an object with a callable `then` signature.
    pub fn check_async_function_return_type(&mut self, node: NodeId, return_type_node: NodeId) {
        let return_type = self.get_type_from_type_node(return_type_node);
        if self.is_error_type(return_type) {
            return;
        }
        let global_promise_type = self.get_global_promise_type_checked();
        if global_promise_type != self.empty_generic_type
            && !self.is_reference_to_type(return_type, global_promise_type)
        {
            // The promise type was not a valid type reference to the global promise type, so we report an error and return the unknown type.
            let mut awaited_type = self.get_awaited_type_no_alias(return_type);
            if awaited_type.is_nil() {
                awaited_type = self.void_type;
            }
            let type_name = self.type_to_string_exported(awaited_type);
            self.error(return_type_node, diagnostics::THE_RETURN_TYPE_OF_AN_ASYNC_FUNCTION_OR_METHOD_MUST_BE_THE_GLOBAL_PROMISE_T_TYPE_DID_YOU_MEAN_TO_WRITE_PROMISE_0, &[Arg::Str(&type_name)]);
            return;
        }
        self.check_awaited_type(return_type, false, node, diagnostics::THE_RETURN_TYPE_OF_AN_ASYNC_FUNCTION_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER);
    }

    pub fn check_method_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        if !self.check_grammar_method(node) {
            self.check_grammar_computed_property_name(a.name(node));
            if is_method_declaration(a, node)
                && !a.as_method_declaration(node).asterisk_token.is_nil()
                && is_identifier(a, a.name(node))
                && a.text(a.name(node)) == b"constructor"
            {
                self.error(
                    a.name(node),
                    diagnostics::CLASS_CONSTRUCTOR_MAY_NOT_BE_A_GENERATOR,
                    &[],
                );
            }
        }
        // Grammar checking for modifiers is done inside the function checkGrammarFunctionLikeDeclaration
        self.check_function_or_method_declaration(node);
        // method signatures already report "implementation not allowed in ambient context" elsewhere
        if has_syntactic_modifier(a, node, ModifierFlags::ABSTRACT)
            && is_method_declaration(a, node)
            && !a.body(node).is_nil()
        {
            let name = declaration_name_to_string(a, a.name(node));
            self.error(
                node,
                diagnostics::METHOD_0_CANNOT_HAVE_AN_IMPLEMENTATION_BECAUSE_IT_IS_MARKED_ABSTRACT,
                &[Arg::Str(&name)],
            );
        }
        // Private named methods are only allowed in class declarations
        if is_private_identifier(a, a.name(node)) && get_containing_class(a, node).is_nil() {
            self.error(
                node,
                diagnostics::PRIVATE_IDENTIFIERS_ARE_NOT_ALLOWED_OUTSIDE_CLASS_BODIES,
                &[],
            );
        }
        self.set_node_links_for_private_identifier_scope(node);
    }

    pub fn check_class_static_block_declaration(&mut self, node: NodeId) {
        // Grammar checking
        self.check_grammar_modifiers(node);
        let a = self.ast;
        a.for_each_child(node, &mut |child| self.check_source_element(child));
    }

    pub fn check_constructor_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar check on signature of constructor and modifier of the constructor is done in checkSignatureDeclaration function.
        self.check_signature_declaration(node);
        // Grammar check for checking only related to constructorDeclaration
        if !self.check_grammar_constructor_type_parameters(node) {
            self.check_grammar_constructor_type_annotation(node);
        }
        self.check_source_element(a.body(node));
        let symbol = self.get_symbol_of_declaration(node);
        self.check_function_or_constructor_symbol(symbol);
        // exit early in the case of signature - super checks are not relevant to them
        if node_is_missing(a, a.body(node)) {
            return;
        }
        // TS 1.0 spec (April 2014): 8.3.2 Constructors of classes with no extends clause may not contain super calls, whereas constructors of derived classes must contain at least one super call somewhere in their function body.
        let containing_class_decl = a.parent(node);
        if get_class_extends_heritage_element(a, containing_class_decl).is_nil() {
            return;
        }
        let class_extends_null = self.class_declaration_extends_null(containing_class_decl);
        let super_call = self.find_first_super_call(a.body(node));
        if !super_call.is_nil() {
            if class_extends_null {
                self.error(
                    super_call,
                    diagnostics::A_CONSTRUCTOR_CANNOT_CONTAIN_A_SUPER_CALL_WHEN_ITS_CLASS_EXTENDS_NULL,
                    &[],
                );
            }
            // A super call must be root-level in a constructor if both of the following are true: the containing class is a derived class, and the constructor declares parameter properties or the containing class declares instance member variables with initializers.
            let super_call_should_be_root_level = !self.emit_standard_class_fields
                && (a.members(a.parent(node)).as_slice().iter().any(|&member| {
                    is_instance_property_with_initializer_or_private_identifier_property(a, member)
                }) || a.parameters(node).as_slice().iter().any(|&parameter| {
                    has_syntactic_modifier(a, parameter, ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
                }));
            if super_call_should_be_root_level {
                // Until we have better flow analysis, it is an error to place the super call within any kind of block or conditional (see GH #8277)
                if !super_call_is_root_level_in_constructor(a, super_call, a.body(node)) {
                    self.error(super_call, diagnostics::A_SUPER_CALL_MUST_BE_A_ROOT_LEVEL_STATEMENT_WITHIN_A_CONSTRUCTOR_OF_A_DERIVED_CLASS_THAT_CONTAINS_INITIALIZED_PROPERTIES_PARAMETER_PROPERTIES_OR_PRIVATE_IDENTIFIERS, &[]);
                } else {
                    let mut super_call_statement = NodeId::NIL;
                    for &statement in a.statements(a.body(node)).as_slice() {
                        if is_expression_statement(a, statement)
                            && is_super_call(
                                a,
                                skip_outer_expressions(
                                    a,
                                    a.expression(statement),
                                    OuterExpressionKinds::ALL,
                                ),
                            )
                        {
                            super_call_statement = statement;
                            break;
                        }
                        if node_immediately_references_super_or_this(a, statement) {
                            break;
                        }
                    }
                    // Until we have better flow analysis, it is an error to place the super call within any kind of block or conditional (see GH #8277)
                    if super_call_statement.is_nil() {
                        self.error(node, diagnostics::A_SUPER_CALL_MUST_BE_THE_FIRST_STATEMENT_IN_THE_CONSTRUCTOR_TO_REFER_TO_SUPER_OR_THIS_WHEN_A_DERIVED_CLASS_CONTAINS_INITIALIZED_PROPERTIES_PARAMETER_PROPERTIES_OR_PRIVATE_IDENTIFIERS, &[]);
                    }
                }
            }
        } else if !class_extends_null {
            self.error(
                node,
                diagnostics::CONSTRUCTORS_FOR_DERIVED_CLASSES_MUST_CONTAIN_A_SUPER_CALL,
                &[],
            );
        }
    }

    pub fn find_first_super_call(&self, node: NodeId) -> NodeId {
        fn visit(c: &Checker<'_>, node: NodeId, super_call: &mut NodeId) -> bool {
            let a = c.ast;
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            if is_super_call(a, node) {
                *super_call = node;
                return true;
            }
            if is_function_like(a, node) {
                return false;
            }
            a.for_each_child(node, &mut |child| visit(c, child, super_call))
        }
        let mut super_call = NodeId::NIL;
        visit(self, node, &mut super_call);
        super_call
    }

    pub fn check_accessor_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking accessors
        if !self.check_grammar_function_like_declaration(node) && !self.check_grammar_accessor(node)
        {
            self.check_grammar_computed_property_name(a.name(node));
        }
        let name = a.name(node);
        if is_identifier(a, name)
            && a.text(name) == b"constructor"
            && is_class_like(a, a.parent(node))
        {
            self.error(
                a.name(node),
                diagnostics::CLASS_CONSTRUCTOR_MAY_NOT_BE_AN_ACCESSOR,
                &[],
            );
        }
        self.check_decorators(node);
        self.check_signature_declaration(node);
        if is_get_accessor_declaration(a, node) {
            if !a.flags(node).intersects(NodeFlags::AMBIENT)
                && node_is_present(a, a.body(node))
                && a.flags(node).intersects(NodeFlags::HAS_IMPLICIT_RETURN)
            {
                if !a.flags(node).intersects(NodeFlags::HAS_EXPLICIT_RETURN) {
                    self.error(name, diagnostics::A_GET_ACCESSOR_MUST_RETURN_A_VALUE, &[]);
                }
            }
        }
        // Do not use hasDynamicName here, because that returns false for well known symbols. We want to perform checkComputedPropertyName for all computed properties, including well known symbols.
        if is_computed_property_name(a, name) {
            self.check_computed_property_name(name);
        }
        if self.has_bindable_name(node) {
            // TypeScript 1.0 spec (April 2014): 8.4.3 Accessors for the same member name must specify the same accessibility.
            let symbol = self.get_symbol_of_declaration(node);
            let getter = get_declaration_of_kind(a, symbol, Kind::GetAccessor);
            let setter = get_declaration_of_kind(a, symbol, Kind::SetAccessor);
            if !getter.is_nil() && !setter.is_nil() {
                let getter_links = self.node_links.get(getter);
                if !self.node_links[getter_links]
                    .flags
                    .intersects(NodeCheckFlags::TYPE_CHECKED)
                {
                    self.node_links[getter_links].flags |= NodeCheckFlags::TYPE_CHECKED;
                    let getter_flags = a.modifier_flags(getter);
                    let setter_flags = a.modifier_flags(setter);
                    if (getter_flags & ModifierFlags::ABSTRACT)
                        != (setter_flags & ModifierFlags::ABSTRACT)
                    {
                        self.error(
                            a.name(getter),
                            diagnostics::ACCESSORS_MUST_BOTH_BE_ABSTRACT_OR_NON_ABSTRACT,
                            &[],
                        );
                        self.error(
                            a.name(setter),
                            diagnostics::ACCESSORS_MUST_BOTH_BE_ABSTRACT_OR_NON_ABSTRACT,
                            &[],
                        );
                    }
                    if (getter_flags.intersects(ModifierFlags::PROTECTED)
                        && !setter_flags
                            .intersects(ModifierFlags::PROTECTED | ModifierFlags::PRIVATE))
                        || (getter_flags.intersects(ModifierFlags::PRIVATE)
                            && !setter_flags.intersects(ModifierFlags::PRIVATE))
                    {
                        self.error(
                            a.name(getter),
                            diagnostics::A_GET_ACCESSOR_MUST_BE_AT_LEAST_AS_ACCESSIBLE_AS_THE_SETTER,
                            &[],
                        );
                        self.error(
                            a.name(setter),
                            diagnostics::A_GET_ACCESSOR_MUST_BE_AT_LEAST_AS_ACCESSIBLE_AS_THE_SETTER,
                            &[],
                        );
                    }
                }
            }
        }
        let accessor_symbol = self.get_symbol_of_declaration(node);
        let return_type = self.get_type_of_accessors(accessor_symbol);
        if a.kind(node) == Kind::GetAccessor {
            self.check_all_code_paths_in_non_void_function_return_or_throw(node, return_type);
        }
        self.check_source_element(a.body(node));
        self.set_node_links_for_private_identifier_scope(node);
    }

    pub fn check_type_reference_node(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_type_arguments(node, a.type_argument_list(node));
        if is_type_reference_node(a, node) && !a.flags(node).intersects(NodeFlags::JSDOC) {
            let data = a.as_type_reference_node(node);
            if !data.type_arguments.is_nil()
                && a.end(data.type_name) != a.list_loc(data.type_arguments).pos
            {
                // If there was a token between the type name and the type arguments, check if it was a DotToken
                let source_file = get_source_file_of_node(a, node);
                if scan_token_at_position(a, source_file, a.end(data.type_name)) == Kind::DotToken {
                    self.grammar_error_at_pos(
                        node,
                        skip_trivia(a.as_source_file(source_file).text(), a.end(data.type_name)),
                        1,
                        diagnostics::JSDOC_TYPES_CAN_ONLY_BE_USED_INSIDE_DOCUMENTATION_COMMENTS,
                        &[],
                    );
                }
            }
        }
        self.check_source_elements(a.type_arguments(node));
        self.check_type_reference_or_import(node);
    }

    pub fn check_type_reference_or_import(&mut self, node: NodeId) {
        let a = self.ast;
        let t = self.get_type_from_type_node(node);
        if !self.is_error_type(t) {
            if a.type_arguments(node).len() != 0 {
                let type_parameters = self.get_type_parameters_for_type_reference_or_import(node);
                if type_parameters.len() != 0 {
                    self.check_type_argument_constraints(node, type_parameters);
                }
            }
            let symbol = self.get_resolved_symbol_or_nil(node);
            if !symbol.is_nil() {
                let declarations = a.sym(symbol).declarations;
                if declarations.as_slice().iter().any(|&declaration| {
                    is_type_declaration(a, declaration)
                        && self.is_deprecated_declaration(declaration)
                }) {
                    let suggestion_node = self.get_deprecated_suggestion_node(node);
                    self.add_deprecated_suggestion(
                        suggestion_node,
                        declarations,
                        a.sym(symbol).name,
                    );
                }
            }
        }
    }

    pub fn check_type_argument_constraints(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
    ) -> bool {
        let a = self.ast;
        let mut type_arguments: List<'a, TypeId> = List::NIL;
        let mut mapper = TypeMapperId::NIL;
        let mut result = true;
        for (i, &type_parameter) in type_parameters.as_slice().iter().enumerate() {
            let constraint = self.get_constraint_of_type_parameter(type_parameter);
            if !constraint.is_nil() {
                if type_arguments.is_nil() {
                    type_arguments = self.get_effective_type_arguments(node, type_parameters);
                    mapper = new_type_mapper(self, type_parameters, type_arguments);
                }
                // `result = result && check(...)`: nothing is instantiated or checked after the first failing constraint.
                if result {
                    let instantiated_constraint = self.instantiate_type(constraint, mapper);
                    result = self.check_type_assignable_to(
                        type_arguments.at(i),
                        instantiated_constraint,
                        a.type_arguments(node).at(i),
                        diagnostics::TYPE_0_DOES_NOT_SATISFY_THE_CONSTRAINT_1,
                    );
                }
            }
        }
        result
    }

    pub fn get_deprecated_suggestion_node(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return node;
        }
        let node = skip_parentheses(a, node);
        match a.kind(node) {
            Kind::CallExpression | Kind::Decorator | Kind::NewExpression => {
                return self.get_deprecated_suggestion_node(a.expression(node));
            }
            Kind::TaggedTemplateExpression => {
                return self
                    .get_deprecated_suggestion_node(a.as_tagged_template_expression(node).tag);
            }
            Kind::JsxOpeningElement | Kind::JsxSelfClosingElement => {
                return self.get_deprecated_suggestion_node(a.tag_name(node));
            }
            Kind::ElementAccessExpression => {
                return a.as_element_access_expression(node).argument_expression;
            }
            Kind::PropertyAccessExpression => {
                return a.name(node);
            }
            Kind::TypeReference => {
                let type_name = a.as_type_reference_node(node).type_name;
                if is_qualified_name(a, type_name) {
                    return a.as_qualified_name(type_name).right;
                }
            }
            _ => {}
        }
        node
    }

    pub fn check_type_predicate(&mut self, node: NodeId) {
        let a = self.ast;
        // Always check the predicate's type so nested type errors are reported even when the predicate is in an invalid position, keeping diagnostics stable.
        self.check_source_element(a.type_node(node));
        let parent = self.get_type_predicate_parent(node);
        if parent.is_nil() {
            // The parent must not be valid.
            self.error(node, diagnostics::A_TYPE_PREDICATE_IS_ONLY_ALLOWED_IN_RETURN_TYPE_POSITION_FOR_FUNCTIONS_AND_METHODS, &[]);
            return;
        }
        let signature = self.get_signature_from_declaration(parent);
        let type_predicate = self.get_type_predicate_of_signature(signature);
        if type_predicate.is_nil() {
            return;
        }
        let parameter_name = a.as_type_predicate_node(node).parameter_name;
        let predicate_kind = self.type_predicates[type_predicate].kind;
        let predicate_parameter_index = self.type_predicates[type_predicate].parameter_index;
        let predicate_parameter_name = self.type_predicates[type_predicate].parameter_name;
        let predicate_type = self.type_predicates[type_predicate].t;
        if predicate_kind != TypePredicateKind::THIS
            && predicate_kind != TypePredicateKind::ASSERTS_THIS
        {
            if predicate_parameter_index >= 0 {
                let parameters = self.signatures[signature].parameters;
                if signature_has_rest_parameter(self, signature)
                    && predicate_parameter_index as isize == parameters.len() - 1
                {
                    self.error(
                        parameter_name,
                        diagnostics::A_TYPE_PREDICATE_CANNOT_REFERENCE_A_REST_PARAMETER,
                        &[],
                    );
                } else {
                    if !predicate_type.is_nil() {
                        let mut diags: Vec<DiagnosticId> = Vec::new();
                        let parameter_type =
                            self.get_type_of_symbol(parameters.at(predicate_parameter_index));
                        if !self.check_type_assignable_to_ex(
                            predicate_type,
                            parameter_type,
                            a.type_node(node),
                            MessageId::NIL,
                            Some(&mut diags),
                        ) {
                            // Upstream reads diags[0] without a length test: a failed check that left no diagnostic is an internal fault here.
                            match diags.first().copied() {
                                Some(first) => {
                                    let chain = self.diagnostic_store.new_diagnostic_chain(first, diagnostics::A_TYPE_PREDICATE_S_TYPE_MUST_BE_ASSIGNABLE_TO_ITS_PARAMETER_S_TYPE, &[]);
                                    self.add_diagnostic(chain);
                                }
                                None => self.fail("index out of range [0] with length 0"),
                            }
                        }
                    }
                }
            } else if !parameter_name.is_nil() {
                let mut has_reported_error = false;
                for &param in a.parameters(parent).as_slice() {
                    let name = a.name(param);
                    if is_binding_pattern(a, name)
                        && self.check_if_type_predicate_variable_is_declared_in_binding_pattern(
                            name,
                            parameter_name,
                            predicate_parameter_name,
                        )
                    {
                        has_reported_error = true;
                        break;
                    }
                }
                if !has_reported_error {
                    self.error(
                        parameter_name,
                        diagnostics::CANNOT_FIND_PARAMETER_0,
                        &[Arg::Str(predicate_parameter_name)],
                    );
                }
            }
        }
    }

    pub fn get_type_predicate_parent(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        let parent = a.parent(node);
        match a.kind(parent) {
            Kind::ArrowFunction
            | Kind::CallSignature
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::FunctionType
            | Kind::MethodDeclaration
            | Kind::MethodSignature => {
                if node == a.type_node(parent) {
                    return parent;
                }
            }
            _ => {}
        }
        NodeId::NIL
    }

    pub fn check_if_type_predicate_variable_is_declared_in_binding_pattern(
        &mut self,
        pattern: NodeId,
        predicate_variable_node: NodeId,
        predicate_variable_name: &[u8],
    ) -> bool {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        for &element in a.elements(pattern).as_slice() {
            let name = a.name(element);
            if name.is_nil() {
                continue;
            }
            if is_identifier(a, name) && a.text(name) == predicate_variable_name {
                self.error(
                    predicate_variable_node,
                    diagnostics::A_TYPE_PREDICATE_CANNOT_REFERENCE_ELEMENT_0_IN_A_BINDING_PATTERN,
                    &[Arg::Str(predicate_variable_name)],
                );
                return true;
            }
            if is_array_binding_pattern(a, name) || is_object_binding_pattern(a, name) {
                if self.check_if_type_predicate_variable_is_declared_in_binding_pattern(
                    name,
                    predicate_variable_node,
                    predicate_variable_name,
                ) {
                    return true;
                }
            }
        }
        false
    }

    pub fn check_type_query(&mut self, node: NodeId) {
        self.get_type_from_type_query_node(node);
    }

    pub fn check_type_literal(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_source_elements(a.members(node));
        let t = self.get_type_from_type_literal_or_function_or_constructor_type_node(node);
        let symbol = self.types[t].symbol;
        self.check_index_constraints(t, symbol, false);
        self.check_type_for_duplicate_index_signatures(node);
        self.check_object_type_for_duplicate_declarations(node, false);
    }

    pub fn check_object_type_for_duplicate_declarations(
        &mut self,
        node: NodeId,
        check_private_names: bool,
    ) {
        // The closure checkPropertyOrAccessor of upstream: the state of a name is 0, 1 (property), 2 (accessor) or 3 (reported).
        fn check_property_or_accessor<'a>(
            c: &mut Checker<'a>,
            node: NodeId,
            instance_names: &mut Map<Text<'a>, isize>,
            static_names: &mut Map<Text<'a>, isize>,
            symbol: SymbolId,
            kind: isize,
            is_static_member: bool,
        ) {
            let symbol_data = c.ast.sym(symbol);
            if symbol_data.declarations.len() > 1 {
                let names = if is_static_member {
                    static_names
                } else {
                    instance_names
                };
                if names.is_nil() {
                    *names = Map::make();
                }
                let state = names.get(&symbol_data.name);
                if state == 0 {
                    // On first occurrence just record the kind
                    let _ = names.set(symbol_data.name, kind);
                } else if state == 1 || state == 2 && kind != 2 {
                    // Error on second property or combination of property and accessor
                    c.report_duplicate_member_errors(
                        node,
                        symbol_data.name,
                        true,
                        is_static_member,
                        diagnostics::DUPLICATE_IDENTIFIER_0,
                    );
                    // Record that errors have been reported
                    let _ = names.set(symbol_data.name, 3);
                }
            }
        }

        let a = self.ast;
        let mut instance_names: Map<Text<'a>, isize> = Map::default();
        let mut static_names: Map<Text<'a>, isize> = Map::default();
        let mut private_names: Map<Text<'a>, isize> = Map::default();
        let node_in_ambient_context = a.flags(node).intersects(NodeFlags::AMBIENT);
        for &member in a.members(node).as_slice() {
            if is_constructor_declaration(a, member) {
                for &param in a.parameters(member).as_slice() {
                    if is_parameter_property_declaration(a, param, member)
                        && !is_binding_pattern(a, a.name(param))
                    {
                        let param_symbol = self.get_symbol_of_declaration(param);
                        check_property_or_accessor(
                            self,
                            node,
                            &mut instance_names,
                            &mut static_names,
                            param_symbol,
                            1,
                            false,
                        );
                    }
                }
            } else {
                let symbol = self.get_symbol_of_declaration(member);
                let is_static_member = has_static_modifier(a, member);
                // In non-ambient contexts, check that static members are not named 'prototype'.
                if !node_in_ambient_context
                    && is_static_member
                    && !symbol.is_nil()
                    && a.sym(symbol).name == b"prototype"
                {
                    let class_symbol = self.get_symbol_of_declaration(node);
                    let class_name = self.symbol_to_string(class_symbol);
                    self.error(a.name(member), diagnostics::STATIC_PROPERTY_0_CONFLICTS_WITH_BUILT_IN_PROPERTY_FUNCTION_0_OF_CONSTRUCTOR_FUNCTION_1, &[Arg::Str(a.sym(symbol).name), Arg::Str(&class_name)]);
                }
                // Check that this object type declaration doesn't contain multiple declarations of the same property, or accessor and property declarations with the same name.
                if is_property_declaration(a, member) && !has_accessor_modifier(a, member)
                    || is_property_signature_declaration(a, member)
                {
                    check_property_or_accessor(
                        self,
                        node,
                        &mut instance_names,
                        &mut static_names,
                        symbol,
                        1,
                        is_static_member,
                    );
                } else if is_accessor(a, member)
                    || is_property_declaration(a, member) && has_accessor_modifier(a, member)
                {
                    check_property_or_accessor(
                        self,
                        node,
                        &mut instance_names,
                        &mut static_names,
                        symbol,
                        2,
                        is_static_member,
                    );
                }
                // Check that each private identifier is used only for instance members or only for static members. It is an error for an instance and a static member to have the same private identifier.
                if check_private_names
                    && !a.name(member).is_nil()
                    && is_private_identifier(a, a.name(member))
                {
                    let symbol_name = a.sym(symbol).name;
                    let mut flags = private_names.get(&symbol_name);
                    if flags != 3 {
                        flags |= if is_static(a, member) { 2 } else { 1 };
                        if private_names.is_nil() {
                            private_names = Map::make();
                        }
                        let _ = private_names.set(symbol_name, flags);
                        if flags == 3 {
                            self.report_duplicate_member_errors(node, symbol_name, false, false, diagnostics::DUPLICATE_IDENTIFIER_0_STATIC_AND_INSTANCE_ELEMENTS_CANNOT_SHARE_THE_SAME_PRIVATE_NAME);
                        }
                    }
                }
            }
        }
    }

    pub fn report_duplicate_member_errors(
        &mut self,
        node: NodeId,
        name: &[u8],
        check_static: bool,
        is_static_member: bool,
        message: MessageId,
    ) {
        let a = self.ast;
        for &member in a.members(node).as_slice() {
            if is_constructor_declaration(a, member) {
                for &param in a.parameters(member).as_slice() {
                    if is_parameter_property_declaration(a, param, member)
                        && !is_binding_pattern(a, a.name(param))
                    {
                        let symbol = self.get_symbol_of_declaration(param);
                        if a.sym(symbol).name == name {
                            let symbol_name = self.symbol_to_string(symbol);
                            self.error(a.name(param), message, &[Arg::Str(&symbol_name)]);
                        }
                    }
                }
            } else {
                let symbol = self.get_symbol_of_declaration(member);
                if !symbol.is_nil()
                    && a.sym(symbol).name == name
                    && (!check_static || is_static_member == is_static(a, member))
                {
                    let symbol_name = self.symbol_to_string(symbol);
                    self.error(a.name(member), message, &[Arg::Str(&symbol_name)]);
                }
            }
        }
    }

    pub fn check_array_type(&mut self, node: NodeId) {
        self.check_source_element(self.ast.as_array_type_node(node).element_type);
    }

    pub fn check_tuple_type(&mut self, node: NodeId) {
        let a = self.ast;
        let mut seen_optional_element = false;
        let mut seen_rest_element = false;
        let elements = a.elements(node);
        for &e in elements.as_slice() {
            let mut flags = self.get_tuple_element_flags(e);
            if flags.intersects(ElementFlags::VARIADIC) {
                let t = self.get_type_from_type_node(a.type_node(e));
                if !self.is_array_like_type(t) {
                    self.error(
                        e,
                        diagnostics::A_REST_ELEMENT_TYPE_MUST_BE_AN_ARRAY_TYPE,
                        &[],
                    );
                    break;
                }
                if self.is_array_type(t)
                    || is_tuple_type(self, t)
                        && self
                            .type_target_tuple_type(t)
                            .combined_flags
                            .intersects(ElementFlags::REST)
                {
                    flags |= ElementFlags::REST;
                }
            }
            if flags.intersects(ElementFlags::REST) {
                if seen_rest_element {
                    self.grammar_error_on_node(
                        e,
                        diagnostics::A_REST_ELEMENT_CANNOT_FOLLOW_ANOTHER_REST_ELEMENT,
                        &[],
                    );
                    break;
                }
                seen_rest_element = true;
            } else if flags.intersects(ElementFlags::OPTIONAL) {
                if seen_rest_element {
                    self.grammar_error_on_node(
                        e,
                        diagnostics::AN_OPTIONAL_ELEMENT_CANNOT_FOLLOW_A_REST_ELEMENT,
                        &[],
                    );
                    break;
                }
                seen_optional_element = true;
            } else if flags.intersects(ElementFlags::REQUIRED) && seen_optional_element {
                self.grammar_error_on_node(
                    e,
                    diagnostics::A_REQUIRED_ELEMENT_CANNOT_FOLLOW_AN_OPTIONAL_ELEMENT,
                    &[],
                );
                break;
            }
        }
        self.check_source_elements(elements);
        self.get_type_from_type_node(node);
    }

    pub fn check_union_or_intersection_type(&mut self, node: NodeId) {
        let a = self.ast;
        a.for_each_child(node, &mut |child| self.check_source_element(child));
        self.get_type_from_type_node(node);
    }

    pub fn check_this_type(&mut self, node: NodeId) {
        self.get_type_from_this_type_node(node);
    }

    pub fn check_type_operator(&mut self, node: NodeId) {
        self.check_grammar_type_operator_node(node);
        self.check_source_element(self.ast.type_node(node));
    }

    pub fn check_conditional_type(&mut self, node: NodeId) {
        let a = self.ast;
        a.for_each_child(node, &mut |child| self.check_source_element(child));
    }

    pub fn check_infer_type(&mut self, node: NodeId) {
        let a = self.ast;
        if find_ancestor(a, node, |n| {
            let parent = a.parent(n);
            !parent.is_nil()
                && a.kind(parent) == Kind::ConditionalType
                && a.as_conditional_type_node(parent).extends_type == n
        })
        .is_nil()
        {
            self.grammar_error_on_node(node, diagnostics::X_INFER_DECLARATIONS_ARE_ONLY_PERMITTED_IN_THE_EXTENDS_CLAUSE_OF_A_CONDITIONAL_TYPE, &[]);
        }
        let type_parameter_declaration_node = a.as_infer_type_node(node).type_parameter;
        self.check_source_element(type_parameter_declaration_node);
        let symbol = self.get_symbol_of_declaration(type_parameter_declaration_node);
        if a.sym(symbol).declarations.len() > 1 {
            let links = self.declared_type_links.get(symbol);
            if !self.declared_type_links[links].type_parameters_checked {
                self.declared_type_links[links].type_parameters_checked = true;
                let type_parameter = self.get_declared_type_of_type_parameter(symbol);
                let declarations = get_declarations_of_kind(a, symbol, Kind::TypeParameter);
                let target_parameters = self.list_of(&[type_parameter]);
                if !self.are_type_parameters_identical(
                    declarations.as_slice(),
                    target_parameters,
                    &|declaration| vec![declaration],
                ) {
                    // Report an error on every conflicting declaration.
                    let name = self.symbol_to_string(symbol);
                    for &declaration in declarations.as_slice() {
                        self.error(
                            a.name(declaration),
                            diagnostics::ALL_DECLARATIONS_OF_0_MUST_HAVE_IDENTICAL_CONSTRAINTS,
                            &[Arg::Str(&name)],
                        );
                    }
                }
            }
        }
        self.register_for_unused_identifiers_check(node);
    }

    pub fn check_template_literal_type(&mut self, node: NodeId) {
        let a = self.ast;
        for &span in a
            .nodes(a.as_template_literal_type_node(node).template_spans)
            .as_slice()
        {
            self.check_source_element(a.type_node(span));
            let t = self.get_type_from_type_node(a.type_node(span));
            self.check_type_assignable_to(
                t,
                self.template_constraint_type,
                a.type_node(span),
                MessageId::NIL,
            );
        }
        self.get_type_from_type_node(node);
    }

    pub fn check_import_type(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_source_element(a.as_import_type_node(node).argument);
        let attributes = a.as_import_type_node(node).attributes;
        if !attributes.is_nil() {
            self.get_resolution_mode_override(attributes, true);
        }
        self.check_type_reference_or_import(node);
    }

    pub fn get_resolution_mode_override(
        &mut self,
        node: NodeId,
        report_errors: bool,
    ) -> ResolutionMode {
        let a = self.ast;
        let attributes = a.nodes(a.as_import_attributes(node).attributes);
        if attributes.len() != 1 {
            if report_errors {
                self.grammar_error_on_node(node, diagnostics::TYPE_IMPORT_ATTRIBUTES_SHOULD_HAVE_EXACTLY_ONE_KEY_RESOLUTION_MODE_WITH_VALUE_IMPORT_OR_REQUIRE, &[]);
            }
            return RESOLUTION_MODE_NONE;
        }
        let elem = attributes.at(0usize);
        if !is_string_literal_like(a, a.name(elem)) {
            return RESOLUTION_MODE_NONE;
        }
        if a.text(a.name(elem)) != b"resolution-mode" {
            if report_errors {
                self.grammar_error_on_node(
                    a.name(elem),
                    diagnostics::X_RESOLUTION_MODE_IS_THE_ONLY_VALID_KEY_FOR_TYPE_IMPORT_ATTRIBUTES,
                    &[],
                );
            }
            return RESOLUTION_MODE_NONE;
        }
        let value = a.as_import_attribute(elem).value;
        if !is_string_literal_like(a, value) {
            return RESOLUTION_MODE_NONE;
        }
        if a.text(value) != b"import" && a.text(value) != b"require" {
            if report_errors {
                self.grammar_error_on_node(
                    value,
                    diagnostics::X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT,
                    &[],
                );
            }
            return RESOLUTION_MODE_NONE;
        }
        if a.text(value) == b"import" {
            return RESOLUTION_MODE_ESM;
        }
        RESOLUTION_MODE_COMMON_JS
    }

    pub fn check_named_tuple_member(&mut self, node: NodeId) {
        let a = self.ast;
        let tuple_member = a.as_named_tuple_member(node);
        if !tuple_member.dot_dot_dot_token.is_nil() && !tuple_member.question_token.is_nil() {
            self.grammar_error_on_node(
                node,
                diagnostics::A_TUPLE_MEMBER_CANNOT_BE_BOTH_OPTIONAL_AND_REST,
                &[],
            );
        }
        if a.kind(tuple_member.type_node) == Kind::OptionalType {
            self.grammar_error_on_node(tuple_member.type_node, diagnostics::A_LABELED_TUPLE_ELEMENT_IS_DECLARED_AS_OPTIONAL_WITH_A_QUESTION_MARK_AFTER_THE_NAME_AND_BEFORE_THE_COLON_RATHER_THAN_AFTER_THE_TYPE, &[]);
        }
        if a.kind(tuple_member.type_node) == Kind::RestType {
            self.grammar_error_on_node(tuple_member.type_node, diagnostics::A_LABELED_TUPLE_ELEMENT_IS_DECLARED_AS_REST_WITH_A_BEFORE_THE_NAME_RATHER_THAN_BEFORE_THE_TYPE, &[]);
        }
        self.check_source_element(a.type_node(node));
        self.get_type_from_type_node(node);
    }

    pub fn check_indexed_access_type(&mut self, node: NodeId) {
        let a = self.ast;
        a.for_each_child(node, &mut |child| self.check_source_element(child));
        let t = self.get_type_from_indexed_access_type_node(node);
        self.check_indexed_access_index_type(t, node);
    }

    pub fn check_mapped_type(&mut self, node: NodeId) {
        let a = self.ast;
        let mapped_type_node = a.as_mapped_type_node(node);
        self.check_grammar_mapped_type(node);
        self.check_source_element(mapped_type_node.type_parameter);
        self.check_source_element(mapped_type_node.name_type);
        self.check_source_element(mapped_type_node.type_node);
        if mapped_type_node.type_node.is_nil() {
            self.report_implicit_any(node, self.any_type, WideningKind::NORMAL);
        }
        let t = self.get_type_from_mapped_type_node(node);
        let name_type = self.get_name_type_from_mapped_type(t);
        if !name_type.is_nil() {
            self.check_type_assignable_to(
                name_type,
                self.string_number_symbol_type,
                mapped_type_node.name_type,
                MessageId::NIL,
            );
        } else {
            let constraint_type = self.get_constraint_type_from_mapped_type(t);
            self.check_type_assignable_to(
                constraint_type,
                self.string_number_symbol_type,
                a.as_type_parameter_declaration(mapped_type_node.type_parameter)
                    .constraint,
                MessageId::NIL,
            );
        }
    }
}

pub fn is_instance_property_with_initializer_or_private_identifier_property(
    a: Ast<'_>,
    n: NodeId,
) -> bool {
    is_private_identifier_class_element_declaration(a, n)
        || is_property_declaration(a, n) && !is_static(a, n) && !a.initializer(n).is_nil()
}

pub fn super_call_is_root_level_in_constructor(
    a: Ast<'_>,
    super_call: NodeId,
    body: NodeId,
) -> bool {
    let super_call_parent = walk_up_parenthesized_expressions(a, a.parent(super_call));
    is_expression_statement(a, super_call_parent) && a.parent(super_call_parent) == body
}

pub fn node_immediately_references_super_or_this(a: Ast<'_>, node: NodeId) -> bool {
    // Go stacks grow: the walk ends here with an internal diagnostic when the thread has no stack left.
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
        return false;
    }
    match a.kind(node) {
        Kind::SuperKeyword | Kind::ThisKeyword => return true,
        Kind::ArrowFunction
        | Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::PropertyDeclaration => return false,
        Kind::Block => match a.kind(a.parent(node)) {
            Kind::Constructor | Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                return false;
            }
            _ => {}
        },
        _ => {}
    }
    a.for_each_child(node, &mut |child| {
        node_immediately_references_super_or_this(a, child)
    })
}
