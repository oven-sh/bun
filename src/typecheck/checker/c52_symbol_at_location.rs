// checker.go:31704-32296 (layer Z-SERVICES): the symbol and the type at a node of the tree, the index signatures at a property name, the `this` type that a contextual type gives an object literal, the index infos and the index symbol that apply to a key type, the test for a reference to `arguments` in a function body, and the exported GetTypeAtLocation, GetEmitResolver and GetAliasedSymbol.
use crate::ast::{
    CheckFlags, INTERNAL_SYMBOL_NAME_INDEX, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId,
    find_ancestor, find_ancestor_kind, get_external_module_import_equals_declaration_expression,
    get_external_module_name, get_host_signature_from_jsdoc, get_node_at_position,
    get_reparsed_node_for_node, get_source_file_of_node, is_binary_expression,
    is_bindable_object_define_property_call, is_binding_element, is_binding_pattern,
    is_call_expression, is_class_or_interface_like, is_computed_property_name, is_declaration,
    is_declaration_name, is_declaration_name_or_import_property_name, is_element_access_expression,
    is_entity_name, is_entity_name_expression, is_export_assignment, is_expression_node,
    is_expression_with_type_arguments_in_class_extends_clause,
    is_external_module_import_equals_declaration, is_external_or_common_js_module,
    is_function_like, is_identifier, is_import_attributes, is_import_call,
    is_import_or_export_specifier, is_in_expression_context, is_indexed_access_type_node,
    is_jsdoc_name_reference_context, is_jsdoc_parameter_tag, is_jsx_tag_name,
    is_literal_computed_property_declaration_name, is_literal_import_type_node,
    is_literal_type_node, is_meta_property, is_name_of_heritage_clause_type_reference,
    is_object_binding_pattern, is_part_of_type_node, is_private_identifier,
    is_property_access_expression, is_qualified_name,
    is_right_side_of_qualified_name_or_property_access, is_source_file, is_this_in_type_query,
    is_type_declaration, is_type_declaration_name, is_variable_declaration_initialized_to_require,
    node_is_missing, try_get_class_implementing_or_extending_heritage_clause_element,
};
use crate::checker::{
    CheckMode, Checker, ContextFlags, EmitResolver, IndexInfoId, ObjectFlags, TypeFlags, TypeId,
    get_containing_object_literal, is_import_type_qualifier_part,
    is_in_name_of_expression_with_type_arguments_or_heritage_type_reference,
    is_in_right_side_of_import_or_export_assignment, is_jsx_intrinsic_tag_name, is_type_any,
    is_type_reference_identifier, node_starts_new_lexical_environment,
};
use crate::core::{List, append_if_unique, first_or_nil};

impl<'a> Checker<'a> {
    pub fn get_symbol_at_location_exported(&mut self, node: NodeId) -> SymbolId {
        // set ignoreErrors: true because any lookups invoked by the API shouldn't cause any new errors
        let node = get_reparsed_node_for_node(self.ast, node);
        self.get_symbol_at_location(node, true)
    }

    // Returns the symbol associated with a given AST node. Do *not* use this function in the checker itself! It should be used only by the language service and external tools. The semantics of the function are deliberately "fuzzy" and aim to just return *some* symbol for the node. To obtain the symbol associated with a node for type checking purposes, use appropriate function for the context, e.g. `getResolvedSymbol` for an expression identifier, `getSymbolOfDeclaration` for a declaration, etc.
    pub fn get_symbol_at_location(&mut self, node: NodeId, ignore_errors: bool) -> SymbolId {
        let a = self.ast;
        if is_source_file(a, node) {
            if is_external_or_common_js_module(a, node) {
                return self.get_merged_symbol(a.symbol(node));
            }
            return SymbolId::NIL;
        }
        let parent = a.parent(node);
        let grand_parent = a.parent(parent);

        if a.flags(node).intersects(NodeFlags::IN_WITH_STATEMENT) {
            // We cannot answer semantic questions within a with block, do not proceed any further
            return SymbolId::NIL;
        }

        if is_declaration_name_or_import_property_name(a, node) {
            // This is a declaration, call getSymbolOfNode
            let parent_symbol = self.get_symbol_of_declaration(parent);
            if is_import_or_export_specifier(a, parent) && a.property_name(parent) == node {
                return self.get_immediate_aliased_symbol(parent_symbol);
            }
            return parent_symbol;
        } else if is_literal_computed_property_declaration_name(a, node) {
            return self.get_symbol_of_declaration(grand_parent);
        }

        if is_identifier(a, node) {
            if is_in_right_side_of_import_or_export_assignment(a, node) {
                return self.get_symbol_of_name_or_property_access_expression(node);
            } else if is_binding_element(a, parent)
                && is_object_binding_pattern(a, grand_parent)
                && node == a.property_name(parent)
            {
                let type_of_pattern = self.get_type_of_node(grand_parent);
                let property_declaration = self.get_property_of_type(type_of_pattern, a.text(node));
                if !property_declaration.is_nil() {
                    return property_declaration;
                }
            } else if is_meta_property(a, parent) && a.name(parent) == node {
                let meta_prop = a.as_meta_property(parent);
                if meta_prop.keyword_token == Kind::NewKeyword && a.text(node) == b"target" {
                    // `target` in `new.target`
                    let t = self.check_new_target_meta_property(parent);
                    return self.types[t].symbol;
                }
                // The `meta` in `import.meta` could be given `getTypeOfNode(parent).symbol` (the `ImportMeta` interface symbol), but we have a fake expression type made for other reasons already, whose transient `meta` member should more exactly be the kind of (declarationless) symbol we want.
                if meta_prop.keyword_token == Kind::ImportKeyword && a.text(node) == b"meta" {
                    let t = self.get_global_import_meta_expression_type();
                    let members = self.as_object_type(t).structured.members;
                    return a.table_get(members, b"meta");
                }
                // no other meta properties are valid syntax, thus no others should have symbols
                return SymbolId::NIL;
            } else if is_jsdoc_parameter_tag(a, parent) && a.name(parent) == node {
                let func =
                    get_node_at_position(a, get_source_file_of_node(a, node), a.pos(node), false);
                if !func.is_nil() && is_function_like(a, func) {
                    for &param in a.parameters(func).as_slice() {
                        let param_name = a.name(param);
                        if is_identifier(a, param_name) && a.text(param_name) == a.text(node) {
                            return self.get_symbol_of_node(param);
                        }
                    }
                }
            }
        }

        let kind = a.kind(node);
        match kind {
            // The first three cases of upstream fall through, one into the next: a name that is no `this` of a type query returns from the first, ThisKeyword enters at the second and ThisType at the third.
            Kind::Identifier
            | Kind::PrivateIdentifier
            | Kind::PropertyAccessExpression
            | Kind::QualifiedName
            | Kind::ThisKeyword
            | Kind::ThisType => {
                if kind != Kind::ThisKeyword
                    && kind != Kind::ThisType
                    && !is_this_in_type_query(a, node)
                {
                    return self.get_symbol_of_name_or_property_access_expression(node);
                }
                if kind != Kind::ThisType {
                    let container = self.get_this_container(node, false, false);
                    if is_function_like(a, container) {
                        let sig = self.get_signature_from_declaration(container);
                        let this_parameter = self.signatures[sig].this_parameter;
                        if !this_parameter.is_nil() {
                            return this_parameter;
                        }
                    }
                    if is_in_expression_context(a, node) {
                        let t = self.check_expression(node);
                        return self.types[t].symbol;
                    }
                }
                let t = self.get_type_from_this_type_node(node);
                self.types[t].symbol
            }
            Kind::SuperKeyword => {
                let t = self.check_expression(node);
                self.types[t].symbol
            }
            Kind::ConstructorKeyword => {
                // constructor keyword for an overload, should take us to the definition if it exist
                let constructor_declaration = parent;
                if !constructor_declaration.is_nil()
                    && a.kind(constructor_declaration) == Kind::Constructor
                {
                    return a.symbol(a.parent(constructor_declaration));
                }
                SymbolId::NIL
            }
            // The case of the two string literal kinds falls through into the one of NumericLiteral.
            Kind::StringLiteral | Kind::NoSubstitutionTemplateLiteral | Kind::NumericLiteral => {
                if kind != Kind::NumericLiteral {
                    // 1). import x = require("./mo/*gotToDefinitionHere*/d") 2). External module name in an import declaration 3). Require in Javascript 4). type A = import("./f/*gotToDefinitionHere*/oo")
                    if (is_external_module_import_equals_declaration(a, grand_parent)
                        && get_external_module_import_equals_declaration_expression(
                            a,
                            grand_parent,
                        ) == node)
                        || (matches!(
                            a.kind(parent),
                            Kind::ImportDeclaration
                                | Kind::JSImportDeclaration
                                | Kind::ExportDeclaration
                        ) && get_external_module_name(a, parent) == node)
                        || is_variable_declaration_initialized_to_require(a, grand_parent)
                        || is_import_call(a, parent)
                        || (is_literal_type_node(a, parent)
                            && is_literal_import_type_node(a, grand_parent)
                            && a.as_import_type_node(grand_parent).argument == parent)
                    {
                        return self.resolve_external_module_name(node, node, ignore_errors);
                    }
                    if is_call_expression(a, parent)
                        && is_bindable_object_define_property_call(a, parent)
                        && a.arguments(parent).at(1) == node
                    {
                        return self.get_symbol_of_declaration(parent);
                    }
                }
                // index access
                let mut object_type = TypeId::NIL;
                if is_element_access_expression(a, parent) {
                    if a.as_element_access_expression(parent).argument_expression == node {
                        object_type = self.get_type_of_expression(a.expression(parent));
                    }
                } else if is_literal_type_node(a, parent)
                    && is_indexed_access_type_node(a, grand_parent)
                {
                    object_type = self.get_type_from_type_node(
                        a.as_indexed_access_type_node(grand_parent).object_type,
                    );
                }

                if !object_type.is_nil() {
                    return self.get_property_of_type(object_type, a.text(node));
                }
                SymbolId::NIL
            }
            Kind::DefaultKeyword
            | Kind::FunctionKeyword
            | Kind::EqualsGreaterThanToken
            | Kind::ClassKeyword => self.get_symbol_of_node(a.parent(node)),
            Kind::ImportType => {
                if is_literal_import_type_node(a, node) {
                    let argument = a.as_import_type_node(node).argument;
                    let literal = a.as_literal_type_node(argument).literal;
                    return self.get_symbol_at_location(literal, ignore_errors);
                }
                SymbolId::NIL
            }
            Kind::ExportKeyword => {
                if is_export_assignment(a, parent) {
                    let symbol = a.symbol(parent);
                    if symbol.is_nil() {
                        return self.fail("Symbol should be defined");
                    }
                    return symbol;
                }
                SymbolId::NIL
            }
            // The case of ImportKeyword falls through into the one of NewKeyword.
            Kind::ImportKeyword | Kind::NewKeyword => {
                if kind == Kind::ImportKeyword
                    && is_meta_property(a, a.parent(node))
                    && a.text(a.parent(node)) == b"defer"
                {
                    return SymbolId::NIL;
                }
                if is_meta_property(a, parent) {
                    let t = self.check_meta_property_keyword(parent);
                    return self.types[t].symbol;
                }
                SymbolId::NIL
            }
            Kind::InstanceOfKeyword => {
                if is_binary_expression(a, parent) {
                    let t = self.get_type_of_expression(a.as_binary_expression(parent).right);
                    let has_instance_method_type =
                        self.get_symbol_has_instance_method_of_object_type(t);
                    if !has_instance_method_type.is_nil()
                        && !self.types[has_instance_method_type].symbol.is_nil()
                    {
                        return self.types[has_instance_method_type].symbol;
                    }
                    return self.types[t].symbol;
                }
                SymbolId::NIL
            }
            Kind::MetaProperty => {
                let t = self.check_expression(node);
                self.types[t].symbol
            }
            // A namespaced name that is no intrinsic tag name falls through into the default case.
            Kind::JsxNamespacedName => {
                if is_jsx_tag_name(a, node) && is_jsx_intrinsic_tag_name(a, node) {
                    let symbol = self.get_intrinsic_tag_symbol(a.parent(node));
                    if symbol == self.unknown_symbol {
                        return SymbolId::NIL;
                    }
                    return symbol;
                }
                SymbolId::NIL
            }
            _ => SymbolId::NIL,
        }
    }

    pub fn get_index_signatures_at_location(&mut self, node: NodeId) -> Vec<NodeId> {
        let a = self.ast;
        let mut signatures: Vec<NodeId> = Vec::new();
        let parent = a.parent(node);
        if is_identifier(a, node)
            && is_property_access_expression(a, parent)
            && a.name(parent) == node
        {
            let key_type = self.get_literal_type_from_property_name(node);
            let object_type = self.get_type_of_expression(a.expression(parent));
            let types = self.type_distributed(object_type);
            for &t in types.as_slice() {
                let index_infos = self.get_applicable_index_infos(t, key_type);
                for &info in index_infos.as_slice() {
                    let declaration = self.index_infos[info].declaration;
                    if !declaration.is_nil() {
                        signatures = append_if_unique(signatures, declaration);
                    }
                }
            }
        }
        signatures
    }

    pub fn get_symbol_of_name_or_property_access_expression(&mut self, name: NodeId) -> SymbolId {
        let a = self.ast;
        let mut name = name;
        if is_declaration_name(a, name) {
            return self.get_symbol_of_node(a.parent(name));
        }
        if a.kind(a.parent(name)) == Kind::ExportAssignment && is_entity_name_expression(a, name) {
            // Even an entity name expression that doesn't resolve as an entityname may still typecheck as a property access expression
            let success = self.resolve_entity_name(
                name,
                SymbolFlags::VALUE
                    | SymbolFlags::TYPE
                    | SymbolFlags::NAMESPACE
                    | SymbolFlags::ALIAS,
                true,
                false,
                NodeId::NIL,
            );
            if !success.is_nil() && success != self.unknown_symbol {
                return success;
            }
        } else if is_entity_name(a, name)
            && is_in_right_side_of_import_or_export_assignment(a, name)
        {
            // Since we already checked for ExportAssignment, this really could only be an Import
            let import_equals_declaration =
                find_ancestor_kind(a, name, Kind::ImportEqualsDeclaration);
            if import_equals_declaration.is_nil() {
                return self.fail("ImportEqualsDeclaration should be defined");
            }
            return self.get_symbol_of_part_of_right_hand_side_of_import_equals(name);
        }

        if is_entity_name(a, name) {
            let possible_import_node = is_import_type_qualifier_part(a, name);
            if !possible_import_node.is_nil() {
                self.get_type_from_type_node(possible_import_node);
                let sym = self.get_resolved_symbol_or_nil(name);
                return if sym == self.unknown_symbol {
                    SymbolId::NIL
                } else {
                    sym
                };
            }
        }

        while is_right_side_of_qualified_name_or_property_access(a, name) {
            name = a.parent(name);
        }

        if is_in_name_of_expression_with_type_arguments_or_heritage_type_reference(a, name) {
            let parent_kind = a.kind(a.parent(name));
            let mut meaning;
            if parent_kind == Kind::ExpressionWithTypeArguments
                || parent_kind == Kind::TypeReference
            {
                // A heritage element name may appear in type space, value space, or both; ensure the meaning matches its context.
                meaning = if is_part_of_type_node(a, name) {
                    SymbolFlags::TYPE
                } else {
                    SymbolFlags::VALUE
                };

                // In a class 'extends' clause we are also looking for a value.
                if is_expression_with_type_arguments_in_class_extends_clause(a, a.parent(name)) {
                    meaning |= SymbolFlags::VALUE;
                }
            } else {
                meaning = SymbolFlags::NAMESPACE;
            }

            meaning |= SymbolFlags::ALIAS;
            let mut entity_name_symbol = SymbolId::NIL;
            if is_entity_name_expression(a, name) {
                entity_name_symbol =
                    self.resolve_entity_name(name, meaning, true, false, NodeId::NIL);
            }
            if !entity_name_symbol.is_nil() {
                return entity_name_symbol;
            }
        }

        if is_expression_node(a, name) {
            if node_is_missing(a, name) {
                // Missing entity name.
                return SymbolId::NIL;
            }
            let is_jsdoc = is_jsdoc_name_reference_context(a, name);
            if is_identifier(a, name) {
                if is_jsx_tag_name(a, name) && is_jsx_intrinsic_tag_name(a, name) {
                    let symbol = self.get_intrinsic_tag_symbol(a.parent(name));
                    return if symbol == self.unknown_symbol {
                        SymbolId::NIL
                    } else {
                        symbol
                    };
                }
                let meaning = if is_jsdoc {
                    SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE
                } else {
                    SymbolFlags::VALUE
                };
                let mut location = NodeId::NIL;
                if is_jsdoc {
                    location = get_host_signature_from_jsdoc(a, name);
                }
                let mut result = self.resolve_entity_name(name, meaning, true, true, location);
                if result.is_nil() && is_jsdoc {
                    let container = find_ancestor(a, name, |n| is_class_or_interface_like(a, n));
                    if !container.is_nil() {
                        let symbol = self.get_symbol_of_declaration(container);
                        // Handle unqualified references to class static members and class or interface instance members
                        let exports = self.get_exports_of_symbol(symbol);
                        let export = self.get_symbol(exports, a.text(name), meaning);
                        result = self.get_merged_symbol(export);
                        if result.is_nil() {
                            let declared_type = self.get_declared_type_of_symbol(symbol);
                            result = self.get_property_of_type(declared_type, a.text(name));
                        }
                    }
                }
                return result;
            } else if is_private_identifier(a, name) {
                return self.get_symbol_for_private_identifier_expression(name);
            } else if is_property_access_expression(a, name) || is_qualified_name(a, name) {
                let links = self.symbol_node_links.get(name);
                if !self.symbol_node_links[links].resolved_symbol.is_nil() {
                    return self.symbol_node_links[links].resolved_symbol;
                }
                if is_property_access_expression(a, name) {
                    self.check_property_access_expression(name, CheckMode::NORMAL, false);
                    if self.symbol_node_links[links].resolved_symbol.is_nil()
                        && !is_private_identifier(a, a.name(name))
                    {
                        let object_type = self.check_expression_cached(a.expression(name));
                        let key_type = self.get_literal_type_from_property_name(a.name(name));
                        let index_symbol = self.get_applicable_index_symbol(object_type, key_type);
                        self.symbol_node_links[links].resolved_symbol = index_symbol;
                    }
                } else {
                    self.check_qualified_name(name, CheckMode::NORMAL);
                }
                if self.symbol_node_links[links].resolved_symbol.is_nil()
                    && is_jsdoc
                    && is_qualified_name(a, name)
                {
                    return self.resolve_jsdoc_member_name(name);
                }
                return self.symbol_node_links[links].resolved_symbol;
            }
        } else if is_entity_name(a, name) && is_type_reference_identifier(a, name) {
            let meaning = if a.kind(a.parent(name)) == Kind::TypeReference {
                SymbolFlags::TYPE
            } else {
                SymbolFlags::NAMESPACE
            };
            let symbol = self.resolve_entity_name(name, meaning, true, true, NodeId::NIL);
            if !symbol.is_nil() && symbol != self.unknown_symbol {
                return symbol;
            }
            if is_name_of_heritage_clause_type_reference(a, name) {
                return SymbolId::NIL;
            }
            return self.get_unresolved_symbol_for_entity_name(name);
        }

        if a.kind(a.parent(name)) == Kind::TypePredicate {
            return self.resolve_entity_name(
                name,
                SymbolFlags::FUNCTION_SCOPED_VARIABLE,
                true,
                false,
                NodeId::NIL,
            );
        }
        SymbolId::NIL
    }

    pub fn is_this_property_and_this_typed(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if a.kind(a.expression(node)) == Kind::ThisKeyword {
            let container = self.get_this_container(node, false, false);
            if is_function_like(a, container) {
                let containing_literal = get_containing_object_literal(a, container);
                if !containing_literal.is_nil() {
                    let contextual_type = self.get_apparent_type_of_contextual_type(
                        containing_literal,
                        ContextFlags::NONE,
                    );
                    let t = self.get_this_type_of_object_literal_from_contextual_type(
                        containing_literal,
                        contextual_type,
                    );
                    return !t.is_nil() && !is_type_any(self, t);
                }
            }
        }
        false
    }

    pub fn get_type_of_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if is_source_file(a, node) && !is_external_or_common_js_module(a, node) {
            return self.error_type;
        }

        if a.flags(node).intersects(NodeFlags::IN_WITH_STATEMENT) {
            // We cannot answer semantic questions within a with block, do not proceed any further
            return self.error_type;
        }

        let (class_decl, is_implements) =
            try_get_class_implementing_or_extending_heritage_clause_element(a, node);
        let mut class_type = TypeId::NIL;
        if !class_decl.is_nil() {
            let class_symbol = self.get_symbol_of_declaration(class_decl);
            class_type = self.get_declared_type_of_class_or_interface(class_symbol);
        }

        if is_part_of_type_node(a, node) {
            let type_from_type_node = self.get_type_from_type_node(node);
            if !class_type.is_nil() {
                let this_type = self.as_interface_type(class_type).this_type;
                return self.get_type_with_this_argument(type_from_type_node, this_type, false);
            }

            return type_from_type_node;
        }

        if is_expression_node(a, node) {
            return self.get_regular_type_of_expression(node);
        }

        if !class_type.is_nil() && !is_implements {
            // A SyntaxKind.ExpressionWithTypeArguments is considered a type node, except when it occurs in the extends clause of a class. We handle that case here.
            let base_types = self.get_base_types(class_type);
            let base_type = first_or_nil(base_types.as_slice());
            if !base_type.is_nil() {
                let this_type = self.as_interface_type(class_type).this_type;
                return self.get_type_with_this_argument(base_type, this_type, false);
            }
            return self.error_type;
        }

        if is_type_declaration(a, node) {
            // In this case, we call getSymbolOfDeclaration instead of getSymbolAtLocation because it is a declaration
            let symbol = self.get_symbol_of_declaration(node);
            return self.get_declared_type_of_symbol(symbol);
        }

        if is_type_declaration_name(a, node) {
            let symbol = self.get_symbol_at_location(node, false);
            if !symbol.is_nil() {
                return self.get_declared_type_of_symbol(symbol);
            }
            return self.error_type;
        }

        if is_binding_element(a, node) {
            let t = self.get_type_for_variable_like_declaration(node, true, CheckMode::NORMAL);
            if !t.is_nil() {
                return t;
            }
            return self.error_type;
        }

        if is_declaration(a, node) {
            // In this case, we call getSymbolOfDeclaration instead of getSymbolLAtocation because it is a declaration
            let symbol = self.get_symbol_of_declaration(node);
            if !symbol.is_nil() {
                return self.get_type_of_symbol(symbol);
            }
            return self.error_type;
        }

        if is_declaration_name_or_import_property_name(a, node) {
            let symbol = self.get_symbol_at_location(node, false);
            if !symbol.is_nil() {
                return self.get_type_of_symbol(symbol);
            }
            return self.error_type;
        }

        if is_binding_pattern(a, node) {
            let t = self.get_type_for_variable_like_declaration(
                a.parent(node),
                true,
                CheckMode::NORMAL,
            );
            if !t.is_nil() {
                return t;
            }
            return self.error_type;
        }

        if is_in_right_side_of_import_or_export_assignment(a, node) {
            let symbol = self.get_symbol_at_location(node, false);
            if !symbol.is_nil() {
                let declared_type = self.get_declared_type_of_symbol(symbol);
                if !self.is_error_type(declared_type) {
                    return declared_type;
                }
                return self.get_type_of_symbol(symbol);
            }
        }

        let parent = a.parent(node);
        if is_meta_property(a, parent) && a.as_meta_property(parent).keyword_token == a.kind(node) {
            return self.check_meta_property_keyword(parent);
        }

        if is_import_attributes(a, node) {
            return self.get_global_import_attributes_type();
        }

        self.error_type
    }

    pub fn get_this_type_of_object_literal_from_contextual_type(
        &mut self,
        containing_literal: NodeId,
        contextual_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let mut literal = containing_literal;
        let mut t = contextual_type;
        while !t.is_nil() {
            let this_type = self.get_this_type_from_contextual_type(t);
            if !this_type.is_nil() {
                return this_type;
            }
            if a.kind(a.parent(literal)) != Kind::PropertyAssignment {
                break;
            }
            literal = a.parent(a.parent(literal));
            t = self.get_apparent_type_of_contextual_type(literal, ContextFlags::NONE);
        }
        TypeId::NIL
    }

    pub fn get_this_type_from_contextual_type(&mut self, t: TypeId) -> TypeId {
        self.map_type(t, &mut |c, t| {
            if c.types[t].flags.intersects(TypeFlags::INTERSECTION) {
                let types = c.as_intersection_type(t).base.types;
                for &t in types.as_slice() {
                    let type_arg = c.get_this_type_argument(t);
                    if !type_arg.is_nil() {
                        return type_arg;
                    }
                }
                TypeId::NIL
            } else {
                c.get_this_type_argument(t)
            }
        })
    }

    // Upstream indexes the type arguments at 0: a reference to the global ThisType without a type argument reads as nil.
    pub fn get_this_type_argument(&mut self, t: TypeId) -> TypeId {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
            && self.as_type_reference(t).object.target == self.global_this_type
        {
            return self.get_type_arguments(t).at(0);
        }
        TypeId::NIL
    }

    pub fn get_applicable_index_infos(
        &mut self,
        t: TypeId,
        key_type: TypeId,
    ) -> List<'a, IndexInfoId> {
        let index_infos = self.get_index_infos_of_type(t);
        self.filter(index_infos, |c, info| {
            let info_key_type = c.index_infos[info].key_type;
            c.is_applicable_index_type(key_type, info_key_type)
        })
    }

    pub fn get_applicable_index_symbol(&mut self, t: TypeId, key_type: TypeId) -> SymbolId {
        let a = self.ast;
        let info = self.get_applicable_index_info(t, key_type);
        if !info.is_nil() && info != self.any_base_type_index_info {
            if self.index_infos[info].index_symbol.is_nil() {
                let mut declarations: Vec<NodeId> = Vec::new();
                let info_declaration = self.index_infos[info].declaration;
                if !info_declaration.is_nil() {
                    declarations.push(info_declaration);
                } else {
                    let index_infos = self.get_index_infos_of_type(t);
                    for &info in index_infos.as_slice() {
                        let declaration = self.index_infos[info].declaration;
                        let info_key_type = self.index_infos[info].key_type;
                        if !declaration.is_nil()
                            && self.is_applicable_index_type(key_type, info_key_type)
                        {
                            declarations.push(declaration);
                        }
                    }
                }
                if let Some(&first_declaration) = declarations.first() {
                    let symbol = self.new_symbol(SymbolFlags::PROPERTY, INTERNAL_SYMBOL_NAME_INDEX);
                    let declarations = self.list_of(&declarations);
                    let parent = self.types[t].symbol;
                    a.update_symbol(symbol, |s| {
                        s.check_flags |= CheckFlags::INDEX_SYMBOL;
                        s.declarations = declarations;
                        s.value_declaration = first_declaration;
                        s.parent = parent;
                    });
                    let value_type = self.index_infos[info].value_type;
                    let links = self.value_symbol_links_get(symbol);
                    self.value_symbol_links[links].resolved_type = value_type;
                    self.index_infos[info].index_symbol = symbol;
                }
            }
            return self.index_infos[info].index_symbol;
        }
        SymbolId::NIL
    }

    pub fn get_regular_type_of_expression(&mut self, expr: NodeId) -> TypeId {
        let a = self.ast;
        let mut expr = expr;
        if is_right_side_of_qualified_name_or_property_access(a, expr) {
            expr = a.parent(expr);
        }
        let t = self.get_type_of_expression(expr);
        self.get_regular_type_of_literal_type(t)
    }

    pub fn contains_arguments_reference(&mut self, node: NodeId) -> bool {
        // The closure `visit` of upstream. The walk answers false and records the stack limit where Go's stack grows.
        fn visit(c: &mut Checker<'_>, node: NodeId) -> bool {
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            if node.is_nil() {
                return false;
            }
            let a = c.ast;
            match a.kind(node) {
                Kind::Identifier => {
                    if a.text(node) != a.sym(c.arguments_symbol).name {
                        return false;
                    }
                    let symbol = c.get_resolved_symbol(node);
                    return c.is_arguments_symbol(symbol);
                }
                Kind::PropertyDeclaration
                | Kind::MethodDeclaration
                | Kind::GetAccessor
                | Kind::SetAccessor => {
                    if is_computed_property_name(a, a.name(node)) {
                        return visit(c, a.name(node));
                    }
                }
                Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                    return visit(c, a.expression(node));
                }
                Kind::PropertyAssignment => return visit(c, a.initializer(node)),
                _ => {}
            }
            if node_starts_new_lexical_environment(a, node) || is_part_of_type_node(a, node) {
                return false;
            }
            a.for_each_child(node, &mut |child| visit(c, child))
        }

        let a = self.ast;
        if a.body(node).is_nil() {
            return false;
        }

        if let Some(contains_arguments) = self.cached_arguments_referenced.get_ok(&node) {
            return contains_arguments;
        }

        let contains_arguments = visit(self, a.body(node));
        let ok = self
            .cached_arguments_referenced
            .set(node, contains_arguments);
        self.map_set(ok);
        contains_arguments
    }

    pub fn get_type_at_location(&mut self, node: NodeId) -> TypeId {
        let node = get_reparsed_node_for_node(self.ast, node);
        self.get_type_of_node(node)
    }

    // A resolver is a value without fields whose methods take the checker, so the checker keeps none and builds none once.
    pub fn get_emit_resolver(&self) -> EmitResolver {
        EmitResolver
    }

    pub fn get_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        self.resolve_alias(symbol)
    }

    // services.go IsArgumentsSymbol: the one function of that file that the checker itself calls, from containsArgumentsReference.
    pub fn is_arguments_symbol(&self, symbol: SymbolId) -> bool {
        symbol == self.arguments_symbol
    }
}
