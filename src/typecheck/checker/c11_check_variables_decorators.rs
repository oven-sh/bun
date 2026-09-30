// checker.go:5854-6183 (layers D-VAR, D-DECOR): variable statements, declaration lists, variable-like declarations and the checks of decorators.
use crate::ast::{
    Arg, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId, can_have_decorators, find_ancestor_kind,
    get_combined_node_flags, get_containing_function, get_name_of_declaration, has_decorators,
    is_accessor, is_array_binding_pattern, is_auto_accessor_property_declaration,
    is_big_int_literal, is_binding_element, is_binding_pattern, is_block, is_class_declaration,
    is_class_expression, is_computed_property_name, is_decorator, is_for_in_statement,
    is_function_like, is_identifier, is_method_declaration, is_module_block, is_module_declaration,
    is_object_binding_pattern, is_parameter_declaration, is_part_of_parameter_declaration,
    is_private_identifier, is_property_declaration, is_property_signature_declaration,
    is_source_file, is_variable_declaration, is_variable_declaration_initialized_to_require,
    is_variable_like, is_variable_statement, node_can_be_decorated, node_is_missing,
};
use crate::checker::{
    CheckMode, Checker, ExternalEmitHelpers, IterationUse, LANGUAGE_FEATURE_MINIMUM_TARGET,
    ReferenceHint, TypeFlags, TypeId, get_property_name_from_type, has_dot_dot_dot_token,
    is_in_ambient_or_type_node, is_type_usable_as_property_name,
};
use crate::diagnostics::{self, MessageId};
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn check_variable_statement(&mut self, node: NodeId) {
        let declaration_list = self.ast.as_variable_statement(node).declaration_list;
        if !self.check_grammar_modifiers(node)
            && !self.check_grammar_variable_declaration_list(declaration_list)
        {
            self.check_grammar_for_disallowed_block_scoped_variable_statement(node);
        }
        self.check_variable_declaration_list(declaration_list);
    }

    pub fn check_variable_declaration_list(&mut self, node: NodeId) {
        let a = self.ast;
        let block_scope_kind = get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED;
        if (block_scope_kind == NodeFlags::USING || block_scope_kind == NodeFlags::AWAIT_USING)
            && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.using_and_await_using
        {
            self.check_external_emit_helpers(
                node,
                ExternalEmitHelpers::ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES,
            );
        }
        self.check_source_elements(a.nodes(a.as_variable_declaration_list(node).declarations));
    }

    pub fn check_variable_declaration(&mut self, node: NodeId) {
        self.check_grammar_variable_declaration(node);
        self.check_variable_like_declaration(node);
    }

    // Check variable, parameter, or property declaration
    pub fn check_variable_like_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_decorators(node);
        let name = a.name(node);
        if name.is_nil() {
            // Missing array binding elements have no name
            return;
        }
        let type_node = a.type_node(node);
        let initializer = a.initializer(node);
        if !is_binding_element(a, node) {
            self.check_source_element(type_node);
        }
        // For a computed property, just check the initializer and exit. Do not use hasDynamicName here, because that returns false for well known symbols. We want to perform checkComputedPropertyName for all computed properties, including well known symbols.
        if is_computed_property_name(a, name) {
            self.check_computed_property_name(name);
            if !initializer.is_nil() {
                self.check_expression_cached(initializer);
            }
        }
        if is_binding_element(a, node) {
            let prop_name = a.property_name(node);
            if !prop_name.is_nil()
                && is_identifier(a, a.name(node))
                && is_part_of_parameter_declaration(a, node)
                && node_is_missing(a, a.body(get_containing_function(a, node)))
            {
                // In `type F = ({a: string}) => void;` the variable renaming in function type notation is confusing, so we forbid it even if noUnusedLocals is not enabled
                self.renamed_binding_elements_in_types.push(node);
                return;
            }
            if is_object_binding_pattern(a, a.parent(node))
                && has_dot_dot_dot_token(a, node)
                && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.object_spread_rest
            {
                self.check_external_emit_helpers(node, ExternalEmitHelpers::REST);
            }
            // check computed properties inside property names of binding elements
            if !prop_name.is_nil() && is_computed_property_name(a, prop_name) {
                self.check_computed_property_name(prop_name);
            }
            // check private/protected variable access
            let parent = a.parent(a.parent(node));
            let parent_check_mode = if has_dot_dot_dot_token(a, node) {
                CheckMode::REST_BINDING_ELEMENT
            } else {
                CheckMode::NORMAL
            };
            let parent_type = self.get_type_for_binding_element_parent(parent, parent_check_mode);
            let prop_name_name = a.property_name_or_name(node);
            if !parent_type.is_nil() && !is_binding_pattern(a, prop_name_name) {
                let expr_type = self.get_literal_type_from_property_name(prop_name_name);
                if is_type_usable_as_property_name(self, expr_type) {
                    let name_text = get_property_name_from_type(self, expr_type);
                    let property = self.get_property_of_type(parent_type, &name_text);
                    if !property.is_nil() {
                        self.mark_property_as_referenced(property, NodeId::NIL, false);
                        // A destructuring is never a write-only reference.
                        self.check_property_accessibility(
                            node,
                            !a.initializer(parent).is_nil()
                                && a.kind(a.initializer(parent)) == Kind::SuperKeyword,
                            false,
                            parent_type,
                            property,
                        );
                    }
                }
            }
        }
        // For a binding pattern, check contained binding elements
        if is_binding_pattern(a, name) {
            self.check_source_elements(a.elements(name));
        }
        // For a parameter declaration with an initializer, error and exit if the containing function doesn't have a body
        if !initializer.is_nil()
            && is_part_of_parameter_declaration(a, node)
            && node_is_missing(a, a.body(get_containing_function(a, node)))
        {
            self.error(
                node,
                diagnostics::A_PARAMETER_INITIALIZER_IS_ONLY_ALLOWED_IN_A_FUNCTION_OR_CONSTRUCTOR_IMPLEMENTATION,
                &[],
            );
            return;
        }
        // For a binding pattern, validate the initializer and exit
        if is_binding_pattern(a, name) {
            if is_in_ambient_or_type_node(a, node) {
                return;
            }
            let need_check_initializer =
                !initializer.is_nil() && a.kind(a.parent(a.parent(node))) != Kind::ForInStatement;
            let need_check_widened_type = !a
                .elements(name)
                .as_slice()
                .iter()
                .any(|&element| !a.name(element).is_nil());
            if need_check_initializer || need_check_widened_type {
                // Don't validate for-in initializer as it is already an error
                let widened_type = self.get_widened_type_for_variable_like_declaration(node, false);
                if need_check_initializer {
                    let initializer_type = self.check_expression_cached(initializer);
                    if self.strict_null_checks && need_check_widened_type {
                        self.check_non_null_non_void_type(initializer_type, node);
                    } else {
                        let declared_type =
                            self.get_widened_type_for_variable_like_declaration(node, false);
                        self.check_type_assignable_to_and_optionally_elaborate(
                            initializer_type,
                            declared_type,
                            node,
                            initializer,
                            MessageId::NIL,
                            None,
                        );
                    }
                }
                // check the binding pattern with empty elements
                if need_check_widened_type {
                    if is_array_binding_pattern(a, name) {
                        self.check_iterated_type_or_element_type(
                            IterationUse::DESTRUCTURING,
                            widened_type,
                            self.undefined_type,
                            node,
                        );
                    } else if self.strict_null_checks {
                        self.check_non_null_non_void_type(widened_type, node);
                    }
                }
            }
            return;
        }
        // For a commonjs `const x = require`, validate the alias and exit
        let symbol = self.get_symbol_of_declaration(node);
        if a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
            && is_variable_declaration_initialized_to_require(a, node)
        {
            self.check_alias_symbol(node);
            return;
        }
        if is_big_int_literal(a, name) {
            self.error(
                name,
                diagnostics::A_BIGINT_LITERAL_CANNOT_BE_USED_AS_A_PROPERTY_NAME,
                &[],
            );
        }
        let symbol_type = self.get_type_of_symbol(symbol);
        let t = self.convert_auto_to_any(symbol_type);
        if node == a.sym(symbol).value_declaration {
            // Node is the primary declaration of the symbol, just validate the initializer. Don't validate for-in initializer as it is already an error
            if !initializer.is_nil() && !is_for_in_statement(a, a.parent(a.parent(node))) {
                let initializer_type = self.check_expression_cached(initializer);
                self.check_type_assignable_to_and_optionally_elaborate(
                    initializer_type,
                    t,
                    node,
                    initializer,
                    MessageId::NIL,
                    None,
                );
                let block_scope_kind =
                    self.get_combined_node_flags_cached(node) & NodeFlags::BLOCK_SCOPED;
                if block_scope_kind == NodeFlags::AWAIT_USING {
                    let global_async_disposable_type = self.get_global_async_disposable_type();
                    let global_disposable_type = self.get_global_disposable_type();
                    if global_async_disposable_type != self.empty_object_type
                        && global_disposable_type != self.empty_object_type
                    {
                        let constituents = self.list_of(&[
                            global_async_disposable_type,
                            global_disposable_type,
                            self.null_type,
                            self.undefined_type,
                        ]);
                        let optional_disposable_type = self.get_union_type(constituents);
                        let widened_initializer_type = self
                            .widen_type_for_variable_like_declaration(
                                initializer_type,
                                node,
                                false,
                            );
                        self.check_type_assignable_to(widened_initializer_type, optional_disposable_type, initializer, diagnostics::THE_INITIALIZER_OF_AN_AWAIT_USING_DECLARATION_MUST_BE_EITHER_AN_OBJECT_WITH_A_SYMBOL_ASYNCDISPOSE_OR_SYMBOL_DISPOSE_METHOD_OR_BE_NULL_OR_UNDEFINED);
                    }
                } else if block_scope_kind == NodeFlags::USING {
                    let global_disposable_type = self.get_global_disposable_type();
                    if global_disposable_type != self.empty_object_type {
                        let constituents = self.list_of(&[
                            global_disposable_type,
                            self.null_type,
                            self.undefined_type,
                        ]);
                        let optional_disposable_type = self.get_union_type(constituents);
                        let widened_initializer_type = self
                            .widen_type_for_variable_like_declaration(
                                initializer_type,
                                node,
                                false,
                            );
                        self.check_type_assignable_to(widened_initializer_type, optional_disposable_type, initializer, diagnostics::THE_INITIALIZER_OF_A_USING_DECLARATION_MUST_BE_EITHER_AN_OBJECT_WITH_A_SYMBOL_DISPOSE_METHOD_OR_BE_NULL_OR_UNDEFINED);
                    }
                }
            }
            let declarations = a.sym(symbol).declarations;
            if declarations.len() > 1 {
                if declarations.as_slice().iter().any(|&d| {
                    d != node
                        && is_variable_like(a, d)
                        && !self.are_declaration_flags_identical(d, node)
                }) {
                    let name_text = declaration_name_to_string(a, name);
                    self.error(
                        name,
                        diagnostics::ALL_DECLARATIONS_OF_0_MUST_HAVE_IDENTICAL_MODIFIERS,
                        &[Arg::Str(&name_text)],
                    );
                }
            }
        } else {
            // Node is a secondary declaration, check that type is identical to primary declaration and check that initializer is consistent with type associated with the node
            let widened_type = self.get_widened_type_for_variable_like_declaration(node, false);
            let declaration_type = self.convert_auto_to_any(widened_type);
            if !self.is_error_type(t)
                && !self.is_error_type(declaration_type)
                && !self.is_type_identical_to(t, declaration_type)
                && !a.sym(symbol).flags.intersects(SymbolFlags::ASSIGNMENT)
            {
                self.error_next_variable_or_property_declaration_must_have_same_type(
                    a.sym(symbol).value_declaration,
                    t,
                    node,
                    declaration_type,
                );
            }
            if !initializer.is_nil() {
                let initializer_type = self.check_expression_cached(initializer);
                self.check_type_assignable_to_and_optionally_elaborate(
                    initializer_type,
                    declaration_type,
                    node,
                    initializer,
                    MessageId::NIL,
                    None,
                );
            }
            let value_declaration = a.sym(symbol).value_declaration;
            if !value_declaration.is_nil()
                && !self.are_declaration_flags_identical(node, value_declaration)
            {
                let name_text = declaration_name_to_string(a, name);
                self.error(
                    name,
                    diagnostics::ALL_DECLARATIONS_OF_0_MUST_HAVE_IDENTICAL_MODIFIERS,
                    &[Arg::Str(&name_text)],
                );
            }
        }
        if !is_property_declaration(a, node) && !is_property_signature_declaration(a, node) {
            // We know we don't have a binding pattern or computed name here
            self.check_exports_on_merged_declarations(node);
            if is_variable_declaration(a, node) || is_binding_element(a, node) {
                self.check_var_declared_names_not_shadowed(node);
            }
            self.check_collisions_for_declaration_name(node, a.name(node));
        }
    }

    pub fn error_next_variable_or_property_declaration_must_have_same_type(
        &mut self,
        first_declaration: NodeId,
        first_type: TypeId,
        next_declaration: NodeId,
        next_type: TypeId,
    ) {
        let a = self.ast;
        let next_declaration_name = get_name_of_declaration(a, next_declaration);
        let message = if is_property_declaration(a, next_declaration)
            || is_property_signature_declaration(a, next_declaration)
        {
            diagnostics::SUBSEQUENT_PROPERTY_DECLARATIONS_MUST_HAVE_THE_SAME_TYPE_PROPERTY_0_MUST_BE_OF_TYPE_1_BUT_HERE_HAS_TYPE_2
        } else {
            diagnostics::SUBSEQUENT_VARIABLE_DECLARATIONS_MUST_HAVE_THE_SAME_TYPE_VARIABLE_0_MUST_BE_OF_TYPE_1_BUT_HERE_HAS_TYPE_2
        };
        let decl_name = declaration_name_to_string(a, next_declaration_name);
        let first_type_name = self.type_to_string_exported(first_type);
        let next_type_name = self.type_to_string_exported(next_type);
        let err = self.error(
            next_declaration_name,
            message,
            &[
                Arg::Str(&decl_name),
                Arg::Str(&first_type_name),
                Arg::Str(&next_type_name),
            ],
        );
        if !first_declaration.is_nil() {
            let related = self.create_diagnostic_for_node(
                first_declaration,
                diagnostics::X_0_WAS_ALSO_DECLARED_HERE,
                &[Arg::Str(&decl_name)],
            );
            self.diagnostic_store.add_related_info(err, related);
        }
    }

    pub fn check_var_declared_names_not_shadowed(&mut self, node: NodeId) {
        let a = self.ast;
        // For `ScriptBody : StatementList` and `Block : { StatementList }` it is a Syntax Error if any element of the LexicallyDeclaredNames of StatementList also occurs in the VarDeclaredNames of StatementList. Variable declarations are hoisted to the top of their function scope. They can shadow block scoped declarations, which bind tighter. this will not be flagged as duplicate definition by the binder as the declaration scope is different. A non-initialized declaration is a no-op as the block declaration will resolve before the var declaration. the problem is if the declaration has an initializer. this will act as a write to the block declared value. this is fine for let, but not const. Only consider declarations with initializers, uninitialized const declarations will not step on a let/const variable. Do not consider const and const declarations, as duplicate block-scoped declarations are handled by the binder. We are only looking for const declarations that step on let\const declarations from a different scope, e.g. in `{ const x = 0; const x = 0; }` the localDeclarationSymbol obtained after name resolution will correspond to the first declaration and the symbol for the second declaration will be 'symbol'.
        if self
            .get_combined_node_flags_cached(node)
            .intersects(NodeFlags::BLOCK_SCOPED)
            || is_part_of_parameter_declaration(a, node)
        {
            // skip block-scoped variables and parameters
            return;
        }
        // NOTE: in ES6 spec initializer is required in variable declarations where name is binding pattern so we'll always treat binding elements as initialized
        let symbol = self.get_symbol_of_declaration(node);
        let name = a.name(node);
        if a.sym(symbol)
            .flags
            .intersects(SymbolFlags::FUNCTION_SCOPED_VARIABLE)
        {
            if !is_identifier(a, name) {
                return self.fail("Identifier expected");
            }
            let local_declaration_symbol = self.resolve_name(
                node,
                a.text(name),
                SymbolFlags::VARIABLE,
                MessageId::NIL,
                false,
                false,
            );
            if !local_declaration_symbol.is_nil()
                && local_declaration_symbol != symbol
                && a.sym(local_declaration_symbol)
                    .flags
                    .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
            {
                if self
                    .get_declaration_node_flags_from_symbol(local_declaration_symbol)
                    .intersects(NodeFlags::BLOCK_SCOPED)
                {
                    let var_decl_list = find_ancestor_kind(
                        a,
                        a.sym(local_declaration_symbol).value_declaration,
                        Kind::VariableDeclarationList,
                    );
                    if var_decl_list.is_nil() {
                        // Upstream reads the parent of the list without a nil test.
                        return self.fail("no enclosing variable declaration list in checkVarDeclaredNamesNotShadowed");
                    }
                    let mut container = NodeId::NIL;
                    if is_variable_statement(a, a.parent(var_decl_list))
                        && !a.parent(a.parent(var_decl_list)).is_nil()
                    {
                        container = a.parent(a.parent(var_decl_list));
                    }
                    // names of block-scoped and function scoped variables can collide only if block scoped variable is defined in the function\module\source file scope (because of variable hoisting)
                    let names_share_scope = !container.is_nil()
                        && (is_block(a, container) && is_function_like(a, a.parent(container))
                            || is_module_block(a, container)
                            || is_module_declaration(a, container)
                            || is_source_file(a, container));
                    // here we know that function scoped variable is "shadowed" by block scoped one: a var declaration can't hoist past a lexical declaration and it results in a SyntaxError at runtime
                    if !names_share_scope {
                        let name = self.symbol_to_string(local_declaration_symbol);
                        self.error(node, diagnostics::CANNOT_INITIALIZE_OUTER_SCOPED_VARIABLE_0_IN_THE_SAME_SCOPE_AS_BLOCK_SCOPED_DECLARATION_1, &[Arg::Str(&name), Arg::Str(&name)]);
                    }
                }
            }
        }
    }

    pub fn check_decorators(&mut self, node: NodeId) {
        let a = self.ast;
        // skip this check for nodes that cannot have decorators. These should have already had an error reported by checkGrammarModifiers.
        if !can_have_decorators(a, node)
            || !has_decorators(a, node)
            || !node_can_be_decorated(
                a,
                self.legacy_decorators,
                node,
                a.parent(node),
                a.parent(a.parent(node)),
            )
        {
            return;
        }
        let first_decorator = a
            .modifier_nodes(node)
            .as_slice()
            .iter()
            .copied()
            .find(|&modifier| is_decorator(a, modifier))
            .unwrap_or(NodeId::NIL);
        if first_decorator.is_nil() {
            return;
        }
        if self.legacy_decorators {
            self.check_external_emit_helpers(first_decorator, ExternalEmitHelpers::DECORATE);
            if is_parameter_declaration(a, node) {
                self.check_external_emit_helpers(first_decorator, ExternalEmitHelpers::PARAM);
            }
        } else if self.language_version
            < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators
        {
            self.check_external_emit_helpers(
                first_decorator,
                ExternalEmitHelpers::ES_DECORATE_AND_RUN_INITIALIZERS,
            );
            if is_class_declaration(a, node) {
                if a.name(node).is_nil()
                    || !self
                        .get_first_transformable_static_class_element(node)
                        .is_nil()
                {
                    self.check_external_emit_helpers(
                        first_decorator,
                        ExternalEmitHelpers::SET_FUNCTION_NAME,
                    );
                }
            } else if !is_class_expression(a, node) {
                let name = a.name(node);
                if is_private_identifier(a, name)
                    && (is_method_declaration(a, node)
                        || is_accessor(a, node)
                        || is_auto_accessor_property_declaration(a, node))
                {
                    self.check_external_emit_helpers(
                        first_decorator,
                        ExternalEmitHelpers::SET_FUNCTION_NAME,
                    );
                }
                if is_computed_property_name(a, name) {
                    self.check_external_emit_helpers(
                        first_decorator,
                        ExternalEmitHelpers::PROP_KEY,
                    );
                }
            }
        }
        self.mark_linked_references(node, ReferenceHint::DECORATOR, SymbolId::NIL, TypeId::NIL);
        for &modifier in a.modifier_nodes(node).as_slice() {
            if is_decorator(a, modifier) {
                self.check_decorator(modifier);
            }
        }
    }

    pub fn check_decorator(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_decorator(node);
        let signature = self.get_resolved_signature(node, None, CheckMode::NORMAL);
        self.check_deprecated_signature(signature, node);
        let return_type = self.get_return_type_of_signature(signature);
        if self.types[return_type].flags.intersects(TypeFlags::ANY) {
            return;
        }
        // if we fail to get a signature and return type here, we will have already reported a grammar error in `checkDecorators`.
        let decorator_signature = self.get_decorator_call_signature(node);
        if decorator_signature.is_nil()
            || self.signatures[decorator_signature]
                .resolved_return_type
                .is_nil()
        {
            return;
        }
        let expected_return_type = self.signatures[decorator_signature].resolved_return_type;
        let head_message = match a.kind(a.parent(node)) {
            Kind::ClassDeclaration | Kind::ClassExpression => {
                diagnostics::DECORATOR_FUNCTION_RETURN_TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1
            }
            Kind::PropertyDeclaration if !self.legacy_decorators => {
                diagnostics::DECORATOR_FUNCTION_RETURN_TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1
            }
            Kind::PropertyDeclaration | Kind::Parameter => {
                diagnostics::DECORATOR_FUNCTION_RETURN_TYPE_IS_0_BUT_IS_EXPECTED_TO_BE_VOID_OR_ANY
            }
            Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                diagnostics::DECORATOR_FUNCTION_RETURN_TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1
            }
            _ => return self.fail("Unhandled case in checkDecorator"),
        };
        self.check_type_assignable_to(
            return_type,
            expected_return_type,
            a.expression(node),
            head_message,
        );
    }
}
