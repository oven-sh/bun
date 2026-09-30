// checker.go:5148-5852 (layers D-ENUMNS, D-IMPEXP): enum and module declarations, imports, exports, export assignments and module export consistency.
use crate::ast::{
    Arg, Ast, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, INTERNAL_SYMBOL_NAME_EXPORT_STAR,
    INTERNAL_SYMBOL_NAME_IMPORT_ATTRIBUTES, JSDeclarationKind, Kind, ModifierFlags,
    ModuleInstanceState, NodeFlags, NodeId, SymbolFlags, SymbolId, get_assignment_declaration_kind,
    get_declaration_container, get_external_module_name, get_first_identifier,
    get_import_attributes, get_module_instance_state_exported, get_name_of_declaration,
    get_source_file_of_node, is_accessor, is_ambient_module, is_binding_pattern,
    is_class_declaration, is_entity_name_expression, is_enum_const, is_enum_declaration,
    is_exclusively_type_only_import_or_export, is_export_assignment, is_export_declaration,
    is_external_module_augmentation, is_external_module_reference, is_function_declaration,
    is_global_scope_augmentation, is_global_source_file, is_identifier,
    is_import_declaration_or_js_import_declaration, is_import_equals_declaration,
    is_import_specifier, is_in_js_file, is_interface_declaration,
    is_internal_module_import_equals_declaration, is_method_declaration, is_module_block,
    is_module_declaration, is_namespace_export, is_namespace_import, is_private_identifier,
    is_source_file, is_string_literal, is_string_literal_like, module_export_name_is_default,
    node_is_missing, node_is_present,
};
use crate::checker::{
    Checker, ExternalEmitHelpers, ObjectFlags, ReferenceHint, TypeFlags, TypeId,
    get_enclosing_container, get_module_specifier_from_node, has_export_assignment_symbol,
    is_top_level_in_external_module_augmentation,
};
use crate::core::{List, ModuleKind, RESOLUTION_MODE_NONE};
use crate::diagnostics::{self, MessageId};
use crate::scanner::declaration_name_to_string;
use crate::tspath::{
    EXTENSION_CJS, EXTENSION_CTS, file_extension_is_one_of, is_external_module_name_relative,
};

impl<'a> Checker<'a> {
    pub fn check_enum_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_modifiers(node);
        self.check_collisions_for_declaration_name(node, a.name(node));
        self.check_exports_on_merged_declarations(node);
        self.check_source_elements(a.members(node));

        if self.should_check_erasable_syntax(node) && !a.flags(node).intersects(NodeFlags::AMBIENT)
        {
            self.error(
                node,
                diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                &[],
            );
        }

        self.compute_enum_member_values(node);
        // Spec 2014 - Section 9.3: It isn't possible for one enum declaration to continue the automatic numbering sequence of another, and when an enum type has multiple declarations, only one declaration is permitted to omit a value for the first member. Only perform this check once per symbol
        let enum_symbol = self.get_symbol_of_declaration(node);
        let links = self.declared_type_links.get(enum_symbol);
        if !self.declared_type_links[links].enum_checked {
            self.declared_type_links[links].enum_checked = true;
            let declarations = a.sym(enum_symbol).declarations;
            if declarations.len() > 1 {
                let enum_is_const = is_enum_const(a, node);
                // check that const is placed\omitted on all enum declarations
                for &decl in declarations.as_slice() {
                    if is_enum_declaration(a, decl) && is_enum_const(a, decl) != enum_is_const {
                        self.error(
                            get_name_of_declaration(a, decl),
                            diagnostics::ENUM_DECLARATIONS_MUST_ALL_BE_CONST_OR_NON_CONST,
                            &[],
                        );
                    }
                }
            }
            let mut seen_enum_missing_initial_initializer = false;
            for &declaration in declarations.as_slice() {
                // return true if we hit a violation of the rule, false otherwise
                if a.kind(declaration) != Kind::EnumDeclaration {
                    continue;
                }
                let members = a.members(declaration);
                if members.len() == 0 {
                    continue;
                }
                let first_enum_member = members.as_slice().first().copied().unwrap_or_default();
                if a.initializer(first_enum_member).is_nil() {
                    if seen_enum_missing_initial_initializer {
                        self.error(a.name(first_enum_member), diagnostics::IN_AN_ENUM_WITH_MULTIPLE_DECLARATIONS_ONLY_ONE_DECLARATION_CAN_OMIT_AN_INITIALIZER_FOR_ITS_FIRST_ENUM_ELEMENT, &[]);
                    } else {
                        seen_enum_missing_initial_initializer = true;
                    }
                }
            }
        }
    }

    pub fn check_enum_member(&mut self, node: NodeId) {
        let a = self.ast;
        if is_private_identifier(a, a.name(node)) {
            self.error(
                node,
                diagnostics::AN_ENUM_MEMBER_CANNOT_BE_NAMED_WITH_A_PRIVATE_IDENTIFIER,
                &[],
            );
        }
        if !a.initializer(node).is_nil() {
            self.check_expression(a.initializer(node));
        }
    }

    pub fn check_module_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        let body = a.body(node);
        if !body.is_nil() {
            self.check_source_element(body);
            if !is_global_scope_augmentation(a, node) {
                self.register_for_unused_identifiers_check(node);
            }
        }
        let is_global_augmentation = is_global_scope_augmentation(a, node);
        let in_ambient_context = a.flags(node).intersects(NodeFlags::AMBIENT);
        if is_global_augmentation && !in_ambient_context {
            self.error(a.name(node), diagnostics::AUGMENTATIONS_FOR_THE_GLOBAL_SCOPE_SHOULD_HAVE_DECLARE_MODIFIER_UNLESS_THEY_APPEAR_IN_ALREADY_AMBIENT_CONTEXT, &[]);
        }
        let is_ambient_external_module = is_ambient_module(a, node);
        let context_error_message = if is_ambient_external_module {
            diagnostics::AN_AMBIENT_MODULE_DECLARATION_IS_ONLY_ALLOWED_AT_THE_TOP_LEVEL_IN_A_FILE
        } else {
            diagnostics::A_NAMESPACE_DECLARATION_IS_ONLY_ALLOWED_AT_THE_TOP_LEVEL_OF_A_NAMESPACE_OR_MODULE
        };
        if self.check_grammar_module_element_context(node, context_error_message) {
            // If we hit a module declaration in an illegal context, just bail out to avoid cascading errors.
            return;
        }
        if !self.check_grammar_modifiers(node) {
            if !in_ambient_context && is_string_literal(a, a.name(node)) {
                self.grammar_error_on_node(
                    a.name(node),
                    diagnostics::ONLY_AMBIENT_MODULES_CAN_USE_QUOTED_NAMES,
                    &[],
                );
            }
        }
        if is_identifier(a, a.name(node)) {
            self.check_collisions_for_declaration_name(node, a.name(node));
            if a.as_module_declaration(node).keyword == Kind::ModuleKeyword {
                self.error(a.name(node), diagnostics::A_NAMESPACE_DECLARATION_SHOULD_NOT_BE_DECLARED_USING_THE_MODULE_KEYWORD_PLEASE_USE_THE_NAMESPACE_KEYWORD_INSTEAD, &[]);
            }
        }
        self.check_exports_on_merged_declarations(node);
        let symbol = self.get_symbol_of_declaration(node);
        let symbol_data = a.sym(symbol);
        // The following checks only apply on a non-ambient instantiated module declaration.
        if symbol_data.flags.intersects(SymbolFlags::VALUE_MODULE)
            && !in_ambient_context
            && is_instantiated_module(a, node, self.compiler_options.should_preserve_const_enums())
        {
            if self.should_check_erasable_syntax(node) {
                self.error(
                    node,
                    diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                    &[],
                );
            }
            if self.compiler_options.get_isolated_modules()
                && a.as_source_file(get_source_file_of_node(a, node))
                    .external_module_indicator
                    .is_nil()
            {
                // This could be loosened a little if needed. The only problem we are trying to avoid is unqualified references to namespace members declared in other files. But use of namespaces is discouraged anyway, so for now we will just not allow them in scripts, which is the only place they can merge cross-file.
                let flag_name = self.get_isolated_modules_like_flag_name();
                self.error(a.name(node), diagnostics::NAMESPACES_ARE_NOT_ALLOWED_IN_GLOBAL_SCRIPT_FILES_WHEN_0_IS_ENABLED_IF_THIS_FILE_IS_NOT_INTENDED_TO_BE_A_GLOBAL_SCRIPT_SET_MODULEDETECTION_TO_FORCE_OR_ADD_AN_EMPTY_EXPORT_STATEMENT, &[Arg::Str(flag_name)]);
            }
            if symbol_data.declarations.len() > 1 {
                let first_non_ambient_class_or_func =
                    get_first_non_ambient_class_or_function_declaration(a, symbol);
                if !first_non_ambient_class_or_func.is_nil() {
                    if get_source_file_of_node(a, node)
                        != get_source_file_of_node(a, first_non_ambient_class_or_func)
                    {
                        self.error(a.name(node), diagnostics::A_NAMESPACE_DECLARATION_CANNOT_BE_IN_A_DIFFERENT_FILE_FROM_A_CLASS_OR_FUNCTION_WITH_WHICH_IT_IS_MERGED, &[]);
                    } else if a.pos(node) < a.pos(first_non_ambient_class_or_func) {
                        self.error(a.name(node), diagnostics::A_NAMESPACE_DECLARATION_CANNOT_BE_LOCATED_PRIOR_TO_A_CLASS_OR_FUNCTION_WITH_WHICH_IT_IS_MERGED, &[]);
                    }
                }
            }
            if self.compiler_options.verbatim_module_syntax.is_true()
                && is_source_file(a, a.parent(node))
                && a.modifier_flags(node).intersects(ModifierFlags::EXPORT)
                && self.program.get_emit_module_format_of_file(a.parent(node))
                    == ModuleKind::COMMON_JS
            {
                let export_modifier = a
                    .modifier_nodes(node)
                    .as_slice()
                    .iter()
                    .copied()
                    .find(|&modifier| a.kind(modifier) == Kind::ExportKeyword)
                    .unwrap_or_default();
                self.error(export_modifier, diagnostics::A_TOP_LEVEL_EXPORT_MODIFIER_CANNOT_BE_USED_ON_VALUE_DECLARATIONS_IN_A_COMMONJS_MODULE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED, &[]);
            }
        }
        if is_ambient_external_module {
            if is_external_module_augmentation(a, node) {
                // body of the augmentation should be checked for consistency only if augmentation was applied to its target (either global scope or module), otherwise we'll be swamped in cascading errors. We can detect if augmentation was applied using following rules: augmentation for a global scope is always applied, augmentation for some external module is applied if symbol for augmentation is merged (it was combined with target module).
                let mut check_body = is_global_augmentation;
                if !check_body {
                    let augmentation_symbol = self.get_symbol_of_declaration(node);
                    check_body = a
                        .sym(augmentation_symbol)
                        .flags
                        .intersects(SymbolFlags::TRANSIENT);
                }
                if check_body && !a.body(node).is_nil() {
                    for &statement in a.statements(a.body(node)).as_slice() {
                        self.check_module_augmentation_element(statement);
                    }
                }
            } else if is_global_source_file(a, a.parent(node)) {
                if is_global_augmentation {
                    self.error(a.name(node), diagnostics::AUGMENTATIONS_FOR_THE_GLOBAL_SCOPE_CAN_ONLY_BE_DIRECTLY_NESTED_IN_EXTERNAL_MODULES_OR_AMBIENT_MODULE_DECLARATIONS, &[]);
                } else if is_external_module_name_relative(a.text(a.name(node))) {
                    self.error(
                        a.name(node),
                        diagnostics::AMBIENT_MODULE_DECLARATION_CANNOT_SPECIFY_RELATIVE_MODULE_NAME,
                        &[],
                    );
                }
            } else {
                if is_global_augmentation {
                    self.error(a.name(node), diagnostics::AUGMENTATIONS_FOR_THE_GLOBAL_SCOPE_CAN_ONLY_BE_DIRECTLY_NESTED_IN_EXTERNAL_MODULES_OR_AMBIENT_MODULE_DECLARATIONS, &[]);
                } else {
                    // Node is not an augmentation and is not located on the script level. This means that this is declaration of ambient module that is located in other module or namespace which is prohibited.
                    self.error(
                        a.name(node),
                        diagnostics::AMBIENT_MODULES_CANNOT_BE_NESTED_IN_OTHER_MODULES_OR_NAMESPACES,
                        &[],
                    );
                }
            }
        }
    }
}

pub fn is_instantiated_module(a: Ast<'_>, node: NodeId, preserve_const_enums: bool) -> bool {
    let module_state = get_module_instance_state_exported(a, node);
    module_state == ModuleInstanceState::INSTANTIATED
        || preserve_const_enums && module_state == ModuleInstanceState::CONST_ENUM_ONLY
}

pub fn get_first_non_ambient_class_or_function_declaration(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    for &declaration in a.sym(symbol).declarations.as_slice() {
        if (is_class_declaration(a, declaration)
            || is_function_declaration(a, declaration) && node_is_present(a, a.body(declaration)))
            && !a.flags(declaration).intersects(NodeFlags::AMBIENT)
        {
            return declaration;
        }
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_isolated_modules_like_flag_name(&self) -> &'static [u8] {
        if self.compiler_options.verbatim_module_syntax.is_true() {
            b"verbatimModuleSyntax"
        } else {
            b"isolatedModules"
        }
    }

    pub fn check_module_augmentation_element(&mut self, node: NodeId) {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        match a.kind(node) {
            Kind::VariableStatement => {
                // error each individual name in variable statement instead of marking the entire variable statement
                let declaration_list = a.as_variable_statement(node).declaration_list;
                for &decl in a
                    .nodes(
                        a.as_variable_declaration_list(declaration_list)
                            .declarations,
                    )
                    .as_slice()
                {
                    self.check_module_augmentation_element(decl);
                }
            }
            Kind::ExportAssignment | Kind::ExportDeclaration => {
                self.grammar_error_on_first_token(node, diagnostics::EXPORTS_AND_EXPORT_ASSIGNMENTS_ARE_NOT_PERMITTED_IN_MODULE_AUGMENTATIONS, &[]);
            }
            Kind::ImportEqualsDeclaration | Kind::ImportDeclaration | Kind::JSImportDeclaration => {
                // import a = e.x; in module augmentation is ok, but not import a = require('fs)
                if a.kind(node) == Kind::ImportEqualsDeclaration
                    && is_internal_module_import_equals_declaration(a, node)
                {
                    return;
                }
                self.grammar_error_on_first_token(node, diagnostics::IMPORTS_ARE_NOT_PERMITTED_IN_MODULE_AUGMENTATIONS_CONSIDER_MOVING_THEM_TO_THE_ENCLOSING_EXTERNAL_MODULE, &[]);
            }
            Kind::BindingElement | Kind::VariableDeclaration => {
                let name = a.name(node);
                if is_binding_pattern(a, name) {
                    for &el in a.elements(name).as_slice() {
                        // mark individual names in binding pattern
                        self.check_module_augmentation_element(el);
                    }
                }
            }
            _ => {}
        }
    }

    pub fn check_import_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        let diagnostic = if is_in_js_file(a, node) {
            diagnostics::AN_IMPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_MODULE
        } else {
            diagnostics::AN_IMPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_NAMESPACE_OR_MODULE
        };
        if self.check_grammar_module_element_context(node, diagnostic) {
            // If we hit an import declaration in an illegal context, just bail out to avoid cascading errors.
            self.check_external_module_name_in_global_scope(node);
            return;
        }
        if !self.check_grammar_modifiers(node) && !a.modifiers(node).is_nil() {
            self.grammar_error_on_first_token(
                node,
                diagnostics::AN_IMPORT_DECLARATION_CANNOT_HAVE_MODIFIERS,
                &[],
            );
        }
        if self.check_external_import_or_export_declaration(node) {
            let mut resolved_module = SymbolId::NIL;
            let import_clause = a.import_clause(node);
            let module_specifier = a.module_specifier(node);
            if !import_clause.is_nil() && !self.check_grammar_import_clause(import_clause) {
                if !a.name(import_clause).is_nil() {
                    self.check_import_binding(import_clause);
                }
                let mut needs_import_star = false;
                let named_bindings = a.as_import_clause(import_clause).named_bindings;
                if !named_bindings.is_nil() {
                    if is_namespace_import(a, named_bindings) {
                        self.check_import_binding(named_bindings);
                        if self
                            .program
                            .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                            == ModuleKind::COMMON_JS
                        {
                            // import * as ns from "foo";
                            needs_import_star = true;
                            self.check_external_emit_helpers(
                                node,
                                ExternalEmitHelpers::IMPORT_STAR,
                            );
                        }
                    } else {
                        resolved_module = self.resolve_external_module_name(
                            node,
                            a.module_specifier(node),
                            false,
                        );
                        if !resolved_module.is_nil() {
                            for &binding in a.elements(named_bindings).as_slice() {
                                self.check_import_binding(binding);
                            }
                        }
                    }
                }
                if !a.name(import_clause).is_nil()
                    && !needs_import_star
                    && self
                        .program
                        .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                        == ModuleKind::COMMON_JS
                {
                    // import d from "foo";
                    self.check_external_emit_helpers(node, ExternalEmitHelpers::IMPORT_DEFAULT);
                }

                if !a.is_type_only(import_clause)
                    && ModuleKind::NODE18 <= self.module_kind
                    && self.module_kind <= ModuleKind::NODE_NEXT
                    && self.is_only_importable_as_default(module_specifier, resolved_module)
                    && !has_type_json_import_attribute(a, node)
                {
                    let module_kind_name = self.module_kind.string();
                    self.error(module_specifier, diagnostics::IMPORTING_A_JSON_FILE_INTO_AN_ECMASCRIPT_MODULE_REQUIRES_A_TYPE_COLON_JSON_IMPORT_ATTRIBUTE_WHEN_MODULE_IS_SET_TO_0, &[Arg::Str(&module_kind_name)]);
                }
            } else if self
                .compiler_options
                .no_unchecked_side_effect_imports
                .is_true_or_unknown()
                && import_clause.is_nil()
            {
                let ignore_errors = self.compiler_options.no_check.is_true();
                let mut error_message = MessageId::NIL;
                if !ignore_errors {
                    error_message = diagnostics::CANNOT_FIND_MODULE_OR_TYPE_DECLARATIONS_FOR_SIDE_EFFECT_IMPORT_OF_0;
                }
                self.resolve_external_module_name_worker(
                    node,
                    module_specifier,
                    error_message,
                    ignore_errors,
                    false,
                );
            }
        }
        self.check_import_attributes(node);
    }

    pub fn check_external_import_or_export_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let module_name = get_external_module_name(a, node);
        if module_name.is_nil() || node_is_missing(a, module_name) {
            // Should be a parse error.
            return false;
        }
        if !is_string_literal(a, module_name) {
            self.error(module_name, diagnostics::STRING_LITERAL_EXPECTED, &[]);
            return false;
        }
        let in_ambient_external_module =
            is_module_block(a, a.parent(node)) && is_ambient_module(a, a.parent(a.parent(node)));
        if !is_source_file(a, a.parent(node)) && !in_ambient_external_module {
            self.error(
                module_name,
                if is_export_declaration(a, node) {
                    diagnostics::EXPORT_DECLARATIONS_ARE_NOT_PERMITTED_IN_A_NAMESPACE
                } else {
                    diagnostics::IMPORT_DECLARATIONS_IN_A_NAMESPACE_CANNOT_REFERENCE_A_MODULE
                },
                &[],
            );
            return false;
        }
        if in_ambient_external_module && is_external_module_name_relative(a.text(module_name)) {
            // we have already reported errors on top level imports/exports in external module augmentations in checkModuleDeclaration: no need to do this again.
            if !is_top_level_in_external_module_augmentation(a, node) {
                // TypeScript 1.0 spec (April 2013): 12.1.6 An ExternalImportDeclaration in an AmbientExternalModuleDeclaration may reference other external modules only through top - level external module names. Relative external module names are not permitted.
                self.error(node, diagnostics::IMPORT_OR_EXPORT_DECLARATION_IN_AN_AMBIENT_MODULE_DECLARATION_CANNOT_REFERENCE_MODULE_THROUGH_RELATIVE_MODULE_NAME, &[]);
                return false;
            }
        }
        if !is_import_equals_declaration(a, node) {
            let attributes = get_import_attributes(a, node);
            if !attributes.is_nil() {
                let mut has_error = false;
                for &attr in a
                    .nodes(a.as_import_attributes(attributes).attributes)
                    .as_slice()
                {
                    if !is_string_literal(a, a.as_import_attribute(attr).value) {
                        has_error = true;
                        self.error(
                            a.as_import_attribute(attr).value,
                            diagnostics::IMPORT_ATTRIBUTE_VALUES_MUST_BE_STRING_LITERAL_EXPRESSIONS,
                            &[],
                        );
                    }
                }
                return !has_error;
            }
        }
        true
    }

    pub fn check_import_binding(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_collisions_for_declaration_name(node, a.name(node));
        self.check_alias_symbol(node);
        if is_import_specifier(a, node) {
            self.check_module_export_name(a.property_name(node), true);
            if module_export_name_is_default(a, a.property_name_or_name(node))
                && self
                    .program
                    .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                    == ModuleKind::COMMON_JS
            {
                self.check_external_emit_helpers(node, ExternalEmitHelpers::IMPORT_DEFAULT);
            }
        }
    }

    pub fn check_module_export_name(&mut self, name: NodeId, allow_string_literal: bool) {
        let a = self.ast;
        if name.is_nil() || a.kind(name) != Kind::StringLiteral {
            return;
        }
        if !allow_string_literal {
            self.grammar_error_on_node(name, diagnostics::IDENTIFIER_EXPECTED, &[]);
        } else if self.module_kind == ModuleKind::ES2015 || self.module_kind == ModuleKind::ES2020 {
            if !a
                .as_source_file(get_source_file_of_node(a, name))
                .is_declaration_file
            {
                self.grammar_error_on_node(name, diagnostics::STRING_LITERAL_IMPORT_AND_EXPORT_NAMES_ARE_NOT_SUPPORTED_WHEN_THE_MODULE_FLAG_IS_SET_TO_ES2015_OR_ES2020, &[]);
            }
        }
    }
}

pub fn has_type_json_import_attribute(a: Ast<'_>, node: NodeId) -> bool {
    let attributes = a.as_import_declaration(node).attributes;
    !attributes.is_nil()
        && a.nodes(a.as_import_attributes(attributes).attributes)
            .as_slice()
            .iter()
            .any(|&attr| {
                let value = a.as_import_attribute(attr).value;
                a.text(a.name(attr)) == b"type"
                    && is_string_literal_like(a, value)
                    && a.text(value) == b"json"
            })
}

impl<'a> Checker<'a> {
    pub fn check_import_attributes(&mut self, declaration: NodeId) {
        let a = self.ast;
        let node = get_import_attributes(a, declaration);
        if node.is_nil() {
            return;
        }
        let import_attributes_type = self.get_global_import_attributes_type_checked();
        if import_attributes_type != self.empty_object_type {
            let attributes_type = self.get_type_from_import_attributes(node);
            let target = self.get_nullable_type(import_attributes_type, TypeFlags::UNDEFINED);
            self.check_type_assignable_to(attributes_type, target, node, MessageId::NIL);
        }
        let is_type_only = is_exclusively_type_only_import_or_export(a, declaration);
        let override_mode = self.get_resolution_mode_override(node, is_type_only);
        if is_type_only && override_mode != RESOLUTION_MODE_NONE {
            // Other grammar checks do not apply to type-only imports with resolution mode attributes
            return;
        }

        if !self.module_kind.supports_import_attributes() {
            self.grammar_error_on_node(node, diagnostics::IMPORT_ATTRIBUTES_ARE_ONLY_SUPPORTED_WHEN_THE_MODULE_OPTION_IS_SET_TO_ESNEXT_NODE18_NODE20_NODENEXT_OR_PRESERVE, &[]);
            return;
        }

        let module_specifier = get_module_specifier_from_node(a, declaration);
        if !module_specifier.is_nil() {
            if self.get_emit_syntax_for_module_specifier_expression(module_specifier)
                == ModuleKind::COMMON_JS
            {
                self.grammar_error_on_node(node, diagnostics::IMPORT_ATTRIBUTES_ARE_NOT_ALLOWED_ON_STATEMENTS_THAT_COMPILE_TO_COMMONJS_REQUIRE_CALLS, &[]);
                return;
            }
        }

        if is_type_only {
            self.grammar_error_on_node(
                node,
                diagnostics::IMPORT_ATTRIBUTES_CANNOT_BE_USED_WITH_TYPE_ONLY_IMPORTS_OR_EXPORTS,
                &[],
            );
            return;
        }
        if override_mode != RESOLUTION_MODE_NONE {
            self.grammar_error_on_node(
                node,
                diagnostics::X_RESOLUTION_MODE_CAN_ONLY_BE_SET_FOR_TYPE_ONLY_IMPORTS,
                &[],
            );
        }
    }

    pub fn get_type_from_import_attributes(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let symbol = self.new_symbol(
                SymbolFlags::OBJECT_LITERAL,
                INTERNAL_SYMBOL_NAME_IMPORT_ATTRIBUTES,
            );
            let members = a.new_table();
            for &attr in a.nodes(a.as_import_attributes(node).attributes).as_slice() {
                let member = self.new_symbol(SymbolFlags::PROPERTY, a.text(a.name(attr)));
                // The links of the member are requested before its value is checked, as upstream's assignment evaluates its left side first: the request assigns the symbol id.
                let member_links = self.value_symbol_links_get(member);
                let value_type = self.check_expression(a.as_import_attribute(attr).value);
                let regular_type = self.get_regular_type_of_literal_type(value_type);
                self.value_symbol_links[member_links].resolved_type = regular_type;
                a.table_set(members, a.sym(member).name, member);
            }
            let t = self.new_anonymous_type(symbol, members, List::NIL, List::NIL, List::NIL);
            self.types[t].object_flags |=
                ObjectFlags::OBJECT_LITERAL | ObjectFlags::NON_INFERRABLE_TYPE;
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn check_import_equals_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        let diagnostic = if is_in_js_file(a, node) {
            diagnostics::AN_IMPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_MODULE
        } else {
            diagnostics::AN_IMPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_NAMESPACE_OR_MODULE
        };
        if self.check_grammar_module_element_context(node, diagnostic) {
            self.check_external_module_name_in_global_scope(node);
            // If we hit an import declaration in an illegal context, just bail out to avoid cascading errors.
            return;
        }

        self.check_grammar_modifiers(node);
        if self.should_check_erasable_syntax(node) && !a.flags(node).intersects(NodeFlags::AMBIENT)
        {
            self.error(
                node,
                diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                &[],
            );
        }
        if is_internal_module_import_equals_declaration(a, node)
            || self.check_external_import_or_export_declaration(node)
        {
            self.check_import_binding(node);
            self.mark_linked_references(
                node,
                ReferenceHint::EXPORT_IMPORT_EQUALS,
                SymbolId::NIL,
                TypeId::NIL,
            );
            let module_reference = a.as_import_equals_declaration(node).module_reference;
            if !is_external_module_reference(a, module_reference) {
                let symbol = self.get_symbol_of_declaration(node);
                let target = self.resolve_alias(symbol);
                if target != self.unknown_symbol {
                    let target_flags = self.get_symbol_flags(target);
                    if target_flags.intersects(SymbolFlags::VALUE) {
                        // Target is a value symbol, check that it is not hidden by a local declaration with the same name
                        let module_name = get_first_identifier(a, module_reference);
                        let module_symbol = self.resolve_entity_name(
                            module_name,
                            SymbolFlags::VALUE | SymbolFlags::NAMESPACE,
                            false,
                            false,
                            NodeId::NIL,
                        );
                        if module_symbol.is_nil() {
                            // Upstream reads the flags of the result without a nil test.
                            let _: () = self.fail(
                                "nil symbol from resolveEntityName in checkImportEqualsDeclaration",
                            );
                        } else if !a
                            .sym(module_symbol)
                            .flags
                            .intersects(SymbolFlags::NAMESPACE)
                        {
                            let name = declaration_name_to_string(a, module_name);
                            self.error(
                                module_name,
                                diagnostics::MODULE_0_IS_HIDDEN_BY_A_LOCAL_DECLARATION_WITH_THE_SAME_NAME,
                                &[Arg::Str(&name)],
                            );
                        }
                    }
                    if target_flags.intersects(SymbolFlags::TYPE) {
                        self.check_type_name_is_reserved(
                            a.name(node),
                            diagnostics::IMPORT_NAME_CANNOT_BE_0,
                        );
                    }
                }
                if a.is_type_only(node) {
                    self.grammar_error_on_node(
                        node,
                        diagnostics::AN_IMPORT_ALIAS_CANNOT_USE_IMPORT_TYPE,
                        &[],
                    );
                }
            } else {
                if ModuleKind::ES2015 <= self.module_kind
                    && self.module_kind <= ModuleKind::ES_NEXT
                    && !a.is_type_only(node)
                    && !a.flags(node).intersects(NodeFlags::AMBIENT)
                {
                    // Import equals declaration cannot be emitted as ESM
                    self.grammar_error_on_node(node, diagnostics::IMPORT_ASSIGNMENT_CANNOT_BE_USED_WHEN_TARGETING_ECMASCRIPT_MODULES_CONSIDER_USING_IMPORT_ASTERISK_AS_NS_FROM_MOD_IMPORT_A_FROM_MOD_IMPORT_D_FROM_MOD_OR_ANOTHER_MODULE_FORMAT_INSTEAD, &[]);
                }
            }
        }
    }

    pub fn check_export_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        let diagnostic = if is_in_js_file(a, node) {
            diagnostics::AN_EXPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_MODULE
        } else {
            diagnostics::AN_EXPORT_DECLARATION_CAN_ONLY_BE_USED_AT_THE_TOP_LEVEL_OF_A_NAMESPACE_OR_MODULE
        };
        if self.check_grammar_module_element_context(node, diagnostic) {
            self.check_external_module_name_in_global_scope(node);
            // If we hit an export in an illegal context, just bail out to avoid cascading errors.
            return;
        }
        let export_decl = a.as_export_declaration(node);
        if !self.check_grammar_modifiers(node) && !a.modifiers(node).is_nil() {
            self.grammar_error_on_first_token(
                node,
                diagnostics::AN_EXPORT_DECLARATION_CANNOT_HAVE_MODIFIERS,
                &[],
            );
        }
        self.check_grammar_export_declaration(node);
        if export_decl.module_specifier.is_nil()
            || self.check_external_import_or_export_declaration(node)
        {
            if !export_decl.export_clause.is_nil()
                && !is_namespace_export(a, export_decl.export_clause)
            {
                // export { x, y } and export { x, y } from "foo"
                for &binding in a.elements(export_decl.export_clause).as_slice() {
                    self.check_export_specifier(binding);
                }
                let in_ambient_external_module = is_module_block(a, a.parent(node))
                    && is_ambient_module(a, a.parent(a.parent(node)));
                let in_ambient_namespace_declaration = !in_ambient_external_module
                    && is_module_block(a, a.parent(node))
                    && export_decl.module_specifier.is_nil()
                    && a.flags(node).intersects(NodeFlags::AMBIENT);
                if !is_source_file(a, a.parent(node))
                    && !in_ambient_external_module
                    && !in_ambient_namespace_declaration
                {
                    self.error(
                        node,
                        diagnostics::EXPORT_DECLARATIONS_ARE_NOT_PERMITTED_IN_A_NAMESPACE,
                        &[],
                    );
                }
            } else {
                // export * from "foo" and export * as ns from "foo";
                let module_symbol =
                    self.resolve_external_module_name(node, export_decl.module_specifier, false);
                if !module_symbol.is_nil() && has_export_assignment_symbol(a, module_symbol) {
                    let module_name = self.symbol_to_string(module_symbol);
                    self.error(
                        export_decl.module_specifier,
                        diagnostics::MODULE_0_USES_EXPORT_AND_CANNOT_BE_USED_WITH_EXPORT_ASTERISK,
                        &[Arg::Str(&module_name)],
                    );
                } else if !export_decl.export_clause.is_nil() {
                    self.check_alias_symbol(export_decl.export_clause);
                    self.check_module_export_name(a.name(export_decl.export_clause), true);
                }
                if self
                    .program
                    .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                    == ModuleKind::COMMON_JS
                {
                    if !a.as_export_declaration(node).export_clause.is_nil() {
                        // export * as ns from "foo";
                        self.check_external_emit_helpers(node, ExternalEmitHelpers::IMPORT_STAR);
                    } else {
                        // export * from "foo"
                        self.check_external_emit_helpers(node, ExternalEmitHelpers::EXPORT_STAR);
                    }
                }
            }
        }
        self.check_import_attributes(node);
    }

    pub fn check_external_module_name_in_global_scope(&mut self, node: NodeId) {
        let a = self.ast;
        if a.kind(get_enclosing_container(a, node)) != Kind::SourceFile
            || (is_import_declaration_or_js_import_declaration(a, node)
                && a.import_clause(node).is_nil())
        {
            return;
        }
        let module_name = get_external_module_name(a, node);
        if !module_name.is_nil() {
            self.resolve_external_module_name(node, module_name, false);
        }
    }

    pub fn check_export_specifier(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_alias_symbol(node);
        let has_module_specifier = !a.module_specifier(a.parent(a.parent(node))).is_nil();
        self.check_module_export_name(a.property_name(node), has_module_specifier);
        self.check_module_export_name(a.name(node), true);

        if !has_module_specifier {
            let exported_name = a.property_name_or_name(node);
            if a.kind(exported_name) == Kind::StringLiteral {
                // Skip for invalid syntax like this: export { "x" }
                return;
            }
            // find immediate value referenced by exported name (SymbolFlags.Alias is set so we don't chase down aliases)
            let symbol = self.resolve_name(
                exported_name,
                a.text(exported_name),
                SymbolFlags::VALUE
                    | SymbolFlags::TYPE
                    | SymbolFlags::NAMESPACE
                    | SymbolFlags::ALIAS,
                MessageId::NIL,
                true,
                false,
            );
            if !symbol.is_nil()
                && (symbol == self.undefined_symbol
                    || symbol == self.global_this_symbol
                    || a.sym(symbol).declarations.len() != 0
                        && is_global_source_file(
                            a,
                            get_declaration_container(
                                a,
                                a.sym(symbol)
                                    .declarations
                                    .as_slice()
                                    .first()
                                    .copied()
                                    .unwrap_or_default(),
                            ),
                        ))
            {
                self.error(
                    exported_name,
                    diagnostics::CANNOT_EXPORT_0_ONLY_LOCAL_DECLARATIONS_CAN_BE_EXPORTED_FROM_A_MODULE,
                    &[Arg::Str(a.text(exported_name))],
                );
            } else {
                self.mark_linked_references(
                    node,
                    ReferenceHint::EXPORT_SPECIFIER,
                    SymbolId::NIL,
                    TypeId::NIL,
                );
            }
        } else if self
            .program
            .get_emit_module_format_of_file(get_source_file_of_node(a, node))
            == ModuleKind::COMMON_JS
            && module_export_name_is_default(a, a.property_name_or_name(node))
        {
            self.check_external_emit_helpers(node, ExternalEmitHelpers::IMPORT_DEFAULT);
        }
    }
}

pub fn is_contained_by_namespace(a: Ast<'_>, node: NodeId) -> bool {
    let mut container = a.parent(node);
    if !is_source_file(a, container) {
        container = a.parent(container);
    }
    is_module_declaration(a, container) && !is_ambient_module(a, container)
}

impl<'a> Checker<'a> {
    pub fn check_export_assignment(&mut self, node: NodeId) {
        let a = self.ast;
        let is_export_equals = a.as_export_assignment(node).is_export_equals;
        // Always check the exported expression so its identifiers are resolved even when the export assignment is misplaced (grammar error), keeping diagnostics stable regardless of traversal order.
        let expr_type = self.check_expression_cached(a.expression(node));
        let illegal_context_message = if is_export_equals {
            diagnostics::AN_EXPORT_ASSIGNMENT_MUST_BE_AT_THE_TOP_LEVEL_OF_A_FILE_OR_MODULE_DECLARATION
        } else {
            diagnostics::A_DEFAULT_EXPORT_MUST_BE_AT_THE_TOP_LEVEL_OF_A_FILE_OR_MODULE_DECLARATION
        };
        if self.check_grammar_module_element_context(node, illegal_context_message) {
            // If we hit an export assignment in an illegal context, just bail out to avoid cascading errors.
            return;
        }
        let in_ambient_context = a.flags(node).intersects(NodeFlags::AMBIENT);
        if self.should_check_erasable_syntax(node)
            && a.as_export_assignment(node).is_export_equals
            && !in_ambient_context
        {
            self.error(
                node,
                diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                &[],
            );
        }
        if is_contained_by_namespace(a, node) {
            if is_export_equals {
                self.error(
                    node,
                    diagnostics::AN_EXPORT_ASSIGNMENT_CANNOT_BE_USED_IN_A_NAMESPACE,
                    &[],
                );
            } else {
                self.error(
                    node,
                    diagnostics::A_DEFAULT_EXPORT_CAN_ONLY_BE_USED_IN_AN_ECMASCRIPT_STYLE_MODULE,
                    &[],
                );
            }
            return;
        }
        if !self.check_grammar_modifiers(node)
            && is_export_assignment(a, node)
            && !a.modifiers(node).is_nil()
        {
            self.grammar_error_on_first_token(
                node,
                diagnostics::AN_EXPORT_ASSIGNMENT_CANNOT_HAVE_MODIFIERS,
                &[],
            );
        }
        let verbatim_module_syntax = self.compiler_options.verbatim_module_syntax.is_true();
        let is_illegal_export_default_in_cjs = !is_export_equals
            && !in_ambient_context
            && verbatim_module_syntax
            && self
                .program
                .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                == ModuleKind::COMMON_JS;
        if is_identifier(a, a.expression(node)) {
            let id = a.expression(node);
            let resolved = self.resolve_entity_name(id, SymbolFlags::ALL, true, true, node);
            let sym = self.get_export_symbol_of_value_symbol_if_exported(resolved);
            if !sym.is_nil() {
                self.mark_linked_references(
                    node,
                    ReferenceHint::EXPORT_ASSIGNMENT,
                    SymbolId::NIL,
                    TypeId::NIL,
                );
                let type_only_declaration =
                    self.get_type_only_alias_declaration_ex(sym, SymbolFlags::VALUE);
                // If not a value, we're interpreting the identifier as a type export, along the lines of (`export { Id as default }`)
                if self.get_symbol_flags(sym).intersects(SymbolFlags::VALUE) {
                    // However if it is a value, we need to check it's being used correctly
                    if !is_illegal_export_default_in_cjs
                        && !in_ambient_context
                        && verbatim_module_syntax
                        && !type_only_declaration.is_nil()
                    {
                        let message = if is_export_equals {
                            diagnostics::AN_EXPORT_DECLARATION_MUST_REFERENCE_A_REAL_VALUE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED_BUT_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION
                        } else {
                            diagnostics::AN_EXPORT_DEFAULT_MUST_REFERENCE_A_REAL_VALUE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED_BUT_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION
                        };
                        self.error(id, message, &[Arg::Str(a.text(id))]);
                    }
                } else if !is_illegal_export_default_in_cjs
                    && !in_ambient_context
                    && verbatim_module_syntax
                {
                    let message = if is_export_equals {
                        diagnostics::AN_EXPORT_DECLARATION_MUST_REFERENCE_A_VALUE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED_BUT_0_ONLY_REFERS_TO_A_TYPE
                    } else {
                        diagnostics::AN_EXPORT_DEFAULT_MUST_REFERENCE_A_VALUE_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED_BUT_0_ONLY_REFERS_TO_A_TYPE
                    };
                    self.error(id, message, &[Arg::Str(a.text(id))]);
                }
                if !is_illegal_export_default_in_cjs
                    && !in_ambient_context
                    && self.compiler_options.get_isolated_modules()
                    && !a.sym(sym).flags.intersects(SymbolFlags::VALUE)
                {
                    let non_local_meanings = self.get_symbol_flags_ex(sym, false, true);
                    let flag_name = self.get_isolated_modules_like_flag_name();
                    if a.sym(sym).flags.intersects(SymbolFlags::ALIAS)
                        && non_local_meanings.intersects(SymbolFlags::TYPE)
                        && !non_local_meanings.intersects(SymbolFlags::VALUE)
                        && (type_only_declaration.is_nil()
                            || get_source_file_of_node(a, type_only_declaration)
                                != get_source_file_of_node(a, node))
                    {
                        // import { SomeType } from "./someModule"; then `export default SomeType;` or `export = SomeType;`
                        let message = if is_export_equals {
                            diagnostics::X_0_RESOLVES_TO_A_TYPE_AND_MUST_BE_MARKED_TYPE_ONLY_IN_THIS_FILE_BEFORE_RE_EXPORTING_WHEN_1_IS_ENABLED_CONSIDER_USING_IMPORT_TYPE_WHERE_0_IS_IMPORTED
                        } else {
                            diagnostics::X_0_RESOLVES_TO_A_TYPE_AND_MUST_BE_MARKED_TYPE_ONLY_IN_THIS_FILE_BEFORE_RE_EXPORTING_WHEN_1_IS_ENABLED_CONSIDER_USING_EXPORT_TYPE_0_AS_DEFAULT
                        };
                        self.error(id, message, &[Arg::Str(a.text(id)), Arg::Str(flag_name)]);
                    } else if !type_only_declaration.is_nil()
                        && get_source_file_of_node(a, type_only_declaration)
                            != get_source_file_of_node(a, node)
                    {
                        // import { SomeTypeOnlyValue } from "./someModule"; then `export default SomeTypeOnlyValue;` or `export = SomeTypeOnlyValue;`
                        let message = if is_export_equals {
                            diagnostics::X_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION_AND_MUST_BE_MARKED_TYPE_ONLY_IN_THIS_FILE_BEFORE_RE_EXPORTING_WHEN_1_IS_ENABLED_CONSIDER_USING_IMPORT_TYPE_WHERE_0_IS_IMPORTED
                        } else {
                            diagnostics::X_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION_AND_MUST_BE_MARKED_TYPE_ONLY_IN_THIS_FILE_BEFORE_RE_EXPORTING_WHEN_1_IS_ENABLED_CONSIDER_USING_EXPORT_TYPE_0_AS_DEFAULT
                        };
                        let diagnostic =
                            self.error(id, message, &[Arg::Str(a.text(id)), Arg::Str(flag_name)]);
                        self.add_type_only_declaration_related_info(
                            diagnostic,
                            type_only_declaration,
                            a.text(id),
                        );
                    }
                }
            }
        }
        if is_illegal_export_default_in_cjs {
            self.error(node, get_verbatim_module_syntax_error_message(a, node), &[]);
        }
        let mut container = a.parent(node);
        if !is_source_file(a, container) {
            container = a.parent(container);
        }
        self.check_external_module_exports(container);
        let type_node = a.type_node(node);
        if !type_node.is_nil() && a.kind(node) == Kind::ExportAssignment {
            let t = self.get_type_from_type_node(type_node);
            self.check_type_assignable_to_and_optionally_elaborate(
                expr_type,
                t,
                a.expression(node),
                a.expression(node),
                MessageId::NIL,
                None,
            );
        }
        if in_ambient_context && !is_entity_name_expression(a, a.expression(node)) {
            self.grammar_error_on_node(a.expression(node), diagnostics::THE_EXPRESSION_OF_AN_EXPORT_ASSIGNMENT_MUST_BE_AN_IDENTIFIER_OR_QUALIFIED_NAME_IN_AN_AMBIENT_CONTEXT, &[]);
        }
        if is_export_equals {
            // Forbid export= in esm implementation files, and esm mode declaration files
            if self.module_kind >= ModuleKind::ES2015
                && self.module_kind != ModuleKind::PRESERVE
                && ((in_ambient_context
                    && self
                        .program
                        .get_implied_node_format_for_emit(get_source_file_of_node(a, node))
                        == ModuleKind::ES_NEXT)
                    || (!in_ambient_context
                        && self
                            .program
                            .get_implied_node_format_for_emit(get_source_file_of_node(a, node))
                            != ModuleKind::COMMON_JS))
            {
                // export assignment is not supported in es6 modules
                self.grammar_error_on_node(node, diagnostics::EXPORT_ASSIGNMENT_CANNOT_BE_USED_WHEN_TARGETING_ECMASCRIPT_MODULES_CONSIDER_USING_EXPORT_DEFAULT_OR_ANOTHER_MODULE_FORMAT_INSTEAD, &[]);
            } else if self.module_kind == ModuleKind::SYSTEM && !in_ambient_context {
                // system modules does not support export assignment
                self.grammar_error_on_node(
                    node,
                    diagnostics::EXPORT_ASSIGNMENT_IS_NOT_SUPPORTED_WHEN_MODULE_FLAG_IS_SYSTEM,
                    &[],
                );
            }
        }
    }
}

pub fn get_verbatim_module_syntax_error_message(a: Ast<'_>, node: NodeId) -> MessageId {
    let source_file = get_source_file_of_node(a, node);
    let file_name = a.as_source_file(source_file).file_name();

    // Check if the file is .cts or .cjs (CommonJS-specific extensions)
    if file_extension_is_one_of(file_name, &[EXTENSION_CTS, EXTENSION_CJS]) {
        return diagnostics::ECMASCRIPT_IMPORTS_AND_EXPORTS_CANNOT_BE_WRITTEN_IN_A_COMMONJS_FILE_UNDER_VERBATIMMODULESYNTAX;
    }
    // For .ts, .tsx, .js, etc.
    diagnostics::ECMASCRIPT_IMPORTS_AND_EXPORTS_CANNOT_BE_WRITTEN_IN_A_COMMONJS_FILE_UNDER_VERBATIMMODULESYNTAX_ADJUST_THE_TYPE_FIELD_IN_THE_NEAREST_PACKAGE_JSON_TO_MAKE_THIS_FILE_AN_ECMASCRIPT_MODULE_OR_ADJUST_YOUR_VERBATIMMODULESYNTAX_MODULE_AND_MODULERESOLUTION_SETTINGS_IN_TYPESCRIPT
}

impl<'a> Checker<'a> {
    pub fn check_external_module_exports(&mut self, node: NodeId) {
        let a = self.ast;
        let module_symbol = self.get_symbol_of_declaration(node);
        let links = self.module_symbol_links.get(module_symbol);
        if !self.module_symbol_links[links].exports_checked {
            let export_equals_symbol = a.table_get(
                a.sym(module_symbol).exports,
                INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
            );
            // An export assignment is in error if (a) the module exports value members or (b) if the module exports type or namespace members and the exported entity also exports type or namespace members.
            if !export_equals_symbol.is_nil()
                && (self.has_exported_members_of_kind(module_symbol, SymbolFlags::VALUE)
                    || self.has_shadowed_namespace(export_equals_symbol))
            {
                let mut declaration = self.get_declaration_of_alias_symbol(export_equals_symbol);
                if declaration.is_nil() {
                    declaration = a.sym(export_equals_symbol).value_declaration;
                }
                if !declaration.is_nil()
                    && !is_top_level_in_external_module_augmentation(a, declaration)
                {
                    self.error(declaration, diagnostics::AN_EXPORT_ASSIGNMENT_CANNOT_BE_USED_IN_A_MODULE_WITH_OTHER_EXPORTED_ELEMENTS, &[]);
                }
            }
            // Checks for export * conflicts. Upstream ranges over the export table (a map): the table is walked in its own order.
            let exports = self.get_exports_of_module(module_symbol);
            let mut position = 0;
            while let Some((id, symbol)) = a.table_entry_at(exports, position) {
                position += 1;
                if id == INTERNAL_SYMBOL_NAME_EXPORT_STAR {
                    continue;
                }
                let symbol_data = a.sym(symbol);
                // ECMA262: 15.2.1.1 It is a Syntax Error if the ExportedNames of ModuleItemList contains any duplicate entries. (TS Exceptions: namespaces, function overloads, enums, and interfaces)
                if symbol_data
                    .flags
                    .intersects(SymbolFlags::NAMESPACE | SymbolFlags::ENUM)
                {
                    continue;
                }
                let exported_declarations_count = symbol_data
                    .declarations
                    .as_slice()
                    .iter()
                    .filter(|&&d| {
                        is_not_overload(a, d)
                            && !is_accessor(a, d)
                            && !is_interface_declaration(a, d)
                    })
                    .count();
                if symbol_data.flags.intersects(SymbolFlags::TYPE_ALIAS)
                    && exported_declarations_count <= 2
                {
                    // it is legal to merge type alias with other values so count should be either 1 (just type alias) or 2 (type alias + merged value)
                    continue;
                }
                if exported_declarations_count > 1
                    && !symbol_data.declarations.as_slice().iter().all(|&d| {
                        get_assignment_declaration_kind(a, d) == JSDeclarationKind::EXPORTS_PROPERTY
                    })
                {
                    for &declaration in symbol_data.declarations.as_slice() {
                        if is_not_overload(a, declaration) {
                            self.error(
                                declaration,
                                diagnostics::CANNOT_REDECLARE_EXPORTED_VARIABLE_0,
                                &[Arg::Str(id)],
                            );
                        }
                    }
                }
            }
            self.module_symbol_links[links].exports_checked = true;
        }
    }

    pub fn has_exported_members_of_kind(
        &mut self,
        module_symbol: SymbolId,
        kind: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        let exports = a.sym(module_symbol).exports;
        let mut position = 0;
        while let Some((_, symbol)) = a.table_entry_at(exports, position) {
            position += 1;
            if a.sym(symbol).name != INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                && self.get_symbol_flags(symbol).intersects(kind)
            {
                return true;
            }
        }
        false
    }

    pub fn has_shadowed_namespace(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        let flags = a.sym(symbol).flags;
        if flags.intersects(SymbolFlags::NAMESPACE_MODULE) && flags.intersects(SymbolFlags::ALIAS) {
            let target = self.resolve_alias(symbol);
            if a.sym(target).flags.intersects(SymbolFlags::NAMESPACE)
                && self.has_exported_members_of_kind(
                    target,
                    SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
                )
            {
                return true;
            }
        }
        false
    }
}

pub fn is_not_overload(a: Ast<'_>, node: NodeId) -> bool {
    !is_function_declaration(a, node) && !is_method_declaration(a, node) || !a.body(node).is_nil()
}

impl<'a> Checker<'a> {
    pub fn check_missing_declaration(&mut self, node: NodeId) {
        self.check_decorators(node);
    }
}
