// checker/grammarchecks.go (layer G-GRAMMAR): the grammar checks of the checker, in upstream order. The four helpers at the head report nothing in a file that has parse diagnostics and answer whether they reported.
use crate::ast::{
    Arg, Ast, DiagnosticId, FunctionFlags, Kind, ModifierFlags, NodeFlags, NodeId, NodeListId,
    TokenFlags, can_have_illegal_decorators, can_have_illegal_modifiers, can_have_modifiers,
    get_all_accessor_declarations_for_declaration, get_containing_class, get_containing_function,
    get_function_flags, get_source_file_of_node, has_abstract_modifier, has_decorators,
    has_syntactic_modifier, is_accessor, is_ambient_module, is_array_literal_expression,
    is_arrow_function, is_auto_accessor_property_declaration, is_await_expression,
    is_binary_expression, is_binding_pattern, is_block, is_call_expression,
    is_call_signature_declaration, is_case_clause, is_class_like,
    is_class_static_block_declaration, is_comma_sequence, is_computed_property_name,
    is_construct_signature_declaration, is_constructor_type_node, is_declaration_node,
    is_decorator, is_default_clause, is_dynamic_name, is_effective_external_module,
    is_element_access_expression, is_entity_name_expression, is_expression_node,
    is_expression_with_type_arguments, is_for_in_statement, is_for_of_statement, is_function_like,
    is_function_like_declaration, is_function_like_or_class_static_block_declaration,
    is_function_type_node, is_identifier, is_in_top_level_context, is_interface_declaration,
    is_iteration_statement, is_js_type_alias_declaration, is_jsx_namespaced_name,
    is_literal_type_node, is_method_signature_declaration, is_modifier, is_non_null_expression,
    is_object_literal_expression, is_parenthesized_expression, is_prefix_unary_expression,
    is_private_identifier_class_element_declaration, is_property_access_expression,
    is_property_declaration, is_property_signature_declaration, is_spread_element, is_static,
    is_string_literal, is_string_or_numeric_literal_like, is_this_parameter, is_type_literal_node,
    is_type_or_js_type_alias_declaration, is_variable_declaration, is_variable_statement,
    modifier_to_flag, node_can_be_decorated, node_is_present, skip_parentheses,
    walk_up_parenthesized_types,
};
use crate::binder::find_use_strict_prologue;
use crate::checker::{
    Checker, DeclarationMeaning, TypeFlags, every_type,
    get_containing_function_or_class_static_block, get_set_accessor_value_parameter,
    get_verbatim_module_syntax_error_message, has_async_modifier, has_readonly_modifier,
    is_declaration_readonly, is_optional_declaration, is_rest_parameter,
    is_variable_declaration_in_variable_statement, some_type, visibility_to_string,
};
use crate::collections::Set;
use crate::core::{
    ModuleKind, ScriptTarget, Text, TextRange, Tristate, filter, find, if_else, last_or_nil,
    new_text_range,
};
use crate::diagnostics::{self, Category, MessageId};
use crate::jsnum::{MAX_SAFE_INTEGER, from_string};
use crate::scanner::{
    get_range_of_token_at_position, get_text_of_node, is_intrinsic_jsx_name, new_scanner,
    skip_trivia, token_to_string,
};
use crate::stringutil::is_line_break;
use crate::stringutil::util::{strings, utf8};
use crate::tspath::{EXTENSION_CTS, EXTENSION_MTS, file_extension_is_one_of};
use std::collections::BTreeMap;

// `len(s)` of a string constant, as a length in a source text.
const fn text_len(s: &str) -> i32 {
    s.len() as i32
}

impl<'a> Checker<'a> {
    pub fn grammar_error_on_first_token(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> bool {
        let a = self.ast;
        let source_file = get_source_file_of_node(a, node);
        if !self.has_parse_diagnostics(source_file) {
            let span = get_range_of_token_at_position(a, source_file, a.pos(node));
            let diagnostic = self
                .diagnostic_store
                .new_diagnostic(source_file, span, message, args);
            self.add_diagnostic(diagnostic);
            return true;
        }
        false
    }

    pub fn grammar_error_at_pos(
        &mut self,
        node_for_source_file: NodeId,
        start: i32,
        length: i32,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> bool {
        let source_file = get_source_file_of_node(self.ast, node_for_source_file);
        if !self.has_parse_diagnostics(source_file) {
            let diagnostic = self.diagnostic_store.new_diagnostic(
                source_file,
                new_text_range(start, start + length),
                message,
                args,
            );
            self.add_diagnostic(diagnostic);
            return true;
        }
        false
    }

    pub fn grammar_error_on_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> bool {
        let source_file = get_source_file_of_node(self.ast, node);
        if !self.has_parse_diagnostics(source_file) {
            self.error(node, message, args);
            return true;
        }
        false
    }

    pub fn grammar_error_on_node_skipped_on_no_emit(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> bool {
        let source_file = get_source_file_of_node(self.ast, node);
        if !self.has_parse_diagnostics(source_file) {
            let d = self.new_diagnostic_for_node(node, message, args);
            self.diagnostic_store[d].set_skipped_on_no_emit();
            self.add_diagnostic(d);
            return true;
        }
        false
    }
}

pub fn get_identifier_from_entity_name_expression(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::Identifier => node,
        Kind::PropertyAccessExpression => a.as_property_access_expression(node).name,
        _ => NodeId::NIL,
    }
}

impl<'a> Checker<'a> {
    pub fn check_grammar_regular_expression_literal(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let source_file = get_source_file_of_node(a, node);
        if !self.has_parse_diagnostics(source_file) {
            let file = a.as_source_file(source_file);
            let mut last_error = DiagnosticId::NIL;
            // The scanner lives for this one check, where upstream keeps one on the checker and clears its text and its callback after the scan.
            let scanned = {
                let mut scanner = new_scanner();
                scanner.set_script_target(self.language_version);
                scanner.set_language_variant(file.language_variant);
                scanner.set_on_error(Some(Box::new(
                    |message: MessageId, start: i32, length: i32, args: &[Arg<'_>]| {
                        if message.category() == Category::Message
                            && !last_error.is_nil()
                            && start == self.diagnostic_store[last_error].pos()
                            && length == self.diagnostic_store[last_error].len()
                        {
                            // For providing spelling suggestions.
                            let err = self.diagnostic_store.new_diagnostic(
                                NodeId::NIL,
                                new_text_range(start, start + length),
                                message,
                                args,
                            );
                            self.diagnostic_store.add_related_info(last_error, err);
                        } else if last_error.is_nil()
                            || start != self.diagnostic_store[last_error].pos()
                        {
                            last_error = self.diagnostic_store.new_diagnostic(
                                source_file,
                                new_text_range(start, start + length),
                                message,
                                args,
                            );
                            last_error = self.add_diagnostic(last_error);
                        }
                    },
                )));
                scanner.set_text(file.text());
                match scanner.reset_token_state(a.pos(node)) {
                    Ok(()) => {
                        scanner.scan();
                        Ok(scanner.re_scan_slash_token(true) == Kind::RegularExpressionLiteral)
                    }
                    Err(message) => Err(message),
                }
            };
            // The scan above reports an unterminated literal only: the checks of the flags and of the pattern (regExpParser of scanner/regexp.go) are not ported.
            let _: () = self.stand_in("regExpParser.run");
            match scanned {
                Ok(token_is_regular_expression_literal) => self.assert(
                    token_is_regular_expression_literal,
                    "tokenIsRegularExpressionLiteral",
                ),
                Err(message) => return self.fail(message),
            }
            return !last_error.is_nil();
        }
        false
    }

    pub fn check_grammar_private_identifier_expression(&mut self, priv_id: NodeId) -> bool {
        let a = self.ast;
        if get_containing_class(a, priv_id).is_nil() {
            return self.grammar_error_on_node(
                priv_id,
                diagnostics::PRIVATE_IDENTIFIERS_ARE_NOT_ALLOWED_OUTSIDE_CLASS_BODIES,
                &[],
            );
        }
        let parent = a.parent(priv_id);
        if !is_for_in_statement(a, parent) {
            if !is_expression_node(a, priv_id) {
                return self.grammar_error_on_node(priv_id, diagnostics::PRIVATE_IDENTIFIERS_ARE_ONLY_ALLOWED_IN_CLASS_BODIES_AND_MAY_ONLY_BE_USED_AS_PART_OF_A_CLASS_MEMBER_DECLARATION_PROPERTY_ACCESS_OR_ON_THE_LEFT_HAND_SIDE_OF_AN_IN_EXPRESSION, &[]);
            }
            let is_in_operation = is_binary_expression(a, parent)
                && a.kind(a.as_binary_expression(parent).operator_token) == Kind::InKeyword;
            if self
                .get_symbol_for_private_identifier_expression(priv_id)
                .is_nil()
                && !is_in_operation
            {
                return self.grammar_error_on_node(
                    priv_id,
                    diagnostics::CANNOT_FIND_NAME_0,
                    &[Arg::Str(a.as_private_identifier(priv_id).text)],
                );
            }
        }
        false
    }

    pub fn check_grammar_mapped_type(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let members = a.nodes(a.as_mapped_type_node(node).members);
        if members.len() > 0 {
            return self.grammar_error_on_node(
                members.at(0),
                diagnostics::A_MAPPED_TYPE_MAY_NOT_DECLARE_PROPERTIES_OR_METHODS,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_decorator(&mut self, decorator: NodeId) -> bool {
        let a = self.ast;
        let source_file = get_source_file_of_node(a, decorator);
        if !self.has_parse_diagnostics(source_file) {
            let decorator_expression = a.as_decorator(decorator).expression;
            let mut node = decorator_expression;
            // DecoratorParenthesizedExpression : `(` Expression `)`
            if is_parenthesized_expression(a, node) {
                return false;
            }
            let mut can_have_call_expression = true;
            let mut error_node = NodeId::NIL;
            loop {
                // Allow TS syntax such as non-null assertions and instantiation expressions
                if is_expression_with_type_arguments(a, node) || is_non_null_expression(a, node) {
                    node = a.expression(node);
                    continue;
                }
                // DecoratorCallExpression : DecoratorMemberExpression Arguments
                if is_call_expression(a, node) {
                    let call_expr = a.as_call_expression(node);
                    if !can_have_call_expression {
                        error_node = node;
                    }
                    if !call_expr.question_dot_token.is_nil() {
                        // Even if we already have an error node, error at the `?.` token since it appears earlier.
                        error_node = call_expr.question_dot_token;
                    }
                    node = call_expr.expression;
                    can_have_call_expression = false;
                    continue;
                }
                // DecoratorMemberExpression : IdentifierReference, DecoratorMemberExpression `.` IdentifierName, or DecoratorMemberExpression `.` PrivateIdentifier
                if is_property_access_expression(a, node) {
                    let property_access_expr = a.as_property_access_expression(node);
                    if !property_access_expr.question_dot_token.is_nil() {
                        // Even if we already have an error node, error at the `?.` token since it appears earlier.
                        error_node = property_access_expr.question_dot_token;
                    }
                    node = property_access_expr.expression;
                    can_have_call_expression = false;
                    continue;
                }
                if !is_identifier(a, node) {
                    // Even if we already have an error node, error at this node since it appears earlier.
                    error_node = node;
                }
                break;
            }
            if !error_node.is_nil() {
                let err = self.error(
                    decorator_expression,
                    diagnostics::EXPRESSION_MUST_BE_ENCLOSED_IN_PARENTHESES_TO_BE_USED_AS_A_DECORATOR,
                    &[],
                );
                let related = self.create_diagnostic_for_node(
                    error_node,
                    diagnostics::INVALID_SYNTAX_IN_DECORATOR,
                    &[],
                );
                self.diagnostic_store.add_related_info(err, related);
                return true;
            }
        }
        false
    }

    pub fn check_grammar_export_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_export_declaration(node);
        if data.is_type_only
            && !data.export_clause.is_nil()
            && a.kind(data.export_clause) == Kind::NamedExports
        {
            return self.check_grammar_type_only_named_imports_or_exports(data.export_clause);
        }
        false
    }

    pub fn check_grammar_module_element_context(
        &mut self,
        node: NodeId,
        error_message: MessageId,
    ) -> bool {
        let parent_kind = self.ast.kind(self.ast.parent(node));
        let is_in_appropriate_context = parent_kind == Kind::SourceFile
            || parent_kind == Kind::ModuleBlock
            || parent_kind == Kind::ModuleDeclaration;
        if !is_in_appropriate_context {
            self.grammar_error_on_first_token(node, error_message, &[]);
        }
        !is_in_appropriate_context
    }

    pub fn check_grammar_modifiers(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if a.modifiers(node).is_nil() {
            return false;
        }
        if self.report_obvious_decorator_errors(node) || self.report_obvious_modifier_errors(node) {
            return true;
        }
        if is_this_parameter(a, node) {
            return self.grammar_error_on_first_token(
                node,
                diagnostics::NEITHER_DECORATORS_NOR_MODIFIERS_MAY_BE_APPLIED_TO_THIS_PARAMETERS,
                &[],
            );
        }
        let node_kind = a.kind(node);
        let parent = a.parent(node);
        let parent_kind = a.kind(parent);
        let mut block_scope_kind = NodeFlags::NONE;
        if is_variable_statement(a, node) {
            block_scope_kind =
                a.flags(a.as_variable_statement(node).declaration_list) & NodeFlags::BLOCK_SCOPED;
        }
        let mut last_static = NodeId::NIL;
        let mut last_declare = NodeId::NIL;
        let mut last_async = NodeId::NIL;
        let mut last_override = NodeId::NIL;
        let mut first_decorator = NodeId::NIL;
        let mut flags = ModifierFlags::NONE;
        let mut saw_export_before_decorators = false;
        // We parse decorators and modifiers in four contiguous chunks: [...leadingDecorators, ...leadingModifiers, ...trailingDecorators, ...trailingModifiers]. It is an error to have both leading and trailing decorators.
        let mut has_leading_decorators = false;
        for &modifier in a.modifier_nodes(node).as_slice() {
            let modifier_kind = a.kind(modifier);
            let reparsed = a.flags(modifier).intersects(NodeFlags::REPARSED);
            if is_decorator(a, modifier) {
                if !node_can_be_decorated(a, self.legacy_decorators, node, parent, a.parent(parent))
                {
                    if node_kind == Kind::MethodDeclaration && !node_is_present(a, a.body(node)) {
                        return self.grammar_error_on_first_token(node, diagnostics::A_DECORATOR_CAN_ONLY_DECORATE_A_METHOD_IMPLEMENTATION_NOT_AN_OVERLOAD, &[]);
                    } else {
                        return self.grammar_error_on_first_token(
                            node,
                            diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
                            &[],
                        );
                    }
                } else if self.legacy_decorators
                    && (node_kind == Kind::GetAccessor || node_kind == Kind::SetAccessor)
                {
                    let symbol = self.get_symbol_of_declaration(node);
                    let accessors = get_all_accessor_declarations_for_declaration(
                        a,
                        node,
                        a.sym(symbol).declarations.as_slice(),
                    );
                    if has_decorators(a, accessors.first_accessor)
                        && node == accessors.second_accessor
                    {
                        return self.grammar_error_on_first_token(node, diagnostics::DECORATORS_CANNOT_BE_APPLIED_TO_MULTIPLE_GET_SLASHSET_ACCESSORS_OF_THE_SAME_NAME, &[]);
                    }
                }
                // if we've seen any modifiers aside from `export`, `default`, or another decorator, then this is an invalid position
                if flags.without(ModifierFlags::EXPORT_DEFAULT | ModifierFlags::DECORATOR)
                    != ModifierFlags::NONE
                {
                    return self.grammar_error_on_node(
                        modifier,
                        diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
                        &[],
                    );
                }
                // if we've already seen leading decorators and leading modifiers, then trailing decorators are an invalid position
                if has_leading_decorators && flags.intersects(ModifierFlags::MODIFIER) {
                    if first_decorator.is_nil() {
                        return self.fail("Expected firstDecorator to be set");
                    }
                    let source_file = get_source_file_of_node(a, modifier);
                    if !self.has_parse_diagnostics(source_file) {
                        let err = self.error(modifier, diagnostics::DECORATORS_MAY_NOT_APPEAR_AFTER_EXPORT_OR_EXPORT_DEFAULT_IF_THEY_ALSO_APPEAR_BEFORE_EXPORT, &[]);
                        let related = self.create_diagnostic_for_node(
                            first_decorator,
                            diagnostics::DECORATOR_USED_BEFORE_EXPORT_HERE,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(err, related);
                        return true;
                    }
                    return false;
                }
                flags |= ModifierFlags::DECORATOR;
                // if we have not yet seen a modifier, then these are leading decorators
                if !flags.intersects(ModifierFlags::MODIFIER) {
                    has_leading_decorators = true;
                } else if flags.intersects(ModifierFlags::EXPORT) {
                    saw_export_before_decorators = true;
                }
                if first_decorator.is_nil() {
                    first_decorator = modifier;
                }
            } else {
                if modifier_kind != Kind::ReadonlyKeyword {
                    if node_kind == Kind::PropertySignature || node_kind == Kind::MethodSignature {
                        return self.grammar_error_on_node(
                            modifier,
                            diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_TYPE_MEMBER,
                            &[Arg::Str(token_to_string(modifier_kind))],
                        );
                    }
                    if node_kind == Kind::IndexSignature
                        && (modifier_kind != Kind::StaticKeyword || !is_class_like(a, parent))
                    {
                        return self.grammar_error_on_node(
                            modifier,
                            diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_AN_INDEX_SIGNATURE,
                            &[Arg::Str(token_to_string(modifier_kind))],
                        );
                    }
                }
                if modifier_kind != Kind::InKeyword
                    && modifier_kind != Kind::OutKeyword
                    && modifier_kind != Kind::ConstKeyword
                {
                    if node_kind == Kind::TypeParameter {
                        return self.grammar_error_on_node(
                            modifier,
                            diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_TYPE_PARAMETER,
                            &[Arg::Str(token_to_string(modifier_kind))],
                        );
                    }
                }
                match modifier_kind {
                    Kind::ConstKeyword => {
                        if node_kind != Kind::EnumDeclaration && node_kind != Kind::TypeParameter {
                            return self.grammar_error_on_node(
                                node,
                                diagnostics::A_CLASS_MEMBER_CANNOT_HAVE_THE_0_KEYWORD,
                                &[Arg::Str(token_to_string(Kind::ConstKeyword))],
                            );
                        }
                        if node_kind == Kind::TypeParameter {
                            if !(is_function_like_declaration(a, parent)
                                || is_class_like(a, parent)
                                || is_function_type_node(a, parent)
                                || is_constructor_type_node(a, parent)
                                || is_call_signature_declaration(a, parent)
                                || is_construct_signature_declaration(a, parent)
                                || is_method_signature_declaration(a, parent))
                            {
                                return self.grammar_error_on_node(modifier, diagnostics::X_0_MODIFIER_CAN_ONLY_APPEAR_ON_A_TYPE_PARAMETER_OF_A_FUNCTION_METHOD_OR_CLASS, &[Arg::Str(token_to_string(modifier_kind))]);
                            }
                        }
                    }
                    Kind::OverrideKeyword => {
                        // If node.kind === SyntaxKind.Parameter, checkParameter reports an error if it's not a parameter property.
                        if flags.intersects(ModifierFlags::OVERRIDE) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"override")],
                            );
                        } else if flags.intersects(ModifierFlags::AMBIENT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"override"), Arg::Str(b"declare")],
                            );
                        } else if flags.intersects(ModifierFlags::READONLY) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"override"), Arg::Str(b"readonly")],
                            );
                        } else if flags.intersects(ModifierFlags::ACCESSOR) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"override"), Arg::Str(b"accessor")],
                            );
                        } else if flags.intersects(ModifierFlags::ASYNC) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"override"), Arg::Str(b"async")],
                            );
                        }
                        flags |= ModifierFlags::OVERRIDE;
                        last_override = modifier;
                    }
                    Kind::PublicKeyword | Kind::ProtectedKeyword | Kind::PrivateKeyword => {
                        let text = visibility_to_string(modifier_to_flag(modifier_kind));
                        if flags.intersects(ModifierFlags::ACCESSIBILITY_MODIFIER) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::ACCESSIBILITY_MODIFIER_ALREADY_SEEN,
                                &[],
                            );
                        } else if flags.intersects(ModifierFlags::OVERRIDE) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(text), Arg::Str(b"override")],
                            );
                        } else if flags.intersects(ModifierFlags::STATIC) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(text), Arg::Str(b"static")],
                            );
                        } else if flags.intersects(ModifierFlags::ACCESSOR) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(text), Arg::Str(b"accessor")],
                            );
                        } else if flags.intersects(ModifierFlags::READONLY) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(text), Arg::Str(b"readonly")],
                            );
                        } else if flags.intersects(ModifierFlags::ASYNC) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(text), Arg::Str(b"async")],
                            );
                        } else if parent_kind == Kind::ModuleBlock
                            || parent_kind == Kind::SourceFile
                        {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_MODULE_OR_NAMESPACE_ELEMENT,
                                &[Arg::Str(text)],
                            );
                        } else if flags.intersects(ModifierFlags::ABSTRACT) {
                            if modifier_kind == Kind::PrivateKeyword {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                    &[Arg::Str(text), Arg::Str(b"abstract")],
                                );
                            } else if !reparsed {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                    &[Arg::Str(text), Arg::Str(b"abstract")],
                                );
                            }
                        } else if is_private_identifier_class_element_declaration(a, node) {
                            return self.grammar_error_on_node(modifier, diagnostics::AN_ACCESSIBILITY_MODIFIER_CANNOT_BE_USED_WITH_A_PRIVATE_IDENTIFIER, &[]);
                        }
                        flags |= modifier_to_flag(modifier_kind);
                    }
                    Kind::StaticKeyword => {
                        if flags.intersects(ModifierFlags::STATIC) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"static")],
                            );
                        } else if flags.intersects(ModifierFlags::READONLY) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"static"), Arg::Str(b"readonly")],
                            );
                        } else if flags.intersects(ModifierFlags::ASYNC) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"static"), Arg::Str(b"async")],
                            );
                        } else if flags.intersects(ModifierFlags::ACCESSOR) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"static"), Arg::Str(b"accessor")],
                            );
                        } else if parent_kind == Kind::ModuleBlock
                            || parent_kind == Kind::SourceFile
                        {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_MODULE_OR_NAMESPACE_ELEMENT,
                                &[Arg::Str(b"static")],
                            );
                        } else if node_kind == Kind::Parameter {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_PARAMETER,
                                &[Arg::Str(b"static")],
                            );
                        } else if flags.intersects(ModifierFlags::ABSTRACT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"static"), Arg::Str(b"abstract")],
                            );
                        } else if flags.intersects(ModifierFlags::OVERRIDE) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"static"), Arg::Str(b"override")],
                            );
                        }
                        flags |= ModifierFlags::STATIC;
                        last_static = modifier;
                    }
                    Kind::AccessorKeyword => {
                        if flags.intersects(ModifierFlags::ACCESSOR) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"accessor")],
                            );
                        } else if flags.intersects(ModifierFlags::READONLY) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"accessor"), Arg::Str(b"readonly")],
                            );
                        } else if flags.intersects(ModifierFlags::AMBIENT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"accessor"), Arg::Str(b"declare")],
                            );
                        } else if node_kind != Kind::PropertyDeclaration {
                            return self.grammar_error_on_node(modifier, diagnostics::X_ACCESSOR_MODIFIER_CAN_ONLY_APPEAR_ON_A_PROPERTY_DECLARATION, &[]);
                        }
                        flags |= ModifierFlags::ACCESSOR;
                    }
                    Kind::ReadonlyKeyword => {
                        if flags.intersects(ModifierFlags::READONLY) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"readonly")],
                            );
                        } else if node_kind != Kind::PropertyDeclaration
                            && node_kind != Kind::PropertySignature
                            && node_kind != Kind::IndexSignature
                            && node_kind != Kind::Parameter
                        {
                            // If node.kind === SyntaxKind.Parameter, checkParameter reports an error if it's not a parameter property.
                            return self.grammar_error_on_node(modifier, diagnostics::X_READONLY_MODIFIER_CAN_ONLY_APPEAR_ON_A_PROPERTY_DECLARATION_OR_INDEX_SIGNATURE, &[]);
                        } else if flags.intersects(ModifierFlags::ACCESSOR) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"readonly"), Arg::Str(b"accessor")],
                            );
                        }
                        flags |= ModifierFlags::READONLY;
                    }
                    Kind::ExportKeyword => {
                        if self.compiler_options.verbatim_module_syntax == Tristate::TRUE
                            && !a.flags(node).intersects(NodeFlags::AMBIENT)
                            && node_kind != Kind::TypeAliasDeclaration
                            && node_kind != Kind::InterfaceDeclaration
                            && node_kind != Kind::ModuleDeclaration
                            && parent_kind == Kind::SourceFile
                            && self
                                .program
                                .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                                == ModuleKind::COMMON_JS
                        {
                            return self.grammar_error_on_node(modifier, diagnostics::A_TOP_LEVEL_EXPORT_MODIFIER_CANNOT_BE_USED_ON_VALUE_DECLARATIONS_IN_A_COMMONJS_MODULE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED, &[]);
                        }
                        if flags.intersects(ModifierFlags::EXPORT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"export")],
                            );
                        } else if flags.intersects(ModifierFlags::AMBIENT) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"export"), Arg::Str(b"declare")],
                            );
                        } else if flags.intersects(ModifierFlags::ABSTRACT) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"export"), Arg::Str(b"abstract")],
                            );
                        } else if flags.intersects(ModifierFlags::ASYNC) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"export"), Arg::Str(b"async")],
                            );
                        } else if is_class_like(a, parent) && !is_js_type_alias_declaration(a, node)
                        {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_CLASS_ELEMENTS_OF_THIS_KIND,
                                &[Arg::Str(b"export")],
                            );
                        } else if node_kind == Kind::Parameter {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_PARAMETER,
                                &[Arg::Str(b"export")],
                            );
                        } else if block_scope_kind == NodeFlags::USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_USING_DECLARATION,
                                &[Arg::Str(b"export")],
                            );
                        } else if block_scope_kind == NodeFlags::AWAIT_USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_AN_AWAIT_USING_DECLARATION,
                                &[Arg::Str(b"export")],
                            );
                        }
                        flags |= ModifierFlags::EXPORT;
                    }
                    Kind::DefaultKeyword => {
                        let container = if parent_kind == Kind::SourceFile {
                            parent
                        } else {
                            a.parent(parent)
                        };
                        if a.kind(container) == Kind::ModuleDeclaration
                            && !is_ambient_module(a, container)
                        {
                            return self.grammar_error_on_node(modifier, diagnostics::A_DEFAULT_EXPORT_CAN_ONLY_BE_USED_IN_AN_ECMASCRIPT_STYLE_MODULE, &[]);
                        } else if block_scope_kind == NodeFlags::USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_USING_DECLARATION,
                                &[Arg::Str(b"default")],
                            );
                        } else if block_scope_kind == NodeFlags::AWAIT_USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_AN_AWAIT_USING_DECLARATION,
                                &[Arg::Str(b"default")],
                            );
                        } else if !flags.intersects(ModifierFlags::EXPORT) && !reparsed {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"export"), Arg::Str(b"default")],
                            );
                        } else if saw_export_before_decorators {
                            return self.grammar_error_on_node(
                                first_decorator,
                                diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
                                &[],
                            );
                        }
                        flags |= ModifierFlags::DEFAULT;
                    }
                    Kind::DeclareKeyword => {
                        if flags.intersects(ModifierFlags::AMBIENT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"declare")],
                            );
                        } else if flags.intersects(ModifierFlags::ASYNC) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_IN_AN_AMBIENT_CONTEXT,
                                &[Arg::Str(b"async")],
                            );
                        } else if flags.intersects(ModifierFlags::OVERRIDE) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_IN_AN_AMBIENT_CONTEXT,
                                &[Arg::Str(b"override")],
                            );
                        } else if is_class_like(a, parent) && !is_property_declaration(a, node) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_CLASS_ELEMENTS_OF_THIS_KIND,
                                &[Arg::Str(b"declare")],
                            );
                        } else if node_kind == Kind::Parameter {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_PARAMETER,
                                &[Arg::Str(b"declare")],
                            );
                        } else if block_scope_kind == NodeFlags::USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_USING_DECLARATION,
                                &[Arg::Str(b"declare")],
                            );
                        } else if block_scope_kind == NodeFlags::AWAIT_USING {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_AN_AWAIT_USING_DECLARATION,
                                &[Arg::Str(b"declare")],
                            );
                        } else if a.flags(parent).intersects(NodeFlags::AMBIENT)
                            && parent_kind == Kind::ModuleBlock
                        {
                            return self.grammar_error_on_node(modifier, diagnostics::A_DECLARE_MODIFIER_CANNOT_BE_USED_IN_AN_ALREADY_AMBIENT_CONTEXT, &[]);
                        } else if is_private_identifier_class_element_declaration(a, node) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_A_PRIVATE_IDENTIFIER,
                                &[Arg::Str(b"declare")],
                            );
                        } else if flags.intersects(ModifierFlags::ACCESSOR) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"declare"), Arg::Str(b"accessor")],
                            );
                        }
                        flags |= ModifierFlags::AMBIENT;
                        last_declare = modifier;
                    }
                    Kind::AbstractKeyword => {
                        if flags.intersects(ModifierFlags::ABSTRACT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"abstract")],
                            );
                        }
                        if node_kind != Kind::ClassDeclaration && node_kind != Kind::ConstructorType
                        {
                            if node_kind != Kind::MethodDeclaration
                                && node_kind != Kind::PropertyDeclaration
                                && node_kind != Kind::GetAccessor
                                && node_kind != Kind::SetAccessor
                            {
                                return self.grammar_error_on_node(modifier, diagnostics::X_ABSTRACT_MODIFIER_CAN_ONLY_APPEAR_ON_A_CLASS_METHOD_OR_PROPERTY_DECLARATION, &[]);
                            }
                            if !(parent_kind == Kind::ClassDeclaration
                                && has_syntactic_modifier(a, parent, ModifierFlags::ABSTRACT))
                            {
                                let message = if node_kind == Kind::PropertyDeclaration {
                                    diagnostics::ABSTRACT_PROPERTIES_CAN_ONLY_APPEAR_WITHIN_AN_ABSTRACT_CLASS
                                } else {
                                    diagnostics::ABSTRACT_METHODS_CAN_ONLY_APPEAR_WITHIN_AN_ABSTRACT_CLASS
                                };
                                return self.grammar_error_on_node(modifier, message, &[]);
                            }
                            if flags.intersects(ModifierFlags::STATIC) {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                    &[Arg::Str(b"static"), Arg::Str(b"abstract")],
                                );
                            }
                            if flags.intersects(ModifierFlags::PRIVATE) {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                    &[Arg::Str(b"private"), Arg::Str(b"abstract")],
                                );
                            }
                            if flags.intersects(ModifierFlags::ASYNC) && !last_async.is_nil() {
                                return self.grammar_error_on_node(
                                    last_async,
                                    diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                    &[Arg::Str(b"async"), Arg::Str(b"abstract")],
                                );
                            }
                            if flags.intersects(ModifierFlags::OVERRIDE) && !reparsed {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                    &[Arg::Str(b"abstract"), Arg::Str(b"override")],
                                );
                            }
                            if flags.intersects(ModifierFlags::ACCESSOR) && !reparsed {
                                return self.grammar_error_on_node(
                                    modifier,
                                    diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                    &[Arg::Str(b"abstract"), Arg::Str(b"accessor")],
                                );
                            }
                        }
                        let name = a.name(node);
                        if !name.is_nil() && a.kind(name) == Kind::PrivateIdentifier {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_A_PRIVATE_IDENTIFIER,
                                &[Arg::Str(b"abstract")],
                            );
                        }
                        flags |= ModifierFlags::ABSTRACT;
                    }
                    Kind::AsyncKeyword => {
                        if flags.intersects(ModifierFlags::ASYNC) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(b"async")],
                            );
                        } else if flags.intersects(ModifierFlags::AMBIENT)
                            || a.flags(parent).intersects(NodeFlags::AMBIENT)
                        {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_IN_AN_AMBIENT_CONTEXT,
                                &[Arg::Str(b"async")],
                            );
                        } else if node_kind == Kind::Parameter {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_PARAMETER,
                                &[Arg::Str(b"async")],
                            );
                        }
                        if flags.intersects(ModifierFlags::ABSTRACT) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_WITH_1_MODIFIER,
                                &[Arg::Str(b"async"), Arg::Str(b"abstract")],
                            );
                        }
                        flags |= ModifierFlags::ASYNC;
                        last_async = modifier;
                    }
                    Kind::InKeyword | Kind::OutKeyword => {
                        let in_out_flag = if modifier_kind == Kind::InKeyword {
                            ModifierFlags::IN
                        } else {
                            ModifierFlags::OUT
                        };
                        let in_out_text: &[u8] = if modifier_kind == Kind::InKeyword {
                            b"in"
                        } else {
                            b"out"
                        };
                        if node_kind != Kind::TypeParameter
                            || !parent.is_nil()
                                && !(is_interface_declaration(a, parent)
                                    || is_class_like(a, parent)
                                    || is_type_or_js_type_alias_declaration(a, parent))
                        {
                            return self.grammar_error_on_node(modifier, diagnostics::X_0_MODIFIER_CAN_ONLY_APPEAR_ON_A_TYPE_PARAMETER_OF_A_CLASS_INTERFACE_OR_TYPE_ALIAS, &[Arg::Str(in_out_text)]);
                        }
                        if flags.intersects(in_out_flag) {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_ALREADY_SEEN,
                                &[Arg::Str(in_out_text)],
                            );
                        }
                        if in_out_flag.intersects(ModifierFlags::IN)
                            && flags.intersects(ModifierFlags::OUT)
                        {
                            return self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_MUST_PRECEDE_1_MODIFIER,
                                &[Arg::Str(b"in"), Arg::Str(b"out")],
                            );
                        }
                        flags |= in_out_flag;
                    }
                    _ => {}
                }
            }
        }
        if node_kind == Kind::Constructor {
            if flags.intersects(ModifierFlags::STATIC) {
                return self.grammar_error_on_node(
                    last_static,
                    diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_CONSTRUCTOR_DECLARATION,
                    &[Arg::Str(b"static")],
                );
            }
            if flags.intersects(ModifierFlags::OVERRIDE) {
                return self.grammar_error_on_node(
                    last_override,
                    diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_CONSTRUCTOR_DECLARATION,
                    &[Arg::Str(b"override")],
                );
            }
            if flags.intersects(ModifierFlags::ASYNC) {
                return self.grammar_error_on_node(
                    last_async,
                    diagnostics::X_0_MODIFIER_CANNOT_APPEAR_ON_A_CONSTRUCTOR_DECLARATION,
                    &[Arg::Str(b"async")],
                );
            }
            return false;
        } else if (node_kind == Kind::ImportDeclaration
            || node_kind == Kind::JSImportDeclaration
            || node_kind == Kind::ImportEqualsDeclaration)
            && flags.intersects(ModifierFlags::AMBIENT)
        {
            return self.grammar_error_on_node(
                last_declare,
                diagnostics::A_0_MODIFIER_CANNOT_BE_USED_WITH_AN_IMPORT_DECLARATION,
                &[Arg::Str(b"declare")],
            );
        } else if node_kind == Kind::Parameter
            && flags.intersects(ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
            && is_binding_pattern(a, a.name(node))
        {
            return self.grammar_error_on_node(
                node,
                diagnostics::A_PARAMETER_PROPERTY_MAY_NOT_BE_DECLARED_USING_A_BINDING_PATTERN,
                &[],
            );
        } else if node_kind == Kind::Parameter
            && flags.intersects(ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
            && !a.as_parameter_declaration(node).dot_dot_dot_token.is_nil()
        {
            return self.grammar_error_on_node(
                node,
                diagnostics::A_PARAMETER_PROPERTY_CANNOT_BE_DECLARED_USING_A_REST_PARAMETER,
                &[],
            );
        }
        if flags.intersects(ModifierFlags::ASYNC) {
            return self.check_grammar_async_modifier(node, last_async);
        }
        false
    }

    pub fn report_obvious_modifier_errors(&mut self, node: NodeId) -> bool {
        let modifier = self.find_first_illegal_modifier(node);
        if modifier.is_nil() {
            return false;
        }
        self.grammar_error_on_first_token(modifier, diagnostics::MODIFIERS_CANNOT_APPEAR_HERE, &[])
    }

    pub fn find_first_modifier_except(&self, node: NodeId, allowed_modifier: Kind) -> NodeId {
        let a = self.ast;
        let modifier = find(a.modifier_nodes(node).as_slice(), |n| is_modifier(a, n));
        if !modifier.is_nil() && a.kind(modifier) != allowed_modifier {
            return modifier;
        }
        NodeId::NIL
    }

    pub fn find_first_illegal_modifier(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        match a.kind(node) {
            Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::Constructor
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::IndexSignature
            | Kind::ModuleDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ExportDeclaration
            | Kind::ExportAssignment
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::Parameter
            | Kind::TypeParameter
            | Kind::JSTypeAliasDeclaration => NodeId::NIL,
            Kind::ClassStaticBlockDeclaration
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::NamespaceExportDeclaration
            | Kind::MissingDeclaration => {
                find(a.modifier_nodes(node).as_slice(), |n| is_modifier(a, n))
            }
            kind => {
                let parent_kind = a.kind(a.parent(node));
                if parent_kind == Kind::ModuleBlock || parent_kind == Kind::SourceFile {
                    return NodeId::NIL;
                }
                match kind {
                    Kind::FunctionDeclaration => {
                        self.find_first_modifier_except(node, Kind::AsyncKeyword)
                    }
                    Kind::ClassDeclaration | Kind::ConstructorType => {
                        self.find_first_modifier_except(node, Kind::AbstractKeyword)
                    }
                    Kind::ClassExpression
                    | Kind::InterfaceDeclaration
                    | Kind::TypeAliasDeclaration => {
                        find(a.modifier_nodes(node).as_slice(), |n| is_modifier(a, n))
                    }
                    Kind::VariableStatement => {
                        if a.flags(a.as_variable_statement(node).declaration_list)
                            .intersects(NodeFlags::USING)
                        {
                            return self.find_first_modifier_except(node, Kind::AwaitKeyword);
                        }
                        find(a.modifier_nodes(node).as_slice(), |n| is_modifier(a, n))
                    }
                    Kind::EnumDeclaration => {
                        self.find_first_modifier_except(node, Kind::ConstKeyword)
                    }
                    _ => self.fail("Unhandled case in findFirstIllegalModifier."),
                }
            }
        }
    }

    pub fn report_obvious_decorator_errors(&mut self, node: NodeId) -> bool {
        let decorator = self.find_first_illegal_decorator(node);
        if decorator.is_nil() {
            return false;
        }
        self.grammar_error_on_first_token(
            decorator,
            diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
            &[],
        )
    }

    pub fn find_first_illegal_decorator(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        if can_have_illegal_decorators(a, node) {
            return find(a.modifier_nodes(node).as_slice(), |n| is_decorator(a, n));
        }
        NodeId::NIL
    }

    pub fn check_grammar_async_modifier(&mut self, node: NodeId, async_modifier: NodeId) -> bool {
        match self.ast.kind(node) {
            Kind::MethodDeclaration
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ArrowFunction => return false,
            _ => {}
        }
        self.grammar_error_on_node(
            async_modifier,
            diagnostics::X_0_MODIFIER_CANNOT_BE_USED_HERE,
            &[Arg::Str(b"async")],
        )
    }

    pub fn check_grammar_for_disallowed_trailing_comma(
        &mut self,
        list: NodeListId,
        diag: MessageId,
    ) -> bool {
        let a = self.ast;
        if !list.is_nil() && a.has_trailing_comma(list) {
            return self.grammar_error_at_pos(
                a.nodes(list).at(0),
                a.list_end(list) - text_len(","),
                text_len(","),
                diag,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_type_parameter_list(
        &mut self,
        type_parameters: NodeListId,
        file: NodeId,
    ) -> bool {
        let a = self.ast;
        if !type_parameters.is_nil() && a.nodes(type_parameters).len() == 0 {
            let start = a.list_pos(type_parameters) - text_len("<");
            let end = skip_trivia(a.as_source_file(file).text(), a.list_end(type_parameters))
                + text_len(">");
            return self.grammar_error_at_pos(
                file,
                start,
                end - start,
                diagnostics::TYPE_PARAMETER_LIST_CANNOT_BE_EMPTY,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_parameter_list(&mut self, parameters: NodeListId) -> bool {
        let a = self.ast;
        let mut seen_optional_parameter = false;
        let nodes = a.nodes(parameters).as_slice();
        let parameter_count = nodes.len();
        for (i, &node) in nodes.iter().enumerate() {
            let parameter = a.as_parameter_declaration(node);
            if !parameter.dot_dot_dot_token.is_nil() {
                if i + 1 != parameter_count {
                    return self.grammar_error_on_node(
                        parameter.dot_dot_dot_token,
                        diagnostics::A_REST_PARAMETER_MUST_BE_LAST_IN_A_PARAMETER_LIST,
                        &[],
                    );
                }
                if !a.flags(node).intersects(NodeFlags::AMBIENT) {
                    self.check_grammar_for_disallowed_trailing_comma(
                        parameters,
                        diagnostics::A_REST_PARAMETER_OR_BINDING_PATTERN_MAY_NOT_HAVE_A_TRAILING_COMMA,
                    );
                }
                if !parameter.question_token.is_nil() {
                    return self.grammar_error_on_node(
                        parameter.question_token,
                        diagnostics::A_REST_PARAMETER_CANNOT_BE_OPTIONAL,
                        &[],
                    );
                }
                if !parameter.initializer.is_nil() {
                    return self.grammar_error_on_node(
                        parameter.name,
                        diagnostics::A_REST_PARAMETER_CANNOT_HAVE_AN_INITIALIZER,
                        &[],
                    );
                }
            } else if is_optional_declaration(a, node) {
                seen_optional_parameter = true;
                // A reparsed '?' token indicates a bracketed name in @param tag
                if !parameter.question_token.is_nil()
                    && !a
                        .flags(parameter.question_token)
                        .intersects(NodeFlags::REPARSED)
                    && !parameter.initializer.is_nil()
                {
                    return self.grammar_error_on_node(
                        parameter.name,
                        diagnostics::PARAMETER_CANNOT_HAVE_QUESTION_MARK_AND_INITIALIZER,
                        &[],
                    );
                }
            } else if seen_optional_parameter && parameter.initializer.is_nil() {
                return self.grammar_error_on_node(
                    parameter.name,
                    diagnostics::A_REQUIRED_PARAMETER_CANNOT_FOLLOW_AN_OPTIONAL_PARAMETER,
                    &[],
                );
            }
        }
        false
    }

    pub fn check_grammar_for_use_strict_simple_parameter_list(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if self.language_version >= ScriptTarget::ES2016 {
            let body = a.body(node);
            let mut use_strict_directive = NodeId::NIL;
            if !body.is_nil() && is_block(a, body) {
                use_strict_directive = find_use_strict_prologue(
                    a,
                    get_source_file_of_node(a, node),
                    a.statements(body),
                );
            }
            if !use_strict_directive.is_nil() {
                let non_simple_parameters = filter(a.parameters(node).as_slice(), |n| {
                    let parameter = a.as_parameter_declaration(n);
                    !parameter.initializer.is_nil()
                        || is_binding_pattern(a, parameter.name)
                        || is_rest_parameter(a, n)
                });
                if non_simple_parameters.len() != 0 {
                    for &parameter in non_simple_parameters.iter() {
                        let err = self.error(
                            parameter,
                            diagnostics::THIS_PARAMETER_IS_NOT_ALLOWED_WITH_USE_STRICT_DIRECTIVE,
                            &[],
                        );
                        let related = self.create_diagnostic_for_node(
                            use_strict_directive,
                            diagnostics::X_USE_STRICT_DIRECTIVE_USED_HERE,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(err, related);
                    }
                    let err = self.error(use_strict_directive, diagnostics::X_USE_STRICT_DIRECTIVE_CANNOT_BE_USED_WITH_NON_SIMPLE_PARAMETER_LIST, &[]);
                    for (index, &parameter) in non_simple_parameters.iter().enumerate() {
                        let related_message = if index == 0 {
                            diagnostics::NON_SIMPLE_PARAMETER_DECLARED_HERE
                        } else {
                            diagnostics::X_AND_HERE
                        };
                        let related =
                            self.create_diagnostic_for_node(parameter, related_message, &[]);
                        self.diagnostic_store.add_related_info(err, related);
                    }
                    return true;
                }
            }
        }
        false
    }

    pub fn check_grammar_function_like_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        // Prevent cascading error by short-circuit
        let file = get_source_file_of_node(a, node);
        let func_data = a.function_like_data(node).unwrap_or_default();
        self.check_grammar_modifiers(node)
            || self.check_grammar_type_parameter_list(func_data.type_parameters, file)
            || self.check_grammar_parameter_list(func_data.parameters)
            || self.check_grammar_arrow_function(node, file)
            || (is_function_like_declaration(a, node)
                && self.check_grammar_for_use_strict_simple_parameter_list(node))
    }

    pub fn check_grammar_class_like_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let file = get_source_file_of_node(a, node);
        self.check_grammar_class_declaration_heritage_clauses(node, file)
            || self.check_grammar_type_parameter_list(a.type_parameter_list(node), file)
    }

    pub fn check_grammar_arrow_function(&mut self, node: NodeId, file: NodeId) -> bool {
        let a = self.ast;
        if !is_arrow_function(a, node) {
            return false;
        }
        let arrow_func = a.as_arrow_function(node);
        let source_file = a.as_source_file(file);
        let type_parameters = arrow_func.type_parameters;
        if !type_parameters.is_nil() {
            let type_param_nodes = a.nodes(type_parameters);
            let has_constraint = type_param_nodes.len() > 0
                && !a
                    .as_type_parameter_declaration(type_param_nodes.at(0))
                    .constraint
                    .is_nil();
            if !(type_param_nodes.len() > 1
                || a.has_trailing_comma(type_parameters)
                || has_constraint)
            {
                if file_extension_is_one_of(
                    source_file.file_name(),
                    &[EXTENSION_MTS, EXTENSION_CTS],
                ) {
                    match type_param_nodes.as_slice().first() {
                        Some(&first) => {
                            self.grammar_error_on_node(first, diagnostics::THIS_SYNTAX_IS_RESERVED_IN_FILES_WITH_THE_MTS_OR_CTS_EXTENSION_ADD_A_TRAILING_COMMA_OR_EXPLICIT_CONSTRAINT, &[]);
                        }
                        // Upstream indexes the list without a test of its length.
                        None => return self.fail("index out of range [0] with length 0"),
                    }
                }
            }
        }
        let equals_greater_than_token = arrow_func.equals_greater_than_token;
        let arrow_full_text = strings::slice(
            source_file.text(),
            a.pos(equals_greater_than_token) as isize,
            a.end(equals_greater_than_token) as isize,
        );
        utf8::range(arrow_full_text).any(|(_, ch)| is_line_break(ch))
            && self.grammar_error_on_node(
                equals_greater_than_token,
                diagnostics::LINE_TERMINATOR_NOT_PERMITTED_BEFORE_ARROW,
                &[],
            )
    }

    pub fn check_grammar_index_signature_parameters(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_index_signature_declaration(node);
        let param_nodes = a.nodes(data.parameters);
        if param_nodes.len() == 0 {
            return self.grammar_error_on_node(
                node,
                diagnostics::AN_INDEX_SIGNATURE_MUST_HAVE_EXACTLY_ONE_PARAMETER,
                &[],
            );
        }
        let parameter = a.as_parameter_declaration(param_nodes.at(0));
        if param_nodes.len() != 1 {
            return self.grammar_error_on_node(
                parameter.name,
                diagnostics::AN_INDEX_SIGNATURE_MUST_HAVE_EXACTLY_ONE_PARAMETER,
                &[],
            );
        }
        self.check_grammar_for_disallowed_trailing_comma(
            data.parameters,
            diagnostics::AN_INDEX_SIGNATURE_CANNOT_HAVE_A_TRAILING_COMMA,
        );
        if !parameter.dot_dot_dot_token.is_nil() {
            return self.grammar_error_on_node(
                parameter.dot_dot_dot_token,
                diagnostics::AN_INDEX_SIGNATURE_CANNOT_HAVE_A_REST_PARAMETER,
                &[],
            );
        }
        if !parameter.modifiers.is_nil() {
            return self.grammar_error_on_node(
                parameter.name,
                diagnostics::AN_INDEX_SIGNATURE_PARAMETER_CANNOT_HAVE_AN_ACCESSIBILITY_MODIFIER,
                &[],
            );
        }
        if !parameter.question_token.is_nil() {
            return self.grammar_error_on_node(
                parameter.question_token,
                diagnostics::AN_INDEX_SIGNATURE_PARAMETER_CANNOT_HAVE_A_QUESTION_MARK,
                &[],
            );
        }
        if !parameter.initializer.is_nil() {
            return self.grammar_error_on_node(
                parameter.name,
                diagnostics::AN_INDEX_SIGNATURE_PARAMETER_CANNOT_HAVE_AN_INITIALIZER,
                &[],
            );
        }
        let type_node = parameter.type_node;
        if type_node.is_nil() {
            return self.grammar_error_on_node(
                parameter.name,
                diagnostics::AN_INDEX_SIGNATURE_PARAMETER_MUST_HAVE_A_TYPE_ANNOTATION,
                &[],
            );
        }
        let t = self.get_type_from_type_node(type_node);
        if some_type(self, t, &mut |c, t| {
            c.types[t]
                .flags
                .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE)
        }) || self.is_generic_type(t)
        {
            return self.grammar_error_on_node(parameter.name, diagnostics::AN_INDEX_SIGNATURE_PARAMETER_TYPE_CANNOT_BE_A_LITERAL_TYPE_OR_GENERIC_TYPE_CONSIDER_USING_A_MAPPED_OBJECT_TYPE_INSTEAD, &[]);
        }
        if !every_type(self, t, &mut |c, t| c.is_valid_index_key_type(t)) {
            return self.grammar_error_on_node(parameter.name, diagnostics::AN_INDEX_SIGNATURE_PARAMETER_TYPE_MUST_BE_STRING_NUMBER_SYMBOL_OR_A_TEMPLATE_LITERAL_TYPE, &[]);
        }
        if data.type_node.is_nil() {
            return self.grammar_error_on_node(
                node,
                diagnostics::AN_INDEX_SIGNATURE_MUST_HAVE_A_TYPE_ANNOTATION,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_index_signature(&mut self, node: NodeId) -> bool {
        // Prevent cascading error by short-circuit
        self.check_grammar_modifiers(node) || self.check_grammar_index_signature_parameters(node)
    }

    pub fn check_grammar_for_at_least_one_type_argument(
        &mut self,
        node: NodeId,
        type_arguments: NodeListId,
    ) -> bool {
        let a = self.ast;
        if !type_arguments.is_nil() && a.nodes(type_arguments).len() == 0 {
            let source_file = get_source_file_of_node(a, node);
            let start = a.list_pos(type_arguments) - text_len("<");
            let end = skip_trivia(
                a.as_source_file(source_file).text(),
                a.list_end(type_arguments),
            ) + text_len(">");
            return self.grammar_error_at_pos(
                source_file,
                start,
                end - start,
                diagnostics::TYPE_ARGUMENT_LIST_CANNOT_BE_EMPTY,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_type_arguments(
        &mut self,
        node: NodeId,
        type_arguments: NodeListId,
    ) -> bool {
        self.check_grammar_for_disallowed_trailing_comma(
            type_arguments,
            diagnostics::TRAILING_COMMA_NOT_ALLOWED,
        ) || self.check_grammar_for_at_least_one_type_argument(node, type_arguments)
    }

    pub fn check_grammar_tagged_template_chain(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_tagged_template_expression(node);
        if !data.question_dot_token.is_nil() || a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN)
        {
            return self.grammar_error_on_node(
                data.template,
                diagnostics::TAGGED_TEMPLATE_EXPRESSIONS_ARE_NOT_PERMITTED_IN_AN_OPTIONAL_CHAIN,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_heritage_clause(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_heritage_clause(node);
        let types = data.types;
        if self.check_grammar_for_disallowed_trailing_comma(
            types,
            diagnostics::TRAILING_COMMA_NOT_ALLOWED,
        ) {
            return true;
        }
        if !types.is_nil() && a.nodes(types).len() == 0 {
            let list_type = token_to_string(data.token);
            return self.grammar_error_at_pos(
                node,
                a.list_pos(types),
                0,
                diagnostics::X_0_LIST_CANNOT_BE_EMPTY,
                &[Arg::Str(list_type)],
            );
        }
        for &type_node in a.nodes(types).as_slice() {
            if self.check_grammar_expression_with_type_arguments(type_node) {
                return true;
            }
        }
        false
    }

    pub fn check_grammar_expression_with_type_arguments(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if is_expression_with_type_arguments(a, node)
            && a.kind(a.expression(node)) == Kind::ImportKeyword
            && !a.type_argument_list(node).is_nil()
        {
            return self.grammar_error_on_node(node, diagnostics::THIS_USE_OF_IMPORT_IS_INVALID_IMPORT_CALLS_CAN_BE_WRITTEN_BUT_THEY_MUST_HAVE_PARENTHESES_AND_CANNOT_HAVE_TYPE_ARGUMENTS, &[]);
        }
        self.check_grammar_type_arguments(node, a.type_argument_list(node))
    }

    pub fn check_grammar_class_declaration_heritage_clauses(
        &mut self,
        node: NodeId,
        _file: NodeId,
    ) -> bool {
        let a = self.ast;
        let mut seen_extends_clause = false;
        let mut seen_implements_clause = false;
        let class_like_data = a.class_like_data(node).unwrap_or_default();
        if !self.check_grammar_modifiers(node) && !class_like_data.heritage_clauses.is_nil() {
            for &heritage_clause_node in a.nodes(class_like_data.heritage_clauses).as_slice() {
                let heritage_clause = a.as_heritage_clause(heritage_clause_node);
                if heritage_clause.token == Kind::ExtendsKeyword {
                    if seen_extends_clause {
                        return self.grammar_error_on_first_token(
                            heritage_clause_node,
                            diagnostics::X_EXTENDS_CLAUSE_ALREADY_SEEN,
                            &[],
                        );
                    }
                    if seen_implements_clause {
                        return self.grammar_error_on_first_token(
                            heritage_clause_node,
                            diagnostics::X_EXTENDS_CLAUSE_MUST_PRECEDE_IMPLEMENTS_CLAUSE,
                            &[],
                        );
                    }
                    let type_nodes = a.nodes(heritage_clause.types);
                    if type_nodes.len() > 1 {
                        return self.grammar_error_on_first_token(
                            type_nodes.at(1),
                            diagnostics::CLASSES_CAN_ONLY_EXTEND_A_SINGLE_CLASS,
                            &[],
                        );
                    }
                    seen_extends_clause = true;
                } else {
                    if heritage_clause.token != Kind::ImplementsKeyword {
                        return self.fail_detail("Unexpected token", heritage_clause.token as u32);
                    }
                    if seen_implements_clause {
                        return self.grammar_error_on_first_token(
                            heritage_clause_node,
                            diagnostics::X_IMPLEMENTS_CLAUSE_ALREADY_SEEN,
                            &[],
                        );
                    }
                    seen_implements_clause = true;
                }
                // Grammar checking heritageClause inside class declaration
                self.check_grammar_heritage_clause(heritage_clause_node);
            }
        }
        false
    }

    pub fn check_grammar_interface_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let heritage_clauses = a.as_interface_declaration(node).heritage_clauses;
        if !heritage_clauses.is_nil() {
            let mut seen_extends_clause = false;
            for &heritage_clause_node in a.nodes(heritage_clauses).as_slice() {
                let heritage_clause = a.as_heritage_clause(heritage_clause_node);
                match heritage_clause.token {
                    Kind::ExtendsKeyword => {
                        if seen_extends_clause {
                            return self.grammar_error_on_first_token(
                                heritage_clause_node,
                                diagnostics::X_EXTENDS_CLAUSE_ALREADY_SEEN,
                                &[],
                            );
                        }
                        seen_extends_clause = true;
                    }
                    Kind::ImplementsKeyword => {
                        return self.grammar_error_on_first_token(
                            heritage_clause_node,
                            diagnostics::INTERFACE_DECLARATION_CANNOT_HAVE_IMPLEMENTS_CLAUSE,
                            &[],
                        );
                    }
                    token => return self.fail_detail("Unexpected token", token as u32),
                }
                // Grammar checking heritageClause inside class declaration
                self.check_grammar_heritage_clause(heritage_clause_node);
            }
        }
        false
    }

    pub fn check_grammar_computed_property_name(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        // If node is not a computedPropertyName, just skip the grammar checking
        if a.kind(node) != Kind::ComputedPropertyName {
            return false;
        }
        let expression = a.as_computed_property_name(node).expression;
        if a.kind(expression) == Kind::BinaryExpression
            && a.kind(a.as_binary_expression(expression).operator_token) == Kind::CommaToken
        {
            return self.grammar_error_on_node(
                expression,
                diagnostics::A_COMMA_EXPRESSION_IS_NOT_ALLOWED_IN_A_COMPUTED_PROPERTY_NAME,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_for_generator(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if let Some(body_data) = a.body_data(node) {
            if !body_data.asterisk_token.is_nil() {
                let kind = a.kind(node);
                if kind != Kind::FunctionDeclaration
                    && kind != Kind::FunctionExpression
                    && kind != Kind::MethodDeclaration
                {
                    return self.fail_detail("Unexpected node kind", kind as u32);
                }
                if a.flags(node).intersects(NodeFlags::AMBIENT) {
                    return self.grammar_error_on_node(
                        body_data.asterisk_token,
                        diagnostics::GENERATORS_ARE_NOT_ALLOWED_IN_AN_AMBIENT_CONTEXT,
                        &[],
                    );
                }
                if body_data.body.is_nil() {
                    return self.grammar_error_on_node(
                        body_data.asterisk_token,
                        diagnostics::AN_OVERLOAD_SIGNATURE_CANNOT_BE_DECLARED_AS_A_GENERATOR,
                        &[],
                    );
                }
            }
        }
        false
    }

    pub fn check_grammar_for_invalid_question_mark(
        &mut self,
        postfix_token: NodeId,
        message: MessageId,
    ) -> bool {
        !postfix_token.is_nil()
            && self.ast.kind(postfix_token) == Kind::QuestionToken
            && self.grammar_error_on_node(postfix_token, message, &[])
    }

    pub fn check_grammar_for_invalid_exclamation_token(
        &mut self,
        postfix_token: NodeId,
        message: MessageId,
    ) -> bool {
        !postfix_token.is_nil()
            && self.ast.kind(postfix_token) == Kind::ExclamationToken
            && self.grammar_error_on_node(postfix_token, message, &[])
    }

    pub fn check_grammar_object_literal_expression(
        &mut self,
        node: NodeId,
        in_destructuring: bool,
    ) -> bool {
        let a = self.ast;
        let mut seen: BTreeMap<Text<'a>, DeclarationMeaning> = BTreeMap::new();
        let properties = a.nodes(a.as_object_literal_expression(node).properties);
        for &prop in properties.as_slice() {
            let prop_kind = a.kind(prop);
            if prop_kind == Kind::SpreadAssignment {
                let spread_expression = a.as_spread_assignment(prop).expression;
                if in_destructuring {
                    // a rest property cannot be destructured any further
                    let expression = skip_parentheses(a, spread_expression);
                    if is_array_literal_expression(a, expression)
                        || is_object_literal_expression(a, expression)
                    {
                        return self.grammar_error_on_node(
                            spread_expression,
                            diagnostics::A_REST_ELEMENT_CANNOT_CONTAIN_A_BINDING_PATTERN,
                            &[],
                        );
                    }
                }
                continue;
            }
            let name = a.name(prop);
            if a.kind(name) == Kind::ComputedPropertyName {
                // If the name is not a ComputedPropertyName, the grammar checking will skip it
                self.check_grammar_computed_property_name(name);
            }
            if prop_kind == Kind::ShorthandPropertyAssignment && !in_destructuring {
                let object_assignment_initializer = a
                    .as_shorthand_property_assignment(prop)
                    .object_assignment_initializer;
                if !object_assignment_initializer.is_nil() {
                    // having objectAssignmentInitializer is only valid in an ObjectAssignmentPattern. Outside of destructuring, it is a syntax error. Try to grab the last node prior to the initializer, then error on the first token following (which should be the `=` token).
                    let mut last_node_before_initializer = NodeId::NIL;
                    a.for_each_child(prop, &mut |child| {
                        if child != object_assignment_initializer {
                            last_node_before_initializer = child;
                            return false;
                        }
                        true
                    });
                    self.grammar_error_on_first_token(last_node_before_initializer, diagnostics::DID_YOU_MEAN_TO_USE_A_COLON_AN_CAN_ONLY_FOLLOW_A_PROPERTY_NAME_WHEN_THE_CONTAINING_OBJECT_LITERAL_IS_PART_OF_A_DESTRUCTURING_PATTERN, &[]);
                }
            }
            if a.kind(name) == Kind::PrivateIdentifier {
                self.grammar_error_on_node(
                    name,
                    diagnostics::PRIVATE_IDENTIFIERS_ARE_NOT_ALLOWED_OUTSIDE_CLASS_BODIES,
                    &[],
                );
            }
            // Modifiers are never allowed on properties except for 'async' on a method declaration
            let modifiers = a.modifier_nodes(prop);
            if modifiers.len() != 0 {
                if can_have_modifiers(a, prop) {
                    for &modifier in modifiers.as_slice() {
                        if is_modifier(a, modifier)
                            && (a.kind(modifier) != Kind::AsyncKeyword
                                || prop_kind != Kind::MethodDeclaration)
                        {
                            let text = get_text_of_node(a, modifier);
                            self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_HERE,
                                &[Arg::Str(&text)],
                            );
                        }
                    }
                } else if can_have_illegal_modifiers(a, prop) {
                    for &modifier in modifiers.as_slice() {
                        if is_modifier(a, modifier) {
                            let text = get_text_of_node(a, modifier);
                            self.grammar_error_on_node(
                                modifier,
                                diagnostics::X_0_MODIFIER_CANNOT_BE_USED_HERE,
                                &[Arg::Str(&text)],
                            );
                        }
                    }
                }
            }
            // ECMA-262 11.1.5 Object Initializer: if previous is not undefined then throw a SyntaxError exception if any of the following conditions are true. a. This production is contained in strict code and IsDataDescriptor(previous) is true and IsDataDescriptor(propId.descriptor) is true. b. IsDataDescriptor(previous) is true and IsAccessorDescriptor(propId.descriptor) is true. c. IsAccessorDescriptor(previous) is true and IsDataDescriptor(propId.descriptor) is true. d. IsAccessorDescriptor(previous) is true and IsAccessorDescriptor(propId.descriptor) is true and either both previous and propId.descriptor have [[Get]] fields or both previous and propId.descriptor have [[Set]] fields.
            let current_kind = match prop_kind {
                Kind::ShorthandPropertyAssignment | Kind::PropertyAssignment => {
                    let postfix_token = a.postfix_token(prop);
                    // Grammar checking for computedPropertyName and shorthandPropertyAssignment
                    self.check_grammar_for_invalid_exclamation_token(
                        postfix_token,
                        diagnostics::A_DEFINITE_ASSIGNMENT_ASSERTION_IS_NOT_PERMITTED_IN_THIS_CONTEXT,
                    );
                    self.check_grammar_for_invalid_question_mark(
                        postfix_token,
                        diagnostics::AN_OBJECT_MEMBER_CANNOT_BE_DECLARED_OPTIONAL,
                    );
                    if a.kind(name) == Kind::NumericLiteral {
                        self.check_grammar_numeric_literal(name);
                    }
                    if a.kind(name) == Kind::BigIntLiteral {
                        let diagnostic = self.create_diagnostic_for_node(
                            name,
                            diagnostics::A_BIGINT_LITERAL_CANNOT_BE_USED_AS_A_PROPERTY_NAME,
                            &[],
                        );
                        self.add_error_or_suggestion(true, diagnostic);
                    }
                    DeclarationMeaning::PROPERTY_ASSIGNMENT
                }
                Kind::MethodDeclaration => DeclarationMeaning::METHOD,
                Kind::GetAccessor => DeclarationMeaning::GET_ACCESSOR,
                Kind::SetAccessor => DeclarationMeaning::SET_ACCESSOR,
                _ => return self.fail_detail("Unexpected node kind", prop_kind as u32),
            };
            if !in_destructuring {
                let (effective_name, ok) =
                    self.get_effective_property_name_for_property_name_node(name);
                if !ok {
                    continue;
                }
                let existing_kind = seen
                    .get(effective_name)
                    .copied()
                    .unwrap_or(DeclarationMeaning::NONE);
                if existing_kind == DeclarationMeaning::NONE {
                    seen.insert(effective_name, current_kind);
                } else {
                    if current_kind.intersects(DeclarationMeaning::METHOD)
                        && existing_kind.intersects(DeclarationMeaning::METHOD)
                    {
                        let text = get_text_of_node(a, name);
                        self.grammar_error_on_node(
                            name,
                            diagnostics::DUPLICATE_IDENTIFIER_0,
                            &[Arg::Str(&text)],
                        );
                    } else if current_kind.intersects(DeclarationMeaning::PROPERTY_ASSIGNMENT)
                        && existing_kind.intersects(DeclarationMeaning::PROPERTY_ASSIGNMENT)
                    {
                        let text = get_text_of_node(a, name);
                        self.grammar_error_on_node(name, diagnostics::AN_OBJECT_LITERAL_CANNOT_HAVE_MULTIPLE_PROPERTIES_WITH_THE_SAME_NAME, &[Arg::Str(&text)]);
                    } else if current_kind.intersects(DeclarationMeaning::GET_OR_SET_ACCESSOR)
                        && existing_kind.intersects(DeclarationMeaning::GET_OR_SET_ACCESSOR)
                    {
                        if existing_kind != DeclarationMeaning::GET_OR_SET_ACCESSOR
                            && current_kind != existing_kind
                        {
                            seen.insert(effective_name, current_kind | existing_kind);
                        } else {
                            return self.grammar_error_on_node(name, diagnostics::AN_OBJECT_LITERAL_CANNOT_HAVE_MULTIPLE_GET_SLASHSET_ACCESSORS_WITH_THE_SAME_NAME, &[]);
                        }
                    } else {
                        return self.grammar_error_on_node(name, diagnostics::AN_OBJECT_LITERAL_CANNOT_HAVE_PROPERTY_AND_ACCESSOR_WITH_THE_SAME_NAME, &[]);
                    }
                }
            }
        }
        false
    }

    pub fn check_grammar_jsx_element(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        self.check_grammar_jsx_name(a.tag_name(node));
        self.check_grammar_type_arguments(node, a.type_argument_list(node));
        let mut seen: Set<Text<'a>> = Set::default();
        for &attr_node in a.properties(a.attributes(node)).as_slice() {
            if a.kind(attr_node) == Kind::JsxSpreadAttribute {
                continue;
            }
            let attr = a.as_jsx_attribute(attr_node);
            let name = attr.name;
            let initializer = attr.initializer;
            let text_of_name = a.text(name);
            if !seen.has(&text_of_name) {
                seen.add(text_of_name);
            } else {
                return self.grammar_error_on_node(
                    name,
                    diagnostics::JSX_ELEMENTS_CANNOT_HAVE_MULTIPLE_ATTRIBUTES_WITH_THE_SAME_NAME,
                    &[],
                );
            }
            if !initializer.is_nil()
                && a.kind(initializer) == Kind::JsxExpression
                && a.expression(initializer).is_nil()
            {
                return self.grammar_error_on_node(
                    initializer,
                    diagnostics::JSX_ATTRIBUTES_MUST_ONLY_BE_ASSIGNED_A_NON_EMPTY_EXPRESSION,
                    &[],
                );
            }
        }
        false
    }

    pub fn check_grammar_jsx_name(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if is_property_access_expression(a, node) && is_jsx_namespaced_name(a, a.expression(node)) {
            return self.grammar_error_on_node(
                a.expression(node),
                diagnostics::JSX_PROPERTY_ACCESS_EXPRESSIONS_CANNOT_INCLUDE_JSX_NAMESPACE_NAMES,
                &[],
            );
        }
        if is_jsx_namespaced_name(a, node)
            && self.compiler_options.get_jsx_transform_enabled()
            && !is_intrinsic_jsx_name(a.text(a.as_jsx_namespaced_name(node).namespace))
        {
            return self.grammar_error_on_node(
                node,
                diagnostics::REACT_COMPONENTS_CANNOT_INCLUDE_JSX_NAMESPACE_NAMES,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_jsx_expression(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let expression = a.as_jsx_expression(node).expression;
        if !expression.is_nil() && is_comma_sequence(a, expression) {
            return self.grammar_error_on_node(expression, diagnostics::JSX_EXPRESSIONS_MAY_NOT_USE_THE_COMMA_OPERATOR_DID_YOU_MEAN_TO_WRITE_AN_ARRAY, &[]);
        }
        false
    }

    pub fn check_grammar_for_in_or_for_of_statement(
        &mut self,
        for_in_or_of_statement: NodeId,
    ) -> bool {
        let a = self.ast;
        if self.check_grammar_statement_in_ambient_context(for_in_or_of_statement) {
            return true;
        }
        let data = a.as_for_in_or_of_statement(for_in_or_of_statement);
        let kind = a.kind(for_in_or_of_statement);
        let in_await_context = a
            .flags(for_in_or_of_statement)
            .intersects(NodeFlags::AWAIT_CONTEXT);
        if kind == Kind::ForOfStatement && !data.await_modifier.is_nil() {
            if !in_await_context {
                let source_file = get_source_file_of_node(a, for_in_or_of_statement);
                if is_in_top_level_context(a, for_in_or_of_statement) {
                    if !self.has_parse_diagnostics(source_file) {
                        if !is_effective_external_module(a, source_file, self.compiler_options) {
                            let diagnostic = self.create_diagnostic_for_node(data.await_modifier, diagnostics::X_FOR_AWAIT_LOOPS_ARE_ONLY_ALLOWED_AT_THE_TOP_LEVEL_OF_A_FILE_WHEN_THAT_FILE_IS_A_MODULE_BUT_THIS_FILE_HAS_NO_IMPORTS_OR_EXPORTS_CONSIDER_ADDING_AN_EMPTY_EXPORT_TO_MAKE_THIS_FILE_A_MODULE, &[]);
                            self.add_diagnostic(diagnostic);
                        }
                        // The cases of upstream's switch on the module kind: the node module kinds fall through to the module kinds that have top-level await, and those fall through to the default.
                        let is_node_module_kind = matches!(
                            self.module_kind,
                            ModuleKind::NODE16
                                | ModuleKind::NODE18
                                | ModuleKind::NODE20
                                | ModuleKind::NODE_NEXT
                        );
                        'module_kind: {
                            if is_node_module_kind {
                                let source_file_meta_data =
                                    self.program.get_source_file_meta_data(source_file);
                                if source_file_meta_data.implied_node_format
                                    == ModuleKind::COMMON_JS
                                {
                                    let diagnostic = self.create_diagnostic_for_node(data.await_modifier, diagnostics::THE_CURRENT_FILE_IS_A_COMMONJS_MODULE_AND_CANNOT_USE_AWAIT_AT_THE_TOP_LEVEL, &[]);
                                    self.add_diagnostic(diagnostic);
                                    break 'module_kind;
                                }
                            }
                            if (is_node_module_kind
                                || matches!(
                                    self.module_kind,
                                    ModuleKind::ES2022
                                        | ModuleKind::ES_NEXT
                                        | ModuleKind::PRESERVE
                                        | ModuleKind::SYSTEM
                                ))
                                && self.language_version >= ScriptTarget::ES2017
                            {
                                break 'module_kind;
                            }
                            let diagnostic = self.create_diagnostic_for_node(data.await_modifier, diagnostics::TOP_LEVEL_FOR_AWAIT_LOOPS_ARE_ONLY_ALLOWED_WHEN_THE_MODULE_OPTION_IS_SET_TO_ES2022_ESNEXT_SYSTEM_NODE16_NODE18_NODE20_NODENEXT_OR_PRESERVE_AND_THE_TARGET_OPTION_IS_SET_TO_ES2017_OR_HIGHER, &[]);
                            self.add_diagnostic(diagnostic);
                        }
                    }
                } else {
                    // use of 'for-await-of' in non-async function
                    if !self.has_parse_diagnostics(source_file) {
                        let diagnostic = self.create_diagnostic_for_node(data.await_modifier, diagnostics::X_FOR_AWAIT_LOOPS_ARE_ONLY_ALLOWED_WITHIN_ASYNC_FUNCTIONS_AND_AT_THE_TOP_LEVELS_OF_MODULES, &[]);
                        let containing_func = get_containing_function(a, for_in_or_of_statement);
                        if !containing_func.is_nil() && a.kind(containing_func) != Kind::Constructor
                        {
                            self.assert(
                                !get_function_flags(a, containing_func)
                                    .intersects(FunctionFlags::ASYNC),
                                "Enclosing function should never be an async function.",
                            );
                            let related_info = self.create_diagnostic_for_node(
                                containing_func,
                                diagnostics::DID_YOU_MEAN_TO_MARK_THIS_FUNCTION_AS_ASYNC,
                                &[],
                            );
                            self.diagnostic_store
                                .add_related_info(diagnostic, related_info);
                        }
                        self.add_diagnostic(diagnostic);
                        return true;
                    }
                }
            }
        }
        if is_for_of_statement(a, for_in_or_of_statement)
            && !in_await_context
            && is_identifier(a, data.initializer)
            && a.text(data.initializer) == b"async"
        {
            self.grammar_error_on_node(
                data.initializer,
                diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_OF_STATEMENT_MAY_NOT_BE_ASYNC,
                &[],
            );
            return false;
        }
        if a.kind(data.initializer) == Kind::VariableDeclarationList {
            let variable_list = data.initializer;
            if !self.check_grammar_variable_declaration_list(variable_list) {
                let declarations =
                    a.nodes(a.as_variable_declaration_list(variable_list).declarations);
                // declarations.length can be zero if there is an error in variable declaration in for-of or for-in. See http://www.ecma-international.org/ecma-262/6.0/#sec-for-in-and-for-of-statements for details. For example, after `var let = 10;` both `for (let of [1,2,3]) {}` and `for (let in [1,2,3]) {}` are invalid ES6 syntax. We will then want to skip on grammar checking on variableList declaration
                if declarations.len() == 0 {
                    return false;
                }
                if declarations.len() > 1 {
                    let diagnostic = if kind == Kind::ForInStatement {
                        diagnostics::ONLY_A_SINGLE_VARIABLE_DECLARATION_IS_ALLOWED_IN_A_FOR_IN_STATEMENT
                    } else {
                        diagnostics::ONLY_A_SINGLE_VARIABLE_DECLARATION_IS_ALLOWED_IN_A_FOR_OF_STATEMENT
                    };
                    return self.grammar_error_on_first_token(declarations.at(1), diagnostic, &[]);
                }
                let first_variable_declaration_node = declarations.at(0);
                let first_variable_declaration =
                    a.as_variable_declaration(first_variable_declaration_node);
                if !first_variable_declaration.initializer.is_nil() {
                    let diagnostic = if kind == Kind::ForInStatement {
                        diagnostics::THE_VARIABLE_DECLARATION_OF_A_FOR_IN_STATEMENT_CANNOT_HAVE_AN_INITIALIZER
                    } else {
                        diagnostics::THE_VARIABLE_DECLARATION_OF_A_FOR_OF_STATEMENT_CANNOT_HAVE_AN_INITIALIZER
                    };
                    return self.grammar_error_on_node(
                        first_variable_declaration.name,
                        diagnostic,
                        &[],
                    );
                }
                if !first_variable_declaration.type_node.is_nil() {
                    let diagnostic = if kind == Kind::ForInStatement {
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_CANNOT_USE_A_TYPE_ANNOTATION
                    } else {
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_OF_STATEMENT_CANNOT_USE_A_TYPE_ANNOTATION
                    };
                    return self.grammar_error_on_node(
                        first_variable_declaration_node,
                        diagnostic,
                        &[],
                    );
                }
            }
        }
        false
    }

    pub fn check_grammar_accessor(&mut self, accessor: NodeId) -> bool {
        let a = self.ast;
        let body = a.body(accessor);
        let parent_kind = a.kind(a.parent(accessor));
        if !a.flags(accessor).intersects(NodeFlags::AMBIENT)
            && parent_kind != Kind::TypeLiteral
            && parent_kind != Kind::InterfaceDeclaration
        {
            if body.is_nil() && !has_syntactic_modifier(a, accessor, ModifierFlags::ABSTRACT) {
                return self.grammar_error_at_pos(
                    accessor,
                    a.end(accessor) - 1,
                    text_len(";"),
                    diagnostics::X_0_EXPECTED,
                    &[Arg::Str(b"{")],
                );
            }
        }
        if !body.is_nil() {
            if has_syntactic_modifier(a, accessor, ModifierFlags::ABSTRACT) {
                return self.grammar_error_on_node(
                    accessor,
                    diagnostics::AN_ABSTRACT_ACCESSOR_CANNOT_HAVE_AN_IMPLEMENTATION,
                    &[],
                );
            }
            if parent_kind == Kind::TypeLiteral || parent_kind == Kind::InterfaceDeclaration {
                return self.grammar_error_on_node(
                    body,
                    diagnostics::AN_IMPLEMENTATION_CANNOT_BE_DECLARED_IN_AMBIENT_CONTEXTS,
                    &[],
                );
            }
        }
        let func_data = a.function_like_data(accessor);
        let type_parameters = func_data.map_or(NodeListId::NIL, |data| data.type_parameters);
        if !type_parameters.is_nil() {
            return self.grammar_error_on_node(
                a.name(accessor),
                diagnostics::AN_ACCESSOR_CANNOT_HAVE_TYPE_PARAMETERS,
                &[],
            );
        }
        if !self.does_accessor_have_correct_parameter_count(accessor) {
            return self.grammar_error_on_node(
                a.name(accessor),
                if_else(
                    a.kind(accessor) == Kind::GetAccessor,
                    diagnostics::A_GET_ACCESSOR_CANNOT_HAVE_PARAMETERS,
                    diagnostics::A_SET_ACCESSOR_MUST_HAVE_EXACTLY_ONE_PARAMETER,
                ),
                &[],
            );
        }
        if a.kind(accessor) == Kind::SetAccessor {
            if func_data.is_some_and(|data| !data.type_node.is_nil()) {
                return self.grammar_error_on_node(
                    a.name(accessor),
                    diagnostics::A_SET_ACCESSOR_CANNOT_HAVE_A_RETURN_TYPE_ANNOTATION,
                    &[],
                );
            }
            let parameter_node = get_set_accessor_value_parameter(a, accessor);
            if parameter_node.is_nil() {
                return self.fail("Return value does not match parameter count assertion.");
            }
            let parameter = a.as_parameter_declaration(parameter_node);
            if !parameter.dot_dot_dot_token.is_nil() {
                return self.grammar_error_on_node(
                    parameter.dot_dot_dot_token,
                    diagnostics::A_SET_ACCESSOR_CANNOT_HAVE_REST_PARAMETER,
                    &[],
                );
            }
            if !parameter.question_token.is_nil() {
                return self.grammar_error_on_node(
                    parameter.question_token,
                    diagnostics::A_SET_ACCESSOR_CANNOT_HAVE_AN_OPTIONAL_PARAMETER,
                    &[],
                );
            }
            if !parameter.initializer.is_nil() {
                return self.grammar_error_on_node(
                    a.name(accessor),
                    diagnostics::A_SET_ACCESSOR_PARAMETER_CANNOT_HAVE_AN_INITIALIZER,
                    &[],
                );
            }
        }
        false
    }

    // Does the accessor have the right number of parameters? A `get` accessor has no parameters or a single `this` parameter. A `set` accessor has one parameter or a `this` parameter and one more parameter.
    pub fn does_accessor_have_correct_parameter_count(&self, accessor: NodeId) -> bool {
        let a = self.ast;
        // `getAccessorThisParameter` returns `nil` if the accessor's arity is incorrect, even if there is a `this` parameter declared.
        !self.get_accessor_this_parameter(accessor).is_nil()
            || a.parameters(accessor).len() == if_else(a.kind(accessor) == Kind::GetAccessor, 0, 1)
    }

    pub fn check_grammar_type_operator_node(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_type_operator_node(node);
        if data.operator == Kind::UniqueKeyword {
            let inner_type = data.type_node;
            if a.kind(inner_type) != Kind::SymbolKeyword {
                return self.grammar_error_on_node(
                    inner_type,
                    diagnostics::X_0_EXPECTED,
                    &[Arg::Str(token_to_string(Kind::SymbolKeyword))],
                );
            }
            let parent = walk_up_parenthesized_types(a, a.parent(node));
            match a.kind(parent) {
                Kind::VariableDeclaration => {
                    let decl = a.as_variable_declaration(parent);
                    if a.kind(decl.name) != Kind::Identifier {
                        return self.grammar_error_on_node(node, diagnostics::X_UNIQUE_SYMBOL_TYPES_MAY_NOT_BE_USED_ON_A_VARIABLE_DECLARATION_WITH_A_BINDING_NAME, &[]);
                    }
                    if !is_variable_declaration_in_variable_statement(a, parent) {
                        return self.grammar_error_on_node(node, diagnostics::X_UNIQUE_SYMBOL_TYPES_ARE_ONLY_ALLOWED_ON_VARIABLES_IN_A_VARIABLE_STATEMENT, &[]);
                    }
                    if !a.flags(a.parent(parent)).intersects(NodeFlags::CONST) {
                        return self.grammar_error_on_node(
                            decl.name,
                            diagnostics::A_VARIABLE_WHOSE_TYPE_IS_A_UNIQUE_SYMBOL_TYPE_MUST_BE_CONST,
                            &[],
                        );
                    }
                }
                Kind::PropertyDeclaration => {
                    if !is_static(a, parent) || !has_readonly_modifier(a, parent) {
                        return self.grammar_error_on_node(a.as_property_declaration(parent).name, diagnostics::A_PROPERTY_OF_A_CLASS_WHOSE_TYPE_IS_A_UNIQUE_SYMBOL_TYPE_MUST_BE_BOTH_STATIC_AND_READONLY, &[]);
                    }
                }
                Kind::PropertySignature => {
                    if !has_syntactic_modifier(a, parent, ModifierFlags::READONLY) {
                        return self.grammar_error_on_node(a.as_property_signature_declaration(parent).name, diagnostics::A_PROPERTY_OF_AN_INTERFACE_OR_TYPE_LITERAL_WHOSE_TYPE_IS_A_UNIQUE_SYMBOL_TYPE_MUST_BE_READONLY, &[]);
                    }
                }
                _ => {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::X_UNIQUE_SYMBOL_TYPES_ARE_NOT_ALLOWED_HERE,
                        &[],
                    );
                }
            }
        } else if data.operator == Kind::ReadonlyKeyword {
            let inner_type = data.type_node;
            if a.kind(inner_type) != Kind::ArrayType && a.kind(inner_type) != Kind::TupleType {
                return self.grammar_error_on_first_token(node, diagnostics::X_READONLY_TYPE_MODIFIER_IS_ONLY_PERMITTED_ON_ARRAY_AND_TUPLE_LITERAL_TYPES, &[Arg::Str(token_to_string(Kind::SymbolKeyword))]);
            }
        }
        false
    }

    pub fn check_grammar_for_invalid_dynamic_name(
        &mut self,
        node: NodeId,
        message: MessageId,
    ) -> bool {
        let a = self.ast;
        if !self.is_non_bindable_dynamic_name(node) {
            return false;
        }
        let expression = if is_element_access_expression(a, node) {
            skip_parentheses(a, a.as_element_access_expression(node).argument_expression)
        } else {
            a.expression(node)
        };
        if !is_entity_name_expression(a, expression) {
            return self.grammar_error_on_node(node, message, &[]);
        }
        false
    }

    // Indicates whether a declaration name is a dynamic name that cannot be late-bound.
    pub fn is_non_bindable_dynamic_name(&mut self, node: NodeId) -> bool {
        is_dynamic_name(self.ast, node) && !self.is_late_bindable_name(node)
    }

    pub fn check_grammar_method(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if self.check_grammar_function_like_declaration(node) {
            return true;
        }
        let kind = a.kind(node);
        let parent = a.parent(node);
        let parent_kind = a.kind(parent);
        if kind == Kind::MethodDeclaration {
            if parent_kind == Kind::ObjectLiteralExpression {
                // We only disallow modifier on a method declaration if it is a property of object-literal-expression
                let modifiers = a.modifiers(node);
                if !modifiers.is_nil() {
                    let modifier_nodes = a.modifier_list_nodes(modifiers);
                    if !(modifier_nodes.len() == 1
                        && a.kind(modifier_nodes.at(0)) == Kind::AsyncKeyword)
                    {
                        return self.grammar_error_on_first_token(
                            node,
                            diagnostics::MODIFIERS_CANNOT_APPEAR_HERE,
                            &[],
                        );
                    }
                }
                let postfix_token = a.as_method_declaration(node).postfix_token;
                if self.check_grammar_for_invalid_question_mark(
                    postfix_token,
                    diagnostics::AN_OBJECT_MEMBER_CANNOT_BE_DECLARED_OPTIONAL,
                ) {
                    return true;
                }
                if self.check_grammar_for_invalid_exclamation_token(
                    postfix_token,
                    diagnostics::A_DEFINITE_ASSIGNMENT_ASSERTION_IS_NOT_PERMITTED_IN_THIS_CONTEXT,
                ) {
                    return true;
                }
                if a.body(node).is_nil() {
                    return self.grammar_error_at_pos(
                        node,
                        a.end(node) - 1,
                        text_len(";"),
                        diagnostics::X_0_EXPECTED,
                        &[Arg::Str(b"{")],
                    );
                }
            }
            if self.check_grammar_for_generator(node) {
                return true;
            }
        }
        if is_class_like(a, parent) {
            // Technically, computed properties in ambient contexts is disallowed for property declarations and accessors too, not just methods. However, property declarations disallow computed names in general, and accessors are not allowed in ambient contexts in general, so this error only really matters for methods.
            if a.flags(node).intersects(NodeFlags::AMBIENT) {
                return self.check_grammar_for_invalid_dynamic_name(a.name(node), diagnostics::A_COMPUTED_PROPERTY_NAME_IN_AN_AMBIENT_CONTEXT_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE);
            } else if kind == Kind::MethodDeclaration && a.body(node).is_nil() {
                return self.check_grammar_for_invalid_dynamic_name(a.name(node), diagnostics::A_COMPUTED_PROPERTY_NAME_IN_A_METHOD_OVERLOAD_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE);
            }
        } else if parent_kind == Kind::InterfaceDeclaration {
            return self.check_grammar_for_invalid_dynamic_name(a.name(node), diagnostics::A_COMPUTED_PROPERTY_NAME_IN_AN_INTERFACE_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE);
        } else if parent_kind == Kind::TypeLiteral {
            return self.check_grammar_for_invalid_dynamic_name(a.name(node), diagnostics::A_COMPUTED_PROPERTY_NAME_IN_A_TYPE_LITERAL_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE);
        }
        false
    }

    pub fn check_grammar_break_or_continue_statement(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let kind = a.kind(node);
        let target_label = a.label(node);
        let mut current = node;
        while !current.is_nil() {
            if is_function_like_or_class_static_block_declaration(a, current) {
                return self.grammar_error_on_node(
                    node,
                    diagnostics::JUMP_TARGET_CANNOT_CROSS_FUNCTION_BOUNDARY,
                    &[],
                );
            }
            match a.kind(current) {
                Kind::LabeledStatement => {
                    if !target_label.is_nil() && a.text(a.label(current)) == a.text(target_label) {
                        // found matching label - verify that label usage is correct: continue can only target labels that are on iteration statements
                        let is_misplaced_continue_label = kind == Kind::ContinueStatement
                            && !is_iteration_statement(a, a.statement(current), true);
                        if is_misplaced_continue_label {
                            return self.grammar_error_on_node(node, diagnostics::A_CONTINUE_STATEMENT_CAN_ONLY_JUMP_TO_A_LABEL_OF_AN_ENCLOSING_ITERATION_STATEMENT, &[]);
                        }
                        return false;
                    }
                }
                Kind::SwitchStatement => {
                    if kind == Kind::BreakStatement && target_label.is_nil() {
                        // unlabeled break within switch statement - ok
                        return false;
                    }
                }
                _ => {
                    if is_iteration_statement(a, current, false) && target_label.is_nil() {
                        // unlabeled break or continue within iteration statement - ok
                        return false;
                    }
                }
            }
            current = a.parent(current);
        }
        if !target_label.is_nil() {
            let message = if kind == Kind::BreakStatement {
                diagnostics::A_BREAK_STATEMENT_CAN_ONLY_JUMP_TO_A_LABEL_OF_AN_ENCLOSING_STATEMENT
            } else {
                diagnostics::A_CONTINUE_STATEMENT_CAN_ONLY_JUMP_TO_A_LABEL_OF_AN_ENCLOSING_ITERATION_STATEMENT
            };
            self.grammar_error_on_node(node, message, &[])
        } else {
            let message = if kind == Kind::BreakStatement {
                diagnostics::A_BREAK_STATEMENT_CAN_ONLY_BE_USED_WITHIN_AN_ENCLOSING_ITERATION_OR_SWITCH_STATEMENT
            } else {
                diagnostics::A_CONTINUE_STATEMENT_CAN_ONLY_BE_USED_WITHIN_AN_ENCLOSING_ITERATION_STATEMENT
            };
            self.grammar_error_on_node(node, message, &[])
        }
    }

    pub fn check_grammar_binding_element(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_binding_element(node);
        if !data.dot_dot_dot_token.is_nil() {
            let elements = a.element_list(a.parent(node));
            if node != last_or_nil(a.nodes(elements).as_slice()) {
                return self.grammar_error_on_node(
                    node,
                    diagnostics::A_REST_ELEMENT_MUST_BE_LAST_IN_A_DESTRUCTURING_PATTERN,
                    &[],
                );
            }
            self.check_grammar_for_disallowed_trailing_comma(
                elements,
                diagnostics::A_REST_PARAMETER_OR_BINDING_PATTERN_MAY_NOT_HAVE_A_TRAILING_COMMA,
            );
            if !data.property_name.is_nil() {
                return self.grammar_error_on_node(
                    data.name,
                    diagnostics::A_REST_ELEMENT_CANNOT_HAVE_A_PROPERTY_NAME,
                    &[],
                );
            }
        }
        if !data.dot_dot_dot_token.is_nil() && !data.initializer.is_nil() {
            // Error on equals token which immediately precedes the initializer
            return self.grammar_error_at_pos(
                node,
                a.pos(data.initializer) - 1,
                1,
                diagnostics::A_REST_ELEMENT_CANNOT_HAVE_AN_INITIALIZER,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_variable_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_variable_declaration(node);
        let node_flags = self.get_combined_node_flags_cached(node);
        let block_scope_kind = node_flags & NodeFlags::BLOCK_SCOPED;
        if is_binding_pattern(a, data.name) {
            if block_scope_kind == NodeFlags::AWAIT_USING {
                return self.grammar_error_on_node(
                    node,
                    diagnostics::X_0_DECLARATIONS_MAY_NOT_HAVE_BINDING_PATTERNS,
                    &[Arg::Str(b"await using")],
                );
            } else if block_scope_kind == NodeFlags::USING {
                return self.grammar_error_on_node(
                    node,
                    diagnostics::X_0_DECLARATIONS_MAY_NOT_HAVE_BINDING_PATTERNS,
                    &[Arg::Str(b"using")],
                );
            }
        }
        let parent = a.parent(node);
        let grandparent = a.parent(parent);
        let grandparent_kind = a.kind(grandparent);
        if grandparent_kind != Kind::ForInStatement && grandparent_kind != Kind::ForOfStatement {
            if node_flags.intersects(NodeFlags::AMBIENT) {
                self.check_ambient_initializer(node);
            } else if data.initializer.is_nil() {
                if is_binding_pattern(a, data.name) && !is_binding_pattern(a, parent) {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::A_DESTRUCTURING_DECLARATION_MUST_HAVE_AN_INITIALIZER,
                        &[],
                    );
                }
                if block_scope_kind == NodeFlags::AWAIT_USING {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::X_0_DECLARATIONS_MUST_BE_INITIALIZED,
                        &[Arg::Str(b"await using")],
                    );
                } else if block_scope_kind == NodeFlags::USING {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::X_0_DECLARATIONS_MUST_BE_INITIALIZED,
                        &[Arg::Str(b"using")],
                    );
                } else if block_scope_kind == NodeFlags::CONST {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::X_0_DECLARATIONS_MUST_BE_INITIALIZED,
                        &[Arg::Str(b"const")],
                    );
                }
            }
        }
        if !data.exclamation_token.is_nil()
            && (grandparent_kind != Kind::VariableStatement
                || data.type_node.is_nil()
                || !data.initializer.is_nil()
                || node_flags.intersects(NodeFlags::AMBIENT))
        {
            let message = if !data.initializer.is_nil() {
                diagnostics::DECLARATIONS_WITH_INITIALIZERS_CANNOT_ALSO_HAVE_DEFINITE_ASSIGNMENT_ASSERTIONS
            } else if data.type_node.is_nil() {
                diagnostics::DECLARATIONS_WITH_DEFINITE_ASSIGNMENT_ASSERTIONS_MUST_ALSO_HAVE_TYPE_ANNOTATIONS
            } else {
                diagnostics::A_DEFINITE_ASSIGNMENT_ASSERTION_IS_NOT_PERMITTED_IN_THIS_CONTEXT
            };
            return self.grammar_error_on_node(data.exclamation_token, message, &[]);
        }
        if self
            .program
            .get_emit_module_format_of_file(get_source_file_of_node(a, node))
            < ModuleKind::SYSTEM
            && !a.flags(grandparent).intersects(NodeFlags::AMBIENT)
            && has_syntactic_modifier(a, grandparent, ModifierFlags::EXPORT)
        {
            self.check_grammar_for_es_module_marker_in_binding_name(data.name);
        }
        // 1. LexicalDeclaration : LetOrConst BindingList ; It is a Syntax Error if the BoundNames of BindingList contains "let". 2. ForDeclaration: ForDeclaration : LetOrConst ForBinding It is a Syntax Error if the BoundNames of ForDeclaration contains "let". It is a SyntaxError if a VariableDeclaration or VariableDeclarationNoIn occurs within strict code and its Identifier is eval or arguments
        block_scope_kind != NodeFlags::NONE
            && self.check_grammar_name_in_let_or_const_declarations(data.name)
    }

    pub fn check_grammar_for_es_module_marker_in_binding_name(&mut self, name: NodeId) -> bool {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if is_identifier(a, name) {
            if a.text(name) == b"__esModule" {
                return self.grammar_error_on_node_skipped_on_no_emit(name, diagnostics::IDENTIFIER_EXPECTED_ESMODULE_IS_RESERVED_AS_AN_EXPORTED_MARKER_WHEN_TRANSFORMING_ECMASCRIPT_MODULES, &[]);
            }
        } else {
            for &element in a.elements(name).as_slice() {
                if !a.name(element).is_nil() {
                    return self
                        .check_grammar_for_es_module_marker_in_binding_name(a.name(element));
                }
            }
        }
        false
    }

    pub fn check_grammar_name_in_let_or_const_declarations(&mut self, name: NodeId) -> bool {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if a.kind(name) == Kind::Identifier {
            if a.text(name) == b"let" {
                return self.grammar_error_on_node(name, diagnostics::X_LET_IS_NOT_ALLOWED_TO_BE_USED_AS_A_NAME_IN_LET_OR_CONST_DECLARATIONS, &[]);
            }
        } else {
            for &element in a.elements(name).as_slice() {
                let binding_element_name = a.as_binding_element(element).name;
                if !binding_element_name.is_nil() {
                    self.check_grammar_name_in_let_or_const_declarations(binding_element_name);
                }
            }
        }
        false
    }

    pub fn check_grammar_variable_declaration_list(&mut self, declaration_list: NodeId) -> bool {
        let a = self.ast;
        let declarations = a
            .as_variable_declaration_list(declaration_list)
            .declarations;
        if self.check_grammar_for_disallowed_trailing_comma(
            declarations,
            diagnostics::TRAILING_COMMA_NOT_ALLOWED,
        ) {
            return true;
        }
        if a.nodes(declarations).len() == 0 {
            return self.grammar_error_at_pos(
                declaration_list,
                a.list_pos(declarations),
                a.list_end(declarations) - a.list_pos(declarations),
                diagnostics::VARIABLE_DECLARATION_LIST_CANNOT_BE_EMPTY,
                &[],
            );
        }
        let flags = a.flags(declaration_list);
        let parent = a.parent(declaration_list);
        let block_scope_flags = flags & NodeFlags::BLOCK_SCOPED;
        if block_scope_flags == NodeFlags::USING || block_scope_flags == NodeFlags::AWAIT_USING {
            if is_for_in_statement(a, parent) {
                return self.grammar_error_on_node(
                    declaration_list,
                    if_else(
                        block_scope_flags == NodeFlags::USING,
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_CANNOT_BE_A_USING_DECLARATION,
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_CANNOT_BE_AN_AWAIT_USING_DECLARATION,
                    ),
                    &[],
                );
            }
            if flags.intersects(NodeFlags::AMBIENT) {
                return self.grammar_error_on_node(
                    declaration_list,
                    if_else(
                        block_scope_flags == NodeFlags::USING,
                        diagnostics::X_USING_DECLARATIONS_ARE_NOT_ALLOWED_IN_AMBIENT_CONTEXTS,
                        diagnostics::X_AWAIT_USING_DECLARATIONS_ARE_NOT_ALLOWED_IN_AMBIENT_CONTEXTS,
                    ),
                    &[],
                );
            }
            if is_variable_statement(a, parent)
                && (is_case_clause(a, a.parent(parent)) || is_default_clause(a, a.parent(parent)))
            {
                return self.grammar_error_on_node(
                    declaration_list,
                    if_else(
                        block_scope_flags == NodeFlags::USING,
                        diagnostics::X_USING_DECLARATIONS_ARE_NOT_ALLOWED_IN_CASE_OR_DEFAULT_CLAUSES_UNLESS_CONTAINED_WITHIN_A_BLOCK,
                        diagnostics::X_AWAIT_USING_DECLARATIONS_ARE_NOT_ALLOWED_IN_CASE_OR_DEFAULT_CLAUSES_UNLESS_CONTAINED_WITHIN_A_BLOCK,
                    ),
                    &[],
                );
            }
        }
        if block_scope_flags == NodeFlags::AWAIT_USING {
            return self.check_grammar_await_or_await_using(declaration_list);
        }
        false
    }

    pub fn check_grammar_await_or_await_using(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        // Grammar checking
        let mut has_error = false;
        let container = get_containing_function_or_class_static_block(a, node);
        if !container.is_nil() && is_class_static_block_declaration(a, container) {
            // NOTE: We report this regardless as to whether there are parse diagnostics.
            let message = if is_await_expression(a, node) {
                diagnostics::X_AWAIT_EXPRESSION_CANNOT_BE_USED_INSIDE_A_CLASS_STATIC_BLOCK
            } else {
                diagnostics::X_AWAIT_USING_STATEMENTS_CANNOT_BE_USED_INSIDE_A_CLASS_STATIC_BLOCK
            };
            self.error(node, message, &[]);
            has_error = true;
        } else if !a.flags(node).intersects(NodeFlags::AWAIT_CONTEXT) {
            if is_in_top_level_context(a, node) {
                let source_file = get_source_file_of_node(a, node);
                if !self.has_parse_diagnostics(source_file) {
                    let mut span = TextRange::default();
                    let mut span_calculated = false;
                    if !is_effective_external_module(a, source_file, self.compiler_options) {
                        span = get_range_of_token_at_position(a, source_file, a.pos(node));
                        span_calculated = true;
                        let message = if is_await_expression(a, node) {
                            diagnostics::X_AWAIT_EXPRESSIONS_ARE_ONLY_ALLOWED_AT_THE_TOP_LEVEL_OF_A_FILE_WHEN_THAT_FILE_IS_A_MODULE_BUT_THIS_FILE_HAS_NO_IMPORTS_OR_EXPORTS_CONSIDER_ADDING_AN_EMPTY_EXPORT_TO_MAKE_THIS_FILE_A_MODULE
                        } else {
                            diagnostics::X_AWAIT_USING_STATEMENTS_ARE_ONLY_ALLOWED_AT_THE_TOP_LEVEL_OF_A_FILE_WHEN_THAT_FILE_IS_A_MODULE_BUT_THIS_FILE_HAS_NO_IMPORTS_OR_EXPORTS_CONSIDER_ADDING_AN_EMPTY_EXPORT_TO_MAKE_THIS_FILE_A_MODULE
                        };
                        let diagnostic =
                            self.diagnostic_store
                                .new_diagnostic(source_file, span, message, &[]);
                        self.add_diagnostic(diagnostic);
                        has_error = true;
                    }
                    // The cases of upstream's switch on the module kind: the node module kinds fall through to the module kinds that have top-level await, and those fall through to the default.
                    let is_node_module_kind = matches!(
                        self.module_kind,
                        ModuleKind::NODE16
                            | ModuleKind::NODE18
                            | ModuleKind::NODE20
                            | ModuleKind::NODE_NEXT
                    );
                    'module_kind: {
                        if is_node_module_kind {
                            let source_file_meta_data =
                                self.program.get_source_file_meta_data(source_file);
                            if source_file_meta_data.implied_node_format == ModuleKind::COMMON_JS {
                                if !span_calculated {
                                    span =
                                        get_range_of_token_at_position(a, source_file, a.pos(node));
                                }
                                let diagnostic = self.diagnostic_store.new_diagnostic(source_file, span, diagnostics::THE_CURRENT_FILE_IS_A_COMMONJS_MODULE_AND_CANNOT_USE_AWAIT_AT_THE_TOP_LEVEL, &[]);
                                self.add_diagnostic(diagnostic);
                                has_error = true;
                                break 'module_kind;
                            }
                        }
                        if (is_node_module_kind
                            || matches!(
                                self.module_kind,
                                ModuleKind::ES2022
                                    | ModuleKind::ES_NEXT
                                    | ModuleKind::PRESERVE
                                    | ModuleKind::SYSTEM
                            ))
                            && self.language_version >= ScriptTarget::ES2017
                        {
                            break 'module_kind;
                        }
                        if !span_calculated {
                            span = get_range_of_token_at_position(a, source_file, a.pos(node));
                        }
                        let message = if is_await_expression(a, node) {
                            diagnostics::TOP_LEVEL_AWAIT_EXPRESSIONS_ARE_ONLY_ALLOWED_WHEN_THE_MODULE_OPTION_IS_SET_TO_ES2022_ESNEXT_SYSTEM_NODE16_NODE18_NODE20_NODENEXT_OR_PRESERVE_AND_THE_TARGET_OPTION_IS_SET_TO_ES2017_OR_HIGHER
                        } else {
                            diagnostics::TOP_LEVEL_AWAIT_USING_STATEMENTS_ARE_ONLY_ALLOWED_WHEN_THE_MODULE_OPTION_IS_SET_TO_ES2022_ESNEXT_SYSTEM_NODE16_NODE18_NODE20_NODENEXT_OR_PRESERVE_AND_THE_TARGET_OPTION_IS_SET_TO_ES2017_OR_HIGHER
                        };
                        let diagnostic =
                            self.diagnostic_store
                                .new_diagnostic(source_file, span, message, &[]);
                        self.add_diagnostic(diagnostic);
                        has_error = true;
                    }
                }
            } else {
                // use of 'await' in non-async function
                let source_file = get_source_file_of_node(a, node);
                if !self.has_parse_diagnostics(source_file) {
                    let span = get_range_of_token_at_position(a, source_file, a.pos(node));
                    let message = if is_await_expression(a, node) {
                        diagnostics::X_AWAIT_EXPRESSIONS_ARE_ONLY_ALLOWED_WITHIN_ASYNC_FUNCTIONS_AND_AT_THE_TOP_LEVELS_OF_MODULES
                    } else {
                        diagnostics::X_AWAIT_USING_STATEMENTS_ARE_ONLY_ALLOWED_WITHIN_ASYNC_FUNCTIONS_AND_AT_THE_TOP_LEVELS_OF_MODULES
                    };
                    let diagnostic =
                        self.diagnostic_store
                            .new_diagnostic(source_file, span, message, &[]);
                    if !container.is_nil()
                        && a.kind(container) != Kind::Constructor
                        && !has_async_modifier(a, container)
                    {
                        let related_info = self.new_diagnostic_for_node(
                            container,
                            diagnostics::DID_YOU_MEAN_TO_MARK_THIS_FUNCTION_AS_ASYNC,
                            &[],
                        );
                        self.diagnostic_store
                            .add_related_info(diagnostic, related_info);
                    }
                    self.add_diagnostic(diagnostic);
                    has_error = true;
                }
            }
        }
        if is_await_expression(a, node)
            && self.is_in_parameter_initializer_before_containing_function(node)
        {
            // NOTE: We report this regardless as to whether there are parse diagnostics.
            self.error(
                node,
                diagnostics::X_AWAIT_EXPRESSIONS_CANNOT_BE_USED_IN_A_PARAMETER_INITIALIZER,
                &[],
            );
            has_error = true;
        }
        has_error
    }

    pub fn check_grammar_yield_expression(&mut self, node: NodeId) -> bool {
        let mut has_error = false;
        if !self.ast.flags(node).intersects(NodeFlags::YIELD_CONTEXT) {
            self.grammar_error_on_first_token(
                node,
                diagnostics::A_YIELD_EXPRESSION_IS_ONLY_ALLOWED_IN_A_GENERATOR_BODY,
                &[],
            );
            has_error = true;
        }
        if self.is_in_parameter_initializer_before_containing_function(node) {
            self.error(
                node,
                diagnostics::X_YIELD_EXPRESSIONS_CANNOT_BE_USED_IN_A_PARAMETER_INITIALIZER,
                &[],
            );
            has_error = true;
        }
        has_error
    }

    pub fn check_grammar_for_disallowed_block_scoped_variable_statement(
        &mut self,
        node: NodeId,
    ) -> bool {
        let a = self.ast;
        if !self.container_allows_block_scoped_variable(a.parent(node)) {
            let block_scope_kind = self
                .get_combined_node_flags_cached(a.as_variable_statement(node).declaration_list)
                & NodeFlags::BLOCK_SCOPED;
            if block_scope_kind != NodeFlags::NONE {
                let keyword: &[u8] = if block_scope_kind == NodeFlags::LET {
                    b"let"
                } else if block_scope_kind == NodeFlags::CONST {
                    b"const"
                } else if block_scope_kind == NodeFlags::USING {
                    b"using"
                } else if block_scope_kind == NodeFlags::AWAIT_USING {
                    b"await using"
                } else {
                    return self.fail("Unknown BlockScope flag");
                };
                self.error(
                    node,
                    diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_DECLARED_INSIDE_A_BLOCK,
                    &[Arg::Str(keyword)],
                );
            }
        }
        false
    }

    pub fn container_allows_block_scoped_variable(&self, parent: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        match self.ast.kind(parent) {
            Kind::IfStatement
            | Kind::DoStatement
            | Kind::WhileStatement
            | Kind::WithStatement
            | Kind::ForStatement
            | Kind::ForInStatement
            | Kind::ForOfStatement => false,
            Kind::LabeledStatement => {
                self.container_allows_block_scoped_variable(self.ast.parent(parent))
            }
            _ => true,
        }
    }

    pub fn check_grammar_meta_property(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_meta_property(node);
        let node_name = data.name;
        let name_text = a.text(node_name);
        match data.keyword_token {
            Kind::NewKeyword => {
                if name_text != b"target" {
                    return self.grammar_error_on_node(
                        node_name,
                        diagnostics::X_0_IS_NOT_A_VALID_META_PROPERTY_FOR_KEYWORD_1_DID_YOU_MEAN_2,
                        &[
                            Arg::Str(name_text),
                            Arg::Str(token_to_string(data.keyword_token)),
                            Arg::Str(b"target"),
                        ],
                    );
                }
            }
            Kind::ImportKeyword => {
                if name_text != b"meta" {
                    let parent = a.parent(node);
                    let is_callee = is_call_expression(a, parent) && a.expression(parent) == node;
                    if name_text == b"defer" {
                        if !is_callee {
                            return self.grammar_error_at_pos(
                                node,
                                a.end(node),
                                0,
                                diagnostics::X_0_EXPECTED,
                                &[Arg::Str(b"(")],
                            );
                        }
                    } else {
                        if is_callee {
                            return self.grammar_error_on_node(node_name, diagnostics::X_0_IS_NOT_A_VALID_META_PROPERTY_FOR_KEYWORD_IMPORT_DID_YOU_MEAN_META_OR_DEFER, &[Arg::Str(name_text)]);
                        }
                        return self.grammar_error_on_node(
                            node_name,
                            diagnostics::X_0_IS_NOT_A_VALID_META_PROPERTY_FOR_KEYWORD_1_DID_YOU_MEAN_2,
                            &[
                                Arg::Str(name_text),
                                Arg::Str(token_to_string(data.keyword_token)),
                                Arg::Str(b"meta"),
                            ],
                        );
                    }
                }
            }
            _ => {}
        }
        false
    }

    pub fn check_grammar_constructor_type_parameters(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let range = a.as_constructor_declaration(node).type_parameters;
        if !range.is_nil() {
            let pos = if a.list_pos(range) == a.list_end(range) {
                a.list_pos(range)
            } else {
                skip_trivia(
                    a.as_source_file(get_source_file_of_node(a, node)).text(),
                    a.list_pos(range),
                )
            };
            return self.grammar_error_at_pos(
                node,
                pos,
                a.list_end(range) - pos,
                diagnostics::TYPE_PARAMETERS_CANNOT_APPEAR_ON_A_CONSTRUCTOR_DECLARATION,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_constructor_type_annotation(&mut self, node: NodeId) -> bool {
        let t = self.ast.as_constructor_declaration(node).type_node;
        if !t.is_nil() {
            return self.grammar_error_on_node(
                t,
                diagnostics::TYPE_ANNOTATION_CANNOT_APPEAR_ON_A_CONSTRUCTOR_DECLARATION,
                &[],
            );
        }
        false
    }

    pub fn check_grammar_property(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let parent = a.parent(node);
        let property_name = a.name(node);
        if is_computed_property_name(a, property_name)
            && is_binary_expression(a, a.expression(property_name))
            && a.kind(
                a.as_binary_expression(a.expression(property_name))
                    .operator_token,
            ) == Kind::InKeyword
        {
            return match a.members(parent).as_slice().first() {
                Some(&first) => self.grammar_error_on_node(
                    first,
                    diagnostics::A_MAPPED_TYPE_MAY_NOT_DECLARE_PROPERTIES_OR_METHODS,
                    &[],
                ),
                // Upstream indexes the members of the parent without a test of their number.
                None => self.fail("index out of range [0] with length 0"),
            };
        }
        if is_class_like(a, parent) {
            if is_string_literal(a, property_name) && a.text(property_name) == b"constructor" {
                return self.grammar_error_on_node(
                    property_name,
                    diagnostics::CLASSES_MAY_NOT_HAVE_A_FIELD_NAMED_CONSTRUCTOR,
                    &[],
                );
            }
            if self.check_grammar_for_invalid_dynamic_name(property_name, diagnostics::A_COMPUTED_PROPERTY_NAME_IN_A_CLASS_PROPERTY_DECLARATION_MUST_HAVE_A_SIMPLE_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE) {
                return true;
            }
            if is_auto_accessor_property_declaration(a, node)
                && self.check_grammar_for_invalid_question_mark(
                    a.postfix_token(node),
                    diagnostics::AN_ACCESSOR_PROPERTY_CANNOT_BE_DECLARED_OPTIONAL,
                )
            {
                return true;
            }
        } else if is_interface_declaration(a, parent) {
            if self.check_grammar_for_invalid_dynamic_name(property_name, diagnostics::A_COMPUTED_PROPERTY_NAME_IN_AN_INTERFACE_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE) {
                return true;
            }
            if !is_property_signature_declaration(a, node) {
                // Interfaces cannot contain property declarations
                return self.fail_detail("Unexpected node kind", a.kind(node) as u32);
            }
            let initializer = a.initializer(node);
            if !initializer.is_nil() {
                return self.grammar_error_on_node(
                    initializer,
                    diagnostics::AN_INTERFACE_PROPERTY_CANNOT_HAVE_AN_INITIALIZER,
                    &[],
                );
            }
        } else if is_type_literal_node(a, parent) {
            if self.check_grammar_for_invalid_dynamic_name(a.name(node), diagnostics::A_COMPUTED_PROPERTY_NAME_IN_A_TYPE_LITERAL_MUST_REFER_TO_AN_EXPRESSION_WHOSE_TYPE_IS_A_LITERAL_TYPE_OR_A_UNIQUE_SYMBOL_TYPE) {
                return true;
            }
            if !is_property_signature_declaration(a, node) {
                // Type literals cannot contain property declarations
                return self.fail_detail("Unexpected node kind", a.kind(node) as u32);
            }
            let initializer = a.initializer(node);
            if !initializer.is_nil() {
                return self.grammar_error_on_node(
                    initializer,
                    diagnostics::A_TYPE_LITERAL_PROPERTY_CANNOT_HAVE_AN_INITIALIZER,
                    &[],
                );
            }
        }
        if a.flags(node).intersects(NodeFlags::AMBIENT) {
            self.check_ambient_initializer(node);
        }
        if is_property_declaration(a, node) {
            let prop_decl = a.as_property_declaration(node);
            let postfix_token = prop_decl.postfix_token;
            if !postfix_token.is_nil() && a.kind(postfix_token) == Kind::ExclamationToken {
                if !prop_decl.initializer.is_nil() {
                    return self.grammar_error_on_node(postfix_token, diagnostics::DECLARATIONS_WITH_INITIALIZERS_CANNOT_ALSO_HAVE_DEFINITE_ASSIGNMENT_ASSERTIONS, &[]);
                } else if prop_decl.type_node.is_nil() {
                    return self.grammar_error_on_node(postfix_token, diagnostics::DECLARATIONS_WITH_DEFINITE_ASSIGNMENT_ASSERTIONS_MUST_ALSO_HAVE_TYPE_ANNOTATIONS, &[]);
                } else if !is_class_like(a, parent)
                    || a.flags(node).intersects(NodeFlags::AMBIENT)
                    || is_static(a, node)
                    || has_abstract_modifier(a, node)
                {
                    return self.grammar_error_on_node(
                        postfix_token,
                        diagnostics::A_DEFINITE_ASSIGNMENT_ASSERTION_IS_NOT_PERMITTED_IN_THIS_CONTEXT,
                        &[],
                    );
                }
            }
        }
        false
    }

    pub fn check_ambient_initializer(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let (initializer, type_node) = match a.kind(node) {
            Kind::VariableDeclaration => {
                let var_decl = a.as_variable_declaration(node);
                (var_decl.initializer, var_decl.type_node)
            }
            Kind::PropertyDeclaration => {
                let prop_decl = a.as_property_declaration(node);
                (prop_decl.initializer, prop_decl.type_node)
            }
            Kind::PropertySignature => {
                let prop_sig = a.as_property_signature_declaration(node);
                (prop_sig.initializer, prop_sig.type_node)
            }
            kind => return self.fail_detail("Unexpected node kind", kind as u32),
        };
        if !initializer.is_nil() {
            let is_invalid_initializer =
                !(is_initializer_string_or_number_literal_expression(a, initializer)
                    || self.is_initializer_simple_literal_enum_reference(initializer)
                    || a.kind(initializer) == Kind::TrueKeyword
                    || a.kind(initializer) == Kind::FalseKeyword
                    || is_initializer_big_int_literal_expression(a, initializer));
            let is_const_or_readonly = is_declaration_readonly(a, node)
                || is_variable_declaration(a, node) && self.is_var_const_like(node);
            if is_const_or_readonly && type_node.is_nil() {
                if is_invalid_initializer {
                    return self.grammar_error_on_node(initializer, diagnostics::A_CONST_INITIALIZER_IN_AN_AMBIENT_CONTEXT_MUST_BE_A_STRING_OR_NUMERIC_LITERAL_OR_LITERAL_ENUM_REFERENCE, &[]);
                }
            } else {
                return self.grammar_error_on_node(
                    initializer,
                    diagnostics::INITIALIZERS_ARE_NOT_ALLOWED_IN_AMBIENT_CONTEXTS,
                    &[],
                );
            }
        }
        false
    }
}

pub fn is_initializer_string_or_number_literal_expression(a: Ast<'_>, expr: NodeId) -> bool {
    is_string_or_numeric_literal_like(a, expr)
        || a.kind(expr) == Kind::PrefixUnaryExpression
            && a.as_prefix_unary_expression(expr).operator == Kind::MinusToken
            && a.kind(a.as_prefix_unary_expression(expr).operand) == Kind::NumericLiteral
}

pub fn is_initializer_big_int_literal_expression(a: Ast<'_>, expr: NodeId) -> bool {
    if a.kind(expr) == Kind::BigIntLiteral {
        return true;
    }
    if a.kind(expr) == Kind::PrefixUnaryExpression {
        let unary_expr = a.as_prefix_unary_expression(expr);
        return unary_expr.operator == Kind::MinusToken
            && a.kind(unary_expr.operand) == Kind::BigIntLiteral;
    }
    false
}

impl<'a> Checker<'a> {
    pub fn is_initializer_simple_literal_enum_reference(&mut self, expr: NodeId) -> bool {
        let a = self.ast;
        if is_property_access_expression(a, expr) {
            let t = self.check_expression_cached(expr);
            return self.types[t].flags.intersects(TypeFlags::ENUM_LIKE);
        }
        if is_element_access_expression(a, expr) {
            let element_access = a.as_element_access_expression(expr);
            if !(is_initializer_string_or_number_literal_expression(
                a,
                element_access.argument_expression,
            ) && is_entity_name_expression(a, element_access.expression))
            {
                return false;
            }
            let t = self.check_expression_cached(expr);
            return self.types[t].flags.intersects(TypeFlags::ENUM_LIKE);
        }
        false
    }

    pub fn check_grammar_top_level_element_for_required_declare_modifier(
        &mut self,
        node: NodeId,
    ) -> bool {
        let a = self.ast;
        // A declare modifier is required for any top level .d.ts declaration except export=, export default, export as namespace, interfaces and imports categories. DeclarationElement: ExportAssignment, export_opt InterfaceDeclaration, export_opt TypeAliasDeclaration, export_opt ImportDeclaration, export_opt ExternalImportDeclaration, export_opt AmbientDeclaration
        if matches!(
            a.kind(node),
            Kind::InterfaceDeclaration
                | Kind::TypeAliasDeclaration
                | Kind::ImportDeclaration
                | Kind::JSImportDeclaration
                | Kind::ImportEqualsDeclaration
                | Kind::ExportDeclaration
                | Kind::ExportAssignment
                | Kind::NamespaceExportDeclaration
        ) || has_syntactic_modifier(
            a,
            node,
            ModifierFlags::AMBIENT | ModifierFlags::EXPORT | ModifierFlags::DEFAULT,
        ) {
            return false;
        }
        self.grammar_error_on_first_token(node, diagnostics::TOP_LEVEL_DECLARATIONS_IN_D_TS_FILES_MUST_START_WITH_EITHER_A_DECLARE_OR_EXPORT_MODIFIER, &[])
    }

    pub fn check_grammar_top_level_elements_for_required_declare_modifier(
        &mut self,
        file: NodeId,
    ) -> bool {
        let a = self.ast;
        for &decl in a.nodes(a.as_source_file(file).statements).as_slice() {
            if is_declaration_node(a, decl) || a.kind(decl) == Kind::VariableStatement {
                if self.check_grammar_top_level_element_for_required_declare_modifier(decl) {
                    return true;
                }
            }
        }
        false
    }

    pub fn check_grammar_source_file(&mut self, node: NodeId) -> bool {
        self.ast.flags(node).intersects(NodeFlags::AMBIENT)
            && self.check_grammar_top_level_elements_for_required_declare_modifier(node)
    }

    pub fn check_grammar_statement_in_ambient_context(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::AMBIENT) {
            let parent = a.parent(node);
            // Find containing block which is either Block, ModuleBlock, SourceFile
            let links = self.node_links.get(node);
            if !self.node_links[links].has_reported_statement_in_ambient_context
                && (is_function_like(a, parent) || is_accessor(a, parent))
            {
                let reported = self.grammar_error_on_first_token(
                    node,
                    diagnostics::AN_IMPLEMENTATION_CANNOT_BE_DECLARED_IN_AMBIENT_CONTEXTS,
                    &[],
                );
                self.node_links[links].has_reported_statement_in_ambient_context = reported;
                return reported;
            }
            // We are either parented by another statement, or some sort of block. If we're in a block, we only want to really report an error once to prevent noisiness. So use a bit on the block to indicate if this has already been reported, and don't report if it has.
            let parent_kind = a.kind(parent);
            if parent_kind == Kind::Block
                || parent_kind == Kind::ModuleBlock
                || parent_kind == Kind::SourceFile
            {
                let links = self.node_links.get(parent);
                // Check if the containing block ever report this error
                if !self.node_links[links].has_reported_statement_in_ambient_context {
                    let reported = self.grammar_error_on_first_token(
                        node,
                        diagnostics::STATEMENTS_ARE_NOT_ALLOWED_IN_AMBIENT_CONTEXTS,
                        &[],
                    );
                    self.node_links[links].has_reported_statement_in_ambient_context = reported;
                    return reported;
                }
            }
            // Otherwise we must be parented by a statement. If so, there's no need to report the error as our parent will have already done it.
        }
        false
    }

    pub fn check_grammar_numeric_literal(&mut self, node: NodeId) {
        let a = self.ast;
        let literal = a.as_numeric_literal(node);
        let node_text = get_text_of_node(a, node);
        // Realism (size) checking. We should test against `getTextOfNode(node)` rather than `node.text`, because `node.text` for large numeric literals can contain "." e.g. `node.text` for numeric literal `1100000000000000000000` is `1.1e21`.
        let is_fractional = bun_core::strings::contains_char(&node_text, b'.');
        let is_scientific = literal.token_flags.intersects(TokenFlags::SCIENTIFIC);
        // Scientific notation (e.g. 2e54 and 1e00000000010) can't be converted to bigint. Fractional numbers (e.g. 9000000000000000.001) are inherently imprecise anyway
        if is_fractional || is_scientific {
            return;
        }
        // Here `node` is guaranteed to be a numeric literal representing an integer. We need to judge whether the integer `node` represents is <= 2 ** 53 - 1, which can be accomplished by comparing to `value` defined below because: 1) when `node` represents an integer <= 2 ** 53 - 1, `node.text` is its exact string representation and thus `value` precisely represents the integer. 2) otherwise, although `node.text` may be imprecise string representation, its mathematical value and consequently `value` cannot be less than 2 ** 53, thus the result of the predicate won't be affected.
        let value = from_string(literal.text);
        if value <= MAX_SAFE_INTEGER {
            return;
        }
        let diagnostic = self.create_diagnostic_for_node(node, diagnostics::NUMERIC_LITERALS_WITH_ABSOLUTE_VALUES_EQUAL_TO_2_53_OR_GREATER_ARE_TOO_LARGE_TO_BE_REPRESENTED_ACCURATELY_AS_INTEGERS, &[]);
        self.add_error_or_suggestion(false, diagnostic);
    }

    pub fn check_grammar_big_int_literal(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let parent = a.parent(node);
        let literal_type = is_literal_type_node(a, parent)
            || is_prefix_unary_expression(a, parent) && is_literal_type_node(a, a.parent(parent));
        if !literal_type {
            // Don't error on BigInt literals in ambient contexts
            if !a.flags(node).intersects(NodeFlags::AMBIENT)
                && self.language_version < ScriptTarget::ES2020
            {
                if self.grammar_error_on_node(
                    node,
                    diagnostics::BIGINT_LITERALS_ARE_NOT_AVAILABLE_WHEN_TARGETING_LOWER_THAN_ES2020,
                    &[],
                ) {
                    return true;
                }
            }
        }
        false
    }

    pub fn check_grammar_import_clause(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let data = a.as_import_clause(node);
        match data.phase_modifier {
            Kind::TypeKeyword => {
                if !a.flags(node).intersects(NodeFlags::JSDOC)
                    && !data.name.is_nil()
                    && !data.named_bindings.is_nil()
                {
                    return self.grammar_error_on_node(node, diagnostics::A_TYPE_ONLY_IMPORT_CAN_SPECIFY_A_DEFAULT_IMPORT_OR_NAMED_BINDINGS_BUT_NOT_BOTH, &[]);
                }
                if !data.named_bindings.is_nil()
                    && a.kind(data.named_bindings) == Kind::NamedImports
                {
                    return self
                        .check_grammar_type_only_named_imports_or_exports(data.named_bindings);
                }
            }
            Kind::DeferKeyword => {
                if !data.name.is_nil() {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::DEFAULT_IMPORTS_ARE_NOT_ALLOWED_IN_A_DEFERRED_IMPORT,
                        &[],
                    );
                }
                if !data.named_bindings.is_nil()
                    && a.kind(data.named_bindings) == Kind::NamedImports
                {
                    return self.grammar_error_on_node(
                        node,
                        diagnostics::NAMED_IMPORTS_ARE_NOT_ALLOWED_IN_A_DEFERRED_IMPORT,
                        &[],
                    );
                }
                if self.module_kind != ModuleKind::ES_NEXT
                    && self.module_kind != ModuleKind::PRESERVE
                {
                    return self.grammar_error_on_node(node, diagnostics::DEFERRED_IMPORTS_ARE_ONLY_SUPPORTED_WHEN_THE_MODULE_FLAG_IS_SET_TO_ESNEXT_OR_PRESERVE, &[]);
                }
            }
            _ => {}
        }
        false
    }

    pub fn check_grammar_type_only_named_imports_or_exports(
        &mut self,
        named_bindings: NodeId,
    ) -> bool {
        let a = self.ast;
        for &specifier in a.nodes(a.element_list(named_bindings)).as_slice() {
            let (specifier_is_type_only, message) = if a.kind(specifier) == Kind::ImportSpecifier {
                (
                    a.is_type_only(specifier),
                    diagnostics::THE_TYPE_MODIFIER_CANNOT_BE_USED_ON_A_NAMED_IMPORT_WHEN_IMPORT_TYPE_IS_USED_ON_ITS_IMPORT_STATEMENT,
                )
            } else {
                (
                    a.is_type_only(specifier),
                    diagnostics::THE_TYPE_MODIFIER_CANNOT_BE_USED_ON_A_NAMED_EXPORT_WHEN_EXPORT_TYPE_IS_USED_ON_ITS_EXPORT_STATEMENT,
                )
            };
            if specifier_is_type_only {
                return self.grammar_error_on_first_token(specifier, message, &[]);
            }
        }
        false
    }

    pub fn check_grammar_import_call_expression(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if self.compiler_options.verbatim_module_syntax == Tristate::TRUE
            && self.module_kind == ModuleKind::COMMON_JS
        {
            return self.grammar_error_on_node(
                node,
                get_verbatim_module_syntax_error_message(a, node),
                &[],
            );
        }
        if a.kind(a.expression(node)) == Kind::MetaProperty {
            if self.module_kind != ModuleKind::ES_NEXT && self.module_kind != ModuleKind::PRESERVE {
                return self.grammar_error_on_node(node, diagnostics::DEFERRED_IMPORTS_ARE_ONLY_SUPPORTED_WHEN_THE_MODULE_FLAG_IS_SET_TO_ESNEXT_OR_PRESERVE, &[]);
            }
        } else if self.module_kind == ModuleKind::ES2015 {
            return self.grammar_error_on_node(node, diagnostics::DYNAMIC_IMPORTS_ARE_ONLY_SUPPORTED_WHEN_THE_MODULE_FLAG_IS_SET_TO_ES2020_ES2022_ESNEXT_COMMONJS_AMD_SYSTEM_UMD_NODE16_NODE18_NODE20_OR_NODENEXT, &[]);
        }
        let node_as_call = a.as_call_expression(node);
        if !node_as_call.type_arguments.is_nil() {
            return self.grammar_error_on_node(node, diagnostics::THIS_USE_OF_IMPORT_IS_INVALID_IMPORT_CALLS_CAN_BE_WRITTEN_BUT_THEY_MUST_HAVE_PARENTHESES_AND_CANNOT_HAVE_TYPE_ARGUMENTS, &[]);
        }
        let node_arguments = node_as_call.arguments;
        let argument_nodes = a.nodes(node_arguments);
        if !(ModuleKind::NODE16 <= self.module_kind && self.module_kind <= ModuleKind::NODE_NEXT)
            && self.module_kind != ModuleKind::ES_NEXT
            && self.module_kind != ModuleKind::PRESERVE
        {
            // We are allowed trailing comma after proposal-import-assertions.
            self.check_grammar_for_disallowed_trailing_comma(
                node_arguments,
                diagnostics::TRAILING_COMMA_NOT_ALLOWED,
            );
            if argument_nodes.len() > 1 {
                let import_attributes_argument = argument_nodes.at(1);
                return self.grammar_error_on_node(import_attributes_argument, diagnostics::DYNAMIC_IMPORTS_ONLY_SUPPORT_A_SECOND_ARGUMENT_WHEN_THE_MODULE_OPTION_IS_SET_TO_ESNEXT_NODE16_NODE18_NODE20_NODENEXT_OR_PRESERVE, &[]);
            }
        }
        if argument_nodes.len() == 0 || argument_nodes.len() > 2 {
            return self.grammar_error_on_node(node, diagnostics::DYNAMIC_IMPORTS_CAN_ONLY_ACCEPT_A_MODULE_SPECIFIER_AND_AN_OPTIONAL_SET_OF_ATTRIBUTES_AS_ARGUMENTS, &[]);
        }
        // see: parseArgumentOrArrayLiteralElement...we use this function which parse arguments of callExpression to parse specifier for dynamic import. parseArgumentOrArrayLiteralElement allows spread element to be in an argument list which is not allowed as specifier in dynamic import.
        let spread_element = find(argument_nodes.as_slice(), |n| is_spread_element(a, n));
        if !spread_element.is_nil() {
            return self.grammar_error_on_node(
                spread_element,
                diagnostics::ARGUMENT_OF_DYNAMIC_IMPORT_CANNOT_BE_SPREAD_ELEMENT,
                &[],
            );
        }
        false
    }
}
