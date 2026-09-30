// checker.go:2202-2660 (layers D-DRIVER, D-JSDOC, D-TYPENODE): the driver of a file check, unreachable code, deferred nodes, JSDoc links, type parameters.
use crate::ast::{
    Arg, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags, SymbolId,
    get_host_signature_from_jsdoc, get_source_file_of_node, is_class_like, is_entity_name,
    is_enum_const, is_external_or_common_js_module, is_in_js_file, is_instance_of_expression,
    is_instantiated_module, is_interface_declaration, is_jsdoc_non_nullable_type,
    is_jsdoc_nullable_type, is_potentially_executable_node, is_qualified_name,
    is_type_or_js_type_alias_declaration,
};
use crate::checker::{Checker, ObjectFlags, TypeFlags, TypeId, new_simple_type_mapper};
use crate::collections::OrderedSet;
use crate::core::{List, Tristate, new_text_range};
use crate::diagnostics;
use crate::scanner::get_token_pos_of_node;

impl<'a> Checker<'a> {
    pub fn check_source_file(&mut self, source_file: NodeId, check_unused: bool) {
        let a = self.ast;
        let links = self.source_file_links.get(source_file);
        if !self.source_file_links[links].type_checked {
            // Grammar checking
            self.check_grammar_source_file(source_file);
            self.renamed_binding_elements_in_types = Vec::new();
            self.check_source_elements(a.nodes(a.as_source_file(source_file).statements));
            self.check_deferred_nodes(source_file);
            if is_external_or_common_js_module(a, source_file) {
                self.check_external_module_exports(source_file);
                self.register_for_unused_identifiers_check(source_file);
            }
            if !a.as_source_file(source_file).is_declaration_file && !self.is_canceled() {
                self.check_unused_renamed_binding_elements();
            }
            self.produce_deferred_diagnostics();
            self.reported_unreachable_nodes.clear();
            self.source_file_links[links].type_checked = true;
        }
        if check_unused && !self.source_file_links[links].unused_checked {
            // The unused identifiers check relies on a full type check having first been performed
            if !a.as_source_file(source_file).is_declaration_file && !self.is_canceled() {
                let identifier_check_nodes =
                    self.source_file_links[links].identifier_check_nodes.clone();
                self.check_unused_identifiers(&identifier_check_nodes);
            }
            self.source_file_links[links].unused_checked = true;
        }
        if self.is_canceled() {
            self.was_canceled = true;
        }
    }

    pub fn check_source_elements(&mut self, nodes: List<'a, NodeId>) {
        for &node in nodes.as_slice() {
            if self.is_canceled() {
                break;
            }
            self.check_source_element(node);
        }
    }

    pub fn check_source_element(&mut self, node: NodeId) -> bool {
        if !node.is_nil() {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            let save_current_node = self.current_node;
            let save_within_unreachable_code = self.within_unreachable_code;
            self.current_node = node;
            self.instantiation_count = 0;
            self.check_source_element_worker(node);
            self.current_node = save_current_node;
            self.within_unreachable_code = save_within_unreachable_code;
        }
        false
    }

    pub fn check_source_element_worker(&mut self, node: NodeId) {
        let a = self.ast;
        for &jsdoc in a.eager_jsdoc(node).as_slice() {
            self.check_jsdoc_comments(jsdoc);
            let tags = a.as_jsdoc(jsdoc).tags;
            if !tags.is_nil() {
                for &tag in a.nodes(tags).as_slice() {
                    self.check_jsdoc_comments(tag);
                }
            }
        }

        if !self.within_unreachable_code
            && self.compiler_options.allow_unreachable_code != Tristate::TRUE
        {
            if self.check_source_element_unreachable(node) {
                self.within_unreachable_code = true;
            }
        }

        match a.kind(node) {
            Kind::TypeParameter => self.check_type_parameter(node),
            Kind::Parameter => self.check_parameter(node),
            Kind::PropertyDeclaration => self.check_property_declaration(node),
            Kind::PropertySignature => self.check_property_signature(node),
            Kind::ConstructorType
            | Kind::FunctionType
            | Kind::CallSignature
            | Kind::ConstructSignature
            | Kind::IndexSignature => self.check_signature_declaration(node),
            Kind::MethodDeclaration | Kind::MethodSignature => self.check_method_declaration(node),
            Kind::ClassStaticBlockDeclaration => self.check_class_static_block_declaration(node),
            Kind::Constructor => self.check_constructor_declaration(node),
            Kind::GetAccessor | Kind::SetAccessor => self.check_accessor_declaration(node),
            Kind::TypeReference => self.check_type_reference_node(node),
            Kind::TypePredicate => self.check_type_predicate(node),
            Kind::TypeQuery => self.check_type_query(node),
            Kind::TypeLiteral => self.check_type_literal(node),
            Kind::ArrayType => self.check_array_type(node),
            Kind::TupleType => self.check_tuple_type(node),
            Kind::UnionType | Kind::IntersectionType => self.check_union_or_intersection_type(node),
            Kind::ParenthesizedType | Kind::OptionalType | Kind::RestType => {
                a.for_each_child(node, &mut |child| self.check_source_element(child));
            }
            Kind::ThisType => self.check_this_type(node),
            Kind::TypeOperator => self.check_type_operator(node),
            Kind::ConditionalType => self.check_conditional_type(node),
            Kind::InferType => self.check_infer_type(node),
            Kind::TemplateLiteralType => self.check_template_literal_type(node),
            Kind::ImportType => self.check_import_type(node),
            Kind::NamedTupleMember => self.check_named_tuple_member(node),
            Kind::IndexedAccessType => self.check_indexed_access_type(node),
            Kind::MappedType => self.check_mapped_type(node),
            Kind::FunctionDeclaration => self.check_function_declaration(node),
            Kind::Block | Kind::ModuleBlock => self.check_block(node),
            Kind::VariableStatement => self.check_variable_statement(node),
            Kind::ExpressionStatement => self.check_expression_statement(node),
            Kind::IfStatement => self.check_if_statement(node),
            Kind::DoStatement => self.check_do_statement(node),
            Kind::WhileStatement => self.check_while_statement(node),
            Kind::ForStatement => self.check_for_statement(node),
            Kind::ForInStatement => self.check_for_in_statement(node),
            Kind::ForOfStatement => self.check_for_of_statement(node),
            Kind::ContinueStatement | Kind::BreakStatement => {
                self.check_break_or_continue_statement(node)
            }
            Kind::ReturnStatement => self.check_return_statement(node),
            Kind::WithStatement => self.check_with_statement(node),
            Kind::SwitchStatement => self.check_switch_statement(node),
            Kind::LabeledStatement => self.check_labeled_statement(node),
            Kind::ThrowStatement => self.check_throw_statement(node),
            Kind::TryStatement => self.check_try_statement(node),
            Kind::VariableDeclaration => self.check_variable_declaration(node),
            Kind::BindingElement => self.check_binding_element(node),
            Kind::ClassDeclaration => self.check_class_declaration(node),
            Kind::InterfaceDeclaration => self.check_interface_declaration(node),
            Kind::TypeAliasDeclaration | Kind::JSTypeAliasDeclaration => {
                self.check_type_alias_declaration(node)
            }
            Kind::EnumDeclaration => self.check_enum_declaration(node),
            Kind::EnumMember => self.check_enum_member(node),
            Kind::ModuleDeclaration => self.check_module_declaration(node),
            Kind::ImportDeclaration | Kind::JSImportDeclaration => {
                self.check_import_declaration(node)
            }
            Kind::ImportEqualsDeclaration => self.check_import_equals_declaration(node),
            Kind::ExportDeclaration => self.check_export_declaration(node),
            Kind::ExportAssignment => self.check_export_assignment(node),
            Kind::EmptyStatement => {
                self.check_grammar_statement_in_ambient_context(node);
            }
            Kind::DebuggerStatement => {
                self.check_grammar_statement_in_ambient_context(node);
            }
            Kind::MissingDeclaration => self.check_missing_declaration(node),
            Kind::JSDocNonNullableType
            | Kind::JSDocNullableType
            | Kind::JSDocAllType
            | Kind::JSDocTypeLiteral => self.check_jsdoc_type(node),
            _ => {}
        }
    }

    pub fn check_source_element_unreachable(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_potentially_executable_node(a, node) {
            return false;
        }

        if self.reported_unreachable_nodes.has(&node) {
            return true;
        }

        if !self.is_source_element_unreachable(node) {
            return false;
        }

        self.reported_unreachable_nodes.add(node);

        let source_file = get_source_file_of_node(a, node);

        let mut start_node = node;
        let mut end_node = node;

        let parent = a.parent(node);
        if a.can_have_statements(parent) {
            let statements = a.statements(parent);
            let statements = statements.as_slice();
            if let Some(offset) = statements.iter().position(|&statement| statement == node) {
                // Upstream keeps the backwards scan for the first unreachable unreported node disabled until region diagnostics return: the run starts at this statement.
                let first = offset;

                let mut last = offset;
                for (i, &next_node) in statements.iter().enumerate().skip(offset + 1) {
                    if !is_potentially_executable_node(a, next_node)
                        || !self.is_source_element_unreachable(next_node)
                    {
                        break;
                    }
                    last = i;
                    self.reported_unreachable_nodes.add(next_node);
                }

                start_node = statements.get(first).copied().unwrap_or(node);
                end_node = statements.get(last).copied().unwrap_or(node);
            }
        }

        let start = get_token_pos_of_node(a, start_node, source_file, false);

        let diagnostic = self.diagnostic_store.new_diagnostic(
            source_file,
            new_text_range(start, a.end(end_node)),
            diagnostics::UNREACHABLE_CODE_DETECTED,
            &[],
        );
        self.add_error_or_suggestion(
            self.compiler_options.allow_unreachable_code == Tristate::FALSE,
            diagnostic,
        );

        true
    }

    pub fn is_source_element_unreachable(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        // Precondition: ast.IsPotentiallyExecutableNode is true
        if a.flags(node).intersects(NodeFlags::UNREACHABLE) {
            // The binder has determined that this code is unreachable. Ignore const enums unless preserveConstEnums is set.
            return match a.kind(node) {
                Kind::EnumDeclaration => {
                    !is_enum_const(a, node) || self.compiler_options.should_preserve_const_enums()
                }
                Kind::ModuleDeclaration => is_instantiated_module(
                    a,
                    node,
                    self.compiler_options.should_preserve_const_enums(),
                ),
                _ => true,
            };
        }
        let flow_node = a.flow_node(node);
        if !flow_node.is_nil() {
            // For code the binder doesn't know is unreachable, use control flow / types.
            return !self.is_reachable_flow_node(flow_node);
        }
        false
    }

    // Function and class expression bodies are checked after all statements in the enclosing body, so that `const foo = function () { const s = foo(); return "hello"; }` is permitted: a full check of the body while determining the type of foo would give foo type any because of the recursive reference, and delaying the check of the body ensures foo has been assigned a type.
    pub fn check_node_deferred(&mut self, node: NodeId) {
        let enclosing_file = get_source_file_of_node(self.ast, node);
        let links = self.source_file_links.get(enclosing_file);
        if !self.source_file_links[links].type_checked {
            self.source_file_links[links].deferred_nodes.add(node);
        }
    }

    pub fn check_deferred_nodes(&mut self, context: NodeId) {
        let links = self.source_file_links.get(context);
        // The set is walked by position: nodes added during the walk are visited too.
        let mut position = 0;
        while let Some(node) = self.source_file_links[links]
            .deferred_nodes
            .value_at(position)
        {
            if self.is_canceled() {
                break;
            }
            self.check_deferred_node(node);
            position += 1;
        }
        self.source_file_links[links].deferred_nodes = OrderedSet::default();
    }

    pub fn check_deferred_node(&mut self, node: NodeId) {
        let a = self.ast;
        let save_current_node = self.current_node;
        self.current_node = node;
        self.instantiation_count = 0;
        match a.kind(node) {
            Kind::CallExpression
            | Kind::NewExpression
            | Kind::TaggedTemplateExpression
            | Kind::Decorator
            | Kind::JsxOpeningElement => {
                // These node kinds are deferred checked when overload resolution fails. To save on work, we ensure the arguments are checked just once in a deferred way.
                self.resolve_untyped_call(node);
            }
            Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::MethodDeclaration
            | Kind::MethodSignature => {
                self.check_function_expression_or_object_literal_method_deferred(node);
            }
            Kind::GetAccessor | Kind::SetAccessor => {
                self.check_accessor_declaration(node);
            }
            Kind::ClassExpression => {
                self.check_class_expression_deferred(node);
            }
            Kind::TypeParameter => {
                self.check_type_parameter_deferred(node);
            }
            Kind::JsxSelfClosingElement => {
                self.check_jsx_self_closing_element_deferred(node);
            }
            Kind::JsxElement => {
                self.check_jsx_element_deferred(node);
            }
            Kind::TypeAssertionExpression | Kind::AsExpression => {
                self.check_assertion_deferred(node);
            }
            Kind::VoidExpression => {
                self.check_expression(a.expression(node));
            }
            Kind::BinaryExpression => {
                if is_instance_of_expression(a, node) {
                    self.resolve_untyped_call(node);
                }
            }
            Kind::ObjectLiteralExpression | Kind::JsxAttributes => {
                self.check_contextual_deprecations(node);
            }
            _ => {}
        }
        self.current_node = save_current_node;
    }

    pub fn check_jsdoc_comments(&mut self, node: NodeId) {
        for &comment in self.ast.comments(node).as_slice() {
            self.check_jsdoc_comment(comment);
        }
    }

    pub fn check_jsdoc_comment(&mut self, node: NodeId) {
        let a = self.ast;
        // This performs minimal checking of JSDoc nodes to ensure that @link references to entities are recorded for purposes of checking unused identifiers.
        match a.kind(node) {
            Kind::JSDocLink | Kind::JSDocLinkCode | Kind::JSDocLinkPlain => {
                self.resolve_jsdoc_member_name(a.name(node));
            }
            _ => {}
        }
    }

    pub fn resolve_jsdoc_member_name(&mut self, name: NodeId) -> SymbolId {
        let a = self.ast;
        if !name.is_nil() && is_entity_name(a, name) {
            let meaning = SymbolFlags::TYPE | SymbolFlags::NAMESPACE | SymbolFlags::VALUE;
            let symbol = self.resolve_entity_name(
                name,
                meaning,
                true,
                true,
                get_host_signature_from_jsdoc(a, name),
            );
            if !symbol.is_nil() {
                return symbol;
            }
            if is_qualified_name(a, name) {
                let symbol = self.resolve_jsdoc_member_name(a.as_qualified_name(name).left);
                if !symbol.is_nil() {
                    let mut t = TypeId::NIL;
                    if a.sym(symbol).flags.intersects(SymbolFlags::VALUE) {
                        let symbol_type = self.get_type_of_symbol(symbol);
                        let proto = self.get_property_of_type(symbol_type, b"prototype");
                        if !proto.is_nil() {
                            t = self.get_type_of_symbol(proto);
                        }
                    }
                    if t.is_nil() {
                        t = self.get_declared_type_of_symbol(symbol);
                    }
                    return self.get_property_of_type(t, a.text(a.as_qualified_name(name).right));
                }
            }
        }
        SymbolId::NIL
    }

    pub fn check_jsdoc_type(&mut self, node: NodeId) {
        self.check_jsdoc_type_is_in_js_file(node);
        let a = self.ast;
        a.for_each_child(node, &mut |child| self.check_source_element(child));
    }

    pub fn check_jsdoc_type_is_in_js_file(&mut self, node: NodeId) {
        let a = self.ast;
        if !is_in_js_file(a, node) {
            if is_jsdoc_non_nullable_type(a, node) || is_jsdoc_nullable_type(a, node) {
                let token: &[u8] = if is_jsdoc_non_nullable_type(a, node) {
                    b"!"
                } else {
                    b"?"
                };
                let postfix = a.pos(node) == a.pos(a.type_node(node));
                let message = if postfix {
                    diagnostics::X_0_AT_THE_END_OF_A_TYPE_IS_NOT_VALID_TYPESCRIPT_SYNTAX_DID_YOU_MEAN_TO_WRITE_1
                } else {
                    diagnostics::X_0_AT_THE_START_OF_A_TYPE_IS_NOT_VALID_TYPESCRIPT_SYNTAX_DID_YOU_MEAN_TO_WRITE_1
                };
                let mut t = self.get_type_from_type_node(a.type_node(node));
                if is_jsdoc_nullable_type(a, node) && t != self.never_type && t != self.void_type {
                    t = self.get_nullable_type(
                        t,
                        if postfix {
                            TypeFlags::UNDEFINED
                        } else {
                            TypeFlags::NULLABLE
                        },
                    );
                }
                let type_name = self.type_to_string_exported(t);
                self.grammar_error_on_node(node, message, &[Arg::Str(token), Arg::Str(&type_name)]);
            } else {
                self.grammar_error_on_node(
                    node,
                    diagnostics::JSDOC_TYPES_CAN_ONLY_BE_USED_INSIDE_DOCUMENTATION_COMMENTS,
                    &[],
                );
            }
        }
    }

    pub fn check_type_parameter(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar Checking
        self.check_grammar_modifiers(node);
        let expr = a.as_type_parameter_declaration(node).expression;
        if !expr.is_nil() {
            self.grammar_error_on_first_token(expr, diagnostics::TYPE_EXPECTED, &[]);
        }
        let tp_node = a.as_type_parameter_declaration(node);
        self.check_source_element(tp_node.constraint);
        self.check_source_element(tp_node.default_type);
        let symbol = self.get_symbol_of_declaration(node);
        let type_parameter = self.get_declared_type_of_type_parameter(symbol);
        // Resolve base constraint to reveal circularity errors
        self.get_base_constraint_of_type(type_parameter);
        if self.get_resolved_type_parameter_default(type_parameter) == self.circular_constraint_type
        {
            let type_name = self.type_to_string_exported(type_parameter);
            self.error(
                tp_node.default_type,
                diagnostics::TYPE_PARAMETER_0_HAS_A_CIRCULAR_DEFAULT,
                &[Arg::Str(&type_name)],
            );
        }
        let constraint_type = self.get_constraint_of_type_parameter(type_parameter);
        let default_type = self.get_default_from_type_parameter(type_parameter);
        if !constraint_type.is_nil() && !default_type.is_nil() {
            let mapper = new_simple_type_mapper(self, type_parameter, default_type);
            let instantiated_constraint = self.instantiate_type(constraint_type, mapper);
            let target =
                self.get_type_with_this_argument(instantiated_constraint, default_type, false);
            self.check_type_assignable_to(
                default_type,
                target,
                tp_node.default_type,
                diagnostics::TYPE_0_DOES_NOT_SATISFY_THE_CONSTRAINT_1,
            );
        }
        self.check_type_name_is_reserved(
            a.name(node),
            diagnostics::TYPE_PARAMETER_NAME_CANNOT_BE_0,
        );
        self.check_node_deferred(node);
    }

    pub fn check_type_parameter_deferred(&mut self, node: NodeId) {
        let a = self.ast;
        let parent = a.parent(node);
        if is_interface_declaration(a, parent)
            || is_class_like(a, parent)
            || is_type_or_js_type_alias_declaration(a, parent)
        {
            let type_parameter_symbol = self.get_symbol_of_declaration(node);
            let type_parameter = self.get_declared_type_of_type_parameter(type_parameter_symbol);
            let modifiers = self.get_type_parameter_modifiers(type_parameter)
                & (ModifierFlags::IN | ModifierFlags::OUT);
            if modifiers != ModifierFlags::NONE {
                let symbol = self.get_symbol_of_declaration(parent);
                let mut variance_unsupported = false;
                if is_type_or_js_type_alias_declaration(a, parent) {
                    let declared_type = self.get_declared_type_of_symbol(symbol);
                    variance_unsupported = !self.types[declared_type]
                        .object_flags
                        .intersects(ObjectFlags::ANONYMOUS | ObjectFlags::MAPPED);
                }
                if variance_unsupported {
                    self.error(node, diagnostics::VARIANCE_ANNOTATIONS_ARE_ONLY_SUPPORTED_IN_TYPE_ALIASES_FOR_OBJECT_FUNCTION_CONSTRUCTOR_AND_MAPPED_TYPES, &[]);
                } else if modifiers == ModifierFlags::IN || modifiers == ModifierFlags::OUT {
                    let source_marker = if modifiers == ModifierFlags::OUT {
                        self.marker_sub_type_for_check
                    } else {
                        self.marker_super_type_for_check
                    };
                    let source = self.create_marker_type(symbol, type_parameter, source_marker);
                    let target_marker = if modifiers == ModifierFlags::OUT {
                        self.marker_super_type_for_check
                    } else {
                        self.marker_sub_type_for_check
                    };
                    let target = self.create_marker_type(symbol, type_parameter, target_marker);
                    let save_variance_type_parameter = type_parameter;
                    self.variance_type_parameter = type_parameter;
                    self.check_type_assignable_to(
                        source,
                        target,
                        node,
                        diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_AS_IMPLIED_BY_VARIANCE_ANNOTATION,
                    );
                    self.variance_type_parameter = save_variance_type_parameter;
                }
            }
        }
    }

    pub fn should_check_erasable_syntax(&self, node: NodeId) -> bool {
        self.compiler_options.erasable_syntax_only.is_true() && !is_in_js_file(self.ast, node)
    }
}
