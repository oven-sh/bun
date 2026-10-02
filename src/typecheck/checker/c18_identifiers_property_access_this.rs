// checker.go:11132-12376 (layer E-ACCESS): the check of an identifier with its control flow type, property accesses and qualified names with private identifiers, the report of a property that does not exist, the accessibility of a property at a location, the type of `this` with its container, and the order of `this` and `super`. forEachProperty, getDeclaringClass, isValidOverrideOf and isPropertyInClassDerivedFrom of 11997-12038 are in relater.rs.
use crate::ast::{
    Arg, Ast, DiagnosticId, FindAncestorResult, FlowNodeId, Kind, ModifierFlags, NodeFlags, NodeId,
    SymbolFlags, SymbolId, find_ancestor, find_ancestor_or_quit,
    get_class_extends_heritage_element, get_class_like_declaration_of_symbol, get_containing_class,
    get_immediately_invoked_function_expression, get_name_of_declaration,
    get_reparsed_node_for_node, get_root_declaration, get_source_file_of_node, get_this_container,
    get_this_parameter, has_accessor_modifier, has_decorators, has_static_modifier,
    is_access_expression, is_arrow_function, is_assignment_expression, is_assignment_target,
    is_binary_expression, is_binding_element, is_call_like_expression, is_call_or_new_expression,
    is_class_declaration, is_class_element, is_class_like, is_computed_property_name,
    is_constructor_declaration, is_entity_name_expression, is_for_in_or_of_statement,
    is_function_expression_or_arrow_function, is_function_like, is_function_like_declaration,
    is_identifier, is_in_js_file, is_interface_declaration, is_js_type_alias_declaration,
    is_jsdoc_name_reference_context, is_method_declaration, is_module_block, is_node_descendant_of,
    is_non_null_expression, is_object_binding_pattern,
    is_object_literal_or_class_expression_method_or_accessor, is_optional_chain,
    is_parameter_declaration, is_parenthesized_expression, is_plain_js_file, is_private_identifier,
    is_private_identifier_class_element_declaration, is_property_access_expression,
    is_property_declaration, is_question_token, is_source_file, is_spread_assignment, is_static,
    is_this_in_type_query, is_type_alias_declaration, is_type_literal_node, is_type_reference_node,
    is_variable_declaration, is_write_access, is_write_only_access, node_is_present, symbol_name,
    walk_up_parenthesized_expressions,
};
use crate::binder::get_symbol_name_for_private_identifier;
use crate::checker::{
    AssignmentKind, CheckMode, Checker, ContextFlags, ExternalEmitHelpers, IndexInfoId,
    LANGUAGE_FEATURE_MINIMUM_TARGET, NodeCheckFlags, NonExistentPropertyKey, ObjectFlags,
    ReferenceHint, TypeFacts, TypeFlags, TypeId, TypeSystemEntity, TypeSystemPropertyName,
    every_contained_type, get_assignment_target_kind, get_binding_element_property_name,
    get_containing_class_excluding_class_decorators, get_containing_object_literal,
    get_declaration_modifier_flags_from_symbol_ex, get_feature_map, get_target_type,
    is_class_instance_property, is_const_enum_object_type, is_delete_target,
    is_in_compound_like_assignment, is_in_type_query, is_this_initialized_declaration,
    is_this_initialized_object_binding_expression, is_this_property, is_this_type_parameter,
    is_type_any, should_mark_identifier_alias_referenced,
};
use crate::core::{List, every, if_else, some};
use crate::diagnostics::{self, MessageId};
use crate::scanner::{declaration_name_to_string, get_text_of_node};

impl<'a> Checker<'a> {
    pub fn check_identifier(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        if is_this_in_type_query(a, node) {
            return self.check_this_expression(node);
        }
        let symbol = self.get_resolved_symbol(node);
        if symbol == self.unknown_symbol {
            return self.error_type;
        }
        if symbol == self.arguments_symbol {
            if self.is_in_property_initializer_or_class_static_block(node, true) {
                self.error(
                    node,
                    diagnostics::X_ARGUMENTS_CANNOT_BE_REFERENCED_IN_PROPERTY_INITIALIZERS_OR_CLASS_STATIC_INITIALIZATION_BLOCKS,
                    &[],
                );
                return self.error_type;
            }
            return self.get_type_of_symbol(symbol);
        }
        if should_mark_identifier_alias_referenced(a, node) {
            self.mark_linked_references(
                node,
                ReferenceHint::IDENTIFIER,
                SymbolId::NIL,
                TypeId::NIL,
            );
        }
        let local_or_export_symbol = self.get_export_symbol_of_value_symbol_if_exported(symbol);
        let target_symbol = self.resolve_alias_with_deprecation_check(local_or_export_symbol, node);
        if a.sym(target_symbol).declarations.len() != 0
            && self.is_deprecated_symbol(target_symbol)
            && self.is_uncalled_function_reference(node, target_symbol)
        {
            self.add_deprecated_suggestion(node, a.sym(target_symbol).declarations, a.text(node));
        }
        let mut declaration = a.sym(local_or_export_symbol).value_declaration;
        let immediate_declaration = declaration;
        // If the identifier is declared in a binding pattern for which we're currently computing the implied type and the reference occurs with the same binding pattern, return the non-inferrable any type. This for example occurs in 'const [a, b = a + 1] = [2]' when we're computing the contextual type for the array literal '[2]'.
        if !declaration.is_nil()
            && a.kind(declaration) == Kind::BindingElement
            && self
                .contextual_binding_patterns
                .contains(&a.parent(declaration))
            && !find_ancestor(a, node, |parent| parent == a.parent(declaration)).is_nil()
        {
            return self.non_inferrable_any_type;
        }
        let mut t = self.get_narrowed_type_of_symbol(local_or_export_symbol, node);
        let assignment_kind = get_assignment_target_kind(a, node);
        if assignment_kind != AssignmentKind::NONE {
            if !a
                .sym(local_or_export_symbol)
                .flags
                .intersects(SymbolFlags::VARIABLE)
                && !(is_in_js_file(a, node)
                    && a.sym(local_or_export_symbol)
                        .flags
                        .intersects(SymbolFlags::VALUE_MODULE))
            {
                let flags = a.sym(local_or_export_symbol).flags;
                let assignment_error = if flags.intersects(SymbolFlags::ENUM) {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_AN_ENUM
                } else if flags.intersects(SymbolFlags::CLASS) {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_CLASS
                } else if flags.intersects(SymbolFlags::MODULE) {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_NAMESPACE
                } else if flags.intersects(SymbolFlags::FUNCTION) {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_FUNCTION
                } else if flags.intersects(SymbolFlags::ALIAS) {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_AN_IMPORT
                } else {
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_NOT_A_VARIABLE
                };
                let symbol_text = self.symbol_to_string(symbol);
                self.error(node, assignment_error, &[Arg::Str(&symbol_text)]);
                return self.error_type;
            }
            if self.is_readonly_symbol(local_or_export_symbol) {
                let symbol_text = self.symbol_to_string(symbol);
                if a.sym(local_or_export_symbol)
                    .flags
                    .intersects(SymbolFlags::VARIABLE)
                {
                    self.error(
                        node,
                        diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_CONSTANT,
                        &[Arg::Str(&symbol_text)],
                    );
                } else {
                    self.error(
                        node,
                        diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_READ_ONLY_PROPERTY,
                        &[Arg::Str(&symbol_text)],
                    );
                }
                return self.error_type;
            }
        }
        let is_alias = a
            .sym(local_or_export_symbol)
            .flags
            .intersects(SymbolFlags::ALIAS);
        // We only narrow variables and parameters occurring in a non-assignment position. For all other entities we simply return the declared type.
        if a.sym(local_or_export_symbol)
            .flags
            .intersects(SymbolFlags::VARIABLE)
        {
            if assignment_kind == AssignmentKind::DEFINITE {
                if is_in_compound_like_assignment(a, node) {
                    return self.get_base_type_of_literal_type(t);
                }
                return t;
            }
        } else if is_alias {
            declaration = self.get_declaration_of_alias_symbol(symbol);
        } else {
            return t;
        }
        if declaration.is_nil() {
            return t;
        }
        t = self.get_narrowable_type_for_reference(t, node, check_mode);
        // The declaration container is the innermost function that encloses the declaration of the variable or parameter. The flow container is the innermost function starting with which we analyze the control flow graph to determine the control flow based type.
        let is_parameter = a.kind(get_root_declaration(a, declaration)) == Kind::Parameter;
        let declaration_container = self.get_control_flow_container(declaration);
        let mut flow_container = self.get_control_flow_container(node);
        let is_outer_variable = flow_container != declaration_container;
        let is_spread_destructuring_assignment_target = !a.parent(node).is_nil()
            && !a.parent(a.parent(node)).is_nil()
            && is_spread_assignment(a, a.parent(node))
            && self.is_destructuring_assignment_target(a.parent(a.parent(node)));
        let is_module_exports = a.sym(symbol).flags.intersects(SymbolFlags::MODULE_EXPORTS);
        let type_is_automatic = t == self.auto_type || t == self.auto_array_type;
        let is_automatic_type_in_non_null =
            type_is_automatic && a.kind(a.parent(node)) == Kind::NonNullExpression;
        // When the control flow originates in a function expression, arrow function, method, or accessor, and we are referencing a closed-over const variable or parameter or mutable local variable past its last assignment, we extend the origin of the control flow analysis to include the immediately enclosing control flow container.
        while flow_container != declaration_container
            && (is_function_expression_or_arrow_function(a, flow_container)
                || is_object_literal_or_class_expression_method_or_accessor(a, flow_container))
            && (self.is_constant_variable(local_or_export_symbol) && t != self.auto_array_type
                || self.is_parameter_or_mutable_local_variable(local_or_export_symbol)
                    && self.is_past_last_assignment(local_or_export_symbol, node))
        {
            flow_container = self.get_control_flow_container(flow_container);
        }
        // We only look for uninitialized variables in strict null checking mode, and only when we can analyze the entire control flow graph from the variable's declaration (i.e. when the flow container and declaration container are the same).
        let is_never_initialized = !immediate_declaration.is_nil()
            && is_variable_declaration(a, immediate_declaration)
            && !is_for_in_or_of_statement(a, a.parent(a.parent(immediate_declaration)))
            && a.initializer(immediate_declaration).is_nil()
            && a.as_variable_declaration(immediate_declaration)
                .exclamation_token
                .is_nil()
            && self.is_mutable_local_variable_declaration(immediate_declaration)
            && !self.is_symbol_assigned_definitely(symbol);
        let assume_initialized = is_parameter
            || is_alias
            || (is_outer_variable && !is_never_initialized)
            || is_spread_destructuring_assignment_target
            || is_module_exports
            || self.is_same_scoped_binding_element(node, declaration)
            || t != self.auto_type
                && t != self.auto_array_type
                && (!self.strict_null_checks
                    || self.types[t]
                        .flags
                        .intersects(TypeFlags::ANY_OR_UNKNOWN | TypeFlags::VOID)
                    || is_in_type_query(a, node)
                    || self.is_in_ambient_or_type_node(node)
                    || a.kind(a.parent(node)) == Kind::ExportSpecifier)
            || is_non_null_expression(a, a.parent(node))
            || is_variable_declaration(a, declaration)
                && !a
                    .as_variable_declaration(declaration)
                    .exclamation_token
                    .is_nil()
            || a.flags(declaration).intersects(NodeFlags::AMBIENT);
        let initial_type = if is_automatic_type_in_non_null {
            self.undefined_type
        } else if assume_initialized && is_parameter {
            self.remove_optionality_from_declared_type(t, declaration)
        } else if assume_initialized {
            t
        } else if type_is_automatic {
            self.undefined_type
        } else {
            self.get_optional_type(t, false)
        };
        let flow_type = if is_automatic_type_in_non_null {
            let flow_type = self.get_flow_type_of_reference_ex(
                node,
                t,
                initial_type,
                flow_container,
                FlowNodeId::NIL,
            );
            self.get_non_nullable_type(flow_type)
        } else {
            self.get_flow_type_of_reference_ex(
                node,
                t,
                initial_type,
                flow_container,
                FlowNodeId::NIL,
            )
        };
        // A variable is considered uninitialized when it is possible to analyze the entire control flow graph from declaration to use, and when the variable's declared type doesn't include undefined but the control flow based type does include undefined.
        if !self.is_evolving_array_operation_target(node)
            && (t == self.auto_type || t == self.auto_array_type)
        {
            if flow_type == self.auto_type || flow_type == self.auto_array_type {
                if self.no_implicit_any {
                    let declaration_name = get_name_of_declaration(a, declaration);
                    let symbol_text = self.symbol_to_string(symbol);
                    let flow_type_text = self.type_to_string_exported(flow_type);
                    self.error(
                        declaration_name,
                        diagnostics::VARIABLE_0_IMPLICITLY_HAS_TYPE_1_IN_SOME_LOCATIONS_WHERE_ITS_TYPE_CANNOT_BE_DETERMINED,
                        &[Arg::Str(&symbol_text), Arg::Str(&flow_type_text)],
                    );
                    let symbol_text = self.symbol_to_string(symbol);
                    let flow_type_text = self.type_to_string_exported(flow_type);
                    self.error(
                        node,
                        diagnostics::VARIABLE_0_IMPLICITLY_HAS_AN_1_TYPE,
                        &[Arg::Str(&symbol_text), Arg::Str(&flow_type_text)],
                    );
                }
                return self.convert_auto_to_any(flow_type);
            }
        } else if !assume_initialized
            && !self.contains_undefined_type(t)
            && self.contains_undefined_type(flow_type)
        {
            let symbol_text = self.symbol_to_string(symbol);
            self.error(
                node,
                diagnostics::VARIABLE_0_IS_USED_BEFORE_BEING_ASSIGNED,
                &[Arg::Str(&symbol_text)],
            );
            // Return the declared type to reduce follow-on errors
            return t;
        }
        if assignment_kind != AssignmentKind::NONE {
            // Identifier is target of a compound assignment
            return self.get_base_type_of_literal_type(flow_type);
        }
        flow_type
    }

    pub fn is_same_scoped_binding_element(&self, node: NodeId, declaration: NodeId) -> bool {
        let a = self.ast;
        if is_binding_element(a, declaration) {
            let binding_element = find_ancestor(a, node, |n| is_binding_element(a, n));
            return !binding_element.is_nil()
                && get_root_declaration(a, binding_element)
                    == get_root_declaration(a, declaration);
        }
        false
    }

    // Remove undefined from the annotated type of a parameter when there is an initializer (that doesn't include undefined)
    pub fn remove_optionality_from_declared_type(
        &mut self,
        declared_type: TypeId,
        declaration: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let remove_undefined = self.strict_null_checks
            && is_parameter_declaration(a, declaration)
            && !a.initializer(declaration).is_nil()
            && self.has_type_facts(declared_type, TypeFacts::IS_UNDEFINED)
            && !self.parameter_initializer_contains_undefined(declaration);
        if remove_undefined {
            return self.get_type_with_facts(declared_type, TypeFacts::NE_UNDEFINED);
        }
        declared_type
    }

    pub fn parameter_initializer_contains_undefined(&mut self, declaration: NodeId) -> bool {
        let a = self.ast;
        let links = self.node_links.get(declaration);
        if !self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED)
        {
            if !self.push_type_resolution(
                TypeSystemEntity::Node(declaration),
                TypeSystemPropertyName::InitializerIsUndefined,
            ) {
                self.report_circularity_error(a.symbol(declaration));
                return true;
            }
            let initializer_type =
                self.check_declaration_initializer(declaration, CheckMode::NORMAL, TypeId::NIL);
            let contains_undefined = self.has_type_facts(initializer_type, TypeFacts::IS_UNDEFINED);
            if !self.pop_type_resolution() {
                self.report_circularity_error(a.symbol(declaration));
                return true;
            }
            if !self.node_links[links]
                .flags
                .intersects(NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED)
            {
                self.node_links[links].flags |= NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED
                    | if_else(
                        contains_undefined,
                        NodeCheckFlags::INITIALIZER_IS_UNDEFINED,
                        NodeCheckFlags::NONE,
                    );
            }
        }
        self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::INITIALIZER_IS_UNDEFINED)
    }

    pub fn is_in_ambient_or_type_node(&self, node: NodeId) -> bool {
        let a = self.ast;
        a.flags(node).intersects(NodeFlags::AMBIENT)
            || !find_ancestor(a, node, |n| {
                is_interface_declaration(a, n)
                    || is_type_alias_declaration(a, n)
                    || is_js_type_alias_declaration(a, n)
                    || is_type_literal_node(a, n)
            })
            .is_nil()
    }

    pub fn check_property_access_expression(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
        write_only: bool,
    ) -> TypeId {
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN) {
            return self.check_property_access_chain(node, check_mode);
        }
        let expr = a.expression(node);
        let left_type = self.check_non_null_expression(expr);
        self.check_property_access_expression_or_qualified_name(
            node,
            expr,
            left_type,
            a.as_property_access_expression(node).name,
            check_mode,
            write_only,
        )
    }

    pub fn check_property_access_chain(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let left_type = self.check_expression(a.expression(node));
        let non_optional_type = self.get_optional_expression_type(left_type, a.expression(node));
        let non_null_type = self.check_non_null_type(non_optional_type, a.expression(node));
        let prop_type = self.check_property_access_expression_or_qualified_name(
            node,
            a.expression(node),
            non_null_type,
            a.name(node),
            check_mode,
            false,
        );
        self.propagate_optional_type_marker(prop_type, node, non_optional_type != left_type)
    }

    pub fn check_property_access_expression_or_qualified_name(
        &mut self,
        node: NodeId,
        left: NodeId,
        left_type: TypeId,
        right: NodeId,
        check_mode: CheckMode,
        write_only: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent_symbol = self.get_resolved_symbol_or_nil(left);
        let assignment_kind = get_assignment_target_kind(a, node);
        let mut widened_type = left_type;
        if assignment_kind != AssignmentKind::NONE || self.is_method_access_for_call(node) {
            widened_type = self.get_widened_type(left_type);
        }
        let apparent_type = self.get_apparent_type(widened_type);
        let is_any_like =
            is_type_any(self, apparent_type) || apparent_type == self.silent_never_type;
        let mut prop = SymbolId::NIL;
        if is_private_identifier(a, right) {
            if self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.private_names_and_class_static_blocks
                || self.language_version
                    < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators
                || !self.compiler_options.get_use_define_for_class_fields()
            {
                if assignment_kind != AssignmentKind::NONE {
                    self.check_external_emit_helpers(
                        node,
                        ExternalEmitHelpers::CLASS_PRIVATE_FIELD_SET,
                    );
                }
                if assignment_kind != AssignmentKind::DEFINITE {
                    self.check_external_emit_helpers(
                        node,
                        ExternalEmitHelpers::CLASS_PRIVATE_FIELD_GET,
                    );
                }
            }
            let lexically_scoped_symbol =
                self.lookup_symbol_for_private_identifier_declaration(a.text(right), right);
            if assignment_kind != AssignmentKind::NONE
                && !lexically_scoped_symbol.is_nil()
                && !a.sym(lexically_scoped_symbol).value_declaration.is_nil()
                && is_method_declaration(a, a.sym(lexically_scoped_symbol).value_declaration)
            {
                self.grammar_error_on_node(
                    right,
                    diagnostics::CANNOT_ASSIGN_TO_PRIVATE_METHOD_0_PRIVATE_METHODS_ARE_NOT_WRITABLE,
                    &[Arg::Str(a.text(right))],
                );
            }
            if is_any_like {
                if !lexically_scoped_symbol.is_nil() {
                    if self.is_error_type(apparent_type) {
                        return self.error_type;
                    }
                    return apparent_type;
                }
                if get_containing_class_excluding_class_decorators(a, right).is_nil() {
                    self.grammar_error_on_node(
                        right,
                        diagnostics::PRIVATE_IDENTIFIERS_ARE_NOT_ALLOWED_OUTSIDE_CLASS_BODIES,
                        &[],
                    );
                    return self.any_type;
                }
            }
            if !lexically_scoped_symbol.is_nil() {
                prop = self
                    .get_private_identifier_property_of_type(left_type, lexically_scoped_symbol);
            }
            if prop.is_nil() {
                // Check for private-identifier-specific shadowing and lexical-scoping errors.
                if self.check_private_identifier_property_access(
                    left_type,
                    right,
                    lexically_scoped_symbol,
                ) {
                    return self.error_type;
                }
                let containing_class = get_containing_class_excluding_class_decorators(a, right);
                if !containing_class.is_nil()
                    && is_plain_js_file(
                        a,
                        get_source_file_of_node(a, containing_class),
                        self.compiler_options.check_js,
                    )
                {
                    self.grammar_error_on_node(
                        right,
                        diagnostics::PRIVATE_FIELD_0_MUST_BE_DECLARED_IN_AN_ENCLOSING_CLASS,
                        &[Arg::Str(a.text(right))],
                    );
                }
            } else {
                let is_setonly_accessor = a.sym(prop).flags.intersects(SymbolFlags::SET_ACCESSOR)
                    && !a.sym(prop).flags.intersects(SymbolFlags::GET_ACCESSOR);
                if is_setonly_accessor && assignment_kind != AssignmentKind::DEFINITE {
                    self.error(
                        node,
                        diagnostics::PRIVATE_ACCESSOR_WAS_DEFINED_WITHOUT_A_GETTER,
                        &[],
                    );
                }
            }
        } else {
            if is_any_like {
                if is_identifier(a, left) && !parent_symbol.is_nil() {
                    self.mark_linked_references(
                        node,
                        ReferenceHint::PROPERTY,
                        SymbolId::NIL,
                        left_type,
                    );
                }
                if self.is_error_type(apparent_type) {
                    return self.error_type;
                }
                return apparent_type;
            }
            let skip_object_function_property_augment =
                is_const_enum_object_type(self, apparent_type);
            prop = self.get_property_of_type_ex(
                apparent_type,
                a.text(right),
                skip_object_function_property_augment,
                a.kind(node) == Kind::QualifiedName,
            );
        }
        self.mark_linked_references(node, ReferenceHint::PROPERTY, prop, left_type);
        let prop_type = if prop.is_nil() {
            let mut index_info = IndexInfoId::NIL;
            if !is_private_identifier(a, right)
                && (assignment_kind == AssignmentKind::NONE
                    || !self.is_generic_object_type(left_type)
                    || is_this_type_parameter(self, left_type))
            {
                index_info = self.get_applicable_index_info_for_name(apparent_type, a.text(right));
            }
            if index_info.is_nil() {
                let left_type_symbol = self.types[left_type].symbol;
                let is_unchecked_js = self.is_unchecked_js_suggestion(node, left_type_symbol, true);
                if !is_unchecked_js && self.is_js_literal_type(left_type) {
                    return self.any_type;
                }
                if self.types[left_type].symbol == self.global_this_symbol {
                    let global_symbol =
                        a.table_get(a.sym(self.global_this_symbol).exports, a.text(right));
                    if !global_symbol.is_nil()
                        && a.sym(global_symbol)
                            .flags
                            .intersects(SymbolFlags::BLOCK_SCOPED)
                    {
                        let left_type_text = self.type_to_string_exported(left_type);
                        self.error(
                            right,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                            &[Arg::Str(a.text(right)), Arg::Str(&left_type_text)],
                        );
                    } else if self.no_implicit_any {
                        let left_type_text = self.type_to_string_exported(left_type);
                        self.error(
                            right,
                            diagnostics::ELEMENT_IMPLICITLY_HAS_AN_ANY_TYPE_BECAUSE_TYPE_0_HAS_NO_INDEX_SIGNATURE,
                            &[Arg::Str(&left_type_text)],
                        );
                    }
                    return self.any_type;
                }
                if !a.text(right).is_empty()
                    && !self.check_and_report_error_for_extending_interface(node)
                {
                    self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                        // must be deferred because reporting this error can cause us to materialize the containing type completely (to print it), leading to erroneous circularity errors
                        let containing_type = if_else(
                            is_this_type_parameter(c, left_type),
                            apparent_type,
                            left_type,
                        );
                        c.report_nonexistent_property(right, containing_type, is_unchecked_js);
                    }));
                }
                return self.error_type;
            }
            if self.index_infos[index_info].is_readonly
                && (is_assignment_target(a, node) || is_delete_target(a, node))
            {
                let apparent_type_text = self.type_to_string_exported(apparent_type);
                self.error(
                    node,
                    diagnostics::INDEX_SIGNATURE_IN_TYPE_0_ONLY_PERMITS_READING,
                    &[Arg::Str(&apparent_type_text)],
                );
            }
            let mut prop_type = self.index_infos[index_info].value_type;
            if self.compiler_options.no_unchecked_indexed_access.is_true()
                && get_assignment_target_kind(a, node) != AssignmentKind::DEFINITE
            {
                let missing_type = self.missing_type;
                prop_type = self.get_union_type(List::from_slice(&[prop_type, missing_type]));
            }
            if self
                .compiler_options
                .no_property_access_from_index_signature
                .is_true()
                && is_property_access_expression(a, node)
            {
                self.error(
                    right,
                    diagnostics::PROPERTY_0_COMES_FROM_AN_INDEX_SIGNATURE_SO_IT_MUST_BE_ACCESSED_WITH_0,
                    &[Arg::Str(a.text(right))],
                );
            }
            let declaration = self.index_infos[index_info].declaration;
            if !declaration.is_nil() && self.is_deprecated_declaration(declaration) {
                self.add_deprecated_suggestion(
                    right,
                    List::from_slice(&[declaration]),
                    a.text(right),
                );
            }
            prop_type
        } else {
            let target_prop_symbol = self.resolve_alias_with_deprecation_check(prop, right);
            if self.is_deprecated_symbol(target_prop_symbol)
                && self.is_uncalled_function_reference(node, target_prop_symbol)
                && !a.sym(target_prop_symbol).declarations.is_nil()
            {
                self.add_deprecated_suggestion(
                    right,
                    a.sym(target_prop_symbol).declarations,
                    a.text(right),
                );
            }
            self.check_property_not_used_before_declaration(prop, node, right);
            let is_self_type_access = self.is_self_type_access(left, parent_symbol);
            self.mark_property_as_referenced(prop, node, is_self_type_access);
            let links = self.symbol_node_links.get(node);
            self.symbol_node_links[links].resolved_symbol = prop;
            self.check_property_accessibility(
                node,
                a.kind(left) == Kind::SuperKeyword,
                is_write_access(a, node),
                apparent_type,
                prop,
            );
            if self.is_assignment_to_readonly_entity(node, prop, assignment_kind) {
                self.error(
                    right,
                    diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_READ_ONLY_PROPERTY,
                    &[Arg::Str(a.text(right))],
                );
                return self.error_type;
            }
            if self.is_this_property_access_in_constructor(node, prop) {
                self.auto_type
            } else if write_only || is_write_only_access(a, node) {
                self.get_write_type_of_symbol(prop)
            } else {
                self.get_type_of_symbol(prop)
            }
        };
        self.get_flow_type_of_access_expression(node, prop, prop_type, right, check_mode)
    }

    pub fn get_flow_type_of_access_expression(
        &mut self,
        node: NodeId,
        prop: SymbolId,
        prop_type: TypeId,
        error_node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        // Only compute control flow type if this is a property access expression that isn't an assignment target, and the referenced property was declared as a variable, property, accessor, or optional method.
        let assignment_kind = get_assignment_target_kind(a, node);
        if assignment_kind == AssignmentKind::DEFINITE {
            return self.remove_missing_type(
                prop_type,
                !prop.is_nil() && a.sym(prop).flags.intersects(SymbolFlags::OPTIONAL),
            );
        }
        if !prop.is_nil()
            && !a
                .sym(prop)
                .flags
                .intersects(SymbolFlags::VARIABLE | SymbolFlags::PROPERTY | SymbolFlags::ACCESSOR)
            && !(a.sym(prop).flags.intersects(SymbolFlags::METHOD)
                && self.types[prop_type].flags.intersects(TypeFlags::UNION))
        {
            return prop_type;
        }
        if prop_type == self.auto_type {
            return self.get_flow_type_of_property(node, prop);
        }
        let prop_type = self.get_narrowable_type_for_reference(prop_type, node, check_mode);
        // If strict null checks and strict property initialization checks are enabled, if we have a this.xxx property access, if the property is an instance property without an initializer, and if we are in a constructor of the same class as the property declaration, assume that the property is uninitialized at the top of the control flow.
        let mut assume_uninitialized = false;
        if self.strict_null_checks && !prop.is_nil() {
            let declaration = a.sym(prop).value_declaration;
            if !declaration.is_nil() {
                if self.strict_property_initialization
                    && is_access_expression(a, node)
                    && a.kind(a.expression(node)) == Kind::ThisKeyword
                    && self.is_property_without_initializer(declaration)
                    && !is_static(a, declaration)
                {
                    let flow_container = self.get_control_flow_container(node);
                    if is_constructor_declaration(a, flow_container)
                        && a.parent(flow_container) == a.parent(declaration)
                        && !a.flags(declaration).intersects(NodeFlags::AMBIENT)
                    {
                        assume_uninitialized = true;
                    }
                } else if is_binary_expression(a, declaration)
                    && is_property_access_expression(a, a.as_binary_expression(declaration).left)
                    && self.get_control_flow_container(node)
                        == self.get_control_flow_container(declaration)
                {
                    assume_uninitialized = true;
                }
            }
        }
        let initial_type = self.add_optionality_ex(prop_type, false, assume_uninitialized);
        let flow_type = self.get_flow_type_of_reference_ex(
            node,
            prop_type,
            initial_type,
            NodeId::NIL,
            FlowNodeId::NIL,
        );
        if assume_uninitialized
            && !self.contains_undefined_type(prop_type)
            && self.contains_undefined_type(flow_type)
        {
            let prop_text = self.symbol_to_string(prop);
            self.error(
                error_node,
                diagnostics::PROPERTY_0_IS_USED_BEFORE_BEING_ASSIGNED,
                &[Arg::Str(&prop_text)],
            );
            // Return the declared type to reduce follow-on errors
            return prop_type;
        }
        if assignment_kind != AssignmentKind::NONE {
            return self.get_base_type_of_literal_type(flow_type);
        }
        flow_type
    }

    pub fn get_control_flow_container(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        find_ancestor(a, a.parent(node), |node| {
            is_function_like(a, node)
                && get_immediately_invoked_function_expression(a, node).is_nil()
                || is_module_block(a, node)
                || is_source_file(a, node)
                || is_property_declaration(a, node)
        })
    }

    pub fn get_flow_type_of_property(&mut self, reference: NodeId, prop: SymbolId) -> TypeId {
        let a = self.ast;
        let mut initial_type = self.undefined_type;
        if !prop.is_nil()
            && !a.sym(prop).value_declaration.is_nil()
            && (!self.is_auto_typed_property(prop)
                || a.modifier_flags(a.sym(prop).value_declaration)
                    .intersects(ModifierFlags::AMBIENT))
        {
            let base_type = self.get_type_of_property_in_base_class(prop);
            if !base_type.is_nil() {
                initial_type = base_type;
            }
        }
        let auto_type = self.auto_type;
        self.get_flow_type_of_reference_ex(
            reference,
            auto_type,
            initial_type,
            NodeId::NIL,
            FlowNodeId::NIL,
        )
    }

    // Return the inherited type of the given property or undefined if property doesn't exist in a base class.
    pub fn get_type_of_property_in_base_class(&mut self, property: SymbolId) -> TypeId {
        let a = self.ast;
        let class_type = self.get_declaring_class(property);
        if !class_type.is_nil() {
            let base_class_types = self.get_base_types(class_type);
            if base_class_types.len() > 0 {
                return self.get_type_of_property_of_type(
                    base_class_types.at(0usize),
                    a.sym(property).name,
                );
            }
        }
        TypeId::NIL
    }

    pub fn is_method_access_for_call(&self, node: NodeId) -> bool {
        let a = self.ast;
        let mut node = node;
        while is_parenthesized_expression(a, a.parent(node)) {
            node = a.parent(node);
        }
        is_call_or_new_expression(a, a.parent(node)) && a.expression(a.parent(node)) == node
    }

    // Lookup the private identifier lexically.
    pub fn lookup_symbol_for_private_identifier_declaration(
        &self,
        prop_name: &[u8],
        location: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut containing_class = get_containing_class_excluding_class_decorators(a, location);
        while !containing_class.is_nil() {
            let symbol = a.symbol(containing_class);
            let name = get_symbol_name_for_private_identifier(a, symbol, prop_name);
            let prop = a.table_get(a.sym(symbol).members, name);
            if !prop.is_nil() {
                return prop;
            }
            let prop = a.table_get(a.sym(symbol).exports, name);
            if !prop.is_nil() {
                return prop;
            }
            containing_class = get_containing_class(a, containing_class);
        }
        SymbolId::NIL
    }

    pub fn get_private_identifier_property_of_type(
        &mut self,
        left_type: TypeId,
        lexically_scoped_identifier: SymbolId,
    ) -> SymbolId {
        let name = self.ast.sym(lexically_scoped_identifier).name;
        self.get_property_of_type(left_type, name)
    }

    pub fn check_private_identifier_property_access(
        &mut self,
        left_type: TypeId,
        right: NodeId,
        lexically_scoped_identifier: SymbolId,
    ) -> bool {
        let a = self.ast;
        // Either the identifier could not be looked up in the lexical scope OR the lexically scoped identifier did not exist on the type. Find a private identifier with the same description on the type.
        let properties = self.get_properties_of_type(left_type);
        let mut property_on_type = SymbolId::NIL;
        for &symbol in properties.as_slice() {
            let decl = a.sym(symbol).value_declaration;
            if !decl.is_nil()
                && !a.name(decl).is_nil()
                && is_private_identifier(a, a.name(decl))
                && a.text(a.name(decl)) == a.text(right)
            {
                property_on_type = symbol;
                break;
            }
        }
        let diag_name = declaration_name_to_string(a, right);
        if !property_on_type.is_nil() {
            let type_value_decl = a.sym(property_on_type).value_declaration;
            let type_class = get_containing_class(a, type_value_decl);
            // We found a private identifier property with the same description. Either there is a lexically scoped private identifier AND it shadows the one we found on the type, or it is an attempt to access the private identifier outside of the class.
            if !lexically_scoped_identifier.is_nil()
                && !a
                    .sym(lexically_scoped_identifier)
                    .value_declaration
                    .is_nil()
            {
                let lexical_value_decl = a.sym(lexically_scoped_identifier).value_declaration;
                let lexical_class = get_containing_class(a, lexical_value_decl);
                if !find_ancestor(a, lexical_class, |n| type_class == n).is_nil() {
                    let left_type_text = self.type_to_string_exported(left_type);
                    let diagnostic = self.error(
                        right,
                        diagnostics::THE_PROPERTY_0_CANNOT_BE_ACCESSED_ON_TYPE_1_WITHIN_THIS_CLASS_BECAUSE_IT_IS_SHADOWED_BY_ANOTHER_PRIVATE_IDENTIFIER_WITH_THE_SAME_SPELLING,
                        &[Arg::Str(&diag_name), Arg::Str(&left_type_text)],
                    );
                    let related = self.create_diagnostic_for_node(
                        lexical_value_decl,
                        diagnostics::THE_SHADOWING_DECLARATION_OF_0_IS_DEFINED_HERE,
                        &[Arg::Str(&diag_name)],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                    let related = self.create_diagnostic_for_node(
                        type_value_decl,
                        diagnostics::THE_DECLARATION_OF_0_THAT_YOU_PROBABLY_INTENDED_TO_USE_IS_DEFINED_HERE,
                        &[Arg::Str(&diag_name)],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                    return true;
                }
            }
            let type_class_text = self.symbol_to_string_exported(a.symbol(type_class));
            self.error(
                right,
                diagnostics::PROPERTY_0_IS_NOT_ACCESSIBLE_OUTSIDE_CLASS_1_BECAUSE_IT_HAS_A_PRIVATE_IDENTIFIER,
                &[Arg::Str(&diag_name), Arg::Str(&type_class_text)],
            );
            return true;
        }
        false
    }

    pub fn report_nonexistent_property(
        &mut self,
        prop_node: NodeId,
        containing_type: TypeId,
        is_unchecked_js: bool,
    ) {
        let a = self.ast;
        let key = NonExistentPropertyKey {
            prop_node,
            containing_type,
            is_unchecked_js,
        };
        if self.non_existent_properties.has(&key) {
            return;
        }
        self.non_existent_properties.add(key);
        let links = self.node_links.get(prop_node);
        if self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::TYPE_CHECKED)
        {
            // error already made/in progress
            return;
        }
        self.node_links[links].flags |= NodeCheckFlags::TYPE_CHECKED;
        if is_jsdoc_name_reference_context(a, prop_node) {
            return;
        }
        let mut diagnostic = DiagnosticId::NIL;
        if !is_private_identifier(a, prop_node)
            && self.types[containing_type]
                .flags
                .intersects(TypeFlags::UNION)
            && !self.types[containing_type]
                .flags
                .intersects(TypeFlags::PRIMITIVE)
        {
            let subtypes = self.type_types(containing_type);
            for &subtype in subtypes.as_slice() {
                if self
                    .get_property_of_type(subtype, a.text(prop_node))
                    .is_nil()
                    && self
                        .get_applicable_index_info_for_name(subtype, a.text(prop_node))
                        .is_nil()
                {
                    let prop_name = declaration_name_to_string(a, prop_node);
                    let subtype_text = self.type_to_string_exported(subtype);
                    diagnostic = self.new_diagnostic_chain_for_node(
                        diagnostic,
                        prop_node,
                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                        &[Arg::Str(&prop_name), Arg::Str(&subtype_text)],
                    );
                    break;
                }
            }
        }
        if self.type_has_static_property(a.text(prop_node), containing_type) {
            let prop_name = declaration_name_to_string(a, prop_node);
            let type_name = self.type_to_string_exported(containing_type);
            let static_member =
                [type_name.as_slice(), b".".as_slice(), prop_name.as_slice()].concat();
            diagnostic = self.new_diagnostic_chain_for_node(
                diagnostic,
                prop_node,
                diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_TO_ACCESS_THE_STATIC_MEMBER_2_INSTEAD,
                &[
                    Arg::Str(&prop_name),
                    Arg::Str(&type_name),
                    Arg::Str(&static_member),
                ],
            );
        } else {
            let promised_type = self.get_promised_type_of_promise(containing_type);
            if !promised_type.is_nil()
                && !self
                    .get_property_of_type(promised_type, a.text(prop_node))
                    .is_nil()
            {
                let prop_name = declaration_name_to_string(a, prop_node);
                let type_name = self.type_to_string_exported(containing_type);
                diagnostic = self.new_diagnostic_chain_for_node(
                    diagnostic,
                    prop_node,
                    diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                    &[Arg::Str(&prop_name), Arg::Str(&type_name)],
                );
                let related = self.new_diagnostic_for_node(
                    prop_node,
                    diagnostics::DID_YOU_FORGET_TO_USE_AWAIT,
                    &[],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
            } else {
                let missing_property = declaration_name_to_string(a, prop_node);
                let container = self.type_to_string_exported(containing_type);
                let lib_suggestion = self.get_suggested_lib_for_non_existent_property(
                    &missing_property,
                    containing_type,
                );
                if !lib_suggestion.is_empty() {
                    diagnostic = self.new_diagnostic_chain_for_node(
                        diagnostic,
                        prop_node,
                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_2_OR_LATER,
                        &[
                            Arg::Str(&missing_property),
                            Arg::Str(&container),
                            Arg::Str(lib_suggestion),
                        ],
                    );
                } else {
                    let suggestion = self
                        .get_suggested_symbol_for_nonexistent_property(prop_node, containing_type);
                    if !suggestion.is_nil() {
                        let suggested_name = symbol_name(a, suggestion);
                        let message = if_else(
                            is_unchecked_js,
                            diagnostics::PROPERTY_0_MAY_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_2,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_2,
                        );
                        diagnostic = self.new_diagnostic_chain_for_node(
                            diagnostic,
                            prop_node,
                            message,
                            &[
                                Arg::Str(&missing_property),
                                Arg::Str(&container),
                                Arg::Str(suggested_name),
                            ],
                        );
                        let value_declaration = a.sym(suggestion).value_declaration;
                        if !value_declaration.is_nil() {
                            let related = self.new_diagnostic_for_node(
                                value_declaration,
                                diagnostics::X_0_IS_DECLARED_HERE,
                                &[Arg::Str(suggested_name)],
                            );
                            self.diagnostic_store.add_related_info(diagnostic, related);
                        }
                    } else {
                        diagnostic = self.elaborate_never_intersection(
                            diagnostic,
                            prop_node,
                            containing_type,
                        );
                        let message = if self
                            .container_seems_to_be_empty_dom_element(containing_type)
                        {
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_INCLUDE_DOM
                        } else {
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1
                        };
                        diagnostic = self.new_diagnostic_chain_for_node(
                            diagnostic,
                            prop_node,
                            message,
                            &[Arg::Str(&missing_property), Arg::Str(&container)],
                        );
                    }
                }
            }
        }
        let is_error = !is_unchecked_js
            || self.diagnostic_store[diagnostic].code()
                != diagnostics::PROPERTY_0_MAY_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_2.code();
        self.add_error_or_suggestion(is_error, diagnostic);
    }

    pub fn get_suggested_lib_for_non_existent_property(
        &mut self,
        missing_property: &[u8],
        containing_type: TypeId,
    ) -> &'static [u8] {
        let a = self.ast;
        let apparent_type = self.get_apparent_type(containing_type);
        let container = self.types[apparent_type].symbol;
        if !container.is_nil() {
            let feature_map = get_feature_map();
            if let Some(type_features) = feature_map.get(a.sym(container).name) {
                for entry in type_features {
                    if entry.props.contains(&missing_property) {
                        return entry.lib;
                    }
                }
            }
        }
        b""
    }

    pub fn get_suggested_symbol_for_nonexistent_property(
        &mut self,
        name: NodeId,
        containing_type: TypeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut props = self.get_properties_of_type(containing_type);
        let parent = a.parent(name);
        if is_property_access_expression(a, parent) {
            props = self.filter(props, |c, prop| {
                c.is_valid_property_access_for_completions(parent, containing_type, prop)
            });
        }
        self.get_spelling_suggestion_for_name(a.text(name), props.as_slice(), SymbolFlags::VALUE)
    }

    // Checks if an existing property access is valid for completions purposes. The node is a property access-like node where we want to check if we can access a property: it need not be an access of the property we are checking (in completions it is often an incomplete property access node, as in `foo.`), and besides providing a location (i.e. scope) used to check property accessibility, it is used for computing whether this is a `super` property access.
    pub fn is_valid_property_access_for_completions(
        &mut self,
        node: NodeId,
        t: TypeId,
        property: SymbolId,
    ) -> bool {
        let a = self.ast;
        // Previously we validated the 'this' type of methods but this adversely affected performance.
        self.is_property_accessible(
            node,
            is_property_access_expression(a, node)
                && a.kind(a.expression(node)) == Kind::SuperKeyword,
            false,
            t,
            property,
        )
    }

    // Checks if a property can be accessed in a location. The location is given by the node, which does not need to be a property access; is_super says whether to consider this a `super` property access, e.g. `super.foo`, and is_write whether this is a write access, e.g. `++foo.x`.
    pub fn is_property_accessible(
        &mut self,
        node: NodeId,
        is_super: bool,
        is_write: bool,
        containing_type: TypeId,
        property: SymbolId,
    ) -> bool {
        let a = self.ast;
        // Short-circuiting for improved performance.
        if is_type_any(self, containing_type) {
            return true;
        }
        // A #private property access in an optional chain is an error dealt with by the parser. The checker does not check for it, so we need to do our own check here.
        if !a.sym(property).value_declaration.is_nil()
            && is_private_identifier_class_element_declaration(a, a.sym(property).value_declaration)
        {
            let decl_class = get_containing_class(a, a.sym(property).value_declaration);
            return !is_optional_chain(a, node) && is_node_descendant_of(a, node, decl_class);
        }
        self.check_property_accessibility_at_location(
            node,
            is_super,
            is_write,
            containing_type,
            property,
            NodeId::NIL,
        )
    }

    pub fn container_seems_to_be_empty_dom_element(&mut self, containing_type: TypeId) -> bool {
        let has_dom_lib = match &self.compiler_options.lib {
            Some(lib) => lib.iter().any(|name| name.as_slice() == b"lib.dom.d.ts"),
            None => false,
        };
        !has_dom_lib
            && every_contained_type(self, containing_type, &mut |c, t| {
                has_common_dom_type_name(c, t)
            })
            && self.is_empty_object_type(containing_type)
    }
}

pub fn has_common_dom_type_name(c: &Checker<'_>, t: TypeId) -> bool {
    let symbol = c.types[t].symbol;
    if symbol.is_nil() {
        return false;
    }
    let name = c.ast.sym(symbol).name;
    name == b"EventTarget"
        || name == b"Node"
        || name == b"Element"
        || name.starts_with(b"HTML") && name.ends_with(b"Element")
}

impl<'a> Checker<'a> {
    pub fn check_and_report_error_for_extending_interface(
        &mut self,
        error_location: NodeId,
    ) -> bool {
        let a = self.ast;
        let expression = self.get_entity_name_for_extending_interface(error_location);
        if !expression.is_nil()
            && !self
                .resolve_entity_name(expression, SymbolFlags::INTERFACE, true, false, NodeId::NIL)
                .is_nil()
        {
            let expression_text = get_text_of_node(a, expression);
            self.error(
                error_location,
                diagnostics::CANNOT_EXTEND_AN_INTERFACE_0_DID_YOU_MEAN_IMPLEMENTS,
                &[Arg::Str(&expression_text)],
            );
            return true;
        }
        false
    }

    // Climbs up parents to a heritage clause element and returns its entity name.
    pub fn get_entity_name_for_extending_interface(&self, node: NodeId) -> NodeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::Identifier | Kind::QualifiedName | Kind::PropertyAccessExpression => {
                if !a.parent(node).is_nil() {
                    return self.get_entity_name_for_extending_interface(a.parent(node));
                }
            }
            Kind::TypeReference => return a.as_type_reference_node(node).type_name,
            Kind::ExpressionWithTypeArguments => {
                if is_entity_name_expression(a, a.expression(node)) {
                    return a.expression(node);
                }
            }
            _ => {}
        }
        NodeId::NIL
    }

    pub fn is_uncalled_function_reference(&mut self, node: NodeId, symbol: SymbolId) -> bool {
        let a = self.ast;
        if a.sym(symbol)
            .flags
            .intersects(SymbolFlags::FUNCTION | SymbolFlags::METHOD)
        {
            let mut parent = find_ancestor(a, a.parent(node), |n| !is_access_expression(a, n));
            if parent.is_nil() {
                parent = a.parent(node);
            }
            if is_call_like_expression(a, parent) {
                return is_call_or_new_expression(a, parent)
                    && is_identifier(a, node)
                    && self.has_matching_argument(parent, node);
            }
            return every(a.sym(symbol).declarations.as_slice(), |d| {
                !is_function_like(a, d) || self.is_deprecated_declaration(d)
            });
        }
        true
    }

    pub fn check_property_not_used_before_declaration(
        &mut self,
        prop: SymbolId,
        node: NodeId,
        right: NodeId,
    ) {
        let a = self.ast;
        let value_declaration = a.sym(prop).value_declaration;
        if value_declaration.is_nil()
            || a.as_source_file(get_source_file_of_node(a, node))
                .is_declaration_file
        {
            return;
        }
        let mut diagnostic = DiagnosticId::NIL;
        let declaration_name = a.text(right);
        if self.is_in_property_initializer_or_class_static_block(node, false)
            && !self.is_optional_property_declaration(value_declaration)
            && !(is_access_expression(a, node) && is_access_expression(a, a.expression(node)))
            && !self.is_block_scoped_name_declared_before_use(value_declaration, right)
            && !(is_method_declaration(a, value_declaration)
                && self
                    .get_combined_modifier_flags_cached(value_declaration)
                    .intersects(ModifierFlags::STATIC))
            && (self.compiler_options.get_use_define_for_class_fields()
                || !self.is_property_declared_in_ancestor_class(prop))
        {
            diagnostic = self.error(
                right,
                diagnostics::PROPERTY_0_IS_USED_BEFORE_ITS_INITIALIZATION,
                &[Arg::Str(declaration_name)],
            );
        } else if is_class_declaration(a, value_declaration)
            && !is_type_reference_node(a, a.parent(node))
            && !a.flags(value_declaration).intersects(NodeFlags::AMBIENT)
            && !self.is_block_scoped_name_declared_before_use(value_declaration, right)
        {
            diagnostic = self.error(
                right,
                diagnostics::CLASS_0_USED_BEFORE_ITS_DECLARATION,
                &[Arg::Str(declaration_name)],
            );
        }
        if !diagnostic.is_nil() {
            let related = self.new_diagnostic_for_node(
                value_declaration,
                diagnostics::X_0_IS_DECLARED_HERE,
                &[Arg::Str(declaration_name)],
            );
            self.diagnostic_store.add_related_info(diagnostic, related);
        }
    }

    pub fn is_optional_property_declaration(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_property_declaration(a, node)
            && !has_accessor_modifier(a, node)
            && is_question_token(a, a.postfix_token(node))
    }

    pub fn is_property_declared_in_ancestor_class(&mut self, prop: SymbolId) -> bool {
        let a = self.ast;
        if a.sym(a.sym(prop).parent)
            .flags
            .intersects(SymbolFlags::CLASS)
        {
            let declared_type = self.get_declared_type_of_symbol(a.sym(prop).parent);
            let base_types = self.get_base_types(declared_type);
            if base_types.len() != 0 {
                let super_property =
                    self.get_property_of_type(base_types.at(0usize), a.sym(prop).name);
                return !super_property.is_nil()
                    && !a.sym(super_property).value_declaration.is_nil();
            }
        }
        false
    }

    // Check whether the requested property access is valid. Returns true if node is a valid property access, and false otherwise. is_super is true if the access is from `super.`, t is the type of the object whose property is being accessed (not the type of the property), and prop is the symbol for the property being accessed.
    pub fn check_property_accessibility(
        &mut self,
        node: NodeId,
        is_super: bool,
        writing: bool,
        t: TypeId,
        prop: SymbolId,
    ) -> bool {
        self.check_property_accessibility_ex(node, is_super, writing, t, prop, true)
    }

    pub fn check_property_accessibility_ex(
        &mut self,
        node: NodeId,
        is_super: bool,
        writing: bool,
        t: TypeId,
        prop: SymbolId,
        report_error: bool,
    ) -> bool {
        let a = self.ast;
        let mut error_node = NodeId::NIL;
        if report_error {
            error_node = match a.kind(node) {
                Kind::PropertyAccessExpression => a.as_property_access_expression(node).name,
                Kind::QualifiedName => a.as_qualified_name(node).right,
                Kind::ImportType => node,
                Kind::BindingElement => get_binding_element_property_name(a, node),
                _ => a.name(node),
            };
        }
        self.check_property_accessibility_at_location(node, is_super, writing, t, prop, error_node)
    }

    // Check whether the requested property can be accessed at the requested location. Returns true if node is a valid property access, and false otherwise. location is the node where we want to check if the property is accessible, is_super is true if the access is from `super.`, writing is true for a write property access, containing_type is the type of the object whose property is being accessed (not the type of the property), prop is the symbol for the property being accessed, and error_node is the node where we should report an invalid property access error, or nil if we should not report errors.
    pub fn check_property_accessibility_at_location(
        &mut self,
        location: NodeId,
        is_super: bool,
        writing: bool,
        containing_type: TypeId,
        prop: SymbolId,
        error_node: NodeId,
    ) -> bool {
        let a = self.ast;
        let flags = get_declaration_modifier_flags_from_symbol_ex(a, prop, writing);
        if is_super {
            // TS 1.0 spec (April 2014): 4.8.2. In a constructor, instance member function, instance member accessor, or instance member variable initializer where this references a derived class instance, a super property access is permitted and must specify a public instance member function of the base class. In a static member function or static member accessor where this references the constructor function object of a derived class, a super property access is permitted and must specify a public static member function of the base class.
            if flags.intersects(ModifierFlags::ABSTRACT) {
                // A method cannot be accessed in a super property access if the method is abstract. This error could mask a private property access error. But, a member cannot simultaneously be private and abstract, so this will trigger an additional error elsewhere.
                if !error_node.is_nil() {
                    let prop_text = self.symbol_to_string(prop);
                    let declaring_class = self.get_declaring_class(prop);
                    let declaring_class_text = self.type_to_string_exported(declaring_class);
                    self.error(
                        error_node,
                        diagnostics::ABSTRACT_METHOD_0_IN_CLASS_1_CANNOT_BE_ACCESSED_VIA_SUPER_EXPRESSION,
                        &[Arg::Str(&prop_text), Arg::Str(&declaring_class_text)],
                    );
                }
                return false;
            }
            // A class field cannot be accessed via super.* from a derived class. This is true for both [[Set]] (old) and [[Define]] (ES spec) semantics.
            if !flags.intersects(ModifierFlags::STATIC)
                && some(a.sym(prop).declarations.as_slice(), |d| {
                    is_class_instance_property(a, d)
                })
            {
                if !error_node.is_nil() {
                    let prop_text = self.symbol_to_string(prop);
                    self.error(
                        error_node,
                        diagnostics::CLASS_FIELD_0_DEFINED_BY_THE_PARENT_CLASS_IS_NOT_ACCESSIBLE_IN_THE_CHILD_CLASS_VIA_SUPER,
                        &[Arg::Str(&prop_text)],
                    );
                }
                return false;
            }
        }
        // Referencing abstract properties within their own constructors is not allowed
        if flags.intersects(ModifierFlags::ABSTRACT)
            && self.symbol_has_non_method_declaration(prop)
            && (is_this_property(a, location)
                || is_this_initialized_object_binding_expression(a, location)
                || is_object_binding_pattern(a, a.parent(location))
                    && is_this_initialized_declaration(a, a.parent(a.parent(location))))
        {
            let parent_symbol = self.get_parent_of_symbol(prop);
            if !parent_symbol.is_nil()
                && a.sym(parent_symbol).flags.intersects(SymbolFlags::CLASS)
                && self.is_node_used_during_class_initialization(location)
            {
                if !error_node.is_nil() {
                    let prop_text = self.symbol_to_string(prop);
                    let parent_symbol_text = self.symbol_to_string(parent_symbol);
                    self.error(
                        error_node,
                        diagnostics::ABSTRACT_PROPERTY_0_IN_CLASS_1_CANNOT_BE_ACCESSED_IN_THE_CONSTRUCTOR,
                        &[Arg::Str(&prop_text), Arg::Str(&parent_symbol_text)],
                    );
                }
                return false;
            }
        }
        // Public properties are otherwise accessible.
        if !flags.intersects(ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER) {
            return true;
        }
        // Property is known to be private or protected at this point. Private property is accessible if the property is within the declaring class
        if flags.intersects(ModifierFlags::PRIVATE) {
            let parent_symbol = self.get_parent_of_symbol(prop);
            let declaring_class_declaration =
                get_class_like_declaration_of_symbol(a, parent_symbol);
            if !self.is_node_within_class(location, declaring_class_declaration) {
                if !error_node.is_nil() {
                    let prop_text = self.symbol_to_string(prop);
                    let declaring_class = self.get_declaring_class(prop);
                    let declaring_class_text = self.type_to_string_exported(declaring_class);
                    self.error(
                        error_node,
                        diagnostics::PROPERTY_0_IS_PRIVATE_AND_ONLY_ACCESSIBLE_WITHIN_CLASS_1,
                        &[Arg::Str(&prop_text), Arg::Str(&declaring_class_text)],
                    );
                }
                return false;
            }
            return true;
        }
        // Property is known to be protected at this point. All protected properties of a supertype are accessible in a super access
        if is_super {
            return true;
        }
        // Find the first enclosing class that has the declaring classes of the protected constituents of the property as base classes
        let mut enclosing_class = TypeId::NIL;
        let mut container = get_containing_class(a, location);
        while !container.is_nil() {
            let container_symbol = self.get_symbol_of_declaration(container);
            let class = self.get_declared_type_of_symbol(container_symbol);
            if self.is_class_derived_from_declaring_classes(class, prop, writing) {
                enclosing_class = class;
                break;
            }
            container = get_containing_class(a, container);
        }
        // A protected property is accessible if the property is within the declaring class or classes derived from it
        if enclosing_class.is_nil() {
            // allow PropertyAccessibility if context is in function with this parameter; static member access is disallowed
            let class = self.get_enclosing_class_from_this_parameter(location);
            if !class.is_nil() && self.is_class_derived_from_declaring_classes(class, prop, writing)
            {
                enclosing_class = class;
            }
            if flags.intersects(ModifierFlags::STATIC) || enclosing_class.is_nil() {
                if !error_node.is_nil() {
                    let mut class = self.get_declaring_class(prop);
                    if class.is_nil() {
                        class = containing_type;
                    }
                    let prop_text = self.symbol_to_string(prop);
                    let class_text = self.type_to_string_exported(class);
                    self.error(
                        error_node,
                        diagnostics::PROPERTY_0_IS_PROTECTED_AND_ONLY_ACCESSIBLE_WITHIN_CLASS_1_AND_ITS_SUBCLASSES,
                        &[Arg::Str(&prop_text), Arg::Str(&class_text)],
                    );
                }
                return false;
            }
        }
        // No further restrictions for static properties
        if flags.intersects(ModifierFlags::STATIC) {
            return true;
        }
        let mut containing_type = containing_type;
        if self.types[containing_type]
            .flags
            .intersects(TypeFlags::TYPE_PARAMETER)
        {
            // get the original type -- represented as the type constraint of the 'this' type
            if self.as_type_parameter(containing_type).is_this_type {
                containing_type = self.get_constraint_of_type_parameter(containing_type);
            } else {
                containing_type = self.get_base_constraint_of_type(containing_type);
            }
        }
        if containing_type.is_nil() || !self.has_base_type(containing_type, enclosing_class) {
            if !error_node.is_nil() && !containing_type.is_nil() {
                let prop_text = self.symbol_to_string(prop);
                let enclosing_class_text = self.type_to_string_exported(enclosing_class);
                let containing_type_text = self.type_to_string_exported(containing_type);
                self.error(
                    error_node,
                    diagnostics::PROPERTY_0_IS_PROTECTED_AND_ONLY_ACCESSIBLE_THROUGH_AN_INSTANCE_OF_CLASS_1_THIS_IS_AN_INSTANCE_OF_CLASS_2,
                    &[
                        Arg::Str(&prop_text),
                        Arg::Str(&enclosing_class_text),
                        Arg::Str(&containing_type_text),
                    ],
                );
            }
            return false;
        }
        true
    }

    pub fn symbol_has_non_method_declaration(&mut self, symbol: SymbolId) -> bool {
        self.for_each_property(symbol, &mut |c, prop| {
            !c.ast.sym(prop).flags.intersects(SymbolFlags::METHOD)
        })
    }

    pub fn is_node_used_during_class_initialization(&self, node: NodeId) -> bool {
        let a = self.ast;
        !find_ancestor_or_quit(a, node, |element| {
            if is_constructor_declaration(a, element) && node_is_present(a, a.body(element))
                || is_property_declaration(a, element)
            {
                return FindAncestorResult::TRUE;
            }
            if is_class_like(a, element) || is_function_like_declaration(a, element) {
                return FindAncestorResult::QUIT;
            }
            FindAncestorResult::FALSE
        })
        .is_nil()
    }

    pub fn is_node_within_class(&self, node: NodeId, class_declaration: NodeId) -> bool {
        self.for_each_enclosing_class(node, |n| n == class_declaration)
    }

    pub fn for_each_enclosing_class(
        &self,
        node: NodeId,
        mut callback: impl FnMut(NodeId) -> bool,
    ) -> bool {
        let a = self.ast;
        let mut containing_class = get_containing_class(a, node);
        while !containing_class.is_nil() {
            let result = callback(containing_class);
            if result {
                return true;
            }
            containing_class = get_containing_class(a, containing_class);
        }
        false
    }

    // Return true if the given class derives from each of the declaring classes of the protected constituents of the given property.
    pub fn is_class_derived_from_declaring_classes(
        &mut self,
        check_class: TypeId,
        prop: SymbolId,
        writing: bool,
    ) -> bool {
        !self.for_each_property(prop, &mut |c, p| {
            if get_declaration_modifier_flags_from_symbol_ex(c.ast, p, writing)
                .intersects(ModifierFlags::PROTECTED)
            {
                let declaring_class = c.get_declaring_class(p);
                return !c.has_base_type(check_class, declaring_class);
            }
            false
        })
    }

    pub fn get_enclosing_class_from_this_parameter(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        // 'this' type for a node comes from, in priority order: 1. The type of a syntactic 'this' parameter in the enclosing function scope
        let this_parameter = get_this_parameter_from_node_context(a, node);
        let mut this_type = TypeId::NIL;
        if !this_parameter.is_nil() && !a.type_node(this_parameter).is_nil() {
            this_type = self.get_type_from_type_node(a.type_node(this_parameter));
        }
        if !this_type.is_nil() {
            // 2. The constraint of a type parameter used for an explicit 'this' parameter
            if self.types[this_type]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER)
            {
                this_type = self.get_constraint_of_type_parameter(this_type);
            }
        } else {
            // 3. The 'this' parameter of a contextual type
            let this_container = get_this_container(a, node, false, false);
            if !this_container.is_nil() && is_function_like(a, this_container) {
                this_type = self.get_contextual_this_parameter_type(this_container);
            }
        }
        if !this_type.is_nil()
            && self.types[this_type]
                .object_flags
                .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
        {
            return get_target_type(self, this_type);
        }
        TypeId::NIL
    }
}

pub fn get_this_parameter_from_node_context(a: Ast<'_>, node: NodeId) -> NodeId {
    let this_container = get_this_container(a, node, false, false);
    if !this_container.is_nil() && is_function_like(a, this_container) {
        return get_this_parameter(a, this_container);
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_contextual_this_parameter_type(&mut self, func: NodeId) -> TypeId {
        let a = self.ast;
        if is_arrow_function(a, func) {
            return TypeId::NIL;
        }
        if self.is_context_sensitive_function_or_object_literal_method(func) {
            let contextual_signature = self.get_contextual_signature(func);
            if !contextual_signature.is_nil() {
                let this_parameter = self.signatures[contextual_signature].this_parameter;
                if !this_parameter.is_nil() {
                    return self.get_type_of_symbol(this_parameter);
                }
            }
        }
        let in_js = is_in_js_file(a, func);
        if self.no_implicit_this || in_js {
            let containing_literal = get_containing_object_literal(a, func);
            if !containing_literal.is_nil() {
                // We have an object literal method. Check if the containing object literal has a contextual type that includes a ThisType<T>. If so, T is the contextual type for 'this'. We continue looking in any directly enclosing object literals.
                let contextual_type = self
                    .get_apparent_type_of_contextual_type(containing_literal, ContextFlags::NONE);
                let this_type = self.get_this_type_of_object_literal_from_contextual_type(
                    containing_literal,
                    contextual_type,
                );
                if !this_type.is_nil() {
                    let context = self.get_inference_context(containing_literal);
                    let mapper = self.get_mapper_from_context(context);
                    return self.instantiate_type(this_type, mapper);
                }
                // There was no contextual ThisType<T> for the containing object literal, so the contextual type for 'this' is the non-null form of the contextual type for the containing object literal or the type of the object literal itself.
                let this_type = if !contextual_type.is_nil() {
                    self.get_non_nullable_type(contextual_type)
                } else {
                    self.check_expression_cached(containing_literal)
                };
                return self.get_widened_type(this_type);
            }
            // In an assignment of the form 'obj.xxx = function(...)' or 'obj[xxx] = function(...)', the contextual type for 'this' is 'obj'.
            let parent = walk_up_parenthesized_expressions(a, a.parent(func));
            if is_assignment_expression(a, parent, false) {
                let target = a.as_binary_expression(parent).left;
                if is_access_expression(a, target) {
                    let expression = a.expression(target);
                    // Don't contextually type `this` as `exports` in `exports.Point = function(x, y) { this.x = x; this.y = y; }`
                    if in_js && is_identifier(a, expression) {
                        let source_file = get_source_file_of_node(a, parent);
                        if !a
                            .as_source_file(source_file)
                            .common_js_module_indicator
                            .is_nil()
                            && a.sym(self.get_resolved_symbol(expression))
                                .flags
                                .intersects(SymbolFlags::MODULE_EXPORTS)
                        {
                            return TypeId::NIL;
                        }
                    }
                    let expression_type = self.check_expression_cached(expression);
                    return self.get_widened_type(expression_type);
                }
            }
        }
        TypeId::NIL
    }

    pub fn check_this_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        // Stop at the first arrow function so that we can tell whether 'this' needs to be captured.
        let mut container = get_this_container(a, node, true, true);
        let mut captured_by_arrow_function = false;
        let mut this_in_computed_property_name = false;
        if is_constructor_declaration(a, container) {
            self.check_this_before_super(
                node,
                container,
                diagnostics::X_SUPER_MUST_BE_CALLED_BEFORE_ACCESSING_THIS_IN_THE_CONSTRUCTOR_OF_A_DERIVED_CLASS,
            );
        }
        loop {
            // Now skip arrow functions to get the "real" owner of 'this'.
            if is_arrow_function(a, container) {
                container =
                    get_this_container(a, container, false, !this_in_computed_property_name);
                captured_by_arrow_function = true;
            }
            if is_computed_property_name(a, container) {
                container = get_this_container(a, container, !captured_by_arrow_function, false);
                this_in_computed_property_name = true;
                continue;
            }
            break;
        }
        self.check_this_in_static_class_field_initializer_in_decorated_class(node, container);
        if this_in_computed_property_name {
            self.error(
                node,
                diagnostics::X_THIS_CANNOT_BE_REFERENCED_IN_A_COMPUTED_PROPERTY_NAME,
                &[],
            );
        } else {
            match a.kind(container) {
                Kind::ModuleDeclaration => {
                    // do not return here so in case if lexical this is captured - it will be reflected in flags on NodeLinks
                    self.error(
                        node,
                        diagnostics::X_THIS_CANNOT_BE_REFERENCED_IN_A_MODULE_OR_NAMESPACE_BODY,
                        &[],
                    );
                }
                Kind::EnumDeclaration => {
                    self.error(
                        node,
                        diagnostics::X_THIS_CANNOT_BE_REFERENCED_IN_CURRENT_LOCATION,
                        &[],
                    );
                }
                _ => {}
            }
        }
        let t = self.try_get_this_type_at_ex(node, true, container);
        if self.no_implicit_this {
            let global_this_symbol = self.global_this_symbol;
            let global_this_type = self.get_type_of_symbol(global_this_symbol);
            if t == global_this_type && captured_by_arrow_function {
                self.error(
                    node,
                    diagnostics::THE_CONTAINING_ARROW_FUNCTION_CAPTURES_THE_GLOBAL_VALUE_OF_THIS,
                    &[],
                );
            } else if t.is_nil() {
                // With noImplicitThis, functions may not reference 'this' if it has type 'any'
                let diag = self.error(
                    node,
                    diagnostics::X_THIS_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_TYPE_ANNOTATION,
                    &[],
                );
                if !is_source_file(a, container) {
                    let outside_this = self.try_get_this_type_at(container);
                    if !outside_this.is_nil() && outside_this != global_this_type {
                        let related = self.create_diagnostic_for_node(
                            container,
                            diagnostics::AN_OUTER_VALUE_OF_THIS_IS_SHADOWED_BY_THIS_CONTAINER,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(diag, related);
                    }
                }
            }
        }
        if t.is_nil() {
            return self.any_type;
        }
        t
    }

    pub fn try_get_this_type_at(&mut self, node: NodeId) -> TypeId {
        self.try_get_this_type_at_ex(node, true, NodeId::NIL)
    }

    pub fn try_get_this_type_at_ex_exported(
        &mut self,
        node: NodeId,
        include_global_this: bool,
        container: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let reparsed = get_reparsed_node_for_node(a, node);
        if a.flags(reparsed).intersects(NodeFlags::JSDOC)
            && !a.flags(reparsed).intersects(NodeFlags::REPARSED)
        {
            // Binder doesn't process non-reparsed JSDoc nodes
            return TypeId::NIL;
        }
        self.try_get_this_type_at_ex(
            reparsed,
            include_global_this,
            get_reparsed_node_for_node(a, container),
        )
    }

    pub fn try_get_this_type_at_ex(
        &mut self,
        node: NodeId,
        include_global_this: bool,
        container: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let mut container = container;
        if container.is_nil() {
            container = self.get_this_container(node, false, false);
        }
        if is_function_like(a, container)
            && (!self.is_in_parameter_initializer_before_containing_function(node)
                || !get_this_parameter(a, container).is_nil())
        {
            let mut sig = self.get_signature_of_full_signature_type(container);
            if sig.is_nil() {
                sig = self.get_signature_from_declaration(container);
            }
            let mut this_type = self.get_this_type_of_signature(sig);
            // Note: a parameter initializer should refer to class-this unless function-this is explicitly annotated. If this is a function in a JS file, it might be a class method.
            if this_type.is_nil() {
                this_type = self.get_contextual_this_parameter_type(container);
            }
            if !this_type.is_nil() {
                return self.get_flow_type_of_reference(node, this_type);
            }
        }
        if !a.parent(container).is_nil() && is_class_like(a, a.parent(container)) {
            let symbol = self.get_symbol_of_declaration(a.parent(container));
            let t = if is_static(a, container) {
                self.get_type_of_symbol(symbol)
            } else {
                let declared_type = self.get_declared_type_of_symbol(symbol);
                if self.has_interface_type(declared_type) {
                    self.as_interface_type(declared_type).this_type
                } else {
                    // Upstream reads thisType through a nil InterfaceType here.
                    self.fail("nil InterfaceType in tryGetThisTypeAtEx")
                }
            };
            return self.get_flow_type_of_reference(node, t);
        }
        if is_source_file(a, container) {
            // look up in the source file's locals or exports
            if !a
                .as_source_file(container)
                .external_module_indicator
                .is_nil()
            {
                return self.undefined_type;
            }
            if include_global_this {
                let global_this_symbol = self.global_this_symbol;
                return self.get_type_of_symbol(global_this_symbol);
            }
        }
        TypeId::NIL
    }

    pub fn get_this_container(
        &self,
        node: NodeId,
        include_arrow_functions: bool,
        include_class_computed_property_name: bool,
    ) -> NodeId {
        let a = self.ast;
        let mut node = node;
        loop {
            let parent = a.parent(node);
            if parent.is_nil() {
                // If we never pass in a SourceFile, this should be unreachable, since we'll stop when we reach that. Upstream panics here: the last node of the parent chain is returned.
                let _: () = self.fail("No parent in getThisContainer");
                return node;
            }
            node = parent;
            match a.kind(node) {
                Kind::ComputedPropertyName => {
                    // If the grandparent node is an object literal (as opposed to a class), then the computed property is not a 'this' container. A computed property name in a class needs to be a this container so that we can error on it.
                    if include_class_computed_property_name
                        && is_class_like(a, a.parent(a.parent(node)))
                    {
                        return node;
                    }
                    // If this is a computed property, then the parent should not make it a this container. The parent might be a property in an object literal, like a method or accessor. But in order for such a parent to be a this container, the reference must be in the *body* of the container.
                    node = a.parent(a.parent(node));
                }
                Kind::Decorator => {
                    // Decorators are always applied outside of the body of a class or method.
                    if a.kind(a.parent(node)) == Kind::Parameter
                        && is_class_element(a, a.parent(a.parent(node)))
                    {
                        // If the decorator's parent is a Parameter, we resolve the this container from the grandparent class declaration.
                        node = a.parent(a.parent(node));
                    } else if is_class_element(a, a.parent(node)) {
                        // If the decorator's parent is a class element, we resolve the 'this' container from the parent class declaration.
                        node = a.parent(node);
                    }
                }
                Kind::ArrowFunction => {
                    if include_arrow_functions {
                        return node;
                    }
                }
                Kind::FunctionDeclaration
                | Kind::FunctionExpression
                | Kind::ModuleDeclaration
                | Kind::ClassStaticBlockDeclaration
                | Kind::PropertyDeclaration
                | Kind::PropertySignature
                | Kind::MethodDeclaration
                | Kind::MethodSignature
                | Kind::Constructor
                | Kind::GetAccessor
                | Kind::SetAccessor
                | Kind::CallSignature
                | Kind::ConstructSignature
                | Kind::IndexSignature
                | Kind::EnumDeclaration
                | Kind::SourceFile => return node,
                _ => {}
            }
        }
    }

    pub fn is_in_parameter_initializer_before_containing_function(&self, node: NodeId) -> bool {
        let a = self.ast;
        let mut node = node;
        let mut in_binding_initializer = false;
        while !a.parent(node).is_nil() && !is_function_like(a, a.parent(node)) {
            if is_parameter_declaration(a, a.parent(node)) {
                if in_binding_initializer || a.initializer(a.parent(node)) == node {
                    return true;
                }
            }
            if is_binding_element(a, a.parent(node)) && a.initializer(a.parent(node)) == node {
                in_binding_initializer = true;
            }
            node = a.parent(node);
        }
        false
    }

    pub fn check_this_in_static_class_field_initializer_in_decorated_class(
        &mut self,
        this_expression: NodeId,
        container: NodeId,
    ) {
        let a = self.ast;
        if is_property_declaration(a, container)
            && has_static_modifier(a, container)
            && self.legacy_decorators
        {
            let initializer = a.initializer(container);
            if !initializer.is_nil()
                && a.loc(initializer)
                    .contains_inclusive(a.pos(this_expression))
                && has_decorators(a, a.parent(container))
            {
                self.error(
                    this_expression,
                    diagnostics::CANNOT_USE_THIS_IN_A_STATIC_PROPERTY_INITIALIZER_OF_A_DECORATED_CLASS,
                    &[],
                );
            }
        }
    }

    pub fn check_this_before_super(
        &mut self,
        node: NodeId,
        container: NodeId,
        diagnostic_message: MessageId,
    ) {
        let a = self.ast;
        let containing_class_decl = a.parent(container);
        let base_type_node = get_class_extends_heritage_element(a, containing_class_decl);
        // If a containing class does not have extends clause or the class extends null skip checking whether super statement is called before "this" accessing.
        if !base_type_node.is_nil() && !self.class_declaration_extends_null(containing_class_decl) {
            if a.has_flow_node_data(node) && !self.is_post_super_flow_node(a.flow_node(node), false)
            {
                self.error(node, diagnostic_message, &[]);
            }
        }
    }

    // Check if the given class-declaration extends null then return true. Otherwise, return false
    pub fn class_declaration_extends_null(&mut self, class_decl: NodeId) -> bool {
        let class_symbol = self.get_symbol_of_declaration(class_decl);
        let class_instance_type = self.get_declared_type_of_symbol(class_symbol);
        let base_constructor_type = self.get_base_constructor_type_of_class(class_instance_type);
        base_constructor_type == self.null_widening_type
    }
}
