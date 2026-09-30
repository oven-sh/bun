// checker.go:28312-29040 (layers U-ALIASMARK, D-HELPERS): alias reference marking and the import helper checks, with checkClassExpressionExternalHelpers of checker.go:10171-10197.
use crate::ast::{
    Arg, Ast, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags, SymbolId, can_have_decorators,
    class_or_constructor_parameter_is_decorated, find_ancestor, find_ancestor_kind,
    find_many_ancestors, get_class_extends_heritage_element, get_declaration_container,
    get_declaration_of_kind, get_first_constructor_with_body, get_first_identifier,
    get_rest_parameter_element_type, get_source_file_of_node, has_decorators,
    has_syntactic_modifier, is_alias_symbol_declaration, is_any_export_assignment,
    is_assignment_target, is_binding_element, is_class_like, is_computed_property_name,
    is_decorator, is_effective_external_module, is_entity_name, is_entity_name_expression,
    is_enum_member, is_export_assignment, is_export_declaration, is_export_specifier,
    is_expression_node, is_for_in_or_of_statement, is_global_source_file, is_heritage_clause,
    is_identifier, is_import_equals_declaration, is_interface_declaration, is_jsx_opening_fragment,
    is_jsx_opening_like_element, is_jsx_tag_name, is_meta_property, is_named_evaluation_source,
    is_node_descendant_of, is_non_local_alias, is_part_of_type_node, is_private_identifier,
    is_property_access_expression, is_property_access_or_qualified_name, is_property_assignment,
    is_property_declaration, is_property_signature_declaration, is_shorthand_property_assignment,
    is_this_identifier, is_this_in_type_query, is_type_only_import_or_export_declaration,
    is_variable_declaration_list, node_can_be_decorated,
};
use crate::checker::{
    AssignmentKind, Checker, EXTERNAL_HELPERS_MODULE_NAME_TEXT, ExternalEmitHelpers,
    LANGUAGE_FEATURE_MINIMUM_TARGET, ReferenceHint, TypeId, get_assignment_target_kind,
    is_const_enum_or_const_enum_only_module, is_in_type_query, is_invalid_computed_property_name,
    is_jsx_intrinsic_tag_name, is_type_any, walk_up_outer_expressions,
};
use crate::core::{JsxEmit, ModuleKind};
use crate::diagnostics::{self, MessageId};

impl<'a> Checker<'a> {
    pub fn mark_linked_references(
        &mut self,
        location: NodeId,
        hint: ReferenceHint,
        prop_symbol: SymbolId,
        parent_type: TypeId,
    ) {
        let a = self.ast;
        if !self.can_collect_symbol_alias_accessibility_data {
            return;
        }
        if a.flags(location).intersects(NodeFlags::AMBIENT)
            && !is_property_signature_declaration(a, location)
            && !is_property_declaration(a, location)
        {
            // References within types and declaration files are never going to contribute to retaining a JS import, except for properties (which can be decorated).
            return;
        }
        match hint {
            ReferenceHint::IDENTIFIER => self.mark_identifier_alias_referenced(location),
            ReferenceHint::PROPERTY => {
                self.mark_property_alias_referenced(location, prop_symbol, parent_type)
            }
            ReferenceHint::EXPORT_ASSIGNMENT => {
                self.mark_export_assignment_alias_referenced(location)
            }
            ReferenceHint::JSX => self.mark_jsx_alias_referenced(location),
            ReferenceHint::EXPORT_IMPORT_EQUALS => {
                self.mark_import_equals_alias_referenced(location)
            }
            ReferenceHint::EXPORT_SPECIFIER => {
                self.mark_export_specifier_alias_referenced(location)
            }
            ReferenceHint::DECORATOR => self.mark_decorator_alias_referenced(location),
            ReferenceHint::UNSPECIFIED => {
                if a.flags(location).intersects(NodeFlags::IN_WITH_STATEMENT) {
                    // We cannot answer semantic questions within a with block, do not proceed any further
                    return;
                }
                if is_jsx_tag_name(a, location) && is_jsx_intrinsic_tag_name(a, location) {
                    // builtin JSX tag names aren't real type refs by most metrics, but are expressions, so must be filtered
                    return;
                }
                if is_identifier(a, location) {
                    // A shorthand property with an object-assignment-initializer (e.g. `{ s = 5 }`) is only valid inside a destructuring assignment target. When it appears in an ordinary object literal expression, the checker checks the initializer and never resolves the property name, so resolving it here would report a spurious "No value exists in scope for the shorthand property" diagnostic. Skip such names to match checking.
                    let parent = a.parent(location);
                    if is_shorthand_property_assignment(a, parent)
                        && a.name(parent) == location
                        && !a
                            .as_shorthand_property_assignment(parent)
                            .object_assignment_initializer
                            .is_nil()
                        && !is_assignment_target(a, a.parent(parent))
                    {
                        return;
                    }
                    let res = find_many_ancestors(
                        a,
                        location,
                        &mut [
                            &mut |n| is_meta_property(a, n),
                            &mut |n| is_decorator(a, n),
                            &mut |n| is_for_in_or_of_statement(a, n),
                            &mut |n| is_computed_property_name(a, n),
                            &mut |n| is_heritage_clause(a, n),
                        ],
                    );
                    let meta_property = res.first().copied().unwrap_or_default();
                    let decorator = res.get(1).copied().unwrap_or_default();
                    let for_node = res.get(2).copied().unwrap_or_default();
                    let computed_name = res.get(3).copied().unwrap_or_default();
                    let heritage_clause = res.get(4).copied().unwrap_or_default();
                    if !meta_property.is_nil() {
                        // identifiers in meta properties shouldn't be resolved, but are expressions, so must be filtered
                        return;
                    }
                    if !decorator.is_nil() {
                        // Decorators on nodes that cannot be decorated (e.g. class expressions, static blocks, `this` parameters) are never resolved during normal checking, so resolving them here would report spurious diagnostics. Only bail out for such invalid-position decorators; valid decorator expressions must still be resolved and marked for emit.
                        let decorated = a.parent(decorator);
                        if !decorated.is_nil()
                            && !node_can_be_decorated(
                                a,
                                self.legacy_decorators,
                                decorated,
                                a.parent(decorated),
                                a.parent(a.parent(decorated)),
                            )
                        {
                            return;
                        }
                    }
                    // The right-hand side of a 'for-in'/'for-of' statement whose initializer is an empty variable declaration list (a grammar error, e.g. `for (var of X)`) is never checked, because the RHS is only checked while inferring the type of a variable declaration and there is none here. Resolving identifiers in the RHS here would report spurious diagnostics.
                    if !for_node.is_nil() {
                        let data = a.as_for_in_or_of_statement(for_node);
                        if is_variable_declaration_list(a, data.initializer)
                            && a.nodes(
                                a.as_variable_declaration_list(data.initializer)
                                    .declarations,
                            )
                            .len()
                                == 0
                            && !data.expression.is_nil()
                            && (location == data.expression
                                || is_node_descendant_of(a, location, data.expression))
                        {
                            return;
                        }
                    }
                    // Computed property names on enum members are a grammar error and are never checked (checkEnumMember only checks the member initializer, not the name), so resolving identifiers in them here would report a spurious "Cannot find name" diagnostic.
                    if !computed_name.is_nil() {
                        if is_enum_member(a, a.parent(computed_name)) {
                            return;
                        }
                        if is_invalid_computed_property_name(a, computed_name) {
                            return;
                        }
                    }
                    if !heritage_clause.is_nil() {
                        // extends heritage clauses on interfaces are not expressions and are unchecked if they are
                        if is_interface_declaration(a, a.parent(heritage_clause)) {
                            return;
                        }
                        // On a class, only the first `extends` type is resolved as a value (the base class); any additional `extends` types are grammar errors (e.g. `class C extends A extends B` or `class C extends A, B`) and are never resolved during checking.
                        if is_class_like(a, a.parent(heritage_clause))
                            && a.as_heritage_clause(heritage_clause).token == Kind::ExtendsKeyword
                        {
                            let first_extends =
                                get_class_extends_heritage_element(a, a.parent(heritage_clause));
                            if !first_extends.is_nil()
                                && location != first_extends
                                && !is_node_descendant_of(a, location, first_extends)
                            {
                                return;
                            }
                        }
                    }
                    // Identifiers in expression contexts are emitted, so we need to follow their referenced aliases and mark them as used. Some non-expression identifiers are also treated as expression identifiers for this purpose, eg, `a` in `b = {a}` or `q` in `import r = q`. This is the exception, rather than the rule - most non-expression identifiers are declaration names.
                    if (is_expression_node(a, location)
                        || is_shorthand_property_assignment(a, a.parent(location)))
                        && should_mark_identifier_alias_referenced(a, location)
                    {
                        if is_property_access_or_qualified_name(a, a.parent(location)) {
                            let left = if is_property_access_expression(a, a.parent(location)) {
                                a.expression(a.parent(location))
                            } else {
                                a.as_qualified_name(a.parent(location)).left
                            };
                            if left != location {
                                // Only mark the LHS (the RHS is a property lookup)
                                return;
                            }
                        }
                        self.mark_identifier_alias_referenced(location);
                        return;
                    }
                }
                if is_property_access_or_qualified_name(a, location) {
                    let mut top_prop = location;
                    while is_property_access_or_qualified_name(a, top_prop) {
                        if is_part_of_type_node(a, top_prop) {
                            return;
                        }
                        top_prop = a.parent(top_prop);
                    }
                    self.mark_property_alias_referenced(location, SymbolId::NIL, TypeId::NIL);
                    return;
                }
                if is_export_assignment(a, location) {
                    self.mark_export_assignment_alias_referenced(location);
                    return;
                }
                if is_jsx_opening_like_element(a, location) || is_jsx_opening_fragment(a, location)
                {
                    self.mark_jsx_alias_referenced(location);
                    return;
                }
                if is_import_equals_declaration(a, location) {
                    if is_internal_module_import_equals_declaration(a, location)
                        || self.check_external_import_or_export_declaration(location)
                    {
                        self.mark_import_equals_alias_referenced(location);
                    }
                    return;
                }
                if is_export_specifier(a, location) {
                    self.mark_export_specifier_alias_referenced(location);
                    return;
                }
                if !self.compiler_options.emit_decorator_metadata.is_true() {
                    return;
                }
                if !can_have_decorators(a, location)
                    || !has_decorators(a, location)
                    || a.modifiers(location).is_nil()
                    || !node_can_be_decorated(
                        a,
                        self.legacy_decorators,
                        location,
                        a.parent(location),
                        a.parent(a.parent(location)),
                    )
                {
                    return;
                }

                self.mark_decorator_alias_referenced(location);
            }
            _ => self.fail("Unhandled reference hint"),
        }
    }

    pub fn mark_identifier_alias_referenced(&mut self, location: NodeId) {
        if is_this_in_type_query(self.ast, location) {
            return;
        }
        let symbol = self.get_resolved_symbol(location);
        if !symbol.is_nil() && symbol != self.arguments_symbol && symbol != self.unknown_symbol {
            self.mark_alias_referenced(symbol, location);
        }
    }

    pub fn mark_property_alias_referenced(
        &mut self,
        location: NodeId,
        prop_symbol: SymbolId,
        parent_type: TypeId,
    ) {
        let a = self.ast;
        if is_part_of_import_equals_module_reference(a, location) {
            return;
        }
        let left = if is_property_access_expression(a, location) {
            a.expression(location)
        } else {
            a.as_qualified_name(location).left
        };
        if is_this_identifier(a, left) || !is_identifier(a, left) {
            return;
        }
        let parent_symbol = self.get_resolved_symbol(left);
        if parent_symbol.is_nil() || parent_symbol == self.unknown_symbol {
            return;
        }
        // In `Foo.Bar.Baz`, 'Foo' is not referenced if 'Bar' is a const enum or a module containing only const enums. `Foo` is also not referenced in `enum FooCopy { Bar = Foo.Bar }`, because the enum member value gets inlined here even if `Foo` is not a const enum. The exceptions are: 1. if 'isolatedModules' is enabled, because the const enum value will not be inlined, and 2. if 'preserveConstEnums' is enabled and the expression is itself an export, e.g. `export = Foo.Bar.Baz`. The property lookup is deferred as much as possible, in as many situations as possible, to avoid alias marking pulling on types/symbols it doesn't strictly need to.
        if self.compiler_options.get_isolated_modules()
            || (self.compiler_options.should_preserve_const_enums()
                && is_export_or_export_expression(a, location))
        {
            self.mark_alias_referenced(parent_symbol, location);
            return;
        }
        // Hereafter, this relies on type checking - but every check prior to this only used symbol information
        let mut left_type = parent_type;
        if left_type.is_nil() {
            left_type = self.check_expression_cached(left);
        }
        if is_type_any(self, left_type) || left_type == self.silent_never_type {
            self.mark_alias_referenced(parent_symbol, location);
            return;
        }
        let mut prop = prop_symbol;
        if prop.is_nil() && parent_type.is_nil() {
            let right = if is_property_access_expression(a, location) {
                a.name(location)
            } else {
                a.as_qualified_name(location).right
            };
            let mut lexically_scoped_symbol = SymbolId::NIL;
            if is_private_identifier(a, right) {
                lexically_scoped_symbol =
                    self.lookup_symbol_for_private_identifier_declaration(a.text(right), right);
            }
            let assignment_kind = get_assignment_target_kind(a, location);
            let apparent_type = if assignment_kind != AssignmentKind::NONE
                || self.is_method_access_for_call(location)
            {
                let widened_type = self.get_widened_type(left_type);
                self.get_apparent_type(widened_type)
            } else {
                self.get_apparent_type(left_type)
            };
            if is_private_identifier(a, right) {
                if !lexically_scoped_symbol.is_nil() {
                    prop = self.get_private_identifier_property_of_type(
                        apparent_type,
                        lexically_scoped_symbol,
                    );
                }
            } else {
                prop = self.get_property_of_type(apparent_type, a.text(right));
            }
        }
        if !(!prop.is_nil()
            && (is_const_enum_or_const_enum_only_module(a, prop)
                || a.sym(prop).flags.intersects(SymbolFlags::ENUM_MEMBER)
                    && a.kind(a.parent(location)) == Kind::EnumMember))
        {
            self.mark_alias_referenced(parent_symbol, location);
        }
    }

    pub fn mark_export_assignment_alias_referenced(&mut self, location: NodeId) {
        let a = self.ast;
        let id = a.expression(location);
        if is_identifier(a, id) {
            let resolved = self.resolve_entity_name(id, SymbolFlags::ALL, true, true, location);
            let sym = self.get_export_symbol_of_value_symbol_if_exported(resolved);
            if !sym.is_nil() {
                self.mark_alias_referenced(sym, id);
            }
        }
    }

    pub fn mark_jsx_alias_referenced(&mut self, node: NodeId) {
        let a = self.ast;
        if !self
            .get_jsx_namespace_container_for_implicit_import(node)
            .is_nil()
        {
            return;
        }
        // The reactNamespace/jsxFactory's root symbol should be marked as 'used' so we don't incorrectly elide its import. And if there is no reactNamespace/jsxFactory's symbol in scope when targeting React emit, we should issue an error.
        let jsx_factory_ref_err = if self.compiler_options.jsx == JsxEmit::REACT {
            diagnostics::THIS_JSX_TAG_REQUIRES_0_TO_BE_IN_SCOPE_BUT_IT_COULD_NOT_BE_FOUND
        } else {
            MessageId::NIL
        };
        let jsx_factory_namespace = self.get_jsx_namespace(node);
        let mut jsx_factory_location = node;
        if is_jsx_opening_like_element(a, node) {
            jsx_factory_location = a.tag_name(node);
        }
        let should_factory_ref_err = self.compiler_options.jsx != JsxEmit::PRESERVE
            && self.compiler_options.jsx != JsxEmit::REACT_NATIVE;
        // #38720/60122, allow null as jsxFragmentFactory
        let mut jsx_factory_sym = SymbolId::NIL;
        if !(is_jsx_opening_fragment(a, node) && &jsx_factory_namespace[..] == b"null") {
            let mut flags = SymbolFlags::VALUE;
            if !should_factory_ref_err {
                flags = flags.without(SymbolFlags::ENUM);
            }
            jsx_factory_sym = self.resolve_name(
                jsx_factory_location,
                &jsx_factory_namespace,
                flags,
                jsx_factory_ref_err,
                true,
                false,
            );
        }
        if !jsx_factory_sym.is_nil() {
            // Mark local symbol as referenced here because it might not have been marked if jsx emit was not jsxFactory as there wont be error being emitted
            self.symbol_referenced(jsx_factory_sym, SymbolFlags::ALL);
            // If react/jsxFactory symbol is alias, mark it as referenced
            if self.can_collect_symbol_alias_accessibility_data
                && a.sym(jsx_factory_sym).flags.intersects(SymbolFlags::ALIAS)
                && self
                    .get_type_only_alias_declaration(jsx_factory_sym)
                    .is_nil()
            {
                self.mark_alias_symbol_as_referenced(jsx_factory_sym);
            }
        }
        // if JsxFragment, additionally mark jsx pragma as referenced, since `getJsxNamespace` above would have resolved to only the fragment factory if they are distinct
        if is_jsx_opening_fragment(a, node) {
            let file = get_source_file_of_node(a, node);
            let entity = self.get_jsx_factory_entity(file);
            if !entity.is_nil() {
                let local_jsx_namespace = a.text(get_first_identifier(a, entity));
                let mut flags = SymbolFlags::VALUE;
                if !should_factory_ref_err {
                    flags = flags.without(SymbolFlags::ENUM);
                }
                self.resolve_name(
                    jsx_factory_location,
                    local_jsx_namespace,
                    flags,
                    jsx_factory_ref_err,
                    true,
                    false,
                );
            }
        }
    }

    pub fn mark_import_equals_alias_referenced(&mut self, location: NodeId) {
        if has_syntactic_modifier(self.ast, location, ModifierFlags::EXPORT) {
            self.mark_export_as_referenced(location);
        }
    }

    pub fn mark_export_specifier_alias_referenced(&mut self, location: NodeId) {
        let a = self.ast;
        let export_declaration = a.parent(a.parent(location));
        if a.module_specifier(export_declaration).is_nil()
            && !a.is_type_only(location)
            && !a.is_type_only(export_declaration)
        {
            let exported_name = a.property_name_or_name(location);
            if a.kind(exported_name) == Kind::StringLiteral {
                // Skip for invalid syntax like this: export { "x" }
                return;
            }
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
            let is_non_local_symbol = !symbol.is_nil()
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
                        ));
            // Do nothing for a non-local symbol.
            if !is_non_local_symbol {
                let mut target = symbol;
                if !target.is_nil() && a.sym(target).flags.intersects(SymbolFlags::ALIAS) {
                    target = self.resolve_alias(target);
                }
                if target.is_nil() || self.get_symbol_flags(target).intersects(SymbolFlags::VALUE) {
                    // marks export as used
                    self.mark_export_as_referenced(location);
                    // marks target of export as used
                    self.mark_identifier_alias_referenced(exported_name);
                }
            }
        }
    }

    pub fn check_external_emit_helpers(&mut self, location: NodeId, helpers: ExternalEmitHelpers) {
        let a = self.ast;
        if !self.compiler_options.import_helpers.is_true() {
            return;
        }
        let source_file = get_source_file_of_node(a, location);
        if !is_effective_external_module(a, source_file, self.compiler_options)
            || a.flags(location).intersects(NodeFlags::AMBIENT)
        {
            return;
        }
        let helpers_module = self.resolve_helpers_module(source_file, location);
        if helpers_module == self.unknown_symbol {
            return;
        }
        let links = self.source_file_links.get(source_file);
        let requested_helpers = self.source_file_links[links].requested_external_emit_helpers;
        if requested_helpers & helpers != helpers {
            let unchecked_helpers = helpers.without(requested_helpers);
            let mut helper = ExternalEmitHelpers::FIRST_EMIT_HELPER;
            while helper.0 <= ExternalEmitHelpers::LAST_EMIT_HELPER.0 {
                if unchecked_helpers.intersects(helper) {
                    for &name in self.get_helper_names(helper) {
                        let exports = self.get_exports_of_module(helpers_module);
                        let export_symbol = self.get_symbol(exports, name, SymbolFlags::VALUE);
                        let symbol = self.resolve_symbol(export_symbol);
                        if symbol.is_nil() {
                            self.error(location, diagnostics::THIS_SYNTAX_REQUIRES_AN_IMPORTED_HELPER_NAMED_1_WHICH_DOES_NOT_EXIST_IN_0_CONSIDER_UPGRADING_YOUR_VERSION_OF_0, &[Arg::Str(EXTERNAL_HELPERS_MODULE_NAME_TEXT), Arg::Str(name)]);
                        } else if helper.intersects(ExternalEmitHelpers::CLASS_PRIVATE_FIELD_GET) {
                            if !self.has_signature_with_arity_greater_than(symbol, 3) {
                                self.error(location, diagnostics::THIS_SYNTAX_REQUIRES_AN_IMPORTED_HELPER_NAMED_1_WITH_2_PARAMETERS_WHICH_IS_NOT_COMPATIBLE_WITH_THE_ONE_IN_0_CONSIDER_UPGRADING_YOUR_VERSION_OF_0, &[Arg::Str(EXTERNAL_HELPERS_MODULE_NAME_TEXT), Arg::Str(name), Arg::Int(4)]);
                            }
                        } else if helper.intersects(ExternalEmitHelpers::CLASS_PRIVATE_FIELD_SET) {
                            if !self.has_signature_with_arity_greater_than(symbol, 4) {
                                self.error(location, diagnostics::THIS_SYNTAX_REQUIRES_AN_IMPORTED_HELPER_NAMED_1_WITH_2_PARAMETERS_WHICH_IS_NOT_COMPATIBLE_WITH_THE_ONE_IN_0_CONSIDER_UPGRADING_YOUR_VERSION_OF_0, &[Arg::Str(EXTERNAL_HELPERS_MODULE_NAME_TEXT), Arg::Str(name), Arg::Int(5)]);
                            }
                        }
                    }
                }
                helper = ExternalEmitHelpers(helper.0 << 1);
            }
        }
        self.source_file_links[links].requested_external_emit_helpers |= helpers;
    }

    pub fn has_signature_with_arity_greater_than(
        &mut self,
        symbol: SymbolId,
        arity: isize,
    ) -> bool {
        let signatures = self.get_signatures_of_symbol(symbol);
        for &signature in signatures.as_slice() {
            if self.get_parameter_count(signature) > arity {
                return true;
            }
        }
        false
    }

    pub fn get_helper_names(&self, helper: ExternalEmitHelpers) -> &'static [&'static [u8]] {
        match helper {
            ExternalEmitHelpers::REST => &[b"__rest"],
            ExternalEmitHelpers::DECORATE => {
                if self.legacy_decorators {
                    return &[b"__decorate"];
                }
                &[b"__esDecorate", b"__runInitializers"]
            }
            ExternalEmitHelpers::METADATA => &[b"__metadata"],
            ExternalEmitHelpers::PARAM => &[b"__param"],
            ExternalEmitHelpers::AWAITER => &[b"__awaiter"],
            ExternalEmitHelpers::AWAIT => &[b"__await"],
            ExternalEmitHelpers::ASYNC_GENERATOR => &[b"__asyncGenerator"],
            ExternalEmitHelpers::ASYNC_DELEGATOR => &[b"__asyncDelegator"],
            ExternalEmitHelpers::ASYNC_VALUES => &[b"__asyncValues"],
            ExternalEmitHelpers::EXPORT_STAR => &[b"__exportStar"],
            ExternalEmitHelpers::IMPORT_STAR => &[b"__importStar"],
            ExternalEmitHelpers::IMPORT_DEFAULT => &[b"__importDefault"],
            ExternalEmitHelpers::MAKE_TEMPLATE_OBJECT => &[b"__makeTemplateObject"],
            ExternalEmitHelpers::CLASS_PRIVATE_FIELD_GET => &[b"__classPrivateFieldGet"],
            ExternalEmitHelpers::CLASS_PRIVATE_FIELD_SET => &[b"__classPrivateFieldSet"],
            ExternalEmitHelpers::CLASS_PRIVATE_FIELD_IN => &[b"__classPrivateFieldIn"],
            ExternalEmitHelpers::SET_FUNCTION_NAME => &[b"__setFunctionName"],
            ExternalEmitHelpers::PROP_KEY => &[b"__propKey"],
            ExternalEmitHelpers::ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES => {
                &[b"__addDisposableResource", b"__disposeResources"]
            }
            ExternalEmitHelpers::REWRITE_RELATIVE_IMPORT_EXTENSION => {
                &[b"__rewriteRelativeImportExtension"]
            }
            _ => {
                let _: () = self.fail("Unrecognized helper");
                &[]
            }
        }
    }

    pub fn resolve_helpers_module(&mut self, file: NodeId, error_node: NodeId) -> SymbolId {
        let links = self.source_file_links.get(file);
        if self.source_file_links[links]
            .external_helpers_module
            .is_nil()
        {
            let location = self.program.get_import_helpers_import_specifier(file);
            let mut helpers_module = SymbolId::NIL;
            if location.is_nil() {
                // Upstream dereferences the missing import specifier of a program that has none for tslib: the module counts as not found.
                let _: () = self.fail("no import helpers import specifier in resolveHelpersModule");
            } else {
                helpers_module = self.resolve_external_module(
                    location,
                    EXTERNAL_HELPERS_MODULE_NAME_TEXT,
                    diagnostics::THIS_SYNTAX_REQUIRES_AN_IMPORTED_HELPER_BUT_MODULE_0_CANNOT_BE_FOUND,
                    error_node,
                    false,
                );
            }
            if helpers_module.is_nil() {
                helpers_module = self.unknown_symbol;
            }
            self.source_file_links[links].external_helpers_module = helpers_module;
        }
        self.source_file_links[links].external_helpers_module
    }

    pub fn mark_decorator_alias_referenced(&mut self, node: NodeId) {
        let a = self.ast;
        if self
            .compiler_options
            .emit_decorator_metadata
            .is_false_or_unknown()
        {
            return;
        }
        let first_decorator = a
            .decorators(node)
            .as_slice()
            .first()
            .copied()
            .unwrap_or_default();
        if first_decorator.is_nil() {
            return;
        }

        self.check_external_emit_helpers(first_decorator, ExternalEmitHelpers::METADATA);

        // we only need to perform these checks if we are emitting serialized type metadata for the target of a decorator.
        match a.kind(node) {
            Kind::ClassDeclaration => {
                let ctor = get_first_constructor_with_body(a, node);
                if !ctor.is_nil() {
                    for &p in a.parameters(ctor).as_slice() {
                        let type_node = self.get_parameter_type_node_for_decorator_check(p);
                        self.mark_decorator_medata_data_type_node_as_referenced(type_node);
                    }
                }
            }
            Kind::GetAccessor | Kind::SetAccessor => {
                let other_kind = if a.kind(node) == Kind::SetAccessor {
                    Kind::GetAccessor
                } else {
                    Kind::SetAccessor
                };
                let symbol = self.get_symbol_of_declaration(node);
                let other_accessor = get_declaration_of_kind(a, symbol, other_kind);
                let mut annotation = self.get_annotated_accessor_type_node(node);
                if annotation.is_nil() && !other_accessor.is_nil() {
                    annotation = self.get_annotated_accessor_type_node(other_accessor);
                }
                self.mark_decorator_medata_data_type_node_as_referenced(annotation);
            }
            Kind::MethodDeclaration => {
                for &p in a.parameters(node).as_slice() {
                    let type_node = self.get_parameter_type_node_for_decorator_check(p);
                    self.mark_decorator_medata_data_type_node_as_referenced(type_node);
                }
                self.mark_decorator_medata_data_type_node_as_referenced(a.type_node(node));
            }
            Kind::PropertyDeclaration => {
                self.mark_decorator_medata_data_type_node_as_referenced(a.type_node(node));
            }
            Kind::Parameter => {
                let type_node = self.get_parameter_type_node_for_decorator_check(node);
                self.mark_decorator_medata_data_type_node_as_referenced(type_node);
                let containing_signature = a.parent(node);
                for &p in a.parameters(containing_signature).as_slice() {
                    let type_node = self.get_parameter_type_node_for_decorator_check(p);
                    self.mark_decorator_medata_data_type_node_as_referenced(type_node);
                }
                self.mark_decorator_medata_data_type_node_as_referenced(
                    a.type_node(containing_signature),
                );
            }
            _ => {}
        }
    }

    pub fn get_parameter_type_node_for_decorator_check(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        let type_node = a.type_node(node);
        if !a.as_parameter_declaration(node).dot_dot_dot_token.is_nil() {
            return get_rest_parameter_element_type(a, type_node);
        }
        type_node
    }

    pub fn mark_decorator_medata_data_type_node_as_referenced(&mut self, node: NodeId) {
        let entity_name = self.get_entity_name_for_decorator_metadata(node);
        if !entity_name.is_nil() && is_entity_name(self.ast, entity_name) {
            self.mark_entity_name_or_entity_expression_as_reference(entity_name, true);
        }
    }

    pub fn get_entity_name_for_decorator_metadata(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        if node.is_nil() {
            return node;
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        match a.kind(node) {
            Kind::IntersectionType => self.get_entity_name_for_decorator_metadata_from_type_list(
                a.nodes(a.as_intersection_type_node(node).types).as_slice(),
            ),
            Kind::UnionType => self.get_entity_name_for_decorator_metadata_from_type_list(
                a.nodes(a.as_union_type_node(node).types).as_slice(),
            ),
            Kind::ConditionalType => {
                let conditional = a.as_conditional_type_node(node);
                self.get_entity_name_for_decorator_metadata_from_type_list(&[
                    conditional.true_type,
                    conditional.false_type,
                ])
            }
            Kind::ParenthesizedType => self.get_entity_name_for_decorator_metadata(
                a.as_parenthesized_type_node(node).type_node,
            ),
            Kind::NamedTupleMember => {
                self.get_entity_name_for_decorator_metadata(a.as_named_tuple_member(node).type_node)
            }
            Kind::TypeReference => a.as_type_reference_node(node).type_name,
            _ => NodeId::NIL,
        }
    }

    pub fn get_entity_name_for_decorator_metadata_from_type_list(
        &self,
        type_nodes: &[NodeId],
    ) -> NodeId {
        let a = self.ast;
        let mut common_entity_name = NodeId::NIL;
        for &type_node in type_nodes {
            if a.kind(type_node) == Kind::NeverKeyword {
                // Always elide `never` from the union/intersection if possible
                continue;
            }
            if !self.strict_null_checks
                && (a.kind(type_node) == Kind::LiteralType
                    && a.kind(a.as_literal_type_node(type_node).literal) == Kind::NullKeyword
                    || a.kind(type_node) == Kind::UndefinedKeyword)
            {
                // Elide null and undefined from unions for metadata, just like what we did prior to the implementation of strict null checks
                continue;
            }
            let individual_entity_name = self.get_entity_name_for_decorator_metadata(type_node);
            if individual_entity_name.is_nil() {
                // Individual is something like string number, so it would be serialized to either that type or object: safe to return here
                return NodeId::NIL;
            }

            if common_entity_name.is_nil() {
                common_entity_name = individual_entity_name;
            } else {
                // Note this is in sync with the transformation that happens for type node. Keep this in sync with serializeUnionOrIntersectionType. Verify if they refer to same entity and is identifier, return undefined if they dont match because we would emit object
                if !is_identifier(a, common_entity_name)
                    || !is_identifier(a, individual_entity_name)
                    || a.as_identifier(common_entity_name).text
                        != a.as_identifier(individual_entity_name).text
                {
                    return NodeId::NIL;
                }
            }
        }
        common_entity_name
    }

    pub fn mark_alias_referenced(&mut self, symbol: SymbolId, location: NodeId) {
        let a = self.ast;
        if !self.can_collect_symbol_alias_accessibility_data {
            return;
        }
        if is_non_local_alias(a, symbol, SymbolFlags::VALUE) && !is_in_type_query(a, location) {
            let target = self.resolve_alias(symbol);
            if self
                .get_symbol_flags_ex(symbol, true, false)
                .intersects(SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE)
            {
                // An alias resolving to a const enum cannot be elided if (1) 'isolatedModules' is enabled (because the const enum value will not be inlined), or if (2) the alias is an export of a const enum declaration that will be preserved.
                if self.compiler_options.get_isolated_modules()
                    || self.compiler_options.should_preserve_const_enums()
                        && is_export_or_export_expression(a, location)
                    || !is_const_enum_or_const_enum_only_module(
                        a,
                        self.get_export_symbol_of_value_symbol_if_exported(target),
                    )
                {
                    self.mark_alias_symbol_as_referenced(symbol);
                }
            }
        }
    }

    // When an alias symbol is referenced, we need to mark the entity it references as referenced and in turn repeat that until we reach a non-alias or an exported entity (which is always considered referenced). We do this by checking the target of the alias as an expression (which recursively takes us back here if the target references another alias).
    pub fn mark_alias_symbol_as_referenced(&mut self, symbol: SymbolId) {
        let a = self.ast;
        let links = self.alias_symbol_links.get(symbol);
        if !self.alias_symbol_links[links].referenced {
            self.alias_symbol_links[links].referenced = true;
            let node = self.get_declaration_of_alias_symbol(symbol);
            if node.is_nil() {
                return self.fail("Unexpected nil in markAliasSymbolAsReferenced");
            }
            // We defer checking of the reference of an `import =` until the import itself is referenced, this way a chain of imports can be elided if ultimately the final input is only used in a type position.
            if is_import_equals_declaration(a, node)
                && a.kind(a.as_import_equals_declaration(node).module_reference)
                    != Kind::ExternalModuleReference
            {
                let resolved = self.resolve_symbol(symbol);
                if self
                    .get_symbol_flags(resolved)
                    .intersects(SymbolFlags::VALUE)
                {
                    // import foo = <symbol>
                    let left = get_first_identifier(
                        a,
                        a.as_import_equals_declaration(node).module_reference,
                    );
                    self.mark_identifier_alias_referenced(left);
                }
            }
        }
    }

    pub fn mark_export_as_referenced(&mut self, node: NodeId) {
        let a = self.ast;
        let symbol = self.get_symbol_of_declaration(node);
        let target = self.resolve_alias(symbol);
        if !target.is_nil() {
            let mark_alias = target == self.unknown_symbol
                || (self
                    .get_symbol_flags_ex(symbol, true, false)
                    .intersects(SymbolFlags::VALUE)
                    && !is_const_enum_or_const_enum_only_module(a, target));
            if mark_alias {
                self.mark_alias_symbol_as_referenced(symbol);
            }
        }
    }

    pub fn mark_entity_name_or_entity_expression_as_reference(
        &mut self,
        type_name: NodeId,
        for_decorator_metadata: bool,
    ) {
        let a = self.ast;
        if type_name.is_nil() {
            return;
        }

        let root_name = get_first_identifier(a, type_name);
        let meaning = (if a.kind(type_name) == Kind::Identifier {
            SymbolFlags::TYPE
        } else {
            SymbolFlags::NAMESPACE
        }) | SymbolFlags::ALIAS;
        let root_symbol = self.resolve_name(
            root_name,
            a.text(root_name),
            meaning,
            MessageId::NIL,
            true,
            false,
        );

        if !root_symbol.is_nil() && a.sym(root_symbol).flags.intersects(SymbolFlags::ALIAS) {
            if self.can_collect_symbol_alias_accessibility_data
                && self.symbol_is_value(root_symbol)
                && !is_const_enum_or_const_enum_only_module(a, self.resolve_alias(root_symbol))
                && self.get_type_only_alias_declaration(root_symbol).is_nil()
            {
                self.mark_alias_symbol_as_referenced(root_symbol);
            } else if for_decorator_metadata
                && self.compiler_options.get_isolated_modules()
                && self.compiler_options.get_emit_module_kind() >= ModuleKind::ES2015
                && !self.symbol_is_value(root_symbol)
                && !a
                    .sym(root_symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .any(|&declaration| is_type_only_import_or_export_declaration(a, declaration))
            {
                let diag = self.error(type_name, diagnostics::A_TYPE_REFERENCED_IN_A_DECORATED_SIGNATURE_MUST_BE_IMPORTED_WITH_IMPORT_TYPE_OR_A_NAMESPACE_IMPORT_WHEN_ISOLATEDMODULES_AND_EMITDECORATORMETADATA_ARE_ENABLED, &[]);
                let alias_declaration = a
                    .sym(root_symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .copied()
                    .find(|&declaration| is_alias_symbol_declaration(a, declaration))
                    .unwrap_or_default();
                if !alias_declaration.is_nil() {
                    let related = self.create_diagnostic_for_node(
                        alias_declaration,
                        diagnostics::X_0_WAS_IMPORTED_HERE,
                        &[Arg::Str(a.text(root_name))],
                    );
                    self.diagnostic_store.set_related_info(diag, vec![related]);
                }
            }
        }
    }

    // If a TypeNode can be resolved to a value symbol imported from an external module, it is marked as referenced to prevent import elision.
    pub fn mark_type_node_as_referenced(&mut self, node: NodeId) {
        if !node.is_nil() {
            self.mark_entity_name_or_entity_expression_as_reference(
                get_entity_name_from_type_node(self.ast, node),
                false,
            );
        }
    }

    // checker.go:10171-10197 (layer D-HELPERS): kept with the other helper checks until the file of its upstream range exists.
    pub fn check_class_expression_external_helpers(&mut self, node: NodeId) {
        let a = self.ast;
        if !a.name(node).is_nil() {
            return;
        }
        let parent = walk_up_outer_expressions(a, node);
        if !is_named_evaluation_source(a, parent) {
            return;
        }

        let will_transform_es_decorators = !self.legacy_decorators
            && self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators;
        let mut location;
        if will_transform_es_decorators
            && class_or_constructor_parameter_is_decorated(a, false, node)
        {
            location = node;
            let first_decorator = a
                .decorators(node)
                .as_slice()
                .first()
                .copied()
                .unwrap_or_default();
            if !first_decorator.is_nil() {
                location = first_decorator;
            }
        } else {
            location = self.get_first_transformable_static_class_element(node);
        }

        if !location.is_nil() {
            self.check_external_emit_helpers(location, ExternalEmitHelpers::SET_FUNCTION_NAME);
            if (is_property_assignment(a, parent)
                || is_property_declaration(a, parent)
                || is_binding_element(a, parent))
                && is_computed_property_name(a, a.name(parent))
            {
                self.check_external_emit_helpers(location, ExternalEmitHelpers::PROP_KEY);
            }
        }
    }
}

pub fn is_export_or_export_expression(a: Ast<'_>, location: NodeId) -> bool {
    !find_ancestor(a, location, |n| {
        let parent = a.parent(n);
        if !parent.is_nil() {
            if is_any_export_assignment(a, parent) {
                return a.expression(parent) == n && is_entity_name_expression(a, n);
            }
            if is_export_specifier(a, parent) {
                return a.name(parent) == n || a.property_name(parent) == n;
            }
        }
        false
    })
    .is_nil()
}

pub fn should_mark_identifier_alias_referenced(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    if !parent.is_nil() {
        // A property access expression LHS? checkPropertyAccessExpression will handle that.
        if is_property_access_expression(a, parent) && a.expression(parent) == node {
            return false;
        }
        // Next two check for an identifier inside a type only export.
        if is_export_specifier(a, parent) && a.is_type_only(parent) {
            return false;
        }
        if !a.parent(parent).is_nil() {
            let great_grandparent = a.parent(a.parent(parent));
            if !great_grandparent.is_nil()
                && is_export_declaration(a, great_grandparent)
                && a.is_type_only(great_grandparent)
            {
                return false;
            }
        }
    }
    true
}

pub fn is_internal_module_import_equals_declaration(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::ImportEqualsDeclaration
        && a.kind(a.as_import_equals_declaration(node).module_reference)
            != Kind::ExternalModuleReference
}

pub fn is_part_of_import_equals_module_reference(a: Ast<'_>, location: NodeId) -> bool {
    let import_equals = find_ancestor_kind(a, location, Kind::ImportEqualsDeclaration);
    if import_equals.is_nil() {
        return false;
    }
    let mut node = location;
    while !node.is_nil() && node != import_equals {
        if node
            == a.as_import_equals_declaration(import_equals)
                .module_reference
        {
            return true;
        }
        node = a.parent(node);
    }
    false
}

pub fn get_entity_name_from_type_node(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::TypeReference => a.as_type_reference_node(node).type_name,
        Kind::ExpressionWithTypeArguments => {
            if is_entity_name_expression(a, a.expression(node)) {
                return a.expression(node);
            }
            NodeId::NIL
        }
        // These aren't valid TypeNodes, but we treat them as such because of `isPartOfTypeNode`, which returns `true` for things that aren't `TypeNode`s.
        Kind::Identifier | Kind::QualifiedName => node,
        _ => NodeId::NIL,
    }
}
