// checker.go:15830-16012 (layers A-ALIAS, Q-ENTITY): the target of an alias declaration by the kind of the declaration, the resolution of entity names and qualified names with their errors, and fully qualified symbol names.
use crate::ast::{
    Arg, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, Kind, NodeId, SymbolFlags, SymbolId,
    get_first_identifier, is_entity_name, is_in_js_file, is_qualified_name, is_type_of_expression,
    is_variable_declaration, node_is_missing, node_is_synthesized,
};
use crate::checker::{
    Checker, SymbolFormatFlags, entity_name_to_string, get_alias_declaration_from_name,
    get_containing_qualified_name_node,
};
use crate::core::ModuleResolutionKind;
use crate::diagnostics::{self, MessageId};
use crate::internal::LoopGuard;
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn get_target_of_alias_declaration(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        if node.is_nil() {
            return SymbolId::NIL;
        }
        match a.kind(node) {
            Kind::ImportEqualsDeclaration | Kind::VariableDeclaration => {
                self.get_target_of_import_equals_declaration(node)
            }
            Kind::ImportClause => self.get_target_of_import_clause(node),
            Kind::NamespaceImport => self.get_target_of_namespace_import(node),
            Kind::NamespaceExport => self.get_target_of_namespace_export(node),
            Kind::ImportSpecifier | Kind::BindingElement => {
                self.get_target_of_import_specifier(node)
            }
            Kind::ExportSpecifier => self.get_target_of_export_specifier(
                node,
                SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
                true,
            ),
            Kind::ExportAssignment => self.get_target_of_export_assignment(node),
            Kind::BinaryExpression => self.get_target_of_binary_expression(node),
            Kind::NamespaceExportDeclaration => {
                self.get_target_of_namespace_export_declaration(node)
            }
            Kind::ShorthandPropertyAssignment => self.resolve_entity_name(
                a.as_shorthand_property_assignment(node).name,
                SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
                true,
                true,
                NodeId::NIL,
            ),
            Kind::PropertyAssignment => {
                self.get_target_of_alias_like_expression(a.initializer(node))
            }
            Kind::ElementAccessExpression | Kind::PropertyAccessExpression => {
                self.get_target_of_access_expression(node)
            }
            _ => self.fail_detail(
                "Unhandled case in getTargetOfAliasDeclaration: ",
                a.kind(node) as u32,
            ),
        }
    }

    // Resolves a qualified name and any involved aliases.
    pub fn resolve_entity_name(
        &mut self,
        name: NodeId,
        meaning: SymbolFlags,
        ignore_errors: bool,
        dont_resolve_alias: bool,
        location: NodeId,
    ) -> SymbolId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if node_is_missing(a, name) {
            return SymbolId::NIL;
        }
        let mut symbol;
        match a.kind(name) {
            Kind::Identifier => {
                let mut message = MessageId::NIL;
                if !ignore_errors {
                    if meaning == SymbolFlags::NAMESPACE || node_is_synthesized(a, name) {
                        message = diagnostics::CANNOT_FIND_NAMESPACE_0;
                    } else {
                        message = self.get_cannot_find_name_diagnostic_for_name(
                            get_first_identifier(a, name),
                        );
                    }
                }
                let mut resolve_location = location;
                if resolve_location.is_nil() {
                    resolve_location = name;
                }
                if meaning == SymbolFlags::NAMESPACE {
                    let resolved = self.resolve_name(
                        resolve_location,
                        a.text(name),
                        meaning,
                        MessageId::NIL,
                        true,
                        false,
                    );
                    symbol = self.get_merged_symbol(resolved);
                    if symbol.is_nil() {
                        let resolved_alias = self.resolve_name(
                            resolve_location,
                            a.text(name),
                            SymbolFlags::ALIAS,
                            MessageId::NIL,
                            true,
                            false,
                        );
                        let alias = self.get_merged_symbol(resolved_alias);
                        if !alias.is_nil()
                            && a.sym(alias).name == INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                        {
                            // resolve typedefs exported from commonjs, stored on the module symbol
                            symbol = a.sym(alias).parent;
                        }
                    }
                    if symbol.is_nil() && !message.is_nil() {
                        self.resolve_name(
                            resolve_location,
                            a.text(name),
                            meaning,
                            message,
                            true,
                            false,
                        );
                    }
                } else {
                    let resolved = self.resolve_name(
                        resolve_location,
                        a.text(name),
                        meaning,
                        message,
                        true,
                        false,
                    );
                    symbol = self.get_merged_symbol(resolved);
                }
            }
            Kind::QualifiedName => {
                let qualified = a.as_qualified_name(name);
                symbol = self.resolve_qualified_name(
                    name,
                    qualified.left,
                    qualified.right,
                    meaning,
                    ignore_errors,
                    location,
                );
            }
            Kind::PropertyAccessExpression => {
                let access = a.as_property_access_expression(name);
                symbol = self.resolve_qualified_name(
                    name,
                    access.expression,
                    access.name,
                    meaning,
                    ignore_errors,
                    location,
                );
            }
            _ => {
                return self.fail("Unknown entity name kind");
            }
        }
        if !symbol.is_nil() && symbol != self.unknown_symbol {
            if !node_is_synthesized(a, name)
                && is_entity_name(a, name)
                && (a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
                    || !a.parent(name).is_nil() && a.kind(a.parent(name)) == Kind::ExportAssignment)
            {
                self.mark_symbol_of_alias_declaration_if_type_only(
                    get_alias_declaration_from_name(a, name),
                    NodeId::NIL,
                );
            }
            // We know a symbol with the given meaning exists along the alias chain, so resolve until we find it. An alias that resolves to itself keeps upstream's loop alive: the guard ends it.
            let mut guard = LoopGuard::new();
            while !a.sym(symbol).flags.intersects(meaning)
                && !dont_resolve_alias
                && a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
            {
                if !guard.turn() {
                    self.loop_limit("resolveEntityName");
                    break;
                }
                symbol = self.resolve_alias(symbol);
            }
        }
        symbol
    }

    pub fn resolve_qualified_name(
        &mut self,
        name: NodeId,
        left: NodeId,
        right: NodeId,
        meaning: SymbolFlags,
        ignore_errors: bool,
        location: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut namespace =
            self.resolve_entity_name(left, SymbolFlags::NAMESPACE, ignore_errors, false, location);
        if namespace.is_nil() || node_is_missing(a, right) {
            return SymbolId::NIL;
        }
        if namespace == self.unknown_symbol {
            return namespace;
        }
        let value_declaration = a.sym(namespace).value_declaration;
        if !value_declaration.is_nil()
            && is_in_js_file(a, value_declaration)
            && self.compiler_options.get_module_resolution_kind() != ModuleResolutionKind::BUNDLER
            && is_variable_declaration(a, value_declaration)
            && !a.initializer(value_declaration).is_nil()
            && self.is_common_js_require(a.initializer(value_declaration))
        {
            let module_name = a.arguments(a.initializer(value_declaration)).at(0usize);
            let module_sym = self.resolve_external_module_name(module_name, module_name, false);
            if !module_sym.is_nil() {
                let resolved_module_symbol = self.resolve_external_module_symbol(module_sym, false);
                if !resolved_module_symbol.is_nil() {
                    namespace = resolved_module_symbol;
                }
            }
        }
        let text = a.text(right);
        let exports = self.get_exports_of_symbol(namespace);
        let found = self.get_symbol(exports, text, meaning);
        let mut symbol = self.get_merged_symbol(found);
        if symbol.is_nil() && a.sym(namespace).flags.intersects(SymbolFlags::ALIAS) {
            // `namespace` can be resolved further if there was a symbol merge with a re-export
            let resolved_namespace = self.resolve_alias(namespace);
            let exports = self.get_exports_of_symbol(resolved_namespace);
            let found = self.get_symbol(exports, text, meaning);
            symbol = self.get_merged_symbol(found);
        }
        if symbol.is_nil() {
            if !ignore_errors {
                let namespace_name = self.get_fully_qualified_name(namespace, NodeId::NIL);
                let declaration_name = declaration_name_to_string(a, right);
                let suggestion_for_nonexistent_module =
                    self.get_suggested_symbol_for_nonexistent_module(right, namespace);
                if !suggestion_for_nonexistent_module.is_nil() {
                    let suggestion_name = self.symbol_to_string(suggestion_for_nonexistent_module);
                    self.error(
                        right,
                        diagnostics::X_0_HAS_NO_EXPORTED_MEMBER_NAMED_1_DID_YOU_MEAN_2,
                        &[
                            Arg::Str(&namespace_name),
                            Arg::Str(&declaration_name),
                            Arg::Str(&suggestion_name),
                        ],
                    );
                    return SymbolId::NIL;
                }
                let mut containing_qualified_name = NodeId::NIL;
                if is_qualified_name(a, name) {
                    containing_qualified_name = get_containing_qualified_name_node(a, name);
                }
                let can_suggest_typeof = !self.global_object_type.is_nil()
                    && meaning.intersects(SymbolFlags::TYPE)
                    && !containing_qualified_name.is_nil()
                    && !is_type_of_expression(a, a.parent(containing_qualified_name))
                    && !self
                        .try_get_qualified_name_as_value(containing_qualified_name)
                        .is_nil();
                if can_suggest_typeof {
                    let entity_name = entity_name_to_string(a, containing_qualified_name);
                    self.error(
                        containing_qualified_name,
                        diagnostics::X_0_REFERS_TO_A_VALUE_BUT_IS_BEING_USED_AS_A_TYPE_HERE_DID_YOU_MEAN_TYPEOF_0,
                        &[Arg::Str(&entity_name)],
                    );
                    return SymbolId::NIL;
                }
                if meaning.intersects(SymbolFlags::NAMESPACE) {
                    if is_qualified_name(a, a.parent(name)) {
                        let exports = self.get_exports_of_symbol(namespace);
                        let found = self.get_symbol(exports, text, SymbolFlags::TYPE);
                        let exported_type_symbol = self.get_merged_symbol(found);
                        if !exported_type_symbol.is_nil() {
                            let qualified = a.as_qualified_name(a.parent(name));
                            let exported_type_name = self.symbol_to_string(exported_type_symbol);
                            self.error(
                                qualified.right,
                                diagnostics::CANNOT_ACCESS_0_1_BECAUSE_0_IS_A_TYPE_BUT_NOT_A_NAMESPACE_DID_YOU_MEAN_TO_RETRIEVE_THE_TYPE_OF_THE_PROPERTY_1_IN_0_WITH_0_1,
                                &[
                                    Arg::Str(&exported_type_name),
                                    Arg::Str(a.text(qualified.right)),
                                ],
                            );
                            return SymbolId::NIL;
                        }
                    }
                }
                self.error(
                    right,
                    diagnostics::NAMESPACE_0_HAS_NO_EXPORTED_MEMBER_1,
                    &[Arg::Str(&namespace_name), Arg::Str(&declaration_name)],
                );
            }
        }
        symbol
    }

    pub fn try_get_qualified_name_as_value(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let id = get_first_identifier(a, node);
        let mut symbol = self.resolve_name(
            id,
            a.text(id),
            SymbolFlags::VALUE,
            MessageId::NIL,
            true,
            false,
        );
        if symbol.is_nil() {
            return SymbolId::NIL;
        }
        let mut n = id;
        while is_qualified_name(a, a.parent(n)) {
            let t = self.get_type_of_symbol(symbol);
            symbol = self.get_property_of_type(t, a.text(a.as_qualified_name(a.parent(n)).right));
            if symbol.is_nil() {
                return SymbolId::NIL;
            }
            n = a.parent(n);
        }
        symbol
    }

    pub fn get_suggested_symbol_for_nonexistent_module(
        &mut self,
        name: NodeId,
        target_module: SymbolId,
    ) -> SymbolId {
        let a = self.ast;
        let exports = self.get_exports_of_module(target_module);
        // `maps.Values(exports)`: the symbols of the table in its own order.
        let mut symbols: Vec<SymbolId> = Vec::new();
        let mut position = 0;
        while let Some((_, symbol)) = a.table_entry_at(exports, position) {
            position += 1;
            symbols.push(symbol);
        }
        self.get_spelling_suggestion_for_name(a.text(name), &symbols, SymbolFlags::MODULE_MEMBER)
    }

    pub fn get_fully_qualified_name(
        &mut self,
        symbol: SymbolId,
        containing_location: NodeId,
    ) -> Vec<u8> {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return Vec::new();
        }
        let parent = self.ast.sym(symbol).parent;
        if !parent.is_nil() {
            let mut name = self.get_fully_qualified_name(parent, containing_location);
            name.push(b'.');
            name.extend_from_slice(&self.symbol_to_string(symbol));
            return name;
        }
        self.symbol_to_string_ex(
            symbol,
            containing_location,
            SymbolFlags::ALL,
            SymbolFormatFlags::DO_NOT_INCLUDE_SYMBOL_CHAIN | SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
        )
    }
}
