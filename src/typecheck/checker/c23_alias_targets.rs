// checker.go:14533-15193 (layer A-ALIAS): the targets of alias declarations (import equals, import clauses, namespace imports and exports, import and export specifiers, export assignments, access expressions), the members and defaults of external modules with their errors, the module specifier of an import or export, and type-only marking.
use crate::ast::{
    Arg, Ast, INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
    INTERNAL_SYMBOL_NAME_EXPORT_STAR, INTERNAL_SYMBOL_NAME_MODULE_EXPORTS, Kind, NodeId,
    SymbolFlags, SymbolId, can_have_symbol,
    get_external_module_import_equals_declaration_expression, get_external_module_name,
    get_root_declaration, get_source_file_of_module, get_source_file_of_node, is_binary_expression,
    is_binding_element, is_class_expression, is_declaration_node, is_entity_name,
    is_entity_name_expression, is_export_declaration, is_external_module_reference, is_identifier,
    is_import_clause, is_import_or_export_specifier, is_import_specifier, is_in_js_file,
    is_json_source_file, is_property_access_expression,
    is_right_side_of_qualified_name_or_property_access, is_source_file, is_string_literal,
    is_string_literal_like, is_type_only_import_or_export_declaration, is_variable_declaration,
    module_export_name_is_default, node_kind_is,
};
use crate::checker::{
    Checker, TypeId, find_in_map, get_external_module_require_argument,
    has_export_assignment_symbol, is_contained_by_namespace, is_shorthand_ambient_module_symbol,
    is_syntactic_default,
};
use crate::core::{List, ModuleKind, RESOLUTION_MODE_NONE, ResolutionMode, find, if_else, some};
use crate::diagnostics;
use crate::scanner::declaration_name_to_string;
use crate::tspath::get_declaration_file_extension;

impl<'a> Checker<'a> {
    pub fn get_target_of_import_equals_declaration(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        // Node is ImportEqualsDeclaration | VariableDeclaration
        if is_variable_declaration(a, node)
            || a.kind(a.as_import_equals_declaration(node).module_reference)
                == Kind::ExternalModuleReference
        {
            let mut module_reference = get_external_module_require_argument(a, node);
            if module_reference.is_nil() {
                module_reference =
                    get_external_module_import_equals_declaration_expression(a, node);
            }
            let immediate = self.resolve_external_module_name(node, module_reference, false);
            let resolved = self.resolve_external_module_symbol(immediate, true);
            if !resolved.is_nil()
                && ModuleKind::NODE20 <= self.module_kind
                && self.module_kind <= ModuleKind::NODE_NEXT
            {
                let module_exports = self.get_export_of_module(
                    resolved,
                    INTERNAL_SYMBOL_NAME_MODULE_EXPORTS,
                    node,
                    true,
                );
                if !module_exports.is_nil() {
                    return module_exports;
                }
            }
            self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
            return resolved;
        }
        let resolved = self.get_symbol_of_part_of_right_hand_side_of_import_equals(
            a.as_import_equals_declaration(node).module_reference,
        );
        self.check_and_report_error_for_resolving_import_alias_to_type_only_symbol(node, resolved);
        resolved
    }

    pub fn resolve_external_module_type_by_literal(&mut self, name: NodeId) -> TypeId {
        let module_sym = self.resolve_external_module_name(name, name, false);
        if !module_sym.is_nil() {
            let resolved_module_symbol = self.resolve_external_module_symbol(module_sym, false);
            if !resolved_module_symbol.is_nil() {
                return self.get_type_of_symbol(resolved_module_symbol);
            }
        }
        self.any_type
    }

    // This function is only for imports with entity names
    pub fn get_symbol_of_part_of_right_hand_side_of_import_equals(
        &mut self,
        entity_name: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut entity_name = entity_name;
        // There are three things we might try to look for. In the following examples, the search term is enclosed in |...|: `import a = |b|;` is a namespace, `import a = |b.c|;` is a value, type or namespace, and `import a = |b.c|.d;` is a namespace
        if a.kind(entity_name) == Kind::Identifier
            && is_right_side_of_qualified_name_or_property_access(a, entity_name)
        {
            // QualifiedName
            entity_name = a.parent(entity_name);
        }
        // Check for case 1 and 3 in the above example
        if a.kind(entity_name) == Kind::Identifier
            || a.kind(a.parent(entity_name)) == Kind::QualifiedName
        {
            return self.resolve_entity_name(
                entity_name,
                SymbolFlags::NAMESPACE,
                false,
                true,
                NodeId::NIL,
            );
        }
        // Case 2 in above example. entityName.kind could be a QualifiedName or a Missing identifier
        self.assert(
            a.kind(a.parent(entity_name)) == Kind::ImportEqualsDeclaration,
            "entityName.Parent.Kind == ast.KindImportEqualsDeclaration",
        );
        self.resolve_entity_name(
            entity_name,
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            false,
            true,
            NodeId::NIL,
        )
    }

    // Upstream does not read `resolved` either.
    pub fn check_and_report_error_for_resolving_import_alias_to_type_only_symbol(
        &mut self,
        node: NodeId,
        _resolved: SymbolId,
    ) {
        let a = self.ast;
        let decl = a.as_import_equals_declaration(node);
        let mut name = decl.module_reference;
        loop {
            let type_only_declaration = self.get_type_only_declaration_of_entity_name(name);
            if !type_only_declaration.is_nil() {
                let is_export = node_kind_is(
                    a,
                    type_only_declaration,
                    &[Kind::ExportSpecifier, Kind::ExportDeclaration],
                );
                let message = if_else(
                    is_export,
                    diagnostics::AN_IMPORT_ALIAS_CANNOT_REFERENCE_A_DECLARATION_THAT_WAS_EXPORTED_USING_EXPORT_TYPE,
                    diagnostics::AN_IMPORT_ALIAS_CANNOT_REFERENCE_A_DECLARATION_THAT_WAS_IMPORTED_USING_IMPORT_TYPE,
                );
                let related_message = if_else(
                    is_export,
                    diagnostics::X_0_WAS_EXPORTED_HERE,
                    diagnostics::X_0_WAS_IMPORTED_HERE,
                );
                // Upstream leaves open how to get the name for `export *`.
                let mut name: &[u8] = b"*";
                if !is_export_declaration(a, type_only_declaration) {
                    name = a.text(a.name(type_only_declaration));
                }
                let diagnostic = self.error(decl.module_reference, message, &[]);
                let related = self.create_diagnostic_for_node(
                    type_only_declaration,
                    related_message,
                    &[Arg::Str(name)],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
                break;
            }
            if is_identifier(a, name) {
                break;
            }
            name = a.as_qualified_name(name).left;
            if name.is_nil() {
                // Upstream's cast fails on a module reference that is no entity name: the walk ends where it would have died.
                break;
            }
        }
    }

    pub fn get_type_only_declaration_of_entity_name(&mut self, name: NodeId) -> NodeId {
        let symbol = self.resolve_entity_name(
            name,
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            true,
            true,
            NodeId::NIL,
        );
        if !symbol.is_nil() {
            return self.get_type_only_alias_declaration(symbol);
        }
        NodeId::NIL
    }

    pub fn get_target_of_import_clause(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let module_symbol = self.resolve_external_module_name(
            node,
            get_module_specifier_from_node(a, a.parent(node)),
            false,
        );
        if !module_symbol.is_nil() {
            return self.get_target_of_module_default(module_symbol, node, true);
        }
        SymbolId::NIL
    }

    pub fn get_target_of_module_default(
        &mut self,
        module_symbol: SymbolId,
        node: NodeId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        let file = find(
            a.sym(module_symbol).declarations.as_slice(),
            |declaration| is_source_file(a, declaration),
        );
        let specifier = self.get_module_specifier_for_import_or_export(node);
        let mut export_module_dot_exports_symbol = SymbolId::NIL;
        if is_shorthand_ambient_module_symbol(a, module_symbol) {
            // !!! exportDefaultSymbol = moduleSymbol. Does nothing?
        } else if !file.is_nil()
            && !specifier.is_nil()
            && ModuleKind::NODE20 <= self.module_kind
            && self.module_kind <= ModuleKind::NODE_NEXT
            && self.get_emit_syntax_for_module_specifier_expression(specifier)
                == ModuleKind::COMMON_JS
            && self.program.get_implied_node_format_for_emit(file) == ModuleKind::ES_NEXT
        {
            export_module_dot_exports_symbol = self.resolve_export_by_name(
                module_symbol,
                INTERNAL_SYMBOL_NAME_MODULE_EXPORTS,
                node,
                dont_resolve_alias,
            );
        }
        let export_default_symbol = if !export_module_dot_exports_symbol.is_nil() {
            // We have a transpiled default import where the `require` resolves to an ES module with a `module.exports` named export. With `esModuleInterop` (always enabled), this will work: `const dep_1 = __importDefault(require("./dep.mjs"));` wraps like `{ default: require("./dep.mjs") }`, and `dep_1.default;` is `require("./dep.mjs")`, the `module.exports` export value
            self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
            return export_module_dot_exports_symbol;
        } else {
            self.resolve_export_by_name(
                module_symbol,
                INTERNAL_SYMBOL_NAME_DEFAULT,
                node,
                dont_resolve_alias,
            )
        };
        if specifier.is_nil() {
            return export_default_symbol;
        }
        let has_default_only = self.is_only_importable_as_default(specifier, module_symbol);
        let has_synthetic_default =
            self.can_have_synthetic_default(file, module_symbol, dont_resolve_alias, specifier);
        if export_default_symbol.is_nil() && !has_synthetic_default && !has_default_only {
            if is_import_clause(a, node) {
                self.report_non_default_export(module_symbol, node);
            } else {
                let name = if is_import_or_export_specifier(a, node) {
                    a.property_name_or_name(node)
                } else {
                    a.name(node)
                };
                self.error_no_module_member_symbol(module_symbol, module_symbol, node, name);
            }
        } else if has_synthetic_default || has_default_only {
            // per emit behavior, a synthetic default overrides a "real" .default member if `__esModule` is not present
            let mut resolved =
                self.resolve_external_module_symbol(module_symbol, dont_resolve_alias);
            if resolved.is_nil() {
                resolved = self.resolve_symbol_ex(module_symbol, dont_resolve_alias);
            }
            self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
            return resolved;
        }
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        export_default_symbol
    }

    pub fn report_non_default_export(&mut self, module_symbol: SymbolId, node: NodeId) {
        let a = self.ast;
        if !a.sym(module_symbol).exports.is_nil()
            && !a
                .table_get(a.sym(module_symbol).exports, a.sym(a.symbol(node)).name)
                .is_nil()
        {
            let module_name = self.symbol_to_string(module_symbol);
            let node_name = self.symbol_to_string(a.symbol(node));
            self.error(
                node,
                diagnostics::MODULE_0_HAS_NO_DEFAULT_EXPORT_DID_YOU_MEAN_TO_USE_IMPORT_1_FROM_0_INSTEAD,
                &[Arg::Str(&module_name), Arg::Str(&node_name)],
            );
        } else {
            let module_name = self.symbol_to_string(module_symbol);
            let diagnostic = self.error(
                a.name(node),
                diagnostics::MODULE_0_HAS_NO_DEFAULT_EXPORT,
                &[Arg::Str(&module_name)],
            );
            let mut export_star = SymbolId::NIL;
            if !a.sym(module_symbol).exports.is_nil() {
                export_star = a.table_get(
                    a.sym(module_symbol).exports,
                    INTERNAL_SYMBOL_NAME_EXPORT_STAR,
                );
            }
            if !export_star.is_nil() {
                let default_export = find(a.sym(export_star).declarations.as_slice(), |decl| {
                    if !(is_export_declaration(a, decl) && !a.module_specifier(decl).is_nil()) {
                        return false;
                    }
                    let resolved_external_module_name =
                        self.resolve_external_module_name(decl, a.module_specifier(decl), false);
                    !resolved_external_module_name.is_nil()
                        && !a
                            .table_get(
                                a.sym(resolved_external_module_name).exports,
                                INTERNAL_SYMBOL_NAME_DEFAULT,
                            )
                            .is_nil()
                });
                if !default_export.is_nil() {
                    let related = self.create_diagnostic_for_node(
                        default_export,
                        diagnostics::X_EXPORT_ASTERISK_DOES_NOT_RE_EXPORT_A_DEFAULT,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
            }
        }
    }

    pub fn resolve_export_by_name(
        &mut self,
        module_symbol: SymbolId,
        name: &[u8],
        source_node: NodeId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        let export_value = a.table_get(
            a.sym(module_symbol).exports,
            INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
        );
        let export_symbol = if !export_value.is_nil() {
            let export_type = self.get_type_of_symbol(export_value);
            self.get_property_of_type_ex(export_type, name, true, false)
        } else {
            a.table_get(a.sym(module_symbol).exports, name)
        };
        let resolved = self.resolve_symbol_ex(export_symbol, dont_resolve_alias);
        self.mark_symbol_of_alias_declaration_if_type_only(source_node, NodeId::NIL);
        resolved
    }

    pub fn get_target_of_namespace_import(&mut self, node: NodeId) -> SymbolId {
        let module_specifier = self.get_module_specifier_for_import_or_export(node);
        let immediate = self.resolve_external_module_name(node, module_specifier, false);
        let resolved = self.resolve_es_module_symbol(immediate, node, module_specifier);
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        resolved
    }

    pub fn get_target_of_namespace_export(&mut self, node: NodeId) -> SymbolId {
        let module_specifier = self.get_module_specifier_for_import_or_export(node);
        if !module_specifier.is_nil() {
            let immediate = self.resolve_external_module_name(node, module_specifier, false);
            let resolved = self.resolve_es_module_symbol(immediate, node, module_specifier);
            self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
            return resolved;
        }
        SymbolId::NIL
    }

    pub fn get_target_of_import_specifier(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let name = a.property_name_or_name(node);
        if is_import_specifier(a, node) && module_export_name_is_default(a, name) {
            let specifier = self.get_module_specifier_for_import_or_export(node);
            if !specifier.is_nil() {
                let module_symbol = self.resolve_external_module_name(node, specifier, false);
                if !module_symbol.is_nil() {
                    return self.get_target_of_module_default(module_symbol, node, true);
                }
            }
        }
        // ImportDeclaration
        let mut root = a.parent(a.parent(a.parent(node)));
        if is_binding_element(a, node) {
            root = get_root_declaration(a, node);
        }
        let resolved = self.get_external_module_member(root, node, true);
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        resolved
    }

    pub fn get_external_module_member(
        &mut self,
        node: NodeId,
        specifier: NodeId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        // node is ImportDeclaration | ExportDeclaration | VariableDeclaration; specifier is ImportSpecifier | ExportSpecifier | BindingElement | PropertyAccessExpression
        let mut module_specifier = get_external_module_require_argument(a, node);
        if module_specifier.is_nil() {
            module_specifier = get_external_module_name(a, node);
        }
        let module_symbol = self.resolve_external_module_name(node, module_specifier, false);
        let name = if !is_property_access_expression(a, specifier) {
            a.property_name_or_name(specifier)
        } else {
            a.name(specifier)
        };
        if !is_identifier(a, name) && !is_string_literal(a, name) {
            return SymbolId::NIL;
        }
        let name_text = a.text(name);
        let target_symbol =
            self.resolve_es_module_symbol(module_symbol, specifier, module_specifier);
        if !target_symbol.is_nil() {
            // Note: The empty string is a valid module export name: `import { "" as foo } from "./foo";` and `export { foo as "" };`
            if !name_text.is_empty() || a.kind(name) == Kind::StringLiteral {
                if is_shorthand_ambient_module_symbol(a, module_symbol) {
                    return module_symbol;
                }
                let mut symbol_from_variable;
                // First check if module was specified with "export=". If so, get the member from the resolved type
                if !module_symbol.is_nil()
                    && !a
                        .table_get(
                            a.sym(module_symbol).exports,
                            INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
                        )
                        .is_nil()
                {
                    let target_type = self.get_type_of_symbol(target_symbol);
                    symbol_from_variable =
                        self.get_property_of_type_ex(target_type, name_text, true, false);
                } else {
                    symbol_from_variable = self.get_property_of_variable(target_symbol, name_text);
                }
                // if symbolFromVariable is export - get its final target
                symbol_from_variable =
                    self.resolve_symbol_ex(symbol_from_variable, dont_resolve_alias);
                let mut export_container = target_symbol;
                if !module_symbol.is_nil()
                    && !a
                        .table_get(
                            a.sym(module_symbol).exports,
                            INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
                        )
                        .is_nil()
                {
                    // For `export =` modules, supplemental type/namespace exports live on the original module symbol.
                    export_container = module_symbol;
                }
                let mut symbol_from_module = self.get_export_of_module(
                    export_container,
                    name_text,
                    specifier,
                    dont_resolve_alias,
                );
                if symbol_from_module.is_nil() && name_text == INTERNAL_SYMBOL_NAME_DEFAULT {
                    let file = find(
                        a.sym(module_symbol).declarations.as_slice(),
                        |declaration| is_source_file(a, declaration),
                    );
                    if self.is_only_importable_as_default(module_specifier, module_symbol)
                        || self.can_have_synthetic_default(
                            file,
                            module_symbol,
                            dont_resolve_alias,
                            module_specifier,
                        )
                    {
                        symbol_from_module =
                            self.resolve_external_module_symbol(module_symbol, dont_resolve_alias);
                        if symbol_from_module.is_nil() {
                            symbol_from_module =
                                self.resolve_symbol_ex(module_symbol, dont_resolve_alias);
                        }
                    }
                }
                let mut symbol = symbol_from_variable;
                if !symbol_from_module.is_nil() {
                    symbol = symbol_from_module;
                    if !symbol_from_variable.is_nil() {
                        symbol = self.combine_value_and_type_symbols(
                            symbol_from_variable,
                            symbol_from_module,
                        );
                    }
                }
                if is_import_or_export_specifier(a, specifier)
                    && self.is_only_importable_as_default(module_specifier, module_symbol)
                    && name_text != INTERNAL_SYMBOL_NAME_DEFAULT
                {
                    let module_kind_name = self.module_kind.string();
                    self.error(
                        name,
                        diagnostics::NAMED_IMPORTS_FROM_A_JSON_FILE_INTO_AN_ECMASCRIPT_MODULE_ARE_NOT_ALLOWED_WHEN_MODULE_IS_SET_TO_0,
                        &[Arg::Str(&module_kind_name)],
                    );
                } else if symbol.is_nil() {
                    self.error_no_module_member_symbol(module_symbol, target_symbol, node, name);
                }
                return symbol;
            }
        }
        SymbolId::NIL
    }

    pub fn get_property_of_variable(&mut self, symbol: SymbolId, name: &[u8]) -> SymbolId {
        let a = self.ast;
        if a.sym(symbol).flags.intersects(SymbolFlags::VARIABLE) {
            let type_annotation = a.type_node(a.sym(symbol).value_declaration);
            if !type_annotation.is_nil() {
                let annotated_type = self.get_type_from_type_node(type_annotation);
                let property = self.get_property_of_type(annotated_type, name);
                return self.resolve_symbol(property);
            }
        }
        SymbolId::NIL
    }

    // This function creates a synthetic symbol that combines the value side of one symbol with the type/namespace side of another symbol. Consider this example: `declare module graphics { interface Point { x: number; y: number; } }`, `declare var graphics: { Point: new (x: number, y: number) => graphics.Point; }` and `declare module "graphics" { export = graphics; }`. An 'import { Point } from "graphics"' needs to create a symbol that combines the value side 'Point' property with the type/namespace side interface 'Point'.
    pub fn combine_value_and_type_symbols(
        &mut self,
        value_symbol: SymbolId,
        type_symbol: SymbolId,
    ) -> SymbolId {
        let a = self.ast;
        if value_symbol == self.unknown_symbol && type_symbol == self.unknown_symbol {
            return self.unknown_symbol;
        }
        let value_data = a.sym(value_symbol);
        let type_data = a.sym(type_symbol);
        if type_data.flags.intersects(SymbolFlags::VALUE) {
            return type_symbol;
        }
        if value_data
            .flags
            .intersects(SymbolFlags::TYPE | SymbolFlags::NAMESPACE)
        {
            return value_symbol;
        }
        let result = self.new_symbol(value_data.flags | type_data.flags, value_data.name);
        self.assert(
            value_data.declarations.len() > 0 || type_data.declarations.len() > 0,
            "len(valueSymbol.Declarations) > 0 || len(typeSymbol.Declarations) > 0",
        );
        // `slices.Compact(slices.Concat(...))`: the declarations of both symbols without repeats that follow each other, and the nil list when neither symbol has one.
        let mut declarations: Vec<NodeId> = value_data.declarations.as_slice().to_vec();
        declarations.extend_from_slice(type_data.declarations.as_slice());
        declarations.dedup();
        let declarations = if declarations.is_empty() {
            List::NIL
        } else {
            self.list_of(&declarations)
        };
        let mut parent = value_data.parent;
        if parent.is_nil() {
            parent = type_data.parent;
        }
        let members = a.table_clone(type_data.members);
        let exports = a.table_clone(value_data.exports);
        a.update_symbol(result, |s| {
            s.declarations = declarations;
            s.parent = parent;
            s.value_declaration = value_data.value_declaration;
            s.members = members;
            s.exports = exports;
        });
        result
    }

    pub fn get_export_of_module(
        &mut self,
        symbol: SymbolId,
        name_text: &[u8],
        specifier: NodeId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        if a.sym(symbol).flags.intersects(SymbolFlags::MODULE) {
            let exports = self.get_exports_of_symbol(symbol);
            let export_symbol = a.table_get(exports, name_text);
            let resolved = self.resolve_symbol_ex(export_symbol, dont_resolve_alias);
            let links = self.module_symbol_links.get(symbol);
            let export_star_declaration = self.module_symbol_links[links]
                .type_only_export_star_map
                .get(&name_text);
            self.mark_symbol_of_alias_declaration_if_type_only(specifier, export_star_declaration);
            return resolved;
        }
        SymbolId::NIL
    }

    pub fn is_only_importable_as_default(
        &mut self,
        usage: NodeId,
        resolved_module: SymbolId,
    ) -> bool {
        let a = self.ast;
        let mut resolved_module = resolved_module;
        // In Node.js, JSON modules don't get named exports
        if ModuleKind::NODE16 <= self.module_kind && self.module_kind <= ModuleKind::NODE_NEXT {
            let usage_mode = self.get_emit_syntax_for_module_specifier_expression(usage);
            if usage_mode == ModuleKind::ES_NEXT {
                if resolved_module.is_nil() {
                    resolved_module = self.resolve_external_module_name(usage, usage, true);
                }
                let mut target_file = NodeId::NIL;
                if !resolved_module.is_nil() {
                    target_file = get_source_file_of_module(a, resolved_module);
                }
                return !target_file.is_nil()
                    && (is_json_source_file(a, target_file)
                        || get_declaration_file_extension(
                            a.as_source_file(target_file).file_name(),
                        ) == b".d.json.ts");
            }
        }
        false
    }

    pub fn can_have_synthetic_default(
        &mut self,
        file: NodeId,
        module_symbol: SymbolId,
        dont_resolve_alias: bool,
        usage: NodeId,
    ) -> bool {
        let a = self.ast;
        let mut usage_mode: ResolutionMode = RESOLUTION_MODE_NONE;
        if !file.is_nil() {
            usage_mode = self.get_emit_syntax_for_module_specifier_expression(usage);
        }
        if !file.is_nil() && usage_mode != ModuleKind::NONE {
            let target_mode = self.program.get_implied_node_format_for_emit(file);
            if usage_mode == ModuleKind::ES_NEXT
                && target_mode == ModuleKind::COMMON_JS
                && ModuleKind::NODE16 <= self.module_kind
                && self.module_kind <= ModuleKind::NODE_NEXT
            {
                // In Node.js, CommonJS modules always have a synthetic default when imported into ESM
                return true;
            }
            if usage_mode == ModuleKind::ES_NEXT && target_mode == ModuleKind::ES_NEXT {
                // No matter what the `module` setting is, if we're confident that both files are ESM, there cannot be a synthetic default.
                return false;
            }
            // For other files (not node16/nodenext with impliedNodeFormat), check if we can determine the module format from project references
            if target_mode == ModuleKind::NONE && a.as_source_file(file).is_declaration_file {
                // Try to get the project reference - try both source file mapping and output file mapping since declaration files can be mapped either way depending on how they're resolved
                if self.program.get_redirect_for_resolution(file).is_some()
                    || self
                        .program
                        .get_project_reference_from_output_dts(file)
                        .is_some()
                {
                    // This is a declaration file from a project reference, so we can determine its module format from the referenced project's options
                    let target_module_kind = self.program.get_emit_module_format_of_file(file);
                    if usage_mode == ModuleKind::ES_NEXT
                        && ModuleKind::ES2015 <= target_module_kind
                        && target_module_kind <= ModuleKind::ES_NEXT
                    {
                        return false;
                    }
                }
            }
        }
        // Declaration files (and ambient modules)
        if file.is_nil() || a.as_source_file(file).is_declaration_file {
            // Definitely cannot have a synthetic default if they have a syntactic default member specified. Dont resolve alias because we want the immediately exported symbol's declaration
            let default_export_symbol = self.resolve_export_by_name(
                module_symbol,
                INTERNAL_SYMBOL_NAME_DEFAULT,
                NodeId::NIL,
                true,
            );
            if !default_export_symbol.is_nil()
                && some(
                    a.sym(default_export_symbol).declarations.as_slice(),
                    |declaration| is_syntactic_default(a, declaration),
                )
            {
                return false;
            }
            // It _might_ still be incorrect to assume there is no __esModule marker on the import at runtime, even if there is no `default` member. So we check a bit more,
            if !self
                .resolve_export_by_name(
                    module_symbol,
                    b"__esModule",
                    NodeId::NIL,
                    dont_resolve_alias,
                )
                .is_nil()
            {
                // If there is an `__esModule` specified in the declaration (meaning someone explicitly added it or wrote it in their code), it definitely is a module and does not have a synthetic default
                return false;
            }
            // There are _many_ declaration files not written with esmodules in mind that still get compiled into a format with __esModule set. Meaning there may be no default at runtime - however to be on the permissive side, we allow access to a synthetic default member as there is no marker to indicate if the accompanying JS has `__esModule` or not, or is even native esm
            return true;
        }
        // TypeScript files never have a synthetic default (as they are always emitted with an __esModule marker) _unless_ they contain an export= statement
        if !is_in_js_file(a, file) {
            return has_export_assignment_symbol(a, module_symbol);
        }
        // JS files have a synthetic default if they do not contain ES2015+ module syntax (export = is not valid in js) _and_ do not have an __esModule marker
        let external_module_indicator = a.as_source_file(file).external_module_indicator;
        (external_module_indicator.is_nil() || external_module_indicator == file)
            && self
                .resolve_export_by_name(
                    module_symbol,
                    b"__esModule",
                    NodeId::NIL,
                    dont_resolve_alias,
                )
                .is_nil()
    }

    pub fn get_emit_syntax_for_module_specifier_expression(&self, usage: NodeId) -> ResolutionMode {
        let a = self.ast;
        if is_string_literal_like(a, usage) {
            return self
                .program
                .get_emit_syntax_for_usage_location(get_source_file_of_node(a, usage), usage);
        }
        ModuleKind::NONE
    }

    pub fn error_no_module_member_symbol(
        &mut self,
        module_symbol: SymbolId,
        target_symbol: SymbolId,
        node: NodeId,
        name: NodeId,
    ) {
        let a = self.ast;
        if self.compiler_options.no_check.is_true() {
            return;
        }
        let module_name = self.get_fully_qualified_name(module_symbol, node);
        let declaration_name = declaration_name_to_string(a, name);
        let mut suggestion = SymbolId::NIL;
        if is_identifier(a, name) {
            suggestion = self.get_suggested_symbol_for_nonexistent_module(name, target_symbol);
        }
        if !suggestion.is_nil() {
            let suggestion_name = self.symbol_to_string(suggestion);
            let diagnostic = self.error(
                name,
                diagnostics::X_0_HAS_NO_EXPORTED_MEMBER_NAMED_1_DID_YOU_MEAN_2,
                &[
                    Arg::Str(&module_name),
                    Arg::Str(&declaration_name),
                    Arg::Str(&suggestion_name),
                ],
            );
            let value_declaration = a.sym(suggestion).value_declaration;
            if !value_declaration.is_nil() {
                let related = self.create_diagnostic_for_node(
                    value_declaration,
                    diagnostics::X_0_IS_DECLARED_HERE,
                    &[Arg::Str(&suggestion_name)],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
            }
        } else {
            if !a
                .table_get(a.sym(module_symbol).exports, INTERNAL_SYMBOL_NAME_DEFAULT)
                .is_nil()
            {
                self.error(
                    name,
                    diagnostics::MODULE_0_HAS_NO_EXPORTED_MEMBER_1_DID_YOU_MEAN_TO_USE_IMPORT_1_FROM_0_INSTEAD,
                    &[Arg::Str(&module_name), Arg::Str(&declaration_name)],
                );
            } else {
                self.report_non_exported_member(
                    name,
                    &declaration_name,
                    module_symbol,
                    &module_name,
                );
            }
        }
    }

    pub fn report_non_exported_member(
        &mut self,
        name: NodeId,
        declaration_name: &[u8],
        module_symbol: SymbolId,
        module_name: &[u8],
    ) {
        let a = self.ast;
        let mut local_symbol = SymbolId::NIL;
        let locals = a.locals(a.sym(module_symbol).value_declaration);
        if !locals.is_nil() {
            local_symbol = a.table_get(locals, a.text(name));
        }
        let exports = a.sym(module_symbol).exports;
        if !local_symbol.is_nil() {
            let exported_equals_symbol = a.table_get(exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
            if !exported_equals_symbol.is_nil() {
                if !self
                    .get_symbol_if_same_reference(exported_equals_symbol, local_symbol)
                    .is_nil()
                {
                    self.report_invalid_import_equals_export_member(
                        name,
                        declaration_name,
                        module_name,
                    );
                } else {
                    self.error(
                        name,
                        diagnostics::MODULE_0_HAS_NO_EXPORTED_MEMBER_1,
                        &[Arg::Str(module_name), Arg::Str(declaration_name)],
                    );
                }
            } else {
                let exported_symbol = find_in_map(a, exports, |symbol| {
                    !self
                        .get_symbol_if_same_reference(symbol, local_symbol)
                        .is_nil()
                });
                let diagnostic = if !exported_symbol.is_nil() {
                    let exported_name = self.symbol_to_string(exported_symbol);
                    self.error(
                        name,
                        diagnostics::MODULE_0_DECLARES_1_LOCALLY_BUT_IT_IS_EXPORTED_AS_2,
                        &[
                            Arg::Str(module_name),
                            Arg::Str(declaration_name),
                            Arg::Str(&exported_name),
                        ],
                    )
                } else {
                    self.error(
                        name,
                        diagnostics::MODULE_0_DECLARES_1_LOCALLY_BUT_IT_IS_NOT_EXPORTED,
                        &[Arg::Str(module_name), Arg::Str(declaration_name)],
                    )
                };
                for (i, &decl) in a
                    .sym(local_symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .enumerate()
                {
                    let related = self.create_diagnostic_for_node(
                        decl,
                        if_else(
                            i == 0,
                            diagnostics::X_0_IS_DECLARED_HERE,
                            diagnostics::X_AND_HERE,
                        ),
                        &[Arg::Str(declaration_name)],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
            }
        } else {
            self.error(
                name,
                diagnostics::MODULE_0_HAS_NO_EXPORTED_MEMBER_1,
                &[Arg::Str(module_name), Arg::Str(declaration_name)],
            );
        }
    }

    pub fn report_invalid_import_equals_export_member(
        &mut self,
        name: NodeId,
        declaration_name: &[u8],
        module_name: &[u8],
    ) {
        if self.module_kind >= ModuleKind::ES2015 {
            self.error(
                name,
                diagnostics::X_0_CAN_ONLY_BE_IMPORTED_BY_USING_A_DEFAULT_IMPORT,
                &[Arg::Str(declaration_name)],
            );
        } else if is_in_js_file(self.ast, name) {
            self.error(
                name,
                diagnostics::X_0_CAN_ONLY_BE_IMPORTED_BY_USING_A_REQUIRE_CALL_OR_BY_USING_A_DEFAULT_IMPORT,
                &[Arg::Str(declaration_name)],
            );
        } else {
            self.error(
                name,
                diagnostics::X_0_CAN_ONLY_BE_IMPORTED_BY_USING_IMPORT_1_REQUIRE_2_OR_A_DEFAULT_IMPORT,
                &[
                    Arg::Str(declaration_name),
                    Arg::Str(declaration_name),
                    Arg::Str(module_name),
                ],
            );
        }
    }

    pub fn get_target_of_export_specifier(
        &mut self,
        node: NodeId,
        meaning: SymbolFlags,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        let name = a.property_name_or_name(node);
        if module_export_name_is_default(a, name) {
            let specifier = self.get_module_specifier_for_import_or_export(node);
            if !specifier.is_nil() {
                let module_symbol = self.resolve_external_module_name(node, specifier, false);
                if !module_symbol.is_nil() {
                    return self.get_target_of_module_default(
                        module_symbol,
                        node,
                        dont_resolve_alias,
                    );
                }
            }
        }
        let export_declaration = a.parent(a.parent(node));
        let resolved = if !a.module_specifier(export_declaration).is_nil() {
            self.get_external_module_member(export_declaration, node, dont_resolve_alias)
        } else if is_string_literal(a, name) {
            SymbolId::NIL
        } else {
            self.resolve_entity_name(name, meaning, false, dont_resolve_alias, NodeId::NIL)
        };
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        resolved
    }

    pub fn get_target_of_export_assignment(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        // An `export =` / `export default` inside a namespace/module block is a grammar error; checkExportAssignment reports it and returns without resolving the expression. Mirror that bail-out here (using the same container computation) so that alias resolution triggered by the emit resolver does not resolve — and report "Cannot find name" diagnostics on — the expression, which would produce diagnostics inconsistent with checking.
        if is_contained_by_namespace(a, node) {
            return SymbolId::NIL;
        }
        let resolved = self.get_target_of_alias_like_expression(a.expression(node));
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        resolved
    }

    pub fn get_target_of_binary_expression(&mut self, node: NodeId) -> SymbolId {
        let right = self.ast.as_binary_expression(node).right;
        let resolved = self.get_target_of_alias_like_expression(right);
        self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
        resolved
    }

    pub fn get_target_of_alias_like_expression(&mut self, expression: NodeId) -> SymbolId {
        let a = self.ast;
        if is_class_expression(a, expression) {
            let class_type = self.check_expression_cached(expression);
            return self.types[class_type].symbol;
        }
        if !is_entity_name(a, expression) && !is_entity_name_expression(a, expression) {
            return SymbolId::NIL;
        }
        let alias_like = self.resolve_entity_name(
            expression,
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            true,
            true,
            NodeId::NIL,
        );
        if !alias_like.is_nil() {
            return alias_like;
        }
        self.check_expression_cached(expression);
        self.get_resolved_symbol_or_nil(expression)
    }

    pub fn get_target_of_namespace_export_declaration(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        if can_have_symbol(a, a.parent(node)) {
            let resolved = self.resolve_external_module_symbol(a.symbol(a.parent(node)), true);
            self.mark_symbol_of_alias_declaration_if_type_only(node, NodeId::NIL);
            return resolved;
        }
        SymbolId::NIL
    }

    pub fn get_target_of_access_expression(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        if is_binary_expression(a, a.parent(node)) {
            let expr = a.as_binary_expression(a.parent(node));
            if expr.left == node && a.kind(expr.operator_token) == Kind::EqualsToken {
                return self.get_target_of_alias_like_expression(expr.right);
            }
        }
        SymbolId::NIL
    }

    pub fn get_module_specifier_for_import_or_export(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        match a.kind(node) {
            Kind::ImportClause => get_module_specifier_from_node(a, a.parent(node)),
            Kind::ImportEqualsDeclaration => {
                let module_reference = a.as_import_equals_declaration(node).module_reference;
                if is_external_module_reference(a, module_reference) {
                    a.expression(module_reference)
                } else {
                    NodeId::NIL
                }
            }
            Kind::NamespaceImport => get_module_specifier_from_node(a, a.parent(a.parent(node))),
            Kind::ImportSpecifier => {
                get_module_specifier_from_node(a, a.parent(a.parent(a.parent(node))))
            }
            Kind::NamespaceExport => get_module_specifier_from_node(a, a.parent(node)),
            Kind::ExportSpecifier => get_module_specifier_from_node(a, a.parent(a.parent(node))),
            _ => self.fail("Unhandled case in getModuleSpecifierForImportOrExport"),
        }
    }
}

pub fn get_module_specifier_from_node(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration => a.module_specifier(node),
        Kind::ExportDeclaration => a.module_specifier(node),
        _ => a.unhandled("Unhandled case in getModuleSpecifierFromNode", node),
    }
}

impl<'a> Checker<'a> {
    // Marks a symbol as type-only if its declaration is syntactically type-only. If it is not itself marked type-only, but resolves to a type-only alias somewhere in its resolution chain, save a reference to the type-only alias declaration so the alias _not_ marked type-only can be identified as _transitively_ type-only. This function is called on each alias declaration that could be type-only or resolve to another type-only alias during `resolveAlias`, so that later, when an alias is used in a JS-emitting expression, we can quickly determine if that symbol is effectively type-only and issue an error if so. `aliasDeclaration` is the alias declaration not marked as type-only, `immediateTarget` the symbol to which the alias declaration immediately resolves, `finalTarget` the symbol to which the alias declaration ultimately resolves. `overwriteEmpty` checks `resolvesToSymbol` for type-only declarations even if `aliasDeclaration` has already been marked as not resolving to a type-only alias. Used when recursively resolving qualified names of import aliases, e.g. `import C = a.b.C`. If namespace `a` is not found to be type-only, the import declaration will initially be marked as not resolving to a type-only symbol. But, namespace `b` must still be checked for a type-only marker, overwriting the previous negative result if found.
    pub fn mark_symbol_of_alias_declaration_if_type_only(
        &mut self,
        alias_declaration: NodeId,
        export_star_declaration: NodeId,
    ) -> bool {
        let a = self.ast;
        if alias_declaration.is_nil() || !is_declaration_node(a, alias_declaration) {
            return false;
        }
        // If the declaration itself is type-only, mark it and return. No need to check what it resolves to.
        let source_symbol = self.get_symbol_of_declaration(alias_declaration);
        let links = self.alias_symbol_links.get(source_symbol);
        if self.alias_symbol_links[links]
            .type_only_declaration
            .is_nil()
            && is_type_only_import_or_export_declaration(a, alias_declaration)
        {
            self.alias_symbol_links[links].type_only_declaration = alias_declaration;
            return true;
        }
        if self.alias_symbol_links[links]
            .type_only_declaration
            .is_nil()
            && !export_star_declaration.is_nil()
        {
            self.alias_symbol_links[links].type_only_declaration = export_star_declaration;
            return true;
        }
        !self.alias_symbol_links[links]
            .type_only_declaration
            .is_nil()
    }
}
