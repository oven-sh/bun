// checker.go:6826-7417 (layers D-IMPEXP, D-TYPENODE, D-UNUSED): alias symbols, type aliases, merged exports, type parameter lists and the unused identifier checks.
use crate::ast::{
    Arg, Ast, DiagnosticId, Kind, ModifierFlags, ModuleInstanceState, NodeFlags, NodeId,
    SymbolFlags, SymbolId, find_ancestor, get_declaration_of_kind,
    get_module_instance_state_exported, get_name_of_declaration, get_root_declaration,
    get_source_file_of_node, has_modifier, has_syntactic_modifier, is_ambient_module,
    is_binding_element, is_binding_pattern, is_entity_name_expression, is_export_assignment,
    is_export_specifier, is_for_in_or_of_statement, is_identifier, is_import_clause,
    is_import_equals_declaration, is_import_or_import_equals_declaration, is_import_specifier,
    is_in_js_file, is_internal_module_import_equals_declaration, is_js_type_alias_declaration,
    is_namespace_import, is_object_binding_pattern, is_parameter_declaration,
    is_parameter_property_declaration, is_part_of_parameter_declaration, is_private_identifier,
    is_set_accessor_declaration, is_this_parameter, is_type_declaration,
    is_type_only_import_or_export_declaration, is_type_parameter_declaration,
    is_type_reference_node, is_variable_declaration, is_variable_declaration_list, symbol_name,
    walk_up_binding_elements_and_patterns,
};
use crate::checker::{
    Checker, DeclarationSpaces, IntrinsicTypeKind, TypeFlags, all_declarations_in_same_source_file,
    get_selected_modifier_flags, get_verbatim_module_syntax_error_message, has_dot_dot_dot_token,
    intrinsic_type_kinds, is_optional_declaration, range_of_type_parameters,
    try_get_module_specifier_from_declaration,
};
use crate::collections::OrderedSet;
use crate::core::{List, ModuleKind, new_text_range};
use crate::diagnostics::{self, Category, MessageId};
use crate::scanner::declaration_name_to_string;

// checker.go 7167
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct UnusedKind(pub i32);

impl UnusedKind {
    pub const LOCAL: Self = Self(0);
    pub const PARAMETER: Self = Self(1);
}

impl<'a> Checker<'a> {
    pub fn check_alias_symbol(&mut self, node: NodeId) {
        let a = self.ast;
        let mut symbol = self.get_symbol_of_declaration(node);
        let target = self.resolve_alias(symbol);
        if target == self.unknown_symbol {
            return;
        }
        // For external modules, `symbol` represents the local symbol for an alias. This local symbol will merge any other local declarations (excluding other aliases) and symbol.flags will contains combined representation for all merged declaration. Based on symbol.flags we can compute a set of excluded meanings (meaning that resolved alias should not have, otherwise it will conflict with some local declaration). Note that in addition to normal flags we include matching SymbolFlags.Export* in order to prevent collisions with declarations that were exported from the current module (they still contribute to local names).
        let export_symbol = a.sym(symbol).export_symbol;
        symbol = self.get_merged_symbol(if export_symbol.is_nil() {
            symbol
        } else {
            export_symbol
        });
        let symbol_flags = a.sym(symbol).flags;
        let target_flags = self.get_symbol_flags(target);
        // A type-only import/export will already have a grammar error in a JS file, so no need to issue more errors within
        if is_in_js_file(a, node)
            && !target_flags.intersects(SymbolFlags::VALUE)
            && !is_type_only_import_or_export_declaration(a, node)
        {
            let mut error_node = a.property_name_or_name(node);
            if error_node.is_nil() {
                error_node = node;
            }
            self.assert(
                a.kind(node) != Kind::NamespaceExport,
                "node.Kind != ast.KindNamespaceExport",
            );
            if is_export_specifier(a, node) {
                let diag = self.error(
                    error_node,
                    diagnostics::TYPES_CANNOT_APPEAR_IN_EXPORT_DECLARATIONS_IN_JAVASCRIPT_FILES,
                    &[],
                );
                let source_symbol = a.symbol(get_source_file_of_node(a, node));
                if !source_symbol.is_nil() {
                    let already_exported_symbol = a.table_get(
                        a.sym(source_symbol).exports,
                        a.text(a.property_name_or_name(node)),
                    );
                    if already_exported_symbol == target {
                        let exporting_declaration = a
                            .sym(already_exported_symbol)
                            .declarations
                            .as_slice()
                            .iter()
                            .copied()
                            .find(|&declaration| is_js_type_alias_declaration(a, declaration))
                            .unwrap_or_default();
                        if !exporting_declaration.is_nil() {
                            let related = self.new_diagnostic_for_node(
                                exporting_declaration,
                                diagnostics::X_0_IS_AUTOMATICALLY_EXPORTED_HERE,
                                &[Arg::Str(a.sym(already_exported_symbol).name)],
                            );
                            self.diagnostic_store.add_related_info(diag, related);
                        }
                    }
                }
            } else {
                let mut identifier_text = a.sym(symbol).name;
                if is_identifier(a, error_node) {
                    identifier_text = a.text(error_node);
                }
                let mut specifier_text: &[u8] = b"...";
                let import_declaration = find_ancestor(a, node, |n| {
                    is_import_or_import_equals_declaration(a, n) || is_variable_declaration(a, n)
                });
                if !import_declaration.is_nil() {
                    let module_specifier =
                        try_get_module_specifier_from_declaration(a, import_declaration);
                    if !module_specifier.is_nil() {
                        specifier_text = a.text(module_specifier);
                    }
                }
                let mut import_text = [b"import(\"".as_slice(), specifier_text, b"\")"].concat();
                if is_import_specifier(a, node) {
                    import_text.push(b'.');
                    import_text.extend_from_slice(identifier_text);
                }
                self.error(error_node, diagnostics::X_0_IS_A_TYPE_AND_CANNOT_BE_IMPORTED_IN_JAVASCRIPT_FILES_USE_1_IN_A_JSDOC_TYPE_ANNOTATION, &[Arg::Str(identifier_text), Arg::Str(&import_text)]);
            }
            return;
        }
        let mut excluded_meanings = SymbolFlags::NONE;
        if symbol_flags.intersects(SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE) {
            excluded_meanings |= SymbolFlags::VALUE;
        }
        if symbol_flags.intersects(SymbolFlags::TYPE) {
            excluded_meanings |= SymbolFlags::TYPE;
        }
        if symbol_flags.intersects(SymbolFlags::NAMESPACE) {
            excluded_meanings |= SymbolFlags::NAMESPACE;
        }
        if target_flags.intersects(excluded_meanings) {
            let message = if is_export_specifier(a, node) {
                diagnostics::EXPORT_DECLARATION_CONFLICTS_WITH_EXPORTED_DECLARATION_OF_0
            } else {
                diagnostics::IMPORT_DECLARATION_CONFLICTS_WITH_LOCAL_DECLARATION_OF_0
            };
            let name = self.symbol_to_string(symbol);
            self.error(node, message, &[Arg::Str(&name)]);
        } else if !is_export_specifier(a, node) {
            // Look at 'compilerOptions.isolatedModules' and not 'getIsolatedModules(...)' (which considers 'verbatimModuleSyntax') here because 'verbatimModuleSyntax' will already have an error for importing a type without 'import type'.
            let appears_valuey_to_transpiler = self.compiler_options.isolated_modules.is_true()
                && find_ancestor(a, node, |n| is_type_only_import_or_export_declaration(a, n))
                    .is_nil();
            if appears_valuey_to_transpiler
                && symbol_flags.intersects(SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE)
            {
                let name = self.symbol_to_string(symbol);
                let flag_name = self.get_isolated_modules_like_flag_name();
                self.error(node, diagnostics::IMPORT_0_CONFLICTS_WITH_LOCAL_VALUE_SO_MUST_BE_DECLARED_WITH_A_TYPE_ONLY_IMPORT_WHEN_ISOLATEDMODULES_IS_ENABLED, &[Arg::Str(&name), Arg::Str(flag_name)]);
            }
        }
        if self.compiler_options.get_isolated_modules()
            && !is_type_only_import_or_export_declaration(a, node)
            && !a.flags(node).intersects(NodeFlags::AMBIENT)
        {
            let verbatim_module_syntax = self.compiler_options.verbatim_module_syntax.is_true();
            let type_only_alias = self.get_type_only_alias_declaration(symbol);
            let is_type = !target_flags.intersects(SymbolFlags::VALUE);
            if is_type || !type_only_alias.is_nil() {
                match a.kind(node) {
                    Kind::ImportClause | Kind::ImportSpecifier | Kind::ImportEqualsDeclaration => {
                        if verbatim_module_syntax {
                            self.assert(
                                !a.name(node).is_nil(),
                                "An ImportClause with a symbol should have a name",
                            );
                            let message = if verbatim_module_syntax
                                && is_internal_module_import_equals_declaration(a, node)
                            {
                                diagnostics::AN_IMPORT_ALIAS_CANNOT_RESOLVE_TO_A_TYPE_OR_TYPE_ONLY_DECLARATION_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED
                            } else if is_type {
                                diagnostics::X_0_IS_A_TYPE_AND_MUST_BE_IMPORTED_USING_A_TYPE_ONLY_IMPORT_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED
                            } else {
                                diagnostics::X_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION_AND_MUST_BE_IMPORTED_USING_A_TYPE_ONLY_IMPORT_WHEN_VERBATIMMODULESYNTAX_IS_ENABLED
                            };
                            let name = a.text(a.property_name_or_name(node));
                            let diagnostic = self.error(node, message, &[Arg::Str(name)]);
                            self.add_type_only_declaration_related_info(
                                diagnostic,
                                if is_type {
                                    NodeId::NIL
                                } else {
                                    type_only_alias
                                },
                                name,
                            );
                        }
                        if is_type
                            && a.kind(node) == Kind::ImportEqualsDeclaration
                            && has_modifier(a, node, ModifierFlags::EXPORT)
                        {
                            let flag_name = self.get_isolated_modules_like_flag_name();
                            self.error(node, diagnostics::CANNOT_USE_EXPORT_IMPORT_ON_A_TYPE_OR_TYPE_ONLY_NAMESPACE_WHEN_0_IS_ENABLED, &[Arg::Str(flag_name)]);
                        }
                    }
                    Kind::ExportSpecifier => {
                        // Don't allow re-exporting an export that will be elided when `--isolatedModules` is set. The exception is that `import type { A } from './a'; export { A }` is allowed because single-file analysis can determine that the export should be dropped.
                        if verbatim_module_syntax
                            || get_source_file_of_node(a, type_only_alias)
                                != get_source_file_of_node(a, node)
                        {
                            let name = a.text(a.property_name_or_name(node));
                            let flag_name = self.get_isolated_modules_like_flag_name();
                            let diagnostic = if is_type {
                                self.error(node, diagnostics::RE_EXPORTING_A_TYPE_WHEN_0_IS_ENABLED_REQUIRES_USING_EXPORT_TYPE, &[Arg::Str(flag_name)])
                            } else {
                                self.error(node, diagnostics::X_0_RESOLVES_TO_A_TYPE_ONLY_DECLARATION_AND_MUST_BE_RE_EXPORTED_USING_A_TYPE_ONLY_RE_EXPORT_WHEN_1_IS_ENABLED, &[Arg::Str(name), Arg::Str(flag_name)])
                            };
                            self.add_type_only_declaration_related_info(
                                diagnostic,
                                if is_type {
                                    NodeId::NIL
                                } else {
                                    type_only_alias
                                },
                                name,
                            );
                        }
                    }
                    _ => {}
                }
            }
            if verbatim_module_syntax
                && !is_import_equals_declaration(a, node)
                && !is_in_js_file(a, node)
                && self
                    .program
                    .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                    == ModuleKind::COMMON_JS
            {
                self.error(node, get_verbatim_module_syntax_error_message(a, node), &[]);
            } else if self.module_kind == ModuleKind::PRESERVE
                && !is_import_equals_declaration(a, node)
                && !is_variable_declaration(a, node)
                && !is_binding_element(a, node)
                && self
                    .program
                    .get_emit_module_format_of_file(get_source_file_of_node(a, node))
                    == ModuleKind::COMMON_JS
            {
                // In `--module preserve`, ESM input syntax emits ESM output syntax, but there will be times when we look at the `impliedNodeFormat` of this file and decide it's CommonJS (i.e., currently, only if the file extension is .cjs/.cts). To avoid that inconsistency, we disallow ESM syntax in files that are unambiguously CommonJS in this mode.
                self.error(node, diagnostics::ECMASCRIPT_MODULE_SYNTAX_IS_NOT_ALLOWED_IN_A_COMMONJS_MODULE_WHEN_MODULE_IS_SET_TO_PRESERVE, &[]);
            }
            if verbatim_module_syntax
                && !is_type_only_import_or_export_declaration(a, node)
                && !a.flags(node).intersects(NodeFlags::AMBIENT)
                && target_flags.intersects(SymbolFlags::CONST_ENUM)
            {
                let const_enum_declaration = a.sym(target).value_declaration;
                if const_enum_declaration.is_nil() {
                    // Upstream reads the file and the flags of the value declaration without a nil test.
                    let _: () =
                        self.fail("nil ValueDeclaration of a const enum in checkAliasSymbol");
                } else {
                    let redirect = self.program.get_project_reference_from_output_dts(
                        get_source_file_of_node(a, const_enum_declaration),
                    );
                    if a.flags(const_enum_declaration)
                        .intersects(NodeFlags::AMBIENT)
                        && !redirect.is_some_and(|options| options.should_preserve_const_enums())
                    {
                        let flag_name = self.get_isolated_modules_like_flag_name();
                        self.error(
                            node,
                            diagnostics::CANNOT_ACCESS_AMBIENT_CONST_ENUMS_WHEN_0_IS_ENABLED,
                            &[Arg::Str(flag_name)],
                        );
                    }
                }
            }
        }
        if is_import_specifier(a, node) {
            let target_symbol = self.resolve_alias_with_deprecation_check(symbol, node);
            if self.is_deprecated_symbol(target_symbol)
                && a.sym(target_symbol).declarations.len() != 0
            {
                self.add_deprecated_suggestion(
                    node,
                    a.sym(target_symbol).declarations,
                    a.sym(target_symbol).name,
                );
            }
        }
    }

    pub fn are_declaration_flags_identical(&self, left: NodeId, right: NodeId) -> bool {
        let a = self.ast;
        if is_parameter_declaration(a, left) && is_variable_declaration(a, right)
            || is_variable_declaration(a, left) && is_parameter_declaration(a, right)
        {
            // Differences in optionality between parameters and variables are allowed.
            return true;
        }
        if is_optional_declaration(a, left) != is_optional_declaration(a, right) {
            return false;
        }
        let interesting_flags = ModifierFlags::PRIVATE
            | ModifierFlags::PROTECTED
            | ModifierFlags::ASYNC
            | ModifierFlags::ABSTRACT
            | ModifierFlags::READONLY
            | ModifierFlags::STATIC;
        get_selected_modifier_flags(a, left, interesting_flags)
            == get_selected_modifier_flags(a, right, interesting_flags)
    }

    pub fn check_type_alias_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        self.check_grammar_modifiers(node);
        self.check_type_name_is_reserved(a.name(node), diagnostics::TYPE_ALIAS_NAME_CANNOT_BE_0);
        if !self.container_allows_block_scoped_variable(a.parent(node)) {
            self.grammar_error_on_node(
                node,
                diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_DECLARED_INSIDE_A_BLOCK,
                &[Arg::Str(b"type")],
            );
        }
        self.check_exports_on_merged_declarations(node);

        let type_node = a.type_node(node);
        let type_parameters = a.type_parameters(node);
        self.check_type_parameters(type_parameters);
        if !type_node.is_nil() && a.kind(type_node) == Kind::IntrinsicKeyword {
            if !(type_parameters.len() == 0 && a.text(a.name(node)) == b"BuiltinIteratorReturn"
                || type_parameters.len() == 1
                    && intrinsic_type_kinds(a.text(a.name(node))) != IntrinsicTypeKind::UNKNOWN)
            {
                self.error(type_node, diagnostics::THE_INTRINSIC_KEYWORD_CAN_ONLY_BE_USED_TO_DECLARE_COMPILER_PROVIDED_INTRINSIC_TYPES, &[]);
            }
            // The `intrinsic` keyword is a leaf type node with no child nodes to check, so skipping the checkSourceElement below visits nothing.
            return;
        }
        self.check_source_element(type_node);
        self.register_for_unused_identifiers_check(node);
    }

    pub fn check_type_name_is_reserved(&mut self, name: NodeId, message: MessageId) {
        // TS 1.0 spec (April 2014): 3.6.1 The predefined type keywords are reserved and cannot be used as names of user defined types.
        let text = self.ast.text(name);
        if matches!(
            text,
            b"any"
                | b"unknown"
                | b"never"
                | b"number"
                | b"bigint"
                | b"boolean"
                | b"string"
                | b"symbol"
                | b"void"
                | b"object"
                | b"undefined"
        ) {
            self.error(name, message, &[Arg::Str(text)]);
        }
    }

    pub fn check_exports_on_merged_declarations(&mut self, node: NodeId) {
        let a = self.ast;
        // If localSymbol is defined on node then node itself is exported - check is required.
        let mut symbol = a.local_symbol(node);
        if symbol.is_nil() {
            // Local symbol is undefined => this declaration is non-exported. However, symbol might contain other declarations that are exported.
            symbol = self.get_symbol_of_declaration(node);
            if a.sym(symbol).export_symbol.is_nil() {
                // This is a pure local symbol (all declarations are non-exported) - no need to check anything.
                return;
            }
        }
        // Run the check only for the first declaration in the list.
        if get_declaration_of_kind(a, symbol, a.kind(node)) != node {
            return;
        }
        let mut exported_declaration_spaces = DeclarationSpaces::NONE;
        let mut non_exported_declaration_spaces = DeclarationSpaces::NONE;
        let mut default_exported_declaration_spaces = DeclarationSpaces::NONE;
        let declarations = a.sym(symbol).declarations;
        for &d in declarations.as_slice() {
            let declaration_spaces = self.get_declaration_spaces(d);
            let effective_declaration_flags = self
                .get_effective_declaration_flags(d, ModifierFlags::EXPORT | ModifierFlags::DEFAULT);
            if effective_declaration_flags.intersects(ModifierFlags::EXPORT) {
                if effective_declaration_flags.intersects(ModifierFlags::DEFAULT) {
                    default_exported_declaration_spaces |= declaration_spaces;
                } else {
                    exported_declaration_spaces |= declaration_spaces;
                }
            } else {
                non_exported_declaration_spaces |= declaration_spaces;
            }
        }
        // Spaces for anything not declared a 'default export'.
        let non_default_exported_declaration_spaces =
            exported_declaration_spaces | non_exported_declaration_spaces;
        let common_declaration_spaces_for_exports_and_locals =
            exported_declaration_spaces & non_exported_declaration_spaces;
        let common_declaration_spaces_for_default_and_non_default =
            default_exported_declaration_spaces & non_default_exported_declaration_spaces;
        if common_declaration_spaces_for_exports_and_locals != DeclarationSpaces::NONE
            || common_declaration_spaces_for_default_and_non_default != DeclarationSpaces::NONE
        {
            // declaration spaces for exported and non-exported declarations intersect
            for &d in declarations.as_slice() {
                let declaration_spaces = self.get_declaration_spaces(d);
                let name = get_name_of_declaration(a, d);
                // Only error on the declarations that contributed to the intersecting spaces.
                if declaration_spaces
                    .intersects(common_declaration_spaces_for_default_and_non_default)
                {
                    let name_text = declaration_name_to_string(a, name);
                    self.error(name, diagnostics::MERGED_DECLARATION_0_CANNOT_INCLUDE_A_DEFAULT_EXPORT_DECLARATION_CONSIDER_ADDING_A_SEPARATE_EXPORT_DEFAULT_0_DECLARATION_INSTEAD, &[Arg::Str(&name_text)]);
                } else if declaration_spaces
                    .intersects(common_declaration_spaces_for_exports_and_locals)
                {
                    let name_text = declaration_name_to_string(a, name);
                    self.error(name, diagnostics::INDIVIDUAL_DECLARATIONS_IN_MERGED_DECLARATION_0_MUST_BE_ALL_EXPORTED_OR_ALL_LOCAL, &[Arg::Str(&name_text)]);
                }
            }
        }
    }

    pub fn get_declaration_spaces(&mut self, node: NodeId) -> DeclarationSpaces {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return DeclarationSpaces::NONE;
        }
        match a.kind(node) {
            Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::JSDocTypedefTag
            | Kind::JSDocCallbackTag => return DeclarationSpaces::EXPORT_TYPE,
            Kind::ModuleDeclaration => {
                if is_ambient_module(a, node)
                    || get_module_instance_state_exported(a, node)
                        != ModuleInstanceState::NON_INSTANTIATED
                {
                    return DeclarationSpaces::EXPORT_NAMESPACE | DeclarationSpaces::EXPORT_VALUE;
                }
                return DeclarationSpaces::EXPORT_NAMESPACE;
            }
            Kind::ClassDeclaration | Kind::EnumDeclaration | Kind::EnumMember => {
                return DeclarationSpaces::EXPORT_TYPE | DeclarationSpaces::EXPORT_VALUE;
            }
            Kind::SourceFile => {
                return DeclarationSpaces::EXPORT_TYPE
                    | DeclarationSpaces::EXPORT_VALUE
                    | DeclarationSpaces::EXPORT_NAMESPACE;
            }
            Kind::ExportAssignment
            | Kind::BinaryExpression
            | Kind::ImportEqualsDeclaration
            | Kind::NamespaceImport
            | Kind::ImportClause => {
                if matches!(
                    a.kind(node),
                    Kind::ExportAssignment | Kind::BinaryExpression
                ) {
                    let expression = if is_export_assignment(a, node) {
                        a.expression(node)
                    } else {
                        a.as_binary_expression(node).right
                    };
                    // Export assigned entity name expressions act as aliases and should fall through, otherwise they export values.
                    if !is_entity_name_expression(a, expression) {
                        return DeclarationSpaces::EXPORT_VALUE;
                    }
                    let assignment_symbol = self.get_symbol_of_declaration(node);
                    if !a
                        .sym(assignment_symbol)
                        .flags
                        .intersects(SymbolFlags::ALIAS)
                    {
                        return DeclarationSpaces::EXPORT_VALUE;
                    }
                }
                // The below options all declare an Alias, which is allowed to merge with other values within the importing module.
                let mut result = DeclarationSpaces::NONE;
                let symbol = self.get_symbol_of_declaration(node);
                let target = self.resolve_alias(symbol);
                for &d in a.sym(target).declarations.as_slice() {
                    result |= self.get_declaration_spaces(d);
                }
                return result;
            }
            Kind::VariableDeclaration
            | Kind::BindingElement
            | Kind::FunctionDeclaration
            | Kind::ImportSpecifier => return DeclarationSpaces::EXPORT_VALUE,
            Kind::MethodSignature | Kind::PropertySignature => {
                return DeclarationSpaces::EXPORT_TYPE;
            }
            _ => {}
        }
        let _: () = self.fail_detail(
            "Unhandled case in getDeclarationSpaces: ",
            a.kind(node) as u32,
        );
        DeclarationSpaces::NONE
    }

    pub fn check_type_parameters(&mut self, type_parameter_declarations: List<'a, NodeId>) {
        let a = self.ast;
        let mut seen_default = false;
        let declarations = type_parameter_declarations.as_slice();
        for (i, &node) in declarations.iter().enumerate() {
            self.check_type_parameter(node);
            let default_type_node = a.as_type_parameter_declaration(node).default_type;
            if !default_type_node.is_nil() {
                seen_default = true;
                self.check_type_parameters_not_referenced(default_type_node, declarations, i);
            } else if seen_default {
                self.error(
                    node,
                    diagnostics::REQUIRED_TYPE_PARAMETERS_MAY_NOT_FOLLOW_OPTIONAL_TYPE_PARAMETERS,
                    &[],
                );
            }
            for &previous in declarations.iter().take(i) {
                if a.symbol(previous) == a.symbol(node) {
                    let name = declaration_name_to_string(a, a.name(node));
                    self.error(
                        a.name(node),
                        diagnostics::DUPLICATE_IDENTIFIER_0,
                        &[Arg::Str(&name)],
                    );
                }
            }
        }
    }

    // Check that type parameter defaults only reference previously declared type parameters
    pub fn check_type_parameters_not_referenced(
        &mut self,
        root: NodeId,
        type_parameters: &[NodeId],
        index: usize,
    ) {
        // The recursive closure `visit` of upstream.
        fn visit(
            c: &mut Checker<'_>,
            node: NodeId,
            type_parameters: &[NodeId],
            index: usize,
        ) -> bool {
            let a = c.ast;
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            if is_type_reference_node(a, node) {
                let t = c.get_type_from_type_reference(node);
                if c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
                    for &type_parameter in type_parameters.iter().skip(index) {
                        let type_parameter_symbol = c.get_symbol_of_declaration(type_parameter);
                        if c.types[t].symbol == type_parameter_symbol {
                            c.error(node, diagnostics::TYPE_PARAMETER_DEFAULTS_CAN_ONLY_REFERENCE_PREVIOUSLY_DECLARED_TYPE_PARAMETERS, &[]);
                        }
                    }
                }
            }
            a.for_each_child(node, &mut |child| visit(c, child, type_parameters, index))
        }
        visit(self, root, type_parameters, index);
    }

    pub fn register_for_unused_identifiers_check(&mut self, node: NodeId) {
        let source_file = get_source_file_of_node(self.ast, node);
        let links = self.source_file_links.get(source_file);
        self.source_file_links[links]
            .identifier_check_nodes
            .push(node);
    }

    pub fn check_unused_identifiers(&mut self, potentially_unused_identifiers: &[NodeId]) {
        let a = self.ast;
        for &node in potentially_unused_identifiers {
            match a.kind(node) {
                Kind::ClassDeclaration | Kind::ClassExpression => {
                    self.check_unused_class_members(node);
                    self.check_unused_type_parameters(node);
                }
                Kind::SourceFile
                | Kind::ModuleDeclaration
                | Kind::Block
                | Kind::CaseBlock
                | Kind::ForStatement
                | Kind::ForInStatement
                | Kind::ForOfStatement => {
                    self.check_unused_locals_and_parameters(node);
                }
                Kind::Constructor
                | Kind::FunctionExpression
                | Kind::FunctionDeclaration
                | Kind::ArrowFunction
                | Kind::MethodDeclaration
                | Kind::GetAccessor
                | Kind::SetAccessor => {
                    // Only report unused parameters on the implementation, not overloads.
                    if !a.body(node).is_nil() {
                        self.check_unused_locals_and_parameters(node);
                    }
                    self.check_unused_type_parameters(node);
                }
                Kind::MethodSignature
                | Kind::CallSignature
                | Kind::ConstructSignature
                | Kind::FunctionType
                | Kind::ConstructorType
                | Kind::TypeAliasDeclaration
                | Kind::JSTypeAliasDeclaration
                | Kind::InterfaceDeclaration => {
                    self.check_unused_type_parameters(node);
                }
                Kind::InferType => {
                    self.check_unused_infer_type_parameter(node);
                }
                _ => self.fail("Unhandled case in checkUnusedIdentifiers"),
            }
        }
    }

    pub fn is_referenced(&mut self, symbol: SymbolId) -> bool {
        let links = self.symbol_reference_links.get(symbol);
        self.symbol_reference_links[links].reference_kinds != SymbolFlags::NONE
    }

    pub fn report_unused_variable(&mut self, mut location: NodeId, diagnostic: DiagnosticId) {
        let a = self.ast;
        while is_binding_element(a, location) || is_binding_pattern(a, location) {
            location = a.parent(location);
        }
        self.report_unused(
            location,
            if is_parameter_declaration(a, location) {
                UnusedKind::PARAMETER
            } else {
                UnusedKind::LOCAL
            },
            diagnostic,
        );
    }

    pub fn report_unused(&mut self, location: NodeId, kind: UnusedKind, diagnostic: DiagnosticId) {
        if !self
            .ast
            .flags(location)
            .intersects(NodeFlags::AMBIENT | NodeFlags::THIS_NODE_OR_ANY_SUB_NODES_HAS_ERROR)
        {
            let is_error = self.unused_is_error(kind);
            if is_error {
                self.add_diagnostic(diagnostic);
            } else {
                let suggestion = self.diagnostic_store.clone_diagnostic(diagnostic);
                self.diagnostic_store[suggestion].set_category(Category::Suggestion);
                self.add_suggestion_diagnostic(suggestion);
            }
        }
    }

    pub fn unused_is_error(&self, kind: UnusedKind) -> bool {
        match kind {
            UnusedKind::LOCAL => self.compiler_options.no_unused_locals.is_true(),
            UnusedKind::PARAMETER => self.compiler_options.no_unused_parameters.is_true(),
            _ => self.fail("Unhandled case in unusedIsError"),
        }
    }

    pub fn check_unused_class_members(&mut self, node: NodeId) {
        let a = self.ast;
        for &member in a.members(node).as_slice() {
            match a.kind(member) {
                Kind::MethodDeclaration
                | Kind::PropertyDeclaration
                | Kind::GetAccessor
                | Kind::SetAccessor => {
                    if is_set_accessor_declaration(a, member)
                        && a.sym(a.symbol(member))
                            .flags
                            .intersects(SymbolFlags::GET_ACCESSOR)
                    {
                        // Already would have reported an error on the getter.
                        continue;
                    }
                    let symbol = self.get_symbol_of_declaration(member);
                    if !self.is_referenced(symbol)
                        && (has_modifier(a, member, ModifierFlags::PRIVATE)
                            || !a.name(member).is_nil() && is_private_identifier(a, a.name(member)))
                        && !a.flags(member).intersects(NodeFlags::AMBIENT)
                    {
                        let name = self.symbol_to_string(symbol);
                        let diagnostic = self.new_diagnostic_for_node(
                            a.name(member),
                            diagnostics::X_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ,
                            &[Arg::Str(&name)],
                        );
                        self.report_unused(member, UnusedKind::LOCAL, diagnostic);
                    }
                }
                Kind::Constructor => {
                    for &parameter in a.parameters(member).as_slice() {
                        if !self.is_referenced(a.symbol(parameter))
                            && has_syntactic_modifier(a, parameter, ModifierFlags::PRIVATE)
                        {
                            let diagnostic = self.new_diagnostic_for_node(
                                a.name(parameter),
                                diagnostics::PROPERTY_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ,
                                &[Arg::Str(symbol_name(a, a.symbol(parameter)))],
                            );
                            self.report_unused(parameter, UnusedKind::LOCAL, diagnostic);
                        }
                    }
                }
                Kind::IndexSignature
                | Kind::SemicolonClassElement
                | Kind::ClassStaticBlockDeclaration
                | Kind::JSTypeAliasDeclaration => {
                    // Can't be private
                }
                _ => self.fail("Unhandled case in checkUnusedClassMembers"),
            }
        }
    }

    pub fn check_unused_locals_and_parameters(&mut self, node: NodeId) {
        let a = self.ast;
        // Upstream ranges over the locals, over a set of variable parents and over a map of import clauses: each is walked in insertion order here.
        let mut variable_parents: OrderedSet<NodeId> = OrderedSet::default();
        let mut import_clauses: Vec<(NodeId, Vec<NodeId>)> = Vec::new();
        let locals = a.locals(node);
        let mut position = 0;
        while let Some((_, local)) = a.table_entry_at(locals, position) {
            position += 1;
            let local_data = a.sym(local);
            let links = self.symbol_reference_links.get(local);
            let reference_kinds = self.symbol_reference_links[links].reference_kinds;
            if local_data.flags.intersects(SymbolFlags::TYPE_PARAMETER)
                && (!local_data.flags.intersects(SymbolFlags::VARIABLE)
                    || reference_kinds.intersects(SymbolFlags::VARIABLE))
                || !local_data.flags.intersects(SymbolFlags::TYPE_PARAMETER)
                    && (reference_kinds != SymbolFlags::NONE
                        || !local_data.export_symbol.is_nil()
                        || local_data.flags.intersects(SymbolFlags::MODULE_EXPORTS))
            {
                continue;
            }
            for &declaration in local_data.declarations.as_slice() {
                if is_variable_declaration(a, declaration)
                    || is_parameter_declaration(a, declaration)
                    || is_binding_element(a, declaration)
                {
                    variable_parents.add(a.parent(get_root_declaration(a, declaration)));
                } else if is_import_clause(a, declaration)
                    || is_import_specifier(a, declaration)
                    || is_namespace_import(a, declaration)
                {
                    if !is_identifier_that_starts_with_underscore(a, a.name(declaration)) {
                        let import_clause = import_clause_from_imported(a, declaration);
                        match import_clauses
                            .iter_mut()
                            .find(|entry| entry.0 == import_clause)
                        {
                            Some(entry) => entry.1.push(declaration),
                            None => import_clauses.push((import_clause, vec![declaration])),
                        }
                    }
                } else {
                    if !is_type_parameter_declaration(a, declaration)
                        && !is_ambient_module(a, declaration)
                    {
                        self.report_unused_local(declaration, symbol_name(a, local));
                    }
                }
            }
        }
        let mut position = 0;
        while let Some(declaration) = variable_parents.value_at(position) {
            position += 1;
            if is_variable_declaration_list(a, declaration) {
                self.report_unused_variables(declaration);
            } else {
                self.report_unused_parameters(declaration);
            }
        }
        for (declaration, unuseds) in &import_clauses {
            self.report_unused_imports(*declaration, unuseds);
        }
    }

    pub fn report_unused_local(&mut self, node: NodeId, name: &[u8]) {
        let a = self.ast;
        let message = if is_type_declaration(a, node) {
            diagnostics::X_0_IS_DECLARED_BUT_NEVER_USED
        } else {
            diagnostics::X_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ
        };
        let error_node = if a.name(node).is_nil() {
            node
        } else {
            a.name(node)
        };
        let diagnostic = self.new_diagnostic_for_node(error_node, message, &[Arg::Str(name)]);
        self.report_unused(node, UnusedKind::LOCAL, diagnostic);
    }

    pub fn report_unused_variables(&mut self, node: NodeId) {
        let a = self.ast;
        let declarations = a.nodes(a.as_variable_declaration_list(node).declarations);
        if declarations.len() > 1
            && declarations
                .as_slice()
                .iter()
                .all(|&declaration| self.is_unreferenced_variable_declaration(declaration))
        {
            let diagnostic =
                self.new_diagnostic_for_node(node, diagnostics::ALL_VARIABLES_ARE_UNUSED, &[]);
            self.report_unused_variable(node, diagnostic);
        } else {
            self.report_unused_variable_declarations(declarations.as_slice());
        }
    }

    pub fn report_unused_parameters(&mut self, node: NodeId) {
        self.report_unused_variable_declarations(self.ast.parameters(node).as_slice());
    }

    pub fn report_unused_binding_elements(&mut self, node: NodeId) {
        let a = self.ast;
        let declarations = a.elements(node);
        if declarations.len() > 1
            && declarations
                .as_slice()
                .iter()
                .all(|&declaration| self.is_unreferenced_variable_declaration(declaration))
        {
            let diagnostic = self.new_diagnostic_for_node(
                node,
                diagnostics::ALL_DESTRUCTURED_ELEMENTS_ARE_UNUSED,
                &[],
            );
            self.report_unused_variable(node, diagnostic);
        } else {
            self.report_unused_variable_declarations(declarations.as_slice());
        }
    }

    pub fn report_unused_variable_declarations(&mut self, declarations: &[NodeId]) {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        for &declaration in declarations {
            let name = a.name(declaration);
            if !name.is_nil()
                && !is_parameter_property_declaration(a, declaration, a.parent(declaration))
                && !is_this_parameter(a, declaration)
            {
                if is_binding_pattern(a, name) {
                    self.report_unused_binding_elements(name);
                } else if self.is_unreferenced_variable_declaration(declaration) {
                    let diagnostic = self.new_diagnostic_for_node(
                        name,
                        diagnostics::X_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ,
                        &[Arg::Str(a.text(name))],
                    );
                    self.report_unused_variable(declaration, diagnostic);
                }
            }
        }
    }

    pub fn is_unreferenced_variable_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let name = a.name(node);
        if name.is_nil() {
            return true;
        }
        if is_binding_pattern(a, name) {
            return a
                .elements(a.name(node))
                .as_slice()
                .iter()
                .all(|&element| self.is_unreferenced_variable_declaration(element));
        }
        let symbol = self.get_symbol_of_declaration(node);
        let links = self.symbol_reference_links.get(symbol);
        if self.symbol_reference_links[links]
            .reference_kinds
            .intersects(SymbolFlags::VARIABLE)
        {
            return false;
        }
        if is_binding_element(a, node) && is_object_binding_pattern(a, a.parent(node)) {
            // In `{ a, ...b }, `a` is considered used since it removes a property from `b`. `b` may still be unused though.
            let last_element = a
                .elements(a.parent(node))
                .as_slice()
                .last()
                .copied()
                .unwrap_or_default();
            if node != last_element && has_dot_dot_dot_token(a, last_element) {
                return false;
            }
        }
        if (is_parameter_declaration(a, node)
            || is_variable_declaration(a, node)
                && (is_for_in_or_of_statement(a, a.parent(a.parent(node)))
                    || self
                        .get_combined_node_flags_cached(node)
                        .intersects(NodeFlags::USING))
            || is_binding_element(a, node)
                && !(is_object_binding_pattern(a, a.parent(node))
                    && a.property_name(node).is_nil()))
            && is_identifier_that_starts_with_underscore(a, name)
        {
            return false;
        }
        true
    }

    pub fn report_unused_imports(&mut self, node: NodeId, unuseds: &[NodeId]) {
        let a = self.ast;
        let mut declaration_count = usize::from(!a.name(node).is_nil());
        let named_bindings = a.as_import_clause(node).named_bindings;
        if !named_bindings.is_nil() {
            if is_namespace_import(a, named_bindings) {
                declaration_count += 1;
            } else {
                declaration_count += a.elements(named_bindings).as_slice().len();
            }
        }
        if declaration_count > 1 && declaration_count == unuseds.len() {
            let diagnostic = self.new_diagnostic_for_node(
                a.parent(node),
                diagnostics::ALL_IMPORTS_IN_IMPORT_DECLARATION_ARE_UNUSED,
                &[],
            );
            self.report_unused(node, UnusedKind::LOCAL, diagnostic);
        } else {
            for &unused in unuseds {
                self.report_unused_local(unused, a.text(a.name(unused)));
            }
        }
    }
}

pub fn is_identifier_that_starts_with_underscore(a: Ast<'_>, node: NodeId) -> bool {
    is_identifier(a, node) && a.text(node).first() == Some(&b'_')
}

pub fn import_clause_from_imported(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportClause => node,
        Kind::NamespaceImport => a.parent(node),
        _ => a.parent(a.parent(node)),
    }
}

impl<'a> Checker<'a> {
    pub fn check_unused_infer_type_parameter(&mut self, node: NodeId) {
        let a = self.ast;
        let type_parameter = a.as_infer_type_node(node).type_parameter;
        if self.is_unreferenced_type_parameter(type_parameter) {
            let diagnostic = self.new_diagnostic_for_node(
                a.name(type_parameter),
                diagnostics::X_0_IS_DECLARED_BUT_NEVER_USED,
                &[Arg::Str(a.text(a.name(type_parameter)))],
            );
            self.report_unused(node, UnusedKind::PARAMETER, diagnostic);
        }
    }

    pub fn check_unused_type_parameters(&mut self, node: NodeId) {
        let a = self.ast;
        let symbol = self.get_symbol_of_declaration(node);
        if !all_declarations_in_same_source_file(a, symbol) {
            return;
        }
        let type_parameter_list = a.type_parameter_list(node);
        if type_parameter_list.is_nil() {
            return;
        }
        let type_parameters = a.nodes(type_parameter_list);
        if type_parameters.len() > 1
            && type_parameters
                .as_slice()
                .iter()
                .all(|&type_parameter| self.is_unreferenced_type_parameter(type_parameter))
        {
            let file = get_source_file_of_node(a, node);
            let loc = range_of_type_parameters(a, file, type_parameter_list);
            let diagnostic = self.diagnostic_store.new_diagnostic(
                file,
                loc,
                diagnostics::ALL_TYPE_PARAMETERS_ARE_UNUSED,
                &[],
            );
            self.report_unused(node, UnusedKind::PARAMETER, diagnostic);
        } else {
            for &type_parameter in type_parameters.as_slice() {
                if self.is_unreferenced_type_parameter(type_parameter) {
                    let diagnostic = self.new_diagnostic_for_node(
                        type_parameter,
                        diagnostics::X_0_IS_DECLARED_BUT_NEVER_USED,
                        &[Arg::Str(a.text(a.name(type_parameter)))],
                    );
                    self.report_unused(node, UnusedKind::PARAMETER, diagnostic);
                }
            }
        }
    }

    pub fn is_unreferenced_type_parameter(&mut self, type_parameter: NodeId) -> bool {
        let a = self.ast;
        let symbol = self.get_merged_symbol(a.symbol(type_parameter));
        let links = self.symbol_reference_links.get(symbol);
        !self.symbol_reference_links[links]
            .reference_kinds
            .intersects(SymbolFlags::TYPE_PARAMETER)
            && !is_identifier_that_starts_with_underscore(a, a.name(type_parameter))
    }

    pub fn check_unused_renamed_binding_elements(&mut self) {
        let a = self.ast;
        let renamed_binding_elements = self.renamed_binding_elements_in_types.clone();
        for &node in &renamed_binding_elements {
            let symbol = self.get_symbol_of_declaration(node);
            let links = self.symbol_reference_links.get(symbol);
            if self.symbol_reference_links[links].reference_kinds == SymbolFlags::NONE {
                let wrapping_declaration = walk_up_binding_elements_and_patterns(a, node);
                self.assert(
                    is_part_of_parameter_declaration(a, wrapping_declaration),
                    "Only parameter declaration should be checked here",
                );
                let name = declaration_name_to_string(a, a.name(node));
                let property_name = declaration_name_to_string(a, a.property_name(node));
                let diagnostic = self.new_diagnostic_for_node(
                    a.name(node),
                    diagnostics::X_0_IS_AN_UNUSED_RENAMING_OF_1_DID_YOU_INTEND_TO_USE_IT_AS_A_TYPE_ANNOTATION,
                    &[Arg::Str(&name), Arg::Str(&property_name)],
                );
                if a.type_node(wrapping_declaration).is_nil() {
                    // entire parameter does not have type annotation, suggest adding an annotation
                    let related = self.diagnostic_store.new_diagnostic(
                        get_source_file_of_node(a, wrapping_declaration),
                        new_text_range(a.end(wrapping_declaration), a.end(wrapping_declaration)),
                        diagnostics::WE_CAN_ONLY_WRITE_A_TYPE_FOR_0_BY_ADDING_A_TYPE_FOR_THE_ENTIRE_PARAMETER_HERE,
                        &[Arg::Str(&property_name)],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
                self.add_diagnostic(diagnostic);
            }
        }
    }
}
