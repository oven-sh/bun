// checker/emitresolver.go: what the emitter and its transformers ask the checker: the visibility of a declaration and of an entity name, the aliases that a file keeps, the declaration that an identifier refers to, and the nodes of a type or of a constant. The receiver is a value without fields: its methods take the checker, whose field `emit_resolver` keeps the three link stores, and a function that locks `checkerMu` upstream locks nothing here, as one checker runs on one thread.
use crate::ast::{
    Ast, CheckFlags, JSDeclarationKind, Kind, ModifierFlags, ModifierListId, NodeFactory as _,
    NodeFlags, NodeId, NodeSink as _, NodeUpdater as _, SymbolFlags, SymbolId, TokenFlags,
    get_assignment_declaration_kind, get_declaration_container, get_first_identifier, get_node_id,
    get_source_file_of_node, get_symbol_id, has_syntactic_modifier, is_alias_symbol_declaration,
    is_binary_expression, is_binding_element, is_binding_pattern, is_computed_property_name,
    is_entity_name_expression, is_enum_const, is_expando_property_declaration,
    is_export_assignment, is_export_declaration, is_expression_statement,
    is_external_module_augmentation, is_function_like_declaration, is_get_accessor_declaration,
    is_global_source_file, is_identifier, is_implicitly_exported_jsdoc_declaration,
    is_import_declaration, is_import_equals_declaration, is_in_js_file,
    is_internal_module_import_equals_declaration, is_late_visibility_painted_statement,
    is_namespace_export, is_non_local_alias, is_parameter_declaration, is_parse_tree_node,
    is_part_of_type_node, is_property_access_expression, is_qualified_name,
    is_set_accessor_declaration, is_source_file, is_this_identifier,
    is_type_only_import_or_export_declaration, is_var_const, is_variable_declaration,
    is_variable_statement, node_is_missing, node_is_present, walk_up_binding_elements_and_patterns,
};
use crate::binder::{ReferenceResolver, ReferenceResolverHooks, new_reference_resolver};
use crate::checker::{
    Checker, IndexInfoId, LiteralValue, ReferenceHint, TypeFlags, TypeId,
    contains_non_missing_undefined_type, get_any_import_syntax, is_const_enum_symbol,
    is_declaration_readonly, is_fresh_literal_type, is_optional_declaration, is_tuple_type,
    pseudo_big_int_to_string,
};
use crate::collections::Set;
use crate::core::{CompilerOptions, LinkStore, List, ResolutionMode, Text, Tristate, every, some};
use crate::diagnostics::MessageId;
use crate::evaluator;
use crate::jsnum::Number;
use crate::nodebuilder::{Flags, InternalFlags, SymbolTracker};
use crate::printer::{
    EmitContext, SymbolAccessibility, SymbolAccessibilityResult, new_node_factory,
};
use std::borrow::Cow;

// Links for jsx
#[derive(Default)]
pub struct JSXLinks {
    pub import_ref: NodeId,
}

// Links for declarations
#[derive(Default)]
pub struct DeclarationLinks {
    pub is_visible: Tristate, // if declaration is depended upon by exported declarations
}

#[derive(Default)]
pub struct DeclarationFileLinks {
    pub aliases_marked: bool, // if file has had alias visibility marked
}

// `*EmitResolver`: the receiver of the upstream methods. `checker` is the argument of each method, `isValueAliasDeclaration` and `aliasMarkingVisitor` are the methods that newEmitResolver binds them to, and `referenceResolver` is made at each call.
#[derive(Clone, Copy, Default)]
pub struct EmitResolver;

// jsxLinks, declarationLinks and declarationFileLinks of EmitResolver: the field `emit_resolver` of the checker.
#[derive(Default)]
pub struct EmitResolverState {
    pub jsx_links: LinkStore<NodeId, JSXLinks>,
    pub declaration_links: LinkStore<NodeId, DeclarationLinks>,
    pub declaration_file_links: LinkStore<NodeId, DeclarationFileLinks>,
}

// printer/emitresolver.go TypeReferenceSerializationKind: how to serialize the name for a TypeReferenceNode when emitting decorator metadata. It is declared beside its one producer, as the printer module has the result types of the accessibility checks only.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeReferenceSerializationKind {
    // The TypeReferenceNode could not be resolved. The type name should be emitted using a safe fallback.
    #[default]
    Unknown,
    // The TypeReferenceNode resolves to a type with a constructor function that can be reached at runtime (e.g. a `class` declaration or a `var` declaration for the static side of a type, such as the global `Promise` type in lib.d.ts).
    TypeWithConstructSignatureAndValue,
    // The TypeReferenceNode resolves to a Void-like, Nullable, or Never type.
    VoidNullableOrNeverType,
    // The TypeReferenceNode resolves to a Number-like type.
    NumberLikeType,
    // The TypeReferenceNode resolves to a BigInt-like type.
    BigIntLikeType,
    // The TypeReferenceNode resolves to a String-like type.
    StringLikeType,
    // The TypeReferenceNode resolves to a Boolean-like type.
    BooleanType,
    // The TypeReferenceNode resolves to an Array-like type.
    ArrayLikeType,
    // The TypeReferenceNode resolves to the ESSymbol type.
    ESSymbolType,
    // The TypeReferenceNode resolved to the global Promise constructor symbol.
    Promise,
    // The TypeReferenceNode resolves to a Function type or a type with call signatures.
    TypeWithCallSignature,
    // The TypeReferenceNode resolves to any other type.
    ObjectType,
}

// `*NodeBuilder` of `NewNodeBuilder(r.checker, emitContext)`: the node builder of one request, over the emit context of the caller. The node builder of this port is the one state of the checker over its own emit context, so a request has no builder yet: each entry records the name of upstream's entry as a stand-in and answers nil.
#[derive(Clone, Copy)]
struct RequestNodeBuilder;

impl RequestNodeBuilder {
    fn index_info_to_index_signature_declaration(
        self,
        c: &Checker<'_>,
        _info: IndexInfoId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.IndexInfoToIndexSignatureDeclaration")
    }

    fn serialize_return_type_for_signature(
        self,
        c: &Checker<'_>,
        _signature_declaration: NodeId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.SerializeReturnTypeForSignature")
    }

    fn serialize_type_parameters_for_signature(
        self,
        c: &Checker<'_>,
        _signature_declaration: NodeId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> Vec<NodeId> {
        c.stand_in("NodeBuilder.SerializeTypeParametersForSignature")
    }

    fn serialize_type_for_declaration(
        self,
        c: &Checker<'_>,
        _declaration: NodeId,
        _symbol: SymbolId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.SerializeTypeForDeclaration")
    }

    fn serialize_type_for_expression(
        self,
        c: &Checker<'_>,
        _expr: NodeId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.SerializeTypeForExpression")
    }

    fn symbol_to_expression(
        self,
        c: &Checker<'_>,
        _symbol: SymbolId,
        _meaning: SymbolFlags,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.SymbolToExpression")
    }

    fn type_to_type_node(
        self,
        c: &Checker<'_>,
        _typ: TypeId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.TypeToTypeNode")
    }

    fn try_js_type_node_to_type_node(
        self,
        c: &Checker<'_>,
        _node: NodeId,
        _enclosing_declaration: NodeId,
        _flags: Flags,
        _internal_flags: InternalFlags,
        _tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        c.stand_in("NodeBuilder.TryJSTypeNodeToTypeNode")
    }
}

// The checker keeps no resolver and Checker.GetEmitResolver answers the value itself, so nothing calls this.
pub fn new_emit_resolver(_checker: &Checker<'_>) -> EmitResolver {
    EmitResolver
}

impl EmitResolver {
    pub fn get_jsx_factory_entity(self, c: &mut Checker<'_>, location: NodeId) -> NodeId {
        c.get_jsx_factory_entity(location)
    }

    pub fn get_jsx_fragment_factory_entity(self, c: &mut Checker<'_>, location: NodeId) -> NodeId {
        c.get_jsx_fragment_factory_entity(location)
    }

    pub fn is_optional_parameter_exported(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        self.is_optional_parameter(c, node)
    }

    pub fn is_late_bound(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        if node.is_nil() {
            return false;
        }
        if !is_parse_tree_node(a, node) {
            return false;
        }
        let symbol = c.get_symbol_of_declaration(node);
        if symbol.is_nil() {
            return false;
        }
        a.sym(symbol).check_flags.intersects(CheckFlags::LATE)
    }

    pub fn get_enum_member_value<'a>(
        self,
        c: &mut Checker<'a>,
        node: NodeId,
    ) -> evaluator::Result<'a> {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return evaluator::new_result(LiteralValue::Nil, false, false, false);
        }

        c.compute_enum_member_values(a.parent(node));
        if !c.enum_member_links.has(node) {
            return evaluator::new_result(LiteralValue::Nil, false, false, false);
        }
        let links = c.enum_member_links.get(node);
        c.enum_member_links[links].value.clone()
    }

    pub fn is_declaration_visible_exported(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        self.is_declaration_visible(c, node)
    }

    pub fn is_declaration_visible(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        // The walk climbs the parents of a node: it answers false and records the stack limit where Go's stack grows.
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        if !is_parse_tree_node(c.ast, node) {
            return false;
        }
        if node.is_nil() {
            return false;
        }

        let links = c.emit_resolver.declaration_links.get(node);
        if c.emit_resolver.declaration_links[links].is_visible == Tristate::UNKNOWN {
            if self.determine_if_declaration_is_visible(c, node) {
                c.emit_resolver.declaration_links[links].is_visible = Tristate::TRUE;
            } else {
                c.emit_resolver.declaration_links[links].is_visible = Tristate::FALSE;
            }
        }
        c.emit_resolver.declaration_links[links].is_visible == Tristate::TRUE
    }

    pub fn determine_if_declaration_is_visible(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        match a.kind(node) {
            // Top-level jsdoc type aliases are considered exported: the first parent is the comment node and the second is the hosting declaration or token, of which only those whose parent is a source file count.
            Kind::JSDocCallbackTag | Kind::JSDocTypedefTag => {
                let comment = a.parent(node);
                let host = a.parent(comment);
                !comment.is_nil()
                    && !host.is_nil()
                    && !a.parent(host).is_nil()
                    && is_source_file(a, a.parent(host))
            }
            Kind::BindingElement => self.is_declaration_visible(c, a.parent(a.parent(node))),
            Kind::VariableDeclaration
            | Kind::ModuleDeclaration
            | Kind::ClassDeclaration
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::FunctionDeclaration
            | Kind::EnumDeclaration
            | Kind::ImportEqualsDeclaration => {
                if is_variable_declaration(a, node)
                    && is_binding_pattern(a, a.name(node))
                    && a.elements(a.name(node)).len() == 0
                {
                    // If the binding pattern is empty, this variable declaration is not visible
                    return false;
                }
                // External module augmentation is always visible, and so is a @typedef at top-level in an external module
                if is_external_module_augmentation(a, node)
                    || is_implicitly_exported_jsdoc_declaration(a, node)
                {
                    return true;
                }
                let parent = get_declaration_container(a, node);
                // If the node is not exported or it is not ambient module element (except import declaration)
                if !c
                    .get_combined_modifier_flags_cached(node)
                    .intersects(ModifierFlags::EXPORT)
                    && !(a.kind(node) != Kind::ImportEqualsDeclaration
                        && a.kind(parent) != Kind::SourceFile
                        && a.flags(parent).intersects(NodeFlags::AMBIENT))
                {
                    return is_global_source_file(a, parent);
                }
                // Exported members/ambient module elements (exception import declaration) are visible if parent is visible
                self.is_declaration_visible(c, parent)
            }
            Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::MethodDeclaration
            | Kind::MethodSignature => {
                if c.get_effective_declaration_flags(
                    node,
                    ModifierFlags::PRIVATE | ModifierFlags::PROTECTED,
                ) != ModifierFlags::NONE
                {
                    // Private/protected properties/methods are not visible
                    return false;
                }
                // Public properties/methods are visible if its parents are visible, so:
                self.is_declaration_visible(c, a.parent(node))
            }
            Kind::Constructor
            | Kind::ConstructSignature
            | Kind::CallSignature
            | Kind::IndexSignature
            | Kind::Parameter
            | Kind::ModuleBlock
            | Kind::FunctionType
            | Kind::ConstructorType
            | Kind::TypeLiteral
            | Kind::TypeReference
            | Kind::ArrayType
            | Kind::TupleType
            | Kind::UnionType
            | Kind::IntersectionType
            | Kind::ParenthesizedType
            | Kind::NamedTupleMember => self.is_declaration_visible(c, a.parent(node)),
            // Default binding, import specifier and namespace import is visible only on demand so by default it is not visible
            Kind::ImportClause | Kind::NamespaceImport | Kind::ImportSpecifier => false,
            // Type parameters are always visible
            Kind::TypeParameter => true,
            // Source file and namespace export are always visible
            Kind::SourceFile | Kind::NamespaceExportDeclaration => true,
            // Export assignments do not create name bindings outside the module
            Kind::ExportAssignment => false,
            // An `export {X}` (without a module specifier) is itself a visible re-export of the named binding; it contributes to the symbol's external visibility.
            Kind::ExportSpecifier => {
                let export_decl = a.parent(a.parent(node));
                if is_export_declaration(a, export_decl)
                    && a.as_export_declaration(export_decl)
                        .module_specifier
                        .is_nil()
                {
                    return self.is_declaration_visible(c, a.parent(export_decl));
                }
                false
            }
            _ => false,
        }
    }

    pub fn precalculate_declaration_emit_visibility(self, c: &mut Checker<'_>, file: NodeId) {
        let a = c.ast;
        let links = c.emit_resolver.declaration_file_links.get(file);
        if c.emit_resolver.declaration_file_links[links].aliases_marked {
            return;
        }
        c.emit_resolver.declaration_file_links[links].aliases_marked = true;
        // Upstream asks whether this has to be an upfront walk.
        a.for_each_child(file, &mut |node| self.alias_marking_visitor_worker(c, node));
    }
}

pub fn is_common_js_module_exports(a: Ast<'_>, node: NodeId) -> bool {
    if is_binary_expression(a, node)
        && is_expression_statement(a, a.parent(node))
        && is_source_file(a, a.parent(a.parent(node)))
        && !a
            .as_source_file(a.parent(a.parent(node)))
            .common_js_module_indicator
            .is_nil()
    {
        let kind = get_assignment_declaration_kind(a, node);
        if kind == JSDeclarationKind::MODULE_EXPORTS || kind == JSDeclarationKind::EXPORTS_PROPERTY
        {
            return true;
        }
    }
    false
}

impl EmitResolver {
    pub fn alias_marking_visitor_worker(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        // The walk visits every node of a file: it answers false and records the stack limit where Go's stack grows.
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        match a.kind(node) {
            Kind::BinaryExpression => {
                let right = a.as_binary_expression(node).right;
                if is_common_js_module_exports(a, node) && is_identifier(a, right) {
                    self.mark_linked_aliases(c, right);
                }
            }
            Kind::ExportAssignment => {
                if a.kind(a.expression(node)) == Kind::Identifier {
                    self.mark_linked_aliases(c, a.expression(node));
                }
            }
            Kind::ExportSpecifier => {
                self.mark_linked_aliases(c, a.property_name_or_name(node));
            }
            _ => {}
        }
        a.for_each_child(node, &mut |child| {
            self.alias_marking_visitor_worker(c, child)
        })
    }

    // Sets the isVisible link on statements the Identifier or ExportName node points at. Follows chains of import d = a.b.c
    pub fn mark_linked_aliases(self, c: &mut Checker<'_>, node: NodeId) {
        let a = c.ast;
        let meaning =
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE | SymbolFlags::ALIAS;
        let mut export_symbol = SymbolId::NIL;
        if a.kind(node) != Kind::StringLiteral
            && !a.parent(node).is_nil()
            && (is_export_assignment(a, a.parent(node))
                || is_common_js_module_exports(a, a.parent(node)))
        {
            export_symbol =
                c.resolve_name(node, a.text(node), meaning, MessageId::NIL, false, false);
        } else if a.kind(a.parent(node)) == Kind::ExportSpecifier {
            export_symbol = c.get_target_of_export_specifier(a.parent(node), meaning, false);
        }

        // guard against circular imports
        let mut visited: Set<u64> = Set::default();
        while !export_symbol.is_nil() {
            if visited.has(&get_symbol_id(a, export_symbol)) {
                break;
            }
            visited.add(get_symbol_id(a, export_symbol));

            let mut next_symbol = SymbolId::NIL;
            for declaration in a.sym(export_symbol).declarations.iter() {
                let links = c.emit_resolver.declaration_links.get(declaration);
                c.emit_resolver.declaration_links[links].is_visible = Tristate::TRUE;

                if is_internal_module_import_equals_declaration(a, declaration) {
                    // Add the referenced top container visible
                    let internal_module_reference =
                        a.as_import_equals_declaration(declaration).module_reference;
                    let first_identifier = get_first_identifier(a, internal_module_reference);
                    let import_symbol = c.resolve_name(
                        declaration,
                        a.text(first_identifier),
                        meaning,
                        MessageId::NIL,
                        false,
                        false,
                    );
                    next_symbol = import_symbol;
                }
            }

            export_symbol = next_symbol;
        }
    }
}

pub fn get_meaning_of_entity_name_reference(a: Ast<'_>, entity_name: NodeId) -> SymbolFlags {
    let parent = a.parent(entity_name);
    let parent_kind = a.kind(parent);
    // get symbol of the first identifier of the entityName
    if parent_kind == Kind::TypeQuery
        || parent_kind == Kind::ExpressionWithTypeArguments && !is_part_of_type_node(a, parent)
        || parent_kind == Kind::ComputedPropertyName
        || parent_kind == Kind::TypePredicate
            && a.as_type_predicate_node(parent).parameter_name == entity_name
        || parent_kind == Kind::BinaryExpression
    {
        // Typeof value
        return SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE;
    }
    let kind = a.kind(entity_name);
    if kind == Kind::QualifiedName
        || kind == Kind::PropertyAccessExpression
        || parent_kind == Kind::ImportEqualsDeclaration
        || (parent_kind == Kind::QualifiedName && a.as_qualified_name(parent).left == entity_name)
        || (parent_kind == Kind::PropertyAccessExpression && a.expression(parent) == entity_name)
        || (parent_kind == Kind::ElementAccessExpression && a.expression(parent) == entity_name)
    {
        // Left identifier from type reference or TypeAlias, and the entity name of the import declaration
        return SymbolFlags::NAMESPACE;
    }
    // Type Reference or TypeAlias entity = Identifier
    SymbolFlags::TYPE
}

impl EmitResolver {
    pub fn is_entity_name_visible_exported(
        self,
        c: &mut Checker<'_>,
        entity_name: NodeId,
        enclosing_declaration: NodeId,
    ) -> SymbolAccessibilityResult {
        self.is_entity_name_visible(c, entity_name, enclosing_declaration, true)
    }

    pub fn is_entity_name_visible(
        self,
        c: &mut Checker<'_>,
        entity_name: NodeId,
        enclosing_declaration: NodeId,
        should_compute_alias_to_make_visible: bool,
    ) -> SymbolAccessibilityResult {
        let a = c.ast;
        if !is_parse_tree_node(a, entity_name) {
            return SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::NotAccessible,
                ..SymbolAccessibilityResult::default()
            };
        }

        let meaning = get_meaning_of_entity_name_reference(a, entity_name);
        let first_identifier = get_first_identifier(a, entity_name);

        let symbol = c.resolve_name(
            enclosing_declaration,
            a.text(first_identifier),
            meaning,
            MessageId::NIL,
            false,
            false,
        );

        if !symbol.is_nil()
            && a.sym(symbol).flags.intersects(SymbolFlags::TYPE_PARAMETER)
            && meaning.intersects(SymbolFlags::TYPE)
        {
            return SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::Accessible,
                ..SymbolAccessibilityResult::default()
            };
        }

        if symbol.is_nil() && is_this_identifier(a, first_identifier) {
            let container = c.get_this_container(first_identifier, false, false);
            let sym = c.get_symbol_of_declaration(container);
            if self
                .is_symbol_accessible(c, sym, enclosing_declaration, meaning, false)
                .accessibility
                == SymbolAccessibility::Accessible
            {
                return SymbolAccessibilityResult {
                    accessibility: SymbolAccessibility::Accessible,
                    ..SymbolAccessibilityResult::default()
                };
            }
        }

        if symbol.is_nil() {
            return SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::NotResolved,
                error_symbol_name: a.text(first_identifier).to_vec(),
                error_node: first_identifier,
                ..SymbolAccessibilityResult::default()
            };
        }

        let visible =
            self.has_visible_declarations(c, symbol, should_compute_alias_to_make_visible);
        if let Some(visible) = visible {
            return visible;
        }

        SymbolAccessibilityResult {
            accessibility: SymbolAccessibility::NotAccessible,
            error_symbol_name: a.text(first_identifier).to_vec(),
            error_node: first_identifier,
            ..SymbolAccessibilityResult::default()
        }
    }
}

pub fn noop_add_visible_alias(_declaration: NodeId, _aliasing_statement: NodeId) {}

impl EmitResolver {
    pub fn has_visible_declarations(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        should_compute_alias_to_make_visible: bool,
    ) -> Option<SymbolAccessibilityResult> {
        // The closure `addVisibleAlias` of upstream, which is noopAddVisibleAlias when no alias is computed.
        fn add_visible_alias(
            c: &mut Checker<'_>,
            should_compute_alias_to_make_visible: bool,
            aliases_to_make_visible_set: &mut Vec<(NodeId, NodeId)>,
            declaration: NodeId,
            aliasing_statement: NodeId,
        ) {
            if !should_compute_alias_to_make_visible {
                noop_add_visible_alias(declaration, aliasing_statement);
                return;
            }
            let links = c.emit_resolver.declaration_links.get(declaration);
            c.emit_resolver.declaration_links[links].is_visible = Tristate::TRUE;
            let id = get_node_id(declaration);
            match aliases_to_make_visible_set
                .iter_mut()
                .find(|entry| entry.0 == id)
            {
                Some(entry) => entry.1 = aliasing_statement,
                None => aliases_to_make_visible_set.push((id, aliasing_statement)),
            }
        }

        let a = c.ast;
        // A declaration and its aliasing statement, in the order of the first entry of each declaration: the map of upstream has no order.
        let mut aliases_to_make_visible_set: Vec<(NodeId, NodeId)> = Vec::new();
        let symbol_flags = a.sym(symbol).flags;

        for declaration in a.sym(symbol).declarations.iter() {
            if is_identifier(a, declaration) {
                continue;
            }
            if !self.is_declaration_visible(c, declaration) {
                // Mark the unexported alias as visible if its parent is visible because these kind of aliases can be used to name types in declaration file
                let any_import_syntax = get_any_import_syntax(a, declaration);
                if !any_import_syntax.is_nil()
                    && !has_syntactic_modifier(a, any_import_syntax, ModifierFlags::EXPORT)
                    && self.is_declaration_visible(c, a.parent(any_import_syntax))
                {
                    add_visible_alias(
                        c,
                        should_compute_alias_to_make_visible,
                        &mut aliases_to_make_visible_set,
                        declaration,
                        any_import_syntax,
                    );
                    continue;
                }
                let parent = a.parent(declaration);
                let grandparent = a.parent(parent);
                if is_variable_declaration(a, declaration)
                    && is_variable_statement(a, grandparent)
                    && !has_syntactic_modifier(a, grandparent, ModifierFlags::EXPORT)
                    && self.is_declaration_visible(c, a.parent(grandparent))
                {
                    add_visible_alias(
                        c,
                        should_compute_alias_to_make_visible,
                        &mut aliases_to_make_visible_set,
                        declaration,
                        grandparent,
                    );
                    continue;
                }
                if is_late_visibility_painted_statement(a, declaration)
                    && !has_syntactic_modifier(a, declaration, ModifierFlags::EXPORT)
                    && self.is_declaration_visible(c, parent)
                {
                    add_visible_alias(
                        c,
                        should_compute_alias_to_make_visible,
                        &mut aliases_to_make_visible_set,
                        declaration,
                        declaration,
                    );
                    continue;
                }
                if is_binding_element(a, declaration) {
                    let variable_statement = a.parent(a.parent(grandparent));
                    // An exported import-like top-level JS require statement, whose container (the file) has to be visible
                    if symbol_flags.intersects(SymbolFlags::ALIAS)
                        && is_in_js_file(a, declaration)
                        && !parent.is_nil()
                        && !grandparent.is_nil()
                        && is_variable_declaration(a, grandparent)
                        && !variable_statement.is_nil()
                        && is_variable_statement(a, variable_statement)
                        && !has_syntactic_modifier(a, variable_statement, ModifierFlags::EXPORT)
                        && !a.parent(variable_statement).is_nil()
                        && self.is_declaration_visible(c, a.parent(variable_statement))
                    {
                        add_visible_alias(
                            c,
                            should_compute_alias_to_make_visible,
                            &mut aliases_to_make_visible_set,
                            declaration,
                            variable_statement,
                        );
                        continue;
                    }
                    if symbol_flags.intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE) {
                        let root_declaration =
                            walk_up_binding_elements_and_patterns(a, declaration);
                        if is_parameter_declaration(a, root_declaration) {
                            return None;
                        }
                        let variable_statement = a.parent(a.parent(root_declaration));
                        if !is_variable_statement(a, variable_statement) {
                            return None;
                        }
                        if has_syntactic_modifier(a, variable_statement, ModifierFlags::EXPORT) {
                            // no alias to add, already exported
                            continue;
                        }
                        if !self.is_declaration_visible(c, a.parent(variable_statement)) {
                            // not visible
                            return None;
                        }
                        add_visible_alias(
                            c,
                            should_compute_alias_to_make_visible,
                            &mut aliases_to_make_visible_set,
                            declaration,
                            variable_statement,
                        );
                        continue;
                    }
                }

                // Declaration is not visible
                return None;
            }
        }

        Some(SymbolAccessibilityResult {
            accessibility: SymbolAccessibility::Accessible,
            aliases_to_make_visible: aliases_to_make_visible_set
                .into_iter()
                .map(|(_, aliasing_statement)| aliasing_statement)
                .collect(),
            ..SymbolAccessibilityResult::default()
        })
    }

    pub fn is_implementation_of_overload(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return false;
        }
        if node_is_present(a, a.body(node)) {
            if is_get_accessor_declaration(a, node) || is_set_accessor_declaration(a, node) {
                // Get or set accessors can never be overload implementations, but can have up to 2 signatures
                return false;
            }
            let symbol = c.get_symbol_of_declaration(node);
            let signatures_of_symbol = c.get_signatures_of_symbol(symbol);
            // If this function body corresponds to function with multiple signature, it is implementation of overload, e.g. `function foo(a: string): string; function foo(a: number): number; function foo(a: any) { return a; }`
            if signatures_of_symbol.len() > 1 {
                return true;
            }
            // If there is single signature for the symbol, it is overload if that signature isn't coming from the node, e.g. `function foo(a: string): string; function foo(a: any) { return a; }`
            if signatures_of_symbol.len() == 1 {
                let signature = signatures_of_symbol.at(0usize);
                if signature == c.get_signature_of_full_signature_type(node) {
                    return false;
                }
                let declaration = c.signatures[signature].declaration;
                if declaration != node && !a.flags(declaration).intersects(NodeFlags::JSDOC) {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_import_required_by_augmentation(self, c: &mut Checker<'_>, decl: NodeId) -> bool {
        let a = c.ast;
        if !is_parse_tree_node(a, decl) {
            return false;
        }
        let file = get_source_file_of_node(a, decl);
        if a.symbol(file).is_nil() {
            // script file
            return false;
        }
        let import_target = self.get_external_module_file_from_declaration(c, decl);
        if import_target.is_nil() {
            return false;
        }
        if import_target == file {
            return false;
        }
        let exports = c.get_exports_of_module(a.symbol(file));
        let mut position = 0;
        while let Some((_, s)) = a.table_entry_at(exports, position) {
            position += 1;
            let merged = c.get_merged_symbol(s);
            if merged != s {
                let declarations = a.sym(merged).declarations;
                if declarations.len() > 0 {
                    for d in declarations.iter() {
                        let decl_file = get_source_file_of_node(a, d);
                        if decl_file == import_target {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    pub fn is_definitely_reference_to_global_symbol_object(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> bool {
        let a = c.ast;
        if !is_property_access_expression(a, node)
            || !is_identifier(a, a.name(node))
            || !is_property_access_expression(a, a.expression(node))
                && !is_identifier(a, a.expression(node))
        {
            return false;
        }
        let expression = a.expression(node);
        if a.kind(expression) == Kind::Identifier {
            if a.text(expression) != b"Symbol" {
                return false;
            }
            // Exactly `Symbol.something` and `Symbol` either does not resolve or definitely resolves to the global Symbol
            let resolved = c.get_resolved_symbol(expression);
            let global = c.get_global_symbol(
                b"Symbol",
                SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
                MessageId::NIL,
            );
            return resolved == global;
        }
        let object = a.expression(expression);
        if a.kind(object) != Kind::Identifier
            || a.text(object) != b"globalThis"
            || a.text(a.name(expression)) != b"Symbol"
        {
            return false;
        }
        // Exactly `globalThis.Symbol.something` and `globalThis` resolves to the global `globalThis`
        c.get_resolved_symbol(object) == c.global_this_symbol
    }

    pub fn requires_adding_implicit_undefined_exported(
        self,
        c: &mut Checker<'_>,
        declaration: NodeId,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> bool {
        if !is_parse_tree_node(c.ast, declaration) {
            return false;
        }
        self.requires_adding_implicit_undefined(c, declaration, symbol, enclosing_declaration)
    }

    pub fn requires_adding_implicit_undefined_unsafe(
        self,
        c: &mut Checker<'_>,
        declaration: NodeId,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> bool {
        if !is_parse_tree_node(c.ast, declaration) {
            return false;
        }
        self.requires_adding_implicit_undefined(c, declaration, symbol, enclosing_declaration)
    }

    pub fn requires_adding_implicit_undefined(
        self,
        c: &mut Checker<'_>,
        declaration: NodeId,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> bool {
        let a = c.ast;
        if !is_parse_tree_node(a, declaration) {
            return false;
        }
        match a.kind(declaration) {
            Kind::PropertyDeclaration | Kind::PropertySignature | Kind::JSDocPropertyTag => {
                let mut symbol = symbol;
                if symbol.is_nil() {
                    symbol = c.get_symbol_of_declaration(declaration);
                }
                let t = c.get_type_of_symbol(symbol);
                let _ = c.mapped_symbol_links.has(symbol);
                let flags = a.sym(symbol).flags;
                if !(flags.intersects(SymbolFlags::PROPERTY)
                    && flags.intersects(SymbolFlags::OPTIONAL)
                    && is_optional_declaration(a, declaration)
                    && c.reverse_mapped_symbol_links.has(symbol))
                {
                    return false;
                }
                let links = c.reverse_mapped_symbol_links.get(symbol);
                !c.reverse_mapped_symbol_links[links].mapped_type.is_nil()
                    && contains_non_missing_undefined_type(c, t)
            }
            Kind::Parameter | Kind::JSDocParameterTag => self
                .requires_adding_implicit_undefined_worker(c, declaration, enclosing_declaration),
            _ => c.fail("Node cannot possibly require adding undefined"),
        }
    }

    pub fn requires_adding_implicit_undefined_worker(
        self,
        c: &mut Checker<'_>,
        parameter: NodeId,
        enclosing_declaration: NodeId,
    ) -> bool {
        (self.is_required_initialized_parameter(c, parameter, enclosing_declaration)
            || self.is_optional_uninitialized_parameter_property(c, parameter))
            && !self.declared_parameter_type_contains_undefined(c, parameter)
    }

    pub fn declared_parameter_type_contains_undefined(
        self,
        c: &mut Checker<'_>,
        parameter: NodeId,
    ) -> bool {
        // The type annotation of the parameter itself: upstream does not read a JSDoc annotation here yet.
        let type_node = c.ast.type_node(parameter);
        if type_node.is_nil() {
            return false;
        }
        let t = c.get_type_from_type_node(type_node);
        // allow error type here to avoid confusing errors that the annotation has to contain undefined when it does in cases like this: `export function fn(x?: Unresolved | undefined): void {}`
        c.is_error_type(t) || c.contains_undefined_type(t)
    }

    pub fn is_optional_uninitialized_parameter_property(
        self,
        c: &mut Checker<'_>,
        parameter: NodeId,
    ) -> bool {
        let a = c.ast;
        c.strict_null_checks
            && self.is_optional_parameter(c, parameter)
            && a.initializer(parameter).is_nil()
            && has_syntactic_modifier(a, parameter, ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
    }

    pub fn is_required_initialized_parameter(
        self,
        c: &mut Checker<'_>,
        parameter: NodeId,
        enclosing_declaration: NodeId,
    ) -> bool {
        let a = c.ast;
        if !c.strict_null_checks
            || self.is_optional_parameter(c, parameter)
            || a.initializer(parameter).is_nil()
        {
            return false;
        }
        if has_syntactic_modifier(a, parameter, ModifierFlags::PARAMETER_PROPERTY_MODIFIER) {
            return !enclosing_declaration.is_nil()
                && is_function_like_declaration(a, enclosing_declaration);
        }
        true
    }

    pub fn is_optional_parameter(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        c.is_optional_parameter(node)
    }

    pub fn is_literal_const_declaration(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return false;
        }
        if is_declaration_readonly(a, node)
            || is_variable_declaration(a, node) && is_var_const(a, node)
        {
            let s = c.get_symbol_of_declaration(node);
            if s.is_nil() {
                return false;
            }
            let t = c.get_type_of_symbol(s);
            return is_fresh_literal_type(c, t);
        }
        false
    }

    pub fn is_expando_function_declaration_unsafe(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return false;
        }
        // this is substantially different from strada, but so is expando property checking
        let props = self.get_properties_of_container_function(c, node);
        for p in props.iter() {
            if is_expando_property_declaration(a, a.sym(p).value_declaration) {
                return true;
            }
        }
        false
    }

    pub fn is_expando_function_declaration(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        self.is_expando_function_declaration_unsafe(c, node)
    }

    pub fn is_symbol_accessible(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        should_compute_alias_to_mark_visible: bool,
    ) -> SymbolAccessibilityResult {
        c.is_symbol_accessible(
            symbol,
            enclosing_declaration,
            meaning,
            should_compute_alias_to_mark_visible,
        )
    }

    pub fn is_symbol_accessible_exported(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        should_compute_alias_to_mark_visible: bool,
    ) -> SymbolAccessibilityResult {
        self.is_symbol_accessible(
            c,
            symbol,
            enclosing_declaration,
            meaning,
            should_compute_alias_to_mark_visible,
        )
    }
}

pub fn is_const_enum_or_const_enum_only_module(a: Ast<'_>, s: SymbolId) -> bool {
    is_const_enum_symbol(a, s)
        || a.sym(s)
            .flags
            .intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE)
}

impl EmitResolver {
    pub fn is_referenced_alias_declaration(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;
        if !c.can_collect_symbol_alias_accessibility_data || !is_parse_tree_node(a, node) {
            return true;
        }

        if is_alias_symbol_declaration(a, node) {
            let symbol = c.get_symbol_of_declaration(node);
            if !symbol.is_nil() {
                let alias_links = c.alias_symbol_links.get(symbol);
                if c.alias_symbol_links[alias_links].referenced {
                    return true;
                }
                let target = c.alias_symbol_links[alias_links].alias_target;
                if !target.is_nil()
                    && a.modifier_flags(node).intersects(ModifierFlags::EXPORT)
                    && c.get_symbol_flags(target).intersects(SymbolFlags::VALUE)
                    && (c.compiler_options.should_preserve_const_enums()
                        || !is_const_enum_or_const_enum_only_module(a, target))
                {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_value_alias_declaration(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        if !c.can_collect_symbol_alias_accessibility_data || !is_parse_tree_node(c.ast, node) {
            return true;
        }

        self.is_value_alias_declaration_worker(c, node)
    }

    pub fn is_value_alias_declaration_worker(self, c: &mut Checker<'_>, node: NodeId) -> bool {
        let a = c.ast;

        match a.kind(node) {
            Kind::ImportEqualsDeclaration => {
                let symbol = c.get_symbol_of_declaration(node);
                return self.is_alias_resolved_to_value(c, symbol, false);
            }
            Kind::ImportClause
            | Kind::NamespaceImport
            | Kind::ImportSpecifier
            | Kind::ExportSpecifier => {
                let symbol = c.get_symbol_of_declaration(node);
                return !symbol.is_nil() && self.is_alias_resolved_to_value(c, symbol, true);
            }
            Kind::ExportDeclaration => {
                let export_clause = a.as_export_declaration(node).export_clause;
                return !export_clause.is_nil()
                    && (is_namespace_export(a, export_clause)
                        || some(a.elements(export_clause).as_slice(), |element| {
                            self.is_value_alias_declaration_worker(c, element)
                        }));
            }
            Kind::ExportAssignment => {
                if !a.expression(node).is_nil() && a.kind(a.expression(node)) == Kind::Identifier {
                    let symbol = c.get_symbol_of_declaration(node);
                    return self.is_alias_resolved_to_value(c, symbol, true);
                }
                return true;
            }
            Kind::BinaryExpression => {
                if is_common_js_module_exports(a, node)
                    && is_identifier(a, a.as_binary_expression(node).right)
                {
                    let symbol = c.get_symbol_of_declaration(node);
                    return self.is_alias_resolved_to_value(c, symbol, true);
                }
            }
            _ => {}
        }
        false
    }

    pub fn is_alias_resolved_to_value(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        exclude_type_only_values: bool,
    ) -> bool {
        let a = c.ast;
        if symbol.is_nil() {
            return false;
        }
        let value_declaration = a.sym(symbol).value_declaration;
        if !value_declaration.is_nil() {
            let container = get_source_file_of_node(a, value_declaration);
            if !container.is_nil() {
                let file_symbol = c.get_symbol_of_declaration(container);
                // Ensures cjs export assignment is setup, since this symbol may point at, and merge with, the file itself: without it the merge may not have occurred yet, and the flags check below would miss the flags that the merge adds.
                c.resolve_external_module_symbol(file_symbol, false);
            }
        }
        let resolved = c.resolve_alias(symbol);
        let target = c.get_export_symbol_of_value_symbol_if_exported(resolved);
        if target == c.unknown_symbol {
            return !exclude_type_only_values || c.get_type_only_alias_declaration(symbol).is_nil();
        }
        // const enums and modules that contain only const enums are not considered values from the emit perspective unless 'preserveConstEnums' option is set to true
        c.get_symbol_flags_ex(symbol, exclude_type_only_values, true)
            .intersects(SymbolFlags::VALUE)
            && (c.compiler_options.should_preserve_const_enums()
                || !is_const_enum_or_const_enum_only_module(a, target))
    }

    pub fn is_top_level_value_import_equals_with_entity_name(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> bool {
        let a = c.ast;
        if !c.can_collect_symbol_alias_accessibility_data {
            return true;
        }
        if !is_parse_tree_node(a, node)
            || a.kind(node) != Kind::ImportEqualsDeclaration
            || a.kind(a.parent(node)) != Kind::SourceFile
        {
            return false;
        }
        if is_import_equals_declaration(a, node) {
            let module_reference = a.as_import_equals_declaration(node).module_reference;
            if node_is_missing(a, module_reference)
                || a.kind(module_reference) == Kind::ExternalModuleReference
            {
                return false;
            }
        }

        let symbol = c.get_symbol_of_declaration(node);
        self.is_alias_resolved_to_value(c, symbol, false)
    }

    pub fn mark_linked_references_recursively(self, c: &mut Checker<'_>, file: NodeId) {
        // The closure `visit` of upstream. The walk answers false and records the stack limit where Go's stack grows.
        fn visit(c: &mut Checker<'_>, n: NodeId) -> bool {
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            let a = c.ast;
            if is_import_equals_declaration(a, n)
                && !a.modifier_flags(n).intersects(ModifierFlags::EXPORT)
            {
                // These are deferred and marked in a chain when referenced
                return false;
            }
            if is_import_declaration(a, n) {
                // likewise, these are ultimately what get marked by calls on other nodes - we want to skip them
                return false;
            }
            c.mark_linked_references(n, ReferenceHint::UNSPECIFIED, SymbolId::NIL, TypeId::NIL);
            a.for_each_child(n, &mut |child| visit(c, child));
            false
        }

        let a = c.ast;
        if !is_parse_tree_node(a, file) {
            return;
        }

        if !file.is_nil() {
            a.for_each_child(file, &mut |child| visit(c, child));
        }
    }

    pub fn get_external_module_file_from_declaration(
        self,
        c: &mut Checker<'_>,
        declaration: NodeId,
    ) -> NodeId {
        if !is_parse_tree_node(c.ast, declaration) {
            return NodeId::NIL;
        }

        c.get_external_module_file_from_declaration(declaration)
    }

    // The resolver holds the options and function pointers only, so it is made at each call and the checker is its host.
    pub fn get_reference_resolver<'a>(
        self,
        compiler_options: &'a CompilerOptions,
    ) -> impl ReferenceResolver<'a, Checker<'a>> {
        new_reference_resolver(
            compiler_options,
            ReferenceResolverHooks {
                resolve_name: Some(Checker::resolve_name),
                get_resolved_symbol: Some(Checker::get_resolved_symbol_or_nil),
                get_merged_symbol: Some(|c: &mut Checker<'a>, symbol: SymbolId| {
                    c.get_merged_symbol(symbol)
                }),
                get_parent_of_symbol: Some(Checker::get_parent_of_symbol),
                get_symbol_of_declaration: Some(Checker::get_symbol_of_declaration),
                get_type_only_alias_declaration: Some(Checker::get_type_only_alias_declaration_ex),
                get_export_symbol_of_value_symbol_if_exported: Some(
                    |c: &mut Checker<'a>, symbol: SymbolId| {
                        c.get_export_symbol_of_value_symbol_if_exported(symbol)
                    },
                ),
                get_element_access_expression_name: Some(try_get_element_access_expression_name),
            },
        )
    }

    // The result is a SourceFile, a ModuleDeclaration or an EnumDeclaration.
    pub fn get_referenced_export_container(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
        prefix_locals: bool,
    ) -> NodeId {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return NodeId::NIL;
        }

        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_referenced_export_container(a, c, node, prefix_locals)
    }

    pub fn set_referenced_import_declaration(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
        ref_: NodeId,
    ) {
        let links = c.emit_resolver.jsx_links.get(node);
        c.emit_resolver.jsx_links[links].import_ref = ref_;
    }

    pub fn get_referenced_import_declaration(self, c: &mut Checker<'_>, node: NodeId) -> NodeId {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            let links = c.emit_resolver.jsx_links.get(node);
            return c.emit_resolver.jsx_links[links].import_ref;
        }

        let symbol = c.get_referenced_value_or_alias_symbol(node);
        if is_non_local_alias(a, symbol, SymbolFlags::VALUE)
            && c.get_type_only_alias_declaration_ex(symbol, SymbolFlags::VALUE)
                .is_nil()
        {
            return c.get_declaration_of_alias_symbol(symbol);
        }
        NodeId::NIL
    }

    pub fn get_referenced_value_declaration(self, c: &mut Checker<'_>, node: NodeId) -> NodeId {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return NodeId::NIL;
        }

        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_referenced_value_declaration(a, c, node)
    }

    pub fn get_referenced_value_declaration_unsafe(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> NodeId {
        let a = c.ast;
        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_referenced_value_declaration(a, c, node)
    }

    pub fn get_referenced_value_declarations(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> Vec<NodeId> {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return Vec::new();
        }

        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_referenced_value_declarations(a, c, node)
    }

    // IsNameResolvable returns `true` if the given `name` resolves to any symbol at `location`
    pub fn is_name_resolvable(self, c: &mut Checker<'_>, location: NodeId, name: &[u8]) -> bool {
        let symbol = c.resolve_name(
            location,
            name,
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            MessageId::NIL,
            false,
            false,
        );
        !symbol.is_nil()
    }

    pub fn get_element_access_expression_name<'a>(
        self,
        c: &mut Checker<'a>,
        expression: NodeId,
    ) -> Text<'a> {
        if !is_parse_tree_node(c.ast, expression) {
            return b"";
        }

        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_element_access_expression_name(c, expression)
    }

    pub fn get_referenced_member_value_declaration(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> NodeId {
        let a = c.ast;
        if !is_parse_tree_node(a, node) {
            return NodeId::NIL;
        }

        let mut resolver = self.get_reference_resolver(c.compiler_options);
        resolver.get_referenced_member_value_declaration(a, c, node)
    }

    pub fn create_return_type_of_signature_declaration(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        signature_declaration: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        let a = c.ast;
        let original = emit_context.parse_node(a, signature_declaration);
        if original.is_nil() {
            return new_node_factory(a, emit_context).new_keyword_type_node(Kind::AnyKeyword);
        }

        let request_node_builder = RequestNodeBuilder;
        request_node_builder.serialize_return_type_for_signature(
            c,
            original,
            enclosing_declaration,
            flags,
            internal_flags,
            tracker,
        )
    }

    pub fn create_type_parameters_of_signature_declaration(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        signature_declaration: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> Vec<NodeId> {
        let original = emit_context.parse_node(c.ast, signature_declaration);
        if original.is_nil() {
            return Vec::new();
        }

        let request_node_builder = RequestNodeBuilder;
        request_node_builder.serialize_type_parameters_for_signature(
            c,
            original,
            enclosing_declaration,
            flags,
            internal_flags,
            tracker,
        )
    }

    pub fn create_type_of_declaration(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        declaration: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        let a = c.ast;
        let original = emit_context.parse_node(a, declaration);
        if original.is_nil() {
            return new_node_factory(a, emit_context).new_keyword_type_node(Kind::AnyKeyword);
        }

        let request_node_builder = RequestNodeBuilder;
        // Get type of the symbol if this is the valid symbol otherwise get type at location
        let symbol = c.get_symbol_of_declaration(declaration);
        request_node_builder.serialize_type_for_declaration(
            c,
            declaration,
            symbol,
            enclosing_declaration,
            flags | Flags::MULTILINE_OBJECT_LITERALS,
            internal_flags,
            tracker,
        )
    }

    pub fn create_literal_const_value(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        node: NodeId,
        tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        let a = c.ast;
        let node = emit_context.parse_node(a, node);
        let symbol = c.get_symbol_of_declaration(node);
        let t = c.get_type_of_symbol(symbol);
        if t.is_nil() {
            // Upstream asks how a symbol can have no type.
            return NodeId::NIL;
        }

        let mut enum_result = NodeId::NIL;
        if c.types[t].flags.intersects(TypeFlags::ENUM_LIKE) {
            let request_node_builder = RequestNodeBuilder;
            let enum_symbol = c.types[t].symbol;
            // What about regularTrueType/regularFalseType - since those aren't fresh, we never make initializers from them
            enum_result = request_node_builder.symbol_to_expression(
                c,
                enum_symbol,
                SymbolFlags::VALUE,
                node,
                Flags::NONE,
                InternalFlags::NONE,
                tracker,
            );
        } else if t == c.true_type {
            enum_result =
                new_node_factory(a, emit_context).new_keyword_expression(Kind::TrueKeyword);
        } else if t == c.false_type {
            enum_result =
                new_node_factory(a, emit_context).new_keyword_expression(Kind::FalseKeyword);
        }
        if !enum_result.is_nil() {
            return enum_result;
        }
        if !c.types[t].flags.intersects(TypeFlags::LITERAL) {
            // non-literal type
            return NodeId::NIL;
        }
        match c.as_literal_type(t).value.clone() {
            LiteralValue::String(value) => {
                new_node_factory(a, emit_context).new_string_literal(value, TokenFlags::NONE)
            }
            LiteralValue::Number(value) => {
                let value = Number(value);
                if value.is_inf() {
                    let infinity = new_node_factory(a, emit_context).new_identifier(b"Infinity");
                    if value > Number(0.0) {
                        return infinity;
                    }
                    return new_node_factory(a, emit_context)
                        .new_prefix_unary_expression(Kind::MinusToken, infinity);
                }
                if value.is_nan() {
                    return new_node_factory(a, emit_context).new_identifier(b"NaN");
                }
                let text = value.string();
                if value.abs() != value {
                    // negative
                    let literal = new_node_factory(a, emit_context)
                        .new_numeric_literal(text.get(1..).unwrap_or(&[]), TokenFlags::NONE);
                    return new_node_factory(a, emit_context)
                        .new_prefix_unary_expression(Kind::MinusToken, literal);
                }
                new_node_factory(a, emit_context).new_numeric_literal(&text, TokenFlags::NONE)
            }
            LiteralValue::BigInt(value) => {
                let mut text = pseudo_big_int_to_string(value);
                text.push(b'n');
                new_node_factory(a, emit_context).new_big_int_literal(&text, TokenFlags::NONE)
            }
            LiteralValue::Boolean(value) => {
                let kind = if value {
                    Kind::TrueKeyword
                } else {
                    Kind::FalseKeyword
                };
                new_node_factory(a, emit_context).new_keyword_expression(kind)
            }
            LiteralValue::Nil => c.fail("unhandled literal const value kind"),
        }
    }

    pub fn create_type_of_expression(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        expression: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        let a = c.ast;
        let expression = emit_context.parse_node(a, expression);
        if expression.is_nil() {
            return new_node_factory(a, emit_context).new_keyword_type_node(Kind::AnyKeyword);
        }

        let request_node_builder = RequestNodeBuilder;
        request_node_builder.serialize_type_for_expression(
            c,
            expression,
            enclosing_declaration,
            flags | Flags::MULTILINE_OBJECT_LITERALS,
            internal_flags,
            tracker,
        )
    }

    pub fn create_late_bound_index_signatures(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        container: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> Vec<NodeId> {
        let a = c.ast;
        let container = emit_context.parse_node(a, container);

        let sym = a.symbol(container);
        let static_type = c.get_type_of_symbol(sym);
        let static_infos = c.get_index_infos_of_type(static_type);
        let instance_index_symbol = c.get_index_symbol(sym);
        let mut instance_infos = List::NIL;
        if !instance_index_symbol.is_nil() {
            let members = c.get_members_of_symbol(sym);
            // Upstream collects the values of the members, a map: the table is read in insertion order.
            let mut sibling_symbols: Vec<SymbolId> = Vec::new();
            let mut position = 0;
            while let Some((_, sibling)) = a.table_entry_at(members, position) {
                position += 1;
                sibling_symbols.push(sibling);
            }
            instance_infos =
                c.get_index_infos_of_index_symbol(instance_index_symbol, &sibling_symbols);
        }

        let request_node_builder = RequestNodeBuilder;

        let mut result: Vec<NodeId> = Vec::new();
        for (i, info_list) in [static_infos, instance_infos].into_iter().enumerate() {
            let is_static = i == 0;
            if info_list.len() == 0 {
                continue;
            }
            for info in info_list.iter() {
                if !c.index_infos[info].declaration.is_nil() {
                    continue;
                }
                if info == c.any_base_type_index_info {
                    // inherited, but looks like a late-bound signature because it has no declarations
                    continue;
                }
                let components = c.index_infos[info].components;
                if components.len() != 0 {
                    // Upstream notes that getObjectLiteralIndexInfo does not yet add late bound components to index signatures.
                    let all_component_computed_names_serializable = !enclosing_declaration.is_nil()
                        && every(components.as_slice(), |component| {
                            let name = a.name(component);
                            !name.is_nil()
                                && is_computed_property_name(a, name)
                                && is_entity_name_expression(a, a.expression(name))
                                && self
                                    .is_entity_name_visible(
                                        c,
                                        a.expression(name),
                                        enclosing_declaration,
                                        false,
                                    )
                                    .accessibility
                                    == SymbolAccessibility::Accessible
                        });
                    if all_component_computed_names_serializable {
                        for component in components.iter() {
                            if c.has_late_bindable_name(component) {
                                // skip late bound props that contribute to the index signature - they'll be preserved via other means
                                continue;
                            }

                            let first_identifier =
                                get_first_identifier(a, a.expression(a.name(component)));
                            let name = c.resolve_name(
                                first_identifier,
                                a.text(first_identifier),
                                SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
                                MessageId::NIL,
                                true,
                                false,
                            );
                            if !name.is_nil() {
                                tracker.track_symbol(
                                    name,
                                    enclosing_declaration,
                                    SymbolFlags::VALUE,
                                );
                            }

                            let mut mods: Vec<NodeId> = Vec::new();
                            if is_static {
                                let modifier = new_node_factory(a, emit_context)
                                    .new_modifier(Kind::StaticKeyword);
                                mods.push(modifier);
                            }
                            if c.index_infos[info].is_readonly {
                                let modifier = new_node_factory(a, emit_context)
                                    .new_modifier(Kind::ReadonlyKeyword);
                                mods.push(modifier);
                            }
                            let modifiers = if mods.is_empty() {
                                ModifierListId::NIL
                            } else {
                                new_node_factory(a, emit_context).new_modifier_list(&mods)
                            };
                            let component_type = c.get_type_of_symbol(a.symbol(component));
                            let type_node = request_node_builder.type_to_type_node(
                                c,
                                component_type,
                                enclosing_declaration,
                                flags,
                                internal_flags,
                                tracker,
                            );
                            let decl = new_node_factory(a, emit_context).new_property_declaration(
                                modifiers,
                                a.name(component),
                                a.question_token(component),
                                type_node,
                                NodeId::NIL,
                            );
                            result.push(decl);
                        }
                        continue;
                    }
                }
                let mut node = request_node_builder.index_info_to_index_signature_declaration(
                    c,
                    info,
                    enclosing_declaration,
                    flags,
                    internal_flags,
                    tracker,
                );
                if !node.is_nil() && is_static {
                    let static_modifier =
                        new_node_factory(a, emit_context).new_modifier(Kind::StaticKeyword);
                    let mut mod_nodes = vec![static_modifier];
                    mod_nodes.extend_from_slice(a.modifier_nodes(node).as_slice());
                    let mods = new_node_factory(a, emit_context).new_modifier_list(&mod_nodes);
                    node = new_node_factory(a, emit_context).update_index_signature_declaration(
                        node,
                        mods,
                        a.parameter_list(node),
                        a.type_node(node),
                    );
                }
                if !node.is_nil() {
                    result.push(node);
                }
            }
        }
        result
    }

    pub fn get_effective_declaration_flags(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
        flags: ModifierFlags,
    ) -> ModifierFlags {
        c.get_effective_declaration_flags(node, flags)
    }

    pub fn get_resolution_mode_override(self, c: &mut Checker<'_>, node: NodeId) -> ResolutionMode {
        c.get_resolution_mode_override(node, false)
    }

    pub fn get_constant_value<'a>(self, c: &mut Checker<'a>, node: NodeId) -> LiteralValue<'a> {
        c.get_constant_value(node)
    }

    pub fn get_type_reference_serialization_kind(
        self,
        c: &mut Checker<'_>,
        type_name: NodeId,
        location: NodeId,
    ) -> TypeReferenceSerializationKind {
        let a = c.ast;
        if type_name.is_nil() || location.is_nil() {
            return TypeReferenceSerializationKind::Unknown;
        }

        // Resolve the symbol as a value to ensure the type can be reached at runtime during emit.
        let mut is_type_only = false;
        if is_qualified_name(a, type_name) {
            let root_value_symbol = c.resolve_entity_name(
                get_first_identifier(a, type_name),
                SymbolFlags::VALUE,
                true,
                true,
                location,
            );

            if !root_value_symbol.is_nil() && a.sym(root_value_symbol).declarations.len() > 0 {
                is_type_only = every(
                    a.sym(root_value_symbol).declarations.as_slice(),
                    |declaration| is_type_only_import_or_export_declaration(a, declaration),
                );
            }
        }
        let value_symbol =
            c.resolve_entity_name(type_name, SymbolFlags::VALUE, true, true, location);
        let mut resolved_value_symbol = value_symbol;
        if !value_symbol.is_nil() && a.sym(value_symbol).flags.intersects(SymbolFlags::ALIAS) {
            resolved_value_symbol = c.resolve_alias(value_symbol);
        }

        is_type_only = is_type_only
            || (!value_symbol.is_nil()
                && !c
                    .get_type_only_alias_declaration_ex(value_symbol, SymbolFlags::VALUE)
                    .is_nil());

        // Resolve the symbol as a type so that we can provide a more useful hint for the type serializer.
        let type_symbol = c.resolve_entity_name(type_name, SymbolFlags::TYPE, true, true, location);
        let mut resolved_type_symbol = type_symbol;
        if !type_symbol.is_nil() && a.sym(type_symbol).flags.intersects(SymbolFlags::ALIAS) {
            resolved_type_symbol = c.resolve_alias(type_symbol);
        }
        // In case the value symbol can't be resolved (e.g. because of missing declarations), use type symbol for reachability check.
        is_type_only = is_type_only
            || (!type_symbol.is_nil()
                && !c
                    .get_type_only_alias_declaration_ex(type_symbol, SymbolFlags::TYPE)
                    .is_nil());

        if !resolved_value_symbol.is_nil() && resolved_value_symbol == resolved_type_symbol {
            let global_promise_symbol = c.get_global_promise_constructor_symbol();
            if !global_promise_symbol.is_nil() && resolved_value_symbol == global_promise_symbol {
                return TypeReferenceSerializationKind::Promise;
            }

            let constructor_type = c.get_type_of_symbol(resolved_value_symbol);
            if !constructor_type.is_nil() && c.is_constructor_type(constructor_type) {
                if is_type_only {
                    return TypeReferenceSerializationKind::TypeWithCallSignature;
                }
                return TypeReferenceSerializationKind::TypeWithConstructSignatureAndValue;
            }
        }

        // We might not be able to resolve type symbol so use unknown type in that case (eg error case)
        if resolved_type_symbol.is_nil() {
            if is_type_only {
                return TypeReferenceSerializationKind::ObjectType;
            }
            return TypeReferenceSerializationKind::Unknown;
        }

        let type_ = c.get_declared_type_of_symbol(resolved_type_symbol);
        if c.is_error_type(type_) {
            if is_type_only {
                return TypeReferenceSerializationKind::ObjectType;
            }
            return TypeReferenceSerializationKind::Unknown;
        }

        if c.types[type_].flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
            TypeReferenceSerializationKind::ObjectType
        } else if c.is_type_assignable_to_kind(
            type_,
            TypeFlags::VOID | TypeFlags::NULLABLE | TypeFlags::NEVER,
        ) {
            TypeReferenceSerializationKind::VoidNullableOrNeverType
        } else if c.is_type_assignable_to_kind(type_, TypeFlags::BOOLEAN_LIKE) {
            TypeReferenceSerializationKind::BooleanType
        } else if c.is_type_assignable_to_kind(type_, TypeFlags::NUMBER_LIKE) {
            TypeReferenceSerializationKind::NumberLikeType
        } else if c.is_type_assignable_to_kind(type_, TypeFlags::BIG_INT_LIKE) {
            TypeReferenceSerializationKind::BigIntLikeType
        } else if c.is_type_assignable_to_kind(type_, TypeFlags::STRING_LIKE) {
            TypeReferenceSerializationKind::StringLikeType
        } else if is_tuple_type(c, type_) {
            TypeReferenceSerializationKind::ArrayLikeType
        } else if c.is_type_assignable_to_kind(type_, TypeFlags::ES_SYMBOL_LIKE) {
            TypeReferenceSerializationKind::ESSymbolType
        } else if c.is_function_type(type_) {
            TypeReferenceSerializationKind::TypeWithCallSignature
        } else if c.is_array_type(type_) {
            TypeReferenceSerializationKind::ArrayLikeType
        } else {
            TypeReferenceSerializationKind::ObjectType
        }
    }

    // Upstream does not lock here: it is only called via error reporters invoked via node builder calls to the symbol tracker already within locked contexts.
    pub fn get_properties_of_container_function<'a>(
        self,
        c: &mut Checker<'a>,
        node: NodeId,
    ) -> List<'a, SymbolId> {
        if node.is_nil() {
            return c.list_of(&[]);
        }
        let s = c.get_symbol_of_declaration(node);
        if s.is_nil() {
            return c.list_of(&[]);
        }
        let t = c.get_type_of_symbol(s);
        c.get_properties_of_type(t)
    }

    pub fn try_js_type_node_to_type_node(
        self,
        c: &mut Checker<'_>,
        emit_context: &mut EmitContext,
        type_node: NodeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: &mut dyn SymbolTracker,
    ) -> NodeId {
        let type_node = emit_context.parse_node(c.ast, type_node);

        let request_node_builder = RequestNodeBuilder;
        request_node_builder.try_js_type_node_to_type_node(
            c,
            type_node,
            enclosing_declaration,
            flags,
            internal_flags,
            tracker,
        )
    }

    // IsThisPropertyAssignmentDeclarationRedundant reports whether a JS `this.<name> = ...` expando assignment should be omitted from declaration emit because an `extends` base type (not an `implements` clause) already provides the member: an inherited accessor or method always counts, and an inherited property counts when its readonly-ness, optionality and type are identical.
    pub fn is_this_property_assignment_declaration_redundant(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> bool {
        let a = c.ast;
        if node.is_nil() {
            return false;
        }

        let s = c.get_symbol_of_declaration(node);
        if s.is_nil() || a.sym(s).parent.is_nil() {
            return false;
        }
        let parent_type = c.get_declared_type_of_symbol(a.sym(s).parent);
        if parent_type.is_nil() {
            return false;
        }
        for base in c.get_base_types(parent_type).iter() {
            let base_prop = c.get_property_of_type(base, a.sym(s).name);
            if base_prop.is_nil() {
                continue;
            }
            if a.sym(base_prop)
                .flags
                .intersects(SymbolFlags::ACCESSOR | SymbolFlags::METHOD | SymbolFlags::FUNCTION)
            {
                return true;
            }
            if c.is_readonly_symbol(base_prop) == c.is_readonly_symbol(s)
                && (a.sym(s).flags & SymbolFlags::OPTIONAL)
                    == (a.sym(base_prop).flags & SymbolFlags::OPTIONAL)
            {
                let source = c.get_type_of_symbol(s);
                let target = c.get_type_of_symbol(base_prop);
                if c.is_type_identical_to(source, target) {
                    return true;
                }
            }
        }
        false
    }
}

// tryGetElementAccessExpressionName as the hook of the reference resolver takes it: a name that the checker built is kept with the texts of the checker.
fn try_get_element_access_expression_name<'a>(
    c: &mut Checker<'a>,
    node: NodeId,
) -> (Text<'a>, bool) {
    let (name, ok) = c.try_get_element_access_expression_name(node);
    let name = match name {
        Cow::Borrowed(name) => name,
        Cow::Owned(name) => c.text(&name),
    };
    (name, ok)
}

impl<'a> Checker<'a> {
    // services.go GetConstantValue: the one function of that file that the emit resolver calls. The result is upstream's `any`: nil, a string or a number.
    pub fn get_constant_value(&mut self, node: NodeId) -> LiteralValue<'a> {
        let a = self.ast;
        if a.kind(node) == Kind::EnumMember {
            return self.get_enum_member_value(node).value;
        }

        let links = self.symbol_node_links.get(node);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            // ensure cached resolved symbol is set
            self.check_expression_cached(node);
        }
        let mut symbol = self.symbol_node_links[links].resolved_symbol;
        if symbol.is_nil() && is_entity_name_expression(a, node) {
            symbol = self.resolve_entity_name(node, SymbolFlags::VALUE, true, false, NodeId::NIL);
        }
        if !symbol.is_nil() && a.sym(symbol).flags.intersects(SymbolFlags::ENUM_MEMBER) {
            // inline property\index accesses only for const enums
            let member = a.sym(symbol).value_declaration;
            if is_enum_const(a, a.parent(member)) {
                return self.get_enum_member_value(member).value;
            }
        }

        LiteralValue::Nil
    }
}
