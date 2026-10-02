// checker/utilities.go: the syntactic predicates of the checker, the order of symbols, nodes and types that sorts the constituents of a union, the operator classes, the names of late-bound and reserved members, the feature map and the details of the module resolution diagnostics. A function that reads the tree takes the tree context first, one that reads a type takes the checker first, and a diagnostic is made in the store of the checker.
use crate::ast::{
    self, Arg, Ast, CheckFlags, DiagnosticId, FindAncestorResult,
    INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, INTERNAL_SYMBOL_NAME_INDEX, INTERNAL_SYMBOL_NAME_PREFIX,
    Kind, ModifierFlags, NodeFlags, NodeId, NodeListId, OuterExpressionKinds, SymbolFlags,
    SymbolId, SymbolTableId, TokenFlags, class_or_constructor_parameter_is_decorated,
    find_ancestor, find_ancestor_or_quit, get_assignment_target, get_combined_modifier_flags,
    get_containing_class, get_extends_heritage_clause_elements,
    get_immediately_invoked_function_expression, get_property_name_for_property_name_node,
    get_root_declaration, get_source_file_of_node, has_accessor_modifier, has_modifier,
    has_question_token, has_static_modifier, has_syntactic_modifier, is_access_expression,
    is_array_literal_expression, is_assertion_expression, is_assignment_expression,
    is_assignment_operator, is_binary_expression, is_bindable_static_access_expression,
    is_bindable_static_name_expression, is_call_expression, is_call_or_new_expression,
    is_catch_clause, is_class_element, is_class_like, is_computed_property_name, is_decorator,
    is_element_access_expression, is_expando_property_declaration, is_export_assignment,
    is_export_specifier, is_expression_statement, is_external_module_augmentation,
    is_for_statement, is_function_like, is_function_like_or_class_static_block_declaration,
    is_get_accessor_declaration, is_global_source_file, is_identifier, is_import_declaration,
    is_in_js_file, is_interface_declaration, is_jsx_namespaced_name, is_jsx_opening_like_element,
    is_logical_binary_operator, is_logical_or_coalescing_assignment_operator, is_module_block,
    is_name_of_heritage_clause_type_reference, is_namespace_export, is_non_null_expression,
    is_object_literal_expression, is_outer_expression, is_parameter_declaration,
    is_parameter_property_declaration, is_parenthesized_expression, is_part_of_type_node,
    is_private_identifier_class_element_declaration, is_property_access_expression,
    is_property_access_or_qualified_name, is_property_assignment, is_property_declaration,
    is_property_name, is_property_signature_declaration, is_prototype_access, is_qualified_name,
    is_set_accessor_declaration, is_shorthand_property_assignment, is_static,
    is_tagged_template_expression, is_this_parameter, is_type_literal_node,
    is_type_or_js_type_alias_declaration, is_type_reference_node, is_var_const,
    is_variable_declaration, is_variable_declaration_initialized_to_require,
    is_variable_declaration_list, is_variable_statement, is_void_expression, skip_parentheses,
    walk_up_parenthesized_expressions,
};
use crate::binder::{ContainerFlags, get_container_flags};
use crate::checker::types::checker_flags;
use crate::checker::{
    Checker, LiteralValue, MinArgumentCountFlags, ObjectFlags, Program, SignatureId, Targets,
    TypeFlags, TypeId, TypeMapper, TypeMapperId, get_boolean_literal_value,
    get_number_literal_value, get_string_literal_value, signature_has_rest_parameter,
};
use crate::core::{
    List, Map, ResolutionMode, ScriptKind, Text, TextRange, every, filter, find, find_index,
    first_or_nil, if_else, new_text_range, some,
};
use crate::diagnostics::{self, MessageId};
use crate::internal::FaultKind;
use crate::jsnum::{Number, PseudoBigInt, from_string, new_pseudo_big_int, parse_pseudo_big_int};
use crate::module::{get_types_package_name, mangle_scoped_package_name};
use crate::printer::{QuoteChar, escape_string};
use crate::scanner::{
    get_error_range_for_node, get_text_of_node, is_intrinsic_jsx_name, new_scanner, skip_trivia,
};
use crate::stringutil::util::{strings, utf8};
use crate::tspath::{
    EXTENSION_DTS, EXTENSION_JS, EXTENSION_MJS, EXTENSION_MTS, EXTENSION_TS, combine_paths,
    try_get_extension_from_path,
};
use bun_core::StackCheck;
use std::borrow::Borrow;
use std::cell::Cell;
use std::collections::BTreeSet;

// Go stacks grow: a walk that follows the depth of the tree ends with an internal diagnostic when the thread has no stack left.
fn stack_is_safe(a: Ast<'_>, node: NodeId) -> bool {
    if StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
    false
}

impl<'a> Checker<'a> {
    // NewDiagnosticForNode is a free function upstream: a diagnostic of the checker is made in its store.
    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let a = self.ast;
        let mut file = NodeId::NIL;
        let mut loc = TextRange::default();
        if !node.is_nil() {
            file = get_source_file_of_node(a, node);
            loc = get_error_range_for_node(a, file, node);
        }
        self.diagnostic_store
            .new_diagnostic(file, loc, message, args)
    }

    pub fn new_diagnostic_chain_for_node(
        &mut self,
        chain: DiagnosticId,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        if !chain.is_nil() {
            return self
                .diagnostic_store
                .new_diagnostic_chain(chain, message, args);
        }
        self.new_diagnostic_for_node(node, message, args)
    }
}

// The one map that upstream searches this way is a symbol table: its entries are visited in insertion order, where the order of a Go map is random.
pub fn find_in_map(
    a: Ast<'_>,
    m: SymbolTableId,
    mut predicate: impl FnMut(SymbolId) -> bool,
) -> SymbolId {
    let mut position = 0;
    while let Some((_, value)) = a.table_entry_at(m, position) {
        position += 1;
        if predicate(value) {
            return value;
        }
    }
    SymbolId::NIL
}

pub fn token_is_identifier_or_keyword(token: Kind) -> bool {
    token >= Kind::Identifier
}

pub fn token_is_identifier_or_keyword_or_greater_than(token: Kind) -> bool {
    token == Kind::GreaterThanToken || token_is_identifier_or_keyword(token)
}

pub fn has_override_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::OVERRIDE)
}

pub fn has_async_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::ASYNC)
}

pub fn get_selected_modifier_flags(
    a: Ast<'_>,
    node: NodeId,
    flags: ModifierFlags,
) -> ModifierFlags {
    a.modifier_flags(node) & flags
}

pub fn has_readonly_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_modifier(a, node, ModifierFlags::READONLY)
}

pub fn is_static_private_identifier_property(a: Ast<'_>, s: SymbolId) -> bool {
    let value_declaration = a.sym(s).value_declaration;
    !value_declaration.is_nil()
        && is_private_identifier_class_element_declaration(a, value_declaration)
        && is_static(a, value_declaration)
}

pub fn is_empty_object_literal(a: Ast<'_>, expression: NodeId) -> bool {
    is_object_literal_expression(a, expression) && a.properties(expression).len() == 0
}

checker_flags!(AssignmentKind: i32 {
    // NONE = 0
    DEFINITE = 1,
    COMPOUND = 2,
});

// BinaryExpression | PrefixUnaryExpression | PostfixUnaryExpression | ForInOrOfStatement
pub type AssignmentTarget = NodeId;

pub fn get_assignment_target_kind(a: Ast<'_>, node: NodeId) -> AssignmentKind {
    let target = get_assignment_target(a, node);
    if target.is_nil() {
        return AssignmentKind::NONE;
    }
    match a.kind(target) {
        Kind::BinaryExpression => {
            let binary_operator = a.kind(a.as_binary_expression(target).operator_token);
            if binary_operator == Kind::EqualsToken
                || is_logical_or_coalescing_assignment_operator(binary_operator)
            {
                return AssignmentKind::DEFINITE;
            }
            AssignmentKind::COMPOUND
        }
        Kind::PrefixUnaryExpression | Kind::PostfixUnaryExpression => AssignmentKind::COMPOUND,
        Kind::ForInStatement | Kind::ForOfStatement => AssignmentKind::DEFINITE,
        _ => a.unhandled("Unhandled case in getAssignmentTargetKind", target),
    }
}

pub fn is_delete_target(a: Ast<'_>, node: NodeId) -> bool {
    if !is_access_expression(a, node) {
        return false;
    }
    let node = walk_up_parenthesized_expressions(a, a.parent(node));
    !node.is_nil() && a.kind(node) == Kind::DeleteExpression
}

pub fn is_in_compound_like_assignment(a: Ast<'_>, node: NodeId) -> bool {
    let target = get_assignment_target(a, node);
    !target.is_nil()
        && is_assignment_expression(a, target, true)
        && is_compound_like_assignment(a, target)
}

pub fn is_compound_like_assignment(a: Ast<'_>, assignment: NodeId) -> bool {
    let right = skip_parentheses(a, a.as_binary_expression(assignment).right);
    a.kind(right) == Kind::BinaryExpression
        && is_shift_operator_or_higher(a.kind(a.as_binary_expression(right).operator_token))
}

pub fn is_const_type_reference(a: Ast<'_>, node: NodeId) -> bool {
    is_type_reference_node(a, node)
        && a.type_arguments(node).len() == 0
        && is_identifier(a, a.as_type_reference_node(node).type_name)
        && a.text(a.as_type_reference_node(node).type_name) == b"const"
}

// isConstTypeReferenceName reports whether node is the `const` type name of a `const` assertion (`x as const` / `<const>x`), which must not be resolved as a real name.
pub fn is_const_type_reference_name(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && is_identifier(a, node)
        && !a.parent(node).is_nil()
        && is_const_type_reference(a, a.parent(node))
        && !a.parent(a.parent(node)).is_nil()
        && is_assertion_expression(a, a.parent(a.parent(node)))
}

// isExportAssignmentExpressionName reports whether node is (the root entity name of) the expression of an `export =` / `export default` assignment. Referencing a namespace or type-only name there is legal, and checkExportAssignment decides whether it is an error, so checkIdentifier must not report a value-usage error for it.
pub fn is_export_assignment_expression_name(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() {
        return false;
    }
    let mut current = node;
    while !a.parent(current).is_nil() && is_property_access_or_qualified_name(a, a.parent(current))
    {
        current = a.parent(current);
    }
    let parent = a.parent(current);
    !parent.is_nil() && is_export_assignment(a, parent) && a.expression(parent) == current
}

pub fn get_single_variable_of_variable_statement(a: Ast<'_>, node: NodeId) -> NodeId {
    if !is_variable_statement(a, node) {
        return NodeId::NIL;
    }
    let declaration_list = a.as_variable_statement(node).declaration_list;
    let declarations = a
        .as_variable_declaration_list(declaration_list)
        .declarations;
    first_or_nil(a.nodes(declarations).as_slice())
}

pub fn is_type_reference_identifier(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    while a.kind(a.parent(node)) == Kind::QualifiedName {
        node = a.parent(node);
    }
    is_type_reference_node(a, a.parent(node))
}

pub fn is_in_type_query(a: Ast<'_>, node: NodeId) -> bool {
    // TypeScript 1.0 spec (April 2014): 3.6.3 A type query consists of the keyword typeof followed by an expression. The expression is restricted to a single identifier or a sequence of identifiers separated by periods
    !find_ancestor_or_quit(a, node, |n| match a.kind(n) {
        Kind::TypeQuery => FindAncestorResult::TRUE,
        Kind::Identifier | Kind::QualifiedName => FindAncestorResult::FALSE,
        _ => FindAncestorResult::QUIT,
    })
    .is_nil()
}

pub fn can_have_locals(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ArrowFunction
            | Kind::Block
            | Kind::CallSignature
            | Kind::CaseBlock
            | Kind::CatchClause
            | Kind::ClassStaticBlockDeclaration
            | Kind::ConditionalType
            | Kind::Constructor
            | Kind::ConstructorType
            | Kind::ConstructSignature
            | Kind::ForStatement
            | Kind::ForInStatement
            | Kind::ForOfStatement
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::FunctionType
            | Kind::GetAccessor
            | Kind::IndexSignature
            | Kind::JSDocSignature
            | Kind::MappedType
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::ModuleDeclaration
            | Kind::SetAccessor
            | Kind::SourceFile
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
    )
}

pub fn is_shorthand_ambient_module_symbol(a: Ast<'_>, module_symbol: SymbolId) -> bool {
    is_shorthand_ambient_module(a, a.sym(module_symbol).value_declaration)
}

pub fn is_shorthand_ambient_module(a: Ast<'_>, node: NodeId) -> bool {
    // The only kind of module that can be missing a body is a shorthand ambient module.
    !node.is_nil() && a.kind(node) == Kind::ModuleDeclaration && a.body(node).is_nil()
}

pub fn get_alias_declaration_from_name(a: Ast<'_>, node: NodeId) -> NodeId {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::ImportClause
        | Kind::ImportSpecifier
        | Kind::NamespaceImport
        | Kind::ExportSpecifier
        | Kind::ExportAssignment
        | Kind::ImportEqualsDeclaration
        | Kind::NamespaceExport => parent,
        Kind::QualifiedName => {
            if !stack_is_safe(a, parent) {
                return NodeId::NIL;
            }
            get_alias_declaration_from_name(a, parent)
        }
        _ => NodeId::NIL,
    }
}

pub fn entity_name_to_string(a: Ast<'_>, name: NodeId) -> Vec<u8> {
    let text_of_node: &dyn Fn(NodeId) -> Vec<u8> = &|node| get_text_of_node(a, node);
    ast::entity_name_to_string(a, name, Some(text_of_node))
}

pub fn get_containing_qualified_name_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while is_qualified_name(a, a.parent(node)) {
        node = a.parent(node);
    }
    node
}

pub fn is_side_effect_import(a: Ast<'_>, node: NodeId) -> bool {
    let ancestor = find_ancestor(a, node, |n| is_import_declaration(a, n));
    !ancestor.is_nil() && a.import_clause(ancestor).is_nil()
}

pub fn get_external_module_require_argument(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_variable_declaration_initialized_to_require(a, node) {
        return a.arguments(a.initializer(node)).at(0usize);
    }
    NodeId::NIL
}

pub fn is_right_side_of_access_expression(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    !parent.is_nil()
        && (is_property_access_expression(a, parent) && a.name(parent) == node
            || is_element_access_expression(a, parent)
                && a.as_element_access_expression(parent).argument_expression == node)
}

pub fn is_top_level_in_external_module_augmentation(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && !a.parent(node).is_nil()
        && is_module_block(a, a.parent(node))
        && is_external_module_augmentation(a, a.parent(a.parent(node)))
}

pub fn is_syntactic_default(a: Ast<'_>, node: NodeId) -> bool {
    (is_export_assignment(a, node) && !a.as_export_assignment(node).is_export_equals)
        || has_syntactic_modifier(a, node, ModifierFlags::DEFAULT)
        || is_export_specifier(a, node)
        || is_namespace_export(a, node)
}

pub fn has_export_assignment_symbol(a: Ast<'_>, module_symbol: SymbolId) -> bool {
    !a.table_get(
        a.sym(module_symbol).exports,
        INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
    )
    .is_nil()
}

pub fn is_type_alias(a: Ast<'_>, node: NodeId) -> bool {
    is_type_or_js_type_alias_declaration(a, node)
}

pub fn has_only_expression_initializer(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::BindingElement
            | Kind::PropertyDeclaration
            | Kind::PropertyAssignment
            | Kind::EnumMember
    )
}

pub fn has_dot_dot_dot_token(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::Parameter => !a.as_parameter_declaration(node).dot_dot_dot_token.is_nil(),
        Kind::BindingElement => !a.as_binding_element(node).dot_dot_dot_token.is_nil(),
        Kind::NamedTupleMember => !a.as_named_tuple_member(node).dot_dot_dot_token.is_nil(),
        Kind::JsxExpression => !a.as_jsx_expression(node).dot_dot_dot_token.is_nil(),
        _ => false,
    }
}

pub fn is_type_any(c: &Checker<'_>, t: TypeId) -> bool {
    !t.is_nil() && c.types[t].flags.intersects(TypeFlags::ANY)
}

// Upstream answers false for every parameter: it reads no JSDoc here.
pub fn is_jsdoc_optional_parameter(_node: NodeId) -> bool {
    false
}

pub fn is_exclamation_token(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && a.kind(node) == Kind::ExclamationToken
}

pub fn is_optional_declaration(a: Ast<'_>, declaration: NodeId) -> bool {
    has_question_token(a, declaration)
}

impl<'a> Checker<'a> {
    pub fn is_optional_parameter(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if is_parameter_declaration(a, node) && !a.question_token(node).is_nil() {
            return true;
        }
        if !is_parameter_declaration(a, node) {
            return false;
        }
        let parent = a.parent(node);
        if !a.initializer(node).is_nil() {
            let signature = self.get_signature_from_declaration(parent);
            let parameter_index = find_index(a.parameters(parent).as_slice(), |p| p == node);
            self.assert(parameter_index >= 0, "parameterIndex >= 0");
            // Only consider syntactic or instantiated parameters as optional, not `void` parameters as this function is used in grammar checks and checking for `void` too early results in parameter types widening too early and causes some noImplicitAny errors to be lost.
            return parameter_index
                >= self.get_min_argument_count_ex(
                    signature,
                    MinArgumentCountFlags::STRONG_ARITY_FOR_UNTYPED_JS
                        | MinArgumentCountFlags::VOID_IS_NON_OPTIONAL,
                );
        }
        let iife = get_immediately_invoked_function_expression(a, parent);
        if !iife.is_nil() {
            let parameter_index = find_index(a.parameters(parent).as_slice(), |p| p == node);
            return a.type_node(node).is_nil()
                && a.as_parameter_declaration(node).dot_dot_dot_token.is_nil()
                && parameter_index
                    >= self.get_effective_call_arguments(iife).as_slice().len() as isize;
        }
        false
    }
}

pub fn is_empty_array_literal(a: Ast<'_>, expression: NodeId) -> bool {
    is_array_literal_expression(a, expression) && a.elements(expression).len() == 0
}

pub fn declaration_belongs_to_private_ambient_member(a: Ast<'_>, declaration: NodeId) -> bool {
    let root = get_root_declaration(a, declaration);
    let mut member_declaration = root;
    if a.kind(root) == Kind::Parameter {
        member_declaration = a.parent(root);
    }
    is_private_within_ambient(a, member_declaration)
}

pub fn is_private_within_ambient(a: Ast<'_>, node: NodeId) -> bool {
    (has_modifier(a, node, ModifierFlags::PRIVATE)
        || is_private_identifier_class_element_declaration(a, node))
        && a.flags(node).intersects(NodeFlags::AMBIENT)
}

pub fn is_type_assertion(a: Ast<'_>, node: NodeId) -> bool {
    is_assertion_expression(a, skip_parentheses(a, node))
}

pub fn create_symbol_table(a: Ast<'_>, symbols: &[SymbolId]) -> SymbolTableId {
    if symbols.is_empty() {
        return SymbolTableId::NIL;
    }
    let result = a.new_table();
    for &symbol in symbols {
        a.table_set(result, a.sym(symbol).name, symbol);
    }
    result
}

impl<'a> Checker<'a> {
    pub fn sort_symbols(&self, symbols: &mut [SymbolId]) {
        slices::sort_func(symbols, &mut |s1, s2| self.compare_symbols(s1, s2) < 0);
    }

    pub fn compare_symbols_worker(&self, s1: SymbolId, s2: SymbolId) -> isize {
        if s1 == s2 {
            return 0;
        }
        if s1.is_nil() {
            return 1;
        }
        if s2.is_nil() {
            return -1;
        }
        let a = self.ast;
        let (symbol1, symbol2) = (a.sym(s1), a.sym(s2));
        if symbol1.declarations.len() != 0 && symbol2.declarations.len() != 0 {
            let r = self.compare_nodes(
                symbol1.declarations.at(0usize),
                symbol2.declarations.at(0usize),
            );
            if r != 0 {
                return r;
            }
        } else if symbol1.declarations.len() != 0 {
            return -1;
        } else if symbol2.declarations.len() != 0 {
            return 1;
        }
        let r = strings::compare(symbol1.name, symbol2.name);
        if r != 0 {
            return r;
        }
        // Fall back to symbol IDs. This is a last resort that should happen only when symbols have no declaration and duplicate names.
        let id1 = a.get_symbol_id(s1);
        let id2 = a.get_symbol_id(s2);
        (id1 as isize).wrapping_sub(id2 as isize)
    }

    pub fn compare_nodes(&self, n1: NodeId, n2: NodeId) -> isize {
        if n1 == n2 {
            return 0;
        }
        if n1.is_nil() {
            return 1;
        }
        if n2.is_nil() {
            return -1;
        }
        let a = self.ast;
        let s1 = get_source_file_of_node(a, n1);
        let s2 = get_source_file_of_node(a, n2);
        if s1 != s2 {
            let f1 = self.file_index_map.get(&s1);
            let f2 = self.file_index_map.get(&s2);
            // Order by index of file in the containing program
            return f1 - f2;
        }
        // In the same file, order by source position
        a.pos(n1) as isize - a.pos(n2) as isize
    }
}

// A type belongs to the one checker that made its id, so upstream's test for types of two checkers has no counterpart. Without stack left the order is the one of the type ids, which is also upstream's last resort.
pub fn compare_types(c: &Checker<'_>, t1: TypeId, t2: TypeId) -> isize {
    if !c.stack_check.is_safe_to_recurse() {
        let _: () = c.stack_limit();
        return t1.0 as isize - t2.0 as isize;
    }
    if t1 == t2 {
        return 0;
    }
    if t1.is_nil() {
        return -1;
    }
    if t2.is_nil() {
        return 1;
    }
    // First sort in order of increasing type flags values.
    let r = get_sort_order_flags(c, t1) - get_sort_order_flags(c, t2);
    if r != 0 {
        return r;
    }
    // Order named types by name and, in the case of aliased types, by alias type arguments.
    let r = compare_type_names(c, t1, t2);
    if r != 0 {
        return r;
    }
    // We have unnamed types or types with identical names. Now sort by data specific to the type.
    let flags = c.types[t1].flags;
    if flags.intersects(
        TypeFlags::ANY
            | TypeFlags::UNKNOWN
            | TypeFlags::STRING
            | TypeFlags::NUMBER
            | TypeFlags::BOOLEAN
            | TypeFlags::BIG_INT
            | TypeFlags::ES_SYMBOL
            | TypeFlags::VOID
            | TypeFlags::UNDEFINED
            | TypeFlags::NULL
            | TypeFlags::NEVER
            | TypeFlags::NON_PRIMITIVE,
    ) {
        // Only distinguished by type IDs, handled below.
    } else if flags.intersects(TypeFlags::OBJECT) {
        // Order unnamed or identically named object types by symbol.
        let r = c.compare_symbols(c.types[t1].symbol, c.types[t2].symbol);
        if r != 0 {
            return r;
        }
        // When object types have the same or no symbol, order by kind. We order type references before other kinds.
        let is_reference1 = c.types[t1].object_flags.intersects(ObjectFlags::REFERENCE);
        let is_reference2 = c.types[t2].object_flags.intersects(ObjectFlags::REFERENCE);
        if is_reference1 && is_reference2 {
            let r1 = c.as_type_reference(t1);
            let r2 = c.as_type_reference(t2);
            if c.types[r1.target]
                .object_flags
                .intersects(ObjectFlags::TUPLE)
                && c.types[r2.target]
                    .object_flags
                    .intersects(ObjectFlags::TUPLE)
            {
                // Tuple types have no associated symbol, instead we order by tuple element information.
                let r = compare_tuple_types(c, r1.target, r2.target);
                if r != 0 {
                    return r;
                }
            }
            // Here we know we have references to instantiations of the same type because we have matching targets.
            if r1.node.is_nil() && r2.node.is_nil() {
                // Non-deferred type references with the same target are sorted by their type argument lists.
                let r = compare_type_lists(
                    c,
                    r1.resolved_type_arguments.as_slice(),
                    r2.resolved_type_arguments.as_slice(),
                );
                if r != 0 {
                    return r;
                }
            } else {
                // Deferred type references with the same target are ordered by the source location of the reference.
                let r = c.compare_nodes(r1.node, r2.node);
                if r != 0 {
                    return r;
                }
                // Instantiations of the same deferred type reference are ordered by their associated type mappers (which reflect the mapping of in-scope type parameters to type arguments).
                let r = compare_type_mappers(
                    c,
                    c.as_object_type(t1).mapper,
                    c.as_object_type(t2).mapper,
                );
                if r != 0 {
                    return r;
                }
            }
        } else if is_reference1 {
            return -1;
        } else if is_reference2 {
            return 1;
        } else {
            // Order unnamed non-reference object types by kind associated type mappers. Reverse mapped types have neither symbols nor mappers so they're ultimately ordered by unstable type IDs, but given their rarity this should be fine.
            let r = (c.types[t1].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).0 as isize
                - (c.types[t2].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).0 as isize;
            if r != 0 {
                return r;
            }
            let r =
                compare_type_mappers(c, c.as_object_type(t1).mapper, c.as_object_type(t2).mapper);
            if r != 0 {
                return r;
            }
        }
    } else if flags.intersects(TypeFlags::UNION) {
        // Unions are ordered by origin and then constituent type lists.
        let o1 = c.as_union_type(t1).origin;
        let o2 = c.as_union_type(t2).origin;
        if o1.is_nil() && o2.is_nil() {
            let r = compare_type_lists(c, c.type_types(t1).as_slice(), c.type_types(t2).as_slice());
            if r != 0 {
                return r;
            }
        } else if o1.is_nil() {
            return 1;
        } else if o2.is_nil() {
            return -1;
        } else {
            let r = compare_types(c, o1, o2);
            if r != 0 {
                return r;
            }
        }
    } else if flags.intersects(TypeFlags::INTERSECTION) {
        // Intersections are ordered by their constituent type lists.
        let r = compare_type_lists(c, c.type_types(t1).as_slice(), c.type_types(t2).as_slice());
        if r != 0 {
            return r;
        }
    } else if flags
        .intersects(TypeFlags::ENUM | TypeFlags::ENUM_LITERAL | TypeFlags::UNIQUE_ES_SYMBOL)
    {
        // Enum members are ordered by their symbol (and thus their declaration order).
        let r = c.compare_symbols(c.types[t1].symbol, c.types[t2].symbol);
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::STRING_LITERAL) {
        // String literal types are ordered by their values.
        let r = strings::compare(
            get_string_literal_value(c, t1),
            get_string_literal_value(c, t2),
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::NUMBER_LITERAL) {
        // Numeric literal types are ordered by their values.
        let r = compare_numbers(
            get_number_literal_value(c, t1),
            get_number_literal_value(c, t2),
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
        let b1 = get_boolean_literal_value(c, t1);
        let b2 = get_boolean_literal_value(c, t2);
        if b1 != b2 {
            if b1 {
                return 1;
            }
            return -1;
        }
    } else if flags.intersects(TypeFlags::TYPE_PARAMETER) {
        let r = c.compare_symbols(c.types[t1].symbol, c.types[t2].symbol);
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::INDEX) {
        let r = compare_types(c, c.as_index_type(t1).target, c.as_index_type(t2).target);
        if r != 0 {
            return r;
        }
        let r =
            c.as_index_type(t1).index_flags.0 as isize - c.as_index_type(t2).index_flags.0 as isize;
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::INDEXED_ACCESS) {
        let r = compare_types(
            c,
            c.as_indexed_access_type(t1).object_type,
            c.as_indexed_access_type(t2).object_type,
        );
        if r != 0 {
            return r;
        }
        let r = compare_types(
            c,
            c.as_indexed_access_type(t1).index_type,
            c.as_indexed_access_type(t2).index_type,
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::CONDITIONAL) {
        let r = c.compare_nodes(
            c.conditional_roots[c.as_conditional_type(t1).root].node,
            c.conditional_roots[c.as_conditional_type(t2).root].node,
        );
        if r != 0 {
            return r;
        }
        let r = compare_type_mappers(
            c,
            c.as_conditional_type(t1).mapper,
            c.as_conditional_type(t2).mapper,
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::SUBSTITUTION) {
        let r = compare_types(
            c,
            c.as_substitution_type(t1).base_type,
            c.as_substitution_type(t2).base_type,
        );
        if r != 0 {
            return r;
        }
        let r = compare_types(
            c,
            c.as_substitution_type(t1).constraint,
            c.as_substitution_type(t2).constraint,
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
        let r = compare_texts(
            c.as_template_literal_type(t1).texts.as_slice(),
            c.as_template_literal_type(t2).texts.as_slice(),
        );
        if r != 0 {
            return r;
        }
        let r = compare_type_lists(
            c,
            c.as_template_literal_type(t1).types.as_slice(),
            c.as_template_literal_type(t2).types.as_slice(),
        );
        if r != 0 {
            return r;
        }
    } else if flags.intersects(TypeFlags::STRING_MAPPING) {
        let r = compare_types(
            c,
            c.as_string_mapping_type(t1).target,
            c.as_string_mapping_type(t2).target,
        );
        if r != 0 {
            return r;
        }
    }
    // Fall back to type IDs. This results in type creation order for built-in types.
    t1.0 as isize - t2.0 as isize
}

// cmp.Compare of two numbers: a NaN is less than every other number and equal to a NaN.
fn compare_numbers(x: Number, y: Number) -> isize {
    let x_nan = x.is_nan();
    let y_nan = y.is_nan();
    if x_nan {
        if y_nan {
            return 0;
        }
        return -1;
    }
    if y_nan {
        return 1;
    }
    if x.0 < y.0 {
        return -1;
    }
    if x.0 > y.0 {
        return 1;
    }
    0
}

// slices.Compare of two lists of strings.
fn compare_texts(s1: &[Text<'_>], s2: &[Text<'_>]) -> isize {
    for (i, &v1) in s1.iter().enumerate() {
        let Some(&v2) = s2.get(i) else {
            return 1;
        };
        let r = strings::compare(v1, v2);
        if r != 0 {
            return r;
        }
    }
    if s1.len() < s2.len() {
        return -1;
    }
    0
}

pub fn get_sort_order_flags(c: &Checker<'_>, t: TypeId) -> isize {
    let flags = c.types[t].flags;
    // Return TypeFlagsEnum for all enum-like unit types (they'll be sorted by their symbols)
    if flags.intersects(TypeFlags::ENUM_LITERAL | TypeFlags::ENUM)
        && !flags.intersects(TypeFlags::UNION)
    {
        return TypeFlags::ENUM.0 as isize;
    }
    flags.0 as isize
}

pub fn compare_type_names(c: &Checker<'_>, t1: TypeId, t2: TypeId) -> isize {
    let s1 = get_type_name_symbol(c, t1);
    let s2 = get_type_name_symbol(c, t2);
    if s1 == s2 {
        if !c.types[t1].alias.is_nil() {
            return compare_type_lists(
                c,
                c.type_aliases[c.types[t1].alias].type_arguments.as_slice(),
                c.type_aliases[c.types[t2].alias].type_arguments.as_slice(),
            );
        }
        return 0;
    }
    if s1.is_nil() {
        return 1;
    }
    if s2.is_nil() {
        return -1;
    }
    strings::compare(c.ast.sym(s1).name, c.ast.sym(s2).name)
}

pub fn get_type_name_symbol(c: &Checker<'_>, t: TypeId) -> SymbolId {
    let alias = c.types[t].alias;
    if !alias.is_nil() {
        return c.type_aliases[alias].symbol;
    }
    if c.types[t]
        .flags
        .intersects(TypeFlags::TYPE_PARAMETER | TypeFlags::STRING_MAPPING)
        || c.types[t]
            .object_flags
            .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
    {
        return c.types[t].symbol;
    }
    SymbolId::NIL
}

pub fn get_object_type_name(c: &Checker<'_>, t: TypeId) -> SymbolId {
    if c.types[t]
        .object_flags
        .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
    {
        return c.types[t].symbol;
    }
    SymbolId::NIL
}

// A `*TupleType` of upstream is the tuple target type that holds the data.
pub fn compare_tuple_types(c: &Checker<'_>, t1: TypeId, t2: TypeId) -> isize {
    if t1 == t2 {
        return 0;
    }
    let tuple1 = c.as_tuple_type(t1);
    let tuple2 = c.as_tuple_type(t2);
    if tuple1.readonly != tuple2.readonly {
        return if_else(tuple1.readonly, 1, -1);
    }
    let element_infos1 = tuple1.element_infos;
    let element_infos2 = tuple2.element_infos;
    if element_infos1.len() != element_infos2.len() {
        return element_infos1.len() - element_infos2.len();
    }
    for (i, info1) in element_infos1.as_slice().iter().enumerate() {
        let r = info1.flags.0 as isize - element_infos2.at(i).flags.0 as isize;
        if r != 0 {
            return r;
        }
    }
    for (i, info1) in element_infos1.as_slice().iter().enumerate() {
        let r = compare_element_labels(
            c.ast,
            info1.labeled_declaration,
            element_infos2.at(i).labeled_declaration,
        );
        if r != 0 {
            return r;
        }
    }
    0
}

pub fn compare_element_labels(a: Ast<'_>, n1: NodeId, n2: NodeId) -> isize {
    if n1 == n2 {
        return 0;
    }
    if n1.is_nil() {
        return -1;
    }
    if n2.is_nil() {
        return 1;
    }
    strings::compare(a.text(a.name(n1)), a.text(a.name(n2)))
}

pub fn compare_type_lists(c: &Checker<'_>, s1: &[TypeId], s2: &[TypeId]) -> isize {
    if s1.len() != s2.len() {
        return s1.len() as isize - s2.len() as isize;
    }
    for (i, &t1) in s1.iter().enumerate() {
        let t2 = s2.get(i).copied().unwrap_or(TypeId::NIL);
        let r = compare_types(c, t1, t2);
        if r != 0 {
            return r;
        }
    }
    0
}

// The targets of an array mapper as a list: a list that is still written is read as it is at this time.
fn targets_to_vec(targets: Targets<'_>) -> Vec<TypeId> {
    let len = usize::try_from(targets.len()).unwrap_or(0);
    (0..len).map(|i| targets.at(i)).collect()
}

pub fn compare_type_mappers(c: &Checker<'_>, m1: TypeMapperId, m2: TypeMapperId) -> isize {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    if m1 == m2 {
        return 0;
    }
    if m1.is_nil() {
        return 1;
    }
    if m2.is_nil() {
        return -1;
    }
    let kind1 = c.mapper_kind(m1);
    let kind2 = c.mapper_kind(m2);
    if kind1 != kind2 {
        return kind1.0 as isize - kind2.0 as isize;
    }
    match (c.type_mappers[m1], c.type_mappers[m2]) {
        (
            TypeMapper::Simple {
                source: source1,
                target: target1,
            },
            TypeMapper::Simple {
                source: source2,
                target: target2,
            },
        ) => {
            let r = compare_types(c, source1, source2);
            if r != 0 {
                return r;
            }
            compare_types(c, target1, target2)
        }
        (
            TypeMapper::Array {
                sources: sources1,
                targets: targets1,
            },
            TypeMapper::Array {
                sources: sources2,
                targets: targets2,
            },
        ) => {
            let r = compare_type_lists(c, sources1.as_slice(), sources2.as_slice());
            if r != 0 {
                return r;
            }
            compare_type_lists(c, &targets_to_vec(targets1), &targets_to_vec(targets2))
        }
        (
            TypeMapper::Merged {
                m1: first1,
                m2: second1,
            },
            TypeMapper::Merged {
                m1: first2,
                m2: second2,
            },
        ) => {
            let r = compare_type_mappers(c, first1, first2);
            if r != 0 {
                return r;
            }
            compare_type_mappers(c, second1, second2)
        }
        _ => 0,
    }
}

pub fn get_declaration_modifier_flags_from_symbol(a: Ast<'_>, s: SymbolId) -> ModifierFlags {
    get_declaration_modifier_flags_from_symbol_ex(a, s, false)
}

pub fn get_declaration_modifier_flags_from_symbol_ex(
    a: Ast<'_>,
    s: SymbolId,
    is_write: bool,
) -> ModifierFlags {
    let symbol = a.sym(s);
    if !symbol.value_declaration.is_nil() {
        let mut declaration = NodeId::NIL;
        if is_write {
            declaration = find(symbol.declarations.as_slice(), |d| {
                is_set_accessor_declaration(a, d)
            });
        }
        if declaration.is_nil() && symbol.flags.intersects(SymbolFlags::GET_ACCESSOR) {
            declaration = find(symbol.declarations.as_slice(), |d| {
                is_get_accessor_declaration(a, d)
            });
        }
        if declaration.is_nil() {
            declaration = symbol.value_declaration;
        }
        let flags = get_combined_modifier_flags(a, declaration);
        if !symbol.parent.is_nil() && a.sym(symbol.parent).flags.intersects(SymbolFlags::CLASS) {
            return flags;
        }
        return flags.without(ModifierFlags::ACCESSIBILITY_MODIFIER);
    }
    if symbol.check_flags.intersects(CheckFlags::SYNTHETIC) {
        let access_modifier = if symbol.check_flags.intersects(CheckFlags::CONTAINS_PRIVATE) {
            ModifierFlags::PRIVATE
        } else if symbol.check_flags.intersects(CheckFlags::CONTAINS_PUBLIC) {
            ModifierFlags::PUBLIC
        } else {
            ModifierFlags::PROTECTED
        };
        let mut static_modifier = ModifierFlags::NONE;
        if symbol.check_flags.intersects(CheckFlags::CONTAINS_STATIC) {
            static_modifier = ModifierFlags::STATIC;
        }
        return access_modifier | static_modifier;
    }
    if symbol.flags.intersects(SymbolFlags::PROTOTYPE) {
        return ModifierFlags::PUBLIC | ModifierFlags::STATIC;
    }
    ModifierFlags::NONE
}

pub fn is_exponentiation_operator(kind: Kind) -> bool {
    kind == Kind::AsteriskAsteriskToken
}

pub fn is_multiplicative_operator(kind: Kind) -> bool {
    kind == Kind::AsteriskToken || kind == Kind::SlashToken || kind == Kind::PercentToken
}

pub fn is_multiplicative_operator_or_higher(kind: Kind) -> bool {
    is_exponentiation_operator(kind) || is_multiplicative_operator(kind)
}

pub fn is_additive_operator(kind: Kind) -> bool {
    kind == Kind::PlusToken || kind == Kind::MinusToken
}

pub fn is_additive_operator_or_higher(kind: Kind) -> bool {
    is_additive_operator(kind) || is_multiplicative_operator_or_higher(kind)
}

pub fn is_shift_operator(kind: Kind) -> bool {
    kind == Kind::LessThanLessThanToken
        || kind == Kind::GreaterThanGreaterThanToken
        || kind == Kind::GreaterThanGreaterThanGreaterThanToken
}

pub fn is_shift_operator_or_higher(kind: Kind) -> bool {
    is_shift_operator(kind) || is_additive_operator_or_higher(kind)
}

pub fn is_relational_operator(kind: Kind) -> bool {
    kind == Kind::LessThanToken
        || kind == Kind::LessThanEqualsToken
        || kind == Kind::GreaterThanToken
        || kind == Kind::GreaterThanEqualsToken
        || kind == Kind::InstanceOfKeyword
        || kind == Kind::InKeyword
}

pub fn is_relational_operator_or_higher(kind: Kind) -> bool {
    is_relational_operator(kind) || is_shift_operator_or_higher(kind)
}

pub fn is_equality_operator(kind: Kind) -> bool {
    kind == Kind::EqualsEqualsToken
        || kind == Kind::EqualsEqualsEqualsToken
        || kind == Kind::ExclamationEqualsToken
        || kind == Kind::ExclamationEqualsEqualsToken
}

pub fn is_equality_operator_or_higher(kind: Kind) -> bool {
    is_equality_operator(kind) || is_relational_operator_or_higher(kind)
}

pub fn is_bitwise_operator(kind: Kind) -> bool {
    kind == Kind::AmpersandToken || kind == Kind::BarToken || kind == Kind::CaretToken
}

pub fn is_bitwise_operator_or_higher(kind: Kind) -> bool {
    is_bitwise_operator(kind) || is_equality_operator_or_higher(kind)
}

pub fn is_logical_operator_or_higher(kind: Kind) -> bool {
    is_logical_binary_operator(kind) || is_bitwise_operator_or_higher(kind)
}

pub fn is_assignment_operator_or_higher(kind: Kind) -> bool {
    kind == Kind::QuestionQuestionToken
        || is_logical_operator_or_higher(kind)
        || is_assignment_operator(kind)
}

pub fn is_binary_operator(kind: Kind) -> bool {
    is_assignment_operator_or_higher(kind) || kind == Kind::CommaToken
}

pub fn is_object_literal_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t]
        .object_flags
        .intersects(ObjectFlags::OBJECT_LITERAL)
}

pub fn is_declaration_readonly(a: Ast<'_>, declaration: NodeId) -> bool {
    get_combined_modifier_flags(a, declaration).intersects(ModifierFlags::READONLY)
        && !is_parameter_property_declaration(a, declaration, a.parent(declaration))
}

// orderedSetMapThreshold is the size at which an orderedSet materializes its dedup map. Below this, contains() scans the values slice.
const ORDERED_SET_MAP_THRESHOLD: usize = 16;

// orderedSet of upstream: `values_by_key` is None where upstream's map is nil.
#[derive(Clone, Debug, Default)]
pub struct OrderedSet<T> {
    pub values_by_key: Option<BTreeSet<T>>,
    pub values: Vec<T>,
}

impl<T: Copy + Ord> OrderedSet<T> {
    pub fn contains(&self, value: T) -> bool {
        let Some(values_by_key) = &self.values_by_key else {
            return self.values.contains(&value);
        };
        values_by_key.contains(&value)
    }

    pub fn add(&mut self, value: T) {
        self.values.push(value);
        // Small sets are served by a linear scan over values; only materialize the map once the set grows large enough for hashing to win.
        if self.values_by_key.is_none() {
            if self.values.len() <= ORDERED_SET_MAP_THRESHOLD {
                return;
            }
            let mut values_by_key = BTreeSet::new();
            if let Some((_, earlier)) = self.values.split_last() {
                for &v in earlier {
                    values_by_key.insert(v);
                }
            }
            self.values_by_key = Some(values_by_key);
        }
        if let Some(values_by_key) = self.values_by_key.as_mut() {
            values_by_key.insert(value);
        }
    }
}

pub fn get_containing_function_or_class_static_block(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |n| {
        is_function_like_or_class_static_block_declaration(a, n)
    })
}

pub fn is_node_descendant_of(a: Ast<'_>, node: NodeId, ancestor: NodeId) -> bool {
    let mut node = node;
    while !node.is_nil() {
        if node == ancestor {
            return true;
        }
        node = a.parent(node);
    }
    false
}

pub fn is_type_usable_as_property_name(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t]
        .flags
        .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE)
}

// Gets the symbolic name for a member from its type.
pub fn get_property_name_from_type(c: &Checker<'_>, t: TypeId) -> Vec<u8> {
    let flags = c.types[t].flags;
    if flags.intersects(TypeFlags::STRING_LITERAL) {
        return get_string_literal_value(c, t).to_vec();
    }
    if flags.intersects(TypeFlags::NUMBER_LITERAL) {
        return get_number_literal_value(c, t).string();
    }
    if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
        return c.as_unique_es_symbol_type(t).name.to_vec();
    }
    c.fail("Unhandled case in getPropertyNameFromType")
}

pub fn is_numeric_literal_name(name: &[u8]) -> bool {
    // The intent of numeric names is that they are names with text in a numeric form, and that setting properties or indexing with them is always equivalent to doing so with the numeric literal 'numLit', acquired by applying the abstract 'ToNumber' operation on the name's text. The text of the name must be equal to 'ToString(numLit)' for this to hold: indexing with '0xF00D' indexes with '"61453"', so '0xF00D' is not a numeric name. Here, we test whether 'ToString(ToNumber(name))' is exactly equal to 'name'. Note that this accepts the values 'Infinity', '-Infinity', and 'NaN', and that this is intentional: indexing with them as numeric entities indexes with the strings '"Infinity"', '"-Infinity"', and '"NaN"' respectively.
    from_string(name).string() == name
}

pub fn is_this_property(a: Ast<'_>, node: NodeId) -> bool {
    (is_property_access_expression(a, node) || is_element_access_expression(a, node))
        && a.kind(a.expression(node)) == Kind::ThisKeyword
}

pub fn is_valid_number_string(s: &[u8], round_trip_only: bool) -> bool {
    if s.is_empty() {
        return false;
    }
    let n = from_string(s);
    !n.is_nan() && !n.is_inf() && (!round_trip_only || n.string() == s)
}

pub fn is_valid_big_int_string(s: &[u8], round_trip_only: bool) -> bool {
    if s.is_empty() {
        return false;
    }
    let text = [s, b"n".as_slice()].concat();
    let success = Cell::new(true);
    let mut scanner = new_scanner();
    scanner.set_skip_trivia(false);
    scanner.set_on_error(Some(Box::new(
        |_: MessageId, _: i32, _: i32, _: &[Arg<'_>]| success.set(false),
    )));
    scanner.set_text(&text);
    let mut result = scanner.scan();
    let negative = result == Kind::MinusToken;
    if negative {
        result = scanner.scan();
    }
    let flags = scanner.token_flags();
    // validate that scanning proceeded without error, that a bigint can be scanned, that it is the full length of the input string (so the scanner is one character beyond the augmented input length), and that it does not contain a numeric separator (the `BigInt` constructor does not accept a numeric separator in its input). A token value that does not parse is upstream's panic: here it round-trips to no text.
    success.get()
        && result == Kind::BigIntLiteral
        && usize::try_from(scanner.token_end()) == Ok(s.len() + 1)
        && !flags.intersects(TokenFlags::CONTAINS_SEPARATOR)
        && (!round_trip_only
            || parse_pseudo_big_int(scanner.token_value()).is_ok_and(|value| {
                s == pseudo_big_int_to_string(new_pseudo_big_int(&value, negative))
            }))
}

pub fn is_valid_es_symbol_declaration(a: Ast<'_>, node: NodeId) -> bool {
    if is_variable_declaration(a, node) {
        return is_var_const(a, node)
            && is_identifier(a, a.as_variable_declaration(node).name)
            && is_variable_declaration_in_variable_statement(a, node);
    }
    if is_property_declaration(a, node) {
        return has_readonly_modifier(a, node) && has_static_modifier(a, node);
    }
    is_property_signature_declaration(a, node) && has_readonly_modifier(a, node)
}

pub fn is_variable_declaration_in_variable_statement(a: Ast<'_>, node: NodeId) -> bool {
    is_variable_declaration_list(a, a.parent(node))
        && is_variable_statement(a, a.parent(a.parent(node)))
}

pub fn is_known_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    is_late_bound_name(a.sym(symbol).name)
}

pub fn is_private_identifier_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    if symbol.is_nil() {
        return false;
    }
    a.sym(symbol)
        .name
        .strip_prefix(INTERNAL_SYMBOL_NAME_PREFIX)
        .is_some_and(|rest| rest.starts_with(b"#"))
}

pub fn is_late_bound_name(name: &[u8]) -> bool {
    name.len() >= 2 && name.first() == Some(&0xFE) && name.get(1) == Some(&b'@')
}

pub fn is_object_or_array_literal_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t]
        .object_flags
        .intersects(ObjectFlags::OBJECT_LITERAL | ObjectFlags::ARRAY_LITERAL)
}

pub fn get_containing_class_excluding_class_decorators(a: Ast<'_>, node: NodeId) -> NodeId {
    let decorator = find_ancestor_or_quit(a, a.parent(node), |n| {
        if is_class_like(a, n) {
            return FindAncestorResult::QUIT;
        }
        if is_decorator(a, n) {
            return FindAncestorResult::TRUE;
        }
        FindAncestorResult::FALSE
    });
    if !decorator.is_nil() && is_class_like(a, a.parent(decorator)) {
        return get_containing_class(a, a.parent(decorator));
    }
    if !decorator.is_nil() {
        return get_containing_class(a, decorator);
    }
    get_containing_class(a, node)
}

pub fn is_this_type_parameter(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) && c.as_type_parameter(t).is_this_type
}

pub fn is_class_instance_property(a: Ast<'_>, node: NodeId) -> bool {
    if is_in_js_file(a, node) && is_expando_property_declaration(a, node) {
        let left = a.as_binary_expression(node).left;
        return (!is_bindable_static_access_expression(a, left, false)
            || !is_prototype_access(a, a.expression(left)))
            && !is_bindable_static_name_expression(a, left, true);
    }
    !a.parent(node).is_nil()
        && is_class_like(a, a.parent(node))
        && is_property_declaration(a, node)
        && !has_accessor_modifier(a, node)
}

pub fn is_this_initialized_object_binding_expression(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && (is_shorthand_property_assignment(a, node) || is_property_assignment(a, node))
        && is_binary_expression(a, a.parent(a.parent(node)))
        && a.kind(
            a.as_binary_expression(a.parent(a.parent(node)))
                .operator_token,
        ) == Kind::EqualsToken
        && a.kind(a.as_binary_expression(a.parent(a.parent(node))).right) == Kind::ThisKeyword
}

pub fn is_this_initialized_declaration(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && is_variable_declaration(a, node)
        && !a.initializer(node).is_nil()
        && a.kind(a.initializer(node)) == Kind::ThisKeyword
}

pub fn is_infinity_or_nan_string(name: &[u8]) -> bool {
    name == b"Infinity" || name == b"-Infinity" || name == b"NaN"
}

impl<'a> Checker<'a> {
    pub fn is_constant_variable(&mut self, symbol: SymbolId) -> bool {
        self.ast.sym(symbol).flags.intersects(SymbolFlags::VARIABLE)
            && self
                .get_declaration_node_flags_from_symbol(symbol)
                .intersects(NodeFlags::CONSTANT)
    }

    pub fn is_parameter_or_mutable_local_variable(&self, symbol: SymbolId) -> bool {
        let a = self.ast;
        // Return true if symbol is a parameter, a catch clause variable, or a mutable local variable
        let value_declaration = a.sym(symbol).value_declaration;
        if !value_declaration.is_nil() {
            let declaration = get_root_declaration(a, value_declaration);
            return !declaration.is_nil()
                && (is_parameter_declaration(a, declaration)
                    || is_variable_declaration(a, declaration)
                        && (is_catch_clause(a, a.parent(declaration))
                            || self.is_mutable_local_variable_declaration(declaration)));
        }
        false
    }

    pub fn is_mutable_local_variable_declaration(&self, declaration: NodeId) -> bool {
        let a = self.ast;
        let parent = a.parent(declaration);
        // Return true if symbol is a non-exported and non-global `let` variable
        a.flags(parent).intersects(NodeFlags::LET)
            && !(get_combined_modifier_flags(a, declaration).intersects(ModifierFlags::EXPORT)
                || a.kind(a.parent(parent)) == Kind::VariableStatement
                    && is_global_source_file(a, a.parent(a.parent(parent))))
    }
}

pub fn is_in_ambient_or_type_node(a: Ast<'_>, node: NodeId) -> bool {
    a.flags(node).intersects(NodeFlags::AMBIENT)
        || !find_ancestor(a, node, |n| {
            is_interface_declaration(a, n)
                || is_type_or_js_type_alias_declaration(a, n)
                || is_type_literal_node(a, n)
        })
        .is_nil()
}

pub fn is_literal_expression_of_object(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ObjectLiteralExpression
            | Kind::ArrayLiteralExpression
            | Kind::RegularExpressionLiteral
            | Kind::FunctionExpression
            | Kind::ClassExpression
    )
}

pub fn can_have_flow_node(a: Ast<'_>, node: NodeId) -> bool {
    a.has_flow_node_data(node)
}

pub fn is_non_null_access(a: Ast<'_>, node: NodeId) -> bool {
    is_access_expression(a, node) && is_non_null_expression(a, a.expression(node))
}

pub fn get_binding_element_property_name(a: Ast<'_>, node: NodeId) -> NodeId {
    a.property_name_or_name(node)
}

pub fn is_call_chain(a: Ast<'_>, node: NodeId) -> bool {
    is_call_expression(a, node) && a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN)
}

impl<'a> Checker<'a> {
    pub fn call_like_expression_may_have_type_arguments(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_call_or_new_expression(a, node)
            || is_tagged_template_expression(a, node)
            || is_jsx_opening_like_element(a, node)
    }
}

pub fn is_super_call(a: Ast<'_>, n: NodeId) -> bool {
    is_call_expression(a, n) && a.kind(a.expression(n)) == Kind::SuperKeyword
}

pub fn get_members_of_declaration<'a>(a: Ast<'a>, node: NodeId) -> List<'a, NodeId> {
    match a.kind(node) {
        Kind::InterfaceDeclaration
        | Kind::ClassDeclaration
        | Kind::ClassExpression
        | Kind::TypeLiteral => a.members(node),
        Kind::ObjectLiteralExpression => a.properties(node),
        _ => List::NIL,
    }
}

pub fn is_in_right_side_of_import_or_export_assignment(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    while a.kind(a.parent(node)) == Kind::QualifiedName {
        node = a.parent(node);
    }
    let parent = a.parent(node);
    a.kind(parent) == Kind::ImportEqualsDeclaration
        && a.as_import_equals_declaration(parent).module_reference == node
        || a.kind(parent) == Kind::ExportAssignment && a.expression(parent) == node
}

pub fn is_jsx_intrinsic_tag_name(a: Ast<'_>, tag_name: NodeId) -> bool {
    is_identifier(a, tag_name) && is_intrinsic_jsx_name(a.text(tag_name))
        || is_jsx_namespaced_name(a, tag_name)
}

pub fn get_containing_object_literal(a: Ast<'_>, f: NodeId) -> NodeId {
    let kind = a.kind(f);
    let parent = a.parent(f);
    if (kind == Kind::MethodDeclaration || kind == Kind::GetAccessor || kind == Kind::SetAccessor)
        && a.kind(parent) == Kind::ObjectLiteralExpression
    {
        return parent;
    } else if kind == Kind::FunctionExpression && a.kind(parent) == Kind::PropertyAssignment {
        return a.parent(parent);
    }
    NodeId::NIL
}

pub fn is_import_type_qualifier_part(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    let mut parent = a.parent(node);
    while is_qualified_name(a, parent) {
        node = parent;
        parent = a.parent(parent);
    }
    if !parent.is_nil()
        && a.kind(parent) == Kind::ImportType
        && a.as_import_type_node(parent).qualifier == node
    {
        return parent;
    }
    NodeId::NIL
}

pub fn is_in_name_of_expression_with_type_arguments_or_heritage_type_reference(
    a: Ast<'_>,
    node: NodeId,
) -> bool {
    let mut node = node;
    while a.kind(a.parent(node)) == Kind::PropertyAccessExpression
        || a.kind(a.parent(node)) == Kind::QualifiedName
    {
        node = a.parent(node);
    }
    a.kind(a.parent(node)) == Kind::ExpressionWithTypeArguments
        || is_name_of_heritage_clause_type_reference(a, node)
}

pub fn get_index_symbol_from_symbol_table(a: Ast<'_>, symbol_table: SymbolTableId) -> SymbolId {
    a.table_get(symbol_table, INTERNAL_SYMBOL_NAME_INDEX)
}

// Indicates whether the result of an `Expression` will be unused. NOTE: This requires a node with a valid `parent` pointer.
pub fn expression_result_is_unused(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    loop {
        let parent = a.parent(node);
        // walk up parenthesized expressions, but keep a pointer to the top-most parenthesized expression
        if is_parenthesized_expression(a, parent) {
            node = parent;
            continue;
        }
        // result is unused in an expression statement, `void` expression, or the initializer or incrementer of a `for` loop
        if is_expression_statement(a, parent)
            || is_void_expression(a, parent)
            || is_for_statement(a, parent)
                && (a.initializer(parent) == node || a.as_for_statement(parent).incrementor == node)
        {
            return true;
        }
        if is_binary_expression(a, parent)
            && a.kind(a.as_binary_expression(parent).operator_token) == Kind::CommaToken
        {
            // left side of comma is always unused
            if node == a.as_binary_expression(parent).left {
                return true;
            }
            // right side of comma is unused if parent is unused
            node = parent;
            continue;
        }
        return false;
    }
}

pub fn pseudo_big_int_to_string(value: impl Borrow<PseudoBigInt>) -> Vec<u8> {
    let value: &PseudoBigInt = value.borrow();
    value.string()
}

pub fn get_super_container(a: Ast<'_>, node: NodeId, stop_on_functions: bool) -> NodeId {
    let mut node = node;
    loop {
        node = a.parent(node);
        if node.is_nil() {
            return NodeId::NIL;
        }
        match a.kind(node) {
            Kind::ComputedPropertyName => node = a.parent(node),
            Kind::FunctionDeclaration | Kind::FunctionExpression | Kind::ArrowFunction => {
                if stop_on_functions {
                    return node;
                }
            }
            Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::ClassStaticBlockDeclaration => return node,
            Kind::Decorator => {
                // Decorators are always applied outside of the body of a class or method.
                let parent = a.parent(node);
                if is_parameter_declaration(a, parent) && is_class_element(a, a.parent(parent)) {
                    // If the decorator's parent is a Parameter, we resolve the this container from the grandparent class declaration.
                    node = a.parent(parent);
                } else if is_class_element(a, parent) {
                    // If the decorator's parent is a class element, we resolve the 'this' container from the parent class declaration.
                    node = parent;
                }
            }
            _ => {}
        }
    }
}

pub fn for_each_yield_expression(
    a: Ast<'_>,
    body: NodeId,
    mut visitor: impl FnMut(NodeId) -> bool,
) -> bool {
    fn traverse(a: Ast<'_>, node: NodeId, visitor: &mut dyn FnMut(NodeId) -> bool) -> bool {
        if !stack_is_safe(a, node) {
            return false;
        }
        match a.kind(node) {
            Kind::YieldExpression => {
                if visitor(node) {
                    return true;
                }
                let operand = a.expression(node);
                if operand.is_nil() {
                    return false;
                }
                return traverse(a, operand, visitor);
            }
            Kind::EnumDeclaration
            | Kind::InterfaceDeclaration
            | Kind::ModuleDeclaration
            | Kind::TypeAliasDeclaration => {
                // These are not allowed inside a generator now, but eventually they may be allowed as local types. Regardless, skip them to avoid the work.
            }
            _ => {
                if is_function_like(a, node) {
                    if !a.name(node).is_nil() && is_computed_property_name(a, a.name(node)) {
                        // Note that we will not include methods/accessors of a class because they would require first descending into the class. This is by design.
                        return traverse(a, a.expression(a.name(node)), visitor);
                    }
                } else if !is_part_of_type_node(a, node) {
                    // This is the general case, which should include mostly expressions and statements. Also includes NodeArrays.
                    return a.for_each_child(node, &mut |child| traverse(a, child, visitor));
                }
            }
        }
        false
    }
    traverse(a, body, &mut visitor)
}

pub fn get_enclosing_container(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |n| {
        get_container_flags(a, n).intersects(ContainerFlags::IS_CONTAINER)
    })
}

pub fn get_declarations_of_kind(a: Ast<'_>, symbol: SymbolId, kind: Kind) -> Vec<NodeId> {
    filter(a.sym(symbol).declarations.as_slice(), |d| a.kind(d) == kind).into_owned()
}

pub fn has_type(a: Ast<'_>, node: NodeId) -> bool {
    !a.type_node(node).is_nil()
}

pub fn get_non_rest_parameter_count(c: &Checker<'_>, sig: SignatureId) -> isize {
    c.signatures[sig].parameters.len() - if_else(signature_has_rest_parameter(c, sig), 1, 0)
}

pub fn min_and_max<T: Copy>(slice: &[T], mut get_value: impl FnMut(T) -> isize) -> (isize, isize) {
    let mut min_value: isize = 0;
    let mut max_value: isize = 0;
    for (i, &element) in slice.iter().enumerate() {
        let value = get_value(element);
        if i == 0 {
            min_value = value;
            max_value = value;
        } else {
            min_value = min_value.min(value);
            max_value = max_value.max(value);
        }
    }
    (min_value, max_value)
}

#[derive(Clone, Copy, Debug)]
pub struct FeatureMapEntry {
    pub lib: &'static [u8],
    pub props: &'static [&'static [u8]],
}

// The map of getFeatureMap: the name of a global type with its entries.
pub struct FeatureMap(&'static [(&'static [u8], &'static [FeatureMapEntry])]);

impl FeatureMap {
    // `featureMap[name]` with its ok.
    pub fn get(&self, name: &[u8]) -> Option<&'static [FeatureMapEntry]> {
        for &(key, entries) in self.0 {
            if key == name {
                return Some(entries);
            }
        }
        None
    }
}

static FEATURE_MAP: FeatureMap = FeatureMap(FEATURES);

pub fn get_feature_map() -> &'static FeatureMap {
    &FEATURE_MAP
}

#[rustfmt::skip]
const FEATURES: &[(&[u8], &[FeatureMapEntry])] = &[
    (b"Array", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"find", b"findIndex", b"fill", b"copyWithin", b"entries", b"keys", b"values"] },
        FeatureMapEntry { lib: b"es2016", props: &[b"includes"] },
        FeatureMapEntry { lib: b"es2019", props: &[b"flat", b"flatMap"] },
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Iterator", &[
        FeatureMapEntry { lib: b"es2015", props: &[] },
    ]),
    (b"AsyncIterator", &[
        FeatureMapEntry { lib: b"es2015", props: &[] },
    ]),
    (b"ArrayBuffer", &[
        FeatureMapEntry { lib: b"es2024", props: &[b"maxByteLength", b"resizable", b"resize", b"detached", b"transfer", b"transferToFixedLength"] },
    ]),
    (b"Atomics", &[
        FeatureMapEntry { lib: b"es2017", props: &[b"add", b"and", b"compareExchange", b"exchange", b"isLockFree", b"load", b"or", b"store", b"sub", b"wait", b"notify", b"xor"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"waitAsync"] },
    ]),
    (b"SharedArrayBuffer", &[
        FeatureMapEntry { lib: b"es2017", props: &[b"byteLength", b"slice"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"growable", b"maxByteLength", b"grow"] },
    ]),
    (b"AsyncIterable", &[
        FeatureMapEntry { lib: b"es2018", props: &[] },
    ]),
    (b"AsyncIterableIterator", &[
        FeatureMapEntry { lib: b"es2018", props: &[] },
    ]),
    (b"AsyncGenerator", &[
        FeatureMapEntry { lib: b"es2018", props: &[] },
    ]),
    (b"AsyncGeneratorFunction", &[
        FeatureMapEntry { lib: b"es2018", props: &[] },
    ]),
    (b"RegExp", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"flags", b"sticky", b"unicode"] },
        FeatureMapEntry { lib: b"es2018", props: &[b"dotAll"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"unicodeSets"] },
    ]),
    (b"RegExpConstructor", &[
        FeatureMapEntry { lib: b"es2025", props: &[b"escape"] },
    ]),
    (b"Reflect", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"apply", b"construct", b"defineProperty", b"deleteProperty", b"get", b"getOwnPropertyDescriptor", b"getPrototypeOf", b"has", b"isExtensible", b"ownKeys", b"preventExtensions", b"set", b"setPrototypeOf"] },
    ]),
    (b"ArrayConstructor", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"from", b"of"] },
        FeatureMapEntry { lib: b"esnext", props: &[b"fromAsync"] },
    ]),
    (b"ObjectConstructor", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"assign", b"getOwnPropertySymbols", b"keys", b"is", b"setPrototypeOf"] },
        FeatureMapEntry { lib: b"es2017", props: &[b"values", b"entries", b"getOwnPropertyDescriptors"] },
        FeatureMapEntry { lib: b"es2019", props: &[b"fromEntries"] },
        FeatureMapEntry { lib: b"es2022", props: &[b"hasOwn"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"groupBy"] },
    ]),
    (b"NumberConstructor", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"isFinite", b"isInteger", b"isNaN", b"isSafeInteger", b"parseFloat", b"parseInt"] },
    ]),
    (b"Math", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"clz32", b"imul", b"sign", b"log10", b"log2", b"log1p", b"expm1", b"cosh", b"sinh", b"tanh", b"acosh", b"asinh", b"atanh", b"hypot", b"trunc", b"fround", b"cbrt"] },
        FeatureMapEntry { lib: b"es2025", props: &[b"f16round"] },
    ]),
    (b"Map", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"entries", b"keys", b"values"] },
        FeatureMapEntry { lib: b"esnext", props: &[b"getOrInsert", b"getOrInsertComputed"] },
    ]),
    (b"MapConstructor", &[
        FeatureMapEntry { lib: b"es2024", props: &[b"groupBy"] },
    ]),
    (b"Set", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"entries", b"keys", b"values"] },
        FeatureMapEntry { lib: b"es2025", props: &[b"union", b"intersection", b"difference", b"symmetricDifference", b"isSubsetOf", b"isSupersetOf", b"isDisjointFrom"] },
    ]),
    (b"PromiseConstructor", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"all", b"race", b"reject", b"resolve"] },
        FeatureMapEntry { lib: b"es2020", props: &[b"allSettled"] },
        FeatureMapEntry { lib: b"es2021", props: &[b"any"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"withResolvers"] },
        FeatureMapEntry { lib: b"es2025", props: &[b"try"] },
    ]),
    (b"Symbol", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"for", b"keyFor"] },
        FeatureMapEntry { lib: b"es2019", props: &[b"description"] },
    ]),
    (b"WeakMap", &[
        FeatureMapEntry { lib: b"es2015", props: &[] },
        FeatureMapEntry { lib: b"esnext", props: &[b"getOrInsert", b"getOrInsertComputed"] },
    ]),
    (b"WeakSet", &[
        FeatureMapEntry { lib: b"es2015", props: &[] },
    ]),
    (b"String", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"codePointAt", b"includes", b"endsWith", b"normalize", b"repeat", b"startsWith", b"anchor", b"big", b"blink", b"bold", b"fixed", b"fontcolor", b"fontsize", b"italics", b"link", b"small", b"strike", b"sub", b"sup"] },
        FeatureMapEntry { lib: b"es2017", props: &[b"padStart", b"padEnd"] },
        FeatureMapEntry { lib: b"es2019", props: &[b"trimStart", b"trimEnd", b"trimLeft", b"trimRight"] },
        FeatureMapEntry { lib: b"es2020", props: &[b"matchAll"] },
        FeatureMapEntry { lib: b"es2021", props: &[b"replaceAll"] },
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2024", props: &[b"isWellFormed", b"toWellFormed"] },
    ]),
    (b"StringConstructor", &[
        FeatureMapEntry { lib: b"es2015", props: &[b"fromCodePoint", b"raw"] },
    ]),
    (b"DateTimeFormat", &[
        FeatureMapEntry { lib: b"es2017", props: &[b"formatToParts"] },
    ]),
    (b"Promise", &[
        FeatureMapEntry { lib: b"es2015", props: &[] },
        FeatureMapEntry { lib: b"es2018", props: &[b"finally"] },
    ]),
    (b"RegExpMatchArray", &[
        FeatureMapEntry { lib: b"es2018", props: &[b"groups"] },
    ]),
    (b"RegExpExecArray", &[
        FeatureMapEntry { lib: b"es2018", props: &[b"groups"] },
    ]),
    (b"Intl", &[
        FeatureMapEntry { lib: b"es2018", props: &[b"PluralRules"] },
        FeatureMapEntry { lib: b"es2020", props: &[b"RelativeTimeFormat", b"Locale", b"DisplayNames"] },
        FeatureMapEntry { lib: b"es2021", props: &[b"ListFormat", b"DateTimeFormat"] },
        FeatureMapEntry { lib: b"es2022", props: &[b"Segmenter"] },
        FeatureMapEntry { lib: b"es2025", props: &[b"DurationFormat"] },
    ]),
    (b"NumberFormat", &[
        FeatureMapEntry { lib: b"es2018", props: &[b"formatToParts"] },
    ]),
    (b"SymbolConstructor", &[
        FeatureMapEntry { lib: b"es2020", props: &[b"matchAll"] },
        FeatureMapEntry { lib: b"esnext", props: &[b"metadata", b"dispose", b"asyncDispose"] },
    ]),
    (b"DataView", &[
        FeatureMapEntry { lib: b"es2020", props: &[b"setBigInt64", b"setBigUint64", b"getBigInt64", b"getBigUint64"] },
        FeatureMapEntry { lib: b"es2025", props: &[b"setFloat16", b"getFloat16"] },
    ]),
    (b"BigInt", &[
        FeatureMapEntry { lib: b"es2020", props: &[] },
    ]),
    (b"RelativeTimeFormat", &[
        FeatureMapEntry { lib: b"es2020", props: &[b"format", b"formatToParts", b"resolvedOptions"] },
    ]),
    (b"Int8Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Uint8Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Uint8ClampedArray", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Int16Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Uint16Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Int32Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Uint32Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Float16Array", &[
        FeatureMapEntry { lib: b"es2025", props: &[] },
    ]),
    (b"Float32Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Float64Array", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"BigInt64Array", &[
        FeatureMapEntry { lib: b"es2020", props: &[] },
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"BigUint64Array", &[
        FeatureMapEntry { lib: b"es2020", props: &[] },
        FeatureMapEntry { lib: b"es2022", props: &[b"at"] },
        FeatureMapEntry { lib: b"es2023", props: &[b"findLastIndex", b"findLast", b"toReversed", b"toSorted", b"toSpliced", b"with"] },
    ]),
    (b"Error", &[
        FeatureMapEntry { lib: b"es2022", props: &[b"cause"] },
    ]),
    (b"ErrorConstructor", &[
        FeatureMapEntry { lib: b"esnext", props: &[b"isError"] },
    ]),
    (b"Uint8ArrayConstructor", &[
        FeatureMapEntry { lib: b"esnext", props: &[b"fromBase64", b"fromHex"] },
    ]),
    (b"DisposableStack", &[
        FeatureMapEntry { lib: b"esnext", props: &[] },
    ]),
    (b"AsyncDisposableStack", &[
        FeatureMapEntry { lib: b"esnext", props: &[] },
    ]),
    (b"Date", &[
        FeatureMapEntry { lib: b"esnext", props: &[b"toTemporalInstant"] },
    ]),
];

pub fn range_of_type_parameters(
    a: Ast<'_>,
    source_file: NodeId,
    type_parameters: NodeListId,
) -> TextRange {
    let text = a.as_source_file(source_file).text();
    let text_len = i32::try_from(text.len()).unwrap_or(i32::MAX);
    new_text_range(
        a.list_pos(type_parameters).saturating_sub(1),
        text_len.min(skip_trivia(text, a.list_end(type_parameters)).saturating_add(1)),
    )
}

pub fn try_get_property_access_or_identifier_to_string(a: Ast<'_>, expr: NodeId) -> Vec<u8> {
    if !stack_is_safe(a, expr) {
        return Vec::new();
    }
    if is_property_access_expression(a, expr) {
        let mut base_str = try_get_property_access_or_identifier_to_string(a, a.expression(expr));
        if !base_str.is_empty() {
            base_str.push(b'.');
            base_str.extend_from_slice(&entity_name_to_string(a, a.name(expr)));
            return base_str;
        }
    } else if is_element_access_expression(a, expr) {
        let mut base_str = try_get_property_access_or_identifier_to_string(a, a.expression(expr));
        let argument_expression = a.as_element_access_expression(expr).argument_expression;
        if !base_str.is_empty() && is_property_name(a, argument_expression) {
            base_str.push(b'.');
            base_str.extend_from_slice(&get_property_name_for_property_name_node(
                a,
                argument_expression,
            ));
            return base_str;
        }
    } else if is_identifier(a, expr) {
        return a.text(expr).to_vec();
    } else if is_jsx_namespaced_name(a, expr) {
        return entity_name_to_string(a, expr);
    }
    Vec::new()
}

pub fn all_declarations_in_same_source_file(a: Ast<'_>, symbol: SymbolId) -> bool {
    let declarations = a.sym(symbol).declarations;
    if declarations.len() > 1 {
        let mut source_file = NodeId::NIL;
        for (i, &d) in declarations.as_slice().iter().enumerate() {
            if i == 0 {
                source_file = get_source_file_of_node(a, d);
            } else if get_source_file_of_node(a, d) != source_file {
                return false;
            }
        }
    }
    true
}

pub fn contains_non_missing_undefined_type(c: &Checker<'_>, t: TypeId) -> bool {
    let candidate = if c.types[t].flags.intersects(TypeFlags::UNION) {
        c.as_union_type(t).types.at(0usize)
    } else {
        t
    };
    c.types[candidate].flags.intersects(TypeFlags::UNDEFINED) && candidate != c.missing_type
}

pub fn get_any_import_syntax(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportEqualsDeclaration => node,
        Kind::ImportClause => a.parent(node),
        Kind::NamespaceImport => a.parent(a.parent(node)),
        Kind::ImportSpecifier => a.parent(a.parent(a.parent(node))),
        _ => NodeId::NIL,
    }
}

// A reserved member name consists of the byte 0xFE (which is an invalid UTF-8 encoding) followed by one or more characters where the first character is not '@' or '#'. The '@' character indicates that the name is denoted by a well known ES Symbol instance and the '#' character indicates that the name is a PrivateIdentifier.
pub fn is_reserved_member_name(name: &[u8]) -> bool {
    name.len() >= 2
        && name.first() == Some(&0xFE)
        && name.get(1) != Some(&b'@')
        && name.get(1) != Some(&b'#')
}

pub fn introduces_arguments_exotic_object(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
    )
}

// The entries of the table are visited in insertion order, where the order of a Go map is random.
pub fn symbols_to_array(a: Ast<'_>, symbols: SymbolTableId) -> Vec<SymbolId> {
    let mut result: Vec<SymbolId> = Vec::new();
    let mut position = 0;
    while let Some((id, symbol)) = a.table_entry_at(symbols, position) {
        position += 1;
        if !is_reserved_member_name(id) {
            result.push(symbol);
        }
    }
    result
}

pub fn skip_alias(symbol: SymbolId, checker: &mut Checker<'_>) -> SymbolId {
    if checker.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
        return checker.get_aliased_symbol(symbol);
    }
    symbol
}

// True if the symbol is for an external module, as opposed to a namespace.
pub fn is_external_module_symbol(a: Ast<'_>, module_symbol: SymbolId) -> bool {
    let symbol = a.sym(module_symbol);
    let (first_rune, _) = utf8::decode_rune_in_string(symbol.name);
    symbol.flags.intersects(SymbolFlags::MODULE) && first_rune == u32::from(b'"')
}

impl<'a> Checker<'a> {
    // The checker has no context that cancels a check: upstream's `ctx` is nil here.
    pub fn is_canceled(&self) -> bool {
        false
    }

    pub fn check_not_canceled(&self) {
        if self.was_canceled {
            let _: () = self.fail("Checker was previously cancelled");
        }
    }

    pub fn get_packages_map(&mut self) -> &Map<Text<'a>, bool> {
        if self.packages_map.is_nil() {
            self.packages_map = Map::make();
            let program = self.program;
            let packages_map = &mut self.packages_map;
            let mut written = true;
            program.for_each_resolved_module(&mut |module| {
                if !module.package_id.name.is_empty() {
                    let bundles_types = packages_map.get(&module.package_id.name)
                        || module.extension == EXTENSION_DTS;
                    written &= packages_map.set(module.package_id.name, bundles_types);
                }
            });
            self.map_set(written);
        }
        &self.packages_map
    }

    pub fn types_package_exists(&mut self, package_name: &[u8]) -> bool {
        let packages_map = self.get_packages_map();
        packages_map
            .get_ok(&get_types_package_name(package_name).as_slice())
            .is_some()
    }

    pub fn package_bundles_types(&mut self, package_name: &[u8]) -> bool {
        let packages_map = self.get_packages_map();
        packages_map.get(&package_name)
    }
}

// The nil value has no text: upstream panics there, and no sink for an internal diagnostic is at hand here.
pub fn value_to_string(value: &LiteralValue<'_>) -> Vec<u8> {
    match value {
        LiteralValue::String(value) => {
            let escaped = escape_string(value, QuoteChar::DOUBLE_QUOTE);
            let mut result = Vec::with_capacity(escaped.len() + 2);
            result.push(b'"');
            result.extend_from_slice(&escaped);
            result.push(b'"');
            result
        }
        LiteralValue::Number(value) => Number(*value).string(),
        LiteralValue::Boolean(value) => {
            if_else(*value, b"true".as_slice(), b"false".as_slice()).to_vec()
        }
        LiteralValue::BigInt(value) => {
            let mut result = value.string();
            result.push(b'n');
            result
        }
        LiteralValue::Nil => Vec::new(),
    }
}

pub fn node_starts_new_lexical_environment(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Constructor
            | Kind::FunctionExpression
            | Kind::FunctionDeclaration
            | Kind::ArrowFunction
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::ModuleDeclaration
            | Kind::SourceFile
    )
}

impl<'a> Checker<'a> {
    // Determines whether a did-you-mean error should be a suggestion in an unchecked JS file. Only applies to unchecked JS files without checkJS, // @ts-check or // @ts-nocheck. It does not suggest when the suggestion is from a global file that is different from the reference file, or (optionally) is a class, or is a this.x property access expression.
    pub fn is_unchecked_js_suggestion(
        &self,
        node: NodeId,
        suggestion: SymbolId,
        exclude_classes: bool,
    ) -> bool {
        let a = self.ast;
        let file = get_source_file_of_node(a, node);
        if !file.is_nil() {
            let source_file = a.as_source_file(file);
            if self.compiler_options.check_js.is_unknown()
                && source_file.check_js_directive.is_none()
                && (source_file.script_kind == ScriptKind::JS
                    || source_file.script_kind == ScriptKind::JSX)
            {
                let mut declaration_file = NodeId::NIL;
                if !suggestion.is_nil() {
                    let first_declaration = first_or_nil(a.sym(suggestion).declarations.as_slice());
                    if !first_declaration.is_nil() {
                        declaration_file = get_source_file_of_node(a, first_declaration);
                    }
                }
                let value_declaration = a.sym(suggestion).value_declaration;
                let suggestion_has_no_extends_or_decorators = suggestion.is_nil()
                    || value_declaration.is_nil()
                    || !is_class_like(a, value_declaration)
                    || !get_extends_heritage_clause_elements(a, value_declaration).is_empty()
                    || class_or_constructor_parameter_is_decorated(a, false, value_declaration);
                return !(file != declaration_file
                    && !declaration_file.is_nil()
                    && is_global_source_file(a, declaration_file))
                    && !(exclude_classes
                        && !suggestion.is_nil()
                        && a.sym(suggestion).flags.intersects(SymbolFlags::CLASS)
                        && suggestion_has_no_extends_or_decorators)
                    && !(!node.is_nil()
                        && exclude_classes
                        && is_property_access_expression(a, node)
                        && a.kind(a.expression(node)) == Kind::ThisKeyword
                        && suggestion_has_no_extends_or_decorators);
            }
        }
        false
    }

    // Returns if a type is or consists of a JSLiteral object type. In addition to objects which are directly literals, unions where every element is a jsliteral, intersections where at least one element is a jsliteral, and instantiable types constrained to a jsliteral should all count as literals and not print errors on access or assignment of possibly existing properties. This mirrors the behavior of the index signature propagation, to which this behaves similarly (but doesn't affect assignability or inference).
    pub fn is_js_literal_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.no_implicit_any {
            // Flag is meaningless under `noImplicitAny` mode
            return false;
        }
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::JS_LITERAL)
        {
            return true;
        }
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            let types = self.as_union_type(t).types;
            return every(types.as_slice(), |t| self.is_js_literal_type(t));
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.as_intersection_type(t).types;
            return some(types.as_slice(), |t| self.is_js_literal_type(t));
        }
        if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            let constraint = self.get_resolved_base_constraint(t, &mut Vec::new());
            return constraint != t && self.is_js_literal_type(constraint);
        }
        false
    }
}

// DiagnosticDetails holds a resolved diagnostic message and its arguments, used for sharing diagnostic chain computation between the checker and incremental builder.
#[derive(Clone, Debug, Default)]
pub struct DiagnosticDetails {
    pub message: MessageId,
    pub args: Vec<Vec<u8>>,
}

// CreateModuleNotFoundChain computes the diagnostic message and arguments for a module-not-found error chain entry. This is shared between the checker (initial diagnostic creation) and the incremental builder (repopulation of cached diagnostics). Mirrors createModuleNotFoundChain in the TypeScript compiler's utilities.ts.
pub fn create_module_not_found_chain(
    program: &dyn Program<'_>,
    file: NodeId,
    module_reference: &[u8],
    mode: ResolutionMode,
    package_name: &[u8],
) -> DiagnosticDetails {
    let resolved_module = program.get_resolved_module(file, module_reference, mode);

    if let Some(resolved_module) = resolved_module {
        if !resolved_module.alternate_result.is_empty() {
            let mut package_name = package_name.to_vec();
            if strings::contains(resolved_module.alternate_result, b"/node_modules/@types/") {
                package_name = [
                    b"@types/".as_slice(),
                    &mangle_scoped_package_name(&package_name),
                ]
                .concat();
            }
            return DiagnosticDetails {
                message: diagnostics::THERE_ARE_TYPES_AT_0_BUT_THIS_RESULT_COULD_NOT_BE_RESOLVED_WHEN_RESPECTING_PACKAGE_JSON_EXPORTS_THE_1_LIBRARY_MAY_NEED_TO_UPDATE_ITS_PACKAGE_JSON_OR_TYPINGS,
                args: vec![resolved_module.alternate_result.to_vec(), package_name],
            };
        }
    }

    if program
        .get_packages_map_entry(&get_types_package_name(package_name))
        .is_some()
    {
        return DiagnosticDetails {
            message: diagnostics::IF_THE_0_PACKAGE_ACTUALLY_EXPOSES_THIS_MODULE_CONSIDER_SENDING_A_PULL_REQUEST_TO_AMEND_HTTPS_COLON_SLASH_SLASHGITHUB_COM_SLASHDEFINITELYTYPED_SLASHDEFINITELYTYPED_SLASHTREE_SLASHMASTER_SLASHTYPES_SLASH_1,
            args: vec![
                package_name.to_vec(),
                mangle_scoped_package_name(package_name),
            ],
        };
    }
    if program
        .get_packages_map_entry(package_name)
        .unwrap_or(false)
    {
        return DiagnosticDetails {
            message: diagnostics::IF_THE_0_PACKAGE_ACTUALLY_EXPOSES_THIS_MODULE_TRY_ADDING_A_NEW_DECLARATION_D_TS_FILE_CONTAINING_DECLARE_MODULE_1,
            args: vec![package_name.to_vec(), module_reference.to_vec()],
        };
    }
    DiagnosticDetails {
        message: diagnostics::TRY_NPM_I_SAVE_DEV_TYPES_SLASH_1_IF_IT_EXISTS_OR_ADD_A_NEW_DECLARATION_D_TS_FILE_CONTAINING_DECLARE_MODULE_0,
        args: vec![
            module_reference.to_vec(),
            mangle_scoped_package_name(package_name),
        ],
    }
}

// CreateModeMismatchDetails computes the diagnostic message and arguments for a mode-mismatch error chain entry. This is shared between the checker (initial diagnostic creation) and the incremental builder (repopulation of cached diagnostics). Mirrors createModeMismatchDetails in the TypeScript compiler's utilities.ts.
pub fn create_mode_mismatch_details(
    a: Ast<'_>,
    program: &dyn Program<'_>,
    file: NodeId,
) -> DiagnosticDetails {
    let ext = try_get_extension_from_path(a.as_source_file(file).file_name());
    let target_ext = if_else(
        ext == EXTENSION_TS,
        EXTENSION_MTS,
        if_else(ext == EXTENSION_JS, EXTENSION_MJS, b"".as_slice()),
    );
    let meta = program.get_source_file_meta_data(file);
    let package_json_type = meta.package_json_type;
    let package_json_directory = meta.package_json_directory;

    if !package_json_directory.is_empty() && package_json_type.is_empty() {
        if !target_ext.is_empty() {
            return DiagnosticDetails {
                message: diagnostics::TO_CONVERT_THIS_FILE_TO_AN_ECMASCRIPT_MODULE_CHANGE_ITS_FILE_EXTENSION_TO_0_OR_ADD_THE_FIELD_TYPE_COLON_MODULE_TO_1,
                args: vec![
                    target_ext.to_vec(),
                    combine_paths(&package_json_directory, &[b"package.json".as_slice()]),
                ],
            };
        }
        return DiagnosticDetails {
            message: diagnostics::TO_CONVERT_THIS_FILE_TO_AN_ECMASCRIPT_MODULE_ADD_THE_FIELD_TYPE_COLON_MODULE_TO_0,
            args: vec![combine_paths(
                &package_json_directory,
                &[b"package.json".as_slice()],
            )],
        };
    }
    if !target_ext.is_empty() {
        return DiagnosticDetails {
            message: diagnostics::TO_CONVERT_THIS_FILE_TO_AN_ECMASCRIPT_MODULE_CHANGE_ITS_FILE_EXTENSION_TO_0_OR_CREATE_A_LOCAL_PACKAGE_JSON_FILE_WITH_TYPE_COLON_MODULE,
            args: vec![target_ext.to_vec()],
        };
    }
    DiagnosticDetails {
        message: diagnostics::TO_CONVERT_THIS_FILE_TO_AN_ECMASCRIPT_MODULE_CREATE_A_LOCAL_PACKAGE_JSON_FILE_WITH_TYPE_COLON_MODULE,
        args: Vec::new(),
    }
}

pub fn walk_up_outer_expressions(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut parent = a.parent(node);
    while !parent.is_nil() && is_outer_expression(a, parent, OuterExpressionKinds::ALL) {
        parent = a.parent(parent);
    }
    parent
}

pub fn get_set_accessor_value_parameter(a: Ast<'_>, accessor: NodeId) -> NodeId {
    let parameters = a.parameters(accessor);
    if parameters.len() > 0 {
        let has_this = parameters.len() == 2 && is_this_parameter(a, parameters.at(0usize));
        return parameters.at(if_else(has_this, 1usize, 0usize));
    }
    NodeId::NIL
}

// slices.SortFunc of Go (slices/zsortanyfunc.go): a pattern-defeating quicksort that is not stable. The sequence of its comparisons decides which of two symbols without declaration gets the lower symbol id first, so the algorithm is part of what upstream computes.
pub(crate) mod slices {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum SortedHint {
        Unknown,
        Increasing,
        Decreasing,
    }

    struct Sorter<'d, E> {
        data: &'d mut [E],
        is_less: &'d mut dyn FnMut(E, E) -> bool,
    }

    impl<E: Copy> Sorter<'_, E> {
        // `cmp(data[i], data[j]) < 0`
        fn less(&mut self, i: isize, j: isize) -> bool {
            let at = |index: isize| usize::try_from(index).ok();
            let (Some(i), Some(j)) = (at(i), at(j)) else {
                return false;
            };
            match (self.data.get(i), self.data.get(j)) {
                (Some(a), Some(b)) => (self.is_less)(*a, *b),
                _ => false,
            }
        }

        // `data[i], data[j] = data[j], data[i]`
        fn swap(&mut self, i: isize, j: isize) {
            if let (Ok(i), Ok(j)) = (usize::try_from(i), usize::try_from(j)) {
                if i < self.data.len() && j < self.data.len() {
                    self.data.swap(i, j);
                }
            }
        }

        // insertionSortCmpFunc sorts data[a:b] using insertion sort.
        fn insertion_sort(&mut self, a: isize, b: isize) {
            for i in a + 1..b {
                let mut j = i;
                while j > a && self.less(j, j - 1) {
                    self.swap(j, j - 1);
                    j -= 1;
                }
            }
        }

        // siftDownCmpFunc implements the heap property on data[lo:hi]. first is an offset into the array where the root of the heap lies.
        fn sift_down(&mut self, lo: isize, hi: isize, first: isize) {
            let mut root = lo;
            loop {
                let mut child = 2 * root + 1;
                if child >= hi {
                    break;
                }
                if child + 1 < hi && self.less(first + child, first + child + 1) {
                    child += 1;
                }
                if !self.less(first + root, first + child) {
                    return;
                }
                self.swap(first + root, first + child);
                root = child;
            }
        }

        fn heap_sort(&mut self, a: isize, b: isize) {
            let first = a;
            let lo = 0;
            let hi = b - a;
            // Build heap with greatest element at top.
            let mut i = (hi - 1) / 2;
            while i >= 0 {
                self.sift_down(i, hi, first);
                i -= 1;
            }
            // Pop elements, largest first, into end of data.
            let mut i = hi - 1;
            while i >= 0 {
                self.swap(first, first + i);
                self.sift_down(lo, i, first);
                i -= 1;
            }
        }

        // pdqsortCmpFunc sorts data[a:b]. limit is the number of allowed bad (very unbalanced) pivots before falling back to heapsort.
        fn pdqsort(&mut self, a: isize, b: isize, limit: isize) {
            const MAX_INSERTION: isize = 12;
            let (mut a, mut b, mut limit) = (a, b, limit);
            // whether the last partitioning was reasonably balanced
            let mut was_balanced = true;
            // whether the slice was already partitioned
            let mut was_partitioned = true;
            loop {
                let length = b - a;
                if length <= MAX_INSERTION {
                    self.insertion_sort(a, b);
                    return;
                }
                // Fall back to heapsort if too many bad choices were made.
                if limit == 0 {
                    self.heap_sort(a, b);
                    return;
                }
                // If the last partitioning was imbalanced, we need to breakPatterns.
                if !was_balanced {
                    self.break_patterns(a, b);
                    limit -= 1;
                }
                let (mut pivot, mut hint) = self.choose_pivot(a, b);
                if hint == SortedHint::Decreasing {
                    self.reverse_range(a, b);
                    // The chosen pivot was pivot-a elements after the start of the array. After reversing it is pivot-a elements before the end of the array.
                    pivot = (b - 1) - (pivot - a);
                    hint = SortedHint::Increasing;
                }
                // The slice is likely already sorted.
                if was_balanced
                    && was_partitioned
                    && hint == SortedHint::Increasing
                    && self.partial_insertion_sort(a, b)
                {
                    return;
                }
                // Probably the slice contains many duplicate elements, partition the slice into elements equal to and elements greater than the pivot.
                if a > 0 && !self.less(a - 1, pivot) {
                    let mid = self.partition_equal(a, b, pivot);
                    a = mid;
                    continue;
                }
                let (mid, already_partitioned) = self.partition(a, b, pivot);
                was_partitioned = already_partitioned;
                let (left_len, right_len) = (mid - a, b - mid);
                let balance_threshold = length / 8;
                if left_len < right_len {
                    was_balanced = left_len >= balance_threshold;
                    self.pdqsort(a, mid, limit);
                    a = mid + 1;
                } else {
                    was_balanced = right_len >= balance_threshold;
                    self.pdqsort(mid + 1, b, limit);
                    b = mid;
                }
            }
        }

        // partitionCmpFunc does one quicksort partition. On return, data[newpivot] = p, data[a:newpivot] < p and data[newpivot+1:b] >= p.
        fn partition(&mut self, a: isize, b: isize, pivot: isize) -> (isize, bool) {
            self.swap(a, pivot);
            // i and j are inclusive of the elements remaining to be partitioned
            let (mut i, mut j) = (a + 1, b - 1);
            while i <= j && self.less(i, a) {
                i += 1;
            }
            while i <= j && !self.less(j, a) {
                j -= 1;
            }
            if i > j {
                self.swap(j, a);
                return (j, true);
            }
            self.swap(i, j);
            i += 1;
            j -= 1;
            loop {
                while i <= j && self.less(i, a) {
                    i += 1;
                }
                while i <= j && !self.less(j, a) {
                    j -= 1;
                }
                if i > j {
                    break;
                }
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
            self.swap(j, a);
            (j, false)
        }

        // partitionEqualCmpFunc partitions data[a:b] into elements equal to data[pivot] followed by elements greater than data[pivot].
        fn partition_equal(&mut self, a: isize, b: isize, pivot: isize) -> isize {
            self.swap(a, pivot);
            // i and j are inclusive of the elements remaining to be partitioned
            let (mut i, mut j) = (a + 1, b - 1);
            loop {
                while i <= j && !self.less(a, i) {
                    i += 1;
                }
                while i <= j && self.less(a, j) {
                    j -= 1;
                }
                if i > j {
                    break;
                }
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
            i
        }

        // partialInsertionSortCmpFunc partially sorts a slice, returns true if the slice is sorted at the end.
        fn partial_insertion_sort(&mut self, a: isize, b: isize) -> bool {
            // maximum number of adjacent out-of-order pairs that will get shifted
            const MAX_STEPS: isize = 5;
            // don't shift any elements on short arrays
            const SHORTEST_SHIFTING: isize = 50;
            let mut i = a + 1;
            for _ in 0..MAX_STEPS {
                while i < b && !self.less(i, i - 1) {
                    i += 1;
                }
                if i == b {
                    return true;
                }
                if b - a < SHORTEST_SHIFTING {
                    return false;
                }
                self.swap(i, i - 1);
                // Shift the smaller one to the left.
                if i - a >= 2 {
                    let mut j = i - 1;
                    while j >= 1 {
                        if !self.less(j, j - 1) {
                            break;
                        }
                        self.swap(j, j - 1);
                        j -= 1;
                    }
                }
                // Shift the greater one to the right.
                if b - i >= 2 {
                    for j in i + 1..b {
                        if !self.less(j, j - 1) {
                            break;
                        }
                        self.swap(j, j - 1);
                    }
                }
            }
            false
        }

        // breakPatternsCmpFunc scatters some elements around in an attempt to break some patterns that might cause imbalanced partitions in quicksort.
        fn break_patterns(&mut self, a: isize, b: isize) {
            let length = b - a;
            if length >= 8 {
                let mut random = length as u64;
                let modulus = 1u64 << bits_len(length);
                let idx_first = a + (length / 4) * 2 - 1;
                for idx in idx_first..=a + (length / 4) * 2 + 1 {
                    // xorshift.Next
                    random ^= random << 13;
                    random ^= random >> 7;
                    random ^= random << 17;
                    let mut other = (random & (modulus - 1)) as isize;
                    if other >= length {
                        other -= length;
                    }
                    self.swap(idx, a + other);
                }
            }
        }

        // choosePivotCmpFunc chooses a pivot in data[a:b]. [0,8): chooses a static pivot. [8,shortestNinther): uses the simple median-of-three method. [shortestNinther,∞): uses the Tukey ninther method.
        fn choose_pivot(&mut self, a: isize, b: isize) -> (isize, SortedHint) {
            const SHORTEST_NINTHER: isize = 50;
            const MAX_SWAPS: isize = 4 * 3;
            let l = b - a;
            let mut swaps = 0;
            let mut i = a + l / 4;
            let mut j = a + l / 4 * 2;
            let mut k = a + l / 4 * 3;
            if l >= 8 {
                if l >= SHORTEST_NINTHER {
                    // Tukey ninther method, the idea came from Rust's implementation.
                    i = self.median_adjacent(i, &mut swaps);
                    j = self.median_adjacent(j, &mut swaps);
                    k = self.median_adjacent(k, &mut swaps);
                }
                // Find the median among i, j, k and stores it into j.
                j = self.median(i, j, k, &mut swaps);
            }
            match swaps {
                0 => (j, SortedHint::Increasing),
                MAX_SWAPS => (j, SortedHint::Decreasing),
                _ => (j, SortedHint::Unknown),
            }
        }

        // order2CmpFunc returns x,y where data[x] <= data[y], where x,y=a,b or x,y=b,a.
        fn order2(&mut self, a: isize, b: isize, swaps: &mut isize) -> (isize, isize) {
            if self.less(b, a) {
                *swaps += 1;
                return (b, a);
            }
            (a, b)
        }

        // medianCmpFunc returns x where data[x] is the median of data[a],data[b],data[c], where x is a, b, or c.
        fn median(&mut self, a: isize, b: isize, c: isize, swaps: &mut isize) -> isize {
            let (a, b) = self.order2(a, b, swaps);
            let (b, _) = self.order2(b, c, swaps);
            let (_, b) = self.order2(a, b, swaps);
            b
        }

        // medianAdjacentCmpFunc finds the median of data[a - 1], data[a], data[a + 1] and stores the index into a.
        fn median_adjacent(&mut self, a: isize, swaps: &mut isize) -> isize {
            self.median(a - 1, a, a + 1, swaps)
        }

        fn reverse_range(&mut self, a: isize, b: isize) {
            let mut i = a;
            let mut j = b - 1;
            while i < j {
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
        }
    }

    // bits.Len
    fn bits_len(n: isize) -> u32 {
        usize::BITS - (n as usize).leading_zeros()
    }

    // slices.SortFunc with `cmp(a, b) < 0` as the comparison.
    pub(crate) fn sort_func<E: Copy>(x: &mut [E], is_less: &mut dyn FnMut(E, E) -> bool) {
        let n = x.len() as isize;
        let mut sorter = Sorter { data: x, is_less };
        sorter.pdqsort(0, n, bits_len(n) as isize);
    }
}
