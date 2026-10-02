// checker.go:1505-2200 (layers N-DIAG and N-RESOLVE): the hooks that the checker gives the name resolver, the diagnostics of a name that does not resolve or that resolves to a symbol of another meaning, the spelling suggestions, the test that a block-scoped declaration comes before its use, the type-only declaration and the immediate target of an alias, and the symbol of a name in a symbol table for a meaning, through merged symbols and alias targets.
use crate::ast::{
    Arg, Ast, DiagnosticId, FindAncestorResult, FunctionFlags, Kind, NodeFlags, NodeId,
    SymbolFlags, SymbolId, SymbolTableId, find_ancestor, find_ancestor_kind, find_ancestor_or_quit,
    get_containing_class, get_enclosing_block_scope_container, get_function_flags,
    get_immediately_invoked_function_expression, get_name_of_declaration, get_root_declaration,
    get_source_file_of_node, is_accessor, is_ambient_module, is_binding_element,
    is_block_or_catch_scoped, is_class_like, is_class_static_block_declaration,
    is_computed_property_name, is_decorator, is_enum_declaration, is_export_assignment,
    is_export_declaration, is_export_specifier, is_external_or_common_js_module,
    is_for_in_or_of_statement, is_function_like, is_global_scope_augmentation, is_heritage_clause,
    is_identifier, is_method_declaration, is_namespace_export, is_namespace_export_declaration,
    is_parameter_declaration, is_parameter_property_declaration, is_private_identifier,
    is_property_declaration, is_property_signature_declaration, is_qualified_name, is_source_file,
    is_static, is_type_literal_node, is_type_only_import_declaration,
    is_valid_type_only_alias_use_site, node_kind_is, symbol_name, to_find_ancestor_result,
};
use crate::checker::{
    Checker, TypeFlags, get_feature_map, is_const_type_reference_name, is_exclamation_token,
    is_export_assignment_expression_name, is_in_type_query, is_this_property,
    is_type_reference_identifier,
};
use crate::core::{
    Tristate, concatenate_seq, every, filter, find, get_spelling_suggestion_exported, if_else,
};
use crate::diagnostics::{self, MessageId};
use crate::internal::{FaultKind, LoopGuard};
use crate::scanner::declaration_name_to_string;
use std::borrow::Cow;
use std::cell::RefCell;

impl<'a> Checker<'a> {
    pub fn symbol_referenced(&mut self, symbol: SymbolId, meaning: SymbolFlags) {
        let links = self.symbol_reference_links.get(symbol);
        self.symbol_reference_links[links].reference_kinds |= meaning;
    }

    pub fn get_requires_scope_change_cache(&mut self, node: NodeId) -> Tristate {
        let links = self.node_links.get(node);
        self.node_links[links].declaration_requires_scope_change
    }

    pub fn set_requires_scope_change_cache(&mut self, node: NodeId, value: Tristate) {
        let links = self.node_links.get(node);
        self.node_links[links].declaration_requires_scope_change = value;
    }

    // The invalid initializer error is needed in two situation: 1. When result is undefined, after checking for a missing "this." 2. When result is defined
    pub fn check_and_report_error_for_invalid_initializer(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        property_with_invalid_initializer: NodeId,
        result: SymbolId,
    ) -> bool {
        let a = self.ast;
        if !self.compiler_options.get_emit_standard_class_fields() {
            if !error_location.is_nil()
                && result.is_nil()
                && self.check_and_report_error_for_missing_prefix(error_location, name)
            {
                return true;
            }
            // We have a match, but the reference occurred within a property initializer and the identifier also binds to a local variable in the constructor where the code will be emitted. Note that this is actually allowed with emitStandardClassFields because the scope semantics are different.
            let prop = a.as_property_declaration(property_with_invalid_initializer);
            let message = if_else(
                !error_location.is_nil()
                    && !prop.type_node.is_nil()
                    && a.loc(prop.type_node)
                        .contains_inclusive(a.pos(error_location)),
                diagnostics::TYPE_OF_INSTANCE_MEMBER_VARIABLE_0_CANNOT_REFERENCE_IDENTIFIER_1_DECLARED_IN_THE_CONSTRUCTOR,
                diagnostics::INITIALIZER_OF_INSTANCE_MEMBER_VARIABLE_0_CANNOT_REFERENCE_IDENTIFIER_1_DECLARED_IN_THE_CONSTRUCTOR,
            );
            let property_name = declaration_name_to_string(a, prop.name);
            self.error(
                error_location,
                message,
                &[Arg::Str(&property_name), Arg::Str(name)],
            );
            return true;
        }
        false
    }

    pub fn check_and_report_error_for_missing_prefix(
        &mut self,
        error_location: NodeId,
        name: &[u8],
    ) -> bool {
        let a = self.ast;
        if !is_identifier(a, error_location)
            || a.text(error_location) != name
            || is_type_reference_identifier(a, error_location)
            || is_in_type_query(a, error_location)
        {
            return false;
        }
        let container = self.get_this_container(error_location, false, false);
        let mut location = container;
        while !a.parent(location).is_nil() {
            if is_class_like(a, a.parent(location)) {
                let class_symbol = self.get_symbol_of_declaration(a.parent(location));
                if class_symbol.is_nil() {
                    break;
                }
                // Check to see if a static member exists.
                let constructor_type = self.get_type_of_symbol(class_symbol);
                if !self.get_property_of_type(constructor_type, name).is_nil() {
                    let class_name = self.symbol_to_string(class_symbol);
                    self.error(
                        error_location,
                        diagnostics::CANNOT_FIND_NAME_0_DID_YOU_MEAN_THE_STATIC_MEMBER_1_0,
                        &[Arg::Str(name), Arg::Str(&class_name)],
                    );
                    return true;
                }
                // No static member is present. Check if we're in an instance method and look for a relevant instance member.
                if location == container && !is_static(a, location) {
                    let declared_type = self.get_declared_type_of_symbol(class_symbol);
                    let instance_type = self.as_interface_type(declared_type).this_type;
                    if !self.get_property_of_type(instance_type, name).is_nil() {
                        self.error(
                            error_location,
                            diagnostics::CANNOT_FIND_NAME_0_DID_YOU_MEAN_THE_INSTANCE_MEMBER_THIS_0,
                            &[Arg::Str(name)],
                        );
                        return true;
                    }
                }
            }
            location = a.parent(location);
        }
        false
    }

    pub fn on_failed_to_resolve_symbol(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
        name_not_found_message: MessageId,
    ) {
        let a = self.ast;
        // The `const` in a `const` assertion (`x as const`) is a syntactic marker, not a real type reference, and must never be resolved or reported as an unresolvable name.
        if is_const_type_reference_name(a, error_location) {
            return;
        }
        if !error_location.is_nil()
            && (a.kind(a.parent(error_location)) == Kind::JSDocLink
                || self.check_and_report_error_for_missing_prefix(error_location, name)
                || self.check_and_report_error_for_extending_interface(error_location)
                || self.check_and_report_error_for_using_type_as_namespace(
                    error_location,
                    name,
                    meaning,
                )
                || self.check_and_report_error_for_exporting_primitive_type(error_location, name)
                || self.check_and_report_error_for_using_namespace_as_type_or_value(
                    error_location,
                    name,
                    meaning,
                )
                || self.check_and_report_error_for_using_type_as_value(
                    error_location,
                    name,
                    meaning,
                )
                || self.check_and_report_error_for_using_value_as_type(
                    error_location,
                    name,
                    meaning,
                ))
        {
            return;
        }
        let mut declaration_name = Cow::Borrowed(name);
        if !error_location.is_nil()
            && is_identifier(a, error_location)
            && a.text(error_location) == name
        {
            // use escape sequences from original file
            declaration_name = Cow::Owned(declaration_name_to_string(a, error_location));
        }
        // Report missing lib first
        let suggested_lib = self.get_suggested_lib_for_non_existent_name(name);
        if !suggested_lib.is_empty() {
            self.error(
                error_location,
                name_not_found_message,
                &[Arg::Str(&declaration_name), Arg::Str(suggested_lib)],
            );
            return;
        }
        // Then spelling suggestions
        let suggestion =
            self.get_suggested_symbol_for_nonexistent_symbol(error_location, name, meaning);
        let suggestion_declaration = a.sym(suggestion).value_declaration;
        if !suggestion.is_nil()
            && !(!suggestion_declaration.is_nil()
                && is_ambient_module(a, suggestion_declaration)
                && is_global_scope_augmentation(a, suggestion_declaration))
        {
            let suggestion_name = self.symbol_to_string(suggestion);
            let is_unchecked_js =
                self.is_unchecked_js_suggestion(error_location, suggestion, false);
            let message = if_else(
                meaning == SymbolFlags::NAMESPACE,
                diagnostics::CANNOT_FIND_NAMESPACE_0_DID_YOU_MEAN_1,
                if_else(
                    is_unchecked_js,
                    diagnostics::COULD_NOT_FIND_NAME_0_DID_YOU_MEAN_1,
                    diagnostics::CANNOT_FIND_NAME_0_DID_YOU_MEAN_1,
                ),
            );
            let diagnostic = self.new_diagnostic_for_node(
                error_location,
                message,
                &[Arg::Str(&declaration_name), Arg::Str(&suggestion_name)],
            );
            let value_declaration = a.sym(suggestion).value_declaration;
            if !value_declaration.is_nil() {
                let related = self.new_diagnostic_for_node(
                    value_declaration,
                    diagnostics::X_0_IS_DECLARED_HERE,
                    &[Arg::Str(&suggestion_name)],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
            }
            self.add_error_or_suggestion(!is_unchecked_js, diagnostic);
            return;
        }
        // And then fall back to unspecified "not found"
        self.error(
            error_location,
            name_not_found_message,
            &[Arg::Str(&declaration_name)],
        );
    }

    pub fn check_and_report_error_for_using_type_as_namespace(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        if meaning == SymbolFlags::NAMESPACE {
            let resolved = self.resolve_name(
                error_location,
                name,
                SymbolFlags::TYPE.without(SymbolFlags::NAMESPACE),
                MessageId::NIL,
                false,
                false,
            );
            let symbol = self.resolve_symbol(resolved);
            if !symbol.is_nil() {
                let parent = a.parent(error_location);
                if is_qualified_name(a, parent) {
                    self.assert(
                        a.as_qualified_name(parent).left == error_location,
                        "Should only be resolving left side of qualified name as a namespace",
                    );
                    let prop_name = a.text(a.as_qualified_name(parent).right);
                    let declared_type = self.get_declared_type_of_symbol(symbol);
                    let prop_type = self.get_property_of_type(declared_type, prop_name);
                    if !prop_type.is_nil() {
                        self.error(
                            parent,
                            diagnostics::CANNOT_ACCESS_0_1_BECAUSE_0_IS_A_TYPE_BUT_NOT_A_NAMESPACE_DID_YOU_MEAN_TO_RETRIEVE_THE_TYPE_OF_THE_PROPERTY_1_IN_0_WITH_0_1,
                            &[Arg::Str(name), Arg::Str(prop_name)],
                        );
                        return true;
                    }
                }
                self.error(
                    error_location,
                    diagnostics::X_0_ONLY_REFERS_TO_A_TYPE_BUT_IS_BEING_USED_AS_A_NAMESPACE_HERE,
                    &[Arg::Str(name)],
                );
                return true;
            }
        }
        false
    }

    pub fn check_and_report_error_for_exporting_primitive_type(
        &mut self,
        error_location: NodeId,
        name: &[u8],
    ) -> bool {
        let a = self.ast;
        if is_primitive_type_name(name) && a.kind(a.parent(error_location)) == Kind::ExportSpecifier
        {
            self.error(
                error_location,
                diagnostics::CANNOT_EXPORT_0_ONLY_LOCAL_DECLARATIONS_CAN_BE_EXPORTED_FROM_A_MODULE,
                &[Arg::Str(name)],
            );
            return true;
        }
        false
    }
}

pub fn is_primitive_type_name(s: &[u8]) -> bool {
    s == b"any"
        || s == b"string"
        || s == b"number"
        || s == b"boolean"
        || s == b"never"
        || s == b"unknown"
}

impl<'a> Checker<'a> {
    pub fn check_and_report_error_for_using_namespace_as_type_or_value(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        if meaning.intersects(SymbolFlags::VALUE.without(SymbolFlags::TYPE)) {
            let resolved = self.resolve_name(
                error_location,
                name,
                SymbolFlags::NAMESPACE_MODULE,
                MessageId::NIL,
                false,
                false,
            );
            let symbol = self.resolve_symbol(resolved);
            if !symbol.is_nil() {
                // `export = ns` may legitimately reference a namespace; checkExportAssignment decides whether that is an error, so don't report "cannot use namespace as a value" here.
                if !is_export_assignment_expression_name(a, error_location) {
                    self.error(
                        error_location,
                        diagnostics::CANNOT_USE_NAMESPACE_0_AS_A_VALUE,
                        &[Arg::Str(name)],
                    );
                }
                return true;
            }
        } else if meaning.intersects(SymbolFlags::TYPE.without(SymbolFlags::VALUE)) {
            let resolved = self.resolve_name(
                error_location,
                name,
                SymbolFlags::MODULE,
                MessageId::NIL,
                false,
                false,
            );
            let symbol = self.resolve_symbol(resolved);
            if !symbol.is_nil() {
                self.error(
                    error_location,
                    diagnostics::CANNOT_USE_NAMESPACE_0_AS_A_TYPE,
                    &[Arg::Str(name)],
                );
                return true;
            }
        }
        false
    }

    pub fn check_and_report_error_for_using_type_as_value(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        if meaning.intersects(SymbolFlags::VALUE) {
            if is_primitive_type_name(name) {
                let grandparent = a.parent(a.parent(error_location));
                if !grandparent.is_nil()
                    && !a.parent(grandparent).is_nil()
                    && is_heritage_clause(a, grandparent)
                {
                    let heritage_kind = a.as_heritage_clause(grandparent).token;
                    let container_kind = a.kind(a.parent(grandparent));
                    if container_kind == Kind::InterfaceDeclaration
                        && heritage_kind == Kind::ExtendsKeyword
                    {
                        self.error(
                            error_location,
                            diagnostics::AN_INTERFACE_CANNOT_EXTEND_A_PRIMITIVE_TYPE_LIKE_0_IT_CAN_ONLY_EXTEND_OTHER_NAMED_OBJECT_TYPES,
                            &[Arg::Str(name)],
                        );
                    } else if is_class_like(a, a.parent(grandparent))
                        && heritage_kind == Kind::ExtendsKeyword
                    {
                        self.error(
                            error_location,
                            diagnostics::A_CLASS_CANNOT_EXTEND_A_PRIMITIVE_TYPE_LIKE_0_CLASSES_CAN_ONLY_EXTEND_CONSTRUCTABLE_VALUES,
                            &[Arg::Str(name)],
                        );
                    } else if is_class_like(a, a.parent(grandparent))
                        && heritage_kind == Kind::ImplementsKeyword
                    {
                        self.error(
                            error_location,
                            diagnostics::A_CLASS_CANNOT_IMPLEMENT_A_PRIMITIVE_TYPE_LIKE_0_IT_CAN_ONLY_IMPLEMENT_OTHER_NAMED_OBJECT_TYPES,
                            &[Arg::Str(name)],
                        );
                    }
                } else {
                    self.error(
                        error_location,
                        diagnostics::X_0_ONLY_REFERS_TO_A_TYPE_BUT_IS_BEING_USED_AS_A_VALUE_HERE,
                        &[Arg::Str(name)],
                    );
                }
                return true;
            }
            let resolved = self.resolve_name(
                error_location,
                name,
                SymbolFlags::TYPE.without(SymbolFlags::VALUE),
                MessageId::NIL,
                false,
                false,
            );
            let symbol = self.resolve_symbol(resolved);
            if !symbol.is_nil() {
                let all_flags = self.get_symbol_flags(symbol);
                if !all_flags.intersects(SymbolFlags::VALUE) {
                    // `export = SomeType` may legitimately reference a type-only name; checkExportAssignment decides whether that is an error, so don't report "used as a value" here.
                    if is_export_assignment_expression_name(a, error_location) {
                        return true;
                    }
                    if is_es2015_or_later_constructor_name(name) {
                        self.error(
                            error_location,
                            diagnostics::X_0_ONLY_REFERS_TO_A_TYPE_BUT_IS_BEING_USED_AS_A_VALUE_HERE_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_ES2015_OR_LATER,
                            &[Arg::Str(name)],
                        );
                    } else if self.maybe_mapped_type(error_location, symbol) {
                        self.error(
                            error_location,
                            diagnostics::X_0_ONLY_REFERS_TO_A_TYPE_BUT_IS_BEING_USED_AS_A_VALUE_HERE_DID_YOU_MEAN_TO_USE_1_IN_0,
                            &[
                                Arg::Str(name),
                                Arg::Str(if_else(name == b"K", b"P".as_slice(), b"K".as_slice())),
                            ],
                        );
                    } else {
                        self.error(
                            error_location,
                            diagnostics::X_0_ONLY_REFERS_TO_A_TYPE_BUT_IS_BEING_USED_AS_A_VALUE_HERE,
                            &[Arg::Str(name)],
                        );
                    }
                    return true;
                }
            }
        }
        false
    }
}

pub fn is_es2015_or_later_constructor_name(s: &[u8]) -> bool {
    s == b"Promise"
        || s == b"Symbol"
        || s == b"Map"
        || s == b"WeakMap"
        || s == b"Set"
        || s == b"WeakSet"
}

impl<'a> Checker<'a> {
    pub fn maybe_mapped_type(&mut self, node: NodeId, symbol: SymbolId) -> bool {
        let a = self.ast;
        let mut node = node;
        loop {
            node = a.parent(node);
            if !(is_computed_property_name(a, node) || is_property_signature_declaration(a, node)) {
                break;
            }
        }
        if is_type_literal_node(a, node) && a.members(node).len() == 1 {
            let t = self.get_declared_type_of_symbol(symbol);
            return self.types[t].flags.intersects(TypeFlags::UNION)
                && self.all_types_assignable_to_kind_ex(
                    t,
                    TypeFlags::STRING_OR_NUMBER_LITERAL,
                    true,
                );
        }
        false
    }

    pub fn check_and_report_error_for_using_value_as_type(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        if meaning.intersects(SymbolFlags::TYPE.without(SymbolFlags::NAMESPACE)) {
            let resolved = self.resolve_name(
                error_location,
                name,
                !SymbolFlags::TYPE & SymbolFlags::VALUE,
                MessageId::NIL,
                false,
                false,
            );
            let symbol = self.resolve_symbol(resolved);
            if !symbol.is_nil() && !a.sym(symbol).flags.intersects(SymbolFlags::NAMESPACE) {
                self.error(
                    error_location,
                    diagnostics::X_0_REFERS_TO_A_VALUE_BUT_IS_BEING_USED_AS_A_TYPE_HERE_DID_YOU_MEAN_TYPEOF_0,
                    &[Arg::Str(name)],
                );
                return true;
            }
        }
        false
    }

    pub fn get_suggested_lib_for_non_existent_name(&self, name: &[u8]) -> &'static [u8] {
        let feature_map = get_feature_map();
        if let Some(type_features) = feature_map.get(name) {
            return match type_features.first() {
                Some(feature) => feature.lib,
                None => b"",
            };
        }
        b""
    }

    pub fn get_suggested_symbol_for_nonexistent_symbol(
        &mut self,
        location: NodeId,
        outer_name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        self.resolve_name_for_symbol_suggestion(
            location,
            outer_name,
            meaning,
            MessageId::NIL,
            false,
            false,
        )
    }
}

// primitiveTypeAliasSuggestions of upstream: the name of each primitive type with the name of the global type that offers it, in upstream's order of writing.
const PRIMITIVE_TYPE_ALIAS_SUGGESTIONS: [(&[u8], &[u8]); 6] = [
    (b"string", b"String"),
    (b"number", b"Number"),
    (b"boolean", b"Boolean"),
    (b"object", b"Object"),
    (b"bigint", b"BigInt"),
    (b"symbol", b"Symbol"),
];

// Upstream keeps the six symbols in a map of the process. A symbol lives in the store of one checker here, so a request makes the symbols that it answers, in the order of the table where the order of a Go map is random.
pub fn get_primitive_type_alias_suggestions(a: Ast<'_>, symbols: SymbolTableId) -> Vec<SymbolId> {
    let mut result: Vec<SymbolId> = Vec::new();
    for (primitive, builtin) in PRIMITIVE_TYPE_ALIAS_SUGGESTIONS {
        if !a.table_get(symbols, builtin).is_nil() {
            result.push(a.new_symbol(SymbolFlags::TYPE_ALIAS | SymbolFlags::TRANSIENT, primitive));
        }
    }
    result
}

impl<'a> Checker<'a> {
    pub fn get_suggestion_for_symbol_name_lookup(
        &mut self,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        let a = self.ast;
        let symbol = self.get_symbol(symbols, name, meaning);
        if !symbol.is_nil() {
            return symbol;
        }
        let extras = if meaning.intersects(SymbolFlags::GLOBAL_LOOKUP) {
            Some(get_primitive_type_alias_suggestions(a, symbols))
        } else {
            None
        };
        // `maps.Values(symbols)`: the symbols of the table in its own order.
        let mut values: Vec<SymbolId> = Vec::new();
        let mut position = 0;
        while let Some((_, value)) = a.table_entry_at(symbols, position) {
            position += 1;
            values.push(value);
        }
        let candidates: Vec<SymbolId> = concatenate_seq([Some(values), extras]).collect();
        self.get_spelling_suggestion_for_name(name, &candidates, meaning)
    }

    // Given a name and a list of symbols whose names are *not* equal to the name, return a spelling suggestion if there is one that is close enough. Names less than length 3 only check for case-insensitive equality, not levenshtein distance. If there is a candidate that's the same except for case, return that. If there is a candidate that's within one edit of the name, return that. Otherwise, return the candidate with the smallest Levenshtein distance, except for candidates: with no name; whose meaning doesn't match the `meaning` parameter; whose length differs from the target name by more than 0.34 of the length of the name; whose levenshtein distance is more than 0.4 of the length of the name (0.4 allows 1 substitution/transposition for every 5 characters, and 1 insertion/deletion at 3 characters)
    pub fn get_spelling_suggestion_for_name(
        &mut self,
        name: &[u8],
        symbols: &[SymbolId],
        meaning: SymbolFlags,
    ) -> SymbolId {
        let a = self.ast;
        // The two callbacks of upstream close over the checker: each takes it for the time of its call, in upstream's order of calls. A callback that finds it taken records a fault.
        const BUSY: &str = "getSpellingSuggestionForName";
        let this = RefCell::new(self);
        let get_candidate_name = |candidate: SymbolId| -> &'a [u8] {
            let candidate_name = symbol_name(a, candidate);
            if candidate_name.is_empty()
                || candidate_name.first() == Some(&b'"')
                || candidate_name.first() == Some(&b'\xFE')
            {
                return b"";
            }
            if a.sym(candidate).flags.intersects(meaning) {
                return candidate_name;
            }
            if a.sym(candidate).flags.intersects(SymbolFlags::ALIAS) {
                let alias = match this.try_borrow_mut() {
                    Ok(mut c) => c.try_resolve_alias(candidate),
                    Err(_) => {
                        a.fault(FaultKind::StoreBusy, BUSY, 0, candidate.0);
                        SymbolId::NIL
                    }
                };
                if !alias.is_nil() && a.sym(alias).flags.intersects(meaning) {
                    return candidate_name;
                }
            }
            b""
        };
        get_spelling_suggestion_exported(
            name,
            symbols.iter().copied(),
            get_candidate_name,
            |s1, s2| match this.try_borrow() {
                Ok(c) => c.compare_symbols(s1, s2),
                Err(_) => {
                    a.fault(FaultKind::StoreBusy, BUSY, 0, s1.0);
                    0
                }
            },
        )
    }

    pub fn on_successfully_resolved_symbol(
        &mut self,
        error_location: NodeId,
        result: SymbolId,
        meaning: SymbolFlags,
        last_location: NodeId,
        associated_declaration_for_containing_initializer_or_binding_name: NodeId,
        within_deferred_context: bool,
    ) {
        let a = self.ast;
        let name = a.sym(result).name;
        let is_in_external_module = !last_location.is_nil()
            && is_source_file(a, last_location)
            && is_external_or_common_js_module(a, last_location);
        // Only check for block-scoped variable if we have an error location and are looking for the name with variable meaning. For example, in `declare module foo { interface bar {} } const foo/*1*/: foo/*2*/.bar;` the foo at /*1*/ and /*2*/ will share same symbol with two meanings: block-scoped variable and namespace module. However, only when we try to resolve name in /*1*/ which is used in variable position, we want to check for block-scoped
        if !error_location.is_nil()
            && (meaning.intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
                || (meaning.intersects(SymbolFlags::CLASS | SymbolFlags::ENUM)
                    && meaning.contains(SymbolFlags::VALUE)))
        {
            let export_or_local_symbol = self.get_export_symbol_of_value_symbol_if_exported(result);
            if a.sym(export_or_local_symbol).flags.intersects(
                SymbolFlags::BLOCK_SCOPED_VARIABLE | SymbolFlags::CLASS | SymbolFlags::ENUM,
            ) {
                self.check_resolved_block_scoped_variable(export_or_local_symbol, error_location);
            }
        }
        // If we're in an external module, we can't reference value symbols created from UMD export declarations
        if is_in_external_module
            && meaning.contains(SymbolFlags::VALUE)
            && !a.flags(error_location).intersects(NodeFlags::JSDOC)
        {
            let merged = self.get_merged_symbol(result);
            let declarations = a.sym(merged).declarations;
            if declarations.len() != 0
                && every(declarations.as_slice(), |d| {
                    is_namespace_export_declaration(a, d)
                        || (is_source_file(a, d) && !a.as_source_file(d).global_exports.is_nil())
                })
            {
                let is_error = self.compiler_options.allow_umd_global_access != Tristate::TRUE;
                self.error_or_suggestion(
                    is_error,
                    error_location,
                    diagnostics::X_0_REFERS_TO_A_UMD_GLOBAL_BUT_THE_CURRENT_FILE_IS_A_MODULE_CONSIDER_ADDING_AN_IMPORT_INSTEAD,
                    &[Arg::Str(name)],
                );
            }
        }
        // If we're in a parameter initializer or binding name, we can't reference the values of the parameter whose initializer we're within or parameters to the right
        if !associated_declaration_for_containing_initializer_or_binding_name.is_nil()
            && !within_deferred_context
            && meaning.contains(SymbolFlags::VALUE)
        {
            let late_bound = self.get_late_bound_symbol(result);
            let candidate = self.get_merged_symbol(late_bound);
            let root = get_root_declaration(
                a,
                associated_declaration_for_containing_initializer_or_binding_name,
            );
            // A parameter initializer or binding pattern initializer within a parameter cannot refer to itself
            if candidate
                == self.get_symbol_of_declaration(
                    associated_declaration_for_containing_initializer_or_binding_name,
                )
            {
                let parameter_name = declaration_name_to_string(
                    a,
                    a.name(associated_declaration_for_containing_initializer_or_binding_name),
                );
                self.error(
                    error_location,
                    diagnostics::PARAMETER_0_CANNOT_REFERENCE_ITSELF,
                    &[Arg::Str(&parameter_name)],
                );
            } else if !a.sym(candidate).value_declaration.is_nil()
                && a.pos(a.sym(candidate).value_declaration)
                    > a.pos(associated_declaration_for_containing_initializer_or_binding_name)
                && !a.locals(a.parent(root)).is_nil()
                && self.get_symbol(a.locals(a.parent(root)), a.sym(candidate).name, meaning)
                    == candidate
            {
                let parameter_name = declaration_name_to_string(
                    a,
                    a.name(associated_declaration_for_containing_initializer_or_binding_name),
                );
                let identifier_name = declaration_name_to_string(a, error_location);
                self.error(
                    error_location,
                    diagnostics::PARAMETER_0_CANNOT_REFERENCE_IDENTIFIER_1_DECLARED_AFTER_IT,
                    &[Arg::Str(&parameter_name), Arg::Str(&identifier_name)],
                );
            }
        }
        if !error_location.is_nil()
            && meaning.intersects(SymbolFlags::VALUE)
            && a.sym(result).flags.intersects(SymbolFlags::ALIAS)
            && !a.sym(result).flags.intersects(SymbolFlags::VALUE)
            && !is_valid_type_only_alias_use_site(a, error_location)
        {
            let type_only_declaration =
                self.get_type_only_alias_declaration_ex(result, SymbolFlags::VALUE);
            if !type_only_declaration.is_nil() {
                let message = if_else(
                    node_kind_is(
                        a,
                        type_only_declaration,
                        &[
                            Kind::ExportSpecifier,
                            Kind::ExportDeclaration,
                            Kind::NamespaceExport,
                        ],
                    ),
                    diagnostics::X_0_CANNOT_BE_USED_AS_A_VALUE_BECAUSE_IT_WAS_EXPORTED_USING_EXPORT_TYPE,
                    diagnostics::X_0_CANNOT_BE_USED_AS_A_VALUE_BECAUSE_IT_WAS_IMPORTED_USING_IMPORT_TYPE,
                );
                let diagnostic = self.error(error_location, message, &[Arg::Str(name)]);
                self.add_type_only_declaration_related_info(
                    diagnostic,
                    type_only_declaration,
                    name,
                );
            }
        }
        // Look at 'compilerOptions.isolatedModules' and not 'getIsolatedModules(...)' (which considers 'verbatimModuleSyntax') here because 'verbatimModuleSyntax' will already have an error for importing a type without 'import type'.
        if self.compiler_options.isolated_modules == Tristate::TRUE
            && !result.is_nil()
            && is_in_external_module
            && meaning.contains(SymbolFlags::VALUE)
        {
            let globals = self.globals;
            let is_global = self.get_symbol(globals, name, meaning) == result;
            let mut non_value_symbol = SymbolId::NIL;
            if is_global && is_source_file(a, last_location) {
                non_value_symbol =
                    self.get_symbol(a.locals(last_location), name, !SymbolFlags::VALUE);
            }
            if !non_value_symbol.is_nil() {
                let import_decl = find(a.sym(non_value_symbol).declarations.as_slice(), |d| {
                    node_kind_is(
                        a,
                        d,
                        &[
                            Kind::ImportSpecifier,
                            Kind::ImportClause,
                            Kind::NamespaceImport,
                            Kind::ImportEqualsDeclaration,
                        ],
                    )
                });
                if !import_decl.is_nil() && !is_type_only_import_declaration(a, import_decl) {
                    self.error(
                        import_decl,
                        diagnostics::IMPORT_0_CONFLICTS_WITH_GLOBAL_VALUE_USED_IN_THIS_FILE_SO_MUST_BE_DECLARED_WITH_A_TYPE_ONLY_IMPORT_WHEN_ISOLATEDMODULES_IS_ENABLED,
                        &[Arg::Str(name)],
                    );
                }
            }
        }
    }

    pub fn check_resolved_block_scoped_variable(
        &mut self,
        result: SymbolId,
        error_location: NodeId,
    ) {
        let a = self.ast;
        self.assert(
            a.sym(result).flags.intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
                || a.sym(result).flags.intersects(SymbolFlags::CLASS)
                || a.sym(result).flags.intersects(SymbolFlags::ENUM),
            "result.Flags&ast.SymbolFlagsBlockScopedVariable != 0 || result.Flags&ast.SymbolFlagsClass != 0 || result.Flags&ast.SymbolFlagsEnum != 0",
        );
        if a.sym(result).flags.intersects(
            SymbolFlags::FUNCTION | SymbolFlags::FUNCTION_SCOPED_VARIABLE | SymbolFlags::ASSIGNMENT,
        ) && a.sym(result).flags.intersects(SymbolFlags::CLASS)
        {
            // constructor functions aren't block scoped
            return;
        }
        // Block-scoped variables cannot be used before their definition
        let declaration = find(a.sym(result).declarations.as_slice(), |d| {
            is_block_or_catch_scoped(a, d) || is_class_like(a, d) || is_enum_declaration(a, d)
        });
        if declaration.is_nil() {
            let _: () = self
                .fail("checkResolvedBlockScopedVariable could not find block-scoped declaration");
            return;
        }
        if !a.flags(declaration).intersects(NodeFlags::AMBIENT)
            && !self.is_block_scoped_name_declared_before_use(declaration, error_location)
        {
            let mut diagnostic = DiagnosticId::NIL;
            let declaration_name =
                declaration_name_to_string(a, get_name_of_declaration(a, declaration));
            if a.sym(result)
                .flags
                .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
            {
                diagnostic = self.error(
                    error_location,
                    diagnostics::BLOCK_SCOPED_VARIABLE_0_USED_BEFORE_ITS_DECLARATION,
                    &[Arg::Str(&declaration_name)],
                );
            } else if a.sym(result).flags.intersects(SymbolFlags::CLASS) {
                diagnostic = self.error(
                    error_location,
                    diagnostics::CLASS_0_USED_BEFORE_ITS_DECLARATION,
                    &[Arg::Str(&declaration_name)],
                );
            } else if a.sym(result).flags.intersects(SymbolFlags::REGULAR_ENUM) {
                diagnostic = self.error(
                    error_location,
                    diagnostics::ENUM_0_USED_BEFORE_ITS_DECLARATION,
                    &[Arg::Str(&declaration_name)],
                );
            } else {
                self.assert(
                    a.sym(result).flags.intersects(SymbolFlags::CONST_ENUM),
                    "result.Flags&ast.SymbolFlagsConstEnum != 0",
                );
                if self.compiler_options.get_isolated_modules() {
                    diagnostic = self.error(
                        error_location,
                        diagnostics::ENUM_0_USED_BEFORE_ITS_DECLARATION,
                        &[Arg::Str(&declaration_name)],
                    );
                }
            }
            if !diagnostic.is_nil() {
                let related = self.create_diagnostic_for_node(
                    declaration,
                    diagnostics::X_0_IS_DECLARED_HERE,
                    &[Arg::Str(&declaration_name)],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
            }
        }
    }

    pub fn is_block_scoped_name_declared_before_use(
        &mut self,
        declaration: NodeId,
        usage: NodeId,
    ) -> bool {
        let a = self.ast;
        let declaration_file = get_source_file_of_node(a, declaration);
        let use_file = get_source_file_of_node(a, usage);
        let decl_container = get_enclosing_block_scope_container(a, declaration);
        if declaration_file != use_file {
            // nodes are in different files and order cannot be determined
            return true;
        }
        // deferred usage in a type context is always OK regardless of the usage position:
        if a.flags(usage).intersects(NodeFlags::JSDOC)
            || is_in_type_query(a, usage)
            || self.is_in_ambient_or_type_node(usage)
        {
            return true;
        }
        if a.pos(declaration) <= a.pos(usage)
            && !(is_property_declaration(a, declaration)
                && is_this_property(a, a.parent(usage))
                && a.initializer(declaration).is_nil()
                && !is_exclamation_token(a, a.postfix_token(declaration)))
        {
            // declaration is before usage
            if a.kind(declaration) == Kind::BindingElement {
                // still might be illegal if declaration and usage are both binding elements (eg var [a = b, b = b] = [1, 2])
                let error_binding_element = find_ancestor_kind(a, usage, Kind::BindingElement);
                if !error_binding_element.is_nil() {
                    return find_ancestor(a, error_binding_element, |n| is_binding_element(a, n))
                        != find_ancestor(a, declaration, |n| is_binding_element(a, n))
                        || a.pos(declaration) < a.pos(error_binding_element);
                }
                // or it might be illegal if usage happens before parent variable is declared (eg var [a] = a)
                return self.is_block_scoped_name_declared_before_use(
                    find_ancestor_kind(a, declaration, Kind::VariableDeclaration),
                    usage,
                );
            } else if a.kind(declaration) == Kind::VariableDeclaration {
                // still might be illegal if usage is in the initializer of the variable declaration (eg var a = a)
                return !is_immediately_used_in_initializer_of_block_scoped_variable(
                    a,
                    declaration,
                    usage,
                    decl_container,
                );
            } else if is_class_like(a, declaration) {
                // still might be illegal if the usage is within a computed property name in the class (eg class A { static p = "a"; [A.p]() {} }) or when used within a decorator in the class (e.g. `@dec(A.x) class A { static x = "x" }`), except when used in a function that is not an IIFE (e.g., `@dec(() => A.x) class A { ... }`)
                let mut container = usage;
                while !container.is_nil() && container != declaration {
                    if (is_computed_property_name(a, container)
                        && a.parent(a.parent(container)) == declaration)
                        || (!self.legacy_decorators
                            && is_decorator(a, container)
                            && (a.parent(container) == declaration
                                || (is_method_declaration(a, a.parent(container))
                                    && a.parent(a.parent(container)) == declaration)
                                || (is_accessor(a, a.parent(container))
                                    && a.parent(a.parent(container)) == declaration)
                                || (is_property_declaration(a, a.parent(container))
                                    && a.parent(a.parent(container)) == declaration)
                                || (is_parameter_declaration(a, a.parent(container))
                                    && a.parent(a.parent(a.parent(container))) == declaration)))
                    {
                        break;
                    }
                    container = a.parent(container);
                }
                if container.is_nil() || container == declaration {
                    return true;
                }
                if !self.legacy_decorators && is_decorator(a, container) {
                    let mut n = usage;
                    while !n.is_nil() && n != container {
                        if is_function_like(a, n)
                            && get_immediately_invoked_function_expression(a, n).is_nil()
                        {
                            break;
                        }
                        n = a.parent(n);
                    }
                    return !n.is_nil() && n != container;
                }
                return false;
            } else if is_property_declaration(a, declaration) {
                // still might be illegal if a self-referencing property initializer (eg private x = this.x)
                return !is_property_immediately_referenced_within_declaration(
                    a,
                    declaration,
                    usage,
                    false,
                );
            } else if is_parameter_property_declaration(a, declaration, a.parent(declaration)) {
                // foo = this.bar is illegal in emitStandardClassFields when bar is a parameter property
                return !(self.emit_standard_class_fields
                    && get_containing_class(a, declaration) == get_containing_class(a, usage)
                    && self.is_used_in_function_or_instance_property(
                        usage,
                        declaration,
                        decl_container,
                    ));
            }
            return true;
        }
        // declaration is after usage, but it can still be legal if usage is deferred: 1. inside an export specifier 2. inside a function 3. inside an instance property initializer, a reference to a non-instance property (except when emitStandardClassFields: true and the reference is to a parameter property) 4. inside a static property initializer, a reference to a static method in the same class 5. inside a TS export= declaration (since we will move the export statement during emit to avoid TDZ)
        if is_export_specifier(a, a.parent(usage))
            || (is_export_assignment(a, a.parent(usage))
                && a.as_export_assignment(a.parent(usage)).is_export_equals)
        {
            // export specifiers do not use the variable, they only make it available for use
            return true;
        }
        // When resolving symbols for exports, the `usage` location passed in can be the export site directly
        if is_export_assignment(a, usage) && a.as_export_assignment(usage).is_export_equals {
            return true;
        }
        if self.is_used_in_function_or_instance_property(usage, declaration, decl_container) {
            if self.emit_standard_class_fields
                && !get_containing_class(a, declaration).is_nil()
                && (is_property_declaration(a, declaration)
                    || is_parameter_property_declaration(a, declaration, a.parent(declaration)))
            {
                return !is_property_immediately_referenced_within_declaration(
                    a,
                    declaration,
                    usage,
                    true,
                );
            }
            return true;
        }
        false
    }

    pub fn is_used_in_function_or_instance_property(
        &mut self,
        usage: NodeId,
        declaration: NodeId,
        decl_container: NodeId,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        !find_ancestor_or_quit(a, usage, |current| {
            if current == decl_container {
                return FindAncestorResult::QUIT;
            }
            if is_function_like(a, current) {
                return to_find_ancestor_result(
                    get_immediately_invoked_function_expression(a, current).is_nil(),
                );
            }
            if is_class_static_block_declaration(a, current) {
                return to_find_ancestor_result(a.pos(declaration) < a.pos(usage));
            }

            if !a.parent(current).is_nil() && is_property_declaration(a, a.parent(current)) {
                let property_declaration = a.parent(current);
                let initializer_of_property = a.initializer(property_declaration) == current;
                if initializer_of_property {
                    if is_static(a, a.parent(current)) {
                        if is_method_declaration(a, declaration) {
                            return FindAncestorResult::TRUE;
                        }
                        if is_property_declaration(a, declaration)
                            && get_containing_class(a, usage)
                                == get_containing_class(a, declaration)
                        {
                            let prop_name = a.name(declaration);
                            if is_identifier(a, prop_name) || is_private_identifier(a, prop_name) {
                                let symbol = self.get_symbol_of_declaration(declaration);
                                let t = self.get_type_of_symbol(symbol);
                                let static_blocks =
                                    filter(a.members(a.parent(declaration)).as_slice(), |member| {
                                        is_class_static_block_declaration(a, member)
                                    });
                                if self.is_property_initialized_in_static_blocks(
                                    prop_name,
                                    t,
                                    &static_blocks,
                                    a.pos(a.parent(declaration)),
                                    a.pos(current),
                                ) {
                                    return FindAncestorResult::TRUE;
                                }
                            }
                        }
                    } else {
                        let is_declaration_instance_property =
                            is_property_declaration(a, declaration) && !is_static(a, declaration);
                        if !is_declaration_instance_property
                            || get_containing_class(a, usage)
                                != get_containing_class(a, declaration)
                        {
                            return FindAncestorResult::TRUE;
                        }
                    }
                }
            }

            if !a.parent(current).is_nil() && is_decorator(a, a.parent(current)) {
                let decorator = a.parent(current);
                if a.as_decorator(decorator).expression == current {
                    if is_parameter_declaration(a, a.parent(decorator)) {
                        if self.is_used_in_function_or_instance_property(
                            a.parent(a.parent(a.parent(decorator))),
                            declaration,
                            decl_container,
                        ) {
                            return FindAncestorResult::TRUE;
                        }
                        return FindAncestorResult::QUIT;
                    }
                    if is_method_declaration(a, a.parent(decorator)) {
                        if self.is_used_in_function_or_instance_property(
                            a.parent(a.parent(decorator)),
                            declaration,
                            decl_container,
                        ) {
                            return FindAncestorResult::TRUE;
                        }
                        return FindAncestorResult::QUIT;
                    }
                }
            }

            FindAncestorResult::FALSE
        })
        .is_nil()
    }
}

pub fn is_immediately_used_in_initializer_of_block_scoped_variable(
    a: Ast<'_>,
    declaration: NodeId,
    usage: NodeId,
    decl_container: NodeId,
) -> bool {
    match a.kind(a.parent(a.parent(declaration))) {
        Kind::VariableStatement | Kind::ForStatement | Kind::ForOfStatement => {
            // variable statement/for/for-of statement case, use site should not be inside variable declaration (initializer of declaration or binding element)
            if is_same_scope_descendent_of(a, usage, declaration, decl_container) {
                return true;
            }
        }
        _ => {}
    }
    // ForIn/ForOf case - use site should not be used in expression part
    let grandparent = a.parent(a.parent(declaration));
    is_for_in_or_of_statement(a, grandparent)
        && is_same_scope_descendent_of(a, usage, a.expression(grandparent), decl_container)
}

// Starting from 'initial' node walk up the parent chain until 'stopAt' node is reached. If at any point current node is equal to 'parent' node - return true. If current node is an IIFE, continue walking up. Return false if 'stopAt' node is reached or isFunctionLike(current) === true.
pub fn is_same_scope_descendent_of(
    a: Ast<'_>,
    initial: NodeId,
    parent: NodeId,
    stop_at: NodeId,
) -> bool {
    if parent.is_nil() {
        return false;
    }
    let mut n = initial;
    while !n.is_nil() {
        if n == parent {
            return true;
        }
        if n == stop_at
            || (is_function_like(a, n)
                && (get_immediately_invoked_function_expression(a, n).is_nil()
                    || get_function_flags(a, n).intersects(FunctionFlags::ASYNC_GENERATOR)))
        {
            return false;
        }
        n = a.parent(n);
    }
    false
}

// isPropertyImmediatelyReferencedWithinDeclaration is used for detecting ES-standard class field use-before-def errors
pub fn is_property_immediately_referenced_within_declaration(
    a: Ast<'_>,
    declaration: NodeId,
    usage: NodeId,
    stop_at_any_property_declaration: bool,
) -> bool {
    // always legal if usage is after declaration
    if a.end(usage) > a.end(declaration) {
        return false;
    }
    // still might be legal if usage is deferred (e.g. x: any = () => this.x), otherwise illegal if immediately referenced within the declaration (e.g. x: any = this.x)
    let mut node = usage;
    while !node.is_nil() && node != declaration {
        match a.kind(node) {
            Kind::ArrowFunction => return false,
            Kind::PropertyDeclaration => {
                // even when stopping at any property declaration, they need to come from the same class
                return stop_at_any_property_declaration
                    && ((is_property_declaration(a, declaration)
                        && a.parent(node) == a.parent(declaration))
                        || (is_parameter_property_declaration(
                            a,
                            declaration,
                            a.parent(declaration),
                        ) && a.parent(node) == a.parent(a.parent(declaration))));
            }
            Kind::Block => match a.kind(a.parent(node)) {
                Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => return false,
                _ => {}
            },
            _ => {}
        }
        node = a.parent(node);
    }
    true
}

impl<'a> Checker<'a> {
    // Return the type-only declaration node (if any) for the given alias symbol (non-transitively)
    pub fn get_type_only_alias_declaration(&mut self, symbol: SymbolId) -> NodeId {
        if self.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            self.resolve_alias(symbol);
            let links = self.alias_symbol_links.get(symbol);
            return self.alias_symbol_links[links].type_only_declaration;
        }
        NodeId::NIL
    }

    // Return the first type-only alias declaration node (if any) in the resolution chain that affects the symbol for the given meaning
    pub fn get_type_only_alias_declaration_ex(
        &mut self,
        symbol: SymbolId,
        meaning: SymbolFlags,
    ) -> NodeId {
        let a = self.ast;
        let mut symbol = symbol;
        // Two aliases that each have another meaning and resolve to each other keep upstream's loop alive: the guard ends it.
        let mut guard = LoopGuard::new();
        while a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
            && !a.sym(symbol).flags.intersects(meaning)
        {
            if !guard.turn() {
                self.loop_limit("getTypeOnlyAliasDeclarationEx");
                break;
            }
            let resolved = self.resolve_alias(symbol);
            let links = self.alias_symbol_links.get(symbol);
            let type_only_declaration = self.alias_symbol_links[links].type_only_declaration;
            if !type_only_declaration.is_nil() {
                return type_only_declaration;
            }
            symbol = resolved;
        }
        NodeId::NIL
    }

    pub fn get_immediate_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        self.assert(
            self.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS),
            "Should only get Alias here.",
        );
        let links = self.alias_symbol_links.get(symbol);
        if self.alias_symbol_links[links].immediate_target.is_nil() {
            let node = self.get_declaration_of_alias_symbol(symbol);
            if node.is_nil() {
                return self.fail("Unexpected nil in getImmediateAliasedSymbol");
            }
            let immediate_target = self.get_target_of_alias_declaration(node);
            self.alias_symbol_links[links].immediate_target = immediate_target;
        }
        self.alias_symbol_links[links].immediate_target
    }

    pub fn add_type_only_declaration_related_info(
        &mut self,
        diagnostic: DiagnosticId,
        type_only_declaration: NodeId,
        name: &[u8],
    ) -> DiagnosticId {
        let a = self.ast;
        if type_only_declaration.is_nil() {
            return diagnostic;
        }
        let is_export = is_export_specifier(a, type_only_declaration)
            || is_export_declaration(a, type_only_declaration)
            || is_namespace_export(a, type_only_declaration);
        let related = self.new_diagnostic_for_node(
            type_only_declaration,
            if_else(
                is_export,
                diagnostics::X_0_WAS_EXPORTED_HERE,
                diagnostics::X_0_WAS_IMPORTED_HERE,
            ),
            &[Arg::Str(name)],
        );
        self.diagnostic_store.add_related_info(diagnostic, related)
    }

    pub fn get_symbol(
        &mut self,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        let a = self.ast;
        if meaning.intersects(SymbolFlags::ALL) {
            let symbol = self.get_merged_symbol(a.table_get(symbols, name));
            if !symbol.is_nil() {
                if a.sym(symbol).flags.intersects(meaning) {
                    return symbol;
                }
                if a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
                    let target_flags = self.get_symbol_flags(symbol);
                    // `targetFlags` will be `SymbolFlags.All` if an error occurred in alias resolution; this avoids cascading errors
                    if target_flags.intersects(meaning) {
                        return symbol;
                    }
                }
            }
        }
        // return nil if we can't find a symbol
        SymbolId::NIL
    }
}
